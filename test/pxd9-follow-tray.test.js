// PXD-9 tray: reads at idle, never writes by itself, places on request, marks cards that left after two reads.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-follow.js";
import { createFollowTray } from "../src/view/follow-tray.js";
import { defineFollowKind } from "../src/host/follow-sources.js";
import { FOLLOW_MIME, FOLLOW_POLL_MS, FOLLOW_QUIET_MS } from "../src/model/follow.js";
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

function mount({ plexus = { v: 2, follow: { kind: "block", uid: "SRC" } }, children, since = null, storage } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Src page", uid: "SRCPAGE", children: [
    { uid: "SRC", string: "Source block", children: [{ uid: "k1", string: "one" }, { uid: "k2", string: "two" }, { uid: "k3", string: "three" }] },
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
  const timers = manualTimers();
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
  });
  return { fake, host, session, root, timers, tray, lefts, placed, toasts };
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
  assert.deepEqual(JSON.parse(drag[FOLLOW_MIME]), { uid: "k2", kind: "block" });
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
  await f.session.stopFollowing();
  assert.equal(f.root.querySelector(".pxd-follow"), null);
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
