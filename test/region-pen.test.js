// Image regions: painted-rect accuracy, the pen (k=imgpoly), and the delete cascade.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { endpointHitsOf, endpointKindOf, pickSmallestRegion, regionPolyFrac } from "../src/model/endpoints.js";
import {
  fracFromDrag,
  imagePolyString,
  imageRegionFrac,
  imageRegionString,
  paintedContentRect,
  paintedRectOfElement,
  polygonClipInBox,
  regionDrawMode,
  setRegionDrawMode,
  simplifyPoly,
} from "../src/model/image-region.js";
import { parseRegion } from "../src/model/regions.js";
import { cropFrame } from "../src/view/region-crop.js";
import { mountRegionCrop, resetCropUrls } from "../src/view/region-crop.js";
import { mountRegionMark } from "../src/view/region-mark.js";
import { createInteractions, REGION_BOX_HINT, REGION_PEN_HINT } from "../src/view/interactions.js";
import { emptyLabelShouldDeleteEdge } from "../src/view/interactions.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createChrome } from "../src/view/chrome.js";
import { createClipboardIO } from "../src/view/clipboard-io.js";
import { mountLazyCrop } from "../src/relchips.js";

afterEach(() => { resetSessions(); resetCropUrls(); });

const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({
  ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids,
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const frac = { rx: 0.25, ry: 0.25, rw: 0.5, rh: 0.5 };

function card(uid, string, x, kids = []) {
  return { uid, string, props: { plexus: { x, y: 0, w: 200, h: 160 } }, children: kids };
}
const cons = (kids = []) => ({ uid: "cons", string: "Connections", props: { plexus: { type: "edges" } }, children: kids });

async function sessionFor(children) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    string: "{{[[diagram]]:Lab}}",
    props: { plexus: { v: 2 } },
    children,
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  await fake.flush();
  fake.clearLog();
  return { fake, host, session };
}

function regionsBox(fake, imageUid) {
  return fake.children(imageUid).find((id) => String(fake.block(id).string).trim() === "{{[[plexus-regions]]}}") || null;
}

const box = (x, y, width, height) => ({ left: x, top: y, width, height, right: x + width, bottom: y + height, x, y });

function near(actual, expected, slack = 1e-6) {
  assert.ok(Math.abs(actual - expected) < slack, `${actual} vs ${expected}`);
}

// ------------------------------------------------------------------ painted rect

test("a tall card letterboxes a wide image onto the centered picture", () => {
  const cardBox = box(0, 0, 200, 400);
  const natural = { width: 800, height: 400 };
  const painted = paintedContentRect(cardBox, natural, { fit: "contain" });
  assert.deepEqual(painted, { left: 0, top: 150, width: 200, height: 100 });
});

test("object-position top puts the picture at the top of the card", () => {
  const painted = paintedContentRect(box(0, 0, 200, 400), { width: 800, height: 400 }, { fit: "contain", position: "top" });
  assert.deepEqual(painted, { left: 0, top: 0, width: 200, height: 100 });
});

test("a wide card pillarboxes a tall image", () => {
  const painted = paintedContentRect(box(0, 0, 400, 200), { width: 400, height: 800 }, { fit: "contain" });
  assert.deepEqual(painted, { left: 150, top: 0, width: 100, height: 200 });
});

test("padding and border are CSS pixels scaled by the board zoom", () => {
  const painted = paintedContentRect(box(0, 0, 220, 420), { width: 800, height: 400 }, {
    fit: "contain",
    zoom: 2,
    padding: { t: 10, r: 10, b: 10, l: 10 },
    border: { t: 0, r: 0, b: 0, l: 0 },
  });
  // Content box is inset by 20 screen px, then the 800×400 picture is contained in 180×380.
  const contentW = 220 - 40;
  const contentH = 420 - 40;
  const scale = Math.min(contentW / 800, contentH / 400);
  assert.equal(painted.left, 20 + (contentW - 800 * scale) / 2);
  assert.equal(painted.top, 20 + (contentH - 400 * scale) / 2);
  assert.equal(painted.width, 800 * scale);
  assert.equal(painted.height, 400 * scale);
});

test("drag, stored fraction, outline, and crop pixels match at zoom 0.5, 1, and 2", () => {
  const natural = { width: 800, height: 400 };
  for (const zoom of [0.5, 1, 2]) {
    const screen = box(10 * zoom, 20 * zoom, 200 * zoom, 400 * zoom);
    const painted = paintedContentRect(screen, natural, { fit: "contain", zoom });
    const x0 = painted.left + painted.width * 0.25;
    const y0 = painted.top + painted.height * 0.25;
    const x1 = painted.left + painted.width * 0.75;
    const y1 = painted.top + painted.height * 0.75;
    const made = fracFromDrag(painted, x0, y0, x1, y1);
    near(made.rx, 0.25);
    near(made.ry, 0.25);
    near(made.rw, 0.5);
    near(made.rh, 0.5);
    const outline = {
      left: painted.left + made.rx * painted.width,
      top: painted.top + made.ry * painted.height,
      width: made.rw * painted.width,
      height: made.rh * painted.height,
    };
    near(outline.left, x0, 1);
    near(outline.top, y0, 1);
    near(outline.width, x1 - x0, 1);
    near(outline.height, y1 - y0, 1);
    // The crop reads the same fractions against the file's pixels.
    near(made.rx * natural.width, 200, 1);
    near(made.ry * natural.height, 100, 1);
    near(made.rw * natural.width, 400, 1);
    near(made.rh * natural.height, 200, 1);
    const frame = cropFrame(made, natural.width, natural.height, 200);
    near(frame.frameW / frame.imgW, made.rw);
    near(frame.frameH / frame.imgH, made.rh);
  }
});

test("paintedRectOfElement reads inline object-fit when computed style has no objectFit", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const img = stub.document.createElement("img");
    img.naturalWidth = 800;
    img.naturalHeight = 400;
    img.style.objectFit = "contain";
    img.style.objectPosition = "center";
    img._rect = box(0, 0, 200, 400);
    assert.deepEqual(paintedRectOfElement(img, { zoom: 1 }), { left: 0, top: 150, width: 200, height: 100 });
    img.style.objectPosition = "top";
    assert.equal(paintedRectOfElement(img, { zoom: 2 }).top, 0);
  } finally { restore(); }
});

// ------------------------------------------------------------------ pen format

test("simplifyPoly caps a noisy stroke at 64 points", () => {
  const points = [];
  for (let i = 0; i < 400; i += 1) {
    const t = (i / 400) * Math.PI * 2;
    points.push({ x: 0.5 + 0.4 * Math.cos(t) + (i % 3) * 0.002, y: 0.5 + 0.4 * Math.sin(t) });
  }
  const out = simplifyPoly(points);
  assert.ok(out.length >= 3);
  assert.ok(out.length <= 64);
});

test("a pen region is k=imgpoly with i=0 and p=, and a box stays k=img with f=", async () => {
  const poly = [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.45, y: 0.9 }];
  const text = imagePolyString("card1", poly, "Region 1");
  assert.match(text, /^\{\{\[\[plexus-region\]\]: k=imgpoly d=card1 i=0 p=[0-9.,]+\}\} Region 1$/);
  assert.equal(text.includes("f="), false);
  const ours = parseRegion(text);
  assert.equal(ours.kind, "imgpoly");
  assert.equal(ours.supported, false);
  assert.equal(ours.i, 0);
  assert.ok(ours.p.length >= 6);
  assert.equal(endpointKindOf(text), "region");

  const boxText = imageRegionString("card1", frac, "Spot");
  assert.match(boxText, /k=img d=card1 f=/);
  assert.equal(parseRegion(boxText).supported, true);

  const roamFile = new URL("../../roam-plexus/src/model/region.js", import.meta.url);
  if (!existsSync(roamFile)) return;
  const roam = await import(roamFile.href);
  const parsed = roam.parseRegion(text);
  assert.equal(parsed.supported, true);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.kind, "imgpoly");
  assert.ok(Array.isArray(parsed.p) && parsed.p.length >= 6);
  assert.equal(roam.parseRegion(boxText).supported, false);
});

test("endpoint hits carry the polygon and its bbox, and the smallest outline wins", () => {
  const text = imagePolyString("img1", [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.7 }, { x: 0.2, y: 0.7 }], "Lasso");
  const hits = endpointHitsOf([{
    string: "{{[[plexus-regions]]}}",
    children: [{ uid: "r1", string: text }],
  }]);
  assert.equal(hits.regions.length, 1);
  assert.ok(hits.regions[0].poly.length >= 3);
  const boxFrac = imageRegionFrac(parseRegion(text));
  assert.deepEqual(hits.regions[0].frac, [boxFrac.rx, boxFrac.ry, boxFrac.rw, boxFrac.rh]);
  assert.equal(pickSmallestRegion([
    { uid: "big", area: 0.5 },
    { uid: "small", area: 0.1 },
    { uid: "mid", area: 0.2 },
  ]), "small");
  assert.equal(pickSmallestRegion([{ uid: "unknown" }, { uid: "known", area: 0.2 }]), "known");
  assert.equal(pickSmallestRegion([{ uid: "a", area: 0.2 }, { uid: "b", area: 0.2 }]), "a");
  assert.equal(endpointKindOf("{{[[plexus-pin]]: d=pdf1 pg=1 f=0.1,0.2,0.3,0.4}} Spot"), "pin");
});

// ------------------------------------------------------------------ delete cascade

test("deleting the arrow deletes its region and the empty container, as one undo", async () => {
  const { fake, host, session } = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const edgeUid = await session.addRegionEndpoint({ from: "c1", to: "img1", frac, label: "feeds" });
  await fake.flush();
  const edge = session.board.edges.get(edgeUid);
  const regionUid = edge.toBlock;
  const boxUid = regionsBox(fake, "img1");
  assert.ok(regionUid && boxUid);
  assert.equal(fake.has(regionUid), true);
  fake.clearLog();
  await session.deleteEdges([edgeUid]);
  await fake.flush();
  assert.equal(fake.has(edgeUid), false);
  assert.equal(fake.has(regionUid), false);
  assert.equal(regionsBox(fake, "img1"), null);
  assert.equal(host.stats.lastAction.writes, 3);
  assert.ok(host.stats.lastAction.writes <= 45);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 3);
});

test("a pen stroke is stored as k=imgpoly and deleting that arrow removes it too", async () => {
  const { fake, session } = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const poly = [{ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.15 }, { x: 0.6, y: 0.8 }, { x: 0.15, y: 0.7 }];
  const edgeUid = await session.addRegionEndpoint({ from: "c1", to: "img1", frac, poly });
  await fake.flush();
  const regionUid = session.board.edges.get(edgeUid).toBlock;
  const text = fake.block(regionUid).string;
  assert.match(text, /k=imgpoly d=img1 i=0 p=/);
  assert.equal(text.includes(" f="), false);
  await session.deleteEdges([edgeUid]);
  await fake.flush();
  assert.equal(fake.has(edgeUid), false);
  assert.equal(fake.has(regionUid), false);
  assert.equal(regionsBox(fake, "img1"), null);
});

test("a second arrow, a foreign ref, a child note, or a failed query keeps the region", async () => {
  const { fake, host, session } = await sessionFor([
    card("c1", "note", 0),
    card("c2", "other", 200),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const first = await session.addRegionEndpoint({ from: "c1", to: "img1", frac });
  await fake.flush();
  const regionUid = session.board.edges.get(first).toBlock;
  const second = await session.addEdge({ from: "c2", to: "img1", toBlock: regionUid });
  await fake.flush();
  await session.deleteEdges([first]);
  await fake.flush();
  assert.equal(fake.has(first), false);
  assert.equal(fake.has(regionUid), true, "the other arrow still uses it");
  assert.equal(fake.has(second), true);

  const alone = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const edgeUid = await alone.session.addRegionEndpoint({ from: "c1", to: "img1", frac });
  await alone.fake.flush();
  const kept = alone.session.board.edges.get(edgeUid).toBlock;
  alone.fake.onQuery(/block\/refs/, () => [["note999"]]);
  await alone.session.deleteEdges([edgeUid]);
  await alone.fake.flush();
  assert.equal(alone.fake.has(edgeUid), false);
  assert.equal(alone.fake.has(kept), true, "a block outside this board still references it");

  const noted = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const notedEdge = await noted.session.addRegionEndpoint({ from: "c1", to: "img1", frac });
  await noted.fake.flush();
  const notedRegion = noted.session.board.edges.get(notedEdge).toBlock;
  await noted.host.createBlock({ parentUid: notedRegion, string: "keep me", order: "last" });
  await noted.fake.flush();
  await noted.session.deleteEdges([notedEdge]);
  await noted.fake.flush();
  assert.equal(noted.fake.has(notedRegion), true);

  const blank = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const blankEdge = await blank.session.addRegionEndpoint({ from: "c1", to: "img1", frac });
  await blank.fake.flush();
  const blankRegion = blank.session.board.edges.get(blankEdge).toBlock;
  await blank.host.createBlock({ parentUid: blankRegion, string: "   ", order: "last" });
  await blank.session.setRegionCaption(blankRegion, "renamed");
  await blank.fake.flush();
  await blank.session.deleteEdges([blankEdge]);
  await blank.fake.flush();
  assert.equal(blank.fake.has(blankRegion), false, "a caption edit and a blank child do not keep it");

  const down = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const downEdge = await down.session.addRegionEndpoint({ from: "c1", to: "img1", frac });
  await down.fake.flush();
  const downRegion = down.session.board.edges.get(downEdge).toBlock;
  down.fake.setQ(() => { throw new Error("query down"); });
  await down.session.deleteEdges([downEdge]);
  await down.fake.flush();
  assert.equal(down.fake.has(downRegion), true);
  assert.equal(host.stats.lastAction.writes <= 45, true);
});

test("a pin endpoint is not deleted with the arrow", async () => {
  const pin = "{{[[plexus-pin]]: d=pdf1 pg=1 f=0.1,0.2,0.3,0.4}} Spot";
  const { fake, session } = await sessionFor([
    card("c1", "note", 0),
    card("pdf1", "{{[[pdf]]: http://x/a.pdf}}", 400, [{
      uid: "pins1",
      string: "{{[[plexus-pins]]}}",
      props: { plexus: { type: "regions" } },
      children: [{ uid: "pin1", string: pin }],
    }]),
    cons([{ uid: "ePin", string: "((c1)) → ((pin1))", props: { plexus: { type: "edge", from: "c1", to: "pdf1", toBlock: "pin1" } } }]),
  ]);
  assert.equal(endpointKindOf(fake.block("pin1").string), "pin");
  await session.deleteEdges(["ePin"]);
  await fake.flush();
  assert.equal(fake.has("ePin"), false);
  assert.equal(fake.has("pin1"), true);
  assert.equal(fake.has("pins1"), true);
});

test("deleting the region itself deletes the arrows that end on it, as one undo", async () => {
  const { fake, host, session } = await sessionFor([
    card("c1", "note", 0),
    card("img1", "![](http://img/a.png)", 400),
    cons(),
  ]);
  const edgeUid = await session.addRegionEndpoint({ from: "c1", to: "img1", frac });
  await fake.flush();
  const regionUid = session.board.edges.get(edgeUid).toBlock;
  await host.createBlock({ parentUid: regionUid, string: "a note", order: "last" });
  await fake.flush();
  fake.calls.length = 0;
  await session.deleteRegion(regionUid);
  await fake.flush();
  assert.equal(fake.has(regionUid), false);
  assert.equal(fake.has(edgeUid), false);
  assert.equal(regionsBox(fake, "img1"), null);
  const writes = host.stats.lastAction.writes;
  assert.ok(writes >= 2 && writes <= 45);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, writes);
});

// ------------------------------------------------------------------ gestures

function memoryStorage() {
  const bag = new Map();
  return {
    getItem(k) { return bag.has(k) ? bag.get(k) : null; },
    setItem(k, v) { bag.set(k, String(v)); },
    removeItem(k) { bag.delete(k); },
  };
}

function gestureHarness() {
  const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
    raw("noteA001", "a note", plx({ x: 0, y: 0, w: 200, h: 100 })),
    raw("img00001", "![](http://img/a.png)", plx({ x: 400, y: 500, w: 200, h: 160 })),
    raw("ec", "Connections", plx({ type: "edges" }), []),
  ]));
  const rects = worldRects(board);
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const IMG = { x: 400, y: 500, w: 200, h: 160 };
  const ctl = createInteractions({
    actions: {
      board: () => board,
      rects: () => rects,
      viewport: () => ({ x: 0, y: 0, zoom: 1 }),
      size: () => ({ width: 1000, height: 800 }),
      onSelection: rec("onSelection"),
      showTempWire: rec("showTempWire"),
      showMarquee: rec("showMarquee"),
      showRegionPen: rec("showRegionPen"),
      connectHint: rec("connectHint"),
      addEdge: rec("addEdge"),
      addRegionEndpoint: rec("addRegionEndpoint"),
      addRegionOn: (p) => { calls.push(["addRegionOn", p]); return "regNew01"; },
      regionDrop: (p) => {
        calls.push(["regionDrop", p]);
        const x = p?.client?.x;
        const y = p?.client?.y;
        if (x >= IMG.x && x <= IMG.x + IMG.w && y >= IMG.y && y <= IMG.y + IMG.h && p.from !== "img00001") {
          return { image: true, to: "img00001", imageRect: IMG };
        }
        return null;
      },
      deleteEdges: rec("deleteEdges"),
      deleteRegion: rec("deleteRegion"),
      editRegionCaption: rec("editRegionCaption"),
      present: rec("present"),
      toast: rec("toast"),
      undo: rec("undo"),
    },
    settings: { get: () => undefined },
  });
  const ev = (type, world, extra = {}) => ({
    type, screen: world, world, client: world, target: { kind: "empty" }, button: 0, buttons: 1,
    shift: false, alt: false, meta: false, ctrl: false, ...extra,
  });
  const named = (name) => calls.filter((c) => c[0] === name);
  return { ctl, ev, named, board, IMG };
}

test("pen mode on a Connect start and an Option release stores the stroke", async () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  setRegionDrawMode("pen");
  try {
    const start = gestureHarness();
    start.ctl.setTool("connect");
    start.ctl.handle(start.ev("pointerdown", { x: 420, y: 520 }, { alt: true, target: { kind: "item", uid: "img00001" } }));
    start.ctl.handle(start.ev("pointermove", { x: 500, y: 530 }, { alt: true }));
    start.ctl.handle(start.ev("pointermove", { x: 520, y: 620 }, { alt: true }));
    start.ctl.handle(start.ev("pointermove", { x: 430, y: 610 }, { alt: true }));
    assert.ok(start.named("showRegionPen").some((row) => Array.isArray(row[1]) && row[1].length >= 3));
    start.ctl.handle(start.ev("pointerup", { x: 430, y: 560 }, { alt: true }));
    await tick();
    const on = start.named("addRegionOn");
    assert.equal(on.length, 1);
    assert.ok(on[0][1].poly.length >= 3);
    assert.equal(on[0][1].frac.rw > 0 && on[0][1].frac.rh > 0, true);

    const end = gestureHarness();
    end.ctl.setTool("connect");
    end.ctl.handle(end.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001" } }));
    end.ctl.handle(end.ev("pointermove", { x: 450, y: 540 }, { alt: true }));
    end.ctl.handle(end.ev("pointerup", { x: 450, y: 540 }, { alt: true, buttons: 0 }));
    assert.equal(end.ctl.gestureKind(), "region-end");
    assert.equal(end.named("connectHint").at(-1)[1], REGION_PEN_HINT);
    end.ctl.handle(end.ev("pointerdown", { x: 420, y: 520 }, { target: { kind: "item", uid: "img00001" } }));
    end.ctl.handle(end.ev("pointermove", { x: 520, y: 530 }));
    end.ctl.handle(end.ev("pointermove", { x: 540, y: 640 }));
    end.ctl.handle(end.ev("pointerup", { x: 430, y: 620 }));
    await tick();
    const wrote = end.named("addRegionEndpoint");
    assert.equal(wrote.length, 1);
    assert.equal(wrote[0][1].from, "noteA001");
    assert.equal(wrote[0][1].to, "img00001");
    assert.ok(wrote[0][1].poly.length >= 3);
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  }
});

test("P toggles the pen while a region gesture is active and does not start Present", () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  setRegionDrawMode("box");
  try {
    const h = gestureHarness();
    h.ctl.setTool("connect");
    h.ctl.handle(h.ev("pointerdown", { x: 20, y: 40 }, { target: { kind: "item", uid: "noteA001" } }));
    h.ctl.handle(h.ev("pointermove", { x: 450, y: 540 }, { alt: true }));
    h.ctl.handle(h.ev("pointerup", { x: 450, y: 540 }, { alt: true, buttons: 0 }));
    assert.equal(h.named("connectHint").at(-1)[1], REGION_BOX_HINT);
    assert.equal(h.ctl.handle({ type: "keydown", key: "p" }), true);
    assert.equal(h.named("present").length, 0);
    assert.equal(h.named("connectHint").at(-1)[1], REGION_PEN_HINT);
    assert.equal(regionDrawMode(), "pen");
    assert.equal(h.ctl.handle({ type: "keydown", key: "p", inputFocused: true }), false);
    assert.equal(regionDrawMode(), "pen");
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  }
});

test("clicking a region outline selects it, Delete removes it, and a double-click edits the caption", async () => {
  const h = gestureHarness();
  h.ctl.handle(h.ev("pointerdown", { x: 450, y: 560 }, {
    target: { kind: "item", uid: "img00001", region: true, row: "reg00001" },
  }));
  assert.equal(h.ctl.getSelection().region.uid, "reg00001");
  assert.equal(h.ctl.getSelection().edge, null);
  h.ctl.handle({ type: "keydown", key: "Delete" });
  await tick();
  assert.equal(h.named("deleteRegion")[0][1], "reg00001");
  assert.equal(h.named("deleteEdges").length, 0);
  assert.equal(h.named("toast")[0][1].message, "Region deleted");

  const dbl = gestureHarness();
  dbl.ctl.handle(dbl.ev("pointerdown", { x: 450, y: 560 }, {
    detail: 2,
    target: { kind: "item", uid: "img00001", region: true, row: "reg00001" },
  }));
  assert.equal(dbl.named("editRegionCaption").length, 1);
  const again = gestureHarness();
  again.ctl.handle({ type: "dblclick", target: { kind: "item", uid: "img00001", region: true, row: "reg00001" } });
  assert.equal(again.named("editRegionCaption").length, 1);
});

test("Delete on a selected arrow deletes the connection block", async () => {
  const h = gestureHarness();
  h.board.edges.set("e1", { uid: "e1", from: "noteA001", to: "img00001", valid: true, toBlock: "reg00001" });
  h.ctl.selectEdge("e1");
  h.ctl.handle({ type: "keydown", key: "Backspace" });
  await tick();
  assert.deepEqual(h.named("deleteEdges")[0][1], ["e1"]);
  assert.equal(h.named("toast")[0][1].message, "Connection deleted");
});

test("an empty arrow label deletes the arrow; a label with text does not", () => {
  assert.equal(emptyLabelShouldDeleteEdge({
    key: "Delete", edgeSelected: true, inLabel: true, empty: true,
  }), true);
  assert.equal(emptyLabelShouldDeleteEdge({
    key: "Backspace", edgeSelected: true, inLabel: true, empty: true,
  }), true);
  assert.equal(emptyLabelShouldDeleteEdge({
    key: "Delete", edgeSelected: true, inLabel: true, empty: false,
  }), false);
  assert.equal(emptyLabelShouldDeleteEdge({
    key: "Delete", meta: true, edgeSelected: true, inLabel: true, empty: true,
  }), false);
  assert.equal(emptyLabelShouldDeleteEdge({
    key: "Delete", edgeSelected: false, inLabel: true, empty: true,
  }), false);
});

test("the edge toolbar trash and the context-menu trash call delete", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    root._rect = box(0, 0, 1200, 900);
    stub.document.body.append(root);
    const calls = [];
    const chrome = createChrome({
      doc: stub.document,
      root,
      version: "3.9.0",
      settings: {},
      timers: { later: () => () => {}, frame: () => () => {} },
      on: { delete: () => calls.push("delete") },
    });
    chrome.ctx.show("edge", { dir: "one", route: "curve", dash: "solid", weight: 2 }, () => ({
      kind: "edge",
      rect: { x: 200, y: 200, w: 80, h: 20 },
    }));
    const button = root.querySelector(".pxd-ctx__delete");
    assert.ok(button);
    button.click();
    assert.deepEqual(calls, ["delete"]);
    chrome.dispose?.();
  } finally { restore(); }
});

test("cutting a selected arrow, including from an empty label, deletes it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const calls = [];
    const io = createClipboardIO({
      doc: stub.document,
      ownsKeyboard: () => true,
      isTextEntry: () => false,
      on: {
        getPayload: () => ({ text: "((a)) → ((b))", mime: JSON.stringify({ kind: "edge", uid: "e1" }) }),
        cutDone: () => calls.push("cut"),
      },
    });
    const data = { store: {}, setData(type, value) { this.store[type] = value; } };
    stub.dispatch(stub.document.body, "cut", { clipboardData: data });
    assert.deepEqual(calls, ["cut"]);
    assert.equal(data.store["text/plain"], "((a)) → ((b))");
    io.dispose?.();

    const labelCalls = [];
    const label = stub.document.createElement("input");
    label.className = "pxd-why__label";
    label.value = "";
    stub.document.body.append(label);
    const filled = stub.document.createElement("input");
    filled.className = "pxd-why__label";
    filled.value = "feeds";
    stub.document.body.append(filled);
    const labelIo = createClipboardIO({
      doc: stub.document,
      ownsKeyboard: () => false,
      isTextEntry: (node) => node?.tagName === "INPUT",
      on: {
        emptyEdgeLabel: (event) => {
          const node = event.target?.classList?.contains("pxd-why__label") ? event.target : null;
          return Boolean(node) && String(node.value ?? "").trim() === "";
        },
        getPayload: () => ({ text: "((a)) → ((b))", mime: "{\"kind\":\"edge\"}" }),
        cutDone: () => labelCalls.push("cut"),
      },
    });
    stub.dispatch(label, "cut", { clipboardData: { setData() {} } });
    assert.deepEqual(labelCalls, ["cut"]);
    stub.dispatch(filled, "cut", { clipboardData: { setData() {} } });
    assert.deepEqual(labelCalls, ["cut"]);
    labelIo.dispose?.();
  } finally { restore(); }
});

test("a freehand stroke in world space becomes image fractions", () => {
  const image = { x: 400, y: 500, w: 200, h: 160 };
  const made = regionPolyFrac(image, [
    { x: 420, y: 520 },
    { x: 520, y: 530 },
    { x: 540, y: 640 },
    { x: 430, y: 620 },
  ]);
  assert.ok(made.poly.length >= 3 && made.poly.length <= 64);
  assert.ok(made.frac.rw > 0 && made.frac.rh > 0);
  assert.equal(regionPolyFrac(image, [{ x: 420, y: 520 }, { x: 424, y: 522 }]), null);
});

// ------------------------------------------------------------------ outlines and crops

test("outlines sit on the painted picture, smallest on top, and a polygon is a stroke", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const host = {
      renderString(node, string) {
        node.textContent = string;
        if (!String(string).startsWith("![]")) return;
        const img = doc.createElement("img");
        img.className = "rm-inline-img";
        img.naturalWidth = 800;
        img.naturalHeight = 400;
        img.style.objectFit = "contain";
        const text = String(string);
        const media = node.parentElement?.parentElement;
        const tall = box(0, 0, 200, 400);
        if (media) media._rect = tall;
        if (text.includes("top.png")) {
          img.style.objectPosition = "top";
          img._rect = tall;
        } else if (text.includes("mid.png")) {
          img._rect = tall;
        } else {
          img._rect = box(0, 0, 200, 100);
        }
        node.append(img);
      },
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
    doc.body.append(itemsLayer);
    const idle = [];
    const r = createItemRenderer({
      doc, host, session: {}, itemsLayer, sectionsLayer: doc.createElement("div"),
      timers: { idle(fn) { idle.push(fn); return () => {}; }, later() { return () => {}; } },
    });
    const big = imageRegionString("imgA", { rx: 0.1, ry: 0.1, rw: 0.8, rh: 0.8 }, "Big");
    const small = imageRegionString("imgA", { rx: 0.2, ry: 0.2, rw: 0.2, rh: 0.2 }, "Small");
    const poly = imagePolyString("imgA", [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.5, y: 0.7 }], "Pen");
    const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
      raw("imgA", "![](http://img/a.png)", plx({ x: 0, y: 0, w: 200, h: 400 }), [
        raw("boxA", "{{[[plexus-regions]]}}", plx({ type: "regions" }), [
          raw("regBig", big, {}),
          raw("regPen", poly, {}),
          raw("regSmall", small, {}),
        ]),
      ]),
      raw("imgTop", "![](http://img/top.png)", plx({ x: 300, y: 0, w: 200, h: 400 }), [
        raw("boxT", "{{[[plexus-regions]]}}", plx({ type: "regions" }), [
          raw("regTop", imageRegionString("imgTop", frac, "Top"), {}),
        ]),
      ]),
      raw("imgMid", "![](http://img/mid.png)", plx({ x: 600, y: 0, w: 200, h: 400 }), [
        raw("boxM", "{{[[plexus-regions]]}}", plx({ type: "regions" }), [
          raw("regMid", imageRegionString("imgMid", frac, "Mid"), {}),
        ]),
      ]),
    ]));
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -9999, y: -9999, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
    while (idle.length) idle.shift()({ timeRemaining: () => 1000, didTimeout: false });
    const shell = r.shellOf("imgA");
    const layer = shell.querySelector(".pxd-region-hits");
    assert.equal(layer.style.top, "0%");
    assert.equal(layer.style.height, "25%");
    const hits = [...shell.querySelectorAll(".pxd-region-hit")];
    assert.deepEqual(hits.map((n) => n.getAttribute("data-pxd-region")), ["regBig", "regPen", "regSmall"]);
    const pen = hits[1];
    assert.equal(pen.classList.contains("pxd-region-hit--poly"), true);
    assert.match(pen.style.clipPath, /^polygon\(/);
    assert.equal(pen.querySelector("polygon").getAttribute("fill"), "transparent");
    assert.equal(hits[0].classList.contains("pxd-region-hit--poly"), false);
    r.setRegionOn("imgA", "regSmall", true);
    assert.equal(hits[2].classList.contains("pxd-region-hit--on"), true);
    const topLayer = r.shellOf("imgTop").querySelector(".pxd-region-hits");
    assert.equal(topLayer.style.top, "0%");
    assert.equal(topLayer.style.height, "25%");
    const midLayer = r.shellOf("imgMid").querySelector(".pxd-region-hits");
    assert.equal(midLayer.style.top, "37.5%");
    assert.equal(midLayer.style.height, "25%");
    r.dispose();
  } finally { restore(); }
});

test("region outlines stay hidden until the card or the arrow shows them", async () => {
  const css = await readFile(new URL("../src/css/region-hover.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-region-hit\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.pxd-item:hover \.pxd-region-hit[\s\S]*\.pxd-region-hit--on\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /\.pxd-region-hit--poly\s*\{[^}]*background:\s*transparent/);
  const ext = await readFile(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(ext, /\.pxd-region-pen\s*\{[^}]*fill:\s*transparent/);
});

test("the mark overlay's pen follows the painted picture, and a box confirm stays a rectangle", () => {
  const stub = createDomStub();
  const restore = stub.install();
  setRegionDrawMode("box");
  try {
    const root = stub.document.createElement("div");
    root._rect = box(0, 0, 800, 600);
    const img = stub.document.createElement("img");
    img.naturalWidth = 800;
    img.naturalHeight = 400;
    img.style.objectFit = "contain";
    img._rect = box(0, 0, 200, 400);
    root.append(img);
    stub.document.body.append(root);
    const seen = [];
    mountRegionMark({
      doc: stub.document,
      root,
      img,
      onConfirm: (value) => seen.push(value),
    });
    const modeButton = (label) => [...root.querySelectorAll(".pxd-region-mode")].find((node) => node.textContent === label);
    const pen = modeButton("Pen");
    pen.click();
    assert.equal(pen.getAttribute("aria-pressed"), "true");
    const layer = root.querySelector(".pxd-region-layer");
    stub.dispatch(layer, "pointerdown", { clientX: 0, clientY: 150, button: 0 });
    stub.dispatch(stub.document, "pointermove", { clientX: 100, clientY: 150 });
    stub.dispatch(stub.document, "pointermove", { clientX: 100, clientY: 250 });
    stub.dispatch(stub.document, "pointerup", { clientX: 20, clientY: 240 });
    stub.dispatch(stub.document, "keydown", { key: "Enter" });
    assert.equal(seen.length, 1);
    assert.ok(seen[0].poly.length >= 3);
    near(seen[0].frac.rx, 0, 0.02);
    near(seen[0].frac.ry, 0, 0.02);
    assert.ok(seen[0].frac.rw > 0.4);
    assert.ok(seen[0].frac.rh > 0.8);

    const boxSeen = [];
    const again = mountRegionMark({
      doc: stub.document,
      root,
      img,
      onConfirm: (value) => boxSeen.push(value),
    });
    modeButton("Box").click();
    const layer2 = root.querySelector(".pxd-region-layer");
    stub.dispatch(layer2, "pointerdown", { clientX: 0, clientY: 150, button: 0 });
    stub.dispatch(stub.document, "pointermove", { clientX: 100, clientY: 250 });
    stub.dispatch(stub.document, "pointerup", { clientX: 100, clientY: 250 });
    root.querySelector(".pxd-region-confirm").click();
    assert.equal("poly" in boxSeen[0], false);
    near(boxSeen[0].frac.rx, 0);
    near(boxSeen[0].frac.ry, 0);
    near(boxSeen[0].frac.rw, 0.5);
    near(boxSeen[0].frac.rh, 1);
    again.destroy();
  } finally { restore(); }
});

test("a polygon crop clips to the stroke and a rectangle crop does not", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:region-pen";
  URL.revokeObjectURL = () => {};
  try {
    const doc = stub.document;
    const parent = doc.createElement("div");
    const button = doc.createElement("button");
    parent.append(button);
    doc.body.append(parent);
    const points = [0.1, 0.2, 0.5, 0.2, 0.5, 0.7, 0.1, 0.7];
    const handle = mountRegionCrop({
      doc,
      button,
      region: { f: [0.1, 0.2, 0.4, 0.5], p: points, drawingUid: "img1", caption: "A" },
      file: {},
    });
    const img = parent.querySelector("img");
    img.naturalWidth = 800;
    img.naturalHeight = 400;
    stub.dispatch(img, "load", {});
    const frame = parent.querySelector(".pxd-region-crop__frame");
    assert.match(frame.style.clipPath, /^polygon\(/);
    assert.equal(frame.style.clipPath, polygonClipInBox({ rx: 0.1, ry: 0.2, rw: 0.4, rh: 0.5 }, points));
    handle.destroy();

    const rectParent = doc.createElement("div");
    const rectButton = doc.createElement("button");
    rectParent.append(rectButton);
    doc.body.append(rectParent);
    const rectHandle = mountRegionCrop({
      doc,
      button: rectButton,
      region: { f: [0.25, 0.25, 0.5, 0.5], drawingUid: "img1", caption: "Box" },
      file: {},
    });
    const rectImg = rectParent.querySelector("img");
    rectImg.naturalWidth = 800;
    rectImg.naturalHeight = 400;
    stub.dispatch(rectImg, "load", {});
    const rectFrame = rectParent.querySelector(".pxd-region-crop__frame");
    assert.equal(rectFrame.style.clipPath || "", "");
    rectHandle.destroy();

    const lazy = doc.createElement("div");
    mountLazyCrop(doc, lazy, {
      frac: { rx: 0.1, ry: 0.2, rw: 0.4, rh: 0.5 },
      points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.7 }, { x: 0.1, y: 0.7 }],
    });
    assert.match(lazy.style.clipPath, /^polygon\(/);
  } finally {
    if (prevCreate) URL.createObjectURL = prevCreate; else delete URL.createObjectURL;
    if (prevRevoke) URL.revokeObjectURL = prevRevoke; else delete URL.revokeObjectURL;
    restore();
  }
});
