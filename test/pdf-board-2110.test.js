// PDF-1: a pdf macro and a ref to one are kind pdf on the board.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard } from "../src/model/board.js";

const MACRO = "{{[[pdf]]: https://example.test/papers/Risk%20model.pdf}}";

const blk = (uid, string, order) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": { ":plexus": { ":x": order * 40, ":y": 0 } },
  ":block/children": [],
});

test("buildBoard marks a pdf macro as kind pdf and a ref to one as that block", () => {
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      blk("pdfcard01", MACRO, 0),
      blk("refcard01", "((pdfblock1))", 1),
    ],
  }, {
    resolve(uid) {
      return uid === "pdfblock1" ? MACRO : "a note";
    },
  });
  const direct = board.items.get("pdfcard01");
  assert.equal(direct.kind, "pdf");
  assert.equal(direct.target.kind, "self");
  assert.equal(direct.target.uid, "pdfcard01");
  const ref = board.items.get("refcard01");
  assert.equal(ref.kind, "pdf");
  assert.equal(ref.title, "PDF");
  assert.equal(ref.target.kind, "block");
  assert.equal(ref.target.uid, "pdfblock1");
});
