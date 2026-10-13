import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard } from "../src/model/board.js";
import { mountTable } from "../src/view/table-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("the table view builds 200 rows at a time and Show more adds the next 200", () => {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const raw = {
      ":block/uid": "tb0000001",
      ":block/string": "{{[[diagram]]:T}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": Array.from({ length: 700 }, (_, i) => ({
        ":block/uid": `r${String(i).padStart(6, "0")}`,
        ":block/string": `Row ${i}`,
        ":block/order": i,
        ":block/props": { ":plexus": { ":x": i * 10, ":y": 0, ":w": 200, ":h": 100 } },
        ":block/children": [{ ":block/uid": `a${String(i).padStart(6, "0")}`, ":block/string": `Status:: open ${i}`, ":block/order": 0 }],
      })),
    };
    const board = buildBoard(raw);
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    const table = mountTable({ doc: stub.document, root, host: { q: () => [], blockString: () => "" }, getBoard: () => board });
    table.open();
    const rows = () => root.querySelectorAll(".pxd-table__row").length;
    assert.equal(rows(), 200);
    const more = root.querySelector(".pxd-table__more-btn");
    assert.ok(more, "a Show more button");
    more.dispatchEvent({ type: "click", bubbles: true, target: more, stopPropagation() {}, preventDefault() {} });
    assert.equal(rows(), 400);
    table.dispose?.();
  } finally {
    restore();
  }
});
