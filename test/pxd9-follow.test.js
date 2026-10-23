// PXD-9: a board follows a source (a block's children or tree, a {{query}}, linked references) through a place tray.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard } from "../src/model/board.js";
import { SPREAD_CAP } from "../src/session-clip.js";
import "../src/session-follow.js";
import {
  FOLLOW_SKIP_CAP,
  LEFT_CONFIRM,
  absentStep,
  addSkip,
  followBatches,
  followColumn,
  followDiff,
  followPointerFor,
  leftUnsettled,
  normalizePointer,
  readFollow,
  serializePointer,
  sinceVisit,
  sourceKey,
  textSourceUid,
  trayHeadline,
  withFollow,
} from "../src/model/follow.js";
import { FOLLOW_READ_CAP } from "../src/model/follow.js";
import { followKind, refsQuery, treeItems, treePattern } from "../src/host/follow-sources.js";

afterEach(() => resetSessions());

const flush = () => new Promise((resolve) => setImmediate(resolve));
const card = (uid, string, x, y, extra = {}, children = []) => ({ uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } }, children });

// ---------------------------------------------------------------- model

test("PXD-9 pointer: normalized, serialized without defaults, merged into the board plexus", () => {
  assert.equal(normalizePointer(null), null);
  assert.equal(normalizePointer({ kind: "block" }), null);
  assert.equal(normalizePointer({ kind: "Block!", uid: "abc" }), null);
  assert.deepEqual(normalizePointer({ kind: "journal-window", uid: "abc" }), { kind: "journal-window", uid: "abc", skip: [] }, "a kind this version does not know is kept");
  const p = normalizePointer({ kind: "block", uid: "src000001", tree: true, skip: ["a", "a", 7, "b c", "b"] });
  assert.deepEqual(p, { kind: "block", uid: "src000001", tree: true, skip: ["a", "b"] });
  assert.deepEqual(serializePointer({ kind: "query", uid: "q", tree: false, skip: [] }), { kind: "query", uid: "q" });
  const board = { v: 2, bg: "dots" };
  const on = withFollow(board, p);
  assert.deepEqual(on, { v: 2, bg: "dots", follow: { kind: "block", uid: "src000001", tree: true, skip: ["a", "b"] } });
  assert.deepEqual(readFollow(on), p);
  assert.deepEqual(withFollow(on, null), board);
  assert.equal(sourceKey(p), "block:src000001");
});

test("PXD-9 pointer: the same source keeps its skip list and tree; a new source starts clean", () => {
  const cur = { kind: "block", uid: "A", tree: true, skip: ["x"] };
  assert.deepEqual(followPointerFor(cur, "block", "A"), { kind: "block", uid: "A", tree: true, skip: ["x"] });
  assert.deepEqual(followPointerFor(cur, "block", "A", { tree: false }), { kind: "block", uid: "A", skip: ["x"] });
  assert.deepEqual(followPointerFor(cur, "query", "A"), { kind: "query", uid: "A", skip: [] });
  assert.deepEqual(followPointerFor(null, "refs", "P"), { kind: "refs", uid: "P", skip: [] });
});

test("PXD-9 skip list: re-adding moves to the end, the oldest drop past the cap", () => {
  assert.deepEqual(addSkip(["a", "b", "c"], ["a"]), ["b", "c", "a"]);
  const full = Array.from({ length: FOLLOW_SKIP_CAP }, (_, i) => `u${i}`);
  const next = addSkip(full, ["new"]);
  assert.equal(next.length, FOLLOW_SKIP_CAP);
  assert.equal(next[0], "u1");
  assert.equal(next.at(-1), "new");
});

test("PXD-9 board text: a lone ((uid)) after the colon is offered as a source; a title is not", () => {
  assert.equal(textSourceUid("{{[[diagram]]: ((abcdefghi))}}"), "abcdefghi");
  assert.equal(textSourceUid("{{diagram: ((abcdefghi))}}"), "abcdefghi");
  assert.equal(textSourceUid("{{[[diagram]]: ((pxd9fsSrc01))}}"), "pxd9fsSrc01", "an API-made uid is longer");
  assert.equal(textSourceUid("{{[[diagram]]: Plain title}}"), null);
  assert.equal(textSourceUid("{{[[diagram]]: ((abcdefghi)) and more}}"), null);
  assert.equal(textSourceUid("{{diagram ((abcdefghi))}}"), null, "Roam draws no diagram without the colon");
});

function boardOf(children, plexus = { v: 2 }) {
  return buildBoard({ ":block/uid": "B", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": plexus }, ":block/children": children.map((c, i) => ({
    ":block/uid": c.uid,
    ":block/string": c.string,
    ":block/order": i,
    ":block/props": { ":plexus": c.plexus },
  })) });
}

const KEY = "block:SRC";
const item = (uid, extra = {}) => ({ uid, kind: "block", text: uid, time: 10, ...extra });

test("PXD-9 diff: on-board, skipped and blank items stay out of the tray; new is by the visit stamp", () => {
  const board = boardOf([
    { uid: "c1", string: "((k1))", plexus: { x: 0, y: 0, src: KEY } },
    { uid: "c2", string: "[[Page P]]", plexus: { x: 0, y: 200 } },
    { uid: "c3", string: "a plain note", plexus: { x: 300, y: 0 } },
  ]);
  const read = {
    ok: true,
    complete: true,
    items: [item("k1"), item("k2", { time: 500 }), item("k3"), item("k4", { blank: true }), item("pg1", { kind: "page", title: "Page P" }), item("k2")],
  };
  const d = followDiff(read, board, { key: KEY, skip: ["k3"], since: 100 });
  assert.deepEqual(d.pending.map((r) => r.uid), ["k2"]);
  assert.equal(d.pending[0].fresh, true);
  assert.equal(d.placed, 2, "the ref card and the page card (matched by title)");
  assert.equal(d.dismissed, 1);
  assert.deepEqual(d.left, []);
  assert.deepEqual(followDiff({ ok: false }, board, { key: KEY }).pending, []);
});

test("PXD-9 diff: a followed card is marked left only after two complete reads without it", () => {
  const board = boardOf([
    { uid: "c1", string: "((k1))", plexus: { x: 0, y: 0, src: KEY } },
    { uid: "c2", string: "((k2))", plexus: { x: 0, y: 200, src: KEY } },
    { uid: "c3", string: "((k9))", plexus: { x: 300, y: 0 } },
    { uid: "c4", string: "((k8))", plexus: { x: 300, y: 200, src: "query:OTHER" } },
  ]);
  const without = { ok: true, complete: true, items: [item("k1")] };
  let absent = absentStep(new Map(), without, board, KEY);
  assert.deepEqual([...absent], [["c2", 1]]);
  assert.equal(leftUnsettled(absent), true, "one more read settles it");
  assert.deepEqual(followDiff(without, board, { key: KEY, absent }).left, []);
  // A partial read never counts a card it did not see; a failed read changes nothing.
  assert.deepEqual([...absentStep(absent, { ok: true, complete: false, items: [item("k1")] }, board, KEY)], [["c2", 1]]);
  assert.deepEqual([...absentStep(absent, { ok: false }, board, KEY)], [["c2", 1]]);
  absent = absentStep(absent, without, board, KEY);
  assert.equal(absent.get("c2"), LEFT_CONFIRM);
  assert.deepEqual(followDiff(without, board, { key: KEY, absent }).left, ["c2"], "cards without this source's mark are never marked");
  // Back in the source: the count clears on the next read.
  absent = absentStep(absent, { ok: true, complete: false, items: [item("k1"), item("k2")] }, board, KEY);
  assert.deepEqual([...absent], []);
});

test("PXD-9 headline: counts since the last visit; left only counts what was not left before", () => {
  const diff = { pending: [{ fresh: true }, { fresh: true }, { fresh: false }], left: ["c1", "c2"] };
  assert.deepEqual(sinceVisit(diff, { since: null }), { newCount: 0, leftCount: 0, baseline: false });
  const s = sinceVisit(diff, { since: 5, leftBefore: new Set(["c1"]) });
  assert.deepEqual(s, { newCount: 2, leftCount: 1, baseline: true });
  assert.equal(trayHeadline(s), "2 new, 1 left since your last visit");
  assert.equal(trayHeadline({ newCount: 3, baseline: true }), "3 new since your last visit");
  assert.equal(trayHeadline({ baseline: true }), "Nothing new since your last visit");
  assert.equal(trayHeadline({ newCount: 3 }), "");
});

test("PXD-9 place column: right of the cards, one column per batch, or at a drop point", () => {
  const spots = followColumn({ x: 0, y: 40, w: 500, h: 300 }, 3, { w: 200, h: 100 });
  assert.deepEqual(spots, [{ x: 548, y: 40 }, { x: 548, y: 164 }, { x: 548, y: 288 }]);
  assert.equal(followColumn({ x: 0, y: 40, w: 500, h: 300 }, 1, { w: 200, h: 100, column: 2 })[0].x, 548 + 2 * 248);
  assert.deepEqual(followColumn(null, 1, { w: 200, h: 100 }), [{ x: 0, y: 0 }]);
  assert.deepEqual(followColumn(null, 1, { w: 200, h: 100, at: { x: 7, y: 9 } }), [{ x: 7, y: 9 }]);
  assert.deepEqual(followBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

// ---------------------------------------------------------------- source kinds

const node = (uid, string, kids = [], extra = {}) => ({ ":block/uid": uid, ":block/string": string, ":edit/time": 1, ":block/children": kids.map((k, i) => ({ ...k, ":block/order": i })), ...extra });

test("PXD-9 block kind: children or the tree in outline order; task attributes and the board itself are skipped", () => {
  const root = node("SRC", "Source", [
    node("k1", "one", [node("g1", "grand", [node("gg1", "deep")])]),
    node("k2", "BT_attrDue:: [[October 1st, 2026]]"),
    node("BRD", "{{[[diagram]]}}", [node("card1", "on the board")]),
    node("k3", "  "),
  ]);
  const flat = treeItems(root, { depth: 1, skip: new Set(["BRD"]) });
  assert.deepEqual(flat.items.map((i) => i.uid), ["k1", "k3"]);
  assert.equal(flat.items[1].blank, true);
  assert.equal(flat.complete, true);
  const deep = treeItems(root, { depth: 2, skip: new Set(["BRD"]) });
  assert.deepEqual(deep.items.map((i) => `${i.uid}@${i.depth}`), ["k1@1", "g1@2", "k3@1"]);
  const capped = treeItems(root, { depth: 3, cap: 2 });
  assert.equal(capped.complete, false, "past the cap the read is partial");
  assert.equal(capped.items.length, 2);
  assert.ok(treePattern(1).includes("(limit :block/children nil)"));
  assert.equal(treePattern(3).split("(limit :block/children nil)").length - 1, 3);
});

test("PXD-9 block kind reads through the host: a gone block is a failed read, not an empty source", async () => {
  const kind = followKind("block");
  const host = { pullEntity: (pattern, uid) => (uid === "SRC" ? node("SRC", "Source", [node("k1", "one"), node("k2", "two")]) : null) };
  const got = await kind.read({ kind: "block", uid: "SRC" }, { host, boardUid: "BRD" });
  assert.deepEqual(got, { ok: true, complete: true, items: [
    { uid: "k1", kind: "block", text: "one", time: 1, depth: 1 },
    { uid: "k2", kind: "block", text: "two", time: 1, depth: 1 },
  ] });
  assert.deepEqual(await kind.read({ kind: "block", uid: "GONE" }, { host, boardUid: "BRD" }), { ok: false, reason: "missing" });
});

test("PXD-9 query kind: runs Plexus's own query engine; the query block, its children and board blocks are not results", async () => {
  const kind = followKind("query");
  const strings = { Q: "{{[[query]]: [[Lab]]}}", R00000001: "first #Lab", R00000002: "second [[Lab]]", OWN000001: "card text [[Lab]]", QK0000001: "under the query [[Lab]]" };
  const host = {
    pullEntity(pattern, uid) {
      if (pattern === "[:block/string]") return strings[uid] ? { ":block/string": strings[uid] } : null;
      if (uid === "Q") return node("Q", strings.Q, [node("QK0000001", strings.QK0000001)]);
      return null;
    },
    q(query, ...inputs) {
      if (query.includes("(count ?r)")) return [[4]];
      if (query.includes("(count ?b)")) return [[0]];
      if (query.includes(":block/parents ?r")) return [];
      if (query.includes("[?r :block/uid ?u]")) return [["R00000001"], ["R00000002"], ["OWN000001"], ["QK0000001"]];
      if (query.includes(":block/string \"\"")) return inputs[0].map((u) => [u, strings[u], "", 100]);
      if (query.includes(":edit/time 0) ?t]]")) return inputs[0].map((u, i) => [u, 100 + i]);
      return [];
    },
  };
  const got = await kind.read({ kind: "query", uid: "Q" }, { host, inBoard: () => new Set(["OWN000001"]), tick: () => Promise.resolve() });
  assert.equal(got.ok, true);
  assert.equal(got.complete, true);
  assert.deepEqual(got.items.map((i) => i.uid).sort(), ["R00000001", "R00000002"]);
  assert.equal(got.items.find((i) => i.uid === "R00000002").text, "second Lab");
  strings.Q = "{{[[query]]: some bare words}}";
  assert.deepEqual(await kind.read({ kind: "query", uid: "Q" }, { host, inBoard: () => new Set(), tick: () => Promise.resolve() }), { ok: false, reason: "unsupported" });
});

test("PXD-9 refs kind: newest first, board blocks, arrows and other boards' cards of the target are skipped", async () => {
  const kind = followKind("refs");
  const ref = (uid, string, time, extra = {}) => ({ ":block/uid": uid, ":block/string": string, ":edit/time": time, ":block/page": { ":node/title": "Daily" }, ...extra });
  let refs = [
    ref("r1", "about [[Lab]] today", 100),
    ref("r2", "later on [[Lab]]", 300),
    ref("own", "board card [[Lab]]", 400),
    ref("edge", "[[Lab]] → [[Other]]", 500, { ":block/props": { ":plexus": { type: "edge" } } }),
    ref("pc", "[[Lab]]", 600),
    ref("qb", "{{[[query]]: {and: [[Lab]] [[Done]]}}}", 50),
  ];
  const calls = [];
  const host = { q: (query, uid) => { calls.push([query, uid]); return [[{ ":node/title": "Lab", ":block/_refs": refs }]]; } };
  const got = await kind.read({ kind: "refs", uid: "PG" }, { host, inBoard: () => new Set(["own"]) });
  assert.equal(calls[0][0], refsQuery());
  assert.equal(calls[0][1], "PG");
  assert.ok(calls[0][0].includes(`(limit :block/_refs ${FOLLOW_READ_CAP + 1})`));
  assert.deepEqual(got.items.map((i) => i.uid), ["r2", "r1", "qb"]);
  assert.equal(got.items[2].text, "Query and: Lab Done", "a query block reads as a query, not as a stray brace");
  assert.equal(got.items[0].crumb, "Daily");
  assert.equal(got.complete, true);
  refs = Array.from({ length: FOLLOW_READ_CAP + 1 }, (_, i) => ref(`x${i}`, `mention ${i} [[Lab]]`, i));
  const full = await kind.read({ kind: "refs", uid: "PG" }, { host, inBoard: () => new Set() });
  assert.equal(full.complete, false, "a full pull is a partial read");
  assert.equal(full.items.length, FOLLOW_READ_CAP);
});

// ---------------------------------------------------------------- session writes

function setup({ plexus = { v: 2 }, children } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Src page", uid: "SRCPAGE", children: [
    { uid: "SRC", string: "Source block", children: [{ uid: "k1", string: "one" }, { uid: "k2", string: "two" }, { uid: "k3", string: "three" }] },
  ] });
  fake.seedBoard({ uid: "b1", props: { plexus }, children: children ?? [
    card("n1", "Note one", 0, 0, { color: "teal" }),
    card("c1", "((k1))", 0, 200, { src: "block:SRC" }),
    { uid: "S", string: "Section", props: { plexus: { type: "section", x: 400, y: 0, w: 300, h: 300 } }, children: [card("m1", "member", 20, 40)] },
  ] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}
const writes = (fake) => fake.writesLog();
const plexusOf = (fake, uid) => fake.props(uid)?.plexus;

test("PXD-9 session: Follow writes only the board's pointer; Stop following clears it and keeps every card", async () => {
  const { fake, session } = setup();
  assert.equal(await session.followSource({ kind: "block", uid: "SRC" }), true);
  await fake.flush();
  assert.deepEqual(writes(fake).map((w) => w[0]), ["update"]);
  assert.deepEqual(plexusOf(fake, "b1").follow, { kind: "block", uid: "SRC" });
  assert.equal(await session.followSource({ kind: "block", uid: "SRC" }), false, "the same pointer writes nothing");
  assert.equal(await session.followSource({ kind: "block", uid: "b1" }), false, "a board cannot follow itself");
  assert.equal(await session.setFollowTree(true), true);
  assert.deepEqual(plexusOf(fake, "b1").follow, { kind: "block", uid: "SRC", tree: true });
  fake.clearLog();
  assert.equal(await session.stopFollowing(), true);
  await fake.flush();
  assert.equal(plexusOf(fake, "b1").follow, undefined);
  assert.equal(plexusOf(fake, "b1").v, 2);
  assert.deepEqual(writes(fake).map((w) => w[0]), ["update"]);
  assert.ok(fake.has("c1") && fake.has("n1"));
});

test("PXD-9 session: Place writes ref cards right of the cards with the source key, and moves nothing", async () => {
  const { fake, session } = setup({ plexus: { v: 2, follow: { kind: "block", uid: "SRC" } } });
  const before = Object.fromEntries(["n1", "c1", "S", "m1"].map((u) => [u, plexusOf(fake, u)]));
  const res = await session.placeFollowed([{ uid: "k2", kind: "block" }, { uid: "k1", kind: "block" }, { uid: "pg", kind: "page", title: "Src page" }]);
  await fake.flush();
  assert.equal(res.placed, 2, "k1 already has a card");
  assert.equal(res.batches, 1);
  assert.deepEqual(writes(fake).map((w) => w[0]), ["create", "create"]);
  const [a, b] = res.uids;
  assert.equal(fake.block(a).string, "((k2))");
  assert.equal(fake.block(b).string, "[[Src page]]");
  assert.equal(fake.block(a).parent, "b1");
  assert.equal(plexusOf(fake, a).src, "block:SRC");
  assert.equal(plexusOf(fake, a).x, 748, "48 px right of the section's right edge");
  assert.equal(plexusOf(fake, a).y, 0);
  assert.equal(plexusOf(fake, b).y, 184);
  for (const [u, p] of Object.entries(before)) assert.deepEqual(plexusOf(fake, u), p, `${u} kept its layout`);
});

test("PXD-9 session: more than SPREAD_CAP places in batches, one transaction and one column each", async () => {
  const { fake, session } = setup({ plexus: { v: 2, follow: { kind: "query", uid: "Q" } } });
  const entries = Array.from({ length: SPREAD_CAP + 5 }, (_, i) => ({ uid: `r${String(i).padStart(8, "0")}`, kind: "block" }));
  const groups = [];
  const orig = session.host.group;
  session.host.group = async (fn) => { groups.push(1); return orig ? orig(fn) : fn(); };
  const res = await session.placeFollowed(entries);
  await fake.flush();
  session.host.group = orig;
  assert.deepEqual([res.placed, res.batches, res.total], [SPREAD_CAP + 5, 2, SPREAD_CAP + 5]);
  assert.equal(groups.length, 2, "one write group per batch");
  const xs = new Set(res.uids.map((u) => plexusOf(fake, u).x));
  assert.equal(xs.size, 2, "two columns");
});

test("PXD-9 session: a drop places one card at the drop point, inside the section under it", async () => {
  const { fake, session } = setup({ plexus: { v: 2, follow: { kind: "block", uid: "SRC" } } });
  const res = await session.placeFollowed([{ uid: "k3", kind: "block" }], { at: { x: 450, y: 100 } });
  await fake.flush();
  const [id] = res.uids;
  assert.equal(fake.block(id).parent, "S");
  assert.deepEqual([plexusOf(fake, id).x, plexusOf(fake, id).y], [50, 100]);
});

test("PXD-9 session: deleting a followed card skips its source uid in the same transaction; other cards do not", async () => {
  const { fake, session } = setup({ plexus: { v: 2, follow: { kind: "block", uid: "SRC" } } });
  fake.trackUndo = true;
  await session.deleteItems(["c1"]);
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "b1").follow.skip, ["k1"]);
  assert.equal(fake.has("c1"), false);
  fake.clearLog();
  await session.deleteItems(["n1"]);
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "b1").follow.skip, ["k1"]);
  assert.equal(writes(fake).filter((w) => w[0] === "update").length, 0);
});

test("PXD-9 session: Don't bring back adds to the skip list; Remove takes a card off and skips it; dismiss keeps the layout", async () => {
  const { fake, session } = setup({ plexus: { v: 2, follow: { kind: "block", uid: "SRC", skip: ["old"] } } });
  assert.equal(await session.dontBringBack(["k2", "k2"]), 1);
  assert.deepEqual(plexusOf(fake, "b1").follow.skip, ["old", "k2"]);
  assert.equal(await session.dontBringBack(["k2"]), 0);
  const layout = plexusOf(fake, "c1");
  assert.equal(await session.dismissLeft(["c1", "n1"]), 1);
  await fake.flush();
  const { src, ...rest } = layout;
  assert.equal(src, "block:SRC");
  assert.deepEqual(plexusOf(fake, "c1"), rest);
  await session.removeFollowed(["n1"]);
  await fake.flush();
  assert.equal(fake.has("n1"), false);
  assert.deepEqual(plexusOf(fake, "b1").follow.skip, ["old", "k2"], "a note card has no source uid to skip");
});
