import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PALETTE } from "../src/model/schema.js";
import { createChrome } from "../src/view/chrome.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const timers = { later: () => () => {}, frame: () => () => {} };

function setup(on = {}, options = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const baseline = stub.listenerCount();
  const chrome = createChrome({ doc: stub.document, root, version: "1.2.0", settings: {}, timers, on, ...options });
  return { stub, restore, root, chrome, baseline };
}
const q = (root, sel) => root.querySelector(sel);
const classes = (node) => String(node.className).split(/\s+/);

test("background button toggles a popover inside the root", (t) => {
  const f = setup();
  t.after(f.restore);
  const btn = q(f.root, ".pxd-toolbar__bg");
  assert.ok(btn, "Background button");
  assert.equal(btn.getAttribute("aria-label"), "Background");
  assert.equal(btn.title, "Background pattern and tone");
  assert.ok(btn.querySelector(".bp3-icon-style"));
  assert.equal(btn.textContent, "");
  const pop = q(f.root, ".pxd-popover.pxd-popover--bg");
  assert.ok(pop);
  assert.equal(pop.parentElement, f.root);
  assert.equal(pop.style.display, "none");
  btn.click();
  assert.equal(pop.style.display, "");
  assert.equal(f.chrome.popover.isOpen(), true);
  assert.ok(classes(btn).includes("pxd-btn--active"));
  btn.click();
  assert.equal(pop.style.display, "none");
  assert.ok(!classes(btn).includes("pxd-btn--active"));
});

test("popover has a pattern control including cross and 12 tone swatches with data-tone", (t) => {
  const f = setup();
  t.after(f.restore);
  const pop = q(f.root, ".pxd-popover--bg");
  const patterns = pop.querySelectorAll(".pxd-bg__pattern .pxd-seg__btn").map((b) => b.dataset.value);
  assert.deepEqual(patterns, ["dots", "lines", "cross", "grid", "plain"]);
  const swatches = pop.querySelectorAll(".pxd-bg__tones .pxd-swatch");
  assert.deepEqual(swatches.map((s) => s.getAttribute("data-tone")), ["", "paper", ...PALETTE]);
  assert.ok(pop.querySelector(".pxd-bg__default"));
  assert.ok(pop.querySelector(".pxd-bg__reset"));
});

test("popover picks call on.setBackground / on.useBackgroundAsDefault", (t) => {
  const calls = [];
  const f = setup({ setBackground: (p) => calls.push(p), useBackgroundAsDefault: () => calls.push("default") });
  t.after(f.restore);
  const pop = q(f.root, ".pxd-popover--bg");
  const seg = (v) => pop.querySelectorAll(".pxd-bg__pattern .pxd-seg__btn").find((b) => b.dataset.value === v);
  const tone = (v) => pop.querySelectorAll(".pxd-bg__tones .pxd-swatch").find((b) => b.getAttribute("data-tone") === v);
  seg("grid").click();
  tone("paper").click();
  tone("teal").click();
  tone("").click();
  q(pop, ".pxd-bg__default").click();
  q(pop, ".pxd-bg__reset").click();
  assert.deepEqual(calls, [
    { bg: "grid" },
    { bgColor: "paper" },
    { bgColor: "teal" },
    { bgColor: null },
    "default",
    { bg: null, bgColor: null },
  ]);
});

test("popover closes on outside pointerdown and Esc, not on inside pointerdown", (t) => {
  const f = setup();
  t.after(f.restore);
  const pop = q(f.root, ".pxd-popover--bg");
  const open = () => { if (!f.chrome.popover.isOpen()) q(f.root, ".pxd-toolbar__bg").click(); };
  open();
  f.stub.dispatch(q(pop, ".pxd-bg__default"), "pointerdown");
  assert.equal(f.chrome.popover.isOpen(), true, "inside pointerdown keeps it open");
  f.stub.dispatch(q(f.root, ".pxd-toolbar__bg"), "pointerdown");
  assert.equal(f.chrome.popover.isOpen(), true, "the toggle button owns its own pointerdown");
  f.stub.dispatch(f.stub.document.body, "pointerdown");
  assert.equal(f.chrome.popover.isOpen(), false, "outside pointerdown closes");
  open();
  const esc = f.stub.dispatch(f.stub.document.body, "keydown", { key: "Escape" });
  assert.equal(f.chrome.popover.isOpen(), false, "Esc closes");
  assert.equal(esc.defaultPrevented, true);
  open();
  f.stub.dispatch(f.stub.document.body, "keydown", { key: "a" });
  assert.equal(f.chrome.popover.isOpen(), true, "other keys do nothing");
});

test("popover keeps no document listeners while closed", (t) => {
  const f = setup();
  t.after(f.restore);
  const closed = f.stub.listenerCount();
  q(f.root, ".pxd-toolbar__bg").click();
  assert.equal(f.stub.listenerCount(), closed + 2);
  f.stub.dispatch(f.stub.document.body, "pointerdown");
  assert.equal(f.stub.listenerCount(), closed);
});

test("toolbar.setBackground reflects pattern, tone and override", (t) => {
  const f = setup();
  t.after(f.restore);
  const pop = q(f.root, ".pxd-popover--bg");
  const on = (sel) => pop.querySelectorAll(sel).filter((n) => classes(n).some((c) => c.endsWith("--on")));
  f.chrome.toolbar.setBackground({ pattern: "lines", tone: "teal", override: true });
  assert.deepEqual(on(".pxd-bg__pattern .pxd-seg__btn").map((b) => b.dataset.value), ["lines"]);
  assert.deepEqual(on(".pxd-bg__tones .pxd-swatch").map((b) => b.getAttribute("data-tone")), ["teal"]);
  assert.ok(!classes(q(pop, ".pxd-bg__reset")).includes("pxd-bg__reset--idle"));
  f.chrome.toolbar.setBackground({ pattern: "dots", tone: null, override: false });
  assert.deepEqual(on(".pxd-bg__pattern .pxd-seg__btn").map((b) => b.dataset.value), ["dots"]);
  assert.deepEqual(on(".pxd-bg__tones .pxd-swatch").map((b) => b.getAttribute("data-tone")), [""], "no tone selects the default swatch");
  assert.ok(classes(q(pop, ".pxd-bg__reset")).includes("pxd-bg__reset--idle"));
});

test("Focus, Present and More buttons call their callbacks", (t) => {
  const calls = [];
  const f = setup({
    toggleFocus: () => calls.push("focus"),
    present: () => calls.push("present"),
    openMore: (p) => calls.push(["more", p]),
  });
  t.after(f.restore);
  const more = q(f.root, ".pxd-toolbar__more");
  more._rect = { left: 40, top: 8, right: 90, bottom: 34, width: 50, height: 26, x: 40, y: 8 };
  q(f.root, ".pxd-toolbar__focus").click();
  q(f.root, ".pxd-toolbar__present").click();
  more.click();
  assert.deepEqual(calls, ["focus", "present", ["more", { x: 40, y: 34, w: 50, h: 26 }]]);
  f.chrome.toolbar.setFocus(true);
  assert.ok(classes(q(f.root, ".pxd-toolbar__focus")).includes("pxd-btn--active"));
  f.chrome.toolbar.setFocus(false);
  assert.ok(!classes(q(f.root, ".pxd-toolbar__focus")).includes("pxd-btn--active"));
});

test("back-to-content button is hidden until asked and calls on.backToContent", (t) => {
  let n = 0;
  const f = setup({ backToContent: () => { n += 1; } });
  t.after(f.restore);
  const btn = q(f.root, ".pxd-backtocontent");
  assert.equal(btn.textContent, "Back to content");
  assert.equal(btn.style.display, "none");
  f.chrome.backToContent.setVisible(true);
  assert.equal(btn.style.display, "");
  btn.click();
  assert.equal(n, 1);
  f.chrome.backToContent.setVisible(false);
  assert.equal(btn.style.display, "none");
  const down = f.stub.dispatch(btn, "pointerdown");
  assert.equal(down.propagationStopped, true);
});

const labels = (ctx) => ctx.querySelectorAll(".pxd-ctx__btn").map((b) => b.getAttribute("aria-label"));
const showCtx = (f, kind, model) => {
  f.chrome.ctx.show(kind, model, () => ({ kind, rect: { x: 100, y: 100, w: 100, h: 50 } }));
  return q(f.root, ".pxd-ctx");
};
const FULL = () => {
  const calls = [];
  const rec = (name) => (...a) => calls.push([name, ...a]);
  const on = {};
  for (const name of ["pin", "fitHeight", "copyRef", "duplicate", "sendTo", "expandOutline", "fitSection", "toggleFit", "tidy", "foldAll", "sameSize", "fold", "collapseSection", "sectionNote", "lockSection", "presentSection", "selectAllInSection", "selectSameColor", "selectConnected"]) on[name] = rec(name);
  return { on, calls };
};

test("card ctx bar gains Pin, Fit height, Copy ref, Duplicate, Send to board", (t) => {
  const { on, calls } = FULL();
  const f = setup(on);
  t.after(f.restore);
  const ctx = showCtx(f, "card", { kind: "block", pinned: false, collapsed: false });
  assert.deepEqual(labels(ctx), ["Color", "Collapse children", "References", "Edit", "Open in sidebar", "Collapse", "Related…", "Pin", "Fit height", "Copy ref", "Duplicate", "Send to board…", "Mind map", "Select same color", "Select connected", "Delete"]);
  assert.ok([...ctx.querySelectorAll(".pxd-ctx__btn")].every((b) => b.querySelector(".bp3-icon") && b.title));
  for (const cls of [".pxd-ctx__pin-toggle", ".pxd-ctx__fit-height", ".pxd-ctx__copy-ref", ".pxd-ctx__duplicate", ".pxd-ctx__send-to", ".pxd-ctx__mindmap"]) q(ctx, cls).click();
  assert.deepEqual(calls, [["pin", true], ["fitHeight"], ["copyRef"], ["duplicate"], ["sendTo"], ["expandOutline"]]);
});

test("card ctx Pin label follows model.pinned and unpins", (t) => {
  const { on, calls } = FULL();
  const f = setup(on);
  t.after(f.restore);
  const ctx = showCtx(f, "card", { kind: "page", pinned: true });
  const pin = q(ctx, ".pxd-ctx__pin-toggle");
  assert.equal(pin.getAttribute("aria-label"), "Unpin");
  assert.ok(pin.querySelector(".bp3-icon-unpin"));
  pin.click();
  assert.deepEqual(calls, [["pin", false]]);
});

test("Mind map only shows for note, block and page cards", (t) => {
  const { on } = FULL();
  const f = setup(on);
  t.after(f.restore);
  for (const kind of ["note", "block", "page"]) assert.ok(q(showCtx(f, "card", { kind }), ".pxd-ctx__mindmap"), kind);
  for (const kind of ["board", "image", undefined]) assert.equal(q(showCtx(f, "card", { kind }), ".pxd-ctx__mindmap"), null, String(kind));
});

test("missing callbacks are skipped, so the 1.0 card ctx bar is unchanged", (t) => {
  const f = setup({});
  t.after(f.restore);
  assert.deepEqual(labels(showCtx(f, "card", { kind: "note" })), ["Color", "Collapse children", "References", "Edit", "Open in sidebar", "Collapse", "Related…", "Delete"]);
  assert.deepEqual(labels(showCtx(f, "section", {})), ["Rename", "Select contents", "Delete frame"]);
  assert.deepEqual(labels(showCtx(f, "cards", null)), ["Wrap in section", "Move into new board", "Delete"]);
});

test("section ctx bar gains Fit to contents, Auto-fit, Tidy, Fold all, Pin", (t) => {
  const { on, calls } = FULL();
  const f = setup(on);
  t.after(f.restore);
  let ctx = showCtx(f, "section", { autofit: true, pinned: false });
  assert.deepEqual(labels(ctx), ["Rename", "Select contents", "Select all in section", "Select same color", "Select connected", "Collapse", "Description", "Lock", "Present", "Fit to contents", "Auto-fit: on", "Fold all", "Pin", "Delete frame"]);
  assert.deepEqual(ctx.querySelectorAll(".pxd-ctx__tidy .pxd-seg__btn").map((b) => b.dataset.value), ["grid", "row", "column"]);
  q(ctx, ".pxd-ctx__fit-section").click();
  q(ctx, ".pxd-ctx__auto-fit").click();
  ctx.querySelectorAll(".pxd-ctx__tidy .pxd-seg__btn")[1].click();
  q(ctx, ".pxd-ctx__fold-all").click();
  q(ctx, ".pxd-ctx__pin-toggle").click();
  assert.deepEqual(calls, [["fitSection"], ["toggleFit"], ["tidy", "row"], ["foldAll", true], ["pin", true]]);
  ctx = showCtx(f, "section", { autofit: false, pinned: true });
  assert.equal(q(ctx, ".pxd-ctx__auto-fit").getAttribute("aria-label"), "Auto-fit: off");
  assert.equal(q(ctx, ".pxd-ctx__pin-toggle").getAttribute("aria-label"), "Unpin");
});

test("HB-10: section and card bars call select all, same color, and connected", (t) => {
  const { on, calls } = FULL();
  const f = setup(on);
  t.after(f.restore);
  const section = showCtx(f, "section", {});
  q(section, ".pxd-ctx__all-in-section").click();
  q(section, ".pxd-ctx__same-color").click();
  q(section, ".pxd-ctx__connected").click();
  const card = showCtx(f, "card", { kind: "block" });
  assert.equal(q(card, ".pxd-ctx__all-in-section"), null);
  q(card, ".pxd-ctx__same-color").click();
  q(card, ".pxd-ctx__connected").click();
  assert.deepEqual(calls, [
    ["selectAllInSection"],
    ["selectSameColor"],
    ["selectConnected"],
    ["selectSameColor"],
    ["selectConnected"],
  ]);
});

test("multi ctx bar gains Tidy, Same size, Fold, Pin, Duplicate", (t) => {
  const { on, calls } = FULL();
  const f = setup(on);
  t.after(f.restore);
  let ctx = showCtx(f, "cards", { count: 3, allPinned: false, anyCollapsed: false });
  assert.deepEqual(ctx.querySelectorAll(".pxd-ctx__same-size .pxd-seg__btn").map((b) => b.dataset.value), ["width", "height", "both"]);
  assert.deepEqual(ctx.querySelectorAll(".pxd-ctx__same-size .pxd-seg__btn").map((b) => b.textContent), ["W", "H", "WH"]);
  ctx.querySelectorAll(".pxd-ctx__tidy .pxd-seg__btn")[0].click();
  ctx.querySelectorAll(".pxd-ctx__same-size .pxd-seg__btn")[2].click();
  q(ctx, ".pxd-ctx__fold").click();
  q(ctx, ".pxd-ctx__pin-toggle").click();
  q(ctx, ".pxd-ctx__duplicate").click();
  assert.deepEqual(calls, [["tidy", "grid"], ["sameSize", "both"], ["fold", true], ["pin", true], ["duplicate"]]);
  calls.length = 0;
  ctx = showCtx(f, "cards", { count: 2, allPinned: true, anyCollapsed: true });
  assert.equal(q(ctx, ".pxd-ctx__fold").getAttribute("aria-label"), "Unfold");
  assert.equal(q(ctx, ".pxd-ctx__pin-toggle").getAttribute("aria-label"), "Unpin");
  q(ctx, ".pxd-ctx__fold").click();
  q(ctx, ".pxd-ctx__pin-toggle").click();
  assert.deepEqual(calls, [["fold", false], ["pin", false]]);
});

test("link ctx keeps its own Pin as connection button", (t) => {
  const { on } = FULL();
  const f = setup({ ...on, pinLink: () => {} });
  t.after(f.restore);
  const ctx = showCtx(f, "link", { sources: [] });
  assert.equal(q(ctx, ".pxd-ctx__pin").getAttribute("aria-label"), "Pin as connection");
  assert.ok(q(ctx, ".pxd-ctx__pin").querySelector(".bp3-icon-new-link"));
  assert.equal(q(ctx, ".pxd-ctx__pin-toggle"), null);
});

test("dispose removes every 1.2 node and listener, even with the popover open", (t) => {
  const f = setup({});
  t.after(f.restore);
  q(f.root, ".pxd-toolbar__bg").click();
  f.chrome.dispose();
  assert.equal(f.stub.listenerCount(), f.baseline);
  assert.equal(f.stub.pxdNodes().filter((n) => n !== f.root).length, 0);
});

// ------------------------------------------------------------------ CSS contract

const read = (name) => readFile(new URL(`../src/css/${name}`, import.meta.url), "utf8");
const ruleList = (css) => {
  const rules = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) { if (text[j] === "{") depth += 1; else if (text[j] === "}") depth -= 1; j += 1; }
      const head = text.slice(i, open).trim();
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(body, head);
      else rules.push({ media, selectors: head.split(",").map((s) => s.trim()).filter(Boolean), body });
      i = j;
    }
  };
  walk(stripped, null);
  return rules;
};

for (const name of ["chrome.css", "background.css"]) {
  test(`${name}: braces balance, no :is/:where, every selector is root-scoped with two classes`, async () => {
    const css = await read(name);
    assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
    assert.ok(!/:is\(|:where\(/.test(css), "no :is/:where");
    assert.ok(!/!important/.test(css));
    const rules = ruleList(css);
    assert.ok(rules.length > 10);
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        const bare = selector.replace(/::?[a-z-]+(\([^)]*\))?/g, (m) => (m.startsWith(":not(") ? m : ""));
        assert.ok(/\.pxd-root\b/.test(selector), `scoped under .pxd-root: ${selector}`);
        assert.ok((bare.match(/\.[a-zA-Z_][\w-]*/g) || []).length >= 2, `two classes at least: ${selector}`);
      }
    }
  });
}

test("background.css: grid pattern, paper and ten palette tones with light and dark values", async () => {
  const css = await read("background.css");
  const rules = ruleList(css);
  const find = (selector, media = null) => rules.find((r) => r.media === media && r.selectors.includes(selector));
  assert.ok(find(".pxd-root .pxd-grid--grid"));
  assert.match(css, /--pxd-grid-major/);
  assert.match(find(".pxd-root.pxd-bg-paper").body, /#eeeded/i);
  for (const tone of PALETTE) {
    const light = find(`.pxd-root.pxd-bg-${tone}`);
    assert.ok(light, `light ${tone}`);
    assert.match(light.body, new RegExp(`color-mix\\(in srgb, var\\(--pxd-${tone}-line\\) 9%`));
  }
  const darkSelectors = [
    (t) => `.bp3-dark .pxd-root.pxd-bg-${t}`,
    (t) => `body.bt-theme-dark .pxd-root.pxd-bg-${t}`,
    (t) => `.rm-dark-theme .pxd-root.pxd-bg-${t}`,
    (t) => `body.roam-body.dark .pxd-root.pxd-bg-${t}`,
    (t) => `.pxd-root.pxd-root--dark.pxd-bg-${t}`,
  ];
  for (const make of darkSelectors) {
    assert.match(find(make("paper")).body, /#191919/, make("paper"));
    for (const tone of PALETTE) assert.match(find(make(tone)).body, new RegExp(`var\\(--pxd-${tone}-line\\) 7%`), make(tone));
  }
  const media = rules.find((r) => r.media && /prefers-color-scheme:\s*dark/.test(r.media));
  assert.ok(media, "prefers-color-scheme dark block");
  assert.match(css, /:root:not\(\.bp3-light\) \.pxd-root\.pxd-bg-paper/);
  assert.match(css, /:root:not\(\.bp3-light\) \.pxd-root\.pxd-bg-pink/);
});

test("chrome.css covers popover, menu, back-to-content and panel classes the JS emits", async () => {
  const css = await read("chrome.css");
  for (const cls of [".pxd-popover", ".pxd-menu", ".pxd-menu__item", ".pxd-menu__item--active", ".pxd-menu__item--checked", ".pxd-menu__item--disabled", ".pxd-menu__item--danger", ".pxd-menu__sep", ".pxd-menu__hint", ".pxd-menu__sub", ".pxd-backtocontent", ".pxd-panel__board-row", ".pxd-panel__outline-row"]) {
    assert.ok(css.includes(cls), cls);
  }
  for (const signal of [".bp3-dark .pxd-root", "body.bt-theme-dark .pxd-root", ".rm-dark-theme .pxd-root", "body.roam-body.dark .pxd-root", ".pxd-root.pxd-root--dark", ":root:not(.bp3-light) .pxd-root"]) {
    assert.ok(css.includes(signal), signal);
  }
});

test("control rail uses native titles and the bar setting restores the zoom group", (t) => {
  const calls = [];
  const f = setup({
    zoomIn: () => calls.push("in"),
    zoomOut: () => calls.push("out"),
    fit: () => calls.push("fit"),
    toggleMinimap: () => calls.push("map"),
    savePng: () => calls.push("png"),
    openOutline: () => calls.push("outline"),
    editBlock: () => calls.push("edit"),
    toggleFullscreen: () => calls.push("full"),
    zoomReset: () => calls.push("reset"),
  });
  t.after(f.restore);
  assert.ok(f.root.classList.contains("pxd-root--rail"));
  assert.equal(q(f.root, ".pxd-toolbar__zoom").style.display, "none");
  const titles = [...f.root.querySelectorAll(".pxd-rail__btn")].map((b) => b.title);
  assert.deepEqual(titles, ["zoom in", "zoom out", "fit view", "Toggle Minimap", "Save PNG", "Open outline in sidebar", "Edit Block", "Maximize"]);
  for (const b of f.root.querySelectorAll(".pxd-rail__btn")) b.click();
  q(f.root, ".pxd-rail__zoom").click();
  assert.deepEqual(calls, ["in", "out", "fit", "map", "png", "outline", "edit", "full", "reset"]);
  f.chrome.toolbar.setFullscreen(true);
  assert.equal(q(f.root, ".pxd-rail__edit").style.display, "none");
  assert.equal(q(f.root, ".pxd-toolbar__edit").style.display, "none");
  assert.equal(q(f.root, ".pxd-rail__fullscreen").title, "Minimize");
  f.chrome.toolbar.setZoom(1.25);
  assert.equal(q(f.root, ".pxd-rail__zoom").textContent, "125%");
  const bar = setup({ zoomIn: () => {} }, { settings: { get: (k) => (k === "controls-position" ? "bar" : undefined) } });
  t.after(bar.restore);
  assert.equal(bar.root.classList.contains("pxd-root--rail"), false);
  assert.equal(q(bar.root, ".pxd-rail").style.display, "none");
  assert.equal(q(bar.root, ".pxd-toolbar__zoom").style.display, "");
});

test("UI-2: toolbar actions are Blueprint icons with tooltips, and the zoom percent stays text", (t) => {
  const f = setup();
  t.after(f.restore);
  const tool = (id) => [...f.root.querySelectorAll(".pxd-tool")].find((b) => b.dataset.tool === id);
  const expect = [
    [tool("select"), "Select", "select"],
    [tool("hand"), "Hand", "hand"],
    [tool("card"), "Card", "new-object"],
    [tool("text"), "Text", "new-text-box"],
    [tool("section"), "Section", "widget"],
    [tool("board"), "Board", "grid-view"],
    [tool("connect"), "Connect", "flows"],
  ];
  const byClass = [
    [".pxd-toolbar__add", "Add", "plus"],
    [".pxd-toolbar__info", "Info", "info-sign"],
    [".pxd-toolbar__links", "Links: All", "graph"],
    [".pxd-toolbar__table", "Table", "th"],
    [".pxd-toolbar__kanban", "Kanban", "layout-auto"],
    [".pxd-toolbar__lens", "Tags", "tag"],
    [".pxd-toolbar__focus", "Focus", "eye-open"],
    [".pxd-toolbar__present", "Present", "presentation"],
    [".pxd-toolbar__more", "More", "more"],
    [".pxd-toolbar__zoom-out", "Zoom out", "minus"],
    [".pxd-toolbar__zoom-in", "Zoom in", "plus"],
    [".pxd-toolbar__fit", "Fit", "zoom-to-fit"],
    [".pxd-toolbar__minimap", "Minimap", "map"],
    [".pxd-toolbar__edit", "Edit Block", "edit"],
    [".pxd-toolbar__fullscreen", "Fullscreen", "fullscreen"],
  ];
  for (const [node, label, icon] of expect) {
    assert.ok(node, label);
    assert.equal(node.getAttribute("aria-label"), label);
    assert.ok(node.title, label);
    assert.ok(node.querySelector(`.bp3-icon-${icon}`), label);
    assert.equal(node.textContent, "", label);
  }
  for (const [sel, label, icon] of byClass) {
    const b = q(f.root, sel);
    assert.ok(b, sel);
    assert.equal(b.getAttribute("aria-label"), label, sel);
    assert.ok(b.title, sel);
    assert.ok(b.querySelector(`.bp3-icon-${icon}`), sel);
    assert.equal(b.textContent, "", sel);
  }
  const pct = [...f.root.querySelectorAll("button.pxd-toolbar__zoom")].find((b) => b.textContent === "100%");
  assert.ok(pct, "zoom percent stays a text button");
  assert.equal(pct.querySelector(".bp3-icon"), null);
  f.chrome.toolbar.setLinkMode("off");
  assert.equal(q(f.root, ".pxd-toolbar__links").getAttribute("aria-label"), "Links: Off");
  assert.ok(q(f.root, ".pxd-toolbar__links").querySelector(".bp3-icon-disable"));
  f.chrome.toolbar.setLinkMode("attributes");
  assert.ok(q(f.root, ".pxd-toolbar__links").querySelector(".bp3-icon-inheritance"));
  assert.equal(q(f.root, ".pxd-toolbar__links").textContent, "");
  f.chrome.toolbar.setTable(true);
  assert.equal(q(f.root, ".pxd-toolbar__table").getAttribute("aria-label"), "Board");
  assert.equal(q(f.root, ".pxd-toolbar__table").title, "Board view");
  assert.ok(q(f.root, ".pxd-toolbar__table").querySelector(".bp3-icon-grid-view"));
  assert.equal(q(f.root, ".pxd-toolbar__table").textContent, "");
  f.chrome.toolbar.setKanban(true);
  assert.equal(q(f.root, ".pxd-toolbar__kanban").getAttribute("aria-label"), "Board");
  assert.ok(q(f.root, ".pxd-toolbar__kanban").querySelector(".bp3-icon-grid-view"));
  f.chrome.toolbar.setFullscreen(true);
  assert.equal(q(f.root, ".pxd-toolbar__fullscreen").getAttribute("aria-label"), "Exit fullscreen");
  assert.ok(q(f.root, ".pxd-toolbar__fullscreen").querySelector(".bp3-icon-minimize"));
  for (const b of f.root.querySelectorAll(".pxd-rail__btn")) {
    assert.ok(b.querySelector(".bp3-icon"), b.title);
    assert.ok(b.title);
    assert.equal(b.textContent, "");
  }
});

test("toolbar.setPanel (panel open/close) repositions an open context bar, and is a no-op with none", (t) => {
  const f = setup();
  t.after(f.restore);
  f.chrome.toolbar.setPanel(true); // no bar: nothing to place, no throw
  let anchored = 0;
  f.chrome.ctx.show("card", { kind: "block" }, () => { anchored++; return { kind: "card", rect: { x: 100, y: 100, w: 100, h: 50 } }; });
  const shown = anchored;
  f.chrome.toolbar.setPanel(true);
  assert.equal(anchored, shown + 1, "panel open re-anchors the bar");
  f.chrome.toolbar.setPanel(false);
  assert.equal(anchored, shown + 2, "panel close re-anchors the bar");
  f.chrome.ctx.hide();
  f.chrome.toolbar.setPanel(true);
  assert.equal(anchored, shown + 2, "a hidden bar is left alone");
});

test("PF-8: the status dot titles idle, writing, retrying, and failed", (t) => {
  const f = setup();
  t.after(f.restore);
  const dot = q(f.root, ".pxd-sync");
  assert.equal(dot.title, "Synced");
  const cases = [
    ["idle", "Synced", []],
    ["writing", "Saving…", ["pxd-sync--pending", "pxd-sync--writing"]],
    ["retrying", "Retrying…", ["pxd-sync--retrying"]],
    ["failed", "Couldn't save", ["pxd-sync--failed"]],
  ];
  const all = ["pxd-sync--pending", "pxd-sync--writing", "pxd-sync--retrying", "pxd-sync--failed"];
  for (const [state, title, on] of cases) {
    f.chrome.toolbar.setSync(state);
    assert.equal(dot.title, title, state);
    for (const cls of all) assert.equal(dot.classList.contains(cls), on.includes(cls), `${state} ${cls}`);
  }
  f.chrome.toolbar.setSync(true);
  assert.equal(dot.title, "Saving…");
  assert.ok(dot.classList.contains("pxd-sync--writing"));
  f.chrome.toolbar.setSync(false);
  assert.equal(dot.title, "Synced");
  assert.equal(dot.classList.contains("pxd-sync--writing"), false);
});
