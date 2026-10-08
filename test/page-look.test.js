// Page look: exact geometry on sideways pages, persistent "Show parsed" boxes with copy icons, and
// click-to-place for chip inserts. Nothing here writes to the graph until a placement click.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bboxToPagePercent, bboxToPageRect, frameBoxToViewport } from "../src/view/parse-overlay.js";
import {
  BESIDE_LABEL,
  PLACE_ACTS,
  SHOW_PARSED_KEY,
  COPIED_MS,
  chipClearLeft,
  chipPlan,
  copyHoverId,
  copyIconSpot,
  createPageChips,
  parsedBoxPlan,
  readShowParsed,
  runChipAction,
  skipParsedBox,
  writeShowParsed,
} from "../src/view/page-chips.js";
import { startPlacement } from "../src/view/drag-ghost.js";
import { createParseActions, placementContent } from "../src/view/parse-actions.js";
import { TIP_TEXT } from "../src/view/tooltip-text.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const close = (a, b, eps = 0.01) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

// The engine's forward map (parsePageGeometry): frame = R(-textRotation) · viewport + t.
function forward(box, vw, vh, tr) {
  const rad = (-tr * Math.PI) / 180;
  const a = Math.cos(rad); const b = Math.sin(rad); const c = -Math.sin(rad); const d = Math.cos(rad);
  const cs = [[0, 0], [vw, 0], [vw, vh], [0, vh]].map(([x, y]) => [a * x + c * y, b * x + d * y]);
  const minX = Math.min(...cs.map((p) => p[0])); const minY = Math.min(...cs.map((p) => p[1]));
  const pts = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map(([x, y]) => [a * x + c * y - minX, b * x + d * y - minY]);
  const fw = Math.max(...cs.map((p) => p[0])) - minX;
  const fh = Math.max(...cs.map((p) => p[1])) - minY;
  return { box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))], fw, fh };
}

test("frameBoxToViewport inverts the engine's sideways frame for -90, 90 and 180", () => {
  const vw = 595; const vh = 842;
  const box = [103.8, 73.5, 563.8, 798.7];
  for (const tr of [-90, 90, 180, 270]) {
    const f = forward(box, vw, vh, tr);
    const back = frameBoxToViewport(f.box, { w: f.fw, h: f.fh, textRotation: tr });
    assert.ok(close(back.box, box), `${tr}: ${back.box}`);
    assert.equal(Math.round(back.vw), vw);
    assert.equal(Math.round(back.vh), vh);
  }
  const plain = frameBoxToViewport([1, 2, 3, 4], { w: 100, h: 200 });
  assert.deepEqual(plain, { box: [1, 2, 3, 4], vw: 100, vh: 200 });
});

test("EU 2073/2005 p15 and p18: the outline matches the drawn table (frozen measurements)", () => {
  // Parse bboxes in the engine frame (842 × 595, textRotation -90) and the table's ruling extent read
  // from the page's own drawing operators in viewport points (595 × 842), header rule excluded.
  const page = { w: 842, h: 595, rotation: 0, textRotation: -90 };
  const cases = [
    { bbox: [43.35, 103.83, 768.55, 563.84], rules: [103.6, 73.8, 564.1, 796.6] },
    { bbox: [43.35, 61.09, 770.25, 538.33], rules: [60.8, 73.8, 538.6, 796.6] },
  ];
  for (const { bbox, rules } of cases) {
    const { box } = frameBoxToViewport(bbox, page);
    for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(box[i] - rules[i]) <= 2.5, `${i}: ${box[i]} vs ${rules[i]}`);
    // On screen at 900 px wide: scale is 900 / 595, not 900 / 842.
    const r = bboxToPageRect(bbox, page, { clientWidth: 900 });
    assert.ok(Math.abs(r.scale - 900 / 595) < 1e-9);
    assert.ok(r.height > r.width, "a sideways table is taller than wide on the upright page");
  }
});

test("bboxToPagePercent is zoom-free and agrees with the pixel rect", () => {
  const page = { w: 842, h: 595, textRotation: -90 };
  const bbox = [43.35, 103.83, 768.55, 563.84];
  const pct = bboxToPagePercent(bbox, page);
  const px = bboxToPageRect(bbox, page, { clientWidth: 595 * 1.7 });
  assert.ok(Math.abs((pct.left / 100) * 595 * 1.7 - px.left) < 1e-6);
  assert.ok(Math.abs((pct.height / 100) * 842 * 1.7 - px.height) < 1e-6);
  const upright = bboxToPagePercent([0, 0, 50, 100], { w: 100, h: 200 });
  assert.deepEqual(upright, { left: 0, top: 0, width: 50, height: 50 });
  assert.equal(parsedBoxPlan({ id: "x", bbox: [0, 0, 0, 0] }, { w: 100, h: 100 }), null);
});

function sample() {
  return {
    sha256: "abc",
    engine: "builtin",
    optsHash: "h",
    pages: [{ n: 1, w: 100, h: 200, rotation: 0 }],
    order: ["h1", "p1", "t1", "f1"],
    blocks: {
      h1: { id: "h1", type: "heading", page: 1, text: "A", bbox: [0, 0, 100, 10] },
      p1: { id: "p1", type: "para", page: 1, text: "x", bbox: [0, 12, 100, 20] },
      t1: { id: "t1", type: "table", page: 1, rows: 1, cols: 2, bbox: [0, 30, 100, 60], grid: { xs: [0, 50, 100], ys: [30, 45, 60] }, cells: [{ r: 0, c: 0, text: "a" }, { r: 0, c: 1, text: "b" }] },
      f1: { id: "f1", type: "figure", page: 1, bbox: [0, 70, 100, 100] },
    },
  };
}

function rig({ storage = null, loaded = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = globalThis.document;
  const page = doc.createElement("div");
  page.className = "page";
  page.setAttribute("data-page-number", "1");
  if (loaded) page.setAttribute("data-loaded", "true");
  page._rect = { left: 10, top: 20, width: 100, height: 200, right: 110, bottom: 220 };
  doc.body.append(page);
  const calls = [];
  const copied = [];
  const before = stub.listenerCount();
  const chips = createPageChips({
    doc,
    getParsed: () => {
      const doc = sample();
      doc.blocks.h1.text = "Introduction";
      doc.blocks.p1.text = "Body text";
      return doc;
    },
    pageEl: (n) => (n === 1 ? page : null),
    pageOf: () => ({ w: 100, h: 200, rotation: 0 }),
    run: (act, item) => calls.push({ act, ...item }),
    copy: (block) => copied.push(block.id),
    storage,
  });
  return { stub, restore, doc, page, calls, copied, chips, before };
}

const memory = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};

test("Show parsed: default on, one soft box and one copy icon per parsed block, boxes take no pointer", () => {
  const h = rig();
  try {
    h.stub.flushFrames();
    const layer = h.page.querySelector(".pxd-parsed-layer");
    assert.ok(layer, "layer painted");
    const boxes = h.page.querySelectorAll(".pxd-parsed-box");
    const icons = h.page.querySelectorAll(".pxd-parsed-copy");
    assert.equal(boxes.length, 4);
    assert.equal(icons.length, 4);
    assert.ok(boxes.every((b) => b.style.pointerEvents === "none"));
    assert.equal(layer.style.pointerEvents, "none");
    assert.ok(icons.every((b) => !b.style.pointerEvents), "pointer-events is driven by the class only, never inline");
    const table = boxes.find((b) => b.getAttribute("data-block") === "t1");
    assert.equal(table.style.top, "calc(15% - 3px)");
    assert.equal(table.style.height, "calc(15% + 6px)");
    assert.equal(h.chips.boxCount(), 4);
    assert.equal(h.calls.length, 0, "painting runs no action");
  } finally { h.chips.dispose(); h.restore(); }
});

test("copy icon copies its block, swallows the press, and no chip action runs", () => {
  const h = rig();
  try {
    h.stub.flushFrames();
    const icon = h.page.querySelectorAll(".pxd-parsed-copy").find((n) => n.getAttribute("data-block") === "t1");
    const down = h.stub.dispatch(icon, "pointerdown", { clientX: 5, clientY: 50 });
    assert.equal(down.defaultPrevented, true);
    assert.equal(down.propagationStopped, true);
    icon.click();
    assert.deepEqual(h.copied, ["t1"]);
    assert.equal(h.calls.length, 0);
  } finally { h.chips.dispose(); h.restore(); }
});

test("hover strengthens the block's box; leaving restores it", () => {
  const h = rig();
  try {
    h.stub.flushFrames();
    h.stub.dispatch(h.page, "pointermove", { clientX: 60, clientY: 20 + 45 });
    const box = h.page.querySelectorAll(".pxd-parsed-box").find((b) => b.getAttribute("data-block") === "t1");
    assert.equal(box.classList.contains("pxd-parsed-box--hot"), true);
    assert.ok(h.page.querySelector(".pxd-page-chip"));
    h.chips.hide();
    assert.equal(box.classList.contains("pxd-parsed-box--hot"), false);
  } finally { h.chips.dispose(); h.restore(); }
});

test("toggle off removes the boxes and is remembered on this device", () => {
  const storage = memory();
  const h = rig({ storage });
  try {
    h.stub.flushFrames();
    assert.equal(h.chips.shown(), true);
    assert.equal(h.chips.setShown(false), false);
    assert.equal(storage.map.get(SHOW_PARSED_KEY), "0");
    assert.equal(h.page.querySelector(".pxd-parsed-layer"), null);
    assert.equal(readShowParsed(storage), false);
    h.chips.setShown(true);
    assert.equal(h.page.querySelectorAll(".pxd-parsed-box").length, 4);
  } finally { h.chips.dispose(); h.restore(); }
  const off = memory();
  writeShowParsed(off, false);
  const h2 = rig({ storage: off });
  try {
    h2.stub.flushFrames();
    assert.equal(h2.page.querySelector(".pxd-parsed-layer"), null);
  } finally { h2.chips.dispose(); h2.restore(); }
  assert.equal(readShowParsed(null), true);
});

test("a page the reader re-renders gets its layer back; dispose removes layers, observers and listeners", () => {
  const h = rig();
  try {
    h.stub.flushFrames();
    const layer = h.page.querySelector(".pxd-parsed-layer");
    layer.remove();
    h.stub.flushMutations();
    h.stub.flushFrames();
    assert.equal(h.page.querySelector(".pxd-parsed-layer"), layer, "same layer re-appended, not rebuilt");
    h.chips.dispose();
    assert.equal(h.page.querySelector(".pxd-parsed-layer"), null);
    assert.equal(h.stub.listenerCount(), h.before);
  } finally { h.restore(); }
});

test("lazy paint: with pdf.js load marks only drawn pages get a layer", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const mk = (n, loaded) => {
      const p = doc.createElement("div");
      p.className = "page";
      p.setAttribute("data-page-number", String(n));
      if (loaded) p.setAttribute("data-loaded", "true");
      doc.body.append(p);
      return p;
    };
    const p1 = mk(1, true);
    const p2 = mk(2, false);
    const parsed = sample();
    parsed.blocks.p1.page = 2;
    parsed.blocks.p1.text = "Body text";
    const chips = createPageChips({ doc, getParsed: () => parsed, pageEl: (n) => (n === 1 ? p1 : n === 2 ? p2 : null), pageOf: () => ({ w: 100, h: 200 }), run() {} });
    stub.flushFrames();
    assert.ok(p1.querySelector(".pxd-parsed-layer"));
    assert.equal(p2.querySelector(".pxd-parsed-layer"), null);
    p2.setAttribute("data-loaded", "true");
    stub.dispatch(p2, "scroll");
    stub.flushFrames();
    assert.equal(p2.querySelectorAll(".pxd-parsed-box").length, 1);
    chips.dispose();
  } finally { restore(); }
});

test("chip plans offer Insert beside PDF for every board insert, and the chip passes pointer and source rect", () => {
  const doc = sample();
  for (const id of ["t1", "f1", "h1"]) {
    const plan = chipPlan(doc.blocks[id], doc);
    const beside = plan.menu.find((m) => m.label === BESIDE_LABEL);
    assert.ok(beside, id);
    assert.equal(beside.extra.beside, true);
    assert.equal(beside.act, plan.primary.act);
    assert.ok(PLACE_ACTS.includes(plan.primary.act));
  }
  const h = rig();
  try {
    h.stub.dispatch(h.page, "pointermove", { clientX: 60, clientY: 20 + 45 });
    const main = h.page.querySelector(".pxd-page-chip__main");
    h.stub.dispatch(main, "click", { clientX: 100, clientY: 52 });
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].pointer, { x: 100, y: 52 });
    assert.deepEqual(h.calls[0].from, { left: 10, top: 50, width: 100, height: 30 });
  } finally { h.chips.dispose(); h.restore(); }
});

test("runChipAction hands a placed client point to the session", () => {
  const seen = [];
  const session = { insertParsedTable: (p) => seen.push(p) };
  runChipAction({ act: "table", ids: ["t1"], extra: { mode: "native", kind: "table" }, client: { x: 300, y: 120 } }, { session, payload: (ids) => ({ ids }) });
  assert.deepEqual(seen[0], { ids: ["t1"], mode: "native", kind: "table", client: { x: 300, y: 120 } });
});

function placeRig() {
  const stub = createDomStub({ width: 1200, height: 800 });
  const restore = stub.install();
  const doc = globalThis.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const pane = doc.createElement("aside");
  pane._rect = { left: 800, top: 0, width: 400, height: 800, right: 1200, bottom: 800 };
  root.append(pane);
  return { stub, restore, doc, root, pane };
}

test("click-to-place: the preview follows the pointer and a board click places at its top-left", () => {
  const r = placeRig();
  try {
    const before = r.stub.listenerCount();
    const placed = [];
    const p = startPlacement({
      doc: r.doc, root: r.root, pane: r.pane, pointer: { x: 900, y: 100 }, from: { left: 820, top: 80, width: 300, height: 200 },
      content: { kind: "table", rows: [["a", "b"], ["1", "2"]], rowCap: 8 }, width: 420, zoom: 1, blocked: [],
      onPlace: (at) => placed.push(at), onCancel: () => placed.push("cancel"),
    });
    const node = p.ghost.element();
    assert.equal(node.style.width, "420px");
    assert.ok(node.classList.contains("pxd-ghost--place"));
    assert.ok(r.root.classList.contains("pxd-root--placing"));
    assert.equal(p.ghost.zone(), "pane");
    r.stub.dispatch(r.doc.body, "pointermove", { clientX: 400, clientY: 300 });
    r.stub.flushFrames();
    assert.equal(p.ghost.zone(), "board");
    const down = r.stub.dispatch(r.doc.body, "pointerdown", { clientX: 400, clientY: 300, button: 0 });
    assert.equal(down.defaultPrevented, true);
    assert.equal(placed.length, 1);
    const drop = p.ghost.dropPoint();
    assert.deepEqual(placed[0].client, { x: drop.x, y: drop.y });
    // Centred on the pointer at board zoom 1: top-left = pointer - half the preview.
    assert.equal(placed[0].client.x, 400 - 210);
    assert.equal(p.active(), false);
    assert.equal(r.root.classList.contains("pxd-root--placing"), false);
    const click = r.stub.dispatch(r.doc.body, "click", { clientX: 400, clientY: 300 });
    assert.equal(click.propagationStopped, true, "the placing click does not reach the board");
    r.stub.flushTimers();
    assert.equal(r.stub.listenerCount(), before, "listeners released");
  } finally { r.restore(); }
});

test("click-to-place: Esc, a pane click and a right click cancel without placing", () => {
  for (const how of ["escape", "pane", "right"]) {
    const r = placeRig();
    try {
      const out = [];
      const p = startPlacement({ doc: r.doc, root: r.root, pane: r.pane, pointer: { x: 900, y: 100 }, content: { kind: "text", text: "Hi" }, zoom: 1, blocked: [], onPlace: () => out.push("place"), onCancel: (why) => out.push(why) });
      if (how === "escape") r.stub.dispatch(globalThis.window, "keydown", { key: "Escape" });
      if (how === "pane") r.stub.dispatch(r.doc.body, "pointerdown", { clientX: 900, clientY: 200, button: 0 });
      if (how === "right") {
        r.stub.dispatch(r.doc.body, "pointermove", { clientX: 300, clientY: 200 });
        r.stub.dispatch(r.doc.body, "pointerdown", { clientX: 300, clientY: 200, button: 2 });
      }
      assert.deepEqual(out, [{ escape: "escape", pane: "outside", right: "button" }[how]], how);
      assert.equal(p.active(), false);
      p.dispose();
    } finally { r.restore(); }
  }
});

test("parse actions land at the placed point through toWorld, else beside the PDF", async () => {
  const doc = sample();
  const calls = [];
  const session = {
    insertParsedTable: async (a) => { calls.push(["table", a]); return { ok: true, uid: "t" }; },
    insertParsedCard: async (a) => { calls.push(["card", a]); return { ok: true, uid: "c" }; },
    sendParsedToBoard: async (a) => { calls.push(["send", a]); return { ok: true, uids: ["s"] }; },
  };
  const actions = createParseActions({
    session,
    store: { getParse: async () => doc, getImage: async () => null },
    placeBeside: () => ({ x: 500, y: 40 }),
    toWorld: (pt) => ({ x: pt.x * 2, y: pt.y * 2 }),
  });
  const base = { sha256: "abc", engine: "builtin", optsHash: "h", pdfUid: "pdf" };
  await actions.insertParsedTable({ ...base, ids: ["t1"], kind: "table", mode: "grid", client: { x: 10, y: 20 } });
  await actions.insertParsedCard({ ...base, ids: ["p1"], client: { x: 3, y: 4 } });
  await actions.sendParsedToBoard({ ...base, ids: ["h1", "p1"], kind: "blocks", client: { x: 7, y: 8 } });
  await actions.insertParsedCard({ ...base, ids: ["p1"], beside: true });
  assert.deepEqual([calls[0][1].x, calls[0][1].y], [20, 40]);
  assert.equal(calls[0][1].mode, "grid");
  assert.deepEqual([calls[1][1].x, calls[1][1].y], [6, 8]);
  assert.deepEqual([calls[2][1].x, calls[2][1].y], [14, 16]);
  assert.deepEqual([calls[3][1].x, calls[3][1].y], [500, 40]);
});

test("placementContent: table preview rows and inserted width, figure caption, text", () => {
  const doc = sample();
  const t = placementContent(doc, ["t1"], "table", { mode: "native" });
  assert.equal(t.content.kind, "table");
  assert.deepEqual(t.content.rows[0], ["a", "b"]);
  assert.equal(t.content.mode, "native");
  assert.ok(t.width >= 200 && t.width <= 900);
  assert.equal(placementContent(doc, ["f1"], "card").content.kind, "figure");
  const text = placementContent(doc, ["h1", "p1"], "board");
  assert.equal(text.content.text, "A x");
  assert.equal(text.width, 280);
});

test("tooltips exist for the copy icon and the Show parsed toggle", () => {
  assert.ok(TIP_TEXT["page-chip.copy"]?.desc);
  assert.ok(TIP_TEXT["parse.show-parsed"]?.desc);
});

test("skipParsedBox: specks, bare marks and tiny images get no box; real blocks and tables do", () => {
  const page = { w: 600, h: 800 };
  const plan = (w, h) => ({ width: (w / 600) * 100, height: (h / 800) * 100 });
  assert.equal(skipParsedBox({ type: "figure" }, plan(30, 10), page), true, "logo speck");
  assert.equal(skipParsedBox({ type: "para", text: "long enough text" }, plan(30, 10), page), true, "under 14 tall and 40 wide");
  assert.equal(skipParsedBox({ type: "para", text: "long enough text" }, plan(200, 10), page), false, "a thin wide line stays");
  assert.equal(skipParsedBox({ type: "para", text: "long enough text" }, plan(30, 40), page), false, "a narrow tall block stays");
  for (const mark of ["1", "a", "*", "†", "‡", "12", "a,"]) {
    assert.equal(skipParsedBox({ type: "para", text: mark }, plan(60, 20), page), mark !== "a,", `mark ${mark}`);
  }
  assert.equal(skipParsedBox({ type: "para", text: "Keyword" }, plan(60, 20), page), false);
  assert.equal(skipParsedBox({ type: "figure" }, plan(100, 20), page), true, "image under 24 px tall");
  assert.equal(skipParsedBox({ type: "figure" }, plan(20, 100), page), true, "image under 24 px wide");
  assert.equal(skipParsedBox({ type: "figure" }, plan(100, 60), page), false);
  assert.equal(skipParsedBox({ type: "table", text: "1" }, plan(100, 60), page), false);
});

test("copyHoverId: the box under the pointer or its own button; smallest box wins; empty page none", () => {
  const page = { w: 100, h: 200 };
  const entries = [
    { id: "big", left: 10, top: 10, width: 80, height: 50, dy: 0 },
    { id: "small", left: 30, top: 20, width: 20, height: 10, dy: 0 },
  ];
  assert.equal(copyHoverId(entries, 35, 40, page), "small");
  assert.equal(copyHoverId(entries, 80, 50, page), "big");
  assert.equal(copyHoverId(entries, 2, 150, page), null);
  // On this narrow page the gutter would fall off the page, so the button sits inside the box's left edge.
  assert.equal(copyHoverId(entries, 1, 25, page), null, "a 100 px page has no gutter: the button moved inside");
  const nudged = [{ id: "n", left: 50, top: 10, width: 10, height: 5, dy: 20 }];
  assert.equal(copyHoverId(nudged, 30, 40, page), "n");
  assert.equal(copyHoverId(nudged, 30, 20, page), null);
});

test("copy buttons hide at rest and show only for the hovered box; one delegated listener, none added", () => {
  const h = rig();
  try {
    h.stub.flushFrames();
    const icons = h.page.querySelectorAll(".pxd-parsed-copy");
    const shown = () => icons.filter((n) => n.classList.contains("pxd-parsed-copy--show")).map((n) => n.getAttribute("data-block"));
    assert.deepEqual(shown(), [], "nothing at rest");
    assert.ok(icons.every((n) => !n.style.pointerEvents), "no inline pointer-events: the CSS class decides");
    const count = h.stub.listenerCount();
    h.stub.dispatch(h.page, "pointermove", { clientX: 10 + 60, clientY: 20 + 16 });
    assert.deepEqual(shown(), ["p1"], "a plain paragraph has no chip, only the copy button");
    assert.equal(h.stub.listenerCount(), count, "hover adds no listener");
    h.stub.dispatch(h.page, "pointermove", { clientX: 10 + 60, clientY: 20 + 45 });
    assert.deepEqual(shown(), ["t1"]);
    h.stub.dispatch(h.page, "pointermove", { clientX: 10 + 60, clientY: 20 + 85 });
    assert.deepEqual(shown(), ["f1"], "moves to the next box");
    h.stub.dispatch(h.page, "pointermove", { clientX: 10 + 60, clientY: 20 + 190 });
    assert.deepEqual(shown(), [], "empty page space hides it");
    h.stub.dispatch(h.page, "pointermove", { clientX: 10 + 60, clientY: 20 + 45 });
    h.stub.dispatch(h.page, "pointerleave", {});
    assert.deepEqual(shown(), [], "leaving hides it");
    const css = readFileSync(new URL("../src/css/page-chips.css", import.meta.url), "utf8");
    assert.match(css, /\.pxd-parsed-copy \{[^}]*opacity: 0;/s);
    assert.match(css, /\.pxd-parsed-copy\.pxd-parsed-copy--show[^{]*\{[^}]*pointer-events: auto/s);
    assert.match(css, /pxd-parsed-copy:focus-visible/);
    assert.match(css, /transition: opacity/);
  } finally { h.chips.dispose(); h.restore(); }
});

test("tiny blocks and marks get no box at all", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const page = doc.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "1");
    page._rect = { left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 };
    doc.body.append(page);
    const parsed = {
      pages: [{ n: 1, w: 600, h: 800, rotation: 0 }],
      order: ["logo", "sup", "chip", "para", "img"],
      blocks: {
        logo: { id: "logo", type: "figure", page: 1, bbox: [10, 10, 30, 22] },
        sup: { id: "sup", type: "para", page: 1, text: "1,", bbox: [100, 100, 130, 130] },
        chip: { id: "chip", type: "para", page: 1, text: "a", bbox: [100, 140, 130, 170] },
        para: { id: "para", type: "para", page: 1, text: "Real paragraph text", bbox: [50, 200, 500, 260] },
        img: { id: "img", type: "figure", page: 1, bbox: [50, 300, 70, 500] },
      },
    };
    const chips = createPageChips({ doc, getParsed: () => parsed, pageEl: () => page, pageOf: () => ({ w: 600, h: 800 }), run() {} });
    stub.flushFrames();
    const ids = page.querySelectorAll(".pxd-parsed-box").map((b) => b.getAttribute("data-block"));
    assert.deepEqual(ids, ["sup", "para"], "the 1-char mark, the speck logo and the thin image are skipped; '1,' is not a pure mark");
    chips.dispose();
  } finally { restore(); }
});

test("a shown copy button can take the click: no inline pointer-events overrides the --show class, and the click copies", () => {
  const h = rig();
  try {
    h.stub.flushFrames();
    h.stub.dispatch(h.page, "pointermove", { clientX: 10 + 60, clientY: 20 + 45 });
    const shown = h.page.querySelectorAll(".pxd-parsed-copy").filter((n) => n.classList.contains("pxd-parsed-copy--show"));
    assert.equal(shown.length, 1);
    assert.equal(shown[0].style.pointerEvents || "", "", "the stylesheet decides, so --show wins");
    shown[0].click();
    assert.deepEqual(h.copied, [shown[0].getAttribute("data-block")]);
    const css = readFileSync(new URL("../src/css/page-chips.css", import.meta.url), "utf8");
    assert.match(css, /\.pxd-parsed-copy \{[^}]*pointer-events: none/s);
  } finally { h.chips.dispose(); h.restore(); }
});

const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test("chip never covers the copy button: box at the left edge, middle and right edge of the page", () => {
  const page = { w: 600, h: 800 };
  const chipW = 112;
  for (const [name, left, width] of [["left edge", 0, 12], ["middle", 40, 10], ["right edge", 88, 12], ["wide box", 10, 80], ["narrow at 8%", 8, 6]]) {
    const entry = { left, top: 10, width, height: 5 };
    const spot = copyIconSpot(entry, page, 0);
    const boxRight = ((left + width) / 100) * page.w + 3;
    const chipTop = (10 / 100) * page.h - 3;
    const x = chipClearLeft(boxRight - chipW, { w: chipW, top: chipTop, h: 20 }, spot);
    const btn = { x: spot.x, y: spot.y, w: spot.size, h: spot.size };
    assert.equal(intersects({ x, y: chipTop, w: chipW, h: 20 }, btn), false, name);
    if (left === 0) assert.equal(spot.inside, true, "gutter off the page: inside-left");
    else if (left * 6 - 3 - 5 - 18 >= 0) assert.equal(spot.inside, false, `${name}: gutter button`);
  }
  // A wide box keeps the chip where it was.
  const wide = copyIconSpot({ left: 10, top: 10, width: 80, height: 5 }, page, 0);
  assert.equal(chipClearLeft(500 - 112, { w: 112, top: 77, h: 20 }, wide), 388);
});

test("copyIconSpot: gutter ~20 px left of the box, top aligned; inside only when the gutter is off the page", () => {
  const page = { w: 600, h: 800 };
  const g = copyIconSpot({ left: 20, top: 10 }, page, 0);
  assert.equal(g.inside, false);
  assert.equal(g.x, 120 - 3 - 5 - 18);
  assert.equal(g.y, 80 - 3 - 1);
  const edge = copyIconSpot({ left: 0, top: 10 }, page, 0);
  assert.equal(edge.inside, true);
  assert.equal(edge.x, -3 + 2);
  assert.equal(copyIconSpot({ left: 20, top: 10 }, page, 20).y, g.y + 20, "the stacking nudge still drops it");
});

test("the hit zone covers the gutter button, and the button stays shown while the pointer is on it", () => {
  const page = { w: 600, h: 800 };
  const entries = [{ id: "a", left: 30, top: 10, width: 40, height: 5, dy: 0 }];
  const spot = copyIconSpot(entries[0], page, 0);
  assert.equal(copyHoverId(entries, spot.x + 4, spot.y + 4, page), "a");
  assert.equal(copyHoverId(entries, spot.x - 4, spot.y + 4, page), null);
});

test("copy click copies that block and the button says Copied for a moment", () => {
  const h = rig();
  try {
    h.stub.flushFrames();
    const icon = h.page.querySelectorAll(".pxd-parsed-copy").find((n) => n.getAttribute("data-block") === "t1");
    const label = icon.getAttribute("aria-label");
    icon.click();
    assert.deepEqual(h.copied, ["t1"]);
    assert.equal(icon.getAttribute("aria-label"), "Copied");
    assert.equal(icon.classList.contains("pxd-parsed-copy--copied"), true);
    assert.ok(COPIED_MS >= 1000 && COPIED_MS <= 1500);
    h.stub.flushTimers?.();
    assert.equal(icon.getAttribute("aria-label"), label);
    assert.equal(icon.classList.contains("pxd-parsed-copy--copied"), false);
  } finally { h.chips.dispose(); h.restore(); }
});
