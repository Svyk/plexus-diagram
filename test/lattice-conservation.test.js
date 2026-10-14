// Words of a ruled grid that is rejected or skipped flow back into the text pass.
// Synthetic page data only: pdf.js-like text items and legacy path operators.
import test from "node:test";
import assert from "node:assert/strict";

import { OP } from "../src/model/parse/rules.js";
import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";

const H = 792;
const W = 612;
const FONTS = { f1: { name: "Helvetica", fontFamily: "sans-serif" } };
const item = (str, x, y, size = 10) => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, fontName: "f1", hasEOL: false });
const row = (y, cells) => cells.map(([text, x]) => item(text, x, H - y));

function ops(rules) {
  const fnArray = [];
  const argsArray = [];
  for (const [x0, y0, x1, y1] of rules) {
    const thick = 0.8;
    const w = x1 - x0 || thick;
    const h = y1 - y0 || thick;
    fnArray.push(OP.setFillGray, OP.rectangle, OP.fill);
    argsArray.push([0], [x0, H - y1 - (h === thick ? thick : 0), w, h], null);
  }
  return { fnArray, argsArray };
}

function grid(xs, ys) {
  const rules = [];
  for (const y of ys) rules.push([xs[0], y, xs[xs.length - 1], y]);
  for (const x of xs) rules.push([x, ys[0], x, ys[ys.length - 1]]);
  return rules;
}

function docOf(items, rules) {
  const pg = parsePageGeometry({ items, ops: ops(rules), w: W, h: H, fonts: FONTS }, 1);
  return { pg, doc: assembleDocument([pg], { numPages: 1 }) };
}

function strings(v, out) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

function lost(pg, doc) {
  const text = strings([doc.blocks, doc.removed], []).join(" ");
  return pg.words.map((w) => w.text).filter((t) => !text.includes(t));
}

test("a mostly empty ruled grid is not a lattice table and its words are not lost", () => {
  const xs = [60, 180, 300, 420, 540];
  const ys = [100, 118, 136, 154, 172, 190, 208, 226, 244, 262, 280];
  const items = [
    ...row(112, [["Weight", 65], ["Time", 185], ["Mass", 305]]),
    ...row(204, [["12.5", 65], ["13.0", 185], ["12.8", 305], ["13.1", 425], ["12.9", 485]]),
  ];
  const { pg, doc } = docOf(items, grid(xs, ys));
  assert.equal(doc.order.map((id) => doc.blocks[id]).filter((b) => b.type === "table" && b.method === "lattice").length, 0);
  assert.deepEqual(lost(pg, doc), []);
});

test("a titled box is not a table and its words are not lost", () => {
  const xs = [100, 300, 500];
  const ys = [100, 124, 148];
  const rules = [[100, 100, 500, 100], [100, 124, 500, 124], [100, 148, 500, 148], [100, 100, 100, 148], [500, 100, 500, 148], [300, 124, 300, 148]];
  const items = [
    ...row(116, [["Sheet", 105], ["of", 150], ["Notes", 170]]),
    ...row(140, [["Mixer", 105], ["Hopper", 305]]),
  ];
  const { pg, doc } = docOf(items, rules);
  assert.equal(doc.order.map((id) => doc.blocks[id]).filter((b) => b.type === "table").length, 0);
  assert.deepEqual(lost(pg, doc), []);
});

test("a filled grid stays a lattice table", () => {
  const xs = [100, 200, 300];
  const ys = [100, 124, 148];
  const items = [...row(116, [["Name", 105], ["Mass", 205]]), ...row(140, [["Lot", 105], ["12.5", 205]])];
  const { pg, doc } = docOf(items, grid(xs, ys));
  const tables = doc.order.map((id) => doc.blocks[id]).filter((b) => b.type === "table");
  assert.equal(tables.length, 1);
  assert.deepEqual(lost(pg, doc), []);
});
