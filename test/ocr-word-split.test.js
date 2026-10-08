import assert from "node:assert/strict";
import { test } from "node:test";

import { padWhite } from "../src/model/ocr/image.js";
import { widthBatches } from "../src/model/ocr/recognize.js";
import { inkProjection, inkRows, inkRuns, innerGaps, segmentLine, sizeFromInk, snapWords } from "../src/model/ocr/word-split.js";
import { baselineRows, rowBaseline } from "../src/model/ocr/words-from-ctc.js";

// A page mask with filled rectangles [x0, y0, x1, y1).
function maskWith(w, h, rects) {
  const mask = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
  }
  return mask;
}

test("inkRuns splits at gaps of at least minGap and drops specks", () => {
  const cols = Uint16Array.from([0, 3, 3, 0, 3, 0, 0, 0, 0, 3, 3, 0, 1]);
  assert.deepEqual(inkRuns(cols, 3, 2).map((r) => [r.x0, r.x1]), [[1, 5], [9, 13]]);
  assert.deepEqual(inkRuns(cols, 1, 2).map((r) => [r.x0, r.x1]), [[1, 3], [4, 5], [9, 11]]);
});

test("innerGaps lists empty-column runs strictly inside a span", () => {
  const cols = Uint16Array.from([2, 0, 0, 2, 2, 0, 2]);
  assert.deepEqual(innerGaps(cols, 0, 7), [{ x0: 1, x1: 3, w: 2 }, { x0: 5, x1: 6, w: 1 }]);
});

test("segmentLine splits two words at a wide gap and ignores a ruling row", () => {
  const w = 200;
  const h = 40;
  // Two 20 px tall "words" with a 30 px gap, and a full-width rule under them.
  const mask = maskWith(w, h, [[10, 10, 60, 30], [90, 10, 150, 30], [0, 35, 200, 37]]);
  const split = segmentLine(mask, w, h, { x0: 0, y0: 5, x1: 200, y1: 38 }, { gapRatio: 0.9 });
  assert.deepEqual(split.segments.map((s) => [s.x0, s.x1]), [[10, 60], [90, 150]]);
  assert.equal(split.inkH, 20);
  assert.equal(split.segments[0].ink.base, 30);
  // A gap narrower than 0.9 × ink height keeps one segment.
  const tight = segmentLine(maskWith(w, h, [[10, 10, 60, 30], [70, 10, 150, 30]]), w, h, { x0: 0, y0: 5, x1: 200, y1: 38 }, { gapRatio: 0.9 });
  assert.equal(tight.segments.length, 1);
});

test("inkProjection blanks a vertical rule so it cannot bridge two words", () => {
  const w = 100;
  const h = 30;
  const mask = maskWith(w, h, [[5, 8, 30, 22], [49, 0, 51, 30], [70, 8, 95, 22]]);
  const proj = inkProjection(mask, w, h, { x0: 0, y0: 0, x1: 100, y1: 30 });
  assert.equal(proj.cols[50], 0);
  const split = segmentLine(mask, w, h, { x0: 0, y0: 0, x1: 100, y1: 30 }, { gapRatio: 0.9 });
  assert.deepEqual(split.segments.map((s) => [s.x0, s.x1]), [[5, 30], [70, 95]]);
});

test("inkRows keeps a descender out of the baseline and the line above out of the crop", () => {
  const w = 60;
  const h = 40;
  // Row 0-2: tail of the line above. Body 10..25, one thin descender 25..30.
  const mask = maskWith(w, h, [[0, 0, 40, 2], [5, 10, 55, 25], [20, 25, 22, 30]]);
  const proj = inkProjection(mask, w, h, { x0: 0, y0: 0, x1: 60, y1: 40 });
  const rows = inkRows(mask, w, proj, 0, 60);
  assert.equal(rows.base, 25);
  assert.equal(rows.top, 10);
  assert.equal(rows.bottom, 30);
});

test("snapWords puts word edges on the projection's inner gaps", () => {
  const w = 120;
  const h = 20;
  const mask = maskWith(w, h, [[10, 4, 40, 16], [48, 4, 100, 16]]);
  const proj = inkProjection(mask, w, h, { x0: 0, y0: 0, x1: 120, y1: 20 });
  const seg = { cols: [10, 100] };
  // CTC put the break near column 45; the gap is 40..48.
  const words = snapWords([{ text: "ab", c0: 11, c1: 41 }, { text: "cde", c0: 49, c1: 98 }], seg, proj);
  assert.deepEqual(words, [{ text: "ab", x0: 10, x1: 40 }, { text: "cde", x0: 48, x1: 100 }]);
  assert.deepEqual(snapWords([{ text: "x", c0: 12, c1: 90 }], seg, proj), [{ text: "x", x0: 10, x1: 100 }]);
});

test("sizeFromInk reads cap height or ascender-to-descender", () => {
  assert.equal(sizeFromInk("1980", 7), 10);
  assert.equal(sizeFromInk("Weekly", 9.5), 10);
  assert.equal(sizeFromInk("one", 5), null);
  assert.equal(sizeFromInk("A", 0), null);
});

test("widthBatches groups crops of similar width and caps the batch size", () => {
  const widths = [100, 2000, 110, 120, 400, 105];
  const batches = widthBatches(widths, 2);
  assert.deepEqual(batches, [[0, 5], [2, 3], [4], [1]]);
  for (const batch of widthBatches(widths, 16)) {
    const ws = batch.map((k) => widths[k]);
    assert.ok(Math.max(...ws) <= 1.3 * Math.min(...ws) + 16);
  }
});

test("baselineRows and rowBaseline ignore a superscript mark", () => {
  const item = (str, base, width) => ({ str, width, transform: [7, 0, 0, 7, 0, base] });
  const sorted = [item("Chancroid", 76.3, 25), item("*", 79.9, 2), item("Chickenpox", 81.8, 29), item("96.69", 82.06, 14)];
  const rows = baselineRows(sorted);
  assert.deepEqual(rows.map((r) => r.map((i) => i.str)), [["Chancroid"], ["*", "Chickenpox", "96.69"]]);
  assert.equal(rowBaseline(rows[1]), 81.8);
});

test("padWhite pads x and y separately", () => {
  const rgb = new Uint8Array([0, 0, 0]);
  const out = padWhite(rgb, 1, 1, 2, 1);
  assert.equal(out.w, 5);
  assert.equal(out.h, 3);
  assert.equal(out.rgb[(1 * 5 + 2) * 3], 0);
  assert.equal(out.rgb[0], 255);
});
