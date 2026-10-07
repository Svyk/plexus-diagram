// Browser client for the local parse helper. Fetch only, with
// targetAddressSpace "loopback". Health is cached 60 s and times out at
// 1500 ms. A parse is HEAD cache → POST /v1/jobs → SSE → one final GET.
// No polling and no calls until the caller asks. EventSource is not used:
// it cannot send Authorization.

import { optionsHash, sha256Hex } from "../model/parse-hash.js";
import { mergeScoped } from "../model/parse-schema.js";

export const HEALTH_TIMEOUT_MS = 1500;
export const HEALTH_CACHE_MS = 60_000;
export const HELPER_NAME = "plexus-parse-helper";

function readSetting(settings, id, fallback) {
  try {
    if (typeof settings === "function") {
      const all = settings();
      if (all && typeof all.get === "function") {
        const value = all.get(id);
        return value == null || value === "" ? fallback : value;
      }
      if (all && typeof all === "object") return all[id] == null || all[id] === "" ? fallback : all[id];
      return fallback;
    }
    if (settings && typeof settings.get === "function") {
      const value = settings.get(id);
      return value == null || value === "" ? fallback : value;
    }
    if (settings && typeof settings === "object") {
      return settings[id] == null || settings[id] === "" ? fallback : settings[id];
    }
  } catch { /* a throwing settings getter is "unset" */ }
  return fallback;
}

function schemaMajor(schema) {
  const match = /\/(\d+)/.exec(String(schema || ""));
  return match ? Number(match[1]) : null;
}

function withTimeout(ms, parent) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (parent) {
    if (parent.aborted) ctrl.abort();
    else parent.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    clear() {
      clearTimeout(timer);
      parent?.removeEventListener?.("abort", onAbort);
    },
  };
}

async function readSSE(response, { onProgress, onPage }) {
  const reader = response.body?.getReader?.();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = "";
  const dispatch = (frame) => {
    let event = "message";
    const data = [];
    for (const line of frame.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return null;
    const payload = JSON.parse(data.join("\n"));
    if (event === "progress") onProgress?.(payload);
    else if (event === "page") onPage?.(payload);
    else if (event === "error") {
      const error = new Error(payload.message || "parse error");
      error.code = payload.code;
      error.page = payload.page;
      throw error;
    }
    return event;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, "\n");
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      if (dispatch(frame) === "done") {
        try { await reader.cancel(); } catch { /* the stream may already be closed */ }
        return;
      }
    }
  }
  if (buf.trim()) dispatch(buf);
}

export function createHelperClient({ fetch: fetchImpl, settings, now, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  const fetchFn = fetchImpl;
  const clock = typeof now === "function" ? now : () => Date.now();
  let healthCache = null;

  const config = () => {
    const url = String(readSetting(settings, "parse-helper-url", "http://127.0.0.1:48765")).replace(/\/$/, "");
    const token = String(readSetting(settings, "parse-helper-token", "") || "").trim();
    return { url, token };
  };

  const call = (url, init, signal) => fetchFn(url, {
    ...init,
    targetAddressSpace: "loopback",
    signal: signal ?? init?.signal,
  });

  async function health() {
    const { url, token } = config();
    const at = clock();
    if (healthCache && healthCache.url === url && healthCache.token === token && at - healthCache.at < HEALTH_CACHE_MS) {
      return healthCache.value;
    }
    if (!token) {
      const value = { state: "not-running", reason: "disabled" };
      healthCache = { url, token, at, value };
      return value;
    }
    if (typeof fetchFn !== "function") {
      const value = { state: "not-running" };
      healthCache = { url, token, at, value };
      return value;
    }
    const timer = withTimeout(timeoutMs);
    try {
      const res = await call(`${url}/v1/health`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }, timer.signal);
      let value;
      const httpOk = res.status >= 200 && res.status < 300;
      if (res.status === 401) value = { state: "wrong-token" };
      else if (!httpOk) value = { state: "not-running" };
      else {
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        const major = schemaMajor(body?.schema);
        if (body?.helper !== HELPER_NAME || major == null) value = { state: "not-running" };
        else if (major >= 2) value = { state: "newer-schema", schema: body.schema };
        else {
          const models = body.models || {};
          const needed = ["layout", "tableformer", "ocr"];
          const missing = needed.some((name) => models[name] !== "ready");
          value = missing
            ? { state: "models-missing", schema: body.schema, models, version: body.version }
            : { state: "ready", schema: body.schema, models, version: body.version, busy: body.busy ?? 0 };
        }
      }
      healthCache = { url, token, at, value };
      return value;
    } catch {
      const value = { state: "not-running" };
      healthCache = { url, token, at, value };
      return value;
    } finally {
      timer.clear();
    }
  }

  async function readJob(base, token, jobId, { onProgress, onPage, signal }) {
    const headers = { Authorization: `Bearer ${token}` };
    const events = await call(`${base}/v1/jobs/${encodeURIComponent(jobId)}/events`, {
      method: "GET",
      headers,
    }, signal);
    await readSSE(events, { onProgress, onPage });
    const finalRes = await call(`${base}/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      headers,
    }, signal);
    const doc = await finalRes.json();
    return doc;
  }

  async function parse({ bytes, sha256, options, onProgress, onPage, signal } = {}) {
    const { url, token } = config();
    const sha = sha256 || await sha256Hex(bytes);
    const optsHash = await optionsHash(options || {});
    const headers = { Authorization: `Bearer ${token}` };
    const cacheUrl = `${url}/v1/cache/${encodeURIComponent(sha)}?opts=${encodeURIComponent(optsHash)}`;
    const head = await call(cacheUrl, { method: "HEAD", headers }, signal);
    if (head.status === 200) {
      const got = await call(cacheUrl, { method: "GET", headers }, signal);
      return { doc: await got.json(), cached: true, sha256: sha, optsHash, job: null };
    }
    const posted = await call(`${url}/v1/jobs`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "X-Pxd-Options": JSON.stringify(options || {}),
      },
      body: bytes,
    }, signal);
    const job = await posted.json();
    if (posted.status === 409) {
      const error = new Error("helper busy");
      error.status = 409;
      error.running = job?.running;
      throw error;
    }
    const doc = await readJob(url, token, job.job, { onProgress, onPage, signal });
    return { doc, cached: false, sha256: sha, optsHash, job: job.job };
  }

  async function cancel(jobId) {
    const { url, token } = config();
    const res = await call(`${url}/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status === 204 || res.status === 200;
  }

  // Scope requests are not cached. Pass `base` to merge the page result
  // (IoU ≥ 0.5) into a mixed document. Without `base`, `merged` is null.
  async function reparseTable({ bytes, sha256, page, bbox, base, onProgress, onPage, signal } = {}) {
    const { url, token } = config();
    const sha = sha256 || await sha256Hex(bytes);
    const ocr = readSetting(settings, "parse-ocr", "auto");
    const formula = readSetting(settings, "parse-formula", false) === true;
    const options = {
      pages: [page],
      ocr,
      formula,
      tables: "accurate",
      scope: { page, bbox },
    };
    const posted = await call(`${url}/v1/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
        "X-Pxd-Options": JSON.stringify(options),
      },
      body: bytes,
    }, signal);
    const job = await posted.json();
    const doc = await readJob(url, token, job.job, { onProgress, onPage, signal });
    const merged = base ? mergeScoped(base, doc, { page, bbox }) : null;
    return { doc, merged, cached: false, sha256: sha, job: job.job };
  }

  return { health, parse, cancel, reparseTable };
}
