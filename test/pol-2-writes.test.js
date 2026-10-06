// POL-2. Each 3.x writer, driven with a 100-item input where the gesture takes a list.
// One user action is one undo group, and the write count stays at or under 45.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { placeHighlights } from "../src/model/highlight-pick.js";
import { groupTimeline } from "../src/model/timeline.js";
import { sourceChipFor } from "../src/model/source-chip.js";
import { lensBright, lensCatalog } from "../src/model/lens.js";
import { applyDust, applyStrength, clearLens } from "../src/view/strength-lens.js";
import { applyStatusPicks } from "../src/view/menu-model.js";
import "../src/views.js";

afterEach(() => resetSessions());

const FRAC = { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 };
const capToast = (n, total) => `Added ${n} of ${total} (Roam undo holds 50 changes)`;

function card(uid, x, y, string = `[[${uid}]]`) {
  return { uid, string, props: { plexus: { x, y, w: 200, h: 80 } } };
}

function manyCards(n, stringFor) {
  const children = [];
  for (let i = 0; i < n; i += 1) {
    const uid = `c${String(i).padStart(2, "0")}`;
    const string = stringFor ? stringFor(uid, i) : `[[${uid}]]`;
    children.push(card(uid, (i % 10) * 220, Math.floor(i / 10) * 120, string));
  }
  return children;
}

function sectionOf(children) {
  return {
    uid: "sect1",
    string: "Week",
    props: { plexus: { type: "section", x: 0, y: 0, w: 900, h: 500 } },
    children,
  };
}

function setup(children = []) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

function undoCount(fake) {
  return fake.calls.filter((call) => call[0] === "undo").length;
}

function watchToasts(session) {
  const toasts = [];
  session.on("toast", (event) => toasts.push(event.message));
  return toasts;
}

// One Cmd+Z steps over exactly the writes this action added.
async function assertOneGroup(session, fake, host, before) {
  const delta = host.stats.writes - before;
  assert.ok(delta >= 1 && delta <= 45, `write delta ${delta}`);
  assert.equal(host.stats.lastAction.writes, delta);
  assert.equal(typeof host.stats.lastAction.label, "string");
  assert.ok(host.stats.lastAction.label.length > 0);
  const start = undoCount(fake);
  await session.undo();
  assert.equal(undoCount(fake) - start, delta);
  return delta;
}

function stubEl(uid) {
  const attrs = new Map();
  if (uid) attrs.set("data-uid", uid);
  const classes = new Set();
  return {
    style: {},
    dataset: { uid: uid || "" },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    getAttribute(key) { return attrs.has(key) ? attrs.get(key) : null; },
    setAttribute(key, value) { attrs.set(key, String(value)); },
    removeAttribute(key) { attrs.delete(key); },
    hasAttribute(key) { return attrs.has(key); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

test("stats.writes counts create, update, move and delete, and lastAction closes with the group", async () => {
  const { fake, host } = setup([]);
  assert.equal(host.stats.writes, 0);
  assert.equal(host.stats.lastAction, undefined);
  const before = host.stats.writes;
  await host.group(async () => {
    const id = await host.createBlock({ parentUid: "b1", string: "n" });
    await host.updateString(id, "n2");
    await host.moveBlock(id, "b1", 0);
    await host.deleteBlock(id);
  });
  assert.equal(host.stats.writes - before, 4);
  assert.deepEqual(host.stats.lastAction, { label: "create+update+move+delete", writes: 4 });
  const start = undoCount(fake);
  await host.undo();
  assert.equal(undoCount(fake) - start, 4);
});

test("an explicit group label overrides the derived kinds", async () => {
  const { host } = setup([]);
  await host.group(async () => {
    const id = await host.createBlock({ parentUid: "b1", string: "n" });
    await host.updateString(id, "n2");
  }, "demo");
  assert.deepEqual(host.stats.lastAction, { label: "demo", writes: 2 });
});

test("a lone update is its own lastAction", async () => {
  const { host } = setup([card("c1", 0, 0)]);
  const before = host.stats.writes;
  await host.updateString("c1", "renamed");
  assert.equal(host.stats.writes - before, 1);
  assert.deepEqual(host.stats.lastAction, { label: "update", writes: 1 });
});

test("mark region with no container is two writes and two undo groups", async () => {
  const image = {
    uid: "img1",
    string: "![ham](https://example.com/leg.png)",
    props: { plexus: { x: 0, y: 0, w: 280, h: 160 } },
  };
  const { fake, host, session } = setup([image]);
  const before = host.stats.writes;
  const uid = await session.addImageRegion("img1", FRAC, "hamstring");
  assert.equal(typeof uid, "string");
  const delta = host.stats.writes - before;
  assert.equal(delta, 2);
  assert.ok(delta <= 3);
  // The container closes first. lastAction is the region, the group that closed last.
  assert.deepEqual(host.stats.lastAction, { label: "create", writes: 1 });
  const start = undoCount(fake);
  await session.undo();
  assert.equal(undoCount(fake) - start, 1);
  await session.undo();
  assert.equal(undoCount(fake) - start, 2);
});

test("mark region reuses the container as one write and one undo group", async () => {
  const image = {
    uid: "img1",
    string: "![ham](https://example.com/leg.png)",
    props: { plexus: { x: 0, y: 0, w: 280, h: 160 } },
  };
  const { host, session, fake } = setup([image]);
  await session.addImageRegion("img1", FRAC, "hamstring");
  const before = host.stats.writes;
  const uid = await session.addImageRegion("img1", FRAC, "other");
  assert.equal(typeof uid, "string");
  const delta = await assertOneGroup(session, fake, host, before);
  assert.equal(delta, 1);
  assert.ok(delta <= 3);
});

test("save view of 100 ids is at most 2 writes and one undo group", async () => {
  const ids = [];
  for (let i = 0; i < 100; i += 1) ids.push(`id${i}`);
  const { host, session, fake } = setup([]);
  const before = host.stats.writes;
  const uid = await session.addView({
    caption: "Wide",
    v: { x: 10, y: 10, w: 200, h: 80 },
    ids,
  });
  assert.equal(typeof uid, "string");
  const delta = await assertOneGroup(session, fake, host, before);
  assert.equal(delta, 2);
  assert.ok(delta <= 2);
});

test("add trail stop is one write, or two with a note, and one undo group", async () => {
  const { host, session, fake } = setup([card("c1", 0, 0), card("c2", 300, 0)]);
  const trailId = await session.createTrail("Walk");
  let before = host.stats.writes;
  const stop = await session.addToTrail(trailId, "c1");
  assert.equal(typeof stop, "string");
  assert.equal(await assertOneGroup(session, fake, host, before), 1);

  before = host.stats.writes;
  const noted = await session.addToTrail(trailId, "c2", "Welcome");
  assert.equal(typeof noted, "string");
  assert.equal(await assertOneGroup(session, fake, host, before), 2);
});

test("add selection to trail with 50 cards makes 45 stops and emits the cap toast", async () => {
  const children = manyCards(50);
  const { host, session, fake } = setup(children);
  const trailId = await session.createTrail("Bulk");
  const toasts = watchToasts(session);
  const before = host.stats.writes;
  const made = await session.addSelectionToTrail(trailId, children.map((child) => child.uid));
  assert.equal(made.length, 45);
  assert.equal(session.board.trails[0].stops.length, 45);
  assert.deepEqual(toasts, [capToast(45, 50)]);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);
});

test("createTrail of 100 cards on a new board stays at 45 writes and one undo group", async () => {
  const children = manyCards(100);
  const ids = children.map((child) => child.uid);
  const { host, session, fake } = setup(children);
  const toasts = watchToasts(session);
  const before = host.stats.writes;
  const trailId = await session.createTrail("Bulk", ids);
  assert.equal(typeof trailId, "string");
  assert.equal(session.board.trails[0].stops.length, 43);
  assert.deepEqual(toasts, [capToast(43, 100)]);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);
});

test("createTrail of 100 cards when Trails already exists stays at 45 writes and one undo group", async () => {
  const children = manyCards(100);
  const ids = children.map((child) => child.uid);
  const { host, session, fake } = setup(children);
  await session.createTrail("Seed");
  const toasts = watchToasts(session);
  const before = host.stats.writes;
  const trailId = await session.createTrail("Bulk", ids);
  const trail = session.board.trails.find((entry) => entry.uid === trailId);
  assert.equal(trail.stops.length, 44);
  assert.deepEqual(toasts, [capToast(44, 100)]);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);
});

test("move stop and delete trail are one write and one undo group", async () => {
  const children = manyCards(100);
  const { host, session, fake } = setup(children);
  const trailId = await session.createTrail("Bulk", children.map((child) => child.uid));
  const stopUid = session.board.trails[0].stops[0].uid;
  assert.ok(session.board.trails[0].stops.length > 1);

  let before = host.stats.writes;
  await session.moveStop(stopUid, 1);
  assert.equal(await assertOneGroup(session, fake, host, before), 1);

  before = host.stats.writes;
  await session.deleteTrail(trailId);
  assert.equal(await assertOneGroup(session, fake, host, before), 1);
});

test("place highlights of 100 rows writes at most 45 in one undo group", async () => {
  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    rows.push({ uid: `h${String(i).padStart(3, "0")}`, selected: true, placed: false });
  }
  const placed = placeHighlights(rows);
  assert.equal(placed.items.length, 45);
  assert.equal(placed.omitted, 55);
  const { host, session, fake } = setup([]);
  const toasts = watchToasts(session);
  const before = host.stats.writes;
  const ids = await session.addRefCards(placed.items);
  assert.equal(ids.length, 45);
  assert.deepEqual(toasts, []);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);
});

test("why note is one write and one undo group", async () => {
  const { host, session, fake } = setup([card("a", 0, 0, "[[A]]"), card("b", 400, 0, "[[B]]")]);
  const edge = await session.addEdge({ from: "a", to: "b" });
  const before = host.stats.writes;
  await session.commitWhy(edge, { label: "", why: "because the dates line up" });
  assert.equal(host.stats.lastAction.label, "create");
  assert.equal(await assertOneGroup(session, fake, host, before), 1);
});

test("why plus a label change is two writes in one undo group", async () => {
  const { host, session, fake } = setup([card("a", 0, 0, "[[A]]"), card("b", 400, 0, "[[B]]")]);
  const edge = await session.addEdge({ from: "a", to: "b" });
  const before = host.stats.writes;
  await session.commitWhy(edge, { label: "supports", why: "because the dates line up" });
  assert.equal(host.stats.lastAction.label, "update+create");
  assert.equal(await assertOneGroup(session, fake, host, before), 2);
});

test("landmark set and clear of 100 cards stops at 45 writes and one undo group", async () => {
  const children = manyCards(100);
  const ids = children.map((child) => child.uid);
  const { host, session, fake } = setup(children);
  const toasts = watchToasts(session);

  let before = host.stats.writes;
  await session.setLandmark(ids[0], { on: true });
  assert.equal(await assertOneGroup(session, fake, host, before), 1);
  assert.deepEqual(toasts, []);

  before = host.stats.writes;
  await session.setLandmark(ids, { on: true });
  assert.deepEqual(toasts, [capToast(45, 100)]);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);

  toasts.length = 0;
  before = host.stats.writes;
  await session.setLandmark(ids, { on: false });
  assert.deepEqual(toasts, [capToast(45, 100)]);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);
});

test("highlight note is one write and one undo group", async () => {
  const { fake, host, session } = setup([]);
  fake.seedPage({ uid: "pg1", title: "Paper", children: [{ uid: "hl1", string: "quoted text" }] });
  const before = host.stats.writes;
  const id = await session.addHighlightNote("hl1");
  assert.equal(typeof id, "string");
  assert.equal(await assertOneGroup(session, fake, host, before), 1);
});

test("status change writes nothing in Plexus", async () => {
  const { host } = setup([]);
  const uids = [];
  for (let i = 0; i < 100; i += 1) uids.push(`task${i}`);
  const calls = [];
  const before = host.stats.writes;
  const previous = host.stats.lastAction;
  const result = await applyStatusPicks(uids, "Doing", async (uid, name) => {
    calls.push([uid, name]);
    return { status: "ok" };
  });
  assert.equal(calls.length, 45);
  assert.equal(result.applied, 45);
  assert.equal(host.stats.writes, before);
  assert.equal(host.stats.lastAction, previous);
});

test("lenses, source chip, and timeline viewing write nothing", async () => {
  const { host } = setup(manyCards(100));
  const before = host.stats.writes;
  const previous = host.stats.lastAction;
  const cards = [];
  const edges = [];
  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    const uid = `c${String(i).padStart(2, "0")}`;
    cards.push({ uid, tags: i % 2 === 0 ? ["alpha", "beta"] : ["beta"] });
    edges.push(stubEl(uid));
    rows.push({ cardUid: uid, pageTitle: "October 6th, 2026", pageUid: "dayp", time: i });
    sourceChipFor({
      pageTitle: i % 2 === 0 ? `Articles/Paper ${i}` : "Other page",
      pageUid: `p${i}`,
      pageChildren: [{ string: "Author:: Ada" }],
    });
    host.dailyBlocks(new Date(2026, 0, (i % 28) + 1));
  }
  const catalog = lensCatalog(cards);
  const bright = lensBright(catalog.byUid, "alpha");
  assert.equal(bright.size, 50);
  const grouped = groupTimeline(rows);
  assert.ok(grouped.length >= 1);
  applyStrength(edges, edges.map(() => 3));
  applyDust(edges, edges.map(() => 1));
  clearLens(edges, edges);
  assert.equal(host.stats.writes, before);
  assert.equal(host.stats.lastAction, previous);
});

test("journal drag of one block is one write and one undo group", async () => {
  const { host, session, fake } = setup([]);
  const before = host.stats.writes;
  const ids = await session.addRefCards([{ string: "((jnl00001))", x: 40, y: 40 }]);
  assert.equal(ids.length, 1);
  assert.equal(await assertOneGroup(session, fake, host, before), 1);
});

test("layout by date of 100 cards stops at 45 writes and one undo group", async () => {
  const children = [];
  for (let i = 0; i < 100; i += 1) {
    const uid = `c${String(i).padStart(2, "0")}`;
    children.push({ uid, string: "Date:: 2026-10-06", props: { plexus: { x: 4, y: 4, w: 80, h: 40 } } });
  }
  const { host, session, fake } = setup([sectionOf(children)]);
  const toasts = watchToasts(session);
  const before = host.stats.writes;
  const n = await session.layoutByDate("sect1", { mode: "attribute" });
  assert.equal(n, 45);
  assert.ok(n <= 45);
  assert.deepEqual(toasts, [capToast(45, 100)]);
  let placed = 0;
  for (let i = 0; i < 100; i += 1) {
    const uid = `c${String(i).padStart(2, "0")}`;
    if (fake.block(uid)?.props?.plexus?.x === 156) placed += 1;
  }
  assert.equal(placed, 45);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);
});

test("layout by date from 100 mention rows stops at 45 writes and one undo group", async () => {
  const children = [];
  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    const uid = `c${String(i).padStart(2, "0")}`;
    children.push({ uid, string: "no date here", props: { plexus: { x: 4, y: 4, w: 80, h: 40 } } });
    rows.push([uid, `r${i}`, "October 6th, 2026", "dayp", i]);
  }
  const { host, session, fake } = setup([sectionOf(children)]);
  const toasts = watchToasts(session);
  const before = host.stats.writes;
  const n = await session.layoutByDate("sect1", { mode: "first", rows });
  assert.equal(n, 45);
  assert.ok(n <= 45);
  assert.deepEqual(toasts, [capToast(45, 100)]);
  assert.equal(await assertOneGroup(session, fake, host, before), 45);
});
