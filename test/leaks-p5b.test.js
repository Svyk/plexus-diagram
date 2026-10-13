// P5-B memory-leak guards: view-lifetime lists must not grow per refresh / gesture / page return.
import assert from "node:assert/strict";
import v8 from "node:v8";
import vm from "node:vm";
import test from "node:test";
import { MOUNT_STAMP_CAP, mountFpsFromStamps, pushFrameStamp } from "../src/view/progressive.js";
import { createCoverStore } from "../src/host/cover-store.js";
import { createParseStore } from "../src/host/parse-store.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";
import { createDocCache } from "../src/host/doc-cache.js";
import { createRelChips } from "../src/relchips.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createSplitWatch } from "../src/host/split-watch.js";
import { createChrome } from "../src/view/chrome.js";
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

test("2b: the chrome context bar does not pin the buttons of every selection it rebuilt", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    const chrome = createChrome({ doc: stub.document, root, settings: {}, timers: { later: () => () => {}, frame: () => () => {} }, on: {} });
    const rect = { x: 10, y: 10, width: 100, height: 50, left: 10, top: 10, right: 110, bottom: 60 };
    const show = () => chrome.ctx.show("card", { kind: "note" }, () => ({ kind: "items", rect }));
    show();
    const once = stub.listenerCount();
    for (let i = 1; i < 120; i += 1) show();
    assert.ok(stub.listenerCount() < once + 600, `listeners ${stub.listenerCount()} vs first build ${once}`);
    chrome.dispose();
  } finally {
    restore();
  }
});

test("2c: the mount frame stamps stay bounded and keep the same median", () => {
  const stamps = [];
  for (let i = 0; i < 5000; i += 1) pushFrameStamp(stamps, i * 16);
  assert.ok(stamps.length <= MOUNT_STAMP_CAP, `stamps ${stamps.length}`);
  assert.equal(mountFpsFromStamps(stamps), 63);
});

const gcNow = async () => {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc");
  for (let i = 0; i < 3; i += 1) { gc(); await new Promise((r) => setTimeout(r, 5)); }
};

test("2d: a stale watchItem off-closure does not pin a disposed split generation's tree", async () => {
  const mk = () => {
    const card = { ":block/uid": "cardA", ":block/string": "A", ":block/props": { ":plexus": { ":x": 0 } }, ":block/children": [{ ":block/uid": "k1", ":block/string": "kid" }] };
    const sec = { ":block/uid": "secA", ":block/string": "Section", ":block/props": { ":plexus": { ":type": "section" } }, ":block/children": [card] };
    return { ":block/uid": "boardX", ":block/string": "{{[[diagram]]:T}}", ":block/children": [sec] };
  };
  const data = { addPullWatch() {}, removePullWatch() {} };
  const make = () => {
    const seed = mk();
    const split = createSplitWatch({ uid: "boardX", seed, data, pull: () => null, deepPattern: "[*]", onTree() {} });
    const off = split.watchItem("cardA");
    split.dispose();
    return { off, ref: new WeakRef(seed) };
  };
  const { off, ref } = make();
  await gcNow();
  assert.equal(ref.deref(), undefined, "the disposed generation's seed tree was collected although a card still holds its off");
  off();
});

test("2e: many views share one IndexedDB connection for the cover and parse caches", async () => {
  const idb = createFakeIDB();
  const stores = [];
  for (let i = 0; i < 12; i += 1) {
    const parse = createParseStore({ indexedDB: idb });
    const cover = createCoverStore({ indexedDB: idb, storage: null });
    stores.push(parse, cover);
    await parse.getParse("sha", "builtin", "o");
    await cover.get?.("https://example.test/a.pdf");
  }
  const diagramOpens = idb.opens.filter((o) => (o.name ?? o[0]) === "plexus-diagram");
  assert.equal(diagramOpens.length, 1, `opens of plexus-diagram: ${diagramOpens.length}`);
});

test("2f: the pin crop document cache destroys what it evicts and what it clears", () => {
  const made = [];
  const doc = (i) => { const d = { i, destroyed: false, destroy() { d.destroyed = true; } }; made.push(d); return d; };
  const cache = createDocCache({ cap: 3 });
  for (let i = 0; i < 10; i += 1) cache.set(`u${i}`, doc(i));
  assert.equal(cache.size(), 3);
  assert.equal(made.filter((d) => !d.destroyed).length, 3, "only the cap stays open");
  assert.ok(cache.get("u9"));
  cache.clear();
  assert.equal(made.every((d) => d.destroyed), true);
});

test("2g: relchips breadcrumb glyphs and listeners of re-rendered Roam pages are released", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    stub.window.location = { hash: "#/app/Svy/page/x" };
    const rawEdge = (uid, string, props, kids = [], order = 0) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids });
    const plx = (o) => ({ plexus: o });
    const board = rawEdge("board001", "{{[[diagram]]:Roadmap}}", plx({ v: 2 }), [
      rawEdge("cardA001", "Alpha", plx({ x: 0, y: 0, w: 200, h: 100 }), [], 0),
      rawEdge("cardB001", "Beta", plx({ x: 500, y: 0, w: 360, h: 480 }), [], 1),
      rawEdge("conn0001", "Connections", plx({ type: "edges" }), [rawEdge("edge0001", "((cardA001)) → x → ((cardB001))", plx({ type: "edge", from: "cardA001", to: "cardB001" }), [], 0)], 2),
    ]);
    const host = { graph: "Svy", listConnectionBlocks: () => [["edge0001", "board001"]], pullBoard: () => board, blockString: () => null, blockPageUid: () => "pageUID01" };
    const chips = createRelChips({ doc, win: stub.window, host, graph: () => "Svy", timers: { later: () => () => {}, frame: () => () => {} } });
    chips.start();
    const mk = (tag, cls, parent) => { const n = doc.createElement(tag); n.className = cls; parent?.append(n); return n; };
    const render = () => {
      const item = mk("div", "rm-reference-item", doc.body);
      const holder = mk("div", "", item);
      const zoom = mk("div", "rm-zoom zoom-mentions-view", holder);
      mk("div", "rm-zoom-item", zoom);
      mk("div", "rm-zoom-item", zoom);
      const container = mk("div", "roam-block-container rm-block", holder);
      container.setAttribute("data-block-uid", "edge0001");
      const main = mk("div", "rm-block-main", container);
      const input = mk("div", "rm-block__input roam-block", main);
      input.id = "block-input-Svy-mentions-page-pageUID01-edge0001";
      return item;
    };
    let item = render();
    chips.scan(item);
    const once = stub.listenerCount();
    for (let i = 0; i < 25; i += 1) {
      item.remove();
      item = render();
      chips.scan(item);
    }
    assert.equal(chips.crumbCount(), 1, "glyphs of dropped pages are not kept");
    // The detached chips keep their own six listeners in the stub's ledger; the crumb listeners (12 per render) must go.
    assert.ok(stub.listenerCount() <= once + 25 * 6, `listeners ${stub.listenerCount()} vs ${once}`);
    chips.dispose();
  } finally {
    restore();
  }
});

test("2h: lifecycle.timeout and idle drop their disposer once they fire", async () => {
  const lifecycle = createLifecycle();
  const base = lifecycle.size();
  for (let i = 0; i < 50; i += 1) lifecycle.timeout(() => {}, 0);
  assert.equal(lifecycle.size(), base + 50);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(lifecycle.size(), base, "fired timers leave nothing behind");
  let cleared = 0;
  const id = lifecycle.timeout(() => { cleared += 1; }, 50);
  await lifecycle.dispose();
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(cleared, 0, "a pending timer is still cleared on dispose");
  void id;
});
