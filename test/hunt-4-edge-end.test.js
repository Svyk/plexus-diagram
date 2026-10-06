// HUNT-4: panning must not measure edge-end handles. A drag still grabs the nearest stored centre.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { edgeEndNearWorld, mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("edgeEndNearWorld picks the nearest stored centre in screen px", () => {
  const centers = [
    { uid: "eAB", end: "from", x: 100, y: 100 },
    { uid: "eAB", end: "to", x: 400, y: 200 },
  ];
  assert.deepEqual(edgeEndNearWorld(centers, { x: 400, y: 200 }), { kind: "edge-end", uid: "eAB", end: "to" });
  assert.deepEqual(edgeEndNearWorld(centers, { x: 408, y: 200 }), { kind: "edge-end", uid: "eAB", end: "to" });
  assert.deepEqual(edgeEndNearWorld(centers, { x: 100, y: 100 }), { kind: "edge-end", uid: "eAB", end: "from" });
  assert.equal(edgeEndNearWorld(centers, { x: 420, y: 200 }), null);
  assert.equal(edgeEndNearWorld(null, { x: 400, y: 200 }), null);
  assert.equal(edgeEndNearWorld(centers, { x: 406, y: 200 }, 10, 2), null, "6 world px is 12 screen px at zoom 2");
  assert.deepEqual(edgeEndNearWorld(centers, { x: 404, y: 200 }, 10, 2), { kind: "edge-end", uid: "eAB", end: "to" });
});

const id = (ch, n) => `${ch}${String(n).padStart(8, "0")}`;

function pulled(cardCount, edgeCount) {
  const item = (uid, string, plexus, order, children = []) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  });
  const cards = [];
  for (let i = 0; i < cardCount; i += 1) {
    cards.push(item(id("c", i), `Card ${i}`, { ":x": i * 280, ":y": 0, ":w": 200, ":h": 100 }, i));
  }
  const edges = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const from = id("c", i);
    const to = id("c", i + 1);
    edges.push(item(id("e", i), `((${from})) → ((${to}))`, { ":type": "edge", ":from": from, ":to": to }, i));
  }
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      ...cards,
      item("edges0001", "Connections", { ":type": "edges" }, cardCount, edges),
    ],
  };
}

function mount(cardCount, edgeCount) {
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard(pulled(cardCount, edgeCount));
  const mutations = [];
  const handlers = new Map();
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    mutations,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
  };
  for (const name of ["commitMove", "updateEdge", "addEdge", "createCard"]) session[name] = rec(name);
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {},
    renderPage() {},
    unmount() {},
    blockString: () => null,
    openBlock() {},
    openInSidebar() {},
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "2.13.2",
    initialViewport: { x: 0, y: 0, zoom: 1 },
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, board, session, view, flush, root: view.root };
}

const pointerDown = (f, target, x, y, extra = {}) => f.stub.dispatch(target, "pointerdown", { button: 0, clientX: x, clientY: y, pointerId: 1, ...extra });
const pointerMove = (f, x, y, extra = {}) => f.stub.dispatch(f.stub.document, "pointermove", { clientX: x, clientY: y, pointerId: 1, buttons: 1, ...extra });
const pointerUp = (f, x, y, extra = {}) => f.stub.dispatch(f.stub.document, "pointerup", { clientX: x, clientY: y, pointerId: 1, ...extra });

function countHandleRects(root) {
  const ends = [...root.querySelectorAll(".pxd-edge__end")];
  let n = 0;
  for (const el of ends) {
    const orig = el.getBoundingClientRect;
    el.getBoundingClientRect = () => { n += 1; return orig(); };
  }
  return { ends, get n() { return n; } };
}

test("a 60-move pan on a board with 40 edges does not measure edge handles", async () => {
  const f = mount(41, 40);
  try {
    await f.flush();
    assert.equal(f.root.querySelectorAll(".pxd-edge").length, 40);
    const edge = f.root.querySelector(".pxd-edge");
    pointerDown(f, edge, 20, 20);
    await f.flush();
    const counted = countHandleRects(f.root);
    assert.equal(counted.ends.length, 2, "the selected edge has two handles to measure");
    const viewport = f.root.querySelector(".pxd-viewport");
    pointerDown(f, viewport, 120, 240, { button: 1, buttons: 4 });
    assert.ok(f.root.classList.contains("pxd-root--gesturing"));
    for (let i = 1; i <= 60; i += 1) pointerMove(f, 120 + i * 3, 240, { buttons: 4 });
    pointerUp(f, 120 + 60 * 3, 240, { button: 1 });
    assert.equal(counted.n, 0);
    f.stub.flushFrames();
    assert.equal(counted.n, 0, "painting the camera does not measure handles");
    assert.equal([...f.root.querySelectorAll(".pxd-edge__end")].every((el, i) => el === counted.ends[i]), true);
    const world = f.root.querySelector(".pxd-world");
    assert.match(world.style.transform, /translate\((?!0px)/, "the camera actually moved");

    const card = f.root.querySelector(`[data-uid=${id("c", 2)}]`);
    pointerDown(f, card, 660, 50);
    for (let i = 1; i <= 8; i += 1) pointerMove(f, 660 + i * 4, 50);
    pointerUp(f, 692, 50);
    assert.equal(counted.n, 0, "a card drag does not measure handles either");
    assert.ok(f.session.mutations.some((m) => m[0] === "commitMove"));

    pointerDown(f, viewport, 400, 320);
    for (let i = 1; i <= 8; i += 1) pointerMove(f, 400 + i * 6, 320);
    pointerUp(f, 448, 320);
    assert.equal(counted.n, 0, "a marquee does not measure handles either");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("dragging an edge end still finds the nearest handle", async () => {
  const f = mount(3, 1);
  try {
    await f.flush();
    const edge = f.root.querySelector(".pxd-edge");
    pointerDown(f, edge, 30, 30);
    await f.flush();
    const counted = countHandleRects(f.root);
    const at = (end) => {
      const node = counted.ends.find((el) => el.getAttribute("data-end") === end);
      assert.ok(node, end);
      return { x: Number(node.getAttribute("cx")), y: Number(node.getAttribute("cy")) };
    };
    const from = at("from");
    const to = at("to");
    assert.ok(Math.hypot(from.x - to.x, from.y - to.y) > 20, "the two centres are far enough apart to tell apart");
    const card0 = f.root.querySelector(`[data-uid=${id("c", 0)}]`);
    const card1 = f.root.querySelector(`[data-uid=${id("c", 1)}]`);
    const drop = { x: 660, y: 50 };

    pointerDown(f, card0, from.x, from.y);
    assert.ok(f.root.classList.contains("pxd-root--gesturing"));
    assert.ok(f.root.querySelector(".pxd-wire"), "the end drag shows the temp wire");
    pointerMove(f, drop.x, drop.y);
    pointerUp(f, drop.x, drop.y);
    const fromPatch = f.session.mutations.filter((m) => m[0] === "updateEdge");
    assert.equal(fromPatch.length, 1);
    assert.equal(fromPatch[0][1], id("e", 0));
    assert.equal(fromPatch[0][2].from, id("c", 2));
    assert.equal(fromPatch[0][2].to, undefined);

    f.session.mutations.length = 0;
    pointerDown(f, card1, to.x, to.y);
    pointerMove(f, drop.x, drop.y);
    pointerUp(f, drop.x, drop.y);
    const toPatch = f.session.mutations.filter((m) => m[0] === "updateEdge");
    assert.equal(toPatch.length, 1);
    assert.equal(toPatch[0][2].to, id("c", 2));
    assert.equal(toPatch[0][2].from, undefined);
    assert.equal(counted.n, 0, "finding the handle does not read its layout box");
    assert.equal(f.session.mutations.some((m) => m[0] === "commitMove"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});
