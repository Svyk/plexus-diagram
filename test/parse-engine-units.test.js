// Built-in parse engine: pure module tests on synthetic geometry (no pdf.js).
import assert from "node:assert/strict";
import test from "node:test";

import { buildLines, mul, applyPoint, normalizeText, fontFlags, makeLine } from "../src/model/parse/lines.js";
import { decodePathData, extractGraphics, luminanceOf, snapRules, OP } from "../src/model/parse/rules.js";
import { findLatticeTables, cellTextOf, isNumericText } from "../src/model/parse/lattice.js";
import { tokenizeLine, projectColumns, visualRows, detectStreamRuns, tableFromBand, phraseTable, tickGrid } from "../src/model/parse/stream.js";
import { resplitColumns } from "../src/model/parse/resplit.js";
import { findFigures, clusterBoxes } from "../src/model/parse/figures.js";
import { findFurniture, normalizeFurniture } from "../src/model/parse/furniture.js";
import { bodySizeOf, headingClasses, headingLevel, applyNumbering, numberedDepth } from "../src/model/parse/headings.js";
import { detectLists, markerOf } from "../src/model/parse/lists.js";
import { detectFormulas } from "../src/model/parse/formulas.js";
import { joinLines, groupParagraphs, lineTextWithRefs, spansOf } from "../src/model/parse/blocks.js";
import { detectColumns, orderUnits, splitAtGutters } from "../src/model/parse/xycut.js";
import { assembleDocument, parsePageGeometry, parsePdf, mergeContinuations, viewportTransform } from "../src/model/parse/index.js";

const H = 792;
const VP = [1, 0, 0, -1, 0, H];
// pdf.js-like text item at PDF coords (x, y baseline from bottom).
const item = (str, x, y, size = 10, font = "f1", width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: font, hasEOL: false });
const FONTS = { f1: { name: "Helvetica" }, fb: { name: "Helvetica-Bold" }, fm: { name: "CMMI10" } };

test("mul/applyPoint follow the pdf.js order and map through the viewport flip", () => {
  const m = mul(VP, [10, 0, 0, 10, 50, 700]);
  assert.deepEqual(m, [10, 0, 0, -10, 50, 92]);
  assert.deepEqual(applyPoint(VP, 10, 10), [10, 782]);
});

test("normalizeText folds ligatures, drops soft hyphens, maps PUA bullets", () => {
  assert.equal(normalizeText("ﬁnd eﬀect­"), "find effect");
  assert.equal(normalizeText(""), "•");
});

test("fontFlags reads bold/italic/math from the font name", () => {
  assert.deepEqual(fontFlags("a", { a: { name: "NimbusRomNo9L-Medi" } }).bold, true);
  assert.equal(fontFlags("b", { b: { name: "CMMI10" } }).math, true);
  assert.equal(fontFlags("c", { c: { name: "Times-Italic" } }).italic, true);
  assert.equal(fontFlags("zz", {}).bold, false);
});

test("buildLines joins glyph runs, splits at spaces, clusters baselines and attaches superscripts", () => {
  const items = [
    item("the e", 50, 700, 10, "f1", 25), item("ff", 75, 700, 10, "f1", 5), item("ect", 80, 700, 10, "f1", 15),
    item(" ", 95, 700, 10, "f1", 3), item("zone", 98, 700, 10, "f1", 20), item("3", 118.2, 704, 8, "f1", 4),
    item("Next line here", 50, 686, 10),
  ];
  const { lines } = buildLines(items, { transform: VP, fonts: FONTS });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].words.map((w) => w.text), ["the", "effect", "zone", "3"]);
  assert.equal(lines[0].words[3].sup, true);
  assert.equal(Math.round(lines[0].base), 92);
  assert.equal(lines[1].text, "Next line here");
});

test("buildLines splits one baseline into fragments at wide gaps and buckets rotated items", () => {
  const items = [item("left column text", 50, 700), item("right column text", 320, 700), { str: "rot", transform: [0, 10, -10, 0, 20, 400], width: 15, height: 10, fontName: "f1" }];
  const { lines, rotated } = buildLines(items, { transform: VP, fonts: FONTS });
  assert.equal(lines.length, 2);
  assert.equal(rotated.length, 1);
});

test("decodePathData reads pdf.js 5 flat path arrays", () => {
  const sub = decodePathData([new Float32Array([0, 1, 2, 1, 3, 2, 2, 0, 0, 0, 0, 5, 6, 3])]);
  assert.equal(sub.length, 1);
  assert.equal(sub[0].length, 4);
  assert.equal(sub[0][2][2], true);
});

test("extractGraphics classifies thin filled rects as rules, light fills as shade boxes, small curves as dots, images by CTM", () => {
  const rect = (x, y, w, h) => [0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 3];
  const ops = {
    fnArray: [OP.save, OP.transform, OP.setFillRGBColor, OP.constructPath, OP.setFillRGBColor, OP.constructPath, OP.constructPath, OP.constructPath, OP.restore, OP.paintImageXObject],
    argsArray: [
      null, [0.5, 0, 0, -0.5, 0, 792], ["#000000"], [OP.fill, [new Float32Array(rect(0, 0, 200, 1))], null],
      ["#eeeeee"], [OP.fill, [new Float32Array(rect(0, 10, 100, 40))], null],
      [OP.fill, [new Float32Array([0, 10, 100, 2, 12, 100, 14, 102, 14, 104, 2, 14, 106, 12, 108, 10, 108, 3])], null],
      [OP.stroke, [new Float32Array([0, 0, 0, 1, 50, 60])], null],
      null, ["img", 100, 100],
    ],
  };
  const g = extractGraphics(ops, { transform: [1, 0, 0, 1, 0, 0] });
  assert.equal(g.rules.length, 1);
  assert.equal(g.rules[0].axis, "h");
  assert.equal(Math.round(g.rules[0].x1 - g.rules[0].x0), 100);
  assert.equal(g.boxes.length, 1);
  assert.equal(g.boxes[0].light, true);
  assert.equal(g.dots.length, 1);
  assert.equal(g.shapes.length, 1);
  assert.equal(g.images.length, 1);
  assert.deepEqual([g.images[0].x0, g.images[0].y0, g.images[0].x1, g.images[0].y1], [0, 0, 1, 1]);
});

test("extractGraphics legacy moveTo/lineTo/rectangle ops and form xobject transforms", () => {
  const ops = {
    fnArray: [OP.paintFormXObjectBegin, OP.rectangle, OP.fill, OP.moveTo, OP.lineTo, OP.stroke, OP.paintFormXObjectEnd, OP.moveTo, OP.lineTo, OP.stroke],
    argsArray: [[[2, 0, 0, 2, 0, 0], null], [10, 10, 50, 0.5], null, [0, 0], [100, 0], null, null, [0, 0], [100, 0], null],
  };
  const g = extractGraphics(ops, { transform: [1, 0, 0, 1, 0, 0] });
  assert.equal(g.rules.length, 3);
  assert.equal(Math.round(g.rules[1].x1), 200);
  assert.equal(Math.round(g.rules[2].x1), 100);
});

test("extractGraphics caps segment work and flags truncation", () => {
  const fn = []; const args = [];
  for (let i = 0; i < 30; i++) { fn.push(OP.constructPath); args.push([OP.stroke, [new Float32Array([0, 0, i, 1, 100, i])], null]); }
  const g = extractGraphics({ fnArray: fn, argsArray: args }, { transform: [1, 0, 0, 1, 0, 0], maxSegments: 10 });
  assert.equal(g.truncated, true);
  assert.equal(g.rules.length, 10);
});

test("luminanceOf handles hex strings, arrays and gray", () => {
  assert.equal(luminanceOf("#ffffff"), 1);
  assert.equal(luminanceOf([0, 0, 0]), 0);
  assert.ok(luminanceOf(0.5) > 0.49);
  assert.equal(luminanceOf(null), null);
});

test("snapRules clusters collinear segments and merges touching intervals", () => {
  const rules = [
    { axis: "h", x0: 0, x1: 50, y0: 100, y1: 100 }, { axis: "h", x0: 50, x1: 100, y0: 100.5, y1: 100.5 }, { axis: "h", x0: 0, x1: 100, y0: 150, y1: 150 },
    { axis: "v", x0: 0, x1: 0, y0: 100, y1: 150 },
  ];
  const s = snapRules(rules);
  assert.equal(s.h.length, 2);
  assert.equal(s.h[0].intervals.length, 1);
  assert.equal(s.h[0].intervals[0].b, 100);
  assert.equal(s.v.length, 1);
});

// A fully ruled 3x3 grid with a 2-col header span and a 2-row span in column 0.
function gridRules() {
  const xs = [100, 200, 300, 400];
  const ys = [100, 120, 140, 160];
  const rules = [];
  for (const y of ys) rules.push({ axis: "h", x0: 100, x1: 400, y0: y, y1: y });
  for (const x of xs) rules.push({ axis: "v", x0: x, x1: x, y0: 100, y1: 160 });
  // Remove the vertical between cols 1 and 2 in row 0 (header span) and the horizontal between rows 1-2 in col 0.
  return rules.filter((r) => true).concat([]).map((r) => r);
}

function gridWords() {
  const w = (text, x, base, extra = {}) => ({ text, x0: x, x1: x + text.length * 5, base, size: 9, y0: base - 7.2, y1: base + 2, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0, rowSize: 9, ...extra });
  return [
    w("Name", 105, 114, { bold: true }), w("Values", 240, 114, { bold: true }),
    w("Alpha", 105, 134), w("1", 205, 134), w("2", 305, 134),
    w("3", 205, 154), w("4", 305, 154),
  ];
}

test("findLatticeTables builds cells, merges across missing boundaries and marks header rows", () => {
  const rules = [];
  const xs = [100, 200, 300, 400];
  const ys = [100, 120, 140, 160];
  for (const y of ys) rules.push({ axis: "h", x0: 100, x1: y === 140 ? 400 : 400, y0: y, y1: y });
  // horizontal at y=140 only from x=200 (col 0 spans rows 1-2)
  rules[2] = { axis: "h", x0: 200, x1: 400, y0: 140, y1: 140 };
  for (const x of xs) {
    if (x === 300) rules.push({ axis: "v", x0: x, x1: x, y0: 120, y1: 160 }); // no vertical in header row between cols 1 and 2
    else rules.push({ axis: "v", x0: x, x1: x, y0: 100, y1: 160 });
  }
  const words = gridWords();
  const { tables, usedWords } = findLatticeTables({ rules, boxes: [{ x0: 100, y0: 100, x1: 400, y1: 120, light: true }], words });
  assert.equal(tables.length, 1);
  const t = tables[0];
  assert.equal(t.rows, 3);
  assert.equal(t.cols, 3);
  assert.equal(t.headerRows, 1);
  const find = (r, c) => t.cells.find((k) => k.r === r && k.c === c);
  assert.deepEqual([find(0, 1).colSpan, find(0, 1).text, find(0, 1).header], [2, "Values", true]);
  assert.deepEqual([find(1, 0).rowSpan, find(1, 0).text], [2, "Alpha"]);
  assert.equal(find(2, 1).text, "3");
  assert.equal(find(2, 1).numeric, true);
  assert.equal(t.cells.length, 7);
  assert.equal(usedWords.size, 7);
  assert.ok(t.confidence > 0.8);
});

test("lattice: a hollow grid (partial verticals inside wider horizontals) becomes a band for the stream detector", () => {
  const rules = [
    { axis: "h", x0: 100, x1: 500, y0: 100, y1: 100 }, { axis: "h", x0: 100, x1: 500, y0: 130, y1: 130 }, { axis: "h", x0: 100, x1: 500, y0: 200, y1: 200 },
    { axis: "v", x0: 200, x1: 200, y0: 100, y1: 200 }, { axis: "v", x0: 400, x1: 400, y0: 100, y1: 200 },
  ];
  const { tables, bands } = findLatticeTables({ rules, boxes: [], words: [] });
  assert.equal(tables.length, 0);
  assert.equal(bands.length, 1);
  assert.deepEqual(bands[0].xs.map(Math.round), [200, 400]);
  assert.equal(bands[0].ys.length, 3);
});

test("cellTextOf joins wrapped lines, keeps hyphenated code joins and glues scripts", () => {
  const w = (text, x, base, extra = {}) => ({ text, x0: x, x1: x + text.length * 5, base, size: 9, mathChars: 0, ...extra });
  assert.equal(cellTextOf([w("Z1-", 10, 100), w("014", 10, 111)]), "Z1-014");
  assert.equal(cellTextOf([w("Weekly after wet", 10, 100), w("clean", 10, 111)]), "Weekly after wet clean");
  assert.equal(cellTextOf([w("10", 10, 100), w("19", 20, 97, { sup: true })]), "10¹⁹");
  assert.equal(isNumericText("1,000"), true);
  assert.equal(isNumericText("Absent in 10 g"), false);
});

const row = (cells, base, size = 9) => {
  const words = cells.map(([text, x]) => ({ text, x0: x, x1: x + text.length * 5, base, size, y0: base - 7.2, y1: base + 2, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0, rowSize: size }));
  return { words, text: words.map((w) => w.text).join(" "), x0: words[0].x0, x1: Math.max(...words.map((w) => w.x1)), y0: base - 7.2, y1: base + 2, base, size, chars: words.reduce((n, w) => n + w.text.length, 0), bold: false, mathShare: 0 };
};

test("tokenizeLine splits at column gaps, not at word spaces", () => {
  const line = row([["Zone", 50], ["Swabs", 100], ["H1", 130], ["Pos.", 200]], 100);
  assert.deepEqual(tokenizeLine(line).map((t) => t.text), ["Zone", "Swabs H1", "Pos."]);
});

test("detectStreamRuns finds a borderless numeric table with a bold header and right-aligned numbers", () => {
  const mk = (cells, base, bold = false) => { const r = row(cells, base); for (const w of r.words) w.bold = bold; r.bold = bold; return r; };
  const lines = [
    mk([["Zone", 50], ["Swabs", 150], ["Rate", 250]], 100, true),
    mk([["Zone 1", 50], ["312", 160], ["0.0", 260]], 113),
    mk([["Zone 2", 50], ["96", 165], ["9.4", 260]], 126),
    mk([["Total", 50], ["408", 160], ["2.0", 260]], 139),
  ];
  const tables = detectStreamRuns(lines);
  assert.equal(tables.length, 1);
  const t = tables[0];
  assert.deepEqual([t.rows, t.cols, t.headerRows], [4, 3, 1]);
  assert.equal(t.cells.find((c) => c.r === 2 && c.c === 1).text, "96");
  assert.equal(t.cells.find((c) => c.r === 2 && c.c === 1).align, "right");
  assert.equal(t.cells.find((c) => c.r === 0 && c.c === 0).header, true);
  assert.equal(t.method, "stream");
});

test("detectStreamRuns keeps a double-spaced numeric table and a repeated column head in one run", () => {
  const head = (base) => row([["Pressure", 50], ["0", 250], ["12", 310], ["15", 370]], base, 10);
  const data = (label, a, b, c, base) => row([[label, 50], [a, 250], [b, 310], [c, 370]], base, 10);
  const lines = [
    row([["Speed 1,000 r.p.m.", 140]], 80, 10),
    head(105),
    data("Roots", "0.3", "42.6", "64.5", 130),
    data("Powerplus", "3.8", "49.6", "90.6", 155),
    row([["----", 50]], 170, 10),
    row([["Speed 2,000 r.p.m.", 140]], 195, 10),
    head(220),
    data("Roots", "0.9", "39.7", "57.1", 245),
    data("Powerplus", "6.6", "39.6", "59.8", 270),
  ];
  const tables = detectStreamRuns(lines);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].cols, 4);
  assert.ok(tables[0].rows >= 8);
  assert.equal(tables[0].cells.some((c) => c.text.includes("2,000")), true);
  assert.equal(tables[0].cells.some((c) => c.text === "----"), false);
});

test("detectStreamRuns skips a stray semicolon from a broken leader", () => {
  const data = (label, a, base) => row([[label, 50], [a, 250], ["1.2", 310]], base, 10);
  const lines = [
    row([["Name", 50], ["A", 250], ["B", 310]], 100, 10),
    data("one", "1.10", 125),
    row([[";", 180]], 145, 10),
    data("two", "1.15", 170),
    data("three", "1.20", 195),
  ];
  const tables = detectStreamRuns(lines);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].cells.some((c) => c.text === ";"), false);
  assert.equal(tables[0].cells.some((c) => c.text.includes("1.10")), true);
  assert.equal(tables[0].cells.some((c) => c.text.includes("1.20")), true);
});

test("tickGrid drops a chart axis whose numbers span an otherwise empty grid", () => {
  const span = (c, text, rowSpan) => ({ r: 0, c, rowSpan, colSpan: 1, text });
  const ticks = { rows: 3, cols: 7, cells: [span(0, "1", 2), span(1, "2", 3), span(2, "3", 3), span(3, "9", 2), span(4, "10", 3), span(5, "11", 3), span(6, "12", 3), { r: 2, c: 0, rowSpan: 1, colSpan: 1, text: "F1g. 3" }] };
  assert.equal(tickGrid(ticks), true);
  const dense = { rows: 3, cols: 4, cells: [] };
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) dense.cells.push({ r, c, text: String(r * 4 + c) });
  assert.equal(tickGrid(dense), false);
});

test("detectStreamRuns skips a one-dash rule and keeps the rows around it", () => {
  const head = row([["Name", 50], ["A", 200], ["B", 260]], 100, 10);
  const data = (name, a, base) => row([[name, 50], [a, 200], ["1.1", 260]], base, 10);
  const lines = [
    head,
    data("one", "2.0", 112),
    row([["-", 80]], 124, 10),
    data("two", "3.0", 136),
    data("three", "4.0", 148),
  ];
  const tables = detectStreamRuns(lines);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].cells.some((c) => c.text === "-"), false);
  assert.equal(tables[0].cells.some((c) => c.text === "three"), true);
  assert.equal(tables[0].cells.some((c) => c.text === "one"), true);
});

test("detectStreamRuns leaves a title above a year header out of the table", () => {
  const lines = [
    row([["NOTIFIABLE DISEASES", 50]], 70, 10),
    row([["Disease", 50], ["1980", 160], ["1979", 220], ["1978", 280]], 100, 10),
    row([["Amebiasis", 50], ["2.38", 160], ["1.90", 220], ["1.84", 280]], 112, 10),
    row([["Anthrax", 50], ["0.00", 160], ["0.00", 220], ["0.00", 280]], 124, 10),
  ];
  const tables = detectStreamRuns(lines);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].cells.some((c) => /NOTIFIABLE/.test(c.text)), false);
  assert.equal(tables[0].cells.find((c) => c.r === 0 && c.c === 0).text, "Disease");
});

test("detectStreamRuns rejects a paragraph laid out as long phrase cells", () => {
  const line = (base) => row([["at equal speeds of the", 50], ["required power stays nearly constant", 300]], base, 10);
  const tables = detectStreamRuns([line(100), line(125), line(150), line(175)]);
  assert.equal(tables.length, 0);
  assert.equal(phraseTable({ cells: [
    { r: 0, c: 0, text: "Roots" }, { r: 0, c: 1, text: "0.294" }, { r: 0, c: 2, text: "42.6" },
    { r: 1, c: 0, text: "Powerplus" }, { r: 1, c: 1, text: "3.84" }, { r: 1, c: 2, text: "49.6" },
  ] }), false);
});

test("tokenizeLine keeps a footnote letter with its number and leader dots as one token", () => {
  const note = row([["c", 200], ["0.1654", 216]], 100, 10);
  assert.equal(tokenizeLine(note).some((t) => t.text === "c 0.1654"), true);
  const dots = row([["....", 120], ["....", 160], ["....", 200]], 120, 10);
  const tok = tokenizeLine(dots);
  assert.equal(tok.length, 1);
  assert.match(tok[0].text, /^[.\s]+$/);
  const name = { x0: 40, x1: 80, text: "Water" };
  const lead = { x0: 100, x1: 170, text: "........" };
  const val = { x0: 200, x1: 230, text: "0.12" };
  assert.equal(projectColumns([[name, lead, val], [name, lead, val]]).length, 2);
});

test("detectStreamRuns rejects justified prose and numbered lists", () => {
  const prose = [
    row([["Dry", 50], ["powder", 80], ["facilities", 125], ["depend", 180], ["on", 220], ["keeping", 240]], 100),
    row([["When", 50], ["water", 90], ["enters", 130], ["during", 170], ["a", 215], ["wet", 230]], 113),
    row([["that", 50], ["persist", 85], ["in", 130], ["dry", 150], ["niches", 180], ["can", 225]], 126),
  ];
  assert.equal(detectStreamRuns(prose).length, 0);
  const list = [row([["1.", 50], ["Weekly: all sites", 65]], 100), row([["2.", 50], ["Monthly: the rest", 65]], 113), row([["3.", 50], ["Quarterly: zone 4", 65]], 126)];
  assert.equal(detectStreamRuns(list).length, 0);
});

test("tableFromBand: booktabs rows with wrapped, vertically centred cells and a multirow label", () => {
  const w = (text, x, base, extra = {}) => ({ text, x0: x, x1: x + text.length * 5, base, size: 9, y0: base - 7.2, y1: base + 2, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0, rowSize: 9, ...extra });
  const words = [
    w("Site", 60, 110), w("ID", 60, 121), w("Zone", 150, 116), w("R", 250, 116),
    w("Z1-", 60, 140), w("014", 60, 151), w("1", 150, 146), w("7.5", 250, 146),
    w("Z1-", 60, 170), w("022", 60, 181), w("1", 150, 176), w("8.0", 250, 176),
    w("(A)", 60, 212), w("2", 150, 206), w("4.5", 250, 206), w("3", 150, 218), w("9.0", 250, 218),
  ];
  const band = { x0: 50, x1: 300, y0: 100, y1: 230, ys: [{ y: 100, full: true }, { y: 128, full: true }, { y: 192, full: true }, { y: 230, full: true }], xs: [] };
  const t = tableFromBand(band, words);
  assert.ok(t);
  assert.deepEqual([t.rows, t.cols, t.headerRows], [5, 3, 1]);
  const find = (r, c) => t.cells.find((k) => k.r === r && k.c === c);
  assert.equal(find(0, 0).text, "Site ID");
  assert.equal(find(1, 0).text, "Z1-014");
  assert.equal(find(2, 0).text, "Z1-022");
  assert.deepEqual([find(3, 0).text, find(3, 0).rowSpan], ["(A)", 2]);
  assert.equal(find(4, 0), undefined);
  assert.equal(find(4, 1).text, "3");
});

test("visualRows chains vertically overlapping words into one row", () => {
  const w = (y0, y1) => ({ y0, y1, x0: 0, x1: 10 });
  assert.equal(visualRows([w(0, 10), w(5, 15), w(30, 40)]).length, 2);
});

test("projectColumns derives columns from the fullest rows", () => {
  const tok = (x0, x1) => ({ x0, x1 });
  const cols = projectColumns([[tok(0, 10), tok(50, 60), tok(100, 110)], [tok(0, 12), tok(52, 60), tok(100, 108)], [tok(0, 70)]]);
  assert.equal(cols.length, 3);
});

test("resplitColumns reassigns words to dragged boundaries and rebuilds cells", () => {
  const words = [
    { text: "Zone 1", x0: 50, x1: 80, base: 113, size: 9 }, { text: "312", x0: 160, x1: 175, base: 113, size: 9 }, { text: "0.0", x0: 260, x1: 275, base: 113, size: 9 },
    { text: "Zone 2", x0: 50, x1: 80, base: 126, size: 9 }, { text: "96", x0: 165, x1: 175, base: 126, size: 9 }, { text: "9.4", x0: 260, x1: 275, base: 126, size: 9 },
  ];
  const table = { id: "t1", type: "table", rows: 2, cols: 3, headerRows: 0, headerCols: 0, cells: [], method: "stream", grid: { xs: [48, 120, 220, 280], ys: [104, 118, 131] }, bbox: [48, 104, 280, 131] };
  const out = resplitColumns(table, words, [48, 200, 280]);
  assert.equal(out.cols, 2);
  assert.equal(out.rows, 2);
  assert.equal(out.cells.find((c) => c.r === 0 && c.c === 0).text, "Zone 1 312");
  assert.equal(out.cells.find((c) => c.r === 1 && c.c === 1).text, "9.4");
  assert.equal(out.cells.find((c) => c.r === 1 && c.c === 1).align, "right");
  assert.equal(table.cols, 3, "input is not mutated");
});

test("findFigures clusters vector primitives, absorbs small labels, ignores light boxes and page fills", () => {
  const graphics = {
    images: [],
    shapes: [],
    boxes: [
      ...Array.from({ length: 12 }, (_, i) => ({ x0: 100 + i * 20, y0: 200 - i * 5, x1: 115 + i * 20, y1: 260, light: false })),
      { x0: 0, y0: 0, x1: 612, y1: 792, light: false },
      { x0: 100, y0: 300, x1: 400, y1: 320, light: true },
    ],
    rules: [],
  };
  const segs = [{ axis: "h", pos: 260, a: 95, b: 350 }, { axis: "v", pos: 95, a: 150, b: 260 }];
  const words = [
    { text: "Jan", x0: 100, x1: 112, y0: 263, y1: 270, size: 6 },
    { text: "Figure 1. Caption", x0: 100, x1: 200, y0: 290, y1: 300, size: 9 },
  ];
  const { figures, used } = findFigures({ graphics, words, bodySize: 10, pageW: 612, pageH: 792, ruleSegments: segs });
  assert.equal(figures.length, 1);
  assert.equal(figures[0].kind, "drawing");
  assert.equal(used.size, 1);
  assert.ok(figures[0].y1 >= 270);
  assert.equal(clusterBoxes([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 12, y0: 0, x1: 20, y1: 10 }, { x0: 100, y0: 0, x1: 110, y1: 10 }], 6).length, 2);
});

test("findFigures: a raster image is a figure on its own", () => {
  const { figures } = findFigures({ graphics: { images: [{ x0: 50, y0: 50, x1: 300, y1: 250 }], shapes: [], boxes: [], rules: [] }, words: [], bodySize: 10 });
  assert.equal(figures.length, 1);
  assert.equal(figures[0].kind, "image");
});

test("findFurniture removes recurring header/footer lines and bare page numbers", () => {
  const line = (text, base, h = 792) => ({ text, base, y0: base - 5, y1: base + 1, x0: 50, x1: 200, size: 6 });
  const pages = [1, 2, 3].map((n) => ({ n, h: 792, lines: [line("Report 2026 · Review", 20), line(`Page ${n} of 3`, 776), line("Body text here", 300)] }));
  const { removed, isFurniture } = findFurniture(pages);
  assert.equal(removed.length, 6);
  assert.equal(removed.filter((r) => r.reason === "running-header").length, 3);
  assert.equal(isFurniture(pages[0].lines[2]), false);
  assert.equal(normalizeFurniture("Page 12 of 30"), "page # of #");
  const single = findFurniture([{ n: 1, h: 792, lines: [line("7", 780), line("Unique header", 20)] }]);
  assert.equal(single.removed.length, 1);
  assert.equal(single.removed[0].reason, "page-number");
});

test("heading levels come from size classes, bold-at-body lines and numbering depth", () => {
  const l = (text, size, bold = false) => ({ text, size, bold, chars: text.length, words: [] });
  const lines = [l("Title", 18), l("1 Intro", 13), l("2.1 Sub", 10, true), ...Array.from({ length: 20 }, () => l("body body body body", 10))];
  const body = bodySizeOf(lines);
  assert.equal(body, 10);
  const classes = headingClasses(lines, body);
  assert.deepEqual(classes, [18, 13]);
  assert.equal(headingLevel(lines[0], { bodySize: body, classes }), 1);
  assert.equal(headingLevel(lines[1], { bodySize: body, classes }), 2);
  assert.equal(headingLevel(lines[2], { bodySize: body, classes, nextIsBody: true }), 3);
  assert.equal(headingLevel(l("Table 1. Caption", 13), { bodySize: body, classes }), 0);
  assert.equal(headingLevel(l("A long bold sentence that ends with a period.", 10, true), { bodySize: body, classes, nextIsBody: true }), 0);
  assert.equal(numberedDepth("2.1.3 Deep"), 3);
  const hs = [{ text: "Title", level: 1 }, { text: "1 Intro", level: 2 }, { text: "1.1 A", level: 2 }, { text: "2 B", level: 2 }, { text: "2.1 C", level: 3 }];
  applyNumbering(hs);
  assert.deepEqual(hs.map((h) => h.level), [1, 2, 3, 2, 3]);
});

test("detectLists reads text markers and vector dots, nests by marker x and keeps continuation lines", () => {
  const lines = [
    row([["1.", 60], ["Weekly: all sites", 75]], 100), row([["2.", 60], ["Monthly: the rest", 75]], 113),
    row([["and more", 75]], 124),
    row([["a.", 80], ["nested item", 92]], 137),
    row([["Plain paragraph after the list", 50]], 170),
  ];
  const lists = detectLists(lines, { joinText: (ls) => ls.map((l) => l.text).join(" ") });
  assert.equal(lists.length, 1);
  assert.equal(lists[0].ordered, true);
  assert.deepEqual(lists[0].items.map((i) => i.level), [0, 0, 1]);
  assert.equal(lists[0].items[1].text, "Monthly: the rest and more");
  const dotLine = row([["Describe positives", 86]], 100);
  const m = markerOf(dotLine, [{ x: 74, y: 96.5, r: 1.5 }]);
  assert.equal(m && m.marker, "•");
  assert.equal(markerOf(row([["S.", 50], ["Kleshchev", 62]], 100)), null, "initials are not markers");
});

test("detectFormulas: isolated centred math line, or a numbered one at the right edge", () => {
  const w = (text, x, base, extra = {}) => ({ text, x0: x, x1: x + text.length * 5, base, size: 10, mathChars: 0, mathFontChars: text.length, fontName: "CMMI10", ...extra });
  const mk = (words, base) => ({ words, text: words.map((x) => x.text).join(" "), x0: words[0].x0, x1: Math.max(...words.map((x) => x.x1)), y0: base - 8, y1: base + 2, base, size: 10, chars: 20, mathShare: 1 });
  const body = { ...row([["Some body text in the column here", 50]], 100), mathShare: 0 };
  const eq = mk([w("R", 140, 130), w("=", 150, 130), w("w", 160, 130)], 130);
  const after = { ...row([["More body text in the column", 50]], 160), mathShare: 0 };
  const runs = detectFormulas([body, eq, after], { column: { x0: 50, x1: 250 }, bodySize: 10 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].number, null);
  const numbered = mk([w("f(x)", 50, 130), w("(1)", 235, 130)], 130);
  const runs2 = detectFormulas([body, numbered, after], { column: { x0: 50, x1: 250 }, bodySize: 10 });
  assert.equal(runs2.length, 1);
  assert.equal(runs2[0].number, "(1)");
  const bodyFontLine = mk([w("just", 50, 130, { fontName: "CMR10" }), w("text", 80, 130, { fontName: "CMR10" })], 130);
  assert.equal(detectFormulas([body, bodyFontLine, after], { column: { x0: 50, x1: 250 }, bodySize: 10, bodyFont: "CMR10" }).length, 0);
});

test("joinLines handles hyphenation, keeps code hyphens, extracts footnote marks and spans", () => {
  const a = row([["harbor-", 50]], 100);
  const b = row([["age site can", 50]], 113);
  assert.equal(joinLines([a, b]).text, "harborage site can");
  const c = row([["Z1-", 50]], 100); const d = row([["014 site", 50]], 113);
  assert.equal(joinLines([c, d]).text, "Z1-014 site");
  const e = row([["zone", 50], ["3", 75], [".", 80]], 100);
  e.words[1].sup = true;
  const joined = joinLines([e]);
  assert.equal(joined.text, "zone.");
  assert.deepEqual(joined.footnoteRefs, [{ mark: "3", at: 4 }]);
  const f = row([["cm", 50], ["2", 62]], 100);
  f.words[1].sup = true;
  assert.equal(lineTextWithRefs(f, { collectRefs: false }).text, "cm²");
  const spans = spansOf([row([["Abstract.", 50], ["We", 100]], 100)]);
  assert.equal(spans.length, 1);
});

test("groupParagraphs splits on gaps, size changes and sentence-end + indent", () => {
  const lines = [row([["Line one of para", 50]], 100), row([["line two of para", 50]], 113), row([["Second para starts here.", 50]], 140), row([["Third after a big gap", 50]], 170)];
  const groups = groupParagraphs(lines, { bodySize: 10 });
  assert.deepEqual(groups.map((g) => g.length), [2, 1, 1]);
});

test("detectColumns finds the gutter between two dominant text columns and splitAtGutters cuts merged lines", () => {
  const left = Array.from({ length: 6 }, (_, i) => row([["left column text that is long enough", 56]], 100 + i * 13));
  const right = Array.from({ length: 6 }, (_, i) => row([["right column text that is long enough", 316]], 100 + i * 13));
  for (const l of left) l.x1 = 295;
  for (const l of right) l.x1 = 555;
  const gutters = detectColumns([...left, ...right], { pageW: 612 });
  assert.equal(gutters.length, 1);
  assert.ok(gutters[0].x0 >= 295 && gutters[0].x1 <= 316);
  const merged = row([["as the", 250], ["5 Conclusion", 316]], 300);
  merged.words[0].x1 = 290;
  const parts = splitAtGutters([merged], gutters, makeLine);
  assert.equal(parts.length, 2);
  assert.equal(detectColumns(left, { pageW: 612 }).length, 0);
});

test("orderUnits reads wide units as separators and columns left to right inside each slice", () => {
  const u = (id, x0, y0, x1, y1) => ({ id, x0, y0, x1, y1 });
  const units = [u("title", 56, 50, 555, 70), u("L1", 56, 100, 295, 120), u("R1", 316, 100, 555, 120), u("L2", 56, 130, 295, 150), u("table", 56, 200, 400, 300), u("L3", 56, 320, 295, 340), u("R2", 316, 320, 555, 340)];
  const { order, columns } = orderUnits(units, { gutters: [{ x0: 295, x1: 316 }] });
  assert.deepEqual(order.map((x) => x.id), ["title", "L1", "L2", "R1", "table", "L3", "R2"]);
  assert.equal(columns, 2);
  assert.equal(orderUnits([u("a", 0, 10, 50, 20), u("b", 0, 0, 50, 5)], {}).order[0].id, "b");
});

test("mergeContinuations joins a paragraph split by a column or page break", () => {
  const blocks = { b1: { id: "b1", type: "para", page: 1, text: "A post", spans: [{ size: 10 }], bbox: [0, 0, 1, 1] }, b2: { id: "b2", type: "para", page: 2, text: "dry-out step, added in May.", spans: [{ size: 10 }], bbox: [0, 0, 1, 1], footnoteRefs: [{ mark: "1", at: 3 }] }, b3: { id: "b3", type: "para", page: 2, text: "Next.", spans: [{ size: 10 }] } };
  const order = ["b1", "b2", "b3"];
  mergeContinuations(order, blocks);
  assert.deepEqual(order, ["b1", "b3"]);
  assert.equal(blocks.b1.text, "A post dry-out step, added in May.");
  assert.equal(blocks.b1.footnoteRefs[0].at, 10);
  assert.equal(blocks.b1.parts.length, 2);
});

test("viewportTransform matches pdf.js for the four rotations", () => {
  assert.deepEqual(viewportTransform(612, 792, 0), [1, 0, 0, -1, 0, 792]);
  assert.deepEqual(viewportTransform(612, 792, 90), [0, 1, 1, 0, 0, 0]);
  assert.deepEqual(viewportTransform(612, 792, 180), [-1, 0, 0, 1, 612, 0]);
  assert.deepEqual(viewportTransform(612, 792, 270), [0, -1, -1, 0, 792, 612]);
});

test("parsePageGeometry flags an image-only page as scan and a text page as text", () => {
  const scan = parsePageGeometry({ items: [], ops: { fnArray: [OP.transform, OP.paintImageXObject], argsArray: [[612, 0, 0, 792, 0, 0], ["img", 10, 10]] }, w: 612, h: 792 }, 1);
  assert.equal(scan.kind, "scan");
  assert.equal(scan.figures.length, 0);
  const text = parsePageGeometry({ items: [item("Hello world", 50, 700)], ops: { fnArray: [], argsArray: [] }, w: 612, h: 792, fonts: FONTS }, 2);
  assert.equal(text.kind, "text");
  assert.equal(text.lines.length, 1);
});

test("parsePdf: ranges, onPage progress, abort between pages, and a pxd-parse/1 shaped document", async () => {
  const pages = {
    1: { items: [item("Big Title Here", 50, 740, 18, "fb"), item("Body text of the first paragraph here", 50, 700), item("second line of the paragraph here", 50, 687), item("Page 1", 290, 20, 6)], ops: { fnArray: [], argsArray: [] }, w: 612, h: 792, fonts: FONTS },
    2: { items: [item("Body text continues on page two here", 50, 700), item("Page 2", 290, 20, 6)], ops: { fnArray: [], argsArray: [] }, w: 612, h: 792, fonts: FONTS },
  };
  const seen = [];
  const doc = await parsePdf({ getPage: async (n) => pages[n], numPages: 2, onPage: (p) => seen.push(p.page), info: { Title: "Meta Title" } });
  assert.equal(doc.schema, "pxd-parse/1");
  assert.equal(doc.engine, "builtin");
  assert.equal(doc.title, "Meta Title");
  assert.equal(doc.pageCount, 2);
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(doc.pages.map((p) => p.kind), ["text", "text"]);
  assert.ok(doc.order.length >= 3);
  const h = doc.blocks[doc.order[0]];
  assert.deepEqual([h.type, h.level, h.text], ["heading", 1, "Big Title Here"]);
  assert.equal(doc.removed.length, 2);
  assert.equal(doc.stats.perPage.length, 2);
  for (const id of doc.order) assert.equal(doc.blocks[id].id, id);
  const ranged = await parsePdf({ getPage: async (n) => pages[n], numPages: 2, pages: [2, 2] });
  assert.deepEqual(ranged.pages.map((p) => p.n), [2]);
  assert.equal(ranged.title, null);
  const ctrl = new AbortController();
  let calls = 0;
  await assert.rejects(parsePdf({ getPage: async (n) => { calls++; ctrl.abort(); return pages[n]; }, numPages: 2, signal: ctrl.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("assembleDocument links footnote refs to footnotes and attaches captions", () => {
  const pg = parsePageGeometry({
    items: [
      ...Array.from({ length: 8 }, (_, i) => item("Body text of a paragraph that is long enough here", 50, 700 - i * 13)),
      item("a single harborage zone", 50, 590), item("3", 165, 594, 8), item(".", 169, 590),
      item("Table 1. Limits by stage", 50, 560, 10, "fb"),
      item("3", 50, 120, 6), item("A harborage site is a niche.", 56, 118, 8),
    ],
    ops: { fnArray: [], argsArray: [] }, w: 612, h: 792, fonts: FONTS,
  }, 1);
  const doc = assembleDocument([pg], { numPages: 1 });
  const note = Object.values(doc.blocks).find((b) => b.type === "footnote");
  assert.ok(note, "footnote block");
  assert.equal(note.mark, "3");
  const para = Object.values(doc.blocks).find((b) => b.footnoteRefs && b.footnoteRefs.length);
  assert.equal(para.footnoteRefs[0].to, note.id);
  const cap = Object.values(doc.blocks).find((b) => b.text && b.text.startsWith("Table 1."));
  assert.equal(cap.type, "para", "caption with no table nearby stays a paragraph");
});
