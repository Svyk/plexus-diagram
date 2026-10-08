// Parsed view: render, filters, tables, keys, chips, overlay math, sync, dispose, cache.
import assert from "node:assert/strict";
import test from "node:test";

import { optionsHash } from "../src/model/parse-hash.js";
import { createParseStore } from "../src/host/parse-store.js";
import { viewportTransform } from "../src/model/parse/index.js";
import { applyPoint } from "../src/model/parse/lines.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createItemRenderer } from "../src/view/cards.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel } from "../src/model/pdf.js";
import { createReadPane } from "../src/view/read-pane.js";
import { tipEntry } from "../src/view/tooltip-text.js";
import {
  BOTH_MIN_PX,
  BUILTIN_OPTIONS,
  PARSE_MIME,
  blockGroup,
  copyText,
  createParseView,
  defaultRangeChoice,
  engineChip,
  keyCommand,
  parseOwnsKey,
  readParsedUrls,
  rememberParsedUrl,
  removedSummary,
  scanSpan,
  syncDecision,
  visibleBlocks,
} from "../src/view/parse-view.js";
import { bboxToPageRect, userBoxToViewport } from "../src/view/parse-overlay.js";
import { makeHighlight } from "../src/view/make-highlight.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function sample() {
  return {
    schema: "pxd-parse/1",
    engine: "builtin",
    sha256: "abc",
    optsHash: "hash",
    pageCount: 2,
    pages: [
      { n: 1, w: 100, h: 200, rotation: 0, kind: "text" },
      { n: 2, w: 100, h: 200, rotation: 0, kind: "text" },
    ],
    order: ["h1", "p1", "t1", "f1", "m1"],
    blocks: {
      h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Title", bbox: [0, 0, 10, 10], confidence: 0.95 },
      p1: { id: "p1", type: "para", page: 1, text: "Hello alpha", bbox: [0, 12, 40, 24], confidence: 0.4 },
      t1: {
        id: "t1", type: "table", page: 2, bbox: [0, 0, 50, 40], confidence: 0.92, method: "lattice",
        rows: 2, cols: 2, headerRows: 1,
        cells: [
          { r: 0, c: 0, rowSpan: 1, colSpan: 2, text: "Head", header: true, bbox: [0, 0, 50, 10] },
          { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: "1.2", numeric: true, align: "right", bbox: [0, 10, 25, 40] },
          { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: "b", bbox: [25, 10, 50, 40] },
        ],
        grid: { xs: [0, 25, 50], ys: [0, 10, 40] },
      },
      f1: { id: "f1", type: "figure", page: 2, text: "Fig", bbox: [0, 50, 20, 80], confidence: 0.8 },
      m1: { id: "m1", type: "formula", page: 2, latex: "E=mc^2", bbox: [0, 80, 20, 90], confidence: 0.5 },
    },
    removed: [
      { reason: "running-header", text: "Head" },
      { reason: "running-header", text: "Head" },
      { reason: "running-header", text: "Head" },
      { reason: "page-number", text: "1" },
      { reason: "page-number", text: "2" },
      { reason: "page-number", text: "3" },
    ],
    stats: { ms: 400 },
    options: BUILTIN_OPTIONS,
  };
}

function pageData(text) {
  return {
    items: [{ str: text, transform: [10, 0, 0, 10, 72, 700], width: text.length * 5, height: 10, fontName: "f1", hasEOL: false }],
    ops: { fnArray: [], argsArray: [] },
    w: 612,
    h: 792,
    fonts: { f1: { name: "Helvetica" } },
  };
}

function mount() {
  const stub = createDomStub();
  const restore = stub.install();
  return { stub, doc: stub.document, restore };
}

test("removed furniture, chips, copy, and scan copy are pure", () => {
  assert.equal(removedSummary(sample().removed), "Removed: running header (3) · page numbers (3)");
  assert.equal(engineChip({ ms: 400 }).text, "Built-in · 0.4 s");
  assert.equal(engineChip({ engine: "docling", ms: 24000 }).text, "Docling · 24 s");
  assert.equal(engineChip({ helper: "not-running" }).text, "Local helper: off");
  assert.match(engineChip({ helper: "not-running" }).tip, /Engines/);
  assert.match(engineChip({ helper: "disabled" }).tip, /Engines/);
  assert.equal(engineChip({ helper: "wrong-token" }).text, "Local helper: wrong token");
  assert.equal(engineChip({ helper: "models-missing" }).text, "Local helper: downloading models");
  assert.equal(engineChip({ phase: "running", page: 4, pageCount: 12 }).text, "Page 4 of 12");
  assert.equal(engineChip({ engine: "anydoc", helper: "not-running", ms: 400 }).text, "Alternative read · 0.4 s");
  assert.equal(engineChip({ phase: "running", page: 4, pageCount: 12 }).cancel, true);
  const doc = sample();
  assert.equal(copyText(doc, ["p1"]).format, "md");
  assert.match(copyText(doc, ["p1"]).text, /Hello alpha/);
  assert.equal(copyText(doc, ["t1"]).format, "csv");
  assert.match(copyText(doc, ["t1"]).text, /Head/);
  assert.equal(copyText(doc, ["p1", "t1"], { shift: true }).format, "csv");
  assert.equal(copyText(doc, ["p1", "t1"]).format, "md");
  assert.equal(scanSpan({
    pages: [{ n: 3, kind: "scan" }, { n: 9, kind: "scan" }],
    order: [],
    blocks: {},
  }), "Scanned pages 3–9 · the page is an image");
  assert.equal(scanSpan({ pages: [{ n: 4, kind: "scan" }], order: [], blocks: {} }), "Scanned page 4 · the page is an image");
  assert.equal(blockGroup("heading"), "text");
  assert.equal(visibleBlocks(doc, { filters: { text: false, table: true, figure: true, formula: true } }).some((b) => b.type === "heading"), false);
  assert.equal(keyCommand({ key: "ArrowDown" }, { owned: false }), null);
  assert.equal(keyCommand({ key: "ArrowDown", shiftKey: true }, { owned: true }), "extend-next");
  assert.equal(keyCommand({ key: "Enter", metaKey: true }, { owned: true }), "send");
  assert.equal(keyCommand({ key: "c", metaKey: true }, { owned: true, textEntry: true }), null);
  assert.equal(syncDecision({ locked: true, now: 1000, last: 0 }).jump, false);
  assert.equal(syncDecision({ wheeling: true, now: 1000, last: 0 }).jump, false);
  assert.equal(syncDecision({ now: 100, last: 0 }).jump, false);
  assert.equal(syncDecision({ now: 400, last: 0 }).jump, true);
  assert.equal(BOTH_MIN_PX, 640);
  assert.equal(tipEntry("pdf.parse").name, "Parse");
  assert.equal(tipEntry("parse.docling-off").name, "Local helper: off");
});

test("overlay maps viewport boxes by page scale and user-space boxes through rotation", () => {
  const el = { clientWidth: 100 };
  const view = bboxToPageRect([10, 20, 30, 50], { w: 200, h: 100, rotation: 90 }, el);
  assert.equal(view.scale, 0.5);
  assert.equal(view.left, 5);
  assert.equal(view.top, 10);
  assert.equal(view.width, 10);
  assert.equal(view.height, 15);
  const wide = bboxToPageRect([0, 0, 10, 10], { w: 200, h: 100, rotation: 90 }, { clientWidth: 400 });
  assert.equal(wide.scale, 2);
  assert.equal(wide.width, 20);
  assert.equal(wide.height, 20);

  const box = [10, 20, 40, 80];
  const media = { w: 100, h: 200, userSpace: true };
  const expectBox = (rotation, clientWidth) => {
    const page = { ...media, rotation };
    const mapped = userBoxToViewport(box, page);
    const rect = bboxToPageRect(box, page, { clientWidth });
    const scale = clientWidth / (rotation === 90 || rotation === 270 ? media.h : media.w);
    assert.equal(rect.left, mapped[0] * scale);
    assert.equal(rect.top, mapped[1] * scale);
    assert.equal(rect.width, (mapped[2] - mapped[0]) * scale);
    assert.equal(rect.height, (mapped[3] - mapped[1]) * scale);
    return mapped;
  };
  assert.deepEqual(expectBox(0, 100).map((n) => Math.round(n)), [10, 120, 40, 180]);
  assert.deepEqual(expectBox(90, 200).map((n) => Math.round(n)), [20, 10, 80, 40]);
  assert.deepEqual(expectBox(180, 100).map((n) => Math.round(n)), [60, 20, 90, 80]);
  assert.deepEqual(expectBox(270, 200).map((n) => Math.round(n)), [120, 60, 180, 90]);
  const m = viewportTransform(100, 200, 270);
  assert.deepEqual(applyPoint(m, 10, 20).map((n) => Math.round(n)), [180, 90]);
});

test("parsed body keeps reading order, filters, spans, selection, and keys", async () => {
  const { stub, doc, restore } = mount();
  const jumps = [];
  const session = [];
  const toasts = [];
  const adopted = [];
  try {
    const before = stub.listenerCount();
    const view = createParseView({
      doc,
      session: {
        insertParsedBelow(payload) { session.push(["below", payload.kind, payload.ids]); },
        insertParsedCard(payload) { session.push(["card", payload.kind, payload.ids]); },
        insertParsedTable(payload) { session.push(["table", payload.mode, payload.kind]); },
        sendParsedToBoard(payload) { session.push(["send", payload.kind]); },
      },
      jumpPage(page) { jumps.push(page); },
      onToast(message) { toasts.push(message); },
      adoptCreated(uid) { adopted.push(uid); },
      getContext: () => null,
      clock: () => 1000,
    });
    doc.body.append(view.element());
    // The stub freezes textContent when it is assigned, so the message lives on the lead.
    assert.match(view.element().querySelector(".pxd-parse__lead").textContent, /No parse yet/);
    const alt = view.element().querySelector(".pxd-parse__alt");
    assert.match(alt.textContent, /Alternative read/);
    assert.match(alt.textContent, /no tables guarantee/);
    assert.equal(alt.getAttribute("data-guarantee"), "no tables guarantee");
    assert.ok(view.element().querySelector(".pxd-parse__go"));
    assert.equal(stub.listenerCount() > before, true);

    view.showDoc(sample());
    const body = view.element().querySelector(".pxd-parse__body");
    assert.deepEqual([...body.querySelectorAll(".pxd-parse__page")].map((node) => node.textContent), ["p. 1", "p. 2"]);
    assert.deepEqual([...body.querySelectorAll(".pxd-parse__block")].map((node) => node.getAttribute("data-id")), ["h1", "p1", "t1", "f1", "m1"]);
    assert.equal(body.querySelector('[data-id="p1"]').classList.contains("pxd-parse__block--low"), true);
    assert.equal(body.querySelector("th").getAttribute("colspan"), "2");
    assert.equal(body.querySelectorAll("td").length, 2);
    assert.equal(body.querySelector(".pxd-parse__num").textContent, "1.2");
    assert.match(body.querySelector(".pxd-parse__tchip").textContent, /lattice · 0\.92/);
    assert.match(body.textContent, /Removed: running header \(3\)/);
    assert.equal(body.querySelector(".pxd-parse__math").textContent, "E=mc^2");
    assert.equal(body.querySelector(".pxd-parse__crop").getAttribute("data-crop"), "pending");
    assert.equal(view.chipText(), "Built-in · 0.4 s");

    body.querySelector('[data-filter="text"]') || view.element().querySelector('[data-filter="text"]').click();
    assert.equal(view.element().querySelector('[data-id="h1"]'), null);
    assert.equal(view.element().querySelector('[data-id="p1"]'), null);
    assert.ok(view.element().querySelector('[data-id="t1"]'));
    view.element().querySelector('[data-filter="text"]').click();

    const title = view.element().querySelector('[data-id="h1"]');
    title.click();
    assert.deepEqual(view.selectedIds(), ["h1"]);
    assert.equal(jumps.at(-1), 1);
    assert.match(view.element().querySelector(".pxd-parse__summary").textContent, /1 block/);

    view.element().focus();
    stub.dispatch(view.element(), "keydown", { key: "ArrowDown" });
    assert.deepEqual(view.selectedIds(), ["p1"]);
    stub.dispatch(view.element(), "keydown", { key: "ArrowDown", shiftKey: true });
    assert.deepEqual(view.selectedIds(), ["p1", "t1"]);
    const search = view.element().querySelector(".pxd-parse__search");
    search.focus();
    stub.dispatch(search, "keydown", { key: "ArrowDown" });
    assert.deepEqual(view.selectedIds(), ["p1", "t1"]);
    assert.equal(parseOwnsKey({ target: search }, view.element(), null), false);

    const act = (label) => [...view.element().querySelectorAll(".pxd-parse__act")].find((node) => node.textContent === label);
    act("Insert below PDF").click();
    assert.equal(session[0][0], "below");
    view.element().querySelector('[data-id="f1"]').click();
    act("Insert below PDF").click();
    assert.deepEqual(session.at(-1).slice(0, 2), ["card", "figure"]);
    view.element().querySelector('[data-id="t1"]').click();
    view.element().querySelector('[data-mode="native"]').click();
    assert.deepEqual(session.at(-1), ["table", "native", "table"]);
    view.element().focus();
    stub.dispatch(view.element(), "keydown", { key: "Enter", metaKey: true });
    assert.equal(session.at(-1)[0], "send");

    const handle = view.element().querySelector('[data-id="t1"] .pxd-parse__handle');
    const set = [];
    stub.dispatch(handle, "dragstart", { dataTransfer: { setData(type, value) { set.push([type, value]); } } });
    assert.equal(set[0][0], PARSE_MIME);
    const payload = JSON.parse(set[0][1]);
    assert.equal(payload.kind, "table");
    assert.deepEqual(payload.ids, ["t1"]);

    view.element().focus();
    stub.dispatch(view.element(), "keydown", { key: "h" });
    assert.deepEqual(adopted, []);
    view.showDoc(sample());
    view.element().querySelector('[data-id="p1"]').click();
    const highlighted = await makeHighlight({
      block: sample().blocks.p1,
      getContext: () => ({ addHighlight: async () => ({ uid: "hl1" }) }),
      adoptCreated(uid) { adopted.push(uid); },
      toast(message) { toasts.push(message); },
    });
    assert.equal(highlighted.path, "roam");
    assert.deepEqual(adopted, ["hl1"]);
    const picked = await makeHighlight({
      block: sample().blocks.p1,
      pageEl: doc.createElement("div"),
      page: { w: 100, h: 200 },
      toast(message) { toasts.push(message); },
    });
    assert.equal(picked.path, "picker");
    assert.equal(picked.message, "Pick a colour to save the highlight");
    assert.equal(toasts.at(-1), "Pick a colour to save the highlight");

    view.noteReaderWheel();
    view.scrollBody();
    const held = jumps.length;
    view.scrollBody();
    assert.equal(jumps.length, held);
    view.dispose();
    assert.equal(stub.listenerCount(), before);
  } finally {
    restore();
  }
});

test("sync stays quiet while the reader is wheeled, then jumps", () => {
  const { stub, doc, restore } = mount();
  let now = 0;
  const jumps = [];
  try {
    const view = createParseView({
      doc,
      clock: () => now,
      jumpPage(page) { jumps.push(page); },
    });
    view.showDoc(sample());
    view.noteReaderWheel();
    view.scrollBody();
    assert.deepEqual(jumps, []);
    now = 500;
    view.scrollBody();
    assert.deepEqual(jumps, [1]);
    view.element().querySelector(".pxd-parse__lock").click();
    now = 1000;
    view.scrollBody();
    assert.deepEqual(jumps, [1]);
    view.dispose();
  } finally {
    restore();
  }
});

test("a cached parse restores from the memory store and the first page paints before the next", async () => {
  const { stub, doc, restore } = mount();
  try {
    const store = createParseStore({});
    const hash = await optionsHash(BUILTIN_OPTIONS);
    const docParsed = { ...sample(), sha256: "abc", engine: "builtin", parseRev: 99, optsHash: hash, options: { ...BUILTIN_OPTIONS } };
    await store.putParse(docParsed);
    await store.indexUrl("https://example.test/a.pdf", { sha256: "abc", pageCount: 2 });
    rememberParsedUrl(stub.localStorage, "https://example.test/a.pdf");
    assert.equal(readParsedUrls(stub.localStorage).has("https://example.test/a.pdf"), true);
    const view = createParseView({
      doc,
      store,
      storage: stub.localStorage,
      url: "https://example.test/a.pdf",
    });
    const found = await view.restore();
    assert.equal(found.sha256, "abc");
    assert.match(view.element().textContent, /Title/);
    view.dispose();

    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    const progressive = createParseView({
      doc,
      getPdf: async () => ({ numPages: 2 }),
      loadGeometry: (n) => (n === 1 ? pageData("Hello page") : gate.then(() => pageData("Later page"))),
    });
    const pending = progressive.parseBuiltin();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.match(progressive.element().textContent, /Hello page/);
    assert.equal(progressive.element().textContent.includes("Later page"), false);
    assert.match(progressive.chipText(), /Page \d of 2/);
    release();
    await pending;
    assert.match(progressive.element().textContent, /Later page/);
    progressive.dispose();
  } finally {
    restore();
  }
});

test("card menu adds Parse PDF and Open parsed without moving Compass", () => {
  const pdf = buildMenu("card", { isPdf: true });
  const byId = (menu, id) => menu.find((row) => row.id === id);
  assert.equal(byId(pdf, "parse-pdf").label, "Parse PDF…");
  assert.equal(byId(pdf, "open-parsed"), undefined);
  assert.equal(byId(buildMenu("card", { isPdf: true, hasParse: true }), "open-parsed").label, "Open parsed");
  assert.equal(byId(buildMenu("card", {}), "parse-pdf"), undefined);
  const compass = buildMenu("card", { isPdf: true, hasParse: true, compass: true }).map((row) => row.id);
  assert.equal(compass[compass.indexOf("open-sidebar") + 1], "open-compass");
});

test("the PDF card Parse button sits beside Open and calls onPdfParse", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const parsed = [];
  const string = "{{[[pdf]]: https://example.test/self.pdf}}";
  try {
    const r = createItemRenderer({
      doc,
      host: {
        renderString(node, text) { node.textContent = text; },
        pdfCover() { return coverModel({ title: "Self paper", url: "https://example.test/self.pdf", count: 0 }); },
      },
      session: { updateProps() {}, setString() {} },
      itemsLayer,
      sectionsLayer,
      timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } },
      onPdfParse(uid) { parsed.push(uid); },
    });
    const board = buildBoard({
      ":block/uid": "boardpdfu",
      ":block/string": "{{[[diagram]]:PDFs}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [{
        ":block/uid": "pdfself01",
        ":block/string": string,
        ":block/order": 0,
        ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 240, ":h": 320 } },
        ":block/children": [],
      }],
    }, { resolve: () => "" });
    r.sync({ board, rects: worldRects(board), structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    while (idleQueue.length) idleQueue.shift()({ timeRemaining: () => 10 });
    const cover = r.shellOf("pdfself01").querySelector(".pxd-pdf-cover");
    const open = cover.querySelector("button.pxd-pdf-open");
    const parse = cover.querySelector("button.pxd-pdf-parse");
    assert.equal(open.textContent, "Open");
    assert.equal(parse.textContent, "Parse");
    assert.equal(parse.getAttribute("data-tip"), "pdf.parse");
    assert.equal(open.parentElement.classList.contains("pxd-pdf-pills"), true);
    parse.click();
    assert.deepEqual(parsed, ["pdfself01"]);
    r.dispose();
  } finally {
    restore();
  }
});

test("default range is all through 60 pages and current after that", () => {
  assert.equal(defaultRangeChoice(1), "all");
  assert.equal(defaultRangeChoice(60), "all");
  assert.equal(defaultRangeChoice(61), "current");
  assert.equal(defaultRangeChoice(0), "all");
  assert.equal(defaultRangeChoice(undefined), "all");
});

test("a pointer drag drops the parse payload on the element under the pointer", () => {
  const { stub, doc, restore } = mount();
  try {
    const view = createParseView({ doc });
    doc.body.append(view.element());
    view.showDoc(sample());
    const board = doc.createElement("div");
    doc.body.append(board);
    const seen = [];
    board.addEventListener("drop", (event) => {
      seen.push(event.dataTransfer.getData(PARSE_MIME));
    });
    doc.elementFromPoint = () => board;
    const handle = view.element().querySelector('[data-id="t1"] .pxd-parse__handle');
    stub.dispatch(handle, "pointerdown", { button: 0, clientX: 10, clientY: 10 });
    stub.dispatch(doc, "pointermove", { clientX: 40, clientY: 12 });
    stub.dispatch(doc, "pointerup", { clientX: 48, clientY: 16 });
    assert.equal(seen.length, 1);
    const payload = JSON.parse(seen[0]);
    assert.equal(payload.kind, "table");
    assert.deepEqual(payload.ids, ["t1"]);
  } finally {
    restore();
  }
});

test("a helper that is not running replaces the timing chip", async () => {
  const { stub, doc, restore } = mount();
  try {
    const view = createParseView({
      doc,
      helper: { async health() { return { state: "not-running" }; } },
    });
    doc.body.append(view.element());
    view.showDoc(sample());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(view.chipText(), "Local helper: off");
    assert.equal(view.element().querySelector(".pxd-parse__docling").hidden, true);
  } finally {
    restore();
  }
});

test("Read + Outline shows the strip and dispose drops its listeners", async () => {
  const { stub, doc, restore } = mount();
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  try {
    const before = stub.listenerCount();
    const pane = createReadPane({
      doc,
      root,
      storage: stub.localStorage,
      host: { renderBlock() {}, unmount() {} },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", source: "{{[[pdf]]: https://example.test/a.pdf}}" });
    assert.equal(pane.element().querySelector(".pxd-read__modes").hasAttribute("hidden"), true);
    assert.deepEqual(pane.element().querySelectorAll(".pxd-read__mode").map((b) => b.textContent), ["Read", "Read + Outline", "Show parsed"]);
    assert.equal(pane.element().querySelector('[data-mode="parsed"]'), null);
    pane.element().querySelector('[data-mode="both"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stub.localStorage.getItem("pxd-read-mode"), "read+outline");
    assert.equal(pane.element().querySelector(".pxd-read__modes").hasAttribute("hidden"), false);
    assert.ok(pane.element().querySelector(".pxd-parse"));
    assert.equal(pane.element().classList.contains("pxd-read--both"), true);
    assert.equal(pane.element().querySelector(".pxd-read__pill").hasAttribute("hidden"), false);
    pane.element()._rect = { left: 0, top: 0, width: 360, height: 600, right: 360, bottom: 600, x: 0, y: 0 };
    pane.layout(360);
    assert.equal(pane.element().classList.contains("pxd-read--narrow"), true);
    assert.equal(pane.element().querySelector(".pxd-read__pill").hasAttribute("hidden"), true);
    assert.ok(pane.element().querySelector(".pxd-read__pageprev"));
    assert.ok(pane.element().querySelector(".pxd-read__pagenext"));
    assert.equal(pane.element().querySelector(".pxd-parse__docling").hidden, true);
    assert.equal(pane.element().querySelector(".pxd-read-drawer--open"), null);
    pane.dispose();
    assert.equal(stub.listenerCount(), before);
  } finally {
    restore();
  }
});
