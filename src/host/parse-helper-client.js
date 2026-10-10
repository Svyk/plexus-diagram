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

// Readiness is per capability. `ocr` is scan reading (Read the scan, cell re-reads, the OCR
// text layer). `docling` is layout + TableFormer (`/v1/jobs`, Parse with Docling). A body with
// no `engines` array keeps the old rule: `state` is ready only when layout, tableformer and ocr
// are all ready. An OCR-only helper (`engines` includes "ocr", `models.ocr` is "ready", and it
// does not advertise "docling") is ready for scans while Docling stays off.
function classifyModels(body) {
  const models = body?.models || {};
  const engines = Array.isArray(body?.engines) ? body.engines : [];
  const listed = engines.length > 0;
  const docling = models.layout === "ready" && models.tableformer === "ready";
  const ocr = listed
    ? engines.includes("ocr") && models.ocr === "ready"
    : docling && models.ocr === "ready";
  let state;
  if (!listed) {
    const missing = ["layout", "tableformer", "ocr"].some((name) => models[name] !== "ready");
    state = missing ? "models-missing" : "ready";
  } else if (engines.includes("docling") && !docling) {
    state = "models-missing";
  } else if (ocr || docling) {
    state = "ready";
  } else {
    state = "models-missing";
  }
  const vlmTables = engines.includes("vlm-tables");
  const vlmLayout = engines.includes("vlm-layout");
  const vlmText = engines.includes("vlm-text");
  return {
    state, engines, ocr, docling, vlmTables, vlmLayout, vlmText,
    vlmHigh: vlmTables && vlmLayout && vlmText,
    models,
  };
}

// Scan reading. A health object that does not say `ocr` (older callers, tests) is ready for
// scans when `state` is "ready".
export function helperCanOcr(health) {
  if (!health) return false;
  if (typeof health.ocr === "boolean") return health.ocr;
  return health.state === "ready";
}

// Layout and TableFormer. Same fallback as helperCanOcr when the helper does not say.
export function helperCanDocling(health) {
  if (!health) return false;
  if (typeof health.docling === "boolean") return health.docling;
  return health.state === "ready";
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

export const TOKEN_SETTING = "parse-helper-token";

export function createHelperClient({ fetch: fetchImpl, settings, setSetting, now, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  const fetchFn = fetchImpl;
  const clock = typeof now === "function" ? now : () => Date.now();
  let healthCache = null;
  let probeCache = null;
  let vlmOn = false;
  let vlmHighOn = false;
  const setVlm = (tables, high) => { vlmOn = tables === true; vlmHighOn = high === true; };

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

  async function health({ force = false } = {}) {
    const { url, token } = config();
    const at = clock();
    if (!force && healthCache && healthCache.url === url && healthCache.token === token && at - healthCache.at < HEALTH_CACHE_MS) {
      return healthCache.value;
    }
    if (!token) {
      setVlm(false, false);
      const value = { state: "not-running", reason: "disabled" };
      healthCache = { url, token, at, value };
      return value;
    }
    if (typeof fetchFn !== "function") {
      setVlm(false, false);
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
      if (res.status === 401) { setVlm(false, false); value = { state: "wrong-token" }; }
      else if (!httpOk) { setVlm(false, false); value = { state: "not-running" }; }
      else {
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        const major = schemaMajor(body?.schema);
        if (body?.helper !== HELPER_NAME || major == null) { setVlm(false, false); value = { state: "not-running" }; }
        else if (major >= 2) { setVlm(false, false); value = { state: "newer-schema", schema: body.schema }; }
        else {
          const flags = classifyModels(body);
          setVlm(flags.vlmTables === true, flags.vlmHigh === true);
          value = {
            state: flags.state,
            schema: body.schema,
            models: flags.models,
            version: body.version,
            engines: flags.engines,
            ocr: flags.ocr,
            docling: flags.docling,
            vlmTables: flags.vlmTables,
            vlmLayout: flags.vlmLayout,
            vlmText: flags.vlmText,
            vlmHigh: flags.vlmHigh,
          };
          if (flags.state === "ready") value.busy = body.busy ?? 0;
        }
      }
      healthCache = { url, token, at, value };
      return value;
    } catch {
      setVlm(false, false);
      const value = { state: "not-running" };
      healthCache = { url, token, at, value };
      return value;
    } finally {
      timer.clear();
    }
  }

  function invalidate() {
    healthCache = null;
    probeCache = null;
  }

  // No token yet: is something answering on the address? An unauthenticated health is 401 with
  // the helper's name. Anything else (refused, timeout, a different server) is "not installed".
  async function probe({ force = false } = {}) {
    const { url } = config();
    const at = clock();
    if (!force && probeCache && probeCache.url === url && at - probeCache.at < HEALTH_CACHE_MS) return probeCache.value;
    let value = { state: "not-installed" };
    if (typeof fetchFn === "function") {
      const timer = withTimeout(timeoutMs);
      try {
        const res = await call(`${url}/v1/health`, { method: "GET" }, timer.signal);
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        if (res.status === 401 && body?.helper === HELPER_NAME) value = { state: "not-paired" };
      } catch { /* refused or timed out */ } finally {
        timer.clear();
      }
    }
    probeCache = { url, at, value };
    return value;
  }

  async function models() {
    const { url, token } = config();
    if (!token || typeof fetchFn !== "function") return null;
    const timer = withTimeout(timeoutMs);
    try {
      const res = await call(`${url}/v1/models`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, timer.signal);
      if (res.status < 200 || res.status >= 300) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      timer.clear();
    }
  }

  // The Engines panel row state. One of: not-installed, not-paired, not-running, wrong-token,
  // newer-schema, models-missing, downloading, ready. `ocr` and `docling` travel with it when
  // health classified them. `force` skips the 60 s cache (pane open, panel visible). `paired`
  // is true when a token is stored.
  async function status({ force = false } = {}) {
    const { token } = config();
    if (!token) return { ...(await probe({ force })), paired: false };
    const h = await health({ force });
    if (h.state === "models-missing") {
      const report = await models();
      const bytes = Number(report?.bytes) || 0;
      const done = Number(report?.done) || 0;
      const fraction = Number.isFinite(report?.fraction) ? report.fraction : (bytes ? done / bytes : 0);
      if (report?.state === "downloading") {
        return { ...h, state: "downloading", paired: true, progress: { bytes, done, fraction } };
      }
      return { ...h, paired: true, progress: { bytes, done, fraction } };
    }
    return { ...h, paired: true };
  }

  // Ask the helper for its token. It answers only inside the 90 s pairing window and only to an
  // allowed Origin, so this works right after install.sh or `plexus-parse-helper pair`.
  async function pair({ signal } = {}) {
    const { url } = config();
    if (typeof fetchFn !== "function") return { ok: false, reason: "not-running" };
    if (typeof setSetting !== "function") return { ok: false, reason: "no-settings" };
    const timer = withTimeout(timeoutMs, signal);
    try {
      const res = await call(`${url}/v1/pair`, { method: "GET" }, timer.signal);
      if (res.status === 404) return { ok: false, reason: "window-closed" };
      if (res.status < 200 || res.status >= 300) return { ok: false, reason: "error", status: res.status };
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (body?.helper !== HELPER_NAME || typeof body.token !== "string" || !body.token) return { ok: false, reason: "error" };
      await setSetting(TOKEN_SETTING, body.token);
      invalidate();
      return { ok: true, version: body.version };
    } catch {
      return { ok: false, reason: "not-running" };
    } finally {
      timer.clear();
    }
  }

  async function downloadModels() {
    const { url, token } = config();
    if (!token || typeof fetchFn !== "function") return false;
    try {
      const res = await call(`${url}/v1/models/download`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      invalidate();
      return res.status === 202 || res.status === 200;
    } catch {
      return false;
    }
  }

  async function cancelModels() {
    const { url, token } = config();
    if (!token || typeof fetchFn !== "function") return false;
    try {
      const res = await call(`${url}/v1/models/download`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      invalidate();
      return res.status === 200;
    } catch {
      return false;
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

  // Scanned pages: POST /v1/ocr with the PDF bytes. `pages` → pxd-ocr/1 page records
  // (cached by the helper); `cells` → re-read of single cells, never cached. One call.
  async function ocr({ bytes, sha256, pages, cells, signal } = {}) {
    const { url, token } = config();
    const sha = sha256 || await sha256Hex(bytes);
    const options = {};
    if (pages && pages.length) options.pages = pages;
    if (cells && cells.length) options.cells = cells.map((c) => ({ page: c.page, bbox: c.bbox }));
    const res = await call(`${url}/v1/ocr`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
        "X-Pxd-Options": JSON.stringify(options),
      },
      body: bytes,
    }, signal);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status < 200 || res.status >= 300) {
      const error = new Error(body?.error || `ocr ${res.status}`);
      error.status = res.status;
      throw error;
    }
    if (cells && cells.length && Array.isArray(body?.cells)) {
      // Hand the caller's ids back beside the helper's answers (same order as sent).
      body.cells = body.cells.map((c, i) => ({ ...cells[i], ...c }));
    }
    return { ...body, sha256: sha };
  }

  // Table crops for a helper that advertises vlm-tables. Same PDF body as ocr().
  // `tables` is [{page, bbox}] in PDF points, origin top-left.
  async function tables({ bytes, sha256, pages, tables: regions, signal } = {}) {
    const { url, token } = config();
    const sha = sha256 || await sha256Hex(bytes);
    const options = {};
    if (pages && pages.length) options.pages = pages;
    if (regions && regions.length) options.tables = regions.map((t) => ({ page: t.page, bbox: t.bbox }));
    const res = await call(`${url}/v1/tables`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
        "X-Pxd-Options": JSON.stringify(options),
      },
      body: bytes,
    }, signal);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status < 200 || res.status >= 300) {
      const error = new Error(body?.error || `tables ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return { ...body, sha256: sha };
  }

  // High-accuracy read. Layout boxes, table readings, optional OCR lines, figure hints.
  // `tables` are the caller's boxes, united with the layout boxes. `numericPages`
  // are pages with aligned numeric columns. `boxMode` is optional.
  async function vlm({ bytes, sha256, pages, tables: regions, text = false, numericPages, boxMode, signal } = {}) {
    const { url, token } = config();
    const sha = sha256 || await sha256Hex(bytes);
    const options = { text: text === true };
    if (pages && pages.length) options.pages = pages;
    if (regions && regions.length) options.tables = regions.map((t) => ({ page: t.page, bbox: t.bbox }));
    if (numericPages && numericPages.length) options.numericPages = numericPages;
    if (boxMode) options.boxMode = boxMode;
    const res = await call(`${url}/v1/vlm`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
        "X-Pxd-Options": JSON.stringify(options),
      },
      body: bytes,
    }, signal);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status < 200 || res.status >= 300) {
      const error = new Error(body?.error || `vlm ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return { ...body, sha256: sha };
  }

  function endpoint() {
    const { url, token } = config();
    return { url, token };
  }

  return {
    health, status, pair, models, downloadModels, cancelModels, invalidate, parse, cancel, reparseTable, ocr, tables, vlm, endpoint,
    get vlmTables() { return vlmOn; },
    get vlmHigh() { return vlmHighOn; },
  };
}
