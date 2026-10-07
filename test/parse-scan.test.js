// Scanned tables: OCR page records through the engine, the numeric post-correction, the
// fresh-vs-layer merge, the cell re-read, the helper client's ocr() call, and the view hook.
import assert from "node:assert/strict";
import test from "node:test";

import { assembleDocument, ocrGraphics, parsePageGeometry } from "../src/model/parse/index.js";
import {
  applyCellOcr, cellsToReread, decimalStyle, fitsColumn, isPlaceholder, numericLike, repairNumber,
  repairNumericColumns, repairOcrTable, repairYearHeader, spanNoteRows, tableNumericValidity, unspanNarrowCells,
} from "../src/model/parse/ocr-fix.js";
import { chooseTable, mergeOcrDocument, scanPagesOf } from "../src/model/parse/ocr-merge.js";
import { createHelperClient } from "../src/host/parse-helper-client.js";
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

test("ocrGraphics turns helper rules into engine rules and one page image", () => {
  const g = ocrGraphics({ rules: [{ x0: 1, y0: 5, x1: 90, y1: 5.4, thick: 0.4 }, { x0: 40, y0: 2, x1: 40.2, y1: 70 }], items: [word("..", 50, 20), word("1.5", 60, 20)] }, 100, 80);
  assert.equal(g.rules[0].axis, "h");
  assert.equal(g.rules[1].axis, "v");
  assert.deepEqual(g.images, [{ x0: 0, y0: 0, x1: 100, y1: 80 }]);
  assert.equal(g.dots.length, 2, "leader dots become dots");
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
    ["l.5", "1.5"], ["I2", "12"], ["|0", "10"], ["Z.5", "2.5"], ["G.1", "6.1"], ["S.5", "5.5"],
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
  assert.equal(fitsColumn("1.5", ["0.03", "0.10", "12.84"]), false, "decimal count must match the column");
  assert.equal(fitsColumn("1.50", ["0.03", "0.10", "12.84"]), true);
  assert.equal(fitsColumn("1000.50", ["0.03", "0.10", "12.84"]), false, "too many integer digits");
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

test("readScan with nothing to read returns the base untouched", async () => {
  const base = { pages: [{ n: 1, kind: "text" }], order: [], blocks: {} };
  const out = await readScan({ helper: { ocr: async () => { throw new Error("must not call"); } }, base, records: [] });
  assert.equal(out.doc, base);
  assert.deepEqual(out.pages, []);
});

// ---------------------------------------------------------------- view hook

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
  view.showDoc({ ...parsed, pages: parsed.pages.map((p) => ({ ...p, ocr: true })) });
  assert.equal(btn.hidden, true, "hidden once read");
  const noHelper = createParseView({ doc: docEl, helper: null });
  noHelper.showDoc(parsed);
  assert.equal(noHelper.element().querySelector(".pxd-parse__scan").hidden, true, "hidden without a helper");
});
