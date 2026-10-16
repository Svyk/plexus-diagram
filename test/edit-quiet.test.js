// A1. While one card is in edit, sibling live roots on that board are unmounted.
// A key does not call renderString on them. Exit mounts them once. Another board is left alone.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const blk = (uid, string, order) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": { ":plexus": { ":x": order * 220, ":y": 0, ":w": 200, ":h": 80 } },
  ":block/children": [],
});
const rawBoard = (uid, children) => ({
  ":block/uid": uid,
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };

function renderer(stub, doc, uid, strings) {
  const calls = { siblingString: 0, siblingBlock: 0 };
  const own = new Set();
  const host = {
    connected: new Set(),
    renderString(node, string) {
      host.connected.add(node);
      const id = node.closest?.("[data-uid]")?.getAttribute?.("data-uid") || "";
      if (!own.has(id)) calls.siblingString += 1;
      node.textContent = string;
    },
    unmount(node) { if (node) host.connected.delete(node); },
    renderBlock(el) {
      const id = el.closest?.("[data-uid]")?.getAttribute?.("data-uid") || "";
      if (!own.has(id)) calls.siblingBlock += 1;
      const input = doc.createElement("textarea");
      input.className = "rm-block__input";
      input.value = "Alpha";
      input.setSelectionRange = () => {};
      el.append(input);
    },
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageUid: (title) => `uid-${title}`,
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
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later() { return () => {}; },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard(uid, strings.map((string, i) => blk(`${uid.slice(0, 4)}${i}`, string, i))));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 80) idleQueue.shift()({ timeRemaining: () => 50, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  flush();
  own.add(board.order[0]);
  return { r, host, calls, flush, itemsLayer, uids: board.order.slice() };
}

function harness() {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const a = renderer(stub, doc, "boardA001", ["Alpha", "Beta", "Gamma"]);
  const b = renderer(stub, doc, "boardB001", ["Delta", "Epsilon"]);
  return {
    stub, doc, a, b,
    done() { a.r.dispose(); b.r.dispose(); restore(); noteSpeedFlags(null); },
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

// Roam re-renders every still-connected renderString root when a block writes.
function roamRerender(root, host) {
  const lives = [...root.querySelectorAll(".pxd-rs__live")].filter((node) => host.connected?.has(node) && !node.closest(".pxd-item--editing"));
  for (const live of lives) host.renderString(live, live.textContent || "");
  return lives.length;
}

test("a key inside the editing card does not re-render sibling roots, and exit restores them once", async () => {
  const h = harness();
  try {
    const [editUid, beta, gamma] = h.a.uids;
    assert.ok(h.a.itemsLayer.querySelector(".pxd-rs__live"));
    const entered = await settle(h, h.a.r.enterEdit(editUid));
    assert.equal(entered, true);
    assert.equal(h.a.r.editingUid(), editUid);
    const shell = h.a.r.shellOf(editUid);
    const input = shell.querySelector("textarea");
    assert.ok(input);
    h.a.calls.siblingString = 0;
    h.a.calls.siblingBlock = 0;
    h.stub.dispatch(input, "keydown", { key: "a" });
    const liveSiblings = roamRerender(h.a.itemsLayer, h.a.host);
    assert.equal(liveSiblings, 0);
    assert.equal(h.a.calls.siblingString, 0);
    assert.equal(h.a.calls.siblingBlock, 0);
    assert.ok(h.a.r.shellOf(beta).querySelector(".pxd-quiet"));
    assert.ok(h.a.r.shellOf(gamma).querySelector(".pxd-quiet"));
    const held = h.a.calls.siblingString;
    h.a.r.quiet(false);
    h.a.flush();
    assert.equal(h.a.calls.siblingString, held);
    assert.equal([...h.a.r.shellOf(beta).querySelectorAll(".pxd-rs__live")].some((node) => h.a.host.connected.has(node)), false);
    await settle(h, h.a.r.exitEdit());
    h.a.flush();
    assert.equal(h.a.calls.siblingString - held, 2);
    const after = h.a.calls.siblingString;
    h.a.flush();
    assert.equal(h.a.calls.siblingString, after);
    assert.ok(h.a.r.shellOf(beta).querySelector(".pxd-rs__live"));
    assert.ok(h.a.r.shellOf(gamma).querySelector(".pxd-rs__live"));
    assert.equal(h.a.r.editingUid(), null);
  } finally {
    h.done();
  }
});

test("editing a card on one board leaves the other board's live roots mounted", async () => {
  const h = harness();
  try {
    const before = h.b.calls.siblingString;
    const lives = h.b.itemsLayer.querySelectorAll(".pxd-rs__live").length;
    assert.ok(lives > 0);
    const entered = await settle(h, h.a.r.enterEdit(h.a.uids[0]));
    assert.equal(entered, true);
    assert.equal(h.b.itemsLayer.querySelectorAll(".pxd-rs__live").length, lives);
    assert.equal(h.b.itemsLayer.querySelector(".pxd-quiet"), null);
    assert.equal(h.b.calls.siblingString, before);
    h.stub.dispatch(h.a.r.shellOf(h.a.uids[0]).querySelector("textarea"), "keydown", { key: "b" });
    roamRerender(h.a.itemsLayer, h.a.host);
    assert.equal(h.b.calls.siblingString, before);
  } finally {
    h.done();
  }
});

test("editQuiet off keeps sibling roots live while a card is edited", async () => {
  noteSpeedFlags({ editQuiet: false });
  const h = harness();
  try {
    const entered = await settle(h, h.a.r.enterEdit(h.a.uids[0]));
    assert.equal(entered, true);
    h.a.calls.siblingString = 0;
    const liveSiblings = roamRerender(h.a.itemsLayer, h.a.host);
    assert.ok(liveSiblings >= 2);
    assert.equal(h.a.calls.siblingString, liveSiblings);
    assert.equal(h.a.r.shellOf(h.a.uids[1]).querySelector(".pxd-quiet"), null);
  } finally {
    h.done();
  }
});
