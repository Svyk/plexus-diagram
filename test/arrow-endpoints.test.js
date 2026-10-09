import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { pxdTarget } from "../src/model/deeplink.js";
import {
  edgeMayTarget,
  endpointChipText,
  endpointIndex,
  endpointKindOf,
  endpointUnderPointer,
  focusEnds,
  imageSourceOf,
  marqueeFrac,
  pointInside,
  regionBox,
  regionBoxFrac,
  clampToBox,
  regionDropPlan,
  regionEdgePoint,
  wireStart,
} from "../src/model/endpoints.js";
import { blockInner } from "../src/model/geometry.js";
import { imageRegionString } from "../src/model/image-region.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createInteractions, REGION_BOX_HINT, REGION_HINT } from "../src/view/interactions.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createConnectionCache, createRelChips, mountLazyCrop, previewModel, SCAN_CAP } from "../src/relchips.js";

afterEach(() => resetSessions());

const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({
  ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids,
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const frac = { rx: 0.25, ry: 0.25, rw: 0.5, rh: 0.5 };
const regionText = (uid, caption) => imageRegionString(uid, frac, caption);

function card(uid, string, x, kids = []) {
  return { uid, string, props: { plexus: { x, y: 0, w: 200, h: 160 } }, children: kids };
}

async function sessionFor(children, { page, canEdit } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  if (canEdit) host.canEdit = canEdit;
  if (page) fake.seedPage(page);
  fake.seedBoard({
    uid: "b1",
    string: "{{[[diagram]]:Lab}}",
    props: { plexus: { v: 2 } },
    children,
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  await fake.flush();
  fake.clearLog();
  return { fake, host, session, toasts };
}

function creates(fake) {
  return fake.writesLog().filter((e) => e[0] === "create");
}

const cons = (kids = []) => ({ uid: "cons", string: "Connections", props: { plexus: { type: "edges" } }, children: kids });

// ------------------------------------------------------------------ geometry

test("a cell tip sits inside the cell, and a region anchor sits on the region edge", () => {
  const rect = { x: 0, y: 0, w: 480, h: 260 };
  const measure = { bodyTop: 30, bodyBottom: 260, rowTop: 60, rowHeight: 20, rowLeft: 40, rowRight: 120, cell: true };
  const tip = wireStart(rect, measure, { x: 900, y: 70 });
  const cell = { x: 40, y: 60, w: 80, h: 20 };
  assert.ok(pointInside(tip, cell), `cell tip ${JSON.stringify(tip)}`);
  const inner = blockInner({ rect, side: "right", point: { x: 480, y: 70 }, rowLeft: 40, rowRight: 120, cell: true });
  assert.deepEqual(tip, inner.tip);

  const image = { x: 300, y: 0, w: 200, h: 160 };
  const hit = regionEdgePoint(image, frac, { x: 0, y: 80 });
  const box = regionBox(image, frac);
  assert.ok(pointInside(hit.point, box), `region point ${JSON.stringify(hit.point)} box ${JSON.stringify(box)}`);
  assert.equal(hit.side, "left");
  assert.equal(wireStart({ x: 0, y: 0, w: 200, h: 160 }, { face: true, pin: true }, { x: 0, y: 0 }), null, "a folded pin stays on the card face");
});

test("marqueeFrac ignores a point or a thin stroke and reuses an outline under the pointer", () => {
  const image = { x: 0, y: 0, w: 200, h: 160 };
  assert.equal(marqueeFrac(image, [{ x: 10, y: 10 }]), null);
  assert.equal(marqueeFrac(image, [{ x: 10, y: 10 }, { x: 14, y: 40 }]), null, "narrower than 8px");
  const made = marqueeFrac(image, [{ x: 20, y: 20 }, { x: 80, y: 90 }]);
  assert.ok(made && made.rw > 0 && made.rh > 0);
  assert.deepEqual(regionDropPlan({ from: "c1", imageUid: "img1", regionUid: "reg1" }), { reuse: true, to: "img1", toBlock: "reg1" });
  assert.equal(regionDropPlan({ from: "img1", imageUid: "img1", imageRect: image }), null);
  const plain = regionDropPlan({ from: "c1", imageUid: "img1", imageRect: image });
  assert.equal(plain.create, undefined, "a release on an image never makes a region by itself");
  assert.equal(plain.image, true);
  assert.equal(plain.to, "img1");
  assert.deepEqual(plain.imageRect, image);
  assert.equal(regionBoxFrac(image, { x: 20, y: 20 }, { x: 24, y: 22 }), null, "a click is not a box");
  const boxed = regionBoxFrac(image, { x: 100, y: 80 }, { x: 900, y: 900 });
  assert.deepEqual(boxed, marqueeFrac(image, [{ x: 100, y: 80 }, { x: 200, y: 160 }]), "a box past the edge stops at the edge");
  assert.deepEqual(clampToBox({ x: -5, y: 500 }, image), { x: 0, y: 160 });
});

test("endpointUnderPointer reads a region, a pin, a row, then a cell", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const cardEl = doc.createElement("div");
    cardEl.className = "pxd-item";
    const region = doc.createElement("div");
    region.setAttribute("data-pxd-region", "reg000001");
    const pin = doc.createElement("div");
    pin.setAttribute("data-pxd-pin", "pin000001");
    const row = doc.createElement("div");
    row.setAttribute("data-pxd-row", "row000001");
    const cell = doc.createElement("div");
    cell.className = "rg-cell";
    cell.setAttribute("data-uid", "cell00001");
    cardEl.append(region, pin, row, cell);
    const inner = (node) => { const s = doc.createElement("span"); node.append(s); return s; };
    assert.equal(endpointUnderPointer(inner(region)), "reg000001");
    assert.equal(endpointUnderPointer(inner(pin)), "pin000001");
    assert.equal(endpointUnderPointer(inner(row)), "row000001");
    assert.equal(endpointUnderPointer(inner(cell), (node) => node.closest(".rg-cell")?.getAttribute("data-uid")), "cell00001");
    assert.equal(endpointUnderPointer(cardEl), null);
  } finally { restore(); }
});

// ------------------------------------------------------------------ session writes

test("a cell-to-card arrow stores both blocks, and reversing keeps them", async () => {
  const { session } = await sessionFor([
    card("c1", "note", 0),
    card("c2", "[[P]]", 400),
    cons(),
  ]);
  const uid = await session.addEdge({ from: "c1", to: "c2", fromBlock: "cell00001", toBlock: "row000003", label: "feeds" });
  const edge = session.board.edges.get(uid);
  assert.equal(edge.string, "((cell00001)) → feeds → ((row000003))");
  assert.equal(edge.fromBlock, "cell00001");
  assert.equal(edge.toBlock, "row000003");
  await session.flipEdge(uid);
  const flipped = session.board.edges.get(uid);
  assert.equal(flipped.fromBlock, "row000003");
  assert.equal(flipped.toBlock, "cell00001");
  assert.equal(flipped.string, "((row000003)) → feeds → ((cell00001))");
});

test("a region and its arrow are one transaction: 3 writes, then 2 once the container exists", async () => {
  const { fake, session } = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const uid = await session.addRegionEndpoint({ from: "c1", to: "img1", frac, label: "feeds" });
  assert.equal(creates(fake).length, 3, JSON.stringify(fake.writesLog()));
  const edge = session.board.edges.get(uid);
  assert.match(edge.string, /^\(\(c1\)\) → feeds → \(\([\w-]+\)\)$/);
  assert.equal(edge.to, "img1");
  assert.equal(endpointKindOf(fake.block(edge.toBlock).string), "region");
  assert.match(fake.block(edge.toBlock).string, /Region|feeds/);
  assert.equal(fake.block(edge.toBlock).parent !== "img1", true);
  const box = fake.children("img1").map((id) => fake.block(id)).find((b) => b.string.trim() === "{{[[plexus-regions]]}}");
  assert.ok(box, "the container is under the image");
  assert.equal(fake.children(box.uid).includes(edge.toBlock), true);
  fake.clearLog();
  await fake.flush();
  fake.clearLog();
  const second = await session.addRegionEndpoint({ from: "c1", to: "img1", frac });
  assert.equal(creates(fake).length, 2, `container already there (${JSON.stringify(fake.writesLog())})`);
  assert.match(fake.block(session.board.edges.get(second).toBlock).string, /Region 2/);
});

test("a region on a ((ref)) is written under the source image, and a locked source is refused", async () => {
  const page = { title: "Pics", uid: "pagePics", children: [{ uid: "imgSrc01", string: "![](http://img/a.png)" }] };
  const kids = [
    card("c1", "note", 0),
    card("ref1", "((imgSrc01))", 400),
    cons(),
  ];
  const ok = await sessionFor(kids, { page });
  const uid = await ok.session.addRegionEndpoint({ from: "c1", to: "ref1", frac, label: "spot" });
  const edge = ok.session.board.edges.get(uid);
  assert.match(edge.string, /^\(\(c1\)\) → spot → \(\([\w-]+\)\)$/);
  assert.equal(ok.fake.block(edge.toBlock).parent !== "ref1", true);
  const box = ok.fake.children("imgSrc01").map((id) => ok.fake.block(id)).find((b) => b.string.includes("plexus-regions"));
  assert.ok(box);
  assert.equal(ok.fake.children("ref1").length, 0, "the ref card gains no container");
  resetSessions();

  const locked = await sessionFor(kids, { page, canEdit: () => false });
  locked.fake.clearLog();
  const refused = await locked.session.addRegionEndpoint({ from: "c1", to: "ref1", frac });
  assert.equal(refused, null);
  assert.equal(creates(locked.fake).length, 0);
  assert.deepEqual(locked.toasts, ["That image is on a page you can't edit."]);

  const note = await sessionFor([card("c1", "note", 0), card("c2", "just text", 400), cons()]);
  const nope = await note.session.addRegionEndpoint({ from: "c1", to: "c2", frac });
  assert.equal(nope, null);
  assert.equal(creates(note.fake).length, 0);
  assert.deepEqual(note.toasts, ["That card is not an image."]);
});

test("an arrow may end on another arrow, one level only, and the string names that edge", async () => {
  const { session } = await sessionFor([
    card("c1", "note", 0),
    card("c2", "other", 400),
    cons(),
  ]);
  const base = await session.addEdge({ from: "c1", to: "c2", label: "feeds" });
  const via = await session.addEdge({ from: "c2", to: base, label: "because" });
  const edge = session.board.edges.get(via);
  assert.equal(edge.valid, true);
  assert.equal(edge.toBlock, undefined);
  assert.equal(edge.string, `((c2)) → because → ((${base}))`);
  assert.equal(await session.addEdge({ from: "c1", to: via }), null, "the target already ends on an edge");
  assert.equal(await session.addEdge({ from: base, to: via }), null, "both ends cannot be edges");
  const before = session.board.edges.get(base).to;
  await session.updateEdge(base, { to: via });
  assert.equal(session.board.edges.get(base).to, before, "a retarget onto a second level is ignored");
  await session.updateEdge(via, { label: "still" });
  assert.equal(session.board.edges.get(via).label, "still");
  assert.ok(session.board.edges.get(via).string.includes(`((${base}))`));
});

test("deleting the target edge drops the dependent edge, and a first open does not", async () => {
  const dangling = await sessionFor([
    card("c1", "note", 0),
    card("c2", "other", 400),
    cons([{ uid: "eHang", string: "((c1)) → ((missingE))", props: { plexus: { type: "edge", from: "c1", to: "missingE" } } }]),
  ]);
  await dangling.fake.flush();
  assert.equal(dangling.session.board.edges.has("eHang"), true);
  assert.equal(dangling.fake.writesLog().some((e) => e[0] === "delete"), false, "a target that was never on the board is left alone");

  const { fake, host, session } = await sessionFor([
    card("c1", "note", 0),
    card("c2", "other", 400),
    cons([
      { uid: "eBase01", string: "((c1)) → ((c2))", props: { plexus: { type: "edge", from: "c1", to: "c2" } } },
      { uid: "eDep001", string: "((c2)) → because → ((eBase01))", props: { plexus: { type: "edge", from: "c2", to: "eBase01" } } },
      { uid: "eKeep01", string: "((c1)) → ((c2))", props: { plexus: { type: "edge", from: "c1", to: "c2", fromBlock: "cell00001" } } },
    ]),
  ]);
  assert.equal(session.board.edges.get("eDep001").valid, true);
  assert.equal(session.board.edges.get("eDep001").label, "because");
  assert.equal(session.board.edges.get("eKeep01").fromBlock, "cell00001");
  await session.deleteEdges(["eBase01"]);
  await fake.flush();
  assert.equal(session.board.edges.has("eBase01"), false);
  assert.equal(session.board.edges.has("eDep001"), false);
  assert.equal(session.board.edges.has("eKeep01"), true);

  const again = await sessionFor([
    card("c1", "note", 0),
    card("c2", "other", 400),
    cons([
      { uid: "eBase01", string: "((c1)) → ((c2))", props: { plexus: { type: "edge", from: "c1", to: "c2" } } },
      { uid: "eDep001", string: "((c2)) → because → ((eBase01))", props: { plexus: { type: "edge", from: "c2", to: "eBase01" } } },
    ]),
  ]);
  await again.host.deleteBlock("eBase01");
  for (let i = 0; i < 6; i += 1) {
    await again.fake.flush();
    await tick();
  }
  assert.equal(again.session.board.edges.has("eBase01"), false);
  assert.equal(again.session.board.edges.has("eDep001"), false, "the next reconcile drops the arrow that used the deleted edge");
  assert.equal(host === again.host, false);
});

test("a seeded second level is invalid, and a pdf pin reads as a pin", () => {
  const pin = "{{[[plexus-region]]: k=pdf d=pdf00001 pg=2 f=0.1,0.2,0.3,0.4}} mark";
  assert.equal(endpointKindOf(pin), "pin");
  assert.equal(endpointKindOf(regionText("img1", "Spot")), "region");
  const board = buildBoard(raw("b1", "{{[[diagram]]:Lab}}", plx({ v: 2 }), [
    raw("c1", "note", plx({ x: 0, y: 0, w: 100, h: 60 })),
    raw("c2", "other", plx({ x: 400, y: 0, w: 200, h: 80 })),
    raw("cons", "Connections", plx({ type: "edges" }), [
      raw("eBase01", "((c1)) → ((c2))", plx({ type: "edge", from: "c1", to: "c2" })),
      raw("eDep001", "((c2)) → because → ((eBase01))", plx({ type: "edge", from: "c2", to: "eBase01" })),
      raw("eDeep01", "((c1)) → no → ((eDep001))", plx({ type: "edge", from: "c1", to: "eDep001" })),
    ]),
  ]));
  assert.equal(board.edges.get("eDep001").valid, true);
  assert.equal(board.edges.get("eDeep01").valid, false);
  assert.equal(board.edges.get("eDeep01").level, "blocked");
  assert.equal(edgeMayTarget(board.edges.get("eDep001"), board.edges), false);
  assert.equal(edgeMayTarget(board.edges.get("eBase01"), board.edges), true);
  assert.deepEqual(focusEnds(board, board.edges.get("eDep001")).sort(), ["c1", "c2"]);
  const target = pxdTarget("#/app/g/page/pageUID01?pxd=eDep001");
  assert.equal(target.cardUid, "eDep001");
  assert.deepEqual(focusEnds(board, board.edges.get(target.cardUid)).sort(), ["c1", "c2"]);
});

test("the drawn arrow meets the region edge and the other arrow's midpoint", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    const labels = doc.createElement("div");
    const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over });
    const board = buildBoard(raw("b1", "{{[[diagram]]:Lab}}", plx({ v: 2 }), [
      raw("c1", "note", plx({ x: 0, y: 0, w: 100, h: 60 })),
      raw("img1", "![](http://img/a.png)", plx({ x: 300, y: 0, w: 200, h: 160 })),
      raw("cons", "Connections", plx({ type: "edges" }), [
        raw("eReg001", "((c1)) → ((reg00001))", plx({ type: "edge", from: "c1", to: "img1", toBlock: "reg00001" })),
        raw("eBase01", "((c1)) → ((img1))", plx({ type: "edge", from: "c1", to: "img1" })),
        raw("eDep001", "((img1)) → because → ((eBase01))", plx({ type: "edge", from: "img1", to: "eBase01" })),
      ]),
    ]));
    const rects = worldRects(board);
    layer.setMeasures(new Map([["eReg001", {
      to: { region: true, frac, image: { x: 0, y: 0, w: 200, h: 160 } },
    }]]));
    layer.render({ board, rects, zoom: 1 });
    const box = regionBox({ x: 300, y: 0, w: 200, h: 160 }, frac);
    const end = layer.geometryOf("eReg001").end;
    assert.ok(pointInside(end, box), `drawn end ${JSON.stringify(end)}`);
    assert.equal(layer.geometryOf("eReg001").toInner, null, "a region has no inner notch");
    assert.deepEqual(layer.geometryOf("eDep001").end, layer.geometryOf("eBase01").mid);
    const cell = { x: 10, y: 40, w: 80, h: 20 };
    const fromPoint = wireStart(rects.get("c1"), {
      bodyTop: 10, bodyBottom: 60, rowTop: 30, rowHeight: 20, rowLeft: 10, rowRight: 90, cell: true,
    }, { x: 400, y: 40 });
    assert.ok(pointInside(fromPoint, cell));
    layer.setTempWire({ from: "c1", fromSide: "right", fromPoint, point: { x: 300, y: 40 } }, rects, 1);
    assert.ok(over.querySelector(".pxd-wire"));
  } finally { restore(); }
});

// ------------------------------------------------------------------ gestures

function gestureHarness() {
  const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
    raw("noteA001", "a note", plx({ x: 0, y: 0, w: 200, h: 100 })),
    raw("pageB001", "[[Page]]", plx({ x: 400, y: 0, w: 360, h: 480 })),
    raw("img00001", "![](http://img/a.png)", plx({ x: 400, y: 500, w: 200, h: 160 })),
    raw("ec", "Connections", plx({ type: "edges" }), []),
  ]));
  const rects = worldRects(board);
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const state = { block: null, drop: null };
  const ctl = createInteractions({
    actions: {
      board: () => board,
      rects: () => rects,
      viewport: () => ({ x: 0, y: 0, zoom: 1 }),
      size: () => ({ width: 1000, height: 800 }),
      onSelection: rec("onSelection"),
      onTool: rec("onTool"),
      showTempWire: rec("showTempWire"),
      blockTarget: () => state.block,
      clearBlockTarget: rec("clearBlockTarget"),
      addEdge: (p) => { calls.push(["addEdge", p]); return "newEdge01"; },
      addRegionEndpoint: (p) => { calls.push(["addRegionEndpoint", p]); return "newReg01"; },
      regionDrop: (p) => { calls.push(["regionDrop", p]); return typeof state.drop === "function" ? state.drop(p) : state.drop; },
      addRegionOn: (p) => { calls.push(["addRegionOn", p]); return state.regionOn === undefined ? "regNew01" : state.regionOn; },
      connectHint: rec("connectHint"),
      showMarquee: rec("showMarquee"),
      duplicateItems: rec("duplicateItems"),
      createCard: rec("createCard"),
    },
    settings: { get: () => undefined },
  });
  const ev = (type, world, extra = {}) => ({
    type, screen: world, world, client: world, target: { kind: "empty" }, button: 0, buttons: 1,
    shift: false, alt: false, meta: false, ctrl: false, ...extra,
  });
  const named = (name) => calls.filter((c) => c[0] === name);
  return { ctl, ev, named, state, board };
}

test("Connect from a cell sets fromBlock, and Option-drag does that only for a row", async () => {
  const h = gestureHarness();
  h.ctl.setTool("connect");
  h.state.block = { uid: "pageB001", row: "row000005", header: false };
  h.ctl.handle(h.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001", row: "cell00001" } }));
  assert.equal(h.named("showTempWire")[0][1].fromBlock, "cell00001");
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 200 }));
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 200 }));
  await tick();
  assert.equal(h.named("addEdge").length, 1);
  assert.equal(h.named("addEdge")[0][1].fromBlock, "cell00001");
  assert.equal(h.named("addEdge")[0][1].toBlock, "row000005");
  assert.equal(h.named("regionDrop").length, 0, "a row under the pointer is not a region marquee");

  const opt = gestureHarness();
  opt.state.block = { uid: "pageB001", row: "row000009", header: false };
  opt.ctl.handle(opt.ev("pointerdown", { x: 20, y: 40 }, { alt: true, target: { kind: "item", uid: "noteA001", row: "row000003" } }));
  opt.ctl.handle(opt.ev("pointermove", { x: 500, y: 80 }, { alt: true }));
  opt.ctl.handle(opt.ev("pointerup", { x: 500, y: 80 }, { alt: true }));
  await tick();
  assert.equal(opt.named("duplicateItems").length, 0);
  assert.equal(opt.named("addEdge")[0][1].fromBlock, "row000003");

  const dup = gestureHarness();
  dup.ctl.handle(dup.ev("pointerdown", { x: 20, y: 40 }, { alt: true, target: { kind: "item", uid: "noteA001" } }));
  dup.ctl.handle(dup.ev("pointermove", { x: 80, y: 90 }, { alt: true }));
  dup.ctl.handle(dup.ev("pointerup", { x: 80, y: 90 }, { alt: true }));
  assert.equal(dup.named("addEdge").length, 0);
  assert.equal(dup.named("duplicateItems").length, 1);

  const same = gestureHarness();
  same.ctl.setTool("connect");
  same.ctl.handle(same.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001", row: "cell00001" } }));
  same.ctl.handle(same.ev("pointermove", { x: 40, y: 50 }));
  same.ctl.handle(same.ev("pointerup", { x: 40, y: 50 }, { target: { kind: "item", uid: "noteA001" } }));
  await tick();
  assert.equal(same.named("addEdge").length, 0, "releasing on the same card creates no arrow");
});

const IMG = { x: 400, y: 500, w: 200, h: 160 };
const inImg = (p) => p.client.x >= IMG.x && p.client.x <= IMG.x + IMG.w && p.client.y >= IMG.y && p.client.y <= IMG.y + IMG.h;
const overImage = (p) => (inImg(p) && p.from !== "img00001" ? { image: true, to: "img00001", imageRect: IMG } : null);

test("an angled Connect drag through an image ends on the card and never makes a region", async () => {
  const h = gestureHarness();
  h.ctl.setTool("connect");
  h.state.drop = overImage;
  h.ctl.handle(h.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001" } }));
  h.ctl.handle(h.ev("pointermove", { x: 420, y: 520 }));
  h.ctl.handle(h.ev("pointermove", { x: 470, y: 560 }));
  h.ctl.handle(h.ev("pointermove", { x: 560, y: 640 }));
  h.ctl.handle(h.ev("pointerup", { x: 560, y: 640 }));
  await tick();
  assert.equal(h.named("addRegionEndpoint").length, 0);
  assert.equal(h.named("addRegionOn").length, 0);
  assert.equal(h.named("addEdge").length, 1);
  assert.equal(h.named("addEdge")[0][1].to, "img00001");
  assert.equal(h.named("addEdge")[0][1].toBlock, undefined);
  const hints = h.named("connectHint").map((c) => c[1]);
  assert.ok(hints.includes(REGION_HINT), "the hint shows over the image");
  assert.equal(hints[hints.length - 1], null, "the hint clears when the arrow ends");
});

test("a release on a region outline ends on that region", async () => {
  const reuse = gestureHarness();
  reuse.ctl.setTool("connect");
  reuse.state.drop = { reuse: true, to: "img00001", toBlock: "reg00001" };
  reuse.ctl.handle(reuse.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001" } }));
  reuse.ctl.handle(reuse.ev("pointermove", { x: 450, y: 560 }));
  reuse.ctl.handle(reuse.ev("pointerup", { x: 480, y: 600 }, { alt: true }));
  await tick();
  assert.equal(reuse.named("addEdge")[0][1].toBlock, "reg00001");
  assert.equal(reuse.named("addRegionEndpoint").length, 0);
});

test("Option on release pins the end, then a box on the picture writes the region and the arrow", async () => {
  const h = gestureHarness();
  h.ctl.setTool("connect");
  h.state.drop = overImage;
  h.ctl.handle(h.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001" } }));
  h.ctl.handle(h.ev("pointermove", { x: 450, y: 540 }, { alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 450, y: 540 }, { alt: true, buttons: 0 }));
  await tick();
  assert.equal(h.named("addEdge").length + h.named("addRegionEndpoint").length, 0, "nothing is written on the release");
  assert.equal(h.ctl.gestureKind(), "region-end");
  const pinned = h.named("showTempWire").at(-1)[1];
  assert.deepEqual(pinned.point, { x: 450, y: 540 }, "the end stays at the pointer");
  assert.equal(h.named("connectHint").at(-1)[1], REGION_BOX_HINT);
  // A hover move does not draw a box.
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 600 }, { buttons: 0 }));
  assert.equal(h.named("showMarquee").filter((c) => c[1]).length, 0);
  h.ctl.handle(h.ev("pointerdown", { x: 450, y: 540 }, { target: { kind: "item", uid: "img00001" } }));
  h.ctl.handle(h.ev("pointermove", { x: 520, y: 600 }));
  h.ctl.handle(h.ev("pointermove", { x: 700, y: 900 }));
  const box = h.named("showMarquee").filter((c) => c[1]).at(-1);
  assert.deepEqual(box[1], { x: 450, y: 540, w: 150, h: 120 }, "the box stops at the picture edge");
  assert.equal(box[2], "region");
  h.ctl.handle(h.ev("pointerup", { x: 700, y: 900 }));
  await tick();
  const writes = h.named("addRegionEndpoint");
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].from, "noteA001");
  assert.equal(writes[0][1].to, "img00001");
  assert.deepEqual(writes[0][1].frac, regionBoxFrac(IMG, { x: 450, y: 540 }, { x: 600, y: 660 }));
  assert.equal(h.named("addEdge").length, 0);
  assert.equal(h.ctl.gestureKind(), null);
});

test("Option end: a click is not a box, a press off the picture cancels, and Esc cancels", async () => {
  const start = (h) => {
    h.ctl.setTool("connect");
    h.state.drop = overImage;
    h.ctl.handle(h.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001" } }));
    h.ctl.handle(h.ev("pointermove", { x: 450, y: 540 }, { alt: true }));
    h.ctl.handle(h.ev("pointerup", { x: 450, y: 540 }, { alt: true }));
  };
  const click = gestureHarness();
  start(click);
  click.ctl.handle(click.ev("pointerdown", { x: 460, y: 550 }, { target: { kind: "item", uid: "img00001" } }));
  click.ctl.handle(click.ev("pointerup", { x: 461, y: 551 }));
  assert.equal(click.ctl.gestureKind(), "region-end", "still waiting for a box");
  assert.equal(click.named("addRegionEndpoint").length, 0);

  const lostEnd = gestureHarness();
  start(lostEnd);
  lostEnd.ctl.handle(lostEnd.ev("pointerup", { x: 300, y: 760 }, { target: { kind: "chrome" } }));
  assert.equal(lostEnd.ctl.gestureKind(), null, "a release after a press on chrome cancels the pinned end");

  const off = gestureHarness();
  start(off);
  off.ctl.handle(off.ev("pointerdown", { x: 100, y: 300 }));
  assert.equal(off.ctl.gestureKind(), null);
  off.ctl.handle(off.ev("pointerup", { x: 100, y: 300 }));
  await tick();
  assert.equal(off.named("addRegionEndpoint").length + off.named("addEdge").length + off.named("createCard").length, 0);

  const esc = gestureHarness();
  start(esc);
  esc.ctl.handle(esc.ev("pointerdown", { x: 450, y: 540 }, { target: { kind: "item", uid: "img00001" } }));
  esc.ctl.handle(esc.ev("pointermove", { x: 520, y: 600 }));
  assert.equal(esc.ctl.escape(), true);
  assert.equal(esc.ctl.gestureKind(), null);
  esc.ctl.handle(esc.ev("pointerup", { x: 520, y: 600 }));
  await tick();
  assert.equal(esc.named("addRegionEndpoint").length + esc.named("addEdge").length, 0, "Esc writes nothing");
  assert.equal(esc.named("showMarquee").at(-1)[1], null);
  assert.equal(esc.named("connectHint").at(-1)[1], null);
});

test("Option-drag on a picture with Connect makes a region and the arrow starts from it", async () => {
  const h = gestureHarness();
  h.ctl.setTool("connect");
  h.state.drop = (p) => (inImg(p) ? { image: true, to: "img00001", imageRect: IMG } : null);
  h.ctl.handle(h.ev("pointerdown", { x: 420, y: 520 }, { alt: true, target: { kind: "item", uid: "img00001" } }));
  assert.equal(h.ctl.gestureKind(), "region-start");
  h.ctl.handle(h.ev("pointermove", { x: 480, y: 580 }, { alt: true }));
  assert.equal(h.named("showMarquee").at(-1)[2], "region");
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 600 }, { alt: true }));
  assert.equal(h.named("addRegionOn").length, 1);
  assert.equal(h.named("addRegionOn")[0][1].uid, "img00001");
  assert.deepEqual(h.named("addRegionOn")[0][1].frac, regionBoxFrac(IMG, { x: 420, y: 520 }, { x: 500, y: 600 }));
  assert.equal(h.ctl.gestureKind(), "connect", "the arrow follows the pointer from the region");
  assert.equal(h.named("showTempWire").at(-1)[1].fromBlock, "regNew01");
  h.ctl.handle(h.ev("pointermove", { x: 100, y: 50 }, { buttons: 0 }));
  h.ctl.handle(h.ev("pointerdown", { x: 100, y: 50 }, { target: { kind: "item", uid: "noteA001" } }));
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 50 }, { target: { kind: "item", uid: "noteA001" } }));
  await tick();
  const add = h.named("addEdge");
  assert.equal(add.length, 1);
  assert.equal(add[0][1].from, "img00001");
  assert.equal(add[0][1].fromBlock, "regNew01");
  assert.equal(add[0][1].to, "noteA001");

  // A press the board never saw (the dock kept it) ends with a bare release: that cancels the arrow.
  const lost = gestureHarness();
  lost.ctl.setTool("connect");
  lost.state.drop = (p) => (inImg(p) ? { image: true, to: "img00001", imageRect: IMG } : null);
  lost.ctl.handle(lost.ev("pointerdown", { x: 420, y: 520 }, { alt: true, target: { kind: "item", uid: "img00001" } }));
  lost.ctl.handle(lost.ev("pointermove", { x: 480, y: 580 }, { alt: true }));
  lost.ctl.handle(lost.ev("pointerup", { x: 480, y: 580 }, { alt: true }));
  assert.equal(lost.ctl.gestureKind(), "connect");
  lost.ctl.handle(lost.ev("pointerup", { x: 300, y: 760 }, { target: { kind: "chrome" } }));
  await tick();
  assert.equal(lost.ctl.gestureKind(), null);
  assert.equal(lost.named("addEdge").length + lost.named("createCard").length, 0);

  const tiny = gestureHarness();
  tiny.ctl.setTool("connect");
  tiny.state.drop = (p) => (inImg(p) ? { image: true, to: "img00001", imageRect: IMG } : null);
  tiny.ctl.handle(tiny.ev("pointerdown", { x: 420, y: 520 }, { alt: true, target: { kind: "item", uid: "img00001" } }));
  tiny.ctl.handle(tiny.ev("pointerup", { x: 421, y: 521 }, { alt: true }));
  assert.equal(tiny.named("addRegionOn").length, 0);
  assert.equal(tiny.ctl.gestureKind(), null);

  const plain = gestureHarness();
  plain.ctl.setTool("connect");
  plain.state.drop = (p) => (inImg(p) ? { image: true, to: "img00001", imageRect: IMG } : null);
  plain.ctl.handle(plain.ev("pointerdown", { x: 420, y: 520 }, { target: { kind: "item", uid: "img00001" } }));
  assert.equal(plain.ctl.gestureKind(), "connect", "without Option the picture is an ordinary connect start");
});

test("addRegionOn writes the region under the image with the given uid", async () => {
  const { fake, session } = await sessionFor([card("img1", "![](http://img/a.png)", 0)]);
  const made = await session.addRegionOn({ on: "img1", frac, uid: "regGiven1" });
  await fake.flush();
  assert.equal(made, "regGiven1");
  assert.equal(creates(fake).length, 2, "container and region");
  assert.ok(fake.block("regGiven1").string.includes("k=img d=img1"));
  fake.clearLog();
  await session.addRegionOn({ on: "img1", frac, uid: "regGiven2" });
  await fake.flush();
  assert.equal(creates(fake).length, 1, "the container is reused");
  assert.equal(await session.addRegionOn({ on: "missing", frac, uid: "x" }), null);
});

test("a click on an aimed arrow label ends on that arrow", async () => {
  const aimed = gestureHarness();
  aimed.ctl.setTool("connect");
  const base = aimed.board.edges;
  base.set("eBase01", { uid: "eBase01", from: "noteA001", to: "pageB001", valid: true });
  aimed.ctl.handle(aimed.ev("pointerdown", { x: 420, y: 40 }, { target: { kind: "item", uid: "pageB001" } }));
  aimed.ctl.handle(aimed.ev("pointermove", { x: 200, y: 40 }));
  aimed.ctl.handle(aimed.ev("pointerup", { x: 200, y: 40 }, { target: { kind: "label", uid: "eBase01" } }));
  await tick();
  assert.equal(aimed.named("addEdge")[0][1].to, "eBase01");
  assert.equal("toBlock" in aimed.named("addEdge")[0][1], false);
});

// ------------------------------------------------------------------ outlines

test("an image card paints a region outline and a page card does not", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const host = {
      renderString(node, string) { node.textContent = string; },
      renderBlock() {},
      unmount() {},
      renderPage() {},
      blockString: () => null,
      pullTree: () => [],
      pageOutline: () => ({ exists: true, blocks: [] }),
      watchPage: () => () => {},
      pageUid: () => null,
    };
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const idle = [];
    const r = createItemRenderer({
      doc, host, session: {}, itemsLayer, sectionsLayer,
      timers: { idle(fn) { idle.push(fn); return () => {}; }, later() { return () => {}; } },
    });
    const region = regionText("img00001", "Spot");
    const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
      raw("img00001", "![](http://img/a.png)", plx({ x: 0, y: 0, w: 200, h: 160 }), [
        raw("box00001", "{{[[plexus-regions]]}}", plx({ type: "regions" }), [
          raw("reg00001", region, {}),
        ]),
      ]),
      raw("page0001", "[[Page]]", plx({ x: 400, y: 0, w: 360, h: 200 }), [
        raw("box00002", "{{[[plexus-regions]]}}", plx({ type: "regions" }), [
          raw("reg00002", region, {}),
        ]),
      ]),
    ]));
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -9999, y: -9999, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
    while (idle.length) idle.shift()({ timeRemaining: () => 1000, didTimeout: false });
    const shell = r.shellOf("img00001");
    const hit = [...shell.querySelectorAll(".pxd-region-hit")].find((n) => n.getAttribute("data-pxd-region") === "reg00001");
    assert.ok(hit, "the region outline is on the image");
    assert.equal(hit.classList.contains("pxd-region-hit"), true);
    assert.equal(r.shellOf("page0001").querySelector("[data-pxd-region]"), null, "a page card does not paint region hits");
    shell._rect = { left: 100, top: 200, width: 200, height: 160, right: 300, bottom: 360 };
    const media = shell.querySelector(".pxd-item__media");
    media._rect = { left: 100, top: 220, width: 200, height: 140, right: 300, bottom: 360 };
    hit._rect = { left: 150, top: 255, width: 50, height: 40, right: 200, bottom: 295 };
    r.setRowHot("img00001", "reg00001", true);
    assert.ok(hit.classList.contains("pxd-region-hit--hot"));
    const measured = r.measureRow("img00001", "reg00001");
    const cardRect = worldRects(board).get("img00001");
    const point = wireStart(cardRect, measured, { x: -100, y: 40 });
    const image = {
      x: cardRect.x + measured.image.x,
      y: cardRect.y + measured.image.y,
      w: measured.image.w,
      h: measured.image.h,
    };
    assert.ok(pointInside(point, regionBox(image, measured.frac)), `measured anchor ${JSON.stringify(point)}`);
    r.dispose();
  } finally { restore(); }
});

// ------------------------------------------------------------------ chips and ?pxd

test("endpoint chips name the board, crops stay unloaded, and Open board carries ?pxd", () => {
  assert.equal(endpointChipText({ count: 1, boardTitle: "Endospore board" }), "⇢ 1 on Endospore board");
  const rows = [
    ["edge0001", "board001", "((cardA001)) → spot → ((reg000001))", "Endospore board"],
    ["edge0002", "board001", "((cardA001)) → ((reg000001))", "Endospore board"],
  ];
  const index = endpointIndex(rows);
  assert.equal(index.get("reg000001").count, 2);
  assert.equal(index.has("edge0001"), false, "the connection block is not its own endpoint");
  const cache = createConnectionCache({
    host: {
      listConnectionRefs: () => rows,
      listConnectionBlocks() { throw new Error("refs replace the uid query"); },
    },
  });
  assert.equal(cache.load(), 2);
  assert.equal(cache.endpointOf("reg000001").boardTitle, "Endospore board");
  const old = createConnectionCache({ host: { listConnectionBlocks: () => [["edge0001", "board001"]] } });
  old.load();
  assert.equal(old.endpointUids().size, 0, "a host without the ref query keeps the old chip path");

  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const region = regionText("img00001", "Spot");
    const board = raw("board001", "{{[[diagram]]:Endospore board}}", plx({ v: 2 }), [
      raw("cardA001", "note", plx({ x: 0, y: 0, w: 200, h: 80 })),
      raw("img00001", "![](http://img/a.png)", plx({ x: 400, y: 0, w: 200, h: 160 })),
      raw("cons", "Connections", plx({ type: "edges" }), [
        raw("edge0001", "((cardA001)) → spot → ((reg000001))", plx({ type: "edge", from: "cardA001", to: "img00001", toBlock: "reg000001" })),
      ]),
    ]);
    const texts = { reg000001: region, img00001: "![](http://img/a.png)" };
    const host = {
      listConnectionRefs: () => rows.slice(0, 1),
      pullBoard: () => board,
      blockString: (uid) => texts[uid] || null,
      blockPageUid: () => "pageUID01",
      openInSidebar() {},
    };
    const chips = createRelChips({
      doc, win: stub.window, host, graph: () => "Svy",
      timers: { later: () => () => {}, frame: (fn) => fn() },
    });
    chips.start();
    const outline = (uid, parent) => {
      const container = doc.createElement("div");
      container.className = "roam-block-container";
      const input = doc.createElement("div");
      input.className = "rm-block__input roam-block";
      input.id = `block-input-Svy-body-outline-pageUID01-${uid}`;
      container.append(input);
      (parent || doc.body).append(container);
      return { container, input };
    };
    const end = outline("reg000001");
    chips.scan(end.container);
    const chip = [...end.container.children].find((c) => c.classList.contains("pxd-relchip"));
    assert.ok(chip);
    assert.equal(chip.textContent, "⇢ 1 on Endospore board");
    assert.equal(chip.getAttribute("data-end"), "reg000001");
    const inside = doc.createElement("div");
    inside.className = "pxd-root";
    const hidden = outline("reg000001", inside);
    doc.body.append(inside);
    chips.scan(hidden.container);
    assert.equal(hidden.container.querySelector(".pxd-relchip"), null, "a block inside a board is not chipped again");

    stub.dispatch(chip, "click", {});
    const pop = doc.body.querySelector(".pxd-relpop");
    assert.ok(pop);
    const img = pop.querySelector(".pxd-relpop__crop img");
    assert.ok(img);
    assert.equal(img.getAttribute("src"), null, "the crop waits until it is on screen");
    const open = [...pop.querySelectorAll("button")].find((b) => b.textContent === "Open board");
    assert.ok(open);
    stub.dispatch(open, "click", {});
    assert.match(stub.window.location.hash, /\?pxd=edge0001$/);

    const frame = doc.createElement("div");
    const lazy = mountLazyCrop(doc, frame, { src: "http://img/a.png", frac, win: {} });
    assert.equal(lazy.img.getAttribute("src"), null);
    lazy.show();
    assert.equal(lazy.img.getAttribute("src"), "http://img/a.png");

    const many = doc.createElement("div");
    for (let i = 0; i < SCAN_CAP + 5; i += 1) outline(`reg00000${i}`, many);
    doc.body.append(many);
    const only = createConnectionCache({ host: { listConnectionRefs: () => [] } });
    assert.equal(only.load(), 0);
    chips.dispose();
  } finally { restore(); }
});

test("previewModel draws an arrow-label end and still returns null when both cards are missing", () => {
  const board = buildBoard(raw("b1", "{{[[diagram]]:Lab}}", plx({ v: 2 }), [
    raw("c1", "note", plx({ x: 0, y: 0, w: 100, h: 60 })),
    raw("c2", "other", plx({ x: 400, y: 0, w: 200, h: 80 })),
    raw("cons", "Connections", plx({ type: "edges" }), [
      raw("eBase01", "((c1)) → ((c2))", plx({ type: "edge", from: "c1", to: "c2" })),
      raw("eDep001", "((c2)) → because → ((eBase01))", plx({ type: "edge", from: "c2", to: "eBase01" })),
    ]),
  ]));
  const model = previewModel(board, "eDep001", {});
  assert.ok(model.path);
  assert.ok(model.cards.some((c) => c.title === "arrow"));
  const gone = buildBoard(raw("b1", "{{[[diagram]]:Lab}}", plx({ v: 2 }), [
    raw("cons", "Connections", plx({ type: "edges" }), [
      raw("eGone01", "((missing1)) → ((missing2))", plx({ type: "edge", from: "missing1", to: "missing2" })),
    ]),
  ]));
  assert.equal(previewModel(gone, "eGone01", {}), null);
});

test("imageSourceOf follows a ref only when the source block is an image", () => {
  assert.deepEqual(imageSourceOf({ uid: "img1", kind: "image", string: "![](http://img/a.png)" }, () => null), { ok: true, uid: "img1", viaRef: false });
  assert.equal(imageSourceOf({ uid: "r1", kind: "block", string: "((imgSrc01))" }, () => "![](http://img/a.png)").uid, "imgSrc01");
  assert.equal(imageSourceOf({ uid: "r1", kind: "block", string: "((imgSrc01))" }, () => null).reason, "unread");
  assert.equal(imageSourceOf({ uid: "n1", kind: "note", string: "hello" }, () => null).reason, "not-image");
});
