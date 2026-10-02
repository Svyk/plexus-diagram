import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createEchoLedger, createHost, createWriteQueue } from "../src/host/roam.js";
import { dailyPageTitle } from "../src/model/schema.js";

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

test("getFile calls file.get and returns null when it is missing or throws; it is not a write", async () => {
  const { fake, host } = setup();
  assert.equal(await host.getFile("https://x/a.png"), null);
  assert.equal(host.stats.writes, 0);
  let got;
  fake.setFileGet(async (arg) => { got = arg; return { size: 4, type: "image/png" }; });
  assert.deepEqual(await host.getFile(" https://x/a.png "), { size: 4, type: "image/png" });
  assert.deepEqual(got, { url: "https://x/a.png" });
  assert.equal(host.stats.writes, 0);
  fake.setFileGet(async () => { throw new Error("decrypt"); });
  assert.equal(await host.getFile("https://x/a.png"), null);
  assert.equal(await host.getFile(""), null);
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

test("renamePage updates the title as one undo step and clears a pending redo", async () => {
  const { fake, host } = setup();
  fake.seedPage({ title: "Beta", uid: "pgBeta" });
  fake.seedBoard({ uid: "b1", children: [{ uid: "c1", string: "a" }] });
  fake.onQuery(/block\/refs/, () => [[4]]);
  assert.equal(host.pageRefCount("Beta"), 4);
  assert.equal(host.pageRefCount(""), 0);
  assert.equal(await host.renamePage("Beta", "Beta"), false);
  assert.equal(await host.renamePage("  ", "Gamma"), false);
  assert.equal(await host.renamePage("Missing", "Nope"), false);
  assert.equal(host.stats.writes, 0);
  assert.equal(await host.renamePage("Beta", "Gamma"), true);
  assert.equal(host.stats.writes, 1);
  assert.equal(host.pageUid("Gamma"), "pgBeta");
  assert.equal(host.pageUid("Beta"), null);
  assert.deepEqual(fake.writesLog().filter((e) => e[0] === "page-update"), [["page-update", "pgBeta", "Gamma"]]);
  // A grouped redo is sitting on the log. renamePage notes its write, so that redo is dropped
  // and the next redo is Roam's single step. Without noteWrite the group would redo twice.
  await host.group(async () => {
    await host.updateProps("c1", { x: 1 });
    await host.updateProps("c1", { x: 2 });
  });
  await host.undo();
  assert.equal(await host.renamePage("Gamma", "Beta"), true);
  fake.calls.length = 0;
  await host.redo();
  assert.deepEqual(undoCalls(fake), ["redo"]);
  fake.calls.length = 0;
  await host.undo();
  await host.redo();
  assert.deepEqual(undoCalls(fake), ["undo", "redo"]);
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

test("cardInfo reads page attributes, tags, refs, and v2 boards", () => {
  const { fake, host } = setup();
  fake.seedPage({
    title: "Alpha",
    children: [
      { uid: "good", string: "Role:: tester" },
      { uid: "tagb", string: "hello #[[Tag Page]] #alpha" },
    ],
  });
  fake.seedBoard({
    uid: "boardV2",
    string: "{{[[diagram]]:Fixture}}",
    props: { plexus: { v: 2 } },
    children: [{ uid: "cardP", string: "[[Alpha]]", children: [{ uid: "bad", string: "Nope:: x" }] }],
  });
  fake.seedBoard({ uid: "native1", string: "{{[[diagram]]}}", props: { plexus: { v: 1 } } });
  fake.setQ((query) => {
    const q = String(query);
    if (q.includes(":block/parents")) assert.match(q, /:find \?u \?s \?pt[\s\S]*\[\?d :block\/uid \?u\]/);
    if (q.includes(":block/refs") && q.includes(":block/parents")) {
      return [["boardV2", "{{[[diagram]]:Fixture}}", "Lab"]];
    }
    if (q.includes(":block/parents")) {
      return [
        ["boardV2", "{{[[diagram]]:Fixture}}", "Lab"],
        ["native1", "{{[[diagram]]}}", "Lab"],
      ];
    }
    if (q.includes(":block/refs")) {
      return [
        ["cardP", "[[Alpha]]", "Lab"],
        ["other1", "see Alpha", "Notes"],
      ];
    }
    return [];
  });
  const info = host.cardInfo({
    uid: "cardP",
    type: "card",
    kind: "page",
    title: "Alpha",
    string: "[[Alpha]]",
    target: { kind: "page", title: "Alpha" },
  });
  assert.deepEqual(info.attributes, [{ name: "Role", value: "tester" }]);
  assert.deepEqual(info.tags, ["Tag Page", "alpha"]);
  assert.deepEqual(info.refs, [{ uid: "other1", string: "see Alpha", pageTitle: "Notes" }]);
  assert.deepEqual(info.boards, [{ uid: "boardV2", title: "Fixture", pageTitle: "Lab" }]);
  assert.equal(info.kind, "page");
  assert.equal(info.pageUid, host.pageUid("Alpha"));
  assert.equal(host.cardInfo({ uid: "s1", type: "section", target: { kind: "self", uid: "s1" } }), null);
});

test("cardInfo reads a note's own children and the block a ref card points at", () => {
  const { fake, host } = setup();
  fake.seedBoard({
    uid: "boardV2",
    string: "{{[[diagram]]:Fixture}}",
    props: { plexus: { v: 2 } },
    children: [{
      uid: "note1",
      string: "Field note #hb1",
      children: [{ uid: "st", string: "Status:: green" }],
    }],
  });
  fake.seedBoard({
    uid: "boardRef",
    string: "{{[[diagram]]:Other}}",
    props: { plexus: { v: 2 } },
  });
  fake.setQ((query, ...inputs) => {
    const q = String(query);
    if (q.includes(":block/parents")) assert.match(q, /:find \?u \?s \?pt[\s\S]*\[\?d :block\/uid \?u\]/);
    if (q.includes(":block/refs") && q.includes(":block/parents")) {
      assert.equal(inputs[0], "note1");
      return [["boardRef", "{{[[diagram]]:Other}}", "Notes"]];
    }
    if (q.includes(":block/parents")) {
      assert.equal(inputs[0], "refcard");
      return [["boardV2", "{{[[diagram]]:Fixture}}", "Lab"]];
    }
    if (q.includes(":block/refs")) {
      assert.equal(inputs[0], "note1");
      return [["mention1", "points here", "Notes"]];
    }
    return [];
  });
  const info = host.cardInfo({
    uid: "refcard",
    type: "card",
    kind: "block",
    title: "Field note",
    string: "((note1))",
    target: { kind: "block", uid: "note1" },
  });
  assert.equal(info.body, "Field note #hb1");
  assert.deepEqual(info.attributes, [{ name: "Status", value: "green" }]);
  assert.deepEqual(info.tags, ["hb1"]);
  assert.deepEqual(info.refs, [{ uid: "mention1", string: "points here", pageTitle: "Notes" }]);
  assert.deepEqual(info.boards.map((b) => b.uid), ["boardV2", "boardRef"]);
  assert.equal(info.uid, "note1");
});

test("linkedRefs lists mentions and skips the card itself", () => {
  const { fake, host } = setup();
  fake.setQ((query, input) => {
    const q = String(query);
    assert.equal(q.includes(":block/parents"), false);
    assert.match(q, /:block\/refs/);
    assert.equal(input, "Alpha");
    return [
      ["cardP0001", "[[Alpha]]", "Lab"],
      ["srcBlock1", "original mention", "Notes"],
      ["srcBlock1", "original mention", "Notes"],
      ["otherMent", "second mention", "Notes"],
    ];
  });
  const refs = host.linkedRefs({
    uid: "cardP0001",
    type: "card",
    kind: "page",
    title: "Alpha",
    string: "[[Alpha]]",
    target: { kind: "page", title: "Alpha" },
  });
  assert.deepEqual(refs, [
    { uid: "srcBlock1", string: "original mention", pageTitle: "Notes" },
    { uid: "otherMent", string: "second mention", pageTitle: "Notes" },
  ]);
  fake.setQ((query, input) => {
    assert.match(String(query), /\?uid/);
    assert.equal(input, "note10001");
    return [
      ["note10001", "self", "Lab"],
      ["backlink1", "points here", "Notes"],
      ["backlink2", "also here", "Notes"],
    ];
  });
  const capped = host.linkedRefs({
    uid: "refcard01",
    type: "card",
    kind: "block",
    title: "Field",
    string: "((note10001))",
    target: { kind: "block", uid: "note10001" },
  }, { limit: 1 });
  assert.deepEqual(capped, [{ uid: "backlink1", string: "points here", pageTitle: "Notes" }]);
  fake.setQ(() => { throw new Error("query down"); });
  assert.deepEqual(host.linkedRefs({
    uid: "cardP0001",
    type: "card",
    kind: "page",
    title: "Alpha",
    target: { kind: "page", title: "Alpha" },
  }), []);
  assert.deepEqual(host.linkedRefs({ uid: "s1", type: "section", target: { kind: "self", uid: "s1" } }), []);
});

test("neighborPages lists outgoing pages, backlinks, and attribute values", () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "boardAAA" });
  const boardEid = host.resolveEid({ uid: "boardAAA" });
  const page = {
    uid: "cardP0001",
    type: "card",
    kind: "page",
    title: "Alpha",
    string: "[[Alpha]]",
    target: { kind: "page", title: "Alpha" },
  };
  fake.setQ((query, title, eid) => {
    const q = String(query);
    assert.equal(title, "Alpha");
    if (q.includes(":block/parents ?board")) {
      assert.equal(eid, boardEid);
      return [
        ["selfblock", "me", "Notes"],
        ["b1", "back", "Notes"],
        ["b2", "back", "Zed"],
        ["b3", "Role:: [[Alpha]]", "Delta"],
        ["b4", "same", "Alpha"],
      ];
    }
    assert.equal(eid, undefined);
    assert.match(q, /:block\/page/);
    return [
      ["Alpha", "self"],
      ["Causes", "Causes:: [[Beta]]"],
      ["Beta", "Causes:: [[Beta]]"],
      ["Gamma", "see [[Gamma]]"],
      ["Gamma", "again"],
    ];
  });
  assert.deepEqual(host.neighborPages(page, "out", { boardUid: "boardAAA" }), ["Gamma"]);
  assert.deepEqual(host.neighborPages(page, "attr", { boardUid: "boardAAA" }), ["Beta"]);
  assert.deepEqual(host.neighborPages(page, "in", { boardUid: "boardAAA" }), ["Notes", "Zed"]);
  fake.setQ((query, uid) => {
    assert.match(String(query), /:block\/parents \?s/);
    assert.equal(uid, "note10001");
    return [["Other", "see"]];
  });
  assert.deepEqual(host.neighborPages({
    uid: "refcard01",
    type: "card",
    kind: "block",
    string: "((note10001))",
    target: { kind: "block", uid: "note10001" },
  }, "out"), ["Other"]);
  fake.setQ(() => { throw new Error("query down"); });
  assert.deepEqual(host.neighborPages(page, "out"), []);
  assert.deepEqual(host.neighborPages(page, "nope"), []);
  assert.deepEqual(host.neighborPages({ uid: "s1", type: "section", kind: "section" }, "out"), []);
});

test("showOnBoard returns the placed v2 card, or the card that refs the block", () => {
  const { fake, host } = setup();
  const placed = { plexus: { x: 10, y: 20, w: 80, h: 40 } };
  fake.seedBoard({ uid: "boardAAA", props: { plexus: { v: 2 } } });
  fake.seedBoard({ uid: "boardZZZ", props: { plexus: { v: 2 } } });
  fake.seedBoard({ uid: "boardBBB", props: { plexus: { v: 2 } } });
  fake.seedBoard({ uid: "boardOLD", props: { plexus: { v: 1 } } });
  fake.seedBoard({ uid: "cardSELF", props: placed });
  fake.seedBoard({ uid: "cardREF", props: placed });
  fake.seedBoard({ uid: "sectONE", props: { plexus: { type: "section", x: 0, y: 0, w: 40, h: 40 } } });
  fake.onQuery(/:block\/refs/, (_query, uid) => {
    if (uid === "srcBLOCK") {
      return [
        ["boardBBB", "pageLAB1", "cardREF"],
        ["boardOLD", "pageLAB1", "cardREF"],
        ["boardAAA", "pageLAB1", "sectONE"],
      ];
    }
    if (uid === "cardSELF") return [["board000", "pageLAB1", "cardREF"]];
    return [];
  });
  fake.onQuery(/:block\/parents/, (_query, uid) => {
    if (uid === "cardSELF") return [["boardZZZ", "pageLAB2"], ["boardAAA", "pageLAB1"]];
    if (uid === "sectONE") return [["boardAAA", "pageLAB1"]];
    return [];
  });
  assert.deepEqual(host.showOnBoard("cardSELF"), { boardUid: "boardAAA", pageUid: "pageLAB1", cardUid: "cardSELF" });
  assert.deepEqual(host.showOnBoard("srcBLOCK"), { boardUid: "boardBBB", pageUid: "pageLAB1", cardUid: "cardREF" });
  assert.equal(host.showOnBoard("sectONE"), null);
  assert.equal(host.showOnBoard("plain99"), null);
  assert.equal(host.showOnBoard(""), null);
  assert.equal(host.stats.writes, 0);
});

test("blockPageUid reads the owning page and showOnBoard stays empty without rows", () => {
  const storage = { getItem() { return null; }, setItem() {} };
  const api = {
    data: {
      pull(pattern, entity) {
        if (String(pattern).includes(":block/page") && entity[1] === "card1") {
          return { ":block/page": { ":block/uid": "pageLAB1" } };
        }
        return null;
      },
      q() { return []; },
    },
  };
  const host = createHost({ api, storage, graph: "Readwisenotes" });
  assert.equal(host.blockPageUid("card1"), "pageLAB1");
  assert.equal(host.blockPageUid("missing"), "");
  assert.equal(host.showOnBoard("card1"), null);
  assert.equal(host.stats.writes, 0);
});

test("librarySearch narrows type, tag, days and orphans without writing", () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "board1", string: "{{[[diagram]]:P1 fixture}}", props: { plexus: { v: 2 } } });
  fake.seedBoard({ uid: "boardV1", string: "{{[[diagram]]:fixture native}}", props: { plexus: { v: 1 } } });
  fake.seedBoard({ uid: "boardOld", string: "{{[[diagram]]:Old}}", props: { plexus: { v: 1 } } });
  const calls = [];
  fake.onQuery(/:find/, (query, ...inputs) => {
    calls.push({ query, inputs });
    if (query.includes("[?card :block/refs ?b]")) return [["blkOn"]];
    if (query.includes("[?u ...]") && query.includes("[?b :block/parents ?d]")) return [["blkOn"]];
    if (query.includes("[?card :block/refs ?p]")) return [["Plexus Notes"]];
    if (query.includes("[?t ...]")) return [[inputs[0][0], "day1", Date.now()]];
    if (query.includes("[?child :block/parents ?d]")) return [["board1", "{{[[diagram]]:P1 fixture}}", "Lab"]];
    if (query.includes("[?tag :node/title ?name]") && query.includes("[?b :block/string ?s]")) return [["fixture tagged", "tag1", "Lab"]];
    if (query.includes("[?tag :node/title ?name]") && query.includes("[?p :node/title ?t]")) return [["Plexus Notes", "pg1"], ["Other", "pg2"]];
    if (query.includes("[?p :node/title ?pt]")) {
      return [
        ["board1", "{{[[diagram]]:P1 fixture}}", "Lab"],
        ["boardV1", "{{[[diagram]]:fixture native}}", "Lab"],
        ["boardOld", "{{[[diagram]]:Old}}", "Lab"],
      ];
    }
    if (query.includes("[?b :block/string ?s]")) {
      if (query.includes("?e")) {
        return [
          ["fixture alpha", "blkOff", "Lab", Date.now()],
          ["fixture old", "blkOld", "Lab", 1],
          ["{{[[diagram]]:P1 fixture}}", "board1", "Lab", Date.now()],
          ["secret", "blkSecret", "roam/js", Date.now()],
        ];
      }
      return [
        ["fixture alpha", "blkOff", "Lab"],
        ["fixture placed", "blkOn", "Lab"],
        ["{{[[diagram]]:Skip}}", "board1", "Lab"],
        ["nope", "blkNo", "Lab"],
      ];
    }
    if (query.includes("[?p :node/title ?t]")) {
      if (query.includes("?e")) {
        return [
          ["Plexus Notes", "pg1", Date.now()],
          ["Old Plexus", "pgOld", 1],
          ["roam/css", "r1", Date.now()],
        ];
      }
      return [
        ["Plexus Notes", "pg1"],
        ["roam/css", "r1"],
        ["October 1st, 2026", "day1"],
        ["Alphabet", "pg2"],
      ];
    }
    return [];
  });
  fake.clearLog();

  const pages = host.librarySearch({ text: "plex", type: "page" }, 40);
  assert.deepEqual(pages.rows.map((r) => r.string), ["[[Plexus Notes]]"]);
  assert.equal(pages.rows[0].kind, "page");
  assert.equal(pages.queries.length, 1);
  assert.equal(pages.queries[0].name, "pages");
  assert.equal(typeof pages.queries[0].ms, "number");

  const blocks = host.librarySearch({ text: "fixture", type: "block", orphan: true }, 40);
  assert.deepEqual(blocks.rows.map((r) => r.string), ["((blkOff))"]);
  assert.deepEqual(blocks.queries.map((q) => q.name), ["blocks", "orphan-parents", "orphan-refs"]);

  const marked = calls.length;
  const before = Date.now();
  const recent = host.librarySearch({ text: "plex", type: "page", days: 2 }, 40);
  const after = Date.now();
  const dayCall = calls.slice(marked).find((c) => c.query.includes("[(> ?e ?since)]"));
  const since = dayCall.inputs.at(-1);
  assert.ok(since >= before - 2 * 86400000);
  assert.ok(since <= after - 2 * 86400000);
  assert.deepEqual(recent.rows.map((r) => r.string), ["[[Plexus Notes]]"]);

  const tagged = host.librarySearch({ tag: "#TODO", type: "block" }, 40);
  assert.equal(calls.at(-1).inputs[0], "TODO");
  assert.deepEqual(tagged.rows.map((r) => r.string), ["((tag1))"]);
  const lower = host.librarySearch({ tag: "todo", type: "block" }, 40);
  assert.equal(calls.at(-1).inputs[0], "todo");
  assert.deepEqual(lower.rows.map((r) => r.string), ["((tag1))"]);

  const boards = host.librarySearch({ type: "board", text: "fixture" }, 40);
  assert.equal(calls.at(-1).inputs[0], "^\\{\\{(\\[\\[)?diagram");
  assert.deepEqual(boards.rows.map((r) => [r.string, r.kind, r.text]), [["((board1))", "board", "P1 fixture"]]);

  const dailies = host.librarySearch({ type: "daily" }, 40);
  const dailyCall = calls.at(-1);
  assert.ok(dailyCall.inputs[0].includes(dailyPageTitle(new Date())));
  assert.deepEqual(dailies.rows[0], {
    string: `[[${dailyCall.inputs[0][0]}]]`,
    text: dailyCall.inputs[0][0],
    kind: "daily",
    label: "daily",
  });

  const quiet = calls.length;
  assert.deepEqual(host.librarySearch({ orphan: true }).rows, []);
  assert.deepEqual(host.librarySearch({ days: 4 }).queries, []);
  assert.deepEqual(host.librarySearch({ type: "block" }).rows, []);
  assert.equal(calls.length, quiet);

  const mixed = host.librarySearch({ type: "all", text: "fixture" }, 40);
  assert.deepEqual(mixed.rows.map((r) => r.string), ["((blkOff))", "((blkOn))", "((board1))"]);
  assert.ok(mixed.queries.every((q) => Number.isFinite(q.ms) && q.ms >= 0));

  const orphanPages = host.librarySearch({ text: "plex", type: "page", orphan: true }, 40);
  assert.deepEqual(orphanPages.rows, []);
  assert.ok(orphanPages.queries.some((q) => q.name === "orphan-pages"));
  for (const call of calls) {
    for (const input of call.inputs) if (Array.isArray(input)) assert.ok(input.length > 0);
  }
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});
