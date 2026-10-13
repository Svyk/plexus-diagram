import test from "node:test";
import assert from "node:assert/strict";
import { cloneTree } from "../src/session.js";

test("cloneTree copies a pull tree deeply and drops undefined fields like a JSON round trip", () => {
  const tree = { ":block/uid": "a", ":block/props": { ":plexus": { ":x": 1, ":tags": ["p", undefined] } }, gone: undefined, ":block/children": [{ ":block/uid": "b", ":block/string": "s" }] };
  const copy = cloneTree(tree);
  assert.deepEqual(copy, JSON.parse(JSON.stringify(tree)));
  assert.notEqual(copy[":block/children"][0], tree[":block/children"][0]);
  assert.notEqual(copy[":block/props"][":plexus"], tree[":block/props"][":plexus"]);
  assert.equal("gone" in copy, false);
});

test("cloneTree is fast on a 20k-block tree", () => {
  const card = (i) => ({ ":block/uid": `c${i}`, ":block/string": `card ${i}`, ":block/order": i, ":block/props": { ":plexus": { ":x": i, ":y": i, ":w": 200, ":h": 100 } }, ":block/children": [{ ":block/uid": `k${i}`, ":block/string": "kid", ":block/order": 0 }] });
  const tree = { ":block/uid": "root", ":block/children": Array.from({ length: 10000 }, (_, i) => card(i)) };
  cloneTree(tree);
  const t0 = performance.now();
  for (let i = 0; i < 5; i += 1) cloneTree(tree);
  const ours = (performance.now() - t0) / 5;
  const t1 = performance.now();
  for (let i = 0; i < 5; i += 1) JSON.parse(JSON.stringify(tree));
  const json = (performance.now() - t1) / 5;
  assert.ok(ours < json / 2, `cloneTree ${ours.toFixed(1)} ms vs JSON ${json.toFixed(1)} ms`);
});
