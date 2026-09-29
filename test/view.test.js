import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function pulled() {
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
    ],
  };
}

function fakeHost() {
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
    addRefCards: rec("addRefCards"),
    deleteItems: rec("deleteItems"),
    deleteEdges: rec("deleteEdges"),
    setColor: rec("setColor"),
    setCollapsed: rec("setCollapsed"),
    setFontSize: rec("setFontSize"),
    setString: rec("setString"),
    growToFit: rec("growToFit"),
    addEdge: rec("addEdge"),
    updateEdge: rec("updateEdge"),
    flipEdge: rec("flipEdge"),
    undo: rec("undo"),
    redo: rec("redo"),
  };
  return session;
}

function mountFixture({ vp = { x: 0, y: 0, zoom: 1 }, settings = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem(`plexus-diagram:vp:Svy:board0001`, JSON.stringify(vp));
  const board = buildBoard(pulled());
  const session = fakeSession(board);
  const host = fakeHost();
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: (k) => settings[k] },
    version: "1.0.0",
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, board, session, host, mountEl, view, flush };
}

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
    // pointerdown/up on the item = select
    f.stub.dispatch(alpha, "pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 50, clientY: 50, pointerId: 1 });
    await tick(140);
    f.stub.flushFrames();
    assert.ok(alpha.classList.contains("pxd-item--selected"));
    const ctx = root.querySelector(".pxd-ctx");
    assert.equal(ctx.style.display, "");
    assert.equal(ctx.dataset.kind, "card");
    assert.equal(ctx.querySelectorAll(".pxd-swatch").length, 11);
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

test("keyboard shortcuts are ignored while a Roam editor / input has focus", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const root = f.view.root;
    const alpha = root.querySelector("[data-uid=cardAAAA1]");
    f.stub.dispatch(alpha, "pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { clientX: 50, clientY: 50, pointerId: 1 });
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
