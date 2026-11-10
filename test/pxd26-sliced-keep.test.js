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
    for (const s of probe.spans()) if (s.name === "bg:model-keep" || s.name === "bg:refresh" || s.name === "bg:derived") log.push({ name: s.name, ms: s.ms });
    probe.clear();
  };
  return { log, drain, max: (name) => log.filter((s) => s.name === name).reduce((m, s) => Math.max(m, s.ms), 0) };
}

const toSeed = (n) => ({ uid: n[":block/uid"], string: n[":block/string"], props: n[":block/props"] ? { plexus: n[":block/props"].plexus } : undefined, heading: n[":block/heading"], open: n[":block/open"], children: (n[":block/children"] || []).map(toSeed) });

// What a read costs on the live PhD main board, per entity: the level pull 250 blocks in ~20 ms, the field compare
// 250 in ~25 ms, the fold compare ~11k in ~58 ms. The stats pull brings every descendant of each target (2.2 s for
// the board's 28k targets in one call), so it costs by what it returns.
const COST = { level: 0.08, field: 0.1, open: 0.005, target: 0.01, under: 0.04, ref: 0.02, own: 0.008, other: 0.02 };
// The fake answers the stats reads from one made-up graph, whichever pattern asks: a block has eid % 4 refs from
// outside the board (one more from under it when eid % 5 is 0, one from another board when eid % 7 is 0), and is a
// TODO when eid % 11 is 0 and DONE when eid % 13 is 0.
function chargeReads(fake) {
  const data = fake.api.data;
  const many = data.pull_many.bind(data);
  const calls = { stats: [], holders: [], refs: [], status: 0, n: 0 };
  calls.derived = () => calls.stats.length + calls.holders.length + calls.refs.length;
  const quietly = (fn) => { const log = fake.pullLog; fake.pullLog = null; try { return fn(); } finally { fake.pullLog = log; } };
  const eids = new Map();
  const uidOf = new Map();
  const eidOf = (entity) => {
    const key = JSON.stringify(entity);
    if (!eids.has(key)) {
      eids.set(key, quietly(() => data.pull("[:db/id]", entity))?.[":db/id"] ?? null);
      if (entity[0] === ":block/uid" && eids.get(key) != null) uidOf.set(eids.get(key), entity[1]);
    }
    return eids.get(key);
  };
  const todoEid = eidOf([":node/title", "TODO"]);
  const doneEid = eidOf([":node/title", "DONE"]);
  assert.ok(todoEid != null && doneEid != null, "the TODO and DONE pages are seeded");
  // The blocks outside the board, by page (when the fixture has them). The one on Page B is always a TODO.
  const OUTSIDE = [["outside1", "Page A"], ["outside2", "Page B"]];
  const statusRefs = (e) => [...(e % 11 === 0 || (e != null && e === eidOf([":block/uid", "outside2"])) ? [{ ":db/id": todoEid }] : []), ...(e % 13 === 0 ? [{ ":db/id": doneEid }] : [])];
  const refsTo = (e) => {
    const boardEid = eidOf([":block/uid", UID]);
    const out = Array.from({ length: e % 4 }, (_, i) => ({ ":db/id": 9_000_000 + e * 8 + i }));
    if (e % 5 === 0) out.push({ ":db/id": 9_000_000 + e * 8 + 5, ":block/parents": [{ ":db/id": boardEid, ":block/string": "{{[[diagram]]}}" }] });
    if (e % 7 === 0) out.push({ ":db/id": 9_000_000 + e * 8 + 6, ":block/parents": [{ ":db/id": 8_000_000 + (e % 3), ":block/string": "{{[[diagram]]}}" }] });
    return out;
  };
  // eid -> the eids under it, for the board as it is now (and, the other way, a block's ancestors).
  let under = null;
  let above = null;
  let underAt = null;
  const pageEid = () => eidOf([":block/uid", "bpage"]);
  const outsideOn = (pageE) => OUTSIDE.filter(([, title]) => eidOf([":node/title", title]) === pageE).map(([u]) => eidOf([":block/uid", u])).filter((e) => e != null);
  const descendants = () => quietly(() => {
    const p = data.pull("[:page/edit-time :page/edit-nonce]", [":block/uid", "bpage"]);
    const at = `${p?.[":page/edit-time"]}|${p?.[":page/edit-nonce"]}`;
    if (under && at === underAt) return under;
    under = new Map();
    underAt = at;
    const walk = (node) => {
      const mine = [];
      for (const kid of node[":block/children"] || []) {
        mine.push(eidOf([":block/uid", kid[":block/uid"]]));
        for (const d of walk(kid)) mine.push(d);
      }
      under.set(eidOf([":block/uid", node[":block/uid"]]), mine);
      return mine;
    };
    walk(data.pull(String(BOARD_PATTERN), [":block/uid", UID]));
    above = new Map();
    for (const [a, list] of under) for (const d of list) { if (!above.has(d)) above.set(d, []); above.get(d).push(a); }
    return under;
  });
  // The status side: the eids of the blocks that carry a status, and who holds each (its page, its ancestors).
  const pageOfOutside = new Map();
  const statusBlocks = (flag) => {
    const below = descendants();
    const out = [];
    for (const e of below.keys()) if (e != null && statusRefs(e).some((r) => r[":db/id"] === flag)) out.push(e);
    for (const [u, title] of OUTSIDE) {
      const o = eidOf([":block/uid", u]);
      if (o == null) continue;
      pageOfOutside.set(o, title);
      if (statusRefs(o).some((r) => r[":db/id"] === flag)) out.push(o);
    }
    return out;
  };
  const holdersOf = (e) => {
    descendants();
    if (pageOfOutside.has(e)) { const title = pageOfOutside.get(e); return { ":db/id": e, ":block/page": { ":block/uid": title === "Page A" ? "pagea" : "pageb", ":node/title": title }, ":block/parents": [] }; }
    return { ":db/id": e, ":block/page": { ":block/uid": "bpage", ":node/title": "Board page" }, ":block/parents": (above.get(e) || []).map((a) => ({ ":block/uid": uidOf.get(a) })) };
  };
  for (const where of [data, data.fast]) {
    const q = where.q.bind(where);
    where.q = (query, ...inputs) => {
      if (String(query).includes("[?x :block/refs ?status]")) { calls.status += 1; own.advance(1); return statusBlocks(inputs[0]).map((e) => [e]); }
      return q(query, ...inputs);
    };
  }
  data.pull_many = (pattern, entities) => {
    const p = String(pattern);
    calls.n += 1;
    if (p.includes(":block/_refs") && p.includes(":block/_parents")) {
      calls.stats.push(entities.length);
      const below = descendants();
      let cost = 0.5;
      const out = entities.map((e) => {
        const kids = below.get(e) || [];
        const refs = refsTo(Number(e));
        cost += COST.target + COST.under * kids.length + COST.ref * refs.length;
        // A page's blocks come under :block/_page (Page A holds the one block outside the board).
        const onPage = outsideOn(e);
        return { ":db/id": e, ":block/_refs": refs, ":block/_parents": kids.map((d) => ({ ":db/id": d, ":block/refs": statusRefs(d) })), ":block/_page": onPage.map((d) => ({ ":db/id": d, ":block/refs": statusRefs(d) })) };
      });
      own.advance(cost);
      return out;
    }
    if (p.includes(":block/page [:block/uid :node/title]")) {
      calls.holders.push(entities.length);
      own.advance(0.2 + COST.own * entities.length);
      return entities.map((e) => holdersOf(e));
    }
    if (p.includes(":block/_refs")) {
      calls.refs.push(entities.length);
      let cost = 0.2;
      const out = entities.map((entity) => {
        const e = typeof entity === "number" ? entity : eidOf(entity);
        if (e == null) return null;
        const refs = refsTo(e);
        cost += COST.target + COST.ref * refs.length;
        return { ":db/id": e, ":block/_refs": refs };
      });
      own.advance(cost);
      return out;
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
  // Two targets outside the board: a page card and a card that shows a block of another page.
  fake.seedPage({ title: "TODO", uid: "todopage", children: [] });
  fake.seedPage({ title: "DONE", uid: "donepage", children: [] });
  fake.seedPage({ title: "Page A", uid: "pagea", children: [{ uid: "outside1", string: "a block outside the board" }] });
  fake.seedPage({ title: "Page B", uid: "pageb", children: [{ uid: "outside2", string: "{{[[TODO]]}} another block outside the board" }] });
  fake.quiet("bc00001", { string: "[[Page A]]" });
  fake.quiet("bc00002", { string: "((outside1))" });
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
  const first = { row: structuredClone(rowOf(S.idb)), live: liveOf(S.host), statCalls: S.reads.derived(), stats: { ...S.host.stats } };
  const statsAt = S.reads.stats.length;
  await S.fake.api.data.block.create({ location: { "parent-uid": "bs0", order: "last" }, block: { uid: "pxd26new", string: "A new card", props: { plexus: { type: "card", x: 10, y: 10, w: 200, h: 120, v: 2 } } } });
  // And two cards whose targets are outside the board: a page, and a block of that page.
  await S.fake.api.data.block.create({ location: { "parent-uid": "bs0", order: "last" }, block: { uid: "pxd26pg", string: "[[Page B]]", props: { plexus: { type: "card", x: 230, y: 10, w: 200, h: 120, v: 2 } } } });
  await S.fake.api.data.block.create({ location: { "parent-uid": "bs0", order: "last" }, block: { uid: "pxd26rf", string: "((outside2))", props: { plexus: { type: "card", x: 450, y: 10, w: 200, h: 120, v: 2 } } } });
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
  assert.ok(run.reads.refs.length > 20, `the refs were read in ${run.reads.refs.length} pulls`);
  assert.ok(Math.max(...run.reads.refs) <= 160 && Math.max(...run.reads.holders) <= 500, "bounded pulls");
  assert.ok(run.reads.status >= 2, "TODO and DONE blocks are found from the status side");
  // (The open's own badge priming also reads through cardStats, 20 targets a time; the store job's reads for the
  // two targets outside the board are among these.)
  assert.ok(run.reads.stats.length >= 1 && Math.max(...run.reads.stats) <= 80, `no stats read for the whole board: ${Math.max(...run.reads.stats)}`);
  assert.ok(Math.max(...run.links) <= 32, `largest link read: ${Math.max(...run.links)} targets`);
  // The second store follows the first within the stats cache's two minutes: only the new card is read.
  assert.ok(run.second.stats.keepStatsPulled <= 8, `refs read for the edit: ${run.second.stats.keepStatsPulled}`);
  assert.ok(run.second.stats.keepStatsReused > 20000, `stats reused: ${run.second.stats.keepStatsReused}`);
  assert.ok(run.second.stats.keepPartMaxMs <= BUDGET_MS, `the job's own longest derived part: ${run.second.stats.keepPartMaxMs} ms`);
});

test("slicedKeep off: the same edit is followed by one store part of seconds", { timeout: 240000 }, async () => {
  const { run, spans } = await bigRun(true);
  const keepMax = spans.max("bg:model-keep");
  assert.ok(keepMax >= 500, `the one-task recompute is one part: ${keepMax.toFixed(0)} ms`);
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
    assert.ok(a.row.derived.b.some((r) => r[3] > 0) && a.row.derived.b.some((r) => r[4] > 0) && a.row.derived.b.some((r) => r[5] > 0), `${when}: boards, open and done counts too`);
    assert.ok(a.row.derived.b.some((r) => r[0] === "p" && r[1] === "Page A"), `${when}: the page card's badge`);
    assert.ok(a.row.derived.b.some((r) => r[0] === "u" && r[1] === "outside1"), `${when}: the badge of the block shown from another page`);
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
  assert.ok(on.reads.status >= 2, `TODO and DONE counts come from the status side (${on.reads.status} reads)`);
  assert.equal(off.reads.status, 0, "the one task does not use the status-side read");
  const pageB = on.second.row.derived.b.find((r) => r[0] === "p" && r[1] === "Page B");
  assert.deepEqual(pageB?.slice(4), [1, 0], "Page B holds one TODO block, counted from the status side");
  assert.ok(on.second.row.derived.b.some((r) => r[0] === "u" && r[1] === "outside2"), "the badge of the block shown from Page B");
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
  await untilTurns(own, () => S.reads.derived() >= 2, 20000);
  assert.equal(S.store.stampOf(UID), null);
  await S.fake.api.data.block.update({ block: { uid: "bc00003", string: "edited during the store" } });
  const stamp = S.pageStamp();
  assert.notEqual(stamp, old);
  const seen = S.reads.derived();
  await untilTurns(own, () => (S.host.stats.keepsDropped || 0) >= 1, 20000);
  assert.ok(S.reads.derived() - seen <= 1, "no stats part after the one that found the page moved");
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
  fake.seedPage({ title: "TODO", uid: "todopage", children: [] });
  fake.seedPage({ title: "DONE", uid: "donepage", children: [] });
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
  const statsAt = reads.derived();
  await prereadAll(host);
  const session = acquireSession(UID, { host, settings: { get: () => undefined } });
  assert.equal(host.boardUnverified(UID), true, "a trusted open");
  let told = 0;
  let statsAtVerify = null;
  const offTold = host.onDerivedRefreshed(UID, () => { told += 1; });
  host.onBoardVerified(UID, () => { statsAtVerify = reads.derived() - statsAt; });
  await until(() => host.boardUnverified(UID) === false);
  await until(() => rowOf(idb)?.parts?.join("").includes("changed quietly"));
  await tick(20);
  const out = { told, statsAtVerify, live: liveOf(host), derived: JSON.stringify(rowOf(idb).derived), stats: { ...host.stats }, biggest: Math.max(0, ...reads.stats, ...reads.refs) };
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
  assert.ok(on.biggest <= 1000, `largest stats read: ${on.biggest}`);
  assert.ok(off.statsAtVerify >= 1, "one task: the stats are read before the board is verified");
  assert.equal(on.derived, off.derived, "stored derived data");
  assert.equal(on.live.badges, off.live.badges);
  assert.equal(on.live.links, off.live.links);
});

// A trusted open of the PhD-shaped board as stored: the check finds it unchanged and refreshes its badges and links.
async function unchangedTrustedOpen(flags) {
  // The first store in one task (flag off): only the open after it is measured.
  const S = setup({ slicedKeep: false });
  await S.store.ready;
  await prereadAll(S.host);
  S.host.pullBoard(UID, { light: true });
  await untilTurns(own, () => S.store.stampOf(UID) != null && rowOf(S.idb)?.stamp != null, 20000);
  S.host.dispose();
  await S.store.dispose();
  noteSpeedFlags(flags);
  resetSharedTaskProbe();
  const spans = spanLog();
  const host = createHost({ api: S.fake.api, storage: S.fake.storage, graph: "g" });
  host.blockPageUid = (u) => (String(u).length ? "bpage" : "");
  const store = createModelStore({ indexedDB: S.idb, graph: "g" });
  host.useModelStore(store);
  stubLinks(host);
  await store.ready;
  await prereadAll(host);
  const session = acquireSession(UID, { host, settings: { get: () => undefined } });
  assert.equal(host.boardUnverified(UID), true, "a trusted open");
  let told = 0;
  const offTold = host.onDerivedRefreshed(UID, () => { told += 1; });
  await untilTurns(own, () => { spans.drain(); return told > 0; }, 40000);
  const out = { max: spans.max("bg:derived"), live: liveOf(host) };
  offTold();
  session.release?.();
  host.dispose();
  await store.dispose();
  resetSessions();
  resetSharedBgBudget();
  noteSpeedFlags(null);
  return out;
}

test("after a trusted open of the PhD-shaped board the derived refresh runs no part past 50 ms; with slicedKeep off its links read is one long part", { timeout: 240000 }, async () => {
  const on = await unchangedTrustedOpen(null);
  const off = await unchangedTrustedOpen({ slicedKeep: false });
  assert.ok(on.max > 0 && on.max <= BUDGET_MS, `longest refresh part ${on.max.toFixed(1)} ms (budget ${BUDGET_MS})`);
  assert.ok(off.max >= 200, `the old refresh reads every card's links in one part: ${off.max.toFixed(0)} ms`);
  assert.equal(on.live.badges, off.live.badges, "the same badges");
  assert.equal(on.live.links, off.live.links, "the same links");
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
