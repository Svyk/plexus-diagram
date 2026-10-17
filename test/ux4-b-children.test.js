// UX4 lane B: child focus from real clicks, refold, drop onto a child row.
// The user's card: "This is a test" › test › [[Todd Zenger]] › TEST › [[Donald Trump's Grip…]] › [[Tech]].
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const blk = (uid, string, children = [], extra = {}) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": 0,
  ":block/children": children,
  ...extra,
});

export function testTree() {
  return [
    blk("kidT00001", "test", [
      blk("kidZ00001", "[[Todd Zenger]]", [
        blk("kidX00001", "TEST", [
          blk("kidD00001", "[[Donald Trump's Grip on the Midterms: May 28, 2026 (highlights)]]", [
            blk("kidH00001", "[[Tech]]"),
          ]),
        ]),
      ]),
    ]),
  ];
}

export function pulled(cards) {
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": cards.map((c, i) => ({
      ":block/uid": c.uid,
      ":block/string": c.string,
      ":block/order": i,
      ":block/props": { ":plexus": { ":x": i * 400, ":y": 0, ":w": 260, ":h": 120, ...(c.plexus || {}) } },
      ":block/children": c.children || [],
    })),
  };
}

const userCards = (kids) => [
  { uid: "cardTT001", string: "This is a test", plexus: kids ? { ":kids": true, ":h": 260 } : {}, children: testTree() },
  { uid: "cardSR001", string: "test" },
];

export function mount({ cards, zoom = 1, host: hostExtra = {}, session: sessionExtra = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom }));
  const board = buildBoard(pulled(cards || userCards(false)));
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    mutations,
    listeners: {},
    on(name, fn) { session.listeners[name] = fn; return () => {}; },
    release() {},
    setLinkMode() {},
    commitMove: rec("commitMove"),
    commitRects: rec("commitRects"),
    createCard: rec("createCard"),
    setString: rec("setString"),
    setKids: rec("setKids"),
    setNodeOpen: rec("setNodeOpen"),
    setBlockOpen: rec("setBlockOpen"),
    setCollapsed: rec("setCollapsed"),
    growToFit: rec("growToFit"),
    addCardChild: rec("addCardChild"),
    updateEdge: rec("updateEdge"),
    addEdge: rec("addEdge"),
    ...sessionExtra,
  };
  const host = {
    graph: "Svy",
    renderString(el, string) {
      const doc = el.ownerDocument || globalThis.document;
      el.replaceChildren(doc.createTextNode(string));
    },
    renderBlock() {},
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    updateString: rec("updateString"),
    createBlock: rec("createBlock"),
    ...hostExtra,
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.35.0" });
  return { stub, restore, session, view, host, mutations };
}

export async function show(f) {
  f.stub.flushFrames();
  await tick();
  f.stub.flushIdle();
  f.stub.flushFrames();
  await tick(5);
  f.stub.flushIdle();
  f.stub.flushFrames();
}

// What a mouse click delivers, in order, at the element.
export function realClick(stub, target, { x = 30, y = 30 } = {}) {
  const base = { clientX: x, clientY: y, pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
  stub.dispatch(target, "pointerdown", { ...base, buttons: 1 });
  stub.dispatch(target, "mousedown", { ...base, buttons: 1 });
  stub.dispatch(target, "pointerup", { ...base, buttons: 0 });
  stub.dispatch(target, "mouseup", { ...base, buttons: 0 });
  stub.dispatch(target, "click", { ...base, buttons: 0, detail: 1 });
}

export function crumbLabels(card) {
  const crumb = card.querySelector(".pxd-focus__crumb");
  return crumb ? [...crumb.querySelectorAll("button")].map((btn) => btn.textContent) : [];
}

const rowUids = (card) => [...card.querySelectorAll("[data-pxd-row]")]
  .filter((n) => !n.closest("[hidden]"))
  .map((n) => n.getAttribute("data-pxd-row"));

// The session's setKids lands in Roam and the pull watch hands the board back.
function applyKids(f, on) {
  const next = buildBoard(pulled(userCards(on)));
  f.session.board = next;
  f.session.rects = worldRects(next);
  f.session.listeners.change?.({ dirty: new Set(["cardTT001"]), structural: false });
}

test("B1: Children button → unfold → real click on bullets at depth 2, 4 and 5 focuses each; Escape steps back", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const kidsBtn = card.querySelector(".pxd-kids");
    assert.ok(kidsBtn, "the folded card has the Children button");
    realClick(f.stub, kidsBtn);
    assert.deepEqual(f.mutations.find((m) => m[0] === "setKids")?.slice(1, 3), ["cardTT001", true]);
    applyKids(f, true);
    await show(f);
    assert.deepEqual(rowUids(card), ["kidT00001", "kidZ00001", "kidX00001", "kidD00001", "kidH00001"]);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidZ00001] .pxd-outline__bullet"));
    await show(f);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    assert.equal(card.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-outline--zoomed"), true);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidD00001] .pxd-outline__bullet"));
    await show(f);
    assert.equal(crumbLabels(card).at(-1).startsWith("Donald Trump"), true);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidH00001] .pxd-outline__bullet"));
    await show(f);
    assert.equal(crumbLabels(card).at(-1), "Tech");
    assert.deepEqual(rowUids(card), ["kidH00001"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await show(f);
    assert.equal(crumbLabels(card).at(-1).startsWith("Donald Trump"), true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// B3: the user's frames. Focus a child, fold: the card went on showing the crumb and the rows.
test("B3: unfold → focus depth 2 → fold → unfold → fold puts the card back to its stored folded size and plain top block", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const folded = { h: card.style.height, rows: rowUids(card) };
    assert.deepEqual(folded.rows, []);
    const kids = () => card.querySelector(".pxd-kids");
    realClick(f.stub, kids());
    applyKids(f, true);
    await show(f);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidZ00001] .pxd-outline__bullet"));
    await show(f);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    f.mutations.length = 0;
    realClick(f.stub, kids());
    assert.deepEqual(f.mutations.filter((m) => m[0] === "setKids").map((m) => m.slice(1, 3)), [["cardTT001", false]]);
    applyKids(f, false);
    await show(f);
    assert.deepEqual(crumbLabels(card), [], "no crumb after fold");
    assert.deepEqual(rowUids(card), [], "no leftover rows after fold");
    assert.equal(card.style.height, folded.h, "the stored folded height");
    realClick(f.stub, kids());
    applyKids(f, true);
    await show(f);
    assert.deepEqual(crumbLabels(card), [], "unfold again shows the whole outline, not the old focus");
    assert.deepEqual(rowUids(card), ["kidT00001", "kidZ00001", "kidX00001", "kidD00001", "kidH00001"]);
    realClick(f.stub, kids());
    applyKids(f, false);
    await show(f);
    assert.deepEqual(rowUids(card), []);
    assert.equal(card.style.height, folded.h);
    assert.equal(f.mutations.some((m) => m[0] === "commitRects" || m[0] === "growToFit"), false, "fold writes no height of its own");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("B3: Escape to the top from a focus on a folded card (focused through a peek or a link) leaves no rows", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const h = card.style.height;
    f.view.focusInside("cardTT001", "kidX00001");
    await show(f);
    assert.equal(crumbLabels(card).at(-1), "TEST");
    for (let i = 0; i < 3; i += 1) {
      f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
      await show(f);
    }
    assert.deepEqual(crumbLabels(card), []);
    assert.deepEqual(rowUids(card), []);
    assert.equal(card.style.height, h);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("B1: hover the Children button, move into the peek, click a depth-2 row: the card shows that block focused, with no write; the Children button folds it back", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const h = card.style.height;
    const kidsBtn = card.querySelector(".pxd-kids");
    f.stub.dispatch(kidsBtn, "mouseenter", {});
    await tick(450);
    await show(f);
    const peek = f.view.root.querySelector(".pxd-kids-peek");
    assert.ok(peek, "the peek opens on hover");
    f.stub.dispatch(kidsBtn, "mouseleave", {});
    f.stub.dispatch(peek, "mouseenter", {});
    await tick(450);
    assert.ok(peek.isConnected, "the peek stays open while the pointer crosses into it");
    const row = peek.querySelector("[data-pxd-peek-row=kidZ00001]");
    assert.ok(row, "depth-2 rows are pickable");
    realClick(f.stub, row);
    await show(f);
    assert.equal(peek.isConnected, false);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    assert.equal(card.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-outline--zoomed"), true);
    assert.equal(f.mutations.length, 0, "picking a child writes nothing");
    realClick(f.stub, card.querySelector(".pxd-kids"));
    await show(f);
    assert.equal(f.mutations.length, 0, "folding back a peek pick writes nothing");
    assert.deepEqual(crumbLabels(card), []);
    assert.deepEqual(rowUids(card), []);
    assert.equal(card.style.height, h);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

async function settleEdit(stub) {
  const real = Date.now;
  let clock = real() + 50;
  Date.now = () => clock;
  try {
    for (let i = 0; i < 10; i += 1) {
      clock += 200;
      stub.flushFrames();
      await tick();
    }
  } finally {
    Date.now = real;
  }
}

// Roam's editor: one root block with a bullet and children, ids ending in the block uid.
function editorHost(rendered) {
  return {
    renderBlock(el, uid) {
      rendered.push(uid);
      const doc = el.ownerDocument || globalThis.document;
      const wrap = doc.createElement("div");
      wrap.className = "rm-api-render--block";
      const box = doc.createElement("div");
      box.className = "roam-block-container";
      const main = doc.createElement("div");
      main.className = "rm-block-main";
      const controls = doc.createElement("div");
      controls.className = "controls";
      const bullet = doc.createElement("span");
      bullet.className = "rm-bullet";
      controls.append(bullet);
      const ta = doc.createElement("textarea");
      ta.className = "rm-block__input";
      ta.id = `block-input-WIN1-body-outline-page0001-${uid}`;
      ta.setSelectionRange = () => {};
      main.append(controls, ta);
      box.append(main);
      wrap.append(box);
      el.append(wrap);
    },
  };
}

test("B1: editing a card focused on a child edits that block (Roam's zoom): the crumb stays, the editor mounts the focused block, Escape keeps the focus", async () => {
  const rendered = [];
  const f = mount({ cards: userCards(true), host: editorHost(rendered) });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    realClick(f.stub, card.querySelector("[data-pxd-row=kidZ00001] .pxd-outline__bullet"));
    await show(f);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    const row = card.querySelector("[data-pxd-row=kidX00001] .pxd-block__text");
    f.stub.dispatch(row, "dblclick", { clientX: 60, clientY: 80 });
    await settleEdit(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    assert.deepEqual(rendered, ["kidZ00001"], "the editor mounts the focused block, not the whole card");
    assert.equal(card.classList.contains("pxd-item--focusedit"), true);
    const body = card.querySelector(".pxd-item__body");
    const crumb = card.querySelector(".pxd-focus__crumb");
    assert.equal(crumb?.parentElement, body, "the crumb stays on screen above the editor, outside the fading static layer");
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await settleEdit(f.stub);
    await show(f);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.classList.contains("pxd-item--focusedit"), false);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});
