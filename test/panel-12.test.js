import assert from "node:assert/strict";
import test from "node:test";

import { createPanel } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const timers = { later: () => () => {}, frame: () => () => {} };

function setup(on = {}, host = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const baseline = stub.listenerCount();
  const panel = createPanel({ doc: stub.document, root, host, timers, on });
  return { stub, restore, root, panel, baseline };
}
const q = (root, sel) => root.querySelector(sel);
const classes = (node) => String(node.className).split(/\s+/);
const tabs = (f) => f.root.querySelectorAll(".pxd-panel__tab");
const tab = (f, name) => tabs(f).find((b) => b.dataset.tab === name);
const shown = (f) => f.root.querySelectorAll(".pxd-panel__pane").filter((p) => p.style.display !== "none").map((p) => classes(p).find((c) => c.startsWith("pxd-panel__pane--")));

const BOARDS = [
  { uid: "b1", title: "Roadmap", page: "Projects/Plexus", count: 12 },
  { uid: "b2", title: "Reading list", page: "Notes", count: 1 },
  { uid: "b3", title: "Scratch", page: "Daily", count: 0 },
];

test("the panel has Search, Related, Boards and Outline tabs in that order", (t) => {
  const f = setup();
  t.after(f.restore);
  assert.deepEqual(tabs(f).map((b) => b.textContent), ["Search", "Related", "Boards", "Outline"]);
  assert.deepEqual(tabs(f).map((b) => b.dataset.tab), ["search", "related", "boards", "outline"]);
  assert.deepEqual(shown(f), ["pxd-panel__pane--search"]);
  assert.deepEqual(tabs(f).filter((b) => classes(b).includes("pxd-panel__tab--on")).map((b) => b.dataset.tab), ["search"]);
});

test("clicking a tab shows only its pane and marks it on", (t) => {
  const f = setup({ listBoards: () => Promise.resolve([]), getOutline: () => [] });
  t.after(f.restore);
  f.panel.open();
  for (const [name, pane] of [["boards", "boards"], ["outline", "outline"], ["related", "related"], ["search", "search"]]) {
    tab(f, name).click();
    assert.deepEqual(shown(f), [`pxd-panel__pane--${pane}`], name);
    assert.deepEqual(tabs(f).filter((b) => classes(b).includes("pxd-panel__tab--on")).map((b) => b.dataset.tab), [name]);
    assert.equal(f.panel.currentTab(), name);
  }
});

test("api.open('boards') and open('outline') land on those tabs", (t) => {
  const f = setup({ listBoards: () => Promise.resolve([]), getOutline: () => [] });
  t.after(f.restore);
  f.panel.open("boards");
  assert.equal(f.panel.isOpen(), true);
  assert.deepEqual(shown(f), ["pxd-panel__pane--boards"]);
  f.panel.open("outline");
  assert.deepEqual(shown(f), ["pxd-panel__pane--outline"]);
});

test("Boards lists title, page and item count; a filter narrows the rows", async (t) => {
  const f = setup({ listBoards: () => Promise.resolve(BOARDS) });
  t.after(f.restore);
  f.panel.open("boards");
  await tick();
  const rows = () => f.root.querySelectorAll(".pxd-panel__board-row");
  assert.equal(rows().length, 3);
  const first = rows()[0];
  assert.equal(q(first, ".pxd-panel__board-title").textContent, "Roadmap");
  assert.equal(q(first, ".pxd-panel__board-page").textContent, "Projects/Plexus");
  assert.equal(q(first, ".pxd-panel__board-count").textContent, "12 items");
  assert.equal(q(rows()[1], ".pxd-panel__board-count").textContent, "1 item");
  const filter = q(f.root, ".pxd-panel__boards-filter");
  filter.value = "read";
  f.stub.dispatch(filter, "input");
  assert.deepEqual(rows().map((r) => r.dataset.uid), ["b2"]);
  filter.value = "projects";
  f.stub.dispatch(filter, "input");
  assert.deepEqual(rows().map((r) => r.dataset.uid), ["b1"], "the page name is searched too");
  filter.value = "zzz";
  f.stub.dispatch(filter, "input");
  assert.equal(rows().length, 0);
  assert.equal(q(f.root, ".pxd-panel__boards .pxd-panel__empty").textContent, "No matching boards");
  filter.value = "";
  f.stub.dispatch(filter, "input");
  assert.equal(rows().length, 3);
});

test("clicking a board row opens it; Add shortcut adds a card and does not open", async (t) => {
  const calls = [];
  const f = setup({ listBoards: () => Promise.resolve(BOARDS), openBoardByUid: (u) => calls.push(["open", u]), addBoardCard: (u) => calls.push(["add", u]) });
  t.after(f.restore);
  f.panel.open("boards");
  await tick();
  const rows = f.root.querySelectorAll(".pxd-panel__board-row");
  rows[1].click();
  q(rows[2], ".pxd-panel__board-add").click();
  q(rows[0], ".pxd-panel__board-title").click();
  assert.deepEqual(calls, [["open", "b2"], ["add", "b3"], ["open", "b1"]]);
  assert.equal(q(rows[0], ".pxd-panel__board-add").textContent, "Add shortcut");
});

test("Boards shows an empty state, survives a rejected listBoards, and ignores a stale answer", async (t) => {
  const f = setup({ listBoards: () => Promise.reject(new Error("offline")) });
  t.after(f.restore);
  f.panel.open("boards");
  await tick();
  assert.equal(q(f.root, ".pxd-panel__boards .pxd-panel__empty").textContent, "No boards found");

  const g = setup({ listBoards: () => new Promise((r) => setTimeout(() => r(BOARDS), 5)) });
  t.after(g.restore);
  g.panel.open("boards");
  tab(g, "outline").click();
  await tick(15);
  assert.equal(g.root.querySelectorAll(".pxd-panel__board-row").length, 0, "answer arrived after leaving the tab");
});

test("Outline renders an indented tree with color and count, and clicks call on.outlineClick", (t) => {
  const clicks = [];
  const tree = [
    { uid: "o1", title: "Section A", depth: 0, count: 3, color: "teal" },
    { uid: "o2", title: "Card one", depth: 1, count: 0, color: null },
    { uid: "o3", title: "Deep card", depth: 2 },
  ];
  const f = setup({ getOutline: () => tree, outlineClick: (u) => clicks.push(u) });
  t.after(f.restore);
  f.panel.open("outline");
  const rows = f.root.querySelectorAll(".pxd-panel__outline-row");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.dataset.depth), ["0", "1", "2"]);
  assert.deepEqual(rows.map((r) => r.style.paddingLeft), ["8px", "22px", "36px"]);
  assert.equal(q(rows[0], ".pxd-panel__outline-title").textContent, "Section A");
  assert.equal(q(rows[0], ".pxd-panel__outline-count").textContent, "3");
  assert.equal(q(rows[1], ".pxd-panel__outline-count"), null, "zero counts are not shown");
  assert.ok(classes(q(rows[0], ".pxd-panel__outline-dot")).includes("pxd-c-teal"));
  assert.ok(!classes(q(rows[1], ".pxd-panel__outline-dot")).some((c) => c.startsWith("pxd-c-")));
  rows[2].click();
  q(rows[0], ".pxd-panel__outline-title").click();
  assert.deepEqual(clicks, ["o3", "o1"]);
});

test("refreshOutline re-renders only while the Outline tab is open", (t) => {
  let tree = [{ uid: "o1", title: "One", depth: 0 }];
  let calls = 0;
  const f = setup({ getOutline: () => { calls += 1; return tree; } });
  t.after(f.restore);
  f.panel.refreshOutline();
  assert.equal(calls, 0, "panel closed");
  f.panel.open("search");
  f.panel.refreshOutline();
  assert.equal(calls, 0, "other tab");
  f.panel.open("outline");
  assert.equal(calls, 1);
  tree = [{ uid: "o1", title: "One", depth: 0 }, { uid: "o2", title: "Two", depth: 1 }];
  f.panel.refreshOutline();
  assert.equal(calls, 2);
  assert.deepEqual(f.root.querySelectorAll(".pxd-panel__outline-row").map((r) => r.dataset.uid), ["o1", "o2"]);
  f.panel.close();
  f.panel.refreshOutline();
  assert.equal(calls, 2, "closed again");
});

test("empty outline shows a message; a throwing getOutline does not break the panel", (t) => {
  const f = setup({ getOutline: () => [] });
  t.after(f.restore);
  f.panel.open("outline");
  assert.equal(q(f.root, ".pxd-panel__outline .pxd-panel__empty").textContent, "Nothing on this board yet");
  const g = setup({ getOutline: () => { throw new Error("x"); } });
  t.after(g.restore);
  assert.doesNotThrow(() => g.panel.open("outline"));
  assert.equal(g.root.querySelectorAll(".pxd-panel__outline-row").length, 0);
});

test("re-rendering the lists never adds listeners; dispose clears everything", async (t) => {
  const f = setup({ listBoards: () => Promise.resolve(BOARDS), getOutline: () => [{ uid: "o1", title: "One", depth: 0 }] });
  t.after(f.restore);
  f.panel.open("boards");
  await tick();
  f.panel.open("outline");
  const settled = f.stub.listenerCount();
  for (let i = 0; i < 5; i += 1) { f.panel.refreshOutline(); f.panel.open("boards"); await tick(); f.panel.open("outline"); }
  assert.equal(f.stub.listenerCount(), settled);
  f.panel.dispose();
  assert.equal(f.stub.listenerCount(), f.baseline);
  assert.equal(f.stub.pxdNodes().filter((n) => n !== f.root).length, 0);
});

test("1.0 behavior stays: search rows, tab classes and stopPropagation", async (t) => {
  const added = [];
  const f = setup({ addBeside: (s) => added.push(s) }, { searchPages: () => [{ title: "Beta" }], searchBlocks: () => [] });
  t.after(f.restore);
  f.panel.open("search");
  const input = q(f.root, ".pxd-panel__input");
  input.value = "beta";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  const rows = f.root.querySelectorAll(".pxd-panel__row");
  assert.equal(rows.length, 1);
  rows[0].click();
  assert.deepEqual(added, ["[[Beta]]"]);
  const ev = f.stub.dispatch(q(f.root, ".pxd-panel__tabs"), "pointerdown");
  assert.equal(ev.propagationStopped, true);
});
