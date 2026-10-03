import assert from "node:assert/strict";
import test from "node:test";

import { PALETTE } from "../src/model/schema.js";
import { buildMenu, flattenMenu, MENU_KINDS } from "../src/view/menu-model.js";
import { createMenu } from "../src/view/menu.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const ids = (items) => items.filter((i) => !i.separator).map((i) => i.id);
const byId = (items, id) => flattenMenu(items).find((i) => i.id === id);
const leafIds = (items) => flattenMenu(items).filter((i) => !i.children).map((i) => i.id);

// ------------------------------------------------------------------ model

test("buildMenu knows all seven kinds and returns [] for an unknown one", () => {
  assert.deepEqual(MENU_KINDS, ["canvas", "card", "section", "text", "edge", "multi", "board-menu"]);
  for (const kind of MENU_KINDS) assert.ok(buildMenu(kind, {}).length > 3, kind);
  assert.deepEqual(buildMenu("nope", {}), []);
  assert.doesNotThrow(() => buildMenu("card"));
});

test("canvas menu ids, in order, with paste gated by canPaste", () => {
  const want = ["new-card", "new-text", "new-sticky", "new-section", "new-lane-h", "new-lane-v", "new-board", "template", "save-template", "save-snapshot", "restore-snapshot", "paste", "paste-clone", "add-today", "add-week", "select-all", "fit-all", "fold-all", "unfold-all", "background", "bg-image", "gallery", "timeline", "graph", "print", "highlights", "export-svg", "export-png", "copy-outline"];
  assert.deepEqual(ids(buildMenu("canvas", {})), want);
  assert.equal(byId(buildMenu("canvas", { canPaste: false }), "paste").disabled, true);
  assert.equal(byId(buildMenu("canvas", { canPaste: false }), "paste-clone").disabled, true);
  assert.equal(byId(buildMenu("canvas", { canPaste: true }), "paste").disabled, undefined);
  assert.equal(byId(buildMenu("canvas", { canPaste: true }), "paste-clone").disabled, undefined);
});

test("card menu: ids, color submenu with checked, fold/unfold, pin/unpin, mind-map only with an outline", () => {
  const base = ids(buildMenu("card", {}));
  for (const id of ["edit", "open", "open-sidebar", "copy", "copy-ref", "copy-link", "duplicate", "duplicate-ref", "color", "fold", "fit-height", "reset-size", "pin", "select-same-color", "select-connected", "send-to", "related", "delete"]) assert.ok(base.includes(id), id);
  assert.ok(!base.includes("mind-map"));
  assert.ok(!base.includes("query-results"));
  assert.ok(!base.includes("neighbors:out"));
  const expand = buildMenu("card", { canExpand: true });
  assert.equal(byId(expand, "neighbors:out").label, "Add pages it links to");
  assert.equal(byId(expand, "neighbors:in").label, "Add pages that link here");
  assert.equal(byId(expand, "neighbors:attr").label, "Add attribute values");
  const queryMenu = buildMenu("card", { isQuery: true });
  assert.equal(byId(queryMenu, "query-results").label, "Add results as cards");
  assert.ok(!base.includes("unfold") && !base.includes("unpin"));
  const menu = buildMenu("card", { collapsed: true, pinned: true, hasOutline: true, item: { color: "teal" } });
  const got = ids(menu);
  assert.ok(got.includes("unfold") && !got.includes("fold"));
  assert.ok(got.includes("unpin") && !got.includes("pin"));
  assert.ok(got.includes("mind-map"));
  assert.equal(byId(menu, "mind-map").children, undefined, "Expand stays a leaf so a click runs it");
  const preset = byId(menu, "mind-preset");
  assert.equal(preset.label, "Mind map preset…");
  const presetIds = preset.children.filter((item) => !item.separator).map((item) => item.id);
  assert.deepEqual(presetIds, [
    "mind-dir:right", "mind-dir:down", "mind-dir:balanced", "mind-dir:radial",
    "mind-space:compact", "mind-space:normal", "mind-space:airy",
    "mind-depth:1", "mind-depth:2", "mind-depth:3", "mind-depth:4",
    "mind-refs:include", "mind-refs:skip",
    "mind-color:on", "mind-color:off",
  ]);
  assert.deepEqual(preset.children.filter((item) => item.checked).map((item) => item.id), [
    "mind-dir:right", "mind-space:normal", "mind-depth:3", "mind-refs:include", "mind-color:off",
  ]);
  const remembered = byId(buildMenu("card", {
    hasOutline: true,
    mindPreset: { direction: "radial", spacing: "airy", depth: 2, includeRefs: false, colorBranches: true },
  }), "mind-preset");
  assert.deepEqual(remembered.children.filter((item) => item.checked).map((item) => item.id), [
    "mind-dir:radial", "mind-space:airy", "mind-depth:2", "mind-refs:skip", "mind-color:on",
  ]);
  const colors = byId(menu, "color").children;
  assert.deepEqual(colors.map((c) => c.id), ["color:none", ...PALETTE.map((p) => `color:${p}`)]);
  assert.deepEqual(colors.filter((c) => c.checked).map((c) => c.id), ["color:teal"]);
  assert.deepEqual(byId(buildMenu("card", {}), "color").children.filter((c) => c.checked).map((c) => c.id), ["color:none"]);
  assert.equal(byId(menu, "delete").danger, true);
  assert.equal(byId(menu, "fit-height").disabled, true, "a folded card has no body to fit");
  assert.equal(byId(buildMenu("card", {}), "fit-height").disabled, undefined);
  assert.equal(byId(buildMenu("card", { item: { look: "block" } }), "show-as-card").label, "Show as card");
  assert.equal(byId(buildMenu("card", { item: { look: "card" } }), "show-as-block").label, "Show as block");
  assert.ok(!ids(buildMenu("card", { item: { look: "card" } })).includes("show-as-card"));
});

test("card menu on a board card says board", () => {
  const menu = buildMenu("card", { isBoard: true });
  assert.equal(byId(menu, "open").label, "Open board");
  assert.equal(byId(menu, "edit").label, "Rename board");
  assert.equal(byId(menu, "open-own-page").label, "Open nested board in its own page");
  assert.ok(!ids(buildMenu("card", {})).includes("open-own-page"));
});

test("section menu: tidy submenu, auto-fit checked, empty sections disable content actions", () => {
  const menu = buildMenu("section", { count: 3, fitOn: true, pinned: false });
  for (const id of ["rename", "select-contents", "select-all-in-section", "select-same-color", "select-connected", "collapse-section", "section-note", "lock-contents", "present-section", "fit-section", "toggle-fit", "tidy", "fold-all-in", "unfold-all-in", "color", "pin", "duplicate", "copy-ref", "delete-frame", "delete-contents"]) assert.ok(ids(menu).includes(id), id);
  assert.equal(byId(menu, "collapse-section").label, "Collapse");
  assert.equal(byId(menu, "section-note").label, "Add description");
  assert.equal(byId(menu, "present-section").label, "Present this section");
  const folded = buildMenu("section", { count: 1, collapsed: true, hasNote: true, locked: true });
  assert.equal(byId(folded, "collapse-section").label, "Expand");
  assert.equal(byId(folded, "section-note").label, "Remove description");
  assert.ok(ids(folded).includes("unlock-contents"));
  assert.deepEqual(byId(menu, "tidy").children.map((c) => c.id), ["tidy:grid", "tidy:row", "tidy:column", "tidy:outline"]);
  assert.equal(byId(menu, "toggle-fit").checked, true);
  assert.equal(byId(buildMenu("section", { count: 3 }), "toggle-fit").checked, undefined);
  assert.equal(byId(menu, "select-contents").disabled, undefined);
  const empty = buildMenu("section", { count: 0 });
  for (const id of ["select-contents", "select-all-in-section", "fit-section", "tidy", "fold-all-in", "unfold-all-in", "delete-contents"]) assert.equal(byId(empty, id).disabled, true, id);
  assert.equal(byId(empty, "select-same-color").disabled, undefined);
  assert.equal(byId(empty, "select-connected").disabled, undefined);
  assert.equal(byId(empty, "delete-frame").disabled, undefined);
  assert.equal(byId(empty, "delete-frame").danger, true);
  assert.ok(ids(buildMenu("section", { pinned: true })).includes("unpin"));
});

test("text menu: sizes 16/24/32/48 with the current one checked", () => {
  const menu = buildMenu("text", { item: { fontSize: 32, color: "red" }, pinned: true });
  assert.deepEqual(byId(menu, "size").children.map((c) => c.id), ["size:16", "size:24", "size:32", "size:48"]);
  assert.deepEqual(byId(menu, "size").children.filter((c) => c.checked).map((c) => c.id), ["size:32"]);
  const shaped = buildMenu("text", { item: { shape: "diamond" } });
  assert.deepEqual(byId(shaped, "shape").children.map((c) => c.id), ["shape:rectangle", "shape:rounded", "shape:ellipse", "shape:diamond", "shape:parallelogram", "shape:cylinder"]);
  assert.deepEqual(byId(shaped, "shape").children.filter((c) => c.checked).map((c) => c.id), ["shape:diamond"]);
  assert.equal(byId(menu, "shape").children.filter((c) => c.checked).length, 0);
  for (const id of ["edit", "color", "duplicate", "unpin", "copy", "delete"]) assert.ok(ids(menu).includes(id), id);
  assert.deepEqual(byId(menu, "color").children.filter((c) => c.checked).map((c) => c.id), ["color:red"]);
});

test("edge menu: dir, route, dash radios follow ctx", () => {
  const menu = buildMenu("edge", { dir: "two", route: "elbow", dash: "dashed", item: { color: "blue" } });
  assert.deepEqual(leafIds(menu).filter((id) => /^(dir|route|dash):/.test(id)), ["dir:one", "dir:two", "dir:none", "route:curve", "route:straight", "route:elbow", "route:around", "dash:solid", "dash:dashed"]);
  const checked = flattenMenu(menu).filter((i) => i.checked).map((i) => i.id);
  assert.deepEqual(checked, ["dir:two", "route:elbow", "dash:dashed", "color:blue"]);
  for (const id of ["flip", "label", "notes", "write-to-graph", "delete"]) assert.ok(ids(menu).includes(id), id);
  assert.equal(byId(menu, "delete").danger, true);
  assert.deepEqual(flattenMenu(buildMenu("edge", {})).filter((i) => i.checked).map((i) => i.id), ["color:none"]);
});

test("multi menu: align/distribute/tidy/same-size submenus, fold and pin follow the selection", () => {
  const menu = buildMenu("multi", { count: 3, allPinned: false, anyCollapsed: false });
  assert.deepEqual(byId(menu, "align").children.map((c) => c.id), ["align:left", "align:center", "align:right", "align:top", "align:middle", "align:bottom"]);
  assert.deepEqual(byId(menu, "distribute").children.map((c) => c.id), ["distribute:h", "distribute:v"]);
  assert.deepEqual(byId(menu, "tidy").children.map((c) => c.id), ["tidy:grid", "tidy:row", "tidy:column", "tidy:outline"]);
  assert.deepEqual(byId(menu, "same-size").children.map((c) => c.id), ["same-size:width", "same-size:height", "same-size:both"]);
  for (const id of ["copy", "duplicate", "color", "fold", "pin", "wrap-section", "wrap-board", "send-to", "delete"]) assert.ok(ids(menu).includes(id), id);
  assert.equal(byId(menu, "distribute").disabled, undefined);
  const two = buildMenu("multi", { count: 2, allPinned: true, anyCollapsed: true });
  assert.equal(byId(two, "distribute").disabled, true, "distribute needs three");
  assert.equal(byId(two, "align").disabled, undefined);
  assert.ok(ids(two).includes("unfold") && !ids(two).includes("fold"));
  assert.ok(ids(two).includes("unpin") && !ids(two).includes("pin"));
});

test("board-menu ids", () => {
  assert.deepEqual(ids(buildMenu("board-menu", {})), ["template", "save-template", "save-snapshot", "restore-snapshot", "export-svg", "export-png", "copy-outline", "sort-outline", "open-outline", "fold-all", "unfold-all", "add-today", "add-week", "background", "tidy:grid"]);
  assert.equal(byId(buildMenu("board-menu", {}), "open-outline").label, "Open outline in sidebar");
  assert.equal(byId(buildMenu("board-menu", {}), "export-png").label, "Export as PNG");
  for (const kind of ["card", "section", "text", "edge", "multi"]) {
    assert.equal(byId(buildMenu(kind, { count: 2 }), "copy-png").label, "Copy selection as PNG");
  }
});

test("menu items are plain data with unique ids per kind and no undefined keys", () => {
  for (const kind of MENU_KINDS) {
    const all = flattenMenu(buildMenu(kind, { count: 3, item: { color: "red", fontSize: 24 }, canPaste: true, hasOutline: true }));
    const seen = new Set();
    for (const item of all) {
      assert.ok(!seen.has(item.id), `${kind}: duplicate ${item.id}`);
      seen.add(item.id);
      assert.equal(typeof item.label, "string");
      for (const [k, v] of Object.entries(item)) assert.notEqual(v, undefined, `${kind}.${item.id}.${k}`);
    }
  }
  const menu = buildMenu("canvas", {});
  assert.ok(menu.some((i) => i.separator === true));
  assert.ok(menu.filter((i) => i.separator).every((i) => typeof i.id === "string"));
});

// ------------------------------------------------------------------ component

function setup(on = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const baseline = stub.listenerCount();
  const picks = [];
  const menu = createMenu({ doc: stub.document, root, timers: {}, on: { pick: (id, item) => picks.push([id, item.id]), ...on } });
  return { stub, restore, root, menu, picks, baseline };
}
const SAMPLE = () => [
  { id: "a", label: "Alpha", hint: "A" },
  { id: "sep-1", separator: true },
  { id: "b", label: "Beta", disabled: true },
  { id: "c", label: "Gamma", danger: true },
  { id: "d", label: "Delta", checked: true },
  { id: "sub", label: "More", children: [{ id: "s1", label: "One" }, { id: "s2", label: "Two", disabled: true }, { id: "s3", label: "Three" }] },
];
const q = (root, sel) => root.querySelector(sel);
const classes = (node) => String(node.className).split(/\s+/);
const rowFor = (root, id) => root.querySelectorAll(".pxd-menu__item").find((n) => n.dataset.id === id);
const key = (f, k) => f.stub.dispatch(f.stub.document.body, "keydown", { key: k });

test("open renders items, hint, states and separator inside the root", (t) => {
  const f = setup();
  t.after(f.restore);
  assert.equal(f.menu.isOpen(), false);
  assert.equal(f.menu.open({ x: 100, y: 100, items: SAMPLE() }), true);
  assert.equal(f.menu.isOpen(), true);
  const menuEl = q(f.root, ".pxd-menu.pxd-chrome");
  assert.ok(menuEl);
  assert.equal(menuEl.parentElement, f.root);
  assert.equal(q(f.root, ".pxd-menu__sep") !== null, true);
  assert.equal(q(rowFor(f.root, "a"), ".pxd-menu__hint").textContent, "A");
  assert.ok(classes(rowFor(f.root, "b")).includes("pxd-menu__item--disabled"));
  assert.ok(classes(rowFor(f.root, "c")).includes("pxd-menu__item--danger"));
  assert.ok(classes(rowFor(f.root, "d")).includes("pxd-menu__item--checked"));
  const sub = q(rowFor(f.root, "sub"), ".pxd-menu__sub");
  assert.ok(sub);
  assert.equal(sub.style.display, "none");
});

test("a menu taller than the board is capped and scrolls, and its submenus are pinned beside the row", (t) => {
  const f = setup();
  t.after(f.restore);
  const tall = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` }));
  tall.push({ id: "sub", label: "More", children: [{ id: "s1", label: "One" }] });
  const rect = { left: 0, top: 0, width: 800, height: 240, right: 800, bottom: 240, x: 0, y: 0 };
  f.root.getBoundingClientRect = () => rect;
  f.menu.open({ x: 10, y: 10, items: tall });
  const menuEl = q(f.root, ".pxd-menu");
  assert.ok(classes(menuEl).includes("pxd-menu--scroll"));
  assert.equal(menuEl.style.maxHeight, "232px", "board height minus both margins");
  const parent = rowFor(f.root, "sub");
  f.stub.dispatch(parent, "pointerover");
  const sub = q(parent, ".pxd-menu__sub");
  assert.equal(sub.style.display, "");
  assert.match(sub.style.left, /^-?\d+px$/, "the submenu is positioned against the board, not clipped by the scroller");
  f.menu.close();
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  assert.equal(classes(q(f.root, ".pxd-menu")).includes("pxd-menu--scroll"), false, "a menu that fits is untouched");
});

test("a submenu taller than the board scrolls instead of leaving rows outside it", (t) => {
  const f = setup();
  t.after(f.restore);
  const kids = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, label: `Sub ${i}` }));
  const tall = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` }));
  const rect = { left: 0, top: 0, width: 800, height: 240, right: 800, bottom: 240, x: 0, y: 0 };
  f.root.getBoundingClientRect = () => rect;
  f.menu.open({ x: 10, y: 10, items: [...tall, { id: "sub", label: "More", children: kids }] });
  const parent = rowFor(f.root, "sub");
  const sub = q(parent, ".pxd-menu__sub");
  sub.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 600, right: 160, bottom: 600, x: 0, y: 0 });
  f.stub.dispatch(parent, "pointerover");
  assert.equal(sub.style.maxHeight, "232px");
  assert.equal(sub.style.overflowY, "auto");
});

test("a scrolling submenu is positioned against the board and stays inside the window", (t) => {
  const f = setup();
  t.after(f.restore);
  const kids = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, label: `Sub ${i}` }));
  const tall = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` }));
  const rect = { left: 100, top: 200, width: 400, height: 240, right: 500, bottom: 440, x: 100, y: 200 };
  f.root.getBoundingClientRect = () => rect;
  f.stub.window.innerHeight = 360;
  f.menu.open({ x: 120, y: 220, items: [...tall, { id: "sub", label: "More", children: kids }] });
  const parent = rowFor(f.root, "sub");
  const sub = q(parent, ".pxd-menu__sub");
  parent.getBoundingClientRect = () => ({ left: 120, top: 400, width: 180, height: 28, right: 300, bottom: 428, x: 120, y: 400 });
  sub.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 600, right: 160, bottom: 600, x: 0, y: 0 });
  f.stub.dispatch(parent, "pointerover");
  assert.equal(sub.style.maxHeight, "152px");
  assert.equal(sub.style.overflowY, "auto");
  assert.equal(sub.style.top, "4px");
  assert.equal(sub.style.left, "202px");
});

test("open with no selectable items does nothing", (t) => {
  const f = setup();
  t.after(f.restore);
  assert.equal(f.menu.open({ x: 0, y: 0, items: [] }), false);
  assert.equal(f.menu.open({ x: 0, y: 0, items: [{ id: "sep-1", separator: true }] }), false);
  assert.equal(f.menu.isOpen(), false);
});

test("clicking an item calls on.pick(id, item) then closes; disabled items do neither", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  rowFor(f.root, "b").click();
  assert.deepEqual(f.picks, []);
  assert.equal(f.menu.isOpen(), true);
  rowFor(f.root, "c").click();
  assert.deepEqual(f.picks, [["c", "c"]]);
  assert.equal(f.menu.isOpen(), false);
  assert.equal(q(f.root, ".pxd-menu"), null);
});

test("submenus open on hover and pick their own ids", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  const parent = rowFor(f.root, "sub");
  const sub = q(parent, ".pxd-menu__sub");
  f.stub.dispatch(parent, "pointerover");
  assert.equal(sub.style.display, "");
  assert.ok(classes(sub).includes("pxd-menu__sub--open"));
  f.stub.dispatch(rowFor(f.root, "a"), "pointerover");
  assert.equal(sub.style.display, "none", "hovering a sibling closes the submenu");
  f.stub.dispatch(parent, "pointerover");
  rowFor(f.root, "s3").click();
  assert.deepEqual(f.picks, [["s3", "s3"]]);
  assert.equal(f.menu.isOpen(), false);
});

test("clicking a parent row opens its submenu instead of picking", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  rowFor(f.root, "sub").click();
  assert.deepEqual(f.picks, []);
  assert.equal(f.menu.isOpen(), true);
  assert.equal(q(rowFor(f.root, "sub"), ".pxd-menu__sub").style.display, "");
});

test("ArrowDown/ArrowUp move over enabled rows, skipping disabled ones, and wrap", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  const active = () => f.root.querySelectorAll(".pxd-menu__item--active").map((n) => n.dataset.id);
  key(f, "ArrowDown");
  assert.deepEqual(active(), ["a"]);
  key(f, "ArrowDown");
  assert.deepEqual(active(), ["c"], "disabled Beta is skipped");
  key(f, "ArrowDown"); key(f, "ArrowDown");
  assert.deepEqual(active(), ["sub"]);
  key(f, "ArrowDown");
  assert.deepEqual(active(), ["a"], "wraps");
  key(f, "ArrowUp");
  assert.deepEqual(active(), ["sub"], "wraps upward");
});

test("Enter picks the active row", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  key(f, "Enter");
  assert.deepEqual(f.picks, [], "nothing active yet");
  key(f, "ArrowDown");
  const ev = key(f, "Enter");
  assert.deepEqual(f.picks, [["a", "a"]]);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(f.menu.isOpen(), false);
});

test("ArrowRight opens the submenu and moves into it, ArrowLeft goes back, Enter picks inside", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  const active = () => f.root.querySelectorAll(".pxd-menu__item--active").map((n) => n.dataset.id);
  for (let i = 0; i < 4; i += 1) key(f, "ArrowDown");
  assert.deepEqual(active(), ["sub"]);
  key(f, "ArrowRight");
  const sub = q(rowFor(f.root, "sub"), ".pxd-menu__sub");
  assert.equal(sub.style.display, "");
  assert.deepEqual(active().sort(), ["s1", "sub"]);
  key(f, "ArrowDown");
  assert.ok(active().includes("s3"), "disabled Two is skipped");
  key(f, "ArrowLeft");
  assert.equal(sub.style.display, "none");
  assert.deepEqual(active(), ["sub"]);
  key(f, "ArrowRight");
  key(f, "Enter");
  assert.deepEqual(f.picks, [["s1", "s1"]]);
});

test("Esc closes, keys are swallowed while open and ignored after close", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  const down = key(f, "ArrowDown");
  assert.equal(down.defaultPrevented, true);
  assert.equal(key(f, "x").defaultPrevented, false, "unrelated keys pass through");
  const esc = key(f, "Escape");
  assert.equal(esc.defaultPrevented, true);
  assert.equal(f.menu.isOpen(), false);
  assert.equal(key(f, "ArrowDown").defaultPrevented, false);
});

test("position is clamped inside the root", (t) => {
  const f = setup();
  t.after(f.restore);
  // The stub root is 800x600; the stub menu has no measured size, so the component estimates 200 x rows*28.
  f.menu.open({ x: 790, y: 590, items: SAMPLE() });
  const menuEl = q(f.root, ".pxd-menu");
  const left = parseInt(menuEl.style.left, 10);
  const top = parseInt(menuEl.style.top, 10);
  assert.ok(left <= 800 - 200, `left ${left}`);
  assert.ok(top <= 600 - 5 * 28, `top ${top}`);
  assert.ok(left >= 4 && top >= 4);
  f.menu.open({ x: -50, y: -50, items: SAMPLE() });
  const again = q(f.root, ".pxd-menu");
  assert.equal(parseInt(again.style.left, 10), 4);
  assert.equal(parseInt(again.style.top, 10), 4);
  f.menu.open({ x: 120, y: 80, items: SAMPLE() });
  assert.equal(parseInt(q(f.root, ".pxd-menu").style.left, 10), 120);
  assert.equal(parseInt(q(f.root, ".pxd-menu").style.top, 10), 80);
  assert.equal(f.root.querySelectorAll(".pxd-menu").length, 1, "re-open replaces the menu");
});

test("menu events stop at the menu; outside pointerdown closes without being swallowed", (t) => {
  const f = setup();
  t.after(f.restore);
  const reached = [];
  f.root.addEventListener("pointerdown", () => reached.push("root:pointerdown"));
  for (const type of ["pointerup", "click", "dblclick", "wheel", "contextmenu", "keydown"]) f.root.addEventListener(type, () => reached.push(`root:${type}`));
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  const row = rowFor(f.root, "b");
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu", "keydown"]) f.stub.dispatch(row, type);
  assert.deepEqual(reached, []);
  const menuDown = f.stub.dispatch(row, "pointerdown");
  assert.equal(menuDown.propagationStopped, true);
  assert.equal(f.menu.isOpen(), true, "pointerdown inside keeps it open");
  const ctxEv = f.stub.dispatch(row, "contextmenu");
  assert.equal(ctxEv.defaultPrevented, true);
  const outside = f.stub.dispatch(f.stub.document.body, "pointerdown");
  assert.equal(f.menu.isOpen(), false);
  assert.equal(outside.propagationStopped, false);
});

test("close and dispose leave no nodes or listeners", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  assert.ok(f.stub.listenerCount() > f.baseline);
  f.menu.close();
  assert.equal(f.stub.listenerCount(), f.baseline);
  assert.equal(f.stub.pxdNodes().filter((n) => n !== f.root).length, 0);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  f.stub.dispatch(rowFor(f.root, "sub"), "pointerover");
  f.menu.dispose();
  assert.equal(f.menu.isOpen(), false);
  assert.equal(f.stub.listenerCount(), f.baseline);
  assert.equal(f.stub.pxdNodes().filter((n) => n !== f.root).length, 0);
  assert.equal(f.menu.open({ x: 0, y: 0, items: SAMPLE() }), false, "a disposed menu stays closed");
  assert.equal(f.stub.pxdNodes().filter((n) => n !== f.root).length, 0);
});

test("on.pick can throw and the menu still closes; on.closed fires once per close", (t) => {
  let closed = 0;
  const f = setup({ pick: () => { throw new Error("boom"); }, closed: () => { closed += 1; } });
  t.after(f.restore);
  f.menu.open({ x: 10, y: 10, items: SAMPLE() });
  assert.throws(() => rowFor(f.root, "a").click(), /boom/);
  assert.equal(f.menu.isOpen(), false);
  assert.equal(closed, 1);
  f.menu.close();
  assert.equal(closed, 1);
});

test("a model from buildMenu renders end to end", (t) => {
  const f = setup();
  t.after(f.restore);
  f.menu.open({ x: 200, y: 200, items: buildMenu("card", { item: { color: "teal" }, pinned: true }) });
  assert.ok(rowFor(f.root, "unpin"));
  const color = rowFor(f.root, "color");
  f.stub.dispatch(color, "pointerover");
  const teal = rowFor(f.root, "color:teal");
  assert.ok(classes(teal).includes("pxd-menu__item--checked"));
  teal.click();
  assert.deepEqual(f.picks, [["color:teal", "color:teal"]]);
});
