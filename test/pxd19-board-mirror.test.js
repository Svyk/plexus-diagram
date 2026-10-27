// PXD-19: a board follows another board, or one section of it. The source's cards are rows in the place tray; cards
// the source got by mirroring a third board are not passed on, and a board never mirrors itself or closes a loop.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-follow.js";
import {
  FOLLOW_QUIET_MS,
  FOLLOW_READ_CAP,
  LEFT_CONFIRM,
  MIRROR_CHAIN_CAP,
  followPointerFor,
  keptFollow,
  mirrorRefusal,
  normalizePointer,
  readFollow,
  serializePointer,
  sourceKey,
  withFollow,
} from "../src/model/follow.js";
import { BOARD_MEMBERS_QUERY, PARENTS_PULL, followKind } from "../src/host/follow-sources.js";
import { BOARD_MEMBER_RULE } from "../src/model/board-rule.js";
import { RELAYED_NOTE, createFollowTray } from "../src/view/follow-tray.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// ---------------------------------------------------------------- pointer

test("PXD-19 pointer: a section survives normalize and serialize, and makes its own source key", () => {
  const p = normalizePointer({ kind: "board", uid: "SB", section: "s1" });
  assert.deepEqual(p, { kind: "board", uid: "SB", section: "s1", skip: [] });
  assert.deepEqual(serializePointer(p), { kind: "board", uid: "SB", section: "s1" });
  assert.equal(normalizePointer({ kind: "board", uid: "SB", section: "a/b" }).section, undefined, "not a uid: dropped");
  assert.equal(sourceKey({ kind: "board", uid: "SB" }), "board:SB");
  assert.equal(sourceKey({ kind: "board", uid: "SB", section: "s1" }), "board:SB/s1");
  assert.equal(sourceKey({ kind: "block", uid: "X" }), "block:X");
});

test("PXD-19 pointer: the same board in another section is another source; the same section keeps its skip list", () => {
  const cur = { kind: "board", uid: "SB", section: "s1", skip: ["a"] };
  assert.deepEqual(followPointerFor(cur, "board", "SB", { section: "s1" }), { kind: "board", uid: "SB", section: "s1", skip: ["a"] });
  assert.deepEqual(followPointerFor(cur, "board", "SB", { section: "s2" }), { kind: "board", uid: "SB", section: "s2", skip: [] });
  assert.deepEqual(followPointerFor(cur, "board", "SB"), { kind: "board", uid: "SB", skip: [] }, "the whole board is another source");
  assert.deepEqual(followPointerFor({ kind: "board", uid: "SB", skip: ["b"] }, "board", "SB"), { kind: "board", uid: "SB", skip: ["b"] });
});

test("PXD-19 pointer: a stopped section source keeps its skip list under its own key", () => {
  const followed = withFollow({ v: 2 }, { kind: "board", uid: "SB", section: "s1", skip: ["a", "b"] });
  const stopped = withFollow(followed, null);
  assert.equal(readFollow(stopped), null);
  const kept = keptFollow(stopped, "board:SB/s1");
  assert.deepEqual(kept, { kind: "board", uid: "SB", section: "s1", skip: ["a", "b"] });
  assert.equal(keptFollow(stopped, "board:SB"), null, "the whole board has no list of its own");
  const again = withFollow(stopped, followPointerFor(kept, "board", "SB", { section: "s1" }));
  assert.deepEqual(readFollow(again).skip, ["a", "b"]);
  assert.equal(again.followSkip, undefined);
});

// ---------------------------------------------------------------- loop guard

test("PXD-19 loop guard: self, a direct loop, a three-board loop, and no loop", () => {
  const graph = { A: [], B: ["A"], C: ["D"], D: ["A"], E: ["F"], F: [] };
  const followsOf = (uid) => graph[uid] || [];
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "A" }, followsOf }), "self");
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "A", section: "s" }, followsOf }), "self");
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "B" }, followsOf }), "cycle");
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "C" }, followsOf }), "cycle");
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "E" }, followsOf }), "");
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "block", uid: "A" }, followsOf }), "", "other kinds are not mirrors");
});

test("PXD-19 loop guard: a long chain stops at the cap, a ring without this board ends, a throwing read mirrors nothing", () => {
  let calls = 0;
  const chain = (uid) => { calls += 1; return [`n${Number(uid.slice(1)) + 1}`]; };
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "n0" }, followsOf: chain }), "");
  assert.equal(calls, MIRROR_CHAIN_CAP);
  const ring = { X: ["Y"], Y: ["X"] };
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "X" }, followsOf: (u) => ring[u] }), "");
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "B" }, followsOf: () => { throw new Error("gone"); } }), "");
  const partly = (u) => { if (u === "B") throw new Error("gone"); return u === "C" ? ["B", "D"] : u === "D" ? ["A"] : []; };
  assert.equal(mirrorRefusal({ boardUid: "A", pointer: { kind: "board", uid: "C" }, followsOf: partly }), "cycle");
});

// ---------------------------------------------------------------- the kind's read (plain host)

const row = (uid, string, parent, order, plexus = {}, parentOrder = 0) => [
  { ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": { plexus }, ":create/time": 5, ":edit/time": 9 },
  parent,
  parentOrder,
];
const SECTION = (extra = {}) => ({ type: "section", x: 0, y: 0, w: 400, h: 300, ...extra });

function plainHost({ blocks = {}, rows = {}, pages = {}, strings = {}, parents = {} } = {}) {
  const calls = [];
  const watched = [];
  return {
    calls,
    watched,
    pullEntity(pattern, uid) {
      if (pattern === PARENTS_PULL) return parents[uid] ? { ":block/uid": uid, ":block/parents": parents[uid].map((u) => ({ ":block/uid": u })) } : null;
      const b = blocks[uid];
      return b ? { ":block/uid": uid, ":block/string": b.string ?? "", ":block/props": { ":plexus": b.plexus } } : null;
    },
    q(...args) { calls.push(args); return rows[args[2]] ?? []; },
    pageUid: (title) => pages[title] ?? null,
    blockString: (uid) => strings[uid] ?? null,
    watchBlock(uid) { watched.push(uid); return () => {}; },
  };
}

const BOARD_ROWS = () => [
  row("s2", "Second section", "SB", 3, SECTION()),
  row("t2", "top two", "SB", 2),
  row("s1", "First section\nmore", "SB", 1, SECTION()),
  row("t1", "top one", "SB", 0),
  row("a2", "((REF))", "s1", 1),
  row("a1", "[[Topic]]", "s1", 0),
  row("in1", "inside nested", "s3", 0),
  row("s3", "Nested", "s1", 2, SECTION()),
  row("bl", "   ", "s2", 0),
  row("rl", "((FAR))", "s2", 1, { src: "board:OTHER" }),
  row("np", "[[No such page]]", "s2", 2),
];

function readHost(extra = {}) {
  return plainHost({
    blocks: { SB: { string: "{{[[diagram]]: Reading}}", plexus: { v: 2 } }, s1: { string: "First section", plexus: SECTION() }, OLD: { string: "{{[[diagram]]}}", plexus: {} } },
    rows: { SB: BOARD_ROWS(), s1: BOARD_ROWS().filter((r) => ["a1", "a2", "s3", "in1"].includes(r[0][":block/uid"])) },
    pages: { Topic: "TOPIC" },
    strings: { REF: "the ref text", FAR: "far away" },
    parents: { s1: ["SBPAGE", "SB"] },
    ...extra,
  });
}
const readOf = (host, p, boardUid = "b1") => followKind("board").read({ kind: "board", skip: [], ...p }, { host, boardUid });

test("PXD-19 read: a whole board lists its cards in outline order; sections name their cards and are not rows", async () => {
  const host = readHost();
  const res = await readOf(host, { uid: "SB" });
  assert.equal(res.ok, true);
  assert.equal(res.complete, true);
  assert.deepEqual(res.items.map((i) => [i.uid, i.crumb || ""]), [
    ["t1", ""], ["TOPIC", "First section"], ["REF", "First section"], ["in1", "Nested"], ["t2", ""], ["bl", "Second section"],
  ]);
  assert.deepEqual(res.items[1], { uid: "TOPIC", kind: "page", title: "Topic", text: "Topic", time: 9, crumb: "First section" });
  assert.deepEqual(res.items[2], { uid: "REF", kind: "block", text: "the ref text", time: 9, crumb: "First section" }, "a ref card shows its block");
  assert.deepEqual(res.items[0], { uid: "t1", kind: "block", text: "top one", time: 9 });
  assert.equal(res.items[5].blank, true);
  assert.equal(res.relayed, 1, "the card the source mirrored from a third board is not passed on");
  for (const uid of ["rl", "FAR", "np", "a1", "a2", "TOPIC", "REF", "t1"]) assert.ok(res.members.includes(uid), `${uid} is a member`);
  assert.equal(res.items.some((i) => ["s1", "s2", "s3", "FAR", "rl", "np"].includes(i.uid)), false);
  assert.equal(host.calls.length, 1, "one q");
  assert.equal(host.calls[0][0], BOARD_MEMBERS_QUERY);
  assert.equal(host.calls[0][1], BOARD_MEMBER_RULE, "the rule string goes in as %");
  assert.equal(host.calls[0][2], "SB");
});

test("PXD-19 read: a section source binds the section and lists its cards and its nested sections' cards", async () => {
  const host = readHost();
  const res = await readOf(host, { uid: "SB", section: "s1" });
  assert.equal(res.ok, true);
  assert.equal(host.calls[0][2], "s1", "the rule is bound to the section");
  assert.deepEqual(res.items.map((i) => [i.uid, i.crumb || ""]), [["TOPIC", ""], ["REF", ""], ["in1", "Nested"]]);
});

test("PXD-19 read: missing board, a board that is not enhanced, a missing section, self and loops say why", async () => {
  const host = readHost();
  assert.deepEqual(await readOf(host, { uid: "NOPE" }), { ok: false, reason: "missing" });
  assert.deepEqual(await readOf(host, { uid: "OLD" }), { ok: false, reason: "missing" });
  assert.deepEqual(await readOf(host, { uid: "SB", section: "gone" }), { ok: false, reason: "missingSection" });
  assert.deepEqual(await readOf(host, { uid: "SB", section: "t1" }), { ok: false, reason: "missingSection" }, "a card is not a section");
  const elsewhere = readHost({ parents: { s1: ["OTHERPAGE", "OTHER"] } });
  assert.deepEqual(await readOf(elsewhere, { uid: "SB", section: "s1" }), { ok: false, reason: "missingSection" }, "a section of another board");
  assert.deepEqual(await readOf(host, { uid: "b1" }), { ok: false, reason: "self" });
  assert.equal(host.calls.length, 0, "none of these runs the q");
  const loop = readHost();
  loop.pullEntity = ((pull) => (pattern, uid) => (uid === "SB" ? { ":block/string": "", ":block/props": { ":plexus": { ":v": 2, ":follow": { ":kind": "board", ":uid": "b1" } } } } : pull(pattern, uid)))(loop.pullEntity);
  assert.deepEqual(await readOf(loop, { uid: "SB" }), { ok: false, reason: "cycle" });
  const sectionLoop = readHost();
  sectionLoop.q = () => [row("s9", "Mirror", "SB", 0, SECTION({ follow: { kind: "board", uid: "b1", section: "x1" } })), row("k", "kid", "s9", 0)];
  assert.deepEqual(await readOf(sectionLoop, { uid: "SB" }), { ok: false, reason: "cycle" }, "a section of the source mirrors this board");
});

test("PXD-19 read: past the read cap the read is partial", async () => {
  const many = Array.from({ length: FOLLOW_READ_CAP + 5 }, (_, i) => row(`c${i}`, `card ${i}`, "SB", i));
  const host = readHost({ rows: { SB: many } });
  const res = await readOf(host, { uid: "SB" });
  assert.equal(res.ok, true);
  assert.equal(res.items.length, FOLLOW_READ_CAP);
  assert.equal(res.complete, false);
});

test("PXD-19 read: names a board and a section", () => {
  const host = readHost();
  const kind = followKind("board");
  assert.equal(kind.title, "Another board");
  assert.equal(kind.describe({ kind: "board", uid: "SB" }, host), "Board “Reading”");
  assert.equal(kind.describe({ kind: "board", uid: "SB", section: "s1" }, host), "Section “First section” of “Reading”");
});

test("PXD-19 watch: a whole board sets no pull watch on the source; a section watches only the section", () => {
  const kind = followKind("board");
  const whole = plainHost();
  kind.watch({ kind: "board", uid: "SB" }, whole, () => {}, {})();
  assert.deepEqual(whole.watched, []);
  const sec = plainHost();
  kind.watch({ kind: "board", uid: "SB", section: "s1" }, sec, () => {}, {})();
  assert.deepEqual(sec.watched, ["s1"]);
});

// ---------------------------------------------------------------- end to end: fake Roam, session and tray

function manualTimers() {
  const later = [];
  const idle = [];
  return {
    later: (fn, ms) => { const e = { fn, ms, on: true }; later.push(e); return () => { e.on = false; }; },
    bgIdle: (fn) => { const e = { fn, on: true }; idle.push(e); return () => { e.on = false; }; },
    idle: (fn) => { const id = setImmediate(fn); return () => clearImmediate(id); },
    pending: (ms) => later.filter((e) => e.on && (ms === undefined || e.ms === ms)).length,
    async run(ms = FOLLOW_QUIET_MS) {
      for (const e of later.splice(0)) {
        if (!e.on) continue;
        if (e.ms === ms) e.fn();
        else later.push(e);
      }
      for (const e of idle.splice(0)) if (e.on) e.fn();
      await flush();
    },
  };
}

const CONTAINERS = new Set(["edges", "snapshots", "regions", "trails"]);
const typeOf = (node) => node?.[":block/props"]?.[":plexus"]?.[":type"];
// What the board-member rule gives for `root` in the fake graph: its non-container children, and the children of
// every section under it.
function memberRows(fake, root) {
  const tree = fake.api.data.pull("[:block/uid :block/string :block/props :block/order {:block/children ...}]", [":block/uid", root]);
  if (!tree) return [];
  const out = new Map();
  for (const kid of tree[":block/children"] || []) if (!CONTAINERS.has(typeOf(kid))) out.set(kid[":block/uid"], [kid, root, tree[":block/order"] ?? -1]);
  const walk = (node) => {
    for (const kid of node[":block/children"] || []) {
      if (typeOf(kid) === "section") for (const k of kid[":block/children"] || []) out.set(k[":block/uid"], [k, kid[":block/uid"], kid[":block/order"]]);
      walk(kid);
    }
  };
  walk(tree);
  return [...out.values()];
}

const card = (uid, string, x, y, extra = {}) => ({ uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } } });

function mount({ follow = { kind: "board", uid: "SB", section: "s1" }, boardKids } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Other page", uid: "OTHERPAGE", children: [{ uid: "ELSE", string: "Somewhere else" }] });
  fake.seedPage({ title: "Source page", uid: "SBPAGE" });
  fake.seedBoard({ uid: "SB", string: "{{[[diagram]]: Reading}}", parent: "SBPAGE", props: { plexus: { v: 2 } }, children: [
    card("t1", "top one", 0, 0),
    { uid: "s1", string: "First section", props: { plexus: SECTION() }, children: [card("m1", "member one", 10, 10), card("m2", "member two", 10, 120)] },
  ] });
  fake.seedPage({ title: "Board page", uid: "BPAGE" });
  fake.seedBoard({ uid: "b1", parent: "BPAGE", props: { plexus: { v: 2, ...(follow ? { follow } : {}) } }, children: boardKids ?? [
    card("n1", "Note one", 0, 0),
    card("c1", "((m1))", 0, 200, { src: "board:SB/s1" }),
  ] });
  const route = fake.onQuery(/board-member/, (query, rule, root) => memberRows(fake, root));
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const timers = manualTimers();
  const tray = createFollowTray({ doc: dom.document, root, host, session, timers, board: () => session.board, storage: fake.storage, graph: "g", now: () => 0 });
  return { fake, host, session, root, timers, tray, route };
}

test("PXD-19 tray: a section source lists the section's cards; a new card arrives after the section's watch fires", async () => {
  const f = mount();
  await f.timers.run();
  assert.equal(f.tray.reads(), 1);
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["m2"], "m1 is on the board as c1");
  assert.equal(f.route.calls[0][1], BOARD_MEMBER_RULE);
  assert.equal(f.route.calls[0][2], "s1");
  await f.fake.api.data.block.create({ location: { "parent-uid": "s1", order: "last" }, block: { uid: "m3", string: "member three", props: { plexus: { x: 10, y: 240 } } } });
  await f.fake.flush();
  assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "the section watch schedules a read");
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["m2", "m3"]);
  assert.equal(f.tray.menuState().label, "Section “First section” of “Reading”");
  f.tray.dispose();
});

test("PXD-19 tray: a card moved out of the section leaves after LEFT_CONFIRM complete reads", async () => {
  const f = mount();
  await f.timers.run();
  await f.fake.api.data.block.move({ location: { "parent-uid": "ELSE", order: "last" }, block: { uid: "m1" } });
  await f.fake.flush();
  for (let i = 1; i < LEFT_CONFIRM; i += 1) {
    await f.timers.run();
    assert.deepEqual(f.tray.left(), [], "not yet");
  }
  await f.timers.run();
  assert.deepEqual(f.tray.left(), ["c1"]);
  assert.ok(f.fake.has("c1"), "the card stays");
  f.tray.dispose();
});

test("PXD-19 tray: a read that finds a loop keeps the last list and marks nothing", async () => {
  const f = mount();
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["m2"]);
  await f.fake.api.data.block.update({ block: { uid: "SB", props: { plexus: { v: 2, follow: { kind: "board", uid: "b1" } } } } });
  await f.fake.api.data.block.move({ location: { "parent-uid": "ELSE", order: "last" }, block: { uid: "m1" } });
  await f.fake.flush();
  for (let i = 0; i < LEFT_CONFIRM + 1; i += 1) { f.tray.refresh(); await f.timers.run(); }
  assert.deepEqual(f.tray.left(), [], "a failed read marks nothing");
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["m2"], "the last good list stays");
  f.tray.open();
  assert.ok(f.root.querySelectorAll(".pxd-follow__note").some((n) => n.textContent === "That board follows this one, so mirroring it would make a loop."));
  f.tray.dispose();
});

test("PXD-19 tray: a whole-board source lists top-level and section cards and says when it held back relayed cards", async () => {
  const f = mount({ follow: { kind: "board", uid: "SB" } });
  await f.fake.api.data.block.create({ location: { "parent-uid": "s1", order: "last" }, block: { uid: "r1", string: "((ELSE))", props: { plexus: { x: 0, y: 0, src: "board:FAR" } } } });
  await f.fake.flush();
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["t1", "m2"], "m1 is on the board as c1; r1 is held back");
  assert.equal(f.tray.menuState().label, "Board “Reading”");
  f.tray.open();
  assert.ok(f.root.querySelectorAll(".pxd-follow__note").some((n) => n.textContent === RELAYED_NOTE));
  f.tray.dispose();
});

// ---------------------------------------------------------------- session

test("PXD-19 session: refuses self and loops, accepts a section, and placed cards carry the section key", async () => {
  const f = mount({ follow: null, boardKids: [card("n1", "Note one", 0, 0), { uid: "bs", string: "Own section", props: { plexus: SECTION() } }] });
  f.tray.dispose();
  assert.equal(f.session.mirrorRefusalOf({ kind: "board", uid: "b1", section: "bs" }), "self");
  assert.equal(await f.session.followSource({ kind: "board", uid: "b1", section: "bs" }), false);
  assert.equal(f.session.mirrorRefusalOf({ kind: "block", uid: "SB" }), "", "other kinds are not mirrors");
  // A section of the source mirrors this board (the PXD-13 shape): a loop.
  await f.fake.api.data.block.update({ block: { uid: "s1", props: { plexus: { ...SECTION(), follow: { kind: "board", uid: "b1" } } } } });
  assert.equal(f.session.mirrorRefusalOf({ kind: "board", uid: "SB" }), "cycle");
  assert.equal(await f.session.followSource({ kind: "board", uid: "SB", section: "s1" }), false);
  assert.equal(readFollow(f.fake.props("b1").plexus), null, "nothing written");
  await f.fake.api.data.block.update({ block: { uid: "s1", props: { plexus: SECTION() } } });
  assert.equal(f.session.mirrorRefusalOf({ kind: "board", uid: "SB" }), "");
  assert.equal(await f.session.followSource({ kind: "board", uid: "SB", section: "s1" }), true);
  assert.deepEqual(f.fake.props("b1").plexus.follow, { kind: "board", uid: "SB", section: "s1" });
  const res = await f.session.placeFollowed([{ uid: "m1", kind: "block" }]);
  assert.equal(res.placed, 1);
  const made = res.uids[0];
  assert.equal(f.fake.api.data.pull("[:block/string]", [":block/uid", made])[":block/string"], "((m1))");
  assert.equal(f.fake.props(made).plexus.src, "board:SB/s1");
});

test("PXD-19 + PXD-13: a section of this board mirrors a section of another board; loops are refused there too", async () => {
  const f = mount({ follow: null, boardKids: [{ uid: "own", string: "Mine", props: { plexus: SECTION() } }] });
  f.tray.dispose();
  assert.equal(await f.session.followSource({ kind: "board", uid: "b1", section: "own", owner: "own" }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "self" });
  assert.equal(await f.session.followSource({ kind: "board", uid: "SB", section: "s1", owner: "own" }), true);
  assert.deepEqual(f.fake.props("own").plexus.follow, { kind: "board", uid: "SB", section: "s1" });
  assert.equal(readFollow(f.fake.props("b1").plexus), null, "the board's own props stay");
  assert.equal(f.session.followOwners().owners.find((o) => o.uid === "own")?.key, "board:SB/s1");
  // The whole source board (another key) may go to the board; a loop back from the source may not.
  await f.fake.api.data.block.update({ block: { uid: "SB", props: { plexus: { v: 2, follow: { kind: "board", uid: "b1" } } } } });
  assert.equal(await f.session.followSource({ kind: "board", uid: "SB", owner: "own" }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "cycle" });
});

// ---------------------------------------------------------------- menu

test("PXD-19 menu: the board menu offers another board or section, and a board card offers This board", () => {
  const idsOf = (menu) => flattenMenu(menu).map((m) => m.id);
  const off = flattenMenu(buildMenu("board-menu", { follow: { following: false } }));
  assert.equal(off.find((m) => m.id === "follow:pick-board")?.label, "Another board or section…");
  const on = flattenMenu(buildMenu("board-menu", { follow: { following: true, kind: "board", label: "Board “Reading”", waiting: 1 } }));
  assert.equal(on.find((m) => m.id === "follow:pick-board")?.label, "Switch to another board or section…");
  const boardCard = flattenMenu(buildMenu("card", { follow: { board: true } }));
  assert.equal(boardCard.find((m) => m.id === "follow:this-board")?.label, "This board");
  assert.equal(idsOf(buildMenu("card", { follow: { block: true } })).includes("follow:this-board"), false);
});
