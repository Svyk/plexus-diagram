// PXD-2: zoom speed on big boards. zoomVarScope (the zoom variables on the sections and cards layers, not the root)
// and handlesWrap (ports and grips in one wrapper that is display:none unless the shell is hovered or selected).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildBoard, worldRects } from "../src/model/board.js";
import { invZoom, screenPx } from "../src/model/geometry.js";
import { mountBoardView } from "../src/view/board-view.js";
import { boardZoom } from "../src/view/drag-ghost.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { mountBig, settledIn, zoomBurst, tick } from "./fixtures/big-mount.js";
import { sourceCss } from "./css-source.js";

const css = sourceCss();
const ZOOM_VARS = ["--pxd-inv-zoom", "--pxd-screen-px", "--pxd-map-font", "--pxd-overview-font", "--pxd-ui"];

const id = (ch, n) => `${ch}${String(n).padStart(8, "0")}`;
function pulled(cardCount) {
  const item = (uid, string, plexus, order, children = []) => ({
    ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": plexus ? { ":plexus": plexus } : {}, ":block/children": children,
  });
  const cards = [];
  for (let i = 0; i < cardCount; i += 1) cards.push(item(id("c", i), `Card ${i}`, { ":x": 40 + i * 280, ":y": 40, ":w": 200, ":h": 100 }, i));
  const section = item("sec000001", "Section", { ":type": "section", ":x": 0, ":y": 400, ":w": 600, ":h": 300 }, cardCount);
  const edges = [];
  for (let i = 0; i + 1 < cardCount; i += 1) edges.push(item(id("e", i), `((${id("c", i)})) → ((${id("c", i + 1)}))`, { ":type": "edge", ":from": id("c", i), ":to": id("c", i + 1) }, i));
  return {
    ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [...cards, section, item("edges0001", "Connections", { ":type": "edges" }, cardCount + 1, edges)],
  };
}

function mount(flags = {}) {
  noteSpeedFlags(flags);
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard(pulled(4));
  const handlers = new Map();
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false, mutations: [],
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); return () => handlers.get(name).delete(fn); },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
  };
  for (const name of ["commitMove", "updateEdge", "addEdge", "createCard"]) session[name] = () => Promise.resolve(`${name}-uid`);
  const host = {
    graph: "Svy", renderString(el, string) { el.textContent = string; }, renderBlock() {}, renderPage() {}, unmount() {},
    blockString: () => null, openBlock() {}, openInSidebar() {},
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.37.0", initialViewport: { x: 0, y: 0, zoom: 1 } });
  const flush = async () => { stub.flushFrames(); await tick(); stub.flushIdle(); stub.flushFrames(); };
  const done = () => { try { view.dispose(); } catch { /* gone */ } restore(); noteSpeedFlags(null); };
  return { stub, view, root: view.root, flush, done };
}

const items = (f) => f.root.querySelector(".pxd-items");
const sections = (f) => f.root.querySelector(".pxd-sections");
const zoomKey = async (f, k) => {
  f.stub.dispatch(f.root.querySelector(".pxd-viewport"), "wheel", { ctrlKey: true, deltaY: k === "-" ? 100 : -100, clientX: 400, clientY: 300 });
  f.stub.flushFrames();
  // The wheel zoom gesture ends on a real 160 ms timer, then the 120 ms settle paints the zoom variables.
  for (let i = 0; i < 6; i += 1) { await tick(80); f.stub.flushTimers(); f.stub.flushFrames(); }
};
const selectFirstEdge = async (f) => {
  f.stub.dispatch(f.root.querySelector(".pxd-edge"), "pointerdown", { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
  f.stub.dispatch(f.stub.document, "pointerup", { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
  await f.flush();
};

test("zoomVarScope: the zoom variables are on the sections and cards layers, never on the root; a zoom step updates both", async () => {
  const f = mount();
  try {
    await f.flush();
    for (const name of ZOOM_VARS) assert.equal(f.root.style[name] ?? "", "", `${name} is not on the root`);
    for (const layer of [items(f), sections(f)]) {
      assert.equal(layer.style["--pxd-inv-zoom"] ?? "", "1");
      assert.equal(layer.style["--pxd-screen-px"] ?? "", "1");
      assert.match(layer.style["--pxd-map-font"] ?? "", /px$/);
      assert.match(layer.style["--pxd-overview-font"] ?? "", /px$/);
    }
    await zoomKey(f, "-");
    const z = f.view.state().zoom;
    assert.ok(z < 1);
    for (const layer of [items(f), sections(f)]) {
      assert.equal(layer.style["--pxd-inv-zoom"] ?? "", String(invZoom(z)));
      assert.equal(layer.style["--pxd-screen-px"] ?? "", String(screenPx(z)));
    }
    for (const name of ZOOM_VARS) assert.equal(f.root.style[name] ?? "", "", `${name} is still not on the root`);
  } finally { f.done(); }
});

test("zoomVarScope: the drag ghost reads the board zoom from the cards layer when the root has none", () => {
  const layer = { style: { getPropertyValue: (name) => (name === "--pxd-screen-px" ? "2.5" : "") } };
  const root = { style: { getPropertyValue: () => "" }, querySelector: (sel) => (sel === ".pxd-items" ? layer : null) };
  assert.equal(boardZoom(root, {}), 0.4);
  const rootSet = { style: { getPropertyValue: (name) => (name === "--pxd-screen-px" ? "0.5" : "") }, querySelector: () => layer };
  assert.equal(boardZoom(rootSet, {}), 2, "a root value (zoomVarScope off) still wins");
});

test("zoomVarScope: a selected edge's end handles carry the zoom variables inline and follow a zoom step", async () => {
  const f = mount();
  try {
    await f.flush();
    await selectFirstEdge(f);
    const ends = () => [...f.root.querySelectorAll(".pxd-edge__end")];
    assert.equal(ends().length, 2, "the selected edge has two handles");
    for (const end of ends()) assert.equal(end.style["--pxd-inv-zoom"] ?? "", "1");
    await zoomKey(f, "-");
    await zoomKey(f, "-");
    const want = items(f).style["--pxd-inv-zoom"] ?? "";
    assert.notEqual(want, "1");
    assert.ok(ends().length === 2);
    for (const end of ends()) {
      assert.equal(end.style["--pxd-inv-zoom"] ?? "", want);
      assert.equal(end.style["--pxd-screen-px"] ?? "", items(f).style["--pxd-screen-px"] ?? "");
    }
  } finally { f.done(); }
});

test("zoomVarScope off: the variables go on the root as in 3.37.0 and the handles carry none", async () => {
  const f = mount({ zoomVarScope: false });
  try {
    await f.flush();
    await selectFirstEdge(f);
    await zoomKey(f, "-");
    const z = f.view.state().zoom;
    assert.equal(f.root.style["--pxd-inv-zoom"] ?? "", String(invZoom(z)));
    assert.match(f.root.style["--pxd-map-font"] ?? "", /px$/);
    assert.equal(items(f).style["--pxd-inv-zoom"] ?? "", "");
    for (const end of f.root.querySelectorAll(".pxd-edge__end")) assert.equal(end.style["--pxd-inv-zoom"] ?? "", "");
  } finally { f.done(); }
});

test("zoomVarScope: a Ctrl-wheel zoom across both tier flips on the 1,560-card board writes no zoom variable on the root", async () => {
  const m = mountBig({ x: -2000, y: -1500, zoom: 1 }, { virtualClock: true });
  try {
    await settledIn(m);
    const writes = [];
    const set = m.view.root.style.setProperty.bind(m.view.root.style);
    m.view.root.style.setProperty = (name, value) => { if (ZOOM_VARS.includes(name)) writes.push(name); return set(name, value); };
    const out = await zoomBurst(m, 1, 14);
    const back = await zoomBurst(m, -1, 14);
    const tiers = new Set([...out, ...back].map((fr) => fr.lod));
    assert.ok(tiers.has("detail") && tiers.has("overview"), `crossed both flips: ${[...tiers]}`);
    assert.deepEqual(writes, []);
    assert.equal(m.view.root.querySelector(".pxd-items").style["--pxd-inv-zoom"] ?? "", String(invZoom(m.view.viewport().zoom)));
    assert.equal(m.view.paintAudit().missing, 0);
  } finally { m.done(); }
});

test("handlesWrap: every card and section has one wrapper with its four ports and three grips; off restores 3.37.0", async () => {
  for (const wrap of [true, false]) {
    const f = mount({ handlesWrap: wrap });
    try {
      await f.flush();
      const shells = [...f.root.querySelectorAll(".pxd-item, .pxd-section")];
      assert.ok(shells.length >= 5);
      for (const shell of shells) {
        const kids = [...shell.children];
        const own = (cls) => kids.filter((k) => k.classList.contains(cls));
        if (wrap) {
          assert.equal(own("pxd-handles").length, 1);
          assert.equal(own("pxd-grip").length, 0, "no grip is a direct child");
          assert.equal(own("pxd-ports").length, 0);
          const handles = own("pxd-handles")[0];
          const parts = [...handles.children];
          assert.equal(parts.filter((k) => k.classList.contains("pxd-port")).length, 4);
          assert.deepEqual(parts.filter((k) => k.classList.contains("pxd-grip")).map((g) => g.dataset.part), ["right", "bottom", "corner"]);
        } else {
          assert.equal(own("pxd-handles").length, 0);
          assert.equal(own("pxd-grip").length, 3);
          assert.equal(own("pxd-ports").length, 1);
        }
      }
    } finally { f.done(); }
  }
});

// Blink restyles every element a gesture-flag rule's subject names when the flag flips; a display:none parent spares
// its children. The wrapper must not be a subject there, and it must start hidden.
test("handlesWrap CSS: the wrapper is hidden by default and no rule keyed on the gesture flag has it as its subject", () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const base = rules.find((r) => r.sel === ".pxd-handles");
  assert.ok(base && /display:\s*none/.test(base.body));
  for (const r of rules) {
    for (const sel of r.sel.split(",").map((s) => s.trim())) {
      if (!sel.includes("data-pxd-gesturing")) continue;
      const subject = sel.split(/\s+|>/).filter(Boolean).pop();
      assert.ok(!/^\.pxd-handles(\W|$)/.test(subject), `gesture rule with the wrapper as subject: ${sel}`);
    }
  }
});
