import assert from "node:assert/strict";
import test from "node:test";

import { LINKED_REF_CAP, linkedRefCard, linkedRefLabel } from "../src/model/refs.js";

test("linkedRefLabel pluralizes the capped count", () => {
  assert.equal(LINKED_REF_CAP, 20);
  assert.equal(linkedRefLabel(0), "0 linked references");
  assert.equal(linkedRefLabel(1), "1 linked reference");
  assert.equal(linkedRefLabel(2), "2 linked references");
  assert.equal(linkedRefLabel(1.9), "1 linked reference");
  assert.equal(linkedRefLabel(-3), "0 linked references");
});

test("linkedRefCard wraps a Roam uid and rejects anything else", () => {
  assert.equal(linkedRefCard("srcBlock1"), "((srcBlock1))");
  assert.equal(linkedRefCard("-abcDEF12"), "((-abcDEF12))");
  assert.equal(linkedRefCard("short"), null);
  assert.equal(linkedRefCard("has space"), null);
  assert.equal(linkedRefCard(""), null);
  assert.equal(linkedRefCard(null), null);
});
