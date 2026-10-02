import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard, worldRects } from "../src/model/board.js";
import { cellText, columnNameOk, filterRows, isTableRow, planAttrCell, sortRows, tableColumns, tableRows } from "../src/model/table.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function row(partial) {
  return {
    uid: partial.uid,
    kind: partial.kind || "card",
    title: partial.title,
    section: partial.section || "",
    type: partial.type || "card",
    edited: partial.edited ?? 0,
    attrs: partial.attrs || [],
  };
}

const rows = [
  row({ uid: "a", title: "Receiving", section: "Dock", edited: 30, attrs: [{ name: "Owner", value: "Ana", uid: "a1" }, { name: "Risk", value: "low" }] }),
  row({ uid: "b", title: "Blending", section: "Floor", edited: 10, attrs: [{ name: "Owner", value: "Bo", uid: "b1" }] }),
  row({ uid: "c", kind: "board", title: "Packing", section: "", type: "board", edited: 20, attrs: [{ name: "Risk", value: "high", uid: "c1" }, { name: "Line", value: "2" }] }),
];

test("TP-2: columns are the fixed four plus attribute names in first-seen order", () => {
  assert.equal(isTableRow({ kind: "section" }), false);
  assert.equal(isTableRow({ kind: "card" }), true);
  assert.deepEqual(tableColumns(rows), ["Title", "Section", "Type", "Edited", "Owner", "Risk", "Line"]);
  assert.equal(cellText(rows[2], "Line"), "2");
  assert.equal(cellText(rows[1], "Line"), "");
});

test("TP-2: filter matches any cell and sort is by column", () => {
  assert.deepEqual(filterRows(rows, "high").map((r) => r.uid), ["c"]);
  assert.deepEqual(filterRows(rows, "  ").map((r) => r.uid), ["a", "b", "c"]);
  assert.deepEqual(sortRows(rows, "Title").map((r) => r.uid), ["b", "c", "a"]);
  assert.deepEqual(sortRows(rows, "Edited", "desc").map((r) => r.uid), ["a", "c", "b"]);
});

test("TP-2: a new column writes only when a cell is filled, and BT_attr is refused", () => {
  assert.equal(columnNameOk(""), false);
  assert.equal(columnNameOk("BT_attrDue"), false);
  assert.equal(columnNameOk("Title"), false);
  assert.equal(columnNameOk("Site"), true);
  assert.equal(planAttrCell({ name: "Owner", value: "", parentUid: "card" }), null);
  assert.equal(planAttrCell({ name: "BT_attrDue", value: "tomorrow", parentUid: "card" }), null);
  assert.equal(planAttrCell({ name: "Title", value: "x", parentUid: "card" }), null);
  assert.deepEqual(planAttrCell({ name: "Owner", value: "Cia", parentUid: "card" }), { op: "create", parent: "card", string: "Owner:: Cia" });
  assert.deepEqual(planAttrCell({ name: "Owner", value: "Cia", blockUid: "a1" }), { op: "update", uid: "a1", string: "Owner:: Cia" });
  assert.deepEqual(planAttrCell({ name: "Owner", value: "", blockUid: "a1" }), { op: "update", uid: "a1", string: "Owner::" });
});

function block(uid, string, order, plexus, children = []) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  };
}

function attr(uid, string, order) {
  return { ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/children": [] };
}

const NAMES = ["juliet", "bravo", "alpha", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"];

function tenCardTree() {
  const card = (uid, title, order, children = []) => block(uid, title, order, { ":x": order * 40, ":y": 0, ":w": 200, ":h": 80 }, children);
  return {
    ":block/uid": "boardTP2",
    ":block/string": "{{[[diagram]]:TP-2}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      block("juliet", "{{[[diagram]]:Juliet}}", 0, { ":x": 0, ":y": 0, ":w": 220, ":h": 80 }, [attr("j-risk", "Risk:: high", 0)]),
      block("dock", "Dock", 1, { ":type": "section", ":x": 0, ":y": 200, ":w": 400, ":h": 240 }, [
        card("bravo", "Bravo", 0, [attr("b-own", "Owner:: Bo", 0)]),
        card("alpha", "Alpha", 1, [attr("a-own", "Owner:: Ana", 0), attr("a-risk", "Risk:: low", 1)]),
      ]),
      card("charlie", "Charlie", 2, [attr("c-line", "Line:: 2", 0)]),
      card("delta", "Delta", 3),
      card("echo", "Echo", 4),
      card("foxtrot", "Foxtrot", 5),
      card("golf", "Golf", 6),
      card("hotel", "Hotel", 7, [attr("h-bt", "BT_attrDue:: tomorrow", 0), attr("h-title", "Title:: nope", 1)]),
      card("india", "India", 8),
      block("label", "Label", 9, { ":type": "text", ":x": 0, ":y": 500, ":w": 80, ":h": 40 }),
    ],
  };
}

test("TP-2: rows come from the board, with section, type, and attribute uids", () => {
  const board = buildBoard(tenCardTree());
  const rows = tableRows(board);
  assert.deepEqual(rows.map((row) => row.uid), NAMES);
  assert.equal(rows.find((row) => row.uid === "alpha").section, "Dock");
  assert.equal(rows.find((row) => row.uid === "juliet").type, "board");
  assert.equal(rows.find((row) => row.uid === "alpha").attrs.find((attr) => attr.name === "Owner").uid, "a-own");
  assert.deepEqual(tableColumns(rows), ["Title", "Section", "Type", "Edited", "Risk", "Owner", "Line"]);
});

test("TP-2: mounted board toggles table, sorts, filters, edits, and adds a value", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard(tenCardTree());
  const times = { alpha: 30, bravo: 10, juliet: 20 };
  const writes = [];
  const renders = [];
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) { renders.push(uid); el.dataset.rendered = uid; },
    renderPage() {},
    unmount() {},
    q(_query, uids) { return (uids || []).filter((uid) => times[uid] != null).map((uid) => [uid, times[uid]]); },
    group(fn) { return fn(); },
    createBlock(spec) { writes.push(spec); return Promise.resolve("made"); },
  };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on() { return () => {}; },
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "1.3.0",
    initialViewport: { x: 12, y: 34, zoom: 1 },
  });
  const flush = async () => {
    stub.flushFrames();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stub.flushIdle();
    stub.flushFrames();
  };
  try {
    await flush();
    const root = view.root;
    const world = root.querySelector(".pxd-world");
    const before = { transform: world.style.transform, items: root.querySelectorAll(".pxd-item").length };
    assert.equal(before.items > 0, true);
    assert.equal(writes.length, 0);
    root.querySelector(".pxd-toolbar")._rect = { left: 0, top: 0, x: 0, y: 0, width: 320, height: 146, right: 320, bottom: 146 };
    root.querySelector(".pxd-toolbar__table").click();
    await flush();
    assert.equal(root.classList.contains("pxd-root--table"), true);
    assert.equal(root.querySelector(".pxd-table").style.top, "146px");
    assert.equal(world.style.transform, before.transform);
    const headers = () => [...root.querySelectorAll(".pxd-table__sort")].map((button) => button.getAttribute("data-col"));
    const rowUids = () => [...root.querySelectorAll(".pxd-table__row")].map((row) => row.getAttribute("data-uid"));
    assert.deepEqual(rowUids(), NAMES);
    assert.deepEqual(headers(), ["Title", "Section", "Type", "Edited", "Risk", "Owner", "Line"]);
    const cell = (uid, column) => {
      const row = [...root.querySelectorAll(".pxd-table__row")].find((item) => item.getAttribute("data-uid") === uid);
      return [...row.children].find((td) => td.getAttribute("data-col") === column);
    };
    assert.equal(cell("alpha", "Section").textContent, "Dock");
    assert.equal(cell("juliet", "Type").textContent, "board");
    assert.equal(writes.length, 0, "opening the table writes nothing");
    [...root.querySelectorAll(".pxd-table__sort")].find((button) => button.getAttribute("data-col") === "Title").click();
    assert.equal(rowUids()[0], "alpha");
    const filter = root.querySelector(".pxd-table__filter");
    filter.value = "high";
    filter.dispatchEvent({ type: "input" });
    assert.deepEqual(rowUids(), ["juliet"]);
    filter.value = "";
    filter.dispatchEvent({ type: "input" });
    assert.equal(rowUids().length, 10);
    const clickSort = (column) => {
      [...root.querySelectorAll(".pxd-table__sort")].find((button) => button.getAttribute("data-col") === column).click();
    };
    clickSort("Edited");
    clickSort("Edited");
    assert.deepEqual(rowUids().slice(0, 3), ["alpha", "juliet", "bravo"]);
    cell("alpha", "Owner").querySelector("button").click();
    assert.deepEqual(renders, ["a-own"]);
    const name = root.querySelector(".pxd-table__colname");
    name.value = "BT_attrDue";
    root.querySelector(".pxd-table__add").click();
    name.value = "Title";
    root.querySelector(".pxd-table__add").click();
    assert.equal(headers().includes("BT_attrDue"), false);
    assert.equal(headers().includes("Site"), false);
    name.value = "Site";
    root.querySelector(".pxd-table__add").click();
    assert.equal(headers().includes("Site"), true);
    assert.equal(writes.length, 0, "adding a column writes nothing");
    const fill = cell("golf", "Site").querySelector("input");
    fill.value = "Cold";
    fill.dispatchEvent({ type: "blur" });
    for (let i = 0; i < 6 && !writes.length; i += 1) await Promise.resolve();
    assert.deepEqual(writes, [{ parentUid: "golf", order: "last", string: "Site:: Cold" }]);
    assert.equal(root.querySelectorAll(".pxd-item").length, before.items);
    root.querySelector(".pxd-toolbar__table").click();
    await flush();
    assert.equal(root.classList.contains("pxd-root--table"), false);
    assert.equal(world.style.transform, before.transform);
    assert.equal(root.querySelectorAll(".pxd-item").length, before.items);
    assert.equal(writes.length, 1);
  } finally {
    view.dispose();
    restore();
  }
});
