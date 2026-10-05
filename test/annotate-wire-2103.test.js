// ECO-6 and ECO-7 wire. Imports the shipped annotatePlan. Does not reimplement it.
import assert from "node:assert/strict";
import test from "node:test";

import { annotatePlan } from "../src/model/annotate.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createRelChips } from "../src/relchips.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const BOARD = "Brd2wXe5a";
const DRAWING = "Dwg9kLm2p";
const REF = "Crd7tYu3v";
const IMAGE = "Img4nQr8s";
const PAGE = "pgOps0001";
const BLOCK = "blkRef001";
const NOTE = "noteCard1";
const PAGE_CARD = "pageCard1";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function item(uid, string, plexus, order, children = []) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  };
}

function pulled() {
  return {
    ":block/uid": BOARD,
    ":block/string": "{{[[diagram]]:Lab}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      item(PAGE_CARD, "[[Ops Page]]", { ":x": 0, ":y": 0, ":w": 200, ":h": 100 }, 0),
      item("blkCard01", `((${BLOCK}))`, { ":x": 240, ":y": 0, ":w": 200, ":h": 100 }, 1),
      item(NOTE, "Plain note", { ":x": 480, ":y": 0, ":w": 200, ":h": 100 }, 2),
      item(IMAGE, "![Shot](https://example.com/shot.png)", { ":x": 40, ":y": 80, ":w": 280, ":h": 160 }, 3),
      item("textTTTT5", "Label", { ":type": "text", ":x": 100, ":y": 300, ":w": 240, ":h": 48 }, 4),
    ],
  };
}

function fakeHost(pageCalls) {
  return {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {},
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    pageUid(title) { pageCalls.push(title); return title === "Ops Page" ? PAGE : null; },
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    group() { throw new Error("annotate must not group the writes"); },
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
    "fitSection", "tidyItems", "sortOutline", "sameSize", "resetSize", "fitToContent", "writeToGraph", "setItemStyle", "addRefCards"]) {
    session[name] = rec(name);
  }
  return session;
}

function mount() {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem(`plexus-diagram:vp:Svy:${BOARD}`, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(pulled());
  const session = fakeSession(board);
  const pageCalls = [];
  const host = fakeHost(pageCalls);
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "2.10.3",
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, board, session, host, pageCalls, view, flush, root: view.root };
}

const menuIds = (f) => [...f.root.querySelectorAll(".pxd-menu__item")].map((row) => row.dataset.id);
const rightClick = (f, target) => f.stub.dispatch(target, "contextmenu", { button: 2, clientX: 20, clientY: 20 });
const shell = (f, uid) => f.root.querySelector(`[data-uid="${uid}"]`);
const openCard = (f, uid) => {
  const node = uid ? shell(f, uid) : f.root.querySelector(".pxd-viewport");
  assert.ok(node, uid || "canvas");
  rightClick(f, node);
  return menuIds(f);
};

test("card menu rows follow compass and canAnnotate, and the clicks use the shipped plan", async () => {
  delete globalThis.RoamCompass;
  delete globalThis.RoamPlexus;
  const f = mount();
  const opens = [];
  const whenOpens = [];
  try {
    await f.flush();
    const image = f.board.items.get(IMAGE);
    const live = f.session.rects.get(IMAGE);
    const plan = annotatePlan({ uid: image.uid, x: live.x, y: live.y, w: live.w, h: live.h }, f.board.uid);
    assert.equal(plan.card.x, image.x + image.w + 40);
    assert.equal(plan.edge.to, IMAGE);
    assert.equal(plan.edge.label, "annotates");

    const absent = (uid, label) => {
      const ids = openCard(f, uid);
      assert.equal(ids.includes("open-compass"), false, label);
      assert.equal(ids.includes("annotate-drawing"), false, label);
      f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    };
    absent(PAGE_CARD, "page");
    absent("blkCard01", "block ref");
    absent(NOTE, "plain block");
    absent(IMAGE, "image");
    absent("textTTTT5", "text");
    absent(null, "canvas");

    globalThis.RoamCompass = { isAvailable() { return true; }, focus() {} };
    globalThis.RoamPlexus = { open() {} };
    absent(IMAGE, "no open and no create");
    absent(PAGE_CARD, "focus is not open");

    const compassOpens = [];
    globalThis.RoamCompass = {
      open(uid) { compassOpens.push(uid); },
    };
    for (const uid of [PAGE_CARD, "blkCard01", NOTE, IMAGE]) {
      const ids = openCard(f, uid);
      assert.equal(ids.includes("open-compass"), true, uid);
      assert.equal(ids.includes("annotate-drawing"), false, uid);
      f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    }
    const textIds = openCard(f, "textTTTT5");
    assert.equal(textIds.includes("open-compass"), false);
    assert.equal(textIds.includes("annotate-drawing"), false);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });

    globalThis.RoamPlexus = {
      create(args) {
        opens.push(args);
        return { uid: DRAWING };
      },
      open(uid) { opens.push(["open", uid, arguments.length]); },
      whenOpen(uid) { whenOpens.push(uid); },
    };
    const noteIds = openCard(f, NOTE);
    assert.equal(noteIds.includes("open-compass"), true);
    assert.equal(noteIds.includes("annotate-drawing"), false, "a plain block is not an image");
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    const imageIds = openCard(f, IMAGE);
    assert.equal(imageIds.includes("open-compass"), true);
    assert.equal(imageIds.includes("annotate-drawing"), true);

    const pick = (id) => {
      const row = [...f.root.querySelectorAll(".pxd-menu__item")].find((node) => node.dataset.id === id);
      assert.ok(row, id);
      f.stub.dispatch(row, "click", { button: 0 });
    };

    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    openCard(f, PAGE_CARD);
    const pageBefore = f.pageCalls.length;
    pick("open-compass");
    assert.deepEqual(f.pageCalls.slice(pageBefore), ["Ops Page"]);
    assert.deepEqual(compassOpens.at(-1), PAGE);

    openCard(f, "blkCard01");
    const blockBefore = f.pageCalls.length;
    pick("open-compass");
    assert.equal(f.pageCalls.length, blockBefore);
    assert.equal(compassOpens.at(-1), BLOCK);

    openCard(f, NOTE);
    const noteBefore = f.pageCalls.length;
    pick("open-compass");
    assert.equal(f.pageCalls.length, noteBefore);
    assert.equal(compassOpens.at(-1), NOTE);

    f.session.addRefCards = (list) => {
      opens.push(["card", list]);
      return Promise.resolve([REF]);
    };
    f.session.addEdge = (spec) => {
      opens.push(["edge", spec]);
      return Promise.resolve("edgeUid01");
    };
    openCard(f, IMAGE);
    pick("annotate-drawing");
    await f.flush();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    assert.equal(opens.filter((row) => !Array.isArray(row)).length, 1);
    assert.deepEqual(opens[0], plan.create);
    assert.deepEqual(Object.keys(opens[0]), ["parentUid", "order"]);
    assert.deepEqual(opens[1], ["card", [{
      string: `((${DRAWING}))`,
      x: plan.card.x,
      y: plan.card.y,
      w: plan.card.w,
      h: plan.card.h,
    }]]);
    assert.deepEqual(opens[2], ["edge", { from: REF, to: IMAGE, label: "annotates" }]);
    assert.deepEqual(opens[3], ["open", DRAWING, 1]);
    assert.deepEqual(whenOpens, []);
    assert.equal(f.root.querySelector(".pxd-toast__text")?.textContent, "Drop the image into the drawing");
    assert.equal(f.stub.document.body.querySelector(".pxd-toast--pin .pxd-toast__text")?.textContent, "Drop the image into the drawing");
    assert.equal(opens.some((row) => Array.isArray(row) && row[0] === "edge" && (row[1].from === DRAWING || row[1].to === DRAWING)), false);

    delete globalThis.RoamPlexus.create;
    const after = openCard(f, IMAGE);
    assert.equal(after.includes("annotate-drawing"), false, "no create means the row is absent");
    assert.equal(after.includes("open-compass"), true);
    delete globalThis.RoamCompass;
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    const gone = openCard(f, IMAGE);
    assert.equal(gone.includes("open-compass"), false);
    assert.equal(gone.includes("annotate-drawing"), false);
  } finally {
    delete globalThis.RoamCompass;
    delete globalThis.RoamPlexus;
    f.view.dispose();
    f.stub.document.body.querySelector(".pxd-toast--pin")?.remove();
    f.restore();
  }
});

test("the outline chip names a resolved drawing ref Drawing and the image by its alt", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const raw = pulled();
    raw[":block/children"].push(
      item(REF, `((${DRAWING}))`, { ":x": 360, ":y": 80, ":w": 280, ":h": 160 }, 5),
      item("connAnn01", "Connections", { ":type": "edges" }, 6, [
        item("edgeAnn01", `((${DRAWING})) → annotates → ((${IMAGE}))`, { ":type": "edge", ":from": REF, ":to": IMAGE }, 0),
      ]),
    );
    const host = {
      listConnectionBlocks: () => [["edgeAnn01", BOARD]],
      pullBoard: () => raw,
      blockString(uid) { return uid === DRAWING ? "{{[[excalidraw]]}}" : null; },
      blockPageUid: () => "pageUID01",
    };
    const chips = createRelChips({ doc: stub.document, win: stub.window, host, graph: () => "Readwisenotes", timers: { later: () => () => {}, frame: () => () => {} } });
    const container = stub.document.createElement("div");
    container.className = "roam-block-container";
    const input = stub.document.createElement("div");
    input.className = "rm-block__input roam-block";
    input.id = "block-input-Readwisenotes-body-outline-pageUID01-edgeAnn01";
    container.append(input);
    stub.document.body.append(container);
    chips.start();
    const chip = container.querySelector(".pxd-relchip");
    assert.ok(chip, "the connection block gets a chip");
    assert.match(chip.textContent, /Drawing —annotates→ Shot/);
    assert.equal(chip.textContent.includes("Block reference"), false);
    chips.dispose();
  } finally {
    restore();
  }
});
