// ECO-4: drawing detection, the ref string, the string-only create, and crop kinds.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAWING_STRING,
  drawingCreateSpec,
  drawingRefModel,
  drawingRefString,
  isDrawingString,
  regionBecomesCrop,
  regionMenuKinds,
} from "../src/model/drawing-card.js";

const BRACKET = "{{[[excalidraw]]}}";
const BARE = "{{excalidraw}}";

test("isDrawingString is true only when the trimmed string starts with a drawing macro", () => {
  assert.equal(DRAWING_STRING, BRACKET);
  assert.equal(isDrawingString(BRACKET), true);
  assert.equal(isDrawingString(BARE), true);
  assert.equal(isDrawingString(`  \n${BRACKET}`), true);
  assert.equal(isDrawingString(`${BRACKET} notes`), true);
  assert.equal(isDrawingString(`\t${BARE}  `), true);
  assert.equal(isDrawingString(`${BARE} caption`), true);
  assert.equal(isDrawingString(`see ${BRACKET}`), false);
  assert.equal(isDrawingString("{{[[diagram]]}}"), false);
  assert.equal(isDrawingString("{{[[excalidraw]]"), false);
  assert.equal(isDrawingString("{{[[Excalidraw]]}}"), false);
  assert.equal(isDrawingString("{{excalidraw"), false);
  assert.equal(isDrawingString(""), false);
  assert.equal(isDrawingString("   "), false);
  assert.equal(isDrawingString(null), false);
  assert.equal(isDrawingString(undefined), false);
  assert.equal(isDrawingString(9), false);
});

test("drawingRefModel is a drawing-ref for a drawing string and needs no API", () => {
  assert.deepEqual(drawingRefModel(BRACKET), { kind: "drawing-ref" });
  assert.deepEqual(drawingRefModel(`  ${BARE} tail`), { kind: "drawing-ref" });
  assert.deepEqual(Object.keys(drawingRefModel(DRAWING_STRING)), ["kind"]);
  assert.equal(drawingRefModel("((ITvT3bqaL))"), null);
  assert.equal(drawingRefModel("{{[[diagram]]}}"), null);
  assert.equal(drawingRefModel(""), null);
  assert.equal(drawingRefModel(null), null);
  assert.equal(drawingRefModel(undefined), null);
});

test("drawingRefString wraps a 1 to 36 char uid and rejects the rest", () => {
  assert.equal(drawingRefString("a"), "((a))");
  assert.equal(drawingRefString("ITvT3bqaL"), "((ITvT3bqaL))");
  assert.equal(drawingRefString("a-b_c"), "((a-b_c))");
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(uuid.length, 36);
  assert.equal(drawingRefString(uuid), `((${uuid}))`);
  assert.equal(drawingRefString(""), null);
  assert.equal(drawingRefString("a".repeat(37)), null);
  assert.equal(drawingRefString(`${uuid}x`), null);
  assert.equal(drawingRefString("bad uid"), null);
  assert.equal(drawingRefString("((abc))"), null);
  assert.equal(drawingRefString("uid.with.dots"), null);
  assert.equal(drawingRefString(null), null);
  assert.equal(drawingRefString(undefined), null);
  assert.equal(drawingRefString(9), null);
});

test("drawingCreateSpec is a string-only create with no props", () => {
  const spec = drawingCreateSpec("boardUid01");
  assert.deepEqual(spec, { parentUid: "boardUid01", order: "last", string: DRAWING_STRING });
  assert.equal(spec.string, BRACKET);
  assert.equal(Object.hasOwn(spec, "props"), false);
  assert.equal("props" in spec, false);
  assert.deepEqual(Object.keys(spec), ["parentUid", "order", "string"]);
});

test("only area, rect, and frame become crop cards", () => {
  assert.deepEqual(regionMenuKinds, ["area", "rect", "frame"]);
  for (const kind of regionMenuKinds) assert.equal(regionBecomesCrop(kind), true);
  for (const kind of ["group", "cframe", "poly", "img", "view", "imgrect", "imgpoly", "Area", "RECT", "", null, undefined]) {
    assert.equal(regionBecomesCrop(kind), false);
  }
});
