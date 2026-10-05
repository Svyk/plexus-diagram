import assert from "node:assert/strict";
import test from "node:test";

import { becauseClause, readWhy, whyPlan, whyTip } from "../src/model/why.js";

test("the first non-attribute child is the why", () => {
  const got = readWhy([
    { uid: "a1", string: "Owner:: Ada" },
    { uid: "w1", string: "seal temp drifted" },
    { uid: "n1", string: "later note" },
  ]);
  assert.deepEqual(got, { uid: "w1", text: "seal temp drifted" });
  assert.equal(readWhy([{ uid: "a1", ":block/string": "Kind:: edge", ":block/uid": "a1" }]), null);
  assert.equal(readWhy([]), null);
});

test("an empty why writes nothing, and a filled why follows the label", () => {
  assert.deepEqual(whyPlan({ label: "causes", why: "", prevLabel: "", prevWhy: "" }), [
    { op: "label", label: "causes" },
  ]);
  assert.deepEqual(whyPlan({ label: "causes", why: "seal temp drifted", prevLabel: "causes", prevWhy: "" }), [
    { op: "why", text: "seal temp drifted" },
  ]);
  assert.deepEqual(whyPlan({ label: "causes", why: "seal temp drifted", prevLabel: "", prevWhy: "" }), [
    { op: "label", label: "causes" },
    { op: "why", text: "seal temp drifted" },
  ]);
  assert.deepEqual(whyPlan({ label: "causes", why: "  ", prevLabel: "causes", prevWhy: "old" }), [
    { op: "clear" },
  ]);
});

test("the chip clause clips at 48 and the tip clips at 200", () => {
  assert.equal(becauseClause("seal temp drifted"), " · because seal temp drifted");
  assert.equal(becauseClause(""), "");
  assert.equal(becauseClause("x".repeat(60)).length, " · because ".length + 48);
  assert.equal(whyTip("y".repeat(250)).length, 200);
});
