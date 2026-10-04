import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { PALETTE } from "../src/model/schema.js";
import { settingsDefaults, normalizeSetting } from "../src/settings.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { createChrome } from "../src/view/chrome.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => resetSessions());

const timers = { later: () => () => {}, frame: () => () => {} };

function setup(values = {}, on = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const baseline = stub.listenerCount();
  const chrome = createChrome({ doc: stub.document, root, version: "2.2.0", settings: { get: (k) => values[k] }, timers, on });
  return { stub, restore, root, chrome, baseline };
}
const q = (root, sel) => root.querySelector(sel);
const has = (node, cls) => String(node.className).split(/\s+/).includes(cls);
const shown = (node) => node.style.display !== "none";

const read = (name) => readFile(new URL(`../src/css/${name}`, import.meta.url), "utf8");
const block22 = (css) => css.slice(css.lastIndexOf("/*", css.indexOf("2.2 board bar and tool dock")));
const rulesOf = (css) => {
  const out = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) out.push({ selectors: m[1].split(",").map((s) => s.trim()), body: m[2] });
  return out;
};

// ------------------------------------------------------------------ TB-1 layout presets

test("TB-1: split is the default layout, hides the top-bar tools, and shows the dock", (t) => {
  const f = setup();
  t.after(f.restore);
  for (const cls of ["pxd-root--layout-split", "pxd-root--docked", "pxd-root--dock-bottom", "pxd-root--dock-pill"]) assert.ok(has(f.root, cls), cls);
  assert.ok(!has(f.root, "pxd-root--layout-classic") && !has(f.root, "pxd-root--layout-dock-only"));
  const tools = q(f.root, ".pxd-toolbar__tools");
  assert.ok(tools, "tool group keeps its class and stays in the DOM");
  assert.equal(tools.querySelectorAll(".pxd-tool").length, 7);
  assert.equal(tools.style.display, "none");
  assert.equal(q(f.root, ".pxd-palette").style.display, "");
});

test("TB-1: classic shows the tools in the top bar and sets no dock classes, so the 2.1 look stands", (t) => {
  const f = setup({ "toolbar-layout": "classic", "dock-position": "left", "dock-labels": true });
  t.after(f.restore);
  assert.ok(has(f.root, "pxd-root--layout-classic"));
  assert.ok(!has(f.root, "pxd-root--docked"));
  for (const name of ["bottom", "left", "top"]) assert.ok(!has(f.root, `pxd-root--dock-${name}`), name);
  assert.ok(!has(f.root, "pxd-root--dock-labels"));
  assert.equal(q(f.root, ".pxd-toolbar__tools").style.display, "");
  assert.equal(f.root.querySelectorAll(".pxd-palette__btn").length, 9, "the old palette is still there");
});

test("TB-1: every dock rule is gated on pxd-root--docked, so classic is untouched", async () => {
  const css = await read("chrome.css");
  const block = block22(css);
  const bad = [];
  for (const rule of rulesOf(block)) {
    for (const sel of rule.selectors) {
      if (/^\.pxd-root \.pxd-(btn\.pxd-tool|dock__)/.test(sel)) continue; // the bug fix and the inert base rules
      if (!sel.includes("pxd-root--docked") && !sel.includes("pxd-root--layout-dock-only")) bad.push(sel);
    }
  }
  assert.deepEqual(bad, []);
});

test("TB-1: settings carry the six new ids with the spec defaults", () => {
  const d = settingsDefaults();
  assert.equal(d["toolbar-layout"], "split");
  assert.equal(d["dock-position"], "bottom");
  assert.equal(d["dock-style"], "pill");
  assert.equal(d["dock-labels"], false);
  assert.equal(d["chrome-density"], "comfortable");
  assert.equal(d["dock-options"], true);
  assert.equal(normalizeSetting("toolbar-layout", "dock-only"), "dock-only");
  assert.equal(normalizeSetting("toolbar-layout", "bogus"), "split");
  assert.equal(normalizeSetting("dock-position", "left"), "left");
  assert.equal(normalizeSetting("dock-position", "right"), "bottom");
  assert.equal(normalizeSetting("dock-style", "strip"), "strip");
  assert.equal(normalizeSetting("chrome-density", "compact"), "compact");
});

test("TB-6: the settings panel lists the six rows under Board", async () => {
  const { createSettingsPanel } = await import("../src/settings.js");
  const ids = createSettingsPanel().settings.map((r) => r.id);
  const from = ids.indexOf("group-board");
  const to = ids.indexOf("group-performance");
  for (const id of ["toolbar-layout", "dock-position", "dock-style", "dock-labels", "chrome-density", "dock-options"]) {
    const at = ids.indexOf(id);
    assert.ok(at > from && at < to, id);
  }
});

test("TB-1: dock-only hides the bar until the pointer is within 48px of the top edge or the bar has focus", (t) => {
  const f = setup({ "toolbar-layout": "dock-only" });
  t.after(f.restore);
  const bar = q(f.root, ".pxd-toolbar");
  assert.ok(has(f.root, "pxd-root--layout-dock-only"));
  assert.ok(has(bar, "pxd-toolbar--hidden"), "starts hidden");
  f.stub.dispatch(f.root, "pointermove", { clientX: 100, clientY: 300 });
  assert.ok(has(bar, "pxd-toolbar--hidden"));
  f.stub.dispatch(f.root, "pointermove", { clientX: 100, clientY: 40 });
  assert.ok(!has(bar, "pxd-toolbar--hidden"), "near the top edge");
  f.stub.dispatch(f.root, "pointermove", { clientX: 100, clientY: 49 });
  assert.ok(has(bar, "pxd-toolbar--hidden"), "49px is outside");
  f.stub.dispatch(bar, "focusin", {});
  assert.ok(!has(bar, "pxd-toolbar--hidden"), "focus inside keeps it");
  f.stub.dispatch(bar, "focusout", {});
  assert.ok(has(bar, "pxd-toolbar--hidden"));
});

test("TB-1: dock-only never hides the bar while its background popover is open", (t) => {
  const f = setup({ "toolbar-layout": "dock-only" });
  t.after(f.restore);
  const bar = q(f.root, ".pxd-toolbar");
  f.stub.dispatch(f.root, "pointermove", { clientX: 100, clientY: 10 });
  q(f.root, ".pxd-toolbar__bg").click();
  assert.equal(f.chrome.popover.isOpen(), true);
  f.stub.dispatch(f.root, "pointermove", { clientX: 100, clientY: 400 });
  assert.ok(!has(bar, "pxd-toolbar--hidden"), "popover open");
  f.chrome.popover.close();
  f.stub.dispatch(f.root, "pointermove", { clientX: 100, clientY: 401 });
  assert.ok(has(bar, "pxd-toolbar--hidden"), "hides again once it closes");
});

test("TB-1: the reveal listeners exist only in dock-only and dispose removes them", (t) => {
  const split = setup();
  t.after(split.restore);
  const afterSplit = split.stub.listenerCount();
  const only = setup({ "toolbar-layout": "dock-only" });
  t.after(only.restore);
  assert.ok(only.stub.listenerCount() > afterSplit - split.baseline + only.baseline, "dock-only adds listeners");
  only.chrome.dispose();
  split.chrome.dispose();
});

// ------------------------------------------------------------------ TB-2 / TB-3 dock look, active tool, lock

test("TB-2: the dock groups nine tools as navigate | create | connect with separators and keeps the palette aliases", (t) => {
  const f = setup();
  t.after(f.restore);
  const dock = q(f.root, ".pxd-dock");
  assert.ok(dock && has(dock, "pxd-palette"));
  assert.ok(q(f.root, ".pxd-dock__bar") && has(q(f.root, ".pxd-dock__bar"), "pxd-palette__bar"));
  const groups = f.root.querySelectorAll(".pxd-dock__group").map((g) => g.querySelectorAll(".pxd-dock__btn").map((b) => b.dataset.tool));
  assert.deepEqual(groups, [["select", "hand"], ["card", "text", "sticky", "shape", "section", "board"], ["connect"]]);
  assert.equal(f.root.querySelectorAll(".pxd-dock__sep").filter((s) => s.parentElement === q(f.root, ".pxd-dock__bar")).length, 2);
  for (const b of f.root.querySelectorAll(".pxd-dock__btn")) {
    assert.ok(has(b, "pxd-palette__btn"));
    assert.equal(b.textContent, "");
    assert.equal(q(b, ".pxd-dock__label").getAttribute("data-label"), b.getAttribute("aria-label"));
  }
});

test("TB-3: the active tool and the lock land on the dock button and the sliding indicator", (t) => {
  const f = setup();
  t.after(f.restore);
  const btn = (id) => f.root.querySelectorAll(".pxd-dock__btn").find((b) => b.dataset.tool === id);
  const ind = q(f.root, ".pxd-dock__indicator");
  assert.ok(q(ind, ".pxd-dock__lock"), "lock glyph lives in the indicator");
  f.chrome.toolbar.setTool("shape", false);
  assert.ok(has(btn("shape"), "pxd-dock__btn--on") && has(btn("shape"), "pxd-palette__btn--on"));
  assert.ok(!has(btn("shape"), "pxd-dock__btn--locked"));
  assert.ok(!has(ind, "pxd-dock__indicator--locked"));
  f.chrome.toolbar.setTool("card", true);
  assert.ok(!has(btn("shape"), "pxd-dock__btn--on"));
  assert.ok(has(btn("card"), "pxd-dock__btn--on") && has(btn("card"), "pxd-dock__btn--locked") && has(btn("card"), "pxd-tool--locked"));
  assert.ok(has(ind, "pxd-dock__indicator--locked"));
  f.chrome.toolbar.setTool("select", false);
  assert.ok(!has(ind, "pxd-dock__indicator--locked"));
});

test("TB-3: the indicator follows the active button's box", (t) => {
  const f = setup();
  t.after(f.restore);
  const hand = f.root.querySelectorAll(".pxd-dock__btn").find((b) => b.dataset.tool === "hand");
  Object.defineProperties(hand, { offsetLeft: { value: 42 }, offsetTop: { value: 6 }, offsetWidth: { value: 36 }, offsetHeight: { value: 36 } });
  f.chrome.toolbar.setTool("hand", false);
  const ind = q(f.root, ".pxd-dock__indicator");
  assert.equal(ind.style["--pxd-ind-x"], "42px");
  assert.equal(ind.style["--pxd-ind-y"], "6px");
  assert.equal(ind.style["--pxd-ind-w"], "36px");
  assert.ok(!has(ind, "pxd-dock__indicator--idle"));
});

test("TB-2: dock position, shape, labels, and density come from the settings", (t) => {
  const f = setup({ "dock-position": "left", "dock-style": "strip", "dock-labels": true, "chrome-density": "compact" });
  t.after(f.restore);
  for (const cls of ["pxd-root--dock-left", "pxd-root--dock-strip", "pxd-root--dock-labels", "pxd-root--dense"]) assert.ok(has(f.root, cls), cls);
  assert.ok(!has(f.root, "pxd-root--dock-bottom") && !has(f.root, "pxd-root--dock-pill"));
});

test("TB-2: the minimap lift is a CSS variable, 136px with the minimap and 16px without", async (t) => {
  const f = setup();
  t.after(f.restore);
  f.chrome.minimap.setVisible(false);
  assert.ok(has(q(f.root, ".pxd-palette"), "pxd-palette--wide"));
  const css = await read("chrome.css");
  assert.match(css, /\.pxd-root\.pxd-root--docked \.pxd-palette \{[^}]*--pxd-dock-offset: 136px/);
  assert.match(css, /\.pxd-root\.pxd-root--docked \.pxd-palette\.pxd-palette--wide \{[^}]*--pxd-dock-offset: 16px/);
  assert.match(css, /pxd-root--dock-bottom \.pxd-palette \{[^}]*bottom: var\(--pxd-dock-offset\)/);
});

// ------------------------------------------------------------------ TB-4 dock options

test("TB-4: Card shows a color row and the block/card look; Select shows nothing", (t) => {
  const calls = [];
  const f = setup({}, { setColor: (c) => calls.push(["color", c]), setLook: (l) => calls.push(["look", l]), setShape: (s) => calls.push(["shape", s]) });
  t.after(f.restore);
  const options = q(f.root, ".pxd-dock__options");
  assert.equal(options.style.display, "none", "Select is the start tool");
  f.chrome.toolbar.setTool("card", false);
  assert.equal(options.style.display, "");
  assert.equal(shown(q(f.root, ".pxd-dock__colors")), true);
  assert.equal(shown(q(f.root, ".pxd-dock__looks")), true);
  assert.equal(shown(q(f.root, ".pxd-dock__shapes")), false);
  const swatches = q(f.root, ".pxd-dock__colors").querySelectorAll(".pxd-swatch");
  assert.equal(swatches.length, PALETTE.length + 1);
  swatches.find((s) => s.getAttribute("data-color") === "teal").click();
  q(f.root, ".pxd-dock__looks").querySelectorAll(".pxd-dock__opt").find((b) => b.dataset.look === "card").click();
  assert.deepEqual(calls, [["color", "teal"], ["look", "card"]]);
  f.chrome.toolbar.setTool("select", false);
  assert.equal(options.style.display, "none");
});

test("TB-4: Sticky and Section show colors, Shape shows its kinds, Text and Board show nothing", (t) => {
  const picked = [];
  const f = setup({}, { setShape: (s) => picked.push(s) });
  t.after(f.restore);
  const options = q(f.root, ".pxd-dock__options");
  for (const tool of ["sticky", "section"]) {
    f.chrome.toolbar.setTool(tool, false);
    assert.equal(options.style.display, "", tool);
    assert.equal(shown(q(f.root, ".pxd-dock__colors")), true, tool);
    assert.equal(shown(q(f.root, ".pxd-dock__looks")), false, tool);
  }
  f.chrome.toolbar.setTool("shape", false);
  assert.equal(shown(q(f.root, ".pxd-dock__shapes")), true);
  assert.equal(shown(q(f.root, ".pxd-dock__colors")), false);
  q(f.root, ".pxd-dock__shapes").querySelectorAll(".pxd-dock__opt").find((b) => b.dataset.shape === "diamond").click();
  assert.deepEqual(picked, ["diamond"]);
  for (const tool of ["text", "board", "connect", "hand"]) {
    f.chrome.toolbar.setTool(tool, false);
    assert.equal(options.style.display, "none", tool);
  }
});

test("TB-4: the dock-options switch turns the options off, and a tool switch adds no listeners", (t) => {
  const off = setup({ "dock-options": false });
  t.after(off.restore);
  off.chrome.toolbar.setTool("card", false);
  assert.equal(q(off.root, ".pxd-dock__options").style.display, "none");
  const f = setup();
  t.after(f.restore);
  const before = f.stub.listenerCount();
  for (const tool of ["card", "shape", "sticky", "select", "card"]) f.chrome.toolbar.setTool(tool, false);
  assert.equal(f.stub.listenerCount(), before);
});

// ------------------------------------------------------------------ TB-5 board-coloured crumb

test("TB-5: the board bar takes the board's color, from a palette tone or a hex, and clears it", (t) => {
  const f = setup();
  t.after(f.restore);
  const bar = q(f.root, ".pxd-toolbar");
  f.chrome.toolbar.setBoardColor("teal");
  assert.equal(bar.style["--pxd-board-line"], "var(--pxd-teal-line)");
  f.chrome.toolbar.setBoardColor("#ABCDEF");
  assert.equal(bar.style["--pxd-board-line"], "#abcdef");
  f.chrome.toolbar.setBoardColor("paper");
  assert.equal(bar.style["--pxd-board-line"], undefined);
  f.chrome.toolbar.setBoardColor("not-a-color");
  assert.equal(bar.style["--pxd-board-line"], undefined);
});

test("TB-5: the last crumb carries a 3px rule and the bar's bottom border reads the board line", async () => {
  const css = await read("chrome.css");
  assert.match(css, /\.pxd-crumb\.pxd-crumb--current \{[^}]*border-left: 3px solid var\(--pxd-board-line/);
  assert.match(css, /\.pxd-root\.pxd-root--docked \.pxd-toolbar \{[^}]*border-bottom-color: var\(--pxd-board-line/);
});

// ------------------------------------------------------------------ TB-6 per-board dock

test("TB-6: a board's dock beats the device setting and null falls back to it", (t) => {
  const f = setup({ "dock-position": "bottom" });
  t.after(f.restore);
  assert.ok(has(f.root, "pxd-root--dock-bottom"));
  f.chrome.toolbar.setBoardDock("top");
  assert.ok(has(f.root, "pxd-root--dock-top") && !has(f.root, "pxd-root--dock-bottom"));
  f.chrome.toolbar.setBoardDock("nonsense");
  assert.ok(has(f.root, "pxd-root--dock-bottom"));
  f.chrome.toolbar.setBoardDock("left");
  f.chrome.toolbar.setBoardDock(null);
  assert.ok(has(f.root, "pxd-root--dock-bottom"));
});

test("TB-6: the board menu lists Dock position for this board and marks the current choice", () => {
  const menu = buildMenu("board-menu", { dock: "left" });
  const dock = flattenMenu(menu).find((i) => i.id === "dock");
  assert.equal(dock.label, "Dock position for this board");
  assert.deepEqual(dock.children.filter((c) => !c.separator).map((c) => c.id), ["dock:bottom", "dock:left", "dock:top", "dock:default"]);
  assert.deepEqual(dock.children.filter((c) => c.checked).map((c) => c.id), ["dock:left"]);
  const none = flattenMenu(buildMenu("board-menu", {})).filter((i) => i.checked).map((i) => i.id);
  assert.deepEqual(none, ["dock:default"]);
});

test("TB-6: the dock key is written only by the explicit action, validated, and removed by null", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2, bg: "grid" } }, children: [] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  assert.deepEqual(fake.writesLog(), [], "opening writes nothing");
  assert.equal(await session.setBoardBackground({ dock: "left" }), true);
  assert.deepEqual(fake.props("b1").plexus, { v: 2, bg: "grid", dock: "left" });
  assert.equal(await session.setBoardBackground({ dock: "right" }), false);
  assert.equal(fake.props("b1").plexus.dock, "left");
  assert.equal(await session.setBoardBackground({ dock: null }), true);
  assert.deepEqual(fake.props("b1").plexus, { v: 2, bg: "grid" });
});

// ------------------------------------------------------------------ TB-7 LOD and narrow

test("TB-7: overview keeps Select, Hand and Board and hides the other six dock buttons", async (t) => {
  const f = setup();
  t.after(f.restore);
  const hidden = f.root.querySelectorAll(".pxd-dock__btn").filter((b) => !["select", "hand", "board"].includes(b.dataset.tool));
  assert.equal(hidden.length, 6);
  const css = await read("chrome.css");
  assert.match(css, /pxd-lod-overview \.pxd-dock__btn:not\(\[data-tool="select"\]\):not\(\[data-tool="hand"\]\):not\(\[data-tool="board"\]\)/);
  assert.match(css, /pxd-lod-overview \.pxd-dock__options/);
});

test("TB-7: a narrow board shrinks the dock buttons and drops separators and options", async () => {
  const css = await read("chrome.css");
  assert.match(css, /pxd-root--narrow \.pxd-palette \{[^}]*--pxd-dock-btn: 32px/);
  assert.match(css, /pxd-root--narrow \.pxd-dock__sep,\s*\.pxd-root\.pxd-root--docked\.pxd-root--narrow \.pxd-dock__options \{[^}]*display: none/);
});

// ------------------------------------------------------------------ TB-8 dark mode

test("TB-8: the active top-bar tool beats .pxd-root .pxd-btn, with a border signal", async () => {
  const css = await read("chrome.css");
  const active = rulesOf(css).find((r) => r.selectors.includes(".pxd-root .pxd-btn.pxd-tool--active"));
  assert.ok(active, "three-class rule");
  assert.match(active.body, /border-color:\s*var\(--pxd-accent\)/);
  assert.match(active.body, /background:\s*var\(--pxd-accent-soft\)/);
  const locked = rulesOf(css).find((r) => r.selectors.includes(".pxd-root .pxd-btn.pxd-tool--locked"));
  assert.match(locked.body, /box-shadow:\s*inset 0 0 0 1px var\(--pxd-accent\)/);
  const ext = await readFile(new URL("../src/extension.css", import.meta.url), "utf8");
  const base = rulesOf(ext).find((r) => r.selectors.includes(".pxd-root .pxd-btn"));
  assert.ok(base, "the (0,2,0) rule that used to win");
});

test("TB-8: dark carries the active dock tool as a border and a dot, in all five signals and the OS guard", async () => {
  const ext = await readFile(new URL("../src/extension.css", import.meta.url), "utf8");
  const darkBlocks = rulesOf(ext).filter((r) => r.body.includes("--pxd-dock-pill-border: var(--pxd-accent)") && r.selectors.includes(".pxd-root--dark"));
  assert.equal(darkBlocks.length, 1, "the five-signal block");
  for (const sig of [".bp3-dark .pxd-root", "body.bt-theme-dark .pxd-root", ".rm-dark-theme .pxd-root", "body.roam-body.dark .pxd-root", ".pxd-root--dark"]) {
    assert.ok(darkBlocks[0].selectors.includes(sig), sig);
  }
  assert.match(darkBlocks[0].body, /--pxd-dock-pill-bg:\s*transparent/);
  assert.match(darkBlocks[0].body, /--pxd-dock-dot:\s*var\(--pxd-accent\)/);
  assert.match(darkBlocks[0].body, /--pxd-dock-border:\s*var\(--pxd-border-strong\)/);
  assert.match(darkBlocks[0].body, /--pxd-bar-line:\s*var\(--pxd-border-strong\)/);
  const guard = ext.slice(ext.indexOf("@media (prefers-color-scheme: dark)"));
  assert.match(guard, /--pxd-dock-pill-border:\s*var\(--pxd-accent\)/);
  const light = rulesOf(ext).find((r) => r.selectors.length === 1 && r.selectors[0] === ".pxd-root" && r.body.includes("--pxd-dock-pill-bg"));
  assert.match(light.body, /--pxd-dock-pill-bg:\s*var\(--pxd-accent-soft\)/);
  assert.match(light.body, /--pxd-dock-pill-border:\s*transparent/);
  const css = await read("chrome.css");
  const pill = rulesOf(css).find((r) => r.selectors.some((s) => s.endsWith(".pxd-dock__indicator")) && r.body.includes("border:"));
  assert.match(pill.body, /border:\s*1\.5px solid var\(--pxd-dock-pill-border\)/);
  assert.match(pill.body, /background:\s*var\(--pxd-dock-pill-bg\)/);
});

test("TB-8: dock buttons restate color so Blueprint's dark button color cannot win, and icons stay unclipped", async () => {
  const css = await read("chrome.css");
  const btn = rulesOf(css).find((r) => r.selectors.includes(".pxd-root.pxd-root--docked .pxd-dock__btn"));
  assert.match(btn.body, /color:\s*var\(--pxd-text\)/);
  assert.ok(rulesOf(css).some((r) => r.selectors.includes(".pxd-root.pxd-root--docked .pxd-dock__btn .bp3-icon svg") && /overflow:\s*visible/.test(r.body)));
});

test("TB-8: every rule in the 2.2 block starts at .pxd-root with two classes at least", async () => {
  const css = await read("chrome.css");
  const block = block22(css);
  for (const rule of rulesOf(block)) {
    for (const sel of rule.selectors) {
      assert.ok(sel.startsWith(".pxd-root"), sel);
      assert.ok((sel.replace(/:not\([^)]*\)/g, "").match(/\.[a-zA-Z_][\w-]*/g) || []).length >= 2, sel);
    }
  }
  assert.ok(!/!important/.test(block));
});
