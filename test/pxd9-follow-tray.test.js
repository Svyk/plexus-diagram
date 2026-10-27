// PXD-9 tray: reads at idle, never writes by itself, places on request, marks cards that left after two reads.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-follow.js";
import { createFollowTray } from "../src/view/follow-tray.js";
import { defineFollowKind, followKind } from "../src/host/follow-sources.js";
import { BLUR_IDLE_MS, BUSY_IDLE_MS, EDIT_IDLE_MS, SAVE_LAG_MS, editState, watchEditing, watchLocalSaves } from "../src/host/local-saves.js";
import { FOLLOW_MIME, FOLLOW_POLL_MS, FOLLOW_QUIET_MS, FOLLOW_SLOW_MS, FOLLOW_TREE_DEPTH, FOLLOW_TYPING_MS, followQuietMs } from "../src/model/follow.js";
import { SPREAD_CAP } from "../src/session-clip.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

afterEach(() => resetSessions());

const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const card = (uid, string, x, y, extra = {}) => ({ uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } } });

function manualTimers() {
  const later = [];
  const idle = [];
  const timers = {
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
  return timers;
}

// F10: Roam's sync dot, and the observers the browser would give the tray (the stub has neither).
function liveDom(dom) {
  const win = dom.document.defaultView;
  const mos = [];
  const ios = [];
  win.MutationObserver = class {
    constructor(cb) { this.cb = cb; this.on = false; mos.push(this); }
    observe(target, opts) { this.on = true; this.target = target; this.opts = opts; }
    disconnect() { this.on = false; }
  };
  win.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.on = false; ios.push(this); }
    observe(target) { this.on = true; this.target = target; }
    disconnect() { this.on = false; }
  };
  const box = dom.document.createElement("div");
  box.className = "rm-sync";
  const icon = dom.document.createElement("div");
  icon.className = "rm-sync__icon rm-sync--synced";
  box.append(icon);
  dom.document.body.append(box);
  const flip = (next) => {
    const old = icon.className;
    icon.className = next;
    for (const mo of mos) if (mo.on) mo.cb([{ type: "attributes", target: icon, attributeName: "class", oldValue: old }]);
  };
  return {
    mos,
    ios,
    observing: () => mos.filter((mo) => mo.on).length,
    // One write in this window: the dot says saving, then synced.
    save() { flip("rm-sync__icon rm-sync--saving-remote"); flip("rm-sync__icon rm-sync--synced"); },
    show(on) { for (const io of ios) if (io.on) io.cb([{ isIntersecting: on, target: io.target }]); },
  };
}

// roamWatch: the fake fires a pull watch only when its pull result changes, as Roam does.
// clock: the tray's own clock (a read's length sets the next quiet period); it only moves when a test moves it.
function mount({ plexus = { v: 2, follow: { kind: "block", uid: "SRC" } }, children, since = null, storage, roamWatch = false, srcKids, live = false, clock = { t: 0 } } = {}) {
  const fake = createFakeRoam();
  fake.roamWatch = roamWatch;
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Src page", uid: "SRCPAGE", children: [
    { uid: "SRC", string: "Source block", children: srcKids ?? [{ uid: "k1", string: "one" }, { uid: "k2", string: "two" }, { uid: "k3", string: "three" }] },
    { uid: "ELSE", string: "Somewhere else" },
  ] });
  fake.seedBoard({ uid: "b1", props: { plexus }, children: children ?? [
    card("n1", "Note one", 0, 0, { color: "teal" }),
    card("c1", "((k1))", 0, 200, { src: "block:SRC" }),
  ] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const liveBits = live ? liveDom(dom) : null;
  const timers = manualTimers();
  // Listeners on the document and the window: the ones that outlive the board's own elements.
  const globalListeners = () => [...dom.listeners].filter((e) => e.target === dom.document || e.target === dom.document.defaultView).length;
  const baseline = globalListeners();
  const lefts = [];
  const placed = [];
  const toasts = [];
  const tray = createFollowTray({
    doc: dom.document,
    root,
    host,
    session,
    timers,
    board: () => session.board,
    since,
    storage: storage || fake.storage,
    graph: "g",
    onLeft: (set) => lefts.push([...set]),
    onPlaced: (uids) => placed.push(uids),
    toast: (m) => toasts.push(m),
    now: () => clock.t,
  });
  return { fake, host, session, dom, root, timers, tray, lefts, placed, toasts, live: liveBits, clock, listeners: () => globalListeners() - baseline };
}

test("PXD-9 tray: opening a followed board reads at idle after the quiet time and writes nothing", async () => {
  const f = mount();
  assert.equal(f.tray.reads(), 0, "no read before the board settles");
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (0)");
  await f.timers.run();
  assert.equal(f.tray.reads(), 1);
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (2)");
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k2", "k3"]);
  assert.equal(f.timers.pending(FOLLOW_POLL_MS), 1, "a slow poll is armed");
  await f.fake.flush();
  assert.deepEqual(f.fake.writesLog(), [], "open and read write nothing");
  f.tray.dispose();
});

test("PXD-9 tray: Place all writes ref cards and empties the tray; a board change sorts again without a read", async () => {
  const f = mount();
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  const rows = f.root.querySelectorAll(".pxd-follow__row");
  assert.deepEqual(rows.map((r) => r.dataset.uid), ["k2", "k3"]);
  const drag = {};
  rows[0].dispatchEvent({ type: "dragstart", stopPropagation() {}, dataTransfer: { setData: (k, v) => { drag[k] = v; } } });
  assert.deepEqual(JSON.parse(drag[FOLLOW_MIME]), { uid: "k2", kind: "block", board: "b1", src: "block:SRC" }, "the row names its board and source");
  assert.equal(drag["application/x-plexus-card"], "((k2))");
  const reads = f.tray.reads();
  f.root.querySelector(".pxd-follow__all").click();
  await flush();
  await f.fake.flush();
  assert.equal(f.placed.length, 1);
  assert.equal(f.placed[0].length, 2);
  assert.deepEqual(f.fake.writesLog().map((w) => w[0]), ["create", "create"]);
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (0)");
  assert.equal(f.tray.reads(), reads, "placing sorts the last read again; it does not read the source");
  assert.equal(f.root.querySelector(".pxd-follow__empty").textContent, "Everything in the source is on the board.");
  f.tray.dispose();
});

test("PXD-9 tray: a child moved out of the source marks its card after two reads; the card stays and keeps its place", async () => {
  const f = mount();
  await f.timers.run();
  const before = f.fake.props("c1").plexus;
  await f.fake.api.data.block.move({ location: { "parent-uid": "ELSE", order: "last" }, block: { uid: "k1" } });
  await f.fake.flush();
  assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "the source watch schedules one read");
  await f.timers.run();
  assert.deepEqual(f.tray.left(), [], "one miss is not enough");
  assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "a confirming read is queued");
  await f.timers.run();
  assert.deepEqual(f.tray.left(), ["c1"]);
  assert.deepEqual(f.lefts.at(-1), ["c1"]);
  assert.ok(f.fake.has("c1"));
  assert.deepEqual(f.fake.props("c1").plexus, before);
  f.root.querySelector(".pxd-follow").click();
  assert.equal(f.root.querySelector(".pxd-follow__section").textContent, "Left the source (1)");
  assert.equal(f.root.querySelector(".pxd-follow__row--left .pxd-follow__text").textContent, "one", "a ref card is named by its block");
  f.root.querySelector(".pxd-follow__dismiss").click();
  await flush();
  assert.deepEqual(f.tray.left(), [], "dismissed: a plain card now");
  assert.deepEqual(f.lefts.at(-1), []);
  assert.equal(f.fake.props("c1").plexus.src, undefined);
  f.tray.dispose();
});

test("PXD-9 tray: Include the whole tree renames the source and reads again; grandchildren join the tray", async () => {
  const f = mount();
  await f.timers.run();
  await f.fake.api.data.block.create({ location: { "parent-uid": "k2", order: "last" }, block: { uid: "g1", string: "grandchild" } });
  await f.session.setFollowTree(true);
  assert.equal(f.tray.menuState().label, "Everything under “Source block”");
  assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1);
  await f.timers.run();
  assert.deepEqual(f.tray.rows().map((r) => `${r.uid}@${r.depth}`), ["k2@1", "g1@2", "k3@1"]);
  f.tray.dispose();
});

test("PXD-9 tray: with Roam's watch filtering a new child shows after the quiet time; an edit elsewhere reads nothing", async () => {
  const f = mount({ roamWatch: true });
  await f.timers.run();
  const reads = f.tray.reads();
  await f.fake.api.data.block.update({ block: { uid: "ELSE", string: "Somewhere else, edited" } });
  await f.fake.flush();
  assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "a block outside the source wakes nothing");
  await f.fake.api.data.block.create({ location: { "parent-uid": "SRC", order: "last" }, block: { uid: "k4", string: "four" } });
  await f.fake.flush();
  assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1);
  await f.timers.run();
  assert.equal(f.tray.reads(), reads + 1);
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k2", "k3", "k4"]);
  await f.fake.flush();
  assert.deepEqual(f.fake.writesLog().map((w) => w[0]), ["update", "create"], "only the test's own writes");
  f.tray.dispose();
});

test("PXD-9 tray: whole tree past the listed levels: a card placed from deep down is never marked left; one moved away is", async () => {
  let deep = null;
  for (let i = 10; i >= 1; i -= 1) deep = { uid: `L${String(i).padStart(2, "0")}`, string: `level ${i}`, children: deep ? [deep] : [] };
  const f = mount({
    plexus: { v: 2, follow: { kind: "block", uid: "SRC", tree: true } },
    srcKids: [deep, { uid: "k1", string: "one" }],
    children: [card("c10", "((L10))", 0, 0, { src: "block:SRC" }), card("c1", "((k1))", 0, 200, { src: "block:SRC" })],
  });
  await f.timers.run();
  f.tray.refresh();
  await f.timers.run();
  assert.ok(f.tray.reads() >= 2);
  assert.deepEqual(f.tray.left(), [], "L10 is below the listed levels but still under the source");
  assert.equal(f.tray.rows().length, FOLLOW_TREE_DEPTH, "levels 1 to 8 wait in the tray");
  f.root.querySelector(".pxd-follow").click();
  assert.equal(f.root.querySelector(".pxd-follow__note").textContent, `Blocks more than ${FOLLOW_TREE_DEPTH} levels down are not listed. Cards placed from there still count as in the source.`);
  await f.fake.api.data.block.move({ location: { "parent-uid": "ELSE", order: "last" }, block: { uid: "L10" } });
  await f.fake.flush();
  await f.timers.run();
  await f.timers.run();
  assert.deepEqual(f.tray.left(), ["c10"]);
  f.tray.dispose();
});

test("PXD-9 tray: Place all clicked twice places each item once; more than one batch says so in a toast", async () => {
  const srcKids = Array.from({ length: SPREAD_CAP + 3 }, (_, i) => ({ uid: `r${String(i).padStart(8, "0")}`, string: `row ${i}` }));
  const f = mount({ srcKids, children: [card("n1", "Note one", 0, 0)] });
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  f.root.querySelector(".pxd-follow__all").click();
  assert.equal(f.root.querySelector(".pxd-follow__all").disabled, true, "disabled while it writes");
  f.root.querySelector(".pxd-follow__all").click();
  await flush(20);
  await f.fake.flush();
  assert.equal(f.fake.writesLog().filter((w) => w[0] === "create").length, SPREAD_CAP + 3);
  assert.deepEqual(f.toasts, [`Placed ${SPREAD_CAP + 3} cards in 2 batches of up to ${SPREAD_CAP}. Each Cmd+Z takes back one batch.`]);
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (0)");
  f.tray.dispose();
});

test("PXD-9 tray: Don't bring back hides a row for good; deleting a followed card keeps it out", async () => {
  const f = mount();
  await f.timers.run();
  f.root.querySelector(".pxd-follow").click();
  f.root.querySelector(".pxd-follow__skip").click();
  await flush();
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k3"]);
  await f.session.deleteItems(["c1"]);
  await flush();
  assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k3"], "k1 does not come back after its card is deleted");
  assert.deepEqual(f.fake.props("b1").plexus.follow.skip, ["k2", "k1"]);
  f.tray.dispose();
});

test("PXD-9 tray: partial and failed reads never mark a card; the last good list stays", async () => {
  const results = [];
  const off = defineFollowKind({ id: "probe", title: "Probe", describe: () => "the probe", read: async () => results.shift() });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "probe", uid: "P" } }, children: [card("c1", "((k1))", 0, 0, { src: "probe:P" })] });
    const item = (uid) => ({ uid, kind: "block", text: uid, time: 1 });
    results.push({ ok: true, complete: true, items: [item("k1"), item("k2")] });
    await f.timers.run();
    assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k2"]);
    for (let i = 0; i < 4; i += 1) {
      results.push({ ok: true, complete: false, items: [item("k2")] });
      f.tray.refresh();
      await f.timers.run();
    }
    assert.deepEqual(f.tray.left(), [], "c1 was not read, so it is not gone");
    results.push({ ok: false, reason: "slow" });
    f.tray.refresh();
    await f.timers.run();
    assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k2"], "a failed read keeps the last list");
    f.tray.open();
    assert.equal(f.root.querySelector(".pxd-follow__note").textContent, "The query took too long to read.");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-9 tray: one miss, then partial reads: one confirming read, then no more reads until something asks", async () => {
  const results = [];
  const item = (uid) => ({ uid, kind: "block", text: uid, time: 1 });
  const off = defineFollowKind({ id: "probe-loop", title: "Probe", describe: () => "the probe", read: async () => results.shift() ?? { ok: true, complete: false, items: [item("k2")] } });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "probe-loop", uid: "P" } }, children: [card("c1", "((k1))", 0, 0, { src: "probe-loop:P" })] });
    results.push({ ok: true, complete: true, items: [item("k2")] });
    await f.timers.run();
    assert.equal(f.tray.reads(), 1);
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "k1 missed once in a complete read: one confirming read");
    await f.timers.run();
    assert.equal(f.tray.reads(), 2);
    for (let i = 0; i < 10; i += 1) await f.timers.run();
    assert.equal(f.tray.reads(), 2, "the partial confirming read asks for no more");
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0);
    assert.deepEqual(f.tray.left(), []);
    results.push({ ok: true, complete: true, items: [item("k2")] });
    f.tray.refresh();
    await f.timers.run();
    assert.deepEqual(f.tray.left(), ["c1"], "the next complete read settles it");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-9 tray: the headline counts what is new and what left since this device's last visit", async () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const results = [];
  const off = defineFollowKind({ id: "probe2", title: "Probe", describe: () => "the probe", read: async () => results.shift() });
  try {
    store.set("plexus-diagram:follow-left:g:b1", JSON.stringify(["c2"]));
    const f = mount({
      plexus: { v: 2, follow: { kind: "probe2", uid: "P" } },
      children: [card("c1", "((k1))", 0, 0, { src: "probe2:P" }), card("c2", "((k2))", 0, 200, { src: "probe2:P" })],
      since: 100,
      storage,
    });
    f.tray.dispose();
    assert.equal(store.get("plexus-diagram:follow-left:g:b1"), JSON.stringify(["c2"]), "closed before its first read: the memory stays");
    const item = (uid, time) => ({ uid, kind: "block", text: uid, time });
    results.push({ ok: true, complete: true, items: [item("k3", 50), item("k4", 150), item("k5", 200)] });
    results.push({ ok: true, complete: true, items: [item("k3", 50), item("k4", 150), item("k5", 200)] });
    const g = mount({
      plexus: { v: 2, follow: { kind: "probe2", uid: "P" } },
      children: [card("c1", "((k1))", 0, 0, { src: "probe2:P" }), card("c2", "((k2))", 0, 200, { src: "probe2:P" })],
      since: 100,
      storage,
    });
    await g.timers.run();
    await g.timers.run();
    g.tray.open();
    assert.equal(g.root.querySelector(".pxd-follow__since").textContent, "2 new, 1 left since your last visit");
    assert.equal(g.root.querySelectorAll(".pxd-follow__new").length, 2);
    g.tray.dispose();
    assert.deepEqual(JSON.parse(store.get("plexus-diagram:follow-left:g:b1")), ["c1", "c2"], "closing remembers what had left");
  } finally { off(); }
});

test("PXD-9 tray: Follow from the menu shows the tray; Stop removes the pill and keeps the cards", async () => {
  const f = mount({ plexus: { v: 2 } });
  assert.equal(f.root.querySelector(".pxd-follow"), null, "no pill without a source");
  assert.equal(f.listeners(), 0, "a board that follows nothing adds no listener and arms no poll");
  assert.equal(f.timers.pending(), 0);
  const menu = buildMenu("board-menu", { follow: f.tray.menuState() });
  const ids = flattenMenu(menu).map((m) => m.id);
  assert.ok(ids.includes("follow:pick-block") && ids.includes("follow:pick-query") && ids.includes("follow:pick-refs"));
  assert.ok(!ids.includes("follow:text"));
  await f.session.followSource({ kind: "block", uid: "SRC" });
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (0)");
  await f.timers.run();
  assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (2)");
  const on = flattenMenu(buildMenu("board-menu", { follow: f.tray.menuState() }));
  assert.deepEqual(on.filter((m) => m.id.startsWith("follow:")).map((m) => m.id), ["follow:label", "follow:show", "follow:tree", "follow:pick-block", "follow:pick-query", "follow:pick-refs", "follow:stop"]);
  assert.equal(on.find((m) => m.id === "follow:label").label, "Children of “Source block”");
  assert.ok(f.listeners() > 0, "following listens for the window coming back");
  await f.session.stopFollowing();
  assert.equal(f.root.querySelector(".pxd-follow"), null);
  assert.equal(f.listeners(), 0, "Stop takes the listeners away again");
  assert.ok(f.fake.has("c1"));
  f.tray.dispose();
});

test("PXD-9 menu: a lone ((uid)) in the board text is offered, and card items follow what the card shows", () => {
  const offered = flattenMenu(buildMenu("board-menu", { follow: { following: false, textUid: "abcdefghi" } })).map((m) => m.id);
  assert.equal(offered.filter((id) => id.startsWith("follow:"))[0], "follow:text");
  const cardIds = (follow) => flattenMenu(buildMenu("card", { follow })).map((m) => m.id).filter((id) => id.startsWith("follow"));
  assert.deepEqual(cardIds({ block: true, refs: true }), ["follow-card", "follow:this", "follow:this-refs"]);
  assert.deepEqual(cardIds({ query: true, refs: true }), ["follow-card", "follow:this-query", "follow:this-refs"]);
  assert.deepEqual(cardIds({ followed: true, left: true }), ["follow:dismiss", "follow:remove"]);
  assert.deepEqual(cardIds(null), []);
});

// ---- F10: query and linked-reference sources read again about 1.5 s after a save in this window ----

const liveItem = (uid) => ({ uid, kind: "block", text: uid, time: 1 });
// A kind that reads what the test says and listens the way linked references do.
function liveProbe(id, read) {
  return defineFollowKind({ id, title: "Probe", describe: () => "the probe", watch: followKind("refs").watch, read });
}

// A Roam block editor and a checkbox in a block, as the page has them.
function roamBlock(dom) {
  const block = dom.document.createElement("div");
  block.className = "roam-block";
  const editor = dom.document.createElement("textarea");
  editor.className = "rm-block-input rm-block__input";
  const box = dom.document.createElement("input");
  block.append(editor, box);
  dom.document.body.append(block);
  return { editor, box };
}

test("PXD-9 F10 save signal: typing (at once, and once more after Roam's write lag), leaving an editor, a checkbox, a drop and the sync dot; one set for every listener", () => {
  const dom = createDomStub();
  const live = liveDom(dom);
  const doc = dom.document;
  const { editor, box } = roamBlock(dom);
  const other = doc.createElement("textarea");
  doc.body.append(other);
  const base = dom.listenerCount();
  let a = 0;
  let b = 0;
  const offA = watchLocalSaves(doc, () => { a += 1; });
  const offB = watchLocalSaves(doc, () => { b += 1; });
  assert.equal(live.observing(), 1, "one observer on the dot for both listeners");
  assert.equal(live.mos[0].target.className, "rm-sync", "the dot's box: a dot drawn again inside it is still heard");
  assert.deepEqual(live.mos[0].opts, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });
  assert.equal(dom.listenerCount() - base, 4, "input, focusout, change and drop, once for both");
  editor.dispatchEvent({ type: "input" });
  assert.deepEqual([a, b], [1, 1], "a key is heard at once");
  editor.dispatchEvent({ type: "input" });
  assert.deepEqual([a, b], [2, 2]);
  assert.equal(dom.timers.size, 1, "one lag timer, moved by each key");
  assert.equal([...dom.timers][0].ms, SAVE_LAG_MS);
  dom.flushTimers();
  assert.deepEqual([a, b], [3, 3], "and once more after Roam's write lag");
  other.dispatchEvent({ type: "input" });
  other.dispatchEvent({ type: "focusout" });
  assert.deepEqual([a, b], [3, 3], "a textarea that is not a block editor says nothing");
  editor.dispatchEvent({ type: "focusout" });
  box.dispatchEvent({ type: "change" });
  doc.body.dispatchEvent({ type: "drop" });
  assert.deepEqual([a, b], [6, 6], "leaving the editor, a checkbox, a drop");
  live.save();
  assert.deepEqual([a, b], [8, 8], "the dot turning to saving, and back: the old value still says saving");
  live.mos[0].cb([{ type: "attributes", target: { className: "bp3-popover-open saving", classList: { contains: () => false } }, oldValue: "" }]);
  assert.deepEqual([a, b], [8, 8], "another element in the box says nothing");
  editor.dispatchEvent({ type: "input" });
  offA();
  assert.equal(live.observing(), 1, "one listener left: everything stays");
  offB();
  assert.equal(live.observing(), 0, "the last listener lets the dot go");
  assert.equal(dom.listenerCount() - base, 0, "and the document listeners");
  assert.equal(dom.timers.size, 0, "and the lag timer");
  const bare = createDomStub();
  let c = 0;
  const offC = watchLocalSaves(bare.document, () => { c += 1; });
  roamBlock(bare).editor.dispatchEvent({ type: "input" });
  assert.equal(c, 1, "no dot drawn yet: typing is still heard");
  offC();
});

test("PXD-9 F10 tray: a new linked reference saved in this window reaches the pill one quiet period later; one read per quiet period", async () => {
  const results = [{ ok: true, complete: true, items: [liveItem("k2")] }];
  let calls = 0;
  const off = liveProbe("live-refs", async () => { calls += 1; return results.shift() ?? { ok: true, complete: true, items: [liveItem("k2"), liveItem("k5")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "live-refs", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true });
    await f.timers.run();
    assert.equal(calls, 1);
    assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (1)");
    assert.equal(f.live.observing(), 1, "one observer on the sync dot");
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "nothing asks for a read");
    f.live.save();
    f.live.save();
    f.live.save();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "three saves join one quiet period");
    await f.timers.run();
    assert.equal(calls, 2, "one read at its end");
    assert.equal(f.root.querySelector(".pxd-follow").textContent, "Following (2)", "the new reference is in the pill");
    for (let i = 0; i < 5; i += 1) await f.timers.run();
    assert.equal(calls, 2, "a read saves nothing, so it wakes nothing");
    await f.fake.flush();
    assert.deepEqual(f.fake.writesLog(), [], "no writes");
    f.tray.dispose();
    assert.equal(f.live.observing(), 0, "dispose lets the dot go");
    assert.equal(f.listeners(), 0, "and the document listeners");
  } finally { off(); }
});

test("PXD-9 F10 tray: the query and linked-reference kinds read again after a save; a block source keeps its own watch", async () => {
  for (const [follow, observing] of [[{ kind: "query", uid: "SRC" }, 1], [{ kind: "refs", uid: "SRCPAGE" }, 1], [{ kind: "block", uid: "SRC" }, 0]]) {
    const f = mount({ plexus: { v: 2, follow }, children: [card("n1", "Note one", 0, 0)], live: true });
    await f.timers.run();
    const reads = f.tray.reads();
    assert.equal(f.live.observing(), observing, `${follow.kind}: listens to saves`);
    f.live.save();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), observing, `${follow.kind}: a save asks for a read`);
    await f.timers.run();
    assert.equal(f.tray.reads(), reads + observing);
    f.tray.dispose();
  }
});

test("PXD-9 F10 tray: no read while the board is off screen or the tab is hidden; one read when it shows again", async () => {
  let calls = 0;
  const off = liveProbe("live-shown", async () => { calls += 1; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "live-shown", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true });
    await f.timers.run();
    assert.equal(calls, 1);
    assert.equal(f.live.ios.filter((io) => io.on && io.target === f.root).length, 1, "the board root is watched for being on screen");
    f.live.show(false);
    f.live.save();
    f.live.save();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "off screen: the saves wait");
    await f.timers.run(FOLLOW_POLL_MS);
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "and so does the poll");
    assert.equal(calls, 1);
    f.live.show(true);
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "back on screen: one read for all of them");
    await f.timers.run();
    assert.equal(calls, 2);
    f.live.show(true);
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "showing again with nothing new reads nothing");
    f.live.save();
    f.live.show(false);
    await f.timers.run();
    assert.equal(calls, 2, "a quiet period that ends off screen reads nothing");
    f.live.show(true);
    await f.timers.run();
    assert.equal(calls, 3);
    f.dom.document.visibilityState = "hidden";
    f.live.save();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "a hidden tab: the save waits");
    f.dom.document.visibilityState = "visible";
    f.dom.document.dispatchEvent({ type: "visibilitychange" });
    await f.timers.run();
    assert.equal(calls, 4);
    f.tray.dispose();
    assert.equal(f.live.ios.filter((io) => io.on).length, 0);
  } finally { off(); }
});

test("PXD-9 F10 tray: a slow read stretches the quiet period to ten times its length; a fast one brings it back", async () => {
  assert.equal(followQuietMs(0), FOLLOW_QUIET_MS);
  assert.equal(followQuietMs(100), FOLLOW_QUIET_MS);
  assert.equal(followQuietMs(400), 4000);
  assert.equal(followQuietMs(20000), FOLLOW_POLL_MS, "never past the poll");
  const clock = { t: 0 };
  let cost = 400;
  let calls = 0;
  const off = liveProbe("live-slow", async () => { calls += 1; clock.t += cost; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "live-slow", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    await f.timers.run();
    assert.equal(calls, 1);
    f.live.save();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0);
    assert.equal(f.timers.pending(4000), 1, "the last read took 400 ms: the next waits 4 s");
    // PXD-20: past FOLLOW_SLOW_MS a read also waits for the edits to stop (the floor has its own test).
    f.dom.flushTimers();
    await f.timers.run(4000);
    assert.equal(calls, 2);
    cost = 5;
    f.live.save();
    assert.equal(f.timers.pending(4000), 1, "still 400 ms last time");
    f.dom.flushTimers();
    await f.timers.run(4000);
    assert.equal(calls, 3);
    f.live.save();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "a 5 ms read: back to 1.5 s");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-9 F10 tray: reads never overlap; saves during a read make one more read after it", async () => {
  const pending = [];
  let calls = 0;
  const off = liveProbe("live-overlap", () => { calls += 1; return new Promise((resolve) => pending.push(resolve)); });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "live-overlap", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true });
    await f.timers.run();
    assert.equal(calls, 1, "the first read is running");
    for (let i = 0; i < 3; i += 1) {
      f.live.save();
      await f.timers.run();
    }
    assert.equal(calls, 1, "no second read while the first runs");
    pending.shift()({ ok: true, complete: true, items: [liveItem("k2")] });
    await flush();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "the saves it missed: one more quiet period");
    await f.timers.run();
    assert.equal(calls, 2);
    pending.shift()({ ok: true, complete: true, items: [liveItem("k2")] });
    await flush();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "and then it rests");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-9 F10 tray: typing a reference reads a quiet period after the first key, and once more after Roam's write lag", async () => {
  let calls = 0;
  const off = liveProbe("live-typing", async () => { calls += 1; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "live-typing", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true });
    await f.timers.run();
    assert.equal(calls, 1);
    const { editor } = roamBlock(f.dom);
    for (let i = 0; i < 3; i += 1) editor.dispatchEvent({ type: "input" });
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "the first key starts the quiet period; the others join it");
    await f.timers.run();
    assert.equal(calls, 2);
    f.dom.flushTimers();
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "the last keys, written by Roam after that read: one more");
    await f.timers.run();
    assert.equal(calls, 3);
    for (let i = 0; i < 5; i += 1) await f.timers.run();
    assert.equal(calls, 3, "then it rests");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-9 F10 tray: a new source starts at the plain quiet period, whatever the old one cost or had armed", async () => {
  const clock = { t: 0 };
  const off = liveProbe("live-dear", async () => { clock.t += 2000; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "live-dear", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    await f.timers.run();
    f.live.save();
    assert.equal(f.timers.pending(20000), 1, "a 2 s read: the next waits 20 s");
    await f.session.followSource({ kind: "block", uid: "SRC" });
    assert.equal(f.timers.pending(20000), 0, "the old source's period is dropped");
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1);
    await f.timers.run();
    assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k1", "k2", "k3"], "the new source is read 1.5 s later");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-9 F10 tray: a source switched while a read runs is read as soon as that read ends", async () => {
  const pending = [];
  const off = liveProbe("live-switch", () => new Promise((resolve) => pending.push(resolve)));
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "live-switch", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true });
    await f.timers.run();
    assert.equal(pending.length, 1, "the probe's read is running");
    await f.session.followSource({ kind: "block", uid: "SRC" });
    await f.timers.run();
    assert.deepEqual(f.tray.rows(), [], "the block read waits for the running one");
    pending.shift()({ ok: true, complete: true, items: [liveItem("x9")] });
    await flush();
    assert.deepEqual(f.tray.rows(), [], "the old source's result is dropped");
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 1, "and the new source's read is asked for");
    await f.timers.run();
    assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k1", "k2", "k3"]);
    f.tray.dispose();
  } finally { off(); }
});

// PXD-20: the DOM stub's timers that have this delay, run once (the stub's flushTimers runs them all).
function runDom(dom, ms) {
  const due = [...dom.timers].filter((t) => t.ms === ms);
  for (const t of due) dom.timers.delete(t);
  for (const t of due) t.fn();
  return due.length;
}

test("PXD-20 edit state: typing while an editor has focus, busy on any save, idle after a pause or leaving the editors; Enter into the next block is still typing", () => {
  const dom = createDomStub();
  const live = liveDom(dom);
  const doc = dom.document;
  const { editor } = roamBlock(dom);
  const next = roamBlock(dom).editor;
  assert.deepEqual(editState(doc), { typing: false, busy: false }, "nobody watches: nothing is kept");
  let saves = 0;
  const offSaves = watchLocalSaves(doc, () => { saves += 1; });
  editor.focus();
  editor.dispatchEvent({ type: "input" });
  assert.equal(dom.timers.size, 1, "with no edit watcher a key arms only the lag timer");
  assert.deepEqual(editState(doc), { typing: false, busy: false });
  dom.flushTimers();
  let idle = 0;
  const whys = [];
  const offEdit = watchEditing(doc, (why) => { idle += 1; whys.push(why); });
  editor.dispatchEvent({ type: "input" });
  assert.deepEqual(editState(doc), { typing: true, busy: true }, "a key in a focused editor is typing");
  runDom(dom, SAVE_LAG_MS);
  assert.deepEqual(editState(doc), { typing: true, busy: true }, "the lag signal is not an edit of its own");
  editor.blur();
  assert.deepEqual(editState(doc), { typing: false, busy: true }, "no editor focused: not typing");
  editor.focus();
  assert.equal(runDom(dom, EDIT_IDLE_MS), 1, "the keys stop first");
  assert.deepEqual(editState(doc), { typing: false, busy: true }, "the save signals have a longer window");
  assert.equal(runDom(dom, BUSY_IDLE_MS), 1);
  assert.deepEqual(editState(doc), { typing: false, busy: false });
  assert.deepEqual(whys, ["typing", "busy"], "the watcher hears each go idle");
  idle = 0;
  editor.dispatchEvent({ type: "input" });
  editor.blur();
  editor.dispatchEvent({ type: "focusout" });
  next.focus();
  runDom(dom, BLUR_IDLE_MS);
  assert.equal(idle, 0, "Enter: the caret is in the next block, so editing goes on");
  assert.equal(editState(doc).typing, true);
  next.dispatchEvent({ type: "input" });
  next.blur();
  next.dispatchEvent({ type: "focusout" });
  runDom(dom, BLUR_IDLE_MS);
  assert.equal(idle, 1, "leaving the editors ends editing at once");
  assert.deepEqual(editState(doc), { typing: false, busy: false });
  live.save();
  assert.deepEqual(editState(doc), { typing: false, busy: true }, "a write that is not typing (the sync dot) is busy, not typing");
  assert.ok(saves > 0);
  offEdit();
  assert.deepEqual(editState(doc), { typing: false, busy: false });
  assert.equal(live.observing(), 1, "the save listener keeps the dot");
  offSaves();
  assert.equal(dom.timers.size, 0, "every timer goes with the last watcher");
  const base = createDomStub();
  const n = base.listenerCount();
  const offOnly = watchEditing(base.document, () => {});
  assert.equal(base.listenerCount() - n, 4, "editing alone: the document listeners");
  offOnly();
  assert.equal(base.listenerCount() - n, 0);
});

test("PXD-20 tray: a long-task read never starts while the user types; it runs once when typing pauses or the editor is left", async () => {
  const clock = { t: 0 };
  let calls = 0;
  let cost = 100;
  const off = liveProbe("pxd20-typing", async () => { calls += 1; clock.t += cost; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    assert.ok(cost >= FOLLOW_TYPING_MS && cost <= FOLLOW_SLOW_MS, "a read the floor does not cover");
    const f = mount({ plexus: { v: 2, follow: { kind: "pxd20-typing", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    const { editor } = roamBlock(f.dom);
    const next = roamBlock(f.dom).editor;
    editor.focus();
    editor.dispatchEvent({ type: "input" });
    await f.timers.run();
    assert.equal(calls, 0, "the first read's cost is not known: it waits for the typing to stop");
    assert.equal(f.tray.stats().held, true);
    for (let i = 0; i < 4; i += 1) editor.dispatchEvent({ type: "input" });
    assert.equal(f.timers.pending(FOLLOW_QUIET_MS), 0, "keys while a read is held start no quiet period");
    runDom(f.dom, SAVE_LAG_MS);
    await f.timers.run();
    assert.equal(calls, 0, "still typing");
    runDom(f.dom, EDIT_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 1, "a pause in the typing: one read");
    assert.equal(f.tray.stats().held, false);
    editor.dispatchEvent({ type: "input" });
    await f.timers.run();
    assert.equal(calls, 1, "a 100 ms read waits while the user types");
    editor.blur();
    editor.dispatchEvent({ type: "focusout" });
    runDom(f.dom, BLUR_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 2, "leaving the editor: it reads without waiting for the pause");
    editor.focus();
    editor.dispatchEvent({ type: "input" });
    await f.timers.run();
    editor.blur();
    editor.dispatchEvent({ type: "focusout" });
    next.focus();
    runDom(f.dom, BLUR_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 2, "Enter into the next block: still typing, still waiting");
    next.dispatchEvent({ type: "input" });
    runDom(f.dom, SAVE_LAG_MS);
    runDom(f.dom, EDIT_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 3);
    cost = 10;
    next.dispatchEvent({ type: "input" });
    runDom(f.dom, EDIT_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 4);
    next.dispatchEvent({ type: "input" });
    await f.timers.run();
    assert.equal(calls, 5, "a 10 ms read is no long task: it runs while the user types, as before");
    await f.fake.flush();
    assert.deepEqual(f.fake.writesLog(), [], "no writes");
    f.tray.dispose();
    assert.equal(f.listeners(), 0, "dispose lets the editing listeners go");
  } finally { off(); }
});

test("PXD-20 tray: a slow read runs at most once per poll period while edits go on, and once when they stop", async () => {
  const clock = { t: 0 };
  let calls = 0;
  const off = liveProbe("pxd20-floor", async () => { calls += 1; clock.t += 1200; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "pxd20-floor", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    await f.timers.run();
    assert.equal(calls, 1, "nobody edits: the first read runs");
    assert.ok(1200 > FOLLOW_SLOW_MS);
    f.live.save();
    await f.timers.run(12000);
    assert.equal(calls, 1, "a 1.2 s read and edits going on: no read 12 s later");
    const wait = FOLLOW_POLL_MS - 1200;
    assert.equal(f.timers.pending(wait), 1, "it waits for a poll period since the last read started");
    for (let i = 0; i < 5; i += 1) f.live.save();
    assert.equal(f.timers.pending(12000), 0, "more saves only join the held read");
    clock.t = FOLLOW_POLL_MS;
    await f.timers.run(wait);
    assert.equal(calls, 2, "a poll period later it reads, edits or not");
    f.live.save();
    await f.timers.run(12000);
    assert.equal(calls, 2, "and the next waits again");
    assert.equal(f.timers.pending(FOLLOW_POLL_MS - 1200), 1);
    runDom(f.dom, BUSY_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 3, "the edits stop: one read now");
    assert.equal(f.timers.pending(FOLLOW_POLL_MS - 1200), 0, "the floor's timer goes with it");
    runDom(f.dom, BUSY_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 3, "idle again with nothing owed reads nothing");
    f.live.save();
    await f.timers.run(12000);
    assert.equal(calls, 3);
    assert.equal(f.tray.stats().held, true);
    await f.session.followSource({ kind: "block", uid: "SRC" });
    assert.equal(f.tray.stats().held, false, "a new source is not held by the old one's cost");
    assert.equal(f.timers.pending(FOLLOW_POLL_MS - 1200), 0);
    await f.timers.run();
    assert.deepEqual(f.tray.rows().map((r) => r.uid), ["k1", "k2", "k3"], "the block source reads at once");
    const { editor } = roamBlock(f.dom);
    editor.focus();
    editor.dispatchEvent({ type: "input" });
    const before = f.tray.reads();
    f.tray.refresh();
    await f.timers.run();
    assert.equal(f.tray.reads(), before + 1, "a fast block read runs while the user types");
    f.tray.dispose();
    assert.equal(f.listeners(), 0);
    const g = mount({ plexus: { v: 2, follow: { kind: "pxd20-floor", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    await g.timers.run();
    g.live.save();
    await g.timers.run(12000);
    assert.equal(g.tray.stats().held, true);
    assert.equal(g.timers.pending(FOLLOW_POLL_MS - 1200), 1);
    g.tray.dispose();
    assert.equal(g.timers.pending(FOLLOW_POLL_MS - 1200), 0, "dispose drops the floor's timer");
  } finally { off(); }
});

test("PXD-20 tray: when typing stops, a quiet period stretched by a slow read ends at once; saves that stop on their own do not", async () => {
  const clock = { t: 0 };
  let calls = 0;
  const off = liveProbe("pxd20-cut", async () => { calls += 1; clock.t += 1200; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "pxd20-cut", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    await f.timers.run();
    assert.equal(calls, 1);
    f.live.save();
    assert.equal(f.timers.pending(12000), 1, "a 1.2 s read: a 12 s quiet period");
    runDom(f.dom, BUSY_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 1, "save signals that stop leave it running");
    assert.equal(f.timers.pending(12000), 1);
    const { editor } = roamBlock(f.dom);
    editor.focus();
    for (let i = 0; i < 3; i += 1) editor.dispatchEvent({ type: "input" });
    runDom(f.dom, SAVE_LAG_MS);
    f.live.save();
    assert.equal(runDom(f.dom, EDIT_IDLE_MS), 1);
    assert.equal(editState(f.dom.document).busy, true, "Roam's write of the keys: still busy");
    await f.timers.run();
    assert.equal(f.timers.pending(12000), 0, "the typing stops: the stretched period is gone");
    assert.equal(calls, 1, "but a pause is no idle: the floor holds while the saves go on");
    assert.equal(f.tray.stats().held, true);
    runDom(f.dom, BUSY_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 2, "the saves stop: one read now");
    runDom(f.dom, BUSY_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 2, "and nothing more");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-20 tray: typing in bursts with short pauses reads a slow source at most once per poll period, and once when the typing stops", async () => {
  const clock = { t: 0 };
  let calls = 0;
  const off = liveProbe("pxd20-burst", async () => { calls += 1; clock.t += 1400; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "pxd20-burst", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    await f.timers.run();
    assert.equal(calls, 1, "nobody edits: the first read runs");
    const { editor } = roamBlock(f.dom);
    editor.focus();
    // 5 s of keys, then a 2.5 s pause: the keys go idle 2 s into it, the saves (Roam's write of the keys) do not.
    const burst = async (k) => {
      for (let i = 0; i < 5; i += 1) editor.dispatchEvent({ type: "input" });
      runDom(f.dom, SAVE_LAG_MS);
      f.live.save();
      clock.t = 1400 + 7500 * k;
      assert.equal(runDom(f.dom, EDIT_IDLE_MS), 1);
      assert.equal(editState(f.dom.document).busy, true);
      await f.timers.run();
    };
    for (let k = 1; k <= 7; k += 1) await burst(k);
    assert.equal(calls, 1, "a pause in the typing is no idle: no read at each pause");
    assert.equal(f.tray.stats().held, true);
    assert.equal(f.timers.pending(60000 - 8900), 1, "the floor waits for a poll period since the last read started");
    await burst(8);
    assert.equal(calls, 2, "a poll period later: one read, at a pause");
    for (let k = 9; k <= 15; k += 1) await burst(k);
    assert.equal(calls, 2, "then none for another poll period");
    runDom(f.dom, BUSY_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 3, "the typing stops: one read");
    for (let i = 0; i < 5; i += 1) editor.dispatchEvent({ type: "input" });
    await f.timers.run();
    editor.blur();
    editor.dispatchEvent({ type: "focusout" });
    runDom(f.dom, BLUR_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 4, "leaving the editors is idle at once, floor or not");
    await f.fake.flush();
    assert.deepEqual(f.fake.writesLog(), [], "no writes");
    f.tray.dispose();
  } finally { off(); }
});

test("PXD-20 tray: a held read that comes due while the board is off screen reads once when it shows again", async () => {
  const clock = { t: 0 };
  let calls = 0;
  const off = liveProbe("pxd20-park", async () => { calls += 1; clock.t += 100; return { ok: true, complete: true, items: [liveItem("k2")] }; });
  try {
    const f = mount({ plexus: { v: 2, follow: { kind: "pxd20-park", uid: "P" } }, children: [card("n1", "Note one", 0, 0)], live: true, clock });
    await f.timers.run();
    assert.equal(calls, 1);
    const { editor } = roamBlock(f.dom);
    editor.focus();
    editor.dispatchEvent({ type: "input" });
    await f.timers.run();
    assert.equal(f.tray.stats().held, true, "held while the user types");
    f.live.show(false);
    runDom(f.dom, EDIT_IDLE_MS);
    await f.timers.run();
    assert.equal(calls, 1, "off screen: no read");
    assert.equal(f.tray.stats().held, false);
    assert.equal(f.tray.stats().stale, true, "it waits as a stale read");
    f.live.show(true);
    await f.timers.run();
    assert.equal(calls, 2, "back on screen: one read");
    f.tray.dispose();
  } finally { off(); }
});
