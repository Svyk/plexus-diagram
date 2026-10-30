import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_CACHE_MS,
  HEALTH_TIMEOUT_MS,
  TOKEN_BACKUP_KEY,
  TOKEN_SETTING,
  createHelperClient,
} from "../src/host/parse-helper-client.js";
import { optionsHash } from "../src/model/parse-hash.js";
import { SCHEMA } from "../src/model/parse-schema.js";

const readyBody = {
  helper: "plexus-parse-helper",
  version: "0.1.0",
  schema: SCHEMA,
  engines: ["docling"],
  models: { layout: "ready", tableformer: "ready", ocr: "ready", formula: "missing" },
  busy: 0,
};

function sse(frames) {
  const text = frames.map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`).join("");
  const cut = Math.max(1, Math.floor(text.length / 3));
  const chunks = [text.slice(0, cut), text.slice(cut, cut * 2), text.slice(cut * 2)];
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true };
          const value = new TextEncoder().encode(chunks[i]);
          i += 1;
          return { done: false, value };
        },
        async cancel() { i = chunks.length; },
      };
    },
  };
}

const TOKEN_KEY = "plexus-diagram:parse-helper-token";
function memStorage(initial, { throws = false } = {}) {
  const map = new Map(initial ? [[TOKEN_KEY, initial]] : []);
  return {
    map,
    getItem: (k) => { if (throws) throw new Error("blocked"); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error("blocked"); map.set(k, String(v)); },
  };
}

function client(handler, { clock = () => 0, token = "secret", timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body, targetAddressSpace: init.targetAddressSpace, signal: init.signal });
    return handler(url, init, calls);
  };
  const api = createHelperClient({
    fetch,
    now: clock,
    timeoutMs,
    settings: () => ({ "parse-helper-url": "http://127.0.0.1:48765/" }),
    storage: memStorage(token),
  });
  return { api, calls };
}

test("health distinguishes not-running, wrong-token, ready, models-missing, and newer-schema", async () => {
  assert.equal(HEALTH_TIMEOUT_MS, 1500);
  assert.equal(HEALTH_CACHE_MS, 60000);

  const off = client(() => { throw new Error("no fetch"); }, { token: "" });
  assert.deepEqual(await off.api.health(), { state: "not-running", reason: "disabled" });
  assert.equal(off.calls.length, 0);

  const down = client(() => { throw new Error("refused"); });
  assert.equal((await down.api.health()).state, "not-running");
  assert.equal(down.calls[0].targetAddressSpace, "loopback");

  let now = 0;
  const cached = client(() => ({ status: 200, json: async () => readyBody }), { clock: () => now });
  assert.equal((await cached.api.health()).state, "ready");
  now = 1000;
  assert.equal((await cached.api.health()).state, "ready");
  assert.equal(cached.calls.length, 1);
  now = 60_001;
  await cached.api.health();
  assert.equal(cached.calls.length, 2);
  assert.equal((await cached.api.health()).models.formula, "missing");

  const denied = client(() => ({ status: 401, json: async () => ({ helper: "plexus-parse-helper", auth: "required" }) }));
  assert.equal((await denied.api.health()).state, "wrong-token");

  const missing = client(() => ({
    status: 200,
    json: async () => ({ ...readyBody, models: { ...readyBody.models, layout: "downloading" } }),
  }));
  assert.equal((await missing.api.health()).state, "models-missing");

  const newer = client(() => ({ status: 200, json: async () => ({ ...readyBody, schema: "pxd-parse/2" }) }));
  assert.equal((await newer.api.health()).state, "newer-schema");

  const full = client(() => ({
    status: 200,
    json: async () => ({
      ...readyBody,
      engines: ["docling", "ocr"],
      models: { layout: "ready", tableformer: "ready", ocr: "ready" },
    }),
  }));
  const fullHealth = await full.api.health();
  assert.equal(fullHealth.state, "ready");
  assert.equal(fullHealth.ocr, true);
  assert.equal(fullHealth.docling, true);
  assert.equal(fullHealth.busy, 0);

  const ocrOnly = client(() => ({
    status: 200,
    json: async () => ({
      ...readyBody,
      version: "0.1.0-rs",
      engines: ["ocr"],
      models: { layout: "missing", tableformer: "missing", ocr: "ready" },
    }),
  }));
  const scanHealth = await ocrOnly.api.health();
  assert.equal(scanHealth.state, "ready");
  assert.equal(scanHealth.ocr, true);
  assert.equal(scanHealth.docling, false);

  const pythonPartial = client(() => ({
    status: 200,
    json: async () => ({
      ...readyBody,
      engines: ["docling", "ocr"],
      models: { layout: "missing", tableformer: "missing", ocr: "ready" },
    }),
  }));
  const partial = await pythonPartial.api.health();
  assert.equal(partial.state, "models-missing");
  assert.equal(partial.ocr, true);
  assert.equal(partial.docling, false);

  let aborted = false;
  const slow = client((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      aborted = true;
      reject(new Error("aborted"));
    });
  }), { timeoutMs: 30 });
  assert.equal((await slow.api.health()).state, "not-running");
  assert.equal(aborted, true);
});

test("a cache HEAD hit skips the upload", async () => {
  const hash = await optionsHash({ ocr: "auto", formula: false });
  const { api, calls } = client((url, init) => {
    if (init.method === "HEAD") return { status: 200, json: async () => ({}) };
    if (init.method === "GET") return { status: 200, json: async () => ({ schema: SCHEMA, sha256: "abc", engine: "docling" }) };
    return { status: 500, json: async () => ({}) };
  });
  const result = await api.parse({
    bytes: new Uint8Array([1, 2, 3]),
    sha256: "abc",
    options: { formula: false, ocr: "auto", scope: { page: 1, bbox: [0, 0, 1, 1] } },
  });
  assert.equal(result.cached, true);
  assert.equal(result.doc.engine, "docling");
  assert.equal(result.optsHash, hash);
  assert.deepEqual(calls.map((call) => call.method), ["HEAD", "GET"]);
  assert.equal(calls[0].url.includes(encodeURIComponent(hash)), true);
  assert.equal(calls.every((call) => call.targetAddressSpace === "loopback"), true);
});

test("SSE frames split across chunks report progress, then the final GET", async () => {
  const doc = { schema: SCHEMA, engine: "docling", sha256: "abc", order: ["b1"], blocks: { b1: { id: "b1", type: "para", text: "hi" } } };
  const progress = [];
  const pages = [];
  const { api, calls } = client((url, init) => {
    if (init.method === "HEAD") return { status: 404, json: async () => ({}) };
    if (init.method === "POST") return { status: 202, json: async () => ({ job: "j_1", sha256: "abc", pages: 2, cached: false }) };
    if (url.endsWith("/events")) {
      return {
        status: 200,
        body: sse([
          { event: "progress", data: { page: 1, of: 2, ms: 10 } },
          { event: "page", data: { page: 1, blocks: [{ id: "b1" }] } },
          { event: "done", data: { sha256: "abc", optsHash: "x", elapsedMs: 4 } },
        ]),
      };
    }
    return { status: 200, json: async () => doc };
  });
  const result = await api.parse({
    bytes: new Uint8Array([9]),
    sha256: "abc",
    options: { ocr: "on", formula: true },
    onProgress: (event) => progress.push(event),
    onPage: (event) => pages.push(event),
  });
  assert.equal(result.cached, false);
  assert.equal(result.job, "j_1");
  assert.equal(result.doc.blocks.b1.text, "hi");
  assert.deepEqual(progress, [{ page: 1, of: 2, ms: 10 }]);
  assert.equal(pages[0].blocks[0].id, "b1");
  assert.deepEqual(calls.map((call) => call.method), ["HEAD", "POST", "GET", "GET"]);
  assert.equal(calls[1].headers["Content-Type"], "application/pdf");
  assert.equal(JSON.parse(calls[1].headers["X-Pxd-Options"]).formula, true);
  assert.equal(calls.filter((call) => call.method === "GET" && call.url.includes("/events")).length, 1);
});

test("cancel deletes the job and a scoped re-parse merges without a cache HEAD", async () => {
  const base = {
    schema: SCHEMA,
    engine: "builtin",
    sha256: "abc",
    options: { ocr: "auto" },
    order: ["t1", "p1"],
    blocks: {
      t1: { id: "t1", type: "table", page: 2, bbox: [0, 0, 100, 40], rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "old" }] },
      p1: { id: "p1", type: "para", page: 2, bbox: [0, 80, 100, 100], text: "keep" },
    },
  };
  const pageDoc = {
    schema: SCHEMA,
    engine: "docling",
    engineVersion: "docling-2.91.0",
    order: ["x"],
    blocks: {
      x: { id: "x", type: "table", page: 2, bbox: [0, 0, 100, 40], rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "new" }], engine: "docling" },
    },
  };
  const { api, calls } = client((url, init) => {
    if (init.method === "DELETE") return { status: 204, json: async () => ({}) };
    if (init.method === "POST") return { status: 202, json: async () => ({ job: "j_9" }) };
    if (url.endsWith("/events")) {
      return { status: 200, body: sse([{ event: "done", data: { sha256: "abc", elapsedMs: 3 } }]) };
    }
    return { status: 200, json: async () => pageDoc };
  });
  assert.equal(await api.cancel("j_9"), true);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url.endsWith("/v1/jobs/j_9"), true);
  const again = calls.length;
  const result = await api.reparseTable({
    bytes: new Uint8Array([1]),
    sha256: "abc",
    page: 2,
    bbox: [0, 0, 100, 40],
    base,
  });
  assert.equal(calls.slice(again).some((call) => call.method === "HEAD"), false);
  const posted = calls.slice(again).find((call) => call.method === "POST");
  const options = JSON.parse(posted.headers["X-Pxd-Options"]);
  assert.deepEqual(options.pages, [2]);
  assert.deepEqual(options.scope, { page: 2, bbox: [0, 0, 100, 40] });
  assert.equal(result.doc.blocks.x.cells[0].text, "new");
  assert.equal(result.merged.engine, "mixed");
  assert.equal(result.merged.blocks.d1.engine, "docling");
  assert.equal(result.merged.blocks.d1.cells[0].text, "new");
  assert.equal(result.merged.blocks.p1.text, "keep");
  assert.deepEqual(result.merged.order, ["d1", "p1"]);
});

test("health with vlm-tables sets the flag and tables() posts the boxes", async () => {
  const recorded = { model: "PaddleOCR-VL-0.9B", tables: [{ page: 2, bbox: [1, 2, 3, 4], rows: 1, cols: 1, cells: [] }] };
  const { api, calls } = client((url, init) => {
    if (url.endsWith("/v1/health")) {
      return { status: 200, json: async () => ({ ...readyBody, engines: ["docling", "ocr", "cloud", "vlm-tables"] }) };
    }
    if (url.endsWith("/v1/tables")) return { status: 200, json: async () => recorded };
    return { status: 500, json: async () => ({}) };
  });
  const health = await api.health();
  assert.equal(health.vlmTables, true);
  assert.equal(health.vlmHigh, false);
  assert.equal(api.vlmTables, true);
  assert.equal(api.vlmHigh, false);
  const out = await api.tables({
    bytes: new Uint8Array([9]),
    sha256: "abc",
    pages: [2],
    tables: [{ page: 2, bbox: [1, 2, 3, 4] }],
  });
  assert.equal(out.model, "PaddleOCR-VL-0.9B");
  const posted = calls.find((call) => call.url.endsWith("/v1/tables"));
  assert.equal(posted.method, "POST");
  assert.deepEqual(JSON.parse(posted.headers["X-Pxd-Options"]).tables, [{ page: 2, bbox: [1, 2, 3, 4] }]);
  assert.equal(posted.headers.Authorization, "Bearer secret");
});

test("health with all three vlm engines sets vlmHigh and vlm() posts /v1/vlm", async () => {
  const recorded = {
    model: "PaddleOCR-VL-0.9B",
    layoutModel: "PP-DocLayoutV2",
    tables: [],
    lines: [],
    figures: [],
    layout: [],
  };
  const { api, calls } = client((url, init) => {
    if (url.endsWith("/v1/health")) {
      return { status: 200, json: async () => ({ ...readyBody, engines: ["docling", "ocr", "cloud", "vlm-tables", "vlm-layout", "vlm-text"] }) };
    }
    if (url.endsWith("/v1/vlm")) return { status: 200, json: async () => recorded };
    return { status: 500, json: async () => ({}) };
  });
  const health = await api.health();
  assert.equal(health.vlmHigh, true);
  assert.equal(health.vlmLayout, true);
  assert.equal(health.vlmText, true);
  assert.equal(api.vlmHigh, true);
  const out = await api.vlm({
    bytes: new Uint8Array([9]),
    sha256: "abc",
    pages: [2],
    tables: [{ page: 2, bbox: [1, 2, 3, 4] }],
    text: true,
  });
  assert.equal(out.layoutModel, "PP-DocLayoutV2");
  const posted = calls.find((call) => call.url.endsWith("/v1/vlm"));
  assert.equal(posted.method, "POST");
  assert.deepEqual(JSON.parse(posted.headers["X-Pxd-Options"]), {
    text: true,
    pages: [2],
    tables: [{ page: 2, bbox: [1, 2, 3, 4] }],
  });
  await api.vlm({
    bytes: new Uint8Array([9]),
    pages: [2],
    tables: [{ page: 2, bbox: [1, 2, 3, 4] }],
    numericPages: [2],
    boxMode: "caller",
  });
  const again = calls.filter((call) => call.url.endsWith("/v1/vlm")).at(-1);
  assert.deepEqual(JSON.parse(again.headers["X-Pxd-Options"]), {
    text: false,
    pages: [2],
    tables: [{ page: 2, bbox: [1, 2, 3, 4] }],
    numericPages: [2],
    boxMode: "caller",
  });
});

test("empty bytes: parse and reparseTable throw empty-pdf and never touch the helper", async () => {
  const { api, calls } = client(() => ({ status: 200, json: async () => ({}) }));
  for (const bytes of [new Uint8Array(0), null, undefined]) {
    await assert.rejects(api.parse({ bytes, sha256: "e3b0c442", options: {} }), (error) => error.reason === "empty-pdf");
  }
  await assert.rejects(api.reparseTable({ bytes: new Uint8Array(0), page: 1, bbox: [0, 0, 1, 1] }), (error) => error.reason === "empty-pdf");
  assert.equal(calls.length, 0);
});

test("a rejected job POST is job-rejected and never polls jobs/undefined", async () => {
  const { api, calls } = client((url, init) => {
    if (init.method === "HEAD") return { status: 404, json: async () => ({}) };
    if (init.method === "POST") return { status: 400, json: async () => ({ error: "bad" }) };
    return { status: 200, json: async () => ({}) };
  });
  await assert.rejects(api.parse({ bytes: new Uint8Array([1]), sha256: "abc", options: {} }), (error) => error.reason === "job-rejected" && error.status === 400);
  await assert.rejects(api.reparseTable({ bytes: new Uint8Array([1]), page: 1, bbox: [0, 0, 1, 1] }), (error) => error.reason === "job-rejected" && error.status === 400);
  assert.equal(calls.some((call) => call.url.includes("undefined")), false);
  assert.equal(calls.some((call) => call.method === "GET"), false);
  const ok = client((url, init) => (init.method === "HEAD" ? { status: 404, json: async () => ({}) } : { status: 202, json: async () => ({}) }));
  await assert.rejects(ok.api.parse({ bytes: new Uint8Array([1]), sha256: "abc", options: {} }), (error) => error.reason === "job-rejected");
  assert.equal(ok.calls.some((call) => call.url.includes("undefined")), false);
});

test("ocr: a scan longer than the helper's page cap goes in batches and the pages merge in order", async () => {
  const { createHelperClient, OCR_PAGE_CAP } = await import("../src/host/parse-helper-client.js");
  const sent = [];
  const fetch = async (url, init) => {
    const opts = JSON.parse(init.headers["X-Pxd-Options"] || "{}");
    sent.push(opts.pages);
    return { status: 200, json: async () => ({ schema: "pxd-ocr/1", pageCount: 110, pages: opts.pages.map((n) => ({ n })) }) };
  };
  const settings = { get: (k) => (k === "parse-helper-token" ? "tok" : undefined) };
  const client = createHelperClient({ fetch, settings, setSetting: () => {} });
  const pages = Array.from({ length: 110 }, (_, i) => i + 1);
  const chunks = [];
  const got = await client.ocr({ bytes: new Uint8Array([1]), sha256: "abc", pages, onChunk: (c) => chunks.push(c.done) });
  assert.equal(OCR_PAGE_CAP, 50);
  assert.ok(sent.every((p) => p.length <= OCR_PAGE_CAP));
  assert.deepEqual(sent.map((p) => p.length), [25, 25, 25, 25, 10]);
  assert.deepEqual(got.pages.map((p) => p.n), pages);
  assert.deepEqual(chunks, [25, 50, 75, 100, 110]);
  assert.equal(got.sha256, "abc");
});

function bodyClient(answer) {
  const sent = [];
  const fetch = async (url, init) => {
    const opts = JSON.parse(init.headers["X-Pxd-Options"] || "{}");
    sent.push({ url, opts });
    return { status: 200, json: async () => answer(url, opts) };
  };
  const settings = { get: (k) => (k === "parse-helper-token" ? "tok" : undefined) };
  return { sent, client: createHelperClient({ fetch, settings, setSetting: () => {} }) };
}

test("ocr: every call names its pages, so a whole-document read is batched, never silently capped", async () => {
  const { sent, client } = bodyClient((url, opts) => ({ pages: (opts.pages || []).map((n) => ({ n })), elapsedMs: 10 }));
  await assert.rejects(client.ocr({ bytes: new Uint8Array([1]), sha256: "abc" }), (error) => error.reason === "ocr-pages");
  assert.equal(sent.length, 0);
  const pages = Array.from({ length: 230 }, (_, i) => i + 1);
  const got = await client.ocr({ bytes: new Uint8Array([1]), sha256: "abc", pages });
  assert.equal(got.pages.length, 230);
  assert.equal(got.elapsedMs, 100);
  assert.ok(sent.every((call) => call.opts.pages.length <= 50));
});

test("ocr: cell re-reads over the helper's cell cap go in batches and keep the caller's ids in order", async () => {
  const { sent, client } = bodyClient((url, opts) => ({ cells: opts.cells.map((c) => ({ text: `p${c.page}` })) }));
  const cells = Array.from({ length: 900 }, (_, i) => ({ id: `c${i}`, page: i + 1, bbox: [0, 0, 1, 1] }));
  const got = await client.ocr({ bytes: new Uint8Array([1]), sha256: "abc", cells });
  assert.deepEqual(sent.map((call) => call.opts.cells.length), [400, 400, 100]);
  assert.equal(got.cells.length, 900);
  assert.equal(got.cells[0].id, "c0");
  assert.equal(got.cells[899].id, "c899");
  assert.equal(got.cells[899].text, "p900");
});

test("ocr: a batch that is aborted stops the read", async () => {
  const { sent, client } = bodyClient((url, opts) => ({ pages: opts.pages.map((n) => ({ n })) }));
  const ctl = new AbortController();
  const pages = Array.from({ length: 80 }, (_, i) => i + 1);
  await assert.rejects(client.ocr({ bytes: new Uint8Array([1]), sha256: "abc", pages, signal: ctl.signal, onChunk: () => ctl.abort() }));
  assert.equal(sent.length, 1);
});

test("ocrImagePath posts the local path and returns null when the helper has no image route", async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, method: init.method, type: init.headers["Content-Type"], body: init.body });
    if (String(url).endsWith("/v1/ocr-image")) return { status: 200, json: async () => ({ text: "lab notebook" }) };
    return { status: 404, json: async () => ({ error: "no" }) };
  };
  const settings = { get: (k) => (k === "parse-helper-token" ? "tok" : undefined) };
  const client = createHelperClient({ fetch, settings, setSetting: () => {} });
  assert.equal(await client.ocrImagePath("/Users/me/scan.png"), "lab notebook");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "POST");
  assert.match(sent[0].url, /\/v1\/ocr-image$/);
  assert.equal(sent[0].type, "application/json");
  assert.deepEqual(JSON.parse(sent[0].body), { path: "/Users/me/scan.png" });

  const missing = createHelperClient({
    fetch: async () => ({ status: 404, json: async () => ({ error: "no" }) }),
    settings,
    setSetting: () => {},
  });
  assert.equal(await missing.ocrImagePath("/tmp/a.png"), null);
  const down = createHelperClient({
    fetch: async () => { throw new TypeError("not running"); },
    settings,
    setSetting: () => {},
  });
  assert.equal(await down.ocrImagePath("/tmp/a.png"), null);
  assert.equal(await client.ocrImagePath(""), null);
});

test("vlm: pages and regions over the helper's caps go in batches and the readings join", async () => {
  const { planVlmBatches } = await import("../src/host/parse-helper-client.js");
  const { sent, client } = bodyClient((url, opts) => ({ model: "m", tables: (opts.tables || []).map((t) => ({ page: t.page })), layout: opts.pages.map((n) => ({ page: n })), decode: { greedy: true } }));
  const pages = Array.from({ length: 95 }, (_, i) => i + 1);
  const tables = pages.map((n) => ({ page: n, bbox: [0, 0, 1, 1] }));
  const got = await client.vlm({ bytes: new Uint8Array([1]), sha256: "abc", pages, tables, numericPages: [3, 50, 90] });
  assert.ok(sent.every((call) => call.opts.pages.length <= 40 && (call.opts.tables || []).length <= 40));
  assert.deepEqual(sent.map((call) => call.opts.pages.length), [40, 40, 15]);
  assert.deepEqual(sent.map((call) => call.opts.numericPages || null), [[3], [50], [90]]);
  assert.equal(got.tables.length, 95);
  assert.equal(got.layout.length, 95);
  assert.equal(got.model, "m");
  assert.equal(got.sha256, "abc");
  const small = bodyClient(() => ({ tables: [] }));
  await small.client.vlm({ bytes: new Uint8Array([1]), sha256: "abc", pages: [1, 2], tables: [] });
  assert.equal(small.sent.length, 1);
  const crowded = Array.from({ length: 90 }, () => ({ page: 7, bbox: [0, 0, 1, 1] }));
  assert.deepEqual(planVlmBatches([6, 7], crowded).map((b) => [b.pages.join(), b.regions.length]), [["6", 0], ["7", 40], ["7", 40], ["7", 10]]);
});

test("tables: regions over the helper's region cap go in batches", async () => {
  const { sent, client } = bodyClient((url, opts) => ({ model: "t", tables: opts.tables.map((t) => ({ page: t.page })) }));
  const tables = Array.from({ length: 85 }, (_, i) => ({ page: i + 1, bbox: [0, 0, 1, 1] }));
  const got = await client.tables({ bytes: new Uint8Array([1]), sha256: "abc", pages: tables.map((t) => t.page), tables });
  assert.deepEqual(sent.map((call) => call.opts.tables.length), [40, 40, 5]);
  assert.equal(got.tables.length, 85);
});

const healthOk = { helper: "plexus-parse-helper", schema: "pxd-parse/1", version: "0.1.0", models: { layout: "ready", tableformer: "ready", ocr: "ready" }, busy: 0 };

function migrationClient({ legacy = "", stored = "", throws = false } = {}) {
  const sets = [];
  const auth = [];
  const storage = memStorage(stored, { throws });
  const api = createHelperClient({
    fetch: async (url, init = {}) => { auth.push(init.headers?.Authorization); return { status: 200, json: async () => healthOk }; },
    settings: () => ({ "parse-helper-token": legacy }),
    setSetting: async (id, value) => { sets.push([id, value]); },
    storage,
  });
  return { api, sets, auth, storage };
}

test("legacy setting token moves to device storage, the setting is cleared once", async () => {
  const { api, sets, auth, storage } = migrationClient({ legacy: "old-tok" });
  assert.equal(api.endpoint().token, "old-tok");
  assert.equal(storage.map.get(TOKEN_KEY), "old-tok");
  await api.health();
  assert.equal(auth[0], "Bearer old-tok");
  api.endpoint();
  await Promise.resolve();
  assert.deepEqual(sets, [["parse-helper-token", ""]]);
});

test("a device token wins over a legacy setting, which is still cleared", async () => {
  const { api, sets, auth, storage } = migrationClient({ legacy: "old-tok", stored: "device-tok" });
  await api.health();
  assert.equal(auth[0], "Bearer device-tok");
  assert.equal(storage.map.get(TOKEN_KEY), "device-tok");
  assert.deepEqual(sets, [["parse-helper-token", ""]]);
});

test("blocked storage keeps the legacy token in use and does not clear the setting", async () => {
  const { api, sets, auth } = migrationClient({ legacy: "old-tok", throws: true });
  await api.health();
  api.endpoint();
  assert.equal(auth[0], "Bearer old-tok");
  assert.deepEqual(sets, []);
});

test("pair writes device storage only and never the settings", async () => {
  const sets = [];
  const storage = memStorage("");
  const api = createHelperClient({
    fetch: async () => ({ status: 200, json: async () => ({ helper: "plexus-parse-helper", token: "paired", version: "0.1.0" }) }),
    settings: () => ({}),
    setSetting: async (id, value) => { sets.push([id, value]); },
    storage,
  });
  assert.deepEqual(await api.pair(), { ok: true, version: "0.1.0" });
  assert.equal(storage.map.get(TOKEN_KEY), "paired");
  assert.deepEqual(sets, []);
  const bare = createHelperClient({ fetch: async () => ({ status: 200, json: async () => ({}) }), settings: () => ({}) });
  assert.deepEqual(await bare.pair(), { ok: false, reason: "no-storage" });
});

test("setToken stores a trimmed token and an empty one turns the helper off", async () => {
  const storage = memStorage("");
  const api = createHelperClient({ fetch: async () => ({ status: 200, json: async () => healthOk }), settings: () => ({}), storage });
  assert.equal(api.setToken("  abc  "), true);
  assert.equal(storage.map.get(TOKEN_KEY), "abc");
  assert.equal((await api.health()).state, "ready");
  assert.equal(api.setToken(""), true);
  assert.deepEqual(await api.health(), { state: "not-running", reason: "disabled" });
  const blocked = createHelperClient({ fetch: async () => ({}), settings: () => ({}), storage: memStorage("", { throws: true }) });
  assert.equal(blocked.setToken("abc"), false);
});

test("migrateToken moves the old setting at load without a request", () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const cleared = [];
  let fetched = 0;
  const api = createHelperClient({
    settings: { "parse-helper-token": "old-tok" },
    setSetting: (id, value) => cleared.push([id, value]),
    storage,
    fetch: async () => { fetched += 1; throw new Error("no fetch at load"); },
  });
  api.migrateToken();
  assert.equal(mem.get(TOKEN_BACKUP_KEY), "old-tok");
  assert.deepEqual(cleared, [[TOKEN_SETTING, ""]]);
  assert.equal(fetched, 0);
});

test("setToken('') also clears a leftover old setting so Forget token sticks", () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const sets = [];
  const api = createHelperClient({ settings: {}, setSetting: (id, value) => sets.push([id, value]), storage });
  api.setToken("tok");
  assert.deepEqual(sets, []);
  api.setToken("");
  assert.deepEqual(sets, [[TOKEN_SETTING, ""]]);
  assert.equal(mem.get(TOKEN_BACKUP_KEY), "");
});
