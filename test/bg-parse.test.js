// Read mode parses quietly: scan detection, the status strip, auto-read and the cached text layer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import { resetSessions } from "../src/session.js";
import { createReadPane } from "../src/view/read-pane.js";
import { ocrWords } from "../src/view/text-layer.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => { resetSessions(); });

const OCR = JSON.parse(readFileSync(new URL("./fixtures/pdf/report-scan.ocr.json", import.meta.url), "utf8"));
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    if (fn()) return true;
    await wait(10);
  }
  return fn();
}

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

// A pdf.js document whose pages carry no text and one page-sized image: every page reads as a scan.
function scanPdf(pages = 2) {
  return {
    numPages: pages,
    async getMetadata() { return { info: {} }; },
    async getData() { return new Uint8Array([1, 2, 3, 4]); },
    async getPage() {
      return {
        getViewport: () => ({ width: 612, height: 792, rotation: 0, transform: [1, 0, 0, -1, 0, 792] }),
        async getTextContent() { return { items: [], styles: {} }; },
        async getOperatorList() { return { fnArray: [12, 85], argsArray: [[612, 0, 0, 792, 0, 0], ["img"]] }; },
        commonObjs: { has: () => false },
      };
    },
  };
}

async function rig({ deviceOcr = null, autoRead = true, fetches } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.window.fetch = (...args) => { fetches?.push(args); return Promise.reject(new Error("offline")); };
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const pdf = scanPdf();
  const pane = createReadPane({
    doc,
    root,
    storage: stub.localStorage,
    settings: { get: (id) => (id === "parse-auto-read" ? autoRead : undefined), set() {} },
    deviceOcr,
    host: {
      toast() {},
      unmount() {},
      renderBlock(node) {
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        const scroller = doc.createElement("div");
        scroller.className = "PdfHighlighter";
        scroller["__reactFiber$t"] = { memoizedProps: { pdfDocument: pdf } };
        box.append(scroller);
        node.append(box);
      },
    },
  });
  pane.open({ blockUid: "blk", cardUid: "card", title: "Scan", source: "{{[[pdf]]: https://example.test/scan.pdf}}" });
  const live = root.querySelector(".pxd-read__live");
  const mountPage = () => {
    const page = doc.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "1");
    page._rect = rect(0, 0, 600, 780);
    const layer = doc.createElement("div");
    layer.className = "textLayer";
    page.append(layer);
    live.append(page);
    stub.flushMutations();
    stub.flushFrames();
    return layer;
  };
  return { stub, root, pane, mountPage, done: () => { pane.dispose(); restore(); } };
}

test("Read mode parses in the background, finds the scan and shows the strip with no network", async () => {
  const fetches = [];
  const r = await rig({ fetches });
  try {
    const strip = () => r.root.querySelector(".pxd-parse-status");
    assert.ok(await until(() => strip()), "strip appears without opening the outline");
    assert.ok(strip().textContent.length > 0);
    assert.equal(r.root.querySelector(".pxd-read__progress")?.hidden ?? true, true);
    // The parse itself fetches nothing; the one call is the loopback helper status probe after scan detection.
    assert.ok(fetches.length >= 1, "scan detection probes the helper");
    for (const [url] of fetches) assert.match(String(url), /^http:\/\/127\.0\.0\.1:48765\//);
    assert.equal(r.pane.textLayerStats().mounts, 0);
  } finally { r.done(); }
});

test("a ready source reads the scan automatically and mounts the text layer", async () => {
  let reads = 0;
  const deviceOcr = {
    async status() { return { state: "ready" }; },
    async read() { reads += 1; return OCR; },
  };
  const r = await rig({ deviceOcr });
  try {
    const layer = r.mountPage();
    assert.ok(await until(() => reads === 1), "one automatic read");
    assert.ok(await until(() => { r.stub.flushFrames(); return layer.querySelectorAll(".pxd-tl-word").length > 0; }));
    assert.equal(layer.querySelectorAll(".pxd-tl-word").length, ocrWords(OCR.pages[0]).length);
    await wait(30);
    assert.equal(reads, 1, "the same scan is not read twice");
  } finally { r.done(); }
});

test("auto-read off keeps the strip and reads nothing", async () => {
  let reads = 0;
  const deviceOcr = { async status() { return { state: "ready" }; }, async read() { reads += 1; return OCR; } };
  const r = await rig({ deviceOcr, autoRead: false });
  try {
    assert.ok(await until(() => r.root.querySelector(".pxd-parse-status")));
    await wait(60);
    assert.equal(reads, 0);
  } finally { r.done(); }
});

test("cached OCR words mount on the next open with no read", async () => {
  let reads = 0;
  const deviceOcr = { async status() { return { state: "ready" }; }, async read() { reads += 1; return OCR; } };
  const r = await rig({ deviceOcr });
  try {
    assert.ok(await until(() => reads === 1));
    await wait(40);
    r.pane.close({ notify: false });
    reads = 0;
    r.pane.open({ blockUid: "blk", cardUid: "card", title: "Scan", source: "{{[[pdf]]: https://example.test/scan.pdf}}" });
    const layer = r.mountPage();
    assert.ok(await until(() => { r.stub.flushFrames(); return layer.querySelectorAll(".pxd-tl-word").length > 0; }));
    assert.equal(layer.querySelectorAll(".pxd-tl-word").length, ocrWords(OCR.pages[0]).length);
    assert.equal(reads, 0, "mounted from the device cache");
  } finally { r.done(); }
});
