import assert from "node:assert/strict";
import test from "node:test";

import { uidFromBlockInputId } from "../src/discovery.js";

test("PERF-10: an element id resolves its uid with one batched read", () => {
  const id = "block-input-6sW6RitOQegKal2aRqf6pKUspse2-body-outline-cBcc5sooz-lwL5UW2Ye";
  let single = 0;
  let batches = 0;
  const isDiagramUid = () => { single += 1; return false; };
  isDiagramUid.many = (candidates) => {
    batches += 1;
    assert.equal(candidates[0], "lwL5UW2Ye", "the shortest suffix is tried first");
    return candidates.includes("lwL5UW2Ye") ? "lwL5UW2Ye" : null;
  };
  assert.equal(uidFromBlockInputId(id, isDiagramUid), "lwL5UW2Ye");
  assert.equal(batches, 1);
  assert.equal(single, 0);
});

test("PERF-10: without a batch reader each candidate is checked in order", () => {
  const seen = [];
  const isDiagramUid = (uid) => { seen.push(uid); return uid === "abc-def"; };
  assert.equal(uidFromBlockInputId("block-input-user-page-abc-def", isDiagramUid), "abc-def");
  assert.deepEqual(seen, ["def", "abc-def"]);
});
