import assert from "node:assert/strict";
import { test } from "node:test";

import { createDeviceOcr, DEVICE_OCR_BYTES } from "../src/host/device-ocr.js";
import { createOcrWeb } from "../src/host/ocr-web.js";
import { renderEnginesPanel, engineRows } from "../src/view/engines-panel.js";

function fakeEnv({ fetches = [], stored = new Set() } = {}) {
  return {
    WebAssembly: {},
    crypto: { subtle: {} },
    fetch: async (url) => { fetches.push(url); throw new Error("must not fetch"); },
    caches: { open: async () => ({ match: async (url) => (stored.has(url) ? { arrayBuffer: async () => new ArrayBuffer(0) } : undefined), put: async () => {} }) },
  };
}

test("readBandTitle reads the open page only when models are cached, and never fetches", async () => {
  const fetches = [];
  const pdf = { getPage: async () => ({}) };
  const cold = createDeviceOcr({
    env: fakeEnv({ fetches }),
    source: { cached: async () => false, ocr: async () => { throw new Error("should not ocr"); } },
  });
  assert.equal(await cold.readBandTitle({ getPdf: async () => pdf, url: "https://x.test/shannon_1948.pdf" }), "");
  const calls = [];
  const ready = createDeviceOcr({
    env: fakeEnv({ fetches }),
    source: {
      cached: async () => true,
      ocr: async (opts) => {
        calls.push(opts);
        return {
          pages: [{
            transform: [1, 0, 0, 1, 0, 0],
            fonts: {},
            items: [{ str: "A Mathematical Theory", transform: [18, 0, 0, 18, 40, 40], width: 220, height: 18, fontName: "ocr" }],
          }],
        };
      },
    },
  });
  assert.equal(await ready.readBandTitle({ getPdf: async () => pdf }), "A Mathematical Theory");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].band, 0.18);
  assert.deepEqual(calls[0].pages, [1]);
  assert.equal(await ready.readBandTitle({ getPdf: async () => null }), "");
  assert.equal(calls.length, 1);
  assert.deepEqual(fetches, []);
});

test("constructing the device source and asking its status fetch nothing", async () => {
  const fetches = [];
  const env = fakeEnv({ fetches });
  const device = createDeviceOcr({ env, createSource: (opts) => createOcrWeb({ ...opts, fetch: env.fetch, caches: env.caches, crypto: env.crypto }) });
  const st = await device.status();
  assert.equal(st.state, "not-downloaded");
  assert.equal(st.mb, Math.round(DEVICE_OCR_BYTES / (1024 * 1024)));
  assert.ok(st.mb >= 30 && st.mb <= 50, `mb ${st.mb}`);
  assert.deepEqual(fetches, []);
});

test("status is ready when every asset is in Cache Storage, unavailable without WebAssembly", async () => {
  const stored = new Set();
  const env = fakeEnv({ stored });
  const web = createOcrWeb({ fetch: env.fetch, caches: env.caches, crypto: env.crypto });
  // Every asset's first URL, as cached() asks for them.
  const all = [];
  await createOcrWeb({ caches: { open: async () => ({ match: async (url) => { all.push(url); return { ok: true }; } }) } }).cached();
  assert.equal(all.length, 6, "runtime (3) and models (3)");
  for (const url of all) stored.add(url);
  const device = createDeviceOcr({ env, source: web });
  assert.equal((await device.status()).state, "ready");
  const none = createDeviceOcr({ env: { ...env, WebAssembly: undefined } });
  assert.equal((await none.status()).state, "unavailable");
});

test("download reports progress, can be cancelled, and ends ready", async () => {
  let release = null;
  let seen = null;
  const source = {
    cached: async () => false,
    prefetch: ({ signal, onProgress }) => new Promise((resolve, reject) => {
      onProgress(10, 40);
      seen = signal;
      release = () => { onProgress(40, 40); resolve({ bytes: 40 }); };
      signal.addEventListener("abort", () => reject(Object.assign(new Error("ocr aborted"), { name: "AbortError" })));
    }),
  };
  const device = createDeviceOcr({ env: fakeEnv(), source });
  const first = device.download();
  const mid = await device.status();
  assert.equal(mid.state, "downloading");
  assert.equal(mid.progress, 0.25);
  device.cancel();
  assert.equal(await first, false);
  assert.equal(seen.aborted, true);
  assert.equal((await device.status()).state, "not-downloaded");
  const second = device.download();
  release();
  assert.equal(await second, true);
  assert.equal((await device.status()).state, "ready");
});

test("read renders from the reader's pdf.js document, reports progress, and forgets pages on a new PDF", async () => {
  const calls = [];
  let forgets = 0;
  const source = {
    cached: async () => true,
    forget: () => { forgets += 1; },
    ocr: async ({ pages }) => { calls.push(pages[0]); return { schema: "pxd-ocr/1", pages: [{ n: pages[0], scan: true, items: [], rules: [] }] }; },
  };
  const device = createDeviceOcr({ env: fakeEnv(), source });
  const pdf = { numPages: 3, fingerprints: ["a"], getPage: async () => ({}) };
  const progress = [];
  const out = await device.read({ pages: [1, 3], url: "https://x/a.pdf", getPdf: async () => pdf, onProgress: (f) => progress.push(f) });
  assert.equal(out.schema, "pxd-ocr/1");
  assert.deepEqual(out.pages.map((p) => p.n), [1, 3]);
  assert.deepEqual(progress, [0.5, 1]);
  assert.equal(forgets, 1);
  await device.read({ pages: [2], url: "https://x/a.pdf", getPdf: async () => pdf });
  assert.equal(forgets, 1, "same PDF keeps its pages");
  await device.read({ pages: [1], url: "https://x/b.pdf", getPdf: async () => ({ ...pdf, fingerprints: ["b"] }) });
  assert.equal(forgets, 2);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(() => device.read({ pages: [1], getPdf: async () => pdf, signal: ctl.signal }), (e) => e.name === "AbortError");
});

test("the Engines panel labels the in-browser row beta and offers Download", () => {
  const rows = engineRows({ device: { state: "not-downloaded", mb: 39 }, helper: { state: "ready" } });
  const row = rows.find((r) => r.id === "device-ocr");
  assert.equal(row.name, "In-browser reading (beta)");
  assert.equal(row.text, "Not downloaded (39 MB, once)");
  assert.equal(row.button.id, "download-device");
  assert.equal(typeof renderEnginesPanel, "function");
});

test("a scanned page in the reading pane with the real device source fetches no model (lazy assets rule)", async () => {
  const { createReadPane } = await import("../src/view/read-pane.js");
  const { createDomStub } = await import("./fixtures/dom-stub.js");
  const stub = createDomStub();
  const restore = stub.install();
  const fetches = [];
  const env = fakeEnv({ fetches });
  const device = createDeviceOcr({ env, createSource: (opts) => createOcrWeb({ ...opts, fetch: env.fetch, caches: env.caches, crypto: env.crypto }) });
  try {
    const doc = stub.document;
    stub.window.fetch = async () => { throw new Error("refused"); };
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const pane = createReadPane({
      doc, root, storage: stub.localStorage, settings: { get: (id) => (id === "parse-auto-read" ? true : undefined) }, deviceOcr: device,
      host: { toast() {}, renderBlock(node) { node.append(doc.createElement("div")); } },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Scan", pageUid: "page", source: "{{[[pdf]]: https://example.test/scan.pdf}}" });
    pane.noteScan({ pages: [1], helperState: "not-running", readScan: async () => {} });
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pane.stripKind(), "scan-first");
    assert.match(root.querySelector(".pxd-parse-status").textContent, /one-time \d+ MB download/);
    assert.deepEqual(fetches, []);
    pane.dispose();
  } finally {
    restore();
  }
});
