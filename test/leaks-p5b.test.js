// P5-B memory-leak guards: view-lifetime lists must not grow per refresh / gesture / page return.
import assert from "node:assert/strict";
import test from "node:test";
import { createPanel } from "../src/view/panel.js";
import { createPropsPanel } from "../src/view/props-panel.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

export function mountSmall(stub, { cards = 6, sticky = false, unmounted = [] } = {}) {
  const kids = Array.from({ length: cards }, (_, i) => ({
    ":block/uid": `card${String(i).padStart(5, "0")}`,
    ":block/string": `Card ${i}`,
    ":block/order": i,
    ":block/props": { ":plexus": { ":x": i * 260, ":y": 0, ":w": 240, ":h": 180 } },
    ":block/children": [],
  }));
  if (sticky) kids[0][":block/props"][":plexus"] = { ":type": "text", ":look": "sticky", ":x": 0, ":y": 0, ":w": 240, ":h": 180 };
  const board = buildBoard({ ":block/uid": "smallboard1", ":block/string": "{{[[diagram]]:Small}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": kids });
  const host = {
    stats: {}, graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) { el.textContent = uid; },
    unmount(node) { unmounted.push(node); },
    pagePreview: () => ({ exists: false, blocks: [] }), pullTree: () => [], blockString: () => null,
    openBlock() {}, openInSidebar() {}, searchPages: () => [], searchBlocks: () => [], related: () => [],
  };
  const session = { uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), on() { return () => {}; }, release() {}, setLinkMode() {} };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  const pump = (n = 5) => { for (let i = 0; i < n; i += 1) { stub.flushFrames(); stub.flushIdle(); } };
  return { view, pump };
}

test("1b: the props panel releases the old body's listeners on every refresh", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    let active = 0;
    const create = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      const node = create(tag);
      const add = node.addEventListener?.bind(node);
      const remove = node.removeEventListener?.bind(node);
      node.addEventListener = (...a) => { active += 1; return add?.(...a); };
      node.removeEventListener = (...a) => { active -= 1; return remove?.(...a); };
      return node;
    };
    const root = create("div");
    doc.body.append(root);
    const panel = createPropsPanel({ doc, root, storage: null, on: {} });
    const state = { items: [{ type: "card", uid: "c1", fontSize: 14 }], edge: null, board: { plexus: {}, defaults: {} } };
    panel.refresh(state);
    const once = active;
    for (let i = 0; i < 20; i += 1) panel.refresh(state);
    assert.equal(active, once, "listener count is flat across refreshes");
    panel.dispose();
  } finally {
    restore();
  }
});

test("1c: pointerdown gestures on a card do not grow the view's listener list", () => {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const { view, pump } = mountSmall(stub);
    pump(20);
    const body = view.root.querySelector(".pxd-item[data-uid] .pxd-item__body") || view.root.querySelector(".pxd-item__header");
    assert.ok(body, "a card body is mounted");
    const gesture = () => {
      stub.dispatch(body, "pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
      stub.dispatch(stub.document, "pointerup", { clientX: 50, clientY: 50, pointerId: 1 });
      pump(2);
    };
    gesture();
    const base = view.stats().listeners;
    for (let i = 0; i < 30; i += 1) gesture();
    assert.equal(view.stats().listeners, base, "per-gesture listeners are released when the gesture ends");
    view.dispose();
  } finally {
    restore();
  }
});

test("1d: a sticky's live Roam block is unmounted when the view is disposed", () => {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const unmounted = [];
    const { view, pump } = mountSmall(stub, { sticky: true, unmounted });
    pump(20);
    const editor = view.root.querySelector(".pxd-item__editor--sticky");
    assert.ok(editor, "the sticky mounted its live block");
    view.dispose();
    assert.ok(unmounted.includes(editor), "host.unmount received the sticky editor");
  } finally {
    restore();
  }
});

test("2a: the add panel does not pin every result row it ever rendered", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    const pages = Array.from({ length: 30 }, (_, i) => ({ title: `Page ${i}` }));
    const panel = createPanel({
      doc: stub.document, root, host: { searchPages: () => pages, searchBlocks: () => [] },
      timers: { later: () => () => {}, frame: () => () => {} }, on: {},
    });
    panel.open("search");
    const input = root.querySelector(".pxd-panel__input");
    const search = async (v) => {
      input.value = v;
      stub.dispatch(input, "keydown", { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    };
    await search("page");
    const once = stub.listenerCount();
    for (let i = 0; i < 40; i += 1) await search(i % 2 ? "page" : "pag");
    const live = root.querySelectorAll(".pxd-panel__row").length;
    assert.ok(live > 0);
    assert.ok(stub.listenerCount() < once + 3 * 30 + 200, `listeners ${stub.listenerCount()} vs first render ${once}`);
    panel.dispose();
  } finally {
    restore();
  }
});
