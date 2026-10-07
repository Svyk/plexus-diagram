import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SCHEMA, tableFromTruth } from "../src/model/parse-schema.js";
import { toCSV, toMarkdown } from "../src/model/parse-to-text.js";

const truth = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/pdf/report.truth.json"),
  "utf8",
));

function csvFields(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let value = "";
      i += 1;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { value += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        value += line[i];
        i += 1;
      }
      fields.push(value);
      if (line[i] === ",") i += 1;
      else break;
    } else {
      const end = line.indexOf(",", i);
      const cut = end === -1 ? line.length : end;
      fields.push(line.slice(i, cut));
      i = cut === line.length ? line.length + 1 : cut + 1;
    }
  }
  return fields;
}

test("CSV quotes commas, leaves covered cells empty, and TSV uses tabs", () => {
  const table = tableFromTruth(truth.tables[0]);
  const csv = toCSV(table);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 7);
  assert.equal(csvFields(lines[0])[0], "Product stage");
  assert.equal(lines[2].includes('"1,000"'), true);
  assert.equal(csvFields(lines[2])[4], "1,000");
  const row4 = csvFields(lines[4]);
  assert.equal(row4[4], "Absent in 10 g");
  assert.equal(row4[5], "");
  const tsv = toCSV(table, { tsv: true });
  assert.equal(tsv.includes("\t"), true);
  assert.equal(tsv.split("\r\n")[2].split("\t")[4], "1,000");
});

test("spans become an HTML table and a span-free table stays GFM", () => {
  const spanned = tableFromTruth(truth.tables[0]);
  const html = toMarkdown({ schema: SCHEMA, order: ["t"], blocks: { t: spanned } }, ["t"]);
  assert.equal(html.includes("<table>"), true);
  assert.equal(html.includes('rowspan="2"'), true);
  assert.equal(html.includes('colspan="4"'), true);
  assert.equal(html.includes("<td></td>"), false);

  const plain = {
    id: "s",
    type: "table",
    page: 1,
    rows: 2,
    cols: 2,
    headerRows: 1,
    cells: [
      { r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "Zone", header: true },
      { r: 0, c: 1, rowSpan: 1, colSpan: 1, text: "Rate", header: true },
      { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: "Z1", header: false },
      { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: "4", header: false },
    ],
  };
  const doc = {
    schema: SCHEMA,
    order: ["h", "s", "e", "n", "p"],
    blocks: {
      h: { id: "h", type: "heading", level: 2, page: 1, text: "Methods" },
      s: plain,
      e: { id: "e", type: "formula", page: 1, latex: "R = 1" },
      p: { id: "p", type: "para", page: 1, text: "See note³", footnoteRefs: [{ mark: "3", to: "n" }] },
      n: { id: "n", type: "footnote", page: 1, mark: "3", text: "Zone three." },
    },
  };
  const md = toMarkdown(doc);
  assert.equal(md.includes("## Methods"), true);
  assert.equal(md.includes("| Zone | Rate |"), true);
  assert.equal(md.includes("| --- | --- |"), true);
  assert.equal(md.includes("$$R = 1$$"), true);
  assert.equal(md.includes("[^3]"), true);
  assert.equal(md.includes("[^3]: Zone three."), true);
  assert.equal(md.includes("<table>"), false);
});
