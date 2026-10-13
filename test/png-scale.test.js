// verify 3.28: "Export as PNG" of PhD MAIN (22,020 x 13,050 board px) failed: rasterizeSvg drew it at 2x, a 44,040 x
// 26,100 canvas, past Chrome's canvas limits, so toBlob gave null ("PNG failed"). The scale now fits the limits.
import assert from "node:assert/strict";
import test from "node:test";
import { PNG_MAX_AREA, PNG_MAX_SIDE, pngScale } from "../src/view/board-view.js";

test("a small board exports at 2x", () => {
  assert.equal(pngScale(800, 600), 2);
});

test("a huge board is scaled down to fit the canvas limits", () => {
  const s = pngScale(22020, 13050);
  assert.ok(s > 0 && s < 2);
  assert.ok(Math.round(22020 * s) <= PNG_MAX_SIDE && Math.round(13050 * s) <= PNG_MAX_SIDE);
  assert.ok(Math.round(22020 * s) * Math.round(13050 * s) <= PNG_MAX_AREA);
});

test("a long thin board keeps each side under the limit", () => {
  const s = pngScale(60000, 500);
  assert.ok(Math.round(60000 * s) <= PNG_MAX_SIDE);
});
