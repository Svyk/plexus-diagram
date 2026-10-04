// TSK-1. K is skipped only when task-tool is off, and the sheet filters when it opens.
import assert from "node:assert/strict";
import test from "node:test";

import { createShortcutSheet } from "../src/view/shortcut-sheet.js";
import { findShortcut } from "../src/view/shortcuts.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const kEvent = { key: "k" };

test("findShortcut skips K only when task-tool is false", () => {
  assert.equal(findShortcut(kEvent, "normal", { "task-tool": false }), null);
  const row = findShortcut(kEvent, "normal");
  assert.equal(row?.keys, "K");
  assert.equal(row?.tool, "task");
  assert.equal(findShortcut(kEvent, "normal", { "task-tool": true })?.keys, "K");
  assert.equal(findShortcut(kEvent, "normal", { get: (id) => (id === "task-tool" ? false : undefined) }), null);
  assert.equal(findShortcut(kEvent, "normal", { get: (id) => (id === "task-tool" ? true : undefined) })?.keys, "K");
  assert.equal(findShortcut({ key: "v" }, "normal", { "task-tool": false })?.tool, "select");
});

test("the shortcut sheet omits K while task-tool is false and shows it when true", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    const bag = { "task-tool": false };
    const sheet = createShortcutSheet({
      doc: stub.document,
      root,
      settings: { get: (id) => bag[id] },
    });
    const keysOf = () => [...root.querySelectorAll(".pxd-sheet__keys")].map((node) => node.textContent);
    sheet.open();
    assert.equal(keysOf().includes("K"), false);
    sheet.close();
    bag["task-tool"] = true;
    sheet.open();
    assert.equal(keysOf().includes("K"), true);
    sheet.close();
    const plain = createShortcutSheet({ doc: stub.document, root, settings: { "task-tool": false } });
    plain.open();
    assert.equal(keysOf().includes("K"), false);
  } finally {
    restore();
  }
});
