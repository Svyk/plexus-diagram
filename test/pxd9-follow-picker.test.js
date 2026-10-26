// PXD-9 board view: the Follow pickers (a 9-letter word is a search word, a pasted ((ref)) is a block) and tray rows
// dropped on a board (only this board's own tray places a followed card). Mounted board view, DOM stub.
import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const rawBoard = () => ({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [] });
const rowFor = (root, id) => [...root.querySelectorAll(".pxd-menu__item")].find((node) => node.getAttribute("data-id") === id);

function openPicker(pick) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(rawBoard());
  const session = { uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false, mutations: [], on: () => () => {}, release() {}, setLinkMode() {} };
  const asked = [];
  const strings = { blkUID001: "A real block", qryUID001: "{{query: {and: [[pxd]]}}}" };
  const host = {
    graph: "Svy", renderString() {}, renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => null, pullTree: () => [], pageUid: () => null,
    blockString: (uid) => strings[uid] ?? null,
    openBlock() {}, openInSidebar() {}, related: () => [],
    searchBlocks: (text) => { asked.push(["blocks", text]); return [{ uid: "blkUID001", string: `${text} in a block`, pageTitle: "P" }, { uid: "qryUID001", string: strings.qryUID001, pageTitle: "Q" }]; },
    searchPages: (text) => { asked.push(["pages", text]); return [{ uid: "pgu", title: text }]; },
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "2.1.0" });
  stub.flushFrames();
  view.root.querySelector(".pxd-toolbar__more").click();
  rowFor(view.root, "follow")?.click();
  rowFor(view.root, `follow:${pick}`).click();
  const filter = stub.document.querySelector(".pxd-addboard__filter");
  const type = async (text) => {
    asked.length = 0;
    filter.value = text;
    filter.dispatchEvent({ type: "input" });
    await tick(200);
    return [...stub.document.querySelectorAll(".pxd-addboard__row")].map((row) => row.getAttribute("data-value"));
  };
  return { type, asked, done: () => { view.dispose(); restore(); } };
}

// A board view whose session records what a drop asks for. `followKey`: the source this board follows, or "".
function mountDrop(followKey) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(rawBoard());
  const calls = [];
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false, mutations: [], on: () => () => {}, release() {}, setLinkMode() {},
    followState: () => (followKey ? { pointer: {}, key: followKey } : null),
    placeFollowed: (entries) => { calls.push(["placeFollowed", entries.map((e) => e.uid)]); return Promise.resolve({ uids: [] }); },
    addRefCards: (rows) => { calls.push(["addRefCards", rows.map((r) => r.string)]); return Promise.resolve([]); },
  };
  const host = {
    graph: "Svy", renderString() {}, renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => null, pullTree: () => [], pageUid: () => null, blockString: (uid) => (uid === "k2" ? "two" : null),
    openBlock() {}, openInSidebar() {}, related: () => [],
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "2.1.0" });
  stub.flushFrames();
  // Exactly what a tray row's dragstart sets (follow-tray.js).
  const drop = async (row) => {
    const data = { "application/x-plexus-follow": JSON.stringify(row), "application/x-plexus-card": "((k2))", "text/plain": "((k2))" };
    stub.dispatch(view.root, "drop", { clientX: 300, clientY: 300, dataTransfer: { getData: (t) => data[t] || "", types: Object.keys(data), files: [] } });
    await tick(20);
  };
  return { calls, drop, done: () => { view.dispose(); restore(); } };
}

test("PXD-9 drop: a row from this board's own tray is placed as a followed card", async () => {
  const d = mountDrop("block:SRC");
  try {
    await d.drop({ uid: "k2", kind: "block", board: "board0001", src: "block:SRC" });
    assert.deepEqual(d.calls, [["placeFollowed", ["k2"]]]);
  } finally { d.done(); }
});

test("PXD-9 drop: a row from another board's tray, or from a source this board does not follow, is a plain ref card", async () => {
  for (const [followKey, row, why] of [
    ["", { uid: "k2", kind: "block", board: "otherBrd1", src: "block:SRC" }, "this board follows nothing"],
    ["block:ELSE", { uid: "k2", kind: "block", board: "otherBrd1", src: "block:SRC" }, "this board follows another source"],
    ["block:ELSE", { uid: "k2", kind: "block", board: "board0001", src: "block:SRC" }, "this board has switched source since the drag began"],
    ["block:SRC", { uid: "k2", kind: "block" }, "a row that names no board"],
  ]) {
    const d = mountDrop(followKey);
    try {
      await d.drop(row);
      assert.deepEqual(d.calls, [["addRefCards", ["((k2))"]]], why);
    } finally { d.done(); }
  }
});

test("PXD-9 picker: a 9-letter word searches like any other word", async () => {
  const p = openPicker("pick-block");
  try {
    for (const word of ["Knowledg", "Knowledge", "Knowledges", "Inventory", "Reference", "Equipment"]) {
      assert.deepEqual(await p.type(word), ["pgu", "blkUID001"], word);
      assert.deepEqual(p.asked, [["pages", word], ["blocks", word]], `${word} runs the search`);
    }
  } finally { p.done(); }
});

test("PXD-9 picker: a pasted ((ref)) is that block alone; a bare uid comes first and the search still runs", async () => {
  const p = openPicker("pick-block");
  try {
    assert.deepEqual(await p.type("((blkUID001))"), ["blkUID001"]);
    assert.deepEqual(p.asked, [], "a pasted ref needs no search");
    assert.deepEqual(await p.type("blkUID001"), ["blkUID001", "pgu"], "the block first, listed once");
    assert.deepEqual(p.asked, [["pages", "blkUID001"], ["blocks", "blkUID001"]]);
  } finally { p.done(); }
  const q = openPicker("pick-query");
  try {
    assert.deepEqual(await q.type("Inventory"), ["qryUID001"], "the query picker lists query blocks only");
    assert.deepEqual(await q.type("blkUID001"), ["qryUID001"], "a bare uid of a block that is not a query is not offered");
  } finally { q.done(); }
  const r = openPicker("pick-refs");
  try {
    assert.deepEqual(await r.type("Knowledge"), ["pgu"]);
    assert.deepEqual(r.asked, [["pages", "Knowledge"]]);
  } finally { r.done(); }
});
