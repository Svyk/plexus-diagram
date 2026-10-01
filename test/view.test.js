import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { freshCardIsBlank, mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function pulled(extraChildren = []) {
  const item = (uid, string, plexus, order, children = []) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  });
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      item("cardAAAA1", "Alpha\nbody line", { ":x": 0, ":y": 0, ":w": 200, ":h": 100 }, 0, [
        { ":block/uid": "kidAAAA01", ":block/string": "child one", ":block/order": 0 },
      ]),
      item("cardBBBB2", "[[Beta]]", { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
      item("cardFAR03", "Far away", { ":x": 4000, ":y": 0, ":w": 200, ":h": 100 }, 2),
      item("cardFAR04", "Also far", { ":x": 0, ":y": 3000, ":w": 200, ":h": 100 }, 3),
      item("textTTTT5", "Label", { ":type": "text", ":x": 100, ":y": 200, ":w": 240, ":h": 48 }, 4),
      item("sectCCCC3", "[[Evidence]]", { ":type": "section", ":x": 0, ":y": 300, ":w": 400, ":h": 300 }, 5, [
        item("cardDDDD4", "Inside", { ":x": 20, ":y": 60, ":w": 200, ":h": 100 }, 0),
      ]),
      item("edgesEEE5", "Connections", { ":type": "edges" }, 6, [
        item("edgeFFFF6", "((cardAAAA1)) → causes → [[Beta]]", { ":type": "edge", ":from": "cardAAAA1", ":to": "cardBBBB2" }, 0),
        item("edgeGGGG7", "[[Beta]] → ((cardAAAA1))", { ":type": "edge", ":from": "cardBBBB2", ":to": "cardAAAA1" }, 1),
      ]),
      ...extraChildren,
    ],
  };
}

function fakeHost(overrides = {}) {
  const calls = { renderString: 0, renderBlock: 0, renderPage: 0, unmount: 0 };
  return {
    calls,
    graph: "Svy",
    renderString(el, string) { calls.renderString += 1; el.textContent = string; },
    renderBlock(el) { calls.renderBlock += 1; const input = el.ownerDocument?.createElement?.("textarea") || globalThis.document.createElement("textarea"); input.className = "rm-block__input"; el.append(input); },
    renderPage(el) { calls.renderPage += 1; },
    unmount() { calls.unmount += 1; },
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [{ uid: "b1", string: "page block", children: [] }] }),
    pullTree: () => [],
    blockString: () => null,
    pageUid: () => "pgBeta001",
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    ...overrides,
  };
}

function fakeSession(board) {
  const handlers = new Map();
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const recList = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve([`${name}-uid`]); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    releaseCount: 0,
    mutations,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    handlerCount: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
    release() { session.releaseCount += 1; },
    setLinkMode() {},
    commitMove: rec("commitMove"),
    commitRects: rec("commitRects"),
    createCard: rec("createCard"),
    createText: rec("createText"),
    createSection: rec("createSection"),
    wrapInSection: rec("wrapInSection"),
    createBoard: rec("createBoard"),
    wrapInBoard: rec("wrapInBoard"),
    renameBoard: rec("renameBoard"),
    moveIntoBoard: (...args) => {
      mutations.push(["moveIntoBoard", ...args]);
      return Promise.resolve(session.moveResult === undefined ? { moved: args[0], title: "Inner", boardUid: args[1], undo: () => { mutations.push(["moveUndo"]); } } : session.moveResult);
    },
    addRefCards: rec("addRefCards"),
    deleteItems: rec("deleteItems"),
    deleteEdges: rec("deleteEdges"),
    setColor: rec("setColor"),
    setCollapsed: rec("setCollapsed"),
    setBlockOpen: rec("setBlockOpen"),
    setFontSize: rec("setFontSize"),
    setString: rec("setString"),
    growToFit: rec("growToFit"),
    addEdge: rec("addEdge"),
    updateEdge: rec("updateEdge"),
    flipEdge: rec("flipEdge"),
    undo: rec("undo"),
    redo: rec("redo"),
    // 1.2 session methods the view calls (recording stubs)
    setCollapsedMany: rec("setCollapsedMany"),
    collapseAll: rec("collapseAll"),
    setPinned: rec("setPinned"),
    setBoardBackground: rec("setBoardBackground"),
    setFit: rec("setFit"),
    fitSection: rec("fitSection"),
    tidyItems: rec("tidyItems"),
    sameSize: rec("sameSize"),
    resetSize: rec("resetSize"),
    fitToContent: rec("fitToContent"),
    duplicateItems: recList("duplicateItems"),
    pasteItems: recList("pasteItems"),
    pasteText: recList("pasteText"),
    addDailyCards: recList("addDailyCards"),
    sendToBoard: (...args) => { mutations.push(["sendToBoard", ...args]); return Promise.resolve({ added: args[0].length, title: "Inner" }); },
    expandOutline: (...args) => { mutations.push(["expandOutline", ...args]); return Promise.resolve({ added: 2, edges: 2 }); },
  };
  return session;
}

function mountFixture({ vp = { x: 0, y: 0, zoom: 1 }, settings = {}, extraChildren = [], hostOverrides = {}, viewOptions = {}, cardOpen } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem(`plexus-diagram:vp:Svy:board0001`, JSON.stringify(vp));
  const tree = pulled(extraChildren);
  if (cardOpen === false) tree[":block/children"][0][":block/open"] = false;
  const board = buildBoard(tree);
  const session = fakeSession(board);
  const host = fakeHost(hostOverrides);
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: (k) => settings[k] },
    version: "1.0.0",
    ...viewOptions,
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, board, session, host, mountEl, view, flush };
}

test("fresh card stays when the editor has text Roam has not saved yet", () => {
  assert.equal(freshCardIsBlank({ blockString: "", itemString: "", editorText: "alpha" }), false);
  assert.equal(freshCardIsBlank({ blockString: null, itemString: "", contentCount: 1 }), false);
  assert.equal(freshCardIsBlank({ blockString: "alpha" }), false);
  assert.equal(freshCardIsBlank({ blockString: "", itemString: "", editorText: "  " }), true);
  assert.equal(freshCardIsBlank({}), true);
});

test("mount builds the documented DOM and a shell for every item", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const root = f.view.root;
    assert.equal(root.className.split(" ")[0], "pxd-root");
    assert.equal(root.parentElement, f.mountEl);
    const viewport = root.querySelector(".pxd-viewport");
    assert.ok(viewport.querySelector(".pxd-grid"));
    const world = viewport.querySelector(".pxd-world");
    const layers = world.children.map((c) => c.className);
    assert.deepEqual(layers, ["pxd-sections", "pxd-edges", "pxd-labels", "pxd-items", "pxd-overlay"]);
    assert.equal(world.querySelectorAll(".pxd-item").length, 6, "cards and text get shells");
    assert.equal(world.querySelectorAll(".pxd-section").length, 1);
    assert.equal(world.querySelector(".pxd-sections").children.length, 1, "sections live in the sections layer");
    assert.equal(world.querySelector(".pxd-items").children.length, 6);
    assert.equal(world.querySelectorAll(".pxd-edge").length, 2);
    assert.equal(world.querySelectorAll(".pxd-edge__head").length, 4, "arrowheads are explicit paths, not markers");
    assert.equal(world.querySelectorAll("marker").length, 0);
    assert.equal(world.querySelectorAll(".pxd-label").length, 2);
    const alpha = world.querySelector(".pxd-item");
    assert.equal(alpha.dataset.uid, "cardAAAA1");
    assert.equal(alpha.querySelector(".pxd-item__header").textContent, "Alpha");
    assert.equal(alpha.querySelectorAll(".pxd-port").length, 4);
    assert.equal(alpha.querySelectorAll(".pxd-grip").length, 3);
    assert.equal(alpha.style.transform, "translate(0px, 0px)");
    assert.equal(alpha.style.width, "200px");
    const inside = world.querySelector("[data-uid=cardDDDD4]");
    assert.equal(inside.style.transform, "translate(20px, 360px)", "member coordinates are resolved to world space");
    assert.ok(root.querySelector(".pxd-toolbar"));
    assert.ok(root.querySelector(".pxd-ctx"));
    assert.ok(root.querySelector(".pxd-panel"));
    assert.ok(root.querySelector(".pxd-minimap"));
    assert.ok(root.querySelector(".pxd-search"));
    assert.ok(root.querySelector(".pxd-toast"));
    assert.ok(root.querySelector(".pxd-popover--bg"), "background popover is part of the chrome");
    assert.ok(root.querySelector(".pxd-backtocontent"), "back-to-content button is part of the chrome");
    assert.equal(root.querySelector(".pxd-backtocontent").style.display, "none", "hidden while content is in view");
    assert.ok(world.querySelector(".pxd-grid--dots") || viewport.querySelector(".pxd-grid--dots"), "default pattern is dots");
    assert.equal(root.querySelector(".pxd-badge").textContent, "v1.0.0");
    assert.ok(root.querySelector(".pxd-sync"));
    assert.equal(root.querySelector(".pxd-tool--active").dataset.tool, "select");
    assert.equal(world.style.transform, "translate(0px, 0px) scale(1)");
    assert.equal(f.session.mutations.length, 0, "opening writes nothing");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("culling: content mounts only for items intersecting the viewport (+50%)", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const mounted = f.view.stats().mounted;
    assert.ok(mounted >= 4, `visible items mounted (${mounted})`);
    const far = f.view.root.querySelector("[data-uid=cardFAR03] .pxd-item__body");
    assert.equal(far.children.length, 0, "far card has no content");
    const far2 = f.view.root.querySelector("[data-uid=cardFAR04] .pxd-item__body");
    assert.equal(far2.children.length, 0);
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1] .pxd-item__body");
    assert.ok(alpha.children.length > 0, "visible card has content");
    assert.ok(f.host.calls.renderString > 0);
    assert.ok(f.host.calls.renderString < 20, "renderString is not called for off-screen items");
    const beta = f.view.root.querySelector("[data-uid=cardBBBB2] .pxd-item__body");
    assert.ok(beta.querySelector(".pxd-item__page"), "page card body comes from pagePreview");
    const sectionTitle = f.view.root.querySelector(".pxd-section__title");
    assert.ok(sectionTitle.querySelector(".pxd-rs"), "section title with a link is rendered via renderString");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("LOD: map class toggles at zoom 0.45 and no render calls happen during a pan", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const root = f.view.root;
    const viewport = root.querySelector(".pxd-viewport");
    const world = root.querySelector(".pxd-world");
    const before = f.host.calls.renderString;
    // middle-button drag on empty space = pan
    f.stub.dispatch(viewport, "pointerdown", { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    assert.ok(root.classList.contains("pxd-root--gesturing"));
    assert.equal(world.style.willChange, "transform");
    for (let i = 1; i <= 5; i += 1) {
      f.stub.dispatch(f.stub.document, "pointermove", { clientX: 100 + i * 30, clientY: 100 + i * 10, pointerId: 1 });
      const frames = f.stub.flushFrames();
      assert.ok(frames <= 1, "at most one frame per move");
    }
    assert.equal(world.style.transform, "translate(150px, 50px) scale(1)");
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 250, clientY: 150, pointerId: 1 });
    f.stub.flushFrames();
    assert.equal(f.host.calls.renderString, before, "no renderString during the pan");
    assert.equal(f.session.mutations.length, 0, "pan writes nothing");
    assert.equal(world.style.willChange, "");
    assert.equal(root.classList.contains("pxd-lod-map"), false);
    // ctrl-wheel zoom out below 0.45
    f.stub.dispatch(viewport, "wheel", { ctrlKey: true, deltaY: 100, clientX: 400, clientY: 300 });
    f.stub.flushFrames();
    await tick(140);
    assert.ok(root.classList.contains("pxd-lod-map"), "zoom < 0.45 switches to map LOD");
    assert.match(root.style["--pxd-map-font"], /px$/);
    f.stub.dispatch(viewport, "wheel", { ctrlKey: true, deltaY: -100, clientX: 400, clientY: 300 });
    f.stub.flushFrames();
    await tick(140);
    assert.equal(root.classList.contains("pxd-lod-map"), false);
    assert.equal(f.session.mutations.length, 0, "zoom writes nothing");
    assert.equal(JSON.parse(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001")).zoom, 1, "viewport persisted to localStorage only");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("selection shows a context bar above the selection and never over it", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const root = f.view.root;
    const alpha = root.querySelector("[data-uid=cardAAAA1]");
    // A click on a block-look note selects and edits, so the context bar stays hidden until Esc.
    f.stub.dispatch(alpha, "pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 50, clientY: 50, pointerId: 1 });
    await tick(300);
    f.stub.flushFrames();
    assert.ok(alpha.classList.contains("pxd-item--selected"));
    assert.ok(alpha.classList.contains("pxd-item--editing"));
    const ctx = root.querySelector(".pxd-ctx");
    assert.equal(ctx.style.display, "none");
    f.stub.dispatch(alpha, "pointermove", { clientX: 40, clientY: 40 });
    assert.equal(ctx.style.display, "none", "hover while editing does not cover the text");
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await tick();
    f.stub.flushFrames();
    assert.equal(alpha.classList.contains("pxd-item--editing"), false);
    assert.equal(ctx.style.display, "");
    assert.equal(ctx.dataset.kind, "card");
    const rowKids = [...ctx.querySelector(".pxd-ctx__row").children].map((n) => n.className);
    assert.equal(rowKids[0].includes("pxd-ctx__color"), true);
    assert.equal(rowKids[1].includes("pxd-ctx__expand"), true);
    assert.equal(rowKids[2].includes("pxd-ctx__refs"), true);
    assert.equal(rowKids[3].includes("pxd-swatches"), true);
    assert.deepEqual(
      [".pxd-ctx__color", ".pxd-ctx__expand", ".pxd-ctx__refs"].map((s) => ctx.querySelector(s).getAttribute("aria-label")),
      ["Color", "Collapse children", "References"],
    );
    assert.equal(ctx.querySelector(".pxd-ctx__color .bp3-icon-tint") != null, true);
    assert.equal(ctx.querySelectorAll(".pxd-ctx__row .pxd-swatch").length, 11);
    f.stub.dispatch(ctx.querySelector(".pxd-ctx__color"), "click");
    const picker = ctx.querySelector(".pxd-ctx__picker");
    assert.equal(picker.style.display, "");
    assert.equal(picker.querySelectorAll(".pxd-swatch").length, 49);
    // card occupies y 0..100 at the top edge: bar must flip BELOW (y >= 112), never overlapping
    const top = Number.parseInt(ctx.style.top, 10);
    assert.ok(top >= 112, `context bar below the card when there is no room above (top=${top})`);
    // select the edge: bar sits with ≥ 28 px clearance from the midpoint
    const edge = root.querySelector(".pxd-edge");
    f.stub.dispatch(edge, "pointerdown", { button: 0, clientX: 250, clientY: 50, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 250, clientY: 50, pointerId: 1 });
    await tick(140);
    f.stub.flushFrames();
    assert.equal(ctx.dataset.kind, "edge");
    assert.ok(edge.getAttribute("class").includes("pxd-edge--selected"));
    // Esc clears
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    f.stub.flushFrames();
    assert.equal(ctx.style.display, "none");
    assert.equal(f.session.mutations.length, 0, "select and deselect write nothing");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("hover toolbar works on a note, a page and a block ref", async () => {
  const calls = [];
  const f = mountFixture({
    extraChildren: [{
      ":block/uid": "refRRRR01",
      ":block/string": "((abcDEF123))",
      ":block/order": 8,
      ":block/props": { ":plexus": { ":x": 0, ":y": 160, ":w": 200, ":h": 100 } },
      ":block/children": [],
    }],
    hostOverrides: {
      openInSidebar(uid, type) { calls.push([uid, type]); },
      blockString: () => "referenced",
      pullTree: () => [{ uid: "kidref01", string: "ref child", children: [] }],
      cardStats(targets) {
        const map = new Map();
        for (const t of targets) {
          const key = t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`;
          map.set(key, { refs: t.kind === "page" ? 2 : 4, boards: 0, open: 0, done: 0 });
        }
        return map;
      },
    },
  });
  try {
    await f.flush();
    const root = f.view.root;
    const show = (uid) => {
      f.stub.dispatch(root.querySelector(`[data-uid=${uid}]`), "pointermove", { clientX: 20, clientY: 20 });
      return root.querySelector(".pxd-ctx");
    };
    const note = show("cardAAAA1");
    assert.equal(note.style.display, "");
    assert.equal(note.querySelector(".pxd-ctx__refs-count").textContent, "4");
    f.stub.dispatch(note.querySelector(".pxd-ctx__expand"), "click");
    assert.deepEqual(f.session.mutations.at(-1), ["setBlockOpen", "cardAAAA1", false]);
    f.stub.dispatch(note.querySelector(".pxd-ctx__refs"), "click");
    assert.deepEqual(calls.at(-1), ["cardAAAA1", "mentions"]);
    const page = show("cardBBBB2");
    assert.equal(page.querySelector(".pxd-ctx__refs-count").textContent, "2");
    f.stub.dispatch(page.querySelector(".pxd-ctx__refs"), "click");
    assert.deepEqual(calls.at(-1), ["pgBeta001", "mentions"]);
    const ref = show("refRRRR01");
    assert.equal(ref.querySelector(".bp3-icon-collapse-all") != null, true);
    f.stub.dispatch(ref.querySelector(".pxd-ctx__refs"), "click");
    assert.deepEqual(calls.at(-1), ["abcDEF123", "mentions"]);
    assert.match(root.querySelector("[data-uid=refRRRR01]").textContent, /ref child/);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a closed card keeps its own text and hides children", async () => {
  const f = mountFixture({ cardOpen: false });
  try {
    await f.flush();
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const beta = f.view.root.querySelector("[data-uid=cardBBBB2]");
    assert.match(alpha.textContent, /Alpha/);
    assert.equal(alpha.textContent.includes("child one"), false);
    assert.match(beta.textContent, /page block/);
    assert.equal(f.board.items.get("cardAAAA1").open, false);
    assert.equal(f.board.items.get("cardBBBB2").open, true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("keyboard shortcuts are ignored while a Roam editor / input has focus", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const root = f.view.root;
    f.view.controller.select(["cardAAAA1"]);
    const textarea = f.stub.document.createElement("textarea");
    textarea.className = "rm-block__input";
    f.stub.document.body.append(textarea);
    textarea.focus();
    f.stub.dispatch(textarea, "keydown", { key: "Delete" });
    f.stub.dispatch(textarea, "keydown", { key: "g" });
    assert.equal(f.session.mutations.length, 0);
    assert.equal(root.dataset.tool, "select");
    textarea.blur();
    root.focus();
    f.stub.dispatch(root, "keydown", { key: "Delete" });
    assert.deepEqual(f.session.mutations[0].slice(0, 2), ["deleteItems", ["cardAAAA1"]]);
    assert.equal(root.querySelector(".pxd-toast").style.display, "");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("edit mode mounts renderBlock into the card, exits on Esc, and typed text never routes through us", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const root = f.view.root;
    const alpha = root.querySelector("[data-uid=cardAAAA1]");
    f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
    assert.equal(f.host.calls.renderBlock, 1);
    assert.ok(alpha.classList.contains("pxd-item--editing"));
    assert.ok(root.classList.contains("pxd-root--editing"));
    const editor = alpha.querySelector(".pxd-item__editor");
    assert.ok(editor.querySelector(".rm-block__input"));
    assert.equal(f.session.mutations.filter((m) => m[0] === "setString").length, 0, "no writes to the edited block");
    // Esc from inside the editor leaves edit mode
    const input = editor.querySelector(".rm-block__input");
    input.focus();
    f.stub.dispatch(input, "keydown", { key: "Escape" });
    await tick();
    assert.equal(alpha.classList.contains("pxd-item--editing"), false);
    assert.ok(f.host.calls.unmount >= 1);
    assert.equal(alpha.querySelector(".pxd-item__editor"), null);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("session change re-renders only dirty uids; structural change reconciles shells by uid", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const root = f.view.root;
    const alphaBefore = root.querySelector("[data-uid=cardAAAA1]");
    const next = buildBoard(pulled());
    next.items.get("cardAAAA1").x = 50;
    f.session.board = next;
    f.session.rects = worldRects(next);
    f.session.emit("change", { dirty: new Set(["cardAAAA1"]), structural: false });
    f.stub.flushFrames();
    const alphaAfter = root.querySelector("[data-uid=cardAAAA1]");
    assert.equal(alphaAfter, alphaBefore, "shell reused, not rebuilt");
    assert.equal(alphaAfter.style.transform, "translate(50px, 0px)");
    const p = pulled();
    p[":block/children"].splice(2, 1); // remove cardFAR03
    const smaller = buildBoard(p);
    f.session.board = smaller;
    f.session.rects = worldRects(smaller);
    f.session.emit("change", { dirty: new Set(), structural: true });
    f.stub.flushFrames();
    assert.equal(root.querySelector("[data-uid=cardFAR03]"), null);
    assert.equal(root.querySelectorAll(".pxd-item").length, 5);
    f.session.emit("busy", true);
    assert.ok(root.querySelector(".pxd-sync").classList.contains("pxd-sync--pending"));
    f.session.emit("busy", false);
    assert.equal(root.querySelector(".pxd-sync").classList.contains("pxd-sync--pending"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("dispose removes every pxd node, listener, observer and timer, and leaves session release to its acquirer", async () => {
  const f = mountFixture();
  const { stub, view, session, mountEl } = f;
  try {
    await f.flush();
    await tick(5);
    stub.flushIdle();
    // open some chrome so there is more to tear down
    view.root.querySelector(".pxd-toolbar__add").click();
    view.root.querySelector(".pxd-search__input");
    assert.ok(stub.listenerCount() > 0);
    view.setFullscreen(true);
    assert.ok(stub.document.body.classList.contains("pxd-has-fullscreen"));
    assert.ok(mountEl.classList.contains("pxd-mount--fullscreen"));
    view.dispose();
    view.dispose();
    assert.equal(mountEl.children.length, 0, "root removed from the mount");
    assert.equal(stub.pxdNodes().filter((n) => n !== mountEl).length, 0, "no .pxd-* nodes remain anywhere in the document");
    assert.equal(stub.listenerCount(), 0, "no listeners remain on window, document, or any element");
    assert.equal(stub.observers.size, 0, "no observers remain");
    assert.equal(stub.frames.length, 0, "no pending frames");
    assert.equal(stub.idle.length, 0, "no pending idle callbacks");
    assert.equal(view.stats().timers, 0, "no pending timers");
    assert.equal(session.handlerCount(), 0, "session subscriptions removed");
    assert.equal(session.releaseCount, 0, "the view never releases the session; feature.js owns release");
    assert.equal(stub.document.body.classList.contains("pxd-has-fullscreen"), false);
    assert.equal(mountEl.classList.contains("pxd-mount--fullscreen"), false);
  } finally {
    f.restore();
  }
});

// ---------------------------------------------------------------- real session over fake Roam
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

function mountReal() {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 1 });
  stub.localStorage.setItem("plexus-diagram:vp:g:b1", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: 1 }, plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "c2", string: "[[B]]", props: { plexus: { x: 400, y: 0, w: 280, h: 160 } } },
      { uid: "c4", string: "a note", props: { plexus: { x: 800, y: 0 } } },
      { uid: "s1", string: "Group", props: { plexus: { type: "section", x: 0, y: 300, w: 500, h: 300 } },
        children: [{ uid: "c3", string: "[[C]]", props: { plexus: { x: 20, y: 60, w: 280, h: 160 } } }] },
    ],
  });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  fake.clearLog();
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  return { stub, restore, fake, host, session, view, mountEl };
}

test("real session: open + pan + select write nothing; one drag = one props write after pointerup; section click = one block", async () => {
  const f = mountReal();
  try {
    f.stub.flushFrames();
    await tick(5);
    f.stub.flushIdle();
    f.stub.flushFrames();
    assert.equal(f.host.stats.writes, 0, "opening writes nothing");
    assert.equal(f.host.stats.watches, 1);
    const root = f.view.root;
    assert.equal(root.querySelectorAll(".pxd-item").length, 4);
    assert.equal(root.querySelectorAll(".pxd-section").length, 1);
    const c1 = root.querySelector("[data-uid=c1]");
    const viewport = root.querySelector(".pxd-viewport");
    // pan
    f.stub.dispatch(viewport, "pointerdown", { button: 1, clientX: 100, clientY: 100, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 160, clientY: 120, pointerId: 1 });
    f.stub.flushFrames();
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 160, clientY: 120, pointerId: 1 });
    await tick(140);
    f.stub.flushFrames();
    assert.equal(f.host.stats.writes, 0, "pan writes nothing");
    // drag c1 by 100,50 screen px at zoom 1 (viewport offset 60,20)
    f.stub.dispatch(c1, "pointerdown", { button: 0, clientX: 100, clientY: 60, pointerId: 2 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 150, clientY: 80, pointerId: 2 });
    f.stub.flushFrames();
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 200, clientY: 110, pointerId: 2 });
    f.stub.flushFrames();
    assert.equal(f.host.stats.writes, 0, "zero writes before pointerup");
    assert.equal(c1.style.transform, "translate(100px, 50px)", "preview moves the shell without writes");
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 200, clientY: 110, pointerId: 2 });
    await f.session.idle();
    await tick(20);
    f.stub.flushFrames();
    const propsWrites = f.fake.writesLog().filter((e) => e[0] === "update" || e[0] === "props" || String(e[0]).includes("update"));
    assert.equal(f.host.stats.writes, 1, `exactly one write after the drag (${JSON.stringify(f.fake.writesLog())})`);
    assert.ok(propsWrites.length >= 1);
    const stored = f.fake.props("c1");
    assert.equal(stored.plexus.x, 100);
    assert.equal(stored.plexus.y, 50);
    assert.equal(c1.style.transform, "translate(100px, 50px)", "no flicker back after the echo");
    // section tool: one click = one block
    f.fake.clearLog();
    const before = f.host.stats.writes;
    f.stub.dispatch(f.stub.window, "keydown", { key: "g" });
    assert.equal(root.dataset.tool, "section");
    f.stub.dispatch(viewport, "pointerdown", { button: 0, clientX: 700, clientY: 500, pointerId: 3 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 700, clientY: 500, pointerId: 3 });
    await tick(5);
    await f.session.idle();
    await tick(20);
    f.stub.flushFrames();
    const creates = f.fake.writesLog().filter((e) => e[0] === "create");
    assert.equal(creates.length, 1, `one section block created (${JSON.stringify(f.fake.writesLog())})`);
    assert.equal(f.host.stats.writes - before, 1);
    assert.equal(root.querySelectorAll(".pxd-section").length, 2);
    assert.equal(root.dataset.tool, "select");
    // dispose keeps the shared session; the acquirer's release removes the watch
    f.view.dispose();
    assert.equal(f.host.stats.watches, 1, "view dispose leaves the shared session alive");
    f.session.release();
    assert.equal(f.host.stats.watches, 0, "pull watch removed when the acquirer releases");
    assert.equal(f.stub.pxdNodes().filter((n) => n !== f.mountEl).length, 0);
  } finally {
    try { f.view.dispose(); } catch { /* already disposed */ }
    resetSessions();
    f.restore();
  }
});

// ------------------------------------------------------------------ 1.1 (R1 cards, R2 focus floor, R3 stability)

const extraCard = (uid, string, order, plexus = {}, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": { ":plexus": { ":x": 20, ":y": 20, ":w": 200, ":h": 100, ...plexus } },
  ":block/children": children,
});

async function startEdit(f, uid = "cardAAAA1") {
  const alpha = f.view.root.querySelector(`[data-uid=${uid}]`);
  f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
  for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
  await tick(300);
  f.stub.flushFrames();
  return alpha;
}

test("R1: note and block cards render the whole string in the body; header stays the first line", async () => {
  const f = mountFixture({
    extraChildren: [
      extraCard("refLONG01", "((longUid001))", 7, { ":h": 348, ":x": 500, ":y": 300 }),
      extraCard("emptyCrd1", "", 8, { ":x": 500, ":y": 500 }),
      extraCard("refEMPTY1", "((emptyUid1))", 9, { ":x": 700, ":y": 500 }),
    ],
    hostOverrides: { blockString: (u) => (u === "longUid001" ? "A very long single line that used to be hidden behind an ellipsis" : u === "emptyUid1" ? "" : null) },
  });
  try {
    await f.flush();
    const root = f.view.root;
    const alpha = root.querySelector("[data-uid=cardAAAA1]");
    assert.equal(alpha.querySelector(".pxd-item__string").textContent, "Alpha\nbody line");
    assert.ok(alpha.querySelector(".pxd-block"), "child block rendered");
    assert.equal(alpha.querySelector(".pxd-item__header").textContent, "Alpha");
    assert.ok(root.querySelector("[data-uid=cardDDDD4] .pxd-item__string").textContent.length > 0);
    const ref = root.querySelector("[data-uid=refLONG01]");
    assert.equal(ref.querySelector(".pxd-item__string").textContent, "A very long single line that used to be hidden behind an ellipsis");
    assert.match(root.querySelector("[data-uid=emptyCrd1] .pxd-item__placeholder").textContent, /Empty card/);
    assert.match(root.querySelector("[data-uid=refEMPTY1] .pxd-item__placeholder").textContent, /Empty card/);
    const page = root.querySelector("[data-uid=cardBBBB2]");
    assert.ok(page, "page card still present");
    assert.ok(alpha.classList.contains("pxd-card--block"), "a note with no stored look is a plain block");
    assert.equal(page.classList.contains("pxd-card--block"), false, "a page card keeps the card look");
    const before = f.host.calls.renderString;
    f.session.emit("change", { dirty: new Set(["cardAAAA1"]), structural: false });
    await f.flush();
    assert.equal(f.host.calls.renderString, before, "same string does not re-render");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("R2: focus floor refocuses Roam's new textarea after focus falls to body", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = await startEdit(f);
    const editor = alpha.querySelector(".pxd-item__editor");
    const old = editor.querySelector("textarea");
    old.focus();
    f.stub.dispatch(editor, "focusin", { target: old });
    old.blur();
    old.remove();
    f.stub.dispatch(editor, "focusout", { target: old, relatedTarget: null });
    assert.equal(f.stub.document.activeElement, f.stub.document.body);
    f.stub.flushFrames();
    assert.equal(f.stub.document.activeElement, f.stub.document.body, "no textarea yet");
    const fresh = f.stub.document.createElement("textarea");
    fresh.className = "rm-block__input";
    editor.append(fresh);
    f.stub.flushFrames();
    assert.equal(f.stub.document.activeElement, fresh);
    assert.equal(f.session.mutations.filter((m) => m[0] === "setString").length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("X3: the editor never stops mouseup, so Roam's document-level mouseup can disarm drag-select", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = await startEdit(f);
    const editor = alpha.querySelector(".pxd-item__editor");
    const input = editor.querySelector("textarea");
    assert.equal(editor.listeners.get("mouseup")?.size ?? 0, 0, "no stopEvent registered for mouseup");
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown"]) {
      assert.equal(editor.listeners.get(type)?.size, 1, `${type} stays stopped at the editor`);
    }
    const seen = [];
    const onUp = (ev) => seen.push(ev.type);
    f.stub.document.addEventListener("mouseup", onUp);
    const down = f.stub.dispatch(input, "mousedown", { target: input });
    const up = f.stub.dispatch(input, "mouseup", { target: input });
    f.stub.document.removeEventListener("mouseup", onUp);
    assert.equal(down.propagationStopped, true, "mousedown is still contained");
    assert.equal(up.propagationStopped, false);
    assert.deepEqual(seen, ["mouseup"], "document-level bubble mouseup listener fires");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("R2: floor stands down for outside pointerdown, outside focus targets, and gives up after 600 ms", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = await startEdit(f);
    const editor = alpha.querySelector(".pxd-item__editor");
    const input = editor.querySelector("textarea");
    const lose = (related = null) => {
      input.focus();
      f.stub.dispatch(editor, "focusin", { target: input });
      input.blur();
      f.stub.dispatch(editor, "focusout", { target: input, relatedTarget: related });
      f.stub.flushFrames();
    };
    // outside pointerdown, then focusout
    f.stub.dispatch(f.stub.document.body, "pointerdown", { target: f.stub.document.body });
    lose();
    assert.equal(f.stub.document.activeElement, f.stub.document.body);
    await tick(320);
    f.stub.flushFrames();
    // focus moved to a real outside input
    const other = f.stub.document.createElement("input");
    f.stub.document.body.append(other);
    await tick(320);
    lose(other);
    assert.equal(f.stub.document.activeElement, f.stub.document.body);
    // no textarea ever appears
    input.remove();
    const mo = f.stub.document.createElement("div");
    f.stub.document.body.append(mo);
    await tick(320);
    lose();
    await tick(650);
    f.stub.flushFrames();
    assert.equal(f.stub.frames.length, 0, "floor gave up");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("R2: a refused recovery (burst cap) is retried once the burst ages out, so typing never goes to <body> for good", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = await startEdit(f);
    await tick(1000); // let enterEdit finish hydrating: its own late focus would otherwise mask a missing retry
    f.stub.flushFrames();
    const editor = alpha.querySelector(".pxd-item__editor");
    const doc = f.stub.document;
    let current = editor.querySelector("textarea");
    current.focus();
    f.stub.dispatch(editor, "focusin", { target: current });
    const dropFocus = () => {
      current.blur();
      current.remove();
      f.stub.dispatch(editor, "focusout", { target: current, relatedTarget: null });
      f.stub.flushFrames();
    };
    const roamRerender = () => {
      current = doc.createElement("textarea");
      current.className = "rm-block__input";
      editor.append(current);
      f.stub.flushFrames();
    };
    for (let i = 0; i < 4; i += 1) {
      dropFocus();
      roamRerender();
      assert.ok(doc.activeElement === current, `recovery ${i + 1} refocuses the new textarea`);
    }
    dropFocus();
    roamRerender();
    assert.ok(doc.activeElement === doc.body, "the fifth loss inside the burst window is rate-limited");
    await tick(1600);
    f.stub.flushFrames();
    assert.ok(doc.activeElement === current, "the deferred retry recovered focus after the burst aged out");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("R2: dispose during a pending floor leaves no frames or listeners", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = await startEdit(f);
    const editor = alpha.querySelector(".pxd-item__editor");
    const input = editor.querySelector("textarea");
    input.focus();
    f.stub.dispatch(editor, "focusin", { target: input });
    input.blur();
    input.remove();
    await tick(320);
    f.stub.dispatch(editor, "focusout", { target: input, relatedTarget: null });
    f.view.dispose();
    f.stub.flushFrames();
    assert.equal(f.stub.frames.length, 0);
    assert.equal(f.stub.listenerCount(), 0);
  } finally {
    f.restore();
  }
});

test("R3: editing card keeps min-height and a frozen header; both restore on exit", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const header = alpha.querySelector(".pxd-item__header");
    await startEdit(f);
    assert.equal(alpha.style.minHeight, "100px");
    assert.equal(header.textContent, "Alpha");
    f.board.items.get("cardAAAA1").string = "Alpha renamed\nbody line";
    f.board.items.get("cardAAAA1").title = "Alpha renamed";
    f.session.emit("change", { dirty: new Set(["cardAAAA1"]), structural: false });
    await f.flush();
    assert.equal(header.textContent, "Alpha", "header does not chase Roam saves while editing");
    const input = alpha.querySelector(".pxd-item__editor textarea");
    f.stub.dispatch(input, "keydown", { key: "Escape" });
    await tick();
    assert.equal(alpha.style.minHeight, "");
    assert.equal(header.textContent, "Alpha renamed");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("CSS contract: node toolbar buttons are 28px targets", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/css/ctx-toolbar.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-ctx \.pxd-ctx__btn\.pxd-ctx__color[\s\S]*min-width: 28px;[\s\S]*height: 28px/);
  assert.match(css, /\.pxd-ctx__expand/);
  assert.match(css, /\.pxd-ctx__refs/);
});

test("CSS contract: block-look cards hide the root bullet and use 14px text", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/css/block-card.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-card--block > \.pxd-item__body > \.pxd-item__editor > \.rm-api-render--block > \.rm-block > \.rm-block-main > \.controls \{\s*display: none/);
  assert.match(css, /\.pxd-root \.pxd-card--block > \.pxd-item__body \{\s*font-size: 14px/);
  assert.match(css, /\.pxd-root:not\(\.pxd-lod-map\) \.pxd-item\.pxd-card--block:not\(\.pxd-item--collapsed\):not\(\.pxd-item--bare\) > \.pxd-item__header \{\s*display: none/);
});

test("CSS contract: card header rules, LOD, editing strip and text font variable", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-item\.pxd-item--card\.pxd-item--note > \.pxd-item__header[^{]*\{\s*display: none/);
  assert.match(css, /\.pxd-item--collapsed > \.pxd-item__header,\s*\.pxd-root\.pxd-lod-map \.pxd-item\.pxd-item--card > \.pxd-item__header \{\s*display: block/);
  assert.match(css, /\.pxd-item--editing > \.pxd-item__header \{[^}]*height: 8px/);
  assert.match(css, /--pxd-text-fs: 48px/);
  assert.match(css, /\.pxd-item--text \.pxd-item__editor \{[^}]*font-size: var\(--pxd-text-fs/);
});

test("CSS contract (1.2): map tile clamp, overview tier, bare header, pin, focus and badges", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `rule ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".pxd-root.pxd-lod-map .pxd-item.pxd-item--card:not(.pxd-item--editing)"), /container-type: size/);
  const header = rule(".pxd-root.pxd-lod-map .pxd-item.pxd-item--card:not(.pxd-item--editing) > .pxd-item__header");
  for (const decl of ["flex: 0 1 auto", "min-height: 0", "padding-bottom: 0", "max-height: calc(3 * 1.2em + 6px)", "line-height: 1.2", "overflow: hidden", "display: -webkit-box", "-webkit-box-orient: vertical", "-webkit-line-clamp: 3", "overflow-wrap: anywhere", "text-overflow: ellipsis"]) assert.ok(header.includes(decl), decl);
  assert.doesNotMatch(header, /flex:\s*1 1 auto/, "a stretched -webkit-box paints lines after the clamp");
  assert.match(rule(".pxd-root.pxd-lod-map .pxd-item.pxd-item--card.pxd-item--wb:not(.pxd-item--editing) > .pxd-item__header"), /max-height: calc\(1\.2em \+ 6px\)/);
  assert.match(header, /font-size: min\(var\(--pxd-map-font\), calc\(\(100cqh - 12px\) \/ 3\.8\)\)/);
  assert.doesNotMatch(rule(".pxd-item"), /overflow:\s*hidden/, "ports sit across the card edge");
  assert.match(rule(".pxd-item__header"), /max-height: 100%;[^}]*overflow: hidden/);
  assert.match(css, /\.pxd-lod-map \.pxd-item--board \.pxd-item__body,\s*\.pxd-lod-map \.pxd-item--wb \.pxd-item__body \{\s*display: block/, "whiteboard-shortcut cards keep their thumbnail at map zoom");
  assert.match(css, /\.pxd-lod-overview \.pxd-item--board \.pxd-item__body,\s*\.pxd-lod-overview \.pxd-item--wb \.pxd-item__body \{\s*display: none/);
  assert.match(rule(".pxd-section__title > .pxd-section__title-text"), /text-overflow: ellipsis/, "the rendered title child owns the ellipsis");
  assert.match(rule('.pxd-root.pxd-lod-overview .pxd-item.pxd-item--card[class*="pxd-c-"]'), /color-mix\(in srgb, var\(--pxd-line\) 42%/);
  assert.match(rule(".pxd-root.pxd-lod-overview .pxd-item--card > .pxd-item__header"), /visibility: hidden/);
  assert.match(rule(".pxd-root.pxd-lod-overview .pxd-section__title"), /font-size: var\(--pxd-overview-font, 40px\)/);
  const pill = rule(".pxd-section__title");
  assert.match(pill, /border: 1px solid var\(--pxd-line/);
  assert.match(pill, /border-radius: 6px/);
  assert.match(pill, /font-weight: 700/);
  assert.match(pill, /text-overflow: ellipsis/);
  assert.match(rule(".pxd-root .pxd-item.pxd-item--card.pxd-item--bare > .pxd-item__header"), /display: block/);
  assert.match(rule(".pxd-root .pxd-item.pxd-item--pinned > .pxd-grip,\n.pxd-root .pxd-section.pxd-section--pinned > .pxd-grip"), /display: none/);
  assert.match(rule(".pxd-root .pxd-item.pxd-item--focus-dim,\n.pxd-root .pxd-section.pxd-section--focus-dim"), /opacity: 0\.18/);
  assert.match(rule(".pxd-root .pxd-item__badges"), /pointer-events: none/);
  assert.match(rule(".pxd-root .pxd-badge-chip.pxd-badge-chip--boards"), /pointer-events: auto/);
  assert.doesNotMatch(rule(".pxd-board-preview"), /accent-soft/);
  assert.match(rule(".pxd-board-preview__canvas"), /width: 100%;\s*height: 100%/);
});

// ---- nested boards ----------------------------------------------------------------------------

const boardCardChildren = () => [
  extraCard("nbCard001", "{{[[diagram]]:Roadmap}}", 7, { ":x": 500, ":y": 300, ":w": 320, ":h": 220, ":v": 2 }, [
    extraCard("kidNB0001", "one", 0, { ":x": 0, ":y": 0, ":w": 100, ":h": 50, ":color": "teal" }),
    extraCard("kidNB0002", "two", 1, { ":x": 200, ":y": 100, ":w": 100, ":h": 50 }),
  ]),
  extraCard("nbUntitl1", "{{[[diagram]]:Untitled board}}", 8, { ":x": 900, ":y": 300, ":w": 320, ":h": 220, ":v": 2 }),
];

const selectCard = async (f, uid, world = { x: 60, y: 60 }) => {
  const el = f.view.root.querySelector(`[data-uid=${uid}]`);
  f.stub.dispatch(el, "pointerdown", { button: 0, clientX: world.x, clientY: world.y, pointerId: 1 });
  f.stub.dispatch(f.stub.document, "pointerup", { clientX: world.x, clientY: world.y, pointerId: 1 });
  await tick(140);
  f.stub.flushFrames();
  return el;
};

test("F5: a board card shows its title, a mini map of the child, the item count and an Open button", async () => {
  const opened = [];
  const f = mountFixture({ extraChildren: boardCardChildren(), viewOptions: { onOpenBoard: (uid) => opened.push(uid) } });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const card = f.view.root.querySelector("[data-uid=nbCard001]");
    assert.ok(card.classList.contains("pxd-item--board"));
    assert.equal(card.querySelector(".pxd-item__header").textContent, "Roadmap");
    assert.equal(card.querySelector(".pxd-item__header").classList.contains("pxd-item__header--muted"), false);
    assert.equal(card.querySelectorAll(".pxd-mini").length, 2);
    const canvas = card.querySelector(".pxd-board-preview__canvas");
    assert.ok(canvas, "the canvas fills the holder");
    assert.equal(canvas.style.aspectRatio, undefined, "no aspect box: the thumbnail frame is padded to the holder");
    const teal = card.querySelector(".pxd-mini.pxd-c-teal");
    const pctOf = (v) => parseFloat(v);
    assert.ok(pctOf(teal.style.left) > 5, "the frame is padded, so a mini never touches the edge");
    assert.ok(pctOf(teal.style.width) < 50, "a mini is a small part of the frame, not one white box");
    assert.equal(teal.querySelector(".pxd-mini__title").textContent, "one");
    assert.equal(card.querySelector(".pxd-item__board-count").textContent, "2 items");
    assert.equal(card.querySelector(".pxd-item__board-name"), null, "a titled board has no name field");
    const open = card.querySelector(".pxd-item__open");
    open.click();
    assert.deepEqual(opened, ["nbCard001"]);
    assert.equal(f.session.mutations.length, 0);
    const empty = f.view.root.querySelector("[data-uid=nbUntitl1]");
    assert.equal(empty.querySelector(".pxd-board-preview__empty").textContent, "Empty board");
    assert.equal(empty.querySelector(".pxd-mini"), null);
    assert.equal(empty.querySelector(".pxd-item__board-count").textContent, "0 items");
    assert.equal(empty.querySelector(".pxd-item__header").classList.contains("pxd-item__header--muted"), true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: Open falls back to the host when no navigation callback is given", async () => {
  const opened = [];
  const f = mountFixture({ extraChildren: boardCardChildren(), hostOverrides: { openBlock: (uid) => opened.push(uid) } });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    f.view.root.querySelector("[data-uid=nbCard001] .pxd-item__open").click();
    assert.deepEqual(opened, ["nbCard001"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: an untitled board card has a name field that renames on Enter and never starts a drag", async () => {
  const f = mountFixture({ extraChildren: boardCardChildren() });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const card = f.view.root.querySelector("[data-uid=nbUntitl1]");
    const input = card.querySelector("input.pxd-item__board-name");
    assert.ok(input);
    assert.equal(input.getAttribute("placeholder"), "Name this board…");
    f.stub.dispatch(input, "pointerdown", { button: 0, clientX: 950, clientY: 400, pointerId: 3 });
    assert.equal(f.view.controller.isGesturing(), false, "the field owns the pointer");
    input.value = "  Plan  ";
    f.stub.dispatch(input, "keydown", { key: "Enter" });
    assert.deepEqual(f.session.mutations.filter((m) => m[0] === "renameBoard"), [["renameBoard", "nbUntitl1", "Plan"]]);
    input.value = "";
    f.stub.dispatch(input, "keydown", { key: "Escape" });
    assert.equal(f.session.mutations.filter((m) => m[0] === "renameBoard").length, 1, "Esc and an empty blur write nothing");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: the header rename commits the whole title on Enter and cancels on Esc", async () => {
  const f = mountFixture({ extraChildren: boardCardChildren() });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    await selectCard(f, "nbCard001", { x: 560, y: 320 });
    const ctx = f.view.root.querySelector(".pxd-ctx");
    assert.equal(ctx.dataset.kind, "board");
    const label = (n) => ctx.querySelectorAll(".pxd-btn").find((b) => b.textContent === n);
    assert.ok(label("Rename board"), "context bar offers Rename board");
    assert.ok(label("Open"));
    label("Rename board").click();
    const header = f.view.root.querySelector("[data-uid=nbCard001] .pxd-item__header");
    assert.ok(header.classList.contains("pxd-item__header--editing"));
    assert.equal(header.getAttribute("contenteditable"), "true");
    assert.equal(header.textContent, "Roadmap");
    header.textContent = "Roadmap 2027";
    f.stub.dispatch(header, "keydown", { key: "Enter" });
    assert.deepEqual(f.session.mutations.filter((m) => m[0] === "renameBoard"), [["renameBoard", "nbCard001", "Roadmap 2027"]]);
    assert.equal(header.classList.contains("pxd-item__header--editing"), false);
    label("Rename board").click();
    header.textContent = "Nope";
    f.stub.dispatch(header, "keydown", { key: "Escape" });
    assert.equal(f.session.mutations.filter((m) => m[0] === "renameBoard").length, 1);
    assert.equal(header.textContent, "Roadmap");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: changing a layout inside the child board refreshes the card preview", async () => {
  const f = mountFixture({ extraChildren: boardCardChildren() });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const card = f.view.root.querySelector("[data-uid=nbCard001]");
    const before = card.querySelector(".pxd-mini.pxd-c-teal");
    const raw = f.board.items.get("nbCard001");
    raw.content[0][":block/props"] = { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 50, ":color": "teal" } };
    f.session.emit("change", { dirty: new Set(["nbCard001"]), structural: false });
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const after = f.view.root.querySelector("[data-uid=nbCard001] .pxd-mini.pxd-c-teal");
    assert.notEqual(after, before, "the preview was rebuilt");
    assert.ok(parseFloat(after.style.width) > parseFloat(before.style.width), "the wider layout draws a wider mini");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: breadcrumbs render only with two or more entries and a click calls onCrumb(index)", async () => {
  const clicked = [];
  const none = mountFixture({ viewOptions: { crumbs: [{ uid: "board0001", title: "Test" }] } });
  try {
    await none.flush();
    assert.equal(none.view.root.querySelector(".pxd-crumbs").style.display, "none");
    assert.equal(none.view.root.querySelectorAll(".pxd-crumb").length, 0);
  } finally {
    none.view.dispose();
    none.restore();
  }
  const f = mountFixture({
    viewOptions: {
      crumbs: [{ uid: "rootAAAA1", title: "Root" }, { uid: "midBBBB02", title: "Middle" }, { uid: "board0001", title: "Test" }],
      onCrumb: (i) => clicked.push(i),
    },
  });
  try {
    await f.flush();
    const bar = f.view.root.querySelector(".pxd-crumbs");
    assert.equal(bar.style.display, "");
    assert.equal(f.view.root.querySelector(".pxd-toolbar").children[0], bar, "crumbs come first in the toolbar");
    const buttons = bar.querySelectorAll("button.pxd-crumb");
    assert.deepEqual(buttons.map((b) => b.textContent), ["Root", "Middle"]);
    assert.equal(bar.querySelector(".pxd-crumb--current").textContent, "Test");
    assert.equal(bar.querySelectorAll(".pxd-crumb__sep").length, 2);
    f.stub.dispatch(buttons[0], "click", { button: 0 });
    await tick();
    assert.deepEqual(clicked, [0]);
    f.stub.dispatch(bar.querySelector(".pxd-crumb--current"), "click", { button: 0 });
    await tick();
    assert.deepEqual(clicked, [0], "the current board is not a button");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: more than four crumbs collapse the middle into an ellipsis that names the hidden boards", async () => {
  const crumbs = ["A", "B", "C", "D", "E", "F"].map((t, i) => ({ uid: `crumb00${i}`, title: t }));
  const f = mountFixture({ viewOptions: { crumbs, onCrumb() {} } });
  try {
    await f.flush();
    const bar = f.view.root.querySelector(".pxd-crumbs");
    assert.deepEqual(bar.querySelectorAll("button.pxd-crumb").map((b) => b.textContent), ["A", "D", "E"]);
    assert.equal(bar.querySelector(".pxd-crumb--current").textContent, "F");
    const more = bar.querySelector(".pxd-crumb__more");
    assert.equal(more.textContent, "…");
    assert.equal(more.title, "B › C");
    assert.deepEqual(bar.querySelectorAll("button.pxd-crumb").map((b) => b.dataset.index), ["0", "3", "4"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: a session title change updates the current crumb", async () => {
  const crumbs = [{ uid: "rootAAAA1", title: "Root" }, { uid: "board0001", title: "Old" }];
  const f = mountFixture({ viewOptions: { crumbs, onCrumb() {} } });
  try {
    await f.flush();
    f.board.title = "Renamed";
    f.session.emit("change", { dirty: new Set(["board0001"]), structural: false });
    assert.equal(f.view.root.querySelector(".pxd-crumb--current").textContent, "Renamed");
    assert.equal(crumbs[1].title, "Renamed", "the shared crumb entry is updated for the feature record");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: Esc with nothing selected goes up one level; at the top it does nothing", async () => {
  const clicked = [];
  const f = mountFixture({
    viewOptions: { crumbs: [{ uid: "rootAAAA1", title: "Root" }, { uid: "board0001", title: "Test" }], onCrumb: (i) => clicked.push(i), autofocus: true },
  });
  try {
    await f.flush();
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await tick();
    assert.deepEqual(clicked, [0]);
  } finally {
    f.view.dispose();
    f.restore();
  }
  const top = mountFixture({ viewOptions: { autofocus: true } });
  try {
    await top.flush();
    top.stub.dispatch(top.stub.window, "keydown", { key: "Escape" });
    await tick();
    assert.equal(top.session.mutations.length, 0);
  } finally {
    top.view.dispose();
    top.restore();
  }
});

test("F5: multi-selection offers Move into new board, which selects the new card", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1", "cardBBBB2"]);
    await tick(140);
    f.stub.flushFrames();
    const ctx = f.view.root.querySelector(".pxd-ctx");
    assert.equal(ctx.dataset.kind, "cards");
    const btn = ctx.querySelectorAll(".pxd-btn").find((b) => b.textContent === "Move into new board");
    assert.ok(btn);
    btn.click();
    await tick();
    assert.deepEqual(f.session.mutations.find((m) => m[0] === "wrapInBoard").slice(1), [["cardAAAA1", "cardBBBB2"]]);
    assert.deepEqual(f.view.controller.getSelection().items, ["wrapInBoard-uid"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: the board tool creates a board through the session", async () => {
  const f = mountFixture({ viewOptions: { autofocus: true } });
  try {
    await f.flush();
    assert.ok(f.view.root.querySelector(".pxd-tool[data-tool=board]"), "toolbar has a Board tool");
    f.stub.dispatch(f.stub.window, "keydown", { key: "w" });
    assert.equal(f.view.root.dataset.tool, "board");
    const viewport = f.view.root.querySelector(".pxd-viewport");
    f.stub.dispatch(viewport, "pointerdown", { button: 0, clientX: 700, clientY: 500, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 700, clientY: 500, pointerId: 1 });
    await tick();
    const call = f.session.mutations.find((m) => m[0] === "createBoard");
    assert.deepEqual(call[1], { rect: { x: 540, y: 390, w: 320, h: 220 } });
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: dropping a card on a board card moves it in with an Undo toast; a refusal falls back to a plain move", async () => {
  const f = mountFixture({ extraChildren: boardCardChildren() });
  try {
    await f.flush();
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1]");
    f.stub.dispatch(alpha, "pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 300, clientY: 200, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 560, clientY: 340, pointerId: 1 });
    f.stub.flushFrames();
    assert.ok(f.view.root.querySelector("[data-uid=nbCard001]").classList.contains("pxd-item--drop"), "drop target is highlighted");
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 560, clientY: 340, pointerId: 1 });
    await tick();
    const move = f.session.mutations.find((m) => m[0] === "moveIntoBoard");
    assert.deepEqual(move.slice(1, 3), [["cardAAAA1"], "nbCard001"]);
    assert.equal(f.session.mutations.filter((m) => m[0] === "commitMove").length, 0);
    const toast = f.view.root.querySelector(".pxd-toast");
    assert.equal(toast.style.display, "");
    assert.equal(toast.querySelector(".pxd-toast__text").textContent, "Moved into Inner");
    toast.querySelector(".pxd-toast__action").click();
    assert.ok(f.session.mutations.some((m) => m[0] === "moveUndo"), "Undo runs the inverse transaction");
    f.session.moveResult = null;
    f.stub.dispatch(alpha, "pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 2 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 300, clientY: 200, pointerId: 2 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 560, clientY: 340, pointerId: 2 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 560, clientY: 340, pointerId: 2 });
    await tick();
    assert.equal(f.session.mutations.filter((m) => m[0] === "commitMove").length, 1);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: opening a board card calls onOpenBoard with the uid, and leaves edit mode first", async () => {
  const opened = [];
  const f = mountFixture({ extraChildren: boardCardChildren(), viewOptions: { onOpenBoard: (u) => opened.push(u) } });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const card = f.view.root.querySelector("[data-uid=nbCard001]");
    f.stub.dispatch(card, "dblclick", { clientX: 560, clientY: 320 });
    await tick();
    assert.deepEqual(opened, ["nbCard001"]);
    await startEdit(f, "cardAAAA1");
    assert.ok(f.view.root.classList.contains("pxd-root--editing"));
    f.stub.dispatch(card, "dblclick", { clientX: 560, clientY: 320 });
    await tick(20);
    assert.equal(f.view.root.classList.contains("pxd-root--editing"), false, "edit mode exited before navigating");
    assert.deepEqual(opened, ["nbCard001", "nbCard001"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: the inline height key and the route watch belong to routeUid, not the nested board", async () => {
  const f = mountFixture({ viewOptions: { routeUid: "routeUID1", autofocus: true } });
  try {
    await f.flush();
    const grip = f.view.root.querySelector(".pxd-resize-grip");
    f.stub.dispatch(grip, "pointerdown", { clientY: 100, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientY: 160 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientY: 160 });
    assert.ok(f.stub.localStorage.getItem("plexus-diagram:h:Svy:routeUID1"), "height is stored under the route board uid");
    assert.equal(f.stub.localStorage.getItem("plexus-diagram:h:Svy:board0001"), null);
    assert.equal(f.stub.document.activeElement, f.view.root, "autofocus puts the keyboard on the board");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: a fullscreen nested view stays fullscreen while the route is its mount board and exits when the route leaves it", async () => {
  const exits = [];
  const f = mountFixture({ viewOptions: { fullscreen: true, routeUid: "routeUID1", onRequestFullscreen: (on) => exits.push(on) } });
  try {
    await f.flush();
    f.stub.window.location.hash = "#/app/Svy/page/routeUID1";
    f.stub.dispatch(f.stub.window, "hashchange", {});
    assert.deepEqual(exits, [], "the nested board's own uid is not the route");
    f.stub.window.location.hash = "#/app/Svy/page/elsewhere";
    f.stub.dispatch(f.stub.window, "hashchange", {});
    assert.deepEqual(exits, [false]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F5: a plain-object settings map is honored by the view", async () => {
  const f = mountFixture({ viewOptions: { settings: { grid: "lines", "show-minimap": false } } });
  try {
    await f.flush();
    assert.ok(f.view.root.querySelector(".pxd-grid").classList.contains("pxd-grid--lines"));
    assert.equal(f.view.root.querySelector(".pxd-minimap").style.display, "none");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("NP-6: a sidebar mount defaults to the outline and does not open the block", async () => {
  const prep = createDomStub();
  const undoPrep = prep.install();
  const sidebar = prep.document.createElement("div");
  sidebar.className = "rm-sidebar-window";
  const nativeEl = prep.document.createElement("div");
  sidebar.append(nativeEl);
  undoPrep();
  const rendered = [];
  const f = mountFixture({
    viewOptions: { nativeEl },
    hostOverrides: {
      renderBlock(el, uid) { rendered.push(uid); },
    },
  });
  try {
    await f.flush();
    const root = f.view.root;
    assert.ok(root.classList.contains("pxd-root--sidebar"));
    assert.ok(root.classList.contains("pxd-root--outline"));
    const want = ["cardAAAA1", "cardBBBB2", "cardFAR03", "cardFAR04", "textTTTT5", "sectCCCC3", "edgesEEE5"];
    assert.deepEqual([...root.querySelectorAll(".pxd-sidebar-outline__row")].map((r) => r.dataset.uid), want);
    assert.deepEqual(rendered, want);
    assert.equal(root.querySelector(".pxd-mode__outline").classList.contains("pxd-mode__btn--on"), true);
    assert.equal(f.session.mutations.some((m) => m[0] === "setBlockOpen"), false);
    f.session.emit("change", { dirty: new Set(["cardAAAA1"]) });
    assert.deepEqual(rendered, want, "a string echo does not rebuild the outline");
    root.querySelector(".pxd-mode__board").click();
    assert.equal(root.classList.contains("pxd-root--outline"), false);
    assert.equal(root.querySelectorAll(".pxd-sidebar-outline__row").length, 0);
    assert.equal(f.host.calls.unmount, want.length);
    assert.equal(f.session.mutations.some((m) => m[0] === "setBlockOpen"), false);
    root.querySelector(".pxd-mode__outline").click();
    assert.ok(root.classList.contains("pxd-root--outline"));
    assert.deepEqual(rendered, [...want, ...want]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("NP-6: a page mount has no sidebar mode bar", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    assert.equal(f.view.root.querySelector(".pxd-mode"), null);
    assert.equal(f.view.root.classList.contains("pxd-root--sidebar"), false);
    assert.equal(f.view.root.classList.contains("pxd-root--outline"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("R2 guard: a key pressed while editing with focus on <body> recovers focus instead of running a board shortcut", async () => {
  const f = mountFixture({ viewOptions: { autofocus: true } });
  try {
    await f.flush();
    await startEdit(f, "cardAAAA1");
    assert.ok(f.view.root.classList.contains("pxd-root--editing"));
    f.stub.document.activeElement = f.stub.document.body;
    f.stub.dispatch(f.stub.window, "keydown", { key: "Backspace" });
    f.stub.dispatch(f.stub.window, "keydown", { key: "n" });
    await tick();
    assert.equal(f.session.mutations.filter((m) => m[0] === "deleteItems").length, 0, "Backspace never deletes the card being edited");
    assert.equal(f.view.controller.getTool(), "select", "n does not switch tools mid-edit");
  } finally {
    f.view.dispose();
    f.restore();
  }
});
