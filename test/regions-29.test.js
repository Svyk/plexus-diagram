// REG-1: region blocks parse, and they are not cards or badge rows.
import assert from "node:assert/strict";
import test from "node:test";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { classifyString } from "../src/model/schema.js";
import { isTaskAttr } from "../src/model/tasks.js";
import { freshCardIsBlank } from "../src/view/board-view.js";
import {
  fracRectOf,
  isContainerString,
  isStructuralString,
  parseRegion,
  regionsOf,
  serializeRegion,
  viewRectOf,
} from "../src/model/regions.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const AREA = "{{[[plexus-region]]: k=area d=ITvT3bqaL ids=pmm-3NChDbxPu-h6dynpr9M pad=10}} ((h6dynpr9M))";
const RECT = "{{[[plexus-region]]: k=rect d=ITvT3bqaL el=plx-img-a f=0.25,0.25,0.5,0.5}} Image crop";
const FRAME = "{{[[plexus-region]]: k=frame d=ITvT3bqaL fr=plx-frame-a pad=10}}";
const CFRAME = "{{[[plexus-region]]: k=cframe d=ITvT3bqaL fr=plx-frame-a}}";
const IMGRECT = "{{[[plexus-region]]: k=imgrect d=kK4xlY1jm i=0 f=0.0859,0.171,0.4124,0.6863}}";
const GROUP = "{{[[plexus-region]]: k=group d=ITvT3bqaL g=plx-grp-1 pad=10}}";

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});

test("REG-1: img and view round-trip, and a real area stays unsupported", () => {
  const img = serializeRegion({ kind: "img", drawingUid: "imgcard01", f: [0.1, 0.2, 0.3, 0.4], caption: "hamstring" });
  assert.equal(img, "{{[[plexus-region]]: k=img d=imgcard01 f=0.1,0.2,0.3,0.4}} hamstring");
  const imgParsed = parseRegion(img);
  assert.equal(imgParsed.owner, "plexus-diagram");
  assert.equal(imgParsed.supported, true);
  assert.equal(imgParsed.error, undefined);
  assert.deepEqual(fracRectOf(imgParsed), { rx: 0.1, ry: 0.2, rw: 0.3, rh: 0.4 });
  assert.equal(serializeRegion(imgParsed), img);

  const view = serializeRegion({
    kind: "view",
    drawingUid: "board0001",
    v: [10.26, -12.04, 200.04, 80],
    ids: ["cardA", "card-b"],
    caption: "saved",
  });
  assert.equal(view, "{{[[plexus-region]]: k=view d=board0001 v=10.3,-12,200,80 ids=cardA,card-b}} saved");
  const viewParsed = parseRegion(view);
  assert.equal(viewParsed.supported, true);
  assert.deepEqual(viewRectOf(viewParsed), { x: 10.3, y: -12, w: 200, h: 80 });
  assert.equal(serializeRegion(viewParsed), view);

  const wide = parseRegion("{{[[plexus-region]]: k=img d=imgcard01 f=1.2,-0.2,0.5,0.5}}");
  assert.deepEqual(wide.f, [1, 0, 0.5, 0.5]);
  assert.equal(parseRegion("{{[[plexus-region]]: k=view d=board0001 v=0,0,0,10}}").error, "bad v");
  const many = Array.from({ length: 25 }, (_, i) => `id${i}`).join(",");
  assert.equal(parseRegion(`{{[[plexus-region]]: k=view d=board0001 v=0,0,10,10 ids=${many}}}`).error, "bad ids");
  assert.equal(parseRegion(`{{[[plexus-region]]: k=area d=ITvT3bqaL ids=${many} pad=10}}`).error, undefined);

  const area = parseRegion(AREA);
  assert.equal(area.owner, "roam-plexus");
  assert.equal(area.supported, false);
  assert.equal(area.error, undefined);
  assert.equal(area.caption, "((h6dynpr9M))");
  assert.equal(serializeRegion(area), AREA);
  for (const sample of [RECT, FRAME, CFRAME, IMGRECT, GROUP]) {
    const region = parseRegion(sample);
    assert.equal(region.owner, "roam-plexus", sample);
    assert.equal(region.supported, false, sample);
    assert.equal(region.error, undefined, sample);
    assert.equal(serializeRegion(region), sample);
  }
  assert.equal(parseRegion("{{[[plexus-region]]: nope k=img d=imgcard01}}").error, "bad token nope");
  assert.equal(parseRegion("{{[[plexus-region]]: k=nope d=imgcard01}}").owner, "unknown");
  assert.equal(parseRegion("not a region"), null);
  assert.equal(isContainerString("  {{[[plexus-regions]]}}  "), true);
  assert.equal(isStructuralString(AREA), true);
  assert.equal(classifyString("{{[[plexus-regions]]}}").kind, "regions");
  assert.equal(classifyString(AREA).kind, "region");
  assert.equal(classifyString("a note").kind, "note");
});

test("REG-1: regionsOf reads the container and skips a bad child", () => {
  const owner = blk("imgcard01", "![alt](https://example.com/a.png)", null, 0, [
    blk("regcont01", "{{[[plexus-regions]]}}", { ":type": "regions" }, 0, [
      blk("regimg001", "{{[[plexus-region]]: k=img d=imgcard01 f=0.1,0.2,0.3,0.4}} hamstring", null, 0),
      blk("regbad001", "plain child", null, 1),
    ]),
  ]);
  const regions = regionsOf(owner);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].uid, "regimg001");
  assert.equal(regions[0].owner, "plexus-diagram");
});

test("REG-1: a regions container is not a card, and the badge ignores it", () => {
  const container = (uid, childUid, childString) => blk(uid, "{{[[plexus-regions]]}}", { ":type": "regions" }, 1, [
    blk(childUid, childString, null, 0),
  ]);
  const imageKids = [
    blk("realkid01", "a note", null, 0),
    container("regcont01", "regimg001", "{{[[plexus-region]]: k=img d=imgcard01 f=0.1,0.2,0.3,0.4}} hamstring"),
  ];
  const noteKids = [
    blk("realnote1", "child", null, 0),
    container("regcont02", "regimg002", "{{[[plexus-region]]: k=view d=board0001 v=0,0,10,10}} saved"),
  ];
  const boardKids = [
    blk("imgcard01", "![alt](https://example.com/a.png)", { ":x": 0, ":y": 0, ":w": 280, ":h": 160 }, 0, imageKids),
    blk("notecard1", "parent text", { ":x": 400, ":y": 0, ":w": 280, ":h": 160 }, 1, noteKids),
    blk("regboard1", "{{[[plexus-regions]]}}", { ":type": "regions" }, 2, [
      blk("regb00001", AREA, null, 0),
      blk("regb00002", RECT, null, 1),
    ]),
    blk("loose0001", AREA, null, 3),
  ];
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": boardKids,
  });
  assert.deepEqual([...board.items.keys()].sort(), ["imgcard01", "notecard1"]);
  const note = board.items.get("notecard1");
  assert.equal(note.content.length, 2);
  const kept = note.content.filter((c) => !isTaskAttr(c)).length;
  assert.equal(kept, 2);
  assert.equal(freshCardIsBlank({ blockString: "", itemString: "", contentCount: kept, editorText: "" }), false);

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
    pageOutline: () => null,
    openPage() {},
    openBlock() {},
    openInSidebar() {},
    watchPage: () => () => {},
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const timers = { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  try {
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -10000, y: -10000, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
    let guard = 0;
    while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
    const image = r.shellOf("imgcard01");
    const noteShell = r.shellOf("notecard1");
    assert.equal(image.querySelector(".pxd-kids"), null);
    assert.equal(noteShell.querySelector(".pxd-kids").textContent, "\u25B8 1");
    assert.equal(doc.querySelectorAll(".pxd-item").length, 2);
  } finally {
    r.dispose();
    restore();
  }
});

test("REG-1: createCard lands before edges, snapshots, and a regions container", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "ed", string: "Connections", props: { plexus: { type: "edges" } } },
      { uid: "sn", string: "Snapshots", props: { plexus: { type: "snapshots" } } },
      { uid: "box", string: "{{[[plexus-regions]]}}", props: { plexus: { type: "regions" } } },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  try {
    assert.equal(session.board.items.has("box"), false);
    const id = await session.createCard({ x: 800, y: 800, string: "added" });
    assert.deepEqual(fake.children("b1"), ["c1", id, "ed", "sn", "box"]);
    assert.equal(session.board.items.has(id), true);
    assert.equal(session.board.items.has("box"), false);
  } finally {
    session.release();
    resetSessions();
  }
});

test("REG-1: createCard lands before a regions container that has only the macro string", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b2",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "box", string: "{{[[plexus-regions]]}}" },
    ],
  });
  const session = acquireSession("b2", { host, linkDelay: 0 });
  try {
    const id = await session.createCard({ x: 800, y: 800, string: "added" });
    assert.deepEqual(fake.children("b2"), ["c1", id, "box"]);
  } finally {
    session.release();
    resetSessions();
  }
});
