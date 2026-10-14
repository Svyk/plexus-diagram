// P8 U3: a cold open reads the board in short tasks (level by level, pull_many) and hands the tree to pullBoard only
// when the page stamp did not move and the folds were read again.
import assert from "node:assert/strict";
import test from "node:test";
import { createHost, BOARD_PATTERN } from "../src/host/roam.js";
import { createSlicedRead } from "../src/host/sliced-read.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

function seed(fake, n = 30) {
  const sections = [];
  for (let s = 0; s < 3; s += 1) {
    const cards = [];
    for (let i = 0; i < n; i += 1) {
      cards.push({ uid: `c${s}_${i}`, string: `card ${s}.${i}`, props: { plexus: { x: i * 10, y: s * 10, w: 100, h: 50 } }, children: [
        { uid: `k${s}_${i}`, string: `kid ${i}`, children: [{ uid: `g${s}_${i}`, string: `grand ${i}` }] },
      ] });
    }
    sections.push({ uid: `sec${s}`, string: `Section ${s}`, open: s !== 1, props: { plexus: { type: "section", x: 0, y: s * 500, w: 2000, h: 400 } }, children: cards });
  }
  fake.seedPage({ title: "Board page", uid: "bpage", children: [] });
  fake.seedBoard({ uid: "sb1", parent: "bpage", props: { plexus: { v: 2 } }, children: [
    ...sections,
    { uid: "conns", string: "Connections", props: { plexus: { type: "edges" } }, open: false, children: [{ uid: "e1", string: "((c0_0)) → ((c1_0))" }] },
  ] });
}

const sortTree = (n) => {
  const out = { ...n };
  if (Array.isArray(n[":block/children"])) out[":block/children"] = n[":block/children"].map(sortTree).sort((a, b) => (a[":block/uid"] < b[":block/uid"] ? -1 : 1));
  return out;
};

function readerFor(fake, opts = {}) {
  const api = fake.api;
  const rootEid = api.data.pull("[:db/id]", [":block/uid", "sb1"])[":db/id"];
  const pageUid = () => "bpage";
  let clock = 0;
  const reader = createSlicedRead({
    rootEid,
    pullMany: (p, ids) => { clock += opts.cost ?? 1; return (opts.wrap || ((x) => x))(api.data.pull_many(p, ids), p, ids); },
    stamp: () => { const p = api.data.pull("[:page/edit-time :page/edit-nonce]", [":block/uid", pageUid()]); return `${p[":page/edit-time"]}|${p[":page/edit-nonce"]}`; },
    clock: () => clock,
    ...opts.reader,
  });
  return reader;
}

test("sliced read: same tree as the one BOARD_PATTERN pull, in several bounded steps", () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true });
  seed(fake);
  const reader = readerFor(fake, { cost: 10, reader: { sliceMs: 20, batch: 25 } });
  let steps = 0;
  while (!reader.step()) { steps += 1; assert.ok(steps < 200); }
  assert.ok(steps >= 3, `more than one task (${steps})`);
  const tree = reader.take();
  const whole = fake.api.data.pull(BOARD_PATTERN, [":block/uid", "sb1"]);
  const strip = (n) => { const o = {}; for (const k in n) if (!/^:edit\/time$|^:db\/id$/.test(k)) o[k] = k === ":block/children" ? n[k].map(strip) : n[k]; return o; };
  assert.deepEqual(sortTree(strip(tree)), sortTree(strip(whole)));
  assert.equal(reader.take(), null, "taken once");
});

test("sliced read: a write on the page between two steps gives no tree", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const reader = readerFor(fake, { reader: { sliceMs: 1, batch: 10 } });
  assert.equal(reader.step(), false);
  await fake.api.data.block.update({ block: { uid: "c2_3", string: "edited elsewhere" } });
  while (!reader.step()) { /* finish */ }
  assert.equal(reader.phase, "failed");
  assert.equal(reader.take(), null);
});

test("sliced read: a block gone mid-read fails; a fold toggled mid-read (no stamp) is read again", () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true });
  seed(fake);
  let drop = false;
  const gone = readerFor(fake, { reader: { sliceMs: 1, batch: 5 }, wrap: (res, p) => (drop && /:block\/props/.test(p) ? res.map((n, i) => (i === 0 ? null : n)) : res) });
  gone.step();
  drop = true;
  while (!gone.step()) { /* finish */ }
  assert.equal(gone.phase, "failed");

  // sec1 is folded at the start; the first level read sees it open (a fold the stamp cannot show), the fold pass reads it again.
  let lie = true;
  const folds = readerFor(fake, { reader: { sliceMs: 1, batch: 5 }, wrap: (res, p) => (lie && /:block\/props/.test(p) ? res.map((n) => (n?.[":block/uid"] === "sec1" ? { ...n, ":block/open": true } : n)) : res) });
  folds.step();
  lie = false;
  while (!folds.step()) { /* finish */ }
  const tree = folds.take();
  assert.equal(tree[":block/children"].find((k) => k[":block/uid"] === "sec1")[":block/open"], false);
});

test("host.prereadBoard offers the tree to the next pullBoard; a moved stamp or an old offer reads Roam whole", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  // The fake has no :block/page: name the board's page as Roam would.
  const hostOn = (h) => { h.blockPageUid = (u) => (String(u).length ? "bpage" : ""); return h; };
  const host = hostOn(createHost({ api: fake.api, storage: fake.storage, graph: "g" }));
  const reader = host.prereadBoard("sb1", { sliceMs: 1, batch: 10 });
  assert.ok(reader);
  let steps = 0;
  while (!reader.step()) steps += 1;
  assert.ok(steps > 1);
  fake.pullLog = [];
  const node = host.pullBoard("sb1", { light: true });
  assert.equal(node[":block/uid"], "sb1");
  assert.equal(host.stats.slicedReads, 1);
  assert.equal(fake.pullLog.filter((p) => p.pattern === BOARD_PATTERN).length, 0, "no whole-board pull");

  // A second host, an offer whose page changed before pullBoard: the whole pull runs.
  const host2 = hostOn(createHost({ api: fake.api, storage: fake.storage, graph: "g" }));
  const r2 = host2.prereadBoard("sb1", { sliceMs: 1000, batch: 1000 });
  while (!r2.step()) { /* finish */ }
  await fake.api.data.block.update({ block: { uid: "c0_1", string: "changed after the read" } });
  fake.pullLog = [];
  const node2 = host2.pullBoard("sb1", { light: true });
  assert.ok(!host2.stats.slicedReads);
  assert.ok(fake.pullLog.some((p) => p.pattern === BOARD_PATTERN));
  const card = node2[":block/children"].flatMap((s) => s[":block/children"] || []).find((c) => c[":block/uid"] === "c0_1");
  assert.equal(card[":block/string"], "changed after the read");

  // An offer older than its TTL is not used.
  const host3 = hostOn(createHost({ api: fake.api, storage: fake.storage, graph: "g" }));
  const r3 = host3.prereadBoard("sb1", { sliceMs: 1000, batch: 1000 });
  while (!r3.step()) { /* finish */ }
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;
  try { host3.pullBoard("sb1", { light: true }); } finally { Date.now = realNow; }
  assert.ok(!host3.stats.slicedReads);
});

test("host.prereadBoard is null without pull_many or a page stamp", () => {
  const plain = createFakeRoam();
  seed(plain);
  assert.equal(createHost({ api: plain.api, storage: plain.storage, graph: "g" }).prereadBoard("sb1"), null);
  const noStamp = createFakeRoam({ pullMany: true });
  seed(noStamp);
  assert.equal(createHost({ api: noStamp.api, storage: noStamp.storage, graph: "g" }).prereadBoard("sb1"), null);
});
