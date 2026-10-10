import assert from "node:assert/strict";
import test from "node:test";

import { alignedNumericColumns, isNumericToken } from "../src/model/parse/vlm-boxes.js";
import { oracleTableBoxes } from "../tools/parse-bench/scan-corpus.mjs";

function col(x, ys, text = "1.0", width = 12) {
  return ys.map((y) => ({ text, x0: x, y0: y, x1: x + width, y1: y + 8 }));
}

test("aligned numeric columns match the helper's rule", () => {
  const rows = [20, 36, 52, 68, 84];
  assert.equal(alignedNumericColumns([...col(40, rows), ...col(90, rows, "2.5")]), true);
  assert.equal(alignedNumericColumns(col(40, rows)), false);
  assert.equal(alignedNumericColumns([
    { text: "The", x0: 20, y0: 20, x1: 40, y1: 28 },
    { text: "yield", x0: 44, y0: 20, x1: 70, y1: 28 },
    { text: "1913", x0: 20, y0: 40, x1: 40, y1: 48 },
  ]), false);
  assert.equal(isNumericToken("0.D0"), false);
  assert.equal(isNumericToken(".98"), true);
  assert.equal(isNumericToken("1,234.5"), true);
});

test("oracle table boxes are the LlamaParse table regions", () => {
  const boxes = oracleTableBoxes({
    blocks: {
      a: { type: "table", bbox: [1, 2, 3, 4] },
      b: { type: "para", bbox: [0, 0, 1, 1] },
      c: { type: "table" },
    },
  }, 5);
  assert.deepEqual(boxes, [{ page: 5, bbox: [1, 2, 3, 4] }]);
});
