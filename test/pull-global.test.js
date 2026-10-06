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
