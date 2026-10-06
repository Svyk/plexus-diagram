// HUNT-1: a page edit patches one row. The outline cache stays until the debounced
// refresh, and that refresh does not rebuild the holder or measure every row.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createRowScheduler } from "../src/view/progressive.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});
const rawBoard = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const PAGE = { ":x": 0, ":y": 0, ":w": 360, ":h": 480 };
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };

function harness({ pageBlocks = [], titles = ["Alpha"] } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderString: 0, unmount: 0, watch: [], released: 0, pageFetch: 0 };
  const state = { blocks: pageBlocks, handlers: new Map() };
  const host = {
    renderString(node, string) { calls.renderString += 1; node.textContent = string; },
    unmount() { calls.unmount += 1; },
    renderBlock() {},
    renderPage() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageOutline(title) {
      calls.pageFetch += 1;
      return { uid: `uid-${title}`, exists: true, blocks: state.blocks };
    },
    pageUid: (t) => `uid-${t}`,
    openPage() {},
    watchPage(title, cb) {
      calls.watch.push(title);
      const set = state.handlers.get(title) || new Set();
      set.add(cb);
      state.handlers.set(title, set);
      return () => {
        calls.released += 1;
        set.delete(cb);
        if (set.size === 0) state.handlers.delete(title);
      };
    },
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const laterQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later(fn, ms) { const t = { fn, ms }; laterQueue.push(t); return () => { const i = laterQueue.indexOf(t); if (i >= 0) laterQueue.splice(i, 1); }; },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard(titles.map((t, i) => blk(`pg${i}`.padEnd(9, "0"), `[[${t}]]`, { ...PAGE, ":x": i * 400 }, i))));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  flush();
  const fire = (title) => { for (const fn of [...(state.handlers.get(title) || [])]) fn({}); };
  const runLater = () => { const q = laterQueue.splice(0); for (const t of q) t.fn(); };
  return {
    doc, calls, r, state, flush, fire, runLater, laterQueue,
    shell: (uid) => r.shellOf(uid),
    uids: board.order.slice(),
    done() { r.dispose(); restore(); },
  };
}

const rowText = (card, uid) => card.querySelector(`[data-pxd-row="${uid}"]`)?.textContent ?? null;

function armLayoutCounter(card) {
  let reads = 0;
  const body = card.querySelector(".pxd-item__body");
  body._rect = { left: 0, top: 0, width: 360, height: 400, right: 360, bottom: 400, x: 0, y: 0 };
  for (const node of card.querySelectorAll(".pxd-prow, .pxd-row, .pxd-block__plain, .pxd-rs, .pxd-rs__live")) {
    node._rect = { left: 8, top: 40, width: 300, height: 22, right: 308, bottom: 62, x: 8, y: 40 };
    const orig = node.getBoundingClientRect.bind(node);
    node.getBoundingClientRect = () => { reads += 1; return orig(); };
  }
  return () => reads;
}

function armRowCounter(doc, card) {
  let created = 0;
  let removed = 0;
  const watchRemove = (node) => {
    if (node.__huntRemove) return;
    node.__huntRemove = true;
    const orig = node.remove.bind(node);
    node.remove = () => {
      if (node.classList.contains("pxd-prow")) removed += 1;
      return orig();
    };
  };
  for (const prow of card.querySelectorAll(".pxd-prow")) watchRemove(prow);
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = origCreate(tag);
    const prev = Object.getOwnPropertyDescriptor(node, "className");
    Object.defineProperty(node, "className", {
      configurable: true,
      get() { return prev.get.call(node); },
      set(value) {
        const was = node.classList.contains("pxd-prow");
        prev.set.call(node, value);
        if (!was && node.classList.contains("pxd-prow")) created += 1;
        if (node.classList.contains("pxd-prow")) watchRemove(node);
      },
    });
    return node;
  };
  return () => ({ created, removed });
}

const blocks = () => [
  { uid: "row000001", string: "alpha", children: [] },
  { uid: "row000002", string: "beta", children: [{ uid: "row000004", string: "nested", children: [] }] },
  { uid: "row000003", string: "gamma", children: [] },
];

test("HUNT-1: one string edit updates that row and does not create, remove, or measure the others", async () => {
  const h = harness({ pageBlocks: blocks() });
  try {
    const card = h.shell(h.uids[0]);
    const row = card.querySelector("[data-uid=row000002]");
    const line = card.querySelector("[data-pxd-row=row000002]");
    const nested = card.querySelector("[data-pxd-row=row000004]");
    const live = line.querySelector(".pxd-rs__live");
    assert.ok(live, "the row upgraded to a live root");
    assert.equal(h.calls.pageFetch, 1);
    const layout = armLayoutCounter(card);
    const tally = armRowCounter(h.doc, card);
    const unmounts = h.calls.unmount;
    const renders = h.calls.renderString;
    h.state.blocks = blocks().map((b) => (b.uid === "row000002" ? { ...b, string: "beta!" } : b));
    h.fire("Alpha");
    assert.equal(h.calls.pageFetch, 1, "the watch keeps the cached outline until the refresh runs");
    assert.equal(h.laterQueue.length, 1);
    h.runLater();
    await tick();
    const moved = tally();
    assert.equal(h.calls.pageFetch, 2, "the refresh pulls once");
    assert.equal(moved.created, 0);
    assert.equal(moved.removed, 0);
    assert.equal(card.querySelector("[data-uid=row000002]"), row);
    assert.equal(card.querySelector("[data-pxd-row=row000002]"), line);
    assert.equal(line.querySelector(".pxd-rs__live"), live, "the live root stays mounted");
    assert.equal(live.textContent, "beta!");
    assert.equal(rowText(card, "row000001"), "alpha");
    assert.equal(nested, card.querySelector("[data-pxd-row=row000004]"));
    assert.equal(rowText(card, "row000004"), "nested");
    assert.equal(rowText(card, "row000003"), "gamma");
    assert.equal(h.calls.unmount, unmounts);
    assert.equal(h.calls.renderString, renders + 1, "one live root took the new string");
    assert.equal(layout(), 0, "no layout read per row on refresh");
  } finally { h.done(); }
});

test("HUNT-1: a nested string edit patches that row only", async () => {
  const h = harness({ pageBlocks: blocks() });
  try {
    const card = h.shell(h.uids[0]);
    const line = card.querySelector("[data-pxd-row=row000004]");
    const live = line.querySelector(".pxd-rs__live");
    const tally = armRowCounter(h.doc, card);
    h.state.blocks = blocks().map((b) => (b.uid === "row000002"
      ? { ...b, children: [{ uid: "row000004", string: "nested!", children: [] }] }
      : b));
    h.fire("Alpha");
    h.runLater();
    await tick();
    const moved = tally();
    assert.equal(moved.created, 0);
    assert.equal(moved.removed, 0);
    assert.equal(card.querySelector("[data-pxd-row=row000004]"), line);
    assert.equal(line.querySelector(".pxd-rs__live"), live);
    assert.equal(live.textContent, "nested!");
    assert.equal(rowText(card, "row000002"), "beta");
  } finally { h.done(); }
});

test("HUNT-1: reordering keeps the row elements", async () => {
  const h = harness({ pageBlocks: blocks() });
  try {
    const card = h.shell(h.uids[0]);
    const first = card.querySelector("[data-uid=row000001]");
    const second = card.querySelector("[data-uid=row000003]");
    const tally = armRowCounter(h.doc, card);
    const list = blocks();
    h.state.blocks = [list[2], list[0], list[1]];
    h.fire("Alpha");
    h.runLater();
    await tick();
    assert.equal(tally().created, 0);
    const page = card.querySelector(".pxd-item__page");
    const top = [...page.children].filter((node) => node.classList.contains("pxd-prow"));
    assert.deepEqual(top.map((node) => node.getAttribute("data-uid")), ["row000003", "row000001", "row000002"]);
    assert.equal(top[1], first);
    assert.equal(top[0], second);
    const wrap = [...top[2].children].find((node) => node.classList.contains("pxd-block__children"));
    assert.equal(wrap.querySelector("[data-uid=row000004]").getAttribute("data-uid"), "row000004");
  } finally { h.done(); }
});

test("HUNT-1: two cards of one title share one watch and one refresh pull", async () => {
  const h = harness({ pageBlocks: blocks(), titles: ["Alpha", "Alpha"] });
  try {
    assert.deepEqual(h.calls.watch, ["Alpha"]);
    assert.equal(h.calls.pageFetch, 1);
    h.state.blocks = blocks().map((b) => (b.uid === "row000001" ? { ...b, string: "alpha!" } : b));
    h.fire("Alpha");
    assert.equal(h.calls.pageFetch, 1);
    h.runLater();
    await tick();
    assert.equal(h.calls.pageFetch, 2);
    assert.equal(rowText(h.shell(h.uids[0]), "row000001"), "alpha!");
    assert.equal(rowText(h.shell(h.uids[1]), "row000001"), "alpha!");
  } finally { h.done(); }
});

test("HUNT-1: adding a row leaves the other live roots mounted", async () => {
  const h = harness({ pageBlocks: blocks() });
  try {
    const card = h.shell(h.uids[0]);
    const before = new Set(card.querySelectorAll(".pxd-prow"));
    const unmounts = h.calls.unmount;
    h.state.blocks = [...blocks(), { uid: "row000009", string: "added", children: [] }];
    h.fire("Alpha");
    h.runLater();
    await tick();
    for (const prow of before) assert.equal(prow.isConnected, true);
    assert.ok(card.querySelector("[data-pxd-row=row000009]"));
    assert.equal(h.calls.unmount, unmounts);
  } finally { h.done(); }
});

test("HUNT-1 scheduler drop skips a row and retarget marks it heavy before it renders", () => {
  const order = [];
  const idleQueue = [];
  const s = createRowScheduler({
    idle: (fn) => { idleQueue.push(fn); return () => {}; },
    render: (id) => order.push(id),
  });
  s.add("a", { wanted: true });
  s.add("b", { wanted: true });
  s.drop("a");
  s.retarget("b", { heavy: true });
  s.add("c", { wanted: true });
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["c", "b"]);
  assert.equal(s.isDone("a"), false);
});
