import assert from "node:assert/strict";
import test from "node:test";

import { enhancedUidGuardCss } from "../src/discovery.js";

test("enhancedUidGuardCss targets rm-diagram hosts for a uid", () => {
  const css = enhancedUidGuardCss(new Set(["abc123"]));
  assert.match(css, /\.rm-diagram/);
  assert.match(css, /abc123/);
  assert.match(css, /\[id\$="abc123"\]/);
  assert.doesNotMatch(css, /overflow:\s*visible/);
});

test("enhancedUidGuardCss caps over-budget uid sets", () => {
  const over = new Set(Array.from({ length: 2001 }, (_, index) => `uid${index}`));
  assert.equal(enhancedUidGuardCss(over), "");
});
