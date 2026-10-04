import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
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

const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };
const CARD = { ":x": 0, ":y": 0, ":w": 280, ":h": 160 };

function harness({ children, hostOverrides = {}, rendererOptions = {}, theme = {}, dark = false } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  Object.assign(stub.theme, theme);
  const doc = stub.document;
  const calls = { renderString: [], prime: 0 };
  const host = {
    renderString(node, string) { calls.renderString.push(string); node.textContent = string; },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
    ...hostOverrides,
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  if (dark) root.classList.add("pxd-root--dark");
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later() { return () => {}; },
  };
  const r = createItemRenderer({
    doc,
    host,
    session: {},
    itemsLayer,
    sectionsLayer,
    timers,
    ...rendererOptions,
  });
  let board = null;
  const load = (raw, { dirty = null, structural = true } = {}) => {
    board = buildBoard(raw);
    r.sync({ board, rects: worldRects(board), dirty, structural });
    return board;
  };
  load(rawBoard(children));
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10, didTimeout: false });
  };
  const show = (tier = "detail", zoom = tier === "detail" ? 1 : 0.3) => {
    r.setLod(tier, zoom);
    r.scheduleContent({ visibleRect: visible, zoom, tier });
    flush();
  };
  return {
    stub, doc, host, calls, r, root, load, flush, show,
    get board() { return board; },
    shell: (uid) => r.shellOf(uid),
    done() { r.dispose(); restore(); },
  };
}

test("a task card with Better Tasks integration off does not call bt.prime or draw .pxd-task-check", () => {
  let primed = 0;
  const bt = {
    available() { return false; },
    prime() { primed += 1; return Promise.resolve(null); },
    modify() { return { ok: false, reason: "unavailable" }; },
  };
  const h = harness({
    children: [blk("task00001", "{{[[TODO]]}} ship", CARD, 0)],
    rendererOptions: { bt },
  });
  try {
    h.r.setTaskChips("none");
    h.show("detail");
    assert.equal(primed, 0);
    assert.equal(h.shell("task00001").querySelector(".pxd-task-check"), null);
    assert.ok(h.calls.renderString.includes("{{[[TODO]]}} ship"));
    assert.equal(h.root.classList.contains("pxd-hl"), false);
  } finally {
    h.done();
  }
});

test("a #bg-blue string sets --pxd-fill from the body probe", () => {
  const light = harness({
    theme: { "--cl-lh-blue": "#1478c8", "--cl-dk-blue": "#0254a0" },
    children: [blk("cardBLUE1", "#bg-blue text", CARD, 0)],
  });
  try {
    light.show("detail");
    const card = light.shell("cardBLUE1");
    assert.equal(card.style["--pxd-fill"], "#1478c8");
    const chip = card.querySelector(".pxd-hl-chip");
    assert.ok(chip);
    assert.equal(chip.querySelector(".pxd-hl-name").textContent, "blue");
    assert.equal(chip.querySelector(".pxd-hl-swatch").style.background, "#1478c8");
    assert.equal(light.root.classList.contains("pxd-hl"), true);
  } finally {
    light.done();
  }

  const dark = harness({
    theme: { "--cl-lh-blue": "#1478c8", "--cl-dk-blue": "#0254a0" },
    dark: true,
    children: [blk("cardBLUE1", "#bg-blue text", CARD, 0)],
  });
  try {
    dark.show("detail");
    assert.equal(dark.shell("cardBLUE1").style["--pxd-fill"], "#0254a0");
    assert.equal(dark.root.classList.contains("pxd-hl"), true);
  } finally {
    dark.done();
  }
});

test("a props fill wins over a #bg-blue tag", () => {
  const h = harness({
    theme: { "--cl-lh-blue": "#1478c8" },
    children: [blk("cardFILL1", "#bg-blue text", { ...CARD, ":fill": "#aabbcc" }, 0)],
  });
  try {
    h.show("detail");
    const card = h.shell("cardFILL1");
    assert.equal(card.style["--pxd-fill"], "#aabbcc");
    assert.equal(card.querySelector(".pxd-hl-chip"), null);
    assert.equal(h.root.classList.contains("pxd-hl"), true);
  } finally {
    h.done();
  }
});
