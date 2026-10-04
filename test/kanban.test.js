import assert from "node:assert/strict";
import test from "node:test";
import { kanbanColumns, kanbanFields, planKanbanMove, todoState } from "../src/model/kanban.js";
import { mountKanban } from "../src/view/kanban-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("TP-3: moving a TODO card to Done rewrites the marker once", () => {
  assert.equal(todoState("{{[[TODO]]}} Wash"), "To do");
  assert.equal(todoState("{{[[DONE]]}} Wash"), "Done");
  assert.equal(todoState("Wash"), "");
  const row = { uid: "c1", string: "{{[[TODO]]}} Wash", attrs: [] };
  const columns = kanbanColumns([row], "To do");
  assert.deepEqual(columns.map((column) => column.name), ["To do", "Done"]);
  assert.equal(columns[0].cards[0].uid, "c1");
  assert.equal(columns[1].cards.length, 0);
  assert.deepEqual(planKanbanMove({ field: "To do", column: "Done", row }), {
    op: "string",
    uid: "c1",
    string: "{{[[DONE]]}} Wash",
    status: "DONE",
  });
  assert.equal(planKanbanMove({ field: "To do", column: "To do", row }), null);
  assert.equal(planKanbanMove({ field: "BT_attrStatus", column: "Done", row }), null);
});

test("TP-3: an attribute drop rewrites that Name:: child and does not invent a second write", () => {
  const row = { uid: "c1", string: "Card", attrs: [{ name: "Status", value: "To do", uid: "a1" }] };
  assert.deepEqual(kanbanFields([row]), ["To do", "Status"]);
  assert.deepEqual(kanbanColumns([row], "Status").map((column) => column.name), ["To do"]);
  assert.deepEqual(planKanbanMove({ field: "Status", column: "Done", row }), {
    op: "string",
    uid: "a1",
    string: "Status:: Done",
  });
  assert.equal(planKanbanMove({ field: "Status", column: "To do", row }), null);
  const fresh = { uid: "c2", string: "Other", attrs: [] };
  assert.deepEqual(planKanbanMove({ field: "Status", column: "Done", row: fresh }), {
    op: "create",
    parent: "c2",
    string: "Status:: Done",
  });
});

test("TP-3: dropping a To do card on Done writes the marker once", async () => {
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  const board = {
    order: ["c1"],
    items: new Map([["c1", {
      uid: "c1",
      type: "card",
      kind: "note",
      parentUid: "board",
      string: "{{[[TODO]]}} Wash",
      title: "Wash",
      content: [],
    }]]),
  };
  const writes = [];
  const host = {
    group(fn) { return fn(); },
    updateString(uid, string) {
      writes.push({ uid, string });
      board.items.get(uid).string = string;
    },
  };
  const view = mountKanban({ doc: stub.document, root, host, getBoard: () => board });
  view.open();
  root.querySelector(".pxd-kanban__card").dispatchEvent({ type: "pointerdown" });
  [...root.querySelectorAll(".pxd-kanban__column")].find((col) => col.getAttribute("data-column") === "Done").dispatchEvent({ type: "pointerup" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(writes, [{ uid: "c1", string: "{{[[DONE]]}} Wash" }]);
  const done = [...root.querySelectorAll(".pxd-kanban__column")].find((col) => col.getAttribute("data-column") === "Done");
  assert.equal(done.querySelector(".pxd-kanban__card")?.getAttribute("data-uid"), "c1");
  view.dispose();
  assert.equal(root.querySelector(".pxd-kanban"), null);
});
