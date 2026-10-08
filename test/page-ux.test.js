// 3.6 page-first UX: U2 text layer, U3 selection bar, U5 ghost drag, U6 Read / Read + Outline.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import { createHost } from "../src/host/roam.js";
import { CARD_MIME, PARSE_MIME, handleParseDrop, parseDropPayload, textCardMarkdown } from "../src/model/drop.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createParseActions } from "../src/view/parse-actions.js";
import { createParseView, outlineBlocks, outlineLabel, scanSpan, sectionIds } from "../src/view/parse-view.js";
import {
  OCR_LAYER_ID,
  READ_MODE_KEY,
  createReadPane,
  mergeOcrPages,
  normalizeReadMode,
  storedReadMode,
} from "../src/view/read-pane.js";
import {
  GHOST_W,
  MORPH_MS,
  boardZoom,
  createDragGhost,
  dispatchDrop,
  ghostContent,
  ghostOrigin,
  zoneAt,
  zoneScale,
} from "../src/view/drag-ghost.js";
import { rectsOverlap, selectionBarPlacement, selectionInReader, unionRect } from "../src/view/make-highlight.js";
import { placePopover } from "../src/relchips.js";
import {
  MARK_ATTR,
  WORD_ATTR,
  compactPage,
  createTextLayer,
  mountWords,
  needsTextLayer,
  ocrWords,
  orderWords,
  pageRecords,
  wordStyle,
} from "../src/view/text-layer.js";
import { tipEntry } from "../src/view/tooltip-text.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => { resetSessions(); });

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const OCR = JSON.parse(read("./fixtures/pdf/report-scan.ocr.json"));
const now = () => performance.now();

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

function withStub(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    return fn(stub, stub.document, stub.window);
  } finally {
    restore();
  }
}

async function withStubAsync(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    return await fn(stub, stub.document, stub.window);
  } finally {
    restore();
  }
}

function syntheticRecord(n, count) {
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / 12);
    const col = i % 12;
    const x = 40 + col * 44;
    const base = 40 + row * 14;
    items.push({ str: `w${i}`, transform: [10, 0, 0, 10, x, base], width: 30, height: 10, y0: base - 8, y1: base + 2, fontName: "ocr", conf: 1 });
  }
  return { n, w: 612, h: 792, rotation: 0, scan: true, items, rules: [] };
}

// ---------------------------------------------------------------- U2 text layer (pure)

test("ocrWords reads the helper's Vision word boxes, geometry words and stored boxes", () => {
  const page = OCR.pages[0];
  assert.equal(OCR.schema, "pxd-ocr/1");
  const words = ocrWords(page);
  assert.equal(words.length, page.items.filter((it) => String(it.str).trim()).length);
  const first = words.find((w) => w.text === "BlendHouse");
  assert.deepEqual(first, { text: "BlendHouse", x: 46.25, y: 18.57, w: 33.92, h: 29.47 - 18.57 });
  const geo = ocrWords({ n: 1, w: 100, words: [{ text: "Hi", x0: 10, x1: 20, base: 50, size: 10 }, { text: "x", x0: 0, x1: 1, base: 1, size: 1, rotated: true }] });
  assert.deepEqual(geo, [{ text: "Hi", x: 10, y: 42, w: 10, h: 10 }]);
  const stored = compactPage(page);
  assert.equal(stored.boxes.length, words.length);
  assert.deepEqual(ocrWords(stored)[0], { ...words[0], h: Math.round(words[0].h * 100) / 100 });
  assert.deepEqual(ocrWords({ n: 1, textRotation: 90, items: page.items }), []);
  assert.deepEqual(ocrWords(null), []);
});

test("orderWords reads rows left to right and marks line ends", () => {
  const words = [
    { text: "b", x: 50, y: 10, w: 10, h: 10 },
    { text: "c", x: 10, y: 30, w: 10, h: 10 },
    { text: "a", x: 10, y: 11, w: 10, h: 10 },
  ];
  const out = orderWords(words);
  assert.deepEqual(out.words.map((w) => w.text), ["a", "b", "c"]);
  assert.deepEqual(out.breaks, [false, true, true]);
});

test("wordStyle sizes like pdf.js: font from box height, scaleX to the box width", () => {
  const style = wordStyle({ text: "abc", x: 10, y: 20, w: 30, h: 10 }, 2, 150);
  // font 20px; natural width 150 * 20 / 100 = 30px; target 60px → scaleX 2.
  assert.equal(style, "left:20.00px;top:40.00px;font-size:20.00px;transform:scaleX(2.0000)");
});

test("needsTextLayer: an empty or near-empty text layer needs ours, a born-digital one does not", () => {
  withStub((stub, doc) => {
    const layer = doc.createElement("div");
    assert.equal(needsTextLayer(layer), true);
    const span = doc.createElement("span");
    span.textContent = "abc";
    layer.append(span);
    assert.equal(needsTextLayer(layer), true);
    const more = doc.createElement("span");
    more.textContent = "a whole born-digital line";
    layer.append(more);
    assert.equal(needsTextLayer(layer), false);
    assert.equal(needsTextLayer(null), false);
  });
});

test("mountWords puts one transparent span per word inside the text layer, with line breaks", () => {
  withStub((stub, doc) => {
    const layer = doc.createElement("div");
    layer.className = "textLayer";
    const page = OCR.pages[2];
    const res = mountWords(layer, page, { doc, widthPx: 618.72 * 1.5 });
    const words = ocrWords(page);
    assert.equal(res.count, words.length);
    const spans = layer.querySelectorAll(".pxd-tl-word");
    assert.equal(spans.length, words.length);
    assert.ok(spans.every((s) => s.hasAttribute(WORD_ATTR) && s.getAttribute("role") === "presentation"));
    const brs = layer.querySelectorAll("br");
    assert.ok(brs.length > 5 && brs.length < words.length, "rows end with a <br>");
    assert.equal(layer.getAttribute(MARK_ATTR), `3:${Math.round(618.72 * 1.5)}`);
    const first = spans.find((s) => s.textContent.trim() === "BlendHouse");
    assert.match(first.style.cssText, /^left:69\.38px;top:29\.45px;font-size:14\.33px;transform:scaleX\(/);
    // Re-mounting replaces, never duplicates.
    mountWords(layer, page, { doc, widthPx: 618.72 });
    assert.equal(layer.querySelectorAll(".pxd-tl-word").length, words.length);
  });
});

// The 4 ms budget is measured in Chrome by tools/bench/page-ux.mjs (2.2 ms median for 600 words). Wall-clock on the
// fake DOM is load-dependent, so this guards the shape of the work instead: O(words) nodes, one append into the
// layer, no per-word measurement of the DOM. The time ceiling is a sanity bound only.
test("U2 budget: 600 words mount with O(words) DOM work and no DOM measuring", () => {
  withStub((stub, doc) => {
    const record = syntheticRecord(1, 600);
    const layer = doc.createElement("div");
    let appends = 0;
    const append = layer.append.bind(layer);
    layer.append = (...nodes) => { appends += 1; return append(...nodes); };
    let measured = 0;
    let created = 0;
    const createElement = doc.createElement.bind(doc);
    doc.createElement = (tag) => { created += 1; return createElement(tag); };
    const t0 = now();
    const out = mountWords(layer, record, { doc, widthPx: 900, measure: (t) => { measured += 1; return t.length * 52; } });
    const ms = now() - t0;
    assert.equal(out.count, 600);
    assert.ok(appends <= 1300, `appends ${appends}`);
    assert.equal(measured, 600, "one string measure per word");
    assert.ok(created >= 600 && created <= 1300, `nodes created ${created}`);
    assert.ok(ms <= 200, `sanity bound: ${ms.toFixed(2)} ms`);
  });
});

// ---------------------------------------------------------------- U2 text layer (observer)

function readerWithPages(doc, pages) {
  const live = doc.createElement("div");
  doc.body.append(live);
  const out = [];
  for (const { n, text = "", width = 900 } of pages) {
    const page = doc.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", String(n));
    page._rect = rect(0, 0, width, width * 1.3);
    const layer = doc.createElement("div");
    layer.className = "textLayer";
    if (text) {
      const span = doc.createElement("span");
      span.textContent = text;
      layer.append(span);
    }
    page.append(layer);
    live.append(page);
    out.push(page);
  }
  return { live, pages: out };
}

test("text layer mounts on scanned pages only and re-mounts after pdf.js rebuilds or zooms", () => {
  withStub((stub, doc) => {
    const { live, pages } = readerWithPages(doc, [{ n: 1 }, { n: 2, text: "Born digital text that is long enough" }, { n: 3 }]);
    const tl = createTextLayer({ doc, readerEl: live });
    assert.equal(stub.observers.size, 0, "no observer before any OCR page");
    assert.equal(tl.setPages(OCR), 3);
    stub.flushFrames();
    const count = (p) => p.querySelectorAll(".pxd-tl-word").length;
    assert.equal(count(pages[0]), ocrWords(OCR.pages[0]).length);
    assert.equal(count(pages[1]), 0, "born-digital page untouched");
    assert.equal(count(pages[2]), ocrWords(OCR.pages[2]).length);
    assert.equal(tl.stats().mounts, 2);
    // Our own inserts do not trigger another pass.
    stub.flushMutations();
    assert.equal(stub.frames.length, 0);
    // pdf.js wipes page 1's layer.
    for (const node of [...pages[0].querySelector(".textLayer").children]) node.remove();
    stub.flushMutations();
    stub.flushFrames();
    assert.equal(count(pages[0]), ocrWords(OCR.pages[0]).length);
    assert.equal(tl.stats().mounts, 3);
    // Zoom: the page is wider, the layer is rebuilt at the new scale.
    pages[2]._rect = rect(0, 0, 1200, 1560);
    tl.refresh();
    assert.equal(pages[2].querySelector(".textLayer").getAttribute(MARK_ATTR), "3:1200");
    assert.equal(tl.stats().mounts, 4);
    // A whole page re-render (new .page node).
    const fresh = doc.createElement("div");
    fresh.className = "page";
    fresh.setAttribute("data-page-number", "1");
    fresh._rect = rect(0, 0, 900, 1170);
    const layer = doc.createElement("div");
    layer.className = "textLayer";
    fresh.append(layer);
    pages[0].remove();
    live.append(fresh);
    stub.flushMutations();
    stub.flushFrames();
    assert.equal(count(fresh), ocrWords(OCR.pages[0]).length);
    assert.ok(tl.stats().maxMs >= 0);
    tl.dispose();
    assert.equal(count(fresh), 0);
    assert.equal(count(pages[2]), 0);
    assert.equal(stub.observers.size, 0);
  });
});

test("pageRecords and mergeOcrPages accept responses, lists and stored pages", () => {
  assert.equal(pageRecords(OCR).length, 3);
  assert.equal(pageRecords(OCR.pages[0]).length, 1);
  assert.deepEqual(pageRecords(null), []);
  const stored = [compactPage(OCR.pages[0])];
  const merged = mergeOcrPages(stored, [OCR.pages[2], OCR.pages[0]]);
  assert.deepEqual(merged.map((p) => p.n), [1, 3]);
  assert.ok(merged.every((p) => Array.isArray(p.boxes)));
});

// ---------------------------------------------------------------- U3 selection helpers

test("selection bar placement: below the selection, below Roam's tip, hidden when only the tip spot is left", () => {
  const viewport = rect(0, 0, 800, 600);
  const size = { w: 200, h: 30 };
  const sel = rect(100, 100, 300, 40);
  const plain = selectionBarPlacement({ selection: sel, size, viewport, place: placePopover });
  assert.equal(plain.hidden, false);
  assert.equal(plain.side, "below");
  assert.equal(plain.top, 146);
  const tip = rect(100, 146, 250, 40);
  const under = selectionBarPlacement({ selection: sel, tip, size, viewport, place: placePopover });
  assert.equal(under.hidden, false);
  assert.ok(under.top >= tip.bottom, "below Roam's tip");
  assert.equal(rectsOverlap({ left: under.left, top: under.top, right: under.left + 200, bottom: under.top + 30 }, tip), false);
  // No room below or above: wherever the placer ends up, the bar never sits over Roam's tip.
  const tipLow = rect(0, 560, 800, 40);
  const cramped = selectionBarPlacement({ selection: rect(0, 0, 800, 560), tip: tipLow, size, viewport, place: placePopover });
  assert.ok(cramped.hidden || !rectsOverlap({ left: cramped.left, top: cramped.top, right: cramped.left + 200, bottom: cramped.top + 30 }, tipLow));
  const forced = selectionBarPlacement({ selection: sel, tip, size, viewport, place: () => ({ left: 100, top: 150, width: 200 }) });
  assert.equal(forced.hidden, true, "a spot over the tip hides the bar while the tip is open");
  assert.deepEqual(unionRect(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), { left: 0, top: 0, right: 15, bottom: 15, width: 15, height: 15 });
  assert.equal(selectionBarPlacement({}).hidden, true);
});

function fakeSelection(anchor, focus, text, box, log) {
  return {
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: anchor,
    focusNode: focus,
    toString: () => text,
    getRangeAt: () => ({ getBoundingClientRect: () => box, getClientRects: () => [box] }),
    removeAllRanges() { log.cleared += 1; },
  };
}

test("selectionInReader: text, page and rect of a selection inside a reader page only", () => {
  withStub((stub, doc) => {
    const { live, pages } = readerWithPages(doc, [{ n: 4 }]);
    const span = doc.createElement("span");
    pages[0].querySelector(".textLayer").append(span);
    const log = { cleared: 0 };
    const info = selectionInReader(fakeSelection(span, span, "  two\nwords ", rect(10, 20, 100, 14), log), live);
    assert.equal(info.text, "two words");
    assert.equal(info.page, 4);
    assert.equal(info.rect.width, 100);
    const outside = doc.createElement("div");
    doc.body.append(outside);
    assert.equal(selectionInReader(fakeSelection(outside, outside, "x", rect(0, 0, 1, 1), log), live), null);
    assert.equal(selectionInReader({ ...fakeSelection(span, span, "x", rect(0, 0, 1, 1), log), isCollapsed: true }, live), null);
    assert.equal(selectionInReader(fakeSelection(span, span, "   ", rect(0, 0, 1, 1), log), live), null);
  });
});

// ---------------------------------------------------------------- U3 / U5 in the pane

function installDragTypes(win) {
  class DataTransfer {
    constructor() { this.store = new Map(); }
    setData(type, value) { this.store.set(String(type), String(value)); }
    getData(type) { return this.store.get(String(type)) ?? ""; }
    get types() { return [...this.store.keys()]; }
  }
  class DragEvent {
    constructor(type, init = {}) {
      Object.assign(this, { type, bubbles: Boolean(init.bubbles), cancelable: Boolean(init.cancelable), clientX: init.clientX, clientY: init.clientY, dataTransfer: init.dataTransfer });
    }
  }
  win.DataTransfer = DataTransfer;
  win.DragEvent = DragEvent;
}

function paneRig(stub, doc, win, extra = {}) {
  installDragTypes(win);
  const root = doc.createElement("div");
  root.className = "pxd-root";
  root.style.setProperty("--pxd-screen-px", "0.5");
  doc.body.append(root);
  const board = doc.createElement("div");
  board.className = "pxd-viewport";
  root.append(board);
  const events = [];
  for (const type of ["dragover", "drop"]) board.addEventListener(type, (event) => events.push(event));
  let elementCalls = 0;
  doc.elementFromPoint = () => { elementCalls += 1; return board; };
  const toasts = [];
  const cards = [];
  const clip = [];
  win.navigator = { clipboard: { writeText: async (text) => { clip.push(text); } } };
  const pane = createReadPane({
    doc,
    root,
    storage: stub.localStorage,
    host: {
      toast: (m) => toasts.push(m),
      renderBlock(node) {
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        const scroller = doc.createElement("div");
        scroller.className = "PdfHighlighter";
        box.append(scroller);
        node.append(box);
      },
    },
    session: { insertTextCard: async (p) => { cards.push(p); return { ok: true, uid: "new" }; } },
    ...extra,
  });
  pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
  const page = doc.createElement("div");
  page.className = "page";
  page.setAttribute("data-page-number", "2");
  const layer = doc.createElement("div");
  layer.className = "textLayer";
  const span = doc.createElement("span");
  span.textContent = "selected words";
  layer.append(span);
  page.append(layer);
  root.querySelector(".PdfHighlighter").append(page);
  const log = { cleared: 0 };
  const selBox = rect(10, 10, 100, 20);
  let selection = fakeSelection(span, span, "selected words", selBox, log);
  doc.getSelection = () => selection;
  return {
    root, board, events, pane, span, page, log, toasts, cards, clip, selBox,
    elementCalls: () => elementCalls,
    noSelection() { selection = { isCollapsed: true, rangeCount: 0, toString: () => "", removeAllRanges() {} }; },
    bar: () => root.querySelector(".pxd-selbar"),
  };
}

test("mouseup on a selection shows Copy · Card · Quote · drag handle below it; Esc closes the bar, not the pane", async () => {
  await withStubAsync(async (stub, doc, win) => {
    const before = stub.listenerCount() + 2; // the rig's own board listeners
    const rig = paneRig(stub, doc, win);
    assert.equal(rig.bar().hasAttribute("hidden"), true);
    const up = stub.dispatch(rig.span, "mouseup");
    assert.equal(up.defaultPrevented, false);
    assert.equal(up.propagationStopped, false, "mouseup is never stopped");
    stub.flushTimers();
    assert.equal(rig.bar().hasAttribute("hidden"), false);
    assert.equal(rig.pane.selectionBarOpen(), true);
    assert.deepEqual(rig.bar().querySelectorAll("button").map((b) => b.textContent), ["Copy", "Card", "Quote", "⠿"]);
    assert.equal(rig.bar().style.top, "36px", "6px below the selection");
    for (const b of rig.bar().querySelectorAll("button")) assert.ok(tipEntry(b.getAttribute("data-tip")), b.getAttribute("data-tip"));
    // Pressing a bar button keeps the selection.
    assert.equal(stub.dispatch(rig.bar().querySelector('[data-act="copy"]'), "mousedown").defaultPrevented, true);
    rig.bar().querySelector('[data-act="copy"]').click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(rig.clip, ["selected words"]);
    assert.deepEqual(rig.toasts, ["Copied"]);
    stub.dispatch(rig.bar(), "keydown", { key: "Escape" });
    assert.equal(rig.bar().hasAttribute("hidden"), true);
    assert.equal(rig.pane.isOpen(), true, "Esc closed the bar only");
    rig.pane.dispose();
    assert.equal(stub.listenerCount(), before);
  });
});

test("Card and Quote insert one card beside the PDF with the text and its page", async () => {
  await withStubAsync(async (stub, doc, win) => {
    const rig = paneRig(stub, doc, win);
    for (const act of ["card", "quote"]) {
      stub.dispatch(rig.span, "mouseup");
      stub.flushTimers();
      rig.bar().querySelector(`[data-act="${act}"]`).click();
      assert.equal(rig.bar().hasAttribute("hidden"), true);
    }
    assert.deepEqual(rig.cards, [
      { text: "selected words", page: 2, pdfUid: "card", quote: false },
      { text: "selected words", page: 2, pdfUid: "card", quote: true },
    ]);
    rig.pane.dispose();
  });
});

test("Roam's tip open below the selection pushes the bar under it", () => {
  withStub((stub, doc, win) => {
    const rig = paneRig(stub, doc, win);
    const tip = doc.createElement("div");
    tip.className = "PdfHighlighter__tip-container";
    tip._rect = rect(10, 36, 160, 44);
    rig.root.querySelector(".PdfHighlighter").append(tip);
    stub.dispatch(rig.span, "mouseup");
    stub.flushTimers();
    assert.equal(rig.bar().hasAttribute("hidden"), false);
    assert.equal(rig.bar().style.top, "86px");
    rig.pane.dispose();
  });
});

test("dragging the selection: card ghost, transform-only moves, no elementFromPoint until the drop, drop at the ghost's top-left", () => {
  withStub((stub, doc, win) => {
    const rig = paneRig(stub, doc, win);
    const down = stub.dispatch(rig.span, "pointerdown", { button: 0, clientX: 20, clientY: 16 });
    assert.equal(down.defaultPrevented, false);
    assert.equal(stub.dispatch(rig.span, "mousedown", { button: 0, clientX: 20, clientY: 16 }).defaultPrevented, true, "the selection is not collapsed");
    stub.dispatch(win, "pointermove", { clientX: 24, clientY: 16, buttons: 1 });
    assert.equal(rig.root.querySelector(".pxd-ghost"), null, "under 6px");
    stub.dispatch(win, "pointermove", { clientX: 40, clientY: 30, buttons: 1 });
    const ghost = rig.root.querySelector(".pxd-ghost");
    assert.ok(ghost);
    assert.equal(ghost.querySelector(".pxd-ghost__text").textContent, "selected words");
    assert.equal(ghost.querySelector(".pxd-ghost__page").textContent, "p. 2");
    for (let i = 0; i < 30; i += 1) {
      stub.dispatch(win, "pointermove", { clientX: 40 + i * 4, clientY: 30 + i * 2, buttons: 1 });
      stub.flushFrames();
    }
    assert.equal(rig.elementCalls(), 0, "no elementFromPoint while moving");
    assert.equal(rig.log.cleared, 0, "selection kept while dragging");
    stub.dispatch(win, "pointerup", { clientX: 180, clientY: 90 });
    assert.equal(rig.elementCalls(), 1);
    assert.deepEqual(rig.events.map((e) => e.type), ["dragover", "drop"]);
    const drop = rig.events[1];
    const payload = JSON.parse(drop.dataTransfer.getData(PARSE_MIME));
    assert.deepEqual(payload, { kind: "text", text: "selected words", page: 2, pdfUid: "card", quote: false });
    // Zoom 2 (screen px 0.5); grab at 10% / 30% of the selection: top-left = pointer − grab × card × zoom.
    assert.equal(drop.clientX, 180 - 0.1 * GHOST_W * 2);
    assert.equal(drop.clientY, 90 - 0.3 * 120 * 2);
    assert.equal(rig.log.cleared, 1, "selection cleared once the drop landed");
    assert.ok(ghost.classList.contains("pxd-ghost--land"));
    stub.flushTimers();
    assert.equal(rig.root.querySelector(".pxd-ghost"), null);
    rig.pane.dispose();
  });
});

test("a cancelled selection drag keeps the selection; Alt on drop asks for a quote", () => {
  withStub((stub, doc, win) => {
    const rig = paneRig(stub, doc, win);
    stub.dispatch(rig.span, "pointerdown", { button: 0, clientX: 20, clientY: 16 });
    stub.dispatch(win, "pointermove", { clientX: 60, clientY: 40, buttons: 1 });
    stub.dispatch(win, "keydown", { key: "Escape" });
    assert.equal(rig.events.length, 0);
    assert.equal(rig.log.cleared, 0);
    assert.ok(rig.root.querySelector(".pxd-ghost").classList.contains("pxd-ghost--cancel"));
    stub.flushTimers();
    // Alt-drop.
    stub.dispatch(rig.span, "pointerdown", { button: 0, clientX: 20, clientY: 16 });
    stub.dispatch(win, "pointermove", { clientX: 60, clientY: 40, buttons: 1 });
    stub.dispatch(win, "pointerup", { clientX: 200, clientY: 200, altKey: true });
    assert.equal(JSON.parse(rig.events[1].dataTransfer.getData(PARSE_MIME)).quote, true);
    rig.pane.dispose();
  });
});

test("the bar's drag handle drags the selection too", () => {
  withStub((stub, doc, win) => {
    const rig = paneRig(stub, doc, win);
    stub.dispatch(rig.span, "mouseup");
    stub.flushTimers();
    const handle = rig.bar().querySelector(".pxd-selbar__handle");
    assert.equal(stub.dispatch(handle, "pointerdown", { button: 0, clientX: 300, clientY: 50 }).defaultPrevented, true);
    stub.dispatch(win, "pointermove", { clientX: 320, clientY: 70, buttons: 1 });
    assert.equal(rig.bar().hasAttribute("hidden"), true, "the bar hides while dragging");
    stub.dispatch(win, "pointerup", { clientX: 400, clientY: 300 });
    assert.equal(JSON.parse(rig.events[1].dataTransfer.getData(PARSE_MIME)).text, "selected words");
    rig.pane.dispose();
  });
});

test("a drawer row drags the card ghost and drops ((uid)) at the ghost's centre; Shift keeps the browser drag", () => {
  withStub((stub, doc, win) => {
    let rowEl = null;
    const rig = paneRig(stub, doc, win, {
      createDrawer: ({ mount }) => {
        rowEl = doc.createElement("div");
        rowEl.className = "pxd-read-drawer__row";
        rowEl.setAttribute("data-uid", "hlrow0001");
        rowEl.setAttribute("draggable", "true");
        rowEl._rect = rect(0, 400, 200, 40);
        mount.append(rowEl);
        return { refresh() {}, setCount() {}, isOpen: () => true, toggle() {}, close() {}, dispose() {} };
      },
    });
    const shifted = stub.dispatch(rowEl, "pointerdown", { button: 0, shiftKey: true, clientX: 20, clientY: 410 });
    assert.equal(shifted.defaultPrevented, false);
    assert.equal(rowEl.getAttribute("draggable"), "true");
    stub.dispatch(rowEl, "pointerdown", { button: 0, clientX: 20, clientY: 410 });
    assert.equal(rowEl.getAttribute("draggable"), "false", "no browser drag while the ghost runs");
    stub.dispatch(win, "pointermove", { clientX: 60, clientY: 380, buttons: 1 });
    const ghost = rig.root.querySelector(".pxd-ghost");
    assert.equal(ghost.getAttribute("data-kind"), "highlight");
    stub.dispatch(win, "pointerup", { clientX: 300, clientY: 200 });
    assert.equal(rig.events[1].dataTransfer.getData(CARD_MIME), "((hlrow0001))");
    const at = { x: 300 - 0.1 * GHOST_W * 2, y: 200 - 0.25 * 120 * 2 };
    assert.equal(rig.events[1].clientX, at.x + GHOST_W);
    assert.equal(rig.events[1].clientY, at.y + 120);
    assert.equal(rowEl.getAttribute("draggable"), "true", "restored");
    rig.pane.dispose();
  });
});

// ---------------------------------------------------------------- U5 ghost (unit)

test("zones come from cached rects; scale is the board zoom over the board, 0.9 elsewhere", () => {
  const rects = { rootRect: rect(0, 0, 1000, 800), paneRect: rect(600, 0, 400, 800), blocked: [rect(0, 760, 600, 40)] };
  assert.equal(zoneAt(100, 100, rects), "board");
  assert.equal(zoneAt(700, 100, rects), "pane");
  assert.equal(zoneAt(100, 780, rects), "blocked");
  assert.equal(zoneAt(1100, 100, rects), "out");
  assert.equal(zoneScale("board", 0.5), 0.5);
  assert.equal(zoneScale("pane", 0.5), 0.9);
  assert.deepEqual(ghostOrigin({ x: 100, y: 100 }, { fx: 0.5, fy: 0 }, { w: 280, h: 100 }, 1, 1), { x: -40, y: 100 });
  const content = ghostContent({ kind: "table", rows: [["a", "b"], ["1", "2"], ["3", "4"], ["5", "6"]] });
  assert.equal(content.rows.length, 3);
  assert.equal(ghostContent({ kind: "nope", text: " a\n b " }).text, "a b");
  withStub((stub, doc) => {
    const root = doc.createElement("div");
    assert.equal(boardZoom(root), 1);
    root.style.setProperty("--pxd-screen-px", "0.25");
    assert.equal(boardZoom(root), 4);
  });
});

test("the ghost morphs from the source shape to the card in 150 ms and moves by transform only", () => {
  withStub((stub, doc) => {
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    let t = 1000;
    const g = createDragGhost({ doc, root, from: rect(100, 100, 140, 60), pointer: { x: 170, y: 130 }, content: { kind: "text", text: "Hello" }, zoom: 1.5, blocked: [], now: () => t });
    const node = g.element();
    assert.equal(node.classList.contains("pxd-item"), true);
    assert.equal(node.classList.contains("pxd-ghost--board"), true);
    // First frame: the source rect (scale 0.5 × 0.5 of a 280 × 120 card).
    assert.match(node.style.transform, /translate3d\(100\.0px, 100\.0px, 0\) scale\(0\.5000, 0\.5000\)/);
    const writes = [];
    const style = node.style;
    const real = { ...style };
    void real;
    let last = style.transform;
    for (let i = 1; i <= 12; i += 1) {
      t += 16;
      g.move(170 + i * 10, 130);
      stub.flushFrames();
      if (style.transform !== last) writes.push(style.transform);
      last = style.transform;
    }
    t += MORPH_MS;
    g.move(400, 300);
    stub.flushFrames();
    assert.deepEqual(g.scale(), { sx: 1.5, sy: 1.5 });
    const drop = g.dropPoint();
    assert.deepEqual([drop.x, drop.y], [400 - 0.5 * 280 * 1.5, 300 - 0.5 * 120 * 1.5]);
    assert.equal(drop.cx, drop.x + drop.w / 2);
    assert.ok(writes.length >= 12);
    const stats = g.stats();
    assert.ok(stats.maxMs <= 2, `max ${stats.maxMs.toFixed(3)} ms per frame`);
    g.land();
    stub.flushTimers();
    assert.equal(node.isConnected, false);
  });
});

test("U5 budget: ≤ 2 ms per move frame over a 3 s drag (180 frames, fake DOM)", () => {
  withStub((stub, doc) => {
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const g = createDragGhost({ doc, root, from: rect(0, 0, 200, 40), pointer: { x: 10, y: 10 }, content: { kind: "text", text: "x".repeat(400) }, blocked: [] });
    for (let i = 0; i < 180; i += 1) {
      g.move(10 + i * 3, 10 + (i % 40) * 4);
      stub.flushFrames();
    }
    const stats = g.stats();
    assert.ok(stats.frames >= 180);
    // The per-frame mean is the budget; one slow frame on a loaded machine is a scheduler hiccup, so max only gets a sanity bound.
    assert.ok(stats.avgMs <= 2 && stats.maxMs <= 50, `avg ${stats.avgMs.toFixed(4)} max ${stats.maxMs.toFixed(4)} ms`);
    g.cancel();
  });
});

test("dispatchDrop reads the target once under the pointer and refuses the reader and outside the root", () => {
  withStub((stub, doc, win) => {
    installDragTypes(win);
    const root = doc.createElement("div");
    const inside = doc.createElement("div");
    const reader = doc.createElement("div");
    reader.className = "pxd-read";
    root.append(inside, reader);
    doc.body.append(root);
    const seen = [];
    inside.addEventListener("drop", (e) => seen.push(e));
    let calls = 0;
    let target = inside;
    doc.elementFromPoint = () => { calls += 1; return target; };
    assert.equal(dispatchDrop({ doc, root, pointer: { x: 5, y: 6 }, at: { x: 1, y: 2 }, entries: [["a/b", "v"]] }), true);
    assert.equal(seen[0].clientX, 1);
    assert.equal(seen[0].dataTransfer.getData("a/b"), "v");
    target = reader;
    assert.equal(dispatchDrop({ doc, root, pointer: { x: 5, y: 6 } }), false);
    target = doc.body;
    assert.equal(dispatchDrop({ doc, root, pointer: { x: 5, y: 6 } }), false);
    assert.equal(calls, 3);
  });
});

// ---------------------------------------------------------------- text payload → card

test("textCardMarkdown: one line, page suffix, links kept as text, quote as a blockquote", () => {
  assert.equal(textCardMarkdown({ text: "Hello\nworld", page: 3 }), "- Hello world (p. 3)");
  assert.equal(textCardMarkdown({ text: "# not a heading [[Page]]", page: 1 }), "- \\# not a heading `[[Page]]` (p. 1)");
  assert.equal(textCardMarkdown({ text: "Quoted", page: 2, quote: true }), "- > Quoted (p. 2)");
  assert.equal(textCardMarkdown({ text: "No page" }), "- No page");
  assert.equal(textCardMarkdown({ text: "   " }), "");
  assert.equal(textCardMarkdown({ text: "x".repeat(5000) }).length, 2 + 4000);
});

function setupSession() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [{ uid: "pdf1", string: "{{[[pdf]]: http://x/y.pdf}}", props: { plexus: { x: 0, y: 0, w: 300, h: 400 } } }] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  return { fake, session };
}

test("a text drop is one card at the drop point in two writes; a quote is a blockquote card", async () => {
  const { fake, session } = setupSession();
  const json = JSON.stringify({ kind: "text", text: "Dry powder", page: 4, pdfUid: "pdf1", quote: false });
  const list = parseDropPayload({ getData: (t) => (t === PARSE_MIME ? json : ""), types: [PARSE_MIME] });
  assert.equal(list[0].parse.kind, "text");
  fake.clearLog();
  const res = await handleParseDrop({ payload: list[0].parse, store: null, session, point: { x: 500, y: 80 } });
  assert.equal(res.ok, true);
  assert.equal(res.writes, 2);
  assert.equal(fake.block(res.uid).string, "Dry powder (p. 4)");
  assert.equal(fake.props(res.uid).plexus.x, 500);
  assert.equal(fake.props(res.uid).plexus.y, 80);
  const quote = await handleParseDrop({ payload: { kind: "text", text: "Q", page: 1, quote: true }, session, point: { x: 0, y: 0 } });
  assert.equal(fake.block(quote.uid).string, "> Q (p. 1)");
  const empty = await handleParseDrop({ payload: { kind: "text", text: "" }, session, point: { x: 0, y: 0 } });
  assert.equal(empty.ok, false);
});

test("insertTextCard places the card beside the PDF in two writes and selects it", async () => {
  const { fake, session } = setupSession();
  const picked = [];
  const toasts = [];
  const actions = createParseActions({
    session,
    store: null,
    placeBeside: (uid) => (uid === "pdf1" ? { x: 340, y: 0 } : null),
    toast: (m) => toasts.push(m),
    select: (uids) => picked.push(...uids),
  });
  fake.clearLog();
  const res = await actions.insertTextCard({ text: "Selected", page: 7, pdfUid: "pdf1" });
  assert.equal(res.writes, 2);
  assert.equal(fake.block(res.uid).string, "Selected (p. 7)");
  assert.equal(fake.props(res.uid).plexus.x, 340);
  assert.deepEqual(picked, [res.uid]);
  assert.deepEqual(toasts, ["Card inserted"]);
  const q = await actions.insertTextCard({ text: "Selected", page: 7, pdfUid: "pdf1", quote: true });
  assert.equal(fake.block(q.uid).string, "> Selected (p. 7)");
  assert.equal(toasts[1], "Quote card inserted");
  assert.equal((await actions.insertTextCard({ text: "" })).ok, false);
});

// ---------------------------------------------------------------- U6 modes and outline

test("modes: Read and Read + Outline; old values migrate", () => {
  assert.equal(normalizeReadMode("reader"), "reader");
  assert.equal(normalizeReadMode("parsed"), "both");
  assert.equal(normalizeReadMode("both"), "both");
  assert.equal(normalizeReadMode("read+outline"), "both");
  assert.equal(normalizeReadMode(undefined), "reader");
  const bag = new Map();
  const storage = { getItem: (k) => bag.get(k) ?? null, setItem: (k, v) => bag.set(k, v) };
  assert.equal(storedReadMode(storage), "reader");
  bag.set(READ_MODE_KEY, "parsed");
  assert.equal(storedReadMode(storage), "both");
  assert.equal(bag.get(READ_MODE_KEY), "read+outline");
  bag.set(READ_MODE_KEY, "reader");
  assert.equal(storedReadMode(storage), "reader");
  assert.equal(bag.get(READ_MODE_KEY), "read");
  assert.equal(tipEntry("parse.mode.both").name, "Read + Outline");
  assert.equal(tipEntry("parse.mode.reader").name, "Read");
});

function outlineDoc() {
  return {
    schema: "pxd-parse/1",
    engine: "builtin",
    sha256: "abc",
    optsHash: "hash",
    pageCount: 2,
    pages: [{ n: 1, w: 100, h: 200, kind: "text" }, { n: 2, w: 100, h: 200, kind: "text" }],
    order: ["h1", "p1", "h2", "p2", "t1", "f1", "h3", "p3"],
    blocks: {
      h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Title", bbox: [0, 0, 10, 10] },
      p1: { id: "p1", type: "para", page: 1, text: "Intro alpha", bbox: [0, 12, 40, 24] },
      h2: { id: "h2", type: "heading", level: 2, page: 1, text: "1. Methods", bbox: [0, 30, 40, 40] },
      p2: { id: "p2", type: "para", page: 1, text: "We sampled", bbox: [0, 42, 40, 50] },
      t1: { id: "t1", type: "table", page: 2, rows: 2, cols: 2, headerRows: 0, bbox: [0, 0, 50, 40], cells: [{ r: 0, c: 0, text: "a" }, { r: 0, c: 1, text: "b" }, { r: 1, c: 0, text: "1" }, { r: 1, c: 1, text: "2" }] },
      f1: { id: "f1", type: "figure", page: 2, text: "Bar chart", bbox: [0, 50, 50, 90] },
      h3: { id: "h3", type: "heading", level: 1, page: 2, text: "Appendix", bbox: [0, 100, 50, 110] },
      p3: { id: "p3", type: "para", page: 2, text: "End", bbox: [0, 112, 50, 120] },
    },
    removed: [],
    stats: {},
  };
}

test("outline rows are headings, tables and figures with pages; a heading inserts its section", () => {
  const doc = outlineDoc();
  assert.deepEqual(outlineBlocks(Object.values(doc.blocks)).map((b) => b.id), ["h1", "h2", "t1", "f1", "h3"]);
  assert.deepEqual(sectionIds(doc, "h2"), ["h2", "p2", "t1", "f1"]);
  assert.deepEqual(sectionIds(doc, "h1"), ["h1", "p1", "h2", "p2", "t1", "f1"]);
  assert.deepEqual(sectionIds(doc, "t1"), ["t1"]);
  assert.equal(outlineLabel(doc.blocks.t1), "Table 2×2");
  assert.equal(outlineLabel(doc.blocks.f1), "Figure · Bar chart");
  withStub((stub, d) => {
    const calls = [];
    const view = createParseView({ doc: d, outline: true, session: { insertParsedBelow: (p) => calls.push(p) } });
    d.body.append(view.element());
    view.showDoc(doc);
    const rows = view.element().querySelectorAll(".pxd-parse__orow");
    assert.deepEqual(rows.map((r) => r.getAttribute("data-id")), ["h1", "h2", "t1", "f1", "h3"]);
    assert.equal(rows[1].querySelector(".pxd-parse__olabel").textContent, "1. Methods");
    assert.equal(rows[2].querySelector(".pxd-parse__opage").textContent, "p. 2");
    rows[1].querySelector(".pxd-parse__check").click();
    view.element().querySelector('[data-id="h3"] .pxd-parse__check').click();
    const insert = view.element().querySelectorAll(".pxd-parse__act").find((b) => b.textContent === "Insert below PDF");
    insert.click();
    assert.deepEqual(calls[0].ids, ["h2", "p2", "t1", "f1", "h3", "p3"]);
    assert.equal(calls[0].kind, "blocks");
    // Search reaches paragraphs too.
    const search = view.element().querySelector(".pxd-parse__search");
    search.value = "sampled";
    stub.dispatch(search, "input");
    assert.deepEqual(view.element().querySelectorAll(".pxd-parse__block").map((r) => r.getAttribute("data-id")), ["p2"]);
    view.dispose();
  });
});

test("a scanned page is never a bare message: Read text calls onNeedOcr", () => {
  withStub((stub, d) => {
    const asked = [];
    const view = createParseView({ doc: d, outline: true, onNeedOcr: (info) => asked.push(info.pages) });
    d.body.append(view.element());
    view.showDoc({ schema: "pxd-parse/1", pageCount: 2, pages: [{ n: 1, kind: "scan" }, { n: 2, kind: "scan" }], order: [], blocks: {}, removed: [], stats: {} });
    const note = view.element().querySelector(".pxd-parse__empty");
    assert.equal(note.querySelector(".pxd-parse__scantext").textContent, scanSpan({ pages: [{ n: 1, kind: "scan" }, { n: 2, kind: "scan" }], order: [], blocks: {} }));
    assert.equal(note.textContent.includes("Docling"), false);
    const button = note.querySelector(".pxd-parse__readtext");
    assert.equal(button.textContent, "Read text");
    button.click();
    assert.deepEqual(asked, [[1, 2]]);
    view.dispose();
  });
});

test("Read text through the helper hands the OCR pages to the text layer", async () => {
  await withStubAsync(async (stub, d) => {
    const handed = [];
    const ocrPage = { ...OCR.pages[1], n: 2 };
    const helper = {
      async health() { return { state: "ready" }; },
      async ocr({ pages }) { return pages ? { schema: "pxd-ocr/1", pageCount: 2, pages: [ocrPage] } : { cells: [] }; },
    };
    const view = createParseView({
      doc: d,
      outline: true,
      helper,
      getPdf: async () => ({ numPages: 2, async getData() { return new Uint8Array(4); } }),
      loadGeometry: async (n) => ({ n, w: 612, h: 792, rotation: 0, items: [{ str: "Plain", transform: [10, 0, 0, 10, 20, 700], width: 30, height: 10, fontName: "f" }], ops: { fnArray: [], argsArray: [] }, fonts: {} }),
      onOcrPages: (pages, sha) => handed.push({ pages, sha }),
    });
    await view.refreshHelper();
    view.showDoc({ schema: "pxd-parse/1", engine: "builtin", sha256: "s1", pageCount: 2, pages: [{ n: 1, kind: "text" }, { n: 2, kind: "scan" }], order: [], blocks: {}, removed: [], stats: { range: [1, 2] } });
    await view.readScan();
    assert.equal(handed.length, 1);
    assert.equal(handed[0].sha, "s1");
    assert.deepEqual(handed[0].pages.map((p) => p.n), [2]);
    assert.ok(ocrWords(handed[0].pages[0]).length > 100, "geometry words reach the text layer");
    view.dispose();
  });
});

test("the pane stores text-layer pages per PDF on this device and mounts them on the next open", async () => {
  await withStubAsync(async (stub, doc) => {
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const images = new Map();
    const pane = createReadPane({
      doc,
      root,
      storage: stub.localStorage,
      host: { renderBlock() {}, unmount() {} },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", source: "{{[[pdf]]: https://example.test/s.pdf}}" });
    // The store is IndexedDB in Roam; here the pane falls back to memory.
    assert.equal(pane.setOcrPages(OCR, { sha256: "sha-1" }), 3);
    await new Promise((r) => setTimeout(r, 20));
    void images;
    const live = root.querySelector(".pxd-read__live");
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
    assert.equal(layer.querySelectorAll(".pxd-tl-word").length, ocrWords(OCR.pages[0]).length);
    assert.equal(pane.textLayerStats().mounts, 1);
    assert.equal(OCR_LAYER_ID, "ocr-layer");
    pane.close({ notify: false });
    assert.equal(layer.querySelectorAll(".pxd-tl-word").length, 0, "closing drops the layer");
    pane.dispose();
  });
});

// ---------------------------------------------------------------- source rules

test("source rules: no pointer capture, no document listeners, no graph writes in the new view modules", () => {
  for (const file of ["../src/view/text-layer.js", "../src/view/drag-ghost.js", "../src/view/read-pane.js"]) {
    const src = read(file);
    assert.equal(src.includes("setPointerCapture"), false, file);
    assert.equal(/\bdoc\.addEventListener|document\.addEventListener/.test(src), false, file);
    assert.equal(/createBlock|updateBlock|fromMarkdown|updateProps/.test(src), false, file);
  }
  const ghost = read("../src/view/drag-ghost.js");
  const moveBody = ghost.slice(ghost.indexOf("function frame("), ghost.indexOf("function schedule("));
  assert.equal(moveBody.includes("elementFromPoint"), false);
  assert.equal(moveBody.includes("getBoundingClientRect"), false);
  const css = read("../src/css/text-layer.css");
  assert.match(css, /\.textLayer > \.pxd-tl-word\s*\{[^}]*color:\s*transparent/);
  assert.match(css, /::selection\s*\{[^}]*var\(--pxd-link/);
  assert.match(css, /\.pxd-ghost--board\s*\{[^}]*outline:\s*2px dashed/);
});

test("an outline row's handle drags a table ghost; once it runs the browser's own drag is refused", () => {
  withStub((stub, d, win) => {
    installDragTypes(win);
    const root = d.createElement("div");
    root.className = "pxd-root";
    d.body.append(root);
    const board = d.createElement("div");
    root.append(board);
    const drops = [];
    board.addEventListener("drop", (e) => drops.push(e));
    d.elementFromPoint = () => board;
    const view = createParseView({ doc: d, outline: true, ghostRoot: root });
    root.append(view.element());
    view.showDoc(outlineDoc());
    const handle = () => view.element().querySelector('[data-id="t1"] .pxd-parse__handle');
    // Before it moves, a native dragstart wins and the press ends.
    stub.dispatch(handle(), "pointerdown", { button: 0, clientX: 10, clientY: 10 });
    const early = stub.dispatch(handle(), "dragstart", {});
    assert.equal(early.defaultPrevented, false);
    stub.dispatch(win, "pointermove", { clientX: 60, clientY: 60 });
    assert.equal(root.querySelector(".pxd-ghost"), null);
    // Moving first: the ghost owns the drag.
    stub.dispatch(handle(), "pointerdown", { button: 0, clientX: 10, clientY: 10 });
    stub.dispatch(win, "pointermove", { clientX: 60, clientY: 60 });
    const ghost = root.querySelector(".pxd-ghost");
    assert.equal(ghost.getAttribute("data-kind"), "table");
    assert.deepEqual(ghost.querySelectorAll("td").map((td) => td.textContent), ["a", "b", "1", "2"]);
    assert.equal(stub.dispatch(handle(), "dragstart", {}).defaultPrevented, true);
    stub.dispatch(win, "pointerup", { clientX: 300, clientY: 200 });
    assert.equal(drops.length, 1);
    const payload = JSON.parse(drops[0].dataTransfer.getData(PARSE_MIME));
    assert.deepEqual([payload.kind, payload.ids], ["table", ["t1"]]);
    view.dispose();
  });
});

test("a mark press that already shows the ghost refuses a native dragstart", () => {
  withStub((stub, doc, win) => {
    const rig = paneRig(stub, doc, win);
    rig.noSelection();
    const part = doc.createElement("div");
    part.className = "TextHighlight__part";
    part._rect = rect(10, 10, 40, 12);
    part["__reactFiber$x"] = { return: { return: { memoizedProps: { value: { highlight: { id: "b0U1aGvkN", color: "blue", content: { text: "marked" } } } } } } };
    rig.page.append(part);
    stub.dispatch(rig.span, "pointermove", { clientX: 20, clientY: 16 });
    stub.flushFrames();
    stub.dispatch(rig.span, "pointerdown", { button: 0, clientX: 20, clientY: 16 });
    stub.dispatch(win, "pointermove", { clientX: 60, clientY: 40, buttons: 1 });
    assert.equal(rig.root.querySelector(".pxd-ghost").getAttribute("data-kind"), "highlight");
    assert.equal(stub.dispatch(rig.span, "dragstart", { dataTransfer: { setData() {} } }).defaultPrevented, true);
    stub.dispatch(win, "pointerup", { clientX: 300, clientY: 200 });
    assert.equal(rig.events[1].dataTransfer.getData(CARD_MIME), "((b0U1aGvkN))");
    rig.pane.dispose();
  });
});

test("opening the pane in Read mode fetches nothing (lazy assets rule)", () => {
  withStub((stub, doc, win) => {
    let fetched = 0;
    win.fetch = () => { fetched += 1; return Promise.reject(new Error("no")); };
    const prev = globalThis.fetch;
    globalThis.fetch = win.fetch;
    try {
      const rig = paneRig(stub, doc, win);
      stub.flushFrames();
      stub.flushTimers();
      rig.pane.setOcrPages(OCR.pages[0]);
      stub.flushFrames();
      assert.equal(fetched, 0);
      rig.pane.dispose();
    } finally {
      globalThis.fetch = prev;
    }
  });
});
