// Scanned tables: OCR page records through the engine, the numeric post-correction, the
// fresh-vs-layer merge, the cell re-read, the helper client's ocr() call, and the view hook.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assembleDocument, ocrGraphics, parsePageGeometry } from "../src/model/parse/index.js";
import {
  applyCellOcr, cellsToReread, chemicalSubscripts, decimalStyle, fitsColumn, isPlaceholder, moveStubTotal, numericLike, polishTableText, repairNumber, repairTableReading,
  repairNumericColumns, repairOcrTable, repairYearHeader, spanGroupHeaders, spanNoteRows, tableNumericValidity, unspanNarrowCells,
} from "../src/model/parse/ocr-fix.js";
import { chooseTable, mergeOcrDocument, scanPagesOf } from "../src/model/parse/ocr-merge.js";
import { createHelperClient } from "../src/host/parse-helper-client.js";
import { alignVlmText, hintLayoutFigures, linkLayoutCaptions } from "../src/model/parse/vlm-tables.js";
import { readScan } from "../src/view/parse-engine.js";
import { buildLines } from "../src/model/parse/lines.js";
import { visualRows } from "../src/model/parse/stream.js";

// ---------------------------------------------------------------- fixtures

function word(str, x, base, { size = 6, conf = 1, width = null } = {}) {
  return { str, transform: [size, 0, 0, size, x, base], width: width ?? str.length * size * 0.55, height: size, y0: base - 0.8 * size, y1: base + 0.22 * size, fontName: "ocr", conf };
}

// A 1980-style summary: label column, four year columns, a rule under the header and one
// between groups, dotted note row, dashes, one misread digit, one empty cell.
function ocrPage({ n = 1, misread = true } = {}) {
  const items = [];
  const cols = [20, 120, 160, 200, 240];
  const header = ["Disease", "1980", "1979", "1878", "1977"];
  header.forEach((t, c) => items.push(word(t, cols[c], 30)));
  const rows = [
    ["Amebiasis", "2.38", "1.90", "1.84", "1.41"],
    ["Anthrax", "0.00", misread ? "0.D0" : "0.00", "0.00", "0.00"],
    ["Infant", "0.03", "0.01", "—", "—"],
    ["Chancroid", "0.35", "0.38", "0.24", "0.21"],
    ["Cholera", "0.00", "0.0B", "0.01", ""],
    ["Smallpox", "", "Last documented", "case occurred", "in 1949"],
    ["Mumps", "3.86", "6.55", "7.81", "10.02"],
  ];
  rows.forEach((row, r) => {
    const base = 40 + r * 7;
    row.forEach((t, c) => {
      if (!t) return;
      // Multi-word cells are one item per word, laid out left to right.
      let x = cols[c];
      for (const piece of t.split(" ")) { items.push(word(piece, x, base, { conf: t === "0.D0" ? 0.5 : 1 })); x += piece.length * 6 * 0.55 + 2; }
    });
  });
  const rules = [
    { x0: 10, y0: 24, x1: 280, y1: 24, thick: 0.5 },
    { x0: 10, y0: 33, x1: 280, y1: 33, thick: 0.5 },
    { x0: 10, y0: 60.5, x1: 280, y1: 60.5, thick: 0.5 },
    { x0: 10, y0: 88, x1: 280, y1: 88, thick: 0.5 },
    ...[110, 150, 190, 230].map((x) => ({ x0: x, y0: 24, x1: x, y1: 88, thick: 0.5 })),
  ];
  return { n, w: 300, h: 120, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0, fonts: { ocr: { name: "ocr" } }, items, rules, ops: { fnArray: [], argsArray: [] } };
}

function tableOf(doc) {
  return doc.order.map((id) => doc.blocks[id]).find((b) => b.type === "table");
}

function cell(t, r, c) {
  return t.cells.find((k) => k.r === r && k.c === c);
}

// ---------------------------------------------------------------- engine on OCR records

test("ocrGraphics copies helper ink onto the page graphics", () => {
  const ink = [
    { x0: 60, y0: 80, x1: 180, y1: 200 },
    { x0: 200, y0: 90, x1: 320, y1: 210 },
    { x0: 70, y0: 220, x1: 190, y1: 340 },
    { x0: 210, y0: 230, x1: 330, y1: 350 },
  ];
  const g = ocrGraphics({ rules: [], items: [word("Fig.", 70, 400), word("5", 100, 400)], ink }, 400, 500);
  assert.deepEqual(g.ink, ink);
  const page = parsePageGeometry({
    n: 1, w: 400, h: 500, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0,
    fonts: { ocr: { name: "ocr" } },
    items: [word("Fig.", 70, 400), word("5", 96, 400), word("plate", 120, 400)],
    rules: [], ink, ops: { fnArray: [], argsArray: [] },
  }, 1);
  const d = assembleDocument([page], { numPages: 1 });
  const figs = d.order.map((id) => d.blocks[id]).filter((b) => b.type === "figure");
  assert.equal(figs.length, 1);
  assert.ok(figs[0].bbox[2] >= 320, "the plate hulls the helper ink");
  const cap = d.blocks[figs[0].caption];
  assert.match(cap.text, /Fig\. 5/);
});

test("ocrGraphics turns helper rules into engine rules and one page image", () => {
  const g = ocrGraphics({ rules: [{ x0: 1, y0: 5, x1: 90, y1: 5.4, thick: 0.4 }, { x0: 40, y0: 2, x1: 40.2, y1: 70 }], items: [word("..", 50, 20), word("1.5", 60, 20)] }, 100, 80);
  assert.equal(g.rules[0].axis, "h");
  assert.equal(g.rules[1].axis, "v");
  assert.deepEqual(g.images, [{ x0: 0, y0: 0, x1: 100, y1: 80 }]);
  assert.equal(g.dots.length, 2, "leader dots become dots");
});

test("ocrGraphics turns raster fills into boxes and their top and bottom edges into rules", () => {
  const g = ocrGraphics({ rules: [], items: [word("Head", 20, 28), word("1.5", 20, 38)], fills: [{ x0: 10, y0: 20, x1: 90, y1: 30, gray: 0.33 }, { x0: 10, y0: 30, x1: 90, y1: 40, gray: 0.86 }] }, 100, 80);
  assert.equal(g.boxes.length, 2);
  assert.equal(g.boxes[0].light, false);
  assert.equal(g.boxes[1].light, true);
  assert.deepEqual(g.rules.map((r) => [r.axis, r.y0]), [["h", 20], ["h", 30], ["h", 30], ["h", 40]]);
  assert.ok(g.rules.every((r) => r.fromBox));
  const lone = ocrGraphics({ rules: [], items: [], fills: [{ x0: 10, y0: 20, x1: 90, y1: 60, gray: 0.86 }] }, 100, 80);
  assert.equal(lone.boxes.length, 1);
  assert.equal(lone.rules.length, 0, "a lone shaded box (a callout) draws no row edges");
  const strips = ocrGraphics({ rules: [], items: [], fills: [{ x0: 10, y0: 20, x1: 90, y1: 30, gray: 0.86 }, { x0: 10, y0: 31, x1: 90, y1: 40, gray: 0.86 }] }, 100, 80);
  assert.equal(strips.rules.length, 0, "fills with no words (a chart's plot strips) draw no row edges");
});

test("full-width zebra fills bound a table on an OCR page", () => {
  const items = [];
  const fills = [];
  for (let r = 0; r < 5; r++) {
    const base = 120 + r * 20;
    items.push(word(`Row ${r}`, 60, base, { size: 8 }), word(String(100 + r), 200, base, { size: 8 }), word(String(200 + r), 260, base, { size: 8 }));
    if (r % 2 === 0) fills.push({ x0: 50, y0: base - 13, x1: 300, y1: base + 7, gray: r === 0 ? 0.3 : 0.86 });
  }
  const rec = parsePageGeometry({ n: 1, w: 400, h: 400, transform: [1, 0, 0, 1, 0, 0], scan: true, fonts: { ocr: { name: "ocr" } }, items, rules: [], fills, ops: { fnArray: [], argsArray: [] } }, 1);
  assert.equal(rec.tables.length, 1);
  assert.equal(rec.tables[0].rows, 5);
  assert.equal(rec.tables[0].cols, 3);
});

test("an inflated OCR word on a body baseline stays in that line", () => {
  // Vision sizes a short lowercase word from the line box (about 1.7× body). It still
  // belongs in the line; a born-digital size step on the same baseline does not.
  const body = { size: 13 };
  const items = [
    word("around", 91, 485, { ...body, width: 42 }),
    word("the", 142, 485, { ...body, width: 22 }),
    word("stem", 171, 485, { ...body, width: 28 }),
    word("is", 208, 485, { size: 22, width: 12 }),
    word("kept", 229, 485, { ...body, width: 28 }),
    word("as", 264, 485, { size: 20, width: 14 }),
    word("small", 287, 485, { ...body, width: 36 }),
  ];
  const { lines } = buildLines(items);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].words.map((w) => w.text), ["around", "the", "stem", "is", "kept", "as", "small"]);
  assert.ok(lines[0].size < 16, "the line keeps the body size");
  const digital = buildLines([
    { str: "body", transform: [13, 0, 0, 13, 91, 485], width: 40, height: 13, fontName: "f1" },
    { str: "TITLE", transform: [20, 0, 0, 20, 140, 485], width: 50, height: 20, fontName: "f1" },
  ]);
  assert.equal(digital.lines.length, 2);
});

test("a short OCR word whose baseline jitters stays in the gap it belongs to", () => {
  const body = { size: 13 };
  const items = [
    word("and", 90, 672, { ...body, width: 24 }),
    word("the", 118, 672, { ...body, width: 22 }),
    word("oil", 149, 667.4, { ...body, width: 18 }),
    word("remains", 178, 672, { ...body, width: 50 }),
    word("below", 90, 696, { ...body, width: 40 }),
  ];
  const { lines } = buildLines(items);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].words.map((w) => w.text), ["and", "the", "oil", "remains"]);
  assert.equal(lines[1].text, "below");
});

test("OCR halves of one line join when their baselines differ by a third of an em", () => {
  const body = { size: 15 };
  const items = [
    word("ment", 89, 285.4, { ...body, width: 40 }),
    word("through", 135, 285.4, { ...body, width: 70 }),
    word("known", 210, 285.4, { ...body, width: 50 }),
    word("angles", 265, 285.4, { ...body, width: 40 }),
    word("less", 310, 280.8, { ...body, width: 36 }),
    word("than", 350, 280.8, { ...body, width: 36 }),
    word("90", 390, 280.8, { ...body, width: 20 }),
    word("degrees", 415, 280.8, { ...body, width: 60 }),
    word("value", 90, 309.1, { ...body, width: 40 }),
    word("of", 135, 309.1, { ...body, width: 16 }),
    word("g.", 156, 309.1, { ...body, width: 16 }),
  ];
  const { lines } = buildLines(items);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "ment through known angles less than 90 degrees");
  assert.equal(lines[1].text, "value of g.");
});

test("OCR halves split by a hole stay in left-to-right order", () => {
  const body = { size: 12 };
  const items = [
    word("within", 88, 215, { ...body, width: 50 }),
    word("the", 142, 215, { ...body, width: 20 }),
    word("the", 273, 213.2, { ...body, width: 24 }),
    word("discharged", 300, 213.2, { ...body, width: 80 }),
    word("air", 384, 213.2, { ...body, width: 24 }),
  ];
  const { lines } = buildLines(items);
  assert.deepEqual(lines.map((l) => l.text), ["within the", "the discharged air"]);
});

test("OCR words keep their confidence and never glue to a neighbour", () => {
  const { lines } = buildLines([word("Anth", 20, 30, { conf: 0.7 }), word("rax", 33.5, 30, { conf: 0.9 })]);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].words.map((w) => w.text), ["Anth", "rax"]);
  assert.equal(lines[0].words[0].conf, 0.7);
  assert.deepEqual([lines[0].words[0].y0, lines[0].words[0].y1].map((v) => Math.round(v * 10) / 10), [25.2, 31.3], "measured box wins over the font-size box");
});

test("visualRows keeps OCR rows apart by baseline and lets a wrapped line join through a centred cell", () => {
  const w = (text, x0, base, size = 6) => ({ text, x0, x1: x0 + 20, base, size, y0: base - 0.8 * size, y1: base + 0.22 * size, conf: 1 });
  // Two tight rows (pitch 5.6 < box height): two rows.
  const tight = visualRows([w("a", 0, 10), w("1", 50, 10), w("b", 0, 15.6), w("2", 50, 15.6)]);
  assert.equal(tight.length, 2);
  // A wrapped cell at 10 pt: "Z1-" above, "014" a line pitch below, the description centred
  // between them: one row.
  const wrapped = visualRows([w("Z1-", 0, 10, 10), w("Blender", 40, 16, 10), w("014", 0, 22, 10)]);
  assert.equal(wrapped.length, 1);
  // Without the centred cell the two stacked words are two rows.
  assert.equal(visualRows([w("Z1-", 0, 10, 10), w("014", 0, 22, 10)]).length, 2);
  // The centred cell arrives first and sits past 0.7 em (half a pitch plus baseline noise): it
  // still joins because the wrapped second line stacks under the first at twice its gap.
  const late = visualRows([w("Z2-", 0, 10, 10), w("Filler", 40, 10, 10), w("Painted", 80, 17.4, 10), w("031", 0, 24.8, 10), w("motor", 40, 24.8, 10)]);
  assert.deepEqual(late.map((r) => r.words.length), [5]);
  // Evenly pitched rows with every column filled stay three rows.
  const dense = visualRows([w("a", 0, 10, 10), w("b", 40, 10, 10), w("c", 0, 17.4, 10), w("d", 40, 17.4, 10), w("e", 0, 24.8, 10), w("f", 40, 24.8, 10)]);
  assert.equal(dense.length, 3);
  // Three numeric rows at a tight pitch are not one wrapped cell: each row repeats the columns.
  const grid = (text, x, base) => ({ text, x0: x, x1: x + 18, base, size: 8, y0: base - 6.4, y1: base + 1.6, conf: 1 });
  const pitched = visualRows([
    grid("Ala", 0, 100), grid("12", 80, 100), grid("3", 140, 100),
    grid("Ark", 0, 105.8), grid("8", 80, 105.8), grid("1", 140, 105.8),
    grid("Geo", 0, 111.6), grid("7", 80, 111.6), grid("2", 140, 111.6),
  ]);
  assert.equal(pitched.length, 3);
  // One Vision box as tall as several lines does not swallow the baselines under it.
  const tall = (text, x0, base) => ({ text, x0, x1: x0 + 24, base, size: 40, y0: base - 32, y1: base + 8, conf: 1 });
  const body = (text, x0, base) => ({ text, x0, x1: x0 + 24, base, size: 8, y0: base - 6.4, y1: base + 1.8, conf: 1 });
  const inflated = visualRows([
    tall("838", 200, 20), body("Ark", 0, 20), body("2", 80, 20),
    body("Col", 0, 26), body("6", 80, 26),
    body("Geo", 0, 32), body("7", 80, 32),
  ]);
  assert.equal(inflated.length, 3);
  // Born-digital words (no conf) are unchanged: overlap alone decides.
  const digital = visualRows([{ text: "a", x0: 0, x1: 10, base: 10, size: 6, y0: 5, y1: 11 }, { text: "b", x0: 0, x1: 10, base: 12, size: 6, y0: 7, y1: 13 }]);
  assert.equal(digital.length, 1);
});

test("an OCR page record parses as a scan layer page with one table, engine ocr+builtin", () => {
  const rec = parsePageGeometry(ocrPage(), 1);
  assert.equal(rec.ocr, true);
  assert.equal(rec.scanLayer, true);
  assert.equal(rec.kind, "mixed");
  const doc = assembleDocument([rec], { numPages: 1, from: 1, to: 1 });
  const t = tableOf(doc);
  assert.ok(t, "a table");
  assert.equal(t.engine, "ocr+builtin");
  assert.equal(t.cols, 5);
  assert.equal(t.rows, 8);
  assert.equal(t.headerRows, 1);
  assert.equal(doc.pages[0].ocr, true);
  // Cells carry the lowest word confidence inside them and the tight word box.
  assert.equal(cell(t, 2, 2).conf, 0.5, "repaired cell keeps its OCR confidence");
  assert.ok(cell(t, 1, 1).wbox, "wbox on a filled cell");
  assert.equal(cell(t, 1, 1).conf, 1);
  // Repairs ran: the year header and the digit confusions.
  assert.equal(cell(t, 0, 3).text, "1978");
  assert.equal(cell(t, 2, 2).text, "0.00");
  assert.equal(cell(t, 5, 2).text, "0.08");
  assert.ok(t.repairs.fixed.some((f) => f.from === "0.D0" && f.to === "0.00"));
  // The note row spans from the first value column to the last.
  const note = t.cells.find((k) => k.r === 6 && k.colSpan > 1);
  assert.ok(note, "spanning note");
  assert.equal(note.c, 1);
  assert.equal(note.colSpan, 4);
  assert.equal(note.text, "Last documented case occurred in 1949");
});

// ---------------------------------------------------------------- numeric post-correction

test("repairNumber maps the common confusions and leaves real numbers and text alone", () => {
  const cases = [
    ["0.D3", "0.03"], ["D.OD", "0.00"], ["12.B4", "12.84"], ["7.7B", "7.78"], ["1.1Б", "1.16"], ["0.BD", "0.80"],
    ["l.5", "1.5"], ["I2", "12"], ["|0", "10"], ["5|", "5"], ["|2|", "2"], ["Z.5", "2.5"], ["G.1", "6.1"], ["S.5", "5.5"],
    ["28. 90", "28.90"], ["1 .16", "1.16"], ["28.90", "28.90"], ["1,004", "1,004"], ["—", "—"],
  ];
  for (const [from, to] of cases) assert.equal(repairNumber(from), to, from);
  assert.equal(repairNumber("Foodborne"), null, "text is never corrected");
  assert.equal(repairNumber("Aseptic"), null);
  assert.equal(repairNumber("1,5", { decimal: "." }), "1.5", "comma to the column's period");
  assert.equal(repairNumber("1.5", { decimal: "," }), "1,5", "period to the column's comma");
  assert.equal(repairNumber(".05", { leadingZero: true }), "0.05");
  assert.equal(repairNumber(".05", { leadingZero: false }), ".05");
  assert.equal(numericLike("0.BO"), true);
  assert.equal(numericLike("BOB"), false, "needs a digit or a zero-like letter next to digits");
  assert.equal(isPlaceholder("NA"), true);
  assert.equal(isPlaceholder(".."), false, "leader dots are not values");
  assert.equal(decimalStyle(["1.5", "2.0", "3,000"]), ".");
  assert.equal(decimalStyle(["1,5", "2,0"]), ",");
});

test("repairNumericColumns works on numeric columns only and flags what it cannot read", () => {
  const t = { cols: 3, rows: 5, headerRows: 1, cells: [] };
  const rows = [["Name", "A", "B"], ["Foodbome", "0.D1", "x"], ["Aleptic", "2.33", "1.5"], ["Beta", "3.41", "2.5"], ["Gamma", "4.0O", "3.5"], ["Delta", "5.0", "4.5"], ["Eps", "6.0", "5.5"]];
  t.rows = rows.length;
  rows.forEach((row, r) => row.forEach((text, c) => t.cells.push({ r, c, rowSpan: 1, colSpan: 1, text, header: r === 0 })));
  const out = repairNumericColumns(t);
  assert.deepEqual(out.numericCols, [1, 2]);
  assert.equal(cell(t, 1, 1).text, "0.01");
  assert.equal(cell(t, 4, 1).text, "4.00");
  assert.equal(cell(t, 1, 0).text, "Foodbome", "text column untouched");
  assert.equal(cell(t, 2, 0).text, "Aleptic");
  assert.equal(cell(t, 1, 2).text, "x");
  assert.equal(cell(t, 1, 2).conf, 0.3, "unreadable numeric cell is low confidence");
  assert.deepEqual(out.unrepaired, [{ r: 1, c: 2, text: "x" }]);
});

test("a text column with a few numbers is left alone", () => {
  const t = { cols: 2, rows: 4, headerRows: 1, cells: [] };
  [["Site", "Zone"], ["Z1-014", "1"], ["Blender", "Stainless"], ["Z1-O22", "Silicone"]].forEach((row, r) => row.forEach((text, c) => t.cells.push({ r, c, rowSpan: 1, colSpan: 1, text })));
  const out = repairNumericColumns(t);
  assert.deepEqual(out.numericCols, []);
  assert.equal(cell(t, 3, 0).text, "Z1-O22");
});

test("repairYearHeader fits the sequence by majority and fixes a one-character outlier", () => {
  const t = { cols: 11, rows: 2, headerRows: 1, cells: ["Disease", "1980", "1979", "1978", "1977", "1876", "1976", "1974", "1973", "1972", "1971"].map((text, c) => ({ r: 0, c, rowSpan: 1, colSpan: 1, text, header: true })) };
  const fixed = repairYearHeader(t);
  assert.deepEqual(fixed.map((f) => [f.from, f.to]), [["1876", "1976"], ["1976", "1975"]]);
  assert.equal(cell(t, 0, 7).text, "1974", "two characters off is left alone");
  const short = { cols: 3, rows: 1, headerRows: 1, cells: ["1980", "1979", "1978"].map((text, c) => ({ r: 0, c, rowSpan: 1, colSpan: 1, text, header: true })) };
  assert.deepEqual(repairYearHeader(short), [], "needs four years");
});

test("spanNoteRows spans notes, NA and * after the numeric prefix, never dashes", () => {
  const t = { cols: 5, rows: 4, headerRows: 1, cells: [] };
  [["Disease", "1980", "1979", "1978", "1977"], ["Carriers", "0.03", "0.03", "NA", ""], ["Infant", "0.03", "—", "—", "—"], ["Hep", "1.0", "2.0", "", "*"]].forEach((row, r) => row.forEach((text, c) => t.cells.push({ r, c, rowSpan: 1, colSpan: 1, text })));
  const spans = spanNoteRows(t, { numericCols: [1, 2, 3, 4] });
  assert.deepEqual(spans.map((s) => [s.r, s.c, s.colSpan, s.text]), [[1, 3, 2, "NA"], [3, 3, 2, "*"]]);
  assert.equal(t.cells.filter((k) => k.r === 2).length, 5, "dash row untouched");
});

test("unspanNarrowCells puts a widened value back in its own column", () => {
  const t = { cols: 3, rows: 2, headerRows: 1, grid: { xs: [0, 50, 100, 150] }, cells: [
    { r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "Zone" }, { r: 0, c: 1, rowSpan: 1, colSpan: 1, text: "A" }, { r: 0, c: 2, rowSpan: 1, colSpan: 1, text: "B" },
    { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: "Zone 2" }, { r: 1, c: 1, rowSpan: 1, colSpan: 2, text: "204", wbox: [60, 10, 90, 16], bbox: [50, 8, 150, 18], wbase: 15, wsize: 6 },
  ] };
  const changed = unspanNarrowCells(t);
  assert.deepEqual(changed, [{ r: 1, from: 1, span: 2, to: 1 }]);
  assert.equal(cell(t, 1, 1).colSpan, 1);
  assert.equal(cell(t, 1, 2).text, "");
  assert.equal(cell(t, 1, 2).wbase, 15, "the new empty cell knows its row band");
});

test("tableNumericValidity and chooseTable prefer the reading whose numbers read", () => {
  const mk = (vals) => ({ rows: vals.length + 1, cols: 2, headerRows: 1, cells: [{ r: 0, c: 0, colSpan: 1, rowSpan: 1, text: "A" }, { r: 0, c: 1, colSpan: 1, rowSpan: 1, text: "B" }, ...vals.flatMap((v, i) => [{ r: i + 1, c: 0, colSpan: 1, rowSpan: 1, text: `r${i}` }, { r: i + 1, c: 1, colSpan: 1, rowSpan: 1, text: v }])] });
  const good = mk(["1.0", "2.0", "3.0", "4.0"]);
  const bad = mk(["1.0", "2.O", "3.0", "4.0"]);
  assert.equal(tableNumericValidity(good).share, 1);
  assert.equal(tableNumericValidity(bad).share, 0.75);
  assert.equal(chooseTable(bad, good).chose, "layer");
  assert.equal(chooseTable(good, bad).chose, "fresh");
  assert.equal(chooseTable(good, mk(["1.0", "2.0", "3.0", "4.0", "5.0", "6.0"])).chose, "layer", "more readable cells at equal share wins");
});

test("cellsToReread lists unrepaired and empty numeric cells with a crop box; applyCellOcr accepts numbers and ink glyphs only", () => {
  const rec = parsePageGeometry(ocrPage(), 1);
  const doc = assembleDocument([rec], { numPages: 1, from: 1, to: 1 });
  const t = tableOf(doc);
  const req = cellsToReread(t, { numericCols: t.repairs.numericCols });
  assert.ok(req.some((q) => q.r === 5 && q.c === 4 && q.empty), "the empty Cholera cell");
  for (const q of req) { assert.equal(q.page, 1); assert.equal(q.bbox.length, 4); assert.ok(q.bbox[3] > q.bbox[1]); }
  const applied = applyCellOcr(t, [
    { id: t.id, r: 5, c: 4, text: "O.O1", conf: 0.8, glyph: null },      // digit confusion → 0.01
    { id: t.id, r: 5, c: 4, text: "", conf: 0, glyph: "—" },             // already filled: ignored
    { id: "other", r: 1, c: 1, text: "9.99", conf: 1, glyph: null },      // another table: ignored
  ]);
  assert.deepEqual(applied, [{ r: 5, c: 4, from: "", to: "0.01" }]);
  assert.equal(cell(t, 5, 4).reread, true);
  // A dash from Vision's text is not trusted; the glyph is. A leader run is rejected.
  const t2 = { id: "t2", cols: 3, rows: 2, headerRows: 1, cells: [{ r: 1, c: 0, colSpan: 1, rowSpan: 1, text: "x" }, { r: 1, c: 1, colSpan: 1, rowSpan: 1, text: "" }, { r: 1, c: 2, colSpan: 1, rowSpan: 1, text: "" }] };
  assert.deepEqual(applyCellOcr(t2, [{ r: 1, c: 1, text: "-", conf: 1, glyph: null }, { r: 1, c: 2, text: "....", conf: 1, glyph: "*" }]), [{ r: 1, c: 2, from: "", to: "*" }]);
  const t3 = { id: "t3", cols: 2, rows: 1, headerRows: 0, cells: [{ r: 0, c: 0, colSpan: 1, rowSpan: 1, text: "" }, { r: 0, c: 1, colSpan: 1, rowSpan: 1, text: "" }] };
  assert.deepEqual(applyCellOcr(t3, [{ r: 0, c: 0, text: "|c", conf: 0.855, glyph: "*" }]), [{ r: 0, c: 0, from: "", to: "c" }]);
  assert.equal(t3.cells[1].text, "", "a low-confidence letter still loses to the glyph when it is not sent");
  assert.equal(fitsColumn("1.5", ["0.03", "0.10", "12.84"]), false, "decimal count must match the column");
  assert.equal(fitsColumn("1.50", ["0.03", "0.10", "12.84"]), true);
  assert.equal(fitsColumn("1000.50", ["0.03", "0.10", "12.84"]), false, "too many integer digits");
  const ink = {
    headerRows: 0, cols: 2, rows: 1,
    cells: [
      { r: 0, c: 0, colSpan: 1, rowSpan: 1, text: "5", wbase: 100, wsize: 8, wbox: [10, 93, 20, 102], bbox: [0, 88, 30, 112] },
      { r: 0, c: 1, colSpan: 1, rowSpan: 1, text: "", bbox: [30, 88, 50, 112] },
    ],
  };
  const crops = cellsToReread(ink, { numericCols: [1] });
  const crop = crops[0].bbox;
  assert.ok(crop[1] < 93, `crop top ${crop[1]} covers the row ink`);
  assert.ok(crop[3] > 102, `crop bottom ${crop[3]} covers the row ink`);
  // A wrapped row's ink box is taller than the digit. The x-height band is asked second,
  // and a number already accepted is not replaced by the other crop.
  const wrapped = {
    id: "t3", page: 3, headerRows: 1, cols: 2, rows: 2,
    cells: [
      { r: 1, c: 0, colSpan: 1, rowSpan: 1, text: "Z1-014", wbase: 153.6, wsize: 9.4, wbox: [60, 134.8, 75, 155.7], bbox: [50, 131, 90, 158] },
      { r: 1, c: 1, colSpan: 1, rowSpan: 1, text: "", wbase: 145.2, wsize: 9.4, bbox: [92, 131, 132, 158] },
      { r: 0, c: 1, colSpan: 1, rowSpan: 1, text: "2", header: true },
    ],
  };
  const asks = cellsToReread(wrapped, { numericCols: [1] });
  assert.equal(asks.length, 2);
  assert.ok(asks[0].bbox[3] - asks[0].bbox[1] > asks[1].bbox[3] - asks[1].bbox[1], "wide crop first, x-height band second");
  const kept = applyCellOcr(wrapped, [
    { r: 1, c: 1, text: "1", conf: 1, glyph: null },
    { r: 1, c: 1, text: "", conf: 0, glyph: null },
  ]);
  assert.deepEqual(kept, [{ r: 1, c: 1, from: "", to: "1" }]);
  assert.equal(wrapped.cells.find((k) => k.r === 1 && k.c === 1).text, "1");
});

// ---------------------------------------------------------------- merge

test("mergeOcrDocument takes fresh pages, compares scanLayer tables and records the choice", () => {
  const fresh = assembleDocument([parsePageGeometry(ocrPage(), 1)], { numPages: 1, from: 1, to: 1 });
  // The "layer" base: same table but with a misread column the repair cannot fix.
  const layerRec = parsePageGeometry(ocrPage({ misread: false }), 1);
  const base = assembleDocument([layerRec], { numPages: 1, from: 1, to: 1 });
  base.pages[0].scanLayer = true;
  base.pages[0].ocr = false;
  for (const k of tableOf(base).cells) if (k.c === 2 && k.r > 0 && k.text) k.text = "x";
  const { doc, choices } = mergeOcrDocument(base, fresh, { pages: [1] });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].chose, "fresh");
  assert.equal(tableOf(doc).ocrSource, "fresh");
  assert.equal(doc.pages[0].ocrChoice, "fresh");
  assert.deepEqual(doc.ocr.pages, [1]);
  // The other way round: a fresh table with broken numbers loses to the layer.
  const broken = assembleDocument([parsePageGeometry(ocrPage(), 1)], { numPages: 1, from: 1, to: 1 });
  for (const k of tableOf(broken).cells) if (k.c === 1 && k.r > 0 && k.text) { k.text = "zz"; }
  const plain = assembleDocument([parsePageGeometry(ocrPage({ misread: false }), 1)], { numPages: 1, from: 1, to: 1 });
  plain.pages[0].scanLayer = false;
  const back = mergeOcrDocument(plain, broken, { pages: [1] });
  assert.equal(back.choices.length, 0, "a page that was not scanLayer is simply fresh");
  const layered = assembleDocument([parsePageGeometry(ocrPage({ misread: false }), 1)], { numPages: 1, from: 1, to: 1 });
  layered.pages[0].scanLayer = true;
  const again = mergeOcrDocument(layered, broken, { pages: [1] });
  assert.equal(again.choices[0].chose, "layer");
  assert.equal(tableOf(again.doc).ocrSource, "layer");
  assert.equal(tableOf(again.doc).id, tableOf(broken).id, "keeps the fresh id");
});

test("scanPagesOf lists image-only and old-layer pages that were not read yet", () => {
  const doc = { pages: [{ n: 1, kind: "text" }, { n: 2, kind: "scan" }, { n: 3, kind: "mixed", scanLayer: true }, { n: 4, kind: "mixed", scanLayer: true, ocr: true }] };
  assert.deepEqual(scanPagesOf(doc), [2, 3]);
});

// ---------------------------------------------------------------- client

test("helper client ocr(): one POST /v1/ocr with the PDF bytes and X-Pxd-Options", async () => {
  const calls = [];
  const pages = { schema: "pxd-ocr/1", pageCount: 1, pages: [ocrPage()], cached: false, elapsedMs: 5 };
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const opts = JSON.parse(init.headers["X-Pxd-Options"]);
    const body = opts.cells ? { cells: opts.cells.map((c) => ({ page: c.page, bbox: c.bbox, text: "0.01", conf: 1, glyph: null })) } : pages;
    return { status: 200, async json() { return body; } };
  };
  const client = createHelperClient({ fetch, settings: { "parse-helper-token": "tok" } });
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const got = await client.ocr({ bytes, sha256: "abc", pages: [1] });
  assert.equal(calls[0].url, "http://127.0.0.1:48765/v1/ocr");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.headers["Content-Type"], "application/pdf");
  assert.deepEqual(JSON.parse(calls[0].init.headers["X-Pxd-Options"]), { pages: [1] });
  assert.equal(calls[0].init.targetAddressSpace, "loopback");
  assert.equal(got.pages.length, 1);
  assert.equal(got.sha256, "abc");
  const cells = await client.ocr({ bytes, sha256: "abc", cells: [{ page: 1, bbox: [1, 2, 3, 4], id: "t1", r: 2, c: 3 }] });
  assert.deepEqual(JSON.parse(calls[1].init.headers["X-Pxd-Options"]), { cells: [{ page: 1, bbox: [1, 2, 3, 4] }] });
  assert.equal(cells.cells[0].r, 2, "caller ids ride back beside the answer");
  assert.equal(cells.cells[0].text, "0.01");
  const failing = createHelperClient({ fetch: async () => ({ status: 500, async json() { return { error: "ocr failed: boom" }; } }), settings: { "parse-helper-token": "tok" } });
  await assert.rejects(() => failing.ocr({ bytes, sha256: "abc", pages: [1] }), /ocr failed: boom/);
});

// ---------------------------------------------------------------- readScan

test("readScan: OCR the scan pages, re-assemble, re-read cells, keep other pages", async () => {
  const textRec = parsePageGeometry({ items: [{ str: "Plain page", transform: [10, 0, 0, 10, 20, 700], width: 50, height: 10, fontName: "f1" }], ops: { fnArray: [], argsArray: [] }, w: 612, h: 792, rotation: 0, fonts: {} }, 1);
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 300, h: 120, rotation: 0, fonts: {} }, 2);
  scanRec.kind = "scan";
  const base = assembleDocument([textRec, scanRec], { numPages: 2, from: 1, to: 2 });
  assert.deepEqual(scanPagesOf(base), [2]);
  const log = [];
  const helper = {
    async ocr({ pages, cells }) {
      log.push(pages ? { pages } : { cells: cells.length });
      if (pages) return { schema: "pxd-ocr/1", pageCount: 2, pages: [ocrPage({ n: 2 })], elapsedMs: 7 };
      return { cells: cells.map((c) => ({ page: c.page, bbox: c.bbox, text: c.r === 5 && c.c === 4 ? "0.02" : "", conf: 1, glyph: null })) };
    },
  };
  const phases = [];
  const out = await readScan({ helper, bytes: new Uint8Array(4), sha256: "s", base, records: [textRec, scanRec], numPages: 2, from: 1, to: 2, onPhase: (p) => phases.push(p.phase) });
  assert.deepEqual(out.pages, [2]);
  assert.deepEqual(phases, ["ocr", "cells"]);
  assert.deepEqual(log[0], { pages: [2] });
  assert.ok(log[1].cells >= 1);
  const t = tableOf(out.doc);
  assert.equal(t.page, 2);
  assert.equal(t.engine, "ocr+builtin");
  assert.equal(cell(t, 5, 4).text, "0.02", "re-read filled the empty cell");
  assert.equal(out.doc.pages[0].ocr, false);
  assert.equal(out.doc.pages[1].ocr, true);
  assert.equal(scanPagesOf(out.doc).length, 0, "nothing left to read");
  assert.ok(out.doc.order.some((id) => out.doc.blocks[id].type === "para" && out.doc.blocks[id].page === 1), "the text page is still there");
  assert.equal(out.doc.ocr.rereads, 1);
  assert.equal(out.doc.options.ocr, "vision");
  assert.equal(out.doc.schema, "pxd-parse/1");
});

test("readScan takes a recorded VLM table when the helper advertises vlm-tables", async () => {
  const recorded = JSON.parse(readFileSync(new URL("./fixtures/vlm-tables.json", import.meta.url), "utf8"));
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 300, h: 120, rotation: 0, fonts: {} }, 2);
  scanRec.kind = "scan";
  const base = assembleDocument([scanRec], { numPages: 2, from: 2, to: 2 });
  let asked = null;
  const helper = {
    vlmTables: true,
    async ocr({ pages, cells }) {
      if (pages) return { schema: "pxd-ocr/1", pageCount: 2, pages: [ocrPage({ n: 2, misread: false })], elapsedMs: 1 };
      return { cells: [] };
    },
    async tables({ tables }) {
      asked = tables;
      const table = structuredClone(recorded.tables[0]);
      table.page = tables[0].page;
      table.bbox = tables[0].bbox;
      return { model: recorded.model, tables: [table] };
    },
  };
  const phases = [];
  const out = await readScan({
    helper, bytes: new Uint8Array([1]), sha256: "s", base, records: [scanRec],
    numPages: 2, from: 2, to: 2, lines: false, onPhase: (p) => phases.push(p.phase),
  });
  assert.ok(asked && asked.length >= 1);
  assert.ok(phases.includes("vlm"));
  const t = tableOf(out.doc);
  assert.equal(t.method, "PaddleOCR-VL-0.9B");
  assert.ok(t.cells.some((c) => c.text === "VLM-MARK"));
  assert.equal(out.doc.ocr.vlm, 1);
});

test("readScan high accuracy calls vlm, keeps the rule table when the reading drops its rows, and does not insert a figure hint", async () => {
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 300, h: 120, rotation: 0, fonts: {} }, 2);
  scanRec.kind = "scan";
  const base = assembleDocument([scanRec], { numPages: 2, from: 2, to: 2 });
  let tablesCalled = false;
  let vlmArgs = null;
  const helper = {
    vlmTables: true,
    vlmHigh: true,
    async ocr({ pages }) {
      if (pages) return { schema: "pxd-ocr/1", pageCount: 2, pages: [ocrPage({ n: 2, misread: false })], elapsedMs: 1 };
      return { cells: [] };
    },
    tables() { tablesCalled = true; throw new Error("must not call tables"); },
    async vlm(req) {
      vlmArgs = req;
      const region = req.tables[0];
      return {
        model: "PaddleOCR-VL-0.9B",
        tables: [{
          page: region.page,
          bbox: region.bbox,
          rows: 1,
          cols: 1,
          cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "qqqqqq", header: false }],
        }],
        figures: [
          { page: 2, bbox: [12, 12, 40, 40], label: "image", score: 0.8 },
          { page: 2, bbox: [50, 12, 80, 40], label: "chart", score: 0.7 },
        ],
        lines: [{ page: 2, bbox: [0, 0, 200, 20], text: "not used" }],
      };
    },
  };
  const out = await readScan({
    helper, bytes: new Uint8Array([1]), sha256: "s", base, records: [scanRec],
    numPages: 2, from: 2, to: 2, lines: false, options: { vlmText: false },
  });
  assert.equal(tablesCalled, false);
  assert.equal(vlmArgs.text, false);
  assert.deepEqual(vlmArgs.numericPages, [2]);
  assert.ok(vlmArgs.tables.length >= 1);
  const t = tableOf(out.doc);
  assert.notEqual(t.method, "PaddleOCR-VL-0.9B");
  assert.notEqual(t.cells[0].text, "qqqqqq");
  assert.ok(t.rows > 1, "the rule grid stays");
  assert.equal(out.doc.ocr.mode, "high");
  assert.equal(out.doc.ocr.vlm, 0);
  assert.equal(out.doc.ocr.vlmLines, 0);
  assert.equal(out.doc.ocr.vlmFigures, 0);
  const hinted = out.doc.order.map((id) => out.doc.blocks[id]).filter((b) => b && b.method === "vlm-layout");
  assert.equal(hinted.length, 0);
  const linked = linkLayoutCaptions(out.doc, [{ page: 2, label: "figure_title", bbox: [0, 0, 10, 10], score: 0.9 }]);
  assert.equal(linked.applied.length, 0);
});

test("readScan high accuracy reads the caption under a page plate", async () => {
  const title = "Dorfstrasse Delgemaelde bon Baul".split(" ");
  const credit = "Nach einer Photographie im Verlage der photographischen Gesellschaft in Berlin".split(" ");
  const items = [
    ...title.map((t, i) => word(t, 40 + i * 48, 168, { width: t.length * 4 })),
    ...credit.map((t, i) => word(t, 20 + i * 36, 184, { width: t.length * 4 })),
  ];
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 400, h: 200, rotation: 0, fonts: {} }, 1);
  scanRec.kind = "scan";
  const base = assembleDocument([scanRec], { numPages: 1 });
  let called = null;
  const helper = {
    vlmHigh: true,
    async ocr({ pages }) {
      if (pages) {
        return {
          schema: "pxd-ocr/1", pageCount: 1, elapsedMs: 1,
          pages: [{ n: 1, w: 400, h: 200, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0, fonts: { ocr: { name: "ocr" } }, items, rules: [], ops: { fnArray: [], argsArray: [] } }],
        };
      }
      return { cells: [] };
    },
    async vlm(req) { called = req; return { tables: [], figures: [], layout: [], lines: [] }; },
  };
  await readScan({
    helper, bytes: new Uint8Array([1]), sha256: "s", base, records: [scanRec],
    numPages: 1, from: 1, to: 1, lines: false,
  });
  assert.ok(called, "a plate with only a bottom caption is read");
  assert.equal(called.text, true);
  assert.deepEqual(called.numericPages, []);
});

test("readScan high accuracy skips a prose page", async () => {
  const items = [];
  const sentence = "The report describes the method and the sample in plain words".split(" ");
  for (let r = 0; r < 8; r++) {
    let x = 30;
    const y = 40 + r * 12;
    for (const piece of sentence) {
      items.push(word(piece, x, y));
      x += piece.length * 4 + 4;
    }
  }
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 400, h: 200, rotation: 0, fonts: {} }, 1);
  scanRec.kind = "scan";
  const base = assembleDocument([scanRec], { numPages: 1 });
  let called = false;
  const helper = {
    vlmHigh: true,
    async ocr({ pages }) {
      if (pages) {
        return {
          schema: "pxd-ocr/1", pageCount: 1, elapsedMs: 1,
          pages: [{ n: 1, w: 400, h: 200, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0, fonts: { ocr: { name: "ocr" } }, items, rules: [], ops: { fnArray: [], argsArray: [] } }],
        };
      }
      return { cells: [] };
    },
    async vlm() { called = true; return { tables: [], figures: [], layout: [] }; },
  };
  const out = await readScan({
    helper, bytes: new Uint8Array([1]), sha256: "s", base, records: [scanRec],
    numPages: 1, from: 1, to: 1, lines: false,
  });
  assert.equal(called, false);
  assert.equal(out.doc.ocr.mode, "high");
  assert.equal(out.doc.ocr.vlm, 0);
});

test("readScan high accuracy lays out a labeled column the rules missed", async () => {
  const labels = ["Methane", "Ethane", "Propane", "Butane", "Nitrogen"];
  const values = ["84.7", "9.4", "3.0", "1.3", "1.6"];
  const items = [];
  labels.forEach((label, i) => {
    const y = 80 + i * 14;
    items.push(word(label, 40, y));
    items.push(word(values[i], 180, y));
  });
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 400, h: 500, rotation: 0, fonts: {} }, 1);
  scanRec.kind = "scan";
  const base = assembleDocument([scanRec], { numPages: 1 });
  let called = null;
  const helper = {
    vlmHigh: true,
    async ocr({ pages }) {
      if (pages) {
        return {
          schema: "pxd-ocr/1", pageCount: 1, elapsedMs: 1,
          pages: [{ n: 1, w: 400, h: 500, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0, fonts: { ocr: { name: "ocr" } }, items, rules: [], ops: { fnArray: [], argsArray: [] } }],
        };
      }
      return { cells: [] };
    },
    async vlm(req) { called = req; return { tables: [], figures: [], layout: [] }; },
  };
  const out = await readScan({
    helper, bytes: new Uint8Array([1]), sha256: "s", base, records: [scanRec],
    numPages: 1, from: 1, to: 1, lines: false,
  });
  assert.ok(called, "the page is sent so layout can find the column");
  assert.deepEqual(called.numericPages, []);
  assert.deepEqual(called.pages, [1]);
  assert.equal(out.doc.ocr.mode, "high");
});

test("hintLayoutFigures adds one box on an empty page and skips a page that has a figure", () => {
  const empty = { order: ["p"], blocks: { p: { id: "p", type: "para", page: 2, bbox: [0, 0, 10, 10], text: "x" } } };
  const added = hintLayoutFigures(empty, [
    { page: 2, bbox: [12, 12, 40, 40], label: "image", score: 0.8 },
    { page: 2, bbox: [50, 12, 80, 40], label: "chart", score: 0.7 },
  ]);
  assert.equal(added.applied.length, 1);
  assert.equal(added.doc.blocks[added.applied[0].id].method, "vlm-layout");
  const again = hintLayoutFigures(added.doc, [{ page: 2, bbox: [1, 1, 8, 8], label: "image", score: 0.9 }]);
  assert.equal(again.applied.length, 0);
});

test("alignVlmText rewrites Vision lines inside a region and leaves the boxes", () => {
  const doc = {
    order: ["p", "q"],
    blocks: {
      p: { id: "p", type: "para", page: 1, bbox: [0, 0, 40, 10], text: "old left" },
      q: { id: "q", type: "para", page: 1, bbox: [40, 0, 80, 10], text: "old right" },
    },
  };
  const out = alignVlmText(doc, [{ page: 1, bbox: [0, 0, 80, 12], text: "new left new right words" }]);
  assert.deepEqual(out.doc.blocks.p.bbox, doc.blocks.p.bbox);
  assert.notEqual(out.doc.blocks.p.text, "old left");
  assert.equal(out.applied.length, 2);
  const skipped = alignVlmText(doc, [{ page: 1, bbox: [200, 200, 220, 210], text: "elsewhere" }]);
  assert.equal(skipped.applied.length, 0);
  const tex = alignVlmText(doc, [{ page: 1, bbox: [0, 0, 80, 12], text: "\\(\\int f(x)\\,dx\\) \\phi(x)" }]);
  assert.equal(tex.applied.length, 0);
  assert.equal(tex.doc.blocks.p.text, "old left");
});

test("alignVlmText pours a page transcription in document order and clears the leftover", () => {
  const doc = {
    order: ["late", "early", "out"],
    blocks: {
      late: { id: "late", type: "para", page: 1, bbox: [0, 40, 80, 50], text: "vision late" },
      early: { id: "early", type: "para", page: 1, bbox: [0, 0, 20, 10], text: "vision early" },
      out: { id: "out", type: "para", page: 1, bbox: [200, 0, 220, 10], text: "kept" },
    },
  };
  const out = alignVlmText(doc, [{ page: 1, bbox: [0, 0, 80, 60], text: "one two three", pageText: true }]);
  assert.equal(out.doc.blocks.late.text, "one two");
  assert.equal(out.doc.blocks.early.text, "three");
  assert.equal(out.doc.blocks.out.text, "kept");
  const short = alignVlmText(doc, [{ page: 1, bbox: [0, 0, 80, 60], text: "only", pageText: true }]);
  assert.equal(short.doc.blocks.late.text, "only");
  assert.equal(short.doc.blocks.early.text, "");
});

test("alignVlmText keeps a caption the page slice does not share a word with", () => {
  const doc = {
    order: ["p", "c"],
    blocks: {
      p: { id: "p", type: "para", page: 1, bbox: [0, 0, 40, 10], text: "old title" },
      c: { id: "c", type: "caption", page: 1, bbox: [40, 0, 80, 10], text: "METAL DRAWING MACHINE" },
    },
  };
  const out = alignVlmText(doc, [{ page: 1, bbox: [0, 0, 80, 12], text: "one two three four", pageText: true }]);
  assert.equal(out.doc.blocks.c.text, "METAL DRAWING MACHINE");
  assert.equal(out.doc.blocks.p.text, "one two three four");
  const shared = alignVlmText(doc, [{ page: 1, bbox: [0, 0, 80, 12], text: "notes about metal drawing", pageText: true }]);
  assert.equal(shared.doc.blocks.c.text, "metal drawing");
});

test("readScan keeps the rule table when the VLM text does not match, and does not call tables without the flag", async () => {
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 300, h: 120, rotation: 0, fonts: {} }, 2);
  scanRec.kind = "scan";
  const base = assembleDocument([scanRec], { numPages: 2, from: 2, to: 2 });
  const ocr = async ({ pages, cells }) => {
    if (pages) return { schema: "pxd-ocr/1", pageCount: 2, pages: [ocrPage({ n: 2, misread: false })], elapsedMs: 1 };
    return { cells: (cells || []).map((c) => ({ ...c, text: "", conf: 1, glyph: null })) };
  };
  let calls = 0;
  const rejected = await readScan({
    helper: {
      vlmTables: true,
      ocr,
      async tables({ tables }) {
        calls += 1;
        return {
          model: "PaddleOCR-VL-0.9B",
          tables: [{
            page: tables[0].page,
            bbox: tables[0].bbox,
            rows: 1,
            cols: 1,
            cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "qqqqqq", header: false }],
          }],
        };
      },
    },
    bytes: new Uint8Array([1]), sha256: "s", base, records: [scanRec], numPages: 2, from: 2, to: 2, lines: false,
  });
  assert.equal(calls, 1);
  assert.notEqual(tableOf(rejected.doc).method, "PaddleOCR-VL-0.9B");
  assert.equal(rejected.doc.ocr.vlm, 0);
  let blew = false;
  await readScan({
    helper: { ocr, tables() { blew = true; throw new Error("must not call"); } },
    bytes: new Uint8Array([1]), sha256: "s", base, records: [scanRec], numPages: 2, from: 2, to: 2, lines: false,
  });
  assert.equal(blew, false);
});

test("readScan high accuracy reads a text-layer page with the layout model and does not OCR it", async () => {
  const base = {
    pages: [{ n: 1, kind: "text", ocr: false, scanLayer: false }],
    order: ["p"],
    blocks: { p: { id: "p", type: "para", page: 1, bbox: [40, 100, 400, 200], text: "length meter mass kilogram time second" } },
  };
  let ocrPages = false;
  let vlmPages = null;
  const out = await readScan({
    helper: {
      vlmHigh: true,
      async ocr(req) {
        if (req.pages) { ocrPages = true; throw new Error("must not ocr the text layer"); }
        return { cells: [] };
      },
      async vlm(req) {
        vlmPages = req.pages;
        return {
          model: "vlm",
          tables: [
            {
              page: 1, bbox: [40, 100, 400, 220], rows: 3, cols: 2,
              cells: [
                { r: 0, c: 0, text: "length" }, { r: 0, c: 1, text: "meter" },
                { r: 1, c: 0, text: "mass" }, { r: 1, c: 1, text: "kilogram" },
                { r: 2, c: 0, text: "time" }, { r: 2, c: 1, text: "second" },
              ],
            },
            { page: 1, bbox: [40, 300, 200, 360], rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "hallucinated zebra" }] },
          ],
        };
      },
    },
    base, records: [], lines: false,
  });
  assert.equal(ocrPages, false);
  assert.deepEqual(vlmPages, [1]);
  const tables = out.doc.order.map((id) => out.doc.blocks[id]).filter((b) => b && b.type === "table");
  assert.equal(tables.length, 1);
  assert.equal(tables[0].cells.some((c) => c.text === "length"), true);
  assert.equal(JSON.stringify(tables[0].cells).includes("zebra"), false);
});

test("readScan with nothing to read returns the base untouched", async () => {
  const base = { pages: [{ n: 1, kind: "text" }], order: [], blocks: {} };
  const out = await readScan({ helper: { ocr: async () => { throw new Error("must not call"); } }, base, records: [] });
  assert.equal(out.doc, base);
  assert.deepEqual(out.pages, []);
});

// ---------------------------------------------------------------- view hook

test("formula tokens, thousands marks, group headers and a stub total", () => {
  assert.equal(chemicalSubscripts("Methane (CH4)"), "Methane (CH₄)");
  assert.equal(chemicalSubscripts("Ethane (C2H6)"), "Ethane (C₂H₆)");
  assert.equal(chemicalSubscripts("Nitrogen (N2)"), "Nitrogen (N₂)");
  assert.equal(chemicalSubscripts("CO2."), "CO₂.");
  assert.equal(chemicalSubscripts("N2."), "N₂.");
  assert.equal(chemicalSubscripts("H1"), "H1");
  const gas = {
    rows: 4, cols: 2, headerRows: 0,
    cells: [
      { r: 0, c: 0, colSpan: 1, text: "Methane (CH4)" }, { r: 0, c: 1, colSpan: 1, text: "84.7" },
      { r: 1, c: 0, colSpan: 1, text: "Ethane (C2H6)" }, { r: 1, c: 1, colSpan: 1, text: "9.4" },
      { r: 2, c: 0, colSpan: 1, text: "Nitrogen (N2)" }, { r: 2, c: 1, colSpan: 1, text: "1.6" },
      { r: 3, c: 0, colSpan: 1, text: "100.0" }, { r: 3, c: 1, colSpan: 1, text: "" },
    ],
  };
  polishTableText(gas);
  assert.equal(gas.cells.find((c) => c.r === 0 && c.c === 0).text, "Methane (CH₄)");
  assert.equal(gas.cells.find((c) => c.r === 3 && c.c === 1).text, "100.0");
  assert.equal(gas.cells.find((c) => c.r === 3 && c.c === 0).text, "");
  const slag = {
    rows: 6, cols: 4, headerRows: 2,
    cells: [
      { r: 0, c: 0, rowSpan: 2, colSpan: 1, text: "Temperature, C." },
      { r: 0, c: 1, rowSpan: 1, colSpan: 1, text: "" },
      { r: 0, c: 2, rowSpan: 1, colSpan: 1, text: "Viscosity" },
      { r: 0, c: 3, rowSpan: 1, colSpan: 1, text: "" },
      { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: "22954" },
      { r: 1, c: 2, rowSpan: 1, colSpan: 1, text: "22962" },
      { r: 1, c: 3, rowSpan: 1, colSpan: 1, text: "22968" },
      { r: 2, c: 0, colSpan: 1, text: "1,275." }, { r: 2, c: 1, colSpan: 1, text: "1,400" }, { r: 2, c: 2, colSpan: 1, text: "1.700" }, { r: 2, c: 3, colSpan: 1, text: "2,600" },
      { r: 3, c: 0, colSpan: 1, text: "1,300" }, { r: 3, c: 1, colSpan: 1, text: "1,500" }, { r: 3, c: 2, colSpan: 1, text: "2.000" }, { r: 3, c: 3, colSpan: 1, text: "2,800" },
      { r: 4, c: 0, colSpan: 1, text: "1,400." }, { r: 4, c: 1, colSpan: 1, text: "1,600" }, { r: 4, c: 2, colSpan: 1, text: "2.600" }, { r: 4, c: 3, colSpan: 1, text: "3,000" },
      { r: 5, c: 0, colSpan: 1, text: "1,500" }, { r: 5, c: 1, colSpan: 1, text: "1,800" }, { r: 5, c: 2, colSpan: 1, text: "3.000" }, { r: 5, c: 3, colSpan: 1, text: "3,200" },
    ],
  };
  polishTableText(slag);
  assert.equal(slag.cells.find((c) => c.r === 0 && c.c === 0).text, "Temperature, °C.");
  const visc = slag.cells.find((c) => c.text === "Viscosity");
  assert.equal(visc.c, 1);
  assert.equal(visc.colSpan, 3);
  assert.equal(slag.cells.find((c) => c.r === 2 && c.c === 0).text, "1,275");
  assert.equal(slag.cells.find((c) => c.r === 2 && c.c === 2).text, "1,700");
  const rates = {
    rows: 4, cols: 1, headerRows: 1,
    cells: [
      { r: 0, c: 0, text: "Rate" },
      { r: 1, c: 0, text: "0.10" },
      { r: 2, c: 0, text: "1.50" },
      { r: 3, c: 0, text: "1.700" },
    ],
  };
  polishTableText(rates);
  assert.equal(rates.cells.find((c) => c.r === 3).text, "1.700");
  assert.equal(moveStubTotal({ rows: 2, cols: 2, headerRows: 0, cells: [] }), null);
});

const gridCell = (r, c, text, extra = {}) => ({ r, c, rowSpan: 1, colSpan: 1, text, ...extra });

test("repairTableReading stacks errors, spans a panel, splits a fused row, and unshifts a unit line", () => {
  const stats = {
    rows: 4, cols: 3, headerRows: 1,
    cells: [
      gridCell(0, 1, "(1)"), gridCell(0, 2, "(2)"),
      gridCell(1, 0, "# of MFIs"), gridCell(1, 1, "0.01"), gridCell(1, 2, "-0.08*"),
      gridCell(2, 1, "(0.06)"), gridCell(2, 2, "(0.05)"),
      gridCell(3, 0, "Panel A: Full sample"),
    ],
  };
  repairTableReading(stats);
  assert.equal(stats.rows, 3);
  assert.equal(stats.cells.find((c) => c.r === 1 && c.c === 1).text, "0.01 (0.06)");
  assert.equal(stats.cells.some((c) => c.text === "(0.06)"), false);
  const panel = stats.cells.find((c) => /Panel A/.test(c.text));
  assert.equal(panel.colSpan, 3);
  assert.equal(panel.c, 0);

  const fused = {
    rows: 3, cols: 3, headerRows: 2,
    cells: [
      gridCell(0, 0, "Plat", { rowSpan: 2 }), gridCell(0, 1, "Yields", { colSpan: 2 }),
      gridCell(1, 1, "Shock"), gridCell(1, 2, "Grain"),
      gridCell(2, 0, "Treated. Control."), gridCell(2, 1, "3,254 3,139"), gridCell(2, 2, "1.04"),
    ],
  };
  repairTableReading(fused);
  assert.equal(fused.rows, 4);
  assert.equal(fused.cells.find((c) => c.r === 2 && c.c === 0).text, "Treated");
  assert.equal(fused.cells.find((c) => c.r === 3 && c.c === 0).text, "Control");
  assert.equal(fused.cells.find((c) => c.r === 2 && c.c === 1).text, "3,254");
  assert.equal(fused.cells.find((c) => c.r === 3 && c.c === 1).text, "3,139");
  assert.equal(fused.cells.find((c) => c.r === 2 && c.c === 2).rowSpan, 2);
  const place = {
    rows: 1, cols: 2, headerRows: 0,
    cells: [gridCell(0, 0, "New Mexico."), gridCell(0, 1, "2, 366")],
  };
  repairTableReading(place);
  assert.equal(place.rows, 1);
  assert.equal(place.cells.find((c) => c.c === 0).text, "New Mexico.");

  const gas = {
    rows: 4, cols: 4, headerRows: 0,
    cells: [
      gridCell(0, 0, "City."), gridCell(0, 1, "CO2"), gridCell(0, 2, "CH4"), gridCell(0, 3, "Total."),
      gridCell(1, 0, "Pittsburgh, Pa."), gridCell(1, 1, "Per cent."), gridCell(1, 2, "Per cent."), gridCell(1, 3, "Per cent."),
      gridCell(2, 0, "Louisville, Ky."), gridCell(2, 1, "Trace."), gridCell(2, 2, "79.2"), gridCell(2, 3, "100.00"),
      gridCell(3, 0, "Chelsea, Okla."), gridCell(3, 1, "do."), gridCell(3, 2, "75.4"), gridCell(3, 3, "100.00"),
    ],
  };
  repairTableReading(gas);
  assert.equal(gas.rows, 5);
  assert.equal(gas.headerRows, 2);
  assert.equal(gas.cells.find((c) => c.r === 0 && c.c === 0).rowSpan, 2);
  assert.equal(gas.cells.find((c) => c.r === 1 && c.c === 1).text, "Per cent.");
  assert.equal(gas.cells.find((c) => c.r === 2 && c.c === 0).text, "Pittsburgh, Pa.");
  assert.equal(gas.cells.find((c) => c.r === 2 && c.c === 2).text, "79.2");
  assert.equal(gas.cells.find((c) => c.r === 4 && c.c === 0).text, "Chelsea, Okla.");
  assert.equal(gas.cells.find((c) => c.r === 4 && c.c === 2), undefined);

  const group = {
    rows: 3, cols: 4, headerRows: 2,
    cells: [
      gridCell(0, 0, "Pollutant"),
      gridCell(0, 1, "THRESHOLD FOR RELEASES", { colSpan: 3 }),
      gridCell(1, 1, "to air kg/year"),
      gridCell(1, 2, "to water kg/year"),
      gridCell(1, 3, "to land kg/year"),
      gridCell(2, 0, "Carbon dioxide (CO2)"),
      gridCell(2, 1, "100 million"),
    ],
  };
  repairTableReading(group);
  assert.equal(group.rows, 3);
  assert.equal(group.headerRows, 2);
  assert.equal(group.cells.find((c) => c.r === 0 && c.c === 1).text, "THRESHOLD FOR RELEASES");
  assert.equal(group.cells.find((c) => c.r === 1 && c.c === 1).text, "to air kg/year");

  const wrapped = {
    rows: 3, cols: 2, headerRows: 2,
    cells: [
      gridCell(0, 0, "# of loans"), gridCell(0, 1, "# of loans"),
      gridCell(1, 0, "from MFIs"), gridCell(1, 1, "from others"),
      gridCell(2, 0, "1"), gridCell(2, 1, "2"),
    ],
  };
  repairTableReading(wrapped);
  assert.equal(wrapped.rows, 2);
  assert.equal(wrapped.cells.find((c) => c.r === 0 && c.c === 0).text, "# of loans from MFIs");
  assert.equal(wrapped.cells.find((c) => c.r === 0 && c.c === 1).text, "# of loans from others");
});

test("repairTableReading shifts a section label's values down and blanks a copied leader", () => {
  const section = {
    rows: 3, cols: 4, headerRows: 0,
    cells: [
      gridCell(0, 0, "Total:"), gridCell(0, 1, "2,528"), gridCell(0, 2, "672"), gridCell(0, 3, "1.03", { rowSpan: 2 }),
      gridCell(1, 0, "Treated"), gridCell(1, 1, "2,444"), gridCell(1, 2, "754"),
      gridCell(2, 0, "Control"),
    ],
  };
  repairTableReading(section);
  assert.equal(section.cells.find((c) => c.r === 0 && c.c === 1), undefined);
  assert.equal(section.cells.find((c) => c.r === 1 && c.c === 1).text, "2,528");
  assert.equal(section.cells.find((c) => c.r === 2 && c.c === 1).text, "2,444");
  assert.equal(section.cells.find((c) => c.r === 1 && c.c === 3).rowSpan, 2);
  repairTableReading(section);
  assert.equal(section.cells.find((c) => c.r === 1 && c.c === 1).text, "2,528");

  // The reader also wrote the last stub's empty cells. After the shift those
  // addresses hold the moved values, and the empty cells go.
  const written = {
    rows: 3, cols: 4, headerRows: 0,
    cells: [
      gridCell(0, 0, "Total:"), gridCell(0, 1, "2,528"), gridCell(0, 2, "672"), gridCell(0, 3, "1.03", { rowSpan: 2 }),
      gridCell(1, 0, "Treated"), gridCell(1, 1, "2,444"), gridCell(1, 2, "754"),
      gridCell(2, 0, "Control"), gridCell(2, 1, ""), gridCell(2, 2, ""), gridCell(2, 3, ""),
    ],
  };
  repairTableReading(written);
  assert.equal(written.cells.filter((c) => c.r === 2 && c.c === 1).length, 1);
  assert.equal(written.cells.find((c) => c.r === 2 && c.c === 1).text, "2,444");
  assert.equal(written.cells.find((c) => c.r === 2 && c.c === 2).text, "754");
  assert.equal(written.cells.find((c) => c.r === 2 && c.c === 3), undefined);
  assert.equal(written.cells.find((c) => c.r === 1 && c.c === 3).rowSpan, 2);
  assert.equal(written.cells.length, 8);

  const leaders = {
    rows: 6, cols: 4, headerRows: 1,
    cells: [
      gridCell(0, 0, "Name"), gridCell(0, 1, "A"), gridCell(0, 2, "B"), gridCell(0, 3, "C"),
      gridCell(1, 0, "Tube"), gridCell(1, 1, "0.15"), gridCell(1, 2, "0.158"), gridCell(1, 3, "0.16"),
      gridCell(2, 0, "Stem"), gridCell(2, 1, ".63"), gridCell(2, 2, ".059"), gridCell(2, 3, ".059"),
      gridCell(3, 0, "Bulb"), gridCell(3, 1, ".80"), gridCell(3, 2, ".059"), gridCell(3, 3, ".059"),
      gridCell(4, 0, "Agate"), gridCell(4, 1, "1.27"), gridCell(4, 2, ".059"), gridCell(4, 3, ".059"),
      gridCell(5, 0, "Base"), gridCell(5, 1, ".852"), gridCell(5, 2, ".059"), gridCell(5, 3, ".059"),
    ],
  };
  // A two-column run is not the block. Widen it.
  leaders.cols = 5;
  leaders.cells.push(gridCell(0, 4, "D"), gridCell(1, 4, "9.4"), gridCell(2, 4, ".059"), gridCell(3, 4, ".059"), gridCell(4, 4, ".059"), gridCell(5, 4, "7.2"));
  repairTableReading(leaders);
  assert.equal(leaders.cells.find((c) => c.r === 2 && c.c === 2).text, "");
  assert.equal(leaders.cells.find((c) => c.r === 4 && c.c === 4).text, "");
  assert.equal(leaders.cells.find((c) => c.r === 5 && c.c === 2).text, "");
  assert.equal(leaders.cells.find((c) => c.r === 5 && c.c === 4).text, "7.2");
  assert.equal(leaders.cells.find((c) => c.r === 1 && c.c === 2).text, "0.158");
  assert.equal(leaders.cells.some((c) => c.text === "e7.67" || c.text === "d.64"), false);
});

test("repairTableReading spaces a footnote letter that sits on a number", () => {
  const t = { rows: 1, cols: 2, headerRows: 0, cells: [gridCell(0, 0, "e7.67"), gridCell(0, 1, "d.64")] };
  repairTableReading(t);
  assert.equal(t.cells[0].text, "e 7.67");
  assert.equal(t.cells[1].text, "d .64");
  repairTableReading(t);
  assert.equal(t.cells[0].text, "e 7.67");
});

test("repairTableReading restores a dropped decimal point, a bullet point, and a split date", () => {
  const volume = {
    rows: 4, cols: 2, headerRows: 1,
    cells: [
      gridCell(0, 0, "Volume"), gridCell(0, 1, "Pressure"),
      gridCell(1, 0, "0.4804"), gridCell(1, 1, "841"),
      gridCell(2, 0, "4743"), gridCell(2, 1, "852"),
      gridCell(3, 0, "•575"), gridCell(3, 1, "3. 133"),
    ],
  };
  repairTableReading(volume);
  assert.equal(volume.cells.find((c) => c.r === 2 && c.c === 0).text, ".4743");
  assert.equal(volume.cells.find((c) => c.r === 2 && c.c === 1).text, "852");
  assert.equal(volume.cells.find((c) => c.r === 3 && c.c === 0).text, ".575");
  assert.equal(volume.cells.find((c) => c.r === 3 && c.c === 1).text, "3.133");

  const dates = {
    rows: 4, cols: 3, headerRows: 0,
    cells: [
      gridCell(0, 0, "Conklin"), gridCell(0, 1, "May"), gridCell(0, 2, "2, 1900."),
      gridCell(1, 0, "Creelman"), gridCell(1, 1, "Jan."), gridCell(1, 2, "18, 1911."),
      gridCell(2, 0, "Dixon"), gridCell(2, 1, "May"), gridCell(2, 2, "2, 1900"),
      gridCell(3, 0, "Silkwood"), gridCell(3, 1, "Oct. 23, 1923"), gridCell(3, 2, ""),
    ],
  };
  repairTableReading(dates);
  assert.equal(dates.cols, 2);
  assert.equal(dates.cells.find((c) => c.r === 0 && c.c === 1).text, "May 2, 1900.");
  assert.equal(dates.cells.find((c) => c.r === 3 && c.c === 1).text, "Oct. 23, 1923");
});

test("repairTableReading spans a numbered section line and drops the mark beside it", () => {
  const t = {
    rows: 2, cols: 4, headerRows: 0,
    cells: [
      gridCell(0, 0, "Supercharger Speed - 2,500 r.p.m.", { colSpan: 2 }),
      gridCell(0, 1, "*", { colSpan: 3 }),
      gridCell(1, 0, "Pressure difference, in. of Hg"), gridCell(1, 1, "0"), gridCell(1, 2, "12"), gridCell(1, 3, "15"),
    ],
  };
  repairTableReading(t);
  const banner = t.cells.find((c) => c.r === 0);
  assert.equal(banner.text, "Supercharger Speed - 2,500 r.p.m.");
  assert.equal(banner.colSpan, 4);
  assert.equal(t.cells.filter((c) => c.r === 0).length, 1);
  assert.equal(t.cells.find((c) => c.r === 1 && c.c === 1).text, "0");
});

test("repairTableReading joins a wrapped stub, folds a split factor, and drops a note row", () => {
  const wrap = {
    rows: 6, cols: 5, headerRows: 2,
    cells: [
      gridCell(0, 0, "Source", { rowSpan: 2 }),
      gridCell(0, 1, "Random", { colSpan: 2 }), gridCell(0, 3, "Systematic", { colSpan: 2 }),
      gridCell(1, 1, "Type A"), gridCell(1, 2, "Type B"), gridCell(1, 3, "Type A"), gridCell(1, 4, "Type B"),
      gridCell(2, 0, "Calibration of standard end gauge"), gridCell(2, 4, "25"),
      gridCell(3, 0, "Measured difference between end gauges:"),
      gridCell(4, 0, "repeated observations"), gridCell(4, 1, "5.8"),
      gridCell(5, 0, "random effects of comparator"), gridCell(5, 3, "3.9"),
    ],
  };
  repairTableReading(wrap);
  assert.equal(wrap.rows, 4);
  const joined = wrap.cells.find((c) => c.r === 3 && c.c === 0);
  assert.match(joined.text, /repeated observations/);
  assert.equal(wrap.cells.find((c) => c.r === 3 && c.c === 1).text, "5.8");
  assert.equal(wrap.cells.find((c) => c.r === 3 && c.c === 3).text, "3.9");

  const factors = {
    rows: 5, cols: 4, headerRows: 0,
    cells: [
      gridCell(0, 0, "Factors in boldface are exact", { colSpan: 4 }),
      gridCell(1, 0, "To convert from"), gridCell(1, 1, "to"), gridCell(1, 2, "Multiply by", { colSpan: 2 }),
      gridCell(2, 0, "abampere"), gridCell(2, 1, "ampere (A)"), gridCell(2, 3, "1.0 E+01"),
      gridCell(3, 0, "acre"), gridCell(3, 1, "square meter"), gridCell(3, 2, "4.046"), gridCell(3, 3, "873 E+03"),
      gridCell(4, 0, "bar"), gridCell(4, 1, "pascal"), gridCell(4, 3, "1.0 E+05"),
    ],
  };
  repairTableReading(factors);
  assert.equal(factors.rows, 4);
  assert.equal(factors.cols, 3);
  assert.equal(factors.cells.find((c) => c.r === 0 && c.c === 0).text, "To convert from");
  assert.equal(factors.cells.find((c) => c.r === 1 && c.c === 2).text, "1.0 E+01");
  assert.equal(factors.cells.find((c) => c.r === 2 && c.c === 2).text, "4.046 873 E+03");
});

test("repairTableReading strips a glued index mark and drops the empty header", () => {
  const t = {
    rows: 8, cols: 2, headerRows: 1,
    cells: [
      gridCell(0, 0, "Engler time", { colSpan: 2 }),
      gridCell(1, 0, "56."), gridCell(1, 1, "0.0155"),
      gridCell(2, 0, "58."), gridCell(2, 1, ".0210"),
      gridCell(3, 0, "60."), gridCell(3, 1, ".0260"),
      gridCell(4, 0, "64"), gridCell(4, 1, ".0357"),
      gridCell(5, 0, "66"), gridCell(5, 1, ".0403"),
      gridCell(6, 0, "68-"), gridCell(6, 1, ".0449"),
      gridCell(7, 0, "120- 120"), gridCell(7, 1, ".1453"),
    ],
  };
  repairTableReading(t);
  assert.equal(t.headerRows, 0);
  assert.equal(t.rows, 7);
  assert.equal(t.cells.find((c) => c.r === 0 && c.c === 0).text, "56");
  assert.equal(t.cells.find((c) => c.r === 5 && c.c === 0).text, "68");
  assert.equal(t.cells.find((c) => c.r === 6 && c.c === 0).text, "120");
});

test("repairTableReading blanks a vertical run of one copied decimal and keeps a lone one", () => {
  const t = {
    rows: 6, cols: 3, headerRows: 1,
    cells: [
      gridCell(0, 0, "Name"), gridCell(0, 1, "Value"), gridCell(0, 2, "Tol"),
      gridCell(1, 0, "Tube"), gridCell(1, 1, "0.15"), gridCell(1, 2, "0.003"),
      gridCell(2, 0, "Stem"), gridCell(2, 1, ""), gridCell(2, 2, ".05"),
      gridCell(3, 0, "Bulb"), gridCell(3, 1, ""), gridCell(3, 2, ".05"),
      gridCell(4, 0, "Cup"), gridCell(4, 1, ""), gridCell(4, 2, ".05"),
      gridCell(5, 0, "Base"), gridCell(5, 1, ".852"), gridCell(5, 2, ".05"),
    ],
  };
  repairTableReading(t);
  assert.equal(t.cells.find((c) => c.r === 2 && c.c === 2).text, "");
  assert.equal(t.cells.find((c) => c.r === 4 && c.c === 2).text, "");
  assert.equal(t.cells.find((c) => c.r === 5 && c.c === 2).text, ".05");
  assert.equal(t.cells.find((c) => c.r === 1 && c.c === 2).text, "0.003");
});

test("repairTableReading reads a lone o as 0, a leading l as a point, and the hole in a count", () => {
  const rows = [
    ["1", "12000", ".0498", "~.69~2"],
    ["2", "o", ".239", "i .3784"],
    ["3", "0", ".0526", "2.7210"],
    ["4", "12000", ".240", "i .3802"],
    ["5", "0", ".0563", "2.~505"],
    ["6", "3000", ".0794", "~.8998"],
    ["~", "6000", "l 119", "T.0755"],
    ["8", "9000", ".179", "1.2529"],
  ];
  const t = {
    rows: rows.length, cols: 4, headerRows: 0,
    cells: rows.flatMap((row, r) => row.map((text, c) => gridCell(r, c, text))),
  };
  repairTableReading(t);
  assert.equal(t.cells.find((c) => c.r === 6 && c.c === 0).text, "7");
  assert.equal(t.cells.find((c) => c.r === 1 && c.c === 1).text, "0");
  assert.equal(t.cells.find((c) => c.r === 6 && c.c === 2).text, ".119");
  assert.equal(t.cells.find((c) => c.r === 0 && c.c === 3).text, "~.69~2");
  assert.equal(t.cells.find((c) => c.r === 2 && c.c === 3).text, "2.7210");
});

test("repairTableReading fills the one empty cell of a numbered stub column and drops it from the header", () => {
  const rows = [
    ["Case", "Plant", "References"],
    ["", "K/s", ""],
    ["2", "K(s+1)", "11"],
    ["3", "K/s^2", "12"],
    ["4", "K/s^3", ""],
    ["5", "K", "14"],
  ];
  const t = {
    rows: rows.length, cols: 3, headerRows: 3,
    cells: rows.flatMap((row, r) => row.map((text, c) => gridCell(r, c, text))),
  };
  repairTableReading(t);
  assert.equal(t.cells.find((c) => c.r === 1 && c.c === 0).text, "1");
  assert.equal(t.headerRows, 1);
  // Two holes, or a run with a jump, stay as read.
  const two = { rows: 6, cols: 2, headerRows: 1, cells: [["n", "x"], ["", "a"], ["2", "b"], ["", "c"], ["4", "d"], ["5", "e"]].flatMap((row, r) => row.map((text, c) => gridCell(r, c, text))) };
  repairTableReading(two);
  assert.equal(two.cells.find((c) => c.r === 1 && c.c === 0).text, "");
  const jump = { rows: 6, cols: 2, headerRows: 1, cells: [["n", "x"], ["1", "a"], ["2", "b"], ["", "c"], ["5", "d"], ["6", "e"]].flatMap((row, r) => row.map((text, c) => gridCell(r, c, text))) };
  repairTableReading(jump);
  assert.equal(jump.cells.find((c) => c.r === 3 && c.c === 0).text, "");
});

test("parse view shows Read the scan only for scan pages with a ready helper", async () => {
  const { createParseView } = await import("../src/view/parse-view.js");
  const { createDomStub } = await import("./fixtures/dom-stub.js");
  const stub = createDomStub();
  const docEl = stub.document || stub;
  const helper = { async health() { return { state: "ready", models: {} }; }, async ocr() { return { pages: [] }; } };
  const view = createParseView({ doc: docEl, helper, getPdf: null });
  const root = view.element();
  const btn = root.querySelector(".pxd-parse__scan");
  assert.ok(btn, "button exists");
  assert.equal(btn.hidden, true, "hidden with no parse");
  await view.refreshHelper();
  const parsed = { schema: "pxd-parse/1", engine: "builtin", pageCount: 2, pages: [{ n: 1, kind: "text", parsed: true }, { n: 2, kind: "scan", parsed: true }], order: ["s1"], blocks: { s1: { id: "s1", type: "scan", page: 2, bbox: [0, 0, 10, 10] } }, removed: [], stats: {} };
  view.showDoc(parsed);
  assert.equal(btn.hidden, false, "shown for a scan page with a ready helper");
  assert.equal(btn.textContent, "Read the scan (p. 2)");
  const highHelper = { ...helper, vlmHigh: true };
  const high = createParseView({ doc: docEl, helper: highHelper });
  await high.refreshHelper();
  high.showDoc(parsed);
  assert.equal(high.element().querySelector(".pxd-parse__scan").textContent, "High accuracy (p. 2)");
  view.showDoc({ ...parsed, pages: parsed.pages.map((p) => ({ ...p, ocr: true })) });
  assert.equal(btn.hidden, true, "hidden once read");
  const noHelper = createParseView({ doc: docEl, helper: null });
  noHelper.showDoc(parsed);
  assert.equal(noHelper.element().querySelector(".pxd-parse__scan").hidden, true, "hidden without a helper");
});
