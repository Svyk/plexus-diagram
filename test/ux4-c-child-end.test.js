// UX4 lane C, C1: an arrow whose end is a child block of a note card. Folded: card-edge end plus a child mark and a
// badge dot; unfolded: the end is on the child row.
import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { blk, crumbLabels, realClick, show, testTree, tick } from "./fixtures/ux4-b.js";

const STRINGS = { kidT00001: "test", kidZ00001: "[[Todd Zenger]]", cardHE001: "This is a test", cardSR001: "src" };

function tree({ kids = false } = {}) {
  const card = (uid, x, extra = {}, children = []) => ({
    ":block/uid": uid, ":block/string": STRINGS[uid], ":block/order": 0, ":block/children": children,
    ":block/props": { ":plexus": { ":type": "card", ":x": x, ":y": 0, ":w": 260, ":h": 200, ...extra } },
  });
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      card("cardHE001", 0, kids ? { ":kids": true } : {}, testTree()),
      card("cardSR001", 600),
      blk("conn00001", "Connections", [
        { ...blk("edge00001", "((cardSR001)) → ((kidT00001))"), ":block/props": { ":plexus": { ":type": "edge", ":from": "cardSR001", ":to": "cardHE001", ":toBlock": "kidT00001" } } },
      ], { ":block/props": { ":plexus": { ":type": "edges" } } }),
    ],
  };
}

// Layout stand-in: the card, its body and the child row's line get boxes (zoom 1, camera at 0,0: screen = world).
function withLayout(stub) {
  const create = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag, ...rest) => {
    const el = create(tag, ...rest);
    Object.defineProperty(el, "_rect", {
      configurable: true,
      get() {
        const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
        if (el.classList.contains("pxd-item") && el.getAttribute("data-uid") === "cardHE001") return box(0, 0, 260, 200);
        if (el.classList.contains("pxd-item__body") && el.closest?.('.pxd-item[data-uid="cardHE001"]')) return box(0, 30, 260, 170);
        if (el.classList.contains("pxd-outline__line") && el.parentElement?.getAttribute?.("data-pxd-row") === "kidT00001") return box(20, 60, 180, 20);
        return undefined;
      },
    });
    return el;
  };
}

function mountChild({ kids = false, flags = {} } = {}) {
  noteSpeedFlags(flags);
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  withLayout(stub);
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(tree({ kids }));
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), mutations,
    on() { return () => {}; }, release() {}, setLinkMode() {},
    commitMove: rec("commitMove"), commitRects: rec("commitRects"), setKids: rec("setKids"), setBlockOpen: rec("setBlockOpen"),
    growToFit: rec("growToFit"), undo: rec("undo"), redo: rec("redo"), updateEdge: rec("updateEdge"), addEdge: rec("addEdge"), setString: rec("setString"),
  };
  const host = {
    graph: "Svy",
    renderString(el, string) { el.replaceChildren((el.ownerDocument || globalThis.document).createTextNode(string)); },
    renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }), pullTree: () => [],
    blockString: (uid) => STRINGS[uid] ?? null,
    openInSidebar: rec("openInSidebar"),
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.36.0" });
  const done = () => { try { view.dispose(); } catch { /* gone */ } restore(); noteSpeedFlags(null); };
  return { stub, view, session, mutations, root: view.root, done };
}

const edgeG = (f) => f.root.querySelector('.pxd-edge[data-uid="edge00001"]');
const card = (f) => f.root.querySelector('.pxd-item[data-uid="cardHE001"]');

test("C1: an arrow to a child of a folded card ends on the card edge with a child mark naming the child; flag off draws none", async () => {
  const f = mountChild();
  try {
    await show(f);
    const g = edgeG(f);
    assert.ok(g, "the edge is drawn");
    const marks = g.querySelectorAll(".pxd-edge__child");
    assert.equal(marks.length, 1);
    assert.equal(marks[0].getAttribute("data-end"), "to");
    assert.equal(marks[0].getAttribute("data-tip"), "edge.child");
    assert.equal(marks[0].getAttribute("data-tip-extra"), "test");
    assert.ok(Number(marks[0].getAttribute("r")) > 0);
  } finally { f.done(); }
  const off = mountChild({ flags: { childEndMark: false } });
  try {
    await show(off);
    assert.equal(edgeG(off).querySelectorAll(".pxd-edge__child").length, 0);
  } finally { off.done(); }
});

test("C1: selecting the arrow puts a dot in its colour on the folded card's Children badge; deselecting clears it", async () => {
  const f = mountChild();
  try {
    await show(f);
    const badge = card(f).querySelector(".pxd-kids");
    assert.ok(badge, "the folded card has its Children badge");
    realClick(f.stub, edgeG(f).querySelector(".pxd-edge__hit") || edgeG(f), { x: 500, y: 100 });
    await show(f);
    assert.ok(edgeG(f).getAttribute("class").includes("pxd-edge--selected"), "the arrow is selected");
    assert.ok(badge.classList.contains("pxd-kids--target"));
    assert.ok(String(badge.style.getPropertyValue?.("--pxd-kids-dot") || badge.style["--pxd-kids-dot"] || "").length > 0);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await show(f);
    assert.ok(!badge.classList.contains("pxd-kids--target"));
  } finally { f.done(); }
});

test("C1: clicking the child mark unfolds the card at that child under the crumb and writes nothing", async () => {
  const f = mountChild();
  try {
    await show(f);
    const mark = edgeG(f).querySelector(".pxd-edge__child");
    realClick(f.stub, mark, { x: 270, y: 100 });
    await show(f);
    await tick(20);
    await show(f);
    assert.deepEqual(crumbLabels(card(f)), ["This is a test", "test"]);
    assert.ok(card(f).querySelector('[data-pxd-row="kidT00001"]'), "the child row is shown");
    assert.deepEqual(f.mutations.filter((m) => !["commitRects", "growToFit"].includes(m[0])), []);
  } finally { f.done(); }
});

test("C1: an unfolded card's child row takes the arrow end at the row's middle, and the selected arrow marks the row", async () => {
  const f = mountChild({ kids: true });
  try {
    await show(f);
    const c = card(f);
    const row = c.querySelector('[data-pxd-row="kidT00001"]');
    assert.ok(row, "the child row is painted");
    const line = row.querySelector(".pxd-outline__line") || row;
    await show(f);
    const d = edgeG(f).querySelector(".pxd-edge__line").getAttribute("d");
    const nums = String(d).match(/-?\d+(\.\d+)?/g).map(Number);
    const endY = nums[nums.length - 1];
    assert.ok(Math.abs(endY - 70) < 0.6, `the arrow ends at the row middle: ${d}`);
    assert.equal(edgeG(f).querySelectorAll(".pxd-edge__child").length, 0, "no child mark when the row is shown");
    realClick(f.stub, edgeG(f).querySelector(".pxd-edge__hit") || edgeG(f), { x: 400, y: 70 });
    await show(f);
    assert.ok(line.classList.contains("pxd-row--target"), "the selected arrow's row has the target look");
  } finally { f.done(); }
});

test("C1: Alt+click on the arrow unfolds the folded card at the child; a plain click only selects", async () => {
  const f = mountChild();
  try {
    await show(f);
    const hit = edgeG(f).querySelector(".pxd-edge__hit") || edgeG(f);
    realClick(f.stub, hit, { x: 500, y: 100 });
    await show(f);
    assert.deepEqual(crumbLabels(card(f)), [], "a plain click does not unfold");
    const base = { clientX: 500, clientY: 100, pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, altKey: true };
    f.stub.dispatch(hit, "pointerdown", { ...base, buttons: 1 });
    f.stub.dispatch(hit, "mousedown", { ...base, buttons: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { ...base, buttons: 0 });
    f.stub.dispatch(hit, "mouseup", { ...base, buttons: 0 });
    f.stub.dispatch(hit, "click", { ...base, buttons: 0, detail: 1 });
    await show(f);
    await tick(20);
    await show(f);
    assert.deepEqual(crumbLabels(card(f)), ["This is a test", "test"]);
    assert.deepEqual(f.mutations.filter((m) => !["commitRects", "growToFit"].includes(m[0])), []);
  } finally { f.done(); }
});

// Browser default: a pointer press on a button focuses it unless mousedown was cancelled.
function pressLikeBrowser(stub, target) {
  const base = { clientX: 30, clientY: 30, pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
  const down = stub.dispatch(target, "pointerdown", { ...base, buttons: 1 });
  const mouse = stub.dispatch(target, "mousedown", { ...base, buttons: 1 });
  if (!down.defaultPrevented && !mouse.defaultPrevented) target.focus();
  stub.dispatch(target, "pointerup", { ...base, buttons: 0 });
  stub.dispatch(target, "mouseup", { ...base, buttons: 0 });
  stub.dispatch(target, "click", { ...base, buttons: 0, detail: 1 });
}

test("C4: after two clicks on the Children badge it does not hold focus, and Cmd+Z reaches the board undo", async () => {
  const f = mountChild();
  try {
    await show(f);
    f.root.focus();
    const badge = card(f).querySelector(".pxd-kids");
    pressLikeBrowser(f.stub, badge);
    await show(f);
    pressLikeBrowser(f.stub, card(f).querySelector(".pxd-kids"));
    await show(f);
    assert.notEqual(f.stub.document.activeElement?.className, "pxd-kids", "the badge keeps no focus after a pointer click");
    const undos = () => f.mutations.filter((row) => row[0] === "undo").length;
    const ev = f.stub.dispatch(f.stub.document.activeElement, "keydown", { key: "z", metaKey: true });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(undos(), 1);
  } finally { f.done(); }
});

test("C4: Cmd+Z with the badge focused from the keyboard still reaches the board undo", async () => {
  const f = mountChild();
  try {
    await show(f);
    const badge = card(f).querySelector(".pxd-kids");
    badge.focus();
    const ev = f.stub.dispatch(badge, "keydown", { key: "z", metaKey: true });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(f.mutations.filter((row) => row[0] === "undo").length, 1);
  } finally { f.done(); }
});
