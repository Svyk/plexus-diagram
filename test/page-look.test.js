// Page look: exact geometry on sideways pages, persistent "Show parsed" boxes with copy icons, and
// click-to-place for chip inserts. Nothing here writes to the graph until a placement click.
import assert from "node:assert/strict";
import test from "node:test";

import { bboxToPagePercent, bboxToPageRect, frameBoxToViewport } from "../src/view/parse-overlay.js";
import {
  BESIDE_LABEL,
  PLACE_ACTS,
  SHOW_PARSED_KEY,
  chipPlan,
  createPageChips,
  parsedBoxPlan,
  readShowParsed,
  runChipAction,
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
    getParsed: () => sample(),
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
    assert.ok(icons.every((b) => b.style.pointerEvents === "auto"));
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
