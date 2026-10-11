// INSTANT-4: a {{[[table]]}} card's thumbnail is drawn from the model's cells at the card's aspect.
import assert from "node:assert/strict";
import test from "node:test";
import { THUMB_MAX, columnWidths, renderTableThumb, tableThumbKey, thumbBox } from "../src/view/table-thumb.js";

function canvasDoc() {
  const calls = [];
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textBaseline: "",
    scale: () => {},
    fillRect: (...a) => calls.push(["fillRect", ...a]),
    fillText: (text, x, y) => calls.push(["fillText", text, Math.round(x), Math.round(y)]),
    measureText: (text) => ({ width: String(text).length * 7 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => calls.push(["stroke"]),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => "data:image/png;base64,QUJD" };
  return { doc: { createElement: () => canvas }, calls, canvas };
}

test("thumbnail box keeps the card aspect and caps the long side", () => {
  assert.deepEqual(thumbBox({ w: 1211, h: 1287 }), { width: Math.round(1211 * (THUMB_MAX / 1287)), height: THUMB_MAX });
  assert.deepEqual(thumbBox({ w: 300, h: 150 }), { width: 300, height: 150 });
  assert.equal(tableThumbKey({ uid: "t1" }, "sig"), "t:t1:sig");
  assert.equal(tableThumbKey({ uid: "t1" }, ""), "");
});

test("columns share the width by their longest text; rows past the box are not drawn", () => {
  const widths = columnWidths([["Name", "A much longer header"], ["x", "y"]], 300);
  assert.equal(Math.round(widths.reduce((a, b) => a + b, 0)), 300);
  assert.ok(widths[1] > widths[0]);
  const { doc, calls, canvas } = canvasDoc();
  const grid = [];
  for (let r = 0; r < 20; r += 1) grid.push([`r${r}`, "a very long cell value that will not fit"]);
  const url = renderTableThumb(doc, grid, { width: 200, height: 100 });
  assert.equal(url, "data:image/png;base64,QUJD");
  assert.equal(canvas.height, 100);
  const texts = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
  assert.ok(texts.includes("r0"));
  assert.ok(!texts.includes("r19"), "a row below the box is skipped");
  assert.ok(texts.some((t) => t.endsWith("…")), "long text is cut");
  assert.equal(renderTableThumb(doc, [], {}), "");
  assert.equal(renderTableThumb({ createElement: () => ({ getContext: () => null }) }, grid, {}), "");
});
