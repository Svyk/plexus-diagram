// UX3 lane A: cards look and edit like a Roam outline. Display rows and the editor share one geometry,
// show the whole stored depth, and keep the caret where the click landed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CHILD_GROW_H, CHILD_ROW_H } from "../src/model/card-children.js";
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
    listeners: {},
    on(name, fn) { session.listeners[name] = fn; return () => {}; },
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
    renderString(el, string) {
      calls.renderString += 1;
      const doc = el.ownerDocument || globalThis.document;
      el.replaceChildren(doc.createTextNode(string));
    },
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
function px(value, z = 1, font = 14) {
  if (value === undefined) return NaN;
  let expr = String(value);
  for (let i = 0; i < 4; i += 1) {
    expr = expr.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name, fb) => {
      if (name === "--pxd-ed-z") return String(z);
      return TOKENS[name] !== undefined ? `(${TOKENS[name]})` : (fb ?? "NaN");
    });
  }
  expr = expr.replace(/calc/g, "").replace(/(-?\d*\.?\d+)px/g, "$1").replace(/(-?\d*\.?\d+)em/g, `($1*${font})`);
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
    // Roam's own `.roam-block { min-height: calc(1.5em + 8px) }` rules every inactive editor row, so the editor
    // declares no row height of its own and the display row must resolve to the same one. The em base is the font
    // (14px text: 29px; at the editor's z-scaled font the same formula gives 29 x z).
    assert.equal(decl(`${E} .rm-block-children .rm-block-main`, "min-height"), undefined, "the editor row keeps Roam's own height");
    const row = px(decl(`${D} .pxd-outline__line`, "min-height"));
    assert.equal(row, 29);
    assert.equal(px(decl(`${D} .pxd-outline__line`, "min-height"), 1, 16), 32, "derived from the em, not a fixed number");
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

// ---- A3: the caret lands in the clicked block at the clicked character, at every depth.
async function settleEdit(stub) {
  const real = Date.now;
  let clock = real() + 50;
  Date.now = () => clock;
  try {
    for (let i = 0; i < 10; i += 1) {
      clock += 200;
      stub.flushFrames();
      await tick();
    }
  } finally {
    Date.now = real;
  }
}

// Roam's editor for the card: view divs that turn into a textarea when clicked, ids ending in the block uid.
function roamEditorHost(placed, inputTop) {
  return {
    renderBlock(el) {
      const doc = el.ownerDocument || globalThis.document;
      const make = (uid, parent) => {
        const box = doc.createElement("div");
        box.className = "roam-block-container";
        const main = doc.createElement("div");
        main.className = "rm-block-main";
        const view = doc.createElement("div");
        view.className = "rm-block__input rm-block__input--view";
        view.id = `block-input-WIN1-body-outline-cardHE001-${uid}`;
        const swap = () => {
          const ta = doc.createElement("textarea");
          ta.className = "rm-block__input";
          ta.id = view.id;
          ta.value = uid;
          ta.setSelectionRange = (start, end) => { ta.selectionStart = start; ta.selectionEnd = end; };
          if (inputTop[uid] != null) ta._rect = { left: 0, top: inputTop[uid], width: 200, height: 18, right: 200, bottom: inputTop[uid] + 18, x: 0, y: inputTop[uid] };
          view.remove();
          main.append(ta);
        };
        view.addEventListener("mousedown", swap, { once: true });
        if (inputTop[uid] != null) view._rect = { left: 0, top: inputTop[uid], width: 200, height: 18, right: 200, bottom: inputTop[uid] + 18, x: 0, y: inputTop[uid] };
        const controls = doc.createElement("div");
        controls.className = "controls rm-block__controls";
        const bullet = doc.createElement("span");
        bullet.className = "rm-bullet";
        bullet.setAttribute("data-test-uid", uid);
        controls.append(bullet);
        main.append(controls);
        main.append(view);
        box.append(main);
        const kids = doc.createElement("div");
        kids.className = "rm-block-children";
        box.append(kids);
        parent.append(box);
        return kids;
      };
      const wrap = doc.createElement("div");
      wrap.className = "rm-api-render--block";
      el.append(wrap);
      const top = make("cardHE001", wrap);
      const child = make("kidT00001", top);
      const grand = make("kidZ00001", child);
      make("kidX00001", grand);
    },
    api: { ui: { setBlockFocusAndSelection: (arg) => { placed.push(arg); } } },
  };
}

test("A3: double-click on a depth-2 row edits that block with the caret at the clicked letter, and the row does not move", async () => {
  const placed = [];
  const f = mount({ host: roamEditorHost(placed, { kidZ00001: 70 }) });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardHE001]");
    const body = card.querySelector(".pxd-item__body");
    body._rect = { left: 0, top: 0, width: 260, height: 220, right: 260, bottom: 220, x: 0, y: 0 };
    const row = card.querySelector("[data-pxd-row=kidZ00001]");
    row._rect = { left: 0, top: 60, width: 200, height: 22, right: 200, bottom: 82, x: 0, y: 60 };
    const live = row.querySelector(".pxd-rs__live");
    const text = live.firstChild;
    assert.equal(text.nodeType, 3);
    f.stub.document.caretPositionFromPoint = () => ({ offsetNode: text, offset: 4 });
    f.stub.window.event = { type: "dblclick", clientX: 50, clientY: 66, target: live };
    f.stub.dispatch(live, "dblclick", { clientX: 50, clientY: 66 });
    await settleEdit(f.stub);
    f.stub.window.event = undefined;
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    const ta = card.querySelector("textarea");
    assert.ok(ta, "the clicked block has the textarea");
    assert.ok(ta.id.endsWith("-kidZ00001"), `focused ${ta.id}`);
    assert.equal(ta.selectionStart, 4);
    // The editor row sat 10px lower than the display row; the body scrolls so it is back under the pointer.
    assert.equal(body.scrollTop, 10);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("A3: childCaret off keeps the 3.34.0 entry (the card's own block)", async () => {
  noteSpeedFlags({ childCaret: false });
  const placed = [];
  const f = mount({ host: roamEditorHost(placed, {}) });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardHE001]");
    const live = card.querySelector("[data-pxd-row=kidZ00001] .pxd-rs__live");
    f.stub.document.caretPositionFromPoint = () => ({ offsetNode: live.firstChild, offset: 4 });
    f.stub.window.event = { type: "dblclick", clientX: 50, clientY: 66, target: live };
    f.stub.dispatch(live, "dblclick", { clientX: 50, clientY: 66 });
    await settleEdit(f.stub);
    f.stub.window.event = undefined;
    const ta = card.querySelector("textarea");
    assert.ok(ta.id.endsWith("-cardHE001"));
  } finally {
    noteSpeedFlags(null);
    f.view.dispose();
    f.restore();
  }
});

// ---- A4: child focus on note cards is the page-card focus: bullet in display or edit, crumb, Escape steps back.
function crumbLabels(card) {
  const crumb = card.querySelector(".pxd-focus__crumb");
  return crumb ? [...crumb.querySelectorAll("button")].map((btn) => btn.textContent) : [];
}

test("A4: a display bullet at depth 3 focuses that block with the crumb; the focused bullet has the zoomed ring; Escape steps back", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardHE001]");
    const bullet = card.querySelector("[data-pxd-row=kidX00001] .pxd-outline__bullet");
    assert.ok(bullet, "the depth-3 row has a bullet");
    bullet.click();
    f.stub.flushFrames();
    assert.deepEqual(crumbLabels(card), ["he", "test", "Todd Zenger", "TEST"]);
    const focused = card.querySelector("[data-pxd-row=kidX00001]");
    assert.equal(focused.classList.contains("pxd-outline--zoomed"), true);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    f.stub.flushFrames();
    assert.deepEqual(crumbLabels(card), ["he", "test", "Todd Zenger"]);
    assert.equal(card.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-outline--zoomed"), true);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("A4: a Roam bullet clicked in the card editor leaves edit and focuses that block on the card (no Roam zoom)", async () => {
  const placed = [];
  const f = mount({ host: roamEditorHost(placed, {}) });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardHE001]");
    f.stub.dispatch(card, "dblclick", { clientX: 40, clientY: 10 });
    await settleEdit(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    const bullet = [...card.querySelectorAll(".pxd-item__editor .rm-bullet")].find((b) => b.getAttribute("data-test-uid") === "kidZ00001");
    assert.ok(bullet);
    let roamSaw = 0;
    f.stub.document.addEventListener("click", () => { roamSaw += 1; });
    f.stub.dispatch(bullet, "click", { clientX: 30, clientY: 40 });
    await settleEdit(f.stub);
    assert.equal(roamSaw, 0, "Roam's own bullet click (zoom the main window) never sees it");
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.deepEqual(crumbLabels(card), ["he", "test", "Todd Zenger"]);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("A4: a page card's focused block has the same zoomed ring", async () => {
  const f = mount({ cards: pageCards(), host: pageHost });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardPG001]");
    card.querySelector("[data-pxd-row=rowRef001] .pxd-outline__bullet").click();
    f.stub.flushFrames();
    assert.deepEqual(crumbLabels(card), ["Pathogen Page", "Related", "Powdered Infant Formula · Biosensors · AOAC"]);
    const prow = card.querySelector("[data-pxd-row=rowRef001]").parentElement;
    assert.equal(prow.classList.contains("pxd-outline--zoomed"), true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ---- A5: a new card and its first children look like Roam while typing and stay exactly so after Escape.
test("A5: parent, child and grandchild typed in a new card show Roam's outline while editing and the same rows after Escape", async () => {
  const placed = [];
  const f = mount({ cards: [{ uid: "cardHE001", string: "he" }], host: roamEditorHost(placed, {}) });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardHE001]");
    f.stub.dispatch(card, "dblclick", { clientX: 40, clientY: 10 });
    await settleEdit(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    assert.equal(card.classList.contains("pxd-item--ol"), true, "the editor has Roam's bullets and thread from the first frame");
    // Shift+Enter on the top block, then a grandchild: the model path writes the blocks and turns children on.
    const next = buildBoard(pulled([{ uid: "cardHE001", string: "he", plexus: { ":kids": true }, children: [
      blk("kidT00001", "test", [blk("kidZ00001", "[[Todd Zenger]]", [blk("kidX00001", "TEST")])]),
    ] }]));
    f.session.board = next;
    f.session.rects = worldRects(next);
    f.session.listeners.change?.({ dirty: new Set(["cardHE001"]), structural: false });
    await settleEdit(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    assert.equal(card.classList.contains("pxd-item--kidsoff"), false, "children are not hidden in the editor once they exist");
    assert.equal(card.classList.contains("pxd-item--ol"), true);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await settleEdit(f.stub);
    await show(f);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    const body = card.querySelector(".pxd-item__body");
    assert.deepEqual(rowTree(body), [
      { uid: "kidT00001", kids: [{ uid: "kidZ00001", kids: [{ uid: "kidX00001", kids: [] }] }] },
    ]);
    assert.equal(card.querySelector("[data-pxd-row=kidX00001] .pxd-outline__bullet") != null, true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("A1 fix: display row min-height is the same declaration as Roam's editor row, and the card grows by one row", () => {
  const ROAM_ROW = "calc(1.5em + 8px)";
  assert.equal(decl(`${D} .pxd-outline__line`, "min-height"), "var(--pxd-ol-row)");
  assert.equal(TOKENS["--pxd-ol-row"], ROAM_ROW);
  assert.equal(decl(`${D} .pxd-outline__line`, "padding-top"), "var(--pxd-ol-pad)");
  assert.equal(px(TOKENS["--pxd-ol-pad"]), 4);
  assert.equal(TOKENS["--pxd-ol-lh"], "1.5");
  assert.equal(decl(`${D} .pxd-outline__line > .pxd-block__text`, "line-height"), "var(--pxd-ol-lh)");
  // Depth 1..3 rows stack at one pitch in both modes: 29 per row at 14px text.
  const pitch = px(TOKENS["--pxd-ol-row"]);
  assert.deepEqual([0, 1, 2, 3].map((d) => d * pitch), [0, 29, 58, 87]);
  assert.equal(CHILD_ROW_H, pitch);
  assert.equal(CHILD_GROW_H, pitch);
});

test("A1 fix 2: the card's own string is a full row, and the editor row box scales with the zoom (29 x z on screen)", () => {
  // Depth 0: display top row has the same box as a child row.
  const top = `${D} > .pxd-item__body > .pxd-item__string`;
  assert.equal(decl(top, "min-height"), "var(--pxd-ol-row)");
  assert.equal(decl(top, "padding-top"), "var(--pxd-ol-pad)");
  assert.equal(decl(top, "padding-bottom"), "var(--pxd-ol-pad)");
  assert.equal(decl(top, "line-height"), "var(--pxd-ol-lh)");
  assert.equal(px(decl(top, "min-height")), 29);
  // Editor row: every inactive row (depth 0 included) is Roam's .roam-block, px parts multiplied by the zoom.
  const row = `${E} .roam-block`;
  for (const z of [1, 0.69, 1.5]) {
    const font = 14 * z;
    const minH = px(decl(row, "min-height"), z, font);
    assert.ok(Math.abs(minH - 29 * z) < 1e-9, `zoom ${z}: editor row ${minH} vs ${29 * z}`);
    assert.ok(Math.abs(px(decl(row, "padding-top"), z, font) - 4 * z) < 1e-9);
    assert.ok(Math.abs(px(decl(row, "padding-bottom"), z, font) - 4 * z) < 1e-9);
    // Bullet offset inside the row scales the same way.
    const controls = `${E} .rm-block-children .rm-block-main > :is(.controls, .rm-block__controls)`;
    assert.ok(Math.abs(px(decl(controls, "margin-top"), z, font) - 4 * z) < 1e-9);
  }
  // At zoom 0.69 the display row is 29 world px, drawn at 0.69 by the board transform: 20.01 on screen.
  assert.ok(Math.abs(px(decl(row, "min-height"), 0.69, 14 * 0.69) - 29 * 0.69) < 1e-9);
  assert.ok(Math.abs(29 * 0.69 - 20.01) < 1e-9);
  // Same top-of-row y at every depth: row tops are equal when the box (padding + min-height) is.
  for (const d of [0, 1, 2, 3]) assert.equal(d * px(decl(top, "min-height")), d * 29);
});

test("A1 fix 3: the editor's bullet column heights are px x zoom, so a row's main box is not taller than its text box", () => {
  const controls = `${E} .rm-block-children .rm-block-main > :is(.controls, .rm-block__controls)`;
  const caret = `${controls} :is(.block-expand, .rm-caret)`;
  const bullet = `${E} .rm-block-children .rm-bullet`;
  // The editor root's font is not scaled (only the textarea and view nodes are), so em here would stay 14px at any zoom:
  // 21px + 4 x z of margin = 23.76 at z 0.69 against the 20.01 row.
  for (const sel of [controls, caret, bullet]) {
    assert.doesNotMatch(String(decl(sel, "height")), /\bem\b/, `${sel}: no em height`);
    for (const z of [1, 0.69, 1.5]) assert.ok(Math.abs(px(decl(sel, "height"), z) - 21 * z) < 1e-9, `${sel} at ${z}`);
  }
  for (const z of [1, 0.69, 1.5]) {
    const colH = px(decl(controls, "height"), z) + px(decl(controls, "margin-top"), z);
    const rowH = px(decl(`${E} .roam-block`, "min-height"), z, 14 * z);
    assert.ok(colH <= rowH + 1e-9, `zoom ${z}: bullet column ${colH} fits the row ${rowH}`);
    // A parent's first child sits one row below it, and depth 3 sits 3 rows below the card top: 29 x 3 x z.
    assert.ok(Math.abs(3 * rowH - 87 * z) < 1e-9);
  }
  assert.ok(Math.abs(3 * 29 * 0.69 - 60.03) < 1e-9);
});

test("A1 fix 3: the active textarea keeps Roam's 4px x zoom top padding, so the text does not move on activation", () => {
  const ta = `${D}.pxd-item--editing:not(.pxd-item--page):not(.pxd-item--text) > .pxd-item__body > .pxd-item__editor:not(.pxd-page-edit) textarea:is(.rm-block-input, .rm-block__input)`;
  for (const z of [1, 0.69, 1.5]) {
    assert.ok(Math.abs(px(decl(ta, "padding-top"), z, 14 * z) - 4 * z) < 1e-9);
    assert.ok(Math.abs(px(decl(ta, "padding-bottom"), z, 14 * z) - 4 * z) < 1e-9);
  }
});
