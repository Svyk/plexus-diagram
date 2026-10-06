// POL-5: cardStats counts come from reverse-attribute pulls. The numbers below are counted by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

// Alpha (page 1), on board 10 "{{[[diagram]]}}":
//   refs 11 (child of the board — excluded), 20 (under {{diagram}} 21; {{Diagram}} 51 does not match),
//   20 again (still one block), 22 (under "Tuesday" and " {{diagram}}" — neither matches),
//   30 (under nest 31 and the board — ref excluded, nest counts), 32 (under 21),
//   the board itself (excluded; its parent 50 counts), 34 (no parents — counts, no board).
//   refs 4 (20, 22, 32, 34). boards 3 (21, 31, 50).
//   open blocks 70, 71, 73 reference TODO, and 70/71/73 also sit on the page (once each). done: 71. open 3, done 1.
// note (block 2): refs 32 (board 21), 33 (page 40 has no string; diagram 41 counts), 35 (one parent object, diagram 42).
//   refs 3. boards 3 (21, 41, 42). descendants 60 and 63 are TODO, 61 and 81 are DONE. open 2, done 2. No :block/_page.
// solo (block 4): one referencer object 90 under diagram 91, one descendant object 92 that references TODO.
//   refs 1, boards 1, open 1, done 0.
// Lonely (page 3) is only {:db/id 3}. Missing and zzz do not resolve.
const EXPECTED = [
  ["page:Alpha", { refs: 4, boards: 3, open: 3, done: 1 }],
  ["uid:note", { refs: 3, boards: 3, open: 2, done: 2 }],
  ["uid:solo", { refs: 1, boards: 1, open: 1, done: 0 }],
  ["page:Lonely", { refs: 0, boards: 0, open: 0, done: 0 }],
  ["page:Missing", { refs: 0, boards: 0, open: 0, done: 0 }],
  ["uid:zzz", { refs: 0, boards: 0, open: 0, done: 0 }],
];

const ALPHA = {
  ":db/id": 1,
  ":block/_refs": [
    { ":db/id": 11, ":block/parents": [{ ":db/id": 10, ":block/string": "{{[[diagram]]}}" }] },
    { ":db/id": 20, ":block/parents": [
      { ":db/id": 21, ":block/string": "{{diagram}}" },
      { ":db/id": 51, ":block/string": "{{Diagram}}" },
    ] },
    { ":db/id": 20, ":block/parents": [
      { ":db/id": 21, ":block/string": "{{diagram}}" },
      { ":db/id": 51, ":block/string": "{{Diagram}}" },
    ] },
    { ":db/id": 22, ":block/parents": [
      { ":db/id": 23, ":block/string": "Tuesday" },
      { ":db/id": 52, ":block/string": " {{diagram}}" },
    ] },
    { ":db/id": 30, ":block/parents": [
      { ":db/id": 31, ":block/string": "{{[[diagram]]:Nest}}" },
      { ":db/id": 10, ":block/string": "{{[[diagram]]}}" },
    ] },
    { ":db/id": 32, ":block/parents": [{ ":db/id": 21, ":block/string": "{{diagram}}" }] },
    { ":db/id": 10, ":block/parents": [{ ":db/id": 50, ":block/string": "{{[[diagram]]:Parent}}" }] },
    { ":db/id": 34 },
  ],
  ":block/_parents": [
    { ":db/id": 70, ":block/refs": [{ ":db/id": 100 }] },
    { ":db/id": 71, ":block/refs": [{ ":db/id": 100 }, { ":db/id": 101 }] },
    { ":db/id": 72, ":block/refs": [{ ":db/id": 999 }] },
    { ":db/id": 73, ":block/refs": [{ ":db/id": 100 }] },
  ],
  ":block/_page": [
    { ":db/id": 70, ":block/refs": [{ ":db/id": 100 }] },
    { ":db/id": 71, ":block/refs": [{ ":db/id": 100 }, { ":db/id": 101 }] },
    { ":db/id": 72, ":block/refs": [{ ":db/id": 999 }] },
    { ":db/id": 73, ":block/refs": [{ ":db/id": 100 }] },
  ],
};

const NOTE = {
  ":db/id": 2,
  ":block/_refs": [
    { ":db/id": 32, ":block/parents": [{ ":db/id": 21, ":block/string": "{{diagram}}" }] },
    { ":db/id": 33, ":block/parents": [{ ":db/id": 40 }, { ":db/id": 41, ":block/string": "{{diagram}}" }] },
    { ":db/id": 35, ":block/parents": { ":db/id": 42, ":block/string": "{{diagram:Side}}" } },
  ],
  ":block/_parents": [
    { ":db/id": 60, ":block/refs": [{ ":db/id": 100 }] },
    { ":db/id": 61, ":block/refs": [{ ":db/id": 101 }] },
    { ":db/id": 63, ":block/refs": [{ ":db/id": 100 }] },
    { ":db/id": 81, ":block/refs": [{ ":db/id": 101 }, { ":db/id": 101 }] },
    { ":db/id": 82, ":block/refs": [{ ":db/id": 7 }] },
  ],
};

const SOLO = {
  ":db/id": 4,
  ":block/_refs": { ":db/id": 90, ":block/parents": { ":db/id": 91, ":block/string": "{{diagram}}" } },
  ":block/_parents": { ":db/id": 92, ":block/refs": { ":db/id": 100 } },
};

const NODES = new Map([
  [1, ALPHA],
  [2, NOTE],
  [4, SOLO],
  [3, { ":db/id": 3 }],
]);

const REF_ROWS = [
  [1, 20], [1, 22], [1, 32], [1, 34], [1, 20],
  [2, 32], [2, 33], [2, 35],
  [4, 90],
];
const BOARD_ROWS = [
  [1, 21], [1, 31], [1, 50], [1, 21],
  [2, 21], [2, 41], [2, 42],
  [4, 91],
];
const OPEN_ROWS = [
  [1, 70], [1, 71], [1, 73], [1, 70],
  [2, 60], [2, 63],
  [4, 92],
];
const DONE_ROWS = [
  [1, 71],
  [2, 61], [2, 81],
];

const TARGETS = [
  { kind: "page", title: "Alpha" },
  { kind: "block", uid: "note" },
  { kind: "self", uid: "note" },
  { kind: "block", uid: "solo" },
  { kind: "page", title: "Lonely" },
  { kind: "page", title: "Missing" },
  { kind: "block", uid: "zzz" },
  null,
  { kind: "page" },
  { kind: "block" },
];

const TITLES = { Alpha: 1, Lonely: 3, TODO: 100, DONE: 101 };
const UIDS = { note: 2, solo: 4, board: 10 };

function lookup(entity) {
  if (!Array.isArray(entity)) return null;
  const [key, value] = entity;
  if (key === ":node/title") return TITLES[value] ?? null;
  if (key === ":block/uid") return UIDS[value] ?? null;
  return null;
}

function queryRows(text, ...inputs) {
  if (text.includes("(not [?b :block/parents ?board])")) return REF_ROWS;
  if (text.includes("re-find")) return BOARD_ROWS;
  if (inputs[1] === 100) return OPEN_ROWS;
  if (inputs[1] === 101) return DONE_ROWS;
  return [];
}

function createStatsHost({ pullMany, query = queryRows, statPull } = {}) {
  const pulls = [];
  const queries = [];
  const data = {
    pull(pattern, entity) {
      const text = String(pattern);
      pulls.push([text, entity]);
      if (text.includes(":block/_refs")) {
        if (statPull) return statPull(pattern, entity);
        const id = typeof entity === "number" ? entity : null;
        return NODES.get(id) ?? null;
      }
      const id = lookup(entity);
      return id == null ? null : { ":db/id": id };
    },
    q(text, ...inputs) {
      queries.push([String(text), inputs]);
      return query(String(text), ...inputs);
    },
  };
  if (pullMany) data.pull_many = (...args) => pullMany(...args);
  const host = createHost({
    api: { data, util: { generateUID: () => "u" } },
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    graph: "g",
  });
  return { host, pulls, queries, data };
}

function statPulls(pulls) {
  return pulls.filter(([pattern]) => pattern.includes(":block/_refs")).map(([, entity]) => entity);
}

test("pull_many returns the hand-counted map and does not run the collection queries", () => {
  const many = [];
  const { host, queries } = createStatsHost({
    pullMany(pattern, eids) {
      many.push([String(pattern), [...eids]]);
      return [...eids].reverse().map((id) => NODES.get(id) ?? null);
    },
  });
  const stats = host.cardStats(TARGETS, { boardUid: "board" });
  assert.deepEqual([...stats], EXPECTED);
  assert.equal(queries.length, 0);
  assert.equal(many.length, 1);
  assert.match(many[0][0], /:block\/_refs \[:db\/id \{:block\/parents \[:db\/id :block\/string\]\}\]/);
  assert.match(many[0][0], /:block\/_parents \[:db\/id \{:block\/refs \[:db\/id\]\}\]/);
  assert.match(many[0][0], /:block\/_page \[:db\/id \{:block\/refs \[:db\/id\]\}\]/);
  assert.deepEqual(many[0][1], [1, 2, 4, 3]);
  assert.equal(host.stats.writes, 0);
});

test("a repeat call is the cache, and another boardUid pulls again", () => {
  let pulls = 0;
  const { host } = createStatsHost({
    pullMany(_pattern, eids) {
      pulls += 1;
      return eids.map((id) => NODES.get(id) ?? null);
    },
  });
  const first = host.cardStats(TARGETS, { boardUid: "board" });
  const second = host.cardStats(TARGETS, { boardUid: "board" });
  assert.equal(pulls, 1);
  assert.deepEqual([...second], [...first]);
  assert.deepEqual(second.get("page:Alpha"), { refs: 4, boards: 3, open: 3, done: 1 });
  const other = host.cardStats(TARGETS, { boardUid: "other" });
  assert.equal(pulls, 2);
  // Nothing resolves to the other board, so the board block and its descendants count.
  assert.deepEqual(other.get("page:Alpha"), { refs: 7, boards: 4, open: 3, done: 1 });
  assert.deepEqual(other.get("uid:note"), { refs: 3, boards: 3, open: 2, done: 2 });
});

test("nothing resolved does not pull or query, and the zero row stays cached", () => {
  let pulls = 0;
  const { host, queries } = createStatsHost({
    pullMany() { pulls += 1; return []; },
  });
  assert.equal(host.cardStats([]).size, 0);
  assert.equal(host.cardStats([null, { kind: "page" }, { kind: "block" }]).size, 0);
  const missed = host.cardStats([{ kind: "page", title: "Missing" }, { kind: "block", uid: "zzz" }]);
  assert.deepEqual(missed.get("page:Missing"), { refs: 0, boards: 0, open: 0, done: 0 });
  assert.deepEqual(missed.get("uid:zzz"), { refs: 0, boards: 0, open: 0, done: 0 });
  assert.equal(pulls, 0);
  assert.equal(queries.length, 0);
  host.cardStats([{ kind: "page", title: "Missing" }]);
  assert.equal(pulls, 0);
});

test("pull_many throwing falls back to the four queries and the same map", () => {
  const { host, queries, pulls } = createStatsHost({
    pullMany() { throw new Error("datascript"); },
  });
  const stats = host.cardStats(TARGETS, { boardUid: "board" });
  assert.deepEqual([...stats], EXPECTED);
  assert.equal(queries.length, 4);
  assert.equal(statPulls(pulls).length, 0);
  for (const [text, inputs] of queries) {
    assert.match(text, /\[\?t \.\.\.\]/);
    assert.deepEqual(inputs[0], [1, 2, 4, 3]);
  }
  assert.match(queries[0][0], /\(not \[\?b :block\/parents \?board\]\) \[\(not= \?b \?board\)\]/);
  assert.equal(queries[0][1][1], 10);
  assert.match(queries[1][0], /re-find/);
  assert.equal(queries[1][1][1], 10);
  assert.equal(queries[1][1][2], "^\\{\\{(\\[\\[)?diagram");
  assert.match(queries[2][0], /\(or \[\?x :block\/parents \?t\] \[\?x :block\/page \?t\]\)/);
  assert.equal(queries[2][1][1], 100);
  assert.equal(queries[3][1][1], 101);
  host.cardStats(TARGETS, { boardUid: "board" });
  assert.equal(queries.length, 4);
});

test("without pull_many, data.pull runs once per resolved eid", () => {
  const { host, pulls, queries } = createStatsHost();
  const stats = host.cardStats(TARGETS, { boardUid: "board" });
  assert.deepEqual([...stats], EXPECTED);
  assert.deepEqual(statPulls(pulls), [1, 2, 4, 3]);
  assert.equal(queries.length, 0);
});

test("a throwing data.pull falls back to the queries", () => {
  const { host, queries } = createStatsHost({
    statPull() { throw new Error("pull"); },
  });
  const stats = host.cardStats(TARGETS, { boardUid: "board" });
  assert.deepEqual([...stats], EXPECTED);
  assert.equal(queries.length, 4);
});

function pageBoard(n) {
  const fake = createFakeRoam();
  fake.seedBoard({
    uid: "b1",
    children: Array.from({ length: n }, (_, i) => ({ uid: `c${i}`, string: `[[P${i}]]` })),
  });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const calls = [];
  const orig = host.cardStats.bind(host);
  host.cardStats = (targets, opts) => {
    calls.push(targets.length);
    return orig(targets, opts);
  };
  const linked = [];
  fake.onQuery(/:block\/refs \?p/, (_query, titles) => {
    linked.push(titles.length);
    return [];
  });
  return { fake, host, calls, linked };
}

test("a foreground pullBoard reads card stats once", () => {
  const { host, calls } = pageBoard(3);
  host.pullBoard("b1");
  assert.deepEqual(calls, [6]);
});

test("light prime keeps linked-ref chunks and reads every card stat in one idle slice", () => {
  const queued = [];
  const previous = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn, opts) => {
    queued.push({ fn, opts });
    return queued.length;
  };
  try {
    const { host, calls, linked } = pageBoard(41);
    host.pullBoard("b1", { light: true });
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0].opts, { timeout: 1500 });
    assert.deepEqual(calls, []);
    queued[0].fn();
    assert.deepEqual(linked, [40]);
    assert.deepEqual(calls, []);
    assert.equal(queued.length, 2);
    queued[1].fn();
    assert.deepEqual(linked, [40, 1]);
    assert.deepEqual(calls, []);
    assert.equal(queued.length, 3);
    queued[2].fn();
    assert.deepEqual(calls, [82]);
    assert.equal(queued.length, 3);
  } finally {
    globalThis.requestIdleCallback = previous;
  }
});
