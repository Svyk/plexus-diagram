import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { freshCardIsBlank, mountBoardView, pageRenameNeedsConfirm, sidebarMountKind, toggleTodoAt } from "../src/view/board-view.js";
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
    setKids: rec("setKids"),
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

function mountFixture({ vp = { x: 0, y: 0, zoom: 1 }, settings = {}, extraChildren = [], hostOverrides = {}, viewOptions = {}, cardOpen, kidsOn = [] } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem(`plexus-diagram:vp:Svy:board0001`, JSON.stringify(vp));
  const tree = pulled(extraChildren);
  if (cardOpen === false) tree[":block/children"][0][":block/open"] = false;
  for (const c of tree[":block/children"]) if (kidsOn.includes(c[":block/uid"])) c[":block/props"] = { ":plexus": { ...(c[":block/props"]?.[":plexus"] || {}), ":kids": true } };
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
    // A click selects. Double-click edits, and the context bar stays hidden until Esc.
    f.stub.dispatch(alpha, "pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 50, clientY: 50, pointerId: 1 });
    await tick(300);
    f.stub.flushFrames();
    assert.ok(alpha.classList.contains("pxd-item--selected"));
    assert.equal(alpha.classList.contains("pxd-item--editing"), false);
    f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
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
      ["Color", "Expand children", "References"],
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
      ":block/props": { ":plexus": { ":x": 0, ":y": 160, ":w": 200, ":h": 100, ":kids": true } },
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
    assert.deepEqual(f.session.mutations.at(-1).slice(0, 3), ["setKids", "cardAAAA1", true]);
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

test("Edit Block opens the board block editor and Esc returns to the board", async () => {
  const rendered = [];
  const f = mountFixture({
    hostOverrides: {
      renderBlock(el, uid) {
        rendered.push(uid);
        const native = globalThis.document.createElement("button");
        native.setAttribute("title", "Edit Block");
        native.addEventListener("click", () => {
          const input = globalThis.document.createElement("textarea");
          input.className = "rm-block__input";
          input.value = "{{[[diagram]]:board}}";
          el.append(input);
        });
        el.append(native);
      },
    },
  });
  try {
    await f.flush();
    const root = f.view.root;
    const btn = root.querySelector(".pxd-rail__edit");
    assert.equal(btn.getAttribute("aria-label"), "Edit Block");
    const buttons = [...root.querySelectorAll(".pxd-rail__btn")];
    assert.equal(buttons.indexOf(btn) + 1, buttons.indexOf(root.querySelector(".pxd-rail__fullscreen")));
    btn.click();
    const editor = root.querySelector(".pxd-block-edit");
    assert.ok(editor);
    assert.deepEqual(rendered, ["board0001"]);
    assert.ok(editor.querySelector(".rm-block__input"));
    assert.equal(f.session.mutations.length, 0);
    const input = editor.querySelector(".rm-block__input");
    input.focus();
    f.stub.dispatch(input, "keydown", { key: "Escape" });
    assert.equal(root.querySelector(".pxd-block-edit"), null);
    assert.ok(root.querySelector(".pxd-world"));
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("I and the Info button open card info; fullscreen edits in the panel", async () => {
  const side = [];
  const opened = [];
  const mounted = [];
  const unmounted = [];
  const f = mountFixture({
    viewOptions: { autofocus: true },
    hostOverrides: {
      cardInfo(item) {
        if (item.target?.kind === "page") {
          return {
            kind: "page",
            uid: null,
            pageUid: "pgBeta001",
            title: item.title,
            body: "Beta",
            attributes: [{ name: "Role", value: "tester" }],
            refs: [],
            boards: [],
            tags: [],
          };
        }
        return {
          kind: "self",
          uid: item.uid,
          title: item.title,
          body: "Alpha #live",
          attributes: [{ name: "Status", value: "green" }],
          refs: [{ uid: "ref111111", string: "mentions alpha", pageTitle: "Test Lab" }],
          boards: [{ uid: "boardZZZZ", title: "Other board", pageTitle: "Test Lab" }],
          tags: ["live"],
        };
      },
      renderBlock(el, uid) { mounted.push(["block", uid]); el.textContent = "block-editor"; },
      renderPage(el, uid) { mounted.push(["page", uid]); el.textContent = "page-editor"; },
      unmount(el) { unmounted.push(el.textContent); },
      openInSidebar(uid, type) { side.push([uid, type]); },
      openBlock(uid) { opened.push(uid); },
    },
  });
  try {
    await f.flush();
    const root = f.view.root;
    f.view.controller.select(["cardAAAA1"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "I" });
    await f.flush();
    assert.equal(root.querySelector(".pxd-panel__pane--info").style.display, "");
    assert.deepEqual(
      [...root.querySelectorAll(".pxd-panel__info-h")].map((n) => n.textContent),
      ["Card", "Attributes", "Linked references", "On boards", "Tags"],
    );
    assert.equal(root.querySelector(".pxd-panel__info-body").textContent, "Alpha #live");
    assert.equal(root.querySelector(".pxd-panel__info-value").textContent, "green");
    assert.equal(root.querySelector(".pxd-panel__info-ref").textContent, "mentions alpha");
    assert.equal(root.querySelector(".pxd-panel__info-board-title").textContent, "Other board");
    assert.equal(root.querySelector(".pxd-panel__info-tag").textContent, "live");
    assert.equal(root.querySelector(".pxd-panel__info-note").textContent, "Editing in the right sidebar");
    assert.deepEqual(side, [["cardAAAA1", "block"]]);
    assert.deepEqual(mounted, []);
    root.querySelector(".pxd-panel__info-board").click();
    assert.deepEqual(opened, ["boardZZZZ"]);
    f.view.setFullscreen(true);
    root.querySelector(".pxd-toolbar__info").click();
    await f.flush();
    assert.equal(root.querySelector(".pxd-panel__info-note"), null);
    assert.deepEqual(mounted, [["block", "cardAAAA1"]]);
    f.view.controller.select(["cardBBBB2"]);
    await f.flush();
    assert.deepEqual(mounted, [["block", "cardAAAA1"], ["page", "pgBeta001"]]);
    assert.equal(root.querySelector(".pxd-panel__info-value").textContent, "tester");
    assert.deepEqual(unmounted, ["block-editor"]);
    root.querySelector(".pxd-panel__close").click();
    assert.deepEqual(unmounted, ["block-editor", "page-editor"]);
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
    f.session.emit("sync", "writing");
    assert.ok(root.querySelector(".pxd-sync").classList.contains("pxd-sync--pending"));
    assert.ok(root.querySelector(".pxd-sync").classList.contains("pxd-sync--writing"));
    assert.equal(root.querySelector(".pxd-sync").title, "Saving…");
    f.session.emit("sync", "idle");
    assert.equal(root.querySelector(".pxd-sync").classList.contains("pxd-sync--pending"), false);
    assert.equal(root.querySelector(".pxd-sync").title, "Synced");
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
    kidsOn: ["cardAAAA1"],
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
    // The floor has stopped. The editor-menu watcher still holds one rAF until
    // twelve empty frames; drain those and then require a quiet queue.
    for (let i = 0; i < 20 && f.stub.frames.length; i += 1) f.stub.flushFrames();
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

test("R3: editing card keeps the measured floor and a frozen header; both restore on exit", async () => {
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

const contentBox = (height, width = 200) => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 });

test("ED-1: enter locks the measured content box and keeps the static layer for an 80ms crossfade", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const body = alpha.querySelector(".pxd-item__body");
    const staticText = body.querySelector(".pxd-item__string");
    body._rect = contentBox(140);
    f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
    assert.equal(alpha.style.minHeight, "140px", "min-height is the measured content box, not the stored 100px");
    assert.ok(alpha.classList.contains("pxd-item--xfade"));
    const ghost = body.querySelector(".pxd-item__ghost");
    assert.ok(ghost?.contains(staticText), "static text stays until the editor is opaque");
    const editor = body.querySelector(".pxd-item__editor");
    assert.ok(editor);
    f.stub.flushFrames();
    assert.equal(alpha.style.minHeight, "140px", "one frame does not end the fade");
    assert.ok(body.querySelector(".pxd-item__ghost"));
    editor._rect = contentBox(180);
    await tick(100);
    assert.equal(body.querySelector(".pxd-item__ghost"), null, "static layer leaves after 80ms");
    assert.equal(alpha.classList.contains("pxd-item--xfade"), false);
    assert.equal(alpha.style.minHeight, "140px", "lock holds for the editor's first in-flow frame");
    f.stub.flushFrames();
    assert.equal(alpha.style.minHeight, "", "released once the editor fills the measured box");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-1: a shorter editor keeps the measured floor so the card cannot collapse", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const body = alpha.querySelector(".pxd-item__body");
    body._rect = contentBox(140);
    f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
    body.querySelector(".pxd-item__editor")._rect = contentBox(40);
    await tick(100);
    f.stub.flushFrames();
    assert.equal(alpha.style.minHeight, "140px");
    f.stub.dispatch(body.querySelector("textarea"), "keydown", { key: "Escape" });
    await tick();
    assert.equal(alpha.style.minHeight, "");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-1: a 0 content box falls back to the stored height", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1]");
    f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
    assert.equal(alpha.style.minHeight, "100px");
    assert.ok(alpha.classList.contains("pxd-item--xfade"));
    await tick(100);
    f.stub.flushFrames();
    assert.equal(alpha.style.minHeight, "100px", "an empty editor does not drop the floor");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-1: reduced motion skips the crossfade and releases a filled editor on the next frame", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.stub.window.matchMedia = (query) => ({ matches: String(query).includes("prefers-reduced-motion"), media: String(query) });
    const alpha = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const body = alpha.querySelector(".pxd-item__body");
    body._rect = contentBox(140);
    f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
    assert.equal(alpha.style.minHeight, "140px");
    assert.equal(alpha.classList.contains("pxd-item--xfade"), false);
    assert.equal(body.querySelector(".pxd-item__ghost"), null);
    const editor = body.querySelector(".pxd-item__editor");
    assert.ok(editor);
    editor._rect = contentBox(140);
    f.stub.flushFrames();
    assert.equal(alpha.style.minHeight, "");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-1: crossfade is 80ms and absent under reduced motion", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-item:not\(\.pxd-item--text\) \.pxd-item__editor :is\([^)]*\.rm-block__input--view[^)]*\) \{\s*margin-top: 0 !important;\s*padding-top: 1px !important;\s*line-height: 1\.4 !important;/);
  assert.match(css, /animation: pxd-edit-in 80ms linear forwards/);
  assert.match(css, /animation: pxd-edit-out 80ms linear forwards/);
  assert.match(css, /@keyframes pxd-edit-in \{[^}]*to \{ opacity: 1; \}/);
  assert.match(css, /@keyframes pxd-edit-out \{[^}]*to \{ opacity: 0; \}/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /pxd-item--xfade[\s\S]*animation: none/);
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
  assert.doesNotMatch(rule(".pxd-root.pxd-lod-map .pxd-item.pxd-item--card:not(.pxd-item--editing)"), /container-type:\s*size/);
  const header = rule(".pxd-root.pxd-lod-map .pxd-item.pxd-item--card:not(.pxd-item--editing) > .pxd-item__header");
  for (const decl of ["flex: 0 1 auto", "min-height: 0", "padding-bottom: 0", "max-height: calc(3 * 1.2em + 6px)", "line-height: 1.2", "overflow: hidden", "display: -webkit-box", "-webkit-box-orient: vertical", "-webkit-line-clamp: 3", "overflow-wrap: anywhere", "text-overflow: ellipsis"]) assert.ok(header.includes(decl), decl);
  assert.doesNotMatch(header, /flex:\s*1 1 auto/, "a stretched -webkit-box paints lines after the clamp");
  assert.match(rule(".pxd-root.pxd-lod-map .pxd-item.pxd-item--card.pxd-item--wb:not(.pxd-item--editing) > .pxd-item__header"), /max-height: calc\(1\.2em \+ 6px\)/);
  assert.match(header, /font-size: var\(--pxd-map-font\)/);
  assert.doesNotMatch(rule(".pxd-item"), /overflow:\s*hidden/, "ports sit across the card edge");
  assert.match(rule(".pxd-item__header"), /max-height: 100%;[^}]*overflow: hidden/);
  assert.match(css, /\.pxd-lod-map \.pxd-item--board \.pxd-item__body,\s*\.pxd-lod-map \.pxd-item--wb \.pxd-item__body \{\s*display: block/, "whiteboard-shortcut cards keep their thumbnail at map zoom");
  assert.match(css, /\.pxd-lod-overview \.pxd-item--board \.pxd-item__body,\s*\.pxd-lod-overview \.pxd-item--wb \.pxd-item__body \{\s*display: none/);
  assert.match(rule(".pxd-section__title > .pxd-section__title-text"), /text-overflow: ellipsis/, "the rendered title child owns the ellipsis");
  assert.match(rule('.pxd-root.pxd-lod-overview .pxd-item.pxd-item--card[class*="pxd-c-"]'), /background-color: var\(--pxd-line\)/);
  assert.match(rule(".pxd-root.pxd-lod-overview .pxd-item--card > .pxd-item__header"), /display: none/);
  assert.match(rule(".pxd-root.pxd-lod-overview .pxd-section__title"), /font-size: var\(--pxd-overview-font, 40px\)/);
  assert.match(rule(".pxd-root.pxd-lod-overview .pxd-section__title"), /z-index: 1/, "overview titles paint above cards");
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
    const label = (n) => ctx.querySelectorAll(".pxd-btn").find((b) => b.getAttribute("aria-label") === n);
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
  const clicked = [];
  const crumbs = ["A", "B", "C", "D", "E", "F"].map((t, i) => ({ uid: `crumb00${i}`, title: t }));
  const f = mountFixture({ viewOptions: { crumbs, onCrumb: (i) => clicked.push(i) } });
  try {
    await f.flush();
    const bar = f.view.root.querySelector(".pxd-crumbs");
    const rowCrumbs = () => bar.querySelectorAll("button.pxd-crumb").filter((b) => b.parentElement === bar);
    assert.deepEqual(rowCrumbs().map((b) => b.textContent), ["A", "D", "E"]);
    assert.equal(bar.querySelector(".pxd-crumb--current").textContent, "F");
    const more = bar.querySelector(".pxd-crumb__more");
    assert.equal(more.textContent, "…");
    assert.equal(more.title, "B › C");
    assert.equal(more.tagName, "BUTTON");
    assert.equal(bar.querySelector(".pxd-crumb-menu"), null);
    assert.deepEqual(rowCrumbs().map((b) => b.dataset.index), ["0", "3", "4"]);
    f.stub.dispatch(more, "click", { button: 0 });
    const menu = bar.querySelector(".pxd-crumb-menu");
    assert.deepEqual(menu.querySelectorAll("button.pxd-crumb").map((b) => b.textContent), ["B", "C"]);
    assert.deepEqual(menu.querySelectorAll("button.pxd-crumb").map((b) => b.dataset.index), ["1", "2"]);
    f.stub.dispatch(menu.querySelector("button.pxd-crumb"), "click", { button: 0 });
    assert.deepEqual(clicked, [1]);
    assert.equal(bar.querySelector(".pxd-crumb-menu"), null, "picking a hidden board closes the menu");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("HB-11: a restored camera is applied and dispose writes it", async () => {
  const f = mountFixture({ viewOptions: { initialViewport: { x: 40, y: -15, zoom: 1.25 } } });
  try {
    await f.flush();
    assert.deepEqual(f.view.viewport(), { x: 40, y: -15, zoom: 1.25 });
    assert.equal(f.view.state().zoom, 1.25);
    assert.match(f.view.root.querySelector(".pxd-world").style.transform, /1\.25/);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
  const stored = JSON.parse(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001"));
  assert.deepEqual(stored, { x: 40, y: -15, zoom: 1.25 });
});

test("HB-11: Cmd+[ and Cmd+] ask for history and write nothing", async () => {
  const seen = [];
  const f = mountFixture({
    viewOptions: {
      autofocus: true,
      onHistoryBack: () => seen.push("back"),
      onHistoryForward: () => seen.push("forward"),
    },
  });
  try {
    await f.flush();
    f.stub.dispatch(f.stub.window, "keydown", { key: "[", code: "BracketLeft", metaKey: true });
    f.stub.dispatch(f.stub.window, "keydown", { key: "]", code: "BracketRight", ctrlKey: true });
    assert.deepEqual(seen, ["back", "forward"]);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("HB-11: Own page opens the nested board through the host and leaves the in-place board", async () => {
  const inPlace = [];
  const hostOpened = [];
  const f = mountFixture({
    extraChildren: boardCardChildren(),
    viewOptions: { onOpenBoard: (uid) => inPlace.push(uid) },
    hostOverrides: { openBlock: (uid) => hostOpened.push(uid) },
  });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    await selectCard(f, "nbCard001");
    const btn = f.view.root.querySelector(".pxd-ctx__own-page");
    assert.equal(btn.getAttribute("aria-label"), "Own page");
    assert.ok(btn.querySelector(".bp3-icon-document"));
    assert.equal(btn.title, "Open nested board in its own page");
    btn.click();
    assert.deepEqual(hostOpened, ["nbCard001"]);
    assert.deepEqual(inPlace, []);
    assert.equal(f.session.mutations.length, 0);
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
    const btn = ctx.querySelectorAll(".pxd-btn").find((b) => b.getAttribute("aria-label") === "Move into new board");
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

test("NP-7: sidebar mount kind comes from the window id", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const make = (id) => {
      const win = stub.document.createElement("div");
      win.className = "rm-sidebar-window";
      if (id) win.id = id;
      const native = stub.document.createElement("div");
      win.append(native);
      return native;
    };
    assert.equal(sidebarMountKind(null), "main");
    assert.equal(sidebarMountKind(make("")), "block");
    assert.equal(sidebarMountKind(make("sidebar-window-sidebar-block-abc")), "block");
    assert.equal(sidebarMountKind(make("sidebar-window-sidebar-outline-abc")), "outline");
    assert.equal(sidebarMountKind(make("sidebar-window-sidebar-mentions-abc")), "mentions");
  } finally {
    restore();
  }
});

test("NP-7: a sidebar board keeps its own viewport, keys, and fullscreen", async () => {
  const f = mountFixture();
  const sidebar = f.stub.document.createElement("div");
  sidebar.id = "sidebar-window-sidebar-block-board0001";
  sidebar.className = "rm-sidebar-window";
  const nativeEl = f.stub.document.createElement("div");
  const mountEl = f.stub.document.createElement("div");
  sidebar.append(nativeEl, mountEl);
  f.stub.document.body.append(sidebar);
  const side = mountBoardView({
    host: f.host,
    session: f.session,
    mountEl,
    nativeEl,
    settings: { get: () => undefined },
  });
  try {
    await f.flush();
    const outlineKey = f.stub.dispatch(f.stub.window, "keydown", { key: "n" });
    assert.equal(outlineKey.propagationStopped, false, "outline mode does not swallow a key");
    assert.equal(side.root.dataset.tool, "select");
    side.root.querySelector(".pxd-mode__board").click();
    const mainWorld = f.view.root.querySelector(".pxd-world");
    const sideWorld = side.root.querySelector(".pxd-world");
    const mainBefore = mainWorld.style.transform;
    f.stub.dispatch(side.root.querySelector(".pxd-viewport"), "pointerdown", { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 9 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 140, clientY: 130, pointerId: 9 });
    f.stub.flushFrames();
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 140, clientY: 130, pointerId: 9 });
    assert.notEqual(sideWorld.style.transform, mainBefore, "the sidebar board pans");
    assert.equal(mainWorld.style.transform, mainBefore, "the main board stays put");
    // Gesture end waits 120ms, then the viewport store waits another 500ms. Both are real timers.
    await tick(700);
    const sideRaw = f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001:block");
    const mainRaw = f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001");
    assert.equal(JSON.parse(mainRaw).zoom, 1, "the main viewport key is unchanged");
    assert.ok(sideRaw, "missing sidebar viewport");
    const sideVp = JSON.parse(sideRaw);
    assert.notDeepEqual(sideVp, JSON.parse(mainRaw), "the sidebar viewport is its own key");
    f.view.root.focus();
    f.stub.dispatch(f.stub.window, "keydown", { key: "g" });
    assert.equal(f.view.root.dataset.tool, "section");
    assert.equal(side.root.dataset.tool, "select", "a key in the main board does not change the sidebar tool");
    side.root.focus();
    f.stub.dispatch(f.stub.window, "keydown", { key: "h" });
    assert.equal(side.root.dataset.tool, "hand");
    assert.equal(f.view.root.dataset.tool, "section", "a key in the sidebar board does not change the main tool");
    side.root.querySelector(".pxd-rail__fullscreen").click();
    assert.ok(side.root.classList.contains("pxd-root--fullscreen"), side.root.className);
    assert.equal(f.view.root.classList.contains("pxd-root--fullscreen"), false);
    const card = f.board.items.get("cardAAAA1");
    card.x = 80;
    f.session.rects = worldRects(f.board);
    f.session.emit("change", { dirty: new Set(["cardAAAA1"]) });
    await f.flush();
    const moved = "translate(80px, 0px)";
    assert.equal(f.view.root.querySelector(".pxd-item[data-uid=cardAAAA1]").style.transform, moved);
    assert.equal(side.root.querySelector(".pxd-item[data-uid=cardAAAA1]").style.transform, moved);
    const zoomBefore = sideVp.zoom;
    f.stub.dispatch(side.root.querySelector(".pxd-viewport"), "wheel", { ctrlKey: true, deltaY: -80, clientX: 200, clientY: 200 });
    await tick(700);
    const zoomed = JSON.parse(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001:block"));
    assert.ok(zoomed.zoom > zoomBefore, "a pinch on the sidebar stores its own zoom");
    assert.equal(JSON.parse(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001")).zoom, 1);
  } finally {
    side.dispose();
    f.view.dispose();
    f.restore();
  }
});

test("RG-10: two embeds keep their own viewports and a shortcut card stays a thumbnail", async () => {
  const vp = { x: 12.5, y: -3.25, zoom: 1 };
  const f = mountFixture({
    vp,
    extraChildren: [{
      ":block/uid": "wbCard001",
      ":block/string": "((wbTarget1))",
      ":block/order": 9,
      ":block/props": { ":plexus": { ":x": 520, ":y": 40, ":w": 220, ":h": 140 } },
      ":block/children": [],
    }],
    hostOverrides: {
      blockString: (uid) => {
        if (uid === "wbTarget1") return "{{[[diagram]]:Whiteboard}}";
        if (uid === "uyXFLc-bf" || uid === "embedOwn02") return "{{[[embed]]: ((board0001))}}";
        return null;
      },
      pullBoard: (uid) => (uid === "wbTarget1" ? { ":block/uid": "wbTarget1", ":block/string": "{{[[diagram]]:Whiteboard}}", ":block/children": [] } : null),
    },
  });
  const exact = f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001");
  const make = (ownerUid) => {
    const container = f.stub.document.createElement("div");
    container.className = "roam-block-container";
    const main = f.stub.document.createElement("div");
    main.className = "rm-block-main";
    const input = f.stub.document.createElement("div");
    input.id = `block-input-w-body-outline-xxnGb6SEj-${ownerUid}`;
    const wrap = f.stub.document.createElement("div");
    wrap.className = "rm-embed-container";
    const native = f.stub.document.createElement("div");
    native.className = "rm-diagram";
    const mountEl = f.stub.document.createElement("div");
    wrap.append(native);
    input.append(wrap);
    main.append(input);
    container.append(main);
    f.stub.document.body.append(container, mountEl);
    return mountBoardView({
      host: f.host,
      session: f.session,
      mountEl,
      nativeEl: native,
      settings: { get: () => undefined },
    });
  };
  const a = make("uyXFLc-bf");
  const b = make("embedOwn02");
  try {
    await f.flush();
    const mainWorld = f.view.root.querySelector(".pxd-world");
    const aWorld = a.root.querySelector(".pxd-world");
    const bWorld = b.root.querySelector(".pxd-world");
    const before = mainWorld.style.transform;
    assert.equal(aWorld.style.transform, before, "an embed starts from the main camera");
    assert.equal(bWorld.style.transform, before);
    const card = [...f.view.root.querySelectorAll(".pxd-item")].find((node) => node.getAttribute("data-uid") === "wbCard001");
    assert.ok(card, "shortcut shell missing");
    assert.ok(card.classList.contains("pxd-item--wb"), "the shortcut stays a thumbnail");
    assert.equal(card.querySelector(".pxd-root"), null);
    assert.equal(f.stub.document.querySelectorAll(".pxd-root").length, 3);
    f.stub.dispatch(a.root.querySelector(".pxd-viewport"), "pointerdown", { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 8 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 160, clientY: 140, pointerId: 8 });
    f.stub.flushFrames();
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 160, clientY: 140, pointerId: 8 });
    assert.notEqual(aWorld.style.transform, before, "the panned embed moves");
    assert.equal(mainWorld.style.transform, before, "the original stays");
    assert.equal(bWorld.style.transform, before, "the other embed stays");
    await tick(700);
    assert.equal(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001"), exact);
    const stored = f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001:embed:uyXFLc-bf");
    assert.equal(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001:embed:bf"), null);
    assert.ok(stored);
    assert.notEqual(stored, exact);
    assert.equal(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001:embed:embedOwn02"), null);
    a.dispose();
    b.dispose();
    assert.equal(f.stub.localStorage.getItem("plexus-diagram:vp:Svy:board0001"), exact);
    assert.equal(f.stub.document.querySelectorAll(".pxd-root").length, 1);
  } finally {
    a.dispose();
    b.dispose();
    f.view.dispose();
    f.restore();
  }
});

test("NP-8: every direction, decoration, and type paints, including weight 4", async () => {
  const f = mountFixture({ settings: { motion: "reduced" } });
  try {
    await f.flush();
    assert.ok(f.view.root.classList.contains("pxd-root--motion-off"));
    const edge = f.board.edges.get("edgeFFFF6");
    const dirs = ["one", "none", "two"];
    const dashes = ["solid", "dashed", "animated"];
    const routes = ["straight", "elbow", "curve"];
    let n = 0;
    for (const dir of dirs) {
      for (const dash of dashes) {
        for (const route of routes) {
          edge.dir = dir;
          edge.dash = dash;
          edge.route = route;
          edge.weight = 4;
          f.session.emit("change", { dirty: new Set(["edgeFFFF6"]) });
          await f.flush();
          const g = f.view.root.querySelector(".pxd-edge[data-uid=edgeFFFF6]");
          assert.ok(g.querySelector(".pxd-edge__line").getAttribute("d"), `${dir} ${dash} ${route}`);
          assert.ok(g.classList.contains("pxd-edge--w4"));
          assert.equal(g.classList.contains("pxd-edge--dashed"), dash === "dashed");
          assert.equal(g.classList.contains("pxd-edge--animated"), dash === "animated");
          const heads = [...g.querySelectorAll(".pxd-edge__head")];
          const head = heads.find((el) => !el.classList.contains("pxd-edge__tail")).getAttribute("display") !== "none";
          const tail = heads.find((el) => el.classList.contains("pxd-edge__tail")).getAttribute("display") !== "none";
          assert.equal(head, dir !== "none", dir);
          assert.equal(tail, dir === "two", dir);
          n += 1;
        }
      }
    }
    assert.equal(n, 27);
    f.board.plexus.bgColor = "#112233";
    f.session.emit("change", {});
    await f.flush();
    assert.equal(f.view.root.style["--pxd-label-bg"], "#112233");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("NP-9: native embeds keep a shield until edit, and a drag still moves the card", async () => {
  const native = [
    ["np9img001", "![shot](https://example.com/a.png)", 520, 0],
    ["np9hl0001", "{{pdf-highlight: quoted passage}}", 520, 90],
    ["np9pdf001", "{{[[pdf]]: https://example.com/a.pdf}}", 520, 180],
    ["np9vid001", "{{[[video]]: https://example.com/a.mp4}}", 680, 0],
    ["np9tw0001", "{{tweet: https://twitter.com/jack/status/20}}", 680, 90],
    ["np9yt0001", "{{[[youtube]]: dQw4w9WgXcQ}}", 680, 180],
  ];
  const extra = native.map(([uid, string, x, y], i) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": 20 + i,
    ":block/props": { ":plexus": { ":x": x, ":y": y, ":w": 150, ":h": 80 } },
    ":block/children": [],
  }));
  const f = mountFixture({
    extraChildren: extra,
    hostOverrides: {
      renderString(el, string) {
        this.calls.renderString += 1;
        const doc = globalThis.document;
        const add = (tag, cls) => {
          const node = doc.createElement(tag);
          if (cls) node.className = cls;
          el.append(node);
        };
        if (string.startsWith("![")) add("img", "rm-inline-img");
        else if (string.includes("pdf-highlight")) add("div", "rm-pdf-highlight");
        else if (string.includes("{{[[pdf]]")) add("div", "rm-pdf-container");
        else if (string.includes("{{[[video]]")) add("video");
        else if (string.includes("{{tweet:")) add("button", "rm-xparser-default-tweet");
        else if (string.includes("{{[[youtube]]")) return;
        else el.textContent = string;
      },
    },
  });
  const drag = (node) => {
    f.stub.dispatch(node, "pointerdown", { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointermove", { clientX: 80, clientY: 90, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 80, clientY: 90, pointerId: 1 });
  };
  try {
    await f.flush();
    const root = f.view.root;
    const expectShield = ["np9hl0001", "np9pdf001", "np9vid001", "np9tw0001"];
    for (const uid of expectShield) {
      const card = root.querySelector(`[data-uid=${uid}]`);
      assert.ok(card.querySelector(".pxd-embed-shield"), uid);
      drag(card.querySelector(".pxd-embed-shield"));
    }
    const img = root.querySelector("[data-uid=np9img001] img");
    assert.equal(root.querySelector("[data-uid=np9img001] .pxd-embed-shield"), null);
    drag(img);
    const yt = root.querySelector("[data-uid=np9yt0001]");
    assert.equal(yt.querySelector(".pxd-embed-shield"), null);
    yt.querySelector(".pxd-rs__live").append(f.stub.document.createElement("iframe"));
    for (const o of f.stub.observers) if (o.active) o.cb([]);
    const shield = yt.querySelector(".pxd-embed-shield");
    assert.ok(shield, "a late iframe grows a shield");
    drag(shield);
    const moved = f.session.mutations.filter((m) => m[0] === "commitMove").map((m) => m[1][0]);
    assert.deepEqual(moved, ["np9hl0001", "np9pdf001", "np9vid001", "np9tw0001", "np9img001", "np9yt0001"]);
    f.stub.dispatch(shield, "dblclick", { clientX: 40, clientY: 40 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
    assert.ok(yt.classList.contains("pxd-item--editing"));
    assert.equal(yt.querySelector(".pxd-embed-shield"), null);
    assert.equal(f.host.calls.renderBlock, 1);
    f.stub.dispatch(yt.querySelector(".rm-block__input"), "keydown", { key: "Escape" });
    await tick();
    assert.equal(yt.classList.contains("pxd-item--editing"), false);
    assert.equal(yt.querySelector(".pxd-embed-shield"), null);
    yt.querySelector(".pxd-rs__live").append(f.stub.document.createElement("iframe"));
    for (const o of f.stub.observers) if (o.active) o.cb([]);
    assert.ok(yt.querySelector(".pxd-embed-shield"), "the shield returns when the embed mounts again");
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

test("ED-3: a taller edit previews the section and Esc writes the card height once", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const card = await startEdit(f, "cardDDDD4");
    const section = f.view.root.querySelector("[data-uid=sectCCCC3]");
    const sectionH = () => parseFloat(section.style.height);
    const beforeH = sectionH();
    assert.equal(f.session.mutations.filter((m) => m[0] === "growToFit").length, 0);
    card._rect = { x: 20, y: 360, width: 200, height: 280, left: 20, top: 360, right: 220, bottom: 640 };
    for (const obs of f.stub.observers) if (obs.active) obs.cb();
    f.stub.flushFrames();
    assert.ok(sectionH() > beforeH, `section grew while editing (${beforeH} -> ${sectionH()})`);
    assert.equal(f.session.mutations.filter((m) => m[0] === "growToFit").length, 0, "typing writes no height");
    const editor = card.querySelector(".pxd-item__editor");
    editor.scrollHeight = 260;
    const input = editor.querySelector("textarea");
    input.focus();
    f.stub.dispatch(input, "keydown", { key: "Escape" });
    await tick(30);
    f.stub.flushFrames();
    const grows = f.session.mutations.filter((m) => m[0] === "growToFit");
    assert.equal(grows.length, 1, `one height write (${JSON.stringify(grows)})`);
    assert.equal(grows[0][1], "cardDDDD4");
    assert.ok(grows[0][2] > 100, `new height ${grows[0][2]}`);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-4: editing pins a page menu to the textarea and lifts it out of the board", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const card = await startEdit(f, "cardAAAA1");
    const editor = card.querySelector(".pxd-item__editor");
    const input = editor.querySelector("textarea");
    input._rect = { x: 100, y: 200, left: 100, top: 200, width: 180, height: 24, right: 280, bottom: 224 };
    const menu = f.stub.document.createElement("div");
    menu.className = "rm-autocomplete__results";
    menu._rect = { x: 10, y: 10, left: 10, top: 10, width: 280, height: 80, right: 290, bottom: 90 };
    editor.append(menu);
    const renders = f.host.calls.renderBlock;
    // Hydrate resolves on a microtask after the last flushed frame. Yield once so the watcher starts.
    await tick();
    f.stub.flushFrames();
    assert.equal(menu.parentElement === f.stub.document.body, true);
    assert.equal(menu.closest(".pxd-viewport") === null, true);
    assert.equal(menu.style.position, "fixed");
    assert.equal(menu.style.transform, "none");
    assert.equal(menu.style.left, "100px");
    assert.equal(menu.style.top, "226px");
    f.stub.flushFrames();
    assert.equal(f.host.calls.renderBlock, renders, "pinning a menu does not re-render the card");
    menu.remove();
    input.focus();
    f.stub.dispatch(input, "keydown", { key: "Escape" });
    await tick(30);
    f.stub.flushFrames();
    const late = f.stub.document.createElement("div");
    late.className = "rm-autocomplete__results";
    late._rect = { x: 10, y: 10, left: 10, top: 10, width: 280, height: 80, right: 290, bottom: 90 };
    f.stub.document.body.append(late);
    f.stub.flushFrames();
    assert.equal(late.style.position || "", "", "the pin stops when the editor closes");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-5: editing at 2x lays the editor out in screen pixels", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const atOne = await startEdit(f, "cardAAAA1");
    const editorAtOne = atOne.querySelector(".pxd-item__editor");
    assert.equal(editorAtOne.style.transform || "", "", "zoom 1 leaves the editor in the card's own box");
    assert.equal(editorAtOne.style.position || "", "");
    f.stub.dispatch(editorAtOne.querySelector("textarea"), "keydown", { key: "Escape" });
    await tick(30);
    f.stub.flushFrames();
    const viewport = f.view.root.querySelector(".pxd-viewport");
    f.stub.dispatch(viewport, "wheel", { ctrlKey: true, deltaY: -Math.log(2) / 0.01, clientX: 400, clientY: 300 });
    f.stub.flushFrames();
    await tick(160);
    f.stub.flushFrames();
    const zoom = f.view.state().zoom;
    assert.ok(Math.abs(zoom - 2) < 0.02, `zoom ${zoom}`);
    const card = await startEdit(f, "cardAAAA1");
    await tick();
    f.stub.flushFrames();
    const editor = card.querySelector(".pxd-item__editor");
    const scale = Number(String(editor.style.transform || "").replace("scale(", "").replace(")", ""));
    assert.ok(Math.abs(scale - (1 / zoom)) < 1e-9, `transform ${editor.style.transform} zoom ${zoom} scale ${scale}`);
    assert.equal(editor.style.position, "absolute");
    assert.ok(Math.abs(parseFloat(editor.style.width) - zoom * 100) < 0.05, editor.style.width);
    assert.equal(editor.parentElement?.style?.position, "relative");
    const ta = editor.querySelector("textarea");
    assert.ok(Math.abs(parseFloat(ta?.style?.["font-size"]) - 14 * zoom) < 0.05, ta?.style?.["font-size"]);
    assert.equal(ta?.style?.height, "auto");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("Enter on a card's root adds a line to that block and writes nothing else", async () => {
  const created = [];
  const updates = [];
  const f = mountFixture({
    hostOverrides: {
      renderBlock(el, uid) {
        const doc = el.ownerDocument || globalThis.document;
        const block = doc.createElement("div");
        block.className = "rm-block";
        block.id = uid;
        const ta = doc.createElement("textarea");
        ta.className = "rm-block__input";
        ta.value = "test";
        block.append(ta);
        el.append(block);
      },
      createBlock(spec) { created.push(spec); return Promise.resolve("childNEW01"); },
      updateString(uid, string) { updates.push([uid, string]); return Promise.resolve(); },
      group(fn) { return fn(); },
    },
  });
  try {
    await f.flush();
    const card = await startEdit(f, "cardAAAA1");
    const ta = card.querySelector(".pxd-item__editor textarea");
    const roamSaw = [];
    ta.addEventListener("keydown", (e) => roamSaw.push(`down:${e.key}`));
    ta.addEventListener("keyup", (e) => roamSaw.push(`up:${e.key}`));
    ta.selectionStart = 4;
    ta.selectionEnd = 4;
    const ev = f.stub.dispatch(ta, "keydown", { key: "Enter", code: "Enter" });
    assert.equal(ev.defaultPrevented, false, "the browser still types the newline");
    f.stub.dispatch(ta, "keyup", { key: "Enter", code: "Enter" });
    assert.deepEqual(roamSaw, [], "Roam never sees the Enter, so it makes no child");
    await tick();
    assert.equal(created.length, 0);
    assert.equal(updates.length, 0, "the open editor saves the string itself");
    f.stub.dispatch(ta, "keyup", { key: "a" });
    const shifted = f.stub.dispatch(ta, "keydown", { key: "Enter", shiftKey: true });
    assert.equal(shifted.defaultPrevented, false);
    f.stub.dispatch(ta, "keyup", { key: "Enter", shiftKey: true });
    assert.deepEqual(roamSaw, ["up:a", "down:Enter", "up:Enter"], "Shift+Enter is still Roam's own newline");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-6: with Enter set to child, Enter, Tab, and Cmd+Enter stay with Roam while the card is editing", async () => {
  const created = [];
  const updates = [];
  const f = mountFixture({
    settings: { "enter-in-card": "child" },
    hostOverrides: {
      renderBlock(el, uid) {
        const doc = el.ownerDocument || globalThis.document;
        const block = doc.createElement("div");
        block.className = "rm-block";
        block.id = uid;
        const ta = doc.createElement("textarea");
        ta.className = "rm-block__input";
        ta.value = "Alpha";
        block.append(ta);
        const kids = doc.createElement("div");
        kids.className = "rm-block-children";
        const child = doc.createElement("div");
        child.id = "kidAAAA01";
        const cta = doc.createElement("textarea");
        cta.className = "rm-block__input";
        cta.value = "child one";
        child.append(cta);
        kids.append(child);
        block.append(kids);
        el.append(block);
      },
      createBlock(spec) { created.push(spec); return Promise.resolve("childNEW01"); },
      updateString(uid, string) { updates.push([uid, string]); return Promise.resolve(); },
      group(fn) { return fn(); },
    },
  });
  try {
    await f.flush();
    const card = await startEdit(f, "cardAAAA1");
    const editor = card.querySelector(".pxd-item__editor");
    const ta = editor.querySelector("textarea");
    ta.selectionStart = ta.value.length;
    ta.selectionEnd = ta.value.length;
    const end = f.stub.dispatch(ta, "keydown", { key: "Enter", code: "Enter" });
    assert.equal(end.defaultPrevented, false);
    await tick();
    assert.equal(created.length, 0);
    assert.equal(updates.length, 0);
    const cta = editor.querySelector(".rm-block-children textarea");
    cta.selectionStart = cta.value.length;
    cta.selectionEnd = cta.value.length;
    const nested = f.stub.dispatch(cta, "keydown", { key: "Enter" });
    assert.equal(nested.defaultPrevented, false);
    assert.equal(created.length, 0);
    const sel = f.view.state().selection.slice();
    const tab = f.stub.dispatch(ta, "keydown", { key: "Tab" });
    assert.equal(tab.defaultPrevented, false);
    assert.deepEqual(f.view.state().selection, sel);
    const todo = f.stub.dispatch(ta, "keydown", { key: "Enter", metaKey: true });
    assert.equal(todo.defaultPrevented, false);
    assert.equal(created.length, 0);
    ta.value = "Alpha";
    ta.selectionStart = 2;
    ta.selectionEnd = 2;
    const mid = f.stub.dispatch(ta, "keydown", { key: "Enter" });
    assert.equal(mid.defaultPrevented, false);
    assert.equal(created.length, 0);
    assert.equal(updates.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-6: Backspace in an empty fresh card deletes it once", async () => {
  const f = mountFixture({
    extraChildren: [extraCard("emptyCrd1", "", 8, { ":x": 20, ":y": 500 })],
    hostOverrides: {
      renderBlock(el) {
        const doc = el.ownerDocument || globalThis.document;
        const ta = doc.createElement("textarea");
        ta.className = "rm-block__input";
        ta.value = "";
        el.append(ta);
      },
      blockString: () => "",
    },
  });
  try {
    await f.flush();
    f.session.createCard = () => Promise.resolve("emptyCrd1");
    const viewport = f.view.root.querySelector(".pxd-viewport");
    f.stub.dispatch(viewport, "dblclick", { clientX: 700, clientY: 200 });
    for (let i = 0; i < 6; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
    const card = f.view.root.querySelector("[data-uid=emptyCrd1]");
    assert.ok(card.classList.contains("pxd-item--editing"), "the new card is open");
    const ta = card.querySelector("textarea");
    ta.value = "";
    ta.selectionStart = 0;
    ta.selectionEnd = 0;
    const ev = f.stub.dispatch(ta, "keydown", { key: "Backspace" });
    assert.equal(ev.defaultPrevented, true);
    await tick();
    const deleted = f.session.mutations.filter((row) => row[0] === "deleteItems");
    assert.equal(deleted.length, 1);
    assert.deepEqual(deleted[0][1], ["emptyCrd1"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-7: a multi-line paste in the card root becomes children, not board cards", async () => {
  const created = [];
  const updates = [];
  const groups = [];
  const f = mountFixture({
    hostOverrides: {
      renderBlock(el, uid) {
        const doc = el.ownerDocument || globalThis.document;
        const block = doc.createElement("div");
        block.className = "rm-block";
        block.id = uid;
        const ta = doc.createElement("textarea");
        ta.className = "rm-block__input";
        ta.value = "HelloWorld";
        block.append(ta);
        const kids = doc.createElement("div");
        kids.className = "rm-block-children";
        const child = doc.createElement("div");
        child.id = "kidAAAA01";
        const cta = doc.createElement("textarea");
        cta.className = "rm-block__input";
        cta.value = "child one";
        child.append(cta);
        kids.append(child);
        block.append(kids);
        el.append(block);
      },
      createBlock(spec) { created.push(spec); return Promise.resolve("new"); },
      updateString(uid, string) { updates.push([uid, string]); return Promise.resolve(); },
      group(fn) { groups.push(1); return fn(); },
      uploadFile(file) { return Promise.resolve(`https://files.test/${file.name}`); },
    },
  });
  const clip = (data = {}, files = []) => ({ getData: (t) => data[t] ?? "", files });
  const settle = async () => {
    await tick();
    f.stub.flushFrames();
    await tick(300);
    f.stub.flushFrames();
    await tick();
  };
  try {
    await f.flush();
    const card = await startEdit(f, "cardAAAA1");
    const ta = card.querySelector(".pxd-item__editor textarea");
    ta.value = "HelloWorld";
    ta.selectionStart = 5;
    ta.selectionEnd = 5;
    const one = f.stub.dispatch(ta, "paste", { clipboardData: clip({ "text/plain": "hello" }) });
    assert.equal(one.defaultPrevented, false);
    await tick();
    assert.equal(created.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(f.session.mutations.filter((row) => row[0] === "pasteText").length, 0);
    const multi = f.stub.dispatch(ta, "paste", { clipboardData: clip({ "text/plain": "A\nB\nC\n" }) });
    assert.equal(multi.defaultPrevented, true);
    await settle();
    assert.deepEqual(updates, [["cardAAAA1", "HelloAWorld"]]);
    assert.deepEqual(created, [
      { parentUid: "cardAAAA1", order: "last", string: "B" },
      { parentUid: "cardAAAA1", order: "last", string: "C" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(f.session.mutations.filter((row) => row[0] === "pasteText" || row[0] === "addRefCards").length, 0);
    const cta = card.querySelector(".rm-block-children textarea") || f.view.root.querySelector(".rm-block-children textarea");
    const nested = f.stub.dispatch(cta, "paste", { clipboardData: clip({ "text/plain": "x\ny" }) });
    assert.equal(nested.defaultPrevented, false);
    await tick();
    assert.equal(created.length, 2);
    const png = { type: "image/png", name: "shot.png" };
    const rootTa = card.querySelector(".pxd-item__editor textarea");
    rootTa.value = "X";
    rootTa.selectionStart = 1;
    rootTa.selectionEnd = 1;
    const img = f.stub.dispatch(rootTa, "paste", { clipboardData: clip({ "text/plain": "nope\nnope" }, [png]) });
    assert.equal(img.defaultPrevented, true);
    await settle();
    assert.deepEqual(updates.at(-1), ["cardAAAA1", "X![](https://files.test/shot.png)"]);
    assert.equal(created.length, 2, "an image is inlined, not a child block or a new card");
    assert.equal(f.session.mutations.filter((row) => row[0] === "addRefCards").length, 0);
    const live = card.querySelector(".pxd-item__editor textarea");
    live.value = updates.at(-1)[1];
    live.selectionStart = live.value.length;
    live.selectionEnd = live.value.length;
    const dropped = f.stub.dispatch(live, "drop", { dataTransfer: clip({}, [{ type: "image/png", name: "drop.png" }]) });
    assert.equal(dropped.defaultPrevented, true);
    await settle();
    assert.equal(updates.at(-1)[1], "X![](https://files.test/shot.png)![](https://files.test/drop.png)");
    assert.equal(f.session.mutations.filter((row) => row[0] === "addRefCards").length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-7: an unavailable upload does not write the block", async () => {
  const updates = [];
  const f = mountFixture({
    hostOverrides: {
      renderBlock(el) {
        const doc = el.ownerDocument || globalThis.document;
        const ta = doc.createElement("textarea");
        ta.className = "rm-block__input";
        el.append(ta);
      },
      updateString(uid, string) { updates.push([uid, string]); return Promise.resolve(); },
      uploadFile() { return Promise.reject(new Error("upload-unavailable")); },
      group(fn) { return fn(); },
    },
  });
  try {
    await f.flush();
    const card = await startEdit(f, "cardAAAA1");
    const ta = card.querySelector("textarea");
    ta.value = "keep";
    const ev = f.stub.dispatch(ta, "paste", { clipboardData: { getData: () => "", files: [{ type: "image/png", name: "a.png" }] } });
    assert.equal(ev.defaultPrevented, true);
    await tick();
    f.stub.flushFrames();
    await tick(20);
    assert.equal(updates.length, 0);
    assert.match(f.view.root.querySelector(".pxd-toast__text").textContent, /not available/);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-8: Cmd+Z in the editor is left to Roam; Cmd+Z on the board undoes", async () => {
  const f = mountFixture({
    hostOverrides: {
      renderBlock(el) {
        const doc = el.ownerDocument || globalThis.document;
        const ta = doc.createElement("textarea");
        ta.className = "rm-block__input";
        ta.value = "Alpha";
        el.append(ta);
      },
    },
  });
  const undos = () => f.session.mutations.filter((row) => row[0] === "undo").length;
  const redos = () => f.session.mutations.filter((row) => row[0] === "redo").length;
  try {
    await f.flush();
    const card = await startEdit(f, "cardAAAA1");
    const ta = card.querySelector(".pxd-item__editor textarea");
    ta.focus();
    const typed = f.stub.dispatch(ta, "keydown", { key: "z", metaKey: true });
    assert.equal(typed.defaultPrevented, false);
    assert.equal(undos(), 0);
    const redo = f.stub.dispatch(ta, "keydown", { key: "Z", metaKey: true, shiftKey: true });
    assert.equal(redo.defaultPrevented, false);
    assert.equal(redos(), 0);
    const ctrl = f.stub.dispatch(ta, "keydown", { key: "z", ctrlKey: true });
    assert.equal(ctrl.defaultPrevented, false);
    assert.equal(undos(), 0);
    f.stub.dispatch(ta, "keydown", { key: "Escape" });
    await tick(30);
    f.stub.flushFrames();
    assert.equal(f.view.root.classList.contains("pxd-root--editing"), false);
    f.view.root.focus();
    f.view.controller.select(["cardAAAA1"]);
    const board = f.stub.dispatch(f.view.root, "keydown", { key: "z", metaKey: true });
    assert.equal(board.defaultPrevented, true);
    assert.equal(undos(), 1);
    const again = f.stub.dispatch(f.view.root, "keydown", { key: "z", metaKey: true, shiftKey: true });
    assert.equal(again.defaultPrevented, true);
    assert.equal(redos(), 1);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("toggleTodoAt flips the nth TODO or DONE token", () => {
  assert.equal(toggleTodoAt("{{[[TODO]]}} a", 0), "{{[[DONE]]}} a");
  assert.equal(toggleTodoAt("{{[[DONE]]}} a", 0), "{{[[TODO]]}} a");
  assert.equal(toggleTodoAt("{{[[TODO]]}} a {{[[DONE]]}} b", 1), "{{[[TODO]]}} a {{[[TODO]]}} b");
  assert.equal(toggleTodoAt("plain", 0), null);
  assert.equal(toggleTodoAt("{{[[TODO]]}}", 1), null);
});

test("ED-9: click selects, double-click edits, a ref navigates, a checkbox and an image keep their click", async () => {
  const opened = [];
  const f = mountFixture({
    hostOverrides: {
      renderString(el, string) {
        this.calls.renderString += 1;
        const doc = el.ownerDocument || globalThis.document;
        if (!String(string).startsWith("Alpha")) { el.textContent = string; return; }
        const label = doc.createElement("label");
        label.className = "check-container";
        const input = doc.createElement("input");
        input.setAttribute("type", "checkbox");
        label.append(input);
        const img = doc.createElement("img");
        const link = doc.createElement("span");
        link.setAttribute("data-link-uid", "pageUID01");
        el.append(label, img, link);
      },
      api: {
        ui: {
          mainWindow: {
            openPage: (arg) => opened.push(["page", arg]),
            openBlock: (arg) => opened.push(["block", arg]),
          },
          rightSidebar: { addWindow: (arg) => opened.push(["side", arg]) },
        },
      },
    },
  });
  const up = (node, extra = {}) => {
    f.stub.dispatch(node, "pointerdown", { button: 0, clientX: 30, clientY: 40, pointerId: 4, ...extra });
    return f.stub.dispatch(f.stub.document, "pointerup", { clientX: 30, clientY: 40, pointerId: 4, ...extra });
  };
  try {
    await f.flush();
    const card = f.view.root.querySelector("[data-uid=cardAAAA1]");
    f.stub.dispatch(card, "pointerdown", { button: 0, clientX: 12, clientY: 12, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 12, clientY: 12, pointerId: 1 });
    f.stub.flushFrames();
    await tick();
    assert.ok(card.classList.contains("pxd-item--selected"));
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    f.stub.dispatch(card, "dblclick", { clientX: 12, clientY: 12 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
    assert.ok(card.classList.contains("pxd-item--editing"));
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await tick(30);
    f.stub.flushFrames();
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    f.board.items.get("cardAAAA1").string = "{{[[TODO]]}} Alpha {{[[TODO]]}} rest";
    const box = card.querySelector(".check-container")?.querySelector("input");
    assert.ok(box, "the card renders a checkbox");
    const boxDown = f.stub.dispatch(box, "pointerdown", { button: 0, clientX: 30, clientY: 40, pointerId: 2 });
    assert.equal(boxDown.defaultPrevented, false);
    const boxClick = f.stub.dispatch(box, "click", { button: 0 });
    assert.equal(boxClick.defaultPrevented, false);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.deepEqual(
      f.session.mutations.filter((m) => m[0] === "setString"),
      [["setString", "cardAAAA1", "{{[[DONE]]}} Alpha {{[[TODO]]}} rest"]],
    );
    const img = card.querySelector("img");
    const imgDown = f.stub.dispatch(img, "pointerdown", { button: 0, clientX: 36, clientY: 44, pointerId: 3 });
    assert.equal(imgDown.defaultPrevented, false);
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 36, clientY: 44, pointerId: 3 });
    const imgClick = f.stub.dispatch(img, "click", { button: 0 });
    assert.equal(imgClick.defaultPrevented, false);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    const link = card.querySelector("[data-link-uid]");
    up(link);
    f.stub.dispatch(link, "click", { button: 0 });
    assert.deepEqual(opened, [["page", { page: { uid: "pageUID01" } }]]);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    up(link, { shiftKey: true });
    f.stub.dispatch(link, "click", { button: 0, shiftKey: true });
    assert.deepEqual(opened[1], ["side", { window: { type: "outline", "block-uid": "pageUID01" } }]);
    assert.equal(opened.length, 2);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("ED-2: 100 pull-watch echoes while editing leave every item render count unchanged", async () => {
  const f = mountReal();
  try {
    f.stub.flushFrames();
    await tick(5);
    f.stub.flushIdle();
    f.stub.flushFrames();
    const counts = () => ({ ...f.host.stats.items });
    const echo = async (string) => {
      await f.fake.api.data.block.update({ block: { uid: "c4", string } });
      await tick(15);
      f.stub.flushFrames();
      f.stub.flushFrames();
    };
    const before = counts();
    assert.ok(before.c4 > 0, "opening paints the note");
    await echo("a note changed");
    const painted = counts();
    assert.ok(painted.c4 > before.c4, "a string echo repaints the card when it is not being edited");
    for (const uid of Object.keys(before)) {
      if (uid !== "c4") assert.equal(painted[uid], before[uid], `${uid} stays put when another card's text changes`);
    }
    const card = f.view.root.querySelector("[data-uid=c4]");
    f.stub.dispatch(card, "dblclick", { clientX: 40, clientY: 40 });
    for (let i = 0; i < 6; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(20);
    f.stub.flushFrames();
    const editor = card.querySelector(".pxd-item__editor");
    assert.ok(editor, "editor mounted");
    assert.ok(card.classList.contains("pxd-item--editing"));
    const snap = counts();
    let text = "a note changed";
    for (let i = 0; i < 100; i += 1) {
      text += "x";
      await echo(text);
    }
    const after = counts();
    for (const uid of new Set([...Object.keys(snap), ...Object.keys(after)])) {
      assert.equal(after[uid] || 0, snap[uid] || 0, `${uid} render delta during 100 echoes`);
    }
    assert.equal(card.querySelector(".pxd-item__editor"), editor, "Roam keeps the same editor node");
  } finally {
    try { f.view.dispose(); } catch { /* already disposed */ }
    resetSessions();
    f.restore();
  }
});

test("pageRenameNeedsConfirm asks only past ten references", () => {
  assert.equal(pageRenameNeedsConfirm(10), false);
  assert.equal(pageRenameNeedsConfirm(11), true);
  assert.equal(pageRenameNeedsConfirm(0), false);
  assert.equal(pageRenameNeedsConfirm("11"), true);
});

test("ED-10: a page title renames in place, waits past ten references, and Escape cancels", async () => {
  const renamed = [];
  let refs = 4;
  const f = mountFixture({
    hostOverrides: {
      pageRefCount: (title) => (title === "Beta" ? refs : 0),
      renamePage: (from, to) => { renamed.push([from, to]); return Promise.resolve(true); },
    },
  });
  const renamedN = () => renamed.length;
  try {
    await f.flush();
    const card = f.view.root.querySelector("[data-uid=cardBBBB2]");
    const header = card.querySelector(".pxd-item__header");
    const body = card.querySelector(".pxd-item__body");
    assert.equal(header.textContent, "Beta");
    f.stub.dispatch(body, "dblclick", { clientX: 320, clientY: 40 });
    assert.equal(header.getAttribute("contenteditable"), null);
    assert.equal(renamedN(), 0);
    assert.ok(card.classList.contains("pxd-item--editing"), "the page body still opens the editor");
    f.view.root.focus();
    f.stub.dispatch(f.view.root, "keydown", { key: "Escape" });
    await tick(300);
    f.stub.flushFrames();
    f.stub.flushTimers();
    assert.equal(card.classList.contains("pxd-item--editing"), false);

    f.stub.dispatch(header, "dblclick", { clientX: 320, clientY: 8 });
    assert.equal(header.getAttribute("contenteditable"), "true");
    header.textContent = "Gamma";
    const steal = (event) => { if (event.key === "Enter") header.textContent = "STOLEN"; };
    f.stub.document.addEventListener("keydown", steal, true);
    f.stub.dispatch(header, "keydown", { key: "Enter" });
    f.stub.document.removeEventListener("keydown", steal, true);
    await tick();
    assert.deepEqual(renamed, [["Beta", "Gamma"]]);
    assert.equal(f.view.root.querySelector(".pxd-toast").style.display, "none");

    refs = 11;
    f.view.root.focus();
    f.view.controller.select(["cardBBBB2"]);
    f.stub.dispatch(f.view.root, "keydown", { key: "F2" });
    assert.equal(header.getAttribute("contenteditable"), "true");
    header.textContent = "Delta";
    f.stub.dispatch(header, "keydown", { key: "Enter" });
    await tick();
    assert.equal(renamedN(), 1, "eleven references do not write yet");
    const toast = f.view.root.querySelector(".pxd-toast");
    assert.equal(toast.style.display, "");
    assert.equal(toast.querySelector(".pxd-toast__text").textContent, "11 blocks link to Beta. Rename it to Delta?");
    assert.equal(renamedN(), 1, "the toast stays until Rename is clicked");
    toast.querySelector(".pxd-toast__action").click();
    await tick();
    assert.deepEqual(renamed, [["Beta", "Gamma"], ["Beta", "Delta"]]);
    assert.equal(toast.style.display, "none");

    f.view.root.focus();
    f.view.controller.select(["cardBBBB2"]);
    f.stub.dispatch(f.view.root, "keydown", { key: "F2" });
    header.textContent = "Nope";
    f.stub.dispatch(header, "keydown", { key: "Escape" });
    assert.equal(header.textContent, "Beta");
    assert.equal(header.getAttribute("contenteditable"), null);
    assert.equal(renamedN(), 2);

    f.stub.dispatch(header, "dblclick", { clientX: 320, clientY: 8 });
    header.textContent = "   ";
    f.stub.dispatch(header, "keydown", { key: "Enter" });
    assert.equal(renamedN(), 2, "an empty title does not write");

    f.view.root.focus();
    f.view.controller.select(["cardAAAA1"]);
    const noteHeader = f.view.root.querySelector("[data-uid=cardAAAA1] .pxd-item__header");
    f.stub.dispatch(f.view.root, "keydown", { key: "F2" });
    assert.notEqual(noteHeader.getAttribute("contenteditable"), "true");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("PF-5: a throwing card render shows one Could not render chip", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...args) => { errors.push(args); };
  const opened = [];
  const f = mountFixture({
    kidsOn: ["cardAAAA1"],
    hostOverrides: {
      openBlock: (uid) => opened.push(uid),
      renderString(el, string) {
        this.calls.renderString += 1;
        if (String(string).startsWith("Alpha")) throw new Error("render boom");
        el.textContent = string;
      },
    },
  });
  try {
    await f.flush();
    const root = f.view.root;
    const alpha = root.querySelector("[data-uid=cardAAAA1]");
    const chip = alpha.querySelector(".pxd-render-chip");
    assert.ok(chip, "the throwing card shows a chip");
    assert.equal(chip.querySelector(".pxd-render-chip__label").textContent, "Could not render");
    assert.equal(chip.querySelector(".pxd-render-chip__uid").textContent, "cardAAAA1");
    assert.ok(alpha.querySelector(".pxd-item--error"));
    assert.equal(alpha.querySelectorAll(".pxd-rs__live").length, 1, "the thrown root is removed; the child still renders");
    assert.match(alpha.querySelector(".pxd-item__body").textContent, /child one/);
    assert.equal(root.querySelectorAll(".pxd-render-chip").length, 1);
    assert.equal(root.querySelectorAll(".pxd-item").length, 6);
    assert.equal(root.querySelector("[data-uid=cardBBBB2] .pxd-render-chip"), null);
    assert.equal(root.querySelector("[data-uid=cardBBBB2] .pxd-item__header").textContent, "Beta");
    assert.match(root.querySelector("[data-uid=cardBBBB2]").textContent, /page block/);
    chip.querySelector(".pxd-render-chip__open").click();
    assert.deepEqual(opened, ["cardAAAA1"]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0].message, "render boom");

    const before = f.host.calls.renderString;
    f.board.items.get("cardAAAA1").string = "Alpha\nbody line again";
    f.session.emit("change", { dirty: new Set(["cardAAAA1"]), structural: false });
    await f.flush();
    assert.ok(f.host.calls.renderString > before, "the card renders again after its string changes");
    assert.equal(errors.length, 1, "a second render of the same card does not log again");
    const chip2 = root.querySelector("[data-uid=cardAAAA1] .pxd-render-chip");
    assert.equal(chip2.querySelector(".pxd-render-chip__uid").textContent, "cardAAAA1");
    assert.equal(root.querySelectorAll(".pxd-item").length, 6);
  } finally {
    console.error = orig;
    f.view.dispose();
    f.restore();
  }
});

test("PF-5: a swallowed roam render error becomes one chip", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...args) => { errors.push(args); };
  const f = mountFixture({
    kidsOn: ["cardAAAA1"],
    hostOverrides: {
      renderString(el, string) {
        this.calls.renderString += 1;
        if (String(string).startsWith("Alpha")) {
          console.error(new Error("Cannot read properties of null (reading 'F')"));
          console.error(new Error("Cannot read properties of null (reading 'F')"));
          console.error(new Error("Cannot read properties of null (reading 'F')"));
          el.textContent = "Error rendering component: \"Cannot read properties of null (reading 'F')\"";
          return;
        }
        el.textContent = string;
      },
    },
  });
  try {
    await f.flush();
    const root = f.view.root;
    const alpha = root.querySelector("[data-uid=cardAAAA1]");
    const chip = alpha.querySelector(".pxd-render-chip");
    const textOf = (cls) => chip.children.find((c) => c.classList.contains(cls)).textContent;
    assert.equal(textOf("pxd-render-chip__label"), "Could not render");
    assert.equal(textOf("pxd-render-chip__uid"), "cardAAAA1");
    assert.equal(textOf("pxd-render-chip__open"), "Open");
    assert.equal(alpha.querySelectorAll(".pxd-rs__live").length, 1, "the failed root is gone; the child still renders");
    assert.match(alpha.querySelector(".pxd-item__body").textContent, /child one/);
    assert.equal(root.querySelectorAll(".pxd-render-chip").length, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0].message, "Cannot read properties of null (reading 'F')");
    const before = f.host.calls.renderString;
    f.board.items.get("cardAAAA1").string = "Alpha again";
    f.session.emit("change", { dirty: new Set(["cardAAAA1"]), structural: false });
    await f.flush();
    assert.ok(f.host.calls.renderString > before, "the card renders again after its string changes");
    assert.equal(errors.length, 1, "a second render of the same card does not log again");
    const chip2 = root.querySelector("[data-uid=cardAAAA1] .pxd-render-chip");
    assert.equal(chip2.children.find((c) => c.classList.contains("pxd-render-chip__uid")).textContent, "cardAAAA1");
  } finally {
    console.error = orig;
    f.view.dispose();
    f.restore();
  }
});
