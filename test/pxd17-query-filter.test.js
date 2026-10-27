import assert from "node:assert/strict";
import test from "node:test";

import { filterBright, filterLabel, filterQueryUid, filterTargets, intersectBright } from "../src/model/query-filter.js";
import { FILTER_POLL_MS, createQueryFilter } from "../src/view/query-filter.js";
import { buildMenu } from "../src/view/menu-model.js";

// ---------------------------------------------------------------- matching

const items = [
  { uid: "qcard0001", type: "card", kind: "note", string: "{{query: [[Alpha]]}}" },
  { uid: "note00001", type: "card", kind: "note", string: "about [[Alpha]]" },
  { uid: "ref000001", type: "card", kind: "block", string: "((blkAAAAA))", target: { kind: "block", uid: "blkAAAAA1" } },
  { uid: "ref000002", type: "card", kind: "block", string: "((blkBBBBB))", target: { kind: "block", uid: "blkBBBBB1" } },
  { uid: "page00001", type: "card", kind: "page", string: "[[Beta]]", target: { kind: "page", title: "Beta" } },
  { uid: "sect00001", type: "section", string: "Group" },
];
const pageUid = (title) => ({ Beta: "pageBETA1" })[title] || null;

test("PXD-17: a card matches by its own block, the block it points at, or its page", () => {
  assert.deepEqual(filterTargets(items[1]), ["note00001"]);
  assert.deepEqual(filterTargets(items[2]), ["ref000001", "blkAAAAA1"]);
  assert.deepEqual(filterTargets(items[4], pageUid), ["page00001", "pageBETA1"]);
  assert.deepEqual(filterTargets(items[5]), []);
  const bright = filterBright(items, new Set(["note00001", "blkAAAAA1", "pageBETA1", "elsewhere"]), "qcard0001", pageUid);
  assert.deepEqual([...bright].sort(), ["note00001", "page00001", "qcard0001", "ref000001"]);
});

test("PXD-17: the filtering card stays bright, sections and misses dim", () => {
  const bright = filterBright(items, new Set(), "qcard0001", pageUid);
  assert.deepEqual([...bright], ["qcard0001"]);
  assert.equal(bright.has("sect00001"), false);
});

test("PXD-17: the query uid is the card's own query block or the query a ref card points at", () => {
  const strings = { blkQQQQQ1: "{{[[query]]: {and: [[A]] [[B]]}}}", blkAAAAA1: "plain" };
  const bs = (uid) => strings[uid] ?? null;
  assert.equal(filterQueryUid(items[0], bs), "qcard0001");
  assert.equal(filterQueryUid({ uid: "r1", type: "card", target: { kind: "block", uid: "blkQQQQQ1" } }, bs), "blkQQQQQ1");
  assert.equal(filterQueryUid(items[2], bs), null);
  assert.equal(filterQueryUid(items[5], bs), null);
});

test("PXD-17: a tag lens and the filter keep only the overlap", () => {
  assert.deepEqual([...intersectBright(new Set(["a", "b"]), new Set(["b", "c"]))], ["b"]);
  assert.deepEqual([...intersectBright(null, new Set(["c"]))], ["c"]);
  assert.equal(intersectBright(null, null), null);
});

test("PXD-17: the pill names the query and counts matches", () => {
  assert.equal(filterLabel("Open tasks", 1), "Filter: Open tasks · 1 match");
  assert.equal(filterLabel("", 3, { partial: true }), "Filter: Query · 3 matches · partial");
  assert.equal(filterLabel("X", 0, { waiting: true }), "Filter: X · running…");
});

test("PXD-17: the card menu offers Use as filter, then Stop filtering; the board menu can stop it", () => {
  const ids = (rows) => rows.flatMap((r) => [r, ...(r.children || [])]).map((r) => r.id);
  const label = (rows, id) => rows.find((r) => r.id === id)?.label;
  const off = buildMenu("card", { isQuery: true, filtering: false });
  assert.equal(label(off, "query-filter"), "Use as filter");
  const on = buildMenu("card", { isQuery: true, filtering: true });
  assert.equal(label(on, "query-filter"), "Stop filtering");
  assert.equal(ids(buildMenu("card", { isQuery: false })).includes("query-filter"), false);
  assert.equal(ids(buildMenu("board-menu", { filtering: true })).includes("query-filter-stop"), true);
  assert.equal(ids(buildMenu("board-menu", { filtering: false })).includes("query-filter-stop"), false);
});

// ---------------------------------------------------------------- controller

function fakeTimers() {
  let id = 0;
  const due = new Map();
  return {
    later: (fn, ms = 0) => { id += 1; due.set(id, { fn, ms }); return id; },
    cancel: (k) => due.delete(k),
    // Run everything queued, including what those callbacks queue, then let promises settle.
    async flush(rounds = 20) {
      for (let i = 0; i < rounds; i += 1) {
        const list = [...due.entries()];
        due.clear();
        for (const [, t] of list) t.fn();
        await new Promise((r) => setImmediate(r));
        if (!due.size) { await new Promise((r) => setImmediate(r)); if (!due.size) return; }
      }
    },
  };
}

function fakeDoc() {
  const listeners = new Map();
  const win = { setTimeout: () => 0, clearTimeout: () => {}, MutationObserver: FakeMO };
  return {
    defaultView: win,
    activeElement: null,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    querySelector: () => null,
    fire: (type, target) => listeners.get(type)?.({ type, target }),
  };
}

const observers = [];
class FakeMO {
  constructor(cb) { this.cb = cb; this.node = null; observers.push(this); }
  observe(node) { this.node = node; }
  disconnect() { this.node = null; }
}

function fakeLive(ids) {
  const node = {
    ids,
    isConnected: true,
    querySelectorAll: (sel) => (sel === "[id]" ? node.ids.map((id) => ({ id })) : []),
    querySelector: () => null,
  };
  return node;
}

test("PXD-17: a translated query runs through query-run and runs again after a save or a query edit", async () => {
  const timers = fakeTimers();
  const doc = fakeDoc();
  const hits = { Alpha: ["note00001", "blkAAAAA1"] };
  let reads = 0;
  const backend = { hits: (leaf) => { reads += 1; return { uids: hits[leaf.title] || [], partial: false }; } };
  const watches = [];
  const host = {
    blockString: () => "{{query: \"Alpha things\" [[Alpha]]}}",
    pullTree: () => [{ uid: "kid000001", children: [] }],
    watchBlock: (uid, cb) => { watches.push(cb); return () => {}; },
  };
  const seen = [];
  const f = createQueryFilter({ host, doc, backend, later: timers.later, cancel: timers.cancel, onResults: (r) => seen.push(r) });
  assert.equal(f.start({ queryUid: "qcard0001", cardUid: "qcard0001" }), true);
  await timers.flush();
  assert.equal(seen.length, 1);
  assert.deepEqual([...seen[0].uids].sort(), ["blkAAAAA1", "note00001"]);
  assert.equal(seen[0].mode, "run");
  assert.equal(f.active().title, "Alpha things");

  // A new result appears and a block editor in this window saves.
  hits.Alpha.push("blkBBBBB1");
  doc.fire("focusout", { tagName: "TEXTAREA", classList: { contains: () => true } });
  await timers.flush();
  assert.equal(seen.length, 2);
  assert.equal(seen[1].uids.has("blkBBBBB1"), true);

  // The query block itself is edited.
  hits.Alpha = ["note00001"];
  watches[0]();
  await timers.flush();
  assert.deepEqual([...seen.at(-1).uids], ["note00001"]);
  assert.ok(reads >= 3);

  // Stop: one null, and no more reads on saves.
  f.stop();
  assert.equal(seen.at(-1), null);
  const before = reads;
  doc.fire("focusout", { tagName: "TEXTAREA", classList: { contains: () => true } });
  await timers.flush();
  assert.equal(reads, before);
  assert.equal(f.active(), null);
});

test("PXD-17: the query block and what sits under it are never matches", async () => {
  const timers = fakeTimers();
  const backend = { hits: () => ({ uids: ["qcard0001", "kid000001", "note00001"], partial: false }) };
  const host = { blockString: () => "{{query: [[Alpha]]}}", pullTree: () => [{ uid: "kid000001" }] };
  const seen = [];
  const f = createQueryFilter({ host, doc: fakeDoc(), backend, later: timers.later, cancel: timers.cancel, onResults: (r) => seen.push(r) });
  f.start({ queryUid: "qcard0001", cardUid: "qcard0001" });
  await timers.flush();
  assert.deepEqual([...seen[0].uids], ["note00001"]);
  f.stop();
});

test("PXD-17: a query Plexus cannot translate reads Roam's render and follows its changes", async () => {
  const timers = fakeTimers();
  observers.length = 0;
  const live = fakeLive(["block-input-x-body-outline-PAGEUID01-note00001"]);
  let mounted = null;
  const host = { blockString: () => "{{query: {and: [[A]] {or: [[B]] {not: [[C]]}}}}}" };
  const seen = [];
  const f = createQueryFilter({ host, doc: fakeDoc(), later: timers.later, cancel: timers.cancel, liveNode: () => mounted, onResults: (r) => seen.push(r) });
  f.start({ queryUid: "qcard0001", cardUid: "card00001" });
  // Not mounted yet: waiting, nothing dimmed.
  assert.equal(seen[0].status, "waiting");
  assert.equal(seen[0].uids, null);
  assert.equal(f.active().mode, "dom");
  mounted = live;
  await timers.flush(1);
  assert.deepEqual([...seen.at(-1).uids], ["note00001"]);
  assert.equal(seen.at(-1).mode, "dom");

  // Roam re-renders the result list: the observer hears it and the set follows.
  live.ids = ["block-input-x-body-outline-PAGEUID01-note00001", "roam-query-qcard0001-blkBBBBB1"];
  const mo = observers.find((o) => o.node === live);
  assert.ok(mo);
  mo.cb([]);
  await timers.flush();
  assert.deepEqual([...seen.at(-1).uids].sort(), ["blkBBBBB1", "note00001"]);

  // Unmounted (off screen): the last set stays.
  mounted = null;
  const count = seen.length;
  f.poke();
  await timers.flush(2);
  assert.equal(seen.length, count);
  f.stop();
  assert.equal(mo.node, null);
});

test("PXD-17: starting a second filter stops the first", async () => {
  const timers = fakeTimers();
  const backend = { hits: () => ({ uids: ["note00001"], partial: false }) };
  const host = { blockString: () => "{{query: [[Alpha]]}}" };
  const seen = [];
  const f = createQueryFilter({ host, doc: fakeDoc(), backend, later: timers.later, cancel: timers.cancel, onResults: (r) => seen.push(r) });
  f.start({ queryUid: "qcard0001", cardUid: "qcard0001" });
  f.start({ queryUid: "qcard0002", cardUid: "qcard0002" });
  await timers.flush();
  assert.equal(seen[0], null);
  assert.equal(seen.filter(Boolean).every((r) => r.cardUid === "qcard0002"), true);
  assert.equal(f.active().cardUid, "qcard0002");
  f.stop();
});

test("PXD-17: a fallback card that mounts late (zoomed in after a while) is still read", async () => {
  const timers = fakeTimers();
  const live = fakeLive(["roam-query-qcard0001-note00001"]);
  let mounted = null;
  const seen = [];
  const f = createQueryFilter({ host: { blockString: () => "{{query: {search: alpha}}}" }, doc: fakeDoc(), later: timers.later, cancel: timers.cancel, liveNode: () => mounted, onResults: (r) => seen.push(r) });
  f.start({ queryUid: "qcard0001", cardUid: "card00001" });
  await timers.flush(20);
  assert.equal(seen.length, 1);
  mounted = live;
  await timers.flush(1);
  assert.deepEqual([...seen.at(-1).uids], ["note00001"]);
  f.stop();
});

test("PXD-17: an edit moves the filter between Roam's render and query-run, both ways", async () => {
  const timers = fakeTimers();
  observers.length = 0;
  let text = "{{query: {and: [[A]] {or: [[B]] {not: [[C]]}}}}}";
  let runs = 0;
  const backend = { hits: () => { runs += 1; return { uids: ["blkAAAAA1"], partial: false }; } };
  const watches = [];
  const host = { blockString: () => text, watchBlock: (uid, cb) => { watches.push(cb); return () => {}; } };
  const live = fakeLive(["roam-query-qcard0001-note00001"]);
  let mounted = live;
  const seen = [];
  const f = createQueryFilter({ host, doc: fakeDoc(), backend, later: timers.later, cancel: timers.cancel, liveNode: () => mounted, onResults: (r) => seen.push(r) });
  f.start({ queryUid: "qcard0001", cardUid: "card00001" });
  assert.equal(f.active().mode, "dom");
  assert.deepEqual([...seen.at(-1).uids], ["note00001"]);

  // Edited into a query Plexus runs: the card now shows Plexus' list, Roam's render is gone.
  text = "{{query: [[Alpha]]}}";
  mounted = null;
  watches[0]();
  await timers.flush(3);
  assert.equal(f.active().mode, "run");
  assert.ok(runs >= 1);
  assert.deepEqual([...seen.at(-1).uids], ["blkAAAAA1"]);
  assert.equal(seen.at(-1).mode, "run");
  assert.equal(observers.every((o) => o.node === null), true);

  // And back: Roam renders again and the filter reads it.
  text = "{{query: {search: alpha}}}";
  mounted = live;
  live.ids = ["roam-query-qcard0001-blkBBBBB1"];
  watches[0]();
  await timers.flush(3);
  assert.equal(f.active().mode, "dom");
  assert.deepEqual([...seen.at(-1).uids], ["blkBBBBB1"]);

  // And forward again.
  text = "{{query: [[Alpha]]}}";
  mounted = null;
  const before = runs;
  watches[0]();
  await timers.flush(3);
  assert.equal(f.active().mode, "run");
  assert.ok(runs > before);
  assert.deepEqual([...seen.at(-1).uids], ["blkAAAAA1"]);
  f.stop();
});

test("PXD-17: a run-mode filter polls slowly for changes from elsewhere and repaints only when they differ", async () => {
  const due = [];
  const later = (fn, ms) => { due.push({ fn, ms }); return due.length; };
  const hits = ["note00001"];
  const backend = { hits: () => ({ uids: [...hits], partial: false }) };
  const seen = [];
  const f = createQueryFilter({ host: { blockString: () => "{{query: [[Alpha]]}}" }, doc: fakeDoc(), backend, later, cancel: () => {}, onResults: (r) => seen.push(r) });
  f.start({ queryUid: "qcard0001", cardUid: "qcard0001" });
  const tick = async () => {
    for (let i = 0; i < 20; i += 1) {
      const t = due.findIndex((d) => d.ms === 0);
      if (t >= 0) { due.splice(t, 1)[0].fn(); } else await new Promise((r) => setImmediate(r));
    }
  };
  await tick();
  assert.equal(seen.length, 1);
  const poll = () => { const i = due.findIndex((d) => d.ms === FILTER_POLL_MS); assert.ok(i >= 0, "poll queued"); due.splice(i, 1)[0].fn(); };
  // Same results: no repaint.
  poll();
  await tick();
  assert.equal(seen.length, 1);
  // Another window tagged a block: the next poll picks it up.
  hits.push("blkBBBBB1");
  poll();
  await tick();
  assert.equal(seen.length, 2);
  assert.equal(seen[1].uids.has("blkBBBBB1"), true);
  f.stop();
});
