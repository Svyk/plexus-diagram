// PGE-2: a page edit is the same rows, in world px. A note edit keeps the inverse-zoom counter-scale.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer, pageEditScrollTop } from "../src/view/cards.js";
import { editorCounterScale } from "../src/view/editor-scale.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});
const rawBoard = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const PAGE = { ":x": 0, ":y": 0, ":w": 280, ":h": 160 };
const NOTE = { ":x": 400, ":y": 0, ":w": 220, ":h": 80 };
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };
const ZOOM = 0.61;

function tree(n) {
  const out = [];
  for (let i = 1; i <= n; i += 1) out.push({ uid: `row${String(i).padStart(4, "0")}`, string: `Row ${i}`, children: [] });
  return out;
}

function harness({ pageBlocks = [] } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    renderPage() {},
    renderBlock() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageOutline: () => ({ uid: "uid-Alpha", exists: true, blocks: pageBlocks }),
    pageUid: (t) => `uid-${t}`,
    openPage() {},
    watchPage() { return () => {}; },
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later() { return () => {}; },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard([
    blk("pg0000001", "[[Alpha]]", PAGE, 0),
    blk("nt0000001", "A note", NOTE, 1),
  ]));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  flush();
  return {
    stub, doc, host, r,
    pageUid: board.order[0],
    noteUid: board.order[1],
    shell: (uid) => r.shellOf(uid),
    done() { r.dispose(); restore(); },
  };
}

async function settle(h, promise) {
  let done = false;
  let value;
  promise.then((v) => { done = true; value = v; });
  for (let i = 0; i < 80 && !done; i += 1) {
    h.stub.flushFrames();
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  assert.equal(done, true);
  return value;
}

test("PGE-2: pageEditScrollTop keeps the clicked row's offset and converts screen px by zoom", () => {
  assert.equal(pageEditScrollTop(0, 40, 40, 1), 0);
  assert.equal(pageEditScrollTop(12, 40, 40, ZOOM), 12);
  assert.equal(pageEditScrollTop(0, 90, 40, 1), 50);
  assert.equal(pageEditScrollTop(10, 90, 40, 1), 60);
  assert.equal(pageEditScrollTop(0, 120, 60, ZOOM), 60 / ZOOM);
  assert.equal(pageEditScrollTop(5, 0, 40, 1), 0);
  assert.equal(pageEditScrollTop(4, 10, 10, 0), 4);
  assert.equal(pageEditScrollTop(4, 10, 10, Number.NaN), 4);
});

test("PGE-2: page edit skips the inverse-zoom transform; a note edit still gets it", async () => {
  const blocks = tree(4);
  const h = harness({ pageBlocks: blocks });
  try {
    const row = blocks[1].uid;
    h.host.renderPage = (el) => {
      const input = h.doc.createElement("textarea");
      input.className = "rm-block__input";
      input.id = `block-input-body-${row}`;
      el.append(input);
    };
    h.r.setZoom(ZOOM);
    const ok = await h.r.enterEdit(h.pageUid, { row });
    h.stub.flushFrames();
    assert.equal(ok, true);
    const editor = h.shell(h.pageUid).querySelector(".pxd-item__editor");
    assert.ok(editor.classList.contains("pxd-page-edit"));
    const scaled = editorCounterScale(ZOOM);
    assert.equal(editor.style.transform, undefined);
    assert.equal(editor.style.width, undefined);
    assert.notEqual(editor.style["--pxd-ed-z"], String(ZOOM));
    const pageInput = editor.querySelector(".rm-block__input");
    assert.equal(pageInput.style["font-size"], undefined);
    h.r.setZoom(0.5);
    h.stub.flushFrames();
    assert.equal(editor.style.transform, undefined);
    assert.equal(h.shell(h.pageUid).querySelector(".pxd-item__body").dataset.pxdScreen, undefined);

    await h.r.exitEdit({ silent: true });
    h.host.renderBlock = (el) => {
      const input = h.doc.createElement("textarea");
      input.className = "rm-block__input";
      el.append(input);
    };
    assert.equal(await settle(h, h.r.enterEdit(h.noteUid)), true);
    const noteEditor = h.shell(h.noteUid).querySelector(".pxd-item__editor");
    const noteScale = editorCounterScale(0.5);
    assert.equal(noteEditor.classList.contains("pxd-page-edit"), false);
    assert.equal(noteEditor.style.transform, noteScale.transform);
    assert.equal(noteEditor.style.width, noteScale.width);
    assert.equal(noteEditor.querySelector(".rm-block__input").style["font-size"], `${noteScale.fontPx}px`);
    assert.equal(scaled.transform, editorCounterScale(ZOOM).transform);
    await h.r.exitEdit({ silent: true });
  } finally { h.done(); }
});

test("PGE-2: the editor scrolls so the clicked row keeps its offset", async () => {
  const blocks = tree(4);
  const h = harness({ pageBlocks: blocks });
  try {
    const row = blocks[2].uid;
    const card = h.shell(h.pageUid);
    const body = card.querySelector(".pxd-item__body");
    body._rect = { top: 100, left: 0, width: 280, height: 120, right: 280, bottom: 220, x: 0, y: 100 };
    const rowEl = card.querySelector(`[data-pxd-row="${row}"]`);
    assert.ok(rowEl);
    rowEl._rect = { top: 160, left: 12, width: 240, height: 22, right: 252, bottom: 182, x: 12, y: 160 };
    h.host.renderPage = (el) => {
      const input = h.doc.createElement("textarea");
      input.className = "rm-block__input";
      input.id = `block-input-body-${row}`;
      input._rect = { top: 220, left: 12, width: 240, height: 22, right: 252, bottom: 242, x: 12, y: 220 };
      el.append(input);
    };
    h.r.setZoom(ZOOM);
    assert.equal(await h.r.enterEdit(h.pageUid, { row }), true);
    const editor = card.querySelector(".pxd-page-edit");
    assert.equal(editor.scrollTop, pageEditScrollTop(0, 120, 60, ZOOM));
    await h.r.exitEdit({ silent: true });
  } finally { h.done(); }
});

test("PGE-2: Escape restores the page rows and leaves the card height", async () => {
  const blocks = tree(3);
  const h = harness({ pageBlocks: blocks });
  try {
    const card = h.shell(h.pageUid);
    card.style.height = "160px";
    h.host.renderPage = (el) => {
      const input = h.doc.createElement("textarea");
      input.className = "rm-block__input";
      input.id = `block-input-body-${blocks[0].uid}`;
      el.append(input);
    };
    assert.equal(await h.r.enterEdit(h.pageUid, { row: blocks[0].uid }), true);
    assert.equal(card.querySelector(".pxd-page-edit") == null, false);
    assert.equal(card.querySelector("[data-pxd-row]"), null);
    await h.r.exitEdit();
    assert.equal(card.querySelector(".pxd-item__editor"), null);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.style.height, "160px");
    assert.equal(card.querySelectorAll("[data-pxd-row]").length, blocks.length);
  } finally { h.done(); }
});

test("PGE-2: page-edit CSS hides bullets and guides, matches the row font, and thins the scrollbar", () => {
  const css = readFileSync(new URL("../src/css/page-edit.css", import.meta.url), "utf8");
  assert.match(css, /\.rm-bullet[^{]*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /\.rm-bullet[^{]*\{[^}]*width:\s*0/);
  assert.match(css, /\.rm-block-children::before[^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.rm-block__input[^{]*\{[^}]*font-size:\s*13px\s*!important/);
  assert.match(css, /\.rm-block__input[^{]*\{[^}]*line-height:\s*19\.5px\s*!important/);
  assert.match(css, /\.pxd-page-edit \{[^}]*scrollbar-width:\s*thin/);
  assert.match(css, /::-webkit-scrollbar-button[^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.pxd-page-edit \{[^}]*transform:\s*none\s*!important/);
});
