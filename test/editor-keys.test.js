import assert from "node:assert/strict";
import test from "node:test";

import { blockUidFromNode, editorKeyAction, inputBlockRole } from "../src/view/editor-keys.js";

const at = (over) => editorKeyAction({ key: "Enter", isRoot: true, value: "Note card", selectionStart: 9, selectionEnd: 9, ...over });

test("Enter on the root adds a line to the same block, like a native Roam diagram", () => {
  assert.equal(at().type, "newline");
  assert.equal(at({ selectionStart: 4, selectionEnd: 4 }).type, "newline");
  assert.equal(at({ selectionStart: 5, selectionEnd: 9 }).type, "newline");
});

test("ED-6: with the child setting, Enter on the root stays with Roam", () => {
  assert.equal(at({ enterMode: "child" }).type, "roam");
  assert.equal(at({ enterMode: "child", selectionStart: 4, selectionEnd: 4 }).type, "roam");
});

test("ED-6: Enter in a child, Tab, and Cmd+Enter stay with Roam", () => {
  assert.equal(at({ isRoot: false }).type, "roam");
  assert.equal(at({ key: "Tab" }).type, "roam");
  assert.equal(at({ key: "Tab", shift: true }).type, "roam");
  assert.equal(at({ meta: true }).type, "roam");
  assert.equal(at({ ctrl: true }).type, "roam");
  assert.equal(at({ shift: true }).type, "roam");
  assert.equal(at({ autocomplete: true }).type, "roam");
});

test("ED-6: Backspace in an empty fresh root deletes the card", () => {
  assert.equal(editorKeyAction({ key: "Backspace", isRoot: true, fresh: true, value: "", selectionStart: 0, selectionEnd: 0 }).type, "delete-card");
  assert.equal(editorKeyAction({ key: "Backspace", isRoot: true, fresh: true, value: "x", selectionStart: 1, selectionEnd: 1 }).type, "roam");
  assert.equal(editorKeyAction({ key: "Backspace", isRoot: true, fresh: false, value: "", selectionStart: 0, selectionEnd: 0 }).type, "roam");
  assert.equal(editorKeyAction({ key: "Backspace", isRoot: false, fresh: true, value: "", selectionStart: 0, selectionEnd: 0 }).type, "roam");
});

test("ED-6: a textarea inside nested blocks is a child, the card block is the root", () => {
  const root = { nodeType: 1, id: "cardAAAA1", parentElement: null, closest() { return null; } };
  const ta = { nodeType: 1, id: "", parentElement: root, closest() { return null; }, getAttribute() { return ""; } };
  assert.deepEqual(inputBlockRole(ta, "cardAAAA1"), { role: "root", uid: "cardAAAA1" });
  const nest = { nodeType: 1, id: "", className: "rm-block-children", parentElement: root, closest(sel) { return sel === ".rm-block-children" ? nest : null; } };
  const child = { nodeType: 1, id: "kidAAAA01", parentElement: nest, closest(sel) { return nest.closest(sel); } };
  const cta = { nodeType: 1, id: "", parentElement: child, closest(sel) { return child.closest(sel); }, getAttribute() { return ""; } };
  assert.equal(blockUidFromNode(cta), "kidAAAA01");
  assert.deepEqual(inputBlockRole(cta, "cardAAAA1"), { role: "child", uid: "kidAAAA01" });

  // The diagram block sits in the page's .rm-block-children. That wrapper is outside the editor.
  const pageKids = { nodeType: 1, className: "rm-block-children", parentElement: null };
  const editor = { nodeType: 1, className: "pxd-item__editor", parentElement: pageKids };
  const block = { nodeType: 1, id: "cardBBBB1", parentElement: editor };
  const walk = (start) => (sel) => {
    let el = start;
    while (el) {
      if (sel === ".rm-block-children" && String(el.className || "").includes("rm-block-children")) return el;
      if (sel === ".pxd-item__editor" && String(el.className || "").includes("pxd-item__editor")) return el;
      el = el.parentElement;
    }
    return null;
  };
  const rootTa = { nodeType: 1, id: "", parentElement: block, closest: walk(block), getAttribute() { return ""; } };
  assert.deepEqual(inputBlockRole(rootTa, "cardBBBB1"), { role: "root", uid: "cardBBBB1" });
  const inner = { nodeType: 1, className: "rm-block-children", parentElement: block };
  const kid = { nodeType: 1, id: "kidBBBB01", parentElement: inner };
  const kidTa = { nodeType: 1, id: "", parentElement: kid, closest: walk(kid), getAttribute() { return ""; } };
  assert.deepEqual(inputBlockRole(kidTa, "cardBBBB1"), { role: "child", uid: "kidBBBB01" });
});
