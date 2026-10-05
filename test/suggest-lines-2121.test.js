import assert from "node:assert/strict";
import test from "node:test";

import { paintSuggest } from "../src/view/suggest-lines.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("two suggestion lines are dotted strokes with no fill", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const svg = stub.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    stub.document.body.append(svg);
    const group = paintSuggest(stub.document, svg, [
      { x1: 0, y1: 0, x2: 10, y2: 10, reason: "Both reference [[Zone 2]]" },
      { x1: 1, y1: 1, x2: 8, y2: 4, reason: "Mentions 'Sanitation' without a link" },
    ]);
    const lines = [...group.querySelectorAll(".pxd-suggest__line")];
    assert.equal(lines.length, 2);
    assert.equal(lines[0].getAttribute("fill"), "none");
    assert.equal(lines[0].getAttribute("stroke-dasharray"), "4 4");
    paintSuggest(stub.document, svg, []);
    assert.equal(group.querySelectorAll(".pxd-suggest__line").length, 0);
  } finally {
    restore();
  }
});
