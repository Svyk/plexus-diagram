// WO N (Later list), C4 live follow-up: a composer menu whose rows are all disabled keeps the focus inside it.
import assert from "node:assert/strict";
import test from "node:test";

import { createPopover } from "../src/view/ask-composer.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("C4: the menu focuses its first enabled row, or itself when every row is disabled", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const host = doc.createElement("div");
    const anchor = doc.createElement("button");
    doc.body.append(host, anchor);
    const pop = createPopover(doc, host);
    pop.open({ sections: [{ items: [{ label: "Add last answer", disabled: true, onPick() {} }, { label: "Copy", onPick() {} }] }] }, anchor);
    assert.equal(doc.activeElement?.textContent, "Copy", "the first row that can be picked");
    pop.close({ refocus: false });
    pop.open({ sections: [{ items: [{ label: "Add last answer", disabled: true, onPick() {} }, { label: "Copy", disabled: true, onPick() {} }] }] }, anchor);
    const menu = host.querySelector(".pxd-ask__menu");
    assert.equal(doc.activeElement, menu, "all disabled: the menu itself, so Escape still closes it");
    let prevented = false;
    stub.dispatch(menu.querySelector(".pxd-ask__mitem"), "pointerdown", { preventDefault() { prevented = true; } });
    assert.equal(prevented, true, "a press on a disabled row does not blur the menu");
    pop.close({ refocus: false });
  } finally {
    restore();
  }
});
