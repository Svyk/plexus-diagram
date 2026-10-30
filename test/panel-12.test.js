import assert from "node:assert/strict";
import test from "node:test";

import { libraryCard, narrowLibrary } from "../src/model/library.js";
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

test("the panel has Search, Related, Boards, Contents, Journal and Info tabs in that order", (t) => {
  const f = setup();
  t.after(f.restore);
  assert.deepEqual(tabs(f).map((b) => b.getAttribute("aria-label")), ["Search", "Related", "Boards", "Contents", "Journal", "Info", "Trails", "Changed"]);
  assert.deepEqual([...tabs(f)].map((b) => b.querySelector(".bp3-icon")?.className), [
    "bp3-icon bp3-icon-search",
    "bp3-icon bp3-icon-diagram-tree",
    "bp3-icon bp3-icon-applications",
    "bp3-icon bp3-icon-list",
    "bp3-icon bp3-icon-calendar",
    "bp3-icon bp3-icon-info-sign",
    "bp3-icon bp3-icon-flows",
    "bp3-icon bp3-icon-history",
  ]);
  assert.ok([...tabs(f)].every((b) => b.title && b.textContent === ""));
  assert.deepEqual(tabs(f).map((b) => b.dataset.tab), ["search", "related", "boards", "outline", "journal", "info", "trails", "changed"]);
  assert.deepEqual(shown(f), ["pxd-panel__pane--search"]);
  assert.deepEqual(tabs(f).filter((b) => classes(b).includes("pxd-panel__tab--on")).map((b) => b.dataset.tab), ["search"]);
});

test("clicking a tab shows only its pane and marks it on", (t) => {
  const f = setup({ listBoards: () => Promise.resolve([]), getOutline: () => [] });
  t.after(f.restore);
  f.panel.open();
  for (const [name, pane] of [["boards", "boards"], ["outline", "outline"], ["related", "related"], ["info", "info"], ["search", "search"]]) {
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

test("Contents groups rows under headers, shows landmark glyphs, and routes clicks and Enter to contentsClick", (t) => {
  const got = [];
  const rows = [
    { kind: "section", uid: "s1", title: "Sec", depth: 0, count: 2, color: null },
    { kind: "landmark", uid: "l1", title: "Pin", depth: 1, glyph: "*" },
    { kind: "landmark", uid: "l2", title: "Bare", depth: 0, glyph: "" },
    { kind: "section", uid: "s2", title: "Mark", depth: 0, count: 0, glyph: "!" },
    { kind: "trail", uid: "t1", title: "Tour", count: 3 },
    { kind: "view", uid: "v1", title: "Corner" },
  ];
  const f = setup({ getOutline: () => ({ rows, sig: "a" }), contentsClick: (x) => got.push(x), outlineClick: () => got.push("old") });
  t.after(f.restore);
  f.panel.open("outline");
  assert.deepEqual(f.root.querySelectorAll(".pxd-panel__outline-head").map((h) => h.textContent), ["Sections", "Trails", "Views"]);
  const els = f.root.querySelectorAll(".pxd-panel__outline-row");
  assert.deepEqual(els.map((r) => r.dataset.kind), ["section", "landmark", "landmark", "section", "trail", "view"]);
  assert.ok(els.every((r) => r.getAttribute("tabindex") === "0" && r.getAttribute("role") === "button"));
  assert.equal(q(els[1], ".pxd-panel__outline-glyph").textContent, "*");
  assert.equal(q(els[1], ".pxd-panel__outline-dot"), null);
  assert.equal(q(els[2], ".pxd-panel__outline-glyph").textContent, "\u25c6");
  assert.ok(q(els[3], ".pxd-panel__outline-dot") && q(els[3], ".pxd-panel__outline-glyph").textContent === "!");
  assert.equal(q(els[4], ".pxd-panel__outline-count").textContent, "3");
  assert.equal(q(els[5], ".pxd-panel__outline-count"), null);
  assert.ok(classes(els[4]).includes("pxd-panel__outline-row--trail"));
  els[4].click();
  f.stub.dispatch(els[1], "keydown", { key: "Enter", button: 0 });
  f.stub.dispatch(els[5], "keydown", { key: " ", button: 0 });
  assert.deepEqual(got, [{ kind: "trail", uid: "t1" }, { kind: "landmark", uid: "l1" }, { kind: "view", uid: "v1" }]);
});

test("refreshOutline with an unchanged sig keeps the row nodes; array rows still work", (t) => {
  let sig = "a";
  const f = setup({ getOutline: () => ({ rows: [{ kind: "section", uid: "s1", title: "S", depth: 0 }], sig }) });
  t.after(f.restore);
  f.panel.open("outline");
  const before = f.root.querySelector(".pxd-panel__outline-row");
  f.panel.refreshOutline();
  assert.equal(f.root.querySelector(".pxd-panel__outline-row"), before);
  sig = "b";
  f.panel.refreshOutline();
  assert.notEqual(f.root.querySelector(".pxd-panel__outline-row"), before);
  const arr = [{ uid: "o1", title: "One", depth: 0 }];
  const g = setup({ getOutline: () => arr });
  t.after(g.restore);
  g.panel.open("outline");
  const node = g.root.querySelector(".pxd-panel__outline-row");
  g.panel.refreshOutline();
  assert.equal(g.root.querySelector(".pxd-panel__outline-row"), node);
  assert.equal(node.dataset.kind, "section");
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

const LIB_NOW = Date.parse("2026-10-01T19:00:00Z");
const LIB_ROWS = [
  { uid: "p1", kind: "page", title: "Plexus Notes", edited: LIB_NOW, tags: ["TODO"], onBoard: false },
  { uid: "d1", kind: "page", title: "October 1st, 2026", edited: LIB_NOW, tags: [], onBoard: false },
  { uid: "k1", kind: "block", string: "fixture alpha", pageTitle: "Lab", edited: LIB_NOW - 86400000, tags: ["TODO"], onBoard: true },
  { uid: "k2", kind: "block", string: "fixture orphan", pageTitle: "Lab", edited: LIB_NOW - 10 * 86400000, tags: [], onBoard: false },
  { uid: "bd", kind: "board", title: "P1 fixture", pageTitle: "Lab", edited: LIB_NOW, tags: ["TODO"], onBoard: true },
];

test("Add panel filters narrow through librarySearch", async (t) => {
  const f = setup({}, {
    librarySearch(filter, limit) {
      const rows = narrowLibrary(LIB_ROWS, filter, LIB_NOW).slice(0, limit).map(libraryCard);
      return { rows, queries: [{ name: "stub", ms: 3 }] };
    },
  });
  t.after(f.restore);
  f.panel.open("search");
  const input = q(f.root, ".pxd-panel__input");
  assert.equal(input.placeholder, "Search pages and blocks…");
  const typeBtn = q(f.root, ".pxd-panel__type-btn");
  const pick = async (...values) => {
    f.stub.dispatch(q(f.root, ".pxd-panel__type-none"), "click");
    for (const value of values) {
      const box = [...f.root.querySelectorAll(".pxd-panel__type-box")].find((b) => b.dataset.type === value);
      box.checked = true;
      f.stub.dispatch(box, "change");
    }
    if (!values.length) f.stub.dispatch(q(f.root, ".pxd-panel__type-all"), "click");
    await tick();
  };
  const tag = q(f.root, ".pxd-panel__tag");
  const days = q(f.root, ".pxd-panel__days");
  const orphan = q(f.root, ".pxd-panel__orphan input");
  const list = q(f.root, ".pxd-panel__pane--search .pxd-panel__list");
  const strings = () => [...f.root.querySelectorAll(".pxd-panel__pane--search .pxd-panel__row")].map((r) => r.dataset.string);
  const expectRows = (filter) => narrowLibrary(LIB_ROWS, filter, LIB_NOW).map(libraryCard).map((r) => r.string);

  input.value = "fixture";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  const base = strings();
  assert.deepEqual(base, expectRows({ text: "fixture", type: "all", tag: "", days: "", orphan: false }));
  assert.ok(base.length >= 2);

  await pick("block");
  assert.equal(typeBtn.textContent, "1 type");
  const blocks = strings();
  assert.ok(blocks.length < base.length);
  assert.ok(blocks.every((s) => base.includes(s)));
  assert.deepEqual(blocks, expectRows({ text: "fixture", type: "block", tag: "", days: "", orphan: false }));

  await pick("board");
  const boards = strings();
  assert.ok(boards.length < base.length);
  assert.ok(boards.every((s) => base.includes(s)));

  await pick();
  assert.equal(typeBtn.textContent, "All");
  orphan.checked = true;
  f.stub.dispatch(orphan, "change");
  // Filter changes wait 200 ms for a pause (these timers never fire); Enter searches now.
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  const orphans = strings();
  assert.ok(orphans.length < base.length);
  assert.ok(orphans.every((s) => base.includes(s)));
  assert.deepEqual(orphans, expectRows({ text: "fixture", type: "all", tag: "", days: "", orphan: true }));

  orphan.checked = false;
  tag.value = "#TODO";
  days.value = "3";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  const tagged = strings();
  assert.ok(tagged.length < base.length);
  assert.ok(tagged.every((s) => base.includes(s)));
  assert.deepEqual(tagged, expectRows({ text: "fixture", type: "all", tag: "#TODO", days: "3", orphan: false }));
  assert.equal(list.dataset.queryMs, "3");
  assert.deepEqual(JSON.parse(list.dataset.queryLog), [{ name: "stub", ms: 3 }]);
  assert.equal(q(f.root, ".pxd-panel__orphan").textContent, "Not on any board");
});

const INFO = {
  kind: "self",
  uid: "note1",
  title: "Field",
  body: "Field note #hb1",
  attributes: [{ name: "Status", value: "green" }],
  refs: [{ uid: "ref1", string: "mentions the note", pageTitle: "Lab" }],
  boards: [{ uid: "board2", title: "Other", pageTitle: "Notes" }],
  tags: ["hb1"],
};

test("Info shows every section, and a board row opens that board", async (t) => {
  const calls = [];
  const f = setup({
    openBoardByUid: (uid) => calls.push(["board", uid]),
    openRef: (uid) => calls.push(["ref", uid]),
    openSidebarEditor: (item) => calls.push(["side", item.uid]),
    isFullscreen: () => false,
  }, {
    cardInfo: async (item) => {
      calls.push(["info", item.uid]);
      return INFO;
    },
  });
  t.after(f.restore);
  f.panel.setSelection({ uid: "note1", type: "card", title: "Field", target: { kind: "self", uid: "note1" } });
  f.panel.open("info");
  await tick();
  assert.deepEqual(
    [...f.root.querySelectorAll(".pxd-panel__info-h")].map((n) => n.textContent),
    ["Card", "Attributes", "Linked references", "On boards", "Tags"],
  );
  assert.equal(q(f.root, ".pxd-panel__info-body").textContent, "Field note #hb1");
  assert.equal(q(f.root, ".pxd-panel__info-name").textContent, "Status");
  assert.equal(q(f.root, ".pxd-panel__info-value").textContent, "green");
  assert.equal(q(f.root, ".pxd-panel__info-ref").textContent, "mentions the note");
  assert.equal(q(f.root, ".pxd-panel__info-board-title").textContent, "Other");
  assert.equal(q(f.root, ".pxd-panel__info-board-page").textContent, "Notes");
  assert.equal(q(f.root, ".pxd-panel__info-tag").textContent, "hb1");
  assert.equal(q(f.root, ".pxd-panel__info-note").textContent, "Editing in the right sidebar");
  assert.equal(f.root.querySelector(".pxd-panel__info-mount").querySelector(".rm-block"), null);
  q(f.root, ".pxd-panel__info-board-title").click();
  q(f.root, ".pxd-panel__info-ref").click();
  assert.deepEqual(calls.filter((c) => c[0] !== "info"), [["side", "note1"], ["board", "board2"], ["ref", "ref1"]]);
});

test("fullscreen Info mounts renderBlock, a page mounts renderPage, and close unmounts", async (t) => {
  let full = false;
  const mounted = [];
  const unmounted = [];
  const f = setup({ isFullscreen: () => full }, {
    cardInfo: (item) => (item.target.kind === "page"
      ? { kind: "page", uid: null, pageUid: "page1", title: "Alpha", body: "Alpha", attributes: [], refs: [], boards: [], tags: [] }
      : { kind: "self", uid: item.uid, title: "Field", body: "Field", attributes: [], refs: [], boards: [], tags: [] }),
    renderBlock(el, uid) { mounted.push(["block", uid]); el.textContent = "block-editor"; },
    renderPage(el, uid) { mounted.push(["page", uid]); el.textContent = "page-editor"; },
    unmount(el) { unmounted.push(el.textContent); },
  });
  t.after(f.restore);
  full = true;
  f.panel.setSelection({ uid: "note1", type: "card", target: { kind: "self", uid: "note1" } });
  f.panel.open("info");
  await tick();
  assert.equal(q(f.root, ".pxd-panel__info-note"), null);
  assert.deepEqual(mounted, [["block", "note1"]]);
  const mount = q(f.root, ".pxd-panel__info-mount");
  const area = f.stub.document.createElement("textarea");
  mount.append(area);
  const typed = f.stub.dispatch(area, "keydown", { key: "z", metaKey: true });
  assert.equal(typed.propagationStopped, false);
  const pressed = f.stub.dispatch(mount, "pointerdown");
  assert.equal(pressed.propagationStopped, true);
  const search = f.stub.dispatch(q(f.root, ".pxd-panel__input"), "keydown", { key: "i" });
  assert.equal(search.propagationStopped, true);
  f.panel.setSelection({ uid: "cardP", type: "card", kind: "page", title: "Alpha", target: { kind: "page", title: "Alpha" } });
  await tick();
  assert.deepEqual(mounted, [["block", "note1"], ["page", "page1"]]);
  assert.deepEqual(unmounted, ["block-editor"]);
  f.panel.close();
  assert.deepEqual(unmounted, ["block-editor", "page-editor"]);
});

test("Info ignores a stale cardInfo and shows an empty card", async (t) => {
  let resolve;
  const f = setup({}, {
    cardInfo: () => new Promise((r) => { resolve = r; }),
  });
  t.after(f.restore);
  f.panel.setSelection({ uid: "note1", type: "card", target: { kind: "self", uid: "note1" } });
  f.panel.open("info");
  tab(f, "search").click();
  resolve({ kind: "self", uid: "note1", body: "late", attributes: [], refs: [], boards: [], tags: [] });
  await tick();
  assert.equal(q(f.root, ".pxd-panel__info-body"), null);
  f.panel.open("info");
  f.panel.setSelection(null);
  await tick();
  assert.equal(q(f.root, ".pxd-panel__info .pxd-panel__empty").textContent, "Select a card");
});

test("Info keeps three session tabs, and the width is the only thing remembered", async (t) => {
  const seen = [];
  const widths = [];
  const f = setup({
    focusInfoTab: (uid) => seen.push(uid),
    rememberWidth: (w) => widths.push(w),
    isFullscreen: () => true,
  }, {
    cardInfo: async (item) => ({
      kind: "self", uid: item.uid, title: item.title, body: item.title,
      attributes: [], refs: [], boards: [], tags: [],
    }),
  });
  t.after(f.restore);
  const card = (uid, title) => ({ uid, type: "card", title, target: { kind: "self", uid } });
  f.panel.addInfoTab(card("a", "Alpha"));
  f.panel.addInfoTab(card("b", "Beta"));
  f.panel.addInfoTab(card("c", "Gamma"));
  await tick();
  assert.deepEqual(f.panel.infoTabs(), ["a", "b", "c"]);
  assert.equal(f.panel.infoCurrent(), "c");
  assert.equal(q(f.root, ".pxd-panel__info-body").textContent, "Gamma");
  q(f.root, ".pxd-panel__infotab-name").click();
  await tick();
  assert.deepEqual(seen, ["a"]);
  assert.equal(f.panel.infoCurrent(), "a");
  assert.equal(q(f.root, ".pxd-panel__info-body").textContent, "Alpha");
  q(f.root, ".pxd-panel__infotab-x").click();
  await tick();
  assert.deepEqual(f.panel.infoTabs(), ["b", "c"]);
  assert.equal(f.panel.infoCurrent(), "b");
  f.panel.el.style.width = "400px";
  f.panel.el._rect = { left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0 };
  const grip = q(f.root, ".pxd-panel__resize");
  f.stub.dispatch(grip, "pointerdown", { button: 0, clientX: 100 });
  f.stub.dispatch(grip, "pointermove", { clientX: 60 });
  f.stub.dispatch(grip, "pointerup", { clientX: 60 });
  assert.deepEqual(widths, [440]);
  assert.equal(f.panel.el.style.width, "440px");
  f.panel.dispose();
  const fresh = createPanel({ doc: f.stub.document, root: f.root, host: {}, timers, on: {} });
  assert.deepEqual(fresh.infoTabs(), []);
  fresh.dispose();
});

test("Info inserts Context after the card body when contextLine returns text", async (t) => {
  const f = setup({
    contextLine: async () => "Made October 4th, 2026 on Lab",
    isFullscreen: () => false,
  }, {
    cardInfo: async () => INFO,
  });
  t.after(f.restore);
  f.panel.setSelection({ uid: "note1", type: "card", title: "Field", target: { kind: "self", uid: "note1" } });
  f.panel.open("info");
  await tick();
  assert.deepEqual(
    [...f.root.querySelectorAll(".pxd-panel__info-h")].map((n) => n.textContent),
    ["Card", "Context", "Attributes", "Linked references", "On boards", "Tags"],
  );
  assert.equal(q(f.root, ".pxd-panel__info-body").textContent, "Field note #hb1");
  assert.equal(q(f.root, ".pxd-panel__info-context").textContent, "Made October 4th, 2026 on Lab");
});

test("Type filter persists, and PDF part rows show a badge, snippet, source, and add the part", async (t) => {
  const saved = [];
  const added = [];
  const asked = [];
  const part = { kind: "table", page: 4, text: "Zone Swab limit 0 CFU", docTitle: "Plan", sha256: "abc", engine: "builtin", optsHash: "oh", blockId: "t1", pdfUid: "u1" };
  const f = setup({
    loadTypes: () => ["table", "pdf"],
    saveTypes: (types) => saved.push(types),
    searchParts: (query) => { asked.push(query); return [part]; },
    addPart: (payload) => added.push(payload),
  }, { librarySearch: () => ({ rows: [], queries: [] }) });
  t.after(f.restore);
  f.panel.open("search");
  const typeBtn = q(f.root, ".pxd-panel__type-btn");
  assert.equal(typeBtn.textContent, "2 types");
  const boxes = [...f.root.querySelectorAll(".pxd-panel__type-box")];
  assert.deepEqual(boxes.filter((b) => b.checked).map((b) => b.dataset.type).sort(), ["pdf", "table"]);
  const input = q(f.root, ".pxd-panel__input");
  input.value = "swab";
  q(f.root, ".pxd-panel__pages").value = "p. 3-8";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.deepEqual(asked, [{ text: "swab", kinds: ["table"], pages: "p. 3-8" }]);
  const row = q(f.root, ".pxd-panel__row--part");
  assert.equal(q(row, ".pxd-panel__badge").textContent, "Table");
  assert.equal(q(row, ".pxd-panel__mark").textContent, "Swab");
  assert.equal(q(row, ".pxd-panel__row-label").textContent, "p. 4 \u00b7 Plan");
  f.stub.dispatch(row, "click");
  assert.deepEqual(added, [{ sha256: "abc", engine: "builtin", optsHash: "oh", ids: ["t1"], pdfUid: "u1", pdfBlockUid: "u1", kind: "table" }]);
  f.stub.dispatch(q(f.root, ".pxd-panel__type-all"), "click");
  assert.equal(saved.at(-1).length, 15);
  assert.equal(typeBtn.textContent, "All");
});

test("PDF part rows: Ask AI button does not add the card; click opens the board's PDF card when there is one", async (t) => {
  const added = [];
  const asked = [];
  const opened = [];
  let onBoard = true;
  const part = { kind: "para", page: 7, text: "Swab limit 0 CFU", docTitle: "Plan", sha256: "abc", engine: "builtin", optsHash: "oh", blockId: "p9", pdfUid: "u1", url: "https://x/plan.pdf" };
  const f = setup({
    loadTypes: () => null,
    searchParts: () => [part],
    addPart: (payload) => added.push(payload),
    askPart: (row) => asked.push(row),
    openPart: (row) => { opened.push(row); return onBoard; },
  }, { librarySearch: () => ({ rows: [], queries: [] }) });
  t.after(f.restore);
  f.panel.open("search");
  const input = q(f.root, ".pxd-panel__input");
  input.value = "swab";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  const row = q(f.root, ".pxd-panel__row--part");
  const btn = q(row, ".pxd-panel__row-act");
  assert.equal(btn.getAttribute("aria-label"), "Ask AI");
  assert.ok(q(btn, ".pxd-ask-icon"), "the one Ask AI mark");
  f.stub.dispatch(btn, "click");
  assert.deepEqual(asked, [part]);
  assert.equal(opened.length, 0);
  assert.equal(added.length, 0);
  f.stub.dispatch(row, "click");
  assert.deepEqual(opened, [part]);
  assert.equal(added.length, 0);
  onBoard = false;
  f.stub.dispatch(row, "click");
  assert.equal(added.length, 1);
  assert.equal(added[0].ids[0], "p9");
});
