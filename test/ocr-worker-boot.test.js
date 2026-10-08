import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createOcrWeb, yieldingRunners } from "../src/host/ocr-web.js";
import { OCR_WORKER } from "../src/model/ocr/worker-asset.js";

const BASE = "https://pages.test/plexus/";
const ORT = "https://cdn.test/ort/";

function spec(file, text) {
  const buf = Buffer.from(text);
  return { file, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length, text };
}

const ASSETS = {
  ort: {
    mjs: spec("ort.mjs", "export const ort = 1;"),
    wasmMjs: spec("ort-wasm.mjs", "export const glue = 1;"),
    wasm: spec("ort.wasm", "\0asm-fake"),
  },
  models: {
    det: spec("det.onnx", "det-weights"),
    rec: spec("rec.onnx", "rec-weights"),
    dict: spec("dict.txt", "H\ni\n"),
  },
  worker: spec("ocr-worker.js", "self.onmessage = () => {};"),
};

function urlMap(worker = ASSETS.worker) {
  const map = new Map();
  for (const s of Object.values(ASSETS.ort)) map.set(`${ORT}${s.file}`, s.text);
  for (const s of Object.values(ASSETS.models)) map.set(`${BASE}assets/ocr/${s.file}`, s.text);
  map.set(`${BASE}assets/ocr/${ASSETS.worker.file}`, worker.text);
  return map;
}

function fakeFetch(map, log) {
  return async (url) => {
    log?.push(String(url));
    if (!map.has(String(url))) return new Response("missing", { status: 404 });
    return new Response(Buffer.from(map.get(String(url))));
  };
}

function blobs() {
  const made = [];
  return {
    made,
    createObjectURL(blob) { made.push(blob); return `blob:test/${made.length}`; },
  };
}

const RECORD = { n: 1, scan: true, items: [{ str: "Hi" }] };

// A Worker stand-in that answers like src/host/ocr-web-worker.js.
function workerClass({ onInit = null, hold = false } = {}) {
  const made = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.posted = [];
      made.push(this);
    }
    postMessage(msg) {
      this.posted.push(msg);
      if (msg.type === "abort" || msg.type === "forget") return;
      queueMicrotask(() => {
        if (msg.type === "init") {
          if (onInit) { onInit(this, msg); return; }
          this.onmessage({ data: { type: "ready", id: msg.id } });
        } else if (msg.type === "page" && !hold) {
          this.onmessage({ data: { type: "page", id: msg.id, record: { ...RECORD, n: msg.n } } });
        } else if (msg.type === "cells") {
          this.onmessage({ data: { type: "cells", id: msg.id, cells: [{ text: "7" }] } });
        }
      });
    }
    terminate() { this.terminated = true; }
  }
  return { FakeWorker, made };
}

const renderPage = async () => ({ rgb: new Uint8Array(3 * 4 * 4).fill(255), width: 4, height: 4, dpi: 72, pointW: 4, pointH: 4 });

function fakeOrt(log) {
  return {
    env: { wasm: {} },
    Tensor: class { constructor(type, data, dims) { this.data = data; this.dims = dims; } },
    InferenceSession: {
      async create(buffer) {
        const det = new TextDecoder().decode(new Uint8Array(buffer)).startsWith("det");
        return {
          async run({ x }) {
            log.push(det ? "det" : "rec");
            if (det) return { fetch_name_0: { data: new Float32Array(x.dims[2] * x.dims[3]) } };
            return { fetch_name_0: { data: new Float32Array(3), dims: [1, 1, 3] } };
          },
        };
      },
    },
  };
}

test("the worker starts from a blob URL of the SHA-checked bundle, never the Pages URL", async () => {
  const { FakeWorker, made } = workerClass();
  const b = blobs();
  const fetched = [];
  const source = createOcrWeb({
    assetBase: BASE, ortBase: ORT, files: ASSETS, caches: null, fetch: fakeFetch(urlMap(), fetched),
    Worker: FakeWorker, createObjectURL: b.createObjectURL, renderPage,
  });
  const out = await source.ocr({ pages: [1], bytes: new Uint8Array([1]) });
  assert.equal(out.pages[0].items[0].str, "Hi");
  assert.equal(made.length, 1);
  assert.match(made[0].url, /^blob:test\//);
  assert.deepEqual(made[0].options, { type: "module" });
  const script = b.made[Number(made[0].url.split("/").pop()) - 1];
  assert.equal(await script.text(), ASSETS.worker.text);
  assert.ok(fetched.includes(`${BASE}assets/ocr/ocr-worker.js`));
  const init = made[0].posted.find((m) => m.type === "init");
  for (const key of ["ortUrl", "wasmMjsUrl", "wasmUrl"]) assert.match(init[key], /^blob:test\//, key);
  assert.equal(init.dictText, "H\ni\n");
});

test("a worker bundle with the wrong hash is never started; OCR runs on the page and yields before each model run", async () => {
  const { FakeWorker, made } = workerClass();
  const b = blobs();
  const runs = [];
  let pauses = 0;
  const source = createOcrWeb({
    assetBase: BASE, ortBase: ORT, files: ASSETS, caches: null,
    fetch: fakeFetch(urlMap({ text: "self.onmessage = evil;" })),
    Worker: FakeWorker, createObjectURL: b.createObjectURL, renderPage,
    importModule: async () => fakeOrt(runs),
    pause: async () => { pauses += 1; runs.push("yield"); },
  });
  const out = await source.ocr({ pages: [1], bytes: new Uint8Array([1]) });
  assert.equal(made.length, 0);
  assert.equal(out.pages.length, 1);
  assert.ok(runs.includes("det"));
  assert.equal(pauses, runs.filter((r) => r !== "yield").length);
  runs.forEach((r, i) => { if (r !== "yield") assert.equal(runs[i - 1], "yield", `run ${i} follows a yield`); });
});

test("a blob worker that fails to start falls back to the page thread", async () => {
  for (const failure of ["throw", "onerror"]) {
    const { FakeWorker, made } = workerClass({
      onInit: (w) => w.onerror({ message: "blocked by worker-src" }),
    });
    const Throwing = class { constructor() { throw Object.assign(new Error("denied"), { name: "SecurityError" }); } };
    const runs = [];
    const source = createOcrWeb({
      assetBase: BASE, ortBase: ORT, files: ASSETS, caches: null, fetch: fakeFetch(urlMap()),
      Worker: failure === "throw" ? Throwing : FakeWorker, createObjectURL: blobs().createObjectURL, renderPage,
      importModule: async () => fakeOrt(runs), pause: async () => {},
    });
    const out = await source.ocr({ pages: [1], bytes: new Uint8Array([1]) });
    assert.equal(out.pages.length, 1, failure);
    assert.ok(runs.includes("det"), failure);
    if (failure === "onerror") assert.equal(made[0].terminated, true);
  }
});

test("an abort during a worker read rejects at once, tells the worker, and the next read works", async () => {
  let hold = true;
  const { FakeWorker, made } = workerClass();
  const Holding = class extends FakeWorker {
    postMessage(msg) {
      if (msg.type === "page" && hold) { this.posted.push(msg); return; }
      super.postMessage(msg);
    }
  };
  const source = createOcrWeb({
    assetBase: BASE, ortBase: ORT, files: ASSETS, caches: null, fetch: fakeFetch(urlMap()),
    Worker: Holding, createObjectURL: blobs().createObjectURL, renderPage,
  });
  const ctl = new AbortController();
  const reading = source.ocr({ pages: [1], bytes: new Uint8Array([1]), signal: ctl.signal });
  for (let i = 0; i < 50 && !made[0]?.posted.some((m) => m.type === "page"); i++) await new Promise((r) => setTimeout(r, 1));
  ctl.abort();
  await assert.rejects(reading, (error) => error.name === "AbortError");
  assert.ok(made[0].posted.some((m) => m.type === "abort"));
  hold = false;
  const again = await source.ocr({ pages: [2], bytes: new Uint8Array([1]) });
  assert.equal(again.pages[0].n, 2);
  assert.equal(made.length, 1);
});

test("prefetch caches the worker bundle with the models; cached() still asks only for models", async () => {
  const store = new Map();
  const caches = {
    async open() {
      return {
        async match(url) { return store.has(url) ? new Response(store.get(url)) : null; },
        async put(url, res) { store.set(String(url), await res.arrayBuffer()); },
      };
    },
  };
  const source = createOcrWeb({ assetBase: BASE, ortBase: ORT, files: ASSETS, caches, fetch: fakeFetch(urlMap()) });
  assert.equal(await source.cached(), false);
  await source.prefetch();
  assert.ok(store.has(`${BASE}assets/ocr/ocr-worker.js`));
  store.delete(`${BASE}assets/ocr/ocr-worker.js`);
  assert.equal(await source.cached(), true);
});

test("yieldingRunners yields before every det and rec call", async () => {
  const order = [];
  const runners = yieldingRunners({
    runDet: async () => { order.push("det"); return 1; },
    runRec: async () => { order.push("rec"); return 2; },
  }, async () => { order.push("yield"); });
  assert.equal(await runners.runDet(), 1);
  assert.equal(await runners.runRec(), 2);
  assert.deepEqual(order, ["yield", "det", "yield", "rec"]);
});

test("the shipped worker manifest matches the deployed worker bundle", () => {
  const buf = readFileSync(new URL("../deploy/assets/ocr/ocr-worker.js", import.meta.url));
  assert.equal(buf.length, OCR_WORKER.bytes);
  assert.equal(createHash("sha256").update(buf).digest("hex"), OCR_WORKER.sha256);
  assert.equal(OCR_WORKER.file, "ocr-worker.js");
});

test("the worker reads again after an abort (a fresh signal per job)", async () => {
  const posted = [];
  const prev = globalThis.self;
  globalThis.self = { postMessage: (msg) => posted.push(msg) };
  try {
    await import(`../src/host/ocr-web-worker.js?abort=${Date.now()}`);
    const worker = globalThis.self;
    const ortSrc = `export const env = { wasm: {} };
      export class Tensor { constructor(t, data, dims) { this.data = data; this.dims = dims; } }
      export const InferenceSession = { async create() { return { async run({ x }) {
        if (x.dims[1] === 3 && x.dims[0] === 1 && x.dims[2] !== 48) return { fetch_name_0: { data: new Float32Array(x.dims[2] * x.dims[3]) } };
        return { fetch_name_0: { data: new Float32Array(x.dims[0] * 3), dims: [x.dims[0], 1, 3] } };
      } }; } };`;
    const wait = async (id) => {
      for (let i = 0; i < 200; i++) {
        const hit = posted.find((m) => m.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 2));
      }
      return null;
    };
    worker.onmessage({ data: { type: "init", id: 1, ortUrl: `data:text/javascript,${encodeURIComponent(ortSrc)}`, det: new ArrayBuffer(1), rec: new ArrayBuffer(1), dictText: "H\n" } });
    assert.equal((await wait(1))?.type, "ready");
    worker.onmessage({ data: { type: "abort" } });
    const rgb = new Uint8Array(3 * 8 * 8).fill(255);
    worker.onmessage({ data: { type: "page", id: 2, n: 1, width: 8, height: 8, dpi: 72, pointW: 8, pointH: 8, rgb: rgb.buffer } });
    const reply = await wait(2);
    assert.equal(reply?.type, "page", JSON.stringify(reply));
  } finally {
    globalThis.self = prev;
  }
});
