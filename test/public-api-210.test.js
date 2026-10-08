import assert from "node:assert/strict";
import test from "node:test";

import {
  API_EVENTS,
  API_VERSION,
  boardBounds,
  boardsFromRefRows,
  createPublicApi,
  fitThumbSize,
  installPublicApi,
  parseAddRef,
  thumbStroke,
  uninstallPublicApi,
} from "../src/model/public-api.js";

const METHODS = [
  "addCard",
  "addEventListener",
  "boardsOn",
  "boardsWith",
  "cardsOf",
  "help",
  "isAvailable",
  "open",
  "regionsOf",
  "removeEventListener",
  "spec",
  "tablesFromPdf",
  "thumbnail",
  "viewsOf",
];

function eventWin() {
  const win = {
    addEventListener(type, cb) {
      if (!win.listeners.has(type)) win.listeners.set(type, new Set());
      win.listeners.get(type).add(cb);
    },
    removeEventListener(type, cb) {
      win.listeners.get(type)?.delete(cb);
    },
    dispatchEvent(event) {
      for (const cb of win.listeners.get(event.type) || []) cb(event);
      return true;
    },
  };
  win.listeners = new Map();
  return win;
}

function block(uid, string, plexus, children = [], order = 0) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { plexus } : {},
    ":block/children": children,
  };
}

const REGION = "{{[[plexus-regions]]}}";
const IMG = "{{[[plexus-region]]: k=img d=imgcard01 f=0.1,0.2,0.3,0.4}} hamstring";
const VIEW = "{{[[plexus-region]]: k=view d=board0001 v=10,20,200,80 ids=cardA}} saved";
const AREA = "{{[[plexus-region]]: k=area d=ITvT3bqaL ids=pmm-3NChDbxPu-h6dynpr9M pad=10}} ((h6dynpr9M))";

function sampleBoard() {
  return block("boardA", "{{[[diagram]]:Alpha}}", { v: 2 }, [
    block("card1", "[[Page]]", { type: "card", x: 10, y: 20, w: 30, h: 40 }, [], 0),
    block("sec1", "Lane", { type: "section", x: 0, y: 0, w: 400, h: 300 }, [
      block("inner", "Hello note", { type: "card", x: 8, y: 9, w: 200, h: 80 }, [], 0),
    ], 1),
    block("stick1", "Sticky", { type: "text", x: 1, y: 2, w: 3, h: 4 }, [], 2),
    block("regs", REGION, { type: "regions" }, [
      block("regImg", IMG, null, [], 0),
      block("regView", VIEW, null, [], 1),
      block("regArea", AREA, null, [], 2),
    ], 3),
  ]);
}

test("API_VERSION, events, frozen methods, and help", () => {
  assert.equal(API_VERSION, 1);
  assert.deepEqual([...API_EVENTS], ["change", "mount", "unmount"]);
  const api = createPublicApi({ host: { graphName: () => "Readwisenotes" }, version: "2.10.1" });
  assert.equal(Object.isFrozen(api), true);
  assert.equal(api.apiVersion, 1);
  assert.equal(api.version, "2.10.1");
  assert.deepEqual(api.spec().methods, METHODS);
  assert.equal(api.spec().apiVersion, 1);
  assert.deepEqual(api.spec().events, ["change", "mount", "unmount"]);
  assert.equal(api.help().includes("apiVersion 1"), true);
  assert.throws(() => {
    api.extra = true;
  });
});

test("isAvailable is true only for a non-empty graph name", () => {
  assert.equal(createPublicApi({ host: { graphName: () => "Readwisenotes" } }).isAvailable(), true);
  assert.equal(createPublicApi({ host: { graphName: () => "" } }).isAvailable(), false);
  assert.equal(createPublicApi({ host: { graphName: () => null } }).isAvailable(), false);
  assert.equal(createPublicApi({ host: {} }).isAvailable(), false);
  assert.equal(createPublicApi({ host: { graphName: () => { throw new Error("down"); } } }).isAvailable(), false);
});

test("parseAddRef keeps one page or block ref", () => {
  assert.equal(parseAddRef("[[Page]]"), "[[Page]]");
  assert.equal(parseAddRef("  [[My Page]]  "), "[[My Page]]");
  assert.equal(parseAddRef("[[Page (draft)]]"), "[[Page (draft)]]");
  assert.equal(parseAddRef("((uid_1))"), "((uid_1))");
  assert.equal(parseAddRef("((abc-123))"), "((abc-123))");
  assert.equal(parseAddRef(""), null);
  assert.equal(parseAddRef("   "), null);
  assert.equal(parseAddRef(null), null);
  assert.equal(parseAddRef(undefined), null);
  assert.equal(parseAddRef("just prose"), null);
  assert.equal(parseAddRef("see [[Page]]"), null);
  assert.equal(parseAddRef("[[Page]] please"), null);
  assert.equal(parseAddRef("[[A]] [[B]]"), null);
  assert.equal(parseAddRef("[[A]][[B]]"), null);
  assert.equal(parseAddRef("((a)) ((b))"), null);
  assert.equal(parseAddRef("[[Page]] ((uid))"), null);
  assert.equal(parseAddRef("[[See ((note))]]"), null);
  assert.equal(parseAddRef("[[A [[B]]]]"), null);
  assert.equal(parseAddRef("[[]]"), null);
  assert.equal(parseAddRef("#tag"), null);
});

test("addCard checks the ref and v2 before the callback, then emits change once", async () => {
  const calls = [];
  const writes = [];
  const host = {
    graphName: () => "G",
    pullBoard(uid) {
      writes.push(["pull", uid]);
      return { ":block/uid": uid, ":block/string": "{{[[diagram]]:Alpha}}", ":block/props": { plexus: { v: 2 } } };
    },
    createBlock() { writes.push("create"); },
    updateBlock() { writes.push("update"); },
    updateString() { writes.push("string"); },
    updateProps() { writes.push("props"); },
    deleteBlock() { writes.push("delete"); },
    moveBlock() { writes.push("move"); },
  };
  const api = createPublicApi({
    host,
    addCard: (boardUid, string, x, y) => {
      calls.push({ boardUid, string, x, y });
      return { uid: "new1" };
    },
  });
  const seen = [];
  api.addEventListener("change", () => { throw new Error("listener boom"); });
  api.addEventListener("change", (detail) => seen.push(detail));
  api.addEventListener("nope", () => { throw new Error("unknown"); });
  api.addEventListener("change", "not-a-function");
  const made = await api.addCard("boardA", { ref: "  [[Page]]  " });
  assert.deepEqual(made, { uid: "new1" });
  assert.deepEqual(calls, [{ boardUid: "boardA", string: "[[Page]]", x: 40, y: 40 }]);
  assert.deepEqual(seen, [{ boardUid: "boardA", uid: "new1" }]);
  assert.deepEqual(writes.filter((row) => row !== "pull" && row[0] !== "pull"), []);

  await api.addCard("boardA", { ref: "((carduid))", at: { x: 5, y: 6 } });
  assert.deepEqual(calls[1], { boardUid: "boardA", string: "((carduid))", x: 5, y: 6 });
  assert.equal(seen.length, 2);

  const removed = () => seen.push("removed");
  api.addEventListener("change", removed);
  api.removeEventListener("change", removed);
  await api.addCard("boardA", { ref: "[[Page]]", at: { x: 0, y: 0 } });
  assert.equal(calls[2].x, 0);
  assert.equal(calls[2].y, 0);
  assert.equal(seen.includes("removed"), false);
  assert.equal(seen.length, 3);

  const before = calls.length;
  await assert.rejects(() => api.addCard("boardA", { ref: "see [[Page]]" }), (err) => err.message === "Bad ref");
  await assert.rejects(() => api.addCard("boardA", { ref: "" }), (err) => err.message === "Bad ref");
  await assert.rejects(() => api.addCard("boardA", { ref: "[[A]] [[B]]" }), (err) => err.message === "Bad ref");
  assert.equal(calls.length, before);

  const refused = createPublicApi({
    host: { pullBoard: () => ({ ":block/props": { plexus: { v: 1 } }, ":block/string": "{{[[diagram]]:Old}}" }) },
    addCard: () => { throw new Error("callback ran"); },
  });
  await assert.rejects(() => refused.addCard("boardA", { ref: "[[Page]]" }), (err) => err.message === "Not a board");

  const missing = createPublicApi({
    host: { pullBoard: () => null },
    addCard: () => { throw new Error("callback ran"); },
  });
  await assert.rejects(() => missing.addCard("boardA", { ref: "((uid))" }), (err) => err.message === "Not a board");

  const threw = createPublicApi({
    host: { pullBoard: () => { throw new Error("datascript"); } },
    addCard: () => { throw new Error("callback ran"); },
  });
  await assert.rejects(() => threw.addCard("boardA", { ref: "[[Page]]" }), (err) => err.message === "Not a board");

  const quiet = [];
  const failing = createPublicApi({
    host,
    addCard: () => { throw new Error("write failed"); },
  });
  failing.addEventListener("change", () => quiet.push("change"));
  await assert.rejects(() => failing.addCard("boardA", { ref: "[[Page]]" }), /write failed/);
  assert.deepEqual(quiet, []);
});

test("boardsFromRefRows keeps v2 boards and titles them with parseBoardTitle", () => {
  const rows = [
    ["boardA", "page1", "card1"],
    ["boardA", "page1", "card2"],
    ["boardB", "page1", "card3"],
    ["boardC", "page1", "card4"],
    ["boardD", "page1", "card5"],
  ];
  const out = boardsFromRefRows(rows, (uid) => {
    if (uid === "boardA") return { ":block/string": "{{[[diagram]]:Hold for leak }}", ":block/props": { ":plexus": { ":v": 2 } }, title: "Wrong" };
    if (uid === "boardB") return { string: "{{[[diagram]]}}", plexus: { v: 2 } };
    if (uid === "boardC") return { string: "{{[[diagram]]:Skip}}", plexus: { v: 1 } };
    if (uid === "boardD") throw new Error("pull failed");
    return null;
  });
  assert.deepEqual(out, [
    { uid: "boardA", title: "Hold for leak", card: "card1" },
    { uid: "boardB", title: "Untitled board", card: "card3" },
  ]);
  assert.deepEqual(boardsFromRefRows(null, () => ({ plexus: { v: 2 } })), []);
});

test("boardsWith reads ref rows and boardsOn does not", () => {
  const board = sampleBoard();
  const calls = [];
  const host = {
    graphName: () => "G",
    listBoards() {
      calls.push("list");
      return [
        { uid: "boardA", title: "Alpha", pageUid: "page1", pageTitle: "Lab", count: 3 },
        { uid: "boardB", title: "Beta", pageUid: "page2" },
        { uid: "boardC", title: "", pageUid: "page1" },
      ];
    },
    q(query, uid, pat) {
      calls.push(["q", query, uid, pat]);
      const rows = [
        ["boardA", "page9", "card1"],
        ["boardB", "page9", "card2"],
        ["boardC", "page9", "card3"],
      ];
      rows.rows = [["nope", "page9", "cardX"]];
      return rows;
    },
    pullBoard(uid) {
      if (uid === "boardA") return { ":block/string": "{{[[diagram]]:Alpha}}", ":block/props": { plexus: { v: 2 } } };
      if (uid === "boardB") return { ":block/string": "{{[[diagram]]:Beta}}", ":block/props": { plexus: { v: 2 } } };
      if (uid === "boardC") return { ":block/string": "{{[[diagram]]:Native}}", ":block/props": { plexus: { v: 1 } } };
      if (uid === "boardShown") return board;
      return null;
    },
  };
  const api = createPublicApi({ host });
  assert.deepEqual(api.boardsOn("page1"), [
    { uid: "boardA", title: "Alpha" },
    { uid: "boardC", title: "Untitled board" },
  ]);
  assert.deepEqual(calls, ["list"]);
  const found = api.boardsWith("pageTarget");
  assert.equal(calls[1][0], "q");
  assert.equal(calls[1][1].includes(":block/refs"), true);
  assert.equal(calls[1][1].includes("re-pattern"), true);
  assert.equal(calls[1][2], "pageTarget");
  assert.deepEqual(found, [
    { uid: "boardA", title: "Alpha", card: "card1" },
    { uid: "boardB", title: "Beta", card: "card2" },
  ]);
  assert.equal(calls.filter((row) => row === "list").length, 1);
  assert.deepEqual(api.cardsOf("boardShown"), [
    { uid: "card1", kind: "page", title: "Page", rect: { x: 10, y: 20, w: 30, h: 40 }, parent: "boardA" },
    { uid: "inner", kind: "note", title: "Hello note", rect: { x: 8, y: 9, w: 200, h: 80 }, parent: "sec1" },
  ]);
  assert.deepEqual(api.regionsOf("boardShown"), [
    { uid: "regImg", kind: "img", caption: "hamstring" },
    { uid: "regView", kind: "view", caption: "saved" },
    { uid: "regArea", kind: "area", caption: "((h6dynpr9M))" },
  ]);
  assert.deepEqual(api.viewsOf("boardShown"), [
    { uid: "regView", caption: "saved", v: [10, 20, 200, 80], ids: ["cardA"] },
  ]);
});

test("open and thumbnail forward and do not write", async () => {
  const writes = [];
  const host = {
    graphName: () => "G",
    createBlock() { writes.push("create"); },
    updateBlock() { writes.push("update"); },
    updateString() { writes.push("string"); },
    updateProps() { writes.push("props"); },
    deleteBlock() { writes.push("delete"); },
    moveBlock() { writes.push("move"); },
    q() { writes.push("q"); },
    listBoards() { writes.push("list"); },
  };
  let opened = null;
  let drawn = null;
  const viewOpts = { view: "view1" };
  const api = createPublicApi({
    host,
    openBoard: (uid, opts) => {
      opened = { uid, opts };
      return Promise.resolve("opened");
    },
    thumbnail: (uid, opts) => {
      drawn = { uid, opts };
      return Promise.resolve("png");
    },
  });
  assert.equal(await api.open("boardA", { card: "card1" }), "opened");
  assert.deepEqual(opened, { uid: "boardA", opts: { card: "card1" } });
  assert.equal(await api.open("boardA", viewOpts), "opened");
  assert.equal(opened.opts, viewOpts);
  assert.deepEqual(await api.thumbnail("boardA"), "png");
  assert.deepEqual(drawn, { uid: "boardA", opts: { maxWidth: 160 } });
  assert.equal(drawn.opts.maxWidth * 2 === 320, true);
  assert.notEqual(drawn.opts.maxWidth, 320);
  const wide = { maxWidth: 160, pad: 2 };
  await api.thumbnail("boardA", wide);
  assert.equal(drawn.opts.maxWidth, 160);
  assert.equal(drawn.opts.pad, 2);
  await api.thumbnail("boardA", { maxWidth: 480 });
  assert.equal(drawn.opts.maxWidth, 480);
  assert.deepEqual(writes, []);
});

test("thumbnail size, stroke, and board bounds", () => {
  assert.deepEqual(fitThumbSize(320, 160, 160), { width: 160, height: 80 });
  assert.deepEqual(fitThumbSize(160, 80, 160), { width: 160, height: 80 });
  assert.deepEqual(fitThumbSize(80, 40, 160), { width: 80, height: 40 });
  assert.equal(fitThumbSize(160, 80, 160).width === 320, false);
  assert.equal(fitThumbSize(0, 100, 160), null);
  assert.equal(fitThumbSize(100, 0, 160), null);
  assert.equal(fitThumbSize(100, 50, 0), null);
  assert.equal(thumbStroke(""), "#5c7080");
  assert.equal(thumbStroke("   "), "#5c7080");
  assert.equal(thumbStroke(null), "#5c7080");
  assert.equal(thumbStroke(undefined), "#5c7080");
  assert.equal(thumbStroke("currentColor"), "#5c7080");
  assert.equal(thumbStroke(" CurrentColor "), "#5c7080");
  assert.equal(thumbStroke("#112233"), "#112233");
  assert.deepEqual(boardBounds([]), { x: 0, y: 0, w: 160, h: 160 });
  assert.deepEqual(boardBounds(null), { x: 0, y: 0, w: 160, h: 160 });
  assert.deepEqual(boardBounds([{ x: 10, y: 20, w: 30, h: 40 }, { x: -5, y: 0, w: 10, h: 10 }]), {
    x: -5, y: 0, w: 45, h: 60,
  });
});

test("install leaves a foreign global and unload always fires", () => {
  const api = createPublicApi({ host: { graphName: () => "G" }, version: "2.10.1" });
  const win = eventWin();
  win.__plexusDiagram = { debug: true };
  const ready = [];
  const unload = [];
  win.addEventListener("plexus-diagram:ready", (event) => ready.push(event.detail));
  win.addEventListener("plexus-diagram:unload", (event) => unload.push(event.detail));

  const foreign = { other: true };
  win.PlexusDiagram = foreign;
  assert.equal(installPublicApi(api, { win }), false);
  assert.equal(win.PlexusDiagram, foreign);
  assert.deepEqual(ready, []);

  delete win.PlexusDiagram;
  assert.equal(installPublicApi(api, { win }), true);
  assert.equal(win.PlexusDiagram, api);
  assert.deepEqual(ready, [{ apiVersion: 1 }]);
  assert.deepEqual(win.__plexusDiagram, { debug: true });

  assert.equal(uninstallPublicApi(api, { win }), true);
  assert.equal(win.PlexusDiagram, undefined);
  assert.deepEqual(unload, [{ apiVersion: 1 }]);
  assert.deepEqual(win.__plexusDiagram, { debug: true });

  win.PlexusDiagram = foreign;
  assert.equal(uninstallPublicApi(api, { win }), false);
  assert.equal(win.PlexusDiagram, foreign);
  assert.deepEqual(unload, [{ apiVersion: 1 }, { apiVersion: 1 }]);
  assert.deepEqual(win.__plexusDiagram, { debug: true });
});
