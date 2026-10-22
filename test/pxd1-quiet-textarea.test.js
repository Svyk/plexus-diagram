// PXD-1: a Roam editor on the board keeps React's defaultValue writes off its text child (no child-list change a key).
import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createItemRenderer } from "../src/view/cards.js";
import { isRoamTextarea, quietTextarea } from "../src/view/quiet-textarea.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// Stands in for HTMLTextAreaElement's defaultValue: every write replaces the text child, as Blink does.
function nativeDefaultValue(ta, initial = "") {
  const log = { childWrites: 0 };
  let text = initial;
  Object.defineProperty(ta, "defaultValue", {
    configurable: true,
    get: () => text,
    set: (next) => { text = String(next); log.childWrites += 1; },
  });
  return log;
}

function roamTextarea(doc) {
  const ta = doc.createElement("textarea");
  ta.className = "rm-block-input rm-block__input";
  return ta;
}

test("PXD-1: a quieted Roam textarea takes React's defaultValue writes without touching its text child", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const ta = roamTextarea(stub.document);
    const log = nativeDefaultValue(ta, "seed");
    assert.equal(isRoamTextarea(ta), true);
    assert.equal(quietTextarea(ta), true);
    assert.equal(ta.defaultValue, "seed", "keeps the string it had");
    for (const s of ["seedq", "seedqz", "seedqzx"]) {
      if (ta.defaultValue !== s) ta.defaultValue = s;
    }
    assert.equal(log.childWrites, 0, "no write reached the text child");
    assert.equal(ta.defaultValue, "seedqzx", "reads give back the last write, so React sees it as done");
    assert.equal(quietTextarea(ta), false, "a second call does nothing");
    ta.defaultValue = "x";
    assert.equal(ta.defaultValue, "x");
    assert.equal(log.childWrites, 0);
  } finally {
    restore();
  }
});

test("PXD-1: only Roam block textareas are quieted", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const plain = stub.document.createElement("textarea");
    const log = nativeDefaultValue(plain);
    const div = stub.document.createElement("div");
    div.className = "rm-block-input";
    assert.equal(quietTextarea(plain), false);
    assert.equal(quietTextarea(div), false);
    assert.equal(quietTextarea(null), false);
    plain.defaultValue = "a";
    assert.equal(log.childWrites, 1, "a board text field keeps the native setter");
  } finally {
    restore();
  }
});

const blk = (uid, string, plexus, order) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": { ":plexus": plexus }, ":block/children": [] });
const STICKY = { ":type": "text", ":look": "sticky", ":x": 20, ":y": 30, ":w": 200, ":h": 160, ":color": "yellow" };
const NOTE = { ":type": "card", ":x": 300, ":y": 30, ":w": 240, ":h": 120 };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// The renderer's own entry points: a sticky's live block taking focus, and enterEdit on a note card.
function harness(flags) {
  const stub = createDomStub();
  const restore = stub.install();
  noteSpeedFlags(flags);
  const doc = stub.document;
  const host = {
    renderString(node, string) { node.textContent = string; },
    renderBlock(node, uid) {
      const ta = roamTextarea(doc);
      ta.id = `block-input-u-body-outline-p-${uid}`;
      ta.classList.add("rm-block__input");
      node.append(ta);
    },
    unmount() {}, renderPage() {}, blockString: () => null, pullTree: () => [], pullBoard: () => null,
    pageOutline: () => ({ exists: false, blocks: [] }), pageUid: () => null, openPage() {}, watchPage: () => () => {},
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later(fn, ms) { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    frame(fn) { const t = setTimeout(fn, 0); return () => clearTimeout(t); },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Typing}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [blk("st000001", "sticky", STICKY, 0), blk("nt000001", "note", NOTE, 1)] });
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -1e4, y: -1e4, w: 2e4, h: 2e4 }, zoom: 1, tier: "detail" });
  for (let i = 0; i < 400 && idleQueue.length; i += 1) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  return {
    stub, doc, r,
    shell: (uid) => r.shellOf(uid),
    done() { r.dispose(); noteSpeedFlags(null); restore(); },
  };
}

async function stickyTyping(flags) {
  const h = harness(flags);
  try {
    const editor = h.shell("st000001").querySelector(".pxd-item__editor--sticky");
    const ta = editor.querySelector("textarea");
    const log = nativeDefaultValue(ta);
    ta.focus();
    h.stub.dispatch(ta, "focusin", {});
    assert.equal(h.r.editingUid(), "st000001");
    let s = "";
    for (const ch of "qzxvw") { s += ch; if (ta.defaultValue !== s) ta.defaultValue = s; }
    return { writes: log.childWrites, value: ta.defaultValue };
  } finally { h.done(); }
}

async function noteTyping(flags) {
  const h = harness(flags);
  try {
    const editing = h.r.enterEdit("nt000001");
    let ta = null;
    for (let i = 0; i < 200 && !ta; i += 1) { await tick(1); ta = h.shell("nt000001").querySelector("textarea.rm-block-input"); }
    assert.ok(ta, "Roam's input mounted in the card editor");
    const log = nativeDefaultValue(ta);
    ta.focus();
    h.stub.dispatch(ta, "focusin", {});
    let s = "";
    for (const ch of "qzxvw") { s += ch; if (ta.defaultValue !== s) ta.defaultValue = s; }
    const out = { writes: log.childWrites, value: ta.defaultValue, editing: h.r.editingUid() };
    await Promise.race([editing, tick(400)]);
    return out;
  } finally { h.done(); }
}

test("PXD-1: typing in a sticky's live block makes no text-child writes", async () => {
  const on = await stickyTyping(null);
  assert.equal(on.writes, 0);
  assert.equal(on.value, "qzxvw");
});

test("PXD-1: typing in a note card's editor makes no text-child writes", async () => {
  const on = await noteTyping(null);
  assert.equal(on.editing, "nt000001");
  assert.equal(on.writes, 0);
  assert.equal(on.value, "qzxvw");
});

test("PXD-1: quietTextarea off leaves React's writes on the text child, one per key, in both editors", async () => {
  assert.equal((await stickyTyping({ quietTextarea: false })).writes, 5);
  assert.equal((await noteTyping({ quietTextarea: false })).writes, 5);
});
