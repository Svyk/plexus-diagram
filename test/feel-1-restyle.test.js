// FEEL-1: interactions stop restyling the whole board (data-* root flags, ancestor custom property shield,
// wheel zoom as a gesture, table grids released at map tier).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createInteractions } from "../src/view/interactions.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { sourceCss } from "./css-source.js";

const css = sourceCss();

// ---------------------------------------------------------------- CSS shield
test("the board root declares every Reference Path custom property so ancestor writes stop there", () => {
  const names = ["box-height", "box-width", "brackets-color", "bullet-color", "bullet-scale-factor", "line-color", "line-left-offset", "line-roundness", "line-style", "line-top-offset", "line-width", "link-color"];
  const rule = /\.pxd-root \{([^}]*--roam-reference-path-[^}]*)\}/.exec(css);
  assert.ok(rule, "a .pxd-root rule carries the shield");
  for (const name of names) assert.match(rule[1], new RegExp(`--roam-reference-path-${name}: initial;`), name);
});

test("no board CSS keys on the old runtime root classes", () => {
  assert.doesNotMatch(css, /pxd-root--(gesturing|zooming|editing|panel-open)|pxd-lod-(map|overview)/);
});

// ---------------------------------------------------------------- wheel zoom
function wheelHarness() {
  const calls = [];
  const a = {
    board: () => null,
    rects: () => new Map(),
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: (v) => calls.push(["vp", v]),
    setGesturing: (on, info) => calls.push(["gesturing", on, info]),
  };
  const ctl = createInteractions({ actions: a, settings: {} });
  const wheel = (extra = {}) => ctl.handle({ type: "wheel", screen: { x: 100, y: 100 }, target: { kind: "empty" }, deltaX: 0, deltaY: -40, ...extra });
  const gest = () => calls.filter((c) => c[0] === "gesturing");
  return { ctl, calls, wheel, gest };
}

test("a burst of ctrl-wheel ticks is one gesture that ends 160 ms after the last tick with moved:false", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = wheelHarness();
  for (let i = 0; i < 6; i += 1) {
    h.wheel({ ctrl: true });
    if (i < 5) t.mock.timers.tick(50);
  }
  assert.deepEqual(h.gest(), [["gesturing", true, { wheelZoom: true }]]);
  assert.equal(h.calls.filter((c) => c[0] === "vp").length, 6);
  t.mock.timers.tick(159);
  assert.equal(h.gest().length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(h.gest(), [["gesturing", true, { wheelZoom: true }], ["gesturing", false, { moved: false }]]);
});

test("a pointerdown during a wheel-zoom burst ends it first and leaves no stuck timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = wheelHarness();
  h.wheel({ ctrl: true });
  h.wheel({ ctrl: true });
  h.ctl.handle({ type: "pointerdown", button: 0, screen: { x: 5, y: 5 }, world: { x: 5, y: 5 }, target: { kind: "empty" }, pointerId: 1, isPrimary: true });
  const g = h.gest();
  assert.deepEqual(g[0], ["gesturing", true, { wheelZoom: true }]);
  assert.deepEqual(g[1], ["gesturing", false, { moved: false }], "the wheel gesture ends before the press starts its own");
  const before = h.gest().length;
  t.mock.timers.tick(1000);
  assert.equal(h.gest().filter((c) => c[1] === false).length, g.filter((c) => c[1] === false).length, "the old timer fired nothing");
  assert.ok(h.gest().length >= before);
});

test("plain wheel pan and the zoom-free wheel never set gesturing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = wheelHarness();
  for (let i = 0; i < 4; i += 1) h.wheel({ deltaX: 3, deltaY: 9 });
  t.mock.timers.tick(500);
  assert.deepEqual(h.gest(), []);
  assert.equal(h.calls.filter((c) => c[0] === "vp").length, 4);
});

// ---------------------------------------------------------------- table grids at map tier
const blk = (uid, string, plexus, order) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": plexus ? { ":plexus": plexus } : {}, ":block/children": [] });

function tableHarness({ thumb }) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const host = {
    renderString(node, string) {
      if (/table/.test(string)) {
        const grid = doc.createElement("div");
        grid.className = "pxd-roam-table pxd-live-grid";
        node.append(grid);
      } else node.textContent = string;
    },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const timers = { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers, tableThumb: thumb, onTableShown: () => {} });
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      blk("tablecard", "{{[[table]]}}", { ":x": 0, ":y": 0, ":w": 280, ":h": 160 }, 0),
      blk("plaincard", "Plain note", { ":x": 400, ":y": 0, ":w": 280, ":h": 160 }, 1),
    ],
  });
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => { let g = 0; while (idleQueue.length && g++ < 50) idleQueue.shift()({ timeRemaining: () => 10, didTimeout: false }); };
  const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  flush();
  return { r, flush, done() { r.dispose(); restore(); } };
}

test("detail to map unmounts a mounted table card that has a thumbnail; other cards wait for the grace timer", () => {
  const h = tableHarness({ thumb: () => "data:image/png;base64,QUJD" });
  try {
    const table = h.r.shellOf("tablecard");
    assert.ok(table.querySelector(".pxd-roam-table"), "the live grid is mounted at detail zoom");
    h.r.setLod("map", 0.3);
    assert.equal(table.querySelector(".pxd-roam-table"), null, "the live grid is released at once");
    assert.ok(table.querySelector("img.pxd-table-thumb"), "the thumbnail stands in");
    assert.equal(h.r.shellOf("plaincard").textContent.includes("Plain note"), true, "a plain card is left to the grace timer");
  } finally {
    h.done();
  }
});

test("detail to map keeps the live table when no thumbnail exists yet", () => {
  const h = tableHarness({ thumb: () => null });
  try {
    const table = h.r.shellOf("tablecard");
    h.r.setLod("map", 0.3);
    assert.ok(table.querySelector(".pxd-roam-table"));
  } finally {
    h.done();
  }
});
