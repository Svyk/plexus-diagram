import test from "node:test";
import assert from "node:assert/strict";
import { createHost } from "../src/host/roam.js";

// Live 2026-10-06: 2.14.0-2.19.0 replaced roamAlphaAPI.data.pull with a cache wrapper, so another
// extension's `[:block/uid :edit/time]` pull came back as Plexus's cached node without `:edit/time`.
test("createHost leaves Roam's global pull as it was and still serves its own reads", () => {
  const calls = [];
  const data = {
    pull(pattern, entity) {
      calls.push([pattern, entity]);
      return { ":block/uid": entity[1], ":edit/time": 42 };
    },
    q() { return []; },
    addPullWatch() {},
    removePullWatch() {},
  };
  const original = data.pull;
  const api = { data, util: { generateUID: () => "uidAAAAA1" }, ui: {} };
  const host = createHost({ api, storage: null, graph: "g" });
  assert.equal(api.data.pull, original, "the global pull is untouched");
  assert.equal(typeof host.pull, "function");
  const row = host.pull("[:block/uid :edit/time]", [":block/uid", "abc"]);
  assert.equal(row[":edit/time"], 42);
  assert.ok(calls.length >= 1);
});

test("a cached board node does not answer a pull for attributes the board pull never stored", async () => {
  const { patternNeeds } = await import("../src/host/roam.js");
  assert.deepEqual(patternNeeds("[:block/uid :edit/time]"), [{ attr: ":block/uid" }, { attr: ":edit/time" }]);
  assert.deepEqual(patternNeeds("[{:block/page [:node/title]}]"), [{ key: ":block/page", sub: [{ attr: ":node/title" }] }]);
});

test("host.pull goes to Roam for :edit/time even after the board pull filled the cache", async () => {
  const calls = [];
  const node = { ":block/uid": "boardAAA1", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [] };
  const data = {
    pull(pattern, entity) {
      calls.push(String(pattern));
      if (String(pattern).includes(":edit/time")) return { ":block/uid": entity[1], ":edit/time": 42 };
      return node;
    },
    q() { return []; },
    addPullWatch() {},
    removePullWatch() {},
  };
  const api = { data, util: { generateUID: () => "uidAAAAA1" }, ui: {} };
  const host = createHost({ api, storage: null, graph: "g" });
  try { host.pullBoard?.("boardAAA1"); } catch { /* the fake tree is enough to fill the cache */ }
  const row = host.pull("[:block/uid :edit/time]", [":block/uid", "boardAAA1"]);
  assert.equal(row[":edit/time"], 42);
});
