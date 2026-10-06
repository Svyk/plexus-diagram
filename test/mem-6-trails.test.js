import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildBoard, diffBoards, worldRects } from "../src/model/board.js";
import { parseTrailBlock, renderTrailStrip, trailBadges, trailStrip } from "../src/model/trails.js";
import { createPresenter } from "../src/view/present.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plexus = (o) => ({ plexus: o });
const blk = (uid, string, props, kids = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": 0,
  ":block/props": props,
  ":block/children": kids,
});

function seed(fake, children) {
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children,
  });
}

function card(uid, x, y) {
  return { uid, string: `[[${uid}]]`, props: { plexus: { x, y, w: 200, h: 80 } } };
}

function setup(children) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seed(fake, children);
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

const undos = (fake) => fake.calls.filter((c) => c[0] === "undo");

test("buildBoard skips the Trails container and reads stops in block order", () => {
  const board = buildBoard(blk("b1", "{{[[diagram]]:Lab}}", plexus({ v: 2 }), [
    blk("c1", "[[Alpha]]", plexus({ x: 0, y: 0, w: 100, h: 40 })),
    blk("tr", "Trails", plexus({ type: "trails" }), [
      blk("t1", "{{[[plexus-trail]]}} Onboarding", plexus({ type: "trail" }), [
        blk("s1", "((c1))", null, [blk("n1", "Welcome")]),
        blk("s2", "((c2))"),
        blk("note", "not a stop"),
      ]),
    ]),
  ]));
  assert.equal(board.items.has("tr"), false);
  assert.equal(board.items.has("t1"), false);
  assert.equal(board.items.has("s1"), false);
  assert.equal(board.trailsUid, "tr");
  assert.equal(board.trails.length, 1);
  assert.equal(board.trails[0].name, "Onboarding");
  assert.deepEqual(board.trails[0].stops.map((s) => s.ref), ["c1", "c2"]);
  assert.equal(board.trails[0].stops[0].note, "Welcome");
  assert.equal(board.trails[0].stops[0].noteUid, "n1");
  assert.equal(board.items.get("c1").title, "Alpha");
  const bare = buildBoard(blk("b2", "{{[[diagram]]:Bare}}", plexus({ v: 2 }), [
    blk("c9", "[[Only]]", plexus({ x: 0, y: 0, w: 100, h: 40 })),
  ]));
  assert.deepEqual(bare.trails, []);
  const prev = { ...bare };
  delete prev.trails;
  assert.equal(diffBoards(prev, bare).structural, false);
});

test("createTrail Onboarding plus four stops is the block tree, and badges are 1-4", async () => {
  const { fake, session } = setup([card("c1", 0, 0), card("c2", 300, 0), card("c3", 0, 200), card("c4", 300, 200)]);
  const trailId = await session.createTrail("Onboarding");
  await session.addToTrail(trailId, "c1", "Welcome");
  await session.addToTrail(trailId, "c2", "Second");
  await session.addToTrail(trailId, "c3", "Third");
  await session.addToTrail(trailId, "c4", "");
  await fake.flush();
  await sleep(20);

  const container = fake.block(session.board.trailsUid);
  assert.equal(container.string, "Trails");
  assert.equal(container.open, false);
  assert.equal(container.props.plexus.type, "trails");
  assert.equal(session.board.items.has(container.uid), false);

  const trail = fake.block(trailId);
  assert.equal(trail.string, "{{[[plexus-trail]]}} Onboarding");
  assert.equal(trail.open, true);
  assert.equal(trail.props.plexus.type, "trail");

  const parsed = session.board.trails[0];
  assert.equal(parsed.uid, trailId);
  assert.deepEqual(parsed.stops.map((s) => s.ref), ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(parsed.stops.map((s) => s.note), ["Welcome", "Second", "Third", ""]);
  const badges = trailBadges(parsed);
  assert.equal(badges.get("c1"), 1);
  assert.equal(badges.get("c2"), 2);
  assert.equal(badges.get("c3"), 3);
  assert.equal(badges.get("c4"), 4);
});

test("moveStop of stop 3 to index 1 is one move and badges follow the echo", async () => {
  const { fake, session } = setup([card("c1", 0, 0), card("c2", 300, 0), card("c3", 0, 200), card("c4", 300, 200)]);
  const trailId = await session.createTrail("Onboarding", ["c1", "c2", "c3", "c4"]);
  await fake.flush();
  await sleep(20);
  const before = session.board.trails[0].stops.map((s) => s.uid);
  fake.clearLog();
  await session.moveStop(before[2], 1);
  await fake.flush();
  await sleep(20);
  const moves = fake.writesLog().filter((e) => e[0] === "move");
  assert.equal(moves.length, 1);
  assert.equal(moves[0][1], before[2]);
  assert.equal(moves[0][2], trailId);
  assert.equal(moves[0][3], 1);
  assert.equal(fake.writesLog().length, 1);
  const refs = session.board.trails[0].stops.map((s) => s.ref);
  assert.deepEqual(refs, ["c1", "c3", "c2", "c4"]);
  const badges = trailBadges(session.board.trails[0]);
  assert.equal(badges.get("c3"), 2);
  assert.equal(badges.get("c2"), 3);
});

test("addToTrail is one undo group: one session.undo steps over every write of that gesture", async () => {
  const { fake, session } = setup([card("c1", 0, 0), card("c2", 300, 0)]);
  const trailId = await session.createTrail("Onboarding");
  await fake.flush();
  fake.clearLog();
  await session.addToTrail(trailId, "c1", "Welcome");
  const writes = fake.writesLog().length;
  assert.equal(writes, 2);
  await session.undo();
  assert.equal(undos(fake).length, writes);
});

test("addSelectionToTrail caps at 45 and toasts the rest", async () => {
  const children = [];
  for (let i = 0; i < 46; i++) children.push(card(`c${i}`, (i % 10) * 220, Math.floor(i / 10) * 120));
  const { fake, session } = setup(children);
  const trailId = await session.createTrail("Bulk");
  await fake.flush();
  fake.clearLog();
  const toasts = [];
  session.on("toast", (e) => toasts.push(e.message));
  const ids = ["", "missing", ...children.map((c) => c.uid)];
  const made = await session.addSelectionToTrail(trailId, ids);
  await fake.flush();
  assert.equal(made.length, 45);
  assert.equal(fake.writesLog().filter((e) => e[0] === "create").length, 45);
  assert.deepEqual(toasts, ["Added 45 of 46 (Roam undo holds 50 changes)"]);
  assert.equal(session.board.trails[0].stops.length, 45);
});

test("trail strip keeps the first 8 titles and a Walk button", () => {
  const stops = [];
  for (let i = 0; i < 10; i++) stops.push({ ref: `c${i}`, uid: `s${i}` });
  const titles = Object.fromEntries(stops.map((s) => [s.ref, `Stop ${s.ref}`]));
  const shown = trailStrip(stops, (uid) => titles[uid]);
  assert.equal(shown.length, 8);
  assert.equal(shown[0].title, "Stop c0");
  assert.equal(shown[7].index, 8);
  assert.equal(shown[0].uid, "c0");

  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const clicks = [];
  renderTrailStrip(stub.document, parent, shown, {
    onStop: (s) => clicks.push(s.uid),
    onWalk: () => clicks.push("walk"),
  });
  assert.equal(parent.querySelectorAll(".pxd-trail-strip__stop").length, 8);
  assert.equal(parent.querySelectorAll(".pxd-trail-strip__arrow").length, 7);
  parent.querySelectorAll(".pxd-trail-strip__stop")[1].click();
  parent.querySelector(".pxd-trail-strip__walk").click();
  assert.deepEqual(clicks, ["c1", "walk"]);
});

test("Walk through trail stops shows each note and stop() writes nothing", () => {
  const board = buildBoard(blk("b1", "{{[[diagram]]:Lab}}", plexus({ v: 2 }), [
    blk("c1", "[[One]]", plexus({ x: 0, y: 0, w: 100, h: 40 })),
    blk("c2", "[[Two]]", plexus({ x: 200, y: 0, w: 100, h: 40 })),
    blk("c3", "[[Three]]", plexus({ x: 0, y: 200, w: 100, h: 40 })),
    blk("c4", "[[Four]]", plexus({ x: 200, y: 200, w: 100, h: 40 })),
    blk("tr", "Trails", plexus({ type: "trails" }), [
      blk("t1", "{{[[plexus-trail]]}} Onboarding", plexus({ type: "trail" }), [
        blk("s1", "((c1))", null, [blk("n1", "Welcome")]),
        blk("s2", "((c2))", null, [blk("n2", "Second")]),
        blk("s3", "((c3))", null, [blk("n3", "Third")]),
        blk("s4", "((c4))", null, [blk("n4", "Fourth")]),
        blk("s5", "((gone))", null, [blk("n5", "Off board")]),
      ]),
    ]),
  ]));
  const rects = worldRects(board);
  const writes = [];
  const host = { createBlock: () => writes.push("create"), updateBlock: () => writes.push("update") };
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  stub.document.body.append(root);
  const notes = [];
  let exited = 0;
  const p = createPresenter({
    doc: stub.document,
    root,
    on: {
      step: (s) => notes.push(s.note),
      exit: () => { exited += 1; },
    },
  });
  const trail = board.trails[0];
  const stops = trail.stops.filter((s) => rects.get(s.ref)).map((s) => ({
    uid: s.ref,
    rect: rects.get(s.ref),
    title: s.ref,
    note: s.note,
  }));
  assert.equal(stops.length, 4);
  assert.equal(p.start(board, rects, { stops }), true);
  assert.equal(p.total(), 4);
  assert.equal(root.querySelector(".pxd-present-hud__note").textContent, "Welcome");
  p.next();
  p.next();
  p.next();
  assert.deepEqual(notes, ["Welcome", "Second", "Third", "Fourth"]);
  assert.equal(root.querySelector(".pxd-present-hud__count").textContent, "4 / 4");
  assert.equal(p.stop(), true);
  assert.equal(exited, 1);
  assert.equal(p.isActive(), false);
  assert.equal(root.querySelector(".pxd-present-hud"), null);
  assert.deepEqual(writes, []);
  void host;
  assert.equal(p.start(board, rects, { stops: [{ uid: "c1", title: "One", note: "no rect" }] }), false);
  assert.equal(p.isActive(), false);
  assert.equal(root.querySelector(".pxd-present-hud"), null);
});

test("parseTrailBlock accepts the macro without a type, and the card menu lists trails", () => {
  const trail = parseTrailBlock({
    ":block/uid": "t1",
    ":block/string": "{{[[plexus-trail]]}} Onboarding",
    ":block/children": [{ ":block/uid": "s1", ":block/string": "((c1))", ":block/order": 0 }],
  });
  assert.equal(trail.name, "Onboarding");
  assert.equal(trail.stops[0].ref, "c1");
  const card = buildMenu("card", { trails: [{ uid: "t1", name: "Onboarding" }] });
  const ids = card.flatMap((row) => [row.id, ...(row.children || []).map((c) => c.id)]);
  assert.ok(ids.includes("trail"));
  assert.ok(ids.includes("trail-add:t1"));
  assert.ok(ids.includes("trail-add:new"));
  assert.ok(ids.includes("landmark-toggle"));
  const plain = buildMenu("board-menu", {});
  assert.equal(plain.some((row) => row.id === "walk"), false);
  const walk = buildMenu("board-menu", { walk: true, hasTrail: false });
  const trailWalk = walk.find((row) => row.id === "walk").children.find((row) => row.id === "walk:trail");
  assert.equal(trailWalk.disabled, true);
});

test("trails.css draws a dashed path and a transparent badge", () => {
  const css = readFileSync(new URL("../src/css/trails.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-trail\s*\{[^}]*fill:\s*none/);
  assert.match(css, /stroke-dasharray/);
  assert.match(css, /\.pxd-trail-badge\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.pxd-root--dark \.pxd-trail-badge\s*\{[^}]*background:\s*transparent/);
});
