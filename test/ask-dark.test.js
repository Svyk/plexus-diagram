import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { closeAskAI, openAskAI } from "../src/view/ask-ai.js";
import { createPartGutter } from "../src/view/part-gutter.js";
import { createPageChips } from "../src/view/page-chips.js";
import { floatingDark } from "../src/view/theme-follow.js";
import { contrast, parseColor } from "../src/model/theme-colors.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const css = readFileSync(new URL("../src/css/ask-ai.css", import.meta.url), "utf8");
const chipsCss = readFileSync(new URL("../src/css/page-chips.css", import.meta.url), "utf8");

// The custom properties declared in the first rule whose selector list starts with `head`.
function tokens(source, head) {
  const at = source.indexOf(`${head} {`) >= 0 ? source.indexOf(`${head} {`) : source.indexOf(`${head},`);
  assert.ok(at >= 0, `rule ${head}`);
  const body = source.slice(source.indexOf("{", at) + 1, source.indexOf("}", at));
  const out = {};
  for (const m of body.matchAll(/--pxd-ask-([a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const LIGHT = tokens(css, "\n.pxd-ask");
const DARK = { ...LIGHT, ...tokens(css, ".bp3-dark .pxd-ask") };

// Text colour on surface, each must reach WCAG AA (4.5:1) in both themes.
const PAIRS = [
  ["fg", "bg"], ["fg", "head"], ["fg", "ctx"], ["fg", "card"], ["fg", "raised"], ["fg", "field"],
  ["muted", "bg"], ["muted", "head"], ["muted", "ctx"], ["muted", "card"], ["muted", "raised"], ["muted", "field"],
  ["user-fg", "user"],
  ["accent-fg", "card"], ["accent-fg", "bg"], ["accent-fg", "raised"],
  ["link", "card"], ["link", "bg"],
];

for (const [name, set] of [["light", LIGHT], ["dark", DARK]]) {
  test(`ask window ${name} tokens: every text/surface pair is at least 4.5:1`, () => {
    const low = [];
    for (const [fg, bg] of PAIRS) {
      assert.ok(parseColor(set[fg]), `${name} --pxd-ask-${fg} is an opaque colour: ${set[fg]}`);
      assert.ok(parseColor(set[bg]), `${name} --pxd-ask-${bg} is an opaque colour: ${set[bg]}`);
      const ratio = contrast(set[fg], set[bg]);
      if (ratio < 4.5) low.push(`${fg} on ${bg} = ${ratio.toFixed(2)}`);
    }
    assert.deepEqual(low, []);
  });
}

test("dark tokens: Live AI / Blueprint dark surfaces, faint borders, light text", () => {
  for (const key of ["bg", "head", "card", "raised", "field"]) {
    assert.ok(contrast(DARK[key], "#000000") < 2.2, `dark ${key} stays dark (${DARK[key]})`);
  }
  const line = parseColor(DARK.line);
  assert.equal(`${line.r},${line.g},${line.b}`, "255,255,255");
  assert.ok(line.a >= 0.06 && line.a <= 0.12, "borders rgba(255,255,255,.06–.12)");
  assert.ok(contrast(DARK.fg, DARK.bg) >= 12, "body text reads at a glance");
  assert.match(css, /\.pxd-ask\.pxd-ask--dark \{/, "the class turns the dark set on");
  assert.doesNotMatch(css, /prefers-color-scheme/, "the OS setting alone never picks the theme");
});

test("row buttons are borderless 28px ghost buttons; on = accent; disabled looks different; model name regular weight", () => {
  const rule = (sel) => new RegExp(`${sel.replace(/[.[\]"=]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] || "";
  const btn = rule(".pxd-ask .pxd-ask__rowbtn");
  assert.match(btn, /border: 0;/);
  assert.match(btn, /background: transparent;/);
  assert.match(btn, /height: 28px;/);
  assert.match(btn, /min-width: 28px;/);
  assert.match(btn, /color: var\(--pxd-ask-muted\);/);
  assert.match(rule(".pxd-ask .pxd-ask__rowbtn.pxd-ask__rowbtn--on"), /color: var\(--pxd-ask-accent-fg\);/);
  assert.match(rule(".pxd-ask .pxd-ask__rowbtn:disabled"), /opacity: 0\.4;/);
  const model = rule(".pxd-ask .pxd-ask__model");
  assert.match(model, /font-weight: 400;/);
  assert.match(model, /text-overflow: ellipsis;/);
  assert.match(rule(".pxd-ask .pxd-ask__question::placeholder"), /color: var\(--pxd-ask-muted\);[\s\S]*opacity: 1;/);
  assert.match(rule(".pxd-ask__msg"), /scroll-margin-top: 8px;/);
});

test("copy menu has a dark set for menus appended outside the board", () => {
  assert.match(chipsCss, /\.pxd-copy-menu\.pxd-copy-menu--dark \{[^}]*background: #2f3b46;/);
  assert.match(chipsCss, /\.pxd-copy-menu\.pxd-copy-menu--dark \.pxd-copy-menu__item \{[^}]*color: #e6edf3;/);
  assert.ok(contrast("#e6edf3", "#2f3b46") >= 4.5);
});

// ---- DOM

function fakeWindow() {
  const store = new Map();
  return {
    innerWidth: 1200,
    innerHeight: 800,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash: "#/app/mygraph/page/x" },
    addEventListener() {},
    removeEventListener() {},
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => [{ id: "m1", name: "Claude Sonnet 5.5", provider: "Anthropic", isDefault: true }],
      getDefaultModel: () => "m1",
      generate: async () => ({ text: "ok", model: "m1" }),
    },
  };
}
const DOC = { schema: "pxd-parse/1", pages: [{ n: 1 }], order: ["p"], blocks: { p: { id: "p", type: "para", page: 1, text: "Sodium was 12 mg." } } };
const walk = (n, fn) => { fn(n); for (const k of n.children || []) walk(k, fn); };
const find = (n, cls) => { let hit = null; walk(n, (x) => { if (!hit && x.className?.split?.(" ").includes(cls)) hit = x; }); return hit; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, stub.document)).finally(() => { closeAskAI(); restore(); });
}

test("ask window theme: light by default, dark over a dark board, under bt-theme-dark / bp3-dark, and on a dark Roam background", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  let a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(a.el.classList.contains("pxd-ask--dark"), false, "light Roam, no board: light");
  closeAskAI();

  const board = doc.createElement("div");
  board.className = "pxd-root pxd-root--dark";
  doc.body.append(board);
  a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(a.el.classList.contains("pxd-ask--dark"), true, "a dark board");
  board.remove();
  a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(a.el.classList.contains("pxd-ask--dark"), false, "re-checked on every open (same session)");
  closeAskAI();

  doc.body.classList.add("bt-theme-dark");
  a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(a.el.classList.contains("pxd-ask--dark"), true, "Roam dark theme marker on body");
  doc.body.classList.remove("bt-theme-dark");
  closeAskAI();

  doc.documentElement.classList.add("bp3-dark");
  assert.equal(floatingDark(doc), true, "bp3-dark on html");
  doc.documentElement.classList.remove("bp3-dark");

  stub.theme["background-color"] = "rgb(24, 32, 38)";
  assert.equal(floatingDark(doc), true, "a dark host background without any class");
  stub.theme["background-color"] = "rgb(255, 255, 255)";
  assert.equal(floatingDark(doc), false);
}));

test("model picker carries the full model name as its tooltip", () => withDom(async (stub, doc) => {
  const a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: fakeWindow() });
  await tick(5);
  const sel = find(a.el, "pxd-ask__model");
  assert.ok(sel, "picker built");
  assert.equal(sel.getAttribute("title"), "Model: Claude Sonnet 5.5 · Anthropic");
}));

test("following an answer never scrolls the question above the log's top edge", () => withDom(async (stub, doc) => {
  let release = null;
  const w = fakeWindow();
  w.LiveAI_API.generate = () => new Promise((r) => { release = r; });
  const a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  await tick(5);
  const log = find(a.el, "pxd-ask__log");
  log._rect = { left: 0, top: 100, width: 400, height: 300, right: 400, bottom: 400 };
  log.scrollTop = 40;
  log.scrollHeight = 2000;
  const ta = find(a.el, "pxd-ask__question");
  ta.value = "Compare with [[Sanitation Breaks]]";
  // The question bubble the send adds sits 350px below the log's top edge at the current scroll.
  const append = log.append.bind(log);
  log.append = (node) => { if (node.className?.includes?.("pxd-ask__msg--user")) node._rect = { left: 0, top: 450, width: 200, height: 30, right: 200, bottom: 480 }; return append(node); };
  stub.dispatch(find(a.el, "pxd-ask__send"), "click");
  await tick(5);
  assert.equal(log.scrollTop, 40 + 350 - 8, "scrolled to the question (8px gap), not to the bottom");
  release?.({ text: "ok", model: "m1" });
  await tick(5);
}));

test("copy menu opened from a dark board's gutter gets the dark class; from a light board it does not", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  try {
    for (const dark of [true, false]) {
      const root = doc.createElement("div");
      root.className = dark ? "pxd-root pxd-root--dark" : "pxd-root";
      const pane = doc.createElement("div");
      pane._rect = { left: 0, top: 0, width: 600, height: 500, right: 600, bottom: 500 };
      root.append(pane);
      doc.body.append(root);
      let chips = null;
      const gutter = createPartGutter({ doc, mount: pane, onCopy: () => true, onMenu: (block, anchor) => chips.openCopyMenu(block, anchor) });
      chips = createPageChips({ doc, host: pane, getParsed: () => ({ blocks: { p1: { id: "p1", type: "para", page: 1, text: "x" } } }), pageEl: () => null, pageOf: () => null, run() {}, copyMenu: () => true });
      gutter.intent({ id: "p1", type: "para" }, { left: 300, top: 120, right: 500, bottom: 160 }, { immediate: true });
      const more = pane.querySelector(".pxd-pgutter").querySelectorAll("button")[2];
      stub.dispatch(more, "click");
      const menu = doc.querySelector(".pxd-copy-menu");
      assert.ok(menu, "menu opens");
      assert.equal(menu.classList.contains("pxd-copy-menu--dark"), dark);
      stub.dispatch(more, "click");
      gutter.destroy?.();
      chips.destroy?.();
      root.remove();
    }
  } finally {
    restore();
  }
});
