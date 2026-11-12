import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createAiTools } from "../src/model/ai-tools.js";
import { buildBoard, worldRects } from "../src/model/board.js";
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
import { acquireSession, resetSessions } from "../src/session.js";
import { createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const METHODS = [
  "addCard",
  "addCards",
  "addEventListener",
  "addSection",
  "boardsOn",
  "boardsWith",
  "cardsOf",
  "connect",
  "help",
  "isAvailable",
  "listBoards",
  "open",
  "regionsOf",
  "removeEventListener",
  "spec",
  "tablesFromPdf",
  "thumbnail",
  "viewsOf",
];

const WRITE_CAPS = ["listBoards", "addCards", "addSection", "connect"];
const NOT_BOARD = "Not a Plexus board. Open it in Roam and run Plexus: Enhance this diagram first.";

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

test("install leaves a foreign global and unload fires only for the installing copy", () => {
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
  assert.deepEqual(unload, [{ apiVersion: 1 }], "a refused copy does not announce an unload");
  assert.deepEqual(win.__plexusDiagram, { debug: true });
});

function seedBoard(fake) {
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: 1 }, plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "c2", string: "[[B]]", props: { plexus: { x: 400, y: 0, w: 280, h: 160 } } },
      {
        uid: "s1",
        string: "Group",
        props: { plexus: { type: "section", x: 0, y: 300, w: 500, h: 300 } },
        children: [{ uid: "c3", string: "[[C]]", props: { plexus: { x: 20, y: 60, w: 280, h: 160 } } }],
      },
    ],
  });
  fake.seedBlock?.({ uid: "plain", string: "not a board" });
}

function recorder(fake) {
  const seen = [];
  const orig = fake.api.data.block.create;
  fake.api.data.block.create = (arg) => {
    seen.push(structuredClone(arg));
    return orig(arg);
  };
  return seen;
}

function live() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  seedBoard(fake);
  fake.trackUndo = true;
  const seen = recorder(fake);
  let sessions = 0;
  const api = createPublicApi({
    host: {
      graphName: () => "g",
      listBoards: () => [
        { uid: "b1", title: "Main", pageTitle: "Lab Notes", pageUid: "p1", count: 4 },
        { uid: "b2", title: "Other", pageTitle: "Zed", pageUid: "p2", count: 1 },
      ],
      pullBoard: (uid) => host.pullBoard(uid),
    },
    withSession: async (uid, fn) => {
      sessions += 1;
      const session = acquireSession(uid, { host, linkDelay: 0 });
      try { return await fn(session); } finally { session.release(); }
    },
  });
  return { fake, host, seen, api, sessions: () => sessions };
}

const cardCount = (host) => [...buildBoard(host.pullBoard("b1")).items.values()].filter((item) => item.type === "card").length;
const edgeList = (host) => [...buildBoard(host.pullBoard("b1")).edges.values()].filter((edge) => edge.valid);

test("capabilities always end with the four write names", () => {
  const bare = createPublicApi({ host: { graphName: () => "g" } });
  assert.deepEqual([...bare.capabilities], WRITE_CAPS);
  assert.deepEqual(bare.spec().capabilities, WRITE_CAPS);
  const extra = createPublicApi({ host: { graphName: () => "g" }, capabilities: ["tablesFromPdf", "listBoards"] });
  assert.deepEqual([...extra.capabilities], ["tablesFromPdf", ...WRITE_CAPS]);
});

test("listBoards filters by page title and turns a throw into []", () => {
  const { api } = live();
  assert.equal(api.listBoards().length, 2);
  assert.deepEqual(api.listBoards({ page: "LAB" }), [{ uid: "b1", title: "Main", pageUid: "p1", pageTitle: "Lab Notes", cards: 4 }]);
  assert.deepEqual(api.listBoards(null), api.listBoards());
  const down = createPublicApi({ host: { listBoards: () => { throw new Error("datascript"); } } });
  assert.deepEqual(down.listBoards({ page: "lab" }), []);
  assert.deepEqual(createPublicApi({ host: {} }).listBoards(), []);
});

test("addCards places, joins a section even when placed, emits change, and is one undo", async () => {
  const { api, host, seen, sessions } = live();
  const changes = [];
  api.addEventListener("change", (detail) => changes.push(detail));
  const out = await api.addCards("((b1))", [{ text: "  [[N1]] " }, { text: "note two" }]);
  assert.equal(out.count, 2);
  assert.deepEqual(out.added.map((row) => row.text), ["[[N1]]", "note two"]);
  assert.equal(sessions(), 1);
  const board = buildBoard(host.pullBoard("b1"));
  const rects = worldRects(board);
  assert.equal(rects.get(out.added[0].uid).x, 0);
  assert.equal(rects.get(out.added[0].uid).y, 680);
  assert.equal(rects.get(out.added[1].uid).x, 320);
  assert.deepEqual(changes, [{ boardUid: "b1", uids: out.added.map((row) => row.uid) }]);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((arg) => !Object.hasOwn(arg.block, "user-uid")));

  const pinned = await api.addCards("b1", [{ text: "pinned", x: 2000, y: 2000 }]);
  assert.equal(worldRects(buildBoard(host.pullBoard("b1"))).get(pinned.added[0].uid).x, 2000);

  const joined = await api.addCards("b1", [{ text: "[[In]]", x: 40, y: 400 }], { section: "((s1))" });
  assert.equal(buildBoard(host.pullBoard("b1")).items.get(joined.added[0].uid).parentUid, "s1");

  const before = cardCount(host);
  await assert.rejects(() => api.addCards("b1", []), (err) => err.message === "Give at least one card");
  await assert.rejects(() => api.addCards("b1", [{ text: "  " }]), (err) => err.message === "Every card needs text");
  await assert.rejects(() => api.addCards("b1", [{ text: "x" }], { section: "c1" }), (err) => err.message === "Not a section on this board: c1");
  await assert.rejects(() => api.addCards("plain", [{ text: "x" }]), (err) => err.message === NOT_BOARD);
  await assert.rejects(() => api.addCards("", [{ text: "x" }]), (err) => err.message === "Give a board uid");
  const many = Array.from({ length: 46 }, (_, i) => ({ text: `n${i}` }));
  await assert.rejects(() => api.addCards("b1", many), (err) => err.message === "At most 45 cards per call (Roam undo holds 50 changes)");
  assert.equal(cardCount(host), before);
  assert.equal(changes.length, 3);

  const undoHost = live();
  await undoHost.api.addCards("b1", [{ text: "[[U1]]" }, { text: "[[U2]]" }]);
  assert.equal(cardCount(undoHost.host), 5);
  const session = acquireSession("b1", { host: undoHost.host, linkDelay: 0 });
  await session.undo();
  assert.equal(cardCount(undoHost.host), 3);
  session.release();
});

test("addCards does not emit change when the write is refused", async () => {
  const { api } = live();
  const changes = [];
  api.addEventListener("change", () => changes.push("change"));
  await assert.rejects(() => api.addCards("b1", [{ text: "x" }], { section: "nope" }), /Not a section/);
  await assert.rejects(() => api.addCards("plain", [{ text: "x" }]), /Not a Plexus board/);
  assert.deepEqual(changes, []);
});

test("the AI tool still leaves an explicitly placed card out of the section", async () => {
  const { host } = live();
  const tools = createAiTools({
    listBoards: () => [],
    pullBoard: (uid) => host.pullBoard(uid),
    withSession: async (uid, fn) => {
      const session = acquireSession(uid, { host, linkDelay: 0 });
      try { return await fn(session); } finally { session.release(); }
    },
  });
  const add = tools.find((tool) => tool.name === "add_cards");
  const out = await add.handler({ board: "b1", section: "s1", cards: [{ text: "[[Out]]", x: 2000, y: 2000 }] }, { tokenUserUid: "ai-user" });
  assert.notEqual(buildBoard(host.pullBoard("b1")).items.get(out.added[0]).parentUid, "s1");
});

test("addSection uses the same defaults as add_section and emits change", async () => {
  const { api, host } = live();
  const changes = [];
  api.addEventListener("change", (detail) => changes.push(detail));
  const made = await api.addSection("b1", {});
  assert.deepEqual(made.rect, { x: 0, y: 680, w: 640, h: 400 });
  const item = buildBoard(host.pullBoard("b1")).items.get(made.uid);
  assert.equal(item.type, "section");
  assert.equal(item.title, "Section");
  const placed = await api.addSection("((b1))", { title: "Lane", x: 10, y: 20, w: 100, h: 80 });
  assert.deepEqual(placed.rect, { x: 10, y: 20, w: 100, h: 80 });
  assert.deepEqual(changes.map((row) => row.boardUid), ["b1", "b1"]);
  assert.deepEqual(changes[0].uids, [made.uid]);
  await assert.rejects(() => api.addSection("plain", { title: "Nope" }), (err) => err.message === NOT_BOARD);
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const before = [...buildBoard(host.pullBoard("b1")).items.values()].filter((item) => item.type === "section").length;
  await session.undo();
  assert.equal([...buildBoard(host.pullBoard("b1")).items.values()].filter((item) => item.type === "section").length, before - 1);
  session.release();
});

test("connect validates like connect_cards, groups an array into one undo, and emits change", async () => {
  const { api, host, seen } = live();
  const changes = [];
  api.addEventListener("change", (detail) => changes.push(detail));
  const one = await api.connect("((b1))", { from: "c1", to: "c2", label: "next", direction: "sideways" });
  assert.equal(one.uids.length, 1);
  assert.equal(edgeList(host)[0].dir, "one");
  assert.equal(edgeList(host)[0].label, "next");
  assert.equal(edgeList(host)[0].from, "c1");
  assert.ok(seen.every((arg) => !Object.hasOwn(arg.block, "user-uid")));

  const two = await api.connect("b1", [
    { from: "c2", to: "c3", direction: "two", label: "down" },
    { from: "c3", to: "c1", direction: "none" },
  ]);
  assert.equal(two.uids.length, 2);
  assert.equal(edgeList(host).length, 3);
  assert.deepEqual(changes[0], { boardUid: "b1", uids: one.uids });
  assert.deepEqual(changes[1], { boardUid: "b1", uids: two.uids });

  await assert.rejects(() => api.connect("b1", []), (err) => err.message === "Give at least one connection");
  await assert.rejects(() => api.connect("b1", null), (err) => err.message === "Give at least one connection");
  await assert.rejects(() => api.connect("b1", { from: "c1", to: "missing" }), (err) => err.message === "Not an item on this board: missing");
  await assert.rejects(() => api.connect("b1", { from: "c1", to: "c1" }), (err) => err.message === "Could not connect these two");
  await assert.rejects(() => api.connect("plain", { from: "c1", to: "c2" }), (err) => err.message === NOT_BOARD);
  await assert.rejects(() => api.connect("", { from: "c1", to: "c2" }), (err) => err.message === "Give a board uid");
  const many = Array.from({ length: 46 }, () => ({ from: "c1", to: "c2" }));
  await assert.rejects(() => api.connect("b1", many), (err) => err.message === "At most 45 connections per call (Roam undo holds 50 changes)");
  assert.equal(changes.length, 2);

  const session = acquireSession("b1", { host, linkDelay: 0 });
  await session.undo();
  assert.equal(edgeList(host).length, 1);
  session.release();
});
