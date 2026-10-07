// G1. In edit, a card keeps the resting string's box. The measured row
// (note 6rN5tqjeD, zoom 54%) was .rm-block-main children:
//   .rm-block__controls 40px, .rm-autocomplete__wrapper 29px (the textarea),
//   .rm-block-separator 116px (flex-grow), an unnamed div 24px (the "1").
// Rest text was .pxd-rs.pxd-item__string at (7, 6), 196px wide, 13px / 18.2px.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer, noteCaretAtPoint, pageCaretAtPoint } from "../src/view/cards.js";
import { editorCounterScale, restCounterScale } from "../src/view/editor-scale.js";
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
const NOTE = { ":x": 0, ":y": 0, ":w": 210, ":h": 80 };
const BLOCK = { ":x": 240, ":y": 0, ":w": 210, ":h": 80 };
const TASK = { ":x": 480, ":y": 0, ":w": 210, ":h": 80 };
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };
const TASK_STRING = "{{[[TODO]]}}Write";
const TASK_MARK = "{{[[TODO]]}}".length;

const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (css) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const clean = stripCss(css);
  while ((m = re.exec(clean))) out.push({ sel: m[1], body: m[2] });
  return out;
};

function harness() {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const placed = [];
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    renderBlock(el) {
      const input = doc.createElement("textarea");
      input.className = "rm-block__input";
      input.value = TASK_STRING;
      input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; };
      el.append(input);
      placed.push(input);
    },
    blockString: (uid) => (uid === "refuid01" ? "Block text" : null),
    pullTree: () => [],
    pullBoard: () => null,
    pageUid: (t) => `uid-${t}`,
    openBlock() {},
    openPage() {},
    watchPage() { return () => {}; },
    api: { ui: {} },
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later() { return () => {}; },
  };
  const r = createItemRenderer({
    doc, host, session: {}, itemsLayer, sectionsLayer, timers,
    bt: { available: () => true },
  });
  const board = buildBoard(rawBoard([
    blk("nt0000001", "Whatever the note", NOTE, 0),
    blk("bk0000001", "((refuid01))", BLOCK, 1),
    blk("tk0000001", TASK_STRING, TASK, 2),
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
    stub, doc, host, r, placed,
    noteUid: board.order[0],
    blockUid: board.order[1],
    taskUid: board.order[2],
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

test("G1: editor CSS hides the separator, ref slot, and bullet in card editors only", () => {
  const card = rules(readFileSync(new URL("../src/css/card-edit.css", import.meta.url), "utf8"));
  const page = rules(readFileSync(new URL("../src/css/page-edit.css", import.meta.url), "utf8"));
  const hides = (list, needle) => list.filter((rule) => rule.sel.includes(needle) && /display:\s*none/.test(rule.body));
  for (const needle of [".rm-block-separator", ".rm-block__ref-count", ".rm-block__controls"]) {
    const found = hides(card, needle);
    assert.ok(found.length > 0, needle);
    for (const rule of found) {
      assert.match(rule.sel, /\.pxd-item--editing/);
      assert.match(rule.sel, /:not\(\.pxd-item--page\)/);
      assert.equal(rule.sel.includes(".pxd-read"), false);
    }
  }
  const slot = hides(card, ".rm-block-separator ~ div");
  assert.equal(slot.length, 1);
  assert.match(slot[0].sel, /\.pxd-item--editing/);
  const inset = card.find((rule) => rule.sel.includes("[style*=\"--pxd-ed-z\"]"));
  assert.ok(inset);
  assert.match(inset.sel, /:not\(\.pxd-item--page\)/);
  assert.match(inset.sel, /:not\(\.pxd-item--text\)/);
  assert.match(inset.body, /left:\s*12px\s*!important/);
  assert.match(inset.body, /top:\s*10px\s*!important/);
  assert.match(inset.body, /width:\s*calc\(var\(--pxd-ed-z\) \* 100% - 24px \* var\(--pxd-ed-z\)\)\s*!important/);
  for (const rule of card) {
    if (rule.sel.includes("textarea") || rule.sel.includes(".rm-block__input")) {
      assert.equal(/transform\s*:/.test(rule.body), false, rule.sel);
    }
  }
  const pageSep = hides(page, ".rm-block-separator");
  assert.ok(pageSep.length > 0);
  for (const rule of pageSep) {
    assert.match(rule.sel, /\.pxd-item--page/);
    assert.match(rule.sel, /\.pxd-page-edit/);
    assert.equal(rule.sel.includes(".rm-block__controls"), false);
  }
  const pageText = readFileSync(new URL("../src/css/page-edit.css", import.meta.url), "utf8");
  assert.match(pageText, /width:\s*16px\s*!important/);
});

test("G1: editor counter-scale matches rest counter-scale at zoom 0.5, 1, and 2", () => {
  assert.equal(editorCounterScale(2).fontPx, 28);
  for (const z of [0.5, 1, 2]) {
    const rest = restCounterScale(z);
    const ed = editorCounterScale(z, 13);
    assert.equal(rest.screenFont, 13 * z);
    assert.equal(rest.screenLine, 13 * 1.4 * z);
    if (z === 1) {
      assert.equal(ed, null);
      assert.equal(rest.screenFont, 13);
    } else {
      assert.equal(ed.fontPx, rest.screenFont);
      assert.equal(ed.linePx, rest.screenLine);
      assert.equal(ed.transform, `scale(${1 / z})`);
    }
  }
});

test("G1: a note editor uses the body font, and the card box does not change", async () => {
  const h = harness();
  try {
    h.stub.theme["font-size"] = "13px";
    const card = h.shell(h.noteUid);
    const before = card.style.height;
    assert.equal(before, "80px");
    h.r.setZoom(0.5);
    assert.equal(await settle(h, h.r.enterEdit(h.noteUid)), true);
    assert.equal(card.style.height, before);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    const editor = card.querySelector(".pxd-item__editor");
    const scale = editorCounterScale(0.5, 13);
    const ta = editor.querySelector("textarea");
    assert.equal(editor.style.transform, scale.transform);
    assert.equal(editor.style.width, scale.width);
    assert.equal(editor.style.position, "absolute");
    assert.equal(ta.style["font-size"], `${scale.fontPx}px`);
    assert.equal(parseFloat(ta.style["line-height"]), scale.linePx);
    assert.equal(ta.style.transform || "", "");
    assert.equal(scale.fontPx, restCounterScale(0.5).screenFont);
    assert.equal(scale.linePx, restCounterScale(0.5).screenLine);

    h.r.setZoom(2);
    h.stub.flushFrames();
    const atTwo = editorCounterScale(2, 13);
    assert.equal(ta.style["font-size"], `${atTwo.fontPx}px`);
    assert.equal(parseFloat(ta.style["line-height"]), atTwo.linePx);
    assert.equal(atTwo.fontPx, restCounterScale(2).screenFont);
    assert.equal(card.style.height, before);

    h.r.setZoom(1);
    h.stub.flushFrames();
    assert.equal(editorCounterScale(1, 13), null);
    assert.equal(editor.style.transform || "", "");
    assert.equal(ta.style["font-size"] || "", "");
    assert.equal(ta.style["line-height"] || "", "");
    assert.equal(card.style.height, before);

    await h.r.exitEdit({ silent: true });
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.style.height, before);
    assert.equal(card.style.minHeight, "");

    const block = h.shell(h.blockUid);
    const blockH = block.style.height;
    assert.equal(await settle(h, h.r.enterEdit(h.blockUid)), true);
    assert.equal(block.style.height, blockH);
    await h.r.exitEdit({ silent: true });
    assert.equal(block.style.height, blockH);
    assert.equal(block.classList.contains("pxd-item--editing"), false);

    const task = h.shell(h.taskUid);
    const taskH = task.style.height;
    assert.equal(await settle(h, h.r.enterEdit(h.taskUid)), true);
    const taskTa = task.querySelector("textarea");
    assert.match(taskTa.value, /\{\{\[\[TODO\]\]\}\}/);
    assert.equal(task.style.height, taskH);
    await h.r.exitEdit({ silent: true });
    assert.equal(task.style.height, taskH);
    assert.equal(task.classList.contains("pxd-item--editing"), false);
  } finally { h.done(); }
});

test("G1: caret mapping reads the clicked character of a note", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const card = doc.createElement("div");
    card.setAttribute("data-uid", "6rN5tqjeD");
    const string = doc.createElement("div");
    string.className = "pxd-rs pxd-item__string";
    const text = doc.createTextNode("Whatever the note");
    string.append(text);
    const check = doc.createElement("span");
    check.className = "pxd-task-check";
    const box = doc.createTextNode("x");
    check.append(box);
    card.append(check, string);
    doc.body.append(card);
    doc.caretPositionFromPoint = () => ({ offsetNode: text, offset: 7 });
    assert.deepEqual(noteCaretAtPoint(doc, 20, 12), { uid: "6rN5tqjeD", offset: 7, task: false });
    doc.caretPositionFromPoint = undefined;
    doc.caretRangeFromPoint = () => ({ startContainer: text, startOffset: 3 });
    assert.deepEqual(noteCaretAtPoint(doc, 8, 8), { uid: "6rN5tqjeD", offset: 3, task: false });
    doc.caretRangeFromPoint = () => ({ startContainer: box, startOffset: 0 });
    assert.equal(noteCaretAtPoint(doc, 2, 2), null);
    assert.equal(noteCaretAtPoint(doc, Number.NaN, 1), null);
    const row = doc.createElement("div");
    row.setAttribute("data-pxd-row", "row0001");
    const rowText = doc.createTextNode("page row");
    row.append(rowText);
    doc.body.append(row);
    doc.caretRangeFromPoint = () => ({ startContainer: rowText, startOffset: 2 });
    assert.deepEqual(pageCaretAtPoint(doc, 4, 4), { row: "row0001", offset: 2 });
  } finally { restore(); }
});

test("G1: entering edit on a note or task lands the caret on that character", async () => {
  const h = harness();
  try {
    const card = h.shell(h.noteUid);
    const string = card.querySelector(".pxd-item__string");
    const text = h.doc.createTextNode("Whatever the note");
    string.replaceChildren(text);
    assert.equal(await settle(h, h.r.enterEdit(h.noteUid, { offset: 4 })), true);
    assert.equal(card.querySelector("textarea").selectionStart, 4);
    await h.r.exitEdit();

    const live = h.shell(h.noteUid).querySelector(".pxd-item__string");
    const again = h.doc.createTextNode("Whatever the note");
    live.replaceChildren(again);
    h.doc.caretPositionFromPoint = () => ({ offsetNode: again, offset: 7 });
    h.doc.defaultView = {
      event: { type: "dblclick", clientX: 20, clientY: 12, target: again },
      getComputedStyle: h.stub.getComputedStyle,
      MutationObserver: globalThis.MutationObserver,
      ResizeObserver: globalThis.ResizeObserver,
    };
    assert.equal(await settle(h, h.r.enterEdit(h.noteUid)), true);
    assert.equal(card.querySelector("textarea").selectionStart, 7);
    await h.r.exitEdit({ silent: true });

    const task = h.shell(h.taskUid);
    const taskText = task.querySelector(".pxd-item__tasktext");
    assert.ok(taskText, "the resting task title is the string without the marker");
    const visible = h.doc.createTextNode("Write");
    taskText.replaceChildren(visible);
    h.doc.caretPositionFromPoint = () => ({ offsetNode: visible, offset: 2 });
    h.doc.defaultView = {
      event: { type: "dblclick", clientX: 30, clientY: 14, target: visible },
      getComputedStyle: h.stub.getComputedStyle,
      MutationObserver: globalThis.MutationObserver,
      ResizeObserver: globalThis.ResizeObserver,
    };
    const taskH = task.style.height;
    assert.equal(await settle(h, h.r.enterEdit(h.taskUid)), true);
    assert.equal(task.querySelector("textarea").selectionStart, 2 + TASK_MARK);
    assert.match(task.querySelector("textarea").value, /\{\{\[\[TODO\]\]\}\}/);
    assert.equal(task.style.height, taskH);
    await h.r.exitEdit({ silent: true });
    assert.equal(task.style.height, taskH);
  } finally { h.done(); }
});
