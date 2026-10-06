import assert from "node:assert/strict";
import test from "node:test";

import { DONE_COLUMN, groupByStatus, kanbanFields, NO_STATUS, planKanbanMove, STATUS_FIELD } from "../src/model/kanban.js";
import { statusPalette } from "../src/model/status-tags.js";
import { mountKanban } from "../src/view/kanban-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const NAMES = ["Active", "Waiting", "In Review", "Holding", "Incubating", "Alert", "Cancelled", "No status", "Done"];

const task = (uid, body, marker = "TODO") => ({
  uid,
  string: `{{[[${marker}]]}} ${body}`,
});

test("groupByStatus is seven statuses, No status, and Done", () => {
  const palette = statusPalette(null);
  const items = [
    task("a1", "One #[[task-status/Active]]"),
    task("a2", "Two #[[task-status/Active]]"),
    task("w1", "Wait #[[task-status/Waiting]]"),
    task("d1", "Finished #[[task-status/Active]]", "DONE"),
    task("u1", "Odd #[[task-status/Blocked]]"),
    task("n1", "Plain"),
  ];
  const columns = groupByStatus(items, palette);
  assert.equal(columns.length, 9);
  assert.deepEqual(columns.map((column) => column.name), NAMES);
  const count = (name) => columns.find((column) => column.name === name);
  assert.equal(count("Active").count, 2);
  assert.deepEqual(count("Active").cards.map((card) => card.uid), ["a1", "a2"]);
  assert.equal(count("Waiting").count, 1);
  assert.equal(count("In Review").count, 0);
  assert.equal(count(NO_STATUS).count, 2);
  assert.deepEqual(count(NO_STATUS).cards.map((card) => card.uid), ["u1", "n1"]);
  assert.equal(count(NO_STATUS).glyph, "diamond");
  assert.equal(count(DONE_COLUMN).count, 1);
  assert.equal(count(DONE_COLUMN).cards[0].uid, "d1");
  assert.equal(count(DONE_COLUMN).glyph, "");
  assert.equal(kanbanFields(items).includes(STATUS_FIELD), false);
  assert.equal(planKanbanMove({ field: STATUS_FIELD, column: "Waiting", row: items[0] }), null);
});

function boardOf(cards) {
  return {
    uid: "board",
    order: cards.map((card) => card.uid),
    items: new Map(cards.map((card) => [card.uid, {
      uid: card.uid,
      type: "card",
      kind: "note",
      parentUid: "board",
      string: card.string,
      title: card.uid,
      content: [],
    }])),
    plexus: { x: 12, y: 34, type: "board", ...(cards.kanban ? { kanban: cards.kanban } : {}) },
  };
}

function card(uid, body, marker = "TODO") {
  return { uid, string: `{{[[${marker}]]}} ${body}` };
}

function mount(stub, cards, extra = {}) {
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const board = boardOf(cards);
  if (extra.kanban) board.plexus.kanban = extra.kanban;
  const writes = [];
  const toasts = [];
  const host = {
    pullProps() { return extra.pullProps === undefined ? {} : extra.pullProps; },
    updateProps(uid, plexus) { writes.push({ uid, plexus }); },
    updateString(uid, string) {
      const entry = { op: "string", uid, string };
      writes.push(entry);
      extra.onWrite?.(entry);
      board.items.get(uid).string = string;
    },
    group(fn) { return fn(); },
  };
  const view = mountKanban({
    doc: stub.document,
    root,
    host,
    getBoard: () => board,
    setStatus: extra.setStatus,
    completeTask: extra.completeTask,
    toast: (toast) => toasts.push(toast),
  });
  return { root, board, writes, toasts, view };
}

const column = (root, name) => [...root.querySelectorAll(".pxd-kanban__column")].find((col) => col.getAttribute("data-column") === name);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("opening does not write; picking Lanes: Status writes the whole plexus once", () => {
  const stub = createDomStub();
  const cards = [card("a1", "One #[[task-status/Active]]")];
  const { root, writes, view } = mount(stub, cards);
  view.open();
  assert.deepEqual(writes, []);
  assert.equal(root.querySelector("select").value, "To do");
  const select = root.querySelector("select");
  const options = [...select.querySelectorAll("option")].map((option) => option.value);
  assert.ok(options.includes("Lanes: Status"));
  assert.ok(!options.includes("Lanes: Status") || options.filter((name) => name === "Lanes: Status").length === 1);
  select.value = "Lanes: Status";
  select.dispatchEvent({ type: "change" });
  assert.deepEqual(writes, [{ uid: "board", plexus: { x: 12, y: 34, type: "board", kanban: "Lanes: Status" } }]);
  view.dispose();
});

test("a saved lane opens nine columns and does not write", () => {
  const stub = createDomStub();
  const cards = [
    card("a1", "One #[[task-status/Active]]"),
    card("a2", "Two #[[task-status/Active]]"),
    card("w1", "Wait #[[task-status/Waiting]]"),
    card("d1", "Finished #[[task-status/Active]]", "DONE"),
    card("u1", "Odd #[[task-status/Blocked]]"),
    card("n1", "Plain"),
  ];
  const { root, writes, view } = mount(stub, cards, { kanban: "Lanes: Status" });
  view.open();
  assert.deepEqual(writes, []);
  const columns = [...root.querySelectorAll(".pxd-kanban__column")];
  assert.deepEqual(columns.map((col) => col.getAttribute("data-column")), NAMES);
  assert.deepEqual(columns.map((col) => col.getAttribute("data-count")), ["2", "1", "0", "0", "0", "0", "0", "2", "1"]);
  assert.equal(column(root, "Active").querySelector(".pxd-kanban__glyph")?.getAttribute("data-status"), "active");
  assert.equal(column(root, "No status").querySelector(".pxd-kanban__glyph")?.getAttribute("data-status"), "diamond");
  assert.equal(column(root, "Done").querySelector(".pxd-kanban__glyph"), null);
  assert.equal(column(root, "Done").querySelector(".pxd-kanban__card")?.getAttribute("data-uid"), "d1");
  assert.equal(column(root, "Active").querySelector('[data-uid="d1"]'), null);
  view.dispose();
});

test("a rejected setStatus puts the card back and toasts the reason", async () => {
  const stub = createDomStub();
  const cards = [card("a1", "One #[[task-status/Active]]")];
  const calls = [];
  const { root, toasts, view } = mount(stub, cards, {
    kanban: "Lanes: Status",
    setStatus: async (uid, name) => {
      calls.push({ uid, name });
      return { status: "rejected", reason: "conflict on the block" };
    },
  });
  view.open();
  const cardEl = column(root, "Active").querySelector(".pxd-kanban__card");
  cardEl.dispatchEvent({ type: "pointerdown" });
  column(root, "Waiting").dispatchEvent({ type: "pointerup" });
  await tick();
  assert.deepEqual(calls, [{ uid: "a1", name: "Waiting" }]);
  assert.equal(column(root, "Active").querySelector('[data-uid="a1"]')?.getAttribute("data-uid"), "a1");
  assert.equal(column(root, "Waiting").querySelector(".pxd-kanban__card"), null);
  assert.deepEqual(toasts, [{ message: "conflict on the block" }]);
  view.dispose();
});

test("[ and ] move the focused card one column and do not wrap", async () => {
  const stub = createDomStub();
  const cards = [
    card("a1", "One #[[task-status/Active]]"),
    card("d1", "Finished #[[task-status/Active]]", "DONE"),
  ];
  const calls = [];
  const order = [];
  const { root, view } = mount(stub, cards, {
    kanban: "Lanes: Status",
    onWrite: (entry) => order.push(entry.op),
    setStatus: async (uid, name) => {
      order.push("status");
      calls.push({ uid, name });
      return { status: "updated", didWrite: true };
    },
  });
  view.open();
  const active = column(root, "Active").querySelector(".pxd-kanban__card");
  active.focus();
  active.dispatchEvent({ type: "keydown", key: "[" });
  await tick();
  assert.deepEqual(calls, []);
  assert.equal(column(root, "Active").querySelector('[data-uid="a1"]'), active.parentElement ? column(root, "Active").querySelector('[data-uid="a1"]') : null);
  assert.ok(column(root, "Active").querySelector('[data-uid="a1"]'));

  column(root, "Active").querySelector('[data-uid="a1"]').focus();
  column(root, "Active").querySelector('[data-uid="a1"]').dispatchEvent({ type: "keydown", key: "]" });
  await tick();
  assert.deepEqual(calls, [{ uid: "a1", name: "Waiting" }]);
  assert.equal(column(root, "Waiting").querySelector('[data-uid="a1"]')?.getAttribute("data-uid"), "a1");
  assert.equal(stub.document.activeElement?.getAttribute?.("data-uid"), "a1");

  calls.length = 0;
  order.length = 0;
  const done = column(root, "Done").querySelector('[data-uid="d1"]');
  done.focus();
  done.dispatchEvent({ type: "keydown", key: "]" });
  await tick();
  assert.deepEqual(calls, []);
  assert.ok(column(root, "Done").querySelector('[data-uid="d1"]'));

  column(root, "Done").querySelector('[data-uid="d1"]').focus();
  column(root, "Done").querySelector('[data-uid="d1"]').dispatchEvent({ type: "keydown", key: "[" });
  await tick();
  assert.deepEqual(calls, [{ uid: "d1", name: null }]);
  assert.deepEqual(order, ["status", "string"]);
  assert.equal(column(root, "No status").querySelector('[data-uid="d1"]')?.getAttribute("data-uid"), "d1");
  view.dispose();
});

test("drop on Done completes; a rejected leave-Done does not reopen", async () => {
  const stub = createDomStub();
  const cards = [
    card("a1", "One #[[task-status/Active]]"),
    card("d1", "Finished #[[task-status/Active]]", "DONE"),
  ];
  const calls = [];
  const completed = [];
  const { root, board, writes, view } = mount(stub, cards, {
    kanban: "Lanes: Status",
    setStatus: async (uid, name) => {
      calls.push({ uid, name });
      return { status: "rejected", reason: "no" };
    },
    completeTask: async (uid) => {
      completed.push(uid);
      board.items.get(uid).string = board.items.get(uid).string.replace("[[TODO]]", "[[DONE]]");
      return { ok: true };
    },
  });
  view.open();
  column(root, "Active").querySelector('[data-uid="a1"]').dispatchEvent({ type: "pointerdown" });
  column(root, "Done").dispatchEvent({ type: "pointerup" });
  await tick();
  assert.deepEqual(completed, ["a1"]);
  assert.deepEqual(calls, []);
  assert.equal(column(root, "Done").querySelector('[data-uid="a1"]')?.getAttribute("data-uid"), "a1");

  calls.length = 0;
  completed.length = 0;
  writes.length = 0;
  column(root, "Done").querySelector('[data-uid="d1"]').dispatchEvent({ type: "pointerdown" });
  column(root, "Waiting").dispatchEvent({ type: "pointerup" });
  await tick();
  assert.deepEqual(calls, [{ uid: "d1", name: "Waiting" }]);
  assert.equal(writes.some((write) => write.op === "string"), false);
  assert.equal(column(root, "Done").querySelector('[data-uid="d1"]')?.getAttribute("data-uid"), "d1");
  assert.equal(column(root, "Waiting").querySelector('[data-uid="d1"]'), null);
  view.dispose();
});
