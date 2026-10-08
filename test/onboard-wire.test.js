// P-ONBOARD wiring: the status strip, the Engines panel, and auto-read inside the reading pane.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SCHEMA } from "../src/model/parse-schema.js";
import { stripKind, stripModel } from "../src/view/parse-status.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const OCR = JSON.parse(readFileSync(new URL("./fixtures/pdf/report-scan.ocr.json", import.meta.url), "utf8"));
const READY = { helper: "plexus-parse-helper", version: "0.1.0", schema: SCHEMA, models: { layout: "ready", tableformer: "ready", ocr: "ready" }, busy: 0 };
const res = (status, body) => ({ status, json: async () => body });
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

async function rig(fn, { fetchImpl, values = {}, deviceOcr = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const win = stub.window;
    win.fetch = fetchImpl || (async () => { throw new Error("refused"); });
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const saved = {};
    const pane = createReadPane({
      doc,
      root,
      storage: stub.localStorage,
      settings: { get: (id) => values[id] },
      setSetting: (id, v) => { saved[id] = v; values[id] = v; },
      deviceOcr,
      host: {
        toast() {},
        renderBlock(node) {
          const box = doc.createElement("div");
          box.className = "rm-pdf-container";
          const scroller = doc.createElement("div");
          scroller.className = "PdfHighlighter";
          scroller["__reactFiber$t"] = { memoizedProps: { pdfDocument: { getPage() {} } } };
          box.append(scroller);
          node.append(box);
        },
      },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Scan", pageUid: "page", source: "{{[[pdf]]: https://example.test/scan.pdf}}" });
    await fn({ pane, root, stub, saved, values });
    pane.dispose();
  } finally {
    restore();
  }
}

const actions = (root) => root.querySelectorAll(".pxd-parse-status [data-action]").map((b) => b.getAttribute("data-action"));
const stripText = (root) => root.querySelector(".pxd-parse-status")?.textContent || "";

test("stripModel with no in-browser source never promises a device read", () => {
  const base = { scanned: true, ocr: { state: "idle", modelsCached: false, deviceAvailable: false }, helper: { state: "not-installed", paired: false } };
  const off = stripModel(stripKind(base), base);
  assert.deepEqual(off.buttons.map((b) => b.id), ["setup-helper", "not-now"]);
  assert.equal(off.text.includes("on this device"), false);
  const ready = { ...base, helper: { state: "ready", paired: true } };
  assert.deepEqual(stripModel(stripKind(ready), ready).buttons.map((b) => b.id), ["read-text", "not-now"]);
  const stopped = { ...base, helper: { state: "not-running", paired: true } };
  assert.equal(stripKind(stopped), "helper-off");
  assert.deepEqual(stripModel("helper-off", stopped).buttons.map((b) => b.id), ["start-helper", "not-now"]);
});

test("scanned PDF, helper not running, no device source: a scan message with Set up and Not now; Set up opens the sheet", async () => {
  await rig(async ({ pane, root }) => {
    pane.noteScan({ pages: [1, 2], readScan: async () => { throw new Error("must not read"); }, helperState: "not-running" });
    await settle();
    assert.equal(pane.stripKind(), "scan-first");
    assert.match(stripText(root), /image/);
    assert.equal(stripText(root).includes("Docling"), false);
    assert.deepEqual(actions(root), ["setup-helper", "not-now"]);
    assert.equal(root.querySelector(".pxd-engines__sheet"), null);
    root.querySelector('[data-action="setup-helper"]').click();
    await settle();
    assert.ok(root.querySelector(".pxd-engines"));
    assert.ok(root.querySelector(".pxd-engines__sheet"));
    root.querySelector('[data-action="not-now"]').click();
    assert.equal(pane.stripKind(), null);
  });
});

test("helper ready: Read text runs readScan and the OCR pages reach setOcrPages", async () => {
  let reads = 0;
  await rig(async ({ pane, root }) => {
    pane.noteScan({
      pages: [1],
      helperState: "ready",
      readScan: async () => { reads += 1; pane.setOcrPages(OCR.pages[0]); },
    });
    await settle();
    assert.equal(reads, 0);
    assert.equal(pane.stripKind(), "scan-first");
    assert.deepEqual(actions(root), ["read-text", "not-now"]);
    root.querySelector('[data-action="read-text"]').click();
    await settle();
    assert.equal(reads, 1);
    assert.equal(pane.ocrRun().state, "done");
    assert.equal(pane.ocrRun().source, "helper");
    assert.equal(pane.stripKind(), "helper-done");
    assert.ok(pane.textLayerStats());
  }, {
    values: { "parse-helper-token": "t", "parse-auto-read": false },
    fetchImpl: async () => res(200, READY),
  });
  assert.equal(reads, 1);
});

test("a read that produces nothing is unreadable, with Retry", async () => {
  await rig(async ({ pane, root }) => {
    pane.noteScan({ pages: [1], helperState: "ready", readScan: async () => {} });
    await settle();
    root.querySelector('[data-action="read-text"]').click();
    await settle();
    assert.equal(pane.stripKind(), "unreadable");
    assert.deepEqual(actions(root), ["setup-helper", "retry"]);
  }, { values: { "parse-helper-token": "t", "parse-auto-read": false }, fetchImpl: async () => res(200, READY) });
});

test("parse-auto-read on: scanned pages are read on their own when a source is ready; off waits", async () => {
  for (const [auto, expected] of [[true, 1], [false, 0]]) {
    let reads = 0;
    await rig(async ({ pane }) => {
      pane.noteScan({ pages: [1], helperState: "ready", readScan: async () => { reads += 1; pane.setOcrPages(OCR.pages[0]); } });
      await settle();
      pane.noteScan({ pages: [1], helperState: "ready", readScan: async () => { reads += 1; } });
      await settle();
    }, { values: { "parse-helper-token": "t", "parse-auto-read": auto }, fetchImpl: async () => res(200, READY) });
    assert.equal(reads, expected, `auto=${auto}`);
  }
});

test("auto-read does nothing while no source is ready", async () => {
  let reads = 0;
  await rig(async ({ pane }) => {
    pane.noteScan({ pages: [1], helperState: "not-running", readScan: async () => { reads += 1; } });
    await settle();
    assert.equal(pane.stripKind(), "scan-first");
  }, { values: { "parse-auto-read": true } });
  assert.equal(reads, 0);
});

test("the local helper is preferred when both it and the in-browser source are ready", async () => {
  let helperReads = 0;
  let deviceReads = 0;
  const device = {
    status: () => ({ state: "ready", mb: 39 }),
    download() {},
    cancel() {},
    read: async () => { deviceReads += 1; return [OCR.pages[0]]; },
  };
  await rig(async ({ pane }) => {
    pane.noteScan({ pages: [1], helperState: "ready", readScan: async () => { helperReads += 1; pane.setOcrPages(OCR.pages[0]); } });
    await settle();
    assert.equal(pane.ocrRun().state, "done");
    assert.equal(pane.ocrRun().source, "helper");
  }, { deviceOcr: device, values: { "parse-helper-token": "t" }, fetchImpl: async () => res(200, READY) });
  assert.equal(helperReads, 1);
  assert.equal(deviceReads, 0);
});

test("the in-browser source reads when the helper is not ready", async () => {
  let helperReads = 0;
  const device = {
    status: () => ({ state: "ready", mb: 39 }),
    download() {},
    cancel() {},
    read: async () => [OCR.pages[0]],
  };
  await rig(async ({ pane, root }) => {
    pane.noteScan({ pages: [1], helperState: "not-running", readScan: async () => { helperReads += 1; } });
    await settle();
    assert.equal(pane.ocrRun().state, "done");
    assert.equal(pane.ocrRun().source, "device");
    assert.equal(pane.stripKind(), null);
    assert.equal(root.querySelector(".pxd-parse-status").hasAttribute("hidden"), true);
  }, { deviceOcr: device });
  assert.equal(helperReads, 0);
});

test("Read text with the models not downloaded downloads them, then reads; auto-read never downloads", async () => {
  let state = "not-downloaded";
  let downloads = 0;
  let reads = 0;
  const device = {
    status: () => ({ state, mb: 39, progress: 0.5 }),
    async download() { downloads += 1; state = "ready"; return true; },
    cancel() {},
    read: async () => { reads += 1; return [OCR.pages[0]]; },
  };
  await rig(async ({ pane, root }) => {
    pane.noteScan({ pages: [1], helperState: "not-running", readScan: async () => {} });
    await settle();
    assert.equal(downloads, 0, "auto-read does not download");
    assert.equal(pane.stripKind(), "scan-first");
    root.querySelector('[data-action="read-text"]').click();
    for (let i = 0; i < 5; i++) await settle();
    assert.equal(downloads, 1);
    assert.equal(reads, 1);
    assert.equal(pane.ocrRun().source, "device");
    assert.equal(pane.ocrRun().state, "done");
  }, { deviceOcr: device, values: { "parse-auto-read": true } });
});

test("Cancel stops a running read", async () => {
  let release = null;
  await rig(async ({ pane, root }) => {
    pane.noteScan({ pages: [1], helperState: "ready", readScan: () => new Promise((resolve) => { release = resolve; }) });
    await settle();
    assert.equal(pane.stripKind(), "reading");
    root.querySelector('[data-action="cancel"]').click();
    release();
    await settle();
    assert.equal(pane.ocrRun().state, "idle");
    assert.equal(pane.stripKind(), "scan-first");
  }, { values: { "parse-helper-token": "t", "parse-auto-read": true }, fetchImpl: async () => res(200, READY) });
});

test("the gear opens the Engines panel and closes it again, and dispose leaves no listeners", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const before = stub.listenerCount();
    stub.window.fetch = async () => { throw new Error("refused"); };
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const pane = createReadPane({ doc, root, storage: stub.localStorage, host: { renderBlock(node) { node.append(doc.createElement("div")); } } });
    pane.open({ blockUid: "blk", cardUid: "card", title: "x", source: "{{[[pdf]]: https://example.test/a.pdf}}" });
    assert.equal(root.querySelector(".pxd-engines"), null);
    root.querySelector(".pxd-read__tools").click();
    await settle();
    const panel = root.querySelector(".pxd-engines");
    assert.ok(panel);
    assert.equal(panel.hasAttribute("hidden"), false);
    root.querySelector(".pxd-read__tools").click();
    assert.equal(panel.hasAttribute("hidden"), true);
    root.querySelector(".pxd-read__tools").click();
    await settle();
    pane.noteScan({ pages: [1], helperState: "not-running", readScan: async () => {} });
    await settle();
    pane.dispose();
    assert.equal(stub.listenerCount(), before);
  } finally {
    restore();
  }
});

test("Pair in the sheet saves the token through the setSetting path", async () => {
  await rig(async ({ pane, root, saved }) => {
    pane.noteScan({ pages: [1], helperState: "not-running", readScan: async () => {} });
    await settle();
    root.querySelector('[data-action="setup-helper"]').click();
    await settle();
    root.querySelector('[data-action="pair"]').click();
    await settle();
    assert.equal(saved["parse-helper-token"], "tok123");
  }, {
    fetchImpl: async (url) => (String(url).endsWith("/v1/pair")
      ? res(200, { helper: "plexus-parse-helper", token: "tok123", version: "0.1.0" })
      : res(401, { helper: "plexus-parse-helper" })),
  });
});
