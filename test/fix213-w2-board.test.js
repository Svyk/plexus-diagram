// 2.13.0 fix pass, worker W2. Each test mounts the real board view over a fake host and session.
import { noteSpeedFlags } from "../src/settings.js";
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { CONTEXTS_QUERY, mountBoardView, pinAnnotateToast, clearPinnedToast, openHighlightDialog } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const BOARD = "board0001";

const block = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});

function pulled({ extra = [] } = {}) {
  return {
    ":block/uid": BOARD,
    ":block/string": "{{[[diagram]]:Lab}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      block("imgCard01", "![Shot](https://example.com/shot.png)", { ":x": 0, ":y": 0, ":w": 280, ":h": 160 }, 0, [
        block("regCont01", "{{[[plexus-regions]]}}", null, 0, [
          block("regionAA1", "{{[[plexus-region]]: k=img d=imgBlk001 f=0.2500,0.2000,0.5000,0.5000}} one", null, 0),
          block("regionBB2", "{{[[plexus-region]]: k=img d=imgBlk001 f=0.1000,0.1000,0.2000,0.2000}} two", null, 1),
        ]),
      ]),
      block("cardAAAA1", "Alpha [[Beta]]", { ":x": 400, ":y": 0, ":w": 200, ":h": 100 }, 1),
      block("cardBBBB2", "Bravo [[Beta]]", { ":x": 400, ":y": 300, ":w": 200, ":h": 100 }, 2),
      block("cardCCCC3", "Charlie [[Beta]]", { ":x": 0, ":y": 500, ":w": 200, ":h": 100 }, 5),
      block("blkCard01", "((blkTarget1))", { ":x": 700, ":y": 0, ":w": 200, ":h": 100 }, 3),
      block("edgesEEE5", "Connections", { ":type": "edges" }, 4, [
        block("edgeFFFF6", "((cardAAAA1)) → ((cardBBBB2))", { ":type": "edge", ":from": "cardAAAA1", ":to": "cardBBBB2" }, 0, [
          block("whyAAAA01", "because it is so", null, 0),
        ]),
      ]),
      ...extra,
    ],
  };
}

function fakeHost(overrides = {}) {
  const calls = { blockString: [], q: [], treeFor: [], listBoards: 0, sidebar: [] };
  return {
    calls,
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {},
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString(uid) { calls.blockString.push(uid); return uid === "blkTarget1" ? "target text" : uid === "plainUid1" ? "just a block" : null; },
    pageUid: () => null,
    openBlock() {},
    openInSidebar(uid, kind) { calls.sidebar.push([uid, kind]); },
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    q(query, ...args) { calls.q.push([query, ...args]); return []; },
    pdfHighlightTree(uid) { calls.treeFor.push(uid); return []; },
    listBoards() { calls.listBoards += 1; return Promise.resolve([]); },
    ...overrides,
  };
}

function fakeSession(board) {
  const handlers = new Map();
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    mutations,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
    setLinkMode() {},
  };
  for (const name of ["commitMove", "commitRects", "createCard", "createText", "createSection", "wrapInSection", "createBoard", "wrapInBoard",
    "renameBoard", "deleteItems", "deleteEdges", "setColor", "setCollapsed", "setFontSize", "setString", "growToFit",
    "addEdge", "updateEdge", "flipEdge", "undo", "redo", "setCollapsedMany", "collapseAll", "setPinned", "setBoardBackground", "setFit",
    "fitSection", "tidyItems", "sortOutline", "sameSize", "resetSize", "fitToContent", "writeToGraph", "setItemStyle", "addRefCards",
    "addView", "renameView", "deleteView"]) {
    session[name] = rec(name);
  }
  return session;
}

function mount({ hostOverrides = {}, tree = pulled(), settings = {}, mountOptions = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  // board-view takes the MutationObserver at mount; keep its callback so a test can fire a class change.
  const observers = [];
  const Base = globalThis.MutationObserver;
  globalThis.MutationObserver = class extends Base {
    constructor(cb) { super(cb); observers.push(cb); }
  };
  stub.localStorage.setItem(`plexus-diagram:vp:Svy:${BOARD}`, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(tree);
  const session = fakeSession(board);
  const host = fakeHost(hostOverrides);
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: (k) => settings[k] },
    version: "2.13.0",
    ...mountOptions,
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  const done = () => {
    view.dispose();
    globalThis.MutationObserver = Base;
    restore();
  };
  return { stub, board, session, host, mountEl, view, flush, root: view.root, observers, done };
}

const menuIds = (f) => [...f.root.querySelectorAll(".pxd-menu__item")].map((row) => row.dataset.id);
const shell = (f, uid) => f.root.querySelector(`[data-uid="${uid}"]`);
const pick = (f, id) => {
  const row = [...f.root.querySelectorAll(".pxd-menu__item")].find((node) => node.dataset.id === id);
  assert.ok(row, `menu row ${id} in ${menuIds(f)}`);
  f.stub.dispatch(row, "click", { button: 0 });
};
const closeMenu = (f) => f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });

// ---------------------------------------------------------------- A3

test("A3: the references query keeps top-level blocks, whose parent is the page and has no string", () => {
  assert.match(CONTEXTS_QUERY, /\[\(get-else \$ \?p :block\/string ""\) \?ps\]/);
  assert.doesNotMatch(CONTEXTS_QUERY, /\[\?p :block\/string \?ps\]/);
});

// ---------------------------------------------------------------- A6

test("A6: lane marks survive a card re-sync, and a snapshot preview moves the arrows", async () => {
  const times = new Map([["imgCard01", 1000], ["cardAAAA1", 1000], ["cardBBBB2", 1000], ["cardCCCC3", 1000], ["edgeFFFF6", 1000], ["blkCard01", Date.now()]]);
  const f = mount({
    hostOverrides: { q: (query, uids) => (Array.isArray(uids) ? uids.filter((u) => times.has(u)).map((u) => [u, times.get(u)]) : []) },
  });
  try {
    await f.flush();
    f.board.snapshots = [{ title: "Earlier", items: [{ uid: "cardBBBB2", x: 1200, y: 900, w: 200, h: 100 }] }];
    f.stub.dispatch(f.root, "pointerenter", {});
    f.stub.dispatch(f.stub.window, "keydown", { key: "T", shiftKey: true });
    await f.flush();
    assert.ok(f.root.querySelector(".pxd-memory"), "the lane bar is mounted");
    const late = shell(f, "blkCard01");
    assert.equal(late.classList.contains("pxd-item--future"), true, "a card created after the first step starts hidden");

    // A change to that card re-syncs its shell; the lane state must not be lost with the class list.
    f.session.emit("change", { dirty: new Set(["blkCard01"]), structural: false });
    await f.flush();
    assert.equal(shell(f, "blkCard01").classList.contains("pxd-item--future"), true, "the future mark is re-applied after the re-sync");

    const edge = () => f.root.querySelector(".pxd-edge path")?.getAttribute("d");
    const before = edge();
    f.stub.dispatch(f.root.querySelector(".pxd-memory__tick"), "click", { button: 0 });
    await f.flush();
    assert.equal(shell(f, "cardBBBB2").style.transform, "translate(1200px, 900px)");
    assert.notEqual(edge(), before, "the arrow follows the previewed layout");

    // The re-sync after a preview keeps both the shell position and the arrow.
    f.session.emit("change", { dirty: new Set(["cardBBBB2"]), structural: false });
    await f.flush();
    assert.equal(shell(f, "cardBBBB2").style.transform, "translate(1200px, 900px)");
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- A7

test("A7: suggested lines follow a card move, and the action menu is a styled links menu at the line", async () => {
  const f = mount();
  try {
    await f.flush();
    const linksBtn = f.root.querySelector(".pxd-toolbar__links");
    assert.ok(linksBtn, "the toolbar has the links button");
    f.stub.dispatch(linksBtn, "click", { button: 0 });
    const rows = [...f.stub.document.body.querySelectorAll(".pxd-linksmenu__row")];
    const suggest = rows.find((row) => row.textContent === "Suggest shared refs");
    assert.ok(suggest, "suggest mode row");
    f.stub.dispatch(suggest, "click", { button: 0 });
    await f.flush();
    const line = () => f.root.querySelector(".pxd-suggest__line");
    assert.ok(line(), "cards sharing [[Beta]] get a dotted line");
    const before = line().getAttribute("d");

    f.session.rects.set("cardCCCC3", { ...f.session.rects.get("cardCCCC3"), y: 900 });
    f.session.emit("change", { dirty: new Set(["cardCCCC3"]), structural: false });
    await f.flush();
    assert.notEqual(line().getAttribute("d"), before, "a card move refreshes the dotted line");

    f.stub.dispatch(line(), "pointerdown", { button: 0 });
    const menu = f.stub.document.body.querySelector(".pxd-linksmenu");
    assert.ok(menu, "the action menu opens");
    assert.equal(menu.classList.contains("pxd-root"), true, "it carries pxd-root so the stylesheet reaches it");
    assert.deepEqual([...menu.querySelectorAll(".pxd-linksmenu__row")].map((n) => n.textContent), ["Connect", "Link text", "Dismiss"]);
    assert.notEqual(`${menu.style.left}|${menu.style.top}`, "24px|24px", "it is not pinned to the corner");
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- A8

test("A8: the Edit why popover anchors at the connection midpoint when the label is empty", async () => {
  const f = mount();
  try {
    await f.flush();
    f.root.querySelector(".pxd-label")?.getBoundingClientRect;
    const label = f.root.querySelector(".pxd-label");
    assert.ok(label, "the connection has a label element");
    assert.equal(label.classList.contains("pxd-label--empty"), false, "a connection with a why is not hidden as empty");
    assert.equal(label.classList.contains("pxd-label--why"), true);
    label.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    f.view.controller.select([]);
    f.stub.dispatch(f.root.querySelector(".pxd-edge__hit") || f.root.querySelector(".pxd-edge"), "contextmenu", { button: 2, clientX: 30, clientY: 30 });
    pick(f, "edit-why");
    const pop = f.stub.document.body.querySelector(".pxd-why");
    assert.ok(pop, "the popover opens");
    const left = Number.parseFloat(pop.style.left);
    const top = Number.parseFloat(pop.style.top);
    assert.ok(left > 24 || top > 24, `anchored off the top-left corner, got ${left},${top}`);
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- B8

test("B8: a dropped ((uid)) is checked for a date string before any tree is pulled", async () => {
  const f = mount();
  try {
    await f.flush();
    const data = { "roam/block-uid-list": "plainUid1", "roam/block-uid-list-only-parents": "plainUid1" };
    f.stub.dispatch(f.root, "drop", {
      clientX: 300,
      clientY: 300,
      dataTransfer: { getData: (type) => data[type] || "", types: Object.keys(data), files: [] },
    });
    await f.flush();
    assert.deepEqual(f.host.calls.treeFor, [], "no pdfHighlightTree pull for a non-date block");
    assert.ok(f.session.mutations.some((m) => m[0] === "addRefCards"), "the drop still places the card");
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- B9

test("B9: the highlight dialog reports how many highlights the 45 cap left out", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const rows = Array.from({ length: 60 }, (_, i) => ({ uid: `hl${String(i).padStart(3, "0")}`, color: "yellow", page: 1, snippet: `h${i}`, enabled: true, group: "g" }));
    let seen = null;
    const dialog = openHighlightDialog(stub.document, { rows, onPlace: (items, info) => { seen = { count: items.length, info }; } });
    stub.document.body.append(dialog);
    dialog.querySelector(".pxd-hl-all").click();
    dialog.querySelector(".pxd-hl-grid").click();
    assert.equal(seen.count, 45);
    assert.equal(seen.info.omitted, 15);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------- B11

test("B11: the per-row page label has its own class, apart from the page filter", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const dialog = openHighlightDialog(stub.document, { rows: [{ uid: "hl001", color: "yellow", page: 3, snippet: "x", enabled: true, group: "g" }] });
    stub.document.body.append(dialog);
    assert.equal(dialog.querySelectorAll(".pxd-hl-page").length, 1, "only the filter select");
    assert.equal(dialog.querySelector(".pxd-hl-row .pxd-hl-rowpage").textContent, "p. 3");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------- C12

test("C12: the pinned annotate toast has no inline style and clearPinnedToast drops node and timer", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const timers = new Map();
  const win = {
    setTimeout(fn, ms) { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  try {
    pinAnnotateToast(stub.document, win);
    const node = stub.document.body.querySelector(".pxd-toast--pin");
    assert.ok(node);
    assert.equal(node.className, "pxd-toast pxd-toast--pin");
    assert.equal(node.getAttribute("style") || "", "");
    assert.equal(timers.size, 1);
    clearPinnedToast();
    assert.equal(stub.document.body.querySelector(".pxd-toast--pin"), null);
    assert.equal(timers.size, 0, "the removal timer is cancelled with the toast");
    pinAnnotateToast(stub.document, win);
    pinAnnotateToast(stub.document, win);
    assert.equal(stub.document.body.querySelectorAll(".pxd-toast--pin").length, 1);
    assert.equal(timers.size, 1, "a second pin replaces the first timer");
    clearPinnedToast();
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------- D1 / D10

test("D1: deleting an image card with regions asks first, with the count; Cancel keeps it", async () => {
  const f = mount();
  try {
    await f.flush();
    f.view.controller.select(["imgCard01"]);
    f.view.controller.deleteSelection(false);
    const dialog = f.root.querySelector(".pxd-view-dialog");
    assert.ok(dialog, "a dialog opens before anything is deleted");
    assert.match(dialog.querySelector(".pxd-region-delete__message").textContent, /2 regions/);
    assert.equal(f.session.mutations.filter((m) => m[0] === "deleteItems").length, 0);
    f.stub.dispatch(dialog.querySelector(".pxd-region-delete-cancel"), "click", { button: 0 });
    await f.flush();
    assert.equal(f.root.querySelector(".pxd-view-dialog"), null);
    assert.equal(f.session.mutations.filter((m) => m[0] === "deleteItems").length, 0, "Cancel deletes nothing");

    f.view.controller.select(["imgCard01"]);
    f.view.controller.deleteSelection(false);
    f.stub.dispatch(f.root.querySelector(".pxd-region-delete"), "click", { button: 0 });
    await f.flush();
    assert.equal(f.session.mutations.filter((m) => m[0] === "deleteItems").length, 1, "Delete goes through");
  } finally {
    f.done();
  }
});

test("D1: a card without regions deletes at once", async () => {
  const f = mount();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1"]);
    f.view.controller.deleteSelection(false);
    assert.equal(f.root.querySelector(".pxd-view-dialog"), null);
    assert.equal(f.session.mutations.filter((m) => m[0] === "deleteItems").length, 1);
  } finally {
    f.done();
  }
});

test("D10: the delete dialog focuses Cancel and Escape closes it", async () => {
  const f = mount();
  try {
    await f.flush();
    f.view.controller.select(["imgCard01"]);
    f.view.controller.deleteSelection(false);
    const dialog = f.root.querySelector(".pxd-view-dialog");
    assert.ok(dialog);
    assert.equal(f.stub.document.activeElement, dialog.querySelector(".pxd-region-delete-cancel"), "Cancel has focus");
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    assert.equal(f.root.querySelector(".pxd-view-dialog"), null, "Escape closes it");
    assert.equal(f.session.mutations.filter((m) => m[0] === "deleteItems").length, 0);
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- D5

test("D5: cards repaint when the dark flag flips, not on any other html/body class change", async () => {
  const f = mount();
  try {
    await f.flush();
    const fire = () => { for (const cb of f.observers) cb([], {}); };
    const count = () => f.host.calls.blockString.filter((u) => u === "blkTarget1").length;
    const base = count();
    f.stub.document.body.classList.add("some-other-class");
    fire();
    f.stub.flushTimers?.();
    assert.equal(count(), base, "an unrelated class change repaints nothing");
    f.stub.document.body.classList.add("bp3-dark");
    fire();
    assert.ok(count() > base, "the dark flag flips and the shells repaint");
    const after = count();
    fire();
    f.stub.flushTimers?.();
    assert.equal(count(), after, "the settle pass repaints nothing when nothing flipped");
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- D9

test("D9: a fullscreen board under a body-focused key still reads it", async () => {
  const f = mount();
  try {
    await f.flush();
    f.view.setFullscreen(true);
    await f.flush();
    f.stub.document.activeElement?.blur?.();
    f.stub.dispatch(f.stub.document.body, "keydown", { key: "?", shiftKey: true });
    assert.ok(f.root.querySelector(".pxd-sheet"), "the shortcut sheet opens");
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- D6 / D7

test("D6/D7: a saved-view map draws only the cards in its frame, and view changes do not reload boards", async () => {
  const many = Array.from({ length: 60 }, (_, i) => block(`bulk${String(i).padStart(5, "0")}`, `card ${i}`, { ":x": 2000 + (i % 10) * 30, ":y": 2000 + Math.floor(i / 10) * 30, ":w": 20, ":h": 20 }, 10 + i));
  const f = mount({ tree: pulled({ extra: many }) });
  try {
    await f.flush();
    f.board.views = [
      { uid: "viewAAAA1", caption: "Corner", v: [0, 0, 700, 200], ids: [] },
      { uid: "viewBBBB2", caption: "Crowd", v: [1900, 1900, 600, 600], ids: [] },
    ];
    f.stub.dispatch(f.root.querySelector(".pxd-toolbar__add"), "click", { button: 0 });
    f.stub.dispatch([...f.root.querySelectorAll(".pxd-panel__tab")][2], "click", { button: 0 });
    await f.flush();
    const rowsOf = (uid) => f.root.querySelector(`[data-view="${uid}"] .pxd-view-map`);
    const crowd = rowsOf("viewBBBB2");
    assert.ok(crowd, "the Boards tab lists the saved views");
    const cardRects = (svg) => svg.querySelectorAll("rect").length - 1;
    assert.equal(cardRects(crowd), 40, "a crowded view map is capped at 40 card rects");
    const corner = rowsOf("viewAAAA1");
    assert.ok(cardRects(corner) < 10, "cards outside the frame are not drawn");
    const loaded = f.host.calls.listBoards;
    f.stub.dispatch(f.root.querySelector('[data-view="viewAAAA1"] [data-act="delete"]'), "click", { button: 0 });
    await f.flush();
    assert.equal(f.session.mutations.some((m) => m[0] === "deleteView"), true);
    assert.equal(f.host.calls.listBoards, loaded, "deleting a view does not re-query every board");
  } finally {
    f.done();
  }
});

// ---------------------------------------------------------------- B1

test("B1: an open PDF reader stays in the pane, so the arrow stays on the card", async () => {
  noteSpeedFlags('{"budgetedMount":false}'); // card bodies mount in wall-clock chunks; a loaded machine must not change what the test sees
  const tree = pulled({ extra: [block("pdfCard001", "{{[[pdf]]: https://example.test/papers/Risk.pdf}}", { ":x": 0, ":y": 800, ":w": 280, ":h": 160 }, 20)] });
  tree[":block/children"].find((c) => c[":block/uid"] === "edgesEEE5")[":block/children"].push(
    block("edgePDF001", "((pdfCard001)) → ((cardAAAA1))", { ":type": "edge", ":from": "pdfCard001", ":to": "cardAAAA1" }, 1),
  );
  const f = mount({ tree, hostOverrides: { pdfCover: () => ({ title: "Risk", label: "3 pages", pageUid: null }) } });
  try {
    await f.flush();
    const path = () => [...f.root.querySelectorAll(".pxd-edge")].find((g) => g.dataset.uid === "edgePDF001")?.querySelector("path")?.getAttribute("d");
    const before = path();
    assert.ok(before, "the pdf edge is drawn");
    const open = shell(f, "pdfCard001").querySelector(".pxd-pdf-open");
    assert.ok(open, "the cover has an Open reader button");
    f.stub.dispatch(open, "click", { button: 0 });
    f.session.emit("change", { dirty: new Set(["pdfCard001"]), structural: false });
    await f.flush();
    assert.equal(path(), before, "the pane keeps the cover, so the arrow stays on the card");
  } finally {
    noteSpeedFlags(null);
    f.done();
  }
});
