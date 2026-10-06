import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildBoard, readingOrder, worldRects } from "../src/model/board.js";
import { normalizeItemLayout, serializeItemLayout } from "../src/model/schema.js";
import {
  landmarkClass,
  landmarkDots,
  membersIn,
  nearestNextOrder,
  neighbourhoodRect,
  readingLandmarkOrder,
  walkStops,
} from "../src/model/landmarks.js";
import { createPresenter } from "../src/view/present.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const plexus = (o) => ({ plexus: o });
const blk = (uid, string, props, kids = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": 0,
  ":block/props": props,
  ":block/children": kids,
});

test("schema stores a landmark glyph of at most two characters and omits size M", () => {
  const emoji = serializeItemLayout({ type: "card", x: 1, landmark: true, glyph: "😀😀😀", size: "M" });
  assert.equal(emoji.landmark, true);
  assert.equal(emoji.glyph, "😀😀");
  assert.equal(emoji.size, undefined);
  assert.equal("size" in emoji, false);
  assert.deepEqual(serializeItemLayout(normalizeItemLayout(emoji)), emoji);

  const small = serializeItemLayout({ type: "card", x: 1, landmark: true, glyph: "ab", size: "S" });
  assert.equal(small.size, "S");
  assert.equal(small.glyph, "ab");
  const large = serializeItemLayout({ type: "card", x: 1, landmark: true, glyph: "  x  ", size: "L" });
  assert.equal(large.glyph, "x");
  assert.equal(large.size, "L");
  assert.deepEqual(serializeItemLayout(normalizeItemLayout(large)), large);

  const off = serializeItemLayout({ type: "card", x: 4, y: 5, landmark: false, glyph: "😀", size: "L" });
  assert.equal("landmark" in off, false);
  assert.equal("glyph" in off, false);
  assert.equal("size" in off, false);
  assert.deepEqual(off, { x: 4, y: 5 });
  assert.equal(normalizeItemLayout({ landmark: false, glyph: "A", size: "S" }).landmark, undefined);
  assert.equal(normalizeItemLayout({ landmark: false, glyph: "A", size: "S" }).size, undefined);
});

test("setLandmark writes the keys and toggle-off removes them in one props write", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[Gate]]", props: { plexus: { x: 10, y: 20, w: 200, h: 80 } } },
      { uid: "s1", string: "Hall", props: { plexus: { type: "section", x: 0, y: 300, w: 400, h: 200 } } },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  await session.setLandmark("c1", { on: true, glyph: "⭐⭐⭐", size: "L" });
  await fake.flush();
  assert.equal(fake.writesLog().length, 1);
  assert.equal(fake.writesLog()[0][0], "update");
  assert.deepEqual(fake.props("c1").plexus, { x: 10, y: 20, w: 200, h: 80, landmark: true, glyph: "⭐⭐", size: "L" });
  assert.equal(session.board.items.get("c1").landmark, true);
  assert.equal(session.board.items.get("c1").size, "L");

  fake.clearLog();
  await session.setLandmark("c1", { on: false });
  await fake.flush();
  assert.equal(fake.writesLog().length, 1);
  const stored = fake.props("c1").plexus;
  assert.equal("landmark" in stored, false);
  assert.equal("glyph" in stored, false);
  assert.equal("size" in stored, false);
  assert.equal(stored.landmark, undefined);
  assert.equal(stored.x, 10);
  assert.equal(session.board.items.get("c1").landmark, undefined);
});

test("reading order for landmarks buckets y by 200 and does not change outline readingOrder", () => {
  const board = buildBoard(blk("b1", "{{[[diagram]]:Lab}}", plexus({ v: 2 }), [
    blk("east", "East", plexus({ x: 500, y: 150, w: 20, h: 20, landmark: true, glyph: "E" })),
    blk("west", "West", plexus({ x: 0, y: 190, w: 20, h: 20, landmark: true, glyph: "W" })),
    blk("south", "South", plexus({ x: 40, y: 400, w: 20, h: 20, landmark: true, glyph: "S" })),
    blk("plain", "Plain", plexus({ x: 10, y: 10, w: 20, h: 20 })),
  ]));
  const rects = worldRects(board);
  assert.deepEqual(readingLandmarkOrder(["east", "west", "south"], rects), ["west", "east", "south"]);
  const outline = readingOrder(board, rects).find((g) => g.parent === "b1").uids;
  assert.deepEqual(outline, ["plain", "east", "west", "south"]);
  assert.deepEqual(nearestNextOrder(["east", "west", "south"], rects), ["west", "south", "east"]);
});

test("a neighbourhood is at least one screen and keeps the landmark plus cards inside it", () => {
  const focus = { x: 100, y: 100, w: 40, h: 20 };
  const hood = neighbourhoodRect(focus, { width: 800, height: 600 });
  assert.equal(hood.w, 800);
  assert.equal(hood.h, 600);
  assert.equal(hood.x, 120 - 400);
  assert.equal(hood.y, 110 - 300);
  const board = {
    order: ["gate", "near", "far"],
    items: new Map([
      ["gate", { landmark: true }],
      ["near", {}],
      ["far", {}],
    ]),
  };
  const rects = new Map([
    ["gate", focus],
    ["near", { x: 200, y: 200, w: 20, h: 20 }],
    ["far", { x: 5000, y: 5000, w: 20, h: 20 }],
  ]);
  const members = membersIn(board, rects, hood, "gate");
  assert.equal(members.has("gate"), true);
  assert.equal(members.has("near"), true);
  assert.equal(members.has("far"), false);
  assert.equal(landmarkClass({ landmark: true, type: "section", size: "S" }), "pxd-section--landmark pxd-landmark--S");
  assert.equal(landmarkClass({ landmark: true, type: "card" }), "pxd-item--landmark pxd-landmark--M");
  assert.equal(landmarkClass({ type: "card" }), "");
});

test("minimap dots carry the three glyphs and Walk uses reading order with no writes", () => {
  const board = buildBoard(blk("b1", "{{[[diagram]]:Lab}}", plexus({ v: 2 }), [
    blk("east", "East", plexus({ x: 500, y: 150, w: 80, h: 40, landmark: true, glyph: "E" })),
    blk("west", "West", plexus({ x: 0, y: 190, w: 80, h: 40, landmark: true, glyph: "W" })),
    blk("south", "South", plexus({ x: 40, y: 400, w: 80, h: 40, landmark: true, glyph: "S" })),
    blk("plain", "Plain", plexus({ x: 10, y: 10, w: 80, h: 40 })),
  ]));
  const rects = worldRects(board);
  const dots = landmarkDots(board, rects, { x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 });
  assert.equal(dots.length, 3);
  assert.deepEqual(dots.map((d) => d.glyph).sort(), ["E", "S", "W"]);
  const stops = walkStops(board, rects, { mode: "reading", screen: { w: 800, h: 600 } });
  assert.deepEqual(stops.map((s) => s.uid), ["west", "east", "south"]);
  assert.ok(stops.every((s) => s.note === ""));
  assert.ok(stops[0].rect.w >= 800 && stops[0].rect.h >= 600);
  assert.equal(stops[0].members.has("west"), true);

  const writes = [];
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  stub.document.body.append(root);
  let exited = 0;
  const seen = [];
  const p = createPresenter({
    doc: stub.document,
    root,
    on: { step: (s) => seen.push(s.uid), exit: () => { exited += 1; } },
  });
  assert.equal(p.start(board, rects, { stops }), true);
  p.next();
  p.next();
  assert.deepEqual(seen, ["west", "east", "south"]);
  p.stop();
  assert.equal(exited, 1);
  assert.deepEqual(writes, []);

  const on = buildMenu("card", { landmark: true, landmarkSize: "L", trails: [] });
  const ids = on.flatMap((row) => [row.id, ...(row.children || []).map((c) => c.id)]);
  assert.ok(ids.includes("landmark-toggle"));
  assert.ok(ids.includes("landmark-glyph"));
  assert.ok(ids.includes("landmark-size:L"));
  const sizeL = on.find((row) => row.id === "landmark").children.find((row) => row.id === "landmark-size:L");
  assert.equal(sizeL.checked, true);
});

test("landmarks.css keeps the overview title and a transparent disc", () => {
  const css = readFileSync(new URL("../src/css/landmarks.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root\.pxd-lod-overview \.pxd-item\.pxd-item--card\.pxd-item--landmark > \.pxd-item__header/);
  assert.match(css, /\.pxd-root\.pxd-lod-overview \.pxd-section\.pxd-section--landmark > \.pxd-section__title/);
  assert.match(css, /--pxd-screen-px/);
  assert.match(css, /\.pxd-root--dark \.pxd-landmark\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /width:\s*48px/);
  assert.match(css, /width:\s*72px/);
  assert.match(css, /width:\s*96px/);
});
