// Handwriting and photographed pages: a name list stays text, a date column stays
// a table, and words claimed by a figure that did not survive come back.
import assert from "node:assert/strict";
import test from "node:test";

import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { proseColumnTable } from "../src/model/parse/stream.js";
import { detectColumns } from "../src/model/parse/xycut.js";
import { makeLine } from "../src/model/parse/lines.js";

function word(str, x, base, conf = 1) {
  const size = 8;
  return {
    str,
    transform: [size, 0, 0, size, x, base],
    width: Math.max(12, str.length * size * 0.5),
    height: size,
    y0: base - 6,
    y1: base + 2,
    fontName: "ocr",
    conf,
  };
}

function page(items, { rules = [], w = 500, h = 700 } = {}) {
  return {
    n: 1, w, h, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0,
    fonts: { ocr: { name: "ocr" } }, items, rules, ops: { fnArray: [], argsArray: [] },
  };
}

function blocks(doc) {
  return doc.order.map((id) => doc.blocks[id]);
}

function textOf(doc) {
  return blocks(doc).filter((b) => b.type === "para" || b.type === "heading").map((b) => b.text).join("\n");
}

test("a two-row column header is not a name roster", () => {
  const header = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) header.push({ r, c, text: "Temper" });
  assert.equal(proseColumnTable({ method: "stream", cells: header }), false);
  const names = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 3; c++) names.push({ r, c, text: "Adams" });
  assert.equal(proseColumnTable({ method: "stream", cells: names }), true);
});

test("an OCR name roster stays text and a date column stays a table", () => {
  const names = [];
  for (let r = 0; r < 8; r++) {
    const y = 40 + r * 16;
    names.push(word("Adams", 40, y), word("Baker", 180, y), word("Clark", 320, y));
  }
  const nameDoc = assembleDocument([parsePageGeometry(page(names), 1)], { numPages: 1 });
  assert.equal(blocks(nameDoc).some((b) => b.type === "table"), false);
  assert.match(textOf(nameDoc), /Adams/);
  assert.match(textOf(nameDoc), /Clark/);

  const dated = [];
  for (let r = 0; r < 8; r++) {
    const y = 40 + r * 16;
    dated.push(word("Adams", 40, y), word("1924", 180, y));
  }
  const dateDoc = assembleDocument([parsePageGeometry(page(dated), 1)], { numPages: 1 });
  assert.equal(blocks(dateDoc).some((b) => b.type === "table"), true);
});

test("handwriting with a few digits stays text when a later read will replace it", () => {
  const items = [];
  for (let r = 0; r < 8; r++) {
    const y = 40 + r * 16;
    items.push(word("12.5", 40, y, 0.2), word("13.0", 140, y, 0.2), word("14.2", 240, y, 0.2));
  }
  const geo = parsePageGeometry(page(items), 1);
  const local = assembleDocument([geo], { numPages: 1 });
  assert.equal(blocks(local).some((b) => b.type === "table"), true);
  const doc = assembleDocument([parsePageGeometry(page(items), 1)], { numPages: 1, options: { releaseHandwriting: true } });
  assert.equal(blocks(doc).some((b) => b.type === "table"), false);
  assert.match(textOf(doc), /12\.5/);
});

test("short name columns are read down the page, a quantity column is not a gutter", () => {
  const line = (text, x, base) => {
    const size = 10;
    const w = text.length * 5;
    return makeLine([{ text, x0: x, x1: x + w, y0: base - 8, y1: base + 2, base, size, width: w }]);
  };
  const left = ["Adams", "Baker", "Clark", "Davis", "Evans", "Foster"].map((t, i) => line(t, 40, 80 + i * 14));
  const right = ["Grant", "Hayes", "Irving", "Jones", "King", "Lewis"].map((t, i) => line(t, 280, 80 + i * 14));
  const gutters = detectColumns([...left, ...right], { pageW: 500 });
  assert.equal(gutters.length, 1);
  const dated = ["1924", "1925", "1926", "1927", "1928", "1929"].map((t, i) => line(t, 280, 80 + i * 14));
  assert.equal(detectColumns([...left, ...dated], { pageW: 500 }).length, 0);
  const crossing = makeLine([
    { text: "label", x0: 40, x1: 80, y0: 200, y1: 210, base: 208, size: 10, width: 40 },
    { text: "0.12", x0: 120, x1: 160, y0: 200, y1: 210, base: 208, size: 10, width: 40 },
    { text: "0.18", x0: 200, x1: 240, y0: 200, y1: 210, base: 208, size: 10, width: 40 },
    { text: "0.20", x0: 280, x1: 320, y0: 200, y1: 210, base: 208, size: 10, width: 40 },
    { text: "0.22", x0: 360, x1: 400, y0: 200, y1: 210, base: 208, size: 10, width: 40 },
    { text: "0.30", x0: 420, x1: 460, y0: 200, y1: 210, base: 208, size: 10, width: 40 },
    { text: "0.40", x0: 480, x1: 520, y0: 200, y1: 210, base: 208, size: 10, width: 40 },
  ]);
  assert.equal(detectColumns([...left, ...right, crossing], { pageW: 560 }).length, 0);
});

test("words claimed by a dropped rule cluster come back as text", () => {
  const rules = [];
  for (let i = 0; i < 10; i++) rules.push({ x0: 40, y0: 40 + i * 36, x1: 360, y1: 40 + i * 36, thick: 0.6 });
  rules.push({ x0: 40, y0: 40, x1: 40, y1: 400, thick: 0.6 });
  rules.push({ x0: 360, y0: 40, x1: 360, y1: 400, thick: 0.6 });
  const items = [];
  const menu = "menu of the day soup fish roast bread wine cheese fruit cream".split(" ");
  for (let r = 0; r < 14; r++) {
    let x = 50;
    for (const w of menu) {
      items.push(word(w, x, 48 + r * 24));
      x += w.length * 4 + 10;
    }
  }
  const doc = assembleDocument([parsePageGeometry(page(items, { rules, w: 420, h: 500 }), 1)], { numPages: 1 });
  assert.match(textOf(doc), /menu/);
  assert.match(textOf(doc), /roast/);
});
