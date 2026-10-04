// 1.2 wiring in mountBoardView: LOD tiers, backgrounds, fit preview, context menu, clipboard, focus,
// presentation, badges, back-to-content, setSettings, state, export. Everything runs against the DOM stub
// with a recording fake session, so "writes nothing" assertions are exact.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { boundsOf, buildBoard, worldRects } from "../src/model/board.js";
import { shapePath } from "../src/model/shapes.js";
import { fitViewport, zoomAt } from "../src/model/geometry.js";
import { cardDeepLink } from "../src/model/deeplink.js";
import { PLEXUS_MIME } from "../src/model/clipboard.js";
import { neighborLayout } from "../src/model/neighbors.js";
import { queryResultLayout } from "../src/model/query.js";
import { linkedRefCard, linkedRefLabel } from "../src/model/refs.js";
import { isLightHost, mountBoardView } from "../src/view/board-view.js";
import { SHORTCUTS } from "../src/view/shortcuts.js";
import { CARD_MIME } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function pulled({ extra = [], rootPlexus = {} } = {}) {
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
    ":block/props": { ":plexus": { ":v": 2, ...rootPlexus } },
    ":block/children": [
      item("cardAAAA1", "Alpha\nbody line", { ":x": 0, ":y": 0, ":w": 200, ":h": 100 }, 0),
      item("cardBBBB2", "[[Beta]]", { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
      item("textTTTT5", "Label", { ":type": "text", ":x": 100, ":y": 200, ":w": 240, ":h": 48 }, 2),
      item("sectCCCC3", "Evidence", { ":type": "section", ":x": 0, ":y": 300, ":w": 400, ":h": 300 }, 3, [
        item("cardDDDD4", "Inside", { ":x": 20, ":y": 60, ":w": 200, ":h": 100 }, 0),
      ]),
      item("edgesEEE5", "Connections", { ":type": "edges" }, 4, [
        item("edgeFFFF6", "((cardAAAA1)) → ((cardBBBB2))", { ":type": "edge", ":from": "cardAAAA1", ":to": "cardBBBB2" }, 0),
      ]),
      ...extra,
    ],
  };
}

const secondSection = () => [{
  ":block/uid": "sectGGGG7",
  ":block/string": "Second",
  ":block/order": 5,
  ":block/props": { ":plexus": { ":type": "section", ":x": 700, ":y": 300, ":w": 300, ":h": 200 } },
  ":block/children": [],
}];

function fakeHost(overrides = {}) {
  return {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {},
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
    mutations,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    handlerCount: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
    release() {},
    setLinkMode() {},
    setBoard(next) { session.board = next; session.rects = worldRects(next); },
  };
  for (const name of ["commitMove", "commitRects", "createCard", "createText", "createSection", "wrapInSection", "createBoard", "wrapInBoard",
    "renameBoard", "addRefCards", "deleteItems", "deleteEdges", "setColor", "setCollapsed", "setFontSize", "setString", "growToFit",
    "addEdge", "updateEdge", "flipEdge", "undo", "redo", "setCollapsedMany", "collapseAll", "setPinned", "setBoardBackground", "setFit",
    "fitSection", "tidyItems", "sortOutline", "sameSize", "resetSize", "fitToContent", "writeToGraph", "setItemStyle"]) session[name] = rec(name);
  for (const name of ["duplicateItems", "pasteItems", "pasteText", "addDailyCards"]) session[name] = recList(name);
  session.sendToBoard = (...args) => { mutations.push(["sendToBoard", ...args]); return Promise.resolve({ added: args[0].length, title: "Inner" }); };
  session.expandOutline = (...args) => { mutations.push(["expandOutline", ...args]); return Promise.resolve({ added: 2, edges: 2 }); };
  session.snapshotItems = (uids) => ({ ":block/uid": board.uid, snapshotOf: [...uids] });
  session.moveIntoBoard = (...args) => { mutations.push(["moveIntoBoard", ...args]); return Promise.resolve(null); };
  session.addRefCards = (...args) => { mutations.push(["addRefCards", ...args]); return Promise.resolve(["img1"]); };
  return session;
}

function mountFixture({ vp = { x: 0, y: 0, zoom: 1 }, settings = {}, extra = [], rootPlexus = {}, hostOverrides = {}, viewOptions = {}, hash = "" } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  if (hash) stub.window.location.hash = hash;
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify(vp));
  const board = buildBoard(pulled({ extra, rootPlexus }));
  const session = fakeSession(board);
  const host = fakeHost(hostOverrides);
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: (k) => settings[k] }, version: "1.2.0", autofocus: true, ...viewOptions });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, board, session, host, mountEl, view, flush, root: view.root };
}

const pointerDown = (f, target, x, y, extra = {}) => f.stub.dispatch(target, "pointerdown", { button: 0, clientX: x, clientY: y, pointerId: 1, ...extra });
const pointerMove = (f, x, y, extra = {}) => f.stub.dispatch(f.stub.document, "pointermove", { clientX: x, clientY: y, pointerId: 1, ...extra });
const pointerUp = (f, x, y, extra = {}) => f.stub.dispatch(f.stub.document, "pointerup", { clientX: x, clientY: y, pointerId: 1, ...extra });
const key = (f, k, extra = {}) => f.stub.dispatch(f.stub.window, "keydown", { key: k, ...extra });
const shell = (f, uid) => f.root.querySelector(`[data-uid=${uid}]`);
const toastText = (f) => f.root.querySelector(".pxd-toast__text")?.textContent ?? "";
const settleWait = async (f) => { await tick(140); f.stub.flushFrames(); };

function countSetProperty(el) {
  const counter = { n: 0, inv: 0 };
  const original = el.style.setProperty;
  el.style.setProperty = (...args) => { if (args[0] === "--pxd-inv-zoom") counter.inv += 1; else if (args[0] !== "--pxd-screen-px") counter.n += 1; return original.apply(el.style, args); };
  return counter;
}

function stubNavigator(impl) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: impl, configurable: true, writable: true });
  return () => {
    if (prev) Object.defineProperty(globalThis, "navigator", prev); else delete globalThis.navigator;
  };
}

// ------------------------------------------------------------------ LOD

test("LOD: the tier class flips mid-gesture at the threshold, with hysteresis, and only the flip writes styles", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const { root } = f;
    const counter = countSetProperty(root);
    // a pan gesture is in progress while the zoom keys are pressed: settle() never runs
    pointerDown(f, root.querySelector(".pxd-viewport"), 400, 300, { button: 1, buttons: 4 });
    assert.ok(root.classList.contains("pxd-root--gesturing"));
    const steps = [];
    for (let i = 0; i < 4; i += 1) {
      key(f, "-", { ctrlKey: true });
      f.stub.flushFrames();
      steps.push(f.view.state());
    }
    // 1 / 1.2^4 = 0.482: above the 0.45 threshold, still detail, and not a single style write happened
    assert.ok(steps[3].zoom > 0.45 && steps[3].zoom < 0.5);
    assert.equal(steps[3].lod, "detail");
    assert.equal(root.classList.contains("pxd-lod-map"), false);
    assert.equal(counter.n, 0, "frames that do not cross a threshold write no root styles");
    key(f, "-", { ctrlKey: true });
    f.stub.flushFrames();
    assert.equal(f.view.state().lod, "map");
    assert.ok(root.classList.contains("pxd-lod-map"), "class flips during the gesture, before any settle");
    assert.equal(root.classList.contains("pxd-lod-overview"), false);
    assert.equal(counter.n, 3, "one flip writes the three font variables once");
    assert.match(root.style["--pxd-map-font"], /px$/);
    assert.match(root.style["--pxd-overview-font"], /px$/);
    const afterFlip = counter.n;
    key(f, "-", { ctrlKey: true });
    f.stub.flushFrames();
    assert.equal(counter.n, afterFlip, "further frames inside the same tier write nothing");
    // zoom back in: 0.402 * 1.2 = 0.482 is above 0.45 but inside the hysteresis band, so it stays map
    key(f, "=", { ctrlKey: true });
    key(f, "=", { ctrlKey: true });
    f.stub.flushFrames();
    assert.ok(f.view.state().zoom > 0.45);
    assert.equal(f.view.state().lod, "map", "hysteresis holds the map tier just above the threshold");
    key(f, "=", { ctrlKey: true });
    f.stub.flushFrames();
    assert.equal(f.view.state().lod, "detail");
    assert.equal(root.classList.contains("pxd-lod-map"), false);
    pointerUp(f, 400, 300, { button: 1 });
    assert.equal(f.session.mutations.length, 0, "zooming writes nothing");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("LOD: below the overview threshold the overview class joins the map class", async () => {
  const f = mountFixture({ vp: { x: 0, y: 0, zoom: 0.1 } });
  try {
    await f.flush();
    assert.equal(f.view.state().lod, "overview");
    assert.ok(f.root.classList.contains("pxd-lod-map"));
    assert.ok(f.root.classList.contains("pxd-lod-overview"));
    assert.match(f.root.style["--pxd-overview-font"], /px$/);
    pointerDown(f, f.root.querySelector(".pxd-viewport"), 400, 300, { button: 1, buttons: 4 });
    for (let i = 0; i < 4; i += 1) { key(f, "=", { ctrlKey: true }); f.stub.flushFrames(); }
    assert.equal(f.view.state().lod, "overview", "0.1 * 1.2^4 = 0.207 is inside the overview hysteresis band (needs 0.23)");
    for (let i = 0; i < 6; i += 1) { key(f, "=", { ctrlKey: true }); f.stub.flushFrames(); }
    assert.equal(f.view.state().lod, "detail");
    assert.equal(f.root.classList.contains("pxd-lod-overview"), false);
    assert.equal(f.root.classList.contains("pxd-lod-map"), false);
    pointerUp(f, 400, 300, { button: 1 });
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("LOD: the map-zoom setting moves the threshold", async () => {
  const f = mountFixture({ vp: { x: 0, y: 0, zoom: 0.5 }, settings: { "map-zoom": "0.6" } });
  try {
    await f.flush();
    assert.equal(f.view.state().lod, "map");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ background

test("background: a board override wins over the settings default; the default applies otherwise", async () => {
  const f = mountFixture({ settings: { grid: "lines", "board-tone": "blue" } });
  try {
    await f.flush();
    const grid = f.root.querySelector(".pxd-grid");
    assert.ok(grid.classList.contains("pxd-grid--lines"));
    assert.ok(f.root.classList.contains("pxd-bg-blue"));
    assert.deepEqual([f.view.state().pattern, f.view.state().tone], ["lines", "blue"]);
    // the board gains an override: pattern + tone switch, the old tone class goes away
    f.session.setBoard(buildBoard(pulled({ rootPlexus: { ":bg": "grid", ":bgColor": "teal" } })));
    f.session.emit("change", { dirty: new Set(["board0001"]), structural: false });
    f.stub.flushFrames();
    assert.ok(grid.classList.contains("pxd-grid--grid"));
    assert.equal(grid.classList.contains("pxd-grid--lines"), false);
    assert.ok(f.root.classList.contains("pxd-bg-teal"));
    assert.equal(f.root.classList.contains("pxd-bg-blue"), false);
    assert.equal(f.root.querySelector(".pxd-popover--bg").classList.contains("pxd-popover--override"), true, "popover shows the override");
    // grid pattern: minor size + position plus the three major variables
    f.view.controller.setTool("select");
    key(f, "=", { ctrlKey: true });
    f.stub.flushFrames();
    assert.match(grid.style.backgroundSize, /^[\d.]+px [\d.]+px$/);
    assert.match(grid.style["--pxd-grid-major"], /px$/);
    assert.match(grid.style["--pxd-grid-major-x"], /px$/);
    // an override with only a tone keeps the default pattern
    f.session.setBoard(buildBoard(pulled({ rootPlexus: { ":bgColor": "pink" } })));
    f.session.emit("change", { dirty: new Set(["board0001"]), structural: false });
    f.stub.flushFrames();
    assert.ok(grid.classList.contains("pxd-grid--lines"));
    assert.ok(f.root.classList.contains("pxd-bg-pink"));
    assert.equal(grid.style["--pxd-grid-major"], undefined, "leaving the grid pattern clears its variables");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("background: the popover writes through the session and 'Use as default' calls onSetDefaults", async () => {
  const defaults = [];
  const f = mountFixture({ viewOptions: { onSetDefaults: (patch) => defaults.push(patch) }, rootPlexus: { ":bg": "plain", ":bgColor": "green" } });
  try {
    await f.flush();
    assert.deepEqual([f.view.state().pattern, f.view.state().tone], ["plain", "green"]);
    const pop = f.root.querySelector(".pxd-popover--bg");
    const seg = pop.querySelectorAll(".pxd-seg__btn").find((b) => b.dataset.value === "lines");
    seg.click();
    assert.deepEqual(f.session.mutations.pop(), ["setBoardBackground", { bg: "lines" }]);
    const tone = pop.querySelectorAll(".pxd-swatch").find((b) => b.dataset.tone === "purple");
    tone.click();
    assert.deepEqual(f.session.mutations.pop(), ["setBoardBackground", { bgColor: "purple" }]);
    pop.querySelector(".pxd-bg__reset").click();
    assert.deepEqual(f.session.mutations.pop(), ["setBoardBackground", { bg: null, bgColor: null }]);
    pop.querySelector(".pxd-bg__default").click();
    assert.deepEqual(defaults, [{ grid: "plain", "board-tone": "green" }]);
    assert.equal(toastText(f), "Saved as the default background");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("background: a refused write (not an enhanced board) tells the user", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.session.setBoardBackground = () => Promise.resolve(false);
    f.root.querySelector(".pxd-popover--bg").querySelectorAll(".pxd-seg__btn")[0].click();
    await tick();
    assert.match(toastText(f), /can't store a background/);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ fit preview

test("fit preview: a card dragged past its section edge shows the section grown, writes nothing, and cancel resets it", async () => {
  const f = mountFixture({ settings: { "snap-guides": false } });
  try {
    await f.flush();
    const section = shell(f, "sectCCCC3");
    assert.equal(section.style.height, "300px");
    const card = shell(f, "cardDDDD4");
    // card sits at world (20,360); the center stays inside the section while the bottom passes its edge
    pointerDown(f, card, 100, 400);
    pointerMove(f, 100, 420);
    pointerMove(f, 100, 580);
    f.stub.flushFrames();
    assert.equal(card.style.transform, "translate(20px, 540px)");
    assert.equal(section.style.height, "364px", "section grows to contain the padded card (bottom 640 + 24)");
    // the card sits 20px from the left edge, inside the 24px padding, so the section also grows leftwards
    assert.equal(section.style.transform, "translate(-4px, 300px)");
    assert.equal(section.style.width, "404px");
    assert.equal(f.session.mutations.length, 0, "the preview writes nothing");
    // cancel puts the section back
    f.stub.dispatch(f.stub.document, "pointercancel", { pointerId: 1 });
    f.stub.flushFrames();
    assert.equal(section.style.height, "300px");
    assert.equal(section.style.width, "400px");
    assert.equal(section.style.transform, "translate(0px, 300px)");
    assert.equal(card.style.transform, "translate(20px, 360px)");
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("fit preview: releasing the drag commits one move and lets go of the preview; the setting turns it off", async () => {
  const f = mountFixture({ settings: { "snap-guides": false, "auto-fit-sections": false } });
  try {
    await f.flush();
    const section = shell(f, "sectCCCC3");
    pointerDown(f, shell(f, "cardDDDD4"), 100, 400);
    pointerMove(f, 100, 420);
    pointerMove(f, 100, 580);
    f.stub.flushFrames();
    assert.equal(section.style.height, "300px", "auto-fit-sections=false previews no growth");
    pointerUp(f, 100, 580);
    assert.deepEqual(f.session.mutations.map((m) => m[0]), ["commitMove"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("fit preview: a resize gesture grows the parent section live and the gesture end snaps it back", async () => {
  const f = mountFixture({ settings: { "snap-guides": false } });
  try {
    await f.flush();
    const section = shell(f, "sectCCCC3");
    const grip = shell(f, "cardDDDD4").querySelectorAll(".pxd-grip").find((g) => g.dataset.part === "corner");
    pointerDown(f, grip, 220, 460);
    pointerMove(f, 240, 500);
    pointerMove(f, 260, 700);
    f.stub.flushFrames();
    assert.ok(Number.parseFloat(section.style.height) > 300, `section grown during the resize (${section.style.height})`);
    f.stub.dispatch(f.stub.document, "pointercancel", { pointerId: 1 });
    f.stub.flushFrames();
    assert.equal(section.style.height, "300px");
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ menu

function rightClick(f, target, x = 100, y = 100) {
  return f.stub.dispatch(target, "contextmenu", { button: 2, clientX: x, clientY: y });
}
const menuRows = (f) => f.root.querySelectorAll(".pxd-menu__item");
const menuIds = (f) => menuRows(f).map((r) => r.dataset.id);
const pickRow = (f, id) => {
  const row = menuRows(f).find((r) => r.dataset.id === id);
  assert.ok(row, `menu row ${id} exists (have ${menuIds(f).join(", ")})`);
  f.stub.dispatch(row, "click", { button: 0 });
};

test("context menu: canvas, card, text, section, edge and multi selections each open their own menu", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const viewport = f.root.querySelector(".pxd-viewport");
    const opens = [];
    const check = (label, target, expectId, absentId) => {
      const ev = rightClick(f, target, 620, 480);
      assert.ok(ev.defaultPrevented, `${label}: the native menu is suppressed`);
      assert.equal(f.view.state().menuOpen, true, label);
      const ids = menuIds(f);
      assert.ok(ids.includes(expectId), `${label}: has ${expectId} (${ids.join(", ")})`);
      if (absentId) assert.ok(!ids.includes(absentId), `${label}: lacks ${absentId}`);
      opens.push(label);
      key(f, "Escape");
      assert.equal(f.view.state().menuOpen, false, `${label}: Escape closes the menu`);
    };
    check("canvas", viewport, "new-card", "delete");
    check("card", shell(f, "cardAAAA1"), "duplicate-ref", "new-card");
    check("text", shell(f, "textTTTT5"), "size:32", "duplicate-ref");
    check("section", f.root.querySelector(".pxd-section__title"), "fit-section", "size:32");
    check("edge", f.root.querySelector(".pxd-edge"), "flip", "fit-section");
    f.view.controller.select(["cardAAAA1", "cardBBBB2"]);
    check("multi", shell(f, "cardAAAA1"), "align:left", "flip");
    assert.deepEqual(opens, ["canvas", "card", "text", "section", "edge", "multi"]);
    assert.equal(f.view.state().selection.length, 2, "Escape closed only the menu");
    assert.equal(f.session.mutations.length, 0, "opening menus writes nothing");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("sticky paper tokens stay opaque when dark mode clears palette fills", () => {
  const css = readFileSync(new URL("../src/css/props.css", import.meta.url), "utf8");
  assert.match(css, /--pxd-sticky-yellow: #fefce8/);
  assert.match(css, /--pxd-sticky-yellow: #38351f/);
  assert.match(css, /--pxd-sticky-blue: #232f45/);
  assert.doesNotMatch(css, /--pxd-sticky-[a-z]+:\s*transparent/);
});

test("a sticky note paints the sticky class and keeps it when the color changes", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const plain = shell(f, "textTTTT5");
    assert.equal(plain.classList.contains("pxd-item--sticky"), false);
    const item = f.session.board.items.get("textTTTT5");
    item.look = "sticky";
    item.color = "yellow";
    item.w = 200;
    item.h = 200;
    f.session.emit("change", { dirty: new Set(["textTTTT5"]), structural: false });
    await f.flush();
    const node = shell(f, "textTTTT5");
    assert.ok(node.classList.contains("pxd-item--sticky"));
    assert.ok(node.classList.contains("pxd-c-yellow"));
    item.color = "pink";
    f.session.emit("change", { dirty: new Set(["textTTTT5"]), structural: false });
    await f.flush();
    const colored = shell(f, "textTTTT5");
    assert.ok(colored.classList.contains("pxd-item--sticky"));
    assert.ok(colored.classList.contains("pxd-c-pink"));
    assert.equal(colored.classList.contains("pxd-c-yellow"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("TP-8: a lane section paints the lane class and puts the label on the side", async () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-section--lane\.pxd-lane-h \.pxd-section__title \{[^}]*right: calc\(100% \+ 8px\)/);
  assert.match(css, /\.pxd-section--lane\.pxd-lane-v \.pxd-section__title \{[^}]*transform: translateX\(-50%\)/);
  const f = mountFixture();
  try {
    await f.flush();
    const item = f.session.board.items.get("sectCCCC3");
    item.look = "lane";
    item.axis = "vertical";
    f.session.emit("change", { dirty: new Set(["sectCCCC3"]), structural: false });
    await f.flush();
    const vertical = shell(f, "sectCCCC3");
    assert.ok(vertical.classList.contains("pxd-section--lane"));
    assert.ok(vertical.classList.contains("pxd-lane-v"));
    item.axis = "horizontal";
    f.session.emit("change", { dirty: new Set(["sectCCCC3"]), structural: false });
    await f.flush();
    const horizontal = shell(f, "sectCCCC3");
    assert.ok(horizontal.classList.contains("pxd-lane-h"));
    assert.equal(horizontal.classList.contains("pxd-lane-v"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a text shape paints an svg outline and a plain text item does not", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const plain = shell(f, "textTTTT5");
    assert.equal(plain.querySelector(".pxd-shape"), null);
    const item = f.session.board.items.get("textTTTT5");
    item.shape = "diamond";
    item.w = 200;
    item.h = 100;
    const rect = f.session.rects.get("textTTTT5");
    rect.w = 200;
    rect.h = 100;
    f.session.emit("change", { dirty: new Set(["textTTTT5"]), structural: false });
    await f.flush();
    const node = shell(f, "textTTTT5");
    assert.ok(node.classList.contains("pxd-item--shape"));
    assert.ok(node.classList.contains("pxd-item--shape-diamond"));
    const path = node.querySelector(".pxd-shape path");
    assert.equal(path.getAttribute("d"), shapePath({ x: 0, y: 0, w: 200, h: 100 }, "diamond"));
    item.shape = undefined;
    delete item.shape;
    f.session.emit("change", { dirty: new Set(["textTTTT5"]), structural: false });
    await f.flush();
    assert.equal(shell(f, "textTTTT5").querySelector(".pxd-shape"), null);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("context menu: a right-click inside an editing card keeps the native menu", async () => {
  const f = mountFixture({ hostOverrides: { renderBlock(el) { const t = globalThis.document.createElement("textarea"); t.className = "rm-block__input"; el.append(t); } } });
  try {
    await f.flush();
    const alpha = shell(f, "cardAAAA1");
    f.stub.dispatch(alpha, "dblclick", { clientX: 50, clientY: 50 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
    assert.ok(alpha.classList.contains("pxd-item--editing"));
    const body = alpha.querySelector(".pxd-item__body");
    const ev = rightClick(f, body);
    assert.equal(ev.defaultPrevented, false);
    assert.equal(f.view.state().menuOpen, false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("context menu: pick dispatch maps every kind's ids onto session calls", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const viewport = f.root.querySelector(".pxd-viewport");
    const last = () => f.session.mutations[f.session.mutations.length - 1];
    const run = async (target, id, x = 300, y = 260, select = null) => {
      f.session.mutations.length = 0;
      if (select) f.view.controller.select(select);
      rightClick(f, target, x, y);
      pickRow(f, id);
      await tick();
      return [...f.session.mutations];
    };

    // canvas: creation lands centered on the click
    let m = await run(viewport, "new-text");
    assert.deepEqual(m[0], ["createText", { x: 180, y: 236 }]);
    m = await run(viewport, "new-sticky");
    assert.deepEqual(m[0], ["createText", { x: 200, y: 160, look: "sticky" }]);
    m = await run(viewport, "new-card");
    assert.deepEqual(m[0], ["createCard", { x: 160, y: 180 }]);
    m = await run(viewport, "new-section");
    assert.deepEqual(m[0], ["createSection", { rect: { x: 60, y: 100, w: 480, h: 320 } }]);
    m = await run(viewport, "new-lane-h");
    assert.deepEqual(m[0], ["createSection", { rect: { x: -180, y: 170, w: 960, h: 180 }, title: "Lane", look: "lane", axis: "horizontal" }]);
    m = await run(viewport, "new-lane-v");
    assert.deepEqual(m[0], ["createSection", { rect: { x: 180, y: -60, w: 240, h: 640 }, title: "Lane", look: "lane", axis: "vertical" }]);
    m = await run(viewport, "new-board");
    assert.deepEqual(m[0], ["createBoard", { rect: { x: 140, y: 150, w: 320, h: 220 } }]);
    m = await run(viewport, "fold-all");
    assert.deepEqual(m[0], ["collapseAll", true]);
    m = await run(viewport, "unfold-all");
    assert.deepEqual(m[0], ["collapseAll", false]);
    m = await run(viewport, "add-today");
    assert.equal(m[0][0], "addDailyCards");
    assert.equal(m[0][1].length, 1);
    assert.deepEqual(m[0][2], { x: 300, y: 260 });
    m = await run(viewport, "add-week");
    const week = m[0][1];
    assert.equal(week.length, 7);
    assert.deepEqual(week.map((d) => d.getDay()), [1, 2, 3, 4, 5, 6, 0], "Monday to Sunday");
    await run(viewport, "select-all");
    assert.equal(f.view.state().selection.length, 5);
    f.view.controller.select([]);
    await run(viewport, "background");
    assert.notEqual(f.root.querySelector(".pxd-popover--bg").style.display, "none", "Background… opens the toolbar popover");
    f.root.querySelector(".pxd-popover--bg").style.display = "none";

    // card
    const alpha = shell(f, "cardAAAA1");
    m = await run(alpha, "duplicate");
    assert.deepEqual(m[0], ["duplicateItems", ["cardAAAA1"], { dx: 24, dy: 24, asRef: false }]);
    m = await run(alpha, "duplicate-ref");
    assert.deepEqual(m[0], ["duplicateItems", ["cardAAAA1"], { dx: 24, dy: 24, asRef: true }]);
    m = await run(alpha, "pin");
    assert.deepEqual(m[0], ["setPinned", ["cardAAAA1"], true]);
    m = await run(alpha, "fold");
    assert.deepEqual(m[0], ["setCollapsedMany", ["cardAAAA1"], true]);
    m = await run(alpha, "color:red");
    assert.deepEqual(m[0], ["setColor", ["cardAAAA1"], "red"]);
    m = await run(alpha, "color:none");
    assert.deepEqual(m[0], ["setColor", ["cardAAAA1"], null]);
    m = await run(alpha, "reset-size");
    assert.deepEqual(m[0], ["resetSize", ["cardAAAA1"]]);
    m = await run(alpha, "delete");
    assert.deepEqual(m[0].slice(0, 2), ["deleteItems", ["cardAAAA1"]]);
    m = await run(alpha, "fit-height");
    assert.match(toastText(f), /Zoom in to measure/, "no measurable content in the stub: the user is told, nothing is written");
    assert.deepEqual(m, []);
    m = await run(shell(f, "cardBBBB2"), "mind-map");
    assert.equal(m[0][0], "expandOutline");
    assert.equal(m[0][1], "cardBBBB2");
    assert.deepEqual(m[0][2], { direction: "right", spacing: "normal", depth: 3, includeRefs: true, colorBranches: false });
    m = await run(shell(f, "cardBBBB2"), "mind-dir:radial");
    assert.deepEqual(m[0][2], { direction: "radial", spacing: "normal", depth: 3, includeRefs: true, colorBranches: false });
    assert.deepEqual(JSON.parse(f.stub.localStorage.getItem("plexus-diagram:mindmap-preset")), m[0][2]);
    await tick();
    assert.equal(toastText(f), "Added 2 cards as a mind map");
    // text
    m = await run(shell(f, "textTTTT5"), "size:32");
    assert.deepEqual(m[0], ["setFontSize", "textTTTT5", 32]);
    m = await run(shell(f, "textTTTT5"), "shape:diamond");
    assert.deepEqual(m[0], ["setItemStyle", ["textTTTT5"], { shape: "diamond" }]);
    // section
    const title = f.root.querySelector(".pxd-section__title");
    m = await run(title, "fit-section");
    assert.deepEqual(m[0], ["fitSection", "sectCCCC3"]);
    m = await run(title, "toggle-fit");
    assert.deepEqual(m[0], ["setFit", "sectCCCC3", false]);
    m = await run(title, "tidy:grid");
    assert.deepEqual(m[0], ["tidyItems", ["sectCCCC3"], "grid"]);
    m = await run(title, "fold-all-in");
    assert.deepEqual(m[0], ["collapseAll", true, { within: "sectCCCC3" }]);
    m = await run(title, "unfold-all-in");
    assert.deepEqual(m[0], ["collapseAll", false, { within: "sectCCCC3" }]);
    m = await run(title, "delete-contents");
    assert.deepEqual(m[0].slice(0, 3), ["deleteItems", ["sectCCCC3"], { withContents: true }]);
    m = await run(title, "select-contents");
    assert.deepEqual(f.view.state().selection, ["cardDDDD4"]);
    // edge
    const edge = f.root.querySelector(".pxd-edge");
    m = await run(edge, "dir:two");
    assert.deepEqual(m[0], ["updateEdge", "edgeFFFF6", { dir: "two" }]);
    m = await run(edge, "route:elbow");
    assert.deepEqual(m[0], ["updateEdge", "edgeFFFF6", { route: "elbow" }]);
    m = await run(edge, "dash:dashed");
    assert.deepEqual(m[0], ["updateEdge", "edgeFFFF6", { dash: "dashed" }]);
    m = await run(edge, "flip");
    assert.deepEqual(m[0], ["flipEdge", "edgeFFFF6"]);
    m = await run(edge, "write-to-graph");
    assert.deepEqual(m[0], ["writeToGraph", "edgeFFFF6"]);
    m = await run(edge, "color:teal");
    assert.deepEqual(m[0], ["setColor", ["edgeFFFF6"], "teal"]);
    // multi
    const trio = ["cardAAAA1", "cardBBBB2", "textTTTT5"];
    m = await run(alpha, "same-size:width", 300, 260, trio);
    assert.deepEqual(m[0], ["sameSize", ["cardAAAA1", "cardBBBB2", "textTTTT5"], "textTTTT5", "width"]);
    m = await run(alpha, "wrap-section", 300, 260, trio);
    assert.deepEqual(m[0], ["wrapInSection", ["cardAAAA1", "cardBBBB2", "textTTTT5"]]);
    m = await run(alpha, "wrap-board", 300, 260, trio);
    assert.deepEqual(m[0], ["wrapInBoard", ["cardAAAA1", "cardBBBB2", "textTTTT5"]]);
    m = await run(alpha, "align:left", 300, 260, trio);
    assert.equal(m[0][0], "commitRects");
    assert.deepEqual(m[0][1].map((r) => r.x), [0, 0, 0]);
    m = await run(alpha, "distribute:h", 300, 260, trio);
    assert.equal(m[0][0], "commitRects");
    m = await run(alpha, "pin", 300, 260, trio);
    assert.deepEqual(m[0], ["setPinned", trio, true]);
    assert.equal(last()[0], "setPinned");
    assert.equal(f.view.state().menuOpen, false, "a pick closes the menu");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("context menu: a pinned card offers Unpin, and an all-pinned multi-selection does too", async () => {
  const pinned = (uid, x) => ({ ":block/uid": uid, ":block/string": uid, ":block/order": 9, ":block/props": { ":plexus": { ":x": x, ":y": 700, ":w": 100, ":h": 60, ":pinned": true } }, ":block/children": [] });
  const f = mountFixture({ extra: [pinned("pinnedAA1", 0), pinned("pinnedBB2", 200)] });
  try {
    await f.flush();
    rightClick(f, shell(f, "pinnedAA1"));
    assert.ok(menuIds(f).includes("unpin"));
    assert.ok(!menuIds(f).includes("pin"));
    pickRow(f, "unpin");
    await tick();
    assert.deepEqual(f.session.mutations[0], ["setPinned", ["pinnedAA1"], false]);
    f.session.mutations.length = 0;
    f.view.controller.select(["pinnedAA1", "pinnedBB2"]);
    rightClick(f, shell(f, "pinnedAA1"));
    assert.ok(menuIds(f).includes("unpin"), "every selected item is pinned");
    key(f, "Escape");
    f.view.controller.select(["pinnedAA1", "cardAAAA1"]);
    rightClick(f, shell(f, "cardAAAA1"));
    assert.ok(menuIds(f).includes("pin"), "a mixed selection offers Pin");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("context menu: copy-ref and copy-link put the right text on the clipboard; Send to board picks a board in the panel", async () => {
  const copied = [];
  const restoreNav = stubNavigator({ clipboard: { writeText: async (t) => { copied.push(t); }, readText: async () => "" } });
  const f = mountFixture({ hostOverrides: { listBoards: () => [{ uid: "boardTarget", title: "Inner", pageTitle: "Page", count: 3 }], openBlock() { f.opened = true; } } });
  try {
    await f.flush();
    const beta = shell(f, "cardBBBB2");
    rightClick(f, beta);
    pickRow(f, "copy-ref");
    await tick();
    rightClick(f, beta);
    pickRow(f, "copy-link");
    await tick();
    assert.deepEqual(copied, ["((cardBBBB2))", "[[Beta]]\n#/app/Svy/page/board0001?pxd=cardBBBB2"]);
    assert.equal(toastText(f), "Link copied");
    // send-to: the Boards tab lists boards, the next row click sends instead of navigating
    rightClick(f, beta);
    pickRow(f, "send-to");
    await tick();
    const panel = f.root.querySelector(".pxd-panel");
    assert.notEqual(panel.style.display, "none");
    const boardRow = f.root.querySelector(".pxd-panel__board-row");
    assert.ok(boardRow, "boards are listed");
    f.stub.dispatch(boardRow, "click", { button: 0 });
    await tick();
    assert.deepEqual(f.session.mutations.find((m) => m[0] === "sendToBoard"), ["sendToBoard", ["cardBBBB2"], "boardTarget"]);
    assert.equal(f.opened, undefined, "the pick sent the card instead of opening the board");
    assert.match(toastText(f), /Added 1 card to Inner/);
    assert.equal(panel.style.display, "none", "the panel closes after the send");
    // afterwards a row click navigates again
    f.root.querySelector(".pxd-toolbar__add").click();
    f.root.querySelectorAll(".pxd-panel__tab").find((b) => b.dataset.tab === "boards").click();
    await tick();
    f.stub.dispatch(f.root.querySelector(".pxd-panel__board-row"), "click", { button: 0 });
    assert.equal(f.opened, true);
  } finally {
    restoreNav();
    f.view.dispose();
    f.restore();
  }
});

test("HB-4: ?pxd= zooms to the card and pulses it; copy link uses the board page", async () => {
  const copied = [];
  const restoreNav = stubNavigator({ clipboard: { writeText: async (t) => { copied.push(t); } } });
  const page = { uid: "pageLAB99" };
  const link = cardDeepLink({ graph: "Svy", pageUid: "pageLAB99", cardUid: "cardAAAA1" });
  const f = mountFixture({ hash: link, hostOverrides: { blockPageUid: () => page.uid } });
  try {
    await f.flush();
    const world = f.root.querySelector(".pxd-world");
    const landed = world.style.transform;
    assert.deepEqual(f.view.state().selection, ["cardAAAA1"]);
    assert.notEqual(landed, "translate(0px, 0px) scale(1)");
    assert.ok(shell(f, "cardAAAA1").classList.contains("pxd-item--pulse"));
    assert.equal(f.session.mutations.length, 0, "opening a deep link writes nothing");

    page.uid = "otherHOST";
    rightClick(f, shell(f, "cardAAAA1"));
    pickRow(f, "copy-link");
    await tick();
    rightClick(f, shell(f, "cardBBBB2"));
    pickRow(f, "copy-link");
    await tick();
    assert.deepEqual(copied, [
      "((cardAAAA1))\n#/app/Svy/page/otherHOST?pxd=cardAAAA1",
      "[[Beta]]\n#/app/Svy/page/otherHOST?pxd=cardBBBB2",
    ]);
    page.uid = "pageLAB99";

    f.stub.window.location.hash = cardDeepLink({ graph: "Svy", pageUid: "pageLAB99", cardUid: "cardBBBB2" });
    f.stub.dispatch(f.stub.window, "hashchange", {});
    f.stub.flushFrames();
    assert.deepEqual(f.view.state().selection, ["cardBBBB2"]);
    assert.notEqual(world.style.transform, landed);
    assert.ok(shell(f, "cardBBBB2").classList.contains("pxd-item--pulse"));
    await tick(1900);
    assert.equal(shell(f, "cardBBBB2").classList.contains("pxd-item--pulse"), false, "the pulse class does not stay");
    f.stub.dispatch(f.stub.window, "hashchange", {});
    f.stub.flushFrames();
    assert.ok(shell(f, "cardBBBB2").classList.contains("pxd-item--pulse"), "the same link pulses again");

    const stayed = world.style.transform;
    f.stub.window.location.hash = cardDeepLink({ graph: "Svy", pageUid: "otherPAGE", cardUid: "cardAAAA1" });
    f.stub.dispatch(f.stub.window, "hashchange", {});
    f.stub.flushFrames();
    assert.equal(world.style.transform, stayed, "a link for another page does not move this board");
    assert.deepEqual(f.view.state().selection, ["cardBBBB2"]);
    f.stub.window.location.hash = cardDeepLink({ graph: "Svy", pageUid: "pageLAB99", cardUid: "missing99" });
    f.stub.dispatch(f.stub.window, "hashchange", {});
    f.stub.flushFrames();
    assert.equal(world.style.transform, stayed);
    assert.equal(f.session.mutations.length, 0);

    // Roam drops ?pxd= from location.hash before listeners. newURL still has it.
    f.stub.window.location.hash = "#/app/Svy/page/pageLAB99";
    f.stub.dispatch(f.stub.window, "hashchange", {
      newURL: "https://roamresearch.com/?server-port=3333#/app/Svy/page/pageLAB99?pxd=cardAAAA1",
    });
    f.stub.flushFrames();
    assert.deepEqual(f.view.state().selection, ["cardAAAA1"]);
    assert.notEqual(world.style.transform, stayed);
    const zoomed = world.style.transform;
    assert.ok(shell(f, "cardAAAA1").classList.contains("pxd-item--pulse"));
    f.stub.dispatch(f.stub.window, "hashchange", {
      newURL: "https://roamresearch.com/?server-port=3333#/app/Svy/page/pageLAB99",
    });
    f.stub.flushFrames();
    assert.equal(world.style.transform, zoomed, "the follow-up strip does not move the board");
    assert.deepEqual(f.view.state().selection, ["cardAAAA1"]);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    restoreNav();
    f.view.dispose();
    f.restore();
  }
});

test("More button opens the board menu at the button and picks run", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.root.querySelector(".pxd-toolbar__more").click();
    assert.equal(f.view.state().menuOpen, true);
    assert.ok(menuIds(f).includes("export-svg"));
    pickRow(f, "tidy:grid");
    await tick();
    assert.deepEqual(f.session.mutations[0], ["tidyItems", ["cardAAAA1", "cardBBBB2", "textTTTT5", "sectCCCC3"], "grid"]);
    f.root.querySelector(".pxd-toolbar__more").click();
    pickRow(f, "sort-outline");
    await tick();
    assert.equal(f.session.mutations.at(-1)[0], "sortOutline");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("TB-6: the board's own dock key picks the side, opening writes nothing, and the menu action writes it", async () => {
  const f = mountFixture({ settings: { "dock-position": "bottom" }, rootPlexus: { dock: "left", bgColor: "teal" } });
  try {
    await f.flush();
    assert.equal(f.root.classList.contains("pxd-root--dock-left"), true);
    assert.equal(f.root.classList.contains("pxd-root--dock-bottom"), false);
    assert.equal(f.root.querySelector(".pxd-toolbar").style["--pxd-board-line"], "var(--pxd-teal-line)");
    assert.equal(f.session.mutations.length, 0, "no write on open");
    f.root.querySelector(".pxd-toolbar__more").click();
    pickRow(f, "dock");
    pickRow(f, "dock:top");
    await tick();
    assert.deepEqual(f.session.mutations.at(-1), ["setBoardBackground", { dock: "top" }]);
    f.root.querySelector(".pxd-toolbar__more").click();
    pickRow(f, "dock");
    pickRow(f, "dock:default");
    await tick();
    assert.deepEqual(f.session.mutations.at(-1), ["setBoardBackground", { dock: null }]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("TB-7: a board narrower than 560px gets the narrow class", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    assert.equal(f.root.classList.contains("pxd-root--narrow"), false, "800px wide");
    f.root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: 400, right: 480, bottom: 400, x: 0, y: 0 });
    for (const ro of [...f.stub.observers]) ro.cb?.([]);
    assert.equal(f.root.classList.contains("pxd-root--narrow"), true, "480px wide");
    f.root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 400, right: 900, bottom: 400, x: 0, y: 0 });
    for (const ro of [...f.stub.observers]) ro.cb?.([]);
    assert.equal(f.root.classList.contains("pxd-root--narrow"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ Alt+drag duplicate

test("Alt+drag shows a dashed ghost, leaves the original, and duplicates on drop; Shift adds 'as ref'", async () => {
  const f = mountFixture({ settings: { "snap-guides": false } });
  try {
    await f.flush();
    const alpha = shell(f, "cardAAAA1");
    pointerDown(f, alpha, 50, 50, { altKey: true });
    pointerMove(f, 90, 70, { altKey: true });
    pointerMove(f, 150, 90, { altKey: true });
    f.stub.flushFrames();
    const ghosts = f.root.querySelectorAll(".pxd-ghost");
    assert.equal(ghosts.length, 1);
    assert.equal(ghosts[0].getAttribute("x"), "100");
    assert.equal(ghosts[0].getAttribute("y"), "40");
    assert.equal(alpha.style.transform, "translate(0px, 0px)", "the original stays put");
    pointerUp(f, 150, 90, { altKey: true });
    await tick();
    assert.deepEqual(f.session.mutations.map((m) => m[0]), ["duplicateItems"]);
    assert.deepEqual(f.session.mutations[0], ["duplicateItems", ["cardAAAA1"], { dx: 100, dy: 40, asRef: false }]);
    assert.equal(f.root.querySelectorAll(".pxd-ghost").length, 0, "ghosts are cleared on drop");
    assert.equal(toastText(f), "Duplicated 1 card");
    f.root.querySelector(".pxd-toast__action").click();
    assert.equal(f.session.mutations[f.session.mutations.length - 1][0], "undo", "the toast offers Undo");
    assert.deepEqual(f.view.state().selection, ["duplicateItems-uid"], "the copy is selected");
    // Alt+Shift: as a reference
    f.session.mutations.length = 0;
    pointerDown(f, shell(f, "cardBBBB2"), 350, 50, { altKey: true, shiftKey: true, pointerId: 2 });
    pointerMove(f, 380, 60, { altKey: true, shiftKey: true, pointerId: 2 });
    pointerMove(f, 420, 80, { altKey: true, shiftKey: true, pointerId: 2 });
    pointerUp(f, 420, 80, { altKey: true, shiftKey: true, pointerId: 2 });
    await tick();
    assert.equal(f.session.mutations[0][2].asRef, true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("Cmd+D duplicates the selection offset by 24 and the fold key toggles it", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1", "sectCCCC3"]);
    key(f, "d", { metaKey: true });
    await tick();
    assert.deepEqual(f.session.mutations[0], ["duplicateItems", ["cardAAAA1", "sectCCCC3"], { dx: 24, dy: 24, asRef: false }]);
    f.session.mutations.length = 0;
    f.view.controller.select(["cardAAAA1", "sectCCCC3"]);
    key(f, "Enter", { metaKey: true, altKey: true });
    assert.deepEqual(f.session.mutations[0], ["setCollapsedMany", ["cardAAAA1", "cardDDDD4"], true], "cards, and the cards inside a selected section, fold together");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ clipboard

const clipboardData = (data = {}, files = []) => {
  const store = { ...data };
  return { store, files, getData: (t) => store[t] ?? "", setData: (t, v) => { store[t] = v; } };
};

test("clipboard: copy writes the plexus payload; paste routes plexus, text and images to the session at the pointer", async () => {
  const f = mountFixture({ hostOverrides: { uploadFile: async (file) => `https://files.test/${file.name}` } });
  try {
    await f.flush();
    f.stub.dispatch(f.root, "pointerenter");
    f.stub.dispatch(f.root, "pointermove", { clientX: 300, clientY: 220 });
    f.view.controller.select(["cardAAAA1", "cardBBBB2"]);
    const out = clipboardData();
    const copyEv = f.stub.dispatch(f.stub.document, "copy", { clipboardData: out });
    assert.ok(copyEv.defaultPrevented);
    const payload = JSON.parse(out.store[PLEXUS_MIME]);
    assert.deepEqual(payload.items.map((i) => i.uid), ["cardAAAA1", "cardBBBB2"]);
    assert.equal(out.store["text/plain"], "((cardAAAA1))\n[[Beta]]");

    // paste: the plexus payload becomes ref cards at the pointer; after Cmd+Shift+V it clones
    f.session.mutations.length = 0;
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({ [PLEXUS_MIME]: out.store[PLEXUS_MIME] }) });
    await tick();
    assert.deepEqual(f.session.mutations[0], ["pasteItems", payload, { x: 300, y: 220, mode: "refs" }]);
    assert.equal(toastText(f), "Pasted 1 card");
    f.stub.dispatch(f.stub.window, "keydown", { key: "V", metaKey: true, shiftKey: true });
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({ [PLEXUS_MIME]: out.store[PLEXUS_MIME] }) });
    await tick();
    assert.equal(f.session.mutations[1][2].mode, "clone");

    // text
    f.session.mutations.length = 0;
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({ "text/plain": "- one\n- two" }) });
    await tick();
    assert.deepEqual(f.session.mutations[0], ["pasteText", [{ string: "one" }, { string: "two" }], { x: 300, y: 220 }]);

    // images: uploaded through the host, then one ref card per image
    f.session.mutations.length = 0;
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({}, [{ type: "image/png", name: "a.png" }, { type: "image/jpeg", name: "b.jpg" }]) });
    await tick(5);
    const add = f.session.mutations.find((m) => m[0] === "addRefCards");
    assert.deepEqual(add[1].map((c) => c.string), ["![](https://files.test/a.png)", "![](https://files.test/b.jpg)"]);
    assert.equal(add[1][0].x, 300);
    assert.equal(add[1][0].y, 220);
    assert.equal(toastText(f), "Added 1 image");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("clipboard: cut copies then deletes; pastes are ignored when the board does not own the keyboard; no point means the viewport center", async () => {
  const f = mountFixture({ viewOptions: { autofocus: false } });
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1"]);
    const cut = f.stub.dispatch(f.stub.document, "cut", { clipboardData: clipboardData() });
    assert.equal(cut.defaultPrevented, false, "the board does not own the keyboard yet");
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({ "text/plain": "x" }) });
    assert.equal(f.session.mutations.length, 0);
    f.stub.dispatch(f.root, "pointerenter");
    const out = clipboardData();
    f.stub.dispatch(f.stub.document, "cut", { clipboardData: out });
    assert.ok(out.store[PLEXUS_MIME]);
    assert.deepEqual(f.session.mutations[0].slice(0, 2), ["deleteItems", ["cardAAAA1"]]);
    assert.deepEqual(f.session.mutations[0][2], { withContents: true }, "a cut is a move: the subtree goes with the card");
    assert.deepEqual(JSON.parse(out.store[PLEXUS_MIME]).snapshot.snapshotOf, ["cardAAAA1"], "the payload carries a snapshot for the paste");
    // no pointer sample: center of the 800x600 viewport
    f.session.mutations.length = 0;
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({ "text/plain": "x" }) });
    await tick();
    assert.deepEqual(f.session.mutations[0], ["pasteText", [{ string: "x" }], { x: 400, y: 300 }]);
    // a focused text field means the browser handles paste
    const input = f.stub.document.createElement("textarea");
    f.stub.document.body.append(input);
    input.focus();
    f.session.mutations.length = 0;
    f.stub.dispatch(input, "paste", { clipboardData: clipboardData({ "text/plain": "typed" }) });
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("clipboard: an upload-unavailable host explains itself and adds no card; a failed upload does too", async () => {
  const f = mountFixture({ hostOverrides: { uploadFile: async () => { throw new Error("upload-unavailable"); } } });
  try {
    await f.flush();
    f.stub.dispatch(f.root, "pointerenter");
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({}, [{ type: "image/png", name: "a.png" }]) });
    await tick(5);
    assert.match(toastText(f), /not available/);
    assert.equal(f.session.mutations.length, 0);
    f.host.uploadFile = async () => { throw new Error("boom"); };
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({}, [{ type: "image/png", name: "a.png" }]) });
    await tick(5);
    assert.match(toastText(f), /Couldn't upload/);
    assert.equal(f.session.mutations.length, 0);
    delete f.host.uploadFile;
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({}, [{ type: "image/png", name: "a.png" }]) });
    await tick(5);
    assert.match(toastText(f), /not available/);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("clipboard: the menu paste restores the last copied plexus items, or falls back to the clipboard text", async () => {
  let clipboardText = "";
  const restoreNav = stubNavigator({ clipboard: { writeText: async (t) => { clipboardText = t; }, readText: async () => clipboardText } });
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1"]);
    rightClick(f, shell(f, "cardAAAA1"));
    pickRow(f, "copy");
    await tick();
    assert.equal(clipboardText, "((cardAAAA1))");
    const viewport = f.root.querySelector(".pxd-viewport");
    rightClick(f, viewport, 500, 400);
    pickRow(f, "paste");
    await tick();
    const paste = f.session.mutations.find((m) => m[0] === "pasteItems");
    assert.deepEqual(paste[1].items.map((i) => i.uid), ["cardAAAA1"]);
    assert.deepEqual(paste[2], { x: 500, y: 400, mode: "refs" });
    rightClick(f, viewport, 500, 400);
    pickRow(f, "paste-clone");
    await tick();
    assert.equal(f.session.mutations.filter((m) => m[0] === "pasteItems")[1][2].mode, "clone");
    // somebody else changed the clipboard: text wins
    clipboardText = "plain line";
    rightClick(f, viewport, 500, 400);
    pickRow(f, "paste");
    await tick();
    assert.deepEqual(f.session.mutations.find((m) => m[0] === "pasteText"), ["pasteText", [{ string: "plain line" }], { x: 500, y: 400 }]);
  } finally {
    restoreNav();
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ focus, quick look, present

test("focus: the set is the selection plus its connection neighbours; Esc leaves focus before it clears the selection", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select([]);
    f.root.querySelector(".pxd-toolbar__focus").click();
    assert.match(toastText(f), /Select a card/);
    assert.equal(f.view.state().focus, false);
    f.view.controller.select(["cardAAAA1"]);
    await settleWait(f);
    key(f, "f");
    f.stub.flushFrames();
    assert.equal(f.view.state().focus, true);
    assert.ok(f.root.classList.contains("pxd-root--focus"));
    const dim = (uid) => shell(f, uid).classList.contains("pxd-item--focus-dim");
    assert.equal(dim("cardAAAA1"), false);
    assert.equal(dim("cardBBBB2"), false, "the connected card stays lit");
    assert.equal(dim("textTTTT5"), true);
    assert.equal(dim("cardDDDD4"), true);
    assert.ok(shell(f, "sectCCCC3").classList.contains("pxd-section--focus-dim"));
    // the set follows the selection (recomputed on selection change)
    f.view.controller.select(["textTTTT5"]);
    f.stub.flushFrames();
    assert.equal(dim("textTTTT5"), false);
    assert.equal(dim("cardAAAA1"), true);
    // links from the session are neighbours too
    f.session.links = [{ key: "l1", from: "textTTTT5", to: "cardDDDD4" }];
    f.session.emit("links");
    f.view.controller.select(["textTTTT5"]);
    f.stub.flushFrames();
    f.session.emit("change", { dirty: new Set(["textTTTT5"]), structural: false });
    f.stub.flushFrames();
    assert.equal(dim("cardDDDD4"), false);
    key(f, "Escape");
    f.stub.flushFrames();
    assert.equal(f.view.state().focus, false);
    assert.equal(dim("cardAAAA1"), false, "focus cleared");
    assert.equal(f.root.classList.contains("pxd-root--focus"), false);
    assert.deepEqual(f.view.state().selection, ["textTTTT5"], "the first Esc left focus only");
    key(f, "Escape");
    assert.deepEqual(f.view.state().selection, []);
    assert.equal(f.session.mutations.length, 0, "focus is presentation-only");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("RG-8: a tag lens dims untagged cards, intersects focus, and writes nothing", async () => {
  const f = mountFixture({
    extra: [{
      ":block/uid": "cardRG8A01",
      ":block/string": "kept #rg8a",
      ":block/order": 6,
      ":block/props": { ":plexus": { ":x": 0, ":y": 700, ":w": 200, ":h": 100 } },
      ":block/children": [],
    }],
    hostOverrides: {
      pullPage: (title) => (title === "Beta" ? { ":block/children": [{ ":block/string": "on the page #rg8b" }] } : null),
    },
  });
  try {
    await f.flush();
    const before = f.session.mutations.length;
    const dim = (uid) => shell(f, uid).classList.contains("pxd-item--focus-dim");
    f.root.querySelector(".pxd-toolbar__lens").click();
    const labels = [...f.root.querySelectorAll(".pxd-lens__row")].map((node) => node.textContent);
    assert.deepEqual(labels, ["All cards", "#rg8b", "#rg8a"]);
    [...f.root.querySelectorAll(".pxd-lens__row")].find((node) => node.getAttribute("data-tag") === "rg8b").click();
    assert.equal(f.view.state().lens, "rg8b");
    assert.equal(dim("cardBBBB2"), false);
    assert.equal(dim("cardRG8A01"), true);
    assert.equal(dim("cardAAAA1"), true);
    f.view.controller.select(["cardAAAA1"]);
    f.stub.flushFrames();
    f.root.querySelector(".pxd-toolbar__focus").click();
    assert.equal(f.view.state().focus, true);
    assert.equal(dim("cardBBBB2"), false, "the tagged neighbour stays bright");
    assert.equal(dim("cardAAAA1"), true, "focus would keep this card; the lens dims it");
    f.root.querySelector(".pxd-toolbar__lens").click();
    [...f.root.querySelectorAll(".pxd-lens__row")].find((node) => node.textContent === "All cards").click();
    assert.equal(f.view.state().lens, null);
    assert.equal(dim("cardAAAA1"), false);
    assert.equal(dim("cardBBBB2"), false);
    assert.equal(dim("textTTTT5"), true);
    assert.equal(f.session.mutations.length, before, "a lens writes nothing");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("Quick Look: Q opens a preview of the selected card, other board keys are inert, Esc closes it before touching the selection", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1"]);
    key(f, "q");
    assert.ok(f.root.querySelector(".pxd-quicklook"));
    key(f, "Delete");
    assert.equal(f.session.mutations.length, 0, "the board ignores keys while Quick Look is open");
    key(f, "Escape");
    assert.equal(f.root.querySelector(".pxd-quicklook"), null);
    assert.deepEqual(f.view.state().selection, ["cardAAAA1"]);
    key(f, "q");
    key(f, "q");
    assert.equal(f.root.querySelector(".pxd-quicklook"), null, "Q toggles");
    f.view.controller.select(["sectCCCC3"]);
    key(f, "q");
    assert.equal(f.root.querySelector(".pxd-quicklook"), null, "sections have no Quick Look");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("present: the toolbar starts a presentation over the sections; keys page through steps; Esc exits and clears the dimming", async () => {
  const f = mountFixture({ extra: secondSection() });
  try {
    await f.flush();
    f.root.querySelector(".pxd-toolbar__present").click();
    f.stub.flushFrames();
    assert.equal(f.view.state().present, true);
    const hud = f.root.querySelector(".pxd-present-hud");
    assert.ok(hud);
    assert.equal(hud.querySelector(".pxd-present-hud__count").textContent, "1 / 2");
    assert.equal(hud.querySelector(".pxd-present-hud__title").textContent, "Evidence");
    assert.ok(f.view.state().zoom <= 1.2 + 1e-9);
    const dim = (uid) => shell(f, uid).classList.contains("pxd-item--focus-dim");
    assert.equal(dim("cardDDDD4"), false, "the step's members are lit");
    assert.equal(dim("cardAAAA1"), true, "everything else is dimmed");
    assert.ok(shell(f, "sectGGGG7").classList.contains("pxd-section--focus-dim"));
    key(f, "Delete");
    key(f, "g");
    assert.equal(f.session.mutations.length, 0, "unrelated keys do nothing while presenting");
    key(f, "ArrowRight");
    f.stub.flushFrames();
    assert.equal(hud.querySelector(".pxd-present-hud__count").textContent, "2 / 2");
    assert.equal(hud.querySelector(".pxd-present-hud__title").textContent, "Second");
    assert.ok(shell(f, "sectCCCC3").classList.contains("pxd-section--focus-dim"));
    assert.equal(shell(f, "sectGGGG7").classList.contains("pxd-section--focus-dim"), false);
    key(f, " ");
    assert.equal(hud.querySelector(".pxd-present-hud__count").textContent, "2 / 2", "no step past the end");
    key(f, "ArrowLeft");
    assert.equal(hud.querySelector(".pxd-present-hud__count").textContent, "1 / 2");
    f.view.controller.select(["cardAAAA1"]);
    key(f, "Escape");
    f.stub.flushFrames();
    assert.equal(f.view.state().present, false);
    assert.equal(f.root.querySelector(".pxd-present-hud"), null);
    assert.equal(dim("cardAAAA1"), false);
    assert.deepEqual(f.view.state().selection, ["cardAAAA1"], "Esc only left the presentation");
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("present: an empty board has nothing to present", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.session.setBoard(buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [] }));
    f.session.emit("change", { structural: true });
    f.stub.flushFrames();
    key(f, "p");
    assert.equal(f.view.state().present, false);
    assert.equal(toastText(f), "Nothing to present");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ badges

test("badges: stats are fetched once per key for visible cards at detail zoom, cached, and rendered as chips", async () => {
  const calls = [];
  const cardStats = (targets, opts) => {
    calls.push({ targets, opts });
    return new Map(targets.map((t) => [t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`, { refs: 3, boards: 1, open: 2, done: 1 }]));
  };
  const f = mountFixture({ hostOverrides: { cardStats } });
  try {
    await f.flush();
    await tick(80);
    assert.equal(calls.length, 0, "the graph scan waits for an idle slot");
    f.stub.flushIdle(); // the stats query runs in an idle slot
    f.stub.flushFrames();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].opts, { boardUid: "board0001" });
    assert.deepEqual(calls[0].targets.map((t) => t.kind === "page" ? t.title : t.uid).sort(), ["Beta", "cardAAAA1", "cardDDDD4"].sort());
    const chips = shell(f, "cardBBBB2").querySelectorAll(".pxd-badge-chip").map((c) => c.textContent);
    assert.ok(chips.includes("3 refs"), `refs chip (${chips.join(" | ")})`);
    assert.ok(chips.includes("2/1"), "task chip");
    assert.equal(f.session.mutations.length, 0, "badges write nothing");
    // a settle at the same zoom is served from the cache
    f.view.controller.select(["cardAAAA1"]);
    f.stub.dispatch(f.root.querySelector(".pxd-viewport"), "wheel", { deltaX: 0, deltaY: 1, clientX: 300, clientY: 300 });
    f.stub.flushFrames();
    await tick(140);
    f.stub.flushIdle();
    assert.equal(calls.length, 1, "no second query inside the cache window");
    // zoomed out to the map tier: nothing is fetched and the chips go away
    pointerDown(f, f.root.querySelector(".pxd-viewport"), 400, 300, { button: 1, buttons: 4 });
    for (let i = 0; i < 6; i += 1) { key(f, "-", { ctrlKey: true }); f.stub.flushFrames(); }
    pointerUp(f, 400, 300, { button: 1 });
    await tick(140);
    f.stub.flushFrames();
    assert.equal(f.view.state().lod, "map");
    assert.equal(calls.length, 1);
    assert.equal(shell(f, "cardBBBB2").querySelectorAll(".pxd-badge-chip").length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("badges: never while a gesture runs, never at map zoom, and never when the setting is off", async () => {
  const calls = [];
  const hostOverrides = { cardStats: (targets) => { calls.push(targets); return new Map(); } };
  const map = mountFixture({ vp: { x: 0, y: 0, zoom: 0.3 }, hostOverrides });
  try {
    await map.flush();
    await tick(80);
    assert.equal(calls.length, 0, "map tier");
  } finally {
    map.view.dispose();
    map.restore();
  }
  const off = mountFixture({ settings: { "show-card-badges": false }, hostOverrides });
  try {
    await off.flush();
    await tick(80);
    assert.equal(calls.length, 0, "setting off");
  } finally {
    off.view.dispose();
    off.restore();
  }
  const busy = mountFixture({ hostOverrides });
  try {
    pointerDown(busy, busy.root.querySelector(".pxd-viewport"), 400, 300, { button: 1, buttons: 4 });
    await busy.flush();
    await tick(80);
    assert.equal(calls.length, 0, "a gesture is running");
    pointerUp(busy, 400, 300, { button: 1 });
    await tick(140);
    busy.stub.flushIdle();
    assert.equal(calls.length, 1, "the query runs once the gesture is over");
  } finally {
    busy.view.dispose();
    busy.restore();
  }
});

// ------------------------------------------------------------------ back to content

test("back to content: shown when nothing is in view, hidden again after fit", async () => {
  const f = mountFixture({ vp: { x: -50000, y: -50000, zoom: 1 } });
  try {
    await f.flush();
    await tick(10);
    const back = f.root.querySelector(".pxd-backtocontent");
    assert.equal(back.style.display, "", "no item intersects the viewport");
    back.click();
    await tick(140);
    f.stub.flushFrames();
    assert.equal(back.style.display, "none");
    // panning far away shows it again after the settle
    pointerDown(f, f.root.querySelector(".pxd-viewport"), 400, 300, { button: 1, buttons: 4 });
    pointerMove(f, 400 - 30000, 300 - 30000, {});
    pointerUp(f, 400 - 30000, 300 - 30000, { button: 1 });
    await tick(140);
    f.stub.flushFrames();
    assert.equal(back.style.display, "");
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("back to content: hidden for an empty board", async () => {
  const f = mountFixture({ vp: { x: -50000, y: 0, zoom: 1 } });
  try {
    await f.flush();
    f.session.setBoard(buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [] }));
    f.session.emit("change", { structural: true });
    f.stub.flushFrames();
    await tick(10);
    assert.equal(f.root.querySelector(".pxd-backtocontent").style.display, "none");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ settings, state, export

test("UI-10: setSettings applies graph links, the palette, and the control rail on the same board", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    const root = f.root;
    const modes = [];
    f.session.setLinkMode = (mode) => { modes.push(mode); };
    f.view.setSettings({
      get: (k) => ({ "graph-links": "off", "show-palette": false, "controls-position": "bar", "show-version-badge": false })[k],
    });
    f.stub.flushFrames();
    assert.equal(f.root, root);
    assert.equal(f.root.isConnected, true);
    assert.deepEqual(modes, ["off"]);
    assert.equal(f.root.querySelector(".pxd-palette").style.display, "none");
    assert.equal(f.root.querySelector(".pxd-rail").style.display, "none");
    assert.equal(f.root.classList.contains("pxd-root--rail"), false);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("setSettings: swaps pattern, tone, map threshold, minimap and badge visibility without remounting", async () => {
  const f = mountFixture({ vp: { x: 0, y: 0, zoom: 0.5 } });
  try {
    await f.flush();
    const grid = f.root.querySelector(".pxd-grid");
    assert.ok(grid.classList.contains("pxd-grid--dots"));
    assert.equal(f.view.state().lod, "detail");
    const minimap = f.root.querySelector(".pxd-minimap");
    assert.equal(minimap.style.display, "");
    f.view.setSettings({ get: (k) => ({ grid: "lines", "board-tone": "teal", "map-zoom": "0.6", "show-minimap": false })[k] });
    f.stub.flushFrames();
    assert.ok(grid.classList.contains("pxd-grid--lines"));
    assert.ok(f.root.classList.contains("pxd-bg-teal"));
    assert.equal(f.view.state().lod, "map", "0.5 is below the new 0.6 threshold");
    assert.ok(f.root.classList.contains("pxd-lod-map"));
    assert.equal(minimap.style.display, "none");
    // a plain object is accepted too, and an unchanged minimap setting does not undo a manual toggle
    f.root.querySelector(".pxd-toolbar__minimap").click();
    assert.equal(minimap.style.display, "");
    f.view.setSettings({ grid: "plain", "show-minimap": false });
    assert.equal(minimap.style.display, "", "minimap setting did not change");
    assert.ok(grid.classList.contains("pxd-grid--plain"));
    assert.equal(f.root.classList.contains("pxd-bg-teal"), false);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("state(): zoom, tier, background, focus, present, selection, mounted count and menu flag", async () => {
  const f = mountFixture({ rootPlexus: { ":bg": "grid" } });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    f.view.controller.select(["cardAAAA1"]);
    const s = f.view.state();
    assert.deepEqual(Object.keys(s).sort(), ["focus", "lens", "lod", "menuOpen", "mounted", "pattern", "present", "selection", "tone", "zoom"]);
    assert.equal(s.lens, null);
    assert.equal(s.zoom, 1);
    assert.equal(s.lod, "detail");
    assert.equal(s.pattern, "grid");
    assert.equal(s.tone, null);
    assert.deepEqual([s.focus, s.present, s.menuOpen], [false, false, false]);
    assert.deepEqual(s.selection, ["cardAAAA1"]);
    assert.ok(s.mounted > 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("exportSvg and copyOutline: SVG text with an optional download link, Markdown outline to the clipboard", async () => {
  let clipboardText = null;
  const restoreNav = stubNavigator({ clipboard: { writeText: async (t) => { clipboardText = t; } } });
  const f = mountFixture();
  try {
    await f.flush();
    const anchors = [];
    const createElement = f.stub.document.createElement.bind(f.stub.document);
    f.stub.document.createElement = (tag) => {
      const node = createElement(tag);
      if (tag === "a") anchors.push(node);
      return node;
    };
    const plain = await f.view.exportSvg({ download: false });
    assert.match(plain, /^<svg/);
    assert.equal(anchors.length, 0);
    const text = await f.view.exportSvg({ download: true });
    assert.equal(text, plain);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].download, "Test.svg");
    assert.equal(anchors[0].parentElement, null, "the temporary link is removed again");
    const md = await f.view.copyOutline();
    assert.equal(clipboardText, md);
    assert.match(md, /- Alpha/);
    assert.match(md, /# Evidence/);
    assert.equal(toastText(f), "Outline copied");
    assert.equal(f.session.mutations.length, 0);
  } finally {
    restoreNav();
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ outline + panel wiring

test("panel: the Boards tab lists host boards, adds a board shortcut as a ((uid)) card, and the Outline tab lists sections", async () => {
  const f = mountFixture({ extra: secondSection(), hostOverrides: { listBoards: () => [{ uid: "boardTarget", title: "Inner", pageTitle: "Page", count: 3 }] } });
  try {
    await f.flush();
    f.root.querySelector(".pxd-toolbar__add").click();
    const tab = (name) => f.root.querySelectorAll(".pxd-panel__tab").find((b) => b.dataset.tab === name);
    tab("boards").click();
    await tick();
    const row = f.root.querySelector(".pxd-panel__board-row");
    assert.equal(row.dataset.uid, "boardTarget");
    f.stub.dispatch(row.querySelector(".pxd-panel__board-add"), "click", { button: 0 });
    assert.deepEqual(f.session.mutations.find((m) => m[0] === "addRefCards")[1].map((c) => c.string), ["((boardTarget))"]);
    tab("outline").click();
    const rows = f.root.querySelectorAll(".pxd-panel__outline-row");
    assert.deepEqual(rows.map((r) => r.dataset.uid), ["sectCCCC3", "sectGGGG7"]);
    assert.equal(rows[0].querySelector(".pxd-panel__outline-count").textContent, "1");
    f.stub.dispatch(rows[1], "click", { button: 0 });
    f.stub.flushFrames();
    assert.deepEqual(f.view.state().selection, ["sectGGGG7"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ dispose

test("dispose after using menu, Quick Look, focus, present and the panel leaves no nodes, listeners, timers or frames", async () => {
  const f = mountFixture({ extra: secondSection(), hostOverrides: { cardStats: () => new Map() } });
  try {
    await f.flush();
    await tick(80);
    rightClick(f, f.root.querySelector(".pxd-viewport"));
    assert.equal(f.view.state().menuOpen, true);
    key(f, "Escape");
    f.view.controller.select(["cardAAAA1"]);
    key(f, "q");
    key(f, "q");
    key(f, "f");
    f.root.querySelector(".pxd-toolbar__present").click();
    f.root.querySelector(".pxd-toolbar__bg").click();
    f.root.querySelector(".pxd-toolbar__add").click();
    rightClick(f, shell(f, "cardAAAA1"));
    f.stub.flushFrames();
    f.view.dispose();
    f.view.dispose();
    assert.equal(f.mountEl.children.length, 0);
    assert.equal(f.stub.pxdNodes().filter((n) => n !== f.mountEl).length, 0, "no .pxd-* nodes remain");
    assert.equal(f.stub.listenerCount(), 0, "no listeners remain");
    assert.equal(f.stub.observers.size, 0);
    assert.equal(f.stub.frames.length, 0);
    assert.equal(f.stub.idle.length, 0);
    assert.equal(f.view.stats().timers, 0);
    assert.equal(f.session.handlerCount(), 0);
  } finally {
    f.restore();
  }
});

// ------------------------------------------------------------------ review fixes

const wbCard = () => [{
  ":block/uid": "wbCard001",
  ":block/string": "((wbTarget1))",
  ":block/order": 9,
  ":block/props": { ":plexus": { ":x": 800, ":y": 0, ":w": 320, ":h": 220 } },
  ":block/children": [],
}];
const wbHost = {
  blockString: (uid) => (uid === "wbTarget1" ? "{{[[diagram]]:Whiteboard}}" : null),
  pullBoard: (uid) => (uid === "wbTarget1" ? { ":block/uid": "wbTarget1", ":block/string": "{{[[diagram]]:Whiteboard}}", ":block/children": [] } : null),
};

test("whiteboard shortcut: Open, double-click and Enter navigate to the referenced board and never start an editor", async () => {
  const opened = [];
  const rendered = [];
  const f = mountFixture({
    extra: wbCard(),
    hostOverrides: { ...wbHost, renderBlock: (el, uid) => rendered.push(uid) },
    viewOptions: { onOpenBoard: (uid) => opened.push(uid) },
  });
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const card = shell(f, "wbCard001");
    card.querySelector(".pxd-item__open").click();
    await tick(5);
    assert.deepEqual(opened, ["wbTarget1"], "the Open button navigates");
    f.stub.dispatch(card.querySelector(".pxd-item__header"), "dblclick", { clientX: 900, clientY: 20 });
    await tick(5);
    assert.deepEqual(opened, ["wbTarget1", "wbTarget1"], "double-click opens the target");
    f.view.controller.select(["wbCard001"]);
    f.view.controller.handle({ type: "keydown", key: "Enter" });
    await tick(5);
    assert.deepEqual(opened, ["wbTarget1", "wbTarget1", "wbTarget1"], "Enter opens the target");
    assert.deepEqual(rendered, [], "the referenced diagram block is never rendered inside the card");
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("Escape closes the Background popover first; the selection and the nesting level stay", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1"]);
    f.root.querySelector(".pxd-toolbar__bg").click();
    const pop = f.root.querySelector(".pxd-popover--bg");
    assert.notEqual(pop.style.display, "none", "popover open");
    const ev = key(f, "Escape");
    assert.equal(pop.style.display, "none", "Escape closed the popover");
    assert.equal(ev.defaultPrevented, true);
    assert.deepEqual(f.view.controller.getSelection().items, ["cardAAAA1"], "the selection was not cleared by the same key");
    key(f, "Escape");
    assert.deepEqual(f.view.controller.getSelection().items, [], "the next Escape runs the normal chain");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("context menu: a ref inside a static card keeps Roam's menu; a prevented event and a plain card body behave", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    await tick(5);
    f.stub.flushIdle();
    const alpha = shell(f, "cardAAAA1");
    const body = alpha.querySelector(".pxd-item__body");
    const ref = f.stub.document.createElement("span");
    ref.className = "rm-block-ref";
    body.append(ref);
    const ev = rightClick(f, ref);
    assert.equal(ev.defaultPrevented, false, "the browser / Roam menu is not suppressed");
    assert.equal(f.view.state().menuOpen, false, "no Plexus menu on top of Roam's");
    const plain = rightClick(f, body);
    assert.equal(plain.defaultPrevented, true, "a right-click on the card text still opens the Plexus menu");
    assert.equal(f.view.state().menuOpen, true);
    key(f, "Escape");
    const claimed = f.stub.dispatch(alpha.querySelector(".pxd-item__header"), "contextmenu", { button: 2, clientX: 10, clientY: 10, defaultPrevented: true });
    assert.equal(f.view.state().menuOpen, false, `an event Roam already handled is left alone (${claimed.defaultPrevented})`);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("Tab is left to Roam and the browser unless focus is on the board itself", async () => {
  const f = mountFixture({ viewOptions: { autofocus: false } });
  try {
    await f.flush();
    f.stub.dispatch(f.root, "pointerenter");
    const away = key(f, "Tab");
    assert.equal(away.defaultPrevented, false, "a resting pointer does not trap Tab");
    assert.deepEqual(f.view.controller.getSelection().items, []);
    f.root.focus();
    const onBoard = key(f, "Tab");
    assert.equal(onBoard.defaultPrevented, true, "with the board focused Tab walks the outline");
    assert.equal(f.view.controller.getSelection().items.length, 1);
    f.root.querySelector(".pxd-toolbar__bg").focus();
    f.view.controller.select([]);
    const onChrome = key(f, "Tab");
    assert.equal(onChrome.defaultPrevented, false, "a toolbar control keeps its own Tab order");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("UI-7: tab reaches the rail, the panel, a card, its toolbar, and the menu", async () => {
  const f = mountFixture({ viewOptions: { autofocus: false } });
  try {
    await f.flush();
    assert.equal(f.root.getAttribute("role"), "region");
    assert.equal(f.root.getAttribute("aria-roledescription"), "whiteboard");
    assert.equal(f.root.tabIndex, 0);
    const alpha = shell(f, "cardAAAA1");
    const section = shell(f, "sectCCCC3");
    assert.equal(alpha.getAttribute("role"), "group");
    assert.equal(alpha.getAttribute("aria-label"), "Alpha, card");
    assert.equal(section.getAttribute("aria-label"), "Evidence, section");
    assert.equal(alpha.tabIndex, -1);
    f.root.focus();
    const onBoard = key(f, "Tab");
    f.stub.flushFrames();
    assert.equal(onBoard.defaultPrevented, true, "Tab on the board still walks the outline");
    const stops = [...f.root.querySelectorAll(".pxd-item, .pxd-section")].filter((node) => node.tabIndex === 0);
    assert.equal(stops.length, 1, "only the selected card is a tab stop");
    const card = stops[0];
    card.focus();
    const onCard = key(f, "Tab");
    assert.equal(onCard.defaultPrevented, false, "Tab on a card moves to the next control");
    const rail = f.root.querySelector(".pxd-rail__zoom-in");
    rail.focus();
    assert.equal(key(f, "Tab").defaultPrevented, false, "Tab on the rail stays with the browser");
    f.root.querySelector(".pxd-toolbar__add").focus();
    const onAdd = key(f, "Enter");
    assert.equal(onAdd.defaultPrevented, true, "Enter activates the Add button");
    assert.equal(f.root.querySelector(".pxd-item--editing, .pxd-section__title--editing"), null);
    await f.flush();
    const panelTab = f.root.querySelector(".pxd-panel__tab");
    assert.equal(f.root.querySelector(".pxd-panel").style.display, "");
    panelTab.focus();
    assert.equal(key(f, "Tab").defaultPrevented, false, "Tab on the panel stays with the browser");
    const ctx = f.root.querySelector(".pxd-ctx");
    assert.notEqual(ctx.style.display, "none", "the card toolbar is open");
    const ctxButtons = [...ctx.querySelectorAll("button")];
    assert.ok(ctxButtons.length > 0, "the card toolbar has actions");
    assert.ok(ctxButtons.every((button) => button.getAttribute("aria-label")), "the card toolbar names every button");
    const unlabeled = [...f.root.querySelectorAll("button, input, select, textarea")].filter((node) => !node.getAttribute("aria-label"));
    assert.deepEqual(unlabeled.map((node) => node.className), []);
    card.focus();
    const opened = key(f, "F10", { shiftKey: true });
    assert.equal(opened.defaultPrevented, true);
    assert.equal(f.view.state().menuOpen, true);
    const first = f.stub.document.activeElement;
    assert.equal(first.classList.contains("pxd-menu__item"), true);
    assert.ok(first.getAttribute("aria-label"));
    key(f, "Tab");
    const second = f.stub.document.activeElement;
    assert.equal(second.classList.contains("pxd-menu__item"), true);
    assert.notEqual(second, first);
    assert.equal(f.view.state().menuOpen, true);
    const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
    assert.match(css, /\.pxd-root button:focus-visible/);
    assert.match(css, /\.pxd-item:focus-visible/);
    assert.match(css, /\.pxd-menu__item:focus-visible/);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("UI-9: the version badge shows the bundled changelog entry", async () => {
  const f = mountFixture({ viewOptions: { autofocus: false, version: "1.3.0" } });
  try {
    await f.flush();
    const badge = f.root.querySelector(".pxd-rail__badge");
    assert.equal(badge.textContent, "v1.3.0");
    badge.click();
    const pop = f.root.querySelector(".pxd-changelog");
    assert.equal(pop.getAttribute("role"), "dialog");
    assert.match(pop.textContent, /Native parity on an enhanced board/);
    assert.equal(pop.textContent.includes("## 1.2.0"), false);
    assert.equal(pop.textContent.includes("0.6.4"), false);
    key(f, "Escape");
    assert.equal(f.root.querySelector(".pxd-changelog"), null);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("UI-8: ? opens the shortcut sheet from the one shortcut table", async () => {
  const f = mountFixture({ settings: { "task-tool": true }, viewOptions: { autofocus: false } });
  try {
    await f.flush();
    f.root.focus();
    const opened = key(f, "?", { shiftKey: true, code: "Slash" });
    assert.equal(opened.defaultPrevented, true);
    const sheet = f.root.querySelector(".pxd-sheet");
    assert.ok(sheet);
    assert.equal(sheet.getAttribute("role"), "dialog");
    assert.equal(sheet.getAttribute("aria-label"), "Shortcuts");
    const text = sheet.textContent;
    for (const row of SHORTCUTS) assert.ok(text.includes(row.keys), row.keys);
    for (const row of SHORTCUTS) assert.ok(text.includes(row.label), row.label);
    const tool = f.root.querySelector(".pxd-palette__btn--on")?.getAttribute("aria-label");
    key(f, "v");
    assert.equal(f.root.querySelector(".pxd-palette__btn--on")?.getAttribute("aria-label"), tool, "keys behind the sheet do not run");
    assert.ok(f.root.querySelector(".pxd-sheet"));
    key(f, "Escape");
    assert.equal(f.root.querySelector(".pxd-sheet"), null);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("badges: stats queries run in idle chunks and a failing query is retried, not cached", async () => {
  const calls = [];
  let fail = true;
  const many = Array.from({ length: 30 }, (_, i) => ({
    ":block/uid": `bulkCard${String(i).padStart(2, "0")}`,
    ":block/string": `Bulk ${i}`,
    ":block/order": 20 + i,
    ":block/props": { ":plexus": { ":x": 2000 + (i % 6) * 40, ":y": Math.floor(i / 6) * 30, ":w": 30, ":h": 20 } },
    ":block/children": [],
  }));
  const f = mountFixture({
    extra: many,
    hostOverrides: { cardStats: (targets) => { calls.push(targets.length); if (fail) throw new Error("scan failed"); return new Map(); } },
    vp: { x: -1900, y: 0, zoom: 1 },
  });
  try {
    await f.flush();
    await tick(80);
    f.stub.flushIdle();
    assert.equal(calls.length >= 1, true, "the first chunk ran");
    assert.ok(calls.every((n) => n <= 12), `no query covers more than one chunk (${calls.join(",")})`);
    fail = false;
    const before = calls.length;
    f.stub.dispatch(f.root.querySelector(".pxd-viewport"), "wheel", { deltaX: 0, deltaY: 1, clientX: 300, clientY: 300 });
    f.stub.flushFrames();
    await tick(140);
    for (let i = 0; i < 5; i += 1) { f.stub.flushIdle(); await tick(); }
    assert.ok(calls.length > before, "a failed chunk is asked for again on the next settle");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("editing a card near a section edge grows the section live (preview only) and snaps back when the edit ends", async () => {
  const f = mountFixture({ hostOverrides: { renderBlock(el) { const t = globalThis.document.createElement("textarea"); t.className = "rm-block__input"; el.append(t); } } });
  try {
    await f.flush();
    const inside = shell(f, "cardDDDD4");
    const section = shell(f, "sectCCCC3");
    f.stub.dispatch(inside, "dblclick", { clientX: 60, clientY: 380 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
    assert.ok(inside.classList.contains("pxd-item--editing"));
    const ro = [...f.stub.observers].filter((o) => o.active && o.cb);
    assert.ok(ro.length, "the editor is observed for height changes");
    inside._offsetHeight = 400;
    Object.defineProperty(inside, "offsetHeight", { configurable: true, get: () => 400 });
    for (const o of ro) o.cb([]);
    assert.ok(parseFloat(section.style.height) > 300, `the section shell grew around the taller card (${section.style.height})`);
    assert.equal(f.session.mutations.filter((m) => m[0] !== "growToFit").length, 0, "nothing but the exit commit is written");
    f.view.controller.handle({ type: "keydown", key: "Escape", inputFocused: true });
    for (let i = 0; i < 3; i += 1) { f.stub.flushFrames(); await tick(); }
    assert.equal(section.style.height, "300px", "the preview is reset when the edit ends");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ------------------------------------------------------------------ stale root rect (wheel zoom pivot, paste point)

const worldTransform = (f) => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(f.root.querySelector(".pxd-world").style.transform);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
};

test("ctrl-wheel pivots about the cursor after the Roam page scrolled (root rect re-measured, not cached)", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    // the outer page scrolled: the board now sits 451px higher than when it was measured
    f.root._rect = { left: 0, top: -451, width: 800, height: 600, right: 800, bottom: 149, x: 0, y: -451 };
    const before = { x: 300, y: 200 };
    f.stub.dispatch(f.root.querySelector(".pxd-viewport"), "wheel", { ctrlKey: true, deltaY: -30, clientX: before.x, clientY: before.y });
    f.stub.flushFrames();
    const vp = worldTransform(f);
    const screen = { x: before.x, y: before.y + 451 }; // root-space cursor
    const world = { x: screen.x, y: screen.y }; // identity viewport before the wheel
    assert.ok(vp.zoom > 1, "zoomed in");
    near(vp.x + world.x * vp.zoom, screen.x, 0.01);
    near(vp.y + world.y * vp.zoom, screen.y, 0.01);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("paste lands at the cursor after the Roam page scrolled without a pointer event on the board", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.stub.dispatch(f.root, "pointerenter");
    f.stub.dispatch(f.root, "pointermove", { clientX: 300, clientY: 220 });
    f.root._rect = { left: 0, top: -115, width: 800, height: 600, right: 800, bottom: 485, x: 0, y: -115 };
    f.stub.dispatch(f.stub.document, "paste", { clipboardData: clipboardData({ "text/plain": "x" }) });
    await tick();
    assert.deepEqual(f.session.mutations[0], ["pasteText", [{ string: "x" }], { x: 300, y: 335 }]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a session change for the card being edited (autosave echo) does not snap the grown section preview back", async () => {
  const f = mountFixture({ hostOverrides: { renderBlock(el) { const t = globalThis.document.createElement("textarea"); t.className = "rm-block__input"; el.append(t); } } });
  try {
    await f.flush();
    const inside = shell(f, "cardDDDD4");
    const section = shell(f, "sectCCCC3");
    f.stub.dispatch(inside, "dblclick", { clientX: 60, clientY: 380 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    await tick(300);
    f.stub.flushFrames();
    const ro = [...f.stub.observers].filter((o) => o.active && o.cb);
    Object.defineProperty(inside, "offsetHeight", { configurable: true, get: () => 400 });
    for (const o of ro) o.cb([]);
    const grownHeight = parseFloat(section.style.height);
    assert.ok(grownHeight > 300);
    f.session.emit("change", { dirty: new Set(["cardDDDD4"]), structural: false });
    f.stub.flushFrames();
    assert.equal(parseFloat(section.style.height), grownHeight, "the section keeps its live-fit height while the edit is open");
    f.view.controller.handle({ type: "keydown", key: "Escape", inputFocused: true });
    for (let i = 0; i < 3; i += 1) { f.stub.flushFrames(); await tick(); }
    assert.equal(section.style.height, "300px");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("isLightHost: a measurably light host opts out of the OS color-scheme rules; dark markers and unmeasurable hosts do not", () => {
  const node = (bg, parent = null, classes = []) => ({ bg, parentElement: parent, classList: { contains: (c) => classes.includes(c) } });
  const win = { getComputedStyle: (n) => ({ backgroundColor: n.bg }) };
  const doc = { body: null, documentElement: null };
  // Roam paints only <body>: the wrappers are transparent, the first opaque ancestor decides
  const bodyLight = node("rgb(255, 255, 255)");
  const wrapper = node("rgba(0, 0, 0, 0)", bodyLight);
  assert.equal(isLightHost(node("rgba(0, 0, 0, 0)", wrapper), doc, win), true);
  assert.equal(isLightHost(node("rgba(0, 0, 0, 0)", node("rgb(30, 42, 53)")), doc, win), false, "a dark host is not light");
  assert.equal(isLightHost(node("rgba(0, 0, 0, 0)", node("rgb(255, 255, 255)", null, ["bp3-dark"])), doc, win), false, "a dark marker wins over the measured color");
  assert.equal(isLightHost(node("rgba(0, 0, 0, 0)", node("color(srgb 1 1 1)")), doc, win), false, "unparseable colors assert nothing");
  assert.equal(isLightHost(node("rgb(255, 255, 255)"), doc, {}), false, "no getComputedStyle asserts nothing");
});

test("CSS contract: every prefers-color-scheme dark rule skips a confirmed-light host", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../src/css/", import.meta.url);
  const files = [new URL("../src/extension.css", import.meta.url), ...readdirSync(dir).filter((n) => n.endsWith(".css")).map((n) => new URL(n, dir))];
  let seen = 0;
  for (const file of files) {
    const css = readFileSync(file, "utf8");
    for (const m of css.matchAll(/:root:not\(\.bp3-light\) \.pxd-root([^\s{,]*)/g)) {
      seen += 1;
      assert.match(m[1], /:not\(\.pxd-root--light\)$/, `${file.pathname}: ${m[0]}`);
    }
  }
  assert.ok(seen > 15);
});

test("the context bar clears the toolbar and an open panel; Fit keeps content below the toolbar and left of the panel", async () => {
  const f = mountFixture({ vp: { x: 0, y: 60, zoom: 1 } });
  try {
    await f.flush();
    const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    f.root.querySelector(".pxd-toolbar")._rect = rect(0, 0, 800, 76);
    f.view.controller.select(["cardAAAA1"]);
    f.stub.flushFrames();
    const ctx = f.root.querySelector(".pxd-ctx");
    assert.ok(parseFloat(ctx.style.top) >= 76, `ctx top ${ctx.style.top} is below the toolbar (it would have sat above the card, over the toolbar)`);
    // Fit: the content top edge leaves the toolbar strip clear
    f.stub.dispatch(f.root.querySelector(".pxd-toolbar__fit"), "click");
    f.stub.flushFrames();
    const t = worldTransform(f);
    const top = t.y + Math.min(...[...f.session.rects.values()].map((r) => r.y)) * t.zoom;
    assert.ok(top >= 76, `content top ${top} is below the toolbar bottom (76)`);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("the context bar never sits over the toolbar when its card is panned under it, and wraps to stay left of an open panel", async () => {
  const f = mountFixture({ vp: { x: 0, y: 0, zoom: 1 } });
  try {
    await f.flush();
    const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    f.root.querySelector(".pxd-toolbar")._rect = rect(0, 54, 800, 68);
    f.view.controller.select(["cardAAAA1"]); // world 0,0 200x100: its bottom edge is under the toolbar
    f.stub.flushFrames();
    const ctx = f.root.querySelector(".pxd-ctx");
    assert.ok(parseFloat(ctx.style.top) >= 122, `ctx top ${ctx.style.top} clears the toolbar bottom (122) with the card under it`);
    // an open panel: the bar is limited to the space left of it, so it wraps instead of floating over the panel
    f.stub.dispatch(f.root.querySelector(".pxd-toolbar__add"), "click");
    f.stub.flushFrames();
    const panel = f.root.querySelector(".pxd-panel");
    assert.notEqual(panel.style.display, "none", "the panel is open");
    panel._rect = rect(500, 0, 300, 400);
    Object.defineProperty(ctx, "offsetWidth", { configurable: true, get: () => Math.min(660, parseFloat(ctx.style.maxWidth) || 660) });
    f.view.controller.select(["cardBBBB2"]);
    f.stub.flushFrames();
    assert.equal(ctx.style.maxWidth, "484px", "max width = space left of the panel minus both margins");
    assert.ok(parseFloat(ctx.style.left) + ctx.offsetWidth <= 500, "the bar ends left of the panel");
    panel._rect = null;
    f.view.controller.select(["cardAAAA1"]);
    f.stub.flushFrames();
    assert.equal(ctx.style.maxWidth, "", "no panel: the stylesheet's own max width applies");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("mind map: hitting the node cap is said out loud, not silent", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.session.expandOutline = () => Promise.resolve({ added: 24, edges: 24, skipped: 21, total: 45 });
    f.view.controller.select(["cardBBBB2"]);
    key(f, "m");
    await tick();
    assert.equal(toastText(f), "Mind map: 24 of 45 branches (cap)");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("duplicate toast names what was duplicated: a section is not 'a card'", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.session.duplicateItems = () => Promise.resolve(["sectCCCC3"]);
    f.view.controller.select(["sectCCCC3"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "d", metaKey: true });
    await tick();
    assert.equal(toastText(f), "Duplicated 1 section");
    f.session.duplicateItems = () => Promise.resolve(["cardAAAA1", "sectCCCC3"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "d", metaKey: true });
    await tick();
    assert.equal(toastText(f), "Duplicated 2 items");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a typed edit outside the board invalidates the host's grouped undo log; typing inside the board does not", async () => {
  let calls = 0;
  const f = mountFixture({ hostOverrides: { invalidateUndo: () => { calls += 1; } } });
  try {
    await f.flush();
    const outside = f.stub.document.createElement("textarea");
    f.stub.document.body.append(outside);
    f.stub.dispatch(outside, "input");
    assert.equal(calls, 1);
    const inside = f.stub.document.createElement("textarea");
    f.root.append(inside);
    f.stub.dispatch(inside, "input");
    assert.equal(calls, 1);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("the dark/light class follows the host live: a dark marker added or removed after mount flips the board", async () => {
  const f = mountFixture();
  try {
    const poke = () => { for (const o of [...f.stub.observers].filter((x) => x.active && x.cb)) o.cb([]); };
    assert.equal(f.root.classList.contains("pxd-root--dark"), false);
    f.stub.document.documentElement.classList.add("bp3-dark");
    poke();
    assert.equal(f.root.classList.contains("pxd-root--dark"), true, "host went dark after mount");
    f.stub.document.documentElement.classList.remove("bp3-dark");
    poke();
    assert.equal(f.root.classList.contains("pxd-root--dark"), false, "host went light again (Roam auto theme): the dark class is dropped");
    f.stub.document.body.classList.add("bt-theme-dark");
    poke();
    assert.equal(f.root.classList.contains("pxd-root--dark"), true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("HB-3: Cmd+F finds three hits, cycles them, and does nothing when the board is not focused", async () => {
  const nested = {
    ":block/uid": "nestCARD9",
    ":block/string": "{{[[diagram]]:Inner}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      blockish("deepCARD1", "nested pebble", 0),
    ],
  };
  const f = mountFixture({
    extra: [{
      ":block/uid": "nestCARD9",
      ":block/string": "{{[[diagram]]:Inner}}",
      ":block/order": 8,
      ":block/props": { ":plexus": { ":v": 2, ":x": 800, ":y": 0, ":w": 220, ":h": 120 } },
      ":block/children": [],
    }],
    hostOverrides: { pullBoard: (uid) => (uid === "nestCARD9" ? nested : null) },
  });
  try {
    await f.flush();
    const search = f.root.querySelector(".pxd-search");
    assert.equal(search.style.display, "none");
    f.root.blur();
    f.stub.dispatch(f.root, "pointerleave", {});
    key(f, "f", { metaKey: true });
    assert.equal(search.style.display, "none", "Cmd+F outside the board stays with Roam");
    f.root.focus();
    key(f, "f", { metaKey: true });
    assert.equal(search.style.display, "");
    const input = f.root.querySelector(".pxd-search__input");
    input.value = "e";
    f.stub.dispatch(input, "input", {});
    const n = Number(f.root.querySelector(".pxd-search__count").textContent);
    assert.ok(n >= 3, `expected at least 3 hits, got ${n}`);
    assert.equal(shell(f, "cardAAAA1").classList.contains("pxd-item--hit"), true);
    assert.equal(shell(f, "cardBBBB2").classList.contains("pxd-item--dim"), false);
    f.stub.dispatch(input, "keydown", { key: "Enter" });
    const first = f.view.state().selection[0];
    f.stub.dispatch(input, "keydown", { key: "Enter" });
    const second = f.view.state().selection[0];
    assert.notEqual(second, first);
    f.stub.dispatch(input, "keydown", { key: "Enter", shiftKey: true });
    assert.equal(f.view.state().selection[0], first);
    assert.match(f.root.querySelector(".pxd-search__count").textContent, /^\d+\/\d+$/);
    input.value = "pebble";
    f.stub.dispatch(input, "input", {});
    assert.equal(f.root.querySelector(".pxd-search__count").textContent, "1");
    assert.equal(shell(f, "nestCARD9").classList.contains("pxd-item--hit"), true);
    assert.equal(shell(f, "cardAAAA1").classList.contains("pxd-item--dim"), true);
    assert.equal(f.root.querySelector("[data-uid=edgeFFFF6]").classList.contains("pxd-edge--dim"), true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("HB-9: zoom keys move the focused board and stay quiet while a card is being typed", async () => {
  const f = mountFixture({ hostOverrides: { renderBlock(el) { const t = globalThis.document.createElement("textarea"); t.className = "rm-block__input"; el.append(t); } } });
  const center = { x: 400, y: 300 };
  const same = (a, b) => { near(a.x, b.x, 1e-6); near(a.y, b.y, 1e-6); near(a.zoom, b.zoom, 1e-6); };
  const read = () => { f.stub.flushFrames(); return worldTransform(f); };
  const tool = () => f.root.querySelector(".pxd-tool--active")?.dataset?.tool;
  const press = (k, extra) => { key(f, k, extra); return read(); };
  try {
    await f.flush();
    f.root.focus();
    const writes = () => f.session.mutations.length;
    const before = writes();
    let vp = read();
    vp = press("=", { code: "Equal", metaKey: true });
    same(vp, zoomAt({ x: 0, y: 0, zoom: 1 }, center, 1.2));
    vp = press("-", { code: "Minus", metaKey: true });
    same(vp, zoomAt(zoomAt({ x: 0, y: 0, zoom: 1 }, center, 1.2), center, 1 / 1.2));
    press("=", { code: "Equal", metaKey: true });
    vp = press(")", { code: "Digit0", shiftKey: true });
    same(vp, zoomAt(zoomAt({ x: 0, y: 0, zoom: 1 }, center, 1.2), center, 1 / 1.2));
    vp = press("!", { code: "Digit1", shiftKey: true });
    same(vp, fitViewport(boundsOf([...f.session.rects.values()]), { width: 800, height: 600 }, { padding: 64, maxZoom: 1.5, insets: { top: 0, right: 0 } }));
    pointerDown(f, shell(f, "cardAAAA1"), 20, 20);
    pointerUp(f, 20, 20);
    assert.deepEqual(f.view.state().selection, ["cardAAAA1"]);
    vp = press("@", { code: "Digit2", shiftKey: true });
    const card = f.session.rects.get("cardAAAA1");
    same(vp, fitViewport(boundsOf([card]), { width: 800, height: 600 }, { padding: 64, maxZoom: 1, insets: { top: 0, right: 0 } }));
    key(f, "Escape");
    f.stub.flushFrames();
    const parked = read();
    press("@", { code: "Digit2", shiftKey: true });
    same(read(), parked);
    press("h", { code: "KeyH" });
    assert.equal(tool(), "hand");
    press("v", { code: "KeyV" });
    assert.equal(tool(), "select");
    const panFrom = read();
    key(f, " ", { code: "Space" });
    assert.equal(f.root.classList.contains("pxd-root--space"), true);
    pointerDown(f, f.root.querySelector(".pxd-viewport"), 600, 150);
    pointerMove(f, 640, 200);
    pointerUp(f, 640, 200);
    f.stub.dispatch(f.stub.window, "keyup", { key: " ", code: "Space" });
    same(read(), { x: panFrom.x + 40, y: panFrom.y + 50, zoom: panFrom.zoom });
    assert.equal(f.root.classList.contains("pxd-root--space"), false);
    assert.equal(writes(), before, "zoom, fit, and pan write nothing");

    const cardEl = shell(f, "cardAAAA1");
    f.stub.dispatch(cardEl, "dblclick", { clientX: 40, clientY: 40 });
    for (let i = 0; i < 4; i += 1) { f.stub.flushFrames(); await tick(); }
    assert.ok(cardEl.classList.contains("pxd-item--editing"));
    const ta = cardEl.querySelector("textarea");
    ta.focus();
    const quiet = read();
    const quietWrites = writes();
    for (const spec of [
      ["=", { code: "Equal", metaKey: true }],
      ["-", { code: "Minus", metaKey: true }],
      [")", { code: "Digit0", shiftKey: true }],
      ["!", { code: "Digit1", shiftKey: true }],
      ["@", { code: "Digit2", shiftKey: true }],
      ["h", { code: "KeyH" }],
      ["v", { code: "KeyV" }],
      [" ", { code: "Space" }],
    ]) f.stub.dispatch(ta, "keydown", { key: spec[0], ...spec[1] });
    f.stub.flushFrames();
    same(read(), quiet);
    assert.equal(tool(), "select");
    assert.equal(f.root.classList.contains("pxd-root--space"), false);
    pointerDown(f, f.root.querySelector(".pxd-viewport"), 600, 150);
    pointerMove(f, 680, 220);
    pointerUp(f, 680, 220);
    same(read(), quiet);
    assert.equal(writes(), quietWrites, "the same keys while typing do not zoom, pan, or write");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("HB-10: lasso, select all in section, same color, and connected each change the selection and write nothing", async () => {
  const item = (uid, string, plexus, order, children = []) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": plexus },
    ":block/children": children,
  });
  const extra = [
    item("sectNEST01", "Nest", { ":type": "section", ":x": 900, ":y": 0, ":w": 400, ":h": 320 }, 8, [
      item("cardDIRECT", "Direct", { ":x": 20, ":y": 40, ":w": 120, ":h": 60 }, 0),
      item("sectINNER1", "Inner", { ":type": "section", ":x": 20, ":y": 140, ":w": 200, ":h": 140 }, 1, [
        item("cardDEEP01", "Deep", { ":x": 10, ":y": 30, ":w": 80, ":h": 40 }, 0),
      ]),
    ]),
    item("cardRED001", "Red one", { ":x": 0, ":y": 800, ":w": 100, ":h": 60, ":color": "red" }, 9),
    item("cardRED002", "Red two", { ":x": 160, ":y": 800, ":w": 100, ":h": 60, ":color": "red" }, 10),
  ];
  const f = mountFixture({ extra });
  const sorted = () => [...f.view.state().selection].sort();
  try {
    await f.flush();
    const before = f.session.mutations.length;
    f.view.controller.select(["sectNEST01"]);
    await f.flush();
    f.root.querySelector(".pxd-ctx__all-in-section").click();
    await f.flush();
    assert.deepEqual(sorted(), ["cardDEEP01", "cardDIRECT", "sectINNER1"]);
    f.view.controller.select(["sectNEST01"]);
    await f.flush();
    f.root.querySelector(".pxd-ctx__contents").click();
    await f.flush();
    assert.deepEqual(sorted(), ["cardDIRECT", "sectINNER1"], "Select contents stays the direct members");

    const title = shell(f, "sectNEST01").querySelector(".pxd-section__title");
    rightClick(f, title);
    assert.ok(menuIds(f).includes("select-all-in-section"));
    pickRow(f, "select-all-in-section");
    await f.flush();
    assert.deepEqual(sorted(), ["cardDEEP01", "cardDIRECT", "sectINNER1"]);

    rightClick(f, shell(f, "cardRED001"));
    pickRow(f, "select-same-color");
    await f.flush();
    assert.deepEqual(sorted(), ["cardRED001", "cardRED002"]);
    rightClick(f, shell(f, "cardAAAA1"));
    pickRow(f, "select-connected");
    await f.flush();
    assert.deepEqual(sorted(), ["cardAAAA1", "cardBBBB2"]);

    const viewport = f.root.querySelector(".pxd-viewport");
    pointerDown(f, viewport, -30, 50, { altKey: true });
    pointerMove(f, 230, -30, { altKey: true });
    assert.ok(f.root.querySelector(".pxd-lasso"), "the free shape is drawn while dragging");
    pointerMove(f, 100, 120, { altKey: true });
    pointerUp(f, 100, 120, { altKey: true });
    await f.flush();
    assert.equal(f.root.querySelector(".pxd-lasso"), null);
    assert.deepEqual(sorted(), ["cardAAAA1"]);
    assert.equal(f.session.mutations.length, before, "lasso and the selection commands write nothing");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("RG-1: a query card mounts renderBlock and Add results places those blocks", async () => {
  const rendered = [];
  const query = "{{[[query]]: {and: [[HACCP]]}}}";
  const f = mountFixture({
    extra: [{
      ":block/uid": "queryCCC3",
      ":block/string": query,
      ":block/order": 6,
      ":block/props": { ":plexus": { ":x": 520, ":y": 0, ":w": 280, ":h": 160 } },
      ":block/children": [],
    }],
    hostOverrides: {
      renderBlock(el, uid) {
        rendered.push(uid);
        const doc = el.ownerDocument || globalThis.document;
        const stamp = (id) => {
          const node = doc.createElement("div");
          node.setAttribute("id", id);
          el.append(node);
        };
        stamp("block-input-db-body-outline-pageUID01-queryCCC3");
        stamp("block-input-db-body-outline-pageUID01-resultAA1");
        stamp("block-input-db-body-outline-pageUID01-resultBB2");
      },
    },
  });
  try {
    await f.flush();
    const card = shell(f, "queryCCC3");
    assert.equal(card.querySelector(".pxd-item__query") != null, true);
    assert.equal(rendered.includes("queryCCC3"), true);
    assert.equal(card.textContent.includes("[[query]]"), false);
    rightClick(f, card);
    assert.ok(menuIds(f).includes("query-results"));
    pickRow(f, "query-results");
    await tick();
    const call = f.session.mutations.find((row) => row[0] === "addRefCards");
    assert.ok(call, "addRefCards ran");
    assert.deepEqual(call[1], queryResultLayout({ x: 520, y: 0, w: 280, h: 160 }, ["resultAA1", "resultBB2"]));
    assert.match(toastText(f), /Added 2 cards from the query/);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("RG-2: a page card drawer drags one mention out and the source string stays", async () => {
  const source = "original mention";
  const strings = new Map([["srcBlock1", source]]);
  const rendered = [];
  const unmounted = [];
  const f = mountFixture({
    extra: [{
      ":block/uid": "pageGAM01",
      ":block/string": "[[Gamma]]",
      ":block/order": 6,
      ":block/props": { ":plexus": { ":x": 520, ":y": 0, ":w": 200, ":h": 140 } },
      ":block/children": [],
    }],
    hostOverrides: {
      linkedRefs(item) {
        if (item.title === "Beta") return [{ uid: "srcBlock1", string: strings.get("srcBlock1") }];
        return [];
      },
      blockString(uid) { return strings.has(uid) ? strings.get(uid) : null; },
      renderBlock(el, uid) {
        rendered.push(uid);
        const doc = el.ownerDocument || globalThis.document;
        const node = doc.createElement("div");
        node.setAttribute("id", `mention-${uid}`);
        node.textContent = strings.get(uid) || "";
        el.append(node);
      },
      unmount(el) { unmounted.push(el); },
    },
  });
  const transfer = () => {
    const data = {};
    return {
      effectAllowed: "uninitialized",
      dropEffect: "none",
      getData: (type) => data[type] || "",
      setData: (type, value) => { data[type] = String(value); },
    };
  };
  try {
    await f.flush();
    assert.equal(shell(f, "cardAAAA1").querySelector(".pxd-refs"), null);
    const gamma = shell(f, "pageGAM01").querySelector(".pxd-refs__toggle");
    assert.equal(gamma.textContent, linkedRefLabel(0));
    const page = shell(f, "cardBBBB2");
    const toggle = page.querySelector(".pxd-refs__toggle");
    assert.equal(toggle.textContent, linkedRefLabel(1));
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(rendered.includes("srcBlock1"), false);
    f.stub.dispatch(toggle, "click");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(page.querySelector(".pxd-refs").classList.contains("pxd-refs--open"), true);
    assert.equal(rendered.includes("srcBlock1"), true);
    const row = page.querySelector(".pxd-refs__row");
    const live = row.querySelector(".pxd-rs__live");
    const dt = transfer();
    const drag = f.stub.dispatch(live, "dragstart", { dataTransfer: dt });
    assert.equal(drag.defaultPrevented, false);
    assert.equal(dt.getData(CARD_MIME), linkedRefCard("srcBlock1"));
    assert.equal(dt.getData("text/plain"), linkedRefCard("srcBlock1"));
    assert.equal(dt.effectAllowed, "copy");
    const down = f.stub.dispatch(live, "pointerdown", { button: 0, clientX: 12, clientY: 12, pointerId: 7 });
    assert.equal(down.defaultPrevented, false);
    pointerMove(f, 80, 80);
    pointerUp(f, 80, 80);
    assert.equal(f.session.mutations.some((row) => row[0] === "commitMove"), false);
    const noteDrag = f.stub.dispatch(shell(f, "cardAAAA1").querySelector(".pxd-item__body"), "dragstart", { dataTransfer: transfer() });
    assert.equal(noteDrag.defaultPrevented, true);
    f.stub.dispatch(f.root, "drop", { dataTransfer: dt, clientX: 40, clientY: 40 });
    await tick();
    const call = f.session.mutations.find((row) => row[0] === "addRefCards");
    assert.ok(call, "addRefCards ran");
    assert.equal(call[1][0].string, linkedRefCard("srcBlock1"));
    assert.equal(typeof call[1][0].x, "number");
    assert.equal(typeof call[1][0].y, "number");
    assert.equal(f.session.mutations.some((row) => row[0] === "setString"), false);
    assert.equal(f.host.blockString("srcBlock1"), source);
    assert.equal(strings.get("srcBlock1"), source);
    f.view.dispose();
    assert.ok(unmounted.includes(live));
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("RG-5: a due chip and overdue border stay read-only when the TODO flips", async () => {
  const due = "BT_attrDue:: [[January 1st, 2020]]";
  const f = mountFixture({
    settings: { "better-tasks": true },
    extra: [{
      ":block/uid": "todoRG501",
      ":block/string": "{{[[TODO]]}} ship rg5",
      ":block/order": 6,
      ":block/props": { ":plexus": { ":x": 520, ":y": 0, ":w": 280, ":h": 160 } },
      ":block/children": [{
        ":block/uid": "dueRG5011",
        ":block/string": due,
        ":block/order": 0,
        ":block/props": {},
        ":block/children": [],
      }],
    }],
    hostOverrides: {
      renderString(el, string) {
        el.textContent = string;
        if (!String(string).includes("{{[[TODO]]}}")) return;
        const doc = el.ownerDocument || globalThis.document;
        const label = doc.createElement("label");
        label.className = "check-container";
        const input = doc.createElement("input");
        input.setAttribute("type", "checkbox");
        label.append(input);
        el.append(label);
      },
    },
  });
  try {
    await f.flush();
    const card = f.root.querySelector("[data-uid=todoRG501]");
    assert.ok(card.classList.contains("pxd-item--overdue"));
    const chip = card.querySelector(".pxd-badge-chip--due");
    assert.equal(chip?.textContent, "Jan 1, 2020");
    assert.match(chip.title, /January 1st, 2020/);
    assert.ok(chip.classList.contains("pxd-badge-chip--overdue"));
    assert.equal(card.textContent.includes("BT_attrDue"), false);
    const before = f.session.mutations.length;
    const box = card.querySelector(".check-container")?.querySelector("input");
    assert.ok(box, "the TODO renders a checkbox");
    f.stub.dispatch(box, "pointerdown", { button: 0, clientX: 30, clientY: 40, pointerId: 2 });
    assert.deepEqual(
      f.session.mutations.slice(before),
      [["setString", "todoRG501", "{{[[DONE]]}} ship rg5"]],
    );
    assert.equal(f.board.items.get("todoRG501").content[0][":block/string"], due);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("RG-4: a Causes edge takes its style and the legend hides it without a write", async () => {
  const f = mountFixture({
    settings: { "attr-styles": '{"Causes":{"color":"red","dash":"solid"}}' },
  });
  try {
    await f.flush();
    const before = f.session.mutations.length;
    f.session.links = [
      {
        key: "cardAAAA1->cardBBBB2",
        from: "cardAAAA1",
        to: "cardBBBB2",
        kind: "attr",
        labels: ["Causes"],
        color: "teal",
        sources: [{ uid: "src", string: "Causes:: [[Beta]]" }],
      },
      {
        key: "cardAAAA1->cardDDDD4",
        from: "cardAAAA1",
        to: "cardDDDD4",
        kind: "ref",
        labels: ["mentions"],
        color: "gray",
        sources: [],
      },
    ];
    f.session.emit("links");
    await f.flush();
    const nodes = () => [...f.root.querySelectorAll('[data-key="cardAAAA1->cardBBBB2"]')];
    const line = nodes().find((n) => n.tagName === "G");
    const label = nodes().find((n) => n.classList.contains("pxd-label--link"));
    assert.ok(line?.classList.contains("pxd-c-red"));
    assert.ok(line?.classList.contains("pxd-link--solid"));
    assert.equal(label?.textContent, "Causes");
    const row = f.root.querySelector('.pxd-legend__row[data-attr="Causes"]');
    assert.equal(row?.textContent, "Causes");
    assert.equal(row?.getAttribute("aria-pressed"), "true");
    f.stub.dispatch(row, "click", { button: 0 });
    await f.flush();
    assert.equal(nodes().length, 0);
    assert.ok(f.root.querySelector('[data-key="cardAAAA1->cardDDDD4"]'));
    assert.equal(f.root.querySelector('.pxd-legend__row[data-attr="Causes"]')?.getAttribute("aria-pressed"), "false");
    assert.equal(f.session.links[0].color, "teal");
    assert.equal(f.session.mutations.length, before);
    assert.equal(f.session.mutations.some((entry) => entry[0] === "writeToGraph"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("RG-3: expand neighbours places a ring of page cards and writes no edges", async () => {
  const titles = ["N1", "N2", "N3", "N4", "N5", "Beta", "bad]]"];
  const f = mountFixture({
    hostOverrides: {
      neighborPages(item, mode, opts) {
        assert.equal(item.uid, "cardBBBB2");
        assert.equal(mode, "out");
        assert.equal(opts.boardUid, "board0001");
        return titles;
      },
    },
  });
  try {
    await f.flush();
    rightClick(f, shell(f, "cardAAAA1"));
    assert.ok(menuIds(f).includes("neighbors:out"), "a block card offers the neighbour actions");
    key(f, "Escape");
    rightClick(f, shell(f, "cardBBBB2"));
    assert.ok(menuIds(f).includes("neighbors:in"));
    assert.ok(menuIds(f).includes("neighbors:attr"));
    const before = f.session.mutations.length;
    pickRow(f, "neighbors:out");
    await tick();
    const added = f.session.mutations.slice(before);
    assert.deepEqual(added.map((row) => row[0]), ["addRefCards"]);
    assert.deepEqual(
      added[0][1],
      neighborLayout({ x: 300, y: 0, w: 200, h: 100 }, titles, { skip: ["Beta"] }),
    );
    assert.match(toastText(f), /Added 5 pages/);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

function blockish(uid, string, order) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": 10, ":y": 10, ":w": 180, ":h": 80 } },
    ":block/children": [],
  };
}

// ------------------------------------------------------------------ 2.2 dock options as the next item's style

const dockBtn = (f, sel) => {
  const m = /\[data-(\w+)=(\w+)\]/.exec(sel);
  return f.root.querySelectorAll(".pxd-dock__options button").find((b) => b.getAttribute(`data-${m[1]}`) === m[2]);
};
const place = (f, x, y) => {
  const vpEl = f.root.querySelector(".pxd-viewport");
  pointerDown(f, vpEl, x, y);
  pointerUp(f, x, y);
};

test("dock options: with Card active and nothing selected a swatch and a look become the next card's style, written only at create", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select([]);
    f.view.controller.setTool("card");
    const before = f.session.mutations.length;
    dockBtn(f, ".pxd-swatch[data-color=blue]").click();
    dockBtn(f, "[data-look=card]").click();
    assert.equal(f.session.mutations.length, before, "choosing writes nothing");
    assert.ok(dockBtn(f, ".pxd-swatch[data-color=blue]").classList.contains("pxd-dock__chosen"), "pending swatch shows selected");
    assert.ok(dockBtn(f, "[data-look=card]").classList.contains("pxd-dock__chosen"));
    place(f, 500, 700);
    await tick();
    const made = f.session.mutations.slice(before).find((row) => row[0] === "createCard");
    assert.ok(made, "a card was created");
    assert.equal(made[1].color, "blue");
    assert.equal(made[1].look, "card");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("dock options: with a card selected the swatch restyles it and sets no pending style", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1"]);
    f.view.controller.setTool("card");
    f.session.mutations.length = 0;
    dockBtn(f, ".pxd-swatch[data-color=red]").click();
    assert.deepEqual(f.session.mutations[0], ["setColor", ["cardAAAA1"], "red"]);
    assert.ok(!dockBtn(f, ".pxd-swatch[data-color=red]").classList.contains("pxd-dock__chosen"));
    f.view.controller.select([]);
    f.session.mutations.length = 0;
    place(f, 500, 700);
    await tick();
    const made = f.session.mutations.find((row) => row[0] === "createCard");
    assert.equal(made[1].color, undefined);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("dock options: sticky, section and shape each keep their own pending style and a plain card is unaffected", async () => {
  const f = mountFixture();
  try {
    await f.flush();
    f.view.controller.select([]);
    f.view.controller.setTool("sticky");
    dockBtn(f, ".pxd-swatch[data-color=green]").click();
    f.view.controller.setTool("shape");
    dockBtn(f, "[data-shape=ellipse]").click();
    f.view.controller.setTool("card");
    assert.ok(!dockBtn(f, ".pxd-swatch[data-color=green]").classList.contains("pxd-dock__chosen"), "sticky pick does not mark the card tool");
    f.view.controller.setTool("sticky");
    assert.ok(dockBtn(f, ".pxd-swatch[data-color=green]").classList.contains("pxd-dock__chosen"));
    f.session.mutations.length = 0;
    place(f, 500, 700);
    await tick();
    let made = f.session.mutations.find((row) => row[0] === "createText");
    assert.equal(made[1].look, "sticky");
    assert.equal(made[1].color, "green");
    f.view.controller.select([]);
    f.view.controller.setTool("shape");
    f.session.mutations.length = 0;
    place(f, 900, 700);
    await tick();
    made = f.session.mutations.find((row) => row[0] === "createText");
    assert.equal(made[1].shape, "ellipse");
    f.view.controller.select([]);
    f.view.controller.setTool("card");
    f.session.mutations.length = 0;
    place(f, 1300, 700);
    await tick();
    made = f.session.mutations.find((row) => row[0] === "createCard");
    assert.equal(made[1].color, undefined);
  } finally {
    f.view.dispose();
    f.restore();
  }
});


// ------------------------------------------------------------------ PO-5 screen-constant grips
test("PO-5: --pxd-inv-zoom is 1/zoom clamped to 0.25..4, written once per zoom change and never on a pan", async () => {
  const f = mountFixture({ vp: { x: 0, y: 0, zoom: 0.5 } });
  try {
    await f.flush();
    assert.equal(f.root.style["--pxd-inv-zoom"], "2", "published at mount");
    const counter = countSetProperty(f.root);
    for (let i = 0; i < 5; i += 1) {
      f.stub.dispatch(f.root.querySelector(".pxd-viewport"), "wheel", { deltaX: 12, deltaY: 7, clientX: 300, clientY: 300 });
      f.stub.flushFrames();
    }
    assert.equal(counter.inv, 0, "panning writes nothing");
    key(f, "=", { ctrlKey: true });
    f.stub.flushFrames();
    assert.equal(counter.inv, 1, "one write for one zoom step");
    near(Number(f.root.style["--pxd-inv-zoom"]), 1 / f.view.state().zoom, 1e-3);
    key(f, "=", { ctrlKey: true });
    f.stub.flushFrames();
    assert.equal(counter.inv, 2);
  } finally {
    f.view.dispose?.();
    f.restore();
  }
});

test("PO-5: the grips, ports and end handles size themselves from --pxd-inv-zoom with calc()", () => {
  const css = readFileSync(new URL("../extension.css", import.meta.url), "utf8");
  assert.equal(/--pxd-ui\b/.test(css), false, "the old zoom-out-only variable is gone from the CSS");
  for (const rule of [/\.pxd-port \{[^}]*width: calc\(12px \* var\(--pxd-inv-zoom, 1\)\)/, /\.pxd-grip--right \{[^}]*width: calc\(8px \* var\(--pxd-inv-zoom, 1\)\)/, /\.pxd-grip--corner \{[^}]*width: calc\(14px \* var\(--pxd-inv-zoom, 1\)\)/, /\.pxd-edge__end \{[^}]*r: calc\(6px \* var\(--pxd-inv-zoom, 1\)\)/]) {
    assert.match(css, rule);
  }
});
