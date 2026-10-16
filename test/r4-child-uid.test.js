// R4: child focus with short block uids (older graphs and imports use 5-8 chars).
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { blockUidFromNode } from "../src/view/editor-keys.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const CARD = "pxdqaK1";
const KID = "kidS1";
const GRAND = "grS0001";
const UUID = "uuid4fa27c31-4792-400b-a4fd-de63b311804b";
const CHILD_ID = `block-input-render-block-path-${CARD}-${UUID}-${KID}`;
const GRAND_ID = `block-input-render-block-path-${CARD}-${UUID}-${KID}-uuid8ab31c20-1111-400b-a4fd-aabbccddeeff-${GRAND}`;

const node = (id, parent, extra = {}) => ({
  nodeType: 1,
  id,
  className: extra.className || "",
  parentElement: parent,
  dataset: extra.dataset || {},
  getAttribute: (name) => (name === "data-uid" ? extra.dataset?.uid || "" : ""),
});


test("R4: a 5-8 char final segment is the block uid; the shortest 9-15 suffix still wins", () => {
  const card = node("", null, { dataset: { uid: CARD } });
  assert.equal(blockUidFromNode(node(CHILD_ID, card)), KID);
  assert.equal(blockUidFromNode(node(GRAND_ID, card)), GRAND);
  assert.equal(blockUidFromNode(node(`block-input-${KID}`, card)), KID);
  assert.equal(blockUidFromNode(node(`block-input-render-block-path-cardAAAA1-${UUID}-kidA00001`, card)), "kidA00001");
  assert.equal(blockUidFromNode(node(`block-input-render-block-path-cardAAAA1-${UUID}--vHHNhkc0`, card)), "-vHHNhkc0");
  assert.equal(blockUidFromNode(node(`block-input-render-block-path-cardAAAA1-${UUID}-uyXFLc-bf`, card)), "uyXFLc-bf");
  // 4 chars is not a uid: walk up to the card (a 7-char card uid on data-uid).
  assert.equal(blockUidFromNode(node(`block-input-render-block-path-${CARD}-${UUID}-abcd`, card)), CARD);
  assert.equal(blockUidFromNode(node("block-input-nope", card)), CARD);
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
      item(CARD, "Parent card", { ":x": 0, ":y": 0, ":w": 240, ":h": 160, ":kids": true }, 0, [
        kids(KID, "Child block", [kids(GRAND, "Grandchild block")]),
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


for (const [label, inputId, crumb] of [["child", CHILD_ID, ["Parent card", "Child block"]], ["grandchild", GRAND_ID, ["Parent card", "Child block", "Grandchild block"]]]) {
  test(`R4: Cmd+. on a short-uid ${label} focuses that block`, async () => {
    const f = mount({ inputId });
    try {
      await show(f);
      const card = f.view.root.querySelector(`[data-uid=${CARD}]`);
      f.stub.dispatch(card, "dblclick", { clientX: 40, clientY: 40 });
      await settle(f.stub);
      const ta = card.querySelector("textarea");
      assert.equal(ta?.id, inputId);
      ta.focus();
      f.stub.dispatch(ta, "keydown", { key: ".", code: "Period", metaKey: true });
      await settle(f.stub);
      assert.equal(card.classList.contains("pxd-item--editing"), false);
      assert.deepEqual(crumbLabels(card), crumb);
      assert.equal(f.session.mutations.length, 0);
    } finally {
      f.view.dispose();
      f.restore();
    }
  });
}
