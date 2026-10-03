import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { edgeString, normalizeEdge, parseEdgeLabel, serializeEdge } from "../src/model/schema.js";

afterEach(() => resetSessions());

test("normalizeEdge keeps valid block ends and drops the rest", () => {
  const e = normalizeEdge({ from: "a", to: "b", fromBlock: "abc123XYZ", toBlock: "bad uid!" });
  assert.equal(e.fromBlock, "abc123XYZ");
  assert.equal("toBlock" in e, false);
  assert.equal("fromBlock" in normalizeEdge({ from: "a", to: "b", fromBlock: 7 }), false);
  assert.equal("toBlock" in normalizeEdge({ from: "a", to: "b", toBlock: "" }), false);
});

test("serializeEdge writes block ends only when set", () => {
  assert.deepEqual(serializeEdge({ from: "a", to: "b" }), { type: "edge", from: "a", to: "b" });
  assert.deepEqual(serializeEdge({ from: "a", to: "b", toBlock: "row000003", fromBlock: "x y" }), { type: "edge", from: "a", to: "b", toBlock: "row000003" });
});

test("edgeString uses ((uid)) for a block end and round-trips the label", () => {
  const s = edgeString({ srcRef: "[[A]]", dstRef: "[[P]]", dstBlock: "row000003", label: "cites" });
  assert.equal(s, "[[A]] → cites → ((row000003))");
  assert.equal(parseEdgeLabel(s, "[[A]]", "((row000003))"), "cites");
  assert.equal(edgeString({ srcRef: "[[A]]", dstRef: "[[P]]", srcBlock: "r1", dstBlock: "r2" }), "((r1)) → ((r2))");
  assert.equal(edgeString({ srcRef: "[[A]]", dstRef: "[[P]]", dstBlock: "bad uid" }), "[[A]] → [[P]]");
});

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "a note", props: { plexus: { x: 0, y: 0 } } },
      { uid: "c2", string: "[[P]]", props: { plexus: { x: 400, y: 0, w: 360, h: 480 } } },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, session };
}

test("addEdge with a block end stores it, writes the ref, and reads it back with the label", async () => {
  const { session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c2", toBlock: "row000003", label: "cites" });
  const edge = session.board.edges.get(uid);
  assert.equal(edge.toBlock, "row000003");
  assert.equal(edge.label, "cites");
  assert.equal(edge.string, "((c1)) → cites → ((row000003))");
  assert.ok(edge.string.endsWith("((row000003))"));
});

test("a page-end edge and a block-end edge between the same cards are distinct", async () => {
  const { session } = setup();
  const a = await session.addEdge({ from: "c1", to: "c2" });
  const b = await session.addEdge({ from: "c1", to: "c2", toBlock: "row000003" });
  const c = await session.addEdge({ from: "c1", to: "c2", toBlock: "row000003" });
  assert.notEqual(a, b);
  assert.equal(b, c);
});

test("updateEdge sets and clears a block end", async () => {
  const { fake, session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c2" });
  fake.clearLog();
  await session.updateEdge(uid, { toBlock: "row000003" });
  assert.equal(session.board.edges.get(uid).toBlock, "row000003");
  assert.ok(session.board.edges.get(uid).string.endsWith("((row000003))"));
  await session.updateEdge(uid, { toBlock: undefined });
  assert.equal(session.board.edges.get(uid).toBlock, undefined);
  assert.ok(session.board.edges.get(uid).string.endsWith("[[P]]"));
});

test("flipEdge carries the block ends across", async () => {
  const { session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c2", toBlock: "row000003", label: "x" });
  await session.flipEdge(uid);
  const e = session.board.edges.get(uid);
  assert.equal(e.from, "c2");
  assert.equal(e.fromBlock, "row000003");
  assert.equal(e.toBlock, undefined);
  assert.ok(e.string.startsWith("((row000003))"));
  assert.equal(e.label, "x");
});

test("label change keeps the block end in the string", async () => {
  const { session } = setup();
  const uid = await session.addEdge({ from: "c1", to: "c2", toBlock: "row000003" });
  await session.updateEdge(uid, { label: "supports" });
  const e = session.board.edges.get(uid);
  assert.equal(e.label, "supports");
  assert.ok(e.string.endsWith("((row000003))"));
});

// ------------------------------------------------------------------ BA-3 geometry
import { buildBoard, worldRects } from "../src/model/board.js";
import { blockAnchor, edgePath } from "../src/model/geometry.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createInteractions } from "../src/view/interactions.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const card = { x: 400, y: 100, w: 360, h: 480 };

test("blockAnchor: a visible row sits at its center on the side facing the other end", () => {
  const left = blockAnchor({ rect: card, rowTop: 100, rowHeight: 20, bodyTop: 30, bodyBottom: 480, other: { x: 50, y: 100 } });
  assert.deepEqual(left, { point: { x: 400, y: 210 }, side: "left", clamped: null });
  const right = blockAnchor({ rect: card, rowTop: 100, rowHeight: 20, bodyTop: 30, bodyBottom: 480, other: { x: 1200, y: 100 } });
  assert.deepEqual(right, { point: { x: 760, y: 210 }, side: "right", clamped: null });
});

test("blockAnchor: a row scrolled out clamps to the card's top or bottom edge; an unrendered row sticks to the top", () => {
  const above = blockAnchor({ rect: card, rowTop: -60, rowHeight: 20, bodyTop: 30, bodyBottom: 480, other: { x: 50, y: 0 } });
  assert.deepEqual(above, { point: { x: 400, y: 100 }, side: "left", clamped: "top" });
  const below = blockAnchor({ rect: card, rowTop: 900, rowHeight: 20, bodyTop: 30, bodyBottom: 480, other: { x: 50, y: 0 } });
  assert.deepEqual(below, { point: { x: 400, y: 580 }, side: "left", clamped: "bottom" });
  const gone = blockAnchor({ rect: card, rowTop: null, bodyTop: 30, bodyBottom: 480, other: { x: 1200, y: 0 } });
  assert.equal(gone.clamped, "top");
  assert.equal(gone.side, "right");
});

test("edgePath without point overrides is unchanged; with them the ends move", () => {
  const a = { x: 0, y: 0, w: 100, h: 60 };
  const b = { x: 400, y: 0, w: 360, h: 480 };
  const plain = edgePath({ a, b });
  assert.deepEqual(edgePath({ a, b, fromPoint: undefined, toPoint: undefined }), plain);
  const moved = edgePath({ a, b, toSide: "left", toPoint: { x: 400, y: 200 } });
  assert.deepEqual(moved.end, { x: 400, y: 200 });
  assert.deepEqual(moved.start, plain.start);
});

// ------------------------------------------------------------------ BA-3 / BA-4 edge layer
const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids });
const pageBoard = (edgeProps = {}) => buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
  raw("c1", "a note", plx({ x: 0, y: 0, w: 100, h: 60 }), [], 0),
  raw("c2", "[[Page]]", plx({ x: 400, y: 0, w: 360, h: 480 }), [], 1),
  raw("ec", "Connections", plx({ type: "edges" }), [
    raw("e12", "((c1)) → ((row1))", plx({ type: "edge", from: "c1", to: "c2", ...edgeProps })),
  ], 2),
]));

function layerFor(texts = {}) {
  const stub = createDomStub();
  const doc = stub.document;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const labels = doc.createElement("div");
  doc.body.append(svg, over, labels);
  const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over, blockText: (uid) => texts[uid] });
  return { layer, svg, stub };
}

test("edge layer: a block end follows its row, clamps with a marker when scrolled out, and tips with the block text", () => {
  const { layer, svg, stub } = layerFor({ row1: `${"long text ".repeat(30)}` });
  const restore = stub.install();
  try {
    const board = pageBoard({ toBlock: "row1" });
    const rects = worldRects(board);
    layer.render({ board, rects, zoom: 1 });
    const plain = layer.geometryOf("e12").end;
    assert.deepEqual(plain, { x: 400, y: 240 }, "no measurement yet: the card's side midpoint");
    layer.setMeasures(new Map([["e12", { to: { rowTop: 100, rowHeight: 20, bodyTop: 30, bodyBottom: 480 } }]]));
    layer.update({ board, edgeUids: new Set(["e12"]), rects, zoom: 1 });
    assert.deepEqual(layer.geometryOf("e12").end, { x: 400, y: 110 });
    const bend = svg.querySelector(".pxd-edge__bend");
    assert.ok(bend);
    assert.ok(!bend.classList.contains("pxd-edge__bend--clamped"));
    assert.equal(bend.querySelector("title").textContent.length, 120, "the tooltip is the first 120 chars");

    const changed = layer.setMeasures(new Map([["e12", { to: { rowTop: -80, rowHeight: 20, bodyTop: 30, bodyBottom: 480 } }]]));
    assert.deepEqual([...changed], ["e12"]);
    layer.update({ board, edgeUids: changed, rects, zoom: 1 });
    assert.deepEqual(layer.geometryOf("e12").end, { x: 400, y: 0 });
    assert.equal(layer.geometryOf("e12").toClamp, "top");
    assert.ok(svg.querySelector(".pxd-edge__bend--clamped"));

    assert.equal(layer.setMeasures(new Map([["e12", { to: { rowTop: -80, rowHeight: 20, bodyTop: 30, bodyBottom: 480 } }]])).size, 0, "identical measurements change nothing");
    layer.setMeasures(new Map());
    layer.update({ board, edgeUids: new Set(["e12"]), rects, zoom: 1 });
    assert.deepEqual(layer.geometryOf("e12").end, plain, "measurement gone: back to the plain side point");
  } finally { restore(); }
});

test("edge layer: an edge without block ends never creates a marker and ignores measurements", () => {
  const { layer, svg, stub } = layerFor();
  const restore = stub.install();
  try {
    const board = pageBoard();
    const rects = worldRects(board);
    layer.setMeasures(new Map([["e12", { to: { rowTop: -80, rowHeight: 20, bodyTop: 30, bodyBottom: 480 } }]]));
    layer.render({ board, rects, zoom: 1 });
    assert.equal(svg.querySelectorAll(".pxd-edge__bend").length, 0);
    assert.deepEqual(layer.geometryOf("e12").end, { x: 400, y: 240 });
  } finally { restore(); }
});

test("edge layer: a selected edge gets two end handles, cleared on deselect", () => {
  const { layer, svg, stub } = layerFor();
  const restore = stub.install();
  try {
    const board = pageBoard();
    layer.render({ board, rects: worldRects(board), zoom: 1 });
    assert.equal(svg.querySelectorAll(".pxd-edge__end").length, 0);
    layer.setSelection({ edge: "e12" });
    assert.equal(svg.querySelectorAll(".pxd-edge__end").length, 2);
    layer.setSelection({});
    assert.equal(svg.querySelectorAll(".pxd-edge__end").length, 0);
  } finally { restore(); }
});

// ------------------------------------------------------------------ BA-3 card measurement
function pageCardHarness() {
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
    pageOutline: (title) => ({ uid: `uid-${title}`, exists: true, blocks: [
      { uid: "row1", string: "one", children: [] },
      { uid: "row2", string: "two", children: [] },
    ] }),
    pageUid: (t) => `uid-${t}`,
    watchPage: () => () => {},
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const laterQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later(fn, ms) { const t = { fn, ms }; laterQueue.push(t); return () => { const i = laterQueue.indexOf(t); if (i >= 0) laterQueue.splice(i, 1); }; },
  };
  const layouts = [];
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers, onPageLayout: (uid) => layouts.push(uid) });
  const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [raw("pg000001", "[[Alpha]]", plx({ x: 0, y: 0, w: 360, h: 480 }), [], 0)]));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -9999, y: -9999, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
  while (idleQueue.length) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  return { r, layouts, laterQueue, shell: r.shellOf("pg000001"), done() { r.dispose(); restore(); } };
}
const rect = (top, height) => ({ left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top });

test("measureRow: offsets are relative to the card top, a missing row is unrendered, a hidden row is too", () => {
  const h = pageCardHarness();
  try {
    assert.ok(h.layouts.length > 0, "painting the page announced a layout change");
    const body = h.shell.querySelector(".pxd-item__body");
    h.shell._rect = rect(1000, 480);
    body._rect = rect(1030, 450);
    h.shell.querySelector("[data-pxd-row=row1]")._rect = rect(1040, 20);
    h.shell.querySelector("[data-pxd-row=row2]")._rect = { ...rect(0, 0), width: 0 };
    assert.deepEqual(h.r.measureRow("pg000001", "row1"), { bodyTop: 30, bodyBottom: 480, rowTop: 40, rowHeight: 20, rendered: true });
    assert.equal(h.r.measureRow("pg000001", "row2").rendered, false);
    assert.equal(h.r.measureRow("pg000001", "nope0001").rendered, false);
    assert.equal(h.r.measureRow("missing", "row1"), null);
  } finally { h.done(); }
});

test("revealRow scrolls the body so the row is centered, flashes it for 600 ms, and reports a missing row", () => {
  const h = pageCardHarness();
  try {
    const body = h.shell.querySelector(".pxd-item__body");
    body._rect = rect(1000, 400);
    body.scrollTop = 0;
    const row = h.shell.querySelector("[data-pxd-row=row1]");
    row._rect = rect(1500, 20);
    assert.equal(h.r.revealRow("pg000001", "row1"), true);
    assert.equal(body.scrollTop, 310, "row center 1510 minus body center 1200");
    assert.ok(row.classList.contains("pxd-row--flash"));
    const timer = h.laterQueue.find((t) => t.ms === 600);
    assert.ok(timer);
    timer.fn();
    assert.ok(!row.classList.contains("pxd-row--flash"));
    assert.equal(h.r.revealRow("pg000001", "gone0001"), false);
  } finally { h.done(); }
});

// ------------------------------------------------------------------ BA-2 gestures
function gestureHarness({ target } = {}) {
  const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
    raw("noteA0001", "a note", plx({ x: 0, y: 0, w: 200, h: 100 }), [], 0),
    raw("pageB0001", "[[Page]]", plx({ x: 400, y: 0, w: 360, h: 480 }), [], 1),
    raw("ec", "Connections", plx({ type: "edges" }), [
      raw("eAB", "((noteA0001)) → ((row000003))", plx({ type: "edge", from: "noteA0001", to: "pageB0001", toBlock: "row000003" })),
    ], 2),
  ]));
  const rects = worldRects(board);
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  let uid = 0;
  const state = { block: target ?? null };
  const ctl = createInteractions({
    actions: {
      board: () => board,
      rects: () => rects,
      viewport: () => ({ x: 0, y: 0, zoom: 1 }),
      size: () => ({ width: 1000, height: 800 }),
      onSelection: rec("onSelection"),
      onTool: rec("onTool"),
      onHover: rec("onHover"),
      setGesturing: rec("setGesturing"),
      showTempWire: rec("showTempWire"),
      cancelPreview: rec("cancelPreview"),
      blockTarget: (pt) => { calls.push(["blockTarget", pt]); return state.block; },
      clearBlockTarget: rec("clearBlockTarget"),
      revealBlockEnd: rec("revealBlockEnd"),
      addEdge: (p) => { calls.push(["addEdge", p]); return Promise.resolve(`new${uid += 1}`); },
      updateEdge: rec("updateEdge"),
    },
    settings: { get: () => undefined },
  });
  const ev = (type, world, extra = {}) => ({ type, screen: world, world, client: world, target: { kind: "empty" }, button: 0, buttons: 1, shift: false, alt: false, meta: false, ctrl: false, ...extra });
  const named = (name) => calls.filter((c) => c[0] === name);
  return { ctl, ev, named, state, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("BA-2: dragging a new arrow over a page row hits the element under the pointer, and the drop writes one addEdge with toBlock", async () => {
  const h = gestureHarness({ target: { uid: "pageB0001", row: "row000005", header: false } });
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "noteA0001", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 60 }));
  assert.equal(h.named("blockTarget").length, 0, "nothing page-like under the pointer yet: no hit test");
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 200 }));
  assert.equal(h.named("blockTarget").length, 1);
  assert.deepEqual(h.named("blockTarget")[0][1], { x: 500, y: 200 });
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 200 }));
  await tick();
  assert.equal(h.named("addEdge").length, 1);
  assert.deepEqual(h.named("addEdge")[0][1], { from: "noteA0001", to: "pageB0001", fromSide: "right", toSide: "left", toBlock: "row000005" });
  assert.ok(h.named("clearBlockTarget").length >= 1, "the highlight is cleared at the end");
});

test("BA-2: a drop on the header or the body connects to the page (no toBlock)", async () => {
  const h = gestureHarness({ target: { uid: "pageB0001", row: null, header: true } });
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "noteA0001", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 10 }));
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 10 }));
  await tick();
  assert.deepEqual(h.named("addEdge")[0][1], { from: "noteA0001", to: "pageB0001", fromSide: "right", toSide: "top" });
});

test("BA-2: dropping on the row an arrow already ends on selects that arrow", async () => {
  const h = gestureHarness({ target: { uid: "pageB0001", row: "row000003", header: false } });
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "noteA0001", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 200 }));
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 200 }));
  await tick();
  assert.equal(h.named("addEdge").length, 0);
  assert.equal(h.ctl.getSelection().edge, "eAB");
});

test("BA-2: moving an arrow end from its row to the header is one updateEdge that clears the block", () => {
  const h = gestureHarness({ target: { uid: "pageB0001", row: null, header: true } });
  h.ctl.handle(h.ev("pointerdown", { x: 400, y: 200 }, { target: { kind: "edge-end", uid: "eAB", end: "to" } }));
  assert.deepEqual(h.named("showTempWire")[0][1].from, "noteA0001");
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 20 }));
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 20 }));
  const ups = h.named("updateEdge");
  assert.equal(ups.length, 1);
  assert.deepEqual(ups[0].slice(1), ["eAB", { toBlock: undefined }]);
});

test("BA-2: moving the end to another row, or releasing in place, writes only when something changed", () => {
  const h = gestureHarness({ target: { uid: "pageB0001", row: "row000007", header: false } });
  h.ctl.handle(h.ev("pointerdown", { x: 400, y: 200 }, { target: { kind: "edge-end", uid: "eAB", end: "to" } }));
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 300 }));
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 300 }));
  assert.deepEqual(h.named("updateEdge")[0].slice(1), ["eAB", { toBlock: "row000007" }]);

  const same = gestureHarness({ target: { uid: "pageB0001", row: "row000003", header: false } });
  same.ctl.handle(same.ev("pointerdown", { x: 400, y: 200 }, { target: { kind: "edge-end", uid: "eAB", end: "to" } }));
  same.ctl.handle(same.ev("pointermove", { x: 500, y: 300 }));
  same.ctl.handle(same.ev("pointerup", { x: 500, y: 300 }));
  assert.equal(same.named("updateEdge").length, 0);
});

test("BA-3: a click on a clamped marker reveals that end and selects the arrow", () => {
  const h = gestureHarness();
  h.ctl.handle(h.ev("pointerdown", { x: 400, y: 0 }, { target: { kind: "edge-marker", uid: "eAB", end: "to" } }));
  assert.deepEqual(h.named("revealBlockEnd")[0].slice(1), ["eAB", "to"]);
  assert.equal(h.ctl.getSelection().edge, "eAB");
});

// ------------------------------------------------------------------ BA-4
test("BA-4: the arrow menu offers Connect to the page instead only for an edge with a block end", () => {
  const ids = (ctx) => buildMenu("edge", ctx).map((i) => i.id);
  assert.ok(ids({ blockEnd: true }).includes("unblock"));
  assert.ok(!ids({ blockEnd: false }).includes("unblock"));
  assert.ok(!ids({}).includes("unblock"));
});

test("BA-4: Write to graph writes label:: ((uid)) when the target end is a block", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0 } } },
      { uid: "c2", string: "[[P]]", props: { plexus: { x: 400, y: 0, w: 360, h: 480 } } },
    ],
  });
  fake.seedPage({ title: "A", uid: "pageA", children: [{ uid: "other", string: "notes" }] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const uid = await session.addEdge({ from: "c1", to: "c2", toBlock: "row000003", label: "cites" });
  const res = await session.writeToGraph(uid);
  assert.deepEqual(res, { ok: true, reason: "created" });
  assert.equal(fake.block(fake.children("pageA").at(-1)).string, "cites:: ((row000003))");
});

test("edgeEndNear grabs a handle whose centre sits under a card", async () => {
  const { edgeEndNear } = await import("../src/view/board-view.js");
  const handle = (cx, cy, end) => ({
    dataset: { end },
    getBoundingClientRect: () => ({ left: cx - 6, top: cy - 6, width: 12, height: 12 }),
    closest: () => ({ dataset: { uid: "eAB" } }),
  });
  const root = { querySelectorAll: () => [handle(400, 200, "to"), handle(100, 100, "from")] };
  assert.deepEqual(edgeEndNear(root, 400, 200), { kind: "edge-end", uid: "eAB", end: "to" });
  assert.deepEqual(edgeEndNear(root, 408, 200), { kind: "edge-end", uid: "eAB", end: "to" });
  assert.equal(edgeEndNear(root, 420, 200), null);
  assert.equal(edgeEndNear({ querySelectorAll: () => [] }, 400, 200), null);
});
