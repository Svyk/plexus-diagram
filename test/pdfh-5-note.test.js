// PDFH-5 list and model. A note is a child block. The pane does not write one.
import assert from "node:assert/strict";
import test from "node:test";

import { highlightModel, highlightNote, noteActionPlan } from "../src/model/highlight.js";
import { highlightRows } from "../src/model/highlight-pick.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const NOTE = "why this passage";
const textProps = {
  ":pdf-highlight": {
    ":type": "text",
    ":position": { ":boundingRect": { ":pageNumber": 1 } },
  },
};

test("highlightNote is empty for the blank child Roam's note button creates", () => {
  assert.equal(highlightNote([{ uid: "note00001", string: "", props: {} }]), "");
  assert.equal(highlightNote([
    { uid: "note00001", string: "", props: {} },
    { uid: "later0001", string: "later", props: {} },
  ]), "");
  assert.equal(highlightNote([
    { ":block/uid": "hlkid0001", ":block/string": "inner #h/green", ":block/order": 0, ":block/props": { ":pdf-highlight": { ":type": "text" } } },
    { ":block/uid": "note00001", ":block/string": NOTE, ":block/order": 1, ":block/props": {} },
  ]), NOTE);
  const model = highlightModel({
    props: textProps,
    string: "quoted passage #h/yellow",
    children: [{ uid: "note00001", string: "", props: {} }],
  });
  assert.equal(model.note, "");
});

test("noteActionPlan focuses the note child, including an empty one, and creates only when there is none", () => {
  assert.deepEqual(noteActionPlan(null), { kind: "create" });
  assert.deepEqual(noteActionPlan([]), { kind: "create" });
  assert.deepEqual(noteActionPlan([
    { uid: "hlkid0001", string: "inner #h/green", props: { ":pdf-highlight": { ":type": "text" } } },
  ]), { kind: "create" });
  assert.deepEqual(noteActionPlan([
    { ":block/uid": "note00001", ":block/string": "", ":block/order": 0, ":block/props": {} },
  ]), { kind: "focus", uid: "note00001" });
  assert.deepEqual(noteActionPlan([
    { uid: "later0001", string: NOTE, props: {}, order: 2 },
    { uid: "hlkid0001", string: "inner #h/green", props: { ":pdf-highlight": { type: "text" } }, order: 0 },
    { uid: "first0001", string: "", props: {}, order: 1 },
  ]), { kind: "focus", uid: "first0001" });
  assert.deepEqual(noteActionPlan([
    { uid: "hlkid0001", string: "inner #h/green", props: { ":pdf-highlight": { ":type": "text" } }, order: 0 },
    { uid: "note00001", string: NOTE, props: {}, order: 1 },
  ]), { kind: "focus", uid: "note00001" });
});

test("a pane row shows a note mark only when the note has text, and Note calls onNote", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const writes = [];
  const noted = [];
  const tree = [{
    uid: "hlnoted01",
    string: "quoted passage #h/yellow",
    props: textProps,
    children: [
      { uid: "hlkid0001", string: "inner #h/green", props: { ":pdf-highlight": { ":type": "text", ":position": { ":boundingRect": { ":pageNumber": 4 } } } }, children: [] },
      { uid: "note00001", string: NOTE, props: {}, children: [] },
    ],
  }, {
    uid: "hlempty01",
    string: "blank child #h/blue",
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":position": { ":boundingRect": { ":pageNumber": 2 } },
      },
    },
    children: [{ uid: "emptykid1", string: "", props: {}, children: [] }],
  }, {
    uid: "hlplain01",
    string: "no child #h/green",
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":position": { ":boundingRect": { ":pageNumber": 3 } },
      },
    },
    children: [],
  }];
  const rows = highlightRows(tree);
  assert.equal(rows.find((row) => row.uid === "hlnoted01").note, NOTE);
  assert.equal(rows.find((row) => row.uid === "hlempty01").note, "");
  assert.equal(rows.find((row) => row.uid === "hlplain01").note, "");
  const host = {
    renderBlock(node) {
      const box = doc.createElement("div");
      box.className = "rm-pdf-container";
      node.append(box);
    },
    pdfHighlightTree() { return tree; },
    createBlock(...args) { writes.push(["create", ...args]); },
    updateBlock(...args) { writes.push(["update", ...args]); },
  };
  const pane = createReadPane({
    doc,
    root,
    host,
    onNote(row) { noted.push(row); },
  });
  try {
    pane.open({ blockUid: "pdfblock1", cardUid: "pdfcard01", title: "Paper", pageUid: "pagepdf01" });
    const rowBy = (uid) => [...root.querySelectorAll(".pxd-read__row")].find((node) => node.getAttribute("data-uid") === uid);
    const marked = rowBy("hlnoted01");
    const empty = rowBy("hlempty01");
    const plain = rowBy("hlplain01");
    assert.equal(marked.querySelector(".pxd-read__mark").textContent, "Note");
    assert.equal(marked.querySelector(".pxd-read__mark").getAttribute("aria-label"), "Note");
    assert.equal(empty.querySelector(".pxd-read__mark"), null);
    assert.equal(plain.querySelector(".pxd-read__mark"), null);
    for (const node of [marked, empty, plain]) {
      const button = node.querySelector("button.pxd-read__note");
      assert.equal(button.textContent, "Note");
      assert.equal(button.getAttribute("aria-label"), "Note");
      assert.ok(node.querySelector("button.pxd-read__place"));
    }
    marked.querySelector("button.pxd-read__note").click();
    empty.querySelector("button.pxd-read__note").click();
    plain.querySelector("button.pxd-read__note").click();
    assert.deepEqual(noted.map((row) => row.uid), ["hlnoted01", "hlempty01", "hlplain01"]);
    assert.equal(noted[0].note, NOTE);
    assert.equal(noted[1].note, "");
    assert.equal(noted[2].note, "");
    assert.equal(writes.length, 0);
    pane.dispose();

    const quiet = createReadPane({ doc, root, host });
    quiet.open({ blockUid: "pdfblock1", cardUid: "pdfcard01", title: "Paper", pageUid: "pagepdf01" });
    root.querySelector("button.pxd-read__note").click();
    assert.equal(writes.length, 0);
    quiet.dispose();
  } finally {
    restore();
  }
});

test("the card Note action is wired: cards.js draws the button and board-view opens Roam's note", async () => {
  const { readFile } = await import("node:fs/promises");
  const cards = await readFile(new URL("../src/view/cards.js", import.meta.url), "utf8");
  const view = await readFile(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  const session = await readFile(new URL("../src/session.js", import.meta.url), "utf8");
  assert.match(cards, /pxd-highlight-notebtn/);
  assert.match(cards, /onHighlightNote\(item\.target\.uid\)/);
  assert.match(view, /noteActionPlan\(kids\)/);
  assert.match(view, /onNote: \(row\) =>/);
  assert.match(session, /addHighlightNote\(highlightUid\)/);
  assert.doesNotMatch(session.slice(session.indexOf("addHighlightNote(highlightUid)"), session.indexOf("addHighlightNote(highlightUid)") + 600), /pdf-highlight/);
});
