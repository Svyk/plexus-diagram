// Forwards only LlamaParse file upload, parse, result, and cancel.
// Stores nothing. The caller's Authorization header is passed through and not logged.
// Region is us or eu. Any other upstream host is refused.

const HOSTS = {
  us: "https://api.cloud.llamaindex.ai",
  eu: "https://api.cloud.eu.llamaindex.ai",
};

const ORIGINS = new Set(["https://roamresearch.com", "app://roam"]);

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

    const headers = new Headers();
    const auth = request.headers.get("Authorization");
    if (auth) headers.set("Authorization", auth);
    const type = request.headers.get("Content-Type");
    if (type) headers.set("Content-Type", type);
    const res = await fetch(upstream + url.pathname + url.search, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
      redirect: "manual",
    });
    const out = new Headers();
    const contentType = res.headers.get("content-type");
    if (contentType) out.set("content-type", contentType);
    if (allow) for (const [key, value] of Object.entries(allow)) out.set(key, value);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
