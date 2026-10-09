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

test("the committed scan pages parse, and a fold-out of strips is a scan layer", async () => {
  const pdfs = readdirSync(DIR).filter((n) => n.endsWith(".pdf")).sort();
  assert.equal(pdfs.length, 6);
  let bytes = 0;
  for (const name of pdfs) bytes += readFileSync(join(DIR, name)).length;
  assert.ok(bytes < 2 * 1024 * 1024, `fixture pdfs are ${bytes} bytes`);
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
