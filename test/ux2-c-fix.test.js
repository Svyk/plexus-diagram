// Lane C fix round. A word-sized pin lands on the parsed part that contains it.
import assert from "node:assert/strict";
import test from "node:test";

import { matchParsedBlock, pageFracFromBbox } from "../src/model/pdf-pin.js";

function figureDoc() {
  const page = { n: 3, w: 100, h: 200, rotation: 0 };
  const figure = { id: "f1", type: "figure", page: 3, bbox: [10, 20, 60, 80] };
  const text = { id: "p1", type: "para", page: 3, bbox: [10, 90, 90, 120], text: "Osmotic water flow" };
  const section = { id: "s1", type: "section", page: 3, bbox: [0, 70, 100, 150] };
  const table = { id: "t1", type: "table", page: 3, bbox: [10, 130, 90, 180] };
  return {
    page,
    figure,
    text,
    doc: { blocks: { f1: figure, s1: section, p1: text, t1: table }, order: ["s1", "f1", "p1", "t1"], pages: [page] },
  };
}

test("a word-sized hit matches the tightest block that holds its centre", () => {
  const { doc, page, text } = figureDoc();
  const para = pageFracFromBbox(text.bbox, page);
  const word = [para[0] + 0.2, para[1] + 0.04, 0.08, 0.03];
  assert.equal(matchParsedBlock(doc, { page: 3, frac: word }).id, "p1");
  assert.equal(matchParsedBlock(doc, { page: 3, frac: [0.01, 0.01, 0.04, 0.02] }), null);
  const speck = [0.2, 0.2, 0.05, 0.04];
  assert.equal(matchParsedBlock(doc, { page: 3, frac: speck }).id, "f1");
});

test("a similar box still wins on IoU, and a mostly covered smaller block still matches", () => {
  const { doc, page, text } = figureDoc();
  const para = pageFracFromBbox(text.bbox, page);
  const formula = { id: "q0", type: "formula", page: 3, bbox: [46, 100, 54, 110] };
  const nested = {
    ...doc,
    blocks: { ...doc.blocks, q0: formula },
    order: [...doc.order, "q0"],
  };
  const near = [para[0] + 0.02, para[1] + 0.01, para[2] - 0.04, para[3] - 0.02];
  assert.equal(matchParsedBlock(nested, { page: 3, frac: near }).id, "p1");
  const small = { id: "q1", type: "formula", page: 4, bbox: [30, 30, 42, 42] };
  const page4 = { n: 4, w: 100, h: 100, rotation: 0 };
  const quiet = {
    blocks: { ...doc.blocks, q1: small, corner: { id: "corner", type: "para", page: 4, bbox: [2, 2, 8, 8] } },
    order: [...doc.order, "q1", "corner"],
    pages: [...doc.pages, page4],
  };
  // Hit is larger than the formula, covers most of it, and its centre sits outside the formula.
  assert.equal(matchParsedBlock(quiet, { page: 4, frac: [0.18, 0.30, 0.20, 0.12] }).id, "q1");
  assert.equal(matchParsedBlock(quiet, { page: 4, frac: [0, 0, 1, 1] }), null);
});
