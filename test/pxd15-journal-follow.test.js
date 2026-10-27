// PXD-15: a board follows a rolling window of daily pages (journals:days-N / journals:week), optionally one column per day.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-follow.js";
import { createFollowTray } from "../src/view/follow-tray.js";
import { JOURNAL_DAY_CAP, JOURNAL_PULL_LIMIT, followKind } from "../src/host/follow-sources.js";
import {
  FOLLOW_POLL_MS,
  FOLLOW_QUIET_MS,
  JOURNAL_DEFAULT_DAYS,
  JOURNAL_MAX_DAYS,
  followPointerFor,
  journalColumnSpots,
  journalSpec,
  journalUid,
  normalizePointer,
  serializePointer,
  sourceKey,
} from "../src/model/follow.js";
import { dailyTitle, dailyUid, journalWindow, startOfDay } from "../src/model/journal.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const day = (n) => new Date(2026, 9, n);

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

// Daily pages Oct `from`..`to` 2026, each with `blocks(n)` children. Page uids are Roam's MM-DD-YYYY.
function seedDays(fake, from, to, blocks = (n) => [{ uid: `b${n}a`, string: `first ${n}` }, { uid: `b${n}b`, string: `second ${n}` }]) {
  for (let n = from; n <= to; n += 1) fake.seedPage({ title: dailyTitle(day(n)), uid: dailyUid(day(n)), children: blocks(n) });
}

function mount({ pointer = { kind: "journals", uid: "days-7" }, clock = { t: at(2026, 10, 27) }, seed = (fake) => seedDays(fake, 20, 28), children } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seed(fake);
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2, follow: pointer } }, children: children ?? [] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const timers = manualTimers();
  const tray = createFollowTray({
    doc: dom.document,
    root,
    host,
    session,
    timers,
    board: () => session.board,
    storage: fake.storage,
    graph: "g",
    now: () => 0,
    clock: () => clock.t,
  });
  return { fake, host, session, dom, root, timers, tray, clock };
}

const place = async (f) => {
  const res = await f.session.placeFollowed(f.tray.rows().map((r) => ({ uid: r.uid, kind: r.kind, ...(r.title ? { title: r.title } : {}), ...(r.day ? { day: r.day } : {}) })));
  await f.fake.flush();
  await flush();
  return res;
};
const read = async (f, n = 1) => { for (let i = 0; i < n; i += 1) { f.tray.refresh(); await f.timers.run(); await f.timers.run(FOLLOW_POLL_MS); } };
const posOf = (f, uid) => { const p = f.fake.props(uid)?.plexus; return p ? { x: p.x, y: p.y } : null; };
const cardsOf = (f) => [...f.session.board.items.values()].filter((i) => i.src === "journals:days-7");

// ---------------------------------------------------------------- 1. pointer and window

test("PXD-15 pointer: columns survives normalize / serialize / followPointerFor; journalSpec and journalUid round trip", () => {
  const p = normalizePointer({ kind: "journals", uid: "days-7", columns: true, skip: ["a"] });
  assert.deepEqual(p, { kind: "journals", uid: "days-7", columns: true, skip: ["a"] });
  assert.deepEqual(serializePointer(p), { kind: "journals", uid: "days-7", columns: true, skip: ["a"] });
  assert.deepEqual(serializePointer({ kind: "journals", uid: "days-7", columns: false }), { kind: "journals", uid: "days-7" });
  assert.equal(sourceKey(p), "journals:days-7");
  assert.deepEqual(followPointerFor(p, "journals", "days-7", {}), { kind: "journals", uid: "days-7", columns: true, skip: ["a"] }, "same source keeps columns");
  assert.deepEqual(followPointerFor(p, "journals", "days-7", { columns: false }), { kind: "journals", uid: "days-7", skip: ["a"] });
  assert.deepEqual(followPointerFor(p, "journals", "week", { columns: true }), { kind: "journals", uid: "week", columns: true, skip: [] });
  assert.deepEqual(followPointerFor(p, "journals", "week", {}), { kind: "journals", uid: "week", skip: [] }, "another source starts clean");
  assert.equal(JOURNAL_DEFAULT_DAYS, 7);
  assert.equal(JOURNAL_MAX_DAYS, 31);
  for (const n of [1, 7, 31]) assert.deepEqual(journalSpec(journalUid({ days: n })), { days: n });
  assert.deepEqual(journalSpec(journalUid({ week: true })), { week: true });
  for (const bad of ["days-0", "days-32", "days-x", "days-", "days-07", "weeks", "", null, undefined]) assert.equal(journalSpec(bad), null, String(bad));
  assert.equal(journalUid({ days: 0 }), "");
  assert.equal(journalUid({ days: 32 }), "");
});

test("PXD-15 window: days-7 and week from a Wednesday and a Sunday, across a DST change", () => {
  const key = (list) => list.map((t) => dailyUid(t));
  assert.deepEqual(key(journalWindow("days-7", at(2026, 10, 27))), ["10-21-2026", "10-22-2026", "10-23-2026", "10-24-2026", "10-25-2026", "10-26-2026", "10-27-2026"]);
  assert.deepEqual(journalWindow("days-1", at(2026, 10, 27)), [startOfDay(at(2026, 10, 27))]);
  assert.deepEqual(journalWindow("days-0", at(2026, 10, 27)), []);
  assert.deepEqual(journalWindow("nope", at(2026, 10, 27)), []);
  // Wednesday Oct 28 2026 -> Monday Oct 26 .. Sunday Nov 1 (the US DST end is Nov 1, 2026).
  assert.equal(new Date(at(2026, 10, 28)).getDay(), 3);
  assert.deepEqual(key(journalWindow("week", at(2026, 10, 28))), ["10-26-2026", "10-27-2026", "10-28-2026", "10-29-2026", "10-30-2026", "10-31-2026", "11-01-2026"]);
  // Sunday Nov 1 is the last day of its own week.
  assert.equal(new Date(at(2026, 11, 1)).getDay(), 0);
  assert.deepEqual(key(journalWindow("week", at(2026, 11, 1))), ["10-26-2026", "10-27-2026", "10-28-2026", "10-29-2026", "10-30-2026", "10-31-2026", "11-01-2026"]);
  // US spring forward is Mar 8, 2026: no skipped or repeated day.
  assert.deepEqual(key(journalWindow("days-5", at(2026, 3, 10))), ["03-06-2026", "03-07-2026", "03-08-2026", "03-09-2026", "03-10-2026"]);
  assert.deepEqual(key(journalWindow("week", at(2026, 3, 8))), ["03-02-2026", "03-03-2026", "03-04-2026", "03-05-2026", "03-06-2026", "03-07-2026", "03-08-2026"]);
  for (const t of journalWindow("days-31", at(2026, 11, 3))) assert.equal(t, startOfDay(t), "every entry is a local midnight");
});

// ---------------------------------------------------------------- 2. rollover

test("PXD-15 rollover: Oct 21..27 pending, place all, the clock rolls to Oct 28 and Oct 21 leaves after two reads; nothing is deleted or written by reading", async () => {
  const f = mount();
  await f.timers.run();
  assert.equal(f.tray.reads(), 1);
  assert.deepEqual(f.tray.rows().map((r) => r.title), [21, 22, 23, 24, 25, 26, 27].map((n) => dailyTitle(day(n))));
  assert.ok(f.tray.rows().every((r) => r.kind === "page"));
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (7)");
  await f.fake.flush();
  assert.deepEqual(f.fake.writesLog(), [], "open and read write nothing");
  const res = await place(f);
  assert.equal(res.placed, 7);
  assert.equal(f.tray.rows().length, 0);
  assert.deepEqual(cardsOf(f).map((c) => c.day).sort(), ["10-21-2026", "10-22-2026", "10-23-2026", "10-24-2026", "10-25-2026", "10-26-2026", "10-27-2026"]);
  const oct21 = cardsOf(f).find((c) => c.day === "10-21-2026").uid;
  f.fake.clearLog();
  f.clock.t = at(2026, 10, 28);
  f.tray.refresh();
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => r.title), [dailyTitle(day(28))], "Oct 28 is offered");
  assert.deepEqual(f.tray.left(), [], "one miss is not enough");
  await read(f, 1);
  assert.deepEqual(f.tray.left(), [oct21], "two complete reads without Oct 21");
  assert.ok(f.session.board.items.has(oct21), "the card stays on the board");
  await f.fake.flush();
  assert.deepEqual(f.fake.writesLog(), [], "reads never write");
  f.tray.dispose();
});

// ---------------------------------------------------------------- 3. titles only

test("PXD-15 titles: a daily title on a page with another uid is found; a non-daily page with a daily uid is not", async () => {
  const f = mount({
    seed: (fake) => {
      fake.seedPage({ title: "October 27th, 2026", uid: "weird0001", children: [{ uid: "wa", string: "from the title" }] });
      fake.seedPage({ title: "Not a day", uid: "10-26-2026", children: [{ uid: "wb", string: "wrong page" }] });
    },
  });
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => [r.uid, r.title, r.day]), [["weird0001", "October 27th, 2026", "10-27-2026"]]);
  f.tray.dispose();
});

test("PXD-15 read: an empty or blank-only day is not offered; a failed pull makes the read partial, every pull failing is an error", async () => {
  const kind = followKind("journals");
  const ctx = { now: () => at(2026, 10, 27) };
  const pageOf = (n, kids) => ({ ":block/uid": dailyUid(day(n)), ":node/title": dailyTitle(day(n)), ":block/children": kids });
  const pages = { 26: pageOf(26, [{ ":block/uid": "x", ":block/string": "  ", ":block/order": 0 }]), 27: pageOf(27, [{ ":block/uid": "y", ":block/string": "hi", ":block/order": 0 }]) };
  const host = { pullTitle: (pattern, title) => { for (const n of Object.keys(pages)) if (dailyTitle(day(n)) === title) return pages[n]; if (title === dailyTitle(day(25))) throw new Error("boom"); return null; } };
  const res = await kind.read({ kind: "journals", uid: "days-7" }, { ...ctx, host });
  assert.equal(res.ok, true);
  assert.equal(res.complete, false, "one pull failed");
  assert.deepEqual(res.items.map((i) => i.uid), [dailyUid(day(27))]);
  const all = await kind.read({ kind: "journals", uid: "days-3" }, { ...ctx, host: { pullTitle: () => { throw new Error("boom"); } } });
  assert.deepEqual(all, { ok: false, reason: "error" });
  assert.equal((await kind.read({ kind: "journals", uid: "days-99" }, { ...ctx, host })).ok, false);
});

// ---------------------------------------------------------------- 4. columns

test("PXD-15 journalColumnSpots: new columns, an existing column appends, new days go right of the rightmost, placed cards are never in the output", () => {
  const size = { w: 200, h: 100, gap: 48, stack: 24 };
  const bounds = { x: 0, y: 10, w: 300, h: 200 };
  const e = (d, n) => Array.from({ length: n }, (_, i) => ({ uid: `${d}-${i}`, day: d }));
  // No journal cards yet: columns right of the bounds, oldest day first, top at bounds.y.
  const fresh = journalColumnSpots([], [...e("10-27-2026", 2), ...e("10-26-2026", 1)], { bounds, ...size });
  assert.deepEqual(fresh, [{ x: 596, y: 10 }, { x: 596, y: 134 }, { x: 348, y: 10 }]);
  assert.deepEqual(journalColumnSpots([], [{ uid: "a", day: "10-27-2026" }], size), [{ x: 0, y: 0 }], "no bounds: 0,0");
  // Existing column for 10-26 (x 400, lowest card ends at 300): a new card goes below it; 10-27 is a new column right of 600.
  const existing = [{ day: "10-26-2026", x: 400, y: 50, w: 200, h: 100 }, { day: "10-26-2026", x: 400, y: 200, w: 200, h: 100 }];
  const spots = journalColumnSpots(existing, [...e("10-26-2026", 2), ...e("10-27-2026", 2), ...e("10-28-2026", 1)], { bounds, ...size });
  assert.deepEqual(spots, [
    { x: 400, y: 324 }, { x: 400, y: 448 },
    { x: 648, y: 50 }, { x: 648, y: 174 },
    { x: 896, y: 50 },
  ]);
  assert.equal(spots.length, 5, "one spot per entry, none for the cards already placed");
});

test("PXD-15 journalColumnSpots: page cards the plain mode stacked in one column are not columns, so blocks never land on another day's card", () => {
  const size = { w: 200, h: 100, gap: 48, stack: 24 };
  // Plain mode placed the page cards of two days one under the other at x 348.
  const existing = [{ day: "01-04-2031", x: 348, y: 40, w: 200, h: 100 }, { day: "01-05-2031", x: 348, y: 164, w: 200, h: 100 }];
  const spots = journalColumnSpots(existing, [{ uid: "a", day: "01-04-2031" }, { uid: "b", day: "01-05-2031" }, { uid: "c", day: "01-05-2031" }], size);
  assert.deepEqual(spots, [{ x: 596, y: 40 }, { x: 844, y: 40 }, { x: 844, y: 164 }]);
  const hit = (s) => existing.some((r) => s.x < r.x + r.w && s.x + 200 > r.x && s.y < r.y + r.h && s.y + 100 > r.y);
  assert.ok(!spots.some(hit), "no new card overlaps a placed one");
  // Once each day has its own block column, the stray page card in the shared band does not stop appending there.
  const later = [...existing, { day: "01-04-2031", x: 596, y: 40, w: 200, h: 100 }, { day: "01-05-2031", x: 844, y: 40, w: 200, h: 100 }, { day: "01-05-2031", x: 844, y: 164, w: 200, h: 100 }];
  assert.deepEqual(journalColumnSpots(later, [{ uid: "d", day: "01-05-2031" }, { uid: "e", day: "01-04-2031" }], size), [{ x: 844, y: 288 }, { x: 596, y: 164 }]);
});

test("PXD-15 columns end to end: two day columns headed by the page card, then a new block and a new day append without moving anything", async () => {
  const f = mount({
    pointer: { kind: "journals", uid: "days-7", columns: true },
    seed: (fake) => {
      fake.seedPage({ title: dailyTitle(day(26)), uid: dailyUid(day(26)), children: [{ uid: "m1", string: "mon one" }, { uid: "m2", string: "mon two" }, { uid: "m3", string: "mon three" }] });
      fake.seedPage({ title: dailyTitle(day(27)), uid: dailyUid(day(27)), children: [{ uid: "t1", string: "tue one" }, { uid: "t2", string: "tue two" }] });
    },
  });
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => r.uid), [dailyUid(day(26)), "m1", "m2", "m3", dailyUid(day(27)), "t1", "t2"]);
  assert.equal(f.tray.stats().key, "journals:days-7");
  const res = await place(f);
  assert.equal(res.placed, 7);
  const items = [...f.session.board.items.values()];
  const byDay = (d) => items.filter((i) => i.day === d).sort((a, b) => a.y - b.y);
  const rects = f.session.rects;
  const col = (d) => items.filter((i) => i.day === d).map((i) => ({ uid: i.uid, ...rects.get(i.uid) })).sort((a, b) => a.y - b.y);
  const mon = col("10-26-2026");
  const tue = col("10-27-2026");
  assert.equal(mon.length, 4);
  assert.equal(tue.length, 3);
  assert.equal(new Set(mon.map((r) => r.x)).size, 1, "one x per column");
  assert.ok(tue[0].x > mon[0].x + mon[0].w, "Tuesday is right of Monday");
  assert.equal(items.find((i) => i.uid === mon[0].uid).string, `[[${dailyTitle(day(26))}]]`, "the page card heads the column");
  assert.deepEqual(mon.slice(1).map((r) => items.find((i) => i.uid === r.uid).string), ["((m1))", "((m2))", "((m3))"], "outline order under the head");
  assert.equal(byDay("10-26-2026").length, 4);
  const before = Object.fromEntries(items.map((i) => [i.uid, posOf(f, i.uid)]));
  const tueBottom = Math.max(...tue.map((r) => r.y + r.h));
  const tueX = tue[0].x;
  // A new block on Tuesday and a new day Wednesday.
  f.fake.seedPage({ title: dailyTitle(day(28)), uid: dailyUid(day(28)), children: [{ uid: "w1", string: "wed one" }] });
  f.fake.api.data.block.create({ location: { "parent-uid": dailyUid(day(27)), order: "last" }, block: { uid: "t3", string: "tue three" } });
  await f.fake.flush();
  f.clock.t = at(2026, 10, 28);
  f.tray.refresh();
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["t3", dailyUid(day(28)), "w1"]);
  await place(f);
  const after = [...f.session.board.items.values()];
  const t3 = after.find((i) => i.string === "((t3))");
  const t3r = f.session.rects.get(t3.uid);
  assert.equal(t3r.x, tueX, "the new Tuesday block is in Tuesday's column");
  assert.ok(t3r.y >= tueBottom, "below Tuesday's lowest card");
  const wed = after.filter((i) => i.day === "10-28-2026").map((i) => ({ i, r: f.session.rects.get(i.uid) })).sort((a, b) => a.r.y - b.r.y);
  assert.equal(wed.length, 2);
  assert.ok(wed[0].r.x > tueX + 100, "Wednesday gets a new column right of Tuesday");
  assert.equal(wed[0].i.string, `[[${dailyTitle(day(28))}]]`);
  for (const [uid, pos] of Object.entries(before)) assert.deepEqual(posOf(f, uid), pos, `${uid} did not move`);
  f.tray.dispose();
});

test("PXD-15 placing with a drag spot puts the card at the spot and still stores its day", async () => {
  const f = mount({ pointer: { kind: "journals", uid: "days-7", columns: true } });
  await f.timers.run();
  const row = f.tray.rows()[0];
  const res = await f.session.placeFollowed([{ uid: row.uid, kind: row.kind, title: row.title, day: row.day }], { at: { x: 500, y: 700 } });
  await f.fake.flush();
  assert.equal(res.placed, 1);
  assert.deepEqual(posOf(f, res.uids[0]), { x: 500, y: 700 });
  assert.equal(f.fake.props(res.uids[0]).plexus.day, row.day);
  assert.equal(f.fake.props(res.uids[0]).plexus.src, "journals:days-7");
  f.tray.dispose();
});

test("PXD-15 session: setFollowColumns flips columns for a journals source only", async () => {
  const f = mount();
  assert.equal(await f.session.setFollowColumns(true), true);
  assert.equal(f.session.followState().pointer.columns, true);
  assert.equal(await f.session.setFollowColumns(false), true);
  assert.equal(f.session.followState().pointer.columns, undefined);
  assert.equal(await f.session.followSource({ kind: "journals", uid: "week", columns: true }), true);
  assert.deepEqual(f.session.followState().pointer, { kind: "journals", uid: "week", columns: true, skip: [] });
  assert.equal(await f.session.followSource({ kind: "block", uid: "SRC" }), true);
  assert.equal(await f.session.setFollowColumns(true), false, "not a journals source");
  f.tray.dispose();
});

// ---------------------------------------------------------------- 5. cap

test("PXD-15 cap: 25 blocks give 20 items, 5 omitted and kept as members; a card from past the cap is never marked left; the tray says so", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ uid: `k${String(i + 1).padStart(2, "0")}`, string: `block ${i + 1}` }));
  const f = mount({
    pointer: { kind: "journals", uid: "days-7", columns: true },
    seed: (fake) => fake.seedPage({ title: dailyTitle(day(27)), uid: dailyUid(day(27)), children: many }),
    children: [{ uid: "c23", string: "((k23))", props: { plexus: { x: 0, y: 0, w: 200, h: 100, src: "journals:days-7", day: "10-27-2026" } } }],
  });
  const kind = followKind("journals");
  const res = await kind.read({ kind: "journals", uid: "days-7", columns: true }, { host: f.host, now: () => at(2026, 10, 27) });
  assert.equal(res.complete, true);
  assert.equal(res.items.filter((i) => i.kind === "block").length, JOURNAL_DAY_CAP);
  assert.deepEqual(res.omitted, [{ day: "10-27-2026", title: dailyTitle(day(27)), n: 5 }]);
  assert.deepEqual(res.members, ["k21", "k22", "k23", "k24", "k25"]);
  await f.timers.run();
  f.tray.open();
  await read(f, 3);
  assert.deepEqual(f.tray.left(), [], "the card for block 23 is still in the source");
  const notes = f.root.querySelectorAll(".pxd-follow__note").map((n) => n.textContent);
  assert.deepEqual(notes, [`At most ${JOURNAL_DAY_CAP} blocks per day: 5 left out of ${dailyTitle(day(27))}.`]);
  f.tray.dispose();
});

test("PXD-15 cap: blank blocks are flagged and do not count toward the cap", async () => {
  const kids = [...Array.from({ length: 3 }, (_, i) => ({ uid: `e${i}`, string: "" })), ...Array.from({ length: JOURNAL_DAY_CAP }, (_, i) => ({ uid: `n${i}`, string: `text ${i}` }))];
  const f = mount({ seed: (fake) => fake.seedPage({ title: dailyTitle(day(27)), uid: dailyUid(day(27)), children: kids }) });
  const res = await followKind("journals").read({ kind: "journals", uid: "days-7", columns: true }, { host: f.host, now: () => at(2026, 10, 27) });
  assert.equal(res.omitted, undefined);
  assert.equal(res.items.filter((i) => i.blank).length, 3);
  assert.equal(res.items.filter((i) => i.kind === "block" && !i.blank).length, JOURNAL_DAY_CAP);
});

test("PXD-15 cap: a day with JOURNAL_PULL_LIMIT children makes the read partial", async () => {
  const kids = Array.from({ length: JOURNAL_PULL_LIMIT }, (_, i) => ({ uid: `z${i}`, string: `b${i}` }));
  const f = mount({ seed: (fake) => fake.seedPage({ title: dailyTitle(day(27)), uid: dailyUid(day(27)), children: kids }) });
  const res = await followKind("journals").read({ kind: "journals", uid: "days-7" }, { host: f.host, now: () => at(2026, 10, 27) });
  assert.equal(res.ok, true);
  assert.equal(res.complete, false);
  assert.equal(res.items.length, 1, "the page card is still offered");
});

// ---------------------------------------------------------------- 6. menu

test("PXD-15 menu: Follow… lists Journals…; following journals shows One column per day with its checked state", async () => {
  const off = flattenMenu(buildMenu("board-menu", { follow: { following: false } })).map((m) => m.id);
  assert.ok(off.includes("follow:pick-journals"));
  assert.ok(off.indexOf("follow:pick-journals") > off.indexOf("follow:pick-refs"));
  const f = mount();
  assert.equal(f.tray.menuState().columns, false);
  const plain = flattenMenu(buildMenu("board-menu", { follow: f.tray.menuState() }));
  const item = (list, id) => list.find((m) => m.id === id);
  assert.ok(item(plain, "follow:columns"));
  assert.ok(item(plain, "follow:pick-journals").label.startsWith("Switch to journals"));
  assert.ok(!item(plain, "follow:tree"));
  assert.ok(!item(plain, "follow:columns").checked);
  assert.equal(item(plain, "follow:label").label, "Journals, last 7 days");
  await f.session.setFollowColumns(true);
  await flush();
  assert.equal(f.tray.menuState().columns, true);
  const cols = flattenMenu(buildMenu("board-menu", { follow: f.tray.menuState() }));
  assert.equal(item(cols, "follow:columns").checked, true);
  assert.equal(item(cols, "follow:label").label, "Journals, last 7 days, one column per day");
  await f.session.followSource({ kind: "journals", uid: "week" });
  await flush();
  assert.equal(item(flattenMenu(buildMenu("board-menu", { follow: f.tray.menuState() })), "follow:label").label, "Journals, this week");
  f.tray.dispose();
});

test("PXD-15 picker: initial shows the rows before any typing; without it nothing is searched until there is text", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const { openPagePicker } = await import("../src/view/board-picker.js");
    const rows = () => [...stub.document.querySelectorAll(".pxd-addboard__row")].map((r) => r.getAttribute("data-value"));
    const search = () => [{ title: "Last 7 days", value: "days-7" }, { title: "This week", value: "week" }];
    const a = openPagePicker({ doc: stub.document, search, initial: true });
    await flush();
    assert.deepEqual(rows(), ["days-7", "week"]);
    a.close();
    const b = openPagePicker({ doc: stub.document, search });
    await flush();
    assert.deepEqual(rows(), []);
    b.close();
  } finally { restore(); }
});
