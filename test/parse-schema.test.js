import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BLOCK_TYPES,
  IOU_MIN,
  SCHEMA,
  blocksInRange,
  iou,
  mergeScoped,
  selectBlocks,
  tableFromTruth,
  tableGrid,
  validateParse,
} from "../src/model/parse-schema.js";

const truth = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/pdf/report.truth.json"),
  "utf8",
));

function docFromTruth() {
  const blocks = {};
  const order = [];
  truth.tables.forEach((table, index) => {
    const id = `t${index + 1}`;
    blocks[id] = tableFromTruth(table, { id, page: index + 1 });
    order.push(id);
  });
  return {
    schema: SCHEMA,
    sha256: "truth",
    engine: "builtin",
    options: { ocr: "auto", formula: false, tables: "accurate" },
    pageCount: 3,
    order,
    blocks,
  };
}

test("truth tables convert to a valid pxd-parse/1 document", () => {
  const doc = docFromTruth();
  const result = validateParse(doc);
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.equal(doc.blocks.t1.rows, 7);
  assert.equal(doc.blocks.t1.cols, 7);
  assert.equal(doc.blocks.t1.cells.length, truth.tables[0].cells.length);
  assert.ok(BLOCK_TYPES.includes("table"));
  assert.equal(IOU_MIN, 0.5);
});

test("validateParse rejects a bad schema, a missing order id, a cell outside the grid, and an overlap", () => {
  const doc = docFromTruth();
  assert.equal(validateParse({ ...doc, schema: "pxd-parse/2" }).errors.includes("schema"), true);
  const missing = { ...doc, order: ["t1", "nope"] };
  assert.equal(validateParse(missing).errors.includes("order-missing:nope"), true);

  const wide = structuredClone(doc);
  wide.blocks.t1.cells.push({ r: 9, c: 0, rowSpan: 1, colSpan: 1, text: "no" });
  assert.equal(validateParse(wide).errors.some((error) => error.startsWith("cell-range:t1:")), true);

  const overlap = structuredClone(doc);
  overlap.blocks.t1.cells.push({ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "again" });
  assert.equal(validateParse(overlap).errors.includes("cell-overlap:t1:0:0"), true);

  const typed = structuredClone(doc);
  typed.blocks.t1.type = "paragraph";
  assert.equal(validateParse(typed).errors.includes("block-type:t1"), true);
});

test("tableGrid marks anchors and covered cells for Table 1's eight merges", () => {
  const table = tableFromTruth(truth.tables[0]);
  const grid = tableGrid(table);
  assert.equal(grid.length, 7);
  assert.equal(grid[0].length, 7);
  assert.equal(grid[0][0].anchor, true);
  assert.equal(grid[0][0].covered, false);
  assert.equal(grid[0][0].text, "Product stage");
  assert.equal(grid[1][0].anchor, false);
  assert.equal(grid[1][0].covered, true);
  assert.equal(grid[1][0].cell.text, "Product stage");
  assert.equal(grid[0][3].covered, true);
  assert.equal(grid[0][3].text, "Sampling plan");
  assert.equal(grid[4][5].covered, true);
  assert.equal(grid[4][4].text, "Absent in 10 g");
  assert.equal(grid[4][4].cell.colSpan, 2);
  const covered = grid.flat().filter((slot) => slot.covered).length;
  assert.equal(covered, 11);
});

test("blocksInRange and selectBlocks keep reading order", () => {
  const doc = docFromTruth();
  doc.blocks.p = { id: "p", type: "para", page: 2, text: "mid" };
  doc.order = ["t1", "p", "t2"];
  assert.deepEqual(blocksInRange(doc, 2, 2).map((block) => block.id), ["p", "t2"]);
  assert.deepEqual(selectBlocks(doc, ["t2", "t1"]).map((block) => block.id), ["t2", "t1"]);
  assert.deepEqual(selectBlocks(doc, { fromPage: 1, toPage: 1 }).map((block) => block.id), ["t1"]);
});

test("mergeScoped replaces only the overlapping table and records mixed sources", () => {
  const base = {
    schema: SCHEMA,
    engine: "builtin",
    engineVersion: "plexus-builtin",
    sha256: "abc",
    options: { ocr: "auto" },
    order: ["h", "t1", "p"],
    blocks: {
      h: { id: "h", type: "heading", level: 1, page: 1, bbox: [0, 0, 10, 10], text: "Title" },
      t1: { id: "t1", type: "table", page: 3, bbox: [10, 10, 90, 50], rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "old" }] },
      p: { id: "p", type: "para", page: 3, bbox: [10, 80, 90, 100], text: "stays" },
    },
  };
  const scoped = {
    schema: SCHEMA,
    engine: "docling",
    engineVersion: "docling-2.91.0",
    order: ["page-para", "page-table"],
    blocks: {
      "page-para": { id: "page-para", type: "para", page: 3, bbox: [10, 80, 90, 100], text: "ignored" },
      "page-table": { id: "page-table", type: "table", page: 3, bbox: [10, 10, 90, 50], rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "new" }] },
    },
  };
  const merged = mergeScoped(base, scoped, { page: 3, bbox: [10, 10, 90, 50] });
  assert.equal(merged.engine, "mixed");
  assert.equal(merged.schema, SCHEMA);
  assert.deepEqual(merged.order, ["h", "d1", "p"]);
  assert.equal(merged.blocks.d1.engine, "docling");
  assert.equal(merged.blocks.d1.text ?? merged.blocks.d1.cells[0].text, "new");
  assert.equal(merged.blocks.t1, undefined);
  assert.equal(merged.blocks.p.text, "stays");
  assert.equal(merged.blocks.h.text, "Title");
  const docling = merged.sources.find((source) => source.engine === "docling");
  assert.deepEqual(docling.ids, ["d1"]);
  assert.equal(docling.page, 3);
  assert.equal(docling.engineVersion, "docling-2.91.0");
  const builtin = merged.sources.find((source) => source.engine === "builtin");
  assert.deepEqual(builtin.ids, ["h", "p"]);

  const otherPage = structuredClone(base);
  otherPage.blocks.twin = { id: "twin", type: "table", page: 1, bbox: [10, 10, 90, 50], rows: 1, cols: 1, cells: [] };
  otherPage.order = ["h", "twin", "t1", "p"];
  const kept = mergeScoped(otherPage, scoped, { page: 3, bbox: [10, 10, 90, 50] });
  assert.equal(kept.blocks.twin.id, "twin");

  const weak = mergeScoped(base, {
    blocks: { z: { id: "z", type: "para", page: 3, bbox: [0, 0, 4, 4], text: "tiny" } },
    order: ["z"],
  }, { page: 3, bbox: [10, 10, 90, 50] });
  assert.equal(weak, base);
});

test("iou is 1 for the same box and 0 for an empty box", () => {
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(iou([], [0, 0, 10, 10]), 0);
  assert.ok(iou([0, 0, 10, 10], [9, 0, 20, 10]) < 0.5);
});
