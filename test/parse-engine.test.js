// Built-in parse engine against the real fixtures through pdfjs-dist (node, legacy build).
// Thresholds are the design's §8 acceptance bar for the built-in engine.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ATTENTION, ATTENTION_EXPECTED, FIX, parseFile, reportTruth } from "./parse-engine-fixtures.js";
import { matchTables, scoreDoc, scoreTable } from "./parse-metrics.js";

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

let reportDoc;
test("report.pdf parses as three text pages with a pxd-parse/1 document", async () => {
  reportDoc = await parseFile(join(FIX, "report.pdf"));
  assert.equal(reportDoc.schema, "pxd-parse/1");
  assert.deepEqual(reportDoc.pages.map((p) => p.kind), ["text", "text", "text"]);
  assert.deepEqual(reportDoc.pages.map((p) => p.columns), [2, 2, 1]);
  for (const id of reportDoc.order) assert.ok(reportDoc.blocks[id], `order id ${id} exists`);
});

test("report.pdf: Table 1 (ruled, 8 merges) structure F1 1.0 and cell F1 >= 0.98 with the merged anchors", () => {
  const truth = reportTruth();
  const { matches } = matchTables(reportDoc, truth.tables);
  const t1 = matches[0];
  assert.ok(t1.pred, "Table 1 detected");
  assert.equal(t1.pred.method, "lattice");
  const s = scoreTable(t1.pred, t1.truth);
  assert.equal(s.structure.f1, 1);
  assert.ok(s.cells.f1 >= 0.98, `cell F1 ${s.cells.f1}`);
  const cell = (text) => t1.pred.cells.find((c) => c.text === text);
  assert.deepEqual([cell("Product stage").rowSpan, cell("Sampling plan").colSpan, cell("Base powder").rowSpan, cell("Absent in 10 g").colSpan], [2, 4, 3, 2]);
  assert.equal(t1.pred.headerRows, 2);
  assert.equal(cell("Sampling plan").header, true);
  assert.equal(reportDoc.blocks[t1.pred.caption].text.startsWith("Table 1."), true);
});

test("report.pdf: Table 2 (borderless numeric) cell F1 >= 0.95 with numeric columns right-aligned", () => {
  const truth = reportTruth();
  const { matches } = matchTables(reportDoc, truth.tables);
  const t2 = matches[1];
  assert.ok(t2.pred, "Table 2 detected");
  assert.equal(t2.pred.method, "stream");
  const s = scoreTable(t2.pred, t2.truth);
  assert.ok(s.cells.f1 >= 0.95, `cell F1 ${s.cells.f1}`);
  assert.ok(s.alignChecks.every((a) => a.right), JSON.stringify(s.alignChecks));
  assert.equal(t2.pred.headerRows, 1);
});

test("report.pdf: Appendix booktabs table cell F1 >= 0.9 with wrapped cells joined", () => {
  const truth = reportTruth();
  const { matches } = matchTables(reportDoc, truth.tables);
  const t3 = matches[2];
  assert.ok(t3.pred, "Appendix table detected");
  const s = scoreTable(t3.pred, t3.truth);
  assert.ok(s.cells.f1 >= 0.9, `cell F1 ${s.cells.f1}`);
  const texts = t3.pred.cells.map((c) => c.text);
  assert.ok(texts.includes("Z1-014"));
  assert.ok(texts.includes("Weekly after wet clean"));
  assert.ok(s.alignChecks.every((a) => a.right));
});

test("report.pdf: heading levels >= 0.9, furniture removed on every page, order tau >= 0.95, lists, footnote, figure, formula", () => {
  const truth = reportTruth();
  const s = scoreDoc(reportDoc, truth);
  assert.ok(s.headings.accuracy >= 0.9, JSON.stringify(s.headings.details));
  assert.equal(s.furniture.ok, true, JSON.stringify(s.furniture));
  assert.equal(reportDoc.removed.filter((r) => r.reason === "running-header").length, 3);
  assert.equal(reportDoc.removed.filter((r) => r.reason === "running-footer").length, 3);
  assert.ok(s.order.tau >= 0.95, `tau ${s.order.tau} unmatched ${JSON.stringify(s.order.unmatched)}`);
  assert.ok(s.order.matched >= 0.9 * s.order.truthCount, `matched ${s.order.matched}/${s.order.truthCount}`);
  const lists = Object.values(reportDoc.blocks).filter((b) => b.type === "list");
  assert.equal(lists.length, 2);
  assert.deepEqual(lists.map((l) => l.ordered).sort(), [false, true]);
  assert.equal(lists.find((l) => !l.ordered).items.length, 3);
  assert.equal(s.footnotes.linked, 1);
  const figures = Object.values(reportDoc.blocks).filter((b) => b.type === "figure");
  assert.equal(figures.length, 1);
  assert.equal(reportDoc.blocks[figures[0].caption].text.startsWith("Figure 1."), true);
  const months = Object.values(reportDoc.blocks).filter((b) => b.type === "para" && /^(Jan|Feb|Mar)\b/.test(b.text));
  assert.equal(months.length, 0, "axis labels are not paragraphs");
  const formulas = Object.values(reportDoc.blocks).filter((b) => b.type === "formula");
  assert.equal(formulas.length, 1);
  assert.equal(formulas[0].latex, null);
  assert.ok(formulas[0].text.includes("="));
  assert.equal(reportDoc.blocks[reportDoc.order[0]].level, 1);
});

test("report-scan.pdf: every page is a scan with one scan block and zero text blocks", async () => {
  const doc = await parseFile(join(FIX, "report-scan.pdf"));
  assert.deepEqual(doc.pages.map((p) => p.kind), ["scan", "scan", "scan"]);
  const types = Object.values(doc.blocks).map((b) => b.type);
  assert.deepEqual(types, ["scan", "scan", "scan"]);
  assert.deepEqual(doc.order.map((id) => doc.blocks[id].page), [1, 2, 3]);
});

test("speed: pure engine median per page well under the design budget (log actuals)", async () => {
  const pure = reportDoc.stats.perPage;
  const adapter = reportDoc.stats.adapterMs;
  console.log(`report.pdf pure ms/page ${pure.map((v) => v.toFixed(1)).join(", ")} (assemble ${reportDoc.stats.assembleMs} ms); pdf.js adapter ms/page ${adapter.map((v) => v.toFixed(0)).join(", ")}`);
  assert.ok(median(pure) <= 150, `median ${median(pure)} ms`);
  assert.ok(Math.max(...pure) <= 300, `max ${Math.max(...pure)} ms (ruled page budget)`);
  assert.ok(reportDoc.stats.ms <= 5000);
});

test("attention.pdf (local only): Tables 1-3 detected as stream tables with cell F1 >= 0.85 each", { skip: !existsSync(ATTENTION) || !existsSync(ATTENTION_EXPECTED) }, async () => {
  const doc = await parseFile(ATTENTION);
  const expected = JSON.parse(readFileSync(ATTENTION_EXPECTED, "utf8"));
  const s = scoreDoc(doc, expected);
  for (const t of s.tables) {
    assert.ok(t.matched, `${t.caption.slice(0, 30)} detected`);
    assert.equal(t.method, "stream");
    assert.ok(t.cells.f1 >= 0.85, `${t.caption.slice(0, 30)} cell F1 ${t.cells.f1}`);
  }
  console.log(`attention.pdf cell F1: ${s.tables.map((t) => t.cells.f1).join(", ")}; pure median ${median(doc.stats.perPage).toFixed(1)} ms/page`);
  assert.ok(median(doc.stats.perPage) <= 150);
});
