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

test("cardStringForUid: page -> [[Title]], block -> ((uid)), unknown -> null", () => {
  const { fake, host } = setup();
  const pageUid = fake.seedPage({ title: "Alpha", children: [{ uid: "p1", string: "hello" }, { uid: "p2", string: "" }] });
  assert.equal(host.cardStringForUid(pageUid), "[[Alpha]]");
  assert.equal(host.cardStringForUid("p1"), "((p1))");
  assert.equal(host.cardStringForUid("p2"), "((p2))");
  assert.equal(host.cardStringForUid("zzz"), null);
  assert.equal(host.cardStringForUid(""), null);
});

function seedLibrary(fake) {
  fake.seedPage({ title: "Zeta", children: [
    { uid: "bz", string: "{{[[diagram]]:Zed board}}", props: { plexus: { v: 2 } }, children: [
      { uid: "bz1", string: "a" }, { uid: "bz2", string: "b" },
      { uid: "bze", string: "Connections", props: { plexus: { type: "edges" } } },
    ] },
  ] });
  fake.seedPage({ title: "Alpha", children: [
    { uid: "ba2", string: "{{[[diagram]]:Beta}}", props: { plexus: { v: 2 } } },
    { uid: "ba1", string: "{{diagram:Aardvark}}", props: { plexus: { v: 2 } } },
    { uid: "bn", string: "{{[[diagram]]:Native}}" },
    { uid: "bo", string: "{{[[diagram]]:Old}}", props: { plexus: { v: 1 } } },
    { uid: "bu", string: "{{[[diagram]]:}}", props: { plexus: { v: 2 } } },
  ] });
}
const libraryRows = [["bz", "{{[[diagram]]:Zed board}}", "Zeta", "pz"], ["ba2", "{{[[diagram]]:Beta}}", "Alpha", "pa"],
  ["ba1", "{{diagram:Aardvark}}", "Alpha", "pa"], ["bn", "{{[[diagram]]:Native}}", "Alpha", "pa"],
  ["bo", "{{[[diagram]]:Old}}", "Alpha", "pa"], ["bu", "{{[[diagram]]:}}", "Alpha", "pa"]];

test("listBoards keeps only plexus v2 boards, sorts, counts children minus Connections", () => {
  const { fake, host } = setup();
  seedLibrary(fake);
  const route = fake.onQuery(/re-pattern/, () => libraryRows);
  fake.clearLog();
  const boards = host.listBoards();
  assert.equal(route.calls.length, 1);
  assert.deepEqual(boards.map((b) => b.uid), ["ba1", "ba2", "bu", "bz"]);
  assert.deepEqual(boards.map((b) => b.title), ["Aardvark", "Beta", "Untitled board", "Zed board"]);
  const z = boards[3];
  assert.equal(z.pageTitle, "Zeta");
  assert.equal(z.pageUid, "pz");
  assert.equal(z.count, 2);
  assert.equal(z.edited, null);
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("listBoards honours limit and null rows", () => {
  const { fake, host } = setup();
  seedLibrary(fake);
  fake.onQuery(/re-pattern/, () => libraryRows);
  assert.deepEqual(host.listBoards({ limit: 2 }).map((b) => b.uid), ["ba1", "ba2"]);
  const { fake: f2, host: h2 } = setup();
  f2.setQ(() => null);
  assert.deepEqual(h2.listBoards(), []);
});

test("cardStats maps counts to page:/uid: keys with at most four queries", () => {
  const { fake, host } = setup();
  const alphaUid = fake.seedPage({ title: "Alpha" });
  fake.seedPage({ title: "TODO" });
  fake.seedPage({ title: "DONE" });
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "x" }] });
  const eA = host.resolveEid({ title: "Alpha" });
  const eC = host.resolveEid({ uid: "c1" });
  const eB = host.resolveEid({ uid: "b1" });
  const calls = [];
  fake.onQuery(/./, (query, ...inputs) => {
    calls.push([query, inputs]);
    if (/:block\/parents \?board\]\) \[\(not=/.test(query) && !/re-pattern/.test(query)) return [[eA, 1], [eA, 2], [eA, 2], [eC, 9]];
    if (/re-pattern/.test(query)) return [[eA, 50], [eA, 51]];
    if (inputs[1] === host.resolveEid({ title: "TODO" })) return [[eA, 7], [eC, 8], [eC, 9]];
    return [[eA, 5]];
  });
  fake.clearLog();
  const stats = host.cardStats(
    [{ kind: "page", title: "Alpha" }, { kind: "block", uid: "c1" }, { kind: "self", uid: "c1" }, { kind: "page", title: "Nope" }, { kind: "block", uid: "zzz" }],
    { boardUid: "b1" },
  );
  assert.equal(calls.length, 4);
  for (const [query, inputs] of calls) {
    assert.match(query, /\[\?t \.\.\.\]/);
    assert.deepEqual(inputs[0].sort(), [eA, eC].sort());
  }
  assert.equal(calls[0][1][1], eB);
  assert.deepEqual(stats.get("page:Alpha"), { refs: 2, boards: 2, open: 1, done: 1 });
  assert.deepEqual(stats.get("uid:c1"), { refs: 1, boards: 0, open: 2, done: 0 });
  assert.deepEqual(stats.get("page:Nope"), { refs: 0, boards: 0, open: 0, done: 0 });
  assert.deepEqual(stats.get("uid:zzz"), { refs: 0, boards: 0, open: 0, done: 0 });
  assert.equal(stats.size, 4);
  assert.equal(alphaUid.length > 0, true);
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("cardStats runs no queries when nothing resolves and skips status queries without TODO/DONE pages", () => {
  const { fake, host } = setup();
  const route = fake.onQuery(/./, () => []);
  assert.equal(host.cardStats([]).size, 0);
  assert.equal(host.cardStats([{ kind: "page", title: "Nope" }]).size, 1);
  assert.equal(route.calls.length, 0);
  fake.seedPage({ title: "Alpha" });
  host.cardStats([{ kind: "page", title: "Alpha" }]);
  assert.equal(route.calls.length, 2);
});

test("uploadFile: string and {url} results, counts a write; absent throws", async () => {
  const { fake, host } = setup();
  await assert.rejects(host.uploadFile({}), /upload-unavailable/);
  assert.equal(host.stats.writes, 0);
  const file = { name: "a.png" };
  let got;
  fake.setUpload(async (arg) => { got = arg; return "https://x/a.png"; });
  assert.equal(await host.uploadFile(file), "https://x/a.png");
  assert.equal(got.file, file);
  fake.setUpload(async () => ({ url: "https://x/b.png" }));
  assert.equal(await host.uploadFile(file), "https://x/b.png");
  assert.equal(host.stats.writes, 2);
  fake.setUpload(async () => ({}));
  await assert.rejects(host.uploadFile(file), /upload-failed/);
  assert.equal(host.stats.writes, 2);
});

test("uploadFile unwraps the markdown image Roam's file.upload returns, so the card string is not double-wrapped", async () => {
  const { fake, host } = setup();
  const file = { name: "a.png" };
  const url = "https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media&token=t(1)";
  fake.setUpload(async () => `![](${url})`);
  assert.equal(await host.uploadFile(file), url);
  fake.setUpload(async () => ({ url: `![alt text](${url})` }));
  assert.equal(await host.uploadFile(file), url);
});

const undoCalls = (fake) => fake.calls.filter((c) => c[0] === "undo" || c[0] === "redo").map((c) => c[0]);

test("undo: a grouped write sequence is one step (N Roam undos), a lone write is one", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "a" }] });
  await host.updateString("c1", "solo");
  await host.group(async () => {
    await host.updateProps("c1", { x: 1 });
    await host.createBlock({ parentUid: "b1", string: "n" });
    await host.moveBlock("c1", "b1", "last");
  });
  await host.undo(); // the grouped operation: three Roam undos
  assert.deepEqual(undoCalls(fake), ["undo", "undo", "undo"]);
  await host.undo(); // the lone write
  assert.equal(undoCalls(fake).length, 4);
  await host.undo(); // nothing recorded: Roam's single step
  assert.equal(undoCalls(fake).length, 5);
});

test("redo replays a whole undone group, and a fresh write clears the redo log", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "a" }] });
  await host.group(async () => {
    await host.updateProps("c1", { x: 1 });
    await host.updateProps("c1", { x: 2 });
  });
  await host.undo();
  fake.calls.length = 0;
  await host.redo();
  assert.deepEqual(undoCalls(fake), ["redo", "redo"]);
  await host.undo();
  await host.updateString("c1", "later");
  fake.calls.length = 0;
  await host.redo(); // the log was cleared by the new write: Roam's single step
  assert.deepEqual(undoCalls(fake), ["redo"]);
});

test("invalidateUndo drops the log after the echo window, not inside it or inside a group", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "a" }] });
  const grouped = async () => host.group(async () => {
    await host.updateProps("c1", { x: 1 });
    await host.updateProps("c1", { x: 2 });
  });
  await grouped();
  host.invalidateUndo(); // our own echo, just written: ignored
  await host.undo();
  assert.equal(undoCalls(fake).length, 2);
  fake.calls.length = 0;
  await grouped();
  await sleep(950);
  host.invalidateUndo(); // a foreign edit after the echo window
  await host.undo();
  assert.deepEqual(undoCalls(fake), ["undo"], "falls back to Roam's own single step");
});

test("undo: a transaction over 45 writes is split into consecutive groups, one Cmd+Z per chunk, and undo never deletes", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "a" }] });
  await host.updateProps("c1", { x: 1 }); // a prior operation
  const uids = [];
  await host.group(async () => {
    for (let i = 0; i < 81; i++) uids.push(await host.createBlock({ parentUid: "b1", string: `n${i}` }));
  });
  fake.calls.length = 0;
  await host.undo(); // newest chunk: 36 writes
  assert.equal(undoCalls(fake).length, 36);
  await host.undo(); // first chunk: 45 writes
  assert.equal(undoCalls(fake).length, 36 + 45);
  assert.deepEqual([...new Set(undoCalls(fake))], ["undo"]);
  assert.ok(!fake.calls.some((c) => c[0] === "delete" || c[0] === "deleteBlock" || /delete/i.test(String(c[0]))), "undo issues no deletes");
  fake.calls.length = 0;
  await host.undo(); // the prior 1-write move is the next Cmd+Z
  assert.deepEqual(undoCalls(fake), ["undo"]);
});

test("redo replays a split transaction chunk by chunk", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "b1" });
  await host.group(async () => {
    for (let i = 0; i < 81; i++) await host.createBlock({ parentUid: "b1", string: `n${i}` });
  });
  await host.undo();
  await host.undo();
  fake.calls.length = 0;
  await host.redo();
  assert.equal(undoCalls(fake).length, 45);
  await host.redo();
  assert.equal(undoCalls(fake).length, 81);
  fake.calls.length = 0;
  await host.undo();
  assert.equal(undoCalls(fake).length, 36, "the redone transaction undoes newest chunk first again");
});
