// Regression tests for the round-3 failure classes (ICDAR 2013 US split, scanned pages with an
// OCR text layer). Synthetic page data only: pdf.js-like text items and legacy path operators.
import test from "node:test";
import assert from "node:assert/strict";

import { OP } from "../src/model/parse/rules.js";
import { absorbSectionBanners, absorbTableFooters, assembleDocument, parsePageGeometry, stitchTables } from "../src/model/parse/index.js";
import { normalizeStreamPiece } from "../src/model/parse/ocr-fix.js";
import { boxGridRules, findLatticeTables, tabularBetween, cellTextOf } from "../src/model/parse/lattice.js";
import { detectStreamRuns, refineColumns, splitTokensAt, tokenizeLine, headerRowGroups } from "../src/model/parse/stream.js";
import { buildLines, letterSpaced, dominantRotation } from "../src/model/parse/lines.js";
import { findFurniture } from "../src/model/parse/furniture.js";

const H = 792;
const W = 612;
const FONTS = {
  f1: { name: "Helvetica", fontFamily: "sans-serif" },
  fb: { name: "Helvetica-Bold", fontFamily: "sans-serif" },
  fm: { name: "Courier", fontFamily: "monospace" },
};
// Text item at PDF coords (x, baseline y from the bottom). Default glyph width 0.5 em.
const item = (str, x, y, size = 10, font = "f1", width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: font, hasEOL: false });
// Words on one baseline (top-left y) at given x positions.
const row = (y, cells, size = 10, font = "f1") => cells.map(([text, x]) => item(text, x, H - y, size, font));
// A word right-aligned so that it ends at x1.
const ral = (text, x1, size = 10) => [text, x1 - text.length * size * 0.5];

function ops(rules = [], boxes = [], images = []) {
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
  for (const im of images) {
    const [x0, y0, x1, y1] = im;
    fnArray.push(OP.save, OP.transform, OP.paintImageXObject, OP.restore);
    argsArray.push(null, [x1 - x0, 0, 0, y1 - y0, x0, H - y1], ["img", 1, 1], null);
  }
  return { fnArray, argsArray };
}

function page(items, { rules = [], boxes = [], images = [] } = {}, n = 1) {
  return parsePageGeometry({ items, ops: ops(rules, boxes, images), w: W, h: H, fonts: FONTS }, n);
}

function doc(pages) {
  return assembleDocument(pages, { numPages: pages.length });
}

function tablesOf(d) { return d.order.map((id) => d.blocks[id]).filter((b) => b.type === "table"); }
function blocksOf(d, type) { return d.order.map((id) => d.blocks[id]).filter((b) => b.type === type); }
function cellAt(t, r, c) { return t.cells.find((k) => k.r === r && k.c === c); }
function grid(xs, ys) {
  const rules = [];
  for (const y of ys) rules.push([xs[0], y, xs[xs.length - 1], y]);
  for (const x of xs) rules.push([x, ys[0], x, ys[ys.length - 1]]);
  return rules;
}

// ---------- dense numeric columns ----------

test("whitespace shared by the body rows splits a column that a group header bridges", () => {
  // "Weight Relative" bridges two numeric columns; the numbers are right-aligned 5 pt apart.
  const items = [
    ...row(100, [["Dose", 60], ["No.", 130], ["Weight Relative", 180]], 10, "fb"),
    ...row(114, [["0", 60], ral("39", 150), ral("5.8", 195), ral("102", 220)]),
    ...row(128, [["250", 60], ral("30", 150), ral("5.9", 195), ral("104", 220)]),
    ...row(142, [["500", 60], ral("33", 150), ral("6.0", 195), ral("103", 220)]),
    ...row(156, [["1,000", 60], ral("31", 150), ral("5.8", 195), ral("100", 220)]),
    ...row(170, [["2,000", 60], ral("38", 150), ral("5.3", 195), ral("91", 220)]),
  ];
  const t = tablesOf(doc([page(items)]))[0];
  assert.ok(t, "a table");
  assert.equal(t.cols, 4);
  assert.equal(cellAt(t, 2, 2).text, "5.9");
  assert.equal(cellAt(t, 2, 3).text, "104");
  assert.equal(cellAt(t, 0, 2).colSpan, 2, "the group header spans both numeric columns");
});

test("refineColumns keeps a space thousands separator and a repeated unit in one cell", () => {
  const rows = (lines) => lines.map((l) => ({ y0: l.y0, y1: l.y1, tokens: tokenizeLine(l) }));
  const a = buildLines([
    ...row(100, [["Austria", 60], ["15 455", 200]]), ...row(114, [["Belgium", 60], ["13 951", 200]]),
    ...row(128, [["Denmark", 60], ["12 068", 200]]), ...row(142, [["Finland", 60], ["20 527", 200]]),
  ], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines;
  const ra = rows(a);
  const colsA = [{ x0: 60, x1: 100 }, { x0: 200, x1: 230 }];
  assert.equal(refineColumns(ra, colsA).cols.length, 2, "15 455 is one number");
  const b = buildLines([
    ...row(100, [["40 years", 60], ["12", 200]]), ...row(114, [["41 years", 60], ["13", 200]]),
    ...row(128, [["42 years", 60], ["14", 200]]), ...row(142, [["43 years", 60], ["15", 200]]),
  ], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines;
  assert.equal(refineColumns(rows(b), [{ x0: 60, x1: 100 }, { x0: 200, x1: 210 }]).cols.length, 2, "40 years is one cell");
});

test("splitTokensAt parts a token only where its words leave the separator free", () => {
  const line = buildLines(row(100, [["5.9", 100], ["102", 120]]), { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines[0];
  const tokens = tokenizeLine(line);
  assert.equal(tokens.length, 1, "the coarse tokenizer merges the narrow gap");
  const parts = splitTokensAt(tokens, [{ x0: 116, x1: 119 }]);
  assert.deepEqual(parts.map((t) => t.text), ["5.9", "102"]);
  const spanning = splitTokensAt(tokens, [{ x0: 110, x1: 112 }]);
  assert.equal(spanning.length, 1, "ink across the separator keeps the token whole");
});

// ---------- box tilings, zebra striping, frames ----------

test("filled boxes that tile a rectangle carry the grid; nested insets and bars do not", () => {
  const tiles = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tiles.push({ x0: 100 + c * 100, y0: 100 + r * 20, x1: 200 + c * 100, y1: 120 + r * 20, fill: [0.2], light: false });
  tiles.push({ x0: 104, y0: 100, x1: 196, y1: 120, fill: [0.2], light: false }); // padding inset
  const out = boxGridRules(tiles);
  assert.equal(out.boxes.length, 9);
  assert.equal(out.rules.length, 40, "four edges per box plus the cluster frame");
  const bars = [{ x0: 100, y0: 150, x1: 120, y1: 200 }, { x0: 140, y0: 120, x1: 160, y1: 200 }, { x0: 180, y0: 170, x1: 200, y1: 200 }, { x0: 220, y0: 130, x1: 240, y1: 200 }].map((b) => ({ ...b, fill: [0.3], light: false }));
  assert.equal(boxGridRules(bars).rules.length, 0, "a bar chart is not a tiling");
  const white = tiles.slice(0, 9).map((b) => ({ ...b, fill: "#ffffff", light: true }));
  assert.equal(boxGridRules(white).rules.length, 0, "white line backgrounds are not tiles");
});

test("a dark header row over zebra-shaded rows is a lattice table with one header row", () => {
  // Per-cell boxes like a word-processor table: a dark header row, light stripes on rows 1, 3, 5.
  const boxes = [];
  const xs = [100, 200, 300, 400];
  for (let c = 0; c < 3; c++) boxes.push([xs[c], 100, xs[c + 1], 120, 0.2]);
  for (let r = 1; r < 6; r += 2) for (let c = 0; c < 3; c++) boxes.push([xs[c], 100 + r * 20, xs[c + 1], 120 + r * 20, 0.9]);
  const items = [
    ...row(115, [["Item", 110], ["2007", 230], ["2008", 330]]),
    ...row(135, [["Cases", 110], ["426", 230], ["365", 330]]),
    ...row(155, [["Charged", 110], ["290", 230], ["259", 330]]),
    ...row(175, [["Sentenced", 110], ["287", 230], ["242", 330]]),
    ...row(195, [["Prison", 110], ["148", 230], ["107", 330]]),
    ...row(215, [["Months", 110], ["52", 230], ["48", 330]]),
  ];
  const pg = page(items, { boxes, rules: [[100, 100, 400, 100], [100, 220, 400, 220]] });
  const t = pg.tables[0];
  assert.ok(t && t.method === "lattice", "boxes form a lattice table");
  assert.equal(t.rows, 6);
  assert.equal(t.headerRows, 1, "the dark fill is the header, the zebra is not");
  assert.equal(pg.figures.length, 0, "no figure is made of the boxes");
});

test("a ruled frame drops its title row above and its notes rows below the table", () => {
  const xs = [70, 250, 400, 540];
  const ys = [100, 130, 150, 170, 190, 210, 240];
  // The frame: outer box plus full-width rules; inner verticals only through the data rows.
  const rules = [...ys.map((y) => [70, y, 540, y]), [70, 100, 70, 240], [540, 100, 540, 240], [250, 130, 250, 210], [400, 130, 400, 210]];
  const items = [
    ...row(118, [["Exhibit 19 Percentage of schools by designation", 120]]),
    ...row(145, [["Designation", 75], ["Identified", 260], ["Not identified", 410]], 10, "fb"),
    ...row(165, [["Low-performing", 75], ["34%", 300], ["3%", 450]]),
    ...row(185, [["High-performing", 75], ["2%", 300], ["18%", 450]]),
    ...row(205, [["Other", 75], ["14%", 300], ["9%", 450]]),
    ...row(225, [["Exhibit reads: Thirty-four percent of schools identified were low-performing.", 75]]),
  ];
  const d = doc([page(items, { rules })]);
  const t = tablesOf(d)[0];
  assert.equal(t.rows, 4);
  assert.equal(t.cols, 3);
  assert.equal(cellAt(t, 0, 0).text, "Designation");
  assert.ok(d.order.map((id) => d.blocks[id]).some((b) => /Exhibit 19/.test(b.text || "")), "the title is a text block again");
  assert.ok(d.order.map((id) => d.blocks[id]).some((b) => /Exhibit reads/.test(b.text || "")), "the note is a text block again");
});

test("unruled prose rows inside a ruled row split at the blank line between them", () => {
  const xs = [70, 200, 400, 540];
  const rules = grid(xs, [100, 120, 240]);
  const items = [
    ...row(115, [["Source", 75], ["Definition", 210], ["Examples", 410]], 10, "fb"),
    ...row(135, [["Major", 100], ["Emissions of 10 tons per year or", 210], ["Utilities, refineries, steel", 410]]),
    ...row(147, [["more of any one air toxic", 210], ["manufacturers", 410]]),
    ...row(175, [["Area", 100], ["Emissions of less than 10 tons", 210], ["Dry cleaners, gas stations", 410]]),
    ...row(187, [["per year of any one pollutant", 210], ["and auto body shops", 410]]),
  ];
  const t = tablesOf(doc([page(items, { rules })]))[0];
  assert.equal(t.rows, 3);
  assert.equal(cellAt(t, 1, 0).text, "Major");
  assert.equal(cellAt(t, 2, 0).text, "Area");
  assert.match(cellAt(t, 2, 1).text, /^Emissions of less than 10 tons per year/);
});

test("a ruled row holding a wrapped header is one row; numeric sub-rows still split", () => {
  const xs = [70, 200, 300, 400];
  const header = [
    ...row(112, [["Age 4", 230]], 10, "fb"),
    ...row(124, [["(Head Start", 215], ["1", 340]], 10, "fb"),
    ...row(136, [["Measure", 75], ["Year)", 225], ["K", 320], ["Grade", 330]], 10, "fb"),
  ];
  const body = [
    ...row(158, [["Color", 75], ["0.16", 220], ["NA", 320]]),
    ...row(170, [["Letter", 75], ["0.25", 220], ["NA", 320]]),
    ...row(182, [["Word", 75], ["0.31", 220], ["NA", 320]]),
  ];
  const t = tablesOf(doc([page([...header, ...body], { rules: grid(xs, [100, 142, 192]) })]))[0];
  assert.equal(t.rows, 2, "the stacked header is one row and the text body is one row");
  const numeric = [
    ...row(158, [["Mink", 75], ["2880", 220], ["1038", 320]]),
    ...row(170, [["Otter", 75], ["1930", 220], ["764", 320]]),
    ...row(182, [["Eagle", 75], ["1920", 220], ["1818", 320]]),
  ];
  const u = tablesOf(doc([page([...header, ...numeric], { rules: grid(xs, [100, 142, 192]) })]))[0];
  assert.equal(u.rows, 4, "three numeric baselines are three rows");
});

// ---------- stream runs: wrapped labels, spanning headers, text rules ----------

test("a wrapped label whose values sit between its lines is one row of a stream table", () => {
  const items = [
    ...row(100, [["Measure", 60], ["1997", 300], ["1998", 360], ["1999", 420]], 10, "fb"),
    ...row(114, [["Median income", 60], ["49,497", 300], ["51,295", 360], ["52,587", 420]]),
    ...row(126, [["Between-state income", 60]]),
    ...row(131, [["0.0628", 300], ["0.0636", 360], ["0.0612", 420]]),
    ...row(136, [["index)", 60]]),
    ...row(150, [["Premature mortality", 60], ["7108.3", 300], ["6960.6", 360], ["6920.0", 420]]),
    ...row(164, [["Mean HALex", 60], ["0.8766", 300], ["0.8762", 360], ["0.8779", 420]]),
  ];
  const t = tablesOf(doc([page(items)]))[0];
  assert.equal(t.rows, 5);
  assert.equal(cellAt(t, 2, 0).text, "Between-state income index)");
  assert.equal(cellAt(t, 2, 1).text, "0.0628");
});

test("a second label line between two data rows joins its label; a group label stays a row", () => {
  const items = [
    ...row(100, [["Characteristic", 60], ["no.", 300], ["(%)", 360]], 10, "fb"),
    ...row(114, [["Hispanic", 60], ["966", 300], ["(7.7)", 360]]),
    ...row(126, [["American Indian/Alaska", 60], ["51", 300], ["(7.2)", 360]]),
    ...row(138, [["Native", 60]]),
    ...row(150, [["Other", 60], ["174", 300], ["(4.3)", 360]]),
    ...row(170, [["Type of degree", 60]]),
    ...row(182, [["Public 4-year", 68], ["466", 300], ["(5.1)", 360]]),
    ...row(194, [["Private", 68], ["219", 300], ["(2.2)", 360]]),
  ];
  const t = tablesOf(doc([page(items)]))[0];
  assert.equal(cellAt(t, 2, 0).text, "American Indian/Alaska Native");
  assert.ok(t.cells.some((k) => k.text === "Type of degree"), "the group label is its own row");
  assert.equal(t.rows, 7);
});

test("a header centred over the columns, a text rule and a second table with its own header", () => {
  const one = (top) => [
    ...row(top, [["Design effect", 275]]),
    ...row(top + 14, [["Proportion", 60], ["1.0", 200], ["1.1", 250], ["1.2", 300], ["1.3", 350], ["1.4", 400]]),
    ...row(top + 28, [["--------------------------------------------------------------------------", 60]]),
    ...row(top + 42, [["0.99", 60], ["800", 200], ["880", 250], ["960", 300], ["1,040", 350], ["1,120", 400]]),
    ...row(top + 56, [["0.95", 60], ["160", 200], ["176", 250], ["192", 300], ["208", 350], ["224", 400]]),
    ...row(top + 70, [["0.90", 60], ["80", 200], ["88", 250], ["96", 300], ["104", 350], ["112", 400]]),
  ];
  const d = doc([page([...one(100), ...one(200)])]);
  const tables = tablesOf(d);
  assert.equal(tables.length, 2, "stacked tables with their own headers are not stitched");
  const t = tables[0];
  assert.equal(t.rows, 5, "the text rule is not a row");
  assert.equal(t.headerRows, 2);
  const de = t.cells.find((k) => k.text === "Design effect");
  assert.equal(de.c, 1);
  assert.equal(de.colSpan, 5);
  const prop = t.cells.find((k) => k.text === "Proportion");
  assert.equal(prop.r, 0);
  assert.equal(prop.rowSpan, 2, "the label on the lower header line starts at the top");
});

test("a header label on the last header line spans upward; a lower-case line wraps it", () => {
  const items = [
    ...row(100, [["2007", 280]], 10, "fb"),
    ...row(112, [["Inadequate housing", 280]], 10, "fb"),
    ...row(124, [["Characteristic", 60], ["total", 200], ["no.", 260], ["(%)", 310], ["OR", 360]], 10, "fb"),
    ...row(134, [["occupied", 200]], 10, "fb"),
    ...row(150, [["Male", 60], ["61,206", 200], ["2,862", 260], ["(4.7)", 310], ["Ref.", 360]]),
    ...row(164, [["Female", 60], ["49,486", 200], ["2,909", 260], ["(5.9)", 310], ["1.1", 360]]),
    ...row(178, [["Other", 60], ["12,609", 200], ["966", 260], ["(7.7)", 310], ["2.0", 360]]),
  ];
  const t = tablesOf(doc([page(items)]))[0];
  const ch = t.cells.find((k) => k.text === "Characteristic");
  assert.equal(ch.r, 0);
  assert.equal(ch.rowSpan, 3);
  const to = t.cells.find((k) => /^total occupied/.test(k.text));
  assert.ok(to, "the wrapped header label is one cell");
  assert.equal(to.rowSpan, 2);
});

test("header baselines without rules group by size and by spanning tokens", () => {
  const lines = buildLines([
    ...row(100, [["U.S. population", 250]], 12),
    ...row(114, [["Proportion", 200], ["Proportion", 300], ["Total", 400]], 9),
    ...row(124, [["(total)", 200], ["(20+ years)", 300]], 9),
  ], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines;
  const groups = headerRowGroups(lines.flatMap((l) => l.words));
  assert.equal(groups.length, 2, "size change splits, the bracketed continuation merges");
  const spans = buildLines([
    ...row(100, [["Age", 60], ["Non-Hispanic white", 150], ["Non-Hispanic black", 300]]),
    ...row(112, [["Male", 160], ["Female", 220], ["Male", 310], ["Female", 370]]),
  ], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines;
  assert.equal(headerRowGroups(spans.flatMap((l) => l.words)).length, 2, "a token over two tokens is a new header row");
});

test("tabularBetween counts a wrapped label with centred values as one multi-token row", () => {
  const words = buildLines([
    ...row(126, [["Between-state income inequality (Gini", 45]], 8),
    ...row(131, [["0.0628", 203], ["0.0636", 237], ["0.0612", 272]], 8),
    ...row(136, [["index)", 45]], 8),
    ...row(150, [["Premature mortality (years of potential life", 45]], 8),
    ...row(155, [["7108.3", 203], ["6960.6", 237], ["6920.0", 272]], 8),
    ...row(160, [["lost before age 75 yrs/100,000 population)", 45]], 8),
  ], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines.flatMap((l) => l.words);
  assert.equal(tabularBetween(words, { x0: 45, x1: 320, y0: 115, y1: 170 }).tabular, true);
});

test("numbered monospace lines with an empty line stay a code block", () => {
  const items = [];
  for (let n = 1; n <= 6; n++) items.push(...row(100 + n * 12, n === 4 ? [[String(n), 60]] : [[String(n), 60], [`const x${n} = ${n};`, 80]], 10, "fm"));
  const d = doc([page(items)]);
  assert.equal(tablesOf(d).length, 0);
  assert.equal(blocksOf(d, "code").length, 1);
});

test("text beside figure labels, one line each, is not a table even when two lines share a column", () => {
  // Figure labels at the left and lines of prose at the right, one line each: no table.
  const labels = ["14-", "-12", "18-", "16-"];
  const prose = ["Britain and in the United States for many years.", "It has been superseded, however, and is now nearly", "obsolete. By the repeated copying of old specifica-", "tions its use has persisted to some extent, both in"];
  const items = labels.flatMap((l, i) => row(400 + i * 12, [[l, 74], [prose[i], 150]]));
  assert.equal(tablesOf(doc([page(items)])).length, 0);
});

test("stitchTables leaves a second piece with its own header rows alone", () => {
  const a = { method: "stream", page: 1, cols: 3, rows: 3, headerRows: 1, bbox: [100, 100, 320, 140], grid: { xs: [98, 150, 250, 322], ys: [100, 115, 130, 140] }, cells: [], confidence: 1 };
  const b = { method: "stream", page: 1, cols: 3, rows: 3, headerRows: 1, bbox: [100, 150, 320, 190], grid: { xs: [98, 150, 250, 322], ys: [150, 165, 180, 190] }, cells: [], confidence: 1 };
  assert.equal(stitchTables([a, b], [], 10).length, 2);
  const c = { ...b, headerRows: 0 };
  assert.equal(stitchTables([{ ...a }, c], [], 10).length, 1);
});

test("stitchTables takes one short section line between two pieces as a row, once a leader column is off the second piece", () => {
  const cell = (r, c, text, colSpan = 1) => ({ r, c, rowSpan: 1, colSpan, text, header: false });
  const names = ["Alberti, Clark", "Barbour, J. H.", "Benton, Robert H.", "Burnham, F. R."];
  const a = {
    method: "stream", page: 1, cols: 3, rows: 4, headerRows: 0, bbox: [22, 156, 297, 220],
    grid: { xs: [22, 160, 227, 297], ys: [156, 172, 188, 204, 220] },
    cells: names.flatMap((n, r) => [cell(r, 0, n), cell(r, 1, "Mar. 18, 1889"), cell(r, 2, "Present.")]),
    confidence: 1,
  };
  // The second piece read the leader dots of one row as a column of its own.
  const b = {
    method: "stream", page: 1, cols: 4, rows: 4, headerRows: 0, bbox: [22, 240, 297, 304],
    grid: { xs: [22, 118, 171, 223, 297], ys: [240, 256, 272, 288, 304] },
    cells: [
      cell(0, 0, "Alexander, W. G."), cell(0, 1, "—"), cell(0, 2, "Sept. 8, 1913"), cell(0, 3, "Present."),
      cell(1, 0, "Crummey, John D."), cell(1, 2, "Sept. 8, 1913"), cell(1, 3, "Present."),
      cell(2, 0, "Sontheimer, W. M."), cell(2, 2, "Sept. 8, 1913"), cell(2, 3, "Present."),
      cell(3, 0, "Tully, R. M."), cell(3, 2, "Sept. 8, 1913"), cell(3, 3, "Present."),
    ],
    confidence: 1,
  };
  normalizeStreamPiece(b);
  assert.equal(b.cols, 3);
  assert.deepEqual(b.grid.xs, [22, 171, 223, 297]);
  // A three-row piece whose dates split at the month joins them before the comparison.
  const split = {
    method: "stream", page: 1, cols: 4, rows: 3, headerRows: 0, bbox: [22, 380, 276, 403],
    grid: { xs: [22, 118, 171, 223, 276], ys: [380, 388, 396, 403] },
    cells: [0, 1, 2].flatMap((r) => [cell(r, 0, "Crummey, John D."), cell(r, 1, "Sept."), cell(r, 2, "8, 1913"), cell(r, 3, "Present.")]),
    confidence: 1,
  };
  normalizeStreamPiece(split);
  assert.equal(split.cols, 3);
  assert.deepEqual(split.grid.xs, [22, 118, 223, 276]);
  assert.equal(split.cells.find((k) => k.r === 1 && k.c === 1).text, "Sept. 8, 1913");
  // The split after the day ("Mar. 1," | "1917."), and one note word in a column of its own.
  const rowsOf = (n, mk) => Array.from({ length: n }, (_, r) => mk(r)).flat();
  const tail = {
    method: "stream", page: 1, cols: 4, rows: 9, headerRows: 0, bbox: [29, 89, 339, 455],
    grid: { xs: [29, 139, 229, 304, 339], ys: Array.from({ length: 10 }, (_, i) => 89 + i * 40) },
    cells: rowsOf(9, (r) => [cell(r, 0, `Name ${r}`), cell(r, 1, "Mar. 1,"), cell(r, 2, "1917."), cell(r, 3, r === 4 || r === 7 ? "Deceased." : "")]),
    confidence: 1,
  };
  normalizeStreamPiece(tail);
  assert.equal(tail.cols, 2);
  assert.equal(tail.cells.find((k) => k.r === 4 && k.c === 1).text, "Mar. 1, 1917. Deceased.");
  assert.equal(tail.cells.find((k) => k.r === 3 && k.c === 1).text, "Mar. 1, 1917.");
  // A headed column, or one filled in more than a quarter of the rows, stays.
  const headed = {
    method: "stream", page: 1, cols: 3, rows: 9, headerRows: 1, bbox: [29, 89, 339, 455],
    grid: { xs: [29, 139, 304, 339], ys: Array.from({ length: 10 }, (_, i) => 89 + i * 40) },
    cells: [cell(0, 0, "Name"), cell(0, 1, "Date"), cell(0, 2, "Note"), ...rowsOf(8, (r) => [cell(r + 1, 0, `Name ${r}`), cell(r + 1, 1, "Mar. 1, 1917."), cell(r + 1, 2, r === 4 ? "Deceased." : "")])],
    confidence: 1,
  };
  normalizeStreamPiece(headed);
  assert.equal(headed.cols, 3);
  const banner = { type: "para", text: "Harbor Commissioners for the Port of San Jose, 1913-1924.", bbox: { x0: 91, x1: 280, y0: 226, y1: 233 } };
  const blocks = [banner];
  const out = stitchTables([a, b], blocks, 7.5);
  assert.equal(out.length, 1);
  assert.equal(out[0].rows, 9);
  const row = out[0].cells.find((k) => k.r === 4);
  assert.equal(row.text, banner.text);
  assert.equal(row.colSpan, 3);
  assert.equal(out[0].cells.find((k) => k.r === 5 && k.c === 1).text, "Sept. 8, 1913");
  assert.equal(blocks.length, 0, "the banner line left the text blocks");
  // A caption between two pieces keeps them apart.
  const caption = { type: "para", text: "Table 2. Members by year, 1913-1924.", bbox: { x0: 91, x1: 280, y0: 226, y1: 233 } };
  assert.equal(stitchTables([structuredClone(a), structuredClone(b)], [caption], 7.5).length, 2);
});

test("stitchTables joins a section banner and the same banner above the first piece", () => {
  const cell = (r, c, text, colSpan = 1) => ({ r, c, rowSpan: 1, colSpan, text, header: false });
  const a = {
    method: "stream", page: 1, cols: 4, rows: 3, headerRows: 0,
    bbox: [100, 300, 520, 365],
    grid: { xs: [99, 356, 424, 478, 521], ys: [300, 320, 340, 365] },
    cells: [cell(0, 0, "Pressure"), cell(0, 1, "0"), cell(0, 2, "12"), cell(0, 3, "15")],
    confidence: 1,
  };
  const b = {
    method: "stream", page: 1, cols: 4, rows: 2, headerRows: 1,
    bbox: [100, 374, 522, 430],
    grid: { xs: [100, 357, 425, 482, 523], ys: [374, 390, 430] },
    cells: [cell(0, 0, "Supercharger speed - 2,000 r.p.m.", 4), cell(1, 0, "Pressure"), cell(1, 1, "0")],
    confidence: 1,
  };
  const blocks = [{ type: "para", text: "Supercharger Speed - 1,000 r.p.m.", bbox: { x0: 186, y0: 274, x1: 433, y1: 287 } }];
  const joined = stitchTables([a, b], blocks, 12.5);
  assert.equal(joined.length, 1);
  absorbSectionBanners(joined, blocks, 12.5);
  assert.equal(blocks.length, 0);
  assert.equal(joined[0].rows, 6);
  assert.equal(joined[0].cells.find((c) => c.r === 0).text, "Supercharger Speed - 1,000 r.p.m.");
  assert.equal(joined[0].cells.find((c) => c.r === 0).colSpan, 4);
  assert.equal(joined[0].cells.find((c) => /2,000/.test(c.text)).r, 4);
});

test("absorbTableFooters takes the line on the bottom rule and leaves the paragraph under it", () => {
  const table = {
    method: "lattice", page: 1, cols: 3, rows: 2, headerRows: 1,
    bbox: [130, 82, 482, 280],
    grid: { ys: [82, 100, 280] },
    cells: [
      { r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "Factor" },
      { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: "10" },
    ],
  };
  const blocks = [
    { type: "para", text: "∗ 23 rue de l'Universite, 75007 Paris, France.", bbox: { x0: 135, y0: 281, x1: 467, y1: 291 } },
    { type: "para", text: "after rounding are shown as 0.00 on the rate.", bbox: { x0: 135, y0: 283, x1: 467, y1: 293 } },
    { type: "para", text: "This table shows the common prefixes. Others, from 10-24 to 1024 are acceptable.", bbox: { x0: 135, y0: 286, x1: 467, y1: 296 } },
    { type: "para", text: "Prefixes produce units that are of an appropriate size for the application, e.g. 10 mm.", bbox: { x0: 72, y0: 340, x1: 540, y1: 430 } },
  ];
  absorbTableFooters([table], blocks, 10);
  assert.equal(table.rows, 3);
  assert.match(table.cells.find((c) => c.r === 2).text, /common prefixes/);
  assert.equal(table.cells.find((c) => c.r === 2).colSpan, 3);
  assert.equal(blocks.length, 3);
  assert.match(blocks.map((b) => b.text).join("\n"), /rue de/);
  assert.match(blocks.map((b) => b.text).join("\n"), /after rounding/);
  assert.match(blocks.map((b) => b.text).join("\n"), /appropriate size/);
});

// ---------- scans with an OCR text layer ----------

test("a year header row at the page top is not a page number", () => {
  const lines = buildLines([
    ...row(20, [["Disease", 60], ["1980", 200], ["1979", 260]]),
    ...row(770, [["14", 300]]),
  ], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines;
  const f = findFurniture([{ n: 1, h: H, lines }]);
  assert.deepEqual(f.removed.map((r) => r.text), ["14"]);
});

test("a page-sized image under a text layer is a scan background, not a figure", () => {
  const items = [
    ...row(40, [["Disease", 60], ["1980", 200], ["1979", 260], ["1978", 320]]),
    ...row(54, [["Amebiasis", 60], ["2.38", 200], ["1.90", 260], ["1.84", 320]]),
    ...row(68, [["Anthrax", 60], ["0.00", 200], ["0.00", 260], ["0.00", 320]]),
    ...row(82, [["Cholera", 60], ["0.00", 200], ["0.00", 260], ["0.01", 320]]),
    ...row(96, [["Malaria", 60], ["0.91", 200], ["0.41", 260], ["0.34", 320]]),
  ];
  const pg = page(items, { images: [[0, 0, W, H]] });
  assert.equal(pg.kind, "mixed");
  assert.equal(pg.scanLayer, true);
  assert.equal(pg.figures.length, 0);
  const d = doc([pg]);
  const t = tablesOf(d)[0];
  assert.ok(t, "the OCR layer parses as a table");
  assert.equal(t.cols, 4);
  assert.equal(t.rows, 5);
  assert.equal(t.headerRows, 1, "a row of years over decimals is the header");
  assert.equal(d.pages[0].scanLayer, true);
  const small = page(items, { images: [[400, 600, 500, 700]] });
  assert.equal(small.figures.length, 1, "an ordinary image is still a figure");
});

test("letter-spaced OCR items join into one word", () => {
  assert.equal(letterSpaced("N O T I F I A B L E"), true);
  assert.equal(letterSpaced("Disease 1980 1979"), false);
  const { lines } = buildLines([item("N O T IF IA B L E", 100, 700, 5)], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS });
  assert.equal(lines[0].text, "NOTIFIABLE");
});

test("text set sideways is read in its own frame and reported as textRotation", () => {
  const rot = (str, x, y, size = 10) => ({ str, transform: [0, size, -size, 0, x, y], width: str.length * size * 0.5, height: size, fontName: "f1", hasEOL: false });
  // Three columns become three baselines along x; rows run up the page along y.
  const items = [];
  const labels = [["Item", "A", "B"], ["Alpha", "12", "34"], ["Beta", "56", "78"], ["Gamma", "90", "12"], ["Delta", "11", "22"]];
  labels.forEach((cells, r) => cells.forEach((text, c) => items.push(rot(text, 100 + r * 20, 100 + c * 120))));
  const pg = parsePageGeometry({ items, ops: ops(), w: W, h: H, fonts: FONTS }, 1);
  assert.equal(Math.abs(pg.textRotation), 90);
  assert.equal(pg.lines.length >= 5, true, "lines are upright in the rotated frame");
  const d = doc([pg]);
  const t = tablesOf(d)[0];
  assert.ok(t, "the sideways table is found");
  assert.equal(t.rows, 5);
  assert.equal(t.cols, 3);
  assert.equal(Math.abs(d.pages[0].textRotation), 90);
  const upright = buildLines(row(100, [["Only", 60]]), { transform: [1, 0, 0, -1, 0, H], fonts: FONTS });
  assert.equal(dominantRotation(upright.rotated, upright.lines), 0);
});

test("axis ticks of a chart on a scan page are not a table", () => {
  const items = [
    ...row(300, [["7", 52], ["14", 71], ["21", 94], ["28", 114], ["4", 141], ["11", 161], ["18", 183], ["25", 204]], 6),
    ...row(312, [["DEC.", 76], ["JAN.", 175]], 6),
    ...row(324, [["1969", 74], ["1970", 174]], 6),
  ];
  const d = doc([page(items, { images: [[0, 0, W, H]] })]);
  assert.equal(tablesOf(d).length, 0);
});

test("leader dots stay with the label and out of the cell text", () => {
  const items = [
    ...row(100, [["Proportion", 60], ["1.0", 200], ["1.1", 250], ["1.2", 300]]),
    ...row(114, [["0.99 ..........", 60], ["800", 200], ["880", 250], ["960", 300]]),
    ...row(128, [["0.95 ..........", 60], ["160", 200], ["176", 250], ["192", 300]]),
    ...row(142, [["0.90 ..........", 60], ["80", 200], ["88", 250], ["96", 300]]),
  ];
  const t = tablesOf(doc([page(items)]))[0];
  assert.equal(t.cols, 4);
  assert.equal(cellAt(t, 1, 0).text, "0.99");
  assert.equal(cellTextOf(buildLines(row(100, [["..", 60]]), { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines[0].words), "..", "a two-dot placeholder is data");
  const label = (text, x) => ({ text, x0: x, x1: x + text.length * 5, base: 10, size: 10, y0: 2, y1: 12, font: "ocr", conf: 1 });
  assert.equal(cellTextOf([label("Diameter", 0), label("of", 55), label("outlet", 75), label("tube", 115), label("d..", 145)]), "Diameter of outlet tube d");
  assert.equal(cellTextOf([label("c", 0), label("0.1654", 16)]), "c 0.1654");
});

test("boxes consumed by a tiling are not figure primitives, other boxes still are", () => {
  const tiles = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tiles.push({ x0: 100 + c * 100, y0: 100 + r * 20, x1: 200 + c * 100, y1: 120 + r * 20, fill: [0.5], light: false });
  const lat = findLatticeTables({ rules: [], boxes: tiles, words: buildLines([
    ...row(115, [["a", 110], ["b", 210], ["c", 310]]), ...row(135, [["d", 110], ["e", 210], ["f", 310]]), ...row(155, [["g", 110], ["h", 210], ["i", 310]]),
  ], { transform: [1, 0, 0, -1, 0, H], fonts: FONTS }).lines.flatMap((l) => l.words) });
  assert.equal(lat.tables.length, 1);
  assert.equal(lat.tables[0].rows, 3);
  assert.equal(lat.usedBoxes.size, 9);
});
