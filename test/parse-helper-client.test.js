import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_CACHE_MS,
  HEALTH_TIMEOUT_MS,
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
    settings: () => ({
      "parse-helper-url": "http://127.0.0.1:48765/",
      "parse-helper-token": token,
    }),
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
});
