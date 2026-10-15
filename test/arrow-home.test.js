import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildBoard, routedEdge, worldRects } from "../src/model/board.js";
import { HOME_PULL, REFS_PULL } from "../src/model/arrow-home.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": props,
  ":block/children": kids,
});

// c1 is not on this board. The arrow still names c1. nb is the board card that holds it.
function housedBoard() {
  const board = buildBoard(raw("b1", "{{[[diagram]]:Outer}}", plx({ v: 2 }), [
    raw("nb", "{{[[diagram]]:Inner}}", plx({ x: 0, y: 0, w: 320, h: 220, v: 2 }), [], 0),
    raw("c2", "[[B]]", plx({ x: 500, y: 40, w: 200, h: 100 }), [], 1),
    raw("ec", "Connections", plx({ type: "edges" }), [
      raw("e12", "[[A]] → [[B]]", plx({ type: "edge", from: "c1", to: "c2" })),
    ], 2),
  ]));
  const edge = board.edges.get("e12");
  edge.homeFrom = { cardUid: "nb", title: "Alpha card" };
  return board;
}

test("an unresolved end draws to the board card that holds it and keeps the card title", () => {
  const board = housedBoard();
  const routed = routedEdge(board, board.edges.get("e12"), worldRects(board));
  assert.equal(routed.from, "nb");
  assert.equal(routed.to, "c2");
  assert.equal(routed.fromHome.title, "Alpha card");
  assert.equal(routed.toHome, undefined);
});

test("the same arrow draws to the card again once that card is back on the board", () => {
  const board = buildBoard(raw("b1", "{{[[diagram]]:Outer}}", plx({ v: 2 }), [
    raw("nb", "{{[[diagram]]:Inner}}", plx({ x: 0, y: 0, w: 320, h: 220, v: 2 }), [], 0),
    raw("c1", "[[A]]", plx({ x: 40, y: 40, w: 200, h: 100 }), [], 1),
    raw("c2", "[[B]]", plx({ x: 500, y: 40, w: 200, h: 100 }), [], 2),
    raw("ec", "Connections", plx({ type: "edges" }), [
      raw("e12", "[[A]] → [[B]]", plx({ type: "edge", from: "c1", to: "c2" })),
    ], 3),
  ]));
  const edge = board.edges.get("e12");
  edge.homeFrom = { cardUid: "nb", title: "Alpha card" };
  const routed = routedEdge(board, edge, worldRects(board));
  assert.equal(routed.from, "c1");
  assert.equal(routed.fromHome, undefined);
});

test("the outer arrow paints a clamped marker labelled with the moved card", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    const labels = doc.createElement("div");
    doc.body.append(svg, labels);
    const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: svg });
    const board = housedBoard();
    const rects = worldRects(board);
    layer.render({ board, rects, zoom: 1, drawn: (uid) => uid === "nb" || uid === "c2" });
    assert.equal(layer.waitingLeft(), 0);
    const bend = svg.querySelector(".pxd-edge__bend--clamped");
    assert.ok(bend, "the end on the board card uses the block-arrow marker");
    assert.match(bend.querySelector(".pxd-edge__bend-text").textContent, /Alpha/);
    assert.equal(svg.querySelector(".pxd-edge--invalid"), null);
    layer.render({ board, rects, zoom: 1, drawn: (uid) => uid === "c1" || uid === "c2" });
    assert.equal(layer.waitingLeft(), 1, "the board card is not drawn, so the arrow waits");
  } finally { restore(); }
});

function seedDrop(fake) {
  fake.seedBoard({
    uid: "b1",
    string: "{{[[diagram]]:Outer}}",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[Alpha]]", props: { plexus: { x: 100, y: 100, w: 200, h: 100 } } },
      { uid: "c2", string: "[[Beta]]", props: { plexus: { x: 400, y: 200, w: 200, h: 100 } } },
      { uid: "nb", string: "{{[[diagram]]:Inner}}", props: { plexus: { x: 0, y: 500, w: 320, h: 220, v: 2 } }, children: [] },
      {
        uid: "ec",
        string: "Connections",
        props: { plexus: { type: "edges" } },
        children: [
          { uid: "e12", string: "[[Alpha]] → [[Beta]]", props: { plexus: { type: "edge", from: "c1", to: "c2" } } },
        ],
      },
    ],
  });
}

function openDrop() {
  const fake = createFakeRoam({ pullMany: true, echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedDrop(fake);
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.pullLog = [];
  fake.clearLog();
  return { fake, host, session };
}

const arrowPulls = (fake) => (fake.pullLog || []).filter((p) => p.pattern === HOME_PULL || p.pattern === REFS_PULL);

test("dropping a card into a board stamps the arrow onto that board card and a keystroke does not pull again", async () => {
  const { fake, host, session } = openDrop();
  await session.moveIntoBoard(["c1"], "nb");
  const edge = session.board.edges.get("e12");
  assert.equal(edge.from, "c1");
  assert.equal(edge.homeFrom?.cardUid, "nb");
  assert.equal(edge.homeFrom?.title, "Alpha");
  assert.equal(fake.props("e12").plexus.from, "c1");
  assert.equal(fake.writesLog().some((e) => e[1] === "e12"), false);
  assert.ok(arrowPulls(fake).some((p) => p.pattern === HOME_PULL), "the drop walks the moved card's parents once");
  await fake.flush();
  const inner = acquireSession("nb", { host, linkDelay: 0 });
  const list = inner.board.outsides?.get("c1") || [];
  assert.equal(list.length, 1);
  assert.equal(list[0].otherUid, "c2");
  assert.equal(list[0].otherTitle, "Beta");
  assert.equal(list[0].boardTitle, "Outer");
  assert.equal(list[0].boardUid, "b1");
  fake.pullLog = [];
  await session.setString("c2", "[[Beta]] edited");
  assert.deepEqual(arrowPulls(fake), [], "a keystroke does not walk ancestors again");
  session.release();
  inner.release();
});

test("a top-level board does not pull every card's refs", () => {
  const fake = createFakeRoam({ pullMany: true, echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedDrop(fake);
  fake.pullLog = [];
  const session = acquireSession("b1", { host, linkDelay: 0 });
  assert.equal(arrowPulls(fake).filter((p) => p.pattern === REFS_PULL).length, 0);
  session.release();
});

test("a missing endpoint is left in place", () => {
  const fake = createFakeRoam({ pullMany: true, echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    string: "{{[[diagram]]:Outer}}",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c2", string: "[[Beta]]", props: { plexus: { x: 400, y: 40, w: 200, h: 100 } } },
      {
        uid: "ec",
        string: "Connections",
        props: { plexus: { type: "edges" } },
        children: [
          { uid: "eg", string: "gone → [[Beta]]", props: { plexus: { type: "edge", from: "gone", to: "c2" } } },
        ],
      },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const edge = session.board.edges.get("eg");
  assert.equal(edge.from, "gone");
  assert.equal(edge.homeFrom, undefined);
  assert.equal(fake.has("eg"), true);
  assert.equal(fake.writesLog().some((e) => e[0] === "delete" && e[1] === "eg"), false);
  session.release();
});

test("a nested card shows ↗ 1 and a click opens the other board on the other card", async () => {
  const { mountBoardView } = await import("../src/view/board-view.js");
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const fake = createFakeRoam({ pullMany: true, echoDelay: 0 });
    fake.seedBoard({
      uid: "b1",
      string: "{{[[diagram]]:Outer}}",
      props: { plexus: { v: 2 } },
      children: [
        { uid: "c2", string: "[[Beta]]", props: { plexus: { x: 400, y: 40, w: 200, h: 100 } } },
        {
          uid: "nb",
          string: "{{[[diagram]]:Inner}}",
          props: { plexus: { x: 0, y: 400, w: 320, h: 220, v: 2 } },
          children: [
            { uid: "c1", string: "[[Alpha]]", props: { plexus: { x: 20, y: 40, w: 200, h: 100 } } },
          ],
        },
        {
          uid: "ec",
          string: "Connections",
          props: { plexus: { type: "edges" } },
          children: [
            { uid: "e12", string: "[[Alpha]] → [[Beta]]", props: { plexus: { type: "edge", from: "c1", to: "c2" } } },
          ],
        },
      ],
    });
    const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
    const session = acquireSession("nb", { host, linkDelay: 0, raf: (fn) => fn() });
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const opened = [];
    const view = mountBoardView({
      host,
      session,
      mountEl,
      settings: { get: () => undefined },
      version: "3.32.0",
      onOpenBoard: (uid, opts) => opened.push({ uid, opts }),
    });
    stub.flushFrames();
    stub.flushIdle();
    const badge = view.root.querySelector(".pxd-out");
    assert.ok(badge, "the moved card shows the outside-arrow badge");
    assert.equal(badge.textContent, "↗ 1");
    assert.match(badge.title || "", /from Beta on Outer/);
    stub.dispatch(badge, "pointerdown", { button: 0, clientX: 30, clientY: 30 });
    assert.deepEqual(opened, [{ uid: "b1", opts: { focus: "c2" } }]);
    view.dispose();
    session.release();
  } finally { restore(); }
});

test("clicking the outer marker opens the board centred on the moved card", async () => {
  const { mountBoardView } = await import("../src/view/board-view.js");
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const { fake, host, session } = openDrop();
    await session.moveIntoBoard(["c1"], "nb");
    await fake.flush();
    host.viewports = host.viewports || { get: () => null, set() {} };
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const opened = [];
    const view = mountBoardView({
      host,
      session,
      mountEl,
      settings: { get: () => undefined },
      version: "3.32.0",
      onOpenBoard: (uid, opts) => opened.push({ uid, opts }),
    });
    stub.flushFrames?.();
    const bend = view.root.querySelector(".pxd-edge__bend--clamped");
    assert.ok(bend, "the outer end is the block-arrow marker");
    stub.dispatch(bend, "pointerdown", { button: 0, clientX: 40, clientY: 40 });
    assert.deepEqual(opened, [{ uid: "nb", opts: { focus: "c1" } }]);
    view.dispose();
    session.release();
  } finally { restore(); }
});

function seedLabels(fake) {
  fake.seedPage({
    title: "Scratch",
    uid: "pgScratch1",
    children: [{ uid: "t072313cT", string: "Target title" }],
  });
  fake.seedBoard({
    uid: "b1",
    string: "{{[[diagram]]:Outer}}",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "x072313cA", string: "Alpha", props: { plexus: { x: 100, y: 100, w: 200, h: 100 } } },
      { uid: "p072313cP", string: "[[Alpha Page]]", props: { plexus: { x: 100, y: 240, w: 200, h: 100 } } },
      { uid: "m072313cM", string: "**Bold** note", props: { plexus: { x: 100, y: 380, w: 200, h: 100 } } },
      { uid: "r072313cR", string: "((t072313cT))", props: { plexus: { x: 100, y: 520, w: 200, h: 100 } } },
      { uid: "l072313cL", string: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", props: { plexus: { x: 100, y: 660, w: 200, h: 100 } } },
      { uid: "k072313cK", string: "Kept card", props: { plexus: { x: 100, y: 800, w: 200, h: 100 } } },
      { uid: "b072313cB", string: "Beta", props: { plexus: { x: 700, y: 100, w: 200, h: 100 } } },
      { uid: "nb", string: "{{[[diagram]]:Inner}}", props: { plexus: { x: 0, y: 1100, w: 320, h: 220, v: 2 } }, children: [] },
      {
        uid: "ec",
        string: "Connections",
        props: { plexus: { type: "edges" } },
        children: [
          { uid: "eAlpha01", string: "((x072313cA)) → ((b072313cB))", props: { plexus: { type: "edge", from: "x072313cA", to: "b072313cB" } } },
          { uid: "ePage001", string: "[[Alpha Page]] → ((b072313cB))", props: { plexus: { type: "edge", from: "p072313cP", to: "b072313cB" } } },
          { uid: "eMark001", string: "((m072313cM)) → ((b072313cB))", props: { plexus: { type: "edge", from: "m072313cM", to: "b072313cB" } } },
          { uid: "eRef0001", string: "((r072313cR)) → ((b072313cB))", props: { plexus: { type: "edge", from: "r072313cR", to: "b072313cB" } } },
          { uid: "eLong001", string: "((l072313cL)) → ((b072313cB))", props: { plexus: { type: "edge", from: "l072313cL", to: "b072313cB" } } },
          { uid: "eKeep001", string: "((k072313cK)) → keeps → ((b072313cB))", props: { plexus: { type: "edge", from: "k072313cK", to: "b072313cB" } } },
        ],
      },
    ],
  });
}

function labelText(root, uid) {
  const nodes = [...root.querySelectorAll(".pxd-label")];
  const label = nodes.find((node) => (node.dataset?.uid || node.getAttribute?.("data-uid")) === uid);
  return label ? label.textContent : null;
}

async function mountLabels(host, session, stub) {
  const { mountBoardView } = await import("../src/view/board-view.js");
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "3.32.0",
  });
  stub.flushFrames?.();
  return view;
}

test("the outer arrow label names the moved card, not its raw ref", async () => {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const fake = createFakeRoam({ pullMany: true, echoDelay: 0 });
    const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
    seedLabels(fake);
    const session = acquireSession("b1", { host, linkDelay: 0 });
    await session.moveIntoBoard(["x072313cA", "p072313cP", "m072313cM", "r072313cR", "l072313cL", "k072313cK"], "nb");
    await fake.flush();
    const view = await mountLabels(host, session, stub);
    assert.equal(labelText(view.root, "eAlpha01"), "Alpha");
    assert.equal(labelText(view.root, "ePage001"), "Alpha Page");
    assert.equal(labelText(view.root, "eMark001"), "Bold note");
    assert.equal(labelText(view.root, "eRef0001"), "Target title");
    assert.equal(labelText(view.root, "eLong001"), "ABCDEFGHIJKLMNOPQRSTU\u2026");
    assert.equal(labelText(view.root, "eKeep001"), "keeps");
    assert.equal(fake.block("eAlpha01").string, "((x072313cA)) → ((b072313cB))");
    view.dispose();
    session.release();
    const again = acquireSession("b1", { host, linkDelay: 0 });
    const reopened = await mountLabels(host, again, stub);
    assert.equal(labelText(reopened.root, "eAlpha01"), "Alpha");
    assert.equal(fake.block("eAlpha01").string, "((x072313cA)) → ((b072313cB))");
    reopened.dispose();
    again.release();
  } finally { restore(); }
});

test("an unverified board does not pull or delete the arrow", async () => {
  const fake = createFakeRoam({ pullMany: true, echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedDrop(fake);
  host.boardUnverified = () => true;
  host.onBoardVerified = () => () => {};
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.pullLog = [];
  fake.clearLog();
  await session.moveIntoBoard(["c1"], "nb");
  assert.deepEqual(arrowPulls(fake), []);
  assert.equal(fake.has("e12"), true);
  assert.equal(fake.writesLog().some((e) => e[0] === "delete"), false);
  session.release();
});
