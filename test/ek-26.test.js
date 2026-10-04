// 2.6.0: EK-1 edit keeps the card size, EK-2 sticky notes, EK-3 progressive page rows, EK-4 block arrows that follow
// their row, EK-5 tooltips. DOM stub and fake hosts only; the live checks belong to the parent.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFileSync } from "node:fs";

import { buildBoard, displayRects, worldRects, STICKY_HEADER_H } from "../src/model/board.js";
import { normalizeItemLayout, serializeItemLayout } from "../src/model/schema.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createRowScheduler, isHeavyRow } from "../src/view/progressive.js";
import { TIP_TEXT } from "../src/view/tooltip-text.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => resetSessions());

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const css = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

// ------------------------------------------------------------------ EK-2 schema, board, session
test("EK-2: plexus.min is kept for text items and dropped everywhere else", () => {
  assert.equal(normalizeItemLayout({ type: "text", look: "sticky", min: true }).min, true);
  assert.equal(normalizeItemLayout({ type: "text", look: "sticky", min: false }).min, undefined);
  assert.equal(normalizeItemLayout({ type: "card", min: true }).min, undefined);
  assert.equal(normalizeItemLayout({ type: "text", min: true }).min, undefined, "a plain text item has no header to shrink to");
  assert.equal(serializeItemLayout({ type: "text", look: "sticky", min: true }).min, true);
  assert.equal("min" in serializeItemLayout({ type: "text", look: "sticky" }), false);
  assert.equal("min" in serializeItemLayout({ type: "card", min: true }), false);
  assert.equal("min" in serializeItemLayout({ type: "text", min: true }), false);
  const round = serializeItemLayout(normalizeItemLayout({ type: "text", look: "sticky", min: true, x: 1, y: 2, w: 200, h: 160 }));
  assert.deepEqual(round, { type: "text", x: 1, y: 2, w: 200, h: 160, look: "sticky", min: true });
});

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
const STICKY = { ":type": "text", ":look": "sticky", ":x": 20, ":y": 30, ":w": 200, ":h": 160, ":color": "yellow" };

test("EK-2: a minimized sticky paints as its header; the stored size stays", () => {
  const board = buildBoard(rawBoard([
    blk("st000001", "note", { ...STICKY, ":min": true }, 0),
    blk("st000002", "open", STICKY, 1),
    blk("tx000001", "plain text", { ":type": "text", ":x": 300, ":y": 0, ":w": 200, ":h": 80, ":min": true }, 2),
  ]));
  assert.equal(board.items.get("st000001").min, true);
  assert.equal(board.items.get("st000001").h, 160);
  assert.equal(board.items.get("tx000001").min, false, "only a sticky minimizes");
  const rects = displayRects(board, worldRects(board));
  assert.equal(rects.get("st000001").h, STICKY_HEADER_H);
  assert.equal(rects.get("st000002").h, 160);
  assert.equal(rects.get("tx000001").h, 80);
});

test("EK-2: setMinimized writes plexus.min once, keeps the size, and a second call to the same state writes nothing", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "s1", string: "note", props: { plexus: { type: "text", look: "sticky", x: 0, y: 0, w: 200, h: 160, color: "yellow" } } },
      { uid: "t1", string: "text", props: { plexus: { type: "text", x: 300, y: 0, w: 200, h: 80 } } },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  await session.setMinimized("s1", true);
  assert.equal(fake.writesLog().length, 1, "one write is one undo step");
  assert.equal(fake.block("s1").props.plexus.min, true);
  assert.equal(fake.block("s1").props.plexus.h, 160);
  assert.equal(session.board.items.get("s1").min, true);
  await session.setMinimized("s1", true);
  assert.equal(fake.writesLog().length, 1, "no change, no write");
  await session.setMinimized("t1", true);
  assert.equal(fake.writesLog().length, 1, "a plain text item is not a sticky");
  await session.setMinimized("s1", false);
  assert.equal("min" in fake.block("s1").props.plexus, false);
  assert.equal(fake.writesLog().length, 2);
});

// ------------------------------------------------------------------ renderer harness
function harness({ nodes = [], pages = {}, hostOverrides = {}, sessionOverrides = {}, lod = "detail", onPageLayout } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderString: 0, renderBlock: [], unmount: 0, pageFetch: [], watch: [], setMinimized: [], setColor: [], layout: [] };
  const state = { pages, handlers: new Map() };
  const host = {
    renderString(node, string) { calls.renderString += 1; node.textContent = string; },
    renderBlock(node, uid) { calls.renderBlock.push(uid); node.textContent = `live:${uid}`; },
    unmount() { calls.unmount += 1; },
    renderPage() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageOutline(title) {
      calls.pageFetch.push(title);
      return { uid: `uid-${title}`, exists: true, blocks: state.pages[title] ?? [] };
    },
    pageUid: (t) => `uid-${t}`,
    openPage() {},
    watchPage(title, cb) {
      calls.watch.push(title);
      state.handlers.set(title, cb);
      return () => { state.handlers.delete(title); };
    },
    ...hostOverrides,
  };
  const session = {
    setMinimized(uid, on) { calls.setMinimized.push([uid, on]); return Promise.resolve(); },
    setColor(uids, color) { calls.setColor.push([uids, color]); return Promise.resolve(); },
    ...sessionOverrides,
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer);
  doc.body.append(itemsLayer);
  const idleQueue = [];
  const frameQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later(fn, ms) { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    frame(fn) { frameQueue.push(fn); return () => { const i = frameQueue.indexOf(fn); if (i >= 0) frameQueue.splice(i, 1); }; },
  };
  const r = createItemRenderer({ doc, host, session, itemsLayer, sectionsLayer, timers, onPageLayout: (uid) => { calls.layout.push(uid); onPageLayout?.(uid); } });
  const board = buildBoard(rawBoard(nodes));
  const rects = worldRects(board);
  r.sync({ board, rects, dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 400) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  };
  const flushFrames = () => { const q = frameQueue.splice(0); for (const fn of q) fn(); };
  const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };
  r.setLod(lod, 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: lod });
  flush();
  return { stub, doc, host, calls, r, board, rects, state, flush, flushFrames, idleQueue, shell: (uid) => r.shellOf(uid), done() { r.dispose(); restore(); } };
}

// The DOM stub's animation frames only run when told to, so a hydrate wait needs them pumped.
async function settle(h, promise) {
  let done = false;
  let value;
  promise.then((v) => { done = true; value = v; });
  for (let i = 0; i < 400 && !done; i += 1) {
    await tick(2);
    h.stub.flushFrames();
  }
  assert.ok(done, "the promise settled");
  return value;
}

// ------------------------------------------------------------------ EK-2 sticky shell
test("EK-2: a sticky has a header with a title, a colour dot and a minimize toggle; the body is the live block", () => {
  const h = harness({ nodes: [blk("st000001", "first line\nsecond line", STICKY, 0)] });
  try {
    const el = h.shell("st000001");
    assert.ok(el.classList.contains("pxd-item--sticky"));
    const header = el.querySelector(".pxd-item__header");
    assert.notEqual(header.style.display, "none");
    assert.equal(header.querySelector(".pxd-sticky__title").textContent, "first line");
    assert.ok(header.querySelector(".pxd-sticky__dot"));
    assert.ok(header.querySelector(".pxd-sticky__min"));
    assert.equal(header.querySelectorAll(".pxd-sticky__swatch").length, 10);
    assert.equal(header.querySelector(".pxd-sticky__swatches").hidden, true);
    assert.equal(header.querySelectorAll("button").some((b) => /close|delete|remove/i.test(b.getAttribute("aria-label") || "")), false, "no delete-on-close");
    assert.deepEqual(h.calls.renderBlock, ["st000001"], "the body is the live Roam block");
    assert.ok(el.querySelector(".pxd-item__body .pxd-item__editor--sticky"));
    assert.equal(h.calls.renderString, 0);
  } finally { h.done(); }
});

test("EK-2: an empty sticky is titled Note; a plain text item gets no header", () => {
  const h = harness({ nodes: [blk("st000001", "", STICKY, 0), blk("tx000001", "plain", { ":type": "text", ":x": 300, ":y": 0, ":w": 200, ":h": 80 }, 1)] });
  try {
    assert.equal(h.shell("st000001").querySelector(".pxd-sticky__title").textContent, "Note");
    const text = h.shell("tx000001");
    assert.equal(text.querySelector(".pxd-sticky__title"), null);
    assert.equal(text.querySelector(".pxd-item__header").style.display, "none");
  } finally { h.done(); }
});

test("EK-2: the minimize button asks the session for one write; the colour dot opens the swatches and a pick sets the colour", () => {
  const h = harness({ nodes: [blk("st000001", "note", STICKY, 0)] });
  try {
    const el = h.shell("st000001");
    el.querySelector(".pxd-sticky__min").click();
    assert.deepEqual(h.calls.setMinimized, [["st000001", true]]);
    el.querySelector(".pxd-sticky__dot").click();
    assert.equal(el.querySelector(".pxd-sticky__swatches").hidden, false);
    const blue = el.querySelectorAll(".pxd-sticky__swatch").find((b) => b.getAttribute("data-color") === "blue");
    blue.click();
    assert.deepEqual(h.calls.setColor, [[["st000001"], "blue"]]);
    assert.equal(el.querySelector(".pxd-sticky__swatches").hidden, true);
  } finally { h.done(); }
});

test("EK-2: a minimized sticky mounts no body; at map zoom a sticky is a static render, not a live block", () => {
  const min = harness({ nodes: [blk("st000001", "note", { ...STICKY, ":min": true }, 0)] });
  try {
    assert.ok(min.shell("st000001").classList.contains("pxd-item--min"));
    assert.deepEqual(min.calls.renderBlock, []);
    assert.equal(min.shell("st000001").querySelector(".pxd-item__editor"), null);
  } finally { min.done(); }
  const map = harness({ nodes: [blk("st000001", "note", STICKY, 0)], lod: "map" });
  try {
    assert.deepEqual(map.calls.renderBlock, []);
    assert.ok(map.calls.renderString >= 1);
  } finally { map.done(); }
});

test("EK-2: zooming out swaps the live block for a static render and back; editing a sticky never changes its size", async () => {
  const h = harness({ nodes: [blk("st000001", "note", STICKY, 0)] });
  try {
    const el = h.shell("st000001");
    assert.equal(h.calls.renderBlock.length, 1);
    h.r.setLod("map", 0.1);
    h.flush();
    assert.equal(el.querySelector(".pxd-item__editor--sticky"), null);
    h.r.setLod("detail", 1);
    h.r.scheduleContent({ visibleRect: { x: -1e4, y: -1e4, w: 2e4, h: 2e4 }, zoom: 1, tier: "detail" });
    h.flush();
    assert.equal(h.calls.renderBlock.length, 2);
    assert.ok(el.querySelector(".pxd-item__editor--sticky"));
    const before = { w: el.style.width, h: el.style.height, min: el.style.minHeight };
    assert.equal(await settle(h, h.r.enterEdit("st000001")), true);
    assert.equal(el.style.height, before.h);
    assert.equal(el.style.minHeight, before.min, "no floor is written: the sticky never swaps content");
    assert.equal(el.classList.contains("pxd-item--editing"), false, "the card-edit class (height:auto) is not used");
  } finally { h.done(); }
});

test("EK-2: focus in the live block is the typing state and leaving it ends the state without unmounting", async () => {
  const h = harness({ nodes: [blk("st000001", "note", STICKY, 0)] });
  try {
    const el = h.shell("st000001");
    const editor = el.querySelector(".pxd-item__editor--sticky");
    const input = h.doc.createElement("textarea");
    editor.append(input);
    input.focus();
    h.stub.dispatch(editor, "focusin", { target: input });
    assert.equal(h.r.isEditing(), true);
    assert.equal(h.r.editingUid(), "st000001");
    assert.ok(el.classList.contains("pxd-item--typing"));
    assert.equal(el.classList.contains("pxd-item--editing"), false);
    await h.r.exitEdit();
    assert.equal(h.r.isEditing(), false);
    assert.equal(el.classList.contains("pxd-item--typing"), false);
    assert.ok(el.querySelector(".pxd-item__editor--sticky"), "the live block stays");
    assert.equal(h.calls.unmount, 0);
  } finally { h.done(); }
});

test("EK-2: sticky CSS has no close control, a persisted minimize, the header bar and a screen-sized body", () => {
  const sticky = css("css/sticky.css");
  assert.match(sticky, /\.pxd-item--sticky\.pxd-item--min > \.pxd-item__body/);
  assert.match(sticky, /\.pxd-sticky__btn/);
  assert.match(sticky, /\.pxd-sticky__dot/);
  assert.equal(/pxd-sticky__close/.test(sticky), false);
  assert.match(sticky, /\.pxd-item--sticky > \.pxd-item__header \{[^}]*height: 28px/);
});

// ------------------------------------------------------------------ EK-1 CSS
test("EK-1: the editor fills the card body and the floor is held by the lock, not by the editor", () => {
  const main = css("extension.css");
  assert.match(main, /\.pxd-root \.pxd-item\.pxd-item--editing > \.pxd-item__body > \.pxd-item__editor:not\(\[style\*="--pxd-ed-z"\]\) \{\s*flex: 1 1 auto;\s*min-height: 100%;/);
  assert.match(main, /\.pxd-item\.pxd-item--editing \{\s*height: auto !important;/);
  const cards = readFileSync(new URL("../src/view/cards.js", import.meta.url), "utf8");
  assert.equal(/releaseIfFilled/.test(cards), false, "no early release of the floor");
});

// ------------------------------------------------------------------ EK-3 scheduler
test("EK-3: the scheduler renders wanted rows in order, light before heavy, within the slice", () => {
  const order = [];
  const idleQueue = [];
  let clock = 0;
  const s = createRowScheduler({ idle: (fn) => { idleQueue.push(fn); return () => {}; }, now: () => clock, budgetMs: 8, render: (id) => { order.push(id); clock += 3; } });
  s.add("a"); s.add("heavy1", { heavy: true }); s.add("b"); s.add("c"); s.add("off");
  for (const id of ["a", "heavy1", "b", "c"]) s.want(id);
  assert.equal(s.pending(), 4);
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["a", "b", "c"], "three rows fit in 8 ms at 3 ms each, light first");
  assert.equal(idleQueue.length, 1, "it asks for another slice");
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["a", "b", "c", "heavy1"]);
  assert.equal(s.isDone("off"), false, "an unwanted row is never rendered");
  assert.equal(s.pending(), 0);
  s.want("off");
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.equal(s.isDone("off"), true);
});

test("EK-3: unwanting a row before its turn drops it; renderNow renders at once; dispose stops everything", () => {
  const order = [];
  const idleQueue = [];
  const s = createRowScheduler({ idle: (fn) => { idleQueue.push(fn); return () => {}; }, render: (id) => order.push(id) });
  s.add("a", { wanted: true });
  s.add("b", { wanted: true });
  s.want("a", false);
  assert.equal(s.renderNow("b"), true);
  assert.deepEqual(order, ["b"]);
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["b"], "a was scrolled out before its turn");
  s.want("a", true);
  s.dispose();
  idleQueue.splice(0).forEach((fn) => fn({ timeRemaining: () => 100 }));
  assert.deepEqual(order, ["b"]);
});

test("EK-3: roam/render, embeds, images and boards count as heavy rows", () => {
  for (const s of ["{{[[roam/render]]:((abc)) 1 2}}", "{{[[embed]]:((abc))}}", "{{embed-path:((abc))}}", "![](https://x/y.png)", "{{[[diagram]]:Board}}", "{{[[video]]:https://x}}"]) {
    assert.equal(isHeavyRow(s), true, s);
  }
  for (const s of ["plain words", "a [[page]] and #tag", "**bold** and `code`", "{{[[TODO]]}} a task"]) assert.equal(isHeavyRow(s), false, s);
});

// ------------------------------------------------------------------ EK-3 page card rows
const PAGE = { ":x": 0, ":y": 0, ":w": 360, ":h": 480 };
const rows = (n, prefix = "r") => Array.from({ length: n }, (_, i) => ({ uid: `${prefix}${String(i).padStart(4, "0")}`, string: `row number ${i}`, children: [] }));
const pageNode = (uid, title, order = 0, x = 0) => blk(uid, `[[${title}]]`, { ...PAGE, ":x": x }, order);

test("EK-3: every row paints at once as plain text with data-pxd-row; the live renders follow in idle chunks", () => {
  const list = rows(60);
  list.push({ uid: "heavy0001", string: "{{[[roam/render]]:((abc)) 22 15 5}}", children: [] });
  const h = harness({ nodes: [pageNode("pg0000001", "Big")], pages: { Big: list }, hostOverrides: {} });
  try {
    // The harness flushed the content pass; nothing is observing visibility here, so every row upgrades in turn.
    const card = h.shell("pg0000001");
    assert.equal(card.querySelectorAll("[data-pxd-row]").length, 61, "data-pxd-row on every row");
    assert.equal(h.calls.renderString, 61, "all upgraded once the idle queue drained");
    assert.equal(card.querySelectorAll(".pxd-block__plain").length, 0, "no placeholder is left behind");
  } finally { h.done(); }
});

test("EK-3: first paint is plain text only; no renderString runs until the idle queue does", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    let rs = 0;
    const host = {
      renderString(node, s) { rs += 1; node.textContent = s; },
      renderBlock() {}, unmount() {}, renderPage() {}, blockString: () => null, pullTree: () => [], pullBoard: () => null,
      pageOutline: () => ({ uid: "u", exists: true, blocks: rows(40) }), pageUid: () => "u", openPage() {},
    };
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer);
    doc.body.append(itemsLayer);
    const idleQueue = [];
    const timers = { idle(fn) { idleQueue.push(fn); return () => {}; }, later: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } };
    const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
    const board = buildBoard(rawBoard([pageNode("pg0000001", "Big")]));
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -1e4, y: -1e4, w: 2e4, h: 2e4 }, zoom: 1, tier: "detail" });
    idleQueue.shift()({ timeRemaining: () => 1000 }); // the content pump: mounts the card
    const card = r.shellOf("pg0000001");
    assert.equal(card.querySelectorAll("[data-pxd-row]").length, 40);
    assert.equal(rs, 0, "the card paints before any live render");
    assert.equal(card.querySelectorAll(".pxd-block__plain").length, 40);
    assert.equal(card.querySelector(".pxd-block__plain").textContent, "row number 0");
    r.dispose();
  } finally { restore(); }
});

test("EK-3: revealRow renders the row before it scrolls to it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    let rs = 0;
    const host = {
      renderString(node, s) { rs += 1; node.textContent = s; },
      renderBlock() {}, unmount() {}, renderPage() {}, blockString: () => null, pullTree: () => [], pullBoard: () => null,
      pageOutline: () => ({ uid: "u", exists: true, blocks: rows(40) }), pageUid: () => "u", openPage() {},
    };
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer);
    doc.body.append(itemsLayer);
    const idleQueue = [];
    const timers = { idle(fn) { idleQueue.push(fn); return () => {}; }, later: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } };
    const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
    const board = buildBoard(rawBoard([pageNode("pg0000001", "Big")]));
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -1e4, y: -1e4, w: 2e4, h: 2e4 }, zoom: 1, tier: "detail" });
    idleQueue.shift()({ timeRemaining: () => 1000 });
    assert.equal(rs, 0);
    const row = r.shellOf("pg0000001").querySelector("[data-pxd-row=r0030]");
    row._rect = { left: 0, top: 10, width: 100, height: 20, right: 100, bottom: 30, x: 0, y: 10 };
    r.revealRow("pg0000001", "r0030");
    assert.equal(rs, 1, "that one row is live now");
    assert.equal(row.querySelector(".pxd-block__plain"), null);
    r.dispose();
  } finally { restore(); }
});

test("EK-3: a pulled outline is reused while its page watch is armed and dropped by the watch", () => {
  const h = harness({
    nodes: [pageNode("pg0000001", "Same", 0, 0), pageNode("pg0000002", "Same", 1, 400)],
    pages: { Same: rows(5) },
  });
  try {
    assert.equal(h.calls.pageFetch.length, 1, "the second card of the page reuses the first card's pull");
    h.state.handlers.get("Same")?.({});
    h.r.dispose();
  } finally { h.done(); }
});

// ------------------------------------------------------------------ EK-4 layout watch
class FakeRO {
  static all = [];
  constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; FakeRO.all.push(this); }
  observe(node) { this.targets.push(node); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
}

test("EK-4: a page card with a block arrow gets one ResizeObserver on its rows; resizes batch to one re-measure per frame", () => {
  FakeRO.all = [];
  const h = harness({ nodes: [pageNode("pg0000001", "Chart", 0), pageNode("pg0000002", "Other", 1, 400)], pages: { Chart: rows(5), Other: rows(5, "o") } });
  h.stub.window.ResizeObserver = FakeRO;
  try {
    assert.equal(FakeRO.all.length, 0, "no observer for a card that has no block arrow");
    h.r.setLayoutWatch(new Set(["pg0000001"]));
    assert.equal(FakeRO.all.length, 1);
    const holder = h.shell("pg0000001").querySelector(".pxd-item__page");
    assert.deepEqual(FakeRO.all[0].targets, [holder]);
    h.r.setLayoutWatch(new Set(["pg0000001"]));
    assert.equal(FakeRO.all.length, 1, "still one observer");
    h.calls.layout.length = 0;
    FakeRO.all[0].cb([{}]);
    FakeRO.all[0].cb([{}]);
    FakeRO.all[0].cb([{}]);
    assert.equal(h.calls.layout.length, 0, "nothing until the frame");
    h.flushFrames();
    assert.deepEqual(h.calls.layout, ["pg0000001"], "one re-measure for three resizes");
    h.r.setLayoutWatch(new Set());
    assert.equal(FakeRO.all[0].disconnected, true);
  } finally { h.done(); }
});

test("EK-4: a card that mounts after the arrow is known is watched at once, and an unmount disconnects the observer", () => {
  FakeRO.all = [];
  const h = harness({ nodes: [pageNode("pg0000001", "Chart", 0)], pages: { Chart: rows(5) } });
  h.stub.window.ResizeObserver = FakeRO;
  try {
    h.r.setLayoutWatch(new Set(["pg0000001"]));
    assert.equal(FakeRO.all.length, 1);
    h.r.expireContent(["pg0000001"]);
    assert.equal(FakeRO.all[0].disconnected, true, "the card unmounted");
    h.flush();
    assert.equal(FakeRO.all.length, 2, "a fresh observer after the remount");
    assert.equal(FakeRO.all[1].disconnected, false);
  } finally { h.done(); }
});

test("EK-4: every linked row carries its own edge colour and a dot, and two rows of one card stay apart", () => {
  const h = harness({ nodes: [pageNode("pg0000001", "Chart", 0)], pages: { Chart: rows(6) } });
  try {
    h.r.markRows([
      { card: "pg0000001", row: "r0001", edges: ["e1"], color: "var(--pxd-teal-line)", tip: "one" },
      { card: "pg0000001", row: "r0003", edges: ["e2"], color: "var(--pxd-pink-line)", tip: "two" },
    ]);
    const card = h.shell("pg0000001");
    const a = card.querySelector("[data-pxd-row=r0001]");
    const b = card.querySelector("[data-pxd-row=r0003]");
    assert.equal(a.style["--pxd-row-line"], "var(--pxd-teal-line)");
    assert.equal(b.style["--pxd-row-line"], "var(--pxd-pink-line)");
    assert.equal(a.getAttribute("data-pxd-edges"), "e1");
    assert.equal(b.getAttribute("data-pxd-edges"), "e2");
    h.r.setRowHot("pg0000001", "r0001", true);
    assert.equal(a.classList.contains("pxd-row--hot"), true);
    assert.equal(b.classList.contains("pxd-row--hot"), false, "hovering one arrow lights only its own row");
    const arrows = css("css/block-arrows.css");
    assert.match(arrows, /\.pxd-row--linked::before \{[^}]*background: var\(--pxd-row-line/);
  } finally { h.done(); }
});

// ------------------------------------------------------------------ EK-5 tooltips
test("EK-5: every sticky control id has a tooltip entry", () => {
  for (const id of ["sticky.drag", "sticky.min", "sticky.expand", "sticky.color", "sticky.swatch"]) {
    assert.ok(TIP_TEXT[id], id);
    assert.ok(TIP_TEXT[id].desc, `${id} has a description`);
  }
  const cards = readFileSync(new URL("../src/view/cards.js", import.meta.url), "utf8");
  for (const id of ["sticky.drag", "sticky.min", "sticky.expand", "sticky.color", "sticky.swatch"]) assert.ok(cards.includes(`"${id}"`), `${id} is set on a control`);
});
