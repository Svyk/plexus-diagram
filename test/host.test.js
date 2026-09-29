import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createEchoLedger, createHost, createWriteQueue } from "../src/host/roam.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host };
}

test("updateProps merges and preserves rf-diagram and other keys", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1", props: { "rf-diagram": { a: 1 }, other: "x" } });
  await host.updateProps("b1", { v: 2 });
  assert.deepEqual(fake.props("b1"), { "rf-diagram": { a: 1 }, other: "x", plexus: { v: 2 } });
  assert.equal(host.stats.writes, 1);
});

test("updateProps with null removes only plexus", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1", props: { "rf-diagram": { a: 1 }, plexus: { v: 2 } } });
  await host.updateProps("b1", null);
  assert.deepEqual(fake.props("b1"), { "rf-diagram": { a: 1 } });
});

test("createBlock writes props and open in one create call", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1" });
  const uid = await host.createBlock({ parentUid: "b1", string: "Connections", props: { plexus: { type: "edges" } }, open: false });
  assert.deepEqual(fake.writesLog().map((e) => e[0]), ["create"]);
  assert.equal(host.stats.writes, 1);
  assert.deepEqual(fake.props(uid), { plexus: { type: "edges" } });
  assert.equal(fake.block(uid).open, false);
});

test("watchBoard: one watch per call, unwatch is idempotent and stats track it", () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1" });
  const off = host.watchBoard("b1", () => {});
  assert.equal(host.stats.watches, 1);
  assert.equal(fake.watchCount(), 1);
  off();
  off();
  assert.equal(host.stats.watches, 0);
  assert.equal(fake.watchCount(), 0);
});

test("pullBoard returns colon keys and null for missing", () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "[[A]]" }] });
  const pulled = host.pullBoard("b1");
  assert.equal(pulled[":block/uid"], "b1");
  assert.equal(pulled[":block/children"][0][":block/uid"], "c1");
  assert.equal(host.pullBoard("nope"), null);
});

test("resolveEid, pageUid, blockString", () => {
  const { fake, host } = setup();
  const pageUid = fake.seedPage({ title: "Alpha", children: [{ uid: "p1", string: "hello" }] });
  assert.equal(host.pageUid("Alpha"), pageUid);
  assert.equal(typeof host.resolveEid({ title: "Alpha" }), "number");
  assert.equal(typeof host.resolveEid({ uid: "p1" }), "number");
  assert.equal(host.resolveEid({ uid: "zzz" }), null);
  assert.equal(host.blockString("p1"), "hello");
  assert.equal(host.blockString("zzz"), null);
});

test("write queue is serial and reports busy transitions", async () => {
  const seen = [];
  const order = [];
  const q = createWriteQueue({ onBusy: (b) => seen.push(b) });
  const p1 = q.run(async () => { await sleep(15); order.push(1); });
  const p2 = q.run(async () => { order.push(2); });
  assert.equal(q.pending, 2);
  await Promise.all([p1, p2]);
  assert.deepEqual(order, [1, 2]);
  assert.deepEqual(seen, [true, false]);
  await q.idle();
  await q.run(() => {});
  assert.deepEqual(seen, [true, false, true, false]);
});

test("write queue keeps running after a failure", async () => {
  const q = createWriteQueue();
  await assert.rejects(q.run(async () => { throw new Error("x"); }));
  assert.equal(await q.run(async () => 7), 7);
});

test("echo ledger: newest echo absorbed, stale older echo ignored", () => {
  let t = 1000;
  const l = createEchoLedger({ graceMs: 100, now: () => t });
  l.expect("u", "props", "A");
  l.expect("u", "props", "B");
  assert.equal(l.accept("u", "props", "A"), false);
  assert.equal(l.accept("u", "props", "B"), false);
  l.settle("u", "props");
  l.settle("u", "props");
  assert.equal(l.accept("u", "props", "A"), false);
});

test("echo ledger: external change accepted after grace", () => {
  let t = 1000;
  const l = createEchoLedger({ graceMs: 100, now: () => t });
  l.expect("u", "props", "A");
  l.settle("u", "props");
  assert.equal(l.accept("u", "props", "A"), false);
  assert.equal(l.accept("u", "props", "EXTERNAL"), false);
  t += 200;
  assert.equal(l.accept("u", "props", "EXTERNAL"), true);
  assert.equal(l.accept("u", "props", "OTHER"), true);
});

test("echo ledger: untracked values are accepted", () => {
  const l = createEchoLedger();
  assert.equal(l.accept("u", "props", "A"), true);
});

test("viewport store round-trips through storage", () => {
  const { fake, host } = setup();
  host.viewports.set("b1", { x: 1, y: 2, zoom: 1.5 });
  host.viewports.flushAll();
  assert.deepEqual(host.viewports.get("b1"), { x: 1, y: 2, zoom: 1.5 });
  assert.equal(host.viewports.get("nope"), null);
  assert.ok(fake.storage._map.size >= 1);
});

test("q falls back and searchPages excludes roam/ titles", () => {
  const { fake, host } = setup();
  fake.setQ(() => [["Alpha", "u1"], ["roam/js", "u2"], ["Alphabet", "u3"]]);
  assert.deepEqual(host.searchPages("alp").map((p) => p.title), ["Alpha", "Alphabet"]);
});
