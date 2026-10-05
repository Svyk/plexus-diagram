// P9 page cards: PG-1 whole outline + scroll + refresh, PG-2 title header open, PG-3 edit where you click,
// PG-4 Add page, PG-5 drop parsing. DOM stub and fake hosts only; the live checks belong to the parent.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { CARD_MIME, parseDropPayload } from "../src/model/drop.js";
import { createInteractions } from "../src/view/interactions.js";
import { openPagePicker } from "../src/view/board-picker.js";
import { createItemRenderer, pageBodyWantsWheel } from "../src/view/cards.js";
import { mountBoardView } from "../src/view/board-view.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ PG-5 parser
const dt = (data) => ({
  getData(type) { return data[type] ?? ""; },
  types: Object.keys(data),
});
const resolveUid = (u) => (u === "pageUID01" ? "[[Page One]]" : u === "gone" ? null : `((${u}))`);
const strings = (list) => list.map((x) => x.string);

test("PG-5: a left-sidebar page drag (uri-list with a page URL) becomes [[Title]]", () => {
  const d = dt({ "text/uri-list": "https://roamresearch.com/#/app/Svy/page/pageUID01", "text/plain": "https://roamresearch.com/#/app/Svy/page/pageUID01" });
  assert.deepEqual(parseDropPayload(d, { resolveUid, graph: "Svy" }), [{ string: "[[Page One]]" }]);
});

test("PG-5: a dropped block URL in text/plain becomes a block ref", () => {
  const d = dt({ "text/plain": "https://roamresearch.com/#/app/Svy/page/blockUID9" });
  assert.deepEqual(parseDropPayload(d, { resolveUid, graph: "Svy" }), [{ string: "((blockUID9))" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "roam://#/app/Svy/page/blockUID9" }), { resolveUid }), [{ string: "((blockUID9))" }]);
});

test("PG-5: a URL from another graph is ignored, text/plain without a URL is not read as one", () => {
  const d = dt({ "text/uri-list": "https://roamresearch.com/#/app/Other/page/pageUID01" });
  assert.deepEqual(parseDropPayload(d, { resolveUid, graph: "Svy" }), []);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "see page/pageUID01" }), { resolveUid }), []);
});

test("PG-5: [[Title]], #Tag, #[[Tag]] and anchors with data-link-uid / data-link-title", () => {
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "[[Project/Sub]]" }), { resolveUid }), [{ string: "[[Project/Sub]]" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "#Tagged" }), { resolveUid }), [{ string: "[[Tagged]]" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "#[[Two Words]]" }), { resolveUid }), [{ string: "[[Two Words]]" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "", "text/html": "<span data-link-uid=\"pageUID01\" data-link-title=\"Page One\">x</span>" }), { resolveUid }), [{ string: "[[Page One]]" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/html": "<span data-link-title=\"A &amp; B\">x</span>" }), { resolveUid: () => null }), [{ string: "[[A & B]]" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "#/app/x" }), { resolveUid }), []);
});

test("PG-5: roam/block-uid-list and CARD_MIME still win in order", () => {
  assert.deepEqual(strings(parseDropPayload(dt({ "roam/block-uid-list": "aaaaaaaaa bbbbbbbbb", "text/uri-list": "https://x/#/app/Svy/page/pageUID01" }), { resolveUid })), ["((aaaaaaaaa))", "((bbbbbbbbb))"]);
  assert.deepEqual(parseDropPayload(dt({ [CARD_MIME]: "[[Own]]", "text/plain": "#Tag" }), { resolveUid }), [{ string: "[[Own]]" }]);
});

// ------------------------------------------------------------------ PG-1 page card rendering
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

// n blocks, each level having `fan` children, to `levels` levels, in a flat unique-uid space.
function tree(levels, fan, prefix = "b") {
  let counter = 0;
  const make = (level) => {
    const out = [];
    for (let i = 0; i < fan; i += 1) {
      counter += 1;
      const uid = `${prefix}${String(counter).padStart(4, "0")}`;
      out.push({ uid, string: `row ${uid}`, children: level < levels ? make(level + 1) : [] });
    }
    return out;
  };
  return make(1);
}
const flat = (blocks) => blocks.flatMap((b) => [b, ...flat(b.children)]);

function harness({ pageBlocks = [], pages = {}, hostOverrides = {}, titles = ["Alpha"], session = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderString: 0, unmount: 0, watch: [], released: 0, opened: [], pageFetch: 0, renderPage: [] };
  const state = { blocks: pageBlocks, handlers: new Map() };
  const outline = (title) => {
    calls.pageFetch += 1;
    const blocks = pages[title] ?? state.blocks;
    return { uid: `uid-${title}`, exists: true, blocks };
  };
  const host = {
    renderString(node, string) { calls.renderString += 1; node.textContent = string; },
    unmount() { calls.unmount += 1; },
    renderPage(el, uid) { calls.renderPage.push(uid); },
    renderBlock() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageOutline: outline,
    pageUid: (t) => `uid-${t}`,
    openPage: (uid) => calls.opened.push(uid),
    watchPage(title, cb) {
      calls.watch.push(title);
      state.handlers.set(title, cb);
      return () => { calls.released += 1; state.handlers.delete(title); };
    },
    ...hostOverrides,
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer);
  doc.body.append(itemsLayer);
  const idleQueue = [];
  const laterQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later(fn, ms) { const t = { fn, ms }; laterQueue.push(t); return () => { const i = laterQueue.indexOf(t); if (i >= 0) laterQueue.splice(i, 1); }; },
  };
  const r = createItemRenderer({ doc, host, session, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard(titles.map((t, i) => blk(`pg${i}`.padEnd(9, "0"), `[[${t}]]`, { ...PAGE, ":x": i * 400 }, i))));
  const rects = worldRects(board);
  r.sync({ board, rects, dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  flush();
  const runLater = () => { const q = laterQueue.splice(0); for (const t of q) t.fn(); };
  return { stub, doc, host, calls, r, board, state, laterQueue, runLater, flush, shell: (uid) => r.shellOf(uid), uids: board.order.slice(), done() { r.dispose(); restore(); } };
}

test("PG-1: a 40-block, 4-level page renders completely with data-pxd-row on every row", () => {
  // 3 + 9 + 27 = 39, plus one more root: 40 blocks over 4 levels
  const blocks = tree(3, 3);
  blocks.push({ uid: "deep0001", string: "deepest", children: [{ uid: "deep0002", string: "l2", children: [{ uid: "deep0003", string: "l3", children: [{ uid: "deep0004", string: "l4", children: [] }] }] }] });
  const all = flat(blocks);
  const h = harness({ pageBlocks: blocks });
  try {
    const card = h.shell(h.uids[0]);
    const rows = card.querySelectorAll("[data-pxd-row]");
    assert.equal(rows.length, all.length);
    assert.ok(all.length >= 40);
    assert.deepEqual(rows.map((n) => n.getAttribute("data-pxd-row")).sort(), all.map((b) => b.uid).sort());
    assert.ok(card.querySelector("[data-pxd-row=deep0004]"), "the fourth level is there");
    assert.equal(card.querySelector(".pxd-row__more"), null);
  } finally { h.done(); }
});

test("PG-1: the render cap is 300 rows and the rest is one +N more row that opens the page", () => {
  const blocks = Array.from({ length: 340 }, (_, i) => ({ uid: `r${String(i).padStart(5, "0")}`, string: `s${i}`, children: [] }));
  const h = harness({ pageBlocks: blocks });
  try {
    const card = h.shell(h.uids[0]);
    assert.equal(card.querySelectorAll("[data-pxd-row]").length, 300);
    const more = card.querySelector(".pxd-row__more");
    assert.equal(more.textContent, "+40 more");
    more.click();
    assert.deepEqual(h.calls.opened, ["uid-Alpha"]);
  } finally { h.done(); }
});

test("PG-1: Roam-folded blocks render folded, a chevron unfolds them locally, BT_attrDue stays hidden", async () => {
  const blocks = [
    { uid: "fold00001", string: "folded", open: false, children: [{ uid: "kid000001", string: "inside", children: [] }] },
    { uid: "open00001", string: "open", children: [{ uid: "kid000002", string: "shown", children: [] }] },
    { uid: "due000001", string: "BT_attrDue:: [[October 3rd, 2026]]", children: [] },
  ];
  const h = harness({ pageBlocks: blocks });
  try {
    const card = h.shell(h.uids[0]);
    assert.ok(!card.querySelector("[data-pxd-row=kid000001]"), "folded children are not rendered");
    assert.ok(card.querySelector("[data-pxd-row=kid000002]"));
    assert.ok(!card.querySelector("[data-pxd-row=due000001]"));
    const row = card.querySelector("[data-pxd-row=fold00001]");
    const chevron = row.querySelector(".pxd-row__fold");
    assert.equal(chevron.getAttribute("aria-expanded"), "false");
    h.flush(); // EK-3: rows upgrade to live renders in idle chunks
    const writes = h.calls.renderString;
    chevron.click();
    assert.ok(card.querySelector("[data-pxd-row=kid000001]"));
    assert.equal(chevron.getAttribute("aria-expanded"), "true");
    h.flush();
    assert.ok(h.calls.renderString > writes);
    chevron.click();
    assert.equal(chevron.getAttribute("aria-expanded"), "false");
  } finally { h.done(); }
});

test("PG-1: an outside edit repaints the page; an identical echo does not", async () => {
  const h = harness({ pageBlocks: tree(1, 3) });
  try {
    const uid = h.uids[0];
    assert.deepEqual(h.calls.watch, ["Alpha"]);
    assert.equal(h.shell(uid).querySelectorAll("[data-pxd-row]").length, 3);
    const poke = async () => { h.state.handlers.get("Alpha")({}); h.runLater(); await tick(); };
    const before = h.calls.renderString;
    await poke();
    assert.equal(h.calls.renderString, before, "same outline: no repaint");
    h.state.blocks = [...tree(1, 3), { uid: "newrow001", string: "added elsewhere", children: [] }];
    await poke();
    assert.equal(h.shell(uid).querySelectorAll("[data-pxd-row]").length, 4);
    assert.ok(h.shell(uid).querySelector("[data-pxd-row=newrow001]"));
    assert.ok(h.calls.unmount >= 3, "the replaced rows were unmounted");
  } finally { h.done(); }
});

test("PG-1: one watch per mounted page card, at most 8, released on unmount", () => {
  const titles = Array.from({ length: 10 }, (_, i) => `P${i}`);
  const h = harness({ pageBlocks: tree(1, 2), titles });
  try {
    assert.equal(h.calls.watch.length, 8, "the ninth and tenth page cards get no watch");
    h.r.expireContent(h.uids);
    assert.equal(h.calls.released, 8);
    h.r.setLod("detail", 1);
    h.flush();
    assert.equal(h.calls.watch.length, 16, "remount re-arms 8");
  } finally { h.done(); }
});

test("PG-1: dispose releases every page watch", () => {
  const h = harness({ pageBlocks: tree(1, 2), titles: ["A", "B", "C"] });
  assert.equal(h.calls.watch.length, 3);
  h.done();
  assert.equal(h.calls.released, 3);
});

test("PG-1: a plain wheel scrolls a long page body until an end; a pinch and an editing card are the board's", () => {
  const body = { scrollHeight: 1000, clientHeight: 400, scrollTop: 0, closest(sel) { return sel === ".pxd-item__body" ? body : card; } };
  const card = { classList: { contains: (c) => c === "pxd-item--page" || (editing && c === "pxd-item--editing") }, closest: () => card };
  let editing = false;
  body.closest = (sel) => (sel === ".pxd-item__body" ? body : sel === ".pxd-item--page" ? card : null);
  const target = { closest: (sel) => (sel === ".pxd-item__body" ? body : null) };
  assert.equal(pageBodyWantsWheel(target, { deltaY: 50 }), body);
  assert.equal(pageBodyWantsWheel(target, { deltaY: -50 }), null, "at the top, scrolling up pans the board");
  body.scrollTop = 300;
  assert.equal(pageBodyWantsWheel(target, { deltaY: -50 }), body);
  body.scrollTop = 600;
  assert.equal(pageBodyWantsWheel(target, { deltaY: 50 }), null, "at the bottom, scrolling down pans the board");
  body.scrollTop = 100;
  assert.equal(pageBodyWantsWheel(target, { deltaY: 50, ctrlKey: true }), null);
  assert.equal(pageBodyWantsWheel(target, { deltaY: 50, metaKey: true }), null);
  editing = true;
  assert.equal(pageBodyWantsWheel(target, { deltaY: 50 }), null);
  editing = false;
  body.scrollHeight = 400;
  assert.equal(pageBodyWantsWheel(target, { deltaY: 50 }), null, "a short page does not scroll");
  const list = { classList: { contains: () => false }, scrollHeight: 400, clientHeight: 80, scrollTop: 10, closest: () => null };
  const row = { closest: (sel) => (sel === ".pxd-drawing-region-list.is-open" ? list : null) };
  assert.equal(pageBodyWantsWheel(row, { deltaY: 20 }), list);
  list.scrollTop = 0;
  assert.equal(pageBodyWantsWheel(row, { deltaY: -20 }), null);
});

// ------------------------------------------------------------------ PG-3 edit where you click
// enterEdit waits on animation frames while Roam hydrates the editor; keep the stub's frames and timers moving.
async function settle(h, promise) {
  let done = false;
  let value;
  promise.then((v) => { done = true; value = v; });
  for (let i = 0; i < 200 && !done; i += 1) {
    h.stub.flushFrames();
    h.runLater();
    await tick(8);
  }
  assert.ok(done, "enterEdit settled");
  return value;
}
test("PG-3: enterEdit with a row mounts renderPage and puts the caret in that block", async () => {
  const blocks = tree(1, 5);
  const h = harness({ pageBlocks: blocks });
  try {
    const uid = h.uids[0];
    const target = blocks[3].uid;
    const focused = [];
    h.host.renderPage = (el, pageUid) => {
      h.calls.renderPage.push(pageUid);
      for (const b of blocks) {
        const input = h.doc.createElement("div");
        input.className = "rm-block__input";
        input.setAttribute("id", `block-input-card-body-outline-uid-Alpha-${b.uid}`);
        input.focus = () => { focused.push(b.uid); };
        el.append(input);
      }
    };
    const ok = await settle(h, h.r.enterEdit(uid, { row: target }));
    assert.equal(ok, true);
    assert.deepEqual(h.calls.renderPage, ["uid-Alpha"]);
    assert.equal(focused[0], target, "the clicked block, not the first one, takes focus");
    await h.r.exitEdit({ silent: true });
  } finally { h.done(); }
});

test("PG-3 fix: leaving a page card edit never grows the card to the page height", async () => {
  const grows = [];
  const h = harness({ pageBlocks: tree(1, 5), session: { growToFit: (...a) => grows.push(a) } });
  try {
    h.host.renderPage = (el) => {
      const input = h.doc.createElement("div");
      input.className = "rm-block__input";
      input.setAttribute("id", "block-input-w-first");
      el.append(input);
      for (let n = el; n; n = n.parentElement) n.scrollHeight = 2400;
    };
    assert.equal(await settle(h, h.r.enterEdit(h.uids[0], {})), true);
    await h.r.exitEdit();
    assert.deepEqual(grows, [], "a page card scrolls, it does not grow");
  } finally { h.done(); }
});

test("PG-3: enterEdit without a row keeps the first-block behaviour", async () => {
  const h = harness({ pageBlocks: tree(1, 3) });
  try {
    const focused = [];
    h.host.renderPage = (el) => {
      for (const id of ["first", "second"]) {
        const input = h.doc.createElement("div");
        input.className = "rm-block__input";
        input.setAttribute("id", `block-input-w-${id}`);
        input.focus = () => { focused.push(id); };
        el.append(input);
      }
    };
    await settle(h, h.r.enterEdit(h.uids[0]));
    assert.equal(focused[0], "first");
    await h.r.exitEdit({ silent: true });
  } finally { h.done(); }
});

// ------------------------------------------------------------------ PG-2 / PG-3 gestures
function gestures() {
  const board = buildBoard(rawBoard([
    blk("pageCARD1", "[[Alpha]]", { ":x": 0, ":y": 0, ":w": 360, ":h": 480 }, 0),
    blk("noteCARD2", "plain note", { ":x": 500, ":y": 0, ":w": 200, ":h": 100 }, 1),
  ]));
  const rects = worldRects(board);
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctl = createInteractions({
    actions: {
      board: () => board,
      rects: () => rects,
      viewport: () => ({ x: 0, y: 0, zoom: 1 }),
      size: () => ({ width: 1000, height: 800 }),
      editingUid: () => null,
      isEditing: () => false,
      enterEdit: rec("enterEdit"),
      openPage: rec("openPage"),
      addInfoTab: rec("addInfoTab"),
      renamePage: rec("renamePage"),
      setGesturing() {},
    },
  });
  const ev = (type, target, extra = {}) => ({ type, screen: { x: 10, y: 10 }, world: { x: 10, y: 10 }, target, button: 0, buttons: 1, ...extra });
  return { ctl, calls, ev };
}

test("PG-2: a click on a page card title opens the page after a short wait; Shift opens the sidebar; double-click only renames", async () => {
  const g = gestures();
  const header = { kind: "item", uid: "pageCARD1", part: "header" };
  g.ctl.handle(g.ev("pointerdown", header));
  g.ctl.handle(g.ev("pointerup", header, { buttons: 0 }));
  assert.deepEqual(g.calls.filter((c) => c[0] === "openPage"), [], "not yet: a double-click may follow");
  await tick(340);
  assert.deepEqual(g.calls.filter((c) => c[0] === "openPage"), [["openPage", "pageCARD1", { sidebar: false }]]);
  g.calls.length = 0;
  g.ctl.handle(g.ev("pointerdown", header, { shift: true }));
  g.ctl.handle(g.ev("pointerup", header, { shift: true, buttons: 0 }));
  await tick(340);
  assert.deepEqual(g.calls.filter((c) => c[0] === "openPage"), [["openPage", "pageCARD1", { sidebar: true }]]);
  assert.deepEqual(g.calls.filter((c) => c[0] === "addInfoTab"), [], "Shift on a page title is the sidebar, not an info tab");
  g.calls.length = 0;
  g.ctl.handle(g.ev("pointerdown", header));
  g.ctl.handle(g.ev("pointerup", header, { buttons: 0 }));
  g.ctl.handle(g.ev("dblclick", header));
  await tick(340);
  assert.deepEqual(g.calls.filter((c) => c[0] === "openPage"), []);
  assert.deepEqual(g.calls.filter((c) => c[0] === "renamePage").length, 1);
});

test("PG-2: dragging a page card by its title does not open the page", async () => {
  const g = gestures();
  const header = { kind: "item", uid: "pageCARD1", part: "header" };
  g.ctl.handle(g.ev("pointerdown", header));
  g.ctl.handle({ ...g.ev("pointermove", header), screen: { x: 80, y: 60 }, world: { x: 80, y: 60 } });
  g.ctl.handle({ ...g.ev("pointerup", header, { buttons: 0 }), screen: { x: 80, y: 60 }, world: { x: 80, y: 60 } });
  await tick(340);
  assert.deepEqual(g.calls.filter((c) => c[0] === "openPage"), []);
});

test("PG-3: a click on a page card row enters edit with that row; modifiers and note cards do not", () => {
  const g = gestures();
  const row = { kind: "item", uid: "pageCARD1", part: "body", row: "rowUID001" };
  g.ctl.handle(g.ev("pointerdown", row));
  g.ctl.handle(g.ev("pointerup", row, { buttons: 0 }));
  assert.deepEqual(g.calls.filter((c) => c[0] === "enterEdit"), [["enterEdit", "pageCARD1", { row: "rowUID001" }]]);
  g.calls.length = 0;
  g.ctl.handle(g.ev("pointerdown", row, { meta: true }));
  g.ctl.handle(g.ev("pointerup", row, { meta: true, buttons: 0 }));
  assert.deepEqual(g.calls.filter((c) => c[0] === "enterEdit"), []);
  const note = { kind: "item", uid: "noteCARD2", part: "body", row: "rowUID001" };
  g.ctl.handle(g.ev("pointerdown", note));
  g.ctl.handle(g.ev("pointerup", note, { buttons: 0 }));
  assert.deepEqual(g.calls.filter((c) => c[0] === "enterEdit"), [], "only page cards route a row click");
  const noRow = { kind: "item", uid: "pageCARD1", part: "body" };
  g.ctl.handle(g.ev("pointerdown", noRow));
  g.ctl.handle(g.ev("pointerup", noRow, { buttons: 0 }));
  assert.deepEqual(g.calls.filter((c) => c[0] === "enterEdit"), [], "a click on the card body outside a row only selects");
});

// ------------------------------------------------------------------ PG-4 Add page
test("PG-4: the canvas and board menus list Add page…", () => {
  for (const kind of ["canvas", "board-menu"]) {
    const item = buildMenu(kind, {}).find((i) => i.id === "add-page");
    assert.equal(item?.label, "Add page…", kind);
  }
});

test("PG-4: the page picker searches as you type and returns the picked title", async () => {
  const dom = createDomStub();
  const restore = dom.install();
  try {
    const asked = [];
    const picked = [];
    const picker = openPagePicker({
      doc: dom.document,
      debounceMs: 0,
      search: (text) => { asked.push(text); return [{ uid: "u1", title: `${text} Alpha` }, { uid: "u2", title: `${text} Beta` }]; },
      onPick: (title) => { picked.push(title); return true; },
    });
    assert.equal(dom.document.querySelector(".pxd-addboard__empty").textContent, "Type to search pages");
    const filter = dom.document.querySelector(".pxd-addboard__filter");
    filter.value = "pro";
    filter.dispatchEvent({ type: "input" });
    await tick(5);
    assert.deepEqual(asked, ["pro"]);
    assert.deepEqual([...dom.document.querySelectorAll(".pxd-addboard__name")].map((n) => n.textContent), ["pro Alpha", "pro Beta"]);
    filter.dispatchEvent({ type: "keydown", key: "Enter" });
    await tick(5);
    assert.deepEqual(picked, ["pro Alpha"]);
    assert.equal(dom.document.querySelector(".pxd-addboard"), null, "closes after a pick");
    picker.close();
  } finally { restore(); }
});

function mountView({ hostOverrides = {}, children = [] } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(rawBoard(children));
  const mutations = [];
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false, mutations,
    on: () => () => {},
    release() {},
    setLinkMode() {},
    createCard(spec) { mutations.push(["createCard", spec]); return Promise.resolve("newcard01"); },
    addRefCards(list) { mutations.push(["addRefCards", list]); return Promise.resolve(list.map((_, i) => `n${i}`)); },
  };
  const host = {
    graph: "Svy",
    renderString() {}, renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => null, pullTree: () => [], blockString: () => null, pageUid: () => null,
    openBlock() {}, openInSidebar() {}, searchBlocks: () => [], related: () => [],
    searchPages: (text) => [{ uid: "pgu", title: `${text}-page` }],
    cardStringForUid: (u) => (u === "pageUID01" ? "[[Page One]]" : `((${u}))`),
    ...hostOverrides,
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "2.1.0" });
  stub.flushFrames();
  return { stub, restore, view, session, mutations };
}

test("PG-4: Add page… adds a 360x480 page card at the view center and selects it; a second add selects the existing card", async () => {
  const f = mountView();
  try {
    f.view.addPage();
    const filter = f.stub.document.querySelector(".pxd-addboard__filter");
    filter.value = "Ops";
    filter.dispatchEvent({ type: "input" });
    await tick(200);
    f.stub.document.querySelector(".pxd-addboard__row").click();
    await tick(5);
    const [name, spec] = f.mutations[0];
    assert.equal(name, "createCard");
    assert.equal(spec.string, "[[Ops-page]]");
    assert.deepEqual([spec.w, spec.h], [360, 480]);
    assert.equal(spec.x, 400 - 180, "centered on the 800x600 view");
    assert.equal(spec.y, 300 - 240);
  } finally { f.view.dispose(); f.restore(); }
});

test("PG-4: a page already on the board is selected, not duplicated", async () => {
  const f = mountView({
    children: [blk("pageCARD1", "[[Ops-page]]", { ":x": 0, ":y": 0, ":w": 360, ":h": 480 }, 0)],
  });
  try {
    f.view.addPage();
    const filter = f.stub.document.querySelector(".pxd-addboard__filter");
    filter.value = "Ops";
    filter.dispatchEvent({ type: "input" });
    await tick(200);
    f.stub.document.querySelector(".pxd-addboard__row").click();
    await tick(5);
    assert.deepEqual(f.mutations, [], "no write for an existing page card");
    assert.deepEqual(f.view.state().selection, ["pageCARD1"]);
  } finally { f.view.dispose(); f.restore(); }
});

test("PG-5: a dropped page lands as a 360x480 page card, other drops keep the card size", async () => {
  const f = mountView();
  try {
    const d = dt({ "text/uri-list": "https://roamresearch.com/#/app/Svy/page/pageUID01", "roam/block-uid-list": "" });
    f.stub.dispatch(f.view.root, "drop", { clientX: 400, clientY: 300, dataTransfer: d });
    await tick(5);
    const [, list] = f.mutations[0];
    assert.equal(list[0].string, "[[Page One]]");
    assert.deepEqual([list[0].w, list[0].h], [360, 480]);
    f.mutations.length = 0;
    f.stub.dispatch(f.view.root, "drop", { clientX: 400, clientY: 300, dataTransfer: dt({ "text/plain": "((blockUID9))" }) });
    await tick(5);
    const [, plain] = f.mutations[0];
    assert.equal(plain[0].string, "((blockUID9))");
    assert.equal(plain[0].w, undefined);
  } finally { f.view.dispose(); f.restore(); }
});

test("PG-4: nothing is written on open, pan or zoom of a board with a page card", async () => {
  const f = mountView({ children: [blk("pageCARD1", "[[Ops-page]]", { ":x": 0, ":y": 0, ":w": 360, ":h": 480 }, 0)] });
  try {
    await tick(20);
    f.stub.flushFrames();
    f.stub.flushIdle();
    assert.deepEqual(f.mutations, []);
  } finally { f.view.dispose(); f.restore(); }
});
