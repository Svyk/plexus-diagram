// REG-2: a drag on the image box becomes rx, ry, rw, rh and a k=img string.
import assert from "node:assert/strict";
import test from "node:test";

import { fracFromDrag, imageRegionString } from "../src/model/image-region.js";

const rect = { x: 40, y: 80, width: 200, height: 100 };
const at = (px, py) => [rect.x + rect.width * px, rect.y + rect.height * py];

test("REG-2: 25,30 to 45,55 of the image box is f=0.25,0.3,0.2,0.25", () => {
  const [x0, y0] = at(0.25, 0.3);
  const [x1, y1] = at(0.45, 0.55);
  const frac = fracFromDrag(rect, x0, y0, x1, y1);
  assert.deepEqual(frac, { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 });
  assert.deepEqual(fracFromDrag(rect, x1, y1, x0, y0), frac);
  assert.deepEqual(fracFromDrag({ left: 40, top: 80, width: 200, height: 100 }, x0, y0, x1, y1), frac);
  assert.equal(
    imageRegionString("imgcard01", frac, "hamstring"),
    "{{[[plexus-region]]: k=img d=imgcard01 f=0.25,0.3,0.2,0.25}} hamstring",
  );
});

test("REG-2: points outside the image box clamp before the fraction", () => {
  const frac = fracFromDrag(rect, 20, rect.y + 30, rect.x + 90, rect.y + 55);
  assert.deepEqual(frac, { rx: 0, ry: 0.3, rw: 0.45, rh: 0.25 });
});

test("REG-2: a zero-size drag or a bad rect is null", () => {
  const [x, y] = at(0.25, 0.3);
  assert.equal(fracFromDrag(rect, x, y, x, y), null);
  assert.equal(fracFromDrag({ x: 40, y: 80, width: 0, height: 100 }, x, y, x + 10, y + 10), null);
  assert.equal(fracFromDrag(null, x, y, x + 10, y + 10), null);
});

test("REG-2: a bad uid returns null", () => {
  assert.equal(imageRegionString("bad uid", { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 }, "hamstring"), null);
});
