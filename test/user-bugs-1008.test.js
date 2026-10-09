// User bugs reported against 3.8.0. Each test fails on the code that shipped with that release.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { figureCardSize, handleParseDrop, planParseInsert } from "../src/model/drop.js";
import { mountBoardView, readPaneHost } from "../src/view/board-view.js";
import { createPageChips, skipParsedBox } from "../src/view/page-chips.js";
import { createParseActions } from "../src/view/parse-actions.js";
import { copyViaEvent } from "../src/view/clipboard-io.js";
import { createParseView } from "../src/view/parse-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function item(uid, string, plexus, order) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": [],
  };
}

function boardTree() {
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      item("table0001", "{{[[table]]}}", { ":x": 0, ":y": 0, ":w": 260, ":h": 150 }, 0),
      item("sticky001", "Note", { ":type": "text", ":look": "sticky", ":x": 0, ":y": 180, ":w": 200, ":h": 90 }, 1),
      item("cardBBBB2", "Target", { ":x": 280, ":y": 0, ":w": 110, ":h": 90 }, 2),
      item("noteCCCC3", "Plain", { ":x": 280, ":y": 180, ":w": 100, ":h": 70 }, 3),
    ],
  };
}

function fakeHost() {
  const calls = { renderString: 0, renderBlock: 0 };
  return {
    calls,
    graph: "Svy",
    renderString(el, string) { calls.renderString += 1; el.textContent = string; },
    renderBlock(el) {
      calls.renderBlock += 1;
      const doc = el.ownerDocument || globalThis.document;
      if (el.closest?.(".pxd-roam-table")) {
        const grid = doc.createElement("div");
        grid.className = "rg-root";
        const cell = doc.createElement("div");
        cell.className = "rg-cell";
        cell.textContent = "A1";
        cell.addEventListener("pointerdown", (event) => event.stopPropagation());
        const resize = doc.createElement("div");
        resize.className = "rg-col-resize";
        grid.append(cell, resize);
        el.append(grid);
        return;
      }
      const input = doc.createElement("textarea");
      input.className = "rm-block__input";
      el.append(input);
    },
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    pageUid: () => "pgBeta001",
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
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
    commitMove: rec("commitMove"),
    commitRects: rec("commitRects"),
    createCard: rec("createCard"),
    createText: rec("createText"),
    createSection: rec("createSection"),
    addEdge: rec("addEdge"),
    updateEdge: rec("updateEdge"),
    setString: rec("setString"),
    deleteItems: rec("deleteItems"),
    addRefCards: rec("addRefCards"),
    undo: rec("undo"),
    redo: rec("redo"),
  };
  return session;
}

async function mountZoomed() {
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard(boardTree());
  const session = fakeSession(board);
  const host = fakeHost();
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "3.8.0",
    initialViewport: { x: 0, y: 0, zoom: 2 },
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  // Card paint is time-sliced per frame; a slow CI machine can need several frames before every card is mounted.
  for (let i = 0; i < 40; i += 1) {
    await flush();
    const r = view.root;
    if (r.querySelector("[data-uid=table0001] .rg-cell") && r.querySelector("[data-uid=sticky001] textarea") && r.querySelector("[data-uid=noteCCCC3]")) break;
  }
  return { stub, restore, session, view, flush };
}

function pointer(stub, target, type, x, y, id = 1) {
  stub.dispatch(target, type, { button: 0, clientX: x, clientY: y, pointerId: id });
}

test("a zoomed-in drag on a grid cell or a live sticky body moves the card", async () => {
  const f = await mountZoomed();
  try {
    const root = f.view.root;
    const world = root.querySelector(".pxd-world");
    assert.match(world.style.transform, /scale\(2\)/);
    const table = root.querySelector("[data-uid=table0001]");
    const cell = table.querySelector(".rg-cell");
    const resize = table.querySelector(".rg-col-resize");
    const sticky = root.querySelector("[data-uid=sticky001]");
    const paper = sticky.querySelector("textarea");
    const note = root.querySelector("[data-uid=noteCCCC3]");
    assert.ok(cell, "the grid cell is mounted");
    assert.ok(paper, "the sticky body is a live editor");
    assert.equal(table.style.transform, "translate(0px, 0px)");

    pointer(f.stub, cell, "pointerdown", 40, 40);
    pointer(f.stub, f.stub.document, "pointerup", 40, 40);
    assert.equal(table.style.transform, "translate(0px, 0px)");
    assert.equal(f.session.mutations.some((row) => row[0] === "commitMove"), false);

    pointer(f.stub, cell, "pointerdown", 40, 40);
    pointer(f.stub, f.stub.document, "pointermove", 80, 40);
    assert.equal(table.style.transform, "translate(20px, 0px)");
    pointer(f.stub, f.stub.document, "pointerup", 80, 40);

    pointer(f.stub, paper, "pointerdown", 20, 400);
    pointer(f.stub, f.stub.document, "pointermove", 60, 400);
    assert.equal(sticky.style.transform, "translate(20px, 180px)");
    pointer(f.stub, f.stub.document, "pointerup", 60, 400);

    pointer(f.stub, note, "pointerdown", 600, 400);
    pointer(f.stub, f.stub.document, "pointermove", 640, 400);
    assert.equal(note.style.transform, "translate(300px, 180px)");
    pointer(f.stub, f.stub.document, "pointerup", 640, 400);

    const before = table.style.transform;
    pointer(f.stub, resize, "pointerdown", 50, 20);
    pointer(f.stub, f.stub.document, "pointermove", 90, 20);
    assert.equal(table.style.transform, before, "a column resize stays with the grid");
    pointer(f.stub, f.stub.document, "pointerup", 90, 20);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("connect from a grid table card starts an arrow", async () => {
  const f = await mountZoomed();
  try {
    const root = f.view.root;
    // The stub's class+attribute selector ignores the attribute, so pick the connect button by its attribute.
    const connect = [...root.querySelectorAll("[data-tool]")].find((node) => node.getAttribute("data-tool") === "connect");
    assert.ok(connect, "the connect tool is in the toolbar");
    connect.click();
    assert.equal(root.getAttribute("data-tool"), "connect");
    const cell = root.querySelector("[data-uid=table0001] .rg-cell");
    pointer(f.stub, cell, "pointerdown", 40, 40, 7);
    pointer(f.stub, f.stub.document, "pointermove", 600, 40, 7);
    pointer(f.stub, f.stub.document, "pointerup", 600, 40, 7);
    const edge = f.session.mutations.find((row) => row[0] === "addEdge");
    assert.ok(edge, "the connect gesture reaches addEdge");
    assert.equal(edge[1].from, "table0001");
    assert.equal(edge[1].to, "cardBBBB2");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("an arrow label editor is one field and does not quiet grid cards", async () => {
  const f = await mountZoomed();
  try {
    const root = f.view.root;
    const table = root.querySelector(".pxd-roam-table");
    assert.ok(table?.isConnected);
    const pop = f.stub.document.createElement("div");
    pop.className = "pxd-why pxd-root";
    const input = f.stub.document.createElement("input");
    input.className = "pxd-why__label";
    pop.append(input);
    f.stub.document.body.append(pop);
    f.stub.dispatch(input, "keydown", { key: "a", target: input });
    assert.equal(table.isConnected, true);
    assert.equal(root.querySelector(".pxd-quiet"), null);
    assert.equal(pop.querySelectorAll("input, textarea").length, 1);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a figure drag inserts the crop, and a short caption still gets a box", async () => {
  const page = { w: 600, h: 800 };
  const plan = (w, h) => ({ width: (w / 600) * 100, height: (h / 800) * 100 });
  assert.equal(skipParsedBox({ type: "figure", text: "c5" }, plan(80, 60), page), false);
  assert.equal(skipParsedBox({ type: "figure", text: "c5" }, plan(20, 20), page), true);
  assert.equal(skipParsedBox({ type: "para", text: "c5" }, plan(80, 60), page), true);

  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const el = doc.createElement("div");
    el.setAttribute("data-page-number", "1");
    el._rect = { left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, x: 0, y: 0 };
    doc.body.append(el);
    const parsed = {
      sha256: "sha",
      order: ["f1", "p1"],
      blocks: {
        f1: { id: "f1", type: "figure", page: 1, text: "c5", bbox: [10, 10, 90, 70] },
        p1: { id: "p1", type: "para", page: 1, text: "Hello alpha", bbox: [10, 80, 200, 120] },
      },
    };
    const dragged = [];
    const chips = createPageChips({
      doc,
      getParsed: () => parsed,
      pageEl: (n) => (n === 1 ? el : null),
      pageOf: () => ({ w: 600, h: 800 }),
      drag: (block) => dragged.push(block.id),
      run() {},
    });
    stub.flushFrames();
    const boxes = [...el.querySelectorAll(".pxd-parsed-box")];
    const fig = boxes.find((node) => node.getAttribute("data-block") === "f1");
    const para = boxes.find((node) => node.getAttribute("data-block") === "p1");
    assert.equal(fig.style.pointerEvents, "auto");
    assert.equal(fig.classList.contains("pxd-parsed-box--drag"), true);
    assert.equal(para.style.pointerEvents, "none");
    stub.dispatch(fig, "pointerdown", { button: 0, clientX: 40, clientY: 40 });
    assert.deepEqual(dragged, ["f1"]);
    stub.dispatch(para, "pointerdown", { button: 0, clientX: 40, clientY: 100 });
    assert.deepEqual(dragged, ["f1"]);
    chips.dispose();
  } finally {
    restore();
  }

  const figureDoc = {
    sha256: "sha",
    engine: "builtin",
    optsHash: "opt",
    order: ["f1"],
    blocks: { f1: { id: "f1", type: "figure", page: 6, text: "c5", bbox: [0, 0, 40, 40] } },
  };
  assert.equal(planParseInsert(figureDoc, { kind: "figure", ids: ["f1"] }).action, "card");
  const markdowns = [];
  const sizes = [];
  const res = await handleParseDrop({
    payload: { sha256: "sha", engine: "builtin", optsHash: "opt", kind: "figure", ids: ["f1"] },
    store: {
      async getParse() { return figureDoc; },
      async getImage(key) { return key.endsWith("/f1") ? "data:image/png;base64,iVBORw0KGgo=" : ""; },
    },
    session: {
      async insertParsedCard({ markdown, w, h }) {
        markdowns.push(markdown);
        sizes.push({ w, h });
        return { ok: true, uid: "figcard1" };
      },
    },
    point: { x: 12, y: 18 },
    upload: async (file) => {
      assert.equal(file.type, "image/png");
      return "https://x/f.png";
    },
  });
  assert.equal(res.ok, true);
  assert.match(markdowns[0], /!\[Figure \(p\. 6\)\]\(https:\/\/x\/f\.png\)/);
  assert.equal(markdowns[0].includes("c5"), false);
  const captioned = {
    ...figureDoc,
    order: ["f1", "c10"],
    blocks: {
      f1: { id: "f1", type: "figure", page: 6, caption: "c10", text: "c10", bbox: [0, 0, 40, 40] },
      c10: { id: "c10", type: "caption", for: "f1", page: 6, text: "Osmotic flow rises. Later text stays off." },
    },
  };
  const captionedMd = [];
  const captionedRes = await handleParseDrop({
    payload: { sha256: "sha", engine: "builtin", optsHash: "opt", kind: "figure", ids: ["f1"] },
    store: {
      async getParse() { return captioned; },
      async getImage(key) { return key.endsWith("/f1") ? "data:image/png;base64,iVBORw0KGgo=" : ""; },
    },
    session: {
      async insertParsedCard({ markdown }) {
        captionedMd.push(markdown);
        return { ok: true, uid: "figcard2" };
      },
    },
    point: { x: 1, y: 2 },
    upload: async () => "https://x/f.png",
  });
  assert.equal(captionedRes.ok, true);
  assert.equal(captionedMd[0], "- ![Osmotic flow rises.](https://x/f.png)");
  // Live 2026-10-08: a square figure landed in a 280x160 card and its bottom half was cut off.
  assert.deepEqual(sizes[0], { w: 280, h: 280 });
  assert.deepEqual(figureCardSize({ bbox: [0, 0, 254, 127] }), { w: 280, h: 153 });
  assert.equal(figureCardSize({ bbox: [0, 0, 0, 10] }), null);
});

test("paragraph copy writes text/plain and toasts Could not copy on failure", async () => {
  const parsed = {
    schema: "pxd-parse/1",
    engine: "builtin",
    sha256: "abc",
    optsHash: "hash",
    pageCount: 1,
    pages: [{ n: 1, w: 600, h: 800, rotation: 0 }],
    order: ["p1"],
    blocks: {
      p1: { id: "p1", type: "para", page: 1, text: "Hello alpha", bbox: [10, 80, 200, 120] },
    },
  };
  const mount = () => {
    const stub = createDomStub();
    const restore = stub.install();
    const doc = stub.document;
    const page = doc.createElement("div");
    page.setAttribute("data-page-number", "1");
    page._rect = { left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, x: 0, y: 0 };
    doc.body.append(page);
    return { stub, doc, restore, page };
  };
  const arm = (doc, clipboard) => {
    doc.defaultView.navigator = { clipboard };
    doc.defaultView.ClipboardItem = class { constructor(items) { this.items = items; } };
    doc.defaultView.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type || ""; } };
  };
  const copied = async (clipboard) => {
    const { stub, doc, restore, page } = mount();
    const toasts = [];
    try {
      arm(doc, clipboard);
      const view = createParseView({
        doc,
        pageEl: (n) => (n === 1 ? page : null),
        onToast: (message) => toasts.push(message),
      });
      doc.body.append(view.element());
      view.showDoc(parsed);
      const icon = page.querySelector('.pxd-parsed-copy[data-block="p1"]');
      assert.ok(icon, "the paragraph has a copy button");
      icon.click();
      for (let i = 0; i < 10; i += 1) await tick();
      view.dispose();
      return toasts;
    } finally {
      restore();
    }
  };

  const writes = [];
  const ok = await copied({
    async write(items) { writes.push(items); },
    async writeText() { throw new Error("writeText denied"); },
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0][0].items["text/plain"].parts, ["Hello alpha"]);
  assert.deepEqual(ok, ["Copied"]);

  const failed = await copied({
    async write() { throw new Error("write denied"); },
    async writeText() { throw new Error("writeText denied"); },
  });
  assert.deepEqual(failed, ["Could not copy"]);
});

test("the reader's toasts reach the board toast (Roam host has no toast)", () => {
  const said = [];
  const host = { renderBlock: () => "rendered", graph: "g" };
  const wrapped = readPaneHost(host, (m) => said.push(m));
  wrapped.toast("Could not copy");
  assert.deepEqual(said, ["Could not copy"]);
  assert.equal(wrapped.renderBlock(), "rendered");
  assert.equal(wrapped.graph, "g");
  assert.equal("toast" in host, false, "the shared host is not mutated");
  const own = { toast() {} };
  assert.equal(readPaneHost(own, () => {}), own);
  assert.equal(readPaneHost(null, () => {}), null);
});

test("the reader's actions pass pins through to the board session", async () => {
  const specs = [];
  const actions = createParseActions({ session: { async ensurePdfPin(spec) { specs.push(spec); return { ok: true, uid: "pin1" }; } }, store: null });
  const made = await actions.ensurePdfPin({ pdfUid: "pdf", page: 6 });
  assert.deepEqual(made, { ok: true, uid: "pin1" });
  assert.deepEqual(specs, [{ pdfUid: "pdf", page: 6 }]);
  const none = await createParseActions({ session: {}, store: null }).ensurePdfPin({});
  assert.equal(none.ok, false);
});

test("Copy as card carries the card JSON through a copy event (async clipboard refuses the type)", () => {
  const set = {};
  let listener = null;
  let stopped = false;
  const doc = {
    addEventListener: (type, fn) => { if (type === "copy") listener = fn; },
    removeEventListener: () => { listener = null; },
    execCommand: (cmd) => {
      if (cmd !== "copy" || !listener) return false;
      const ev = { clipboardData: { setData: (t, v) => { set[t] = v; } }, preventDefault() {}, stopImmediatePropagation() { ev.stopped = true; } };
      listener(ev);
      stopped = ev.stopped === true;
      return true;
    },
  };
  assert.equal(copyViaEvent(doc, { "text/plain": "md", "application/x-plexus-card+json": "{\"markdown\":\"md\"}" }), true);
  assert.deepEqual(Object.keys(set).sort(), ["application/x-plexus-card+json", "text/plain"]);
  assert.equal(listener, null, "the copy listener is removed");
  assert.equal(stopped, true, "the board's copy handler does not add its selection");
  assert.equal(copyViaEvent({ ...doc, execCommand: () => false }, { "text/plain": "md" }), false);
  assert.equal(copyViaEvent(null, { "text/plain": "md" }), false);
});
