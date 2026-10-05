import assert from "node:assert/strict";
import test from "node:test";

import { closeOpenWhyPopovers, openWhyPopover } from "../src/view/why-pop.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("Enter saves the label and the why, Shift+Enter does not, Esc cancels", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const saved = [];
  const cancelled = [];
  try {
    const handle = openWhyPopover({
      doc: stub.document,
      label: "causes",
      why: "seal",
      onSave: (next) => saved.push(next),
      onCancel: () => cancelled.push(1),
    });
    const pop = handle.el;
    assert.equal(pop.classList.contains("pxd-root"), true);
    assert.notEqual(pop.style.height, "560px");
    const note = pop.querySelector(".pxd-why__note");
    stub.dispatch(note, "keydown", { key: "Enter", shiftKey: true, target: note });
    assert.equal(saved.length, 0);
    note.value = "seal temp drifted";
    stub.dispatch(note, "keydown", { key: "Enter", shiftKey: false, target: note });
    assert.deepEqual(saved, [{ label: "causes", why: "seal temp drifted" }]);
    assert.equal(pop.isConnected, false);

    const again = openWhyPopover({ doc: stub.document, onCancel: () => cancelled.push(1) });
    stub.dispatch(again.el, "keydown", { key: "Escape", target: again.el.querySelector(".pxd-why__label") });
    assert.equal(cancelled.length, 1);
    assert.equal(again.el.isConnected, false);
  } finally {
    restore();
  }
});

test("closeOpenWhyPopovers removes a pop whose handle was dropped", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    openWhyPopover({ doc: stub.document, label: "a", why: "b" });
    assert.equal(stub.document.querySelectorAll(".pxd-why").length, 1);
    closeOpenWhyPopovers();
    assert.equal(stub.document.querySelectorAll(".pxd-why").length, 0);
  } finally {
    restore();
  }
});
