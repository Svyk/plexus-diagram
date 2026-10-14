// P10. Overview live does not wait for every map-tier shell. Background slices stay small.
import assert from "node:assert/strict";
import test from "node:test";

import { defaultSpeedFlags, parseSpeedFlags } from "../src/settings.js";

test("overviewFast defaults on and parses off", () => {
  assert.equal(defaultSpeedFlags().overviewFast, true);
  assert.equal(parseSpeedFlags('{"overviewFast":false}').overviewFast, false);
  assert.equal(parseSpeedFlags({}).overviewFast, true);
});
