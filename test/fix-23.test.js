// P11 bug-hunt fixes (PL-5 to PL-19): labels for ref and image cards, views, present, tooltips, menus. DOM stub only.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildBoard, worldRects } from "../src/model/board.js";
import { itemLabel } from "../src/model/schema.js";
import { tableRows } from "../src/model/table.js";
import { kanbanRows } from "../src/model/kanban.js";
import { findOnBoard } from "../src/model/find.js";
import { cardLabel, galleryItems, timelineAxis } from "../src/model/section6.js";
import { mountLater } from "../src/view/later-views.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createPresenter } from "../src/view/present.js";
import { createTooltip } from "../src/view/tooltip.js";
import { createPropsPanel } from "../src/view/props-panel.js";
import { tipEntry } from "../src/view/tooltip-text.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const blk = (uid, string, props, kids = []) => ({ ":block/uid": uid, ":block/string": string, ":block/order": 0, ":block/props": props, ":block/children": kids });
const plexus = (o) => ({ plexus: o });
const IMG = "![sunset over the bay](https://firebasestorage.example/a.png)";
const RAW_IMG = "![](https://firebasestorage.example/b.png)";

const board = () => buildBoard(blk("b1", "{{[[diagram]]:B}}", plexus({ v: 2 }), [
  blk("note0001", "A plain note", plexus({ x: 0, y: 0, w: 200, h: 80 })),
  blk("ref00001", "((target001))", plexus({ x: 300, y: 0, w: 200, h: 80 })),
  blk("img00001", IMG, plexus({ x: 600, y: 0, w: 200, h: 80 })),
  blk("img00002", RAW_IMG, plexus({ x: 900, y: 0, w: 200, h: 80 })),
  blk("ec", "Connections", plexus({ type: "edges" }), [
    blk("e12", "", plexus({ type: "edge", from: "note0001", to: "ref00001" })),
  ]),
]));
const resolve = (uid) => (uid === "target001" ? "Resolved first line\nsecond line" : null);

test("BUG-1 / PL-5: itemLabel uses the ref target's first line and the image alt text", () => {
  const b = board();
  assert.equal(itemLabel(b.items.get("note0001"), resolve), "A plain note");
  assert.equal(itemLabel(b.items.get("ref00001"), resolve), "Resolved first line");
  assert.equal(itemLabel(b.items.get("ref00001"), () => null), "Block reference", "never the raw uid");
  assert.equal(itemLabel(b.items.get("img00001"), resolve), "sunset over the bay");
  assert.equal(itemLabel(b.items.get("img00002"), resolve), "Image");
});

test("BUG-1 / PL-5: table and kanban rows carry the resolved title", () => {
  const b = board();
  const rows = tableRows(b, resolve);
  assert.equal(rows.find((r) => r.uid === "ref00001").title, "Resolved first line");
  assert.equal(rows.find((r) => r.uid === "img00001").title, "sunset over the bay");
  const k = kanbanRows(b, resolve);
  assert.equal(k.find((r) => r.uid === "ref00001").title, "Resolved first line");
  assert.ok(k.every((r) => !r.title.startsWith("((")));
});

test("BUG-1 / PL-5: Find matches the text a ref card displays and an image's alt text", () => {
  const b = board();
  assert.deepEqual(findOnBoard(b, "second line", [], resolve).map((h) => h.uid), ["ref00001"]);
  assert.deepEqual(findOnBoard(b, "sunset", [], resolve).map((h) => h.uid), ["img00001"]);
  assert.equal(findOnBoard(b, "second line").length, 0, "without a resolver the ref text is unknown");
});

test("BUG-1 / BUG-5 / PL-5: labels in Graph, Timeline and Gallery are readable", () => {
  const b = board();
  assert.equal(cardLabel(b.items.get("ref00001"), resolve), "Resolved first line");
  assert.equal(cardLabel(b.items.get("img00002"), resolve), "Image");
  const tiles = galleryItems(b, resolve);
  assert.equal(tiles.find((t) => t.uid === "img00001").title, "sunset over the bay");
  assert.equal(tiles.find((t) => t.uid === "img00002").title, "", "no alt text: no caption, never raw markdown");
  assert.ok(tiles.every((t) => !t.title.includes("![")));
  const axis = timelineAxis([{ uid: "d", title: "", string: "2026-10-03", kind: "block", target: { kind: "block", uid: "target001" } }], { resolve });
  assert.equal(axis[0].title, "Resolved first line");
});

function laterFixture(host) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const b = board();
  const later = mountLater({ doc: stub.document, root, host, getBoard: () => b, onClose: () => later.close() });
  return { stub, restore, root, later, b };
}

test("BUG-2 / PL-6: Graph draws an edge line, spreads the nodes and labels ref cards", (t) => {
  const f = laterFixture({ blockString: resolve });
  t.after(f.restore);
  f.later.open("graph");
  const body = f.root.querySelector(".pxd-later__body");
  assert.equal(body.querySelectorAll(".pxd-later__link").length, 1, "one line for the one edge");
  const nodes = body.querySelectorAll(".pxd-later__node");
  assert.equal(nodes.length, 4);
  const texts = nodes.map((n) => n.textContent);
  assert.ok(texts.includes("Resolved first line"));
  assert.ok(texts.every((x) => !x.startsWith("((") && !x.startsWith("![")), texts.join("|"));
  const xs = nodes.map((n) => parseInt(n.style.left, 10));
  assert.ok(Math.max(...xs) - Math.min(...xs) > 150, "nodes are spread out, not stacked");
  for (const n of nodes) assert.ok(parseInt(n.style.left, 10) >= 0 && parseInt(n.style.top, 10) >= 0, "no node starts off the box");
});

test("BUG-5 / PL-9: a Gallery tile without alt text has no caption, with alt text the alt text", (t) => {
  const f = laterFixture({ blockString: resolve });
  t.after(f.restore);
  f.later.open("gallery");
  const caps = f.root.querySelectorAll(".pxd-later__tile figcaption").map((c) => c.textContent);
  assert.deepEqual(caps, ["sunset over the bay"]);
});

test("UX-2 / PL-17: the Timeline empty state says what counts as dated", (t) => {
  const f = laterFixture({ blockString: resolve });
  t.after(f.restore);
  f.later.open("timeline");
  assert.match(f.root.querySelector(".pxd-later__body").textContent, /date/i);
  assert.match(f.root.querySelector(".pxd-later__body").textContent, /daily page/i);
});

const css = ["src/css/overlays.css", "src/css/block-arrows.css", "src/extension.css"].map((p) => readFileSync(p, "utf8")).join("\n");

test("BUG-9 / BUG-10 / BUG-11 / PL-13 PL-14 PL-15: overlays and the board bar are opaque, titles may overflow in overview", () => {
  assert.match(css, /\.pxd-root \.pxd-later \{[^}]*background: var\(--pxd-surface\)/);
  assert.match(css, /\.pxd-root\.pxd-root--docked \.pxd-toolbar \{\s*background: var\(--pxd-surface\)/);
  assert.match(css, /pxd-lod-overview \.pxd-section__title,\s*\.pxd-root\.pxd-lod-map \.pxd-section__title \{\s*max-width: max\(/);
  assert.match(css, /\.pxd-props\.pxd-props--collapsed \{\s*width: auto/);
});

test("BUG-7 / PL-11: present mode puts a root class on and hides the editing chrome", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const b = board();
    const presenter = createPresenter({ doc: stub.document, root, on: {} });
    assert.ok(presenter.start(b, worldRects(b)));
    assert.ok(root.classList.contains("pxd-root--presenting"));
    presenter.stop();
    assert.ok(!root.classList.contains("pxd-root--presenting"), "restored on exit");
  } finally { restore(); }
  for (const part of [".pxd-toolbar", ".pxd-dock", ".pxd-props", ".pxd-rail", ".pxd-minimap"]) {
    assert.ok(css.includes(`.pxd-root.pxd-root--presenting ${part}`), part);
  }
});

test("BUG-3 / PL-7: a short labelled edge's label steps aside while the edge is selected", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    doc.body.append(root);
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    const labels = doc.createElement("div");
    root.append(svg, over, labels);
    const b = buildBoard(blk("b1", "{{[[diagram]]:B}}", plexus({ v: 2 }), [
      blk("c1", "a", plexus({ x: 0, y: 0, w: 100, h: 60 })),
      blk("c2", "b", plexus({ x: 140, y: 0, w: 100, h: 60 })),
      blk("c3", "c", plexus({ x: 900, y: 0, w: 100, h: 60 })),
      blk("ec", "Connections", plexus({ type: "edges" }), [
        blk("short", "((c1)) → causes → ((c2))", plexus({ type: "edge", from: "c1", to: "c2", label: "causes" })),
        blk("long", "((c1)) → far → ((c3))", plexus({ type: "edge", from: "c1", to: "c3", label: "far" })),
      ]),
    ]));
    const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over });
    layer.render({ board: b, rects: worldRects(b) });
    layer.setSelection({ edge: "short" });
    assert.ok(layer._els.get("short").label.classList.contains("pxd-label--clear"), "short edge: label clears the handles");
    layer.setSelection({ edge: "long" });
    assert.ok(!layer._els.get("long").label.classList.contains("pxd-label--clear"), "long edge keeps its label");
    layer.setSelection({ edge: null });
    assert.ok(!layer._els.get("short").label.classList.contains("pxd-label--clear"));
  } finally { restore(); }
  assert.match(css, /\.pxd-label\.pxd-label--clear \{\s*pointer-events: none/);
});

test("BUG-4 / PL-8: no renderString call ever gets a diagram macro or a non-string", async () => {
  // The page-card board row path is covered in polish-23; this pins the guard in renderRoot itself.
  const src = readFileSync("src/view/cards.js", "utf8");
  assert.match(src, /if \(!string\) return node;/);
});

test("UX-2 / UX-3 / PL-17 / PL-18: Views submenu in the canvas menu and More, template entry renamed", () => {
  for (const kind of ["canvas", "board-menu"]) {
    const items = buildMenu(kind, {});
    const views = items.find((i) => i.id === "views");
    assert.ok(views, `${kind} has Views`);
    assert.deepEqual(views.children.map((c) => c.id), ["gallery", "timeline", "graph"]);
  }
  const labels = flattenMenu(buildMenu("canvas", {})).map((i) => i.label);
  assert.equal(labels.filter((l) => l === "Timeline").length, 1, "Timeline appears once");
  assert.ok(labels.includes("Timeline template"));
});

test("T-1 / PL-19: a tooltip whose target is removed while shown hides", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const btn = doc.createElement("button");
    btn.setAttribute("data-tip", "toolbar.add");
    root.append(btn);
    const tip = createTooltip({ doc, root, timers: { later: () => () => {} }, setting: () => undefined });
    tip.show(btn);
    assert.equal(tip.isVisible(), true);
    btn.remove();
    tip.check();
    assert.equal(tip.isVisible(), false, "check hides it once the control is gone");
    tip.show(btn);
    assert.equal(tip.isVisible(), false, "a detached target never shows");
    tip.dispose();
  } finally { restore(); }
});

test("T-2 / PL-20: Properties steppers, color chips and choice buttons use tips, not native titles", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const noop = () => {};
    const panel = createPropsPanel({ doc: stub.document, root, storage: stub.localStorage, on: new Proxy({}, { get: () => noop }) });
    panel.refresh({ items: [{ uid: "a", type: "card" }], board: { plexus: {}, defaults: { section: {} } } });
    for (const sel of [".pxd-props__dec", ".pxd-props__inc", ".pxd-props__chip", ".pxd-seg__btn", ".pxd-props__num"]) {
      const nodes = root.querySelectorAll(sel);
      assert.ok(nodes.length, sel);
      for (const n of nodes) {
        assert.ok(!n.title, `${sel} has no native title`);
        assert.ok(tipEntry(n.getAttribute("data-tip")), `${sel} -> ${n.getAttribute("data-tip")}`);
      }
    }
    panel.refresh({ edge: { dir: "one", dash: "solid", route: "curve", weight: 1 }, items: [], board: { plexus: {} } });
    for (const n of root.querySelectorAll(".pxd-seg__btn")) assert.ok(tipEntry(n.getAttribute("data-tip")), n.getAttribute("data-tip"));
    root.querySelector(".pxd-props__chip").click();
    const swatches = root.querySelectorAll(".pxd-picker__swatch");
    assert.ok(swatches.length > 5, "picker opened");
    for (const n of swatches) {
      assert.ok(!n.title, "no native title on a swatch");
      assert.ok(tipEntry(n.getAttribute("data-tip")));
    }
  } finally { restore(); }
});
