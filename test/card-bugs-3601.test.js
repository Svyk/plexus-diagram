// New-card typing delay and the far-away context menu (fix/card-bugs).
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createMenu } from "../src/view/menu.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const R = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top });

function menuSetup({ root: rr = R(0, 0, 1000, 800), win = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  if (win) { doc.defaultView.innerWidth = win.w; doc.defaultView.innerHeight = win.h; }
  const root = doc.createElement("div");
  root.className = "pxd-root";
  root._rect = rr;
  doc.body.append(root);
  return { stub, doc, root, restore };
}
const spot = (menu) => ({ left: Number.parseInt(menu.el.style.left, 10), top: Number.parseInt(menu.el.style.top, 10) });
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, label: `Item ${i}` }));

test("a menu opened low on the board with chrome beside it stays at the pointer, not across the board", () => {
  const f = menuSetup();
  try {
    const dock = f.doc.createElement("div");
    dock.className = "pxd-dock pxd-chrome";
    dock._rect = R(60, 740, 940, 790);
    f.root.append(dock);
    const rail = f.doc.createElement("div");
    rail.className = "pxd-panel";
    rail._rect = R(700, 0, 1000, 800);
    f.root.append(rail);
    const menu = createMenu({ doc: f.doc, root: f.root, on: {} });
    // 20 rows x 28 = 560 px, taller than the free strip: the old placer jumped to the far side of the panel.
    assert.equal(menu.open({ x: 150, y: 600, items: items(20) }), true);
    const at = spot(menu);
    assert.ok(Math.abs(at.left - 150) <= 120 && at.left <= 150 + 4, `left ${at.left} near the pointer`);
    assert.ok(at.top >= 4 && at.top + 560 <= 800 - 4, `top ${at.top} on the board`);
    assert.ok(Math.abs(at.top + 560 - 600) < 560, "flipped above the pointer");
    menu.dispose();
  } finally { f.restore(); }
});

test("a board taller than the window keeps the menu inside the visible part, flipping up at the pointer", () => {
  const f = menuSetup({ root: R(0, -400, 1000, 1400), win: { w: 1000, h: 800 } });
  try {
    const menu = createMenu({ doc: f.doc, root: f.root, on: {} });
    menu.open({ x: 500, y: 780, items: items(12) });
    const at = spot(menu);
    const viewportTop = at.top - 400;
    assert.ok(viewportTop + 336 <= 800 - 4, `bottom ${viewportTop + 336} inside the window`);
    assert.ok(viewportTop >= 4);
    assert.ok(Math.abs(viewportTop + 336 - 780) <= 8, "flipped so the bottom edge meets the pointer");
    menu.dispose();
  } finally { f.restore(); }
});

test("a menu near the right edge flips left of the pointer", () => {
  const f = menuSetup();
  try {
    const menu = createMenu({ doc: f.doc, root: f.root, on: {} });
    menu.open({ x: 990, y: 100, items: items(5) });
    assert.ok(spot(menu).left + 200 <= 990 + 1, "right edge at the pointer");
    menu.dispose();
  } finally { f.restore(); }
});

// ------------------------------------------------------------------ new card focus
const blk = (uid, string, plexus, order) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": { ":plexus": plexus }, ":block/children": [] });

test("a new card focuses its input on the first frame, before Roam's hydrate wait, and keeps that focus", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const focuses = [];
    let frame = 0;
    const host = {
      renderString(node, s) { node.textContent = s; },
      unmount() {},
      renderBlock(el) {
        // Roam mounts the textarea one frame after renderBlock returns.
        stub.window.requestAnimationFrame(() => {
          const input = doc.createElement("textarea");
          input.className = "rm-block__input";
          input.value = "";
          input.focus = () => { focuses.push(frame); doc.activeElement = input; };
          el.append(input);
        });
      },
      blockString: () => "",
      pullTree: () => [],
      pullBoard: () => null,
      pageUid: (t) => `uid-${t}`,
      openBlock() {}, openPage() {}, watchPage() { return () => {}; },
      api: { ui: {} },
    };
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers: { idle() { return () => {}; }, later() { return () => {}; } }, bt: { available: () => false } });
    const board = buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:T}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [blk("nt0000001", "", { ":x": 0, ":y": 0, ":w": 210, ":h": 80 }, 0)] });
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    const uid = board.order[0];
    const p = r.enterEdit(uid);
    let done = false;
    p.then(() => { done = true; });
    for (let i = 0; i < 60 && !done; i += 1) {
      frame += 1;
      stub.flushFrames();
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    assert.equal(done, true);
    assert.ok(focuses.length >= 1, "focused");
    assert.ok(focuses[0] <= 2, `first focus on frame ${focuses[0]}, not after the quiet wait`);
    assert.equal(focuses.length, 1, "focus is taken once, so the input is never re-clicked under the user's typing");
    r.dispose();
  } finally { restore(); }
});
