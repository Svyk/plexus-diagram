import assert from "node:assert/strict";
import test from "node:test";

import { isDiagramString } from "../src/discovery.js";

test("isDiagramString accepts diagram macros", () => {
  assert.equal(isDiagramString("{{[[diagram]]}}"), true);
  assert.equal(isDiagramString("{{[[diagram]]:High APC}}"), true);
  assert.equal(isDiagramString("{{diagram}}"), true);
});

test("isDiagramString rejects other block types", () => {
  assert.equal(isDiagramString("{{[[table]]}}"), false);
  assert.equal(isDiagramString("```mermaid\ngraph TD\nA-->B\n```"), false);
  assert.equal(isDiagramString(""), false);
});
