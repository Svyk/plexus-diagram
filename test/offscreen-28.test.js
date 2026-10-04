import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import {
  UNMOUNT_GRACE_MS,
  boardKeyIsOutside,
  intrinsicSize,
  rectMisses,
  shellOffscreen,
  unmountDue,
} from "../src/view/offscreen.js";

const el = (root) => ({ closest: (sel) => (sel === ".pxd-root" ? root : null) });

test("a key outside the board with nothing selected does not enter the board", () => {
  assert.equal(boardKeyIsOutside(el(null), false), true);
  assert.equal(boardKeyIsOutside(el({}), false), false);
  assert.equal(boardKeyIsOutside(el(null), true), false);
  assert.equal(boardKeyIsOutside(null, false), false);
  assert.equal(boardKeyIsOutside({}, false), false);
});

test("a card outside the camera plus margin is a shell, and an editing card is not", () => {
  const view = { x: 0, y: 0, w: 800, h: 600 };
  assert.equal(rectMisses({ x: 900, y: 0, w: 100, h: 80 }, view), true);
  assert.equal(rectMisses({ x: 700, y: 0, w: 100, h: 80 }, view), false);
  assert.equal(shellOffscreen("card", { x: 900, y: 0, w: 100, h: 80 }, view), true);
  assert.equal(shellOffscreen("card", { x: 900, y: 0, w: 100, h: 80 }, view, { editingUid: "card" }), false);
  assert.equal(shellOffscreen("card", null, view), false);
});

test("intrinsic size is the model size in whole pixels", () => {
  assert.equal(intrinsicSize({ w: 200.4, h: 79.6 }), "200px 80px");
  assert.equal(intrinsicSize(null), "0px 0px");
});

test("a Roam body unmounts after the grace and not before", () => {
  assert.equal(UNMOUNT_GRACE_MS, 10000);
  assert.equal(unmountDue(0, 9999), false);
  assert.equal(unmountDue(0, 10000), true);
  assert.equal(unmountDue(Number.NaN, 10000), false);
});

test("scheduleContent marks a card outside the camera and leaves the one on screen", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const later = [];
    const idleQueue = [];
    const timers = {
      idle(fn) {
        idleQueue.push(fn);
        return () => {
          const i = idleQueue.indexOf(fn);
          if (i >= 0) idleQueue.splice(i, 1);
        };
      },
      later(fn, ms) { later.push({ fn, ms }); return () => {}; },
    };
    const flush = () => {
      let guard = 0;
      while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
    };
    const host = {
      renderString(node, string) { node.textContent = string; },
      unmount() {},
      blockString: () => null,
      pullTree: () => [],
      pullBoard: () => null,
      pagePreview: () => ({ exists: false, blocks: [] }),
    };
    const raw = {
      ":block/uid": "board0001",
      ":block/string": "{{[[diagram]]:Test}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [
        { ":block/uid": "cardNEAR1", ":block/string": "Near", ":block/order": 0, ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } }, ":block/children": [] },
        { ":block/uid": "cardFAR02", ":block/string": "Far", ":block/order": 1, ":block/props": { ":plexus": { ":x": 5000, ":y": 0, ":w": 180, ":h": 90 } }, ":block/children": [] },
      ],
    };
    const board = buildBoard(raw);
    const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
    r.sync({ board, rects: worldRects(board), structural: true });
    r.scheduleContent({ visibleRect: { x: 0, y: 0, w: 6000, h: 800 }, zoom: 1, tier: "detail" });
    flush();
    r.scheduleContent({ visibleRect: { x: 0, y: 0, w: 1000, h: 800 }, zoom: 1, tier: "detail" });
    const near = itemsLayer.querySelector("[data-uid=cardNEAR1]");
    const far = itemsLayer.querySelector("[data-uid=cardFAR02]");
    assert.ok(near && far);
    assert.equal(near.classList.contains("pxd-item--offscreen"), false);
    assert.equal(far.classList.contains("pxd-item--offscreen"), true);
    assert.equal(far.style["--pxd-iw"], "180px");
    assert.equal(far.style["--pxd-ih"], "90px");
    r.scheduleContent({ visibleRect: { x: 0, y: 0, w: 6000, h: 800 }, zoom: 1, tier: "detail" });
    assert.equal(far.classList.contains("pxd-item--offscreen"), false);
    assert.ok(later.some((entry) => entry.ms === UNMOUNT_GRACE_MS));
  } finally {
    restore();
  }
});
