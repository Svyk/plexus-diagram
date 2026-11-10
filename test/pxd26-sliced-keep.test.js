// PXD-26: storing a big board's model after an edit (speed flag slicedKeep). The store job computes the board's badges
// and links in parts, drops its work when the page moved on, and a refresh read an edit interrupted is tried again
// later instead of one whole pull.
// The tests own the clock. Roam reads cost virtual time by what they ask for (per entity, from the live PhD main
// board), so a part's length is what it read: the one-task recompute is one part of seconds, the sliced one is not.
// PXD26_KEEP=off runs the budget test with the flag off, where it fails (the long part is there).
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { BOARD_PATTERN, createHost } from "../src/host/roam.js";
import { createModelStore, packDerived } from "../src/host/model-store.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { noteSpeedFlags } from "../src/settings.js";
import { bigBoardTree, treeBlockCount } from "../src/model/stress-board.js";
import { SPLIT_WATCH_MIN } from "../src/host/split-watch.js";
import { resetSharedBgBudget } from "../src/bg-budget.js";
import { resetSharedTaskProbe, sharedTaskProbe } from "../src/long-tasks.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { installOwnClock, tick, untilTurns } from "./fixtures/own-clock.js";

const BUDGET_MS = 50;
const UID = "bigroot";

let own = null;
beforeEach(() => {
  own = installOwnClock();
  resetSharedBgBudget();
  resetSharedTaskProbe();
});
afterEach(() => {
  resetSessions();
  resetSharedBgBudget();
  resetSharedTaskProbe();
  noteSpeedFlags(null);
  own?.restore();
  own = null;
});

// Every span of the store job and its refresh read, drained each turn (the probe keeps only the last 600).
function spanLog() {
  const probe = sharedTaskProbe();
  const log = [];
  const drain = () => {
    for (const s of probe.spans()) if (s.name === "bg:model-keep" || s.name === "bg:refresh") log.push({ name: s.name, ms: s.ms });
    probe.clear();
  };
  return { log, drain, max: (name) => log.filter((s) => s.name === name).reduce((m, s) => Math.max(m, s.ms), 0) };
}

const toSeed = (n) => ({ uid: n[":block/uid"], string: n[":block/string"], props: n[":block/props"] ? { plexus: n[":block/props"].plexus } : undefined, heading: n[":block/heading"], open: n[":block/open"], children: (n[":block/children"] || []).map(toSeed) });

// What a read costs on the live PhD main board, per entity: the level pull 250 blocks in ~20 ms, the field compare
// 250 in ~25 ms, the fold compare ~11k in ~58 ms, the stats pull 28k targets in ~2.2 s.
const COST = { level: 0.08, field: 0.1, open: 0.005, stats: 0.08, other: 0.02 };
function chargeReads(fake) {
  const data = fake.api.data;
  const many = data.pull_many.bind(data);
  const calls = { stats: [], n: 0 };
  data.pull_many = (pattern, entities) => {
    const p = String(pattern);
    calls.n += 1;
    if (p.includes(":block/_refs") && p.includes(":block/_parents")) {
      calls.stats.push(entities.length);
      own.advance(0.5 + COST.stats * entities.length);
      // Refs from outside the board: eid % 4 of them, so the badges are not all zero.
      return entities.map((eid) => ({ ":db/id": eid, ":block/_refs": Array.from({ length: Number(eid) % 4 }, (_, i) => ({ ":db/id": 9_000_000 + Number(eid) * 8 + i })) }));
    }
    const per = p.includes(":block/children") ? COST.level : p === "[:db/id :block/open]" ? COST.open : p.includes(":block/props") ? COST.field : COST.other;
    own.advance(per * entities.length);
    return many(pattern, entities);
  };
  return calls;
}

// Derived-link rows for every third card target, some of them attributes. The same rows whatever the group size.
function stubLinks(host) {
  const calls = [];
  let all = null;
  let at = null;
  host.linkRows = (boardEid, eids, targets) => {
    if (!all || all.length !== eids.size) { all = [...eids]; at = new Map(all.map((e, i) => [e, i])); }
    calls.push(targets.length);
    own.advance(0.5 + 0.25 * targets.length);
    const rows = [];
    for (const b of targets) {
      const i = at.get(b);
      if (i == null || i % 3 !== 0) continue;
      rows.push([all[(i * 7 + 3) % all.length], b, `src${b}`, i % 6 === 0 ? "Supports:: here" : "a mention", null]);
    }
    return rows;
  };
  return calls;
}

// Past SPLIT_WATCH_MIN blocks (a big board to the host), small enough that its derived data fits the stored cap.
const MID = { cards: 600, sections: 12, edges: 200, nested: 4, nestedCards: 40, nestedKids: 2, kids: 2 };

function setup(flags, shape) {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  fake.seedPage({ title: "Board page", uid: "bpage", children: [] });
  const tree = bigBoardTree(shape);
  const seed = toSeed(tree);
  fake.seedBoard({ uid: seed.uid, string: seed.string, props: seed.props, children: seed.children, parent: "bpage" });
  const reads = chargeReads(fake);
  if (flags) noteSpeedFlags(flags);
  const idb = createFakeIDB();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.blockPageUid = (u) => (String(u).length ? "bpage" : "");
  const store = createModelStore({ indexedDB: idb, graph: "g" });
  host.useModelStore(store);
  const links = stubLinks(host);
  const puts = [];
  const put = store.put.bind(store);
  store.put = (uid, stamp, model) => { puts.push(stamp); return put(uid, stamp, model); };
  const pageStamp = () => {
    const p = fake.api.data.pull("[:page/edit-time :page/edit-nonce]", [":block/uid", "bpage"]);
    return `${p?.[":page/edit-time"] ?? ""}|${p?.[":page/edit-nonce"] ?? ""}`;
  };
  return { fake, host, store, idb, reads, links, puts, pageStamp, blocks: treeBlockCount(tree) };
}

// The board read in one pull (the reader's fallback), in a pull log.
const wholePulls = (log) => log.filter((e) => !e.many && e.pattern === String(BOARD_PATTERN) && JSON.stringify(e.entity ?? "").includes(UID)).length;
const rowOf = (idb) => idb.dbs.get("plexus-diagram-snapshots")?.stores?.get("boards")?.get(`model\u0000g\u0000${UID}`) || null;
const liveOf = (host) => {
  const d = host.storedDerived(UID);
  return d ? { badges: JSON.stringify([...d.badges]), links: JSON.stringify(d.links) } : null;
};

// Open (a whole pull: the first store), then one edit that adds a card and the refresh that stores the board again.
async function openEditStore(flags, shape, spans) {
  const S = setup(flags, shape);
  const turn = (fn, turns) => untilTurns(own, () => { spans?.drain(); return fn(); }, turns);
  await S.store.ready;
  S.host.pullBoard(UID);
  const off = S.host.watchBoard(UID, () => {});
  await turn(() => rowOf(S.idb)?.stamp != null && S.store.stampOf(UID) != null, 20000);
  const first = { row: structuredClone(rowOf(S.idb)), live: liveOf(S.host), statCalls: S.reads.stats.length, stats: { ...S.host.stats } };
  const statsAt = S.reads.stats.length;
  await S.fake.api.data.block.create({ location: { "parent-uid": "bs0", order: "last" }, block: { uid: "pxd26new", string: "A new card", props: { plexus: { type: "card", x: 10, y: 10, w: 200, h: 120, v: 2 } } } });
  const stamp = S.pageStamp();
  assert.equal(S.host.refreshModel(UID), true, "the refresh read starts");
  await turn(() => rowOf(S.idb)?.stamp === stamp && S.store.stampOf(UID) === stamp, 20000);
  spans?.drain();
  const second = { row: structuredClone(rowOf(S.idb)), live: liveOf(S.host), statCalls: S.reads.stats.slice(statsAt), stats: { ...S.host.stats } };
  off();
  S.host.dispose();
  await S.store.dispose();
  return { ...S, first, second };
}

const KEEP_OFF = process.env.PXD26_KEEP === "off";

// One run of the PhD-shaped board per flag state, shared by the tests below (a run is ~10 s).
const bigRuns = new Map();
function bigRun(flagOff) {
  if (!bigRuns.has(flagOff)) {
    bigRuns.set(flagOff, (async () => {
      const spans = spanLog();
      const run = await openEditStore(flagOff ? { slicedKeep: false } : null, undefined, spans);
      noteSpeedFlags(null);
      return { run, spans };
    })());
  }
  return bigRuns.get(flagOff);
}

test("on the PhD-shaped board no part of the store job or its refresh read runs past 50 ms", { timeout: 240000 }, async () => {
  const { run, spans } = await bigRun(KEEP_OFF);
  assert.ok(run.blocks >= 20000, `blocks: ${run.blocks}`);
  const keepMax = spans.max("bg:model-keep");
  const readMax = spans.max("bg:refresh");
  assert.ok(spans.log.some((s) => s.name === "bg:model-keep"), "the store job ran");
  assert.ok(keepMax <= BUDGET_MS, `longest store part ${keepMax.toFixed(1)} ms (budget ${BUDGET_MS})`);
  assert.ok(readMax <= BUDGET_MS, `longest refresh read part ${readMax.toFixed(1)} ms (budget ${BUDGET_MS})`);
  assert.ok(run.reads.stats.length > 20, `the stats were read in ${run.reads.stats.length} pulls`);
  assert.ok(Math.max(...run.reads.stats) <= 240, `largest stats pull: ${Math.max(...run.reads.stats)} targets`);
  assert.ok(Math.max(...run.links) <= 240, `largest link read: ${Math.max(...run.links)} targets`);
  // The second store follows the first within the stats cache's two minutes: only the new card is read.
  assert.ok(run.second.stats.keepStatsPulled <= 4, `stats pulled for the edit: ${run.second.stats.keepStatsPulled}`);
  assert.ok(run.second.stats.keepStatsReused > 20000, `stats reused: ${run.second.stats.keepStatsReused}`);
  assert.ok(run.second.stats.keepPartMaxMs <= BUDGET_MS, `the job's own longest derived part: ${run.second.stats.keepPartMaxMs} ms`);
});

test("slicedKeep off: the same edit is followed by one store part of seconds", { timeout: 240000 }, async () => {
  const { run, spans } = await bigRun(true);
  const keepMax = spans.max("bg:model-keep");
  assert.ok(keepMax >= 1000, `the one-task recompute is one part: ${keepMax.toFixed(0)} ms`);
  assert.ok(Math.max(...run.second.statCalls) > 20000, "one stats pull for every target, because one card is new");
  assert.equal(run.second.stats.keepStatsPulled, undefined);
});

test("the stored model and derived data equal the one-task result, after the open and after an edit", { timeout: 120000 }, async () => {
  const on = await openEditStore(null, MID);
  const off = await openEditStore({ slicedKeep: false }, MID);
  assert.ok(on.blocks >= SPLIT_WATCH_MIN);
  for (const when of ["first", "second"]) {
    const a = on[when];
    const b = off[when];
    assert.ok(a.row?.derived, `${when}: derived data is stored`);
    assert.ok(a.row.derived.b.some((r) => r[2] > 0), `${when}: badges are not all zero`);
    assert.ok(a.row.derived.l.length > 20, `${when}: links are stored (${a.row.derived.l.length})`);
    assert.ok(a.row.derived.l.some((r) => r[2] === 1), `${when}: attribute links too`);
    assert.equal(JSON.stringify(a.row.derived), JSON.stringify(b.row.derived), `${when}: stored derived data`);
    assert.deepEqual(a.row.parts, b.row.parts, `${when}: stored tree`);
    assert.equal(a.row.n, b.row.n);
    assert.equal(a.live.badges, b.live.badges, `${when}: live badges`);
    assert.equal(a.live.links, b.live.links, `${when}: live links`);
  }
  assert.ok(on.second.row.parts.join("").includes("pxd26new"), "the edit is in the second store");
  assert.ok(on.first.statCalls > 5, `sliced: ${on.first.statCalls} stats pulls for the open`);
});

test("on the PhD-shaped board the derived data in memory equals the one-task result (over the stored cap both store none)", { timeout: 240000 }, async () => {
  const on = (await bigRun(false)).run;
  const off = (await bigRun(true)).run;
  for (const when of ["first", "second"]) {
    assert.equal(on[when].live.badges, off[when].live.badges, `${when}: badges`);
    assert.equal(on[when].live.links, off[when].live.links, `${when}: links`);
    assert.equal(JSON.stringify(on[when].row.derived), JSON.stringify(off[when].row.derived), `${when}: stored derived data`);
    assert.deepEqual(on[when].row.parts, off[when].row.parts, `${when}: stored tree`);
  }
  assert.ok(JSON.parse(on.first.live.badges).length > 20000);
  assert.ok(JSON.parse(on.first.live.links).length > 100);
});

test("an edit during the store job stops it: nothing is stored for the old page, and the retry stores the new one once", { timeout: 120000 }, async () => {
  const S = setup(null, MID);
  await S.store.ready;
  S.host.pullBoard(UID);
  const off = S.host.watchBoard(UID, () => {});
  const old = S.pageStamp();
  // The first store is in its stats parts.
  await untilTurns(own, () => S.reads.stats.length >= 2, 20000);
  assert.equal(S.store.stampOf(UID), null);
  await S.fake.api.data.block.update({ block: { uid: "bc00003", string: "edited during the store" } });
  const stamp = S.pageStamp();
  assert.notEqual(stamp, old);
  const seen = S.reads.stats.length;
  await untilTurns(own, () => (S.host.stats.keepsDropped || 0) >= 1, 20000);
  assert.ok(S.reads.stats.length - seen <= 1, "no stats part after the one that found the page moved");
  assert.equal(S.puts.includes(old), false, "nothing was stored under the old stamp");
  // The retry reads the newer page and stores it.
  await untilTurns(own, () => S.store.stampOf(UID) === stamp && rowOf(S.idb)?.stamp === stamp, 20000);
  assert.deepEqual(S.puts, [stamp], "one store, for the page as it is now");
  assert.ok(rowOf(S.idb).parts.join("").includes("edited during the store"));
  off();
  S.host.dispose();
  await S.store.dispose();
});

test("a burst of edits stores once: an edit during the refresh read ends it with no whole pull, and a later try reads again", { timeout: 120000 }, async () => {
  const S = setup(null, MID);
  await S.store.ready;
  S.host.pullBoard(UID);
  const off = S.host.watchBoard(UID, () => {});
  await untilTurns(own, () => S.store.stampOf(UID) != null, 20000);
  S.puts.length = 0;
  await S.fake.api.data.block.update({ block: { uid: "bc00003", string: "first of the burst" } });
  assert.equal(S.host.refreshModel(UID), true);
  // The read is under way (its level pulls run) when the next edits land.
  const n0 = S.reads.n;
  await untilTurns(own, () => S.reads.n > n0 + 3, 20000);
  S.fake.pullLog = [];
  await S.fake.api.data.block.update({ block: { uid: "bc00004", string: "second of the burst" } });
  await S.fake.api.data.block.update({ block: { uid: "bc00005", string: "third of the burst" } });
  const stamp = S.pageStamp();
  await untilTurns(own, () => S.store.stampOf(UID) === stamp && rowOf(S.idb)?.stamp === stamp, 20000);
  assert.equal(wholePulls(S.fake.pullLog), 0, "no whole-board pull in one task");
  assert.ok((S.host.stats.refreshMisses || 0) >= 1, "the interrupted read ended");
  assert.deepEqual(S.puts, [stamp], "one store for the burst");
  const text = rowOf(S.idb).parts.join("");
  assert.ok(text.includes("second of the burst") && text.includes("third of the burst"));
  off();
  S.host.dispose();
  await S.store.dispose();
});

test("slicedKeep off: an edit during the refresh read is retried and then read in one whole pull, as before", { timeout: 120000 }, async () => {
  const S = setup({ slicedKeep: false }, MID);
  await S.store.ready;
  S.host.pullBoard(UID);
  const off = S.host.watchBoard(UID, () => {});
  await untilTurns(own, () => S.store.stampOf(UID) != null, 20000);
  await S.fake.api.data.block.update({ block: { uid: "bc00003", string: "first" } });
  S.fake.pullLog = [];
  assert.equal(S.host.refreshModel(UID), true);
  let edits = 0;
  let last = S.reads.n;
  // An edit each time the read has moved on, until it gives up slicing.
  await untilTurns(own, () => {
    if ((S.host.stats.refreshRetries || 0) >= 2) return true;
    if (S.reads.n > last + 3 && edits < 6) { edits += 1; last = S.reads.n; void S.fake.api.data.block.update({ block: { uid: "bc00004", string: `again ${edits}` } }); }
    return false;
  }, 20000);
  assert.equal(S.host.stats.refreshMisses, undefined, "no miss path with the flag off");
  await untilTurns(own, () => S.store.stampOf(UID) === S.pageStamp(), 20000);
  assert.equal(wholePulls(S.fake.pullLog), 1, "the third take is one whole-board pull");
  off();
  S.host.dispose();
  await S.store.dispose();
});

// A trusted open of a board that changed without a stamp move (a fold or a sync from another device).
function seedSmall(fake, n = 230) {
  const sections = [];
  for (let s = 0; s < 3; s += 1) {
    const cards = [];
    for (let i = 0; i < n; i += 1) {
      cards.push({ uid: `c${s}_${i}`, string: `card ${s}.${i}`, props: { plexus: { x: i * 10, y: s * 10, w: 100, h: 50 } }, children: [
        { uid: `k${s}_${i}`, string: `kid ${i}`, children: [{ uid: `g${s}_${i}`, string: `grand ${i}` }] },
      ] });
    }
    sections.push({ uid: `sec${s}`, string: `Section ${s}`, open: true, props: { plexus: { type: "section", x: 0, y: s * 500, w: 2000, h: 400 } }, children: cards });
  }
  fake.seedPage({ title: "Board page", uid: "bpage", children: [] });
  fake.seedBoard({ uid: UID, parent: "bpage", props: { plexus: { v: 2 } }, children: sections });
}

async function prereadAll(host) {
  const reader = host.prereadBoard(UID, { sliceMs: 8, batch: 200 });
  assert.ok(reader);
  for (let steps = 0; ; steps += 1) {
    if (reader.waiting) await reader.waiting;
    if (reader.step()) break;
    assert.ok(steps < 8000);
  }
}

async function changedTrustedOpen(flags) {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seedSmall(fake);
  const reads = chargeReads(fake);
  const idb = createFakeIDB();
  const until = (fn) => untilTurns(own, fn, 20000);
  {
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    host.blockPageUid = (u) => (String(u).length ? "bpage" : "");
    const store = createModelStore({ indexedDB: idb, graph: "g" });
    host.useModelStore(store);
    stubLinks(host);
    await store.ready;
    await prereadAll(host);
    host.pullBoard(UID, { light: true });
    await until(() => store.stampOf(UID) != null);
    host.dispose();
    await store.dispose();
  }
  // The board changes with no stamp move; the stored model's stamp still matches the page.
  fake.quiet("c1_7", { string: "changed quietly" });
  if (flags) noteSpeedFlags(flags);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.blockPageUid = (u) => (String(u).length ? "bpage" : "");
  const store = createModelStore({ indexedDB: idb, graph: "g" });
  host.useModelStore(store);
  stubLinks(host);
  await store.ready;
  const statsAt = reads.stats.length;
  await prereadAll(host);
  const session = acquireSession(UID, { host, settings: { get: () => undefined } });
  assert.equal(host.boardUnverified(UID), true, "a trusted open");
  let told = 0;
  let statsAtVerify = null;
  const offTold = host.onDerivedRefreshed(UID, () => { told += 1; });
  host.onBoardVerified(UID, () => { statsAtVerify = reads.stats.length - statsAt; });
  await until(() => host.boardUnverified(UID) === false);
  await until(() => rowOf(idb)?.parts?.join("").includes("changed quietly"));
  await tick(20);
  const out = { told, statsAtVerify, live: liveOf(host), derived: JSON.stringify(rowOf(idb).derived), stats: { ...host.stats }, statCalls: reads.stats.slice(statsAt) };
  offTold();
  session.release?.();
  host.dispose();
  await store.dispose();
  noteSpeedFlags(null);
  return out;
}

test("a trusted open of a board that changed: verified before any stats read, its listeners told when the sliced store lands, the result the one task's", { timeout: 120000 }, async () => {
  const on = await changedTrustedOpen(null);
  resetSessions();
  resetSharedBgBudget();
  const off = await changedTrustedOpen({ slicedKeep: false });
  assert.equal(on.stats.checkChanges, 1, "the check found the change");
  assert.equal(on.statsAtVerify, 0, "sliced: verified before the stats are read");
  assert.ok(on.told >= 1, "derived listeners are told when the store lands");
  assert.ok(Math.max(...on.statCalls) <= 240);
  assert.ok(off.statsAtVerify >= 1, "one task: the stats are read before the board is verified");
  assert.equal(on.derived, off.derived, "stored derived data");
  assert.equal(on.live.badges, off.live.badges);
  assert.equal(on.live.links, off.live.links);
});

test("packDerived with search gives the linear result, under and over the cap", () => {
  const badges = (n, pad = "") => new Map(Array.from({ length: n }, (_, i) => [`uid:${pad}b${i}`, { refs: i % 5, boards: i % 2, open: i % 3, done: 0 }]));
  const links = (n) => Array.from({ length: n }, (_, i) => ({ from: `from-card-${i}`, to: `to-card-${(i * 7 + 1) % (n + 3)}x`, kind: i % 4 ? "ref" : "attr", labels: i % 4 ? ["mentions"] : ["Supports"], sources: Array.from({ length: 1 + (i % 9) }, (_, k) => ({ uid: `source-${i}-${k}` })) }));
  const cases = [
    [badges(10), links(5)],
    [badges(200), links(2000)], // over with sources, fits without
    [badges(200), links(5200)], // over without sources: the last links go
    [badges(6000), links(1500)], // few links fit
    [badges(9000, "a-long-uid-prefix-"), links(300)], // the badges alone are over the cap
    [badges(0), links(0)],
    [badges(7800), links(1)],
  ];
  for (const [b, l] of cases) {
    const linear = packDerived(b, l);
    const searched = packDerived(b, l, { search: true });
    assert.equal(JSON.stringify(searched), JSON.stringify(linear), `${b.size} badges, ${l.length} links`);
  }
  assert.equal(packDerived(badges(9000, "a-long-uid-prefix-"), links(300), { search: true }), null);
  const cut = packDerived(badges(200), links(5200), { search: true });
  assert.ok(cut.l.length > 0 && cut.l.length < 5200, `links kept: ${cut.l.length}`);
});
