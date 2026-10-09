// Scorer for the 1900–1950 scan corpus. No PDF and no OCR: the bench imports these.
import assert from "node:assert/strict";
import test from "node:test";

import { boxIou, captionLinked, scorePage, tableCounts, textCounts } from "../tools/parse-bench/scan-score.mjs";

function doc(blocks, order, pages = [{ n: 1, w: 100, h: 200 }]) {
  const map = {};
  for (const b of blocks) map[b.id] = b;
  return { blocks: map, order: order || blocks.map((b) => b.id), pages };
}

test("unsure cells drop out of both sides", () => {
  const truth = { rows: 1, cols: 2, headerRows: 0, cells: [
    { r: 0, c: 0, text: "0.15" },
    { r: 0, c: 1, text: "maybe", unsure: true },
  ] };
  const pred = { cells: [
    { r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "0.15" },
    { r: 0, c: 1, rowSpan: 1, colSpan: 1, text: "wrong" },
  ] };
  const c = tableCounts(pred, truth);
  assert.equal(c.cellTp, 1);
  assert.equal(c.truthN, 1);
  assert.equal(c.predN, 1);
});

test("cellSim and cellF1@0.9 sit beside exact cell counts", () => {
  const truth = { cells: [
    { r: 0, c: 0, text: "Diameter of outlet tube d" },
    { r: 0, c: 1, text: "8.059" },
    { r: 1, c: 0, text: "e 7.67" },
    { r: 1, c: 1, text: "other" },
  ] };
  const pred = { cells: [
    { r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "Diameter of outlet tube d.." },
    { r: 0, c: 1, rowSpan: 1, colSpan: 1, text: "8. 059" },
    { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: "e7.67" },
    { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: "xxxx" },
  ] };
  const c = tableCounts(pred, truth);
  assert.equal(c.cellTp, 2, "a spaced decimal and a footnote letter match; trailing leaders do not");
  assert.equal(c.cellSoftTp, 3, "the leader label is within 0.9 edit similarity");
  assert.ok(c.cellSimSum / c.structureTp > 0.7);
});

test("a figure hits at IoU 0.5 and a short caption links inside a longer one", () => {
  assert.ok(boxIou([0, 0, 0.5, 0.5], [0, 0, 0.5, 0.5]) === 1);
  assert.ok(boxIou([0, 0, 0.2, 0.2], [0.8, 0.8, 1, 1]) === 0);
  assert.equal(captionLinked("Fig. 2", "Fig. 2 Sketch of the supercharger."), true);
  assert.equal(captionLinked("Fig. 2 Characteristics of propeller section", "Fig.2"), true);
  assert.equal(captionLinked("Fig. 2", "Fig. 9 Something else entirely."), false);
  const parsed = doc([
    { id: "f1", type: "figure", page: 1, bbox: [10, 20, 60, 120], caption: "c1" },
    { id: "c1", type: "caption", text: "Fig. 2 Sketch of the supercharger." },
  ]);
  const s = scorePage(parsed, { figures: [{ bbox: [0.1, 0.1, 0.6, 0.6], caption: "Fig. 2" }] });
  assert.equal(s.figureCounts.hits, 1);
  assert.equal(s.figureCounts.linked, 1);
});

test("an empty truth table list counts a predicted table as a false positive", () => {
  const parsed = doc([{ id: "t1", type: "table", cells: [{ r: 0, c: 0, text: "no" }] }]);
  const s = scorePage(parsed, { tables: [] });
  assert.equal(s.tables.f1, 0);
  assert.equal(s.tableCounts.predN, 1);
});

test("character and word error use the non-table reading text", () => {
  const parsed = doc([
    { id: "b1", type: "para", text: "Fig. 2 Sketches of ice" },
    { id: "t1", type: "table", text: "not in the lines", cells: [] },
  ]);
  const c = textCounts(parsed, ["Fig. 2 Sketches of ice"]);
  assert.equal(c.cer, 0);
  assert.equal(c.wer, 0);
});
