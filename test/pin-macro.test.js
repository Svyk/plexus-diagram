// Pins on their own macro, a hidden pins container, board focus after a reader insert, and a jump that keeps the zoom.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { PARSE_MIME } from "../src/model/drop.js";
import {
  CONTAINER_STRING,
  PIN_COMPONENT,
  PIN_CONTAINER_STRING,
  isContainerString,
  isStructuralString,
  parseRegion,
  regionsOf,
} from "../src/model/regions.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createParseActions } from "../src/view/parse-actions.js";
import { createReadPane } from "../src/view/read-pane.js";
import { eachRegionButton, regionUidForButton } from "../src/view/region-crop.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const PIN = "{{[[plexus-pin]]: d=pdfblock1 pg=3 f=0.1,0.2,0.3,0.1}} quote";

test("plexus-pin is its own macro and the pins container is structure", () => {
  assert.equal(PIN_COMPONENT, "plexus-pin");
  assert.equal(PIN_CONTAINER_STRING, "{{[[plexus-pins]]}}");
  assert.equal(isContainerString(PIN_CONTAINER_STRING), true);
  assert.equal(isContainerString(` ${CONTAINER_STRING} `), true);
  assert.equal(isStructuralString(PIN_CONTAINER_STRING), true);
  assert.equal(parseRegion("{{[[plexus-pins]]}}"), null);
  const rows = regionsOf({
    children: [{ string: PIN_CONTAINER_STRING, children: [{ uid: "p1", string: PIN }] }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "pdf");
  assert.equal(rows[0].uid, "p1");
  assert.equal(rows[0].owner, "plexus-diagram");
});

test("Roam's plexus-pin buttons are claimed like region buttons, and a pin card resolves to its block", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    doc.body.append(root);
    const pin = doc.createElement("button");
    pin.className = "rm-xparser-default-plexus-pin";
    pin.setAttribute("data-n", "pin");
    const box = doc.createElement("button");
    box.className = "rm-xparser-default-plexus-pins";
    box.setAttribute("data-n", "container");
    const region = doc.createElement("button");
    region.className = "rm-xparser-default-plexus-region";
    region.setAttribute("data-n", "region");
    root.append(pin, box, region);
    const seen = [];
    eachRegionButton(root, (button) => seen.push(button.getAttribute("data-n")));
    assert.deepEqual(seen.sort(), ["pin", "region"]);

    const card = doc.createElement("div");
    card.className = "pxd-item";
    card.setAttribute("data-uid", "pincard1");
    const inner = doc.createElement("button");
    inner.className = "rm-xparser-default-plexus-pin";
    card.append(inner);
    root.append(card);
    assert.equal(regionUidForButton(inner, (uid) => (uid === "pincard1" ? PIN : "")), "pincard1");
  } finally {
    restore();
  }
});

test("the pins and regions container rows are hidden in the reading pane and page edit, and the label is quiet", () => {
  const css = read("../src/css/pdf-pin.css");
  const hide = /\.pxd-read \.roam-block-container:has\(> \.rm-block-main button:is\(\.rm-xparser-default-plexus-pins, \.rm-xparser-default-plexus-regions\)\),\s*\.pxd-root \.pxd-item--page \.pxd-page-edit \.roam-block-container:has\(> \.rm-block-main button:is\(\.rm-xparser-default-plexus-pins, \.rm-xparser-default-plexus-regions\)\) \{\s*display: none !important;/;
  assert.match(css, hide);
  assert.match(css, /button\.rm-xparser-default-plexus-pins \{[^}]*opacity: 0\.45;[^}]*border: 0;/);
  const quiet = css.split("button.rm-xparser-default-plexus-pins {")[1].split("}")[0];
  assert.match(quiet, /background: transparent;/);
  assert.match(read("../extension.css"), /rm-xparser-default-plexus-pins/);
});

// ---- board drop harness: a reader drop moves focus to the board so ⌘Z is the board's.
function mountBoard(sessionExtra = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [],
  });
  const calls = [];
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
    on: () => () => {},
    release() {},
    setLinkMode() {},
    addRefCards(list) { calls.push(["addRefCards", list]); return Promise.resolve(["ref1"]); },
    insertParsedCard(spec) { calls.push(["insertParsedCard", spec]); return Promise.resolve({ ok: true, uid: "card1", writes: 5 }); },
    ...sessionExtra,
  };
  const host = {
    graph: "Svy",
    renderString() {}, renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => null, pullTree: () => [], blockString: () => null, pageUid: () => null,
    openBlock() {}, openInSidebar() {}, searchPages: () => [], searchBlocks: () => [], related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.1.0" });
  const reader = stub.document.createElement("div");
  reader.className = "pxd-read";
  const field = stub.document.createElement("input");
  reader.append(field);
  view.root.append(reader);
  return { stub, restore, view, calls, field };
}

const transfer = (data) => ({
  getData(type) { return data[type] ?? ""; },
  types: Object.keys(data),
  files: [],
});

test("a parsed drop from the reader moves focus to the board root so the board owns ⌘Z", async () => {
  const f = mountBoard();
  try {
    f.field.focus();
    assert.equal(f.stub.document.activeElement === f.field, true);
    const d = transfer({ [PARSE_MIME]: JSON.stringify({ kind: "text", text: "Osmotic water flow", page: 3 }) });
    f.stub.dispatch(f.view.root, "drop", { clientX: 300, clientY: 200, dataTransfer: d });
    await tick();
    await tick();
    assert.equal(f.calls.filter((c) => c[0] === "insertParsedCard").length, 1);
    assert.equal(f.stub.document.activeElement === f.view.root, true);
  } finally {
    f.view.destroy?.();
    f.restore();
  }
});

test("a highlight ((uid)) dropped while the reader has focus also hands focus to the board", async () => {
  const f = mountBoard();
  try {
    f.field.focus();
    const d = transfer({ "text/plain": "((hlmark001))" });
    f.stub.dispatch(f.view.root, "drop", { clientX: 300, clientY: 200, dataTransfer: d });
    await tick();
    await tick();
    assert.equal(f.calls.filter((c) => c[0] === "addRefCards").length, 1);
    assert.equal(f.stub.document.activeElement === f.view.root, true);
  } finally {
    f.view.destroy?.();
    f.restore();
  }
});

test("a drop that inserts nothing leaves focus where it was", async () => {
  const f = mountBoard({ insertParsedCard() { return Promise.resolve({ ok: false, reason: "empty" }); } });
  try {
    f.field.focus();
    const d = transfer({ [PARSE_MIME]: JSON.stringify({ kind: "text", text: "x" }) });
    f.stub.dispatch(f.view.root, "drop", { clientX: 300, clientY: 200, dataTransfer: d });
    await tick();
    await tick();
    assert.equal(f.stub.document.activeElement === f.field, true);
  } finally {
    f.view.destroy?.();
    f.restore();
  }
});

test("Insert and click-to-place (parse actions) call focus after a successful insert only", async () => {
  let focused = 0;
  let ok = true;
  const actions = createParseActions({
    session: { insertParsedCard: async () => (ok ? { ok: true, uid: "c1" } : { ok: false, reason: "empty" }) },
    focus: () => { focused += 1; },
    select: () => {},
    show: () => {},
    toWorld: (pt) => pt,
  });
  await actions.insertTextCard({ text: "hello", client: { x: 10, y: 20 } });
  assert.equal(focused, 1);
  ok = false;
  await actions.insertTextCard({ text: "hello" });
  assert.equal(focused, 1);
});

// ---- reader jump: the Source chip opens a page on the PDF that is already showing.
function mountReader({ resetOnPage = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const viewer = { currentScaleValue: "auto", currentScale: 1 };
  const renders = [];
  let input = null;
  const pane = createReadPane({
    doc,
    root,
    host: {
      renderBlock(node, uid) {
        renders.push(uid);
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        input = doc.createElement("input");
        input.className = "bp3-input";
        input.value = "1";
        input.addEventListener("change", () => {
          if (resetOnPage != null) { viewer.currentScaleValue = String(resetOnPage); viewer.currentScale = resetOnPage; }
        });
        const scroller = doc.createElement("div");
        scroller.className = "PdfHighlighter";
        scroller["__reactFiber$v"] = { stateNode: { viewer } };
        const page = doc.createElement("div");
        page.className = "page";
        page.setAttribute("data-page-number", "1");
        const canvas = doc.createElement("canvas");
        canvas.width = 600;
        page.append(canvas);
        scroller.append(page);
        box.append(input, scroller);
        node.append(box);
      },
    },
  });
  const drain = () => { for (let i = 0; i < 40; i += 1) if (!stub.flushTimers()) break; };
  return { stub, restore, pane, viewer, renders, drain, input: () => input };
}

test("a Source-chip jump on the open PDF moves the page and keeps the user's zoom", () => {
  const f = mountReader({ resetOnPage: 0.33 });
  try {
    f.pane.open({ blockUid: "pdf1", cardUid: "card1", title: "Paper" });
    f.drain();
    assert.equal(f.viewer.currentScaleValue, "page-width");
    f.viewer.currentScaleValue = "1.5";
    f.viewer.currentScale = 1.5;
    f.pane.open({ blockUid: "pdf1", cardUid: "card1", title: "Paper", page: 5, frac: [0.1, 0.2, 0.3, 0.1] });
    f.drain();
    assert.equal(f.input().value, "5");
    assert.equal(f.viewer.currentScale, 1.5);
    assert.equal(f.renders.length, 1);
  } finally {
    f.pane.dispose();
    f.restore();
  }
});

test("a fitted page width stays page width through a jump", () => {
  const f = mountReader({ resetOnPage: 0.33 });
  try {
    f.pane.open({ blockUid: "pdf1", cardUid: "card1", title: "Paper" });
    f.drain();
    f.viewer.currentScale = 1.2;
    f.pane.open({ blockUid: "pdf1", cardUid: "card1", title: "Paper", page: 4 });
    f.drain();
    assert.equal(f.input().value, "4");
    assert.equal(f.viewer.currentScaleValue, "page-width");
  } finally {
    f.pane.dispose();
    f.restore();
  }
});

test("a jump that does not disturb the zoom writes no scale", () => {
  const f = mountReader();
  try {
    f.pane.open({ blockUid: "pdf1", cardUid: "card1", title: "Paper" });
    f.drain();
    let writes = 0;
    let value = f.viewer.currentScaleValue;
    Object.defineProperty(f.viewer, "currentScaleValue", { get: () => value, set: (v) => { writes += 1; value = v; }, configurable: true });
    f.pane.open({ blockUid: "pdf1", cardUid: "card1", title: "Paper", page: 2 });
    f.drain();
    assert.equal(f.input().value, "2");
    assert.equal(writes, 0);
  } finally {
    f.pane.dispose();
    f.restore();
  }
});
