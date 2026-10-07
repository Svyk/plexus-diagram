// U2: page-card edit keeps the rest geometry, and the caret lands in the clicked row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer, pageCaretAtPoint, pageEditWindowId } from "../src/view/cards.js";
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
const PAGE = { ":x": 0, ":y": 0, ":w": 354, ":h": 160 };
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };

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
    api: { ui: { setBlockFocusAndSelection() {} } },
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later(fn) { return () => {}; },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard([blk("pg0000001", "[[Alpha]]", PAGE, 0)]));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1.5, tier: "detail" });
  flush();
  return {
    stub, doc, host, r,
    uid: board.order[0],
    shell: () => r.shellOf(board.order[0]),
    done() { r.dispose(); restore(); },
  };
}

async function until(stub, pred) {
  for (let i = 0; i < 20 && !pred(); i += 1) {
    stub.flushFrames();
    await Promise.resolve();
    await Promise.resolve();
  }
}

test("U2: caret mapping picks the clicked row and character", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const row1 = doc.createElement("div");
    row1.setAttribute("data-pxd-row", "TPLLP8OYe");
    row1.append(doc.createTextNode("first row text"));
    const row9 = doc.createElement("div");
    row9.setAttribute("data-pxd-row", "5oj-FaMZC");
    const text = doc.createTextNode("infant botulism");
    row9.append(text);
    doc.body.append(row1, row9);
    doc.caretPositionFromPoint = () => ({ offsetNode: text, offset: 7 });
    assert.deepEqual(pageCaretAtPoint(doc, 40, 180), { row: "5oj-FaMZC", offset: 7 });
    doc.caretPositionFromPoint = undefined;
    doc.caretRangeFromPoint = () => ({ startContainer: text, startOffset: 3 });
    assert.deepEqual(pageCaretAtPoint(doc, 12, 40), { row: "5oj-FaMZC", offset: 3 });
    assert.equal(pageCaretAtPoint(doc, Number.NaN, 1), null);
    const editor = doc.createElement("div");
    const input = doc.createElement("textarea");
    input.className = "rm-block__input";
    input.id = "block-input-card-body-outline-uid-Alpha-5oj-FaMZC";
    editor.append(input);
    assert.equal(pageEditWindowId(editor), "card");
    const bare = doc.createElement("div");
    const other = doc.createElement("textarea");
    other.id = "block-input-body-TPLLP8OYe";
    other.className = "rm-block__input";
    bare.append(other);
    bare.setAttribute("data-window-id", "sidebar");
    assert.equal(pageEditWindowId(bare), "sidebar");
  } finally { restore(); }
});

test("U2: a single click on a selected page card edits that row at that character", async () => {
  const blocks = tree(9);
  const h = harness({ pageBlocks: blocks });
  try {
    const target = blocks[8].uid;
    const first = blocks[0].uid;
    const card = h.shell();
    card.style.height = "160px";
    const row = card.querySelector(`[data-pxd-row="${target}"]`);
    assert.ok(row, "row 9 is on the card");
    const text = h.doc.createTextNode("0123456789");
    row.replaceChildren(text);
    h.doc.caretPositionFromPoint = () => ({ offsetNode: text, offset: 4 });
    assert.deepEqual(pageCaretAtPoint(h.doc, 20, 30), { row: target, offset: 4 });
    const focusCalls = [];
    let focused = null;
    h.host.api.ui.setBlockFocusAndSelection = (arg) => {
      focusCalls.push(arg);
      const editor = card.querySelector(".pxd-page-edit");
      if (editor) editor.scrollTop = 80;
    };
    h.host.renderPage = (el) => {
      for (const block of blocks) {
        const input = h.doc.createElement("textarea");
        input.className = "rm-block__input";
        input.id = `block-input-card-body-outline-uid-Alpha-${block.uid}`;
        input.focus = () => { focused = input; };
        input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; };
        el.append(input);
      }
    };
    h.r.setSelection([h.uid]);
    row.dispatchEvent({ type: "pointerdown", clientX: 20, clientY: 30, button: 0 });
    row.dispatchEvent({ type: "pointerup", clientX: 22, clientY: 31, button: 0 });
    await until(h.stub, () => focusCalls.length > 0 && focused);
    assert.equal(focusCalls.length, 1);
    assert.equal(focusCalls[0].location["block-uid"], target);
    assert.equal(focusCalls[0].location["window-id"], "card");
    assert.deepEqual(focusCalls[0].selection, { start: 4, end: 4 });
    assert.equal(focused.id.endsWith(`-${target}`), true);
    assert.equal(focused.id.endsWith(`-${first}`), false);
    assert.equal(focused.selectionStart, 4);
    assert.equal(card.style.height, "160px");
    assert.equal(card.querySelector(".pxd-page-edit").scrollTop, 0);
    await h.r.exitEdit({ silent: true });
    assert.equal(card.style.height, "160px");
    assert.equal(card.classList.contains("pxd-item--editing"), false);
  } finally { h.done(); }
});

test("U2: enterEdit with no row still uses the caret measured on pointerdown", async () => {
  const blocks = tree(9);
  const h = harness({ pageBlocks: blocks });
  try {
    const target = blocks[8].uid;
    const card = h.shell();
    const row = card.querySelector(`[data-pxd-row="${target}"]`);
    const text = h.doc.createTextNode("0123456789");
    row.replaceChildren(text);
    h.doc.caretPositionFromPoint = () => ({ offsetNode: text, offset: 8 });
    const focusCalls = [];
    let focused = null;
    h.host.api.ui.setBlockFocusAndSelection = (arg) => { focusCalls.push(arg); };
    h.host.renderPage = (el) => {
      for (const block of blocks) {
        const input = h.doc.createElement("textarea");
        input.className = "rm-block__input";
        input.id = `block-input-card-body-outline-uid-Alpha-${block.uid}`;
        input.focus = () => { focused = input; };
        input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; };
        el.append(input);
      }
    };
    row.dispatchEvent({ type: "pointerdown", clientX: 20, clientY: 30, button: 0 });
    const pending = h.r.enterEdit(h.uid);
    await until(h.stub, () => focusCalls.length > 0 && focused);
    await pending;
    assert.equal(focusCalls[0].location["block-uid"], target);
    assert.equal(focusCalls[0].selection.start, 8);
    assert.equal(focused.id.endsWith(`-${target}`), true);
    assert.equal(focused.id.endsWith(`-${blocks[0].uid}`), false);
    await h.r.exitEdit({ silent: true });
  } finally { h.done(); }
});

test("U2: edit rules use the rest row's left edge, width, and line-height", () => {
  const edit = readFileSync(new URL("../src/css/page-edit.css", import.meta.url), "utf8");
  const rest = readFileSync(new URL("../src/css/page-card.css", import.meta.url), "utf8");
  const base = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(rest, /\.pxd-block__text:first-child \{[^}]*margin-left:\s*16px/);
  assert.match(rest, /\.pxd-block__text \{[^}]*flex:\s*1 1 auto/);
  assert.match(rest, /\.pxd-block__plain \{[^}]*white-space:\s*pre-wrap/);
  assert.match(rest, /\.pxd-block__plain \{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(base, /\.pxd-item__body \{[^}]*font-size:\s*13px/);
  assert.match(base, /\.pxd-block \{[^}]*margin:\s*2px 0/);
  assert.match(base, /\.pxd-block__children \{[^}]*margin-left:\s*12px/);
  assert.match(base, /\.pxd-block__children \{[^}]*padding-left:\s*6px/);
  assert.match(edit, /padding:\s*0 0 0 16px !important/);
  assert.match(edit, /width:\s*100% !important/);
  assert.match(edit, /flex:\s*1 1 auto/);
  assert.match(edit, /font-size:\s*13px !important/);
  assert.match(edit, /line-height:\s*19\.5px !important/);
  assert.match(edit, /min-height:\s*22px !important/);
  assert.match(edit, /white-space:\s*pre-wrap/);
  assert.match(edit, /overflow-wrap:\s*anywhere/);
  assert.match(edit, /\.rm-block-children \.rm-block-children \{[^}]*margin-left:\s*12px/);
  assert.match(edit, /\.rm-block-children \.rm-block-children \{[^}]*padding-left:\s*6px/);
  assert.match(edit, /\.roam-block-container\.rm-block \{[^}]*margin:\s*1px 0 !important/);
  assert.match(edit, /width:\s*16px !important/);
});

test("U2: an empty tab strip is hidden and the bar token is opaque in light and dark", () => {
  const tabs = readFileSync(new URL("../src/css/tabs.css", import.meta.url), "utf8");
  const ext = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const chrome = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8");
  assert.match(tabs, /\.pxd-fstabs:empty \{[^}]*display:\s*none/);
  assert.match(tabs, /:not\(:has\(\.pxd-fstab\)\)[^{]*\{[^}]*margin-top:\s*0/);
  assert.match(tabs, /\.pxd-fstabs \{[^}]*background:\s*var\(--pxd-bar-bg\)/);
  assert.match(ext, /\.pxd-root \{[^}]*--pxd-bar-bg:\s*var\(--pxd-card\)/);
  assert.match(ext, /\.pxd-root--dark \{[^}]*--pxd-bar-bg:\s*var\(--pxd-card\)/);
  assert.match(ext, /prefers-color-scheme:\s*dark\)[\s\S]*?--pxd-bar-bg:\s*var\(--pxd-card\)/);
  assert.match(ext, /\.pxd-toolbar \{[^}]*background:\s*var\(--pxd-bar-bg\)/);
  assert.match(chrome, /\.pxd-root\.pxd-root \.pxd-toolbar \{[^}]*background:\s*var\(--pxd-bar-bg\)/);
  assert.match(chrome, /\.pxd-legend \.pxd-legend__row \{[^}]*background:\s*var\(--pxd-bar-bg\)/);
  assert.match(chrome, /\.pxd-root\.pxd-root \.pxd-props \{[^}]*background:\s*var\(--pxd-bar-bg\)/);
  assert.equal(chrome.includes("color-mix(in srgb, var(--pxd-chrome-bg) 92%, transparent)"), false);
});
