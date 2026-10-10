// Generalisation round, tables (pxd15-gen-tables-1): a contents list is one
// table, side-by-side tables stay apart, a value column beside names is a
// table, a reading keeps the page's leading zeros and loses its title row, a
// note spans the rows it sits beside, two readings inside one joined grid
// replace it, a matrix is a formula, and a wrapped head does not cost a reading.
import assert from "node:assert/strict";
import test from "node:test";

import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { detectColumns } from "../src/model/parse/xycut.js";
import { makeLine } from "../src/model/parse/lines.js";
import { OP } from "../src/model/parse/rules.js";
import { splitSideBySide } from "../src/model/parse/stream.js";
import { pageToken } from "../src/model/parse/contents.js";
import { applyVlmTables, dropCaptionRow, dropFormulaTables, restoreLeadingZeros, sharedHosts, spanNoteCells } from "../src/model/parse/vlm-tables.js";
import { chooseTableReading } from "../src/model/parse/vlm-arbitrate.js";

const H = 792;
const FONTS = { f1: { name: "Times", fontFamily: "serif" } };
const item = (str, x, top, size, width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, H - top], width, height: size, fontName: "f1", hasEOL: false });
const noOps = () => ({ fnArray: [OP.setFillGray], argsArray: [[0]] });

function page(items) {
  return parsePageGeometry({ items, ops: noOps(), w: 400, h: H, fonts: FONTS }, 1);
}

function tablesOf(doc) {
  return doc.order.map((id) => doc.blocks[id]).filter((b) => b.type === "table");
}

function cellText(table, r, c) {
  return (table.cells.find((k) => k.r === r && k.c === c) || {}).text || "";
}

test("pageToken reads a page number through OCR confusions and leaves a roman numeral", () => {
  assert.equal(pageToken("15"), "15");
  assert.equal(pageToken("I5"), "15");
  assert.equal(pageToken("25-27"), "25-27");
  assert.equal(pageToken("48-a"), "48-a");
  assert.equal(pageToken("II."), null);
  assert.equal(pageToken("Page."), null);
});

test("a contents list with wrapped entries and OCR-broken page numbers is one table", () => {
  // Entries at x 40, page numbers at x 330; two entries wrap onto a second, indented line.
  const items = [
    item("CONTENTS.", 150, 60, 10),
    item("Page.", 330, 80, 8),
    item("EXPLANATION OF TABLES", 40, 100, 9), item("9", 334, 100, 9),
    item("TABLE 1.—Velocity of water in feet per second, based on", 40, 116, 9),
    item("Kutter's formula, coefficient of roughness n=.010", 48, 128, 9), item("I5", 332, 128, 9),
    item("TABLE 2.—Velocity of water in feet per second, based on", 40, 144, 9),
    item("Kutter's formula, coefficient of roughness n=.011", 48, 156, 9), item("18", 332, 156, 9),
    item("TABLE 3.—Velocity of water in feet per second", 40, 172, 9), item("21", 332, 172, 9),
    item("TABLE 4.—Area, wetted perimeter and hydraulic radius", 40, 188, 9), item("24", 332, 188, 9),
    item("TABLE 5.—Multipliers for broad-crested weirs", 40, 204, 9), item("27", 332, 204, 9),
    item("The body of the report begins here with a long sentence of prose that runs on.", 40, 260, 9),
  ];
  const doc = assembleDocument([page(items)], { numPages: 1 });
  const tables = tablesOf(doc);
  assert.equal(tables.length, 1, JSON.stringify(tables.map((t) => `${t.rows}x${t.cols}`)));
  const t = tables[0];
  assert.equal(t.cols, 2);
  assert.equal(t.rows, 7, JSON.stringify(t.cells.map((c) => c.text)));
  assert.equal(t.headerRows, 1);
  assert.equal(cellText(t, 0, 1), "Page.");
  assert.equal(cellText(t, 1, 0), "EXPLANATION OF TABLES");
  assert.equal(cellText(t, 2, 0), "TABLE 1.—Velocity of water in feet per second, based on Kutter's formula, coefficient of roughness n=.010");
  assert.equal(cellText(t, 2, 1), "15");
  assert.equal(cellText(t, 6, 1), "27");
  const texts = doc.order.map((id) => doc.blocks[id].text || "");
  assert.ok(texts.some((s) => s.startsWith("The body of the report")));
  assert.ok(!texts.some((s) => s.includes("Kutter")), "list lines are table cells, not paragraphs");
});

test("two tables printed side by side, joined by their shared baselines, are two tables", () => {
  // Left table rows on even baselines, right table rows on odd ones, a wide gap between.
  const cells = [];
  const words = [];
  const put = (r, c, text) => {
    cells.push({ r, c, rowSpan: 1, colSpan: 1, text, header: r === 0 });
    words.push({ text, x0: 10 + c * 70, x1: 10 + c * 70 + text.length * 5, size: 9 });
  };
  put(0, 0, "Knot"); put(0, 1, "Param"); put(0, 2, "Knot"); put(0, 3, "Param");
  for (let r = 1; r < 12; r++) {
    if (r % 2 === 1) { put(r, 0, `t(5, ${r})`); put(r, 1, `K(2, ${r})`); } else { put(r, 2, `t(11, ${r})`); put(r, 3, `K(4, ${r})`); }
  }
  const table = { method: "stream", rows: 12, cols: 4, headerRows: 1, cells, bbox: [10, 0, 290, 150], grid: { xs: [10, 80, 150, 220, 290], ys: Array.from({ length: 13 }, (_, i) => i * 12) }, usedWords: words, lines: [] };
  const halves = splitSideBySide(table);
  assert.equal(halves.length, 2);
  // The header row is on both sides; six body rows left, five right.
  assert.deepEqual(halves.map((t) => `${t.rows}x${t.cols}`), ["7x2", "6x2"]);
  assert.equal(cellText(halves[1], 0, 0), "Knot");
  assert.equal(cellText(halves[1], 1, 0), "t(11, 2)");
  assert.equal(halves[0].bbox[2], 150);
  assert.equal(halves[1].bbox[0], 150);
});

test("splitSideBySide leaves a wide table whose rows are filled across alone", () => {
  const cells = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) cells.push({ r, c, rowSpan: 1, colSpan: 1, text: `${r}${c}`, header: r === 0 });
  const words = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) words.push({ text: `${r}${c}`, x0: 10 + c * 60, x1: 30 + c * 60, size: 9 });
  const table = { method: "stream", rows: 8, cols: 4, cells, bbox: [0, 0, 240, 100], grid: { xs: [0, 60, 120, 180, 240], ys: [] }, usedWords: words };
  assert.equal(splitSideBySide(table).length, 1);
});

test("a column of dates beside a column of names is not a text column", () => {
  const names = ["Clinton, Patrick,", "Collins, Robert,", "Connor, Shewbridge,", "Croker, Charles Philip,", "Duncan, James Foulis,", "Dwyer, Henry Law,"];
  const dates = ["Dec. 2, 1826.", "June 2, 1824.", "Sept. 23, 1826.", "July 1, 1826.", "Nov. 27, 1837.", "Oct. 28, 1839."];
  const lines = [];
  names.forEach((name, i) => {
    const base = 100 + i * 16;
    lines.push(makeLine([{ text: name, x0: 40, x1: 40 + name.length * 6.5, base, size: 11, mathChars: 0, mathFontChars: 0 }]));
    lines.push(makeLine([{ text: dates[i], x0: 280, x1: 280 + dates[i].length * 6.5, base, size: 11, mathChars: 0, mathFontChars: 0 }]));
  });
  assert.equal(detectColumns(lines, { pageW: 552 }).length, 0);
  // Two prose columns still split.
  const prose = [];
  for (let i = 0; i < 6; i++) {
    const base = 100 + i * 16;
    prose.push(makeLine([{ text: "the quick brown fox jumps over the lazy dog again", x0: 40, x1: 240, base, size: 11, mathChars: 0, mathFontChars: 0 }]));
    prose.push(makeLine([{ text: "and the slow grey wolf walks under the old bridge", x0: 300, x1: 500, base, size: 11, mathChars: 0, mathFontChars: 0 }]));
  }
  assert.equal(detectColumns(prose, { pageW: 552 }).length, 1);
});

test("a reading takes back the leading zero the page prints", () => {
  const table = { rows: 2, cols: 2, cells: [
    { r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "Aug", header: false },
    { r: 0, c: 1, rowSpan: 1, colSpan: 1, text: ".3", header: false },
    { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: "Sep", header: false },
    { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: "-.1", header: false },
  ] };
  restoreLeadingZeros(table, [{ text: "0.3" }, { text: "-0.1" }, { text: "Aug" }]);
  assert.equal(table.cells[1].text, "0.3");
  assert.equal(table.cells[3].text, "-0.1");
  // A page that prints ".0219" keeps it.
  const factor = { rows: 1, cols: 1, cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: ".0219", header: false }] };
  restoreLeadingZeros(factor, [{ text: ".0219" }]);
  assert.equal(factor.cells[0].text, ".0219");
});

test("a title read into the first row of a crop is dropped when its words sit above the table", () => {
  const cells = [{ r: 0, c: 0, rowSpan: 1, colSpan: 3, text: "2.3 Employment 1)", header: false }];
  const body = [["", "Total", "Employees"], ["2020", "100.0", "85.9"], ["2021", "100.0", "86.1"]];
  body.forEach((row, i) => row.forEach((text, c) => cells.push({ r: i + 1, c, rowSpan: 1, colSpan: 1, text, header: false })));
  const table = { rows: 4, cols: 3, headerRows: 0, bbox: [50, 160, 540, 300], cells };
  const words = [
    { text: "2.3", base: 150, size: 9 }, { text: "Employment", base: 150, size: 9 }, { text: "1)", base: 150, size: 9 },
    { text: "Total", base: 175, size: 8 }, { text: "Employees", base: 175, size: 8 }, { text: "2020", base: 200, size: 8 },
  ];
  const trimmed = dropCaptionRow(table, words);
  assert.equal(trimmed.rows, 3);
  assert.equal(cellText(trimmed, 0, 1), "Total");
  // The same first row when those words are inside the box stays.
  const inside = words.map((w) => ({ ...w, base: 200 }));
  assert.equal(dropCaptionRow(table, inside).rows, 4);
});

test("a note beside several rows spans those rows and the empty columns to its right", () => {
  const rows = [
    ["Country", "Production", "Shut-ins", "Forecast", "Forecast"],
    ["Kuwait", "2,560", "1,466", "", ""],
    ["UAE", "3,600", "740", "We only forecast an aggregate value for the seven countries", ""],
    ["Iran", "3,390", "424", "", ""],
    ["Iraq", "4,400", "2,646", "", ""],
    ["Total", "13,950", "5,276", "4,500", "3,100"],
  ];
  const cells = [];
  rows.forEach((row, r) => row.forEach((text, c) => cells.push({ r, c, rowSpan: 1, colSpan: 1, text, header: r === 0 })));
  const table = spanNoteCells({ rows: 6, cols: 5, headerRows: 1, cells });
  const note = table.cells.find((k) => k.text.startsWith("We only"));
  assert.equal(note.rowSpan, 3);
  assert.equal(note.colSpan, 2);
  assert.equal(table.cells.filter((k) => k.r >= 2 && k.r <= 4 && k.c >= 3).length, 1);
  assert.equal(cellText(table, 5, 3), "4,500");
});

test("two readings side by side inside one joined rule table replace it with two tables", () => {
  const joined = { id: "t1", type: "table", page: 1, bbox: [100, 100, 400, 400], rows: 10, cols: 4, headerRows: 1, cells: [], method: "stream", engine: "builtin" };
  const doc = { order: ["t1"], blocks: { t1: joined } };
  const read = (bbox, label) => ({ page: 1, bbox, rows: 3, cols: 2, cells: [
    { r: 0, c: 0, text: "Knot", header: true }, { r: 0, c: 1, text: "Parametrization", header: true },
    { r: 1, c: 0, text: `t(${label}, 1)` }, { r: 1, c: 1, text: "K(1, 1, 1, 1)" },
    { r: 2, c: 0, text: `t(${label}, 2)` }, { r: 2, c: 1, text: "K(2, 2, 2, 2)" },
  ] });
  const structures = [read([100, 100, 240, 400], "5"), read([260, 100, 400, 400], "11")];
  assert.equal(sharedHosts(doc, structures).size, 2);
  const out = applyVlmTables(doc, structures, { method: "vlm", arbitrate: true, evidence: [{ page: 1, words: [], rules: [] }] });
  const tables = out.doc.order.map((id) => out.doc.blocks[id]).filter((b) => b.type === "table");
  assert.equal(tables.length, 2);
  assert.ok(!out.doc.blocks.t1);
  assert.deepEqual(out.applied.map((a) => a.split), ["t1", "t1"]);
});

test("a stream table under a display-formula box on a text page becomes a formula", () => {
  const table = { id: "t1", type: "table", page: 1, method: "stream", bbox: [109, 391, 418, 460], rows: 2, cols: 3, cells: [
    { r: 0, c: 0, text: "Ω(tα) =" }, { r: 0, c: 1, text: "1 0" }, { r: 0, c: 2, text: "," },
    { r: 1, c: 1, text: "1 1" },
  ] };
  const doc = { order: ["t1"], blocks: { t1: table } };
  const layout = [{ page: 1, label: "display_formula", score: 0.94, bbox: [180, 403, 421, 433] }];
  const out = dropFormulaTables(doc, layout, [1]);
  assert.equal(out.applied.length, 1);
  assert.equal(out.doc.blocks.t1.type, "formula");
  assert.equal(out.doc.blocks.t1.text, "Ω(tα) = 1 0 , 1 1");
  // A layout table box over it keeps the table; an OCR page is not touched.
  assert.equal(dropFormulaTables(doc, [...layout, { page: 1, label: "table", score: 0.9, bbox: [109, 391, 418, 460] }], [1]).applied.length, 0);
  assert.equal(dropFormulaTables(doc, layout, [2]).applied.length, 0);
});

test("a column head wrapped over four short lines does not cost the reading its row coverage", () => {
  const words = [];
  const line = (text, x, base) => words.push({ text, x0: x, x1: x + text.length * 5, base, size: 8, y0: base - 8, y1: base });
  ["CPIH", "Index (UK,", "2015 =", "100)"].forEach((t, i) => line(t, 120, 20 + i * 10));
  ["CPI", "Index"].forEach((t, i) => line(t, 200, 20 + i * 10));
  const body = [["2025", "138.9", "139.3"], ["Aug", "138.9", "139.3"], ["Sep", "139.5", "139.8"], ["Oct", "139.4", "139.5"], ["Nov", "139.9", "140.1"]];
  body.forEach((row, r) => row.forEach((t, c) => line(t, 40 + c * 80, 70 + r * 10)));
  const vlm = { rows: 6, cols: 3, headerRows: 1, bbox: [30, 10, 300, 130], cells: [] };
  [["", "CPIH Index (UK, 2015 = 100)", "CPI Index"], ...body].forEach((row, r) => row.forEach((t, c) => vlm.cells.push({ r, c, rowSpan: 1, colSpan: 1, text: t, header: r === 0 })));
  const rule = { rows: 5, cols: 3, headerRows: 0, bbox: [30, 60, 300, 130], cells: [] };
  body.forEach((row, r) => row.forEach((t, c) => rule.cells.push({ r, c, rowSpan: 1, colSpan: 1, text: t, header: false })));
  const decision = chooseTableReading(rule, vlm, { words, rules: [] });
  assert.ok(decision.scores.vlm.rowCov >= decision.scores.rule.rowCov, JSON.stringify(decision.scores));
  assert.equal(decision.choice, "vlm");
});

test("a range cut at its dash goes back onto its number and the spare column is dropped", async () => {
  const { foldSplitRanges, dropLeaderColumn } = await import("../src/model/parse/ocr-fix.js");
  const cells = [];
  const rows = [["Aether", "0,724", "-0,728", "0,728"], ["Acidum", "1,041—1,045", null, "1,042"], ["Alcohol", "0,892-", "-0,896", "0,894"], ["Aqua", "1,000", "", "1,000"]];
  rows.forEach((row, r) => {
    cells.push({ r, c: 0, rowSpan: 1, colSpan: 1, text: row[0], header: false });
    if (row[2] === null) cells.push({ r, c: 1, rowSpan: 1, colSpan: 2, text: row[1], header: false });
    else { cells.push({ r, c: 1, rowSpan: 1, colSpan: 1, text: row[1], header: false }); cells.push({ r, c: 2, rowSpan: 1, colSpan: 1, text: row[2], header: false }); }
    cells.push({ r, c: 3, rowSpan: 1, colSpan: 1, text: row[3], header: false });
  });
  const table = { method: "stream", rows: 4, cols: 4, headerRows: 0, cells, grid: { xs: [0, 60, 100, 130, 170], ys: [] } };
  foldSplitRanges(table);
  assert.equal(cells.find((k) => k.r === 0 && k.c === 1).text, "0,724-0,728");
  assert.equal(cells.find((k) => k.r === 2 && k.c === 1).text, "0,892-0,896");
  dropLeaderColumn(table);
  assert.equal(table.cols, 3);
  assert.equal(cells.find((k) => k.r === 1 && k.c === 1).colSpan, 1);
});
