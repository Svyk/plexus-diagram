// PDF-6: Highlight colour plans one #h tag write. Imports the shipped helpers.
import assert from "node:assert/strict";
import test from "node:test";

import { rewriteHighlightTag } from "../src/model/highlight.js";
import { HIGHLIGHT_FIELD, kanbanColumns, kanbanFields, kanbanRows, planKanbanMove } from "../src/model/kanban.js";

const YELLOW = "selected passage #h/yellow";

function board() {
  return {
    order: ["c1", "c2"],
    items: new Map([
      ["c1", {
        uid: "c1",
        type: "card",
        kind: "highlight",
        string: "((hl1))",
        title: "selected passage",
        parentUid: "b",
        content: [],
        highlight: { color: "yellow" },
        target: { kind: "block", uid: "hl1" },
      }],
      ["c2", {
        uid: "c2",
        type: "card",
        kind: "note",
        string: "A note",
        title: "A note",
        parentUid: "b",
        content: [],
      }],
    ]),
  };
}

test("a yellow highlight moving to green rewrites the target tag", () => {
  assert.equal(HIGHLIGHT_FIELD, "Highlight colour");
  const source = board();
  const rows = kanbanRows(source, (uid) => (uid === "hl1" ? YELLOW : null));
  const yellow = rows.find((row) => row.uid === "c1");
  const note = rows.find((row) => row.uid === "c2");
  assert.equal(yellow.highlightColor, "yellow");
  assert.equal(yellow.targetUid, "hl1");
  assert.equal(yellow.targetString, YELLOW);
  assert.equal(yellow.color, undefined);
  assert.equal(source.items.get("c1").color, undefined);
  assert.equal(note.highlightColor, undefined);
  assert.equal(note.targetUid, undefined);
  assert.equal(note.targetString, undefined);
  assert.deepEqual(kanbanFields(rows), ["To do", HIGHLIGHT_FIELD]);
  assert.deepEqual(kanbanFields([note]), ["To do"]);
  const columns = kanbanColumns(rows, HIGHLIGHT_FIELD);
  const byName = Object.fromEntries(columns.map((column) => [column.name, column.cards.map((card) => card.uid)]));
  assert.deepEqual(byName.yellow, ["c1"]);
  assert.deepEqual(byName[""], ["c2"]);
  const plan = planKanbanMove({ field: HIGHLIGHT_FIELD, column: "green", row: yellow });
  assert.deepEqual(plan, {
    op: "string",
    uid: "hl1",
    string: rewriteHighlightTag(YELLOW, "green"),
  });
  assert.equal(plan.string, "selected passage #h/green");
  assert.equal(planKanbanMove({ field: HIGHLIGHT_FIELD, column: "yellow", row: yellow }), null);
  assert.equal(planKanbanMove({ field: HIGHLIGHT_FIELD, column: "green", row: note }), null);
});

test("no highlight target plans nothing", () => {
  assert.equal(planKanbanMove({
    field: HIGHLIGHT_FIELD,
    column: "green",
    row: { uid: "c1", kind: "highlight", highlightColor: "yellow", targetString: YELLOW },
  }), null);
  assert.equal(planKanbanMove({
    field: HIGHLIGHT_FIELD,
    column: "green",
    row: { uid: "c1", kind: "highlight", highlightColor: "yellow", targetUid: "hl1" },
  }), null);
  assert.equal(planKanbanMove({
    field: HIGHLIGHT_FIELD,
    column: "green",
    row: { uid: "c1", kind: "highlight", highlightColor: "yellow", targetUid: "hl1", targetString: "" },
  }), null);
});
