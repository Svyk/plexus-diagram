import assert from "node:assert/strict";
import test from "node:test";

import {
  arrowheadMarkerId,
  arrowheadPoints,
  arrowheadSize,
  bezierPath,
  buildEdgePath,
  directionToPoints,
  edgeEndpoints,
  edgeMidpoint,
  effectiveDirection,
  elbowPath,
  shouldRescaleMarkers,
  straightPath,
} from "../src/edges.js";

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

test("edgeMidpoint is the midpoint of the connector endpoints", () => {
  const mid = edgeMidpoint(source, target);
  assert.equal(typeof mid.x, "number");
  assert.equal(typeof mid.y, "number");
  assert.ok(mid.x > source.x);
  assert.ok(mid.x < target.x + target.width);
});

test("edgeEndpoints uses port sides", () => {
  const endpoints = edgeEndpoints(source, target, "right", "left");
  assert.equal(endpoints.sx, 100);
  assert.equal(endpoints.sy, 40);
  assert.equal(endpoints.tx, 200);
  assert.equal(endpoints.ty, 160);

  const topAuto = edgeEndpoints(source, target, "top", "auto");
  assert.equal(topAuto.sx, 50);
  assert.equal(topAuto.sy, 0);
  assert.equal(topAuto.tx, 200);
  assert.equal(topAuto.ty, 160);
});

test("bezierPath from top exits upward", () => {
  const path = bezierPath(50, 0, 200, 160, "top", "left");
  const match = path.match(/^M (\S+) (\S+) C (\S+) (\S+),/);
  assert.ok(match);
  const sy = Number(match[2]);
  const c1y = Number(match[4]);
  assert.ok(c1y < sy);
});

test("arrowheadMarkerId is scoped per canvas", () => {
  assert.equal(arrowheadMarkerId("end", "pxdA", "teal"), "pxd-arrow-end-pxdA-teal");
  assert.notEqual(arrowheadMarkerId("end", "pxdA", "teal"), arrowheadMarkerId("end", "pxdB", "teal"));
});

test("arrowheadSize clamps with zoom", () => {
  assert.equal(arrowheadSize(0.4), 24);
  assert.equal(arrowheadSize(1), 10);
  assert.equal(arrowheadSize(3), 6);
});

test("shouldRescaleMarkers at 5 percent threshold", () => {
  assert.equal(shouldRescaleMarkers(1, 1.03), false);
  assert.equal(shouldRescaleMarkers(1, 1.06), true);
});

test("effectiveDirection prefers explicit edge direction", () => {
  assert.equal(effectiveDirection({}, "end"), "oneWay");
  assert.equal(effectiveDirection({ direction: "none" }, "end"), "none");
});

test("directionToPoints maps direction to marker sides", () => {
  assert.deepEqual(directionToPoints("oneWay"), { start: false, end: true });
  assert.deepEqual(directionToPoints("twoWay"), { start: true, end: true });
  assert.deepEqual(directionToPoints("none"), { start: false, end: false });
});
