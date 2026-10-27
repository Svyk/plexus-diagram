// PXD-13: a source per section. A section follows a source through its own props; its rows place inside its frame;
// one item waiting in two sources shows once; at most 8 sections follow one; one shared pass reads every due owner.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-follow.js";
import { createFollowTray } from "../src/view/follow-tray.js";
import { defineFollowKind } from "../src/host/follow-sources.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import {
  FOLLOW_MIME,
  FOLLOW_QUIET_MS,
  FOLLOW_SECTION_CAP,
  FOLLOW_STACK_GAP,
  dedupeFollow,
  followCapText,
  followOwnersOf,
  sectionGrid,
} from "../src/model/follow.js";
import { DEFAULT_SIZES, FIT_PAD } from "../src/model/schema.js";

const W = DEFAULT_SIZES.card.w;
const H = DEFAULT_SIZES.card.h;
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

const flush = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const card = (uid, string, x, y, extra = {}) => ({ uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } } });
const section = (uid, title, x, y, w, h, extra = {}, children = []) => ({ uid, string: title, props: { plexus: { type: "section", x, y, w, h, ...extra } }, children });

function manualTimers() {
  const later = [];
  const idle = [];
  const timers = {
    jobs: 0,
    later: (fn, ms) => { const e = { fn, ms, on: true }; later.push(e); return () => { e.on = false; }; },
    bgIdle: (fn) => { timers.jobs += 1; const e = { fn, on: true }; idle.push(e); return () => { e.on = false; }; },
    idle: (fn) => { const id = setImmediate(fn); return () => clearImmediate(id); },
    pending: (ms) => later.filter((e) => e.on && (ms === undefined || e.ms === ms)).length,
    idlePending: () => idle.filter((e) => e.on).length,
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
  return timers;
}

// Two sources on one page: SRC (k1 k2 k3) and SRC2 (k3 k4).
function mount({ plexus = { v: 2 }, children, srcKids, src2Kids } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Src page", uid: "SRCPAGE", children: [
    { uid: "SRC", string: "Source block", children: srcKids ?? [{ uid: "k1", string: "one" }, { uid: "k2", string: "two" }, { uid: "k3", string: "three" }] },
    { uid: "SRC2", string: "Second source", children: src2Kids ?? [{ uid: "k3x", string: "ref" }] },
    { uid: "ELSE", string: "Somewhere else" },
  ] });
  fake.seedBoard({ uid: "b1", props: { plexus }, children: children ?? [
    card("n1", "Note one", 0, 0),
    section("S1", "Reading", 400, 0, 500, 300, {}, [card("m1", "member", 24, 24)]),
  ] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const timers = manualTimers();
  const lefts = [];
  const tray = createFollowTray({
    doc: dom.document,
    root,
    host,
    session,
    timers,
    board: () => session.board,
    storage: fake.storage,
    graph: "g",
    onLeft: (set) => lefts.push([...set]),
    toast: () => {},
    now: () => 0,
  });
  return { fake, host, session, dom, root, timers, tray, lefts };
}

const item = (uid) => ({ uid, kind: "block", text: uid, time: 1 });

// ---- model ----

test("PXD-13 owners: sections in outline order (nested ones too), then the board; past the cap and duplicates are not read", () => {
  const sec = (uid, order, follow, members = []) => ({ uid, type: "section", order, title: uid, members, ...(follow ? { follow } : {}) });
  const items = new Map();
  const add = (it) => { items.set(it.uid, it); return it.uid; };
  add(sec("A", 1, { kind: "block", uid: "X", skip: [] }, ["A1"]));
  add(sec("A1", 0, { kind: "query", uid: "Q", skip: [] }));
  add(sec("B", 0, { kind: "block", uid: "X", skip: [] }));
  add({ uid: "c", type: "card", order: 2, members: [] });
  const board = { uid: "b", items, roots: ["A", "B", "c"], plexus: { follow: { kind: "refs", uid: "P" } } };
  const { owners, capped } = followOwnersOf(board);
  assert.deepEqual(owners.map((o) => o.uid), ["B", "A", "A1", "b"]);
  assert.deepEqual(owners.map((o) => o.key), ["block:X", "block:X", "query:Q", "refs:P"]);
  assert.equal(owners[1].dup, "“B”", "the second owner of block:X is not read");
  assert.equal(owners[0].dup, null);
  assert.equal(owners[3].name, "this board");
  assert.equal(capped, false);
  const many = new Map();
  const roots = [];
  for (let i = 0; i < FOLLOW_SECTION_CAP + 2; i += 1) {
    const uid = `S${i}`;
    many.set(uid, sec(uid, i, { kind: "block", uid: `X${i}`, skip: [] }));
    roots.push(uid);
  }
  const big = followOwnersOf({ uid: "b", items: many, roots, plexus: {} });
  assert.equal(big.capped, true);
  assert.deepEqual(big.owners.filter((o) => o.over).map((o) => o.uid), ["S8", "S9"]);
});

test("PXD-13 dedupe: an item in two sources is placeable in the first owner only; later owners show a hint; a skip in the first hides it everywhere", () => {
  const row = (uid) => ({ uid, kind: "block", text: uid });
  const lanes = [
    { name: "“A”", read: { ok: true, items: [row("x"), row("y"), row("s")] }, skip: ["s"], diff: { pending: [row("x"), row("y")] } },
    { name: "“B”", read: { ok: true, items: [row("x"), row("z"), row("s")] }, skip: [], diff: { pending: [row("x"), row("z"), row("s")] } },
    { name: "this board", read: { ok: true, items: [row("y")] }, skip: [], diff: { pending: [row("y")] } },
  ];
  const out = dedupeFollow(lanes);
  assert.deepEqual(out[0].pending.map((r) => r.uid), ["x", "y"]);
  assert.deepEqual(out[1].pending.map((r) => r.uid), ["z"]);
  assert.deepEqual(out[1].hints.map((r) => `${r.uid}@${r.also}`), ["x@“A”"], "s was skipped in A: no row and no hint in B");
  assert.deepEqual(out[2].pending, []);
  assert.deepEqual(out[2].hints.map((r) => `${r.uid}@${r.also}`), ["y@“A”"]);
});

test("PXD-13 section grid: columns fit the inner width; the first row sits one gap below the members, or inside the padding", () => {
  const sec = { x: 100, y: 50, w: 500, h: 300 };
  const empty = sectionGrid(sec, [], 3, { w: 200, h: 100, pad: FIT_PAD });
  assert.deepEqual(empty, [{ x: 124, y: 74 }, { x: 124 + 200 + FOLLOW_STACK_GAP, y: 74 }, { x: 124, y: 74 + 100 + FOLLOW_STACK_GAP }], "inner 452: two columns");
  const below = sectionGrid(sec, [{ x: 124, y: 74, w: 200, h: 100 }], 1, { w: 200, h: 100, pad: FIT_PAD });
  assert.deepEqual(below, [{ x: 124, y: 174 + FOLLOW_STACK_GAP }]);
  const narrow = sectionGrid({ x: 0, y: 0, w: 100, h: 100 }, [], 2, { w: 200, h: 100, pad: FIT_PAD });
  assert.deepEqual(narrow.map((p) => p.x), [24, 24], "always one column");
  assert.deepEqual(sectionGrid(sec, [], 1, { w: 200, h: 100, pad: FIT_PAD, start: 3 }), [{ x: 124 + 200 + FOLLOW_STACK_GAP, y: 74 + 100 + FOLLOW_STACK_GAP }], "a later batch continues the grid");
});

// ---- session ----

test("PXD-13 session: a section's Follow writes only the section's props; the board's stay", async () => {
  const f = mount({ plexus: { v: 2, follow: { kind: "query", uid: "Q" } } });
  const board = f.fake.props("b1").plexus;
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC", owner: "S1" }), true);
  await f.fake.flush();
  assert.deepEqual(f.fake.writesLog().map((w) => [w[0], w[1]]), [["update", "S1"]]);
  assert.deepEqual(f.fake.props("S1").plexus.follow, { kind: "block", uid: "SRC" });
  assert.deepEqual(f.fake.props("S1").plexus.type, "section");
  assert.deepEqual(f.fake.props("b1").plexus, board);
  assert.deepEqual(f.session.board.items.get("S1").follow, { kind: "block", uid: "SRC", skip: [] }, "the section item carries its pointer");
  assert.equal(await f.session.setFollowTree(true, "S1"), true);
  assert.deepEqual(f.fake.props("S1").plexus.follow, { kind: "block", uid: "SRC", tree: true });
  assert.equal(await f.session.stopFollowing("S1"), true);
  assert.equal(f.fake.props("S1").plexus.follow, undefined);
  assert.deepEqual(f.fake.props("b1").plexus, board);
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC", owner: "n1" }), false, "a card is not an owner");
  assert.deepEqual(f.session.followRefusal(), { reason: "not-section" });
  assert.equal(await f.session.followSource({ kind: "block", uid: "S1", owner: "S1" }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "self" });
  assert.equal(await f.session.followSource({ kind: "block", uid: "b1", owner: "S1" }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "self" });
  f.tray.dispose();
});

test("PXD-13 session: a section cannot follow a page's headings (they make sections of their own); the board can", async () => {
  const f = mount({ children: [section("S1", "Reading", 0, 0, 400, 300)] });
  assert.equal(await f.session.followSource({ kind: "headings", uid: "SRCPAGE", owner: "S1" }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "kind" });
  assert.equal(f.fake.props("S1").plexus.follow, undefined, "nothing written");
  assert.equal(await f.session.followSource({ kind: "headings", uid: "SRCPAGE" }), true);
});

test("PXD-13 session: the same source on two owners is refused and names the owner that has it", async () => {
  const f = mount({
    plexus: { v: 2, follow: { kind: "block", uid: "SRC" } },
    children: [section("S1", "Reading", 0, 0, 400, 300), section("S2", "Later", 500, 0, 400, 300)],
  });
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC", owner: "S1" }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "taken", by: "the board" });
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC2", owner: "S1" }), true);
  assert.equal(f.session.followRefusal(), null);
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC2", owner: "S2" }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "taken", by: "“Reading”" });
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC2" }), false, "nor can the board take a section's source");
  assert.deepEqual(f.session.followRefusal(), { reason: "taken", by: "“Reading”" });
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC2", owner: "S1" }), false, "the same pointer again");
  assert.deepEqual(f.session.followRefusal(), { reason: "unchanged" });
  f.tray.dispose();
});

test("PXD-13 session: the 9th section is refused; a section already following can still switch", async () => {
  const kids = Array.from({ length: FOLLOW_SECTION_CAP + 1 }, (_, i) => section(`S${i}`, `Sec ${i}`, i * 500, 0, 400, 300,
    i < FOLLOW_SECTION_CAP ? { follow: { kind: "block", uid: `X${i}` } } : {}));
  const f = mount({ children: kids });
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC", owner: `S${FOLLOW_SECTION_CAP}` }), false);
  assert.deepEqual(f.session.followRefusal(), { reason: "cap" });
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC", owner: "S0" }), true, "a switch adds no section");
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC2" }), true, "the board's own source is not a section");
  const state = f.tray.sectionMenuState(`S${FOLLOW_SECTION_CAP}`);
  assert.equal(state.capped, true);
  const menu = flattenMenu(buildMenu("section", { follow: state }));
  const cap = menu.find((m) => m.id === "follow-section:cap");
  assert.equal(cap.label, followCapText());
  assert.equal(cap.label, "Up to 8 sections follow a source on one board");
  assert.equal(menu.find((m) => m.id === "follow-section:pick-block").disabled, true);
  f.tray.dispose();
});

test("PXD-13 session: deleting a section's followed card adds it to that section's skip list, not the board's", async () => {
  const f = mount({
    plexus: { v: 2, follow: { kind: "block", uid: "SRC2" } },
    children: [
      card("n1", "((k3x))", 0, 0, { src: "block:SRC2" }),
      section("S1", "Reading", 400, 0, 500, 300, { follow: { kind: "block", uid: "SRC" } }, [card("c1", "((k1))", 24, 24, { src: "block:SRC" })]),
    ],
  });
  f.fake.trackUndo = true;
  await f.session.deleteItems(["c1"]);
  await f.fake.flush();
  assert.deepEqual(f.fake.props("S1").plexus.follow.skip, ["k1"]);
  assert.equal(f.fake.props("b1").plexus.follow.skip, undefined);
  await f.session.deleteItems(["n1"]);
  assert.deepEqual(f.fake.props("b1").plexus.follow.skip, ["k3x"]);
  assert.deepEqual(f.fake.props("S1").plexus.follow.skip, ["k1"]);
  assert.equal(await f.session.dontBringBack(["k2"], "S1"), 1);
  assert.deepEqual(f.fake.props("S1").plexus.follow.skip, ["k1", "k2"]);
  await f.session.undo();
  await f.session.undo();
  await f.fake.flush();
  assert.equal(f.fake.has("n1"), true);
  await f.session.undo();
  await f.fake.flush();
  assert.equal(f.fake.has("c1"), true, "one undo per delete, skip included");
  assert.equal(f.fake.props("S1").plexus.follow.skip, undefined);
  f.tray.dispose();
});

// ---- placement inside the frame ----

const placedBlocks = (f, uids) => uids.map((id) => ({ ...f.fake.block(id), plexus: f.fake.props(id).plexus }));

test("PXD-13 place: a section's Place all writes children of the section, below its cards inside its width; auto-fit grows the frame", async () => {
  const f = mount({ children: [
    card("n1", "Note one", 0, 0),
    section("S1", "Reading", 400, 0, 700, 300, { follow: { kind: "block", uid: "SRC" } }, [card("m1", "member", 24, 24)]),
  ] });
  await f.timers.run();
  assert.deepEqual(f.tray.rows("S1").map((r) => r.uid), ["k1", "k2", "k3"]);
  f.tray.open("S1");
  const group = f.root.querySelector(".pxd-follow__owner");
  assert.equal(group.dataset.owner, "S1");
  assert.equal(f.root.querySelector(".pxd-follow__owner-title").textContent, "“Reading”");
  f.root.querySelector(".pxd-follow__all").click();
  await flush(20);
  await f.fake.flush();
  const made = f.fake.writesLog().filter((w) => w[0] === "create").map((w) => w[1]);
  assert.equal(made.length, 3);
  const blocks = placedBlocks(f, made);
  assert.deepEqual(blocks.map((b) => b.parent), ["S1", "S1", "S1"], "children of the section");
  assert.deepEqual(blocks.map((b) => b.string), ["((k1))", "((k2))", "((k3))"]);
  assert.deepEqual(blocks.map((b) => b.plexus.src), ["block:SRC", "block:SRC", "block:SRC"]);
  const y0 = 24 + 100 + FOLLOW_STACK_GAP;
  assert.deepEqual(blocks.map((b) => [b.plexus.x, b.plexus.y]), [[24, y0], [24 + W + FOLLOW_STACK_GAP, y0], [24, y0 + H + FOLLOW_STACK_GAP]], "relative to the section, two columns in an inner width of 652");
  const frame = f.fake.props("S1").plexus;
  assert.ok(frame.h >= y0 + 2 * H + FOLLOW_STACK_GAP + FIT_PAD, `the frame grew down around the cards (${frame.h})`);
  assert.equal(frame.w, 700, "and kept its width");
  assert.deepEqual([frame.x, frame.y], [400, 0]);
  assert.deepEqual(f.tray.rows(), []);
  f.tray.dispose();
});

test("PXD-13 place: an empty section starts at the top left inside its padding; a fixed section keeps its size", async () => {
  const f = mount({ children: [
    section("S1", "Empty", 400, 0, 260, 140, { follow: { kind: "block", uid: "SRC" } }),
    section("S2", "Fixed", 0, 400, 500, 140, { fit: false, follow: { kind: "block", uid: "SRC2" } }),
  ] });
  await f.timers.run();
  const one = await f.session.placeFollowed([{ uid: "k1", kind: "block" }, { uid: "k2", kind: "block" }], { owner: "S1" });
  await f.fake.flush();
  const a = placedBlocks(f, one.uids);
  assert.deepEqual(a.map((b) => [b.parent, b.plexus.x, b.plexus.y]), [["S1", FIT_PAD, FIT_PAD], ["S1", FIT_PAD, FIT_PAD + H + FOLLOW_STACK_GAP]], "inner 212: one column, wrapped down");
  assert.ok(f.fake.props("S1").plexus.h > 140, "auto-fit grew the empty section");
  const two = await f.session.placeFollowed([{ uid: "k3x", kind: "block" }], { owner: "S2" });
  await f.fake.flush();
  const b = placedBlocks(f, two.uids);
  assert.deepEqual(b.map((x) => [x.parent, x.plexus.x, x.plexus.y]), [["S2", FIT_PAD, FIT_PAD]]);
  assert.deepEqual([f.fake.props("S2").plexus.w, f.fake.props("S2").plexus.h], [500, 140], "fit off: the frame stays, the card is still its child");
  f.tray.dispose();
});

test("PXD-13 place: an entry from another owner's source is not placed in this section", async () => {
  const f = mount({
    plexus: { v: 2, follow: { kind: "block", uid: "SRC2" } },
    children: [section("S1", "Reading", 400, 0, 500, 300, { follow: { kind: "block", uid: "SRC" } })],
  });
  const res = await f.session.placeFollowed([{ uid: "k3x", kind: "block", src: "block:SRC2" }], { owner: "S1" });
  assert.equal(res.placed, 0);
  const ok = await f.session.placeFollowed([{ uid: "k3x", kind: "block", src: "block:SRC2" }]);
  assert.equal(ok.placed, 1);
  assert.equal(f.fake.block(ok.uids[0]).parent, "b1");
  f.tray.dispose();
});

// ---- tray ----

test("PXD-13 tray: an item in two sections waits once in the first and is a hint in the second; placing it clears both", async () => {
  const off = defineFollowKind({ id: "probe13d", title: "Probe", describe: () => "the probe", read: async () => ({ ok: true, complete: true, items: [item("k2"), item("k9")] }) });
  try {
    const g = mount({
      children: [
        section("S1", "First", 0, 0, 500, 300, { follow: { kind: "block", uid: "SRC" } }),
        section("S2", "Second", 600, 0, 500, 300, { follow: { kind: "probe13d", uid: "P" } }),
      ],
    });
    await g.timers.run();
    assert.deepEqual(g.tray.rows("S1").map((r) => r.uid), ["k1", "k2", "k3"]);
    assert.deepEqual(g.tray.rows("S2").map((r) => r.uid), ["k9"]);
    assert.deepEqual(g.tray.hints("S2").map((r) => `${r.uid}@${r.also}`), ["k2@“First”"]);
    assert.equal(g.root.querySelector(".pxd-follow").textContent, "Following (4)", "hint rows do not count");
    g.tray.open();
    const hint = g.root.querySelector(".pxd-follow__row--hint");
    assert.equal(hint.querySelector(".pxd-follow__text").textContent, "k2");
    assert.equal(hint.querySelector(".pxd-follow__also").textContent, "Also in “First”", "on its own line, not after a title that ellipsizes");
    assert.equal(hint.querySelector(".pxd-follow__place"), null, "a hint has no Place");
    const groups = g.root.querySelectorAll(".pxd-follow__owner");
    assert.deepEqual(groups.map((n) => n.dataset.owner), ["S1", "S2"]);
    const counts = g.root.querySelectorAll(".pxd-follow__count").map((n) => n.textContent);
    assert.deepEqual(counts, ["3 waiting · 0 on the board", "1 waiting · 0 on the board"]);
    await g.session.placeFollowed([{ uid: "k2", kind: "block" }], { owner: "S1" });
    await flush();
    assert.deepEqual(g.tray.rows("S1").map((r) => r.uid), ["k1", "k3"]);
    assert.deepEqual(g.tray.hints("S2"), [], "on the board anywhere: no owner shows it");
    assert.deepEqual(g.tray.rows("S2").map((r) => r.uid), ["k9"]);
    g.tray.dispose();
  } finally { off(); }
});

// The stub does no layout: the groups scroller sits 40 px down the panel, each group is 300 px tall.
function layoutGroups(doc) {
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = make(tag);
    Object.defineProperty(node, "offsetTop", {
      get() {
        if (node.classList.contains("pxd-follow__owners")) return 40;
        if (!node.classList.contains("pxd-follow__owner")) return 0;
        return 40 + 300 * (node.parentElement?._kids || []).indexOf(node);
      },
    });
    return node;
  };
}

test("PXD-13 tray: reads and places paint again without moving the drawer; Show in tray stays on its section", async () => {
  const off = defineFollowKind({ id: "probe13s", title: "Probe", describe: () => "the probe", read: async () => ({ ok: true, complete: true, items: [item("k9"), item("k8")] }) });
  try {
    const g = mount({
      children: [
        section("S1", "First", 0, 0, 500, 300, { follow: { kind: "block", uid: "SRC" } }),
        section("S2", "Second", 600, 0, 500, 300, { follow: { kind: "probe13s", uid: "P" } }),
      ],
    });
    layoutGroups(g.dom.document);
    await g.timers.run();
    const scroller = () => g.root.querySelector(".pxd-follow__owners");
    // Show in tray on the second section: the drawer opens on it, and the read that open asks for keeps it there.
    g.tray.open("S2");
    assert.equal(scroller().scrollTop, 300, "Show in tray puts the section's group at the top");
    const before = scroller();
    await g.timers.run();
    assert.notEqual(scroller(), before, "the read painted the drawer again");
    assert.equal(before.isConnected, false);
    assert.equal(scroller().scrollTop, 300, "still on the second section after the read");
    // The user scrolls a little further; placing a card (a paint before and after the write) keeps that too.
    scroller().scrollTop = 340;
    await g.session.placeFollowed([{ uid: "k1", kind: "block" }], { owner: "S1" });
    await flush();
    assert.equal(scroller().scrollTop, 340, "a place keeps the scroll");
    g.tray.close();
    g.tray.open("S1");
    assert.equal(scroller().scrollTop, 0, "Show in tray on the first section");
    g.tray.dispose();
  } finally { off(); }
});

test("PXD-13 tray: a board that follows one source keeps its list's scroll through a read", async () => {
  const g = mount({ plexus: { v: 2, follow: { kind: "block", uid: "SRC" } } });
  await g.timers.run();
  g.tray.open();
  const list = () => g.root.querySelector(".pxd-follow__list");
  list().scrollTop = 120;
  const before = list();
  await g.timers.run();
  assert.notEqual(list(), before);
  assert.equal(list().scrollTop, 120);
  g.tray.dispose();
});

test("PXD-13 tray: a section before the board; Don't bring back in the first owner does not promote the row into the next", async () => {
  const off = defineFollowKind({ id: "probe13", title: "Probe", describe: () => "the probe", read: async () => ({ ok: true, complete: true, items: [item("k1"), item("k7")] }) });
  try {
    const f = mount({
      plexus: { v: 2, follow: { kind: "probe13", uid: "P" } },
      children: [section("S1", "Reading", 400, 0, 500, 300, { follow: { kind: "block", uid: "SRC" } })],
    });
    await f.timers.run();
    assert.deepEqual(f.tray.rows("S1").map((r) => r.uid), ["k1", "k2", "k3"]);
    assert.deepEqual(f.tray.rows("b1").map((r) => r.uid), ["k7"]);
    assert.deepEqual(f.tray.hints("b1").map((r) => `${r.uid}@${r.also}`), ["k1@“Reading”"]);
    f.tray.open();
    const all = f.root.querySelectorAll(".pxd-follow__all");
    assert.equal(all.length, 2);
    all[1].click();
    await flush(20);
    await f.fake.flush();
    const made = f.fake.writesLog().filter((w) => w[0] === "create").map((w) => f.fake.block(w[1]).string);
    assert.deepEqual(made, ["((k7))"], "the board's Place all skips the hint");
    await f.session.dontBringBack(["k1"], "S1");
    await flush();
    assert.deepEqual(f.tray.rows("b1"), []);
    assert.deepEqual(f.tray.hints("b1"), [], "skipped in the first owner: not offered anywhere");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-13 tray: several owners due -> one bgIdle job; reads one after another; one paint and one onLeft per pass", async () => {
  const pending = [];
  let running = 0;
  let most = 0;
  const off = defineFollowKind({
    id: "probe13p",
    title: "Probe",
    describe: (p) => `probe ${p.uid}`,
    read: (p) => {
      running += 1;
      most = Math.max(most, running);
      return new Promise((resolve) => pending.push(() => { running -= 1; resolve({ ok: true, complete: true, items: [item(`i-${p.uid}`)] }); }));
    },
  });
  try {
    const f = mount({
      plexus: { v: 2, follow: { kind: "probe13p", uid: "B" } },
      children: [
        section("S1", "One", 0, 0, 400, 300, { follow: { kind: "probe13p", uid: "A1" } }),
        section("S2", "Two", 500, 0, 400, 300, { follow: { kind: "probe13p", uid: "A2" } }),
      ],
    });
    const jobs = f.timers.jobs;
    const paints = f.tray.stats().paints;
    const lefts = f.lefts.length;
    await f.timers.run();
    assert.equal(f.timers.jobs - jobs, 1, "three quiet periods ended: one shared job");
    assert.equal(pending.length, 1, "the first owner's read runs alone");
    for (let i = 0; i < 3; i += 1) {
      pending.shift()();
      await flush();
    }
    assert.equal(most, 1, "never two reads at once");
    assert.equal(pending.length, 0);
    assert.equal(f.tray.stats().passes, 1);
    assert.equal(f.tray.stats().paints - paints, 1, "one sort and paint for the pass");
    assert.equal(f.tray.stats().maxReads, 1);
    assert.deepEqual(f.tray.stats().lanes.map((l) => [l.owner, l.reads]), [["S1", 1], ["S2", 1], ["b1", 1]], "owner order");
    assert.deepEqual(f.tray.rows().map((r) => r.uid), ["i-A1", "i-A2", "i-B"]);
    assert.ok(f.lefts.length - lefts <= 1, "at most one onLeft per pass");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-13 tray: an owner that comes due during a pass is read in the next pass", async () => {
  const pending = [];
  const order = [];
  const off = defineFollowKind({
    id: "probe13q",
    title: "Probe",
    describe: () => "probe",
    read: (p) => { order.push(p.uid); return new Promise((resolve) => pending.push(() => resolve({ ok: true, complete: true, items: [item(`i-${p.uid}`)] }))); },
  });
  try {
    const f = mount({
      plexus: { v: 2, follow: { kind: "probe13q", uid: "B" } },
      children: [
        section("S1", "One", 0, 0, 400, 300, { follow: { kind: "probe13q", uid: "A1" } }),
        section("S2", "Two", 500, 0, 400, 300),
      ],
    });
    await f.timers.run();
    assert.deepEqual(order, ["A1"], "the pass starts with the first owner");
    // S2 starts following while S1's read runs; its quiet period ends during the pass.
    assert.equal(await f.session.followSource({ kind: "probe13q", uid: "A2", owner: "S2" }), true);
    await f.timers.run();
    pending.shift()();
    await flush();
    assert.deepEqual(order, ["A1", "B"], "S2 is not slipped into the running pass");
    pending.shift()();
    await flush();
    assert.equal(f.tray.stats().passes, 1);
    await f.timers.run();
    assert.deepEqual(order, ["A1", "B", "A2"], "the next pass reads it");
    pending.shift()();
    await flush();
    assert.equal(f.tray.stats().passes, 2);
    assert.deepEqual(f.tray.rows().map((r) => r.uid), ["i-A1", "i-A2", "i-B"], "owner order: S1, S2, the board");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-13 tray: section pointers past the cap are listed, not read", async () => {
  let reads = 0;
  const off = defineFollowKind({ id: "probe13c", title: "Probe", describe: (p) => `probe ${p.uid}`, read: async (p) => { reads += 1; return { ok: true, complete: true, items: [item(`i-${p.uid}`)] }; } });
  try {
    const kids = Array.from({ length: FOLLOW_SECTION_CAP + 1 }, (_, i) => section(`S${i}`, `Sec ${i}`, i * 500, 0, 400, 300, { follow: { kind: "probe13c", uid: `X${i}` } }));
    const f = mount({ children: kids });
    await f.timers.run();
    assert.equal(reads, FOLLOW_SECTION_CAP);
    assert.equal(f.tray.stats().lanes.at(-1).over, true);
    assert.equal(f.tray.stats().lanes.at(-1).reads, 0);
    assert.equal(f.tray.stats().passes, 1, "eight owners, one pass");
    f.tray.open(`S${FOLLOW_SECTION_CAP}`);
    const notes = f.root.querySelectorAll(".pxd-follow__note").map((n) => n.textContent);
    assert.deepEqual(notes, [`Not read: over the limit of ${FOLLOW_SECTION_CAP}.`]);
    const state = f.tray.sectionMenuState(`S${FOLLOW_SECTION_CAP}`);
    assert.equal(state.over, true);
    assert.ok(flattenMenu(buildMenu("section", { follow: state })).some((m) => m.id === "follow-section:over" && m.disabled));
    assert.equal(f.root.querySelector(".pxd-follow").textContent, `Following (${FOLLOW_SECTION_CAP})`);
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-13 tray: a section row's drag carries its owner; the card menu sees every owner's key", async () => {
  const f = mount({ children: [section("S1", "Reading", 400, 0, 500, 300, { follow: { kind: "block", uid: "SRC" } }, [card("c1", "((k1))", 24, 24, { src: "block:SRC" })])] });
  await f.timers.run();
  f.tray.open();
  const drag = {};
  f.root.querySelector(".pxd-follow__row").dispatchEvent({ type: "dragstart", stopPropagation() {}, dataTransfer: { setData: (k, v) => { drag[k] = v; } } });
  assert.deepEqual(JSON.parse(drag[FOLLOW_MIME]), { uid: "k2", kind: "block", board: "b1", src: "block:SRC", owner: "S1" });
  assert.deepEqual(f.tray.keys(), ["block:SRC"]);
  assert.equal(f.tray.menuState().following, false, "the board itself follows nothing");
  assert.equal(f.tray.sectionMenuState("S1").following, true);
  const ids = flattenMenu(buildMenu("section", { follow: f.tray.sectionMenuState("S1") })).map((m) => m.id).filter((id) => id.startsWith("follow-section"));
  assert.deepEqual(ids, ["follow-section", "follow-section:label", "follow-section:show", "follow-section:tree", "follow-section:pick-block", "follow-section:pick-query", "follow-section:pick-refs", "follow-section:pick-board", "follow-section:stop"]);
  await f.session.stopFollowing("S1");
  assert.equal(f.root.querySelector(".pxd-follow"), null, "no owner left: no pill");
  f.tray.dispose();
});

// ---- board view: a dropped section row ----

function mountDrop(owners) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [] });
  const calls = [];
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false, mutations: [], on: () => () => {}, release() {}, setLinkMode() {},
    followState: () => null,
    followOwners: () => ({ owners, capped: false }),
    placeFollowed: (entries, opts) => { calls.push(["placeFollowed", entries.map((e) => e.uid), opts?.owner || null]); return Promise.resolve({ uids: [] }); },
    addRefCards: (rows) => { calls.push(["addRefCards", rows.map((r) => r.string)]); return Promise.resolve([]); },
  };
  const host = {
    graph: "Svy", renderString() {}, renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => null, pullTree: () => [], pageUid: () => null, blockString: (uid) => (uid === "k2" ? "two" : null),
    openBlock() {}, openInSidebar() {}, related: () => [],
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "2.1.0" });
  stub.flushFrames();
  const drop = async (row) => {
    const data = { [FOLLOW_MIME]: JSON.stringify(row), "application/x-plexus-card": "((k2))", "text/plain": "((k2))" };
    stub.dispatch(view.root, "drop", { clientX: 300, clientY: 300, dataTransfer: { getData: (t) => data[t] || "", types: Object.keys(data), files: [] } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { calls, drop, done: () => { view.dispose(); restore(); } };
}

test("PXD-13 drop: a section's row is placed while that section follows the same source; otherwise it is a plain ref card", async () => {
  const owners = [{ uid: "sec000001", section: true, key: "block:SRC", over: false, dup: null }];
  const d = mountDrop(owners);
  try {
    await d.drop({ uid: "k2", kind: "block", board: "board0001", src: "block:SRC", owner: "sec000001" });
    assert.deepEqual(d.calls, [["placeFollowed", ["k2"], "sec000001"]]);
  } finally { d.done(); }
  const e = mountDrop([{ uid: "sec000001", section: true, key: "block:ELSE", over: false, dup: null }]);
  try {
    await e.drop({ uid: "k2", kind: "block", board: "board0001", src: "block:SRC", owner: "sec000001" });
    assert.deepEqual(e.calls, [["addRefCards", ["((k2))"]]], "the section switched source since the drag began");
  } finally { e.done(); }
});
