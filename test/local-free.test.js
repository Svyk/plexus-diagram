// Local is free and it just does it: no caps, no prompts, and every engine says what it costs.
import assert from "node:assert/strict";
import test from "node:test";

import { parsePageGeometry } from "../src/model/parse/index.js";
import { createDeviceOcr } from "../src/host/device-ocr.js";
import { createParseStore } from "../src/host/parse-store.js";
import { createParseView, engineChip } from "../src/view/parse-view.js";
import { readScan } from "../src/view/parse-engine.js";
import { engineRows, renderEnginesPanel } from "../src/view/engines-panel.js";
import { tipEntry } from "../src/view/tooltip-text.js";
import { stripModel } from "../src/view/parse-status.js";
import { TAG_LLAMA, TAG_MAC, TAG_MISTRAL, TAG_ROAM } from "../src/view/engine-tags.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(fn, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return fn();
}

function word(str, x, base) {
  return { str, transform: [6, 0, 0, 6, x, base], width: str.length * 3.3, height: 6, y0: base - 4.8, y1: base + 1.3, fontName: "ocr", conf: 1 };
}
function ocrPage(n) {
  return { n, w: 300, h: 120, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0, fonts: { ocr: { name: "ocr" } }, items: [word("Scanned", 20, 30), word("page", 80, 30)], rules: [], ops: { fnArray: [], argsArray: [] } };
}
function scanGeometry(n) {
  const rec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 300, h: 120, rotation: 0, fonts: {} }, n);
  rec.kind = "scan";
  return rec;
}

function localHelper({ docling = true, parse = null, ocrCalls = [] } = {}) {
  return {
    async health() { return { state: "ready", ocr: true, docling, engines: docling ? ["docling", "ocr"] : ["ocr"], version: "0.1.0" }; },
    async ocr(req) {
      ocrCalls.push(req);
      if (req.cells) return { cells: req.cells.map(() => ({ text: "" })) };
      try { req.onChunk?.({ done: req.pages.length, total: req.pages.length }); } catch { /* none */ }
      return { schema: "pxd-ocr/1", pages: req.pages.map(ocrPage) };
    },
    parse: parse || (async () => { throw new Error("no docling job"); }),
  };
}

const PDF = (pages) => async () => ({ numPages: pages, getData: async () => new Uint8Array([1, 2, 3]) });

test("Parse on a scanned 110-page PDF reads every scanned page in the same run, in one go, with no prompt", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const calls = [];
    const toasts = [];
    const view = createParseView({
      doc: stub.document,
      store: createParseStore({}),
      storage: stub.localStorage,
      url: "https://example.test/batch.pdf",
      helper: localHelper({ docling: false, ocrCalls: calls }),
      getPdf: PDF(110),
      loadGeometry: async (n) => scanGeometry(n),
      onToast: (m) => toasts.push(m),
    });
    await view.parse();
    const pageCalls = calls.filter((c) => !c.cells);
    assert.equal(pageCalls.length, 1, "one OCR run, no extra step");
    assert.deepEqual(pageCalls[0].pages, Array.from({ length: 110 }, (_, i) => i + 1), "every page named");
    assert.equal(typeof pageCalls[0].onChunk, "function", "per-batch progress is wired");
    assert.equal(view.getDoc().pages.filter((p) => p.ocr).length, 110);
    assert.deepEqual(toasts, []);
    assert.match(view.chipText(), /^Built-in · free · 110 pages · /);
    view.dispose();
  } finally {
    restore();
  }
});

test("a host that takes scans itself (onScan) keeps its own auto-read, and the view does not read twice", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const calls = [];
    const seen = [];
    const view = createParseView({
      doc: stub.document, store: createParseStore({}), storage: stub.localStorage, url: "https://example.test/a.pdf",
      helper: localHelper({ docling: false, ocrCalls: calls }), getPdf: PDF(2), loadGeometry: async (n) => scanGeometry(n),
      onScan: (info) => seen.push(info),
    });
    await view.parseBuiltin();
    assert.equal(calls.length, 0);
    assert.ok(seen.some((info) => info.pages.length === 2));
    view.dispose();
  } finally {
    restore();
  }
});

test("Read the scan stays as a manual re-run", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const calls = [];
    const view = createParseView({
      doc: stub.document, store: createParseStore({}), storage: stub.localStorage, url: "https://example.test/b.pdf",
      helper: localHelper({ docling: false, ocrCalls: calls }), getPdf: PDF(2), loadGeometry: async (n) => scanGeometry(n),
      scanAuto: false,
    });
    await view.parseBuiltin();
    assert.equal(calls.length, 0);
    await view.refreshHelper();
    const btn = view.element().querySelector(".pxd-parse__scan");
    assert.equal(btn.hidden, false);
    assert.equal(btn.getAttribute("data-engine-tag"), TAG_MAC);
    btn.click();
    assert.ok(await until(() => calls.some((c) => !c.cells)));
    view.dispose();
  } finally {
    restore();
  }
});

test("the Parse button runs Docling through a paired helper by default, without asking", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const jobs = [];
    const docling = {
      schema: "pxd-parse/1", engine: "docling", sha256: "s", pageCount: 3, pages: [{ n: 1, w: 100, h: 100, rotation: 0, kind: "text" }],
      order: ["p1"], blocks: { p1: { id: "p1", type: "para", page: 1, text: "Hi", bbox: [0, 0, 10, 10] } }, removed: [], stats: { ms: 42000 },
    };
    const helper = localHelper({ parse: async (req) => { jobs.push(req); return { doc: docling, cached: false, job: "j1" }; } });
    const view = createParseView({ doc: stub.document, store: createParseStore({}), storage: stub.localStorage, url: "https://example.test/c.pdf", helper, getPdf: PDF(3), loadGeometry: async (n) => scanGeometry(n) });
    await view.refreshHelper();
    const go = view.element().querySelector(".pxd-parse__go");
    assert.match(go.textContent, /^Parse \(Docling\)/);
    assert.equal(go.getAttribute("data-engine-tag"), TAG_MAC);
    go.click();
    assert.ok(await until(() => view.hasParse()));
    assert.equal(jobs.length, 1);
    assert.equal(view.chipText(), "Docling · free · 3 pages · 42 s");
    view.dispose();
  } finally {
    restore();
  }
});

test("Parse falls back to the built-in parser when the Docling job fails, and never touches the cloud", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const helper = localHelper({ parse: async () => { throw Object.assign(new Error("busy"), { status: 409 }); } });
    const view = createParseView({ doc: stub.document, store: createParseStore({}), storage: stub.localStorage, url: "https://example.test/d.pdf", helper, getPdf: PDF(1), loadGeometry: async (n) => scanGeometry(n), onToast: () => {} });
    await view.parse();
    assert.ok(view.hasParse());
    assert.equal(view.getDoc().engine, "builtin");
    view.dispose();
  } finally {
    restore();
  }
});

test("with no helper, or when the user picks Built-in, Parse is the built-in parser", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const jobs = [];
    const helper = localHelper({ parse: async (req) => { jobs.push(req); return { doc: {}, job: "x" }; } });
    const picked = createParseView({ doc: stub.document, store: createParseStore({}), storage: stub.localStorage, url: "https://example.test/e.pdf", helper, getPdf: PDF(1), loadGeometry: async (n) => scanGeometry(n), defaultEngine: () => "builtin" });
    await picked.parse();
    assert.equal(picked.getDoc().engine, "builtin");
    assert.equal(jobs.length, 0);
    const none = createParseView({ doc: stub.document, store: createParseStore({}), storage: stub.localStorage, url: "https://example.test/f.pdf", helper: null, getPdf: PDF(1), loadGeometry: async (n) => scanGeometry(n) });
    await none.parse();
    assert.equal(none.getDoc().engine, "builtin");
    picked.dispose();
    none.dispose();
  } finally {
    restore();
  }
});

test("the engine menu tags every engine as free or paid", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const view = createParseView({ doc: stub.document, helper: null });
    const tag = (cls) => view.element().querySelector(cls).getAttribute("data-engine-tag");
    assert.equal(tag(".pxd-parse__again"), TAG_ROAM);
    assert.equal(tag(".pxd-parse__docling"), TAG_MAC);
    assert.equal(tag(".pxd-parse__cloud"), TAG_LLAMA);
    assert.equal(tag(".pxd-parse__mistral"), TAG_MISTRAL);
    assert.equal(TAG_LLAMA, "Cloud · uses your LlamaParse credits");
    assert.equal(TAG_MISTRAL, "Cloud · uses your Mistral credits");
    view.dispose();
  } finally {
    restore();
  }
});

test("the Engines sheet tags local rows free and the cloud row with the credits it spends", () => {
  const rows = engineRows({ device: { state: "ready" }, helper: { state: "ready" }, cloud: { key: "k" } });
  const by = Object.fromEntries(rows.map((r) => [r.id, r.tags]));
  assert.deepEqual(by.device, [TAG_ROAM]);
  assert.deepEqual(by["device-ocr"], [TAG_ROAM]);
  assert.deepEqual(by.helper, [TAG_MAC]);
  assert.deepEqual(by.cloud, [TAG_LLAMA, TAG_MISTRAL]);
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const panel = renderEnginesPanel(stub.document, parent, { client: { status: async () => ({ state: "ready" }) }, device: { status: async () => ({ state: "ready" }) } });
  return until(() => parent.querySelectorAll?.(".pxd-engines__tag").length >= 4).then((ok) => {
    const texts = [...parent.querySelectorAll(".pxd-engines__tag")].map((n) => n.textContent);
    assert.ok(ok);
    assert.ok(texts.includes(TAG_MAC) && texts.includes(TAG_ROAM) && texts.includes(TAG_LLAMA) && texts.includes(TAG_MISTRAL));
    panel.dispose?.();
  });
});

test("tooltips say what each engine costs", () => {
  assert.match(tipEntry("parse.docling").desc, /^Free\./);
  assert.match(tipEntry("parse.cloud").desc, /Uses your LlamaParse credits/);
  assert.match(tipEntry("parse.mistral").desc, /Uses your Mistral credits/);
  assert.match(tipEntry("engines.helper").desc, /^Free\./);
  assert.match(tipEntry("engines.builtin").desc, /^Free\./);
  assert.match(stripModel("helper-done", { ocr: { ms: 1200 } }).text, /free/);
});

test("readScan names its pages even when the caller does not, and reports per batch", async () => {
  const calls = [];
  const base = { pageCount: 3, pages: [1, 2, 3].map((n) => ({ n, kind: "scan", w: 300, h: 120 })), order: [], blocks: {}, removed: [], stats: {}, options: {} };
  const helper = { async ocr(req) { calls.push(req); req.onChunk?.({ done: 3, total: 3 }); return { pages: req.pages.map(ocrPage) }; } };
  const seen = [];
  await readScan({ helper, bytes: new Uint8Array([1]), sha256: "s", base, records: [1, 2, 3].map(scanGeometry), numPages: 3, lines: false, onProgress: (p) => seen.push(p) });
  assert.deepEqual(calls[0].pages, [1, 2, 3]);
  assert.deepEqual(seen, [{ done: 3, total: 3 }]);
});

test("the in-browser check after the helper's OCR reports its pages, and the chip names each step", async () => {
  const base = { pageCount: 4, pages: [1, 2, 3, 4].map((n) => ({ n, kind: "scan", w: 300, h: 120 })), order: [], blocks: {}, removed: [], stats: {}, options: {} };
  const helper = { async ocr(req) { return { pages: (req.pages || []).map(ocrPage) }; } };
  const alt = { async ocr(req) { for (let i = 1; i <= 4; i += 1) req.onProgress?.(i / 4); return { pages: req.pages.map(ocrPage) }; } };
  const phases = [];
  await readScan({ helper, alt, bytes: new Uint8Array([1]), sha256: "s", base, records: [1, 2, 3, 4].map(scanGeometry), numPages: 4, lines: false, onPhase: (p) => phases.push(p) });
  const checks = phases.filter((p) => p.phase === "check").map((p) => p.done);
  assert.deepEqual(checks, [0, 1, 2, 3, 4]);
  assert.equal(engineChip({ phase: "running", page: 2, pageCount: 4, step: "check" }).text, "Checking page 2 of 4");
  assert.equal(engineChip({ phase: "running", page: 4, pageCount: 4, step: "finish" }).text, "Finishing the read");
  assert.equal(engineChip({ phase: "running", page: 1, pageCount: 4 }).text, "Page 1 of 4");
});

test("in-browser reading with no page list reads the whole document, not page 1", async () => {
  const read = [];
  const device = createDeviceOcr({
    source: { ocr: async ({ pages }) => { read.push(pages[0]); return { pages: [{ n: pages[0] }] }; }, forget() {} },
  });
  const out = await device.read({ pages: [], url: "u", getPdf: async () => ({ numPages: 7, getPage() {} }) });
  assert.deepEqual(read, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(out.pages.length, 7);
});

test("a restored Docling read names Docling on the chip, not the built-in default", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const store = createParseStore({});
    const url = "https://example.test/r.pdf";
    const docling = {
      schema: "pxd-parse/1", engine: "docling", sha256: "r".repeat(64), pageCount: 2, optsHash: "o",
      pages: [{ n: 1, w: 100, h: 100, rotation: 0, kind: "text" }, { n: 2, w: 100, h: 100, rotation: 0, kind: "text" }],
      order: ["p1"], blocks: { p1: { id: "p1", type: "para", page: 1, text: "Hi", bbox: [0, 0, 10, 10] } }, removed: [], stats: { ms: 5000 },
    };
    await store.putParse(docling);
    await store.indexUrl(url, { sha256: docling.sha256, pageCount: 2 });
    const view = createParseView({ doc: stub.document, store, storage: stub.localStorage, url, helper: localHelper({}), getPdf: PDF(2), loadGeometry: async (n) => scanGeometry(n) });
    assert.ok(await view.restore());
    assert.match(view.chipText(), /^Docling · free · 2 pages/);
    view.dispose();
  } finally {
    restore();
  }
});

test("the engine menu closes on Esc and on a press outside it", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const view = createParseView({ doc: stub.document, store: createParseStore({}), storage: stub.localStorage, url: "https://example.test/m.pdf", helper: localHelper({}), getPdf: PDF(1), loadGeometry: async (n) => scanGeometry(n) });
    stub.document.body.appendChild(view.element());
    const pop = () => view.element().querySelector(".pxd-parse__engine").parentElement.querySelector(".pxd-parse__pop");
    const isOpen = () => pop().hidden !== true && !pop().hasAttribute("hidden");
    view.element().querySelector(".pxd-parse__engine").click();
    assert.ok(isOpen());
    stub.document.dispatchEvent({ type: "keydown", key: "Escape", target: stub.document.body, stopPropagation() {} });
    assert.ok(!isOpen());
    view.element().querySelector(".pxd-parse__engine").click();
    assert.ok(isOpen());
    stub.document.dispatchEvent({ type: "pointerdown", target: pop().querySelector("button") });
    assert.ok(isOpen(), "a press inside the menu keeps it open");
    stub.document.dispatchEvent({ type: "pointerdown", target: stub.document.body });
    assert.ok(!isOpen());
    view.dispose();
  } finally {
    restore();
  }
});

test("Read the scan: the in-browser second reading runs only on pages with doubtful words, and others keep the helper's read", async () => {
  const { doubtfulOcrPages, voteOcrBodies } = await import("../src/model/parse/ocr-vote.js");
  const word = (str, conf) => ({ str, conf, x: 0, y: 0, w: 10, h: 10 });
  const W = ["blend", "powder", "lactoferrin", "verify", "weight", "minutes", "transfer", "hopper", "completed", "review"];
  const sure = { n: 1, items: Array.from({ length: 20 }, (_, i) => word(W[i % W.length], 0.99)) };
  const doubt = { n: 2, items: [...Array.from({ length: 30 }, (_, i) => word(W[i % W.length], 0.99)), word("1O25", 0.3), word("CAM", 0.4), word("PBW", 0.2)] };
  const lexicon = new Set(W);
  assert.deepEqual(doubtfulOcrPages([sure, doubt], lexicon), [2]);
  assert.deepEqual(doubtfulOcrPages([sure, { n: 3, items: [word("prossure", 1)] }], lexicon), [3], "a confident word the lexicon does not know");
  assert.deepEqual(doubtfulOcrPages([sure, doubt]), [1, 2], "no lexicon: every page, as before");
  const voted = voteOcrBodies([sure, doubt], [], null);
  assert.equal(voted[0], sure, "a page with no second reading is returned as read");
});
