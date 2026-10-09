// Structure-model tables: words land in the cell that contains their centre, and a
// recorded helper structure replaces the overlapping rule table.
import assert from "node:assert/strict";
import test from "node:test";

import { applyStructureTables, cellText, fillStructureCells, tableFromStructure, tableRegions, wordsFromOcrPage } from "../src/model/parse/table-structure.js";

function word(text, x, y, { w = 10, h = 6, base = null } = {}) {
  return { text, x0: x, x1: x + w, y0: y, y1: y + h, base: base ?? y + h * 0.8, size: h };
}

test("a word's centre picks the smallest cell that contains it", () => {
  const cells = [
    { r: 0, c: 0, rowSpan: 1, colSpan: 2, bbox: [0, 0, 40, 20] },
    { r: 0, c: 0, rowSpan: 1, colSpan: 1, bbox: [0, 0, 20, 20] },
    { r: 0, c: 1, rowSpan: 1, colSpan: 1, bbox: [20, 0, 40, 20] },
  ];
  const filled = fillStructureCells(cells, [word("Plat", 2, 2), word("3,465", 22, 2), word("out", 50, 2)]);
  assert.equal(filled[1].text, "Plat");
  assert.equal(filled[2].text, "3,465");
  assert.equal(filled[0].text, "");
  assert.equal(filled[1].rowSpan, 1);
});

test("words on one baseline join in x order, a lower baseline follows", () => {
  const text = cellText([
    word("Straw", 30, 10, { base: 16 }),
    word("Grain", 8, 10, { base: 16 }),
    word("1.06", 8, 24, { base: 30 }),
  ]);
  assert.equal(text, "Grain Straw 1.06");
});

test("wordsFromOcrPage uses the Vision box, not the baseline alone", () => {
  const words = wordsFromOcrPage({
    items: [
      { str: "1.05", transform: [6, 0, 0, 6, 10, 40], width: 12, height: 6, y0: 34, y1: 42, conf: 1 },
      { str: " ", transform: [6, 0, 0, 6, 0, 0], width: 2, height: 6, y0: 0, y1: 6 },
    ],
  });
  assert.equal(words.length, 1);
  assert.equal(words[0].x0, 10);
  assert.equal(words[0].x1, 22);
  assert.equal(words[0].y0, 34);
});

test("a recorded structure replaces the overlapping rule table and leaves the other", () => {
  const rule = {
    id: "t1", type: "table", page: 1, bbox: [0, 0, 40, 30], rows: 1, cols: 1,
    cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "Yields" }],
    caption: "c1", ocrSource: "fresh",
  };
  const other = {
    id: "t2", type: "table", page: 1, bbox: [200, 200, 240, 230], rows: 1, cols: 1,
    cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "kept" }],
  };
  const doc = { order: ["t1", "p", "t2"], blocks: { t1: rule, p: { id: "p", type: "paragraph", page: 1 }, t2: other } };
  const structure = {
    page: 1,
    bbox: [0, 0, 40, 20],
    rows: 1,
    cols: 2,
    cells: [
      { r: 0, c: 0, rowSpan: 1, colSpan: 1, bbox: [0, 0, 20, 20], header: true },
      { r: 0, c: 1, rowSpan: 1, colSpan: 1, bbox: [20, 0, 40, 20], header: true },
    ],
  };
  const words = new Map([[1, [word("Yields", 2, 4), word("Ratio", 22, 4)]]]);
  const { doc: next, applied } = applyStructureTables(doc, [structure], words, { method: "slanet-plus" });
  assert.equal(applied.length, 1);
  assert.equal(next.blocks.t1.method, "slanet-plus");
  assert.equal(next.blocks.t1.rows, 1);
  assert.equal(next.blocks.t1.cols, 2);
  assert.equal(next.blocks.t1.cells.find((c) => c.c === 0).text, "Yields");
  assert.equal(next.blocks.t1.cells.find((c) => c.c === 1).text, "Ratio");
  assert.equal(next.blocks.t1.caption, "c1");
  assert.equal(next.blocks.t2.cells[0].text, "kept");
  assert.equal(next.order.join(","), "t1,p,t2");
});

test("a structure reading that does not share the rule table's text is left alone", () => {
  const rule = {
    id: "t1", type: "table", page: 1, bbox: [0, 0, 40, 30], rows: 1, cols: 1,
    cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "True wind speed" }],
  };
  const doc = { order: ["t1"], blocks: { t1: rule } };
  const structure = {
    page: 1, bbox: [0, 0, 40, 30], rows: 1, cols: 1,
    cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, bbox: [0, 0, 40, 30] }],
  };
  const words = new Map([[1, [word("other", 2, 4)]]]);
  const { doc: next, applied } = applyStructureTables(doc, [structure], words);
  assert.equal(applied.length, 0);
  assert.equal(next.blocks.t1.cells[0].text, "True wind speed");
});

test("tableRegions are the assembled table boxes", () => {
  const doc = {
    order: ["a", "b"],
    blocks: {
      a: { id: "a", type: "table", page: 2, bbox: [1, 2, 3, 4] },
      b: { id: "b", type: "para", page: 2, bbox: [0, 0, 1, 1] },
    },
  };
  assert.deepEqual(tableRegions(doc, [2]), [{ page: 2, bbox: [1, 2, 3, 4] }]);
  assert.deepEqual(tableRegions(doc, [1]), []);
});

test("no structure leaves the document alone", () => {
  const doc = { order: ["t1"], blocks: { t1: { id: "t1", type: "table" } } };
  const out = applyStructureTables(doc, [], new Map());
  assert.equal(out.doc, doc);
  assert.deepEqual(out.applied, []);
});

test("tableFromStructure counts rows from spans when the model omits them", () => {
  const table = tableFromStructure({
    page: 2,
    cells: [{ r: 0, c: 0, rowSpan: 2, colSpan: 3, bbox: [0, 0, 30, 20], header: true }],
  }, []);
  assert.equal(table.rows, 2);
  assert.equal(table.cols, 3);
  assert.equal(table.headerRows, 1);
  assert.equal(table.page, 2);
});
