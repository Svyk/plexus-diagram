// LlamaParse client. Fetch only, and only after the caller has confirmed.
// Transport: the paired local helper, else an https relay URL, else a reason
// and no request. The API key is read from this device's storage. Nothing
// here writes the graph, and importing this module fetches nothing.

export const CREDIT_USD = 1.25 / 1000;
export const LAYOUT_CREDITS = 3;
export const TIER_CREDITS = Object.freeze({
  fast: 1,
  cost_effective: 3,
  agentic: 10,
  agentic_plus: 45,
});
export const TIER_LABELS = Object.freeze({
  fast: "Fast",
  cost_effective: "Cost-effective",
  agentic: "Agentic",
  agentic_plus: "Agentic Plus",
});
export const DEFAULT_TIER = "agentic";
export const DEFAULT_TIMEOUT_MS = 240_000;

// Empty until `npm run relay:deploy`. The orchestrator pastes the workers.dev URL here.
export const DEFAULT_RELAY_URL = "https://plexus-cloud-relay.svyk.workers.dev";

export const MISTRAL_MODEL = "mistral-ocr-latest";
export const MISTRAL_URL = "https://api.mistral.ai/v1/ocr";
export const MISTRAL_USD_PER_PAGE = 4 / 1000;
// Model card https://docs.mistral.ai/models/mistral-ocr-latest , read 2026-10-09.
export const MISTRAL_PRICE_CHECKED = "2026-10-09";
// Cookbook limit for one OCR request. The upload API allows more; this path does not use it.
export const MISTRAL_MAX_BYTES = 50 * 1024 * 1024;

export const CLOUD_STORAGE = Object.freeze({
  key: "pxd-cloud-key",
  region: "pxd-cloud-region",
  tier: "pxd-cloud-tier",
  relay: "pxd-cloud-relay",
  mistralKey: "pxd-cloud-mistral-key",
});

const HELPER_PATH = "/v1/cloud/parse";

function fail(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (status != null) error.status = status;
  return error;
}

function storageGet(storage, id) {
  try {
    const value = storage?.getItem?.(id);
    return value == null ? "" : String(value);
  } catch {
    return "";
  }
}

export function readCloudPrefs(storage) {
  const region = storageGet(storage, CLOUD_STORAGE.region) === "eu" ? "eu" : "us";
  const tierRaw = storageGet(storage, CLOUD_STORAGE.tier);
  const tier = Object.prototype.hasOwnProperty.call(TIER_CREDITS, tierRaw) ? tierRaw : DEFAULT_TIER;
  return {
    key: storageGet(storage, CLOUD_STORAGE.key).trim(),
    region,
    tier,
    relay: storageGet(storage, CLOUD_STORAGE.relay).trim(),
  };
}

// `key: null` keeps the key already stored. A string, including "", replaces it.
export function writeCloudPrefs(storage, prefs = {}) {
  const prev = readCloudPrefs(storage);
  const next = {
    key: prefs.key == null ? prev.key : String(prefs.key).trim(),
    region: prefs.region == null ? prev.region : (prefs.region === "eu" ? "eu" : "us"),
    tier: prefs.tier == null ? prev.tier : (Object.prototype.hasOwnProperty.call(TIER_CREDITS, prefs.tier) ? prefs.tier : DEFAULT_TIER),
    relay: prefs.relay == null ? prev.relay : String(prefs.relay).trim(),
  };
  storage.setItem(CLOUD_STORAGE.key, next.key);
  storage.setItem(CLOUD_STORAGE.region, next.region);
  storage.setItem(CLOUD_STORAGE.tier, next.tier);
  storage.setItem(CLOUD_STORAGE.relay, next.relay);
  return { ...next };
}

export function estimateCloudCost({ pages, tier, layout = true } = {}) {
  const count = Math.max(0, Math.floor(Number(pages) || 0));
  const perTier = TIER_CREDITS[tier] ?? TIER_CREDITS[DEFAULT_TIER];
  const extra = layout ? LAYOUT_CREDITS : 0;
  const creditsPerPage = perTier + extra;
  const credits = count * creditsPerPage;
  return {
    pages: count,
    tier: TIER_CREDITS[tier] ? tier : DEFAULT_TIER,
    tierCredits: perTier,
    layoutCredits: extra,
    creditsPerPage,
    credits,
    usd: credits * CREDIT_USD,
    cacheNote: "free if parsed in the last 48 h",
  };
}

function money(usd) {
  const n = Number(usd) || 0;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function cloudConfirmMessage({ pages, tier, region } = {}) {
  const est = estimateCloudCost({ pages, tier, layout: true });
  const where = region === "eu" ? "EU" : "US";
  const label = TIER_LABELS[est.tier] || est.tier;
  const pageText = est.pages ? `${est.pages} page${est.pages === 1 ? "" : "s"}` : "page count unknown";
  return `Send this PDF to LlamaParse (${where}, ${label})? ${pageText}, about ${money(est.usd)} (${est.credits} credits: ${est.tierCredits} per page plus ${est.layoutCredits} for layout). The pricing FAQ says layout is free in v2; this estimate includes it. Free if this file was parsed with the same options in the last 48 hours. The PDF leaves this device.`;
}

function httpsUrl(value) {
  const url = String(value || "").trim().replace(/\/$/, "");
  return /^https:\/\//i.test(url) ? url : "";
}

// Panel label for the LlamaParse route. A ready helper counts only when it lists `cloud`,
// or when it does not list engines at all.
export function llamaRoute(prefs, helper, defaultRelay = DEFAULT_RELAY_URL) {
  const engines = helper?.engines;
  const paired = helper?.state === "ready" && (!Array.isArray(engines) || engines.includes("cloud"));
  if (paired) return "helper";
  if (httpsUrl(prefs?.relay)) return "your relay";
  if (httpsUrl(defaultRelay)) return "hosted relay";
  return "";
}

export function resolveCloudTransport({ helper, relayUrl, defaultRelay = DEFAULT_RELAY_URL } = {}) {
  const url = String(helper?.url || "").replace(/\/$/, "");
  const token = String(helper?.token || "").trim();
  const engines = helper?.engines;
  const cloudEngine = !Array.isArray(engines) || engines.includes("cloud");
  if (helper?.state === "ready" && url && token && cloudEngine) return { kind: "helper", url, token };
  const user = httpsUrl(relayUrl);
  if (user) return { kind: "relay", url: user, source: "user" };
  const hosted = httpsUrl(defaultRelay);
  if (hosted) return { kind: "relay", url: hosted, source: "default" };
  return {
    kind: "none",
    reason: "Pair a local helper that includes the cloud engine, or set a relay URL in Engines. The hosted relay URL is empty until it is deployed. Roam cannot call LlamaParse directly.",
  };
}

export function readMistralKey(storage) {
  return storageGet(storage, CLOUD_STORAGE.mistralKey).trim();
}

// `null` keeps the stored key. A string, including "", replaces it.
export function writeMistralKey(storage, key) {
  const next = key == null ? readMistralKey(storage) : String(key).trim();
  storage.setItem(CLOUD_STORAGE.mistralKey, next);
  return next;
}

export function estimateMistralCost({ pages } = {}) {
  const count = Math.max(0, Math.floor(Number(pages) || 0));
  return {
    pages: count,
    usd: count * MISTRAL_USD_PER_PAGE,
    perThousand: 4,
    checked: MISTRAL_PRICE_CHECKED,
  };
}

export function mistralConfirmMessage({ pages } = {}) {
  const est = estimateMistralCost({ pages });
  const pageText = est.pages ? `${est.pages} page${est.pages === 1 ? "" : "s"}` : "page count unknown";
  return `Send this PDF to Mistral OCR? ${pageText}, about ${money(est.usd)} ($4 / 1,000 pages, model card checked ${est.checked}). Tables are weaker than LlamaParse. The PDF leaves this device.`;
}

export function pageSpec(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    return value.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1).join(",");
  }
  return String(value).trim();
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(fail("cancelled", "cancelled", 499));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(fail("cancelled", "cancelled", 499));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function readSSE(response, onEvent) {
  const reader = response.body?.getReader?.();
  if (!reader) throw fail("bad-response", "no progress stream");
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
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n"));
    onEvent(event, payload);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, "\n");
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) dispatch(frame);
  }
  if (buf.trim()) dispatch(buf);
}

function statusError(status, body, name = "LlamaParse") {
  if (status === 401) return fail("unauthorized", `${name} rejected the key`, 401);
  if (status === 402) return fail("credits", `${name} is out of credits`, 402);
  if (status === 429) return fail("rate", `${name} rate limit`, 429);
  const message = body?.detail || body?.error || body?.message || `${name} ${status}`;
  return fail("provider", String(message), status);
}

async function helperParse({ fetch, transport, bytes, apiKey, region, tier, signal, onProgress }) {
  const headers = {
    Authorization: `Bearer ${transport.token}`,
    "X-Pxd-Cloud-Key": apiKey,
    "X-Pxd-Options": JSON.stringify({ region, tier, version: "latest" }),
    "Content-Type": "application/pdf",
  };
  let jobId = "";
  const onAbort = () => {
    if (!jobId) return;
    Promise.resolve(fetch(`${transport.url}${HELPER_PATH}/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${transport.token}` },
      targetAddressSpace: "loopback",
    })).catch(() => {});
  };
  signal?.addEventListener?.("abort", onAbort, { once: true });
  let response;
  try {
    response = await fetch(`${transport.url}${HELPER_PATH}`, {
      method: "POST",
      headers,
      body: bytes,
      targetAddressSpace: "loopback",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw fail("cancelled", "cancelled", 499);
    throw error;
  }
  if (response.status === 401) throw fail("unauthorized", "local helper rejected its token", 401);
  if (response.status < 200 || response.status >= 300) {
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    throw statusError(response.status, body);
  }
  let provider = null;
  await readSSE(response, (event, payload) => {
    if (event === "started") jobId = payload?.job || jobId;
    else if (event === "progress") {
      if (payload?.job) jobId = payload.job;
      onProgress?.(payload);
    } else if (event === "result") provider = payload;
    else if (event === "error") {
      const error = fail(payload?.code || "provider", payload?.message || "cloud parse failed", payload?.status);
      throw error;
    }
  });
  if (!provider) throw fail("bad-response", "cloud parse returned no result");
  return provider;
}

async function relayParse({ fetch, transport, bytes, apiKey, region, tier, pages, signal, onProgress, sleep, now, timeoutMs }) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (!transport.direct) headers["X-Pxd-Region"] = region === "eu" ? "eu" : "us";
  const clock = now;
  const pause = sleep;
  const deadline = clock() + timeoutMs;
  const form = new FormData();
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: "application/pdf" });
  form.append("purpose", "parse");
  form.append("file", blob, "document.pdf");
  const uploaded = await fetch(`${transport.url}/api/v1/beta/files`, {
    method: "POST",
    headers,
    body: form,
    signal,
  });
  const uploadBody = await uploaded.json().catch(() => null);
  if (uploaded.status < 200 || uploaded.status >= 300) throw statusError(uploaded.status, uploadBody);
  const fileId = uploadBody?.id;
  if (!fileId) throw fail("bad-response", "upload did not return a file id");
  const spec = pageSpec(pages);
  const payload = {
    file_id: fileId,
    tier,
    version: "latest",
    output_options: { granular_bboxes: ["cell"] },
  };
  if (spec) payload.page_ranges = { target_pages: spec };
  const started = await fetch(`${transport.url}/api/v2/parse`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const startBody = await started.json().catch(() => null);
  if (started.status < 200 || started.status >= 300) throw statusError(started.status, startBody);
  const jobId = startBody?.id || startBody?.job?.id;
  if (!jobId) throw fail("bad-response", "parse did not return a job id");
  const cancelRemote = () => {
    Promise.resolve(fetch(`${transport.url}/api/v2/parse/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    })).catch(() => {});
  };
  signal?.addEventListener?.("abort", cancelRemote, { once: true });
  let delay = 1000;
  let status = startBody?.status || startBody?.job?.status || "PENDING";
  while (status !== "COMPLETED" && status !== "FAILED" && status !== "CANCELLED") {
    if (signal?.aborted) throw fail("cancelled", "cancelled", 499);
    if (clock() >= deadline) throw fail("timeout", "LlamaParse timed out", 504);
    await pause(delay, signal);
    delay = Math.min(delay * 2, 8000);
    if (clock() >= deadline) throw fail("timeout", "LlamaParse timed out", 504);
    const polled = await fetch(`${transport.url}/api/v2/parse/${encodeURIComponent(jobId)}`, { headers, signal });
    const body = await polled.json().catch(() => null);
    if (polled.status < 200 || polled.status >= 300) throw statusError(polled.status, body);
    status = body?.job?.status || body?.status || "";
    onProgress?.({ status, job: jobId });
  }
  if (status === "CANCELLED") throw fail("cancelled", "cancelled", 499);
  if (status !== "COMPLETED") throw fail("failed", "LlamaParse failed the job", 502);
  const done = await fetch(`${transport.url}/api/v2/parse/${encodeURIComponent(jobId)}?expand=items&expand=markdown&expand=usage`, {
    headers,
    signal,
  });
  const provider = await done.json().catch(() => null);
  if (done.status < 200 || done.status >= 300) throw statusError(done.status, provider);
  return provider;
}

export async function parseCloud({
  fetch: fetchFn,
  transport,
  bytes,
  apiKey,
  region = "us",
  tier = DEFAULT_TIER,
  pages,
  confirmed = false,
  signal,
  onProgress,
  sleep = wait,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (confirmed !== true) throw fail("confirm", "confirm required");
  if (typeof fetchFn !== "function") throw fail("no-fetch", "no fetch");
  if (!transport || transport.kind === "none") throw fail("transport", transport?.reason || resolveCloudTransport().reason);
  const key = String(apiKey || "").trim();
  if (!key) throw fail("no-key", "Add a LlamaParse key in Engines. It stays on this device.");
  if (!Object.prototype.hasOwnProperty.call(TIER_CREDITS, tier)) throw fail("bad-tier", "bad tier");
  const where = region === "eu" ? "eu" : "us";
  if (transport.kind === "helper") {
    const provider = await helperParse({
      fetch: fetchFn, transport, bytes, apiKey: key, region: where, tier, signal, onProgress,
    });
    return { provider, transport: "helper" };
  }
  if (transport.kind === "relay") {
    const provider = await relayParse({
      fetch: fetchFn, transport, bytes, apiKey: key, region: where, tier, pages, signal, onProgress, sleep, now, timeoutMs,
    });
    return { provider, transport: "relay" };
  }
  throw fail("transport", "unknown cloud transport");
}

export function bytesToBase64(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    binary += String.fromCharCode(...data.subarray(i, i + step));
  }
  return btoa(binary);
}

function mistralPageIndexes(value) {
  const spec = pageSpec(value);
  if (!spec) return undefined;
  const out = [];
  for (const part of spec.split(",")) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part.trim());
    if (range) {
      const from = Math.min(Number(range[1]), Number(range[2]));
      const to = Math.max(Number(range[1]), Number(range[2]));
      for (let n = from; n <= to; n += 1) out.push(n - 1);
    } else {
      const n = Number(part);
      if (Number.isInteger(n) && n >= 1) out.push(n - 1);
    }
  }
  return out.length ? out : undefined;
}

export async function parseMistral({
  fetch: fetchFn,
  bytes,
  apiKey,
  pages,
  confirmed = false,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (confirmed !== true) throw fail("confirm", "confirm required");
  if (typeof fetchFn !== "function") throw fail("no-fetch", "no fetch");
  const key = String(apiKey || "").trim();
  if (!key) throw fail("no-key", "Add a Mistral OCR key in Engines. It stays on this device.");
  const size = bytes?.byteLength ?? bytes?.length ?? 0;
  if (size > MISTRAL_MAX_BYTES) {
    throw fail("too-large", "This PDF is over 50 MB. Mistral OCR's documented request limit is about 50 MB. Split it and try again.");
  }
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) throw fail("cancelled", "cancelled", 499);
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const indexes = mistralPageIndexes(pages);
  const payload = {
    model: MISTRAL_MODEL,
    document: {
      type: "document_url",
      document_url: `data:application/pdf;base64,${bytesToBase64(bytes)}`,
    },
    table_format: "html",
    extract_header: true,
    extract_footer: true,
    include_blocks: true,
    include_image_base64: false,
  };
  if (indexes) payload.pages = indexes;
  try {
    const response = await fetchFn(MISTRAL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body = await response.json().catch(() => null);
    if (response.status < 200 || response.status >= 300) throw statusError(response.status, body, "Mistral OCR");
    if (!body || !Array.isArray(body.pages)) throw fail("bad-response", "Mistral OCR returned no pages");
    return { provider: body, transport: "direct" };
  } catch (error) {
    if (error?.code) throw error;
    if (signal?.aborted) throw fail("cancelled", "cancelled", 499);
    if (timedOut || ctrl.signal.aborted) throw fail("timeout", "Mistral OCR timed out", 504);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}
