// Sidebar outline, 2.13.2. The copy opens as a board. Outline rows render when the
// scroll watcher says they are near, and a uid-list change keeps the rows it already drew.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const BOARD = "board0001";
const MODE_KEY = `plexus-diagram:sidebar-mode:Svy:${BOARD}`;

const block = (uid, string, order) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": { ":plexus": { ":x": order * 40, ":y": 0, ":w": 200, ":h": 80 } },
  ":block/children": [],
});

function pulled() {
  return {
    ":block/uid": BOARD,
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      block("cardAAAA1", "Alpha", 0),
      block("cardBBBB2", "Beta", 1),
      block("cardCCCC3", "Gamma", 2),
    ],
  };
}

function mount({ mode = null, IntersectionObserver = null, hostOverrides = {} } = {}) {
  const stub = createDomStub();
  const restoreDom = stub.install();
  const prevIO = globalThis.IntersectionObserver;
  if (IntersectionObserver) globalThis.IntersectionObserver = IntersectionObserver;
  if (mode) stub.localStorage.setItem(MODE_KEY, mode);
  const renders = [];
  const unmounts = [];
  const board = buildBoard(pulled());
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
  for (const name of ["commitMove", "commitRects", "createCard", "createText", "createSection", "setBlockOpen", "setString", "undo", "redo"]) {
    session[name] = rec(name);
  }
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) {
      renders.push({ el, uid });
      const mark = stub.document.createElement("div");
      mark.className = "rm-block";
      el.append(mark);
    },
    renderPage() {},
    unmount(el) { unmounts.push(el); },
    blockString: () => null,
    pageUid: () => null,
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    pullTree: () => [],
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    ...hostOverrides,
  };
  const sidebar = stub.document.createElement("div");
  sidebar.className = "rm-sidebar-window";
  const nativeEl = stub.document.createElement("div");
  sidebar.append(nativeEl);
  stub.document.body.append(sidebar);
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    nativeEl,
    settings: { get: () => undefined },
  });
  const done = () => {
    try { view.dispose(); } catch { /* already disposed */ }
    if (prevIO === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = prevIO;
    restoreDom();
  };
  return { stub, board, session, host, view, root: view.root, renders, unmounts, done };
}

class ScrollWatch {
  static all = [];
  constructor(cb, opts) {
    this.cb = cb;
    this.opts = opts;
    this.root = opts?.root;
    this.rootMargin = opts?.rootMargin;
    this.rows = new Set();
    this.disconnected = false;
    ScrollWatch.all.push(this);
  }
  observe(el) { this.rows.add(el); }
  unobserve(el) { this.rows.delete(el); }
  disconnect() { this.disconnected = true; this.rows.clear(); }
  fire(el, isIntersecting) { this.cb([{ target: el, isIntersecting }], this); }
}

test("sidebar mount defaults to Board when nothing is stored, and honours a stored outline", () => {
  const fresh = mount();
  try {
    const root = fresh.root;
    assert.ok(root.classList.contains("pxd-root--sidebar"));
    assert.equal(root.classList.contains("pxd-root--outline"), false);
    assert.equal(root.querySelector(".pxd-mode__board").classList.contains("pxd-mode__btn--on"), true);
    assert.equal(root.querySelector(".pxd-mode__outline").classList.contains("pxd-mode__btn--on"), false);
    assert.equal(root.querySelectorAll(".pxd-sidebar-outline__row").length, 0);
    assert.equal(fresh.renders.length, 0);
    assert.equal(fresh.stub.localStorage.getItem(MODE_KEY), null);
    assert.equal(fresh.session.mutations.some((m) => m[0] === "setBlockOpen"), false);
    root.querySelector(".pxd-mode__outline").click();
    assert.equal(fresh.stub.localStorage.getItem(MODE_KEY), "outline");
    root.querySelector(".pxd-mode__board").click();
    assert.equal(fresh.stub.localStorage.getItem(MODE_KEY), "board");
    assert.equal(root.classList.contains("pxd-root--outline"), false);
    assert.equal(fresh.session.mutations.some((m) => m[0] === "setBlockOpen"), false);
  } finally {
    fresh.done();
  }

  const remembered = mount({ mode: "board" });
  try {
    assert.equal(remembered.root.classList.contains("pxd-root--outline"), false);
    assert.equal(remembered.renders.length, 0);
    assert.equal(remembered.root.querySelector(".pxd-mode__board").classList.contains("pxd-mode__btn--on"), true);
  } finally {
    remembered.done();
  }

  const stored = mount({ mode: "outline" });
  try {
    const root = stored.root;
    assert.ok(root.classList.contains("pxd-root--outline"));
    assert.equal(root.querySelector(".pxd-mode__outline").classList.contains("pxd-mode__btn--on"), true);
    assert.deepEqual(
      [...root.querySelectorAll(".pxd-sidebar-outline__row")].map((row) => row.dataset.uid),
      ["cardAAAA1", "cardBBBB2", "cardCCCC3"],
    );
    assert.deepEqual(stored.renders.map((row) => row.uid), ["cardAAAA1", "cardBBBB2", "cardCCCC3"]);
    assert.equal(stored.session.mutations.some((m) => m[0] === "setBlockOpen"), false);
  } finally {
    stored.done();
  }
});

test("outline rows render only after the observer reports them visible, and far rows unmount", () => {
  ScrollWatch.all = [];
  const f = mount({ mode: "outline", IntersectionObserver: ScrollWatch });
  try {
    const root = f.root;
    const rows = [...root.querySelectorAll(".pxd-sidebar-outline__row")];
    assert.equal(rows.length, 3);
    assert.equal(f.renders.length, 0, "nothing renders until a row is near");
    const near = ScrollWatch.all.find((io) => io.rootMargin === "100% 0px");
    const far = ScrollWatch.all.find((io) => io.rootMargin === "300% 0px");
    assert.ok(near && far);
    assert.equal(near.root, root.querySelector(".pxd-sidebar-outline"));
    assert.equal(far.root, near.root);
    const row = rows[0];
    near.fire(row, true);
    assert.deepEqual(f.renders.map((hit) => hit.uid), ["cardAAAA1"]);
    assert.equal(f.renders[0].el, row);
    assert.ok(row.querySelector(".rm-block"));
    row._rect = { left: 0, top: 0, width: 200, height: 120, right: 200, bottom: 120, x: 0, y: 0 };
    far.fire(row, false);
    assert.equal(f.unmounts.length, 1);
    assert.equal(f.unmounts[0], row);
    assert.equal(row.querySelector(".rm-block"), null);
    assert.equal(row.style.height, "120px");
    assert.equal(row.parentElement, root.querySelector(".pxd-sidebar-outline"));
    near.fire(row, true);
    assert.equal(f.renders.length, 2);
    assert.equal(row.style.height, "");
  } finally {
    f.done();
  }
});

test("a uid-list change keeps the DOM node of an unchanged row", () => {
  const f = mount({ mode: "outline" });
  try {
    const root = f.root;
    const kept = root.querySelector('[data-uid="cardAAAA1"]');
    const dropped = root.querySelector('[data-uid="cardBBBB2"]');
    const before = f.renders.filter((hit) => hit.uid === "cardAAAA1").length;
    assert.equal(before, 1);
    f.board.roots = ["cardCCCC3", "cardAAAA1", "cardNEW001"];
    f.session.emit("change", { dirty: new Set(["cardCCCC3"]) });
    const again = root.querySelector('[data-uid="cardAAAA1"]');
    assert.equal(again, kept);
    assert.equal(f.renders.filter((hit) => hit.uid === "cardAAAA1").length, 1);
    assert.equal(f.renders.filter((hit) => hit.el === kept).length, 1);
    assert.equal(root.querySelector('[data-uid="cardBBBB2"]'), null);
    assert.ok(f.unmounts.includes(dropped));
    assert.equal(f.unmounts.length, 1);
    const made = root.querySelector('[data-uid="cardNEW001"]');
    assert.ok(made);
    assert.equal(f.renders.filter((hit) => hit.uid === "cardNEW001").length, 1);
    assert.deepEqual(
      [...root.querySelectorAll(".pxd-sidebar-outline__row")].map((row) => row.dataset.uid),
      ["cardCCCC3", "cardAAAA1", "cardNEW001"],
    );
  } finally {
    f.done();
  }
});

test("dispose disconnects the outline observers", () => {
  ScrollWatch.all = [];
  const f = mount({ mode: "outline", IntersectionObserver: ScrollWatch });
  try {
    assert.equal(ScrollWatch.all.length, 2);
    assert.ok(ScrollWatch.all.every((io) => io.rows.size === 3 && io.disconnected === false));
    f.view.dispose();
    assert.ok(ScrollWatch.all.every((io) => io.disconnected === true));
    assert.ok(ScrollWatch.all.every((io) => io.rows.size === 0));
    const row = { dataset: { uid: "cardAAAA1" } };
    for (const io of ScrollWatch.all) io.fire(row, true);
    assert.equal(f.renders.length, 0);
  } finally {
    f.done();
  }
});
