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
  // Best of several runs each, so a busy machine does not decide the comparison.
  const best = (fn) => {
    let min = Infinity;
    for (let i = 0; i < 7; i += 1) {
      const t = performance.now();
      fn();
      min = Math.min(min, performance.now() - t);
    }
    return min;
  };
  const ours = best(() => cloneTree(tree));
  const json = best(() => JSON.parse(JSON.stringify(tree)));
  assert.ok(ours < json / 2, `cloneTree ${ours.toFixed(1)} ms vs JSON ${json.toFixed(1)} ms`);
});
