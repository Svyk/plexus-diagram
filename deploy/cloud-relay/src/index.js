// Forwards only LlamaParse upload, start, poll, expanded result, and cancel.
// Stores nothing. Does not log headers or bodies. The caller's Authorization
// is copied through unchanged. Cookies are not forwarded and not set.
// Region is us or eu. Any other upstream host is refused.

const HOSTS = {
  us: "https://api.cloud.llamaindex.ai",
  eu: "https://api.cloud.eu.llamaindex.ai",
};

const ORIGINS = new Set(["https://roamresearch.com", "app://roam"]);

// Workers Free account plan, not the Workers plan. Over this, Cloudflare
// answers 413 before the worker runs. We refuse first so the body is not fetched.
// https://developers.cloudflare.com/workers/platform/limits/ (page updated 2026-10-08)
export const MAX_BODY_BYTES = 100 * 1024 * 1024;

function allowed(method, path) {
  if (method === "POST" && (path === "/api/v1/beta/files" || path === "/api/v2/parse")) return true;
  if (method === "GET" && /^\/api\/v2\/parse\/[^/]+$/.test(path)) return true;
  if (method === "POST" && /^\/api\/v2\/parse\/[^/]+\/cancel$/.test(path)) return true;
  return false;
}

function cors(origin) {
  if (!origin || !ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Pxd-Region",
    "Access-Control-Max-Age": "600",
  };
}

function json(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(extra || {}) },
  });
}

export async function readLimitedBody(request, max = MAX_BODY_BYTES) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return { body: undefined };
  }
  const rawLength = request.headers.get("content-length");
  if (rawLength != null && rawLength !== "") {
    const declared = Number(rawLength);
    if (Number.isFinite(declared) && declared > max) return { status: 413 };
    return { body: request.body };
  }
  if (request.body == null) return { body: undefined };
  const reader = request.body.getReader();
  const chunks = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value?.byteLength || 0;
    if (seen > max) {
      try { await reader.cancel(); } catch { /* closed */ }
      return { status: 413 };
    }
    chunks.push(value);
  }
  return { body: new Blob(chunks) };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const allow = cors(origin);
    if (origin && !allow) return json(403, { error: "forbidden" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: allow || {} });

    const url = new URL(request.url);
    if (!allowed(request.method, url.pathname)) return json(404, { error: "not a parse route" }, allow);
    const region = (request.headers.get("X-Pxd-Region") || "").toLowerCase() === "eu" ? "eu" : "us";
    const upstream = HOSTS[region];
    const limited = await readLimitedBody(request);
    if (limited.status === 413) return json(413, { error: "body too large", maxBytes: MAX_BODY_BYTES }, allow);

    const headers = new Headers();
    const auth = request.headers.get("Authorization");
    if (auth) headers.set("Authorization", auth);
    const type = request.headers.get("Content-Type");
    if (type) headers.set("Content-Type", type);
    const res = await fetch(upstream + url.pathname + url.search, {
      method: request.method,
      headers,
      body: limited.body,
      redirect: "manual",
    });
    const out = new Headers();
    const contentType = res.headers.get("content-type");
    if (contentType) out.set("content-type", contentType);
    if (allow) for (const [key, value] of Object.entries(allow)) out.set(key, value);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
