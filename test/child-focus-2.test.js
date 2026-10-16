// Child focus defects: Cmd+. while editing, a deeper bullet, hover vs selection.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { blockUidFromNode, inputBlockRole } from "../src/view/editor-keys.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const CHILD_ID = "block-input-render-block-path-cardAAAA1-uuid4fa27c31-4792-400b-a4fd-de63b311804b-kidA00001";
const GRAND_ID = "block-input-render-block-path-cardAAAA1-uuid4fa27c31-4792-400b-a4fd-de63b311804b-kidA00001-uuid8ab31c20-1111-400b-a4fd-aabbccddeeff-kidA10001";
const HYPHEN_ID = "block-input-render-block-path-cardAAAA1-uuid4fa27c31-4792-400b-a4fd-de63b311804b-uyXFLc-bf";
const LEAD_ID = "block-input-render-block-path-cardAAAA1-uuid4fa27c31-4792-400b-a4fd-de63b311804b--vHHNhkc0";
const LONG_ID = "block-input-render-block-path-cardAAAA1-uuidabcd-kidA00001xy";

const node = (id, parent, extra = {}) => ({
  nodeType: 1,
  id,
  className: extra.className || "",
  parentElement: parent,
  dataset: extra.dataset || {},
  getAttribute: (name) => (name === "data-uid" ? extra.dataset?.uid || "" : ""),
});

test("F1: a render-block-path id is the trailing block uid", () => {
  const card = node("", null, { dataset: { uid: "cardAAAA1" } });
  assert.equal(blockUidFromNode(node(CHILD_ID, card)), "kidA00001");
  assert.equal(blockUidFromNode(node(GRAND_ID, card)), "kidA10001");
  assert.equal(blockUidFromNode(node(HYPHEN_ID, card)), "uyXFLc-bf");
  assert.equal(blockUidFromNode(node(LEAD_ID, card)), "-vHHNhkc0");
  assert.equal(blockUidFromNode(node(LONG_ID, card)), "kidA00001xy");
  assert.equal(blockUidFromNode(node("block-input-kidA00001", card)), "kidA00001");
  // The last piece is 16 chars, past the uid window, so the walk-up still wins.
  assert.equal(blockUidFromNode(node("block-input-render-block-path-abcdefghijklmnop", card)), "cardAAAA1");
  assert.equal(blockUidFromNode(node("block-input-nope", card)), "cardAAAA1");
});

test("F1: a nested path id is the child for paste, Enter, and Cmd+.", () => {
  const card = node("", null, { className: "pxd-item", dataset: { uid: "cardAAAA1" } });
  const editor = node("", card, { className: "pxd-item__editor" });
  const nest = node("", editor, { className: "rm-block-children" });
  const ta = node(CHILD_ID, nest);
  ta.closest = (sel) => {
    let el = ta;
    while (el) {
      const cls = String(el.className || "");
      if (sel === ".rm-block-children" && cls.includes("rm-block-children")) return el;
      if (sel === ".pxd-item__editor" && cls.includes("pxd-item__editor")) return el;
      el = el.parentElement;
    }
    return null;
  };
  assert.deepEqual(inputBlockRole(ta, "cardAAAA1"), { role: "child", uid: "kidA00001" });
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function pulled() {
  const item = (uid, string, plexus, order, children = []) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  });
  const kids = (uid, string, children = []) => item(uid, string, null, 0, children);
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      item("cardAAAA1", "Parent card", { ":x": 0, ":y": 0, ":w": 240, ":h": 160, ":kids": true }, 0, [
        kids("kidA00001", "Child block", [kids("kidA10001", "Grandchild block")]),
      ]),
      item("cardBBBB2", "Second card", { ":x": 320, ":y": 0, ":w": 240, ":h": 160, ":kids": true }, 1, [
        kids("kidB00001", "Child 2", [kids("kidB10001", "Grand 2")]),
      ]),
    ],
  };
}

function mount({ inputId = CHILD_ID } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(pulled());
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    mutations,
    on() { return () => {}; },
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
  };
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el) {
      const doc = el.ownerDocument || globalThis.document;
      const nest = doc.createElement("div");
      nest.className = "rm-block-children";
      const ta = doc.createElement("textarea");
      ta.className = "rm-block__input";
      ta.id = inputId;
      nest.append(ta);
      el.append(nest);
    },
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    updateString: rec("updateString"),
    createBlock: rec("createBlock"),
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "3.34.0",
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, session, view, flush };
}

async function settle(stub) {
  const real = Date.now;
  let clock = real() + 50;
  Date.now = () => clock;
  try {
    for (let i = 0; i < 8; i += 1) {
      clock += 200;
      stub.flushFrames();
      await tick();
    }
  } finally {
    Date.now = real;
  }
}

function crumbLabels(card) {
  const crumb = card.querySelector(".pxd-focus__crumb");
  if (!crumb) return [];
  return [...crumb.querySelectorAll("button")].map((btn) => btn.textContent);
}

async function show(f) {
  await f.flush();
  await tick(5);
  f.stub.flushIdle();
  f.stub.flushFrames();
}

test("F1: Cmd+. while editing a child leaves edit and focuses that block", async () => {
  const f = mount({ inputId: CHILD_ID });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardAAAA1]");
    f.stub.dispatch(card, "dblclick", { clientX: 40, clientY: 40 });
    await settle(f.stub);
    const ta = card.querySelector("textarea");
    assert.equal(ta?.id, CHILD_ID);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    ta.focus();
    f.stub.dispatch(ta, "keydown", { key: ".", code: "Period", metaKey: true });
    await settle(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.querySelector(".pxd-item__editor"), null);
    assert.deepEqual(crumbLabels(card), ["Parent card", "Child block"]);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F1: Cmd+. while editing a grandchild focuses card › child › grandchild", async () => {
  const f = mount({ inputId: GRAND_ID });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardAAAA1]");
    f.stub.dispatch(card, "dblclick", { clientX: 40, clientY: 40 });
    await settle(f.stub);
    const ta = card.querySelector("textarea");
    assert.equal(ta?.id, GRAND_ID);
    ta.focus();
    f.stub.dispatch(ta, "keydown", { key: ".", code: "Period", metaKey: true });
    await settle(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.querySelector(".pxd-item__editor"), null);
    assert.deepEqual(crumbLabels(card), ["Parent card", "Child block", "Grandchild block"]);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F2: a grandchild bullet inside a child focus remounts, then Escape steps back", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const childBullet = card.querySelector("[data-pxd-row=kidA00001] .pxd-outline__bullet");
    assert.ok(childBullet, "the child has a focus bullet");
    childBullet.click();
    f.stub.flushFrames();
    assert.deepEqual(crumbLabels(card), ["Parent card", "Child block"]);
    const grandBullet = card.querySelector("[data-pxd-row=kidA10001] .pxd-outline__bullet");
    assert.ok(grandBullet, "the grandchild bullet is inside the child focus");
    grandBullet.click();
    f.stub.flushFrames();
    assert.deepEqual(crumbLabels(card), ["Parent card", "Child block", "Grandchild block"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    f.stub.flushFrames();
    assert.deepEqual(crumbLabels(card), ["Parent card", "Child block"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    f.stub.flushFrames();
    assert.deepEqual(crumbLabels(card), []);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

function cmdPeriod(stub) {
  stub.dispatch(stub.window, "keydown", { key: ".", code: "Period", metaKey: true });
  stub.flushFrames();
}

test("F3: a hovered row wins Cmd+. when another card is selected", async () => {
  const f = mount();
  try {
    await show(f);
    f.view.controller.select(["cardBBBB2"]);
    f.stub.dispatch(f.view.root, "pointerenter");
    const card = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const bullet = card.querySelector("[data-pxd-row=kidA10001] .pxd-outline__bullet");
    assert.ok(bullet);
    f.stub.dispatch(bullet, "pointerover");
    cmdPeriod(f.stub);
    assert.deepEqual(crumbLabels(card), ["Parent card", "Child block", "Grandchild block"]);
    assert.deepEqual(crumbLabels(f.view.root.querySelector("[data-uid=cardBBBB2]")), []);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F3: Cmd+. with a selected card and no hover focuses nothing", async () => {
  const f = mount();
  try {
    await show(f);
    f.view.controller.select(["cardAAAA1"]);
    f.stub.dispatch(f.view.root, "pointerenter");
    cmdPeriod(f.stub);
    assert.deepEqual(crumbLabels(f.view.root.querySelector("[data-uid=cardAAAA1]")), []);
    assert.deepEqual(crumbLabels(f.view.root.querySelector("[data-uid=cardBBBB2]")), []);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("F3: Cmd+. on the selected card's hovered row still focuses that row", async () => {
  const f = mount();
  try {
    await show(f);
    f.view.controller.select(["cardAAAA1"]);
    f.stub.dispatch(f.view.root, "pointerenter");
    const card = f.view.root.querySelector("[data-uid=cardAAAA1]");
    const bullet = card.querySelector("[data-pxd-row=kidA00001] .pxd-outline__bullet");
    assert.ok(bullet);
    f.stub.dispatch(bullet, "pointerover");
    cmdPeriod(f.stub);
    assert.deepEqual(crumbLabels(card), ["Parent card", "Child block"]);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});
