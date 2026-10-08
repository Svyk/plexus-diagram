import assert from "node:assert/strict";
import { test } from "node:test";

import { baselineSkew, rotateItems } from "../src/model/ocr/fine-skew.js";
import { rotateRgb } from "../src/model/ocr/image.js";

function item(str, x, base, size = 8, width = 30) {
  return { str, transform: [size, 0, 0, size, x, base], width, height: size, y0: base - 0.8 * size, y1: base + 0.22 * size };
}

// Rows of words whose baselines fall by tan(deg) per point to the right.
function skewedPage(deg) {
  const slope = Math.tan(deg * Math.PI / 180);
  const items = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    const x = 50 + c * 80;
    items.push(item(`w${r}${c}`, x, 100 + r * 30 + (x + 15) * slope));
  }
  return items;
}

test("baselineSkew reads the residual angle of long rows", () => {
  const a = baselineSkew(skewedPage(0.17));
  assert.ok(Math.abs(a - 0.17) < 0.005, String(a));
  assert.ok(Math.abs(baselineSkew(skewedPage(-0.3)) + 0.3) < 0.005);
  assert.equal(baselineSkew([item("a", 10, 10), item("b", 50, 10)]), null, "too few rows");
});

test("rotateItems flattens the rows in the frame rotateRgb draws", () => {
  const items = skewedPage(0.2);
  const w = 2550;
  const h = 3300;
  const scale = 300 / 72;
  rotateItems(items, 0.2, w, h, scale, scale);
  assert.ok(Math.abs(baselineSkew(items)) < 0.01);
  // A dark pixel at a word's baseline start lands where rotateItems puts the word.
  const small = 200;
  const rgb = new Uint8Array(small * small * 3).fill(255);
  const px = 150;
  const py = 60;
  for (let k = 0; k < 3; k++) rgb[(py * small + px) * 3 + k] = 0;
  const turned = rotateRgb(rgb, small, small, 3);
  const [moved] = rotateItems([item("x", px, py)], 3, small, small, 1, 1);
  const at = (Math.round(moved.transform[5]) * small + Math.round(moved.transform[4])) * 3;
  assert.ok(turned.rgb[at] < 200, `pixel ${turned.rgb[at]} at ${moved.transform[4]},${moved.transform[5]}`);
});
