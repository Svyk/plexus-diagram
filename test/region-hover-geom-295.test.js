// REG-5. Veil boxes and the region or view camera. Numbers come from the exports.
import assert from "node:assert/strict";
import test from "node:test";

import {
  cameraRectOf,
  holeRect,
  previewImageBox,
  regionCamera,
  regionZoom,
  setCameraFromView,
} from "../src/view/region-hover-geom.js";

const board = { width: 800, height: 600 };
const frac = [0.25, 0.3, 0.2, 0.25];
const fracObj = { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 };

test("REG-5: previewImageBox scales 1600 by 1000 to 480 by 300 and does not upscale", () => {
  assert.deepEqual(previewImageBox(1600, 1000, 480), { w: 480, h: 300, scale: 0.3 });
  assert.deepEqual(previewImageBox(1000, 2000, 480), { w: 240, h: 480, scale: 0.24 });
  assert.deepEqual(previewImageBox(320, 200, 480), { w: 320, h: 200, scale: 1 });
  assert.equal(previewImageBox(0, 1000, 480), null);
  assert.equal(previewImageBox(1600, 0, 480), null);
});

test("REG-5: holeRect reads f as an array or an object", () => {
  const box = previewImageBox(1600, 1000, 480);
  const hole = { x: 120, y: 90, w: 96, h: 75 };
  assert.deepEqual(holeRect(box, frac), hole);
  assert.deepEqual(holeRect(box, fracObj), hole);
});

test("REG-5: region zoom uses the image box", () => {
  assert.equal(regionZoom(100, 80), 3);
  assert.equal(regionZoom(40, 80), 4);
  assert.ok(40 * regionZoom(40, 80) < 240);
  assert.equal(regionZoom(200, 200), 1.2);
  assert.equal(200 * regionZoom(200, 200), 240);

  const hundred = regionCamera({
    imageRect: { x: 0, y: 0, w: 400, h: 400 },
    frac: [0, 0, 0.25, 0.2],
    size: board,
  });
  assert.deepEqual(hundred, { x: 250, y: 180, zoom: 3 });
  assert.equal(hundred.zoom, regionZoom(100, 80));

  const forty = regionCamera({
    imageRect: { x: 10, y: 20, w: 200, h: 100 },
    frac: { rx: 0, ry: 0, rw: 0.2, rh: 0.4 },
    size: board,
  });
  assert.equal(forty.zoom, 4);
  assert.deepEqual(forty, { x: 280, y: 140, zoom: 4 });
  assert.ok(40 * forty.zoom < 240);

  const off = regionCamera({
    imageRect: { x: 0, y: 0, w: 1000, h: 500 },
    frac: { rx: 0.1, ry: 0.2, rw: 0.2, rh: 0.4 },
    size: board,
  });
  assert.deepEqual(off, { x: 160, y: 60, zoom: 1.2 });
});

test("REG-5: setCameraFromView pins v and cameraRectOf is that visible rect", () => {
  const v = [10, 20, 400, 300];
  const cam = setCameraFromView(v, board);
  assert.deepEqual(cam, { x: -20, y: -40, zoom: 2 });
  assert.deepEqual(setCameraFromView({ x: 10, y: 20, w: 400, h: 300 }, board), cam);
  assert.deepEqual(cameraRectOf(cam, board), { x: 10, y: 20, w: 400, h: 300 });

  const short = { width: 800, height: 200 };
  const fitted = setCameraFromView(v, short);
  const vis = cameraRectOf(fitted, short);
  assert.deepEqual(vis, { x: 10, y: 20, w: 1200, h: 300 });
  assert.ok(vis.h === 300 && vis.w > 400);

  const clamped = setCameraFromView([0, 0, 10, 10], board);
  assert.equal(clamped.zoom, 4);
  assert.deepEqual(cameraRectOf(clamped, board), { x: 0, y: 0, w: 200, h: 150 });
});
