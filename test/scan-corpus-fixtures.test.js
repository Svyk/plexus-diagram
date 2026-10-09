// Six public-domain scan pages committed so CI can parse them. The full corpus stays outside the repo.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFile } from "./parse-engine-fixtures.js";
import { chartGrid } from "../src/model/parse/lattice.js";
import { scorePage } from "../tools/parse-bench/scan-score.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/pdf/scans");

test("a column of names is a table, not a chart of ticks", () => {
  const cells = [];
  for (let r = 0; r < 10; r++) {
    cells.push({ r, c: 0, text: "Diameter of outlet tube" });
    for (let c = 1; c < 5; c++) cells.push({ r, c, text: "0.15" });
  }
  assert.equal(chartGrid({ rows: 10, cols: 5, cells }), false);
});

test("a dense numeric table with a numeric header stays a table", () => {
  const cells = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 6; c++) cells.push({ r, c, text: r === 0 ? String(c) : (r * 10 + c).toFixed(2) });
  }
  assert.equal(chartGrid({ rows: 10, cols: 6, cells }), false);
});

test("a tick grid with labels only on the axes stays a chart", () => {
  const cells = [];
  const rows = 12;
  const cols = 8;
  for (let c = 0; c < cols; c++) {
    cells.push({ r: 0, c, text: String(c) });
    cells.push({ r: rows - 1, c, text: String(c * 2) });
  }
  for (let r = 1; r < rows - 1; r++) {
    cells.push({ r, c: 0, text: String(r) });
    cells.push({ r, c: cols - 1, text: "." + r });
  }
  assert.equal(chartGrid({ rows, cols, cells }), true);
});

test("graph paper with ticks on inner rulings stays a chart", () => {
  // Propeller p11 is a 22×12 grid, about a third of the interior cells holding a tick.
  const cells = [];
  const rows = 22;
  const cols = 12;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 3 === 0) cells.push({ r, c, text: r % 2 ? "—" : String(r % 10) });
    }
  }
  assert.equal(chartGrid({ rows, cols, cells }), true);
});

test("the committed scan pages parse, and a fold-out of strips is a scan layer", async () => {
  const pdfs = readdirSync(DIR).filter((n) => n.endsWith(".pdf")).sort();
  assert.equal(pdfs.length, 10);
  let bytes = 0;
  for (const name of pdfs) bytes += readFileSync(join(DIR, name)).length;
  assert.ok(bytes <= 1024 * 1024, `fixture pdfs are ${bytes} bytes`);
  for (const name of pdfs) {
    const doc = await parseFile(join(DIR, name));
    const truth = JSON.parse(readFileSync(join(DIR, name.replace(/\.pdf$/, ".truth.json")), "utf8"));
    const scored = scorePage(doc, truth);
    assert.equal(typeof scored.tables.f1, "number");
    if (name.includes("diesel") && name.includes("p12")) {
      assert.equal(doc.pages[0].scanLayer, true);
      assert.equal(doc.pages[0].figures?.length ?? doc.order.filter((id) => doc.blocks[id].type === "figure").length, 0);
    }
  }
});
