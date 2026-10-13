// The chrome's listener purge must not strip listeners from an element that is still being built (the color
// picker is built detached and appended after its builder returns).
import assert from "node:assert/strict";
import test from "node:test";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createChrome } from "../src/view/chrome.js";

test("every color-picker swatch fires on all 40 context-bar rebuilds", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    const picked = [];
    const chrome = createChrome({ doc: stub.document, root, settings: {}, timers: { later: () => () => {}, frame: () => () => {} }, on: { setColor: (c) => picked.push(c) } });
    const rect = { x: 10, y: 10, width: 100, height: 50, left: 10, top: 10, right: 110, bottom: 60 };
    const click = (node) => (node.click ? node.click() : node.dispatchEvent({ type: "click", preventDefault() {}, stopPropagation() {} }));
    for (let n = 0; n < 40; n += 1) {
      chrome.ctx.show("card", { kind: "note" }, () => ({ kind: "items", rect }));
      click(root.querySelector(".pxd-ctx__color"));
      const swatches = root.querySelectorAll(".pxd-picker .pxd-swatch, .pxd-picker button");
      assert.ok(swatches.length > 0, `round ${n}: picker open`);
      const before = picked.length;
      for (const swatch of swatches) click(swatch);
      assert.equal(picked.length - before, swatches.length, `round ${n}: ${picked.length - before} of ${swatches.length} swatches fired`);
    }
    chrome.dispose();
  } finally {
    restore();
  }
});
