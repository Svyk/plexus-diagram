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

export const CLOUD_STORAGE = Object.freeze({
  key: "pxd-cloud-key",
  region: "pxd-cloud-region",
  tier: "pxd-cloud-tier",
  relay: "pxd-cloud-relay",
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

export function resolveCloudTransport({ helper, relayUrl } = {}) {
  const url = String(helper?.url || "").replace(/\/$/, "");
  const token = String(helper?.token || "").trim();
  if (helper?.state === "ready" && url && token) return { kind: "helper", url, token };
  const relay = String(relayUrl || "").trim().replace(/\/$/, "");
  if (/^https:\/\//i.test(relay)) return { kind: "relay", url: relay };
  return {
    kind: "none",
    reason: "Pair the local helper, or set a cloud relay URL in Engines. Roam cannot call LlamaParse directly.",
  };
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

function statusError(status, body) {
  if (status === 401) return fail("unauthorized", "LlamaParse rejected the key", 401);
  if (status === 402) return fail("credits", "LlamaParse is out of credits", 402);
  if (status === 429) return fail("rate", "LlamaParse rate limit", 429);
  const message = body?.detail || body?.error || body?.message || `LlamaParse ${status}`;
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

async function relayParse({ fetch, transport, bytes, apiKey, region, tier, signal, onProgress, sleep, now, timeoutMs }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "X-Pxd-Region": region === "eu" ? "eu" : "us",
  };
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
  const started = await fetch(`${transport.url}/api/v2/parse`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      tier,
      version: "latest",
      output_options: { granular_bboxes: ["cell"] },
    }),
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
      fetch: fetchFn, transport, bytes, apiKey: key, region: where, tier, signal, onProgress, sleep, now, timeoutMs,
    });
    return { provider, transport: "relay" };
  }
  throw fail("transport", "unknown cloud transport");
}
