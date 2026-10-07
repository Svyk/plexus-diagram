// Regression tests for the failure classes found on unseen PDFs and ICDAR 2013 (round 2).
// Synthetic page data only: pdf.js-like text items and legacy path operators.
import test from "node:test";
import assert from "node:assert/strict";

import { OP } from "../src/model/parse/rules.js";
import { assembleDocument, parsePageGeometry, isTitledBox, stitchTables, linkContinuedTables } from "../src/model/parse/index.js";
import { findLatticeTables, tabularBetween, looksLikeChart } from "../src/model/parse/lattice.js";
import { detectStreamRuns, isMonospace } from "../src/model/parse/stream.js";
import { equationRowSignals } from "../src/model/parse/formulas.js";
import { headingLevel } from "../src/model/parse/headings.js";
import { adjacencyRelations, parseStructure, parseRegions, prf } from "../tools/parse-bench/icdar2013.mjs";

const H = 792;
const W = 612;
const FONTS = {
  f1: { name: "Helvetica", fontFamily: "sans-serif" },
  fb: { name: "Helvetica-Bold", fontFamily: "sans-serif" },
  fi: { name: "AdvOT65f8a23b.I", fontFamily: "serif" },
  fm: { name: "Inconsolata-Regular", fontFamily: "monospace" },
};
// Text item at PDF coords (x, baseline y from the bottom). Default glyph width 0.5 em.
const item = (str, x, y, size = 10, font = "f1", width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: font, hasEOL: false });
// Words on one baseline (top-left y) at given x positions.
const row = (y, cells, size = 10, font = "f1") => cells.map(([text, x]) => item(text, x, H - y, size, font));

// Rules as filled thin rectangles; boxes as filled rectangles with a colour.
function ops(rules = [], boxes = []) {
  const fnArray = [];
  const argsArray = [];
  for (const r of rules) {
    const [x0, y0, x1, y1] = r;
    const thick = 0.8;
    const w = x1 - x0 || thick;
    const h = y1 - y0 || thick;
    fnArray.push(OP.setFillGray, OP.rectangle, OP.fill);
    argsArray.push([0], [x0, H - y1 - (h === thick ? thick : 0), w, h], null);
  }
  for (const b of boxes) {
    const [x0, y0, x1, y1, gray] = b;
    fnArray.push(OP.setFillGray, OP.rectangle, OP.fill);
    argsArray.push([gray], [x0, H - y1, x1 - x0, y1 - y0], null);
  }
  return { fnArray, argsArray };
}

function page(items, { rules = [], boxes = [] } = {}, n = 1) {
  return parsePageGeometry({ items, ops: ops(rules, boxes), w: W, h: H, fonts: FONTS }, n);
}

function doc(pages) {
  return assembleDocument(pages, { numPages: pages.length });
}

function tablesOf(d) { return d.order.map((id) => d.blocks[id]).filter((b) => b.type === "table"); }
function blocksOf(d, type) { return d.order.map((id) => d.blocks[id]).filter((b) => b.type === type); }

// Full grid of rules for a table at (x0, y0) with given column edges and row pitch.
function grid(xs, ys) {
  const rules = [];
  for (const y of ys) rules.push([xs[0], y, xs[xs.length - 1], y]);
  for (const x of xs) rules.push([x, ys[0], x, ys[ys.length - 1]]);
  return rules;
}

test("stacked ruled tables of the same width stay two tables", () => {
  const xs = [100, 200, 300, 400];
  const items = [];
  const rules = [...grid(xs, [100, 120, 140, 160]), ...grid(xs, [220, 240, 260, 280])];
  for (const [i, y] of [100, 120, 140].entries()) items.push(...row(y + 14, [[`A${i}`, 105], [`${i * 2}`, 205], [`${i * 3}`, 305]]));
  for (const [i, y] of [220, 240, 260].entries()) items.push(...row(y + 14, [[`B${i}`, 105], [`${i + 7}`, 205], [`${i + 9}`, 305]]));
  const d = doc([page(items, { rules })]);
  const tables = tablesOf(d);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables.map((t) => [t.rows, t.cols]), [[3, 3], [3, 3]]);
  assert.equal(tables[0].cells.find((k) => k.r === 0 && k.c === 0).text, "A0");
  assert.equal(tables[1].cells.find((k) => k.r === 0 && k.c === 0).text, "B0");
});

test("a frame around prose is not a table: its lines become a paragraph", () => {
  const rules = grid([80, 500], [100, 170]);
  const items = [
    ...row(120, [["The sequence was discovered by Leonardo of Pisa around twelve hundred and", 90]]),
    ...row(134, [["it is an infinite sequence which appears to grow very rapidly at first and", 90]]),
    ...row(148, [["then more slowly as the terms get larger in the usual fashion of growth.", 90]]),
  ];
  const d = doc([page(items, { rules })]);
  assert.equal(tablesOf(d).length, 0);
  const paras = blocksOf(d, "para");
  assert.equal(paras.length, 1);
  assert.ok(paras[0].text.startsWith("The sequence was discovered"));
});

test("lattice: ruled header verticals with unruled body rows split the body into columns", () => {
  // Header row has verticals; body rows only have horizontal rules between them.
  const xs = [80, 180, 280, 380, 480];
  const ys = [100, 120, 140, 160, 180];
  const rules = [];
  for (const y of ys) rules.push([80, y, 480, y]);
  for (const x of xs) rules.push([x, 100, x, 120]);
  rules.push([80, 120, 80, 180], [480, 120, 480, 180]);
  const items = [
    ...row(114, [["Country", 85], ["Domestic", 185], ["Imported", 285], ["Total", 385]], 10, "fb"),
    ...row(134, [["Austria", 85], ["86.2", 220], ["13.8", 320], ["3,375", 420]]),
    ...row(154, [["Belgium", 85], ["0", 230], ["100.0", 320], ["3,973", 420]]),
    ...row(174, [["Cyprus", 85], ["81.0", 220], ["3.8", 325], ["158", 425]]),
  ];
  const d = doc([page(items, { rules })]);
  const t = tablesOf(d)[0];
  assert.ok(t, "table found");
  assert.deepEqual([t.rows, t.cols, t.method], [4, 4, "lattice"]);
  assert.equal(t.cells.filter((k) => k.colSpan > 1).length, 0, "no merged body rows");
  assert.equal(t.cells.find((k) => k.r === 2 && k.c === 2).text, "100.0");
});

test("lattice: a spanning header stays one cell while token-split body text splits", () => {
  const xs = [80, 180, 280, 380];
  const ys = [100, 120, 140, 160];
  const rules = [];
  for (const y of ys) rules.push([80, y, 380, y]);
  rules.push([80, 100, 80, 160], [380, 100, 380, 160], [180, 120, 180, 160], [280, 120, 280, 160]);
  const items = [
    ...row(114, [["Threshold for releases", 170]], 10, "fb"),
    ...row(134, [["to air", 85], ["12", 220], ["34", 320]]),
    ...row(154, [["to water", 85], ["56", 220], ["78", 320]]),
  ];
  const d = doc([page(items, { rules })]);
  const t = tablesOf(d)[0];
  assert.ok(t);
  assert.equal(t.cells.find((k) => k.r === 0).colSpan, 3);
  assert.equal(t.cells.find((k) => k.r === 1 && k.c === 2).text, "34");
});

test("lattice: ruled columns over unruled body rows split the grid row at text baselines", () => {
  const xs = [80, 230, 330, 430];
  const rules = [[80, 100, 430, 100], [80, 120, 430, 120], [80, 200, 430, 200]];
  for (const x of xs) rules.push([x, 100, x, 200]);
  const items = [
    ...row(114, [["Country", 85], ["Cohesion", 235], ["Total", 335]], 10, "fb"),
    ...row(134, [["Bulgaria", 85], ["2.3", 240], ["5.5", 340]]),
    ...row(150, [["Cyprus", 85], ["0.21", 240], ["0.21", 340]]),
    ...row(166, [["Estonia", 85], ["1.1", 240], ["3.0", 340]]),
    ...row(182, [["Latvia", 85], ["1.5", 240], ["3.9", 340]]),
  ];
  const d = doc([page(items, { rules })]);
  const t = tablesOf(d)[0];
  assert.ok(t);
  assert.deepEqual([t.rows, t.cols], [5, 3]);
  assert.equal(t.cells.find((k) => k.r === 3 && k.c === 1).text, "1.1");
  assert.equal(t.headerRows, 1);
});

test("lattice: a two-line wrapped header row is not split into two rows", () => {
  const xs = [80, 230, 330, 430];
  const rules = [[80, 100, 430, 100], [80, 130, 430, 130], [80, 150, 430, 150], [80, 170, 430, 170]];
  for (const x of xs) rules.push([x, 100, x, 170]);
  const items = [
    ...row(112, [["Our", 235], ["LDA", 335]], 10, "fb"),
    ...row(124, [["estimates", 235], ["1997", 335]], 10, "fb"),
    ...row(144, [["Austria", 85], ["58.6", 240], ["79", 340]]),
    ...row(164, [["Belgium", 85], ["61.6", 240], ["57", 340]]),
  ];
  const d = doc([page(items, { rules })]);
  const t = tablesOf(d)[0];
  assert.ok(t);
  assert.equal(t.rows, 3);
  assert.equal(t.cells.find((k) => k.r === 0 && k.c === 1).text, "Our estimates");
});

test("booktabs rules join into one band only when the text between them reads as rows", () => {
  const words = [
    ...row(114, [["Site", 85], ["Zone", 200], ["Score", 300]]),
    ...row(134, [["Z1-014", 85], ["1", 200], ["7.5", 300]]),
    ...row(154, [["Z1-022", 85], ["1", 200], ["8.0", 300]]),
  ];
  const prose = row(200, [["This paragraph sits between two tables and describes the method in full sentences", 85]]);
  const pg = page([...words, ...prose, ...row(230, [["X", 85], ["Y", 200], ["Z", 300]]), ...row(250, [["1", 85], ["2", 200], ["3", 300]])],
    { rules: [[80, 100, 400, 100], [80, 120, 400, 120], [80, 160, 400, 160], [80, 215, 400, 215], [80, 258, 400, 258]] });
  const d = doc([pg]);
  const tables = tablesOf(d);
  assert.equal(tables.length, 2, "prose between rules separates the bands");
  assert.deepEqual(tables.map((t) => t.rows), [3, 2]);
  const rows = tabularBetween(pg.words, { x0: 80, x1: 400, y0: 160, y1: 215 });
  assert.equal(rows.tabular, false);
  assert.equal(rows.reason, "prose");
});

test("a bracketed matrix with an equation number is a formula, not a table", () => {
  const items = [
    ...row(300, [["2.0", 100], ["1500", 150], ["20,000", 200], ["5.5", 260]]),
    ...row(314, [["D", 60], ["=", 75], ["2.5", 100], ["2700", 150], ["18,000", 200], ["6.5", 260], ["(14)", 415]]),
    ...row(328, [["1.8", 100], ["2000", 150], ["21,000", 200], ["4.5", 260]]),
    ...row(400, [["Body text continues after the equation with ordinary words in a paragraph.", 60]]),
  ];
  const d = doc([page(items)]);
  assert.equal(tablesOf(d).length, 0);
  const formulas = blocksOf(d, "formula");
  assert.equal(formulas.length, 1);
  assert.equal(formulas[0].number, "(14)");
  assert.ok(formulas[0].text.includes("2700"));
  const sig = equationRowSignals(page(row(314, [["X", 60], ["0", 66, 6], ["¼", 75], ["0.5", 100], ["ð9Þ", 280]])).words, { column: { x0: 50, x1: 300 } });
  assert.equal(sig.number, "ð9Þ");
  assert.equal(sig.lead, true);
});

test("a numbered monospace listing is a code block, a numbered 'No.' column is still a table", () => {
  const code = [
    ...row(300, [["1", 90], ["def solve(a, b):", 110]], 9, "fm"),
    ...row(312, [["2", 90], ["return a + b", 110]], 9, "fm"),
    ...row(324, [["3", 90], ["print(solve(1, 2))", 110]], 9, "fm"),
  ];
  const d = doc([page(code, { rules: grid([80, 400], [290, 332]) })]);
  assert.equal(tablesOf(d).length, 0);
  const k = blocksOf(d, "code");
  assert.equal(k.length, 1);
  assert.equal(k[0].text.split("\n").length, 3);
  assert.ok(k[0].text.startsWith("def solve"));
  // Proportional text: glyph widths vary from word to word.
  const prop = (y, cells, font = "f1") => cells.map(([text, x]) => item(text, x, H - y, 10, font, text.length * 4 + 6));
  const numbered = [
    ...prop(300, [["No.", 90], ["Non-numerical data", 140], ["Conversion", 300]], "fb"),
    ...prop(314, [["1", 90], ["Not detected", 140], ["0", 300]]),
    ...prop(328, [["2", 90], ["Null", 140], ["Delete", 300]]),
    ...prop(342, [["3", 90], ["Trace", 140], ["0.5", 300]]),
  ];
  const d2 = doc([page(numbered)]);
  assert.equal(tablesOf(d2).length, 1);
  assert.equal(blocksOf(d2, "code").length, 0);
  assert.equal(isMonospace(page(code).words), true);
  assert.equal(isMonospace(page(numbered).words), false);
});

test("a stream table stops at a prose line and at a caption", () => {
  const items = [
    ...row(100, [["Model", 100], ["Params", 200], ["Score", 300]], 10, "fb"),
    ...row(114, [["GPT-3", 100], ["175B", 200], ["60.5", 300]]),
    ...row(128, [["Gopher", 100], ["280B", 200], ["79.3", 300]]),
    ...row(142, [["LLaMA", 100], ["65B", 200], ["83.7", 300]]),
    ...row(158, [["Table 3: Zero-shot performance on common sense reasoning tasks.", 100]]),
    ...row(176, [["We report the results of the models on the benchmark tasks described above in", 100]]),
    ...row(190, [["detail and compare with the published numbers of other authors where known.", 100]]),
  ];
  const d = doc([page(items)]);
  const tables = tablesOf(d);
  assert.equal(tables.length, 1);
  assert.deepEqual([tables[0].rows, tables[0].cols], [4, 3]);
  assert.ok(tables[0].bbox[3] < 150, "table ends above the caption");
  const cap = blocksOf(d, "caption");
  assert.equal(cap.length, 1);
  assert.equal(cap[0].for, tables[0].id);
});

test("tight numeric columns split by glyph-relative gaps and multi-word headers stay cells", () => {
  const hdr = row(100, [["params", 100], ["dimension", 150], ["n heads", 215], ["n layers", 270], ["learning rate", 330], ["batch size", 405], ["n tokens", 470]], 9, "fb");
  const rows = [
    row(112, [["6.7B", 100], ["4096", 150], ["32", 215], ["32", 270], ["3.0e-4", 330], ["4M", 405], ["1.0T", 470]], 9),
    row(124, [["13.0B", 100], ["5120", 150], ["40", 215], ["40", 270], ["3.0e-4", 330], ["4M", 405], ["1.0T", 470]], 9),
    row(136, [["32.5B", 100], ["6656", 150], ["52", 215], ["60", 270], ["1.5e-4", 330], ["4M", 405], ["1.4T", 470]], 9),
    row(148, [["65.2B", 100], ["8192", 150], ["64", 215], ["80", 270], ["1.5e-4", 330], ["4M", 405], ["1.4T", 470]], 9),
  ].flat();
  const d = doc([page([...hdr, ...rows])]);
  const t = tablesOf(d)[0];
  assert.ok(t);
  assert.deepEqual([t.rows, t.cols], [5, 7]);
  assert.equal(t.cells.find((k) => k.r === 0 && k.c === 2).text, "n heads");
  assert.equal(t.cells.find((k) => k.r === 1 && k.c === 3).text, "32");
  assert.equal(t.cells.find((k) => k.r === 4 && k.c === 6).text, "1.4T");
});

test("two stream runs split by a wider row gap stitch when the columns match", () => {
  const items = [
    ...row(100, [["Attr1", 100], ["0.1144", 200], ["2", 300]]),
    ...row(112, [["Attr2", 100], ["0.2049", 200], ["4", 300]]),
    ...row(124, [["Attr3", 100], ["0.2213", 200], ["7", 300]]),
    ...row(160, [["Attr4", 100], ["0.2658", 200], ["6", 300]]),
    ...row(172, [["Attr5", 100], ["0.2365", 200], ["5", 300]]),
    ...row(184, [["Attr6", 100], ["0.1251", 200], ["3", 300]]),
  ];
  const d = doc([page(items)]);
  const tables = tablesOf(d);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].rows, 6);
  assert.equal(tables[0].cells.filter((k) => k.text).length, 18, "every row kept");
  // Direct unit: stitchTables leaves different column structures alone.
  const a = { method: "stream", page: 1, cols: 3, rows: 2, bbox: [100, 100, 320, 130], grid: { xs: [98, 150, 250, 322], ys: [100, 115, 130] }, cells: [], confidence: 1 };
  const b = { method: "stream", page: 1, cols: 3, rows: 2, bbox: [100, 140, 320, 170], grid: { xs: [98, 200, 290, 322], ys: [140, 155, 170] }, cells: [], confidence: 1 };
  assert.equal(stitchTables([a, b], [], 10).length, 2);
});

test("a table continued on the next page carries `continues`", () => {
  const p1 = page([
    ...row(640, [["Study", 60], ["Sport", 200], ["N", 350]], 10, "fb"),
    ...row(654, [["Smith 2001", 60], ["Golf", 200], ["24", 350]]),
    ...row(668, [["Jones 2004", 60], ["Tennis", 200], ["31", 350]]),
    ...row(682, [["Lee 2010", 60], ["Rowing", 200], ["18", 350]]),
    ...row(700, [["(Continued)", 330]]),
  ], {}, 1);
  const p2 = page([
    ...row(66, [["Table 1. Continued.", 60]]),
    ...row(90, [["Study", 60], ["Sport", 200], ["N", 350]], 10, "fb"),
    ...row(104, [["Park 2012", 60], ["Swimming", 200], ["40", 350]]),
    ...row(118, [["Kim 2015", 60], ["Golf", 200], ["12", 350]]),
    ...row(132, [["Ali 2018", 60], ["Cycling", 200], ["22", 350]]),
    ...row(300, [["Body text resumes here with an ordinary paragraph of the article under review.", 60]]),
  ], {}, 2);
  const d = doc([p1, p2]);
  const tables = tablesOf(d);
  assert.equal(tables.length, 2);
  assert.equal(tables[1].continues, tables[0].id);
  assert.equal(tables[0].continues, undefined);
  // Different column counts never link.
  const blocks = { t1: { id: "t1", type: "table", page: 1, cols: 3, bbox: [0, 600, 100, 700] }, t2: { id: "t2", type: "table", page: 2, cols: 4, bbox: [0, 60, 100, 200] } };
  linkContinuedTables(["t1", "t2"], blocks, [{ n: 1, h: 792 }, { n: 2, h: 792 }]);
  assert.equal(blocks.t2.continues, undefined);
});

test("numbered body-size headings in italic or bold become headings with numbering depth", () => {
  const items = [
    ...row(80, [["Novel risk assessment model of food quality", 60]], 16, "fb"),
    ...row(120, [["1. Introduction", 60]], 10, "fb"),
    ...row(136, [["Food safety is a public concern in every country and the models used to assess it", 60]]),
    ...row(150, [["differ widely between agencies, a difference this paper tries to explain in full.", 60]]),
    ...row(180, [["2. Materials and methods", 60]], 10, "fb"),
    ...row(200, [["2.1. The coefficient of variation algorithm", 60]], 10, "fi"),
    ...row(216, [["The coefficient of variation measures the dispersion of an attribute around its", 60]]),
    ...row(230, [["mean value and is unitless, which is why it suits comparisons across indexes.", 60]]),
    ...row(260, [["3.2. The verification of weight compatibility", 60]], 10, "fi"),
    ...row(276, [["The stability and usability of the method are verified by using the index pair.", 60]]),
    ...row(290, [["1  Ej", 100]], 10, "fb"),
    ...row(306, [["Lines like the one above are equation fragments and must not become headings.", 60]]),
  ];
  const d = doc([page(items)]);
  const hs = blocksOf(d, "heading");
  const byText = Object.fromEntries(hs.map((h) => [h.text, h.level]));
  assert.equal(byText["Novel risk assessment model of food quality"], 1);
  assert.equal(byText["1. Introduction"], 2);
  assert.equal(byText["2. Materials and methods"], 2);
  assert.equal(byText["2.1. The coefficient of variation algorithm"], 3);
  assert.equal(byText["3.2. The verification of weight compatibility"], 3);
  assert.equal(byText["1 Ej"], undefined);
  assert.equal(headingLevel({ text: "4.1. Food data preprocessing", size: 10, bold: false, italic: false, words: [{ text: "4.1." }, { text: "Food" }], mathShare: 0 }, { bodySize: 10, classes: [16], isolated: true }), 3);
  assert.equal(headingLevel({ text: "2006. The year the market turned", size: 10, bold: false, italic: false, words: [], mathShare: 0 }, { bodySize: 10, classes: [16], isolated: false }), 0);
  assert.equal(headingLevel({ text: "⁎ ⁎ ⁎⁎", size: 16, bold: true, italic: false, words: [], mathShare: 0 }, { bodySize: 10, classes: [16], isolated: true }), 0);
  assert.equal(headingLevel({ text: "Title⁎", size: 16, bold: true, italic: false, words: [], mathShare: 0 }, { bodySize: 10, classes: [16], isolated: true }), 1);
});

test("a bar chart with gridlines and value labels is not a table", () => {
  const rules = [[110, 120, 495, 120], [110, 150, 495, 150], [110, 180, 495, 180], [110, 210, 495, 210], [110, 240, 495, 240], [110, 120, 110, 240]];
  const boxes = [[111, 125, 214, 140, 0.3], [214, 125, 371, 140, 0.5], [111, 155, 216, 170, 0.3], [216, 155, 388, 170, 0.5], [111, 185, 221, 200, 0.3], [221, 185, 399, 200, 0.5]];
  const items = [
    ...row(135, [["2001", 80], ["30.5", 150], ["49.0", 280], ["20.4", 420]], 8),
    ...row(165, [["2005", 80], ["29.7", 150], ["48.6", 280], ["21.7", 420]], 8),
    ...row(195, [["2010", 80], ["28.7", 150], ["46.3", 280], ["25.0", 420]], 8),
    ...row(225, [["2015", 80], ["27.2", 150], ["45.0", 280], ["27.8", 420]], 8),
  ];
  const pg = page(items, { rules, boxes });
  const lat = findLatticeTables({ rules: pg.graphics.rules, boxes: pg.graphics.boxes, words: pg.words });
  assert.equal(lat.tables.length, 0);
  assert.ok(lat.bands.length >= 1);
  assert.equal(looksLikeChart(lat.bands[0], pg.graphics), true);
  const d = doc([pg]);
  assert.equal(tablesOf(d).length, 0);
  assert.equal(blocksOf(d, "figure").length, 1);
});

test("light cell shading does not read as chart bars", () => {
  const band = { x0: 65, x1: 517, y0: 293, y1: 372 };
  const boxes = [];
  for (let i = 0; i < 6; i++) boxes.push({ x0: 65 + i * 75, x1: 65 + i * 75 + 70, y0: 293, y1: 308, light: true });
  assert.equal(looksLikeChart(band, { boxes }), false);
});

test("a heading over one spanning line is a titled box, not a table", () => {
  assert.equal(isTitledBox({ rows: 2, cols: 2, cells: [{ r: 0, c: 0, colSpan: 1, text: "A R T I C L E" }, { r: 0, c: 1, colSpan: 1, text: "I N F O" }, { r: 1, c: 0, colSpan: 2, text: "Editor: Jacopo Bacenetti" }] }), true);
  assert.equal(isTitledBox({ rows: 1, cols: 3, cells: [] }), true);
  assert.equal(isTitledBox({ rows: 2, cols: 2, cells: [{ r: 0, c: 0, colSpan: 1, text: "a" }, { r: 0, c: 1, colSpan: 1, text: "b" }, { r: 1, c: 0, colSpan: 1, text: "c" }, { r: 1, c: 1, colSpan: 1, text: "d" }] }), false);
});

test("stream detector returns typed items: tables keep rows, formulas and code are separate", () => {
  const pg = page([
    ...row(300, [["a", 100], ["=", 110], ["1", 130], ["2", 160], ["(3)", 290]]),
    ...row(312, [["b", 100], ["=", 110], ["3", 130], ["4", 160]]),
  ]);
  const items = detectStreamRuns(pg.lines, { column: { x0: 90, x1: 300 } });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "formula");
  assert.equal(items[0].number, "(3)");
});

test("ICDAR harness: GT parsing and the adjacency relation metric", () => {
  const str = `<document><table id="1"><region page="1" id="1"><cell id="1" start-col="1" start-row="1"><bounding-box x1="1" x2="2" y1="3" y2="4"/><content>A</content></cell>
    <cell id="2" start-col="2" start-row="1" end-col="3"><content>B</content></cell>
    <cell id="3" start-col="1" start-row="2"><content></content></cell>
    <cell id="4" start-col="2" start-row="2"><content>C&amp;D</content></cell>
    <cell id="5" start-col="3" start-row="2"><content>E</content></cell></region></table></document>`;
  const [t] = parseStructure(str);
  assert.equal(t.cells.length, 5);
  assert.deepEqual([t.cells[0].r, t.cells[0].c, t.cells[1].c1, t.cells[3].text], [0, 0, 2, "C&D"]);
  const rel = adjacencyRelations(t.cells);
  // A->B right; nothing non-empty below A (blank cells are skipped); B->C&D and B->E below; C&D->E right.
  assert.deepEqual([...rel.keys()].sort(), ["A\u0001B\u0001h", "B\u0001C&D\u0001v", "B\u0001E\u0001v", "C&D\u0001E\u0001h"]);
  const reg = parseRegions(`<document><table id='1'><region id='1' page='2'><bounding-box x1='100' y1='451' x2='482' y2='543'/></region></table></document>`);
  assert.deepEqual(reg, [{ id: "1", regions: [{ page: 2, bbox: [100, 451, 482, 543] }] }]);
  assert.deepEqual(prf(3, 1, 1), { tp: 3, fp: 1, fn: 1, p: 0.75, r: 0.75, f1: 0.75 });
});
