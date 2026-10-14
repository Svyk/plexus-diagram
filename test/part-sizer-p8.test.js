// P8 U2: background parts sized from their measured cost so a part fits what is left of the slice.
import assert from "node:assert/strict";
import test from "node:test";
import { createPartSizer } from "../src/part-sizer.js";

test("part sizer: starts small, grows to fit cheap items, shrinks after an expensive part", () => {
  const s = createPartSizer({ max: 30, start: 4 });
  assert.equal(s.size(30), 4, "no measure yet: the start size");
  s.note(4, 2); // 0.5 ms each
  assert.equal(s.size(30), 30, "cheap: capped at max");
  s.note(30, 300); // 10 ms each
  const n = s.size(30);
  assert.ok(n >= 1 && n <= 4, `expensive: a few (${n})`);
  assert.equal(s.size(0), 1, "always one at least");
});
