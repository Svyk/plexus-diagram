import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { tableFromTruth } from "../src/model/parse-schema.js";
import { flatRows, isNumericCell, toGridSpec } from "../src/model/parse-to-grid.js";

const truth = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/pdf/report.truth.json"),
  "utf8",
));

test("numeric detection strips the marks the design names", () => {
  assert.equal(isNumericCell("1,000"), true);
  assert.equal(isNumericCell("10%"), true);
  assert.equal(isNumericCell("(12)"), true);
  assert.equal(isNumericCell("3 [a]"), true);
  assert.equal(isNumericCell("±2.5"), true);
  assert.equal(isNumericCell("Absent in 10 g"), false);
  assert.equal(isNumericCell(""), false);
  assert.equal(isNumericCell("Hold lot"), false);
});

test("Table 1 grid spec keeps merges, header rows, and right-aligns numeric columns", () => {
  const table = tableFromTruth(truth.tables[0]);
  const spec = toGridSpec(table);
  assert.equal(spec.enhance, true);
  assert.equal(spec.widths, null);
  assert.deepEqual(spec.headerRows, [0, 1]);
  assert.equal(spec.merges.length, 8);
  assert.deepEqual(spec.merges[0], { row: 0, col: 0, rowSpan: 2, colSpan: 1 });
  assert.deepEqual(spec.merges.find((merge) => merge.row === 0 && merge.col === 2), { row: 0, col: 2, rowSpan: 1, colSpan: 4 });
  assert.equal(spec.rows.length, 7);
  assert.equal(spec.rows[0].length, 7);
  assert.equal(spec.rows[0][0], "Product stage");
  assert.equal(spec.rows[0][3], "");
  assert.equal(spec.rows[1][0], "");
  assert.equal(spec.rows[4][5], "");
  assert.equal(spec.rows[4][4], "Absent in 10 g");
  assert.deepEqual(spec.alignments, [
    { col: 2, align: "right" },
    { col: 3, align: "right" },
    { col: 5, align: "right" },
  ]);

  const flat = flatRows(table);
  assert.equal(flat[0][3], "Sampling plan");
  assert.equal(flat[1][0], "Product stage");
  assert.equal(flat[4][5], "Absent in 10 g");
});

test("a column is right-aligned at 80 percent and not at 75", () => {
  const cells = (texts) => texts.map((text, i) => ({ r: i + 1, c: 0, rowSpan: 1, colSpan: 1, text, header: false }));
  const table = (texts) => ({
    rows: texts.length + 1,
    cols: 1,
    headerRows: 1,
    cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "n", header: true }, ...cells(texts)],
  });
  assert.deepEqual(toGridSpec(table(["1", "2", "3", "no"])).alignments, []);
  assert.deepEqual(toGridSpec(table(["1", "2", "3", "4", "no"])).alignments, [{ col: 0, align: "right" }]);
  assert.deepEqual(toGridSpec(table(["1", "2", "3", "4", "5", "no", "no", "8", "9", "10"])).alignments, [{ col: 0, align: "right" }]);
});

test("a leading marker in a cell is backticked, not placeholdered", () => {
  const spec = toGridSpec({
    rows: 1,
    cols: 1,
    headerRows: 0,
    cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "- n" }],
  });
  assert.equal(spec.rows[0][0], "`-` n");
  assert.equal(spec.rows[0][0].includes("⟦"), false);
});
