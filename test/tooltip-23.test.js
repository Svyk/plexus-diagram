// PL-3 / PL-4: the shared hover tooltip, its text table, and the two settings. DOM stub only.
import assert from "node:assert/strict";
import test from "node:test";

import { createChrome } from "../src/view/chrome.js";
import { createPropsPanel } from "../src/view/props-panel.js";
import { createTooltip, placeTip, preferredSide, tooltipDelay } from "../src/view/tooltip.js";
import { TIP_TEXT, tipEntry, tipIdForClass } from "../src/view/tooltip-text.js";
import { normalizeSetting, settingsDefaults, createSettingsPanel } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const noop = () => {};
const everyHandler = new Proxy({}, { get: () => noop });

function chromeFixture(values = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const timers = { later: () => () => {}, frame: () => () => {} };
  const chrome = createChrome({ doc: stub.document, root, version: "2.3.0", settings: { get: (k) => values[k] }, timers, on: everyHandler, crumbs: [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }, { title: "E" }, { title: "F" }] });
  return { stub, restore, root, chrome };
}

const CTX_SHOTS = [
  ["card", { kind: "note", kids: true, pinned: true, collapsed: true, refs: 2 }],
  ["card", { kind: "block", kids: false, pinned: false, collapsed: false, open: false }],
  ["card", { kind: "page", open: true }],
  ["cards", { anyCollapsed: true, allPinned: true }],
  ["cards", { anyCollapsed: false, allPinned: false }],
  ["board", { enhanced: true }],
  ["section", { collapsed: true, hasNote: true, locked: true, autofit: true, pinned: true }],
  ["section", { collapsed: false, hasNote: false, locked: false, autofit: false, pinned: false }],
  ["text", { fontSize: 24 }],
  ["edge", { dir: "one", route: "curve", dash: "solid", weight: 1, fromBlock: "blk000001" }],
  ["link", { sources: [{ uid: "src000001", string: "a source block" }] }],
];

// Every control the chrome builds, in every state, so a new button without a tooltip entry fails here.
function allControls(f) {
  const nodes = new Set();
  const grab = () => {
    for (const n of f.root.querySelectorAll("button, .pxd-sync, .pxd-minimap, .pxd-crumb, .pxd-props__heading")) nodes.add(n);
  };
  const anchor = () => ({ kind: "card", rect: { x: 10, y: 10, w: 100, h: 50 } });
  f.chrome.toolbar.setTool("card", false);
  for (const [kind, model] of CTX_SHOTS) { f.chrome.ctx.show(kind, model, anchor); grab(); }
  for (const mode of ["off", "attributes", "all"]) { f.chrome.toolbar.setLinkMode(mode); grab(); }
  f.chrome.toolbar.setTable(true); f.chrome.toolbar.setKanban(true); f.chrome.toolbar.setFullscreen(true); grab();
  for (const tool of ["card", "sticky", "shape", "section"]) { f.chrome.toolbar.setTool(tool, true); grab(); }
  f.chrome.popover.open(); grab();
  f.chrome.toast.show({ message: "x" });
  grab();
  return [...nodes].filter((n) => !n.classList.contains("pxd-toast__action"));
}

test("PL-3: every chrome control has a tooltip entry, and none keeps a native title", (t) => {
  const f = chromeFixture();
  t.after(f.restore);
  const controls = allControls(f);
  assert.ok(controls.length > 120, `a real chrome has many controls (${controls.length})`);
  const missing = [];
  const doubled = [];
  const used = new Set();
  for (const n of controls) {
    const id = n.getAttribute("data-tip");
    const entry = tipEntry(id, n.getAttribute("data-tip-state"));
    if (!entry) missing.push(`${n.className} -> ${id}`);
    else {
      used.add(id);
      assert.ok(entry.desc && entry.desc.length > 12, `${id} has a real description`);
      assert.ok(entry.name || n.getAttribute("aria-label"), `${id} has a name`);
    }
    if (n.title) doubled.push(`${n.className} title=${n.title}`);
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(doubled, [], "native titles are gone where the tooltip exists");
  assert.ok(used.size >= 100, `coverage: ${used.size} distinct ids exercised`);
});

test("PL-3: every .pxd-iconbtn, dock tool and rail button in the chrome has a tooltip id", (t) => {
  const f = chromeFixture();
  t.after(f.restore);
  allControls(f);
  const icons = f.root.querySelectorAll(".pxd-iconbtn, .pxd-dock__btn, .pxd-palette__btn, .pxd-rail__btn, .pxd-tool");
  assert.ok(icons.length >= 35);
  for (const b of icons) assert.ok(tipEntry(b.getAttribute("data-tip"), b.getAttribute("data-tip-state")), b.className);
});

test("PL-3: the nine dock tools carry the shortcut in <kbd> text and the lock hint", () => {
  const keys = { select: "V", hand: "H", card: "N", text: "T", sticky: "S", shape: "R", section: "G", board: "W", connect: "C" };
  for (const [id, key] of Object.entries(keys)) {
    const entry = TIP_TEXT[`tool.${id}`];
    assert.equal(entry.key, key, id);
    assert.equal(entry.hint, "Double-click to keep this tool.", id);
  }
});

test("PL-3: tipIdForClass reads the last block__element token", () => {
  assert.equal(tipIdForClass("pxd-btn pxd-iconbtn pxd-ctx__btn pxd-ctx__color"), "ctx.color");
  assert.equal(tipIdForClass("pxd-btn pxd-ctx__delete pxd-btn--danger"), "ctx.delete");
  assert.equal(tipIdForClass("pxd-btn pxd-rail__btn pxd-rail__zoom-in"), "rail.zoom-in");
  assert.equal(tipIdForClass("pxd-btn pxd-badge"), "badge");
  assert.equal(tipIdForClass("pxd-btn pxd-seg__btn"), null);
});

// ------------------------------------------------------------------ the tooltip element
function tipFixture(values = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const bar = doc.createElement("div");
  bar.className = "pxd-toolbar";
  root.append(bar);
  const btn = doc.createElement("button");
  btn.className = "pxd-btn";
  btn.setAttribute("data-tip", "tool.card");
  btn.setAttribute("aria-label", "Card");
  btn.matches = () => true;
  bar.append(btn);
  const other = doc.createElement("button");
  other.setAttribute("data-tip", "toolbar.fit");
  other.matches = () => true;
  bar.append(other);
  const queue = [];
  const timers = { later(fn, ms) { const t = { fn, ms }; queue.push(t); return () => { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); }; } };
  const base = stub.listenerCount();
  const tooltip = createTooltip({ doc, root, timers, setting: (k) => values[k] });
  const fire = (target, type, init = {}) => target.dispatchEvent({ type, ...init, target });
  return { stub, restore, doc, root, bar, btn, other, queue, tooltip, base, fire, listeners: () => stub.listenerCount() - base };
}

test("PL-3: hover shows after the delay with name, kbd and description; leave hides", (t) => {
  const f = tipFixture();
  t.after(f.restore);
  assert.equal(f.root.querySelectorAll(".pxd-tooltip").length, 1);
  f.fire(f.btn, "pointerover");
  assert.equal(f.tooltip.isVisible(), false, "not yet");
  assert.equal(f.queue.length, 1);
  assert.equal(f.queue[0].ms, 350);
  f.queue.shift().fn();
  assert.equal(f.tooltip.isVisible(), true);
  assert.equal(f.root.querySelector(".pxd-tooltip__name").textContent, "Card");
  assert.equal(f.root.querySelector(".pxd-tooltip__key").textContent, "N");
  assert.ok(f.root.querySelector(".pxd-tooltip__desc").textContent.length > 12);
  assert.equal(f.root.querySelector(".pxd-tooltip__hint").textContent, "Double-click to keep this tool.");
  assert.equal(f.btn.getAttribute("aria-describedby"), "pxd-tooltip");
  assert.equal(f.root.querySelector(".pxd-tooltip").getAttribute("role"), "tooltip");
  assert.equal(f.root.querySelector(".pxd-tooltip").getAttribute("data-side"), "below", "the board bar places it below");
  f.fire(f.btn, "pointerout", { relatedTarget: f.root });
  assert.equal(f.tooltip.isVisible(), false);
  assert.equal(f.btn.getAttribute("aria-describedby"), null);
});

test("PL-3: moving to a neighbour while shown switches at once; pointer buttons down never show", (t) => {
  const f = tipFixture();
  t.after(f.restore);
  f.fire(f.btn, "pointerover");
  f.queue.shift().fn();
  f.fire(f.other, "pointerover");
  assert.equal(f.queue.length, 0, "no second delay");
  assert.equal(f.root.querySelector(".pxd-tooltip__name").textContent, "Fit", "name falls back to the aria-label or the table");
  assert.equal(f.tooltip.target(), f.other);
  f.tooltip.hide();
  f.fire(f.btn, "pointerover", { buttons: 1 });
  assert.equal(f.queue.length, 0, "a drag in progress");
});

test("PL-3: keyboard focus shows immediately, blur hides", (t) => {
  const f = tipFixture();
  t.after(f.restore);
  f.fire(f.btn, "focusin");
  assert.equal(f.tooltip.isVisible(), true);
  assert.equal(f.queue.length, 0);
  f.fire(f.btn, "focusout");
  assert.equal(f.tooltip.isVisible(), false);
});

test("PL-3: pointerdown, wheel, scroll and Escape hide it, and the dismiss listeners go with it", (t) => {
  const f = tipFixture();
  t.after(f.restore);
  const idle = f.listeners();
  assert.equal(idle, 4, "one pointer pair and one focus pair on the root, nothing else");
  for (const type of ["pointerdown", "wheel", "scroll"]) {
    f.fire(f.btn, "focusin");
    assert.equal(f.tooltip.isVisible(), true, type);
    assert.ok(f.listeners() > idle, "dismiss listeners armed while shown");
    f.fire(f.btn, type);
    assert.equal(f.tooltip.isVisible(), false, type);
    assert.equal(f.listeners(), idle, `${type}: back to the idle count`);
  }
  f.fire(f.btn, "focusin");
  f.doc.dispatchEvent({ type: "keydown", key: "Escape", target: f.doc });
  assert.equal(f.tooltip.isVisible(), false, "Escape");
  assert.equal(f.listeners(), idle);
});

test("PL-4: tooltip-delay picks instant / 350 / 800, and tooltips off hands the text to the native title", (t) => {
  assert.equal(tooltipDelay("instant"), 0);
  assert.equal(tooltipDelay("350 ms"), 350);
  assert.equal(tooltipDelay("800 ms"), 800);
  assert.equal(tooltipDelay(undefined), 350);
  const slow = tipFixture({ "tooltip-delay": "800 ms" });
  t.after(slow.restore);
  slow.fire(slow.btn, "pointerover");
  assert.equal(slow.queue[0].ms, 800);
  const instant = tipFixture({ "tooltip-delay": "instant" });
  t.after(instant.restore);
  instant.fire(instant.btn, "pointerover");
  assert.equal(instant.tooltip.isVisible(), true);
  const off = tipFixture({ tooltips: false });
  t.after(off.restore);
  off.fire(off.btn, "pointerover");
  off.fire(off.btn, "focusin");
  assert.equal(off.tooltip.isVisible(), false);
  assert.equal(off.queue.length, 0);
  assert.ok(off.btn.title.startsWith("Card (N). "), "native fallback keeps name and key");
});

test("PL-3: dispose removes the element and every listener", (t) => {
  const f = tipFixture();
  t.after(f.restore);
  f.fire(f.btn, "focusin");
  f.tooltip.dispose();
  assert.equal(f.root.querySelector(".pxd-tooltip"), null);
  assert.equal(f.listeners(), 0);
});

test("PL-3: placement prefers the side, flips to stay inside, and clamps", () => {
  const bounds = { left: 0, top: 0, width: 800, height: 600 };
  const tip = { width: 200, height: 60 };
  assert.equal(placeTip({ target: { left: 100, top: 10, width: 30, height: 30 }, tip, bounds, side: "below" }).side, "below");
  assert.equal(placeTip({ target: { left: 100, top: 560, width: 30, height: 30 }, tip, bounds, side: "below" }).side, "above", "no room below");
  assert.equal(placeTip({ target: { left: 100, top: 5, width: 30, height: 20 }, tip, bounds, side: "above" }).side, "below", "no room above");
  assert.equal(placeTip({ target: { left: 760, top: 200, width: 30, height: 30 }, tip, bounds, side: "right" }).side, "left");
  const clamped = placeTip({ target: { left: 0, top: 10, width: 10, height: 10 }, tip, bounds, side: "below" });
  assert.ok(clamped.left >= 4, "clamped inside the left edge");
  const far = placeTip({ target: { left: 790, top: 10, width: 10, height: 10 }, tip, bounds, side: "below" });
  assert.ok(far.left + tip.width <= 796, "clamped inside the right edge");
});

test("PL-3: sides by region: bar below, dock above, rail left, dock left goes right", (t) => {
  const f = chromeFixture();
  t.after(f.restore);
  const q = (sel) => f.root.querySelector(sel);
  assert.equal(preferredSide(q(".pxd-toolbar__fit"), f.root), "below");
  assert.equal(preferredSide(q(".pxd-rail__fit"), f.root), "left");
  assert.equal(preferredSide(q(".pxd-dock__btn"), f.root), "above");
  f.root.classList.add("pxd-root--dock-left");
  assert.equal(preferredSide(q(".pxd-dock__btn"), f.root), "right");
  f.root.classList.remove("pxd-root--dock-left");
  f.root.classList.add("pxd-root--dock-top");
  assert.equal(preferredSide(q(".pxd-dock__btn"), f.root), "below");
});

test("PL-3: Properties panel headings, the toggle and reset buttons carry tips", (t) => {
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const panel = createPropsPanel({ doc: stub.document, root, storage: stub.localStorage, on: everyHandler });
  panel.refresh({ items: [{ uid: "a", type: "card" }, { uid: "s", type: "section" }], board: { plexus: {}, defaults: { section: {} } } });
  const tips = root.querySelectorAll("[data-tip]").map((n) => n.getAttribute("data-tip"));
  for (const id of ["props.toggle", "props.group.blocks", "props.group.group", "props.group.diagram", "props.reset"]) assert.ok(tips.includes(id), id);
  for (const id of tips) assert.ok(tipEntry(id), id);
  assert.ok(!root.querySelector(".pxd-props__toggle").title, "no native title on the toggle");
});

test("PL-4: the two settings have defaults, enums and rows under Board", () => {
  const d = settingsDefaults();
  assert.equal(d.tooltips, true);
  assert.equal(d["tooltip-delay"], "350 ms");
  assert.equal(normalizeSetting("tooltips", "false"), false);
  assert.equal(normalizeSetting("tooltip-delay", "instant"), "instant");
  assert.equal(normalizeSetting("tooltip-delay", "800 ms"), "800 ms");
  assert.equal(normalizeSetting("tooltip-delay", "2 s"), "350 ms");
  const rows = createSettingsPanel().settings;
  const ids = rows.map((r) => r.id);
  const from = ids.indexOf("group-board");
  const to = ids.indexOf("group-performance");
  for (const id of ["tooltips", "tooltip-delay"]) assert.ok(ids.indexOf(id) > from && ids.indexOf(id) < to, id);
  assert.equal(rows.find((r) => r.id === "tooltips").action.type, "switch");
  assert.deepEqual(rows.find((r) => r.id === "tooltip-delay").action.items, ["instant", "350 ms", "800 ms"]);
});
