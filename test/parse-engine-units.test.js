// Built-in parse engine: pure module tests on synthetic geometry (no pdf.js).
import assert from "node:assert/strict";
import test from "node:test";

import { buildLines, mul, applyPoint, normalizeText, fontFlags, makeLine, relineWords } from "../src/model/parse/lines.js";
import { decodePathData, extractGraphics, luminanceOf, snapRules, OP } from "../src/model/parse/rules.js";
import { findLatticeTables, cellTextOf, isNumericText } from "../src/model/parse/lattice.js";
import { tokenizeLine, projectColumns, visualRows, detectStreamRuns, tableFromBand, phraseTable, tickGrid, alignNumericColumns, lacksTabularEvidence } from "../src/model/parse/stream.js";
import { dropFigureLabelTables } from "../src/model/parse/index.js";
import { resplitColumns } from "../src/model/parse/resplit.js";
import { findFigures, clusterBoxes } from "../src/model/parse/figures.js";
import { findFurniture, isScanBanner, normalizeFurniture } from "../src/model/parse/furniture.js";
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
  const host = w("25", 70, 100, { conf: 1, boxY: [92, 102] });
  host.x0 = 70; host.x1 = 90;
  const echo = w("1", 76, 100, { conf: 0.3, boxY: [93, 108] });
  echo.x0 = 76; echo.x1 = 80;
  assert.equal(cellTextOf([w("Absent", 10, 100), w("in", 48, 100), host, echo]), "Absent in 25");
  const clear = { ...echo, x0: 120, x1: 124 };
  assert.equal(cellTextOf([w("Absent", 10, 100), w("in", 48, 100), host, clear]), "Absent in 25 1", "a digit clear of the word stays");
  assert.equal(isNumericText("1,000"), true);
  assert.equal(isNumericText("Absent in 10 g"), false);
});

const row = (cells, base, size = 9) => {
  const words = cells.map(([text, x]) => ({ text, x0: x, x1: x + text.length * 5, base, size, y0: base - 7.2, y1: base + 2, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0, rowSize: size }));
  return { words, text: words.map((w) => w.text).join(" "), x0: words[0].x0, x1: Math.max(...words.map((w) => w.x1)), y0: base - 7.2, y1: base + 2, base, size, chars: words.reduce((n, w) => n + w.text.length, 0), bold: false, mathShare: 0 };
};

test("alignNumericColumns keeps a year range beside a right-aligned quantity", () => {
  const tok = (text, x0, x1) => ({ text, x0, x1, words: [{ text, x0, x1, conf: 1 }] });
  const row = (name, yearX1, qty) => [tok(name, 30, 58), tok("1893-1913", 81, yearX1), tok(qty, 118, 140), tok("16,863", 146, 165)];
  const rows = ["Alabama", "Arkansas", "Colorado", "Georgia", "Illinois", "Indiana"].map((name, i) => row(name, 104 + (i % 3) * 4, "10,533,707"));
  const cols = alignNumericColumns(rows, 8);
  assert.ok(cols.length >= 4);
  const year = cols.find((c) => c.x0 < 100 && c.x1 > 90);
  const qty = cols.find((c) => c.x1 > 130 && c.x1 < 150);
  assert.ok(year && qty && year.x1 < qty.x0);
});

test("tokenizeLine separates a year range from the quantity whose box touches it", () => {
  const w = (text, x0, x1) => ({ text, x0, x1, conf: 1 });
  const line = { words: [w("Alabama", 30, 57), w("1893-1913", 81, 112), w("10,533,707", 111, 140), w("16,863", 146, 165)], size: 8 };
  assert.deepEqual(tokenizeLine(line).map((t) => t.text), ["Alabama", "1893-1913", "10,533,707", "16,863"]);
});

test("tokenizeLine keeps an OCR thousands group and splits a wider numeric column gap", () => {
  const w = (text, x0, x1) => ({ text, x0, x1, conf: 1 });
  const line = { words: [w("10,", 100, 118), w("533,", 120, 142), w("707", 144, 162), w("16,863", 172, 204)], size: 8 };
  assert.deepEqual(tokenizeLine(line).map((t) => t.text), ["10, 533, 707", "16,863"]);
});

test("tokenizeLine splits at column gaps, not at word spaces", () => {
  const line = row([["Zone", 50], ["Swabs", 100], ["H1", 130], ["Pos.", 200]], 100);
  assert.deepEqual(tokenizeLine(line).map((t) => t.text), ["Zone", "Swabs H1", "Pos."]);
});

test("detectStreamRuns keeps a contents list when a title has no page number on its line", () => {
  const w = (text, x0, x1) => ({ text, x0, x1, conf: 1 });
  const line = (words, base) => ({
    words: words.map((wd) => ({ ...wd, base, size: 10, y0: base - 8, y1: base + 2, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0 })),
    text: words.map((wd) => wd.text).join(" "),
    x0: words[0].x0, x1: Math.max(...words.map((wd) => wd.x1)),
    y0: base - 8, y1: base + 2, base, size: 10, chars: 10, bold: false, mathShare: 0,
  });
  const lines = [
    line([w("Page.", 370, 400)], 140),
    line([w("Introduction", 70, 150), w("5", 380, 392)], 156),
    line([w("Composition", 70, 140), w("of", 144, 160), w("natural", 164, 200), w("gas.", 204, 230)], 172),
    line([w("Compressibility", 70, 160), w("of", 164, 176), w("methane", 180, 220), w("6", 380, 392)], 188),
    line([w("Experiments", 70, 140), w("made.", 144, 180)], 204),
    line([w("Publications", 70, 150), w("on", 154, 170), w("petroleum", 174, 230), w("11", 378, 392)], 220),
  ];
  const tables = detectStreamRuns(lines);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].headerRows, 1);
  const cell = (r, c) => tables[0].cells.find((k) => k.r === r && k.c === c);
  assert.equal(cell(1, 0).text, "Introduction");
  assert.equal(cell(1, 1).text, "5");
  assert.match(cell(2, 0).text, /Composition/);
  assert.equal(cell(3, 1).text, "6");
  assert.equal(cell(5, 1).text, "11");
});

test("detectStreamRuns reads columns from the numeric body when a header spans them", () => {
  const ocr = (text, x0, x1, base) => ({ text, x0, x1, base, size: 8, y0: base - 6, y1: base + 1, conf: 1, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0 });
  const line = (words, base) => ({
    words, text: words.map((w) => w.text).join(" "), x0: words[0].x0, x1: Math.max(...words.map((w) => w.x1)),
    y0: base - 6, y1: base + 1, base, size: 8, chars: words.reduce((n, w) => n + w.text.length, 0), bold: false, mathShare: 0,
  });
  const head = line([ocr("State", 40, 80, 80), ocr("Number killed, by cause, this year", 150, 420, 80)], 80);
  const body = (name, a, b, c, d, base) => line([
    ocr(name, 40, 90, base), ocr(a, 160, 190, base), ocr(b, 230, 260, base), ocr(c, 300, 340, base), ocr(d, 380, 410, base),
  ], base);
  const tables = detectStreamRuns([
    head,
    body("Alabama", "12", "3", "1", "4", 96),
    body("Georgia", "8", "2", "0", "1", 108),
    body("Kansas", "15", "4", "2", "6", 120),
    body("Ohio", "9", "1", "1", "3", 132),
    body("Texas", "11", "2", "0", "2", 144),
  ]);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].cols, 5);
  assert.equal(tables[0].cells.find((c) => c.r === 1 && c.c === 1).text, "12");
  assert.equal(tables[0].cells.find((c) => c.r === 1 && c.c === 4).text, "4");
  const span = tables[0].cells.find((c) => c.r === 0 && c.c > 0 && c.colSpan > 1);
  assert.ok(span && span.colSpan >= 2, "the group header covers more than one body column");
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

test("detectStreamRuns does not bridge a stacked rate when the page already has a ruled table", () => {
  // us-009: the indirect-rate lines sit under a ruled table. Two of them are single-spaced;
  // the fringe rate is a wider gap. Bridging that gap made a second table (an ICDAR false positive).
  const line = (words, base, size = 8) => {
    const ws = words.map(([text, x0, x1]) => ({ text, x0, x1, base, size, y0: base - 7, y1: base + 1, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0 }));
    return { words: ws, text: ws.map((w) => w.text).join(" "), x0: ws[0].x0, x1: Math.max(...ws.map((w) => w.x1)), y0: base - 7, y1: base + 1, base, size, chars: ws.reduce((n, w) => n + w.text.length, 0), bold: false, mathShare: 0 };
  };
  const lines = [
    line([["Indirect Rate (c)/(d)", 72, 147], ["870,038", 217, 246]], 442),
    line([["1,839,050", 210, 246], ["47.31%", 277, 305]], 454),
    line([["Fringe Benefit Rate (b)/(a)", 72, 169], ["352,000", 210, 239], ["26.79%", 278, 305]], 476),
  ];
  assert.equal(detectStreamRuns(lines, { bridgeGaps: false }).length, 0);
  assert.equal(detectStreamRuns(lines).length, 1, "the same lines still join when no ruled table claimed the page");
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

test("detectStreamRuns joins a wrapped unit name to the factor row under it", () => {
  const lineAt = (base, cells) => {
    const words = [];
    for (const [text, x] of cells) {
      let at = x;
      for (const bit of text.split(" ")) {
        words.push({ text: bit, x0: at, x1: at + bit.length * 4.2, base, size: 9, y0: base - 7, y1: base + 2, bold: false, mathChars: 0, mathFontChars: 0 });
        at += bit.length * 4.2 + 2.4;
      }
    }
    return { words, text: words.map((w) => w.text).join(" "), x0: words[0].x0, x1: words.at(-1).x1, y0: base - 7, y1: base + 2, base, size: 9 };
  };
  const items = detectStreamRuns([
    lineAt(100, [["To convert from", 40], ["to", 280], ["Multiply by", 460]]),
    lineAt(112, [["abampere", 40], ["ampere (A)", 280], ["1.0 E+01", 460]]),
    lineAt(124, [["abcoulomb", 40], ["coulomb (C)", 280], ["1.0 E+01", 460]]),
    lineAt(136, [["abfarad", 40], ["farad (F)", 280], ["1.0 E+09", 460]]),
    lineAt(148, [["British thermal unit of heat per hour square foot degree", 40]]),
    lineAt(160, [["[Btu]", 40], ["watt per kelvin", 280], ["1.730 735 E+00", 460]]),
  ]);
  const tables = items.filter((t) => !t.type || t.type === "table");
  assert.equal(tables.length, 1);
  assert.ok(tables[0].rows >= 5);
  assert.equal(tables[0].cells.some((c) => c.text.includes("British") && c.text.includes("Btu")), true);
});

test("detectStreamRuns keeps a conversion table with long names and a scientific factor", () => {
  const lineAt = (base, cells) => {
    const words = [];
    for (const [text, x] of cells) {
      let at = x;
      for (const bit of text.split(" ")) {
        words.push({ text: bit, x0: at, x1: at + bit.length * 4.2, base, size: 9, y0: base - 7, y1: base + 2, bold: false, mathChars: 0, mathFontChars: 0 });
        at += bit.length * 4.2 + 2.4;
      }
    }
    return { words, text: words.map((w) => w.text).join(" "), x0: words[0].x0, x1: words.at(-1).x1, y0: base - 7, y1: base + 2, base, size: 9 };
  };
  const items = detectStreamRuns([
    lineAt(100, [["To convert from", 40], ["to", 280], ["Multiply by", 460]]),
    lineAt(112, [["abampere", 40], ["ampere (A)", 280], ["1.0 E+01", 460]]),
    lineAt(124, [["acceleration of free fall", 40], ["meter per second squared", 280], ["9.806 65 E+00", 460]]),
    lineAt(136, [["acre foot based on the survey", 40], ["cubic meter (m)", 280], ["1.233 489 E+03", 460]]),
    lineAt(148, [["bar", 40], ["pascal (Pa)", 280], ["1.0 E+05", 460]]),
  ]);
  const tables = items.filter((t) => !t.type || t.type === "table");
  assert.equal(tables.length, 1);
  assert.equal(tables[0].cols, 3);
  assert.ok(tables[0].rows >= 4);
});

test("tokenizeLine splits leader dots into columns and keeps a scientific factor whole", () => {
  const words = [
    { text: "abampere", x0: 90, x1: 130 },
    { text: ".......", x0: 140, x1: 250 },
    { text: "ampere", x0: 260, x1: 300 },
    { text: "(A)", x0: 304, x1: 324 },
    { text: ".......", x0: 330, x1: 450 },
    { text: "1.0", x0: 460, x1: 478 },
    { text: "E+01", x0: 486, x1: 520 },
  ];
  const tok = tokenizeLine({ words, size: 10, x0: 90, x1: 520 });
  assert.deepEqual(tok.map((t) => t.text), ["abampere", "ampere (A)", "1.0 E+01"]);
});

test("tableFromBand keeps sentence-case booktabs body rows apart", () => {
  const w = (text, x, base) => ({ text, x0: x, x1: x + Math.max(12, text.length * 5), base, size: 10, y0: base - 8, y1: base + 2, bold: false, mathChars: 0, mathFontChars: 0, rowSize: 10 });
  const words = [w("Quantity", 40, 100), w("Name", 200, 100), w("Symbol", 320, 100)];
  for (const [i, cells] of [["length", "meter", "m"], ["mass", "kilogram", "kg"], ["time", "second", "s"], ["current", "ampere", "A"]].entries()) {
    const base = 140 + i * 14;
    words.push(w(cells[0], 40, base), w(cells[1], 200, base), w(cells[2], 320, base));
  }
  const band = { x0: 30, x1: 400, y0: 88, y1: 210, ys: [{ y: 88, full: true }, { y: 118, full: true }, { y: 210, full: true }] };
  const t = tableFromBand(band, words);
  assert.ok(t);
  assert.equal(t.rows, 5);
  assert.equal(t.cells.some((c) => c.text === "length"), true);
  assert.equal(t.cells.some((c) => c.text.includes("length") && c.text.includes("mass")), false);
});

test("detectStreamRuns reads a regression grid as a table, not a formula", () => {
  const stamp = (line) => {
    for (const w of line.words) { w.mathChars = w.text.length; w.mathFontChars = w.text.length; }
    return line;
  };
  const head = stamp(row([["(1)", 200], ["(2)", 280], ["(3)", 360], ["(4)", 440]], 100, 10));
  const data = (a, b, c, d, base) => stamp(row([["MFIs", 40], [a, 200], [b, 280], [c, 360], [d, 440]], base, 10));
  const items = detectStreamRuns([
    head,
    data("0.01", "-0.08", "-0.31", "-0.06", 114),
    data("(0.06)", "(0.05)", "(0.13)", "(0.07)", 128),
    data("0.72", "1.20", "0.24", "0.76", 142),
    data("2735", "2735", "2735", "2735", 156),
  ], { column: { x0: 30, x1: 500 } });
  assert.equal(items.some((t) => t.type === "formula"), false);
  assert.equal(items.filter((t) => !t.type || t.type === "table").length, 1);
  assert.ok(items[0].rows >= 4);
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

test("an unheaded stream grid without a number, date, or time column is not a table", () => {
  const names = [];
  for (let i = 0; i < 6; i++) names.push(row([["RICHARD STOCKTON,", 70], ["GEORGE READ,", 300]], 100 + i * 14));
  assert.equal(detectStreamRuns(names).length, 0, "two columns of names are the page's text");
  const letter = [];
  for (let i = 0; i < 4; i++) letter.push(row([["Dear", 40], ["Mr", 160], ["Johnson", 240]], 80 + i * 16));
  assert.equal(detectStreamRuns(letter).length, 0, "a letter's lines are not a table");
  const roster = [];
  for (let i = 0; i < 4; i++) roster.push(row([["Blaney", 40], ["1911", 200], ["1917", 320]], 100 + i * 14));
  assert.equal(detectStreamRuns(roster).length, 1, "a name beside two years stays a table");
  const hours = [];
  for (let i = 0; i < 3; i++) hours.push(row([["Dienstag:", 40], ["12.00 - 17.00 Uhr", 200]], 100 + i * 16));
  assert.equal(detectStreamRuns(hours).length, 1, "a label beside a clock time stays a table");
  assert.equal(lacksTabularEvidence({ method: "stream", headerRows: 0, rows: 4, cols: 3, cells: [
    { r: 0, c: 0, text: "Blaney" }, { r: 0, c: 1, text: "Aug. 2, 1911" }, { r: 0, c: 2, text: "Present." },
    { r: 1, c: 0, text: "Darlington" }, { r: 1, c: 1, text: "Jan. 9, 1923" }, { r: 1, c: 2, text: "Present." },
    { r: 2, c: 0, text: "Edwards" }, { r: 2, c: 1, text: "Jan. 9, 1923" }, { r: 2, c: 2, text: "Present." },
    { r: 3, c: 0, text: "Everding" }, { r: 3, c: 1, text: "Jan. 9, 1923" }, { r: 3, c: 2, text: "Present." },
  ] }), false, "a date column is tabular evidence");
  assert.equal(lacksTabularEvidence({ method: "stream", headerRows: 1, rows: 4, cols: 2, cells: [
    { r: 0, c: 0, text: "Name" }, { r: 0, c: 1, text: "City" },
    { r: 1, c: 0, text: "Ada" }, { r: 1, c: 1, text: "Paris" },
    { r: 2, c: 0, text: "Bea" }, { r: 2, c: 1, text: "Lyon" },
    { r: 3, c: 0, text: "Cara" }, { r: 3, c: 1, text: "Nice" },
  ] }), false, "a header keeps a text grid");
  assert.equal(lacksTabularEvidence({ method: "stream", headerRows: 4, rows: 4, cols: 2, cells: [
    { r: 0, c: 0, text: "Dear" }, { r: 0, c: 1, text: "sir" },
    { r: 1, c: 0, text: "your" }, { r: 1, c: 1, text: "letter" },
    { r: 2, c: 0, text: "came" }, { r: 2, c: 1, text: "today" },
    { r: 3, c: 0, text: "with" }, { r: 3, c: 1, text: "thanks" },
  ] }), true, "a header with no body rows is not evidence");
});

test("a page-number column is not a value column unless the list is named or headed Page", () => {
  const toc = [
    ["The expression of resistivity.", "54"],
    ["The density of copper", "61"],
    ["Calculation of the resistance", "64"],
  ].map(([title, page], i) => row([[title, 40], [page, 360]], 100 + i * 14));
  assert.equal(detectStreamRuns(toc).length, 0, "entries and a page number are not a data table");
  const named = [
    ["FIGURE 1. Apparatus", "7"],
    ["FIGURE 2. Chart", "9"],
    ["FIGURE 3. Plate", "11"],
  ].map(([title, page], i) => row([[title, 40], [page, 360]], 100 + i * 14));
  assert.equal(detectStreamRuns(named).filter((t) => !t.type || t.type === "table").length, 1, "a figures list stays a table");
  const gages = [
    ["12-", "-10", "Some of the later gages were based on the"],
    ["13-", "-11", "It was used extensively both in Great"],
    ["14-", "-12", "Britain and in the United States for many"],
    ["15-", "-13", "It has been superseded and is now nearly"],
  ].map(([a, b, prose], i) => row([[a, 40], [b, 90], [prose, 150]], 100 + i * 14));
  assert.equal(detectStreamRuns(gages).length, 0, "gage indexes beside prose are not measured values");
  const titled = [
    ["The characteristics of the American wire gage", "20"],
    ["Wire table short cuts", "20"],
    ["Explanation of tables", "23"],
  ].map(([title, page], i) => row([[title, 40], [page, 400]], 100 + i * 14));
  assert.equal(detectStreamRuns(titled).length, 0, "the word table inside a chapter title does not name the list");
  assert.equal(lacksTabularEvidence({
    method: "stream", headerRows: 1, rows: 4, cols: 2, cells: [
      { r: 0, c: 1, text: "Page." },
      { r: 1, c: 0, text: "Introduction" }, { r: 1, c: 1, text: "5" },
      { r: 2, c: 0, text: "Composition of natural gas" }, { r: 2, c: 1, text: "6" },
      { r: 3, c: 0, text: "Publications on petroleum" }, { r: 3, c: 1, text: "11" },
    ],
  }), false, "a Page heading keeps the contents table");
  assert.equal(lacksTabularEvidence({
    method: "stream", headerRows: 0, rows: 3, cols: 2, cells: [
      { r: 0, c: 0, text: "Introduction" }, { r: 0, c: 1, text: "5" },
      { r: 1, c: 0, text: "Compressibility of methane" }, { r: 1, c: 1, text: "6" },
      { r: 2, c: 0, text: "Publications on petroleum" }, { r: 2, c: 1, text: "11" },
    ],
  }), true, "page numbers alone are not a value column");
  assert.equal(lacksTabularEvidence({
    method: "stream", headerRows: 0, rows: 2, cols: 2, cells: [
      { r: 0, c: 0, text: "TABLE 1. PV values for air" }, { r: 0, c: 1, text: "8" },
      { r: 1, c: 0, text: "2. PV values for natural gas" },
    ],
  }), false, "a tables list stays when the second page number is missing");
  assert.equal(lacksTabularEvidence({
    method: "stream", headerRows: 1, rows: 4, cols: 3, cells: [
      { r: 0, c: 0, text: "Era." }, { r: 0, c: 1, text: "Characteristic life." }, { r: 0, c: 2, text: "Duration." },
      { r: 1, c: 0, text: "Quaternary." }, { r: 1, c: 1, text: "Age of man. Animals and plants of modern type." }, { r: 1, c: 2, text: "1 to 5." },
      { r: 2, c: 0, text: "Tertiary." }, { r: 2, c: 1, text: "Age of mammals. Possible first appearance of man." }, { r: 2, c: 2, text: "1 to 10." },
      { r: 3, c: 0, text: "Carboniferous." }, { r: 3, c: 1, text: "Age of amphibians. Dominance of club mosses and ferns." }, { r: 3, c: 2, text: "17 to 25." },
    ],
  }), false, "a duration range is a measured value even when the other cells are prose");
  assert.equal(lacksTabularEvidence({
    method: "stream", headerRows: 2, rows: 5, cols: 5, cells: [
      { r: 0, c: 1, text: "SI coherent derived unit" },
      { r: 1, c: 0, text: "Quantity" }, { r: 1, c: 1, text: "Special name" }, { r: 1, c: 2, text: "Special symbol" }, { r: 1, c: 3, text: "Expression in terms of other SI units" }, { r: 1, c: 4, text: "Expression in terms of SI base units" },
      { r: 2, c: 0, text: "plane angle" }, { r: 2, c: 1, text: "radian" }, { r: 2, c: 2, text: "rad" }, { r: 2, c: 3, text: "m/m" },
      { r: 3, c: 0, text: "energy, work, amount of heat" }, { r: 3, c: 1, text: "joule" }, { r: 3, c: 2, text: "J" }, { r: 3, c: 3, text: "N · m" },
      { r: 4, c: 0, text: "electric charge, amount of electricity" }, { r: 4, c: 1, text: "coulomb" }, { r: 4, c: 2, text: "C" }, { r: 4, c: 3, text: "s · A" },
    ],
  }), false, "column titles keep a unit table whose cells are names, not numbers");
  assert.equal(lacksTabularEvidence({
    method: "stream", headerRows: 1, rows: 4, cols: 4, cells: [
      { r: 0, c: 1, text: "8" }, { r: 0, c: 2, text: "2, page 18." }, { r: 0, c: 3, text: "brought out in Birmingham." },
      { r: 1, c: 0, text: "12-" }, { r: 1, c: 1, text: "-10" }, { r: 1, c: 2, text: "Some of the later gages were based on the decimal system." },
      { r: 2, c: 0, text: "13-" }, { r: 2, c: 1, text: "-11" }, { r: 2, c: 2, text: "It was used extensively both in Great Britain and America." },
      { r: 3, c: 0, text: "14-" }, { r: 3, c: 1, text: "-12" }, { r: 3, c: 2, text: "It has been superseded and is now nearly forgotten." },
    ],
  }), true, "a sentence under a false header is not a column-title table");
  assert.equal(lacksTabularEvidence({
    method: "stream", headerRows: 1, rows: 4, cols: 2, cells: [
      { r: 0, c: 0, text: "Indicators" }, { r: 0, c: 1, text: "Weight of indicator in 2006" },
      { r: 1, c: 0, text: "Employment" }, { r: 1, c: 1, text: "40" },
      { r: 2, c: 0, text: "Further studies" }, { r: 2, c: 1, text: "15" },
      { r: 3, c: 0, text: "Dropping out" }, { r: 3, c: 1, text: "15" },
    ],
  }), false, "small integers under a column title are weights, not page numbers");
});

test("a chart's label table inside the figure is dropped after layout puts it back", () => {
  const table = {
    id: "t1", type: "table", page: 1, method: "vlm", rows: 2, cols: 3, headerRows: 0,
    bbox: [80, 400, 500, 460],
    cells: [
      { r: 0, c: 0, text: "35.7" }, { r: 0, c: 1, text: "35.6" }, { r: 0, c: 2, text: "35.5" },
      { r: 1, c: 0, text: "34.1" }, { r: 1, c: 1, text: "34.0" }, { r: 1, c: 2, text: "33.8" },
    ],
  };
  const data = {
    id: "t2", type: "table", page: 1, method: "lattice", rows: 6, cols: 4, headerRows: 1,
    bbox: [80, 80, 400, 220],
    cells: ["Ada", "12", "Bea", "14", "Cara", "16", "Dora", "18", "Eve", "20", "Fay", "22", "Gus", "24", "Hal", "26", "Ivy", "28", "Jan", "30", "Kim", "32", "Leo", "34"].map((text, i) => ({ r: Math.floor(i / 4), c: i % 4, text })),
  };
  const doc = {
    blocks: {
      t1: table,
      t2: data,
      f1: { id: "f1", type: "figure", page: 1, bbox: [40, 300, 560, 700] },
    },
    order: ["t2", "f1", "t1"],
  };
  dropFigureLabelTables(doc);
  assert.deepEqual(doc.order, ["t2", "f1"]);
  assert.equal(doc.blocks.t1, undefined);
  assert.equal(doc.blocks.t2.type, "table");
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
  assert.equal(isScanBanner("1•A.C.A. Tochnical Noto No. 426"), true);
  assert.equal(isScanBanner("Unique header"), false);
  const h = 785;
  const banner = { text: "1•A.C.A. Tochnical Noto No. 426", base: 75.4, y0: 66, y1: 78, x0: 80, x1: 400, size: 12 };
  const num = { text: "8", base: 75.4, y0: 66, y1: 78, x0: 40, x1: 52, size: 12 };
  const body = { text: "compressed within the supercharger", base: 113, y0: 102, y1: 116, x0: 70, x1: 500, size: 12 };
  const scan = findFurniture([{ n: 10, h, lines: [num, banner, body] }]);
  assert.equal(scan.isFurniture(banner), true);
  assert.equal(scan.isFurniture(num), true);
  assert.equal(scan.isFurniture(body), false);
  assert.ok(scan.removed.some((r) => r.reason === "scan-banner"));
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
  const cols = {
    L: { id: "L", type: "para", page: 1, text: "nating a distant target", spans: [{ size: 10 }], bbox: [78, 80, 290, 700] },
    R: { id: "R", type: "para", page: 1, text: "detector arrays every pixel", spans: [{ size: 10 }], bbox: [312, 80, 520, 120] },
  };
  const colOrder = ["L", "R"];
  mergeContinuations(colOrder, cols);
  assert.deepEqual(colOrder, ["L", "R"]);
  assert.equal(cols.L.text, "nating a distant target");
  const header = {
    h: { id: "h", type: "para", page: 4, text: "1•A.C.A. Tochnical Noto No. 426", spans: [{ size: 12 }], bbox: [70, 60, 400, 80] },
    b: { id: "b", type: "para", page: 4, text: "compressed within the supercharger", spans: [{ size: 12 }], bbox: [70, 110, 500, 140] },
  };
  const headerOrder = ["h", "b"];
  mergeContinuations(headerOrder, header);
  assert.deepEqual(headerOrder, ["h", "b"]);
  assert.equal(header.h.text, "1•A.C.A. Tochnical Noto No. 426");
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

const wordAt = (text, x, base, width) => ({
  text, x0: x, x1: x + (width ?? text.length * 5), base, size: 9,
  y0: base - 7, y1: base + 2, bold: false, mathChars: 0, boldChars: 0, italicChars: 0, mathFontChars: 0, rowSize: 9,
});

test("a body-only vertical splits the number columns and leaves the spanning header", () => {
  const rules = [];
  for (const y of [100, 120, 140, 160, 180, 200]) rules.push({ axis: "h", x0: 100, x1: 400, y0: y, y1: y });
  for (const x of [100, 200, 300, 400]) rules.push({ axis: "v", x0: x, x1: x, y0: 100, y1: 200 });
  rules.push({ axis: "v", x0: 250, x1: 250, y0: 140, y1: 200 });
  const words = [
    wordAt("Trial", 210, 114, 70),
    wordAt("12.1", 205, 154, 22), wordAt("399", 268, 154, 22),
    wordAt("13.4", 205, 174, 22), wordAt("401", 268, 174, 22),
    wordAt("14.0", 205, 194, 22), wordAt("388", 268, 194, 22),
  ];
  const { tables } = findLatticeTables({ rules, boxes: [], words });
  assert.equal(tables.length, 1);
  const t = tables[0];
  assert.equal(t.cols, 4);
  const head = t.cells.find((k) => k.text === "Trial");
  assert.equal(head.colSpan, 2);
  assert.equal(head.header, true);
  assert.ok(t.cells.some((k) => k.text === "12.1" && k.colSpan === 1));
  assert.ok(t.cells.some((k) => k.text === "399" && k.c === t.cells.find((c) => c.text === "12.1").c + 1));
});

test("unit lines above the numbers stay in the header", () => {
  const rules = [];
  const ys = [100, 118, 136, 154, 172];
  for (const y of ys) rules.push({ axis: "h", x0: 40, x1: 280, y0: y, y1: y });
  for (const x of [40, 120, 200, 280]) rules.push({ axis: "v", x0: x, x1: x, y0: 100, y1: 172 });
  const words = [
    wordAt("Volume", 48, 112, 40), wordAt("Pressure", 128, 112, 50), wordAt("PV", 220, 112, 20),
    wordAt("C.c.", 48, 130, 24), wordAt("Mm.", 128, 130, 22), wordAt("mercury", 160, 130, 36),
    wordAt("404.0", 48, 148, 30), wordAt("760", 140, 148, 20), wordAt("1.00", 214, 148, 28),
    wordAt("401.6", 48, 166, 30), wordAt("755", 140, 166, 20), wordAt("0.99", 214, 166, 28),
  ];
  const { tables } = findLatticeTables({ rules, boxes: [], words });
  assert.equal(tables.length, 1);
  assert.equal(tables[0].rows, 4);
  assert.equal(tables[0].headerRows, 2);
  assert.equal(tables[0].cells.find((k) => k.text.startsWith("C.c.")).header, true);
  assert.equal(tables[0].cells.find((k) => k.text === "404.0").header, false);
});

test("an identifier row under a rule is a header and a comma number is not", () => {
  const rules = [];
  for (const y of [40, 58, 76, 94, 112]) rules.push({ axis: "h", x0: 20, x1: 320, y0: y, y1: y });
  for (const x of [20, 80, 140, 200, 260, 320]) rules.push({ axis: "v", x0: x, x1: x, y0: 40, y1: 112 });
  const words = [
    wordAt("Lab", 28, 52, 20), wordAt("A", 90, 52, 10), wordAt("B", 150, 52, 10), wordAt("C", 210, 52, 10), wordAt("D", 270, 52, 10),
    wordAt("22954", 28, 70, 32), wordAt("22955", 88, 70, 32), wordAt("22956", 148, 70, 32), wordAt("22957", 208, 70, 32), wordAt("22958", 268, 70, 32),
    wordAt("1,275", 28, 88, 32), wordAt("820", 96, 88, 18), wordAt("900", 156, 88, 18), wordAt("700", 216, 88, 18), wordAt("640", 276, 88, 18),
    wordAt("1,300", 28, 106, 32), wordAt("810", 96, 106, 18), wordAt("880", 156, 106, 18), wordAt("690", 216, 106, 18), wordAt("630", 276, 106, 18),
  ];
  const { tables } = findLatticeTables({ rules, boxes: [], words });
  assert.equal(tables.length, 1);
  assert.equal(tables[0].headerRows, 2);
  assert.equal(tables[0].cells.find((k) => k.text === "22954").header, true);
  assert.equal(tables[0].cells.find((k) => k.text === "1,275").header, false);
});

test("wrapped glyphs that share a column stay on successive lines", () => {
  const stacked = relineWords([
    wordAt("ture", 20, 100, 40),
    wordAt("which", 18, 104, 36),
  ]);
  assert.equal(stacked.length, 2);
  assert.equal(stacked[0].text, "ture");
  const sup = relineWords([
    wordAt("10", 10, 100, 12),
    wordAt("19", 24, 97, 12),
  ]);
  assert.equal(sup.length, 1);
});

test("a two-row contents list is a table and a two-row phrase is not", () => {
  const page = (rows) => buildLines(rows.flat(), { transform: VP, fonts: FONTS }).lines;
  const contents = page([
    [item("FIGURE 1. Apparatus", 72, 700, 10, "f1", 150), item("7", 400, 700, 10, "f1", 8)],
    [item("FIGURE 2. Chart", 72, 684, 10, "f1", 120), item("9", 401, 684, 10, "f1", 8)],
  ]);
  const found = detectStreamRuns(contents).filter((b) => b.type === "table");
  assert.equal(found.length, 1);
  assert.equal(found[0].rows, 2);
  assert.equal(found[0].cols, 2);
  const numbered = page([
    [item("2.", 90, 700, 10, "f1", 14), item("Figure of the apparatus", 110, 700, 10, "f1", 180), item("9", 400, 700, 10, "f1", 8)],
    [item("3.", 90, 684, 10, "f1", 14), item("Apparatus", 110, 684, 10, "f1", 70), item("11", 401, 684, 10, "f1", 10)],
  ]);
  const listed = detectStreamRuns(numbered).filter((b) => b.type === "table");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].cols, 2);
  const onePage = page([
    [item("TABLE 1. PV values for air", 72, 700, 10, "f1", 180), item("8", 400, 700, 10, "f1", 8)],
    [item("2. PV values for natural gas", 72, 684, 10, "f1", 190)],
  ]);
  assert.equal(detectStreamRuns(onePage).filter((b) => b.type === "table").length, 1, "the list stays when the second page number is missing");
  const phrase = page([
    [item("The mixture was heated slowly", 72, 700, 10, "f1", 180)],
    [item("and then left overnight", 72, 684, 10, "f1", 150)],
  ]);
  assert.equal(detectStreamRuns(phrase).filter((b) => b.type === "table").length, 0);
});

test("a repeated narrow gap between numeric words is a column and a thousands group is not", () => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const y = 700 - i * 14;
    rows.push([
      item("Alabama", 40, y, 8, "f1", 52),
      item("5.89", 180, y, 8, "f1", 22),
      item(String(169 + i), 204.2, y, 8, "f1", 18),
      item("12", 280, y, 8, "f1", 14),
    ]);
  }
  const lines = buildLines(rows.flat(), { transform: VP, fonts: FONTS }).lines;
  const table = detectStreamRuns(lines).find((b) => b.type === "table");
  assert.ok(table);
  assert.equal(table.cols, 4);
  const grouped = [];
  for (let i = 0; i < 6; i++) {
    const y = 700 - i * 14;
    grouped.push([
      item("State", 40, y, 8, "f1", 36),
      item("10,", 180, y, 8, "f1", 16),
      item("533", 197, y, 8, "f1", 16),
      item("8", 280, y, 8, "f1", 8),
    ]);
  }
  const kept = detectStreamRuns(buildLines(grouped.flat(), { transform: VP, fonts: FONTS }).lines).find((b) => b.type === "table");
  assert.ok(kept);
  assert.equal(kept.cols, 3);
  const narrow = [];
  for (let i = 0; i < 6; i++) {
    const y = 700 - i * 14;
    narrow.push([
      item("Treated", 40, y, 8, "f1", 48),
      item("1", 180, y, 8, "f1", 8),
      item("01", 190, y, 8, "f1", 10),
      item("20.01", 280, y, 8, "f1", 28),
    ]);
  }
  const oneNumber = detectStreamRuns(buildLines(narrow.flat(), { transform: VP, fonts: FONTS }).lines).find((b) => b.type === "table");
  assert.ok(oneNumber);
  assert.equal(oneNumber.cols, 3);
});

test("a speed line ending in a column integer does not end the table before the body", () => {
  const lines = buildLines([
    [item("Supercharger speed - 2,000 r.p.m.", 72, 700, 10, "f1", 220), item("15", 400, 700, 10, "f1", 14)],
    [item("Pressure difference, in. of Hg", 72, 686, 10, "f1", 180), item("0", 270, 686, 10, "f1", 10), item("12", 330, 686, 10, "f1", 14), item("15", 400, 686, 10, "f1", 14)],
    [item("N.A.C.A. Roots supercharger, hp", 72, 672, 10, "f1", 190), item("0.954", 260, 672, 10, "f1", 32), item("39.7", 330, 672, 10, "f1", 24), item("57.1", 390, 672, 10, "f1", 24)],
    [item("Powerplus supercharger, hp", 72, 658, 10, "f1", 160), item("6.57", 270, 658, 10, "f1", 24), item("39.55", 330, 658, 10, "f1", 28), item("59.8", 390, 658, 10, "f1", 24)],
  ].flat(), { transform: VP, fonts: FONTS }).lines;
  const found = detectStreamRuns(lines).filter((b) => b.type === "table");
  assert.equal(found.length, 1);
  assert.ok(found[0].rows >= 4);
});

test("a unit line under the column names stays in the header", () => {
  const units = buildLines([
    [item("Volume", 40, 700, 8, "f1", 40), item("Pressure", 160, 700, 8, "f1", 52), item("PV", 280, 700, 8, "f1", 16)],
    [item("C.c.", 40, 686, 8, "f1", 24), item("Mm.", 160, 686, 8, "f1", 22), item("mercury", 188, 686, 8, "f1", 48)],
    [item("404.0", 40, 672, 8, "f1", 30), item("760", 170, 672, 8, "f1", 20), item("1.00", 276, 672, 8, "f1", 24)],
    [item("401.6", 40, 658, 8, "f1", 30), item("755", 170, 658, 8, "f1", 20), item("0.99", 276, 658, 8, "f1", 24)],
  ].flat(), { transform: VP, fonts: FONTS }).lines;
  const named = detectStreamRuns(units).find((b) => b.type === "table");
  assert.ok(named);
  assert.equal(named.headerRows, 2);
  assert.equal(named.cells.find((k) => k.text.startsWith("C.c.")).header, true);
  assert.equal(named.cells.find((k) => k.text === "404.0").header, false);
});
