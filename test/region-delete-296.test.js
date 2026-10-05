import assert from "node:assert/strict";
import test from "node:test";

import { openRegionDeleteDialog } from "../src/view/region-delete-dialog.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("delete dialog names the count and the three actions", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const calls = [];
  try {
    const dialog = openRegionDeleteDialog(stub.document, {
      message: "Referenced in 1 block. Delete anyway?",
      onDelete: () => calls.push("delete"),
      onOpen: () => calls.push("open"),
      onCancel: () => calls.push("cancel"),
    });
    stub.document.body.append(dialog.el);
    assert.equal(dialog.el.querySelector(".pxd-region-delete__message").textContent, "Referenced in 1 block. Delete anyway?");
    dialog.el.querySelector(".pxd-region-open-refs").click();
    dialog.el.querySelector(".pxd-region-delete").click();
    dialog.el.querySelector(".pxd-region-delete-cancel").click();
    assert.deepEqual(calls, ["open", "delete", "cancel"]);
  } finally {
    restore();
  }
});
