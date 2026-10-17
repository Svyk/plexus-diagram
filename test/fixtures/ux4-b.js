// Shared by the UX4 lane B tests: a mounted board view on the DOM stub and real pointer sequences.
import { buildBoard, worldRects } from "../../src/model/board.js";
import { mountBoardView } from "../../src/view/board-view.js";
import { createDomStub } from "./dom-stub.js";

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export const blk = (uid, string, children = [], extra = {}) => ({
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

export function mount({ cards, zoom = 1, host: hostExtra = {}, session: sessionExtra = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom }));
  const board = buildBoard(pulled(cards || []));
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

export async function settleEdit(stub) {
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
export function editorHost(rendered) {
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

