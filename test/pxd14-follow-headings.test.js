// PXD-14: a board follows a page by its headings. Top-level H1-H3 blocks become sections, the blocks directly under
// each become ref cards inside it.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard } from "../src/model/board.js";
import { SPREAD_CAP } from "../src/session-clip.js";
import "../src/session-follow.js";
import { FOLLOW_QUIET_MS, absentStep, cardIds, followDiff, normalizePointer, sourceKey } from "../src/model/follow.js";
import { FOLLOW_HEAD, headingItems, headingPlan, headingsNote, movedCards } from "../src/model/follow-headings.js";
import { HEADINGS_PULL, followKind } from "../src/host/follow-sources.js";
import { createFollowTray } from "../src/view/follow-tray.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const KEY = "headings:PG";

// A pulled node: kids are [uid, string, heading?, kids?].
const node = (uid, string, order, heading, kids = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ...(heading ? { ":block/heading": heading } : {}),
  ":create/time": 5,
  ":edit/time": 9,
  ":block/children": kids,
});
const page = (kids) => ({ ":node/title": "Notes", ":block/children": kids });

const PAGE_CHILDREN = () => [
  { uid: "h1", string: "Alpha", heading: 1, children: [
    { uid: "a1", string: "alpha one" },
    { uid: "a2", string: "alpha two", children: [{ uid: "a2x", string: "deeper" }] },
    { uid: "a3", string: "BT_attrDue:: [[May 1st, 2026]]" },
  ] },
  { uid: "tp", string: "plain top", children: [{ uid: "tpk", string: "under plain" }] },
  { uid: "h2", string: "Beta", heading: 2, children: [{ uid: "b1", string: "beta one" }] },
  { uid: "h3", string: "Gamma", heading: 3 },
];

function setup({ plexus = { v: 2, follow: { kind: "headings", uid: "PG" } }, children, boardKids } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Notes", uid: "PG", children: children ?? PAGE_CHILDREN() });
  fake.seedBoard({ uid: "bd", props: { plexus }, children: boardKids ?? [
    { uid: "n1", string: "Note one", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
  ] });
  const session = acquireSession("bd", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}
const plexusOf = (fake, uid) => fake.props(uid)?.plexus;
const readOf = (host, boardUid = "bd") => followKind("headings").read({ kind: "headings", uid: "PG" }, { host, boardUid });
const sectionByHead = (session, head) => [...session.board.items.values()].find((i) => i.type === "section" && i.head === head);

// ---------------------------------------------------------------- model

test("PXD-14 heading map: only top-level H1-H3 are headings, their direct children are the blocks", () => {
  const pg = page([
    node("a", "Alpha", 0, 1, [node("a1", "one", 1, 0, [node("a1x", "deep", 0)]), node("a0", "zero", 0), node("bt", "BT_attrDue:: x", 2), node("sk", "skipped", 3), node("be", "  ", 4)]),
    node("p", "plain", 1, 0, [node("pk", "under plain", 0)]),
    node("b", "Beta", 2, 3),
    node("c", "Big", 3, 4, [node("ck", "h4 is not a heading", 0)]),
    node("d", "Delta", 4, 2, [node("dk", "delta kid", 0)]),
    node("sh", "Skipped heading", 5, 1, [node("shk", "never", 0)]),
  ]);
  const { items, complete } = headingItems(pg, { skip: new Set(["sk", "sh"]) });
  assert.equal(complete, true);
  assert.deepEqual(items.map((i) => [i.uid, i.kind]), [["a", "heading"], ["a0", "block"], ["a1", "block"], ["be", "block"], ["b", "heading"], ["d", "heading"], ["dk", "block"]]);
  assert.deepEqual(items[0], { uid: "a", kind: "heading", text: "Alpha", time: 9, heading: "a" });
  assert.deepEqual(items[1], { uid: "a0", kind: "block", text: "zero", time: 9, heading: "a", headingText: "Alpha", depth: 2 }, "children are sorted by :block/order");
  assert.equal(items[3].blank, true);
  assert.equal(items.some((i) => ["a1x", "bt", "p", "pk", "c", "ck", "sk", "shk"].includes(i.uid)), false, "deeper, BT_attr, non-heading, h4 and skipped blocks are not items");
});

test("PXD-14 heading map: past the cap, or a level cut at the pull limit, the read is partial", () => {
  const many = Array.from({ length: 5 }, (_, i) => node(`k${i}`, `kid ${i}`, i));
  const capped = headingItems(page([node("a", "Alpha", 0, 1, many)]), { cap: 3 });
  assert.equal(capped.complete, false);
  assert.equal(capped.items.length, 3);
  const cut = headingItems(page(Array.from({ length: 4 }, (_, i) => node(`h${i}`, `H ${i}`, i, 1))), { cap: 3 });
  assert.equal(cut.complete, false, "more top-level blocks than the cap");
  assert.equal(headingItems(page([]), {}).complete, true);
  assert.deepEqual(headingItems(page([]), {}).items, []);
});

test("PXD-14 diff: a heading is on the board through its section; a skipped heading dismisses its blocks", () => {
  const board = buildBoard({ ":block/uid": "bd", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": { v: 2 } }, ":block/children": [
    { ":block/uid": "s1", ":block/string": "Alpha", ":block/order": 0, ":block/props": { ":plexus": { type: "section", x: 0, y: 0, w: 300, h: 300, src: KEY, head: "h1" } }, ":block/children": [] },
  ] });
  assert.equal(board.items.get("s1").head, "h1");
  assert.deepEqual(cardIds(board.items.get("s1")), ["u:s1", "u:h1"]);
  const read = { ok: true, complete: true, items: [
    { uid: "h1", kind: "heading", text: "Alpha", time: 1, heading: "h1" },
    { uid: "a1", kind: "block", text: "one", time: 1, heading: "h1", headingText: "Alpha" },
    { uid: "h2", kind: "heading", text: "Beta", time: 1, heading: "h2" },
    { uid: "b1", kind: "block", text: "beta one", time: 1, heading: "h2", headingText: "Beta" },
  ] };
  const d = followDiff(read, board, { key: KEY });
  assert.deepEqual(d.pending.map((r) => r.uid), ["a1", "h2", "b1"], "the heading with a section is placed; its block still waits");
  assert.equal(d.placed, 1);
  const skipped = followDiff(read, board, { key: KEY, skip: ["h2"] });
  assert.deepEqual(skipped.pending.map((r) => r.uid), ["a1"]);
  assert.equal(skipped.dismissed, 2, "the heading row and its block");
  // The section keeps its heading alive in the source: it is not counted as gone while the heading is read.
  assert.deepEqual([...absentStep(new Map(), read, board, KEY)], []);
  assert.deepEqual([...absentStep(new Map(), { ok: true, complete: true, items: [] }, board, KEY)], [["s1", 1]]);
});

test("PXD-14 moved cards: a card whose block is under another heading now; none on a failed read", () => {
  const board = buildBoard({ ":block/uid": "bd", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": { v: 2 } }, ":block/children": [
    { ":block/uid": "c1", ":block/string": "((a1))", ":block/order": 0, ":block/props": { ":plexus": { x: 0, y: 0, src: KEY, head: "h1" } } },
    { ":block/uid": "c2", ":block/string": "((a2))", ":block/order": 1, ":block/props": { ":plexus": { x: 0, y: 200, src: KEY, head: "h1" } } },
    { ":block/uid": "c3", ":block/string": "((zz))", ":block/order": 2, ":block/props": { ":plexus": { x: 0, y: 400, src: KEY } } },
    { ":block/uid": "c4", ":block/string": "((a1))", ":block/order": 3, ":block/props": { ":plexus": { x: 300, y: 0, src: "block:ELSE", head: "h9" } } },
  ] });
  const read = { ok: true, complete: true, items: [
    { uid: "a1", kind: "block", text: "one", time: 1, heading: "h1", headingText: "Alpha" },
    { uid: "a2", kind: "block", text: "two", time: 1, heading: "h2", headingText: "Beta" },
    { uid: "zz", kind: "block", text: "z", time: 1, heading: "h2", headingText: "Beta" },
  ] };
  assert.deepEqual(movedCards(read, board, KEY), [{ uid: "c2", to: "h2", toText: "Beta" }]);
  assert.deepEqual(movedCards({ ok: false }, board, KEY), []);
  assert.deepEqual(movedCards(null, board, KEY), []);
});

// ---------------------------------------------------------------- source kind

test("PXD-14 source: the headings kind reads the page into heading and block items; a missing page is not ok", async () => {
  const { host } = setup();
  const kind = followKind("headings");
  assert.equal(kind.title, "A page by headings");
  assert.equal(kind.describe({ kind: "headings", uid: "PG" }, host), "Headings of “Notes”");
  assert.ok(HEADINGS_PULL.includes(":block/heading"));
  assert.deepEqual(normalizePointer({ kind: "headings", uid: "PG" }), { kind: "headings", uid: "PG", skip: [] });
  const got = await readOf(host);
  assert.equal(got.ok, true);
  assert.equal(got.complete, true);
  assert.deepEqual(got.heads, ["h1", "h2", "h3"]);
  assert.deepEqual(got.items.map((i) => i.uid), ["h1", "a1", "a2", "h2", "b1", "h3"]);
  assert.equal(got.items.find((i) => i.uid === "a1").headingText, "Alpha");
  assert.deepEqual(await followKind("headings").read({ kind: "headings", uid: "NOPE" }, { host, boardUid: "bd" }), { ok: false, reason: "missing" });
});

// ---------------------------------------------------------------- layout

test("PXD-14 plan: stale blocks are dropped; an empty board starts at the origin; no card goes into a missing section", () => {
  const board = buildBoard({ ":block/uid": "bd", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": { v: 2 } }, ":block/children": [] });
  const entries = [
    { uid: "h1", kind: "heading", text: "Alpha", heading: "h1" },
    { uid: "a1", kind: "block", text: "one", heading: "h1", headingText: "Alpha" },
    { uid: "x1", kind: "block", text: "stale", heading: "gone", headingText: "Gone" },
  ];
  const ops = headingPlan({ entries, order: ["h1"], board, rects: new Map(), key: KEY, size: { w: 280, h: 160 } });
  assert.deepEqual(ops.map((o) => `${o.op}:${o.uid || o.head}`), ["section:h1", "card:a1"]);
  assert.deepEqual([ops[0].x, ops[0].y, ops[0].w, ops[0].h], [0, 0, 344, 224]);
  assert.deepEqual([ops[1].x, ops[1].y, ops[1].into], [32, 32, null]);
});

test("PXD-14 plan: columns of eight inside a new section", () => {
  const board = buildBoard({ ":block/uid": "bd", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": { v: 2 } }, ":block/children": [] });
  const entries = Array.from({ length: 10 }, (_, i) => ({ uid: `k${i}`, kind: "block", text: "k", heading: "h1", headingText: "Alpha" }));
  const ops = headingPlan({ entries, order: ["h1"], board, rects: new Map(), key: KEY, size: { w: 280, h: 160 } });
  const cards = ops.filter((o) => o.op === "card");
  assert.deepEqual([cards[0].x, cards[0].y], [32, 32]);
  assert.deepEqual([cards[7].x, cards[7].y], [32, 32 + 7 * 184]);
  assert.deepEqual([cards[8].x, cards[8].y], [32 + 304, 32], "the ninth starts the second column");
  assert.equal(ops[0].w, 32 * 2 + 280 * 2 + 24);
  assert.equal(ops[0].h, 32 * 2 + 160 * 8 + 24 * 7);
});

// ---------------------------------------------------------------- session writes

test("PXD-14 session: first Place all makes one section per heading in source order, cards inside, nothing else changes", async () => {
  const { fake, host, session } = setup();
  const before = plexusOf(fake, "n1");
  const read = await readOf(host);
  const res = await session.placeFollowed(read.items, { order: read.heads });
  await fake.flush();
  assert.deepEqual([res.placed, res.sections, res.batches, res.total], [3, 3, 1, 6]);
  assert.equal(res.uids.length, 6, "cards and new sections");
  const sections = ["h1", "h2", "h3"].map((h) => sectionByHead(session, h));
  assert.deepEqual(sections.map((s) => s.title), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(sections.map((s) => fake.block(s.uid).parent), ["bd", "bd", "bd"]);
  const xs = sections.map((s) => plexusOf(fake, s.uid).x);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], "side by side in heading order");
  assert.ok(xs[0] >= 200 + 64, "right of the board's cards");
  assert.equal(new Set(sections.map((s) => plexusOf(fake, s.uid).y)).size, 1, "top-aligned");
  for (const s of sections) assert.deepEqual([plexusOf(fake, s.uid).src, plexusOf(fake, s.uid)[FOLLOW_HEAD]], [KEY, s.head]);
  const inside = (head) => [...session.board.items.values()].filter((i) => i.parentUid === sectionByHead(session, head).uid);
  assert.deepEqual(inside("h1").map((c) => c.target.uid), ["a1", "a2"]);
  assert.deepEqual(inside("h2").map((c) => c.target.uid), ["b1"]);
  assert.deepEqual(inside("h3"), [], "an empty heading is an empty section");
  for (const c of inside("h1")) assert.deepEqual([plexusOf(fake, c.uid).src, plexusOf(fake, c.uid).head], [KEY, "h1"]);
  assert.deepEqual(plexusOf(fake, "n1"), before);
  // Everything is on the board now: the diff has nothing pending.
  assert.deepEqual(followDiff(await readOf(host), session.board, { key: KEY }).pending, []);
});

test("PXD-14 session: more than SPREAD_CAP ops split into batches, and a spilled card keeps its section", async () => {
  const kids = Array.from({ length: SPREAD_CAP + 8 }, (_, i) => ({ uid: `m${String(i).padStart(3, "0")}`, string: `kid ${i}` }));
  const { fake, host, session } = setup({ children: [{ uid: "h1", string: "Alpha", heading: 1, children: kids }, { uid: "h2", string: "Beta", heading: 1, children: [{ uid: "z1", string: "zed" }] }] });
  const read = await readOf(host);
  const groups = [];
  const orig = session.host.group;
  session.host.group = async (fn) => {
    const from = fake.writesLog().length;
    const out = await (orig ? orig(fn) : fn());
    groups.push(fake.writesLog().slice(from).filter((w) => w[0] === "create").length);
    return out;
  };
  const res = await session.placeFollowed(read.items, { order: read.heads });
  session.host.group = orig;
  await fake.flush();
  const ops = 1 + kids.length + 1 + 1;
  assert.equal(res.batches, Math.ceil(ops / SPREAD_CAP));
  assert.equal(res.batches, 2);
  assert.equal(groups.length, 2, "one write group per batch");
  assert.ok(groups.every((n) => n <= SPREAD_CAP), `creates per transaction: ${groups}`);
  assert.equal(groups.reduce((a, b) => a + b, 0), ops);
  assert.deepEqual([res.placed, res.sections], [kids.length + 1, 2]);
  const alpha = sectionByHead(session, "h1");
  const members = [...session.board.items.values()].filter((i) => i.parentUid === alpha.uid);
  assert.equal(members.length, kids.length, "the cards that spilled into the second batch are in the same section");
  assert.equal(sectionByHead(session, "h2").members.length, 1);
});

test("PXD-14 session: a heading added later gets a section right of the existing ones, top-aligned; nothing existing moves", async () => {
  const { fake, host, session } = setup();
  const first = await readOf(host);
  await session.placeFollowed(first.items, { order: first.heads });
  await fake.flush();
  const secs = ["h1", "h2", "h3"].map((h) => sectionByHead(session, h));
  const snap = Object.fromEntries([...session.board.items.keys()].map((u) => [u, plexusOf(fake, u)]));
  await fake.api.data.block.create({ location: { "parent-uid": "PG", order: "last" }, block: { uid: "h4", string: "Delta", heading: 1 } });
  await fake.api.data.block.create({ location: { "parent-uid": "h4", order: "last" }, block: { uid: "d1", string: "delta one" } });
  const read = await readOf(host);
  const pending = followDiff(read, session.board, { key: KEY }).pending;
  assert.deepEqual(pending.map((r) => r.uid), ["h4", "d1"]);
  fake.clearLog();
  const res = await session.placeFollowed(pending, { order: read.heads });
  await fake.flush();
  assert.deepEqual([res.placed, res.sections], [1, 1]);
  const delta = sectionByHead(session, "h4");
  const edge = Math.max(...secs.map((s) => plexusOf(fake, s.uid).x + plexusOf(fake, s.uid).w));
  assert.ok(plexusOf(fake, delta.uid).x > edge, "right of every existing source section");
  assert.equal(plexusOf(fake, delta.uid).y, plexusOf(fake, secs[0].uid).y, "top-aligned");
  for (const [u, p] of Object.entries(snap)) assert.deepEqual(plexusOf(fake, u), p, `${u} kept its layout`);
});

test("PXD-14 session: a new block under an existing heading goes into its section below the lowest member; the section grows", async () => {
  const { fake, host, session } = setup();
  const first = await readOf(host);
  await session.placeFollowed(first.items, { order: first.heads });
  await fake.flush();
  const beta = sectionByHead(session, "h2");
  const existing = [...session.board.items.values()].find((i) => i.parentUid === beta.uid);
  const snap = Object.fromEntries([...session.board.items.keys()].filter((u) => u !== beta.uid).map((u) => [u, plexusOf(fake, u)]));
  const betaBefore = plexusOf(fake, beta.uid);
  await fake.api.data.block.create({ location: { "parent-uid": "h2", order: "last" }, block: { uid: "b2", string: "beta two" } });
  const read = await readOf(host);
  const pending = followDiff(read, session.board, { key: KEY }).pending;
  assert.deepEqual(pending.map((r) => r.uid), ["b2"]);
  const res = await session.placeFollowed(pending, { order: read.heads });
  await fake.flush();
  assert.deepEqual([res.placed, res.sections], [1, 0]);
  const [id] = res.uids;
  assert.equal(fake.block(id).parent, beta.uid);
  const mine = plexusOf(fake, id);
  const old = plexusOf(fake, existing.uid);
  assert.equal(mine.x, old.x);
  assert.equal(mine.y, old.y + 160 + 24, "one stack gap below the lowest member");
  assert.equal(mine.head, "h2");
  const after = plexusOf(fake, beta.uid);
  assert.ok(after.h > betaBefore.h, "auto-fit grew the section");
  for (const [u, p] of Object.entries(snap)) assert.deepEqual(plexusOf(fake, u), p, `${u} kept its layout`);
});

test("PXD-14 session: a block moved to another heading in Roam is reported moved, never re-parented, never left; dismiss writes only head", async () => {
  const { fake, host, session } = setup();
  const first = await readOf(host);
  await session.placeFollowed(first.items, { order: first.heads });
  await fake.flush();
  const card = [...session.board.items.values()].find((i) => i.target?.uid === "b1");
  const parentBefore = fake.block(card.uid).parent;
  const layoutBefore = plexusOf(fake, card.uid);
  await fake.api.data.block.move({ location: { "parent-uid": "h1", order: "last" }, block: { uid: "b1" } });
  let absent = new Map();
  for (let i = 0; i < 2; i += 1) {
    const read = await readOf(host);
    absent = absentStep(absent, read, session.board, KEY);
    assert.deepEqual(movedCards(read, session.board, KEY), [{ uid: card.uid, to: "h1", toText: "Alpha" }]);
    assert.deepEqual(followDiff(read, session.board, { key: KEY, absent }).left, [], "its block is still in the source");
  }
  assert.equal(fake.block(card.uid).parent, parentBefore);
  assert.deepEqual(plexusOf(fake, card.uid), layoutBefore);
  fake.clearLog();
  assert.equal(await session.dismissMoved({ [card.uid]: "h1" }), 1);
  await fake.flush();
  assert.deepEqual(fake.writesLog().map((w) => w[0]), ["update"]);
  assert.deepEqual(plexusOf(fake, card.uid), { ...layoutBefore, head: "h1" });
  assert.equal(fake.block(card.uid).parent, parentBefore, "still where it was");
  assert.deepEqual(movedCards(await readOf(host), session.board, KEY), []);
  assert.equal(await session.dismissMoved({ [card.uid]: "h1" }), 0);
});

test("PXD-14 session: deleting a heading's section skips the heading, not each block; a dropped block row keeps its heading", async () => {
  const { fake, host, session } = setup();
  const first = await readOf(host);
  await session.placeFollowed(first.items, { order: first.heads });
  await fake.flush();
  await session.deleteItems([sectionByHead(session, "h1").uid]);
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "bd").follow.skip, ["h1"], "its cards stay on the board and are not skipped one by one");
  await session.deleteItems([sectionByHead(session, "h2").uid], { withContents: true });
  await fake.flush();
  assert.deepEqual(plexusOf(fake, "bd").follow.skip, ["h1", "h2"], "with its cards gone too, still only the heading");
  const read = await readOf(host);
  const d = followDiff(read, session.board, { key: KEY, skip: ["h1", "h2"] });
  assert.deepEqual(d.pending, [], "Gamma's section is still there; the other two headings and b1 are dismissed");
  assert.equal(d.dismissed, 3);
  // A single block row dropped on the board carries its heading.
  const drop = await session.placeFollowed([{ uid: "b1", kind: "block", heading: "h2", headingText: "Beta" }, { uid: "a1", kind: "block", heading: "h1" }], { at: { x: 900, y: 900 } });
  await fake.flush();
  assert.equal(drop.placed, 0, "b1's and a1's headings are skipped");
  const drop2 = await session.placeFollowed([{ uid: "q9", kind: "block", heading: "hx", headingText: "Other" }], { at: { x: 900, y: 900 } });
  await fake.flush();
  assert.equal(drop2.placed, 1);
  assert.equal(plexusOf(fake, drop2.uids[0]).head, "hx");
  assert.equal(plexusOf(fake, drop2.uids[0]).src, KEY);
});

// ---------------------------------------------------------------- tray

function manualTimers() {
  const later = [];
  const idle = [];
  return {
    later: (fn, ms) => { const e = { fn, ms, on: true }; later.push(e); return () => { e.on = false; }; },
    bgIdle: (fn) => { const e = { fn, on: true }; idle.push(e); return () => { e.on = false; }; },
    idle: (fn) => { const id = setImmediate(fn); return () => clearImmediate(id); },
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

function mountTray(opts = {}) {
  const { fake, host, session } = setup(opts);
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const timers = manualTimers();
  const moves = [];
  const tray = createFollowTray({
    doc: dom.document,
    root,
    host,
    session,
    timers,
    board: () => session.board,
    storage: fake.storage,
    graph: "g",
    onMoved: (map) => moves.push([...map]),
    onPlaced: () => {},
    toast: () => {},
  });
  return { fake, host, session, root, timers, tray, moves };
}

test("PXD-14 tray: grouped headers, the rule note, and Place on a header places that heading", async () => {
  const f = mountTray();
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  const notes = f.root.querySelectorAll(".pxd-follow__note").map((n) => n.textContent);
  assert.ok(notes.includes(headingsNote));
  assert.match(headingsNote, /top-level H1–H3 headings/);
  const groups = f.root.querySelectorAll(".pxd-follow__group");
  assert.deepEqual(groups.map((g) => g.querySelector(".pxd-follow__text").textContent), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(f.root.querySelectorAll(".pxd-follow__row").map((r) => r.dataset.uid), ["a1", "a2", "b1"], "block rows sit under their header");
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (6)");
  groups[1].querySelector(".pxd-follow__place").click();
  await flush();
  await f.fake.flush();
  assert.deepEqual([...f.session.board.items.values()].filter((i) => i.type === "section").map((s) => s.head), ["h2"]);
  assert.equal(sectionByHead(f.session, "h2").members.length, 1);
  assert.deepEqual(f.root.querySelectorAll(".pxd-follow__group").map((g) => g.querySelector(".pxd-follow__text").textContent), ["Alpha", "Gamma"]);
  f.root.querySelectorAll(".pxd-follow__group")[1].querySelector(".pxd-follow__skip").click();
  await flush();
  assert.deepEqual(plexusOf(f.fake, "bd").follow.skip, ["h3"]);
  f.tray.dispose();
});

test("PXD-14 tray: a page with no headings says so", async () => {
  const f = mountTray({ children: [{ uid: "p1", string: "just text" }] });
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  const notes = f.root.querySelectorAll(".pxd-follow__note").map((n) => n.textContent);
  assert.ok(notes.includes("This page has no top-level H1–H3 headings yet."));
  f.tray.dispose();
});

test("PXD-14 tray: a moved block is listed as moved with its new heading, and Dismiss clears it", async () => {
  const f = mountTray();
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  f.root.querySelector(".pxd-follow__all").click();
  await flush();
  await f.fake.flush();
  assert.deepEqual(f.tray.moved(), []);
  await f.fake.api.data.block.move({ location: { "parent-uid": "h1", order: "last" }, block: { uid: "b1" } });
  await f.fake.flush();
  await f.timers.run();
  await f.timers.run();
  const card = [...f.session.board.items.values()].find((i) => i.target?.uid === "b1");
  assert.deepEqual(f.tray.moved().map((m) => m.uid), [card.uid]);
  assert.deepEqual(f.moves.at(-1), [[card.uid, "Alpha"]]);
  assert.equal(f.tray.stats().moved, 1);
  assert.deepEqual(f.tray.left(), []);
  const sections = f.root.querySelectorAll(".pxd-follow__section").map((n) => n.textContent);
  assert.deepEqual(sections, ["Moved (1)"]);
  const row = f.root.querySelectorAll(".pxd-follow__row--left")[0];
  assert.equal(row.querySelector(".pxd-follow__text").textContent, "beta one");
  assert.equal(row.querySelector(".pxd-follow__crumb").textContent, "Moved to Alpha");
  row.querySelector(".pxd-follow__dismiss").click();
  await flush();
  await f.fake.flush();
  assert.deepEqual(f.tray.moved(), []);
  assert.deepEqual(f.moves.at(-1), []);
  assert.equal(plexusOf(f.fake, card.uid).head, "h1");
  f.tray.dispose();
});

// ---------------------------------------------------------------- menu

test("PXD-14 menu: the board menu offers a page by headings, and so does a page card", () => {
  const idsOf = (menu) => flattenMenu(menu).map((m) => m.id);
  const off = idsOf(buildMenu("board-menu", { follow: { following: false } }));
  assert.ok(off.includes("follow:pick-headings"));
  const on = idsOf(buildMenu("board-menu", { follow: { following: true, kind: "headings", label: "Headings of “Notes”", waiting: 2 } }));
  assert.ok(on.includes("follow:pick-headings"));
  const card = flattenMenu(buildMenu("card", { follow: { block: true, refs: true, headings: true } }));
  assert.deepEqual(card.map((m) => m.id).filter((id) => id.startsWith("follow")), ["follow-card", "follow:this", "follow:this-refs", "follow:this-headings"]);
  assert.equal(card.find((m) => m.id === "follow:this-headings").label, "Its page by headings");
  assert.deepEqual(flattenMenu(buildMenu("card", { follow: { block: true, refs: true } })).map((m) => m.id).filter((id) => id.startsWith("follow")), ["follow-card", "follow:this", "follow:this-refs"]);
  assert.equal(sourceKey({ kind: "headings", uid: "PG" }), KEY);
});
