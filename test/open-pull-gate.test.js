import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { OPEN_PULL_MAX_REFS, createHost, refBlocksOf } from "../src/host/roam.js";

const card = (i, string) => ({ ":block/uid": `c${i}`, ":block/string": string, ":block/order": i, ":block/children": [] });
const board = (n, string) => ({ ":block/uid": "bigBoard1", ":block/string": "{{[[diagram]]:Big}}", ":block/children": Array.from({ length: n }, (_, i) => card(i, string(i))) });

test("refBlocksOf counts blocks whose text names a page, block, tag or attribute, and stops past the cap", () => {
  const tree = board(10, (i) => (i % 2 ? `see [[P${i}]]` : "plain"));
  tree[":block/children"][0][":block/children"] = [card(99, "((abc))"), card(98, "a:: b"), card(97, "#tag")];
  assert.equal(refBlocksOf(tree), 8);
  assert.equal(refBlocksOf(board(500, () => "[[X]]"), 20), 21);
});

test("a board with many ref blocks skips the wide OPEN pull and keeps the structure pull", () => {
  const fake = createFakeRoam();
  const tree = board(OPEN_PULL_MAX_REFS + 5, (i) => `((r${i})) → x → [[Page ${i}]]`);
  const patterns = [];
  const orig = fake.api.data.pull.bind(fake.api.data);
  fake.api.data.pull = (pattern, entity) => {
    if (Array.isArray(entity) && entity[1] === "bigBoard1") {
      patterns.push(String(pattern).includes(":block/refs") ? "open" : "board");
      return tree;
    }
    return orig(pattern, entity);
  };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const node = host.pullBoard("bigBoard1");
  assert.equal(node?.[":block/uid"], "bigBoard1");
  assert.deepEqual(patterns, ["board"]);
});

test("a board with a few ref blocks still takes the wide OPEN pull", () => {
  const fake = createFakeRoam();
  const tree = board(5, (i) => `[[Page ${i}]]`);
  const patterns = [];
  const orig = fake.api.data.pull.bind(fake.api.data);
  fake.api.data.pull = (pattern, entity) => {
    if (Array.isArray(entity) && entity[1] === "bigBoard1") {
      patterns.push(String(pattern).includes(":block/refs") ? "open" : "board");
      return tree;
    }
    return orig(pattern, entity);
  };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.pullBoard("bigBoard1");
  assert.deepEqual(patterns, ["board", "open"]);
});

test("a keep-alive catch-up pull reads the board's refs in the first idle slice, not inline", () => {
  const fake = createFakeRoam();
  fake.seedPage({ title: "Ref page", uid: "refPage01" });
  fake.seedBoard({ uid: "catchUp1", props: { plexus: { v: 2 } }, children: [{ uid: "cardRef01", string: "[[Ref page]]", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } }] });
  const queued = [];
  const previous = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  try {
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    let many = 0;
    const pm = fake.api.data.pull_many;
    fake.api.data.pull_many = (...args) => { many += 1; return pm.apply(fake.api.data, args); };
    host.pullBoard("catchUp1", { light: true, deferRefs: true });
    assert.equal(many, 0);
    queued.shift()();
    assert.ok(many >= 1);
  } finally {
    globalThis.requestIdleCallback = previous;
  }
});
