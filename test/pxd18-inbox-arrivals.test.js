// PXD-18: the board's Inbox as a follow source. Citing daily-note blocks arrive in the tray's Arrivals strip, at most
// ARRIVALS_CAP per visit; nothing is written on open; placing reuses PXD-9's place, skip list and no-move rule.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-follow.js";
import { createFollowTray } from "../src/view/follow-tray.js";
import { followKind } from "../src/host/follow-sources.js";
import { ARRIVALS_CAP, FOLLOW_QUIET_MS, arrivalsLine, arrivalsPill, arrivalsView, followDiff, followedUids, visitPlaced } from "../src/model/follow.js";
import { INBOX_PULL_LIMIT, readInbox } from "../src/model/inbox.js";
import { createInbox } from "../src/view/inbox.js";
import { SPREAD_CAP } from "../src/session-clip.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const card = (uid, string, x, y, extra = {}) => ({ uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } } });
const INBOX = { v: 2, follow: { kind: "inbox", uid: "b1" } };
const ord = (n) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
const day = (n) => `October ${n}${ord(n)}, 2026`;
const row = (uid, n, string = `note ${uid} [[Lab]]`) => ({ uid, string, page: day(n), time: Date.UTC(2026, 9, n) });

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

// The reverse pull per title, answered from `cites` (title -> rows). `fail`: the pull throws.
function inboxQ(cites, calls = [], state = { fail: false }) {
  return (query, title) => {
    calls.push(title);
    if (state.fail) throw new Error("q failed");
    const refs = (cites[title] || []).map((r) => ({ ":block/uid": r.uid, ":block/string": r.string, ":create/time": r.time, ":block/page": { ":node/title": r.page } }));
    return [[{ ":node/title": title, ":block/_refs": refs }]];
  };
}

function mount({ plexus = INBOX, children, cites = { Lab: [] }, storage, undo = false } = {}) {
  const fake = createFakeRoam();
  fake.trackUndo = undo;
  const base = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus }, children: children ?? [card("n1", "Note one", 0, 0)] });
  const calls = [];
  const state = { fail: false };
  const host = Object.create(base);
  host.q = inboxQ(cites, calls, state);
  host.pageTitleOf = (uid) => (uid === "b1" ? "Lab" : "");
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const timers = manualTimers();
  const sources = [];
  const make = () => createFollowTray({
    doc: dom.document,
    root,
    host,
    session,
    timers,
    board: () => session.board,
    storage: storage || fake.storage,
    graph: "g",
    onSource: (kind, was) => sources.push([kind, was]),
    now: () => 0,
  });
  return { fake, host, session, dom, root, timers, tray: make(), make, calls, state, sources };
}

const many = (n, from = 1) => Array.from({ length: n }, (_, i) => row(`d${String(from + i).padStart(8, "0")}`, 1 + ((from + i) % 28)));

test("PXD-18 arrivals: the strip shows at most the visit's room and says how many wait", () => {
  const pending = Array.from({ length: 25 }, (_, i) => ({ uid: `u${i}` }));
  const first = arrivalsView(pending);
  assert.equal(first.rows.length, ARRIVALS_CAP);
  assert.deepEqual(first.rows.map((r) => r.uid), pending.slice(0, ARRIVALS_CAP).map((r) => r.uid), "newest first, in source order");
  assert.equal(first.waiting, 25 - ARRIVALS_CAP);
  assert.equal(arrivalsLine(first), `${ARRIVALS_CAP} arrivals · ${25 - ARRIVALS_CAP} more wait`);
  // The 20 were placed: they leave `pending`, and the visit has no room left.
  const after = arrivalsView(pending.slice(ARRIVALS_CAP), { placed: ARRIVALS_CAP });
  assert.deepEqual(after, { rows: [], waiting: 5 });
  assert.equal(arrivalsLine(after), "5 wait for your next visit");
  const more = arrivalsView(pending.slice(ARRIVALS_CAP), { allowance: 2 * ARRIVALS_CAP, placed: ARRIVALS_CAP });
  assert.equal(more.rows.length, 5);
  assert.equal(more.waiting, 0);
  assert.equal(arrivalsLine(more), "5 arrivals");
  assert.equal(arrivalsLine(arrivalsView([{ uid: "a" }])), "1 arrival");
  assert.equal(arrivalsLine(arrivalsView([])), "No arrivals");
  assert.deepEqual(arrivalsView(null), { rows: [], waiting: 0 });
  assert.ok(ARRIVALS_CAP <= SPREAD_CAP, "placing the whole strip is one batch, one undo");
  assert.equal(arrivalsPill(7), "Arrivals (7)");
});

test("PXD-18 arrivals diff: only daily-note blocks not on the board and not skipped arrive, newest first", async () => {
  const kind = followKind("inbox");
  assert.ok(kind, "the inbox kind is registered");
  const cites = {
    Lab: [
      row("dOld00001", 3),
      row("dNew00001", 20),
      { uid: "pNotDaily", string: "on a plain page [[Lab]]", page: "Projects", time: Date.UTC(2026, 9, 25) },
      row("dPlaced01", 10),
      row("dSkip0001", 12),
      row("dBlank001", 14, "  "),
    ],
    Flow: [row("dTitle001", 15, "[[Flow]] from the board title"), row("dNew00001", 20)],
  };
  const host = { q: inboxQ(cites), pageTitleOf: () => "Lab" };
  const res = await kind.read({ kind: "inbox", uid: "b1" }, { host, boardUid: "b1", boardTitle: () => "Flow", inBoard: () => new Set(["b1", "n1"]), tick: () => Promise.resolve() });
  assert.equal(res.ok, true);
  assert.equal(res.complete, true);
  assert.deepEqual(res.items.map((i) => i.uid), ["dNew00001", "dTitle001", "dBlank001", "dSkip0001", "dPlaced01", "dOld00001"], "daily pages only, one row per block, newest first");
  assert.equal(res.items[0].crumb, day(20));
  assert.equal(res.items[0].kind, "block");
  const board = { items: new Map([["c1", { uid: "c1", string: "((dPlaced01))", target: { kind: "block", uid: "dPlaced01" } }]]) };
  const diff = followDiff(res, board, { key: "inbox:b1", skip: ["dSkip0001"], since: Date.UTC(2026, 9, 13) });
  assert.deepEqual(diff.pending.map((p) => p.uid), ["dNew00001", "dTitle001", "dOld00001"], "placed, skipped and blank blocks do not arrive");
  assert.deepEqual(diff.pending.map((p) => p.fresh), [true, true, false], "made since the last visit: new");
  assert.equal(diff.placed, 1);
  assert.equal(diff.dismissed, 1);
});

test("PXD-18 arrivals diff: a failed or full pull is partial, so placed cards are never marked as gone", async () => {
  const kind = followKind("inbox");
  const ctx = (host) => ({ host, boardUid: "b1", boardTitle: () => "", inBoard: () => new Set(["b1"]), tick: () => Promise.resolve() });
  const broken = await kind.read({ kind: "inbox", uid: "b1" }, ctx({ q: inboxQ({}, [], { fail: true }), pageTitleOf: () => "Lab" }));
  assert.equal(broken.ok, true);
  assert.equal(broken.complete, false, "a pull that threw is not the whole inbox");
  assert.equal((await readInbox(inboxQ({}, [], { fail: true }), ["Lab"])).failed, true);
  const full = await kind.read({ kind: "inbox", uid: "b1" }, ctx({ q: inboxQ({ Lab: many(INBOX_PULL_LIMIT) }), pageTitleOf: () => "Lab" }));
  assert.equal(full.complete, false, "at the pull limit the list may go on");
  assert.equal(full.items.length, 300, "the read cap holds");
  const untitled = await kind.read({ kind: "inbox", uid: "b1" }, ctx({ q: () => { throw new Error("no read"); }, pageTitleOf: () => "" }));
  assert.deepEqual(untitled, { ok: true, complete: true, items: [] }, "a board nothing can cite has an empty inbox and asks nothing");
});

test("PXD-18 tray: opening a board that follows its Inbox reads at idle, caps the strip and writes nothing", async () => {
  const f = mount({ cites: { Lab: many(25) } });
  assert.equal(f.calls.length, 0, "no read before the board settles");
  await f.timers.run();
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Arrivals (25)");
  f.root.querySelector(".pxd-follow").click();
  await f.timers.run();
  assert.equal(f.root.querySelector(".pxd-follow__title").textContent, "Following this board's Inbox");
  assert.equal(f.root.querySelector(".pxd-follow__arrivals").textContent, "Arrivals");
  assert.equal(f.root.querySelectorAll(".pxd-follow__row").length, ARRIVALS_CAP);
  assert.equal(f.root.querySelector(".pxd-follow__more .pxd-follow__count").textContent, "5 more wait");
  assert.equal(f.tray.arrivals().waiting, 5);
  await f.fake.flush();
  assert.deepEqual(f.fake.writesLog(), [], "open and read write nothing");
  f.tray.dispose();
});

test("PXD-18 tray: Place all places only the strip, in one batch; the rest wait for the next visit or Show more", async () => {
  const f = mount({ cites: { Lab: many(25) } });
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  const shown = f.tray.arrivals().rows.map((r) => r.uid);
  const before = f.fake.props("n1").plexus;
  f.root.querySelector(".pxd-follow__all").click();
  await flush();
  await f.fake.flush();
  const creates = f.fake.writesLog().filter((w) => w[0] === "create");
  assert.equal(creates.length, ARRIVALS_CAP);
  const placed = [...f.session.board.items.values()].filter((i) => i.src === "inbox:b1");
  assert.deepEqual(placed.map((i) => i.target?.uid).sort(), shown.slice().sort(), "ref cards for the strip's rows, with the source key");
  assert.deepEqual(f.fake.props("n1").plexus, before, "cards already on the board do not move");
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Arrivals (5)");
  assert.equal(f.root.querySelectorAll(".pxd-follow__row").length, 0, "the visit's room is used up");
  assert.match(f.root.querySelector(".pxd-follow__count").textContent, /^5 wait for your next visit/);
  assert.equal(f.root.querySelector(".pxd-follow__all").disabled, true);
  f.root.querySelector(".pxd-follow__show-more").click();
  assert.equal(f.root.querySelectorAll(".pxd-follow__row").length, 5);
  f.tray.dispose();
  // A new visit has room again.
  const next = f.make();
  await f.timers.run();
  assert.equal(next.arrivals().rows.length, 5);
  assert.equal(next.arrivals().waiting, 0);
  next.dispose();
});

test("PXD-18 tray: Don't bring back uses no room and the block never arrives again", async () => {
  const f = mount({ cites: { Lab: many(22) } });
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  const first = f.tray.arrivals().rows[0].uid;
  f.root.querySelector(".pxd-follow__skip").click();
  await flush();
  await f.fake.flush();
  assert.deepEqual(f.fake.props("b1").plexus.follow.skip, [first], "the skip list lives in the pointer");
  assert.equal(f.tray.arrivals().rows.length, ARRIVALS_CAP, "a row from the waiting ones takes its place");
  assert.equal(f.tray.arrivals().waiting, 1);
  assert.ok(!f.tray.rows().some((r) => r.uid === first));
  f.tray.dispose();
});

test("PXD-18 tray: a pull that fails after cards were placed marks none of them as left", async () => {
  const cites = { Lab: [row("dA0000001", 5), row("dB0000001", 6)] };
  const f = mount({ cites, children: [card("c1", "((dA0000001))", 0, 0, { src: "inbox:b1" })] });
  await f.timers.run();
  f.state.fail = true;
  for (let i = 0; i < 3; i += 1) { f.tray.refresh(); await f.timers.run(); }
  assert.deepEqual(f.tray.left(), [], "partial reads never count a miss");
  f.state.fail = false;
  cites.Lab = [row("dB0000001", 6)];
  for (let i = 0; i < 2; i += 1) { f.tray.refresh(); await f.timers.run(); }
  assert.deepEqual(f.tray.left(), ["c1"], "the block stopped citing the board: two complete reads mark its card");
  assert.ok(f.fake.has("c1"), "the card stays");
  f.tray.dispose();
});

test("PXD-18 session: only the board's own uid is an Inbox source; following it is one pointer write", async () => {
  const f = mount({ plexus: { v: 2 } });
  assert.equal(await f.session.followSource({ kind: "inbox", uid: "OTHER" }), false);
  assert.equal(await f.session.followSource({ kind: "block", uid: "b1" }), false, "a board never follows its own children");
  f.fake.clearLog();
  assert.equal(await f.session.followSource({ kind: "inbox", uid: "b1" }), true);
  await f.fake.flush();
  assert.deepEqual(f.fake.props("b1").plexus.follow, { kind: "inbox", uid: "b1" });
  assert.equal(f.fake.writesLog().length, 1, "one write: the pointer");
  assert.deepEqual(f.sources.at(-1), ["inbox", ""], "the Inbox pill hears the switch");
  assert.equal(f.tray.menuState().kind, "inbox");
  f.tray.dispose();
});

test("PXD-18 menu: the Inbox is offered as a source, and not again while it is followed", () => {
  const ids = (follow) => flattenMenu(buildMenu("board-menu", { follow })).map((m) => m.id).filter((id) => id.startsWith("follow:"));
  assert.ok(ids({ following: false }).includes("follow:inbox"));
  assert.ok(ids({ following: true, kind: "block", label: "x" }).includes("follow:inbox"));
  assert.deepEqual(ids({ following: true, kind: "inbox", label: "this board's Inbox" }), ["follow:label", "follow:show", "follow:pick-block", "follow:pick-query", "follow:pick-refs", "follow:pick-headings", "follow:pick-journals", "follow:stop"]);
});

test("PXD-18 Inbox pill: hidden while the board follows its Inbox, with no read; Follow in its panel", async () => {
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const calls = [];
  const host = { q: inboxQ({ Lab: [row("dA0000001", 5)] }, calls) };
  let away = true;
  const follows = [];
  const timers = { idle: (fn) => { const id = setImmediate(fn); return () => clearImmediate(id); } };
  const inbox = createInbox({ doc: dom.document, root, host, timers, titles: () => ["Lab"], hidden: () => away, follow: () => follows.push(1) });
  await flush();
  assert.equal(root.querySelector(".pxd-inbox"), null, "no pill");
  assert.equal(calls.length, 0, "no read");
  away = false;
  await inbox.refresh();
  assert.equal(root.querySelector(".pxd-inbox").textContent, "Inbox (1)");
  root.querySelector(".pxd-inbox").click();
  await flush();
  root.querySelector(".pxd-inbox__follow").click();
  assert.equal(follows.length, 1);
  away = true;
  inbox.sync();
  assert.equal(root.querySelector(".pxd-inbox"), null);
  assert.equal(root.querySelector(".pxd-inbox__panel"), null, "the open list goes too");
  inbox.dispose();
});

test("PXD-18 visit count: read from the board, so any way a card of the source is made counts, and undo gives it back", () => {
  const board = (uids) => ({ items: new Map(uids.map((u) => [u, { uid: u, src: u.startsWith("x") ? "block:S" : "inbox:b1" }])) });
  const before = followedUids(board(["old1", "x1"]), "inbox:b1");
  assert.deepEqual([...before], ["old1"]);
  assert.equal(visitPlaced(board(["old1", "x1"]), "inbox:b1", before), 0, "cards from before the visit and other sources do not count");
  assert.equal(visitPlaced(board(["old1", "new1", "new2", "x2"]), "inbox:b1", before), 2);
  assert.equal(visitPlaced(board(["new1"]), "inbox:b1", before), 1, "a card from before that went does not refund room twice");
});

test("PXD-18 tray: a dragged arrival (the drop's placeFollowed) uses the visit's room like Place", async () => {
  const f = mount({ cites: { Lab: many(25) } });
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  const placedAll = [];
  for (let i = 0; i < 25; i += 1) {
    const rows = f.tray.arrivals().rows;
    if (!rows.length) break;
    // What the board's drop handler does with a FOLLOW_MIME row.
    await f.session.placeFollowed([{ uid: rows[0].uid, kind: "block", src: "inbox:b1" }], { at: { x: 400, y: 40 * i } });
    await f.fake.flush();
    placedAll.push(rows[0].uid);
    assert.equal(f.tray.arrivals().rows.length, ARRIVALS_CAP - placedAll.length, "the strip does not refill");
    assert.equal(f.tray.arrivals().waiting, 5);
  }
  assert.equal(placedAll.length, ARRIVALS_CAP, "one visit places at most the cap");
  assert.equal(f.root.querySelectorAll(".pxd-follow__row").length, 0);
  assert.match(f.root.querySelector(".pxd-follow__count").textContent, /^5 wait for your next visit/);
  f.tray.dispose();
});

test("PXD-18 tray: undoing Place all gives the visit its room back", async () => {
  const f = mount({ cites: { Lab: many(25) }, undo: true });
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  f.root.querySelector(".pxd-follow__all").click();
  await flush();
  await f.fake.flush();
  assert.equal(f.tray.arrivals().rows.length, 0);
  await f.session.undo();
  await f.fake.flush();
  await flush();
  assert.equal([...f.session.board.items.values()].filter((i) => i.src === "inbox:b1").length, 0, "the cards are gone");
  assert.equal(f.tray.arrivals().rows.length, ARRIVALS_CAP);
  assert.equal(f.tray.arrivals().waiting, 5);
  assert.equal(f.root.querySelectorAll(".pxd-follow__row").length, ARRIVALS_CAP, "the panel shows them again");
  assert.equal(f.root.querySelector(".pxd-follow__all").disabled, false);
  assert.match(f.root.querySelector(".pxd-follow__count").textContent, /^20 arrivals · 5 more wait · 0 on the board/);
  f.tray.dispose();
});

test("PXD-18 session: a section cannot follow the board's Inbox; the board still can", async () => {
  const sec = { uid: "s1", string: "Reading", props: { plexus: { type: "section", x: 0, y: 300, w: 400, h: 300 } }, children: [] };
  const f = mount({ plexus: { v: 2 }, children: [card("n1", "Note one", 0, 0), sec] });
  assert.equal(await f.session.followSource({ kind: "inbox", uid: "b1", owner: "s1" }), false);
  assert.equal(f.session.followRefusal().reason, "self");
  assert.equal(await f.session.followSource({ kind: "inbox", uid: "s1", owner: "s1" }), false);
  assert.equal(await f.session.followSource({ kind: "inbox", uid: "b1" }), true);
  f.tray.dispose();
});
