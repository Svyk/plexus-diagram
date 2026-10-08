import assert from "node:assert/strict";
import { test } from "node:test";

import { padWhite } from "../src/model/ocr/image.js";
import { detLimitFor, widthBatches } from "../src/model/ocr/recognize.js";
import { acceptOrphanRead, blobBaseline, coverMask, dashFromShape, orphanBlobs } from "../src/model/ocr/orphans.js";
import { dashRuns, inkProjection, inkRows, inkRuns, innerGaps, joinNumberWords, localMask, segmentLine, sizeFromInk, snapWords } from "../src/model/ocr/word-split.js";
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
  assert.equal(sizeFromInk("1980", 6.4), 10);
  assert.equal(sizeFromInk("Weekly", 6.4), 10);
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

test("inkRows skips an underline so the baseline is the glyphs'", () => {
  const w = 60;
  const h = 40;
  const mask = maskWith(w, h, [[5, 8, 15, 28], [20, 8, 30, 28], [35, 8, 45, 28], [2, 30, 58, 32]]);
  const proj = inkProjection(mask, w, h, { x0: 0, y0: 0, x1: 60, y1: 40 });
  const rows = inkRows(mask, w, proj, 2, 58);
  assert.equal(rows.base, 28);
  assert.equal(rows.top, 8);
});

test("dashRuns finds a free-standing dash between glyphs, not an H crossbar", () => {
  const w = 120;
  const h = 40;
  // "1" stem, gap, dash at mid height, gap, "2" stem. Baseline 30, cap height 20.
  const mask = maskWith(w, h, [[10, 10, 14, 30], [18, 19, 30, 22], [34, 10, 38, 30]]);
  const proj = inkProjection(mask, w, h, { x0: 0, y0: 0, x1: 120, y1: 40 });
  assert.deepEqual(dashRuns(mask, w, proj, 10, 38, 30, 20), [{ c0: 18, c1: 30 }]);
  const hbar = maskWith(w, h, [[10, 10, 14, 30], [14, 19, 26, 22], [26, 10, 30, 30]]);
  const projH = inkProjection(hbar, w, h, { x0: 0, y0: 0, x1: 120, y1: 40 });
  assert.deepEqual(dashRuns(hbar, w, projH, 10, 30, 30, 20), []);
});

test("joinNumberWords rejoins a thousands group, not a date", () => {
  const words = [{ text: "348,", x0: 0, x1: 30, conf: 1 }, { text: "928", x0: 33, x1: 55, conf: 0.9 }];
  assert.deepEqual(joinNumberWords(words, 5), [{ text: "348,928", x0: 0, x1: 55, conf: 0.9 }]);
  const date = [{ text: "21,", x0: 0, x1: 20, conf: 1 }, { text: "2010", x0: 23, x1: 50, conf: 1 }];
  assert.equal(joinNumberWords(date, 5).length, 2);
  assert.equal(joinNumberWords(words, 2).length, 2);
});

test("localMask binarises a shaded cell with its own threshold", () => {
  const w = 20;
  const h = 10;
  const gray = new Uint8Array(w * h).fill(120);
  for (let y = 3; y < 7; y++) for (let x = 5; x < 9; x++) gray[y * w + x] = 10;
  const mask = new Uint8Array(w * h).fill(1);
  assert.equal(localMask(gray, mask, w, h, { x0: 0, y0: 0, x1: 20, y1: 10 }), true);
  assert.equal(mask[0], 0);
  assert.equal(mask[4 * w + 6], 1);
  const flat = new Uint8Array(w * h).fill(200);
  assert.equal(localMask(flat, new Uint8Array(w * h), w, h, { x0: 0, y0: 0, x1: 20, y1: 10 }), false);
});

test("detLimitFor scales the det map toward the target box height", () => {
  assert.equal(detLimitFor(13.5, 1600, 3300), 3200);
  assert.equal(detLimitFor(27, 1600, 3300), 1600);
  assert.equal(detLimitFor(54, 1600, 3300), 960);
  assert.equal(detLimitFor(10, 1600, 1200), 1200);
});

test("orphanBlobs keeps uncovered text-sized ink and groups a number's digits", () => {
  const w = 200;
  const h = 100;
  const comps = [
    { area: 60, x0: 10, y0: 40, x1: 14, y1: 59 },
    { area: 60, x0: 18, y0: 40, x1: 22, y1: 59 },
    { area: 40, x0: 80, y0: 50, x1: 92, y1: 52 },
    { area: 2, x0: 150, y0: 10, x1: 150, y1: 10 },
    { area: 600, x0: 0, y0: 90, x1: 199, y1: 92 },
    { area: 60, x0: 120, y0: 40, x1: 124, y1: 59 },
  ];
  const covered = coverMask([{ x0: 115, y0: 35, x1: 130, y1: 65 }], w, h);
  const blobs = orphanBlobs(comps, covered, w, 28);
  assert.deepEqual(blobs.map((b) => [b.x0, b.x1, b.parts]), [[10, 23, 2], [80, 93, 1]]);
  assert.equal(dashFromShape(blobs[1], 28), "–");
  assert.equal(dashFromShape(blobs[0], 28), null);
  assert.equal(blobBaseline(blobs[0], 28), 60);
});

test("acceptOrphanRead drops the rec model's empty-crop hallucination", () => {
  const blob = { x0: 0, x1: 40, y0: 0, y1: 20 };
  assert.equal(acceptOrphanRead("cYanmaGenta", 0.9, blob, 28), false);
  assert.equal(acceptOrphanRead("12", 0.95, blob, 28), true);
  assert.equal(acceptOrphanRead("12", 0.4, blob, 28), false);
  assert.equal(acceptOrphanRead("-", 0.4, { x0: 0, x1: 10, y0: 0, y1: 3 }, 28), true);
});
