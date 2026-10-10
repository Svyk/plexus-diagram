import assert from "node:assert/strict";
import test from "node:test";

import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { applyVlmTables } from "../src/model/parse/vlm-tables.js";
import { chooseTableReading } from "../src/model/parse/vlm-arbitrate.js";
import { takeArgs, vlmHelper } from "../tools/parse-bench/scan.mjs";

function grid(labels, { cols = null, headerRows = 1, bbox = null } = {}) {
  const width = cols || labels[0].length;
  const cells = [];
  labels.forEach((row, r) => {
    for (let c = 0; c < width; c += 1) {
      cells.push({
        r, c, rowSpan: 1, colSpan: 1, text: row[c] || "", header: r < headerRows,
      });
    }
  });
  return {
    rows: labels.length,
    cols: width,
    headerRows,
    bbox: bbox || [0, 0, 40 * width, 12 + labels.length * 10],
    cells,
  };
}

function evidence(labels) {
  const words = [];
  labels.forEach((row, r) => {
    row.forEach((text, c) => {
      if (!text) return;
      words.push({
        text, x0: 8 + c * 40, x1: 36 + c * 40, base: 16 + r * 10, size: 8,
        y0: 10 + r * 10, y1: 18 + r * 10,
      });
    });
  });
  return { words, rules: [] };
}

const TEN = [
  ["Disease", "1980"],
  ["Amebiasis", "2.38"],
  ["Anthrax", "0.00"],
  ["Cholera", "0.01"],
  ["Malaria", "0.91"],
  ["Measles", "11.20"],
  ["Mumps", "3.86"],
  ["Plague", "0.02"],
  ["Rabies", "0.04"],
  ["Tetanus", "0.06"],
];

test("arbitration keeps the rule table when the VLM drops rows", () => {
  const rule = grid(TEN);
  const vlm = grid(TEN.slice(0, 6), { bbox: rule.bbox });
  const decision = chooseTableReading(rule, vlm, evidence(TEN));
  assert.equal(decision.choice, "rule");
  assert.ok(decision.scores.rule.total > decision.scores.vlm.total + 0.06);
});

test("arbitration takes the VLM table when the rule grid drops rows", () => {
  const vlm = grid(TEN);
  const rule = grid(TEN.slice(0, 3));
  const decision = chooseTableReading(rule, vlm, evidence(TEN));
  assert.equal(decision.choice, "vlm");
  assert.ok(decision.scores.vlm.rowCov > decision.scores.rule.rowCov);
});

test("a near tie keeps the rule table", () => {
  const rule = grid(TEN);
  const vlm = grid(TEN.map((row) => [row[0], row[1] === "1980" ? "1980" : row[1]]), { bbox: rule.bbox });
  const decision = chooseTableReading(rule, vlm, evidence(TEN));
  assert.equal(decision.choice, "rule");
});

test("arbitration prefers the column count the vertical rules support", () => {
  const labels = TEN.map((row) => [row[0], row[1], "", "", ""]);
  const rule = grid(labels, { cols: 5, headerRows: 1 });
  const vlm = grid(TEN, { bbox: rule.bbox });
  const page = evidence(TEN);
  page.rules = [0, 40, 80].map((x) => ({ axis: "v", x0: x, x1: x, y0: 0, y1: 120 }));
  const decision = chooseTableReading(rule, vlm, page);
  assert.equal(decision.choice, "vlm");
  assert.ok(decision.scores.vlm.colFit > decision.scores.rule.colFit);
});

test("a cell that fuses two text lines loses to the split reading", () => {
  const data = [
    ["Length", "Pressure"],
    ["Inch", "Foot"],
    ["0.00", "63.6"],
    ["0.04", "68.5"],
  ];
  const vlm = grid(data);
  const rule = grid([
    ["Length", "Pressure"],
    ["Inch 0.00", "Foot 63.6"],
    ["0.04", "68.5"],
  ], { headerRows: 1, bbox: vlm.bbox });
  const decision = chooseTableReading(rule, vlm, evidence(data));
  assert.equal(decision.choice, "vlm");
  assert.ok(decision.scores.vlm.rowCov > decision.scores.rule.rowCov);
});

test("two numbers packed into one cell lose to separate columns", () => {
  const data = [
    ["Name", "Higgins", "Meissner"],
    ["Diameter", "0.15", "0.003"],
    ["Length", "1.00", "0.01"],
    ["Height", "9.25", "0.64"],
  ];
  const vlm = grid(data);
  const rule = grid([
    ["Name", "Higgins"],
    ["Diameter", "0.15 0.003"],
    ["Length", "1.00 0.01"],
    ["Height", "9.25 0.64"],
  ], { headerRows: 1, bbox: vlm.bbox });
  const decision = chooseTableReading(rule, vlm, evidence(data));
  assert.equal(decision.choice, "vlm");
  assert.ok(decision.scores.vlm.single > decision.scores.rule.single);
});

test("a header split into one row per text line loses to the numeric body", () => {
  const data = [
    ["Saybolt", "Redwood", "Saybolt", "Redwood"],
    ["time", "time", "time", "time"],
    ["seconds", "viscosity", "seconds", "viscosity"],
    ["56", "0.0155", "130", "0.1624"],
    ["58", "0.0210", "140", "0.1793"],
    ["60", "0.0260", "150", "0.1956"],
    ["62", "0.0309", "160", "0.2121"],
  ];
  const rule = grid(data, { headerRows: 0 });
  const vlm = grid([
    ["Saybolt Redwood time seconds viscosity", "Redwood", "Saybolt", "viscosity"],
    ["56", "0.0155", "130", "0.1624"],
    ["58", "0.0210", "140", "0.1793"],
    ["60", "0.0260", "150", "0.1956"],
    ["62", "0.0309", "160", "0.2121"],
  ], { headerRows: 1, bbox: rule.bbox });
  const decision = chooseTableReading(rule, vlm, evidence(data));
  assert.equal(decision.choice, "vlm");
  assert.equal(decision.scores.rule.body, 5);
});

test("a same-size grid that leaves body cells empty loses to the filled reading", () => {
  const data = [
    ["Test", "Press", "Sec"],
    ["1", "0", "6.13"],
    ["2", "12000", "20.5"],
    ["3", "0", "6.27"],
    ["4", "12000", "20.7"],
  ];
  const vlm = grid(data, { headerRows: 0 });
  vlm.headerRows = 0;
  vlm.cells.forEach((cell) => { cell.header = false; });
  const rule = grid(data.map((row, r) => (r === 0 ? row : [row[0], "", row[2]])), { headerRows: 1, bbox: vlm.bbox });
  const decision = chooseTableReading(rule, vlm, evidence(data));
  assert.equal(decision.choice, "vlm");
  assert.ok(decision.scores.vlm.filled > decision.scores.rule.filled);
});

test("a short VLM body keeps its header on the rule rows", () => {
  const data = [
    ["Temperature", "poises"],
    ["A1", "1.20"],
    ["A2", "1.40"],
    ["A3", "1.55"],
    ["A4", "1.70"],
    ["A5", "1.90"],
    ["A6", "2.10"],
    ["A7", "2.40"],
  ];
  const full = grid(data);
  const rule = grid(data.slice(1), { headerRows: 0 });
  rule.cells.forEach((cell) => { cell.header = false; });
  rule.headerRows = 0;
  rule.bbox = full.bbox;
  const vlm = {
    rows: 2,
    cols: 2,
    headerRows: 1,
    bbox: full.bbox,
    cells: [
      { r: 0, c: 0, rowSpan: 1, colSpan: 2, text: "Temperature poises", header: true },
      { r: 1, c: 0, rowSpan: 1, colSpan: 1, text: "A1", header: false },
      { r: 1, c: 1, rowSpan: 1, colSpan: 1, text: "1.20", header: false },
    ],
  };
  const decision = chooseTableReading(rule, vlm, evidence(data));
  assert.equal(decision.choice, "merge");
  assert.equal(decision.table.rows, 8);
  assert.equal(decision.table.cells.find((cell) => cell.r === 0).colSpan, 2);
  assert.ok(decision.table.cells.some((cell) => cell.text === "A7"));
  assert.ok(decision.table.cells.some((cell) => cell.text === "Temperature poises"));
});

test("applyVlmTables arbitration does not replace a full grid with a one-cell reading", () => {
  const rule = grid(TEN, { bbox: [10, 10, 200, 120] });
  rule.id = "t1";
  rule.type = "table";
  rule.page = 1;
  const doc = { order: ["t1"], blocks: { t1: rule } };
  const out = applyVlmTables(doc, [{
    page: 1,
    bbox: rule.bbox,
    rows: 1,
    cols: 1,
    cells: [{ r: 0, c: 0, rowSpan: 1, colSpan: 1, text: "qqqqqq", header: false }],
  }], { method: "PaddleOCR-VL-0.9B", arbitrate: true, evidence: [{ page: 1, ...evidence(TEN) }] });
  assert.equal(out.applied.length, 0);
  assert.equal(out.doc.blocks.t1.rows, 10);
  assert.notEqual(out.doc.blocks.t1.method, "PaddleOCR-VL-0.9B");
});

test("sideways margin text is furniture and not a heading or the title", () => {
  const upright = (str, x, base, size = 6) => ({
    str, transform: [size, 0, 0, size, x, base], width: str.length * size * 0.5,
    height: size, y0: base - 0.8 * size, y1: base + 0.22 * size, fontName: "ocr", conf: 1,
  });
  const vertical = (str, x, base, size) => ({
    str, transform: [size, 0, 0, size, x, base], width: 6,
    height: size, y0: base - 0.8 * size, y1: base + 0.22 * size, fontName: "ocr", conf: 1,
  });
  const items = [
    upright("NOTIFIABLE", 180, 14),
    upright("DISEASES", 250, 14),
    upright("Summary", 320, 14),
    upright("Amebiasis", 100, 40),
    upright("2.38", 200, 40),
    vertical("NOTIFIABLE", 581, 280, 62),
    vertical("DISEASES", 581, 340, 49),
  ];
  const rec = parsePageGeometry({
    items, ops: { fnArray: [], argsArray: [] }, w: 597, h: 405, rotation: 0,
    transform: [1, 0, 0, 1, 0, 0], scan: true, rules: [], fonts: {},
  }, 1);
  const doc = assembleDocument([rec], { numPages: 1, options: { ocr: "vision" } });
  const headings = doc.order.map((id) => doc.blocks[id]).filter((block) => block.type === "heading");
  assert.equal(headings.some((block) => block.text === "NOTIFIABLE" || block.text === "DISEASES"), false);
  assert.notEqual(doc.title, "NOTIFIABLE");
  const spun = (doc.removed || []).filter((row) => row.reason === "rotated-margin");
  assert.deepEqual(spun.map((row) => row.text).sort(), ["DISEASES", "NOTIFIABLE"]);
});

test("a text-layer quarter turn in the margin is furniture", () => {
  const rot = (str, x, y, size = 8) => ({
    str, transform: [0, size, -size, 0, x, y], width: str.length * size * 0.5, height: size, fontName: "f1",
  });
  const items = [rot("NOTIFIABLE", 581, 200), rot("DISEASES", 581, 140)];
  const rec = parsePageGeometry({
    items, ops: { fnArray: [], argsArray: [] }, w: 597, h: 405, rotation: 0, fonts: { f1: { name: "Helvetica" } },
  }, 1);
  const doc = assembleDocument([rec], { numPages: 1 });
  assert.equal((doc.removed || []).some((row) => row.reason === "rotated-margin" && row.text === "NOTIFIABLE"), true);
  assert.equal(doc.order.map((id) => doc.blocks[id]).some((block) => block.type === "heading" && block.text === "NOTIFIABLE"), false);
});

test("--vlm is parsed and vlm() posts through the helper client", async () => {
  const args = takeArgs(["page.pdf", "--vlm", "--helper-url", "http://127.0.0.1:48770", "--helper-token", "tok"]);
  assert.equal(args.vlm, true);
  assert.equal(args.helperUrl, "http://127.0.0.1:48770");
  const calls = [];
  const helper = vlmHelper({
    url: "http://127.0.0.1:48770",
    token: "tok",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 200, async json() { return { model: "PaddleOCR-VL-0.9B", tables: [] }; } };
    },
  });
  assert.equal(helper.vlmHigh, true);
  const out = await helper.vlm({ bytes: new Uint8Array([1, 2]), pages: [1], tables: [{ page: 1, bbox: [0, 0, 1, 1] }] });
  assert.equal(out.model, "PaddleOCR-VL-0.9B");
  const posted = calls.find((call) => String(call.url).endsWith("/v1/vlm"));
  assert.ok(posted, "client vlm() posts /v1/vlm");
  assert.equal(posted.init.headers.Authorization, "Bearer tok");
  assert.equal(posted.init.targetAddressSpace, undefined);
});

test("an empty high-accuracy cell takes the rule text the page words contain", () => {
  const data = [
    ["State", "Rate", "Deaths"],
    ["Alabama", "5.25", "239"],
    ["Alaska", "4.39", "12"],
    ["Arizona", "6.10", "80"],
    ["Arkansas", "5.80", "70"],
  ];
  const ruleLabels = data.map((row) => row.map((cell) => (cell === "6.10" || cell === "5.80" ? `•${cell}` : cell)));
  ruleLabels[2][1] = "zzmissing";
  const rule = grid(ruleLabels, { headerRows: 1 });
  const vlm = grid(data.map((row, r) => row.map((cell, c) => ((r === 1 && c === 1) || (r === 2 && c === 1) ? "" : cell))), { headerRows: 1, bbox: rule.bbox });
  const decision = chooseTableReading(rule, vlm, evidence(data));
  assert.equal(decision.choice, "vlm");
  assert.equal(decision.table.cells.find((cell) => cell.r === 1 && cell.c === 1).text, "5.25");
  assert.equal(decision.table.cells.find((cell) => cell.r === 2 && cell.c === 1).text, "");
});
