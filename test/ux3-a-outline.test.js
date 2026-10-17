// UX3 lane A: cards look and edit like a Roam outline. Display rows and the editor share one geometry,
// show the whole stored depth, and keep the caret where the click landed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { noteSpeedFlags } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const blk = (uid, string, children = [], extra = {}) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": 0,
  ":block/children": children,
  ...extra,
});

// Card "he" with test › [[Todd Zenger]] › TEST, the user's frames, plus a folded branch.
function heTree() {
  return [
    blk("kidT00001", "test", [
      blk("kidZ00001", "[[Todd Zenger]]", [blk("kidX00001", "TEST")]),
    ]),
    blk("kidF00001", "folded", [blk("kidG00001", "hidden grandchild")], { ":block/open": false }),
  ];
}

function pulled(cards) {
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": cards.map((c, i) => ({
      ":block/uid": c.uid,
      ":block/string": c.string,
      ":block/order": i,
      ":block/props": { ":plexus": { ":x": i * 400, ":y": 0, ":w": 260, ":h": 220, ...(c.plexus || {}) } },
      ":block/children": c.children || [],
    })),
  };
}

function mount({ cards, zoom = 1, settings, host: hostExtra = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom }));
  const board = buildBoard(pulled(cards || [{ uid: "cardHE001", string: "he", plexus: { ":kids": true }, children: heTree() }]));
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    mutations,
    on() { return () => {}; },
    release() {},
    setLinkMode() {},
    commitMove: rec("commitMove"),
    commitRects: rec("commitRects"),
    createCard: rec("createCard"),
    setString: rec("setString"),
    setKids: rec("setKids"),
    setNodeOpen: rec("setNodeOpen"),
    setBlockOpen: rec("setBlockOpen"),
    setCollapsed: rec("setCollapsed"),
    growToFit: rec("growToFit"),
    addCardChild: rec("addCardChild"),
    updateEdge: rec("updateEdge"),
    addEdge: rec("addEdge"),
  };
  const calls = { renderString: 0, renderBlock: [], focus: [] };
  const host = {
    graph: "Svy",
    renderString(el, string) { calls.renderString += 1; el.textContent = string; },
    renderBlock(el, uid) { calls.renderBlock.push(uid); },
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    updateString: rec("updateString"),
    createBlock: rec("createBlock"),
    ...hostExtra,
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: settings || { get: () => undefined },
    version: "3.34.0",
  });
  return { stub, restore, session, view, host, calls };
}

async function show(f) {
  f.stub.flushFrames();
  await tick();
  f.stub.flushIdle();
  f.stub.flushFrames();
  await tick(5);
  f.stub.flushIdle();
  f.stub.flushFrames();
}

// The display row tree of a card: [{ uid, kids: [...] }] from data-pxd-row rows that are not hidden.
function rowTree(parent) {
  const out = [];
  for (const node of parent.children || []) {
    if (!node.classList?.contains("pxd-block")) continue;
    const uid = node.getAttribute("data-pxd-row");
    const wrap = [...node.children].find((c) => c.classList?.contains("pxd-block__children"));
    const open = wrap && !wrap.hasAttribute("hidden");
    out.push({ uid, kids: open ? rowTree(wrap) : [] });
  }
  return out;
}

test("A1: a note card shows its children to the stored depth; a folded block stays folded with Roam's closed bullet", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardHE001]");
    const body = card.querySelector(".pxd-item__body");
    assert.deepEqual(rowTree(body), [
      { uid: "kidT00001", kids: [{ uid: "kidZ00001", kids: [{ uid: "kidX00001", kids: [] }] }] },
      { uid: "kidF00001", kids: [] },
    ]);
    assert.equal(card.querySelector("[data-pxd-row=kidG00001]"), null, "a folded block does not draw its children");
    const folded = card.querySelector("[data-pxd-row=kidF00001]");
    assert.equal(folded.classList.contains("pxd-outline--closed"), true);
    assert.equal(folded.querySelector(".pxd-outline__caret").getAttribute("aria-expanded"), "false");
    assert.equal(card.classList.contains("pxd-item--ol"), true, "note cards carry the Roam outline geometry class");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("A1: roamOutline off drops the outline geometry class", async () => {
  noteSpeedFlags({ roamOutline: false });
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardHE001]");
    assert.equal(card.classList.contains("pxd-item--ol"), false);
  } finally {
    noteSpeedFlags(null);
    f.view.dispose();
    f.restore();
  }
});

// ---- geometry. The stub has no layout, so the rows are placed from the declared CSS: each side's text x and row
// pitch at depth 1..3 come from its own rules, with every var() resolved from the one token rule.
const OUTLINE_CSS = readFileSync(new URL("../src/css/ux3-outline.css", import.meta.url), "utf8");

function rules(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = {};
    for (const part of m[2].split(";")) {
      const at = part.indexOf(":");
      if (at < 0) continue;
      decl[part.slice(0, at).trim()] = part.slice(at + 1).replace(/!important/, "").trim();
    }
    const sels = [];
    let depth = 0;
    let cur = "";
    for (const ch of m[1]) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { sels.push(cur); cur = ""; } else cur += ch;
    }
    sels.push(cur);
    for (const sel of sels) out.push({ sel: sel.trim().replace(/\s+/g, " "), decl });
  }
  return out;
}

const RULES = rules(OUTLINE_CSS);
const decl = (sel, prop) => {
  let hit;
  for (const r of RULES) if (r.sel === sel && r.decl[prop] !== undefined) hit = r.decl[prop];
  return hit;
};

const TOKENS = (() => {
  const out = {};
  for (const r of RULES) {
    if (r.sel !== ".pxd-root .pxd-item.pxd-item--ol") continue;
    for (const [k, v] of Object.entries(r.decl)) if (k.startsWith("--")) out[k] = v;
  }
  return out;
})();

// Resolves calc() over px, var(), and the editor's --pxd-ed-z (1 at zoom 1, the zoom otherwise).
function px(value, z = 1) {
  if (value === undefined) return NaN;
  let expr = String(value);
  for (let i = 0; i < 4; i += 1) {
    expr = expr.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name, fb) => {
      if (name === "--pxd-ed-z") return String(z);
      return TOKENS[name] !== undefined ? `(${TOKENS[name]})` : (fb ?? "NaN");
    });
  }
  expr = expr.replace(/calc/g, "").replace(/(-?\d*\.?\d+)px/g, "$1");
  if (/[^\d\s.+\-*/()]/.test(expr)) return NaN;
  return Function(`"use strict"; return (${expr});`)();
}

const D = ".pxd-root .pxd-item.pxd-item--ol";
const E = ".pxd-root .pxd-item.pxd-item--ol.pxd-item--editing > .pxd-item__body > .pxd-item__editor:not(.pxd-page-edit)";

function displayTextX(depth) {
  const indent = px(decl(`${D} .pxd-block__children`, "margin-left"));
  const bullet = px(decl(`${D} .pxd-outline__bullet`, "width"));
  const gap = px(decl(`${D} .pxd-outline__bullet`, "margin-right"));
  assert.equal(decl(`${D} .pxd-outline__caret`, "position"), "absolute", "the display caret hangs outside the text column");
  return (depth - 1) * indent + bullet + gap;
}

// The editor is laid out at screen size (z times) and scaled back by 1/z, so world x = screen x / z.
function editTextX(depth, z) {
  const top = px(decl(`${E} > .rm-api-render--block > .roam-block-container > .rm-block-children`, "margin-left"), z);
  const nested = px(decl(`${E} .rm-block-children`, "margin-left"), z);
  const controls = `${E} .rm-block-children .rm-block-main > :is(.controls, .rm-block__controls)`;
  const bullet = px(decl(controls, "width"), z);
  const gap = px(decl(controls, "margin-right"), z);
  assert.equal(decl(`${controls} :is(.block-expand, .rm-caret)`, "position"), "absolute", "Roam's caret hangs outside the text column");
  return (top + (depth - 1) * nested + bullet + gap) / z;
}

test("A1: display rows and the Roam editor put the text at the same x for depth 1, 2 and 3, at any zoom", () => {
  for (const z of [1, 0.6, 1.5]) {
    for (const depth of [1, 2, 3]) {
      const d = displayTextX(depth);
      const e = editTextX(depth, z);
      assert.ok(Number.isFinite(d) && d > 0, `display x at depth ${depth}`);
      assert.ok(Math.abs(d - e) < 0.01, `depth ${depth} zoom ${z}: display ${d} vs edit ${e}`);
    }
  }
  // The top block (the card's own string) has no bullet in either mode.
  assert.equal(decl(`${E} > .rm-api-render--block > .roam-block-container > .rm-block-main > :is(.controls, .rm-block__controls)`, "display"), "none");
});

test("A1: the row pitch, bullet box and thread line are the same in display and edit", () => {
  for (const z of [1, 0.6]) {
    const row = px(decl(`${D} .pxd-outline__line`, "min-height"));
    const editRow = px(decl(`${E} .rm-block-children .rm-block-main`, "min-height"), z) / z;
    assert.equal(row, editRow);
    assert.equal(decl(`${D} .pxd-block.pxd-outline`, "margin"), "0");
    assert.equal(decl(`${E} .roam-block-container`, "margin"), "0");
    // Bullet: the same dot in the same box.
    const dot = px(decl(`${D} .pxd-outline__bullet::before`, "width"));
    const editDot = px(decl(`${E} .rm-block-children .rm-bullet__inner`, "width"), z) / z;
    assert.equal(dot, 5);
    assert.equal(editDot, dot);
    assert.equal(px(decl(`${E} .rm-block-children .rm-bullet`, "width"), z) / z, px(decl(`${D} .pxd-outline__bullet`, "width")));
    // Thread line: 1px under the parent's bullet centre, at the same x.
    const line = px(decl(`${D} .pxd-block__children::before`, "left"));
    const editLine = px(decl(`${E} .rm-block-children > .rm-multibar`, "left"), z) / z;
    assert.equal(line, editLine);
    assert.equal(px(decl(`${D} .pxd-block__children::before`, "width")), 1);
    assert.equal(px(decl(`${E} .rm-block-children > .rm-multibar`, "width"), z) / z, 1);
    assert.equal(decl(`${E} > .rm-api-render--block > .roam-block-container > .rm-block-children > .rm-multibar`, "display"), "none");
    // Bullet centre sits under the parent text start: indent == bullet + gap.
    assert.equal(px(TOKENS["--pxd-ol-indent"]), px(TOKENS["--pxd-ol-bullet"]) + px(TOKENS["--pxd-ol-gap"]));
    assert.equal(line, px(TOKENS["--pxd-ol-bullet"]) / 2 - px(TOKENS["--pxd-ol-indent"]));
  }
});

// ---- A2: rows render like the editor (Roam's renderString), not stripped plain text.
const LONG = `${"Cronobacter sakazakii is the flagship pathogen risk for powdered infant formula ".repeat(4)}end-of-row`;
function pageCards() {
  return [
    { uid: "cardPG001", string: "[[Pathogen Page]]", plexus: { ":h": 240 } },
  ];
}
const pageHost = {
  pageUid: (t) => `uid-${t}`,
  watchPage: () => () => {},
  pageOutline: (title) => ({
    uid: `uid-${title}`,
    title,
    exists: true,
    blocks: [
      { uid: "rowRel001", string: "Related", children: [
        { uid: "rowRef001", string: "[[Powdered Infant Formula]] · [[Biosensors]] · **AOAC**", children: [] },
      ] },
      { uid: "rowLong01", string: LONG, children: [] },
      { uid: "rowHeavy1", string: "{{[[roam/render]]: ((abcDEF123))}}", children: [] },
    ],
  }),
};

// A real IntersectionObserver reports later (or, on a busy window, not before the user looks).
class SilentIO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

test("A2: a page card's first screen of rows is Roam's rendering (links, bold), full length; heavy rows keep the placeholder", async () => {
  const f = mount({ cards: pageCards(), host: pageHost });
  const prevIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = SilentIO;
  f.stub.window.IntersectionObserver = SilentIO;
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardPG001]");
    const textOf = (uid) => card.querySelector(`[data-pxd-row=${uid}]`);
    const ref = textOf("rowRef001");
    assert.ok(ref.querySelector(".pxd-rs__live"), "the ref row is a renderString root");
    assert.equal(ref.querySelector(".pxd-block__plain"), null);
    assert.match(ref.textContent, /\[\[Powdered Infant Formula\]\]/, "refs are not stripped");
    const long = textOf("rowLong01");
    assert.ok(long.querySelector(".pxd-rs__live"));
    assert.ok(long.textContent.includes("end-of-row"), "a long row wraps, it is not cut with an ellipsis");
    assert.equal(long.textContent.includes("…"), false);
    const heavy = textOf("rowHeavy1");
    assert.equal(heavy.querySelector(".pxd-block__plain--heavy")?.textContent, "…");
  } finally {
    globalThis.IntersectionObserver = prevIO;
    f.view.dispose();
    f.restore();
  }
});

test("A2: plain rows painted before the upgrade are not cut at 200 characters", async () => {
  noteSpeedFlags({ richRows: false });
  const f = mount({ cards: pageCards(), host: pageHost });
  const prevIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = SilentIO;
  f.stub.window.IntersectionObserver = SilentIO;
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardPG001]");
    const plain = card.querySelector("[data-pxd-row=rowLong01] .pxd-block__plain");
    assert.ok(plain, "richRows off keeps the plain first paint");
    assert.ok(plain.textContent.endsWith("end-of-row"));
  } finally {
    noteSpeedFlags(null);
    globalThis.IntersectionObserver = prevIO;
    f.view.dispose();
    f.restore();
  }
});

test("A2: at overview zoom no card body mounts a renderString root", async () => {
  const cards = [
    { uid: "cardHE001", string: "he", plexus: { ":kids": true }, children: heTree() },
    ...pageCards(),
  ];
  const f = mount({ cards, zoom: 0.1, host: pageHost });
  try {
    await show(f);
    assert.equal(f.view.state().lod === "detail", false);
    assert.equal(f.calls.renderString, 0);
    assert.equal(f.view.root.querySelectorAll(".pxd-rs__live").length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});
