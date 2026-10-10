import assert from "node:assert/strict";
import test from "node:test";

import { alignedNumericColumns, decimalColumnPagesOf, isNumericToken, labeledDecimalColumn, numericPagesOf } from "../src/model/parse/vlm-boxes.js";
import { oracleTableBoxes } from "../tools/parse-bench/scan-corpus.mjs";

function col(x, ys, text = "1.0", width = 12) {
  return ys.map((y) => ({ text, x0: x, y0: y, x1: x + width, y1: y + 8 }));
}

test("aligned numeric columns match the helper's rule", () => {
  const rows = [20, 36, 52, 68, 84];
  assert.equal(alignedNumericColumns([...col(40, rows), ...col(90, rows, "2.5")]), true);
  assert.equal(alignedNumericColumns(col(40, rows)), false);
  assert.equal(alignedNumericColumns([
    { text: "The", x0: 20, y0: 20, x1: 40, y1: 28 },
    { text: "yield", x0: 44, y0: 20, x1: 70, y1: 28 },
    { text: "1913", x0: 20, y0: 40, x1: 40, y1: 48 },
  ]), false);
  assert.equal(isNumericToken("0.D0"), false);
  assert.equal(isNumericToken(".98"), true);
  assert.equal(isNumericToken("1,234.5"), true);
});

test("a small integer on a sentence is not a numeric column", () => {
  const ys = [20, 36, 52, 68, 84];
  const sentence = "The combination of the draw bench and the die";
  const prose = (y) => ({ text: sentence, x0: 40, y0: y, x1: 220, y1: y + 8 });
  const mark = (text, x, y) => ({ text, x0: x, y0: y, x1: x + 12, y1: y + 8 });
  assert.equal(alignedNumericColumns(ys.flatMap((y) => [prose(y), mark("1", 230, y), mark("70", 280, y)])), false);
  assert.equal(alignedNumericColumns(ys.flatMap((y) => [prose(y), mark("1.2", 230, y), mark("3.4", 280, y)])), true);
  assert.equal(alignedNumericColumns(ys.flatMap((y) => [
    { text: "North", x0: 20, y0: y, x1: 52, y1: y + 8 },
    mark("12", 80, y),
    mark("14", 120, y),
  ])), true);
  const contents = ys.flatMap((y, i) => [
    mark(`${280 + i}.`, 28, y),
    { text: "Cooling", x0: 52, y0: y, x1: 100, y1: y + 8 },
    { text: "by", x0: 104, y0: y, x1: 120, y1: y + 8 },
    mark(String(250 + i), 300, y),
  ]);
  assert.equal(alignedNumericColumns(contents), false);
  const scattered = [20, 140, 260, 400].flatMap((y) => [mark("12", 40, y), mark("40", 200, y)]);
  assert.equal(alignedNumericColumns(scattered), false, "page numbers a third of a page apart are not a grid");
});

test("a labeled column of measured values is a layout candidate", () => {
  const ys = [20, 36, 52, 68, 84];
  const names = ["Methane", "Ethane", "Propane", "Butane", "Nitrogen"];
  const values = ["84.7", "9.4", "3.0", "1.3", "1.6"];
  const column = ys.flatMap((y, i) => [
    { text: names[i], x0: 40, y0: y, x1: 90, y1: y + 8 },
    { text: values[i], x0: 200, y0: y, x1: 224, y1: y + 8 },
  ]);
  assert.equal(alignedNumericColumns(column), false);
  assert.equal(labeledDecimalColumn(column), true);
  const integers = ys.flatMap((y, i) => [
    { text: names[i], x0: 40, y0: y, x1: 90, y1: y + 8 },
    { text: String(i + 1), x0: 200, y0: y, x1: 212, y1: y + 8 },
  ]);
  assert.equal(labeledDecimalColumn(integers), false);
  assert.equal(labeledDecimalColumn(ys.map((y) => ({ text: "1.5", x0: 200, y0: y, x1: 220, y1: y + 8 }))), false);
  const sentence = "The combination of the draw bench and the die";
  const prose = ys.map((y) => [
    { text: sentence, x0: 40, y0: y, x1: 280, y1: y + 8 },
    { text: "1.5", x0: 300, y0: y, x1: 320, y1: y + 8 },
  ]).flat();
  assert.equal(labeledDecimalColumn(prose), false);
  const scattered = [20, 140, 260, 400].flatMap((y) => [
    { text: "Methane", x0: 40, y0: y, x1: 90, y1: y + 8 },
    { text: "1.5", x0: 200, y0: y, x1: 220, y1: y + 8 },
  ]);
  assert.equal(labeledDecimalColumn(scattered), false);
  assert.deepEqual(decimalColumnPagesOf([{ n: 1, words: column }], [1]), [1]);
  assert.deepEqual(decimalColumnPagesOf([{ n: 1, words: column }], [1], [{ page: 1, bbox: [0, 0, 300, 200] }]), []);
});

test("numbers inside a figure are not a missed table", () => {
  const ys = [20, 36, 52, 68, 84];
  const words = ys.flatMap((y) => [
    { text: "1.2", x0: 40, y0: y, x1: 60, y1: y + 8 },
    { text: "3.4", x0: 80, y0: y, x1: 100, y1: y + 8 },
  ]);
  const figures = [{ page: 1, type: "figure", bbox: [0, 0, 200, 200] }];
  assert.deepEqual(numericPagesOf([{ n: 1, words }], [1], figures), []);
  assert.deepEqual(numericPagesOf([{ n: 1, words }], [1]), [1]);
});

test("oracle table boxes are the LlamaParse table regions", () => {
  const boxes = oracleTableBoxes({
    blocks: {
      a: { type: "table", bbox: [1, 2, 3, 4] },
      b: { type: "para", bbox: [0, 0, 1, 1] },
      c: { type: "table" },
    },
  }, 5);
  assert.deepEqual(boxes, [{ page: 5, bbox: [1, 2, 3, 4] }]);
});
