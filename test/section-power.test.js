import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import {
  COLLAPSED_SECTION_H, anchorUid, buildBoard, displayRects, routedEdge, sectionNoteUid, worldRects,
} from "../src/model/board.js";
import { edgePath } from "../src/model/geometry.js";
import { normalizeItemLayout, serializeItemLayout } from "../src/model/schema.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createPresenter } from "../src/view/present.js";
import { mountBoardView } from "../src/view/board-view.js";

afterEach(() => resetSessions());

const card = (uid, x, y, w = 200, h = 100) => ({ uid, string: `[[${uid}]]`, props: { plexus: { x, y, w, h } } });
const section = (uid, x, y, w, h, children = [], extra = {}) => ({
  uid, string: uid, props: { plexus: { type: "section", x, y, w, h, ...extra } }, children,
});

function setup(children) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, session };
}

const plexus = (fake, uid) => fake.props(uid).plexus;

test("section-note look round-trips on text and is dropped on a card", () => {
  const note = normalizeItemLayout({ type: "text", look: "section-note", x: 16, y: 12, w: 200, h: 32 });
  assert.equal(note.look, "section-note");
  assert.equal(serializeItemLayout(note).look, "section-note");
  assert.equal(normalizeItemLayout({ type: "card", look: "section-note" }).look, undefined);
  assert.equal(serializeItemLayout({ type: "card", look: "section-note", x: 1 }).look, undefined);
  const stored = serializeItemLayout({ type: "section", x: 0, y: 0, w: 400, h: 241.1, collapsed: true });
  assert.equal(stored.h, 241.1);
  assert.equal(stored.collapsed, true);
  assert.equal(normalizeItemLayout(stored).collapsed, true);
});

const plexusOf = (o) => ({ plexus: o });
const blk = (uid, string, props, kids = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": 0,
  ":block/props": props,
  ":block/children": kids,
});

function powerBoard() {
  return buildBoard(blk("b1", "{{[[diagram]]:B}}", plexusOf({ v: 2 }), [
    blk("out", "Outside", plexusOf({ x: 700, y: 40, w: 120, h: 80 })),
    blk("S", "Section one", plexusOf({ type: "section", x: 24, y: 40, w: 400, h: 241.1, collapsed: true }), [
      blk("note", "A description", plexusOf({ type: "text", look: "section-note", x: 16, y: 12, w: 200, h: 32 })),
      blk("in1", "Inside", plexusOf({ x: 30, y: 50, w: 100, h: 60 })),
      blk("in2", "Also", plexusOf({ x: 160, y: 50, w: 100, h: 60 })),
    ]),
    blk("ec", "Connections", plexusOf({ type: "edges" }), [
      blk("eOut", "", plexusOf({ type: "edge", from: "out", to: "in1" })),
      blk("eIn", "", plexusOf({ type: "edge", from: "in1", to: "in2" })),
    ]),
  ]));
}

test("displayRects hides members, keeps stored h, and routes edges to the section", () => {
  const board = powerBoard();
  assert.equal(board.items.get("note").look, "section-note");
  assert.equal(sectionNoteUid(board, "S"), "note");
  assert.equal(board.items.get("S").h, 241.1);
  const stored = worldRects(board);
  const shown = displayRects(board, stored);
  assert.equal(stored.get("S").h, 241.1, "stored rects stay at the real height");
  assert.equal(shown.get("S").h, COLLAPSED_SECTION_H);
  assert.equal(shown.get("S").x, stored.get("S").x);
  assert.equal(shown.has("in1"), false);
  assert.equal(shown.has("note"), false);
  assert.equal(anchorUid(board, "in1"), "S");
  assert.equal(anchorUid(board, "note"), "S");
  assert.equal(anchorUid(board, "out"), "out");
  const outside = routedEdge(board, board.edges.get("eOut"), shown);
  assert.equal(outside.from, "out");
  assert.equal(outside.to, "S");
  assert.equal(outside.b.h, COLLAPSED_SECTION_H);
  assert.equal(routedEdge(board, board.edges.get("eIn"), shown), null);

  const stub = createDomStub();
  const doc = stub.document;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const labels = doc.createElement("div");
  doc.body.append(svg, over, labels);
  const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over });
  layer.render({ board, rects: shown });
  const outRec = layer._els.get("eOut");
  const inRec = layer._els.get("eIn");
  assert.equal(inRec.g.getAttribute("display"), "none");
  assert.equal(outRec.line.getAttribute("d"), edgePath({
    a: outside.a, b: outside.b, fromSide: "auto", toSide: "auto", route: "curve", offset: 0,
  }).d);
  layer.dispose();
});

test("collapsed section shell hides children and shows the note only while expanded", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const r = createItemRenderer({
    doc,
    host: { renderString: (n, s) => { n.textContent = s; }, unmount() {} },
    session: {},
    itemsLayer,
    sectionsLayer,
    timers: { idle: () => () => {}, later: () => () => {} },
  });
  const raw = blk("b1", "{{[[diagram]]:B}}", plexusOf({ v: 2 }), [
    blk("S", "Section one", plexusOf({ type: "section", x: 10, y: 20, w: 400, h: 241.1, collapsed: true }), [
      blk("note", "A description", plexusOf({ type: "text", look: "section-note", x: 16, y: 12, w: 200, h: 32 })),
      blk("in1", "Inside", plexusOf({ x: 30, y: 50, w: 100, h: 60 })),
    ]),
  ]);
  let board = buildBoard(raw);
  r.sync({ board, rects: displayRects(board, worldRects(board)), structural: true });
  assert.equal(r.shellOf("S").style.height, `${COLLAPSED_SECTION_H}px`);
  assert.equal(r.shellOf("in1").style.display, "none");
  assert.equal(r.shellOf("note").style.display, "none");
  assert.equal(r.shellOf("S").querySelector(".pxd-section__note").style.display, "none");
  assert.ok(r.shellOf("S").classList.contains("pxd-section--collapsed"));
  board.items.get("S").collapsed = false;
  r.sync({ board, rects: displayRects(board, worldRects(board)), structural: true });
  assert.equal(r.shellOf("S").style.height, "241.1px");
  assert.equal(r.shellOf("in1").style.display, "");
  assert.equal(r.shellOf("note").style.display, "none");
  assert.equal(r.shellOf("S").querySelector(".pxd-section__note").textContent, "A description");
  assert.equal(board.items.get("S").h, 241.1);
  r.dispose();
  restore();
});

test("present this section is one step for that section", () => {
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  stub.document.body.append(root);
  const board = powerBoard();
  board.items.get("S").collapsed = false;
  const steps = [];
  const p = createPresenter({ doc: stub.document, root, on: { step: (s) => steps.push(s) } });
  assert.equal(p.start(board, worldRects(board), { only: "S" }), true);
  assert.equal(p.total(), 1);
  assert.equal(p.index(), 0);
  assert.equal(steps[0].uid, "S");
  assert.equal(steps[0].title, "Section one");
  assert.equal(steps[0].rect.h, 241.1);
  assert.ok(steps[0].members.has("S"));
  assert.ok(steps[0].members.has("in1"));
  assert.equal(root.querySelector(".pxd-present-hud__count").textContent, "1 / 1");
  p.stop();
  assert.equal(p.start(board, worldRects(board), { only: "missing" }), false);
});

test("lockSection pins the section and its members in one undo group and does not write h", async () => {
  const { fake, session } = setup([section("S", 100, 100, 400, 300, [card("a", 40, 60), card("b", 240, 150)])]);
  await session.lockSection("S", true);
  assert.equal(plexus(fake, "S").pinned, true);
  assert.equal(plexus(fake, "a").pinned, true);
  assert.equal(plexus(fake, "b").pinned, true);
  assert.equal(plexus(fake, "S").h, 300);
  fake.clearLog();
  await session.undo();
  assert.equal(fake.calls.filter((c) => c[0] === "undo").length, 3);
  await session.lockSection("S", false);
  assert.equal(plexus(fake, "S").pinned, undefined);
  assert.equal(plexus(fake, "a").pinned, undefined);
  assert.equal(plexus(fake, "S").h, 300);
});

test("setCollapsed and the section note leave the section height alone", async () => {
  const { fake, session } = setup([section("S", 100, 100, 400, 300, [card("a", 40, 60)])]);
  await session.setCollapsed("S", true);
  assert.equal(plexus(fake, "S").collapsed, true);
  assert.equal(plexus(fake, "S").h, 300);
  await session.setCollapsed("S", false);
  assert.equal(plexus(fake, "S").collapsed, undefined);
  assert.equal(plexus(fake, "S").h, 300);
  const id = await session.toggleSectionNote("S", "A description");
  assert.equal(fake.block(id).parent, "S");
  assert.equal(fake.block(id).string, "A description");
  assert.equal(plexus(fake, id).look, "section-note");
  assert.equal(plexus(fake, id).type, "text");
  assert.equal(session.board.items.get(id).look, "section-note");
  assert.equal(sectionNoteUid(session.board, "S"), id);
  assert.equal(plexus(fake, "S").h, 300);
  assert.equal(await session.toggleSectionNote("S"), null);
  assert.equal(fake.has(id), false);
  assert.equal(plexus(fake, "S").h, 300);
  assert.equal(sectionNoteUid(session.board, "S"), null);
});

test("a collapse while the board is open reroutes the edge onto the short section", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const fake = createFakeRoam();
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    fake.seedBoard({
      uid: "b1",
      props: { plexus: { v: 2 } },
      children: [
        card("out", 700, 40, 120, 80),
        section("S", 24, 40, 400, 241.1, [card("in1", 30, 50, 100, 60)]),
        {
          uid: "ec", string: "Connections", props: { plexus: { type: "edges" } },
          children: [{ uid: "e1", string: "", props: { plexus: { type: "edge", from: "out", to: "in1" } } }],
        },
      ],
    });
    const session = acquireSession("b1", { host, linkDelay: 0 });
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.3.0" });
    const flush = () => { for (let i = 0; i < 6; i++) stub.flushFrames(); };
    flush();
    const line = () => view.root.querySelector('.pxd-edge[data-uid="e1"] .pxd-edge__line');
    const before = line()?.getAttribute("d");
    assert.ok(before, "the edge is painted before collapse");
    await session.setCollapsed("S", true);
    flush();
    const board = session.board;
    const shown = displayRects(board);
    const routed = routedEdge(board, board.edges.get("e1"), shown);
    assert.equal(routed.b.h, COLLAPSED_SECTION_H);
    const expectD = edgePath({ a: routed.a, b: routed.b }).d;
    assert.equal(line().getAttribute("d"), expectD);
    assert.notEqual(expectD, before);
    assert.equal(board.items.get("S").h, 241.1);
    assert.equal(view.root.querySelector('[data-uid="in1"]').style.display, "none");
    view.dispose();
    session.release();
  } finally {
    restore();
  }
});
