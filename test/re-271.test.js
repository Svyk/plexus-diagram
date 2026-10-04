// 2.7.1 rough edges: RE-1 completion path, RE-2 chrome-aware placement, RE-3 zoomed-out task marks, RE-4 arrow pill,
// RE-5 light task checkbox. A fake window.RoamExtensionTools stands in for Better Tasks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { screenPx } from "../src/model/geometry.js";
import { createBt } from "../src/host/bt.js";
import { setTaskAttrNames } from "../src/model/tasks.js";
import { placePopover } from "../src/relchips.js";
import { chromeObstacles, placeNearAnchor, pointAnchor } from "../src/view/avoid.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createTaskCompleter } from "../src/view/task-complete.js";
import { createTaskPopover } from "../src/view/task-popover.js";
import { mountKanban } from "../src/view/kanban-view.js";
import { createMenu } from "../src/view/menu.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => setTaskAttrNames(null));

const R = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top });
const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const spanOf = (p, h) => ({ left: p.left, top: p.top, right: p.left + p.width, bottom: p.top + (p.maxHeight ?? h) });

// ------------------------------------------------------------------ RE-2 placement with obstacles
const vp = { left: 0, top: 0, right: 1000, bottom: 800 };
const size = { w: 240, h: 200 };
const dock = { left: 300, top: 740, right: 700, bottom: 790 };
const bar = { left: 0, top: 0, right: 1000, bottom: 48 };

test("RE-2 placePopover without obstacles is the PO-3 placement", () => {
  const anchor = { left: 100, top: 100, right: 300, bottom: 140 };
  assert.deepEqual(placePopover({ anchor, size, viewport: vp, obstacles: [] }), placePopover({ anchor, size, viewport: vp }));
  assert.deepEqual(placePopover({ anchor, size, viewport: vp, obstacles: [dock] }), placePopover({ anchor, size, viewport: vp }), "a dock that is out of the way changes nothing");
});

test("RE-2 a chip just above the dock gets a popover that does not cover the dock", () => {
  const tall = { ...vp, bottom: 1000 };
  const anchor = { left: 400, top: 700, right: 460, bottom: 718 };
  const plain = placePopover({ anchor, size, viewport: tall });
  assert.equal(plain.side, "below", "the plain placer fits below (718+8+200 < 992)");
  const p = placePopover({ anchor, size, viewport: tall, obstacles: [dock] });
  assert.ok(!hits(spanOf(p, size.h), dock), "clear of the dock (slid beside it or flipped above)");
  assert.ok(!hits(spanOf(p, size.h), anchor), "clear of the chip");
});

test("RE-2 a popover under the board bar slides or flips clear of it", () => {
  const anchor = { left: 20, top: 60, right: 90, bottom: 78 };
  const p = placePopover({ anchor, size, viewport: vp, obstacles: [bar, { left: 0, top: 48, right: 40, bottom: 400 }] });
  assert.ok(!hits(spanOf(p, size.h), bar));
  assert.ok(!hits(spanOf(p, size.h), { left: 0, top: 48, right: 40, bottom: 400 }), "and clear of the rail on the left");
});

test("RE-2 when nothing fits whole, the roomiest clear strip scrolls", () => {
  const anchor = { left: 400, top: 395, right: 460, bottom: 413 };
  const walls = [{ left: 0, top: 0, right: 1000, bottom: 300 }, { left: 0, top: 500, right: 1000, bottom: 800 }];
  const p = placePopover({ anchor, size: { w: 240, h: 600 }, viewport: vp, obstacles: walls });
  assert.equal(p.scroll, true);
  assert.ok(p.maxHeight >= 80 && p.maxHeight <= 200, `shrunk into the 200 px strip, got ${p.maxHeight}`);
  assert.ok(!walls.some((w) => hits(spanOf(p, 600), w)), "clear of both walls");
});

test("RE-2 chromeObstacles lists the visible chrome only", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const mk = (cls, rect, hidden) => {
      const n = doc.createElement("div");
      n.className = cls;
      n._rect = rect;
      if (hidden) n.style.display = "none";
      root.append(n);
      return n;
    };
    mk("pxd-toolbar pxd-chrome", R(0, 0, 1000, 48));
    mk("pxd-palette pxd-dock pxd-chrome", R(300, 740, 700, 790));
    mk("pxd-rail pxd-chrome", R(960, 60, 1000, 300), true);
    mk("pxd-minimap pxd-chrome", R(800, 600, 1000, 800));
    mk("pxd-props pxd-chrome", R(0, 0, 0, 0));
    mk("pxd-panel pxd-chrome", R(700, 48, 1000, 600));
    const rects = chromeObstacles(root, { win: stub.window });
    assert.equal(rects.length, 4, "toolbar, dock, minimap, panel: the hidden rail and the empty props panel are skipped");
  } finally { restore(); }
});

test("RE-2 the task chip popover opens clear of the dock, and a project list that loads later re-places it", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    root._rect = R(0, 0, 1000, 800);
    doc.body.append(root);
    const dockEl = doc.createElement("div");
    dockEl.className = "pxd-palette pxd-dock pxd-chrome";
    dockEl._rect = R(300, 740, 700, 790);
    root.append(dockEl);
    const anchor = doc.createElement("button");
    anchor._rect = R(400, 700, 460, 718);
    root.append(anchor);
    const bt = createBt({ win: { RoamExtensionTools: { "better-tasks": { tools: [
      { name: "bt_modify", execute: async () => ({}) },
      { name: "bt_get_projects", execute: async () => ({ projects: [{ name: "EMP" }] }) },
    ] } } } });
    const pop = createTaskPopover({ doc, root, bt });
    assert.equal(pop.open("task00001", "due", anchor), true);
    const node = root.querySelector(".pxd-task-pop");
    node._rect = R(0, 0, 240, 200);
    pop.close();
    pop.open("task00001", "due", anchor);
    const again = root.querySelector(".pxd-task-pop");
    again._rect = R(0, 0, 240, 200);
    const at = placeNearAnchor(again, anchor.getBoundingClientRect(), root, { gap: 6 });
    const box = { left: Number.parseInt(again.style.left, 10), top: Number.parseInt(again.style.top, 10) };
    box.right = box.left + 240;
    box.bottom = box.top + (at.maxHeight ?? 200);
    assert.ok(!hits(box, { left: 300, top: 740, right: 700, bottom: 790 }), "the popover does not cover the dock");
  } finally { restore(); }
});

test("RE-2 a card menu that would open under the dock moves clear of it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    root._rect = R(0, 0, 1000, 800);
    doc.body.append(root);
    const dockEl = doc.createElement("div");
    dockEl.className = "pxd-palette pxd-dock pxd-chrome";
    dockEl._rect = R(300, 700, 700, 790);
    root.append(dockEl);
    const menu = createMenu({ doc, root, on: {} });
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, label: `Item ${i}` }));
    // Opened at (320, 690) the default spot (below the pointer) is inside the dock's rect (the stub measures no menu size,
    // so the placer uses its 180 x 120 fallback).
    assert.equal(menu.open({ x: 320, y: 690, items }), true);
    const el = menu.el;
    const box = { left: Number.parseInt(el.style.left, 10), top: Number.parseInt(el.style.top, 10) };
    box.right = box.left + 180;
    box.bottom = box.top + 120;
    assert.ok(!hits(box, { left: 300, top: 700, right: 700, bottom: 790 }), `menu at ${box.left},${box.top} is clear of the dock`);
    menu.dispose();
  } finally { restore(); }
});

// ------------------------------------------------------------------ RE-3 marks in screen pixels
test("RE-3 screenPx is world px per screen px with no 4x clamp", () => {
  assert.equal(screenPx(1), 1);
  assert.equal(screenPx(0.5), 2);
  assert.equal(screenPx(0.13), 7.6923);
  assert.equal(screenPx(0.35), 2.8571);
  assert.equal(screenPx(2), 0.5);
});

test("RE-3 zoomed-out task marks: 20 px or more, due 11 px or more, status colours on the mark", async () => {
  const css = await readFile(new URL("../src/css/task.css", import.meta.url), "utf8");
  const sizes = [...css.matchAll(/font-size:\s*calc\((\d+)px \* var\(--pxd-screen-px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.some((n) => n >= 20), "the map mark is 20 px or more on screen");
  assert.match(css, /pxd-lod-overview[^{]*> \.pxd-item__header::before \{[^}]*width: calc\((\d+)px \* var\(--pxd-screen-px/, "the overview box is drawn in screen pixels");
  const box = /pxd-lod-overview[^{]*> \.pxd-item__header::before \{[^}]*width: calc\((\d+)px/.exec(css);
  assert.ok(Number(box[1]) >= 20, "the overview box is 20 px or more on screen");
  assert.ok(sizes.includes(11), "the due text is 11 px on screen");
  assert.match(css, /pxd-lod-map \.pxd-item\.pxd-item--task-overdue[^{]*> \.pxd-item__header::before \{\s*color: var\(--pxd-red-text/);
  assert.match(css, /pxd-lod-map \.pxd-item\.pxd-item--task-today[^{]*> \.pxd-item__header::before \{\s*color: var\(--pxd-accent\)/);
  assert.match(css, /pxd-lod-overview \.pxd-item\.pxd-item--card\.pxd-item--task-overdue[^{]*> \.pxd-item__header \{\s*color: var\(--pxd-red-text/);
  for (const glyph of ["2610", "2611", "2612", "2713", "2715"]) assert.match(css, new RegExp(`content: "\\\\${glyph}"`));
});

// ------------------------------------------------------------------ RE-4 pill inside the card
const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids });

function pillLayer(cardW) {
  const stub = createDomStub();
  const doc = stub.document;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const labels = doc.createElement("div");
  doc.body.append(svg, over, labels);
  const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over, blockText: () => "14:40 - 19:00 (**long shift**) cleanup and handoff" });
  const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
    raw("c1", "a note", plx({ x: 0, y: 0, w: 100, h: 60 }), [], 0),
    raw("c2", "[[Page]]", plx({ x: 400, y: 0, w: cardW, h: 480 }), [], 1),
    raw("ec", "Connections", plx({ type: "edges" }), [raw("e12", "((c1)) → ((row1))", plx({ type: "edge", from: "c1", to: "c2", toBlock: "row1" }))], 2),
  ]));
  return { stub, layer, svg, board, rects: worldRects(board) };
}
const measure = new Map([["e12", { to: { rowTop: 900, rowHeight: 20, bodyTop: 30, bodyBottom: 480, rowLeft: 16, rowRight: 100 } }]]);

test("RE-4 the clamped pill is never wider than the card minus 16 screen px, ends in an ellipsis, and sits inside the edge", () => {
  for (const [cardW, zoom] of [[360, 1], [120, 1], [120, 0.5], [200, 2]]) {
    const f = pillLayer(cardW);
    const restore = f.stub.install();
    try {
      f.layer.render({ board: f.board, rects: f.rects, zoom });
      f.layer.setMeasures(measure);
      f.layer.update({ board: f.board, edgeUids: new Set(["e12"]), rects: f.rects, zoom });
      const bend = f.svg.querySelector(".pxd-edge__bend--clamped");
      assert.ok(bend, `clamped at ${cardW}/${zoom}`);
      const pill = bend.querySelector(".pxd-edge__bend-pill");
      const width = Number(pill.getAttribute("width"));
      const cardScreen = cardW * zoom;
      assert.ok(width <= Math.max(40, cardScreen - 16), `pill ${width} fits card ${cardScreen} - 16`);
      const x = Number(pill.getAttribute("x"));
      assert.ok(x >= 0 || x + width <= 0, "the pill does not cover the marker dot");
      assert.ok(x + width <= cardScreen && x >= -cardScreen, "inside the card width on the screen scale");
      const text = bend.querySelector(".pxd-edge__bend-text").textContent;
      if (width < 40 + 6 * text.length) assert.ok(text.length > 0);
      assert.equal(bend.getAttribute("transform").includes(`scale(${screenPx(zoom)})`), true, "screen-constant size");
      if (cardScreen < 330) assert.match(text, /\u2026$/);
      assert.ok(text.startsWith("\u2193") || text.startsWith("\u2191"));
    } finally { restore(); }
  }
});

// ------------------------------------------------------------------ RE-5 light checkbox, RE-1 completion
const kid = (string, uid = "k") => ({ ":block/uid": uid, ":block/string": string, ":block/children": [] });
const blk = (uid, string, plexus, order, children = []) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": plexus ? { ":plexus": plexus } : {}, ":block/children": children });

function fakeBt({ failComplete = false } = {}) {
  const calls = [];
  const tools = [
    { name: "bt_get_attributes", execute: async () => ({ surface: "Child", attributes: [{ id: "due", name: "BT_attrDue", aliases: [] }] }) },
    { name: "bt_modify", execute: async (a) => { calls.push(["bt_modify", a]); return failComplete ? { error: "nope" } : { uid: a.uid }; } },
  ];
  return { calls, win: { RoamExtensionTools: { "better-tasks": { tools } } } };
}

function cardHarness({ children, bt = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderBlock: [], renderString: [] };
  const host = {
    renderString(node, string) { calls.renderString.push(string); node.textContent = string; },
    renderBlock(node, uid, opts) { calls.renderBlock.push([uid, opts]); node.textContent = `live:${uid}`; },
    unmount() {}, blockString: () => null, pullTree: () => [], pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const sectionsLayer = doc.createElement("div");
  const itemsLayer = doc.createElement("div");
  root.append(sectionsLayer);
  root.append(itemsLayer);
  const idleQueue = [];
  const timers = { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } };
  const r = createItemRenderer({ doc, host, session: { setKids: async () => {} }, itemsLayer, sectionsLayer, timers, bt, onTaskChip() {} });
  const board = buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": children });
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setShowBadges(true);
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -10000, y: -10000, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
  let guard = 0;
  while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10, didTimeout: false });
  r.setBadges(new Map());
  return { stub, restore, doc, root, r, calls };
}

test("RE-5 forty task cards at rest mount no real block render and no input checkbox", () => {
  const tasks = Array.from({ length: 40 }, (_, i) => blk(`task${String(i).padStart(5, "0")}`, `{{[[${i % 5 === 0 ? "DONE" : "TODO"}]]}} task ${i}`, { ":x": (i % 8) * 300, ":y": Math.floor(i / 8) * 200, ":w": 280, ":h": 160 }, i, [kid("BT_attrDue:: [[October 5th, 2026]]", `due${String(i).padStart(6, "0")}`)]));
  const h = cardHarness({ children: tasks, bt: createBt({ win: fakeBt().win }) });
  try {
    assert.equal(h.calls.renderBlock.length, 0, "no renderBlock at rest");
    assert.equal(h.root.querySelectorAll("input").length, 0, "no checkbox input");
    assert.equal(h.root.querySelectorAll(".pxd-task-check").length, 40);
    assert.equal(h.root.querySelectorAll(".pxd-task-check--done").length, 8, "every fifth task is DONE");
    assert.equal(h.root.querySelector(".pxd-task-check").getAttribute("role"), "checkbox");
  } finally { h.restore(); }
});

test("RE-5 without Better Tasks a task card keeps Roam's own rendering and no light checkbox", () => {
  const h = cardHarness({ children: [blk("task00001", "{{[[TODO]]}} ship", { ":x": 0, ":y": 0, ":w": 280, ":h": 160 }, 0)] });
  try {
    assert.equal(h.root.querySelectorAll(".pxd-task-check").length, 0);
    assert.deepEqual(h.calls.renderString, ["{{[[TODO]]}} ship"]);
  } finally { h.restore(); }
});

function holderHarness({ stateAfterClick = "DONE", renderThrows = false, noCheckbox = false } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  doc.body.append(root);
  const log = [];
  let string = "{{[[TODO]]}} weekly review";
  const host = {
    blockString: () => string,
    renderBlock(node, uid, opts) {
      if (renderThrows) throw new Error("render failed");
      log.push(["renderBlock", uid, opts]);
      if (noCheckbox) return;
      const label = doc.createElement("label");
      label.className = "check-container";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.click = () => { log.push(["click"]); string = `{{[[${stateAfterClick}]]}} weekly review`; };
      label.append(input);
      node.append(label);
    },
    unmount() { log.push(["unmount"]); },
  };
  const win = {
    PointerEvent: class { constructor(type, init) { this.type = type; this.init = init; } },
  };
  const bt = createBt({ win: fakeBt().win });
  const completer = createTaskCompleter({ doc, getRoot: () => root, host, bt, win });
  // the stub's dispatchEvent reads ev.type; record the pointerdown before the click
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const n = origCreate(tag);
    if (tag === "input") {
      const base = n.dispatchEvent;
      n.dispatchEvent = (ev) => { log.push(["event", ev.type, ev.init?.bubbles]); return base ? base(ev) : true; };
    }
    return n;
  };
  return { root, log, completer, restore, setString: (s) => { string = s; } };
}

test("RE-1 complete renders the task closed in a hidden holder, sends pointerdown then click to its checkbox, and unmounts", async () => {
  const h = holderHarness();
  try {
    const res = await h.completer.complete("task00001");
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(h.log.map((e) => e[0] === "event" ? `${e[0]}:${e[1]}` : e[0]), ["renderBlock", "event:pointerdown", "click", "unmount"]);
    assert.deepEqual(h.log[0], ["renderBlock", "task00001", { open: false }]);
    assert.equal(h.log[1][2], true, "the pointerdown bubbles to Better Tasks' document listener");
    assert.equal(h.root.querySelectorAll(".pxd-task-holder").length, 0, "holder removed");
  } finally { h.restore(); }
});

test("RE-1 a second call while one runs shares it, so one click means one spawn", async () => {
  const h = holderHarness();
  try {
    const a = h.completer.complete("task00001");
    const b = h.completer.complete("task00001");
    assert.equal(a, b);
    await a;
    assert.equal(h.log.filter((e) => e[0] === "click").length, 1);
  } finally { h.restore(); }
});

test("RE-1 an already DONE task is left alone; a missing checkbox or a block that never turns DONE reports failure", async () => {
  const done = holderHarness();
  try {
    done.setString("{{[[DONE]]}} weekly review");
    assert.deepEqual(await done.completer.complete("task00001"), { ok: true, already: true });
    assert.equal(done.log.length, 0);
  } finally { done.restore(); }
  const never = holderHarness({ stateAfterClick: "TODO" });
  try {
    const res = await never.completer.complete("task00001");
    assert.equal(res.ok, false);
    assert.equal(never.root.querySelectorAll(".pxd-task-holder").length, 0, "holder removed on failure too");
  } finally { never.restore(); }
  const thrown = holderHarness({ renderThrows: true });
  try {
    assert.equal((await thrown.completer.complete("task00001")).ok, false);
    assert.equal(thrown.root.querySelectorAll(".pxd-task-holder").length, 0);
  } finally { thrown.restore(); }
});

test("RE-1 Kanban Done runs the checkbox path first; its failure falls back to bt_modify, then to the marker", async () => {
  const run = async (completeTask, bt) => {
    const stub = createDomStub();
    const root = stub.document.createElement("div");
    const board = { order: ["c1"], items: new Map([["c1", { uid: "c1", type: "card", kind: "note", parentUid: "b", string: "{{[[TODO]]}} Wash", title: "Wash", content: [] }]]) };
    const writes = [];
    const host = { group: (fn) => fn(), updateString: (uid, string) => { writes.push([uid, string]); } };
    const view = mountKanban({ doc: stub.document, root, host, bt, completeTask, getBoard: () => board });
    view.open();
    root.querySelector(".pxd-kanban__card").dispatchEvent({ type: "pointerdown" });
    [...root.querySelectorAll(".pxd-kanban__column")].find((col) => col.getAttribute("data-column") === "Done").dispatchEvent({ type: "pointerup" });
    await new Promise((r) => setTimeout(r, 0));
    view.dispose();
    return writes;
  };
  const f = fakeBt();
  const asked = [];
  assert.deepEqual(await run(async (uid) => { asked.push(uid); return { ok: true }; }, createBt({ win: f.win })), []);
  assert.deepEqual(asked, ["c1"]);
  assert.equal(f.calls.length, 0, "bt_modify not needed when the checkbox path worked");
  const g = fakeBt();
  await run(async () => ({ ok: false, reason: "x" }), createBt({ win: g.win }));
  assert.deepEqual(g.calls.map((c) => c[1]), [{ uid: "c1", status: "DONE" }], "falls back to bt_modify");
  assert.deepEqual(await run(async () => ({ ok: false }), null), [["c1", "{{[[DONE]]}} Wash"]], "then to the marker");
});
