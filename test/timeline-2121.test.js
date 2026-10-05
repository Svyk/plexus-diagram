import assert from "node:assert/strict";
import test from "node:test";

import { edgeHidden, laneSets, monthSteps, playMs, previewLayout, timeIndex } from "../src/model/timeline.js";

test("a two-year play finishes under 20 seconds", () => {
  const start = new Date(2024, 0, 1).getTime();
  const end = new Date(2026, 0, 1).getTime();
  const steps = monthSteps(start, end);
  assert.equal(steps[0], start);
  assert.equal(steps[steps.length - 1], end);
  assert.ok(playMs(start, end) < 20000, String(playMs(start, end)));
  assert.equal(monthSteps(end, start).length, 1);
});

test("the start thumb hides later cards and their connections", () => {
  const index = timeIndex([
    { uid: "a", time: 10, kind: "card" },
    { uid: "b", time: 50, kind: "card" },
    { uid: "skip", time: null },
  ]);
  assert.deepEqual(index.map((row) => row.uid), ["a", "b"]);
  const atStart = laneSets(index, 10);
  assert.deepEqual(atStart.future, ["b"]);
  assert.deepEqual(atStart.fresh, ["a"]);
  assert.deepEqual(edgeHidden([{ uid: "e", from: "a", to: "b", time: 50 }], atStart.future, 10), ["e"]);
  const atEnd = laneSets(index, 50);
  assert.deepEqual(atEnd.future, []);
  assert.deepEqual(edgeHidden([{ uid: "e", from: "a", to: "b", time: 50 }], atEnd.future, 50), []);
});

test("a snapshot preview records positions and writes nothing", () => {
  const got = previewLayout([{ uid: "a", x: 10, y: 20, w: 30, h: 40 }, { uid: "bad", x: NaN, y: 1 }]);
  assert.equal(got.writes, 0);
  assert.deepEqual(got.layout.get("a"), { x: 10, y: 20, w: 30, h: 40 });
  assert.equal(got.layout.has("bad"), false);
});
