import assert from "node:assert/strict";
import test from "node:test";

import { arrowheadPoints, bezierPath, buildEdgePath, elbowPath, straightPath } from "../src/edges.js";

const source = { x: 0, y: 0, width: 100, height: 80 };
const target = { x: 200, y: 120, width: 100, height: 80 };

test("path helpers return SVG d strings", () => {
  assert.match(straightPath(0, 0, 10, 10), /^M 0 0 L 10 10$/);
  assert.match(bezierPath(0, 0, 10, 10), /^M 0 0 C /);
  assert.match(elbowPath(0, 0, 10, 10), /^M 0 0 L /);
});

test("buildEdgePath switches on connector style", () => {
  assert.match(buildEdgePath("straight", source, target), /^M /);
  assert.match(buildEdgePath("elbow", source, target), /^M /);
  assert.match(buildEdgePath("bezier", source, target), /^M /);
});

test("arrowheadPoints follows setting", () => {
  assert.deepEqual(arrowheadPoints("end"), { start: false, end: true });
  assert.deepEqual(arrowheadPoints("both"), { start: true, end: true });
  assert.deepEqual(arrowheadPoints("none"), { start: false, end: false });
});
