// G3. Three optional Heptabase looks. Defaults keep today's canvas, sections, and highlight bar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createSettingsPanel, normalizeSetting, settingsDefaults } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const LOOKS = ["pxd-look--flat", "pxd-look--pastel", "pxd-look--tint"];

function mount(settings = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Looks}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [{
      ":block/uid": "cardAAAA1",
      ":block/string": "Alpha",
      ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } },
      ":block/children": [],
    }],
  });
  const session = {
    uid: "board0001",
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    on: () => () => {},
    release() {},
    setLinkMode() {},
  };
  const host = {
    graph: "Svy",
    renderString() {},
    renderBlock() {},
    renderPage() {},
    unmount() {},
    pullTree: () => [],
    blockString: () => null,
    pageUid: () => null,
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: (key) => settings[key] },
    version: "3.2.0",
  });
  return {
    root: view.root,
    view,
    close() {
      view.dispose();
      restore();
    },
  };
}

function classesOf(root) {
  return LOOKS.filter((name) => root.classList.contains(name));
}

test("look settings default off and only accept their two values", () => {
  const defaults = settingsDefaults();
  assert.equal(defaults["look-canvas"], "dots");
  assert.equal(defaults["look-sections"], "none");
  assert.equal(defaults["look-highlights"], "bar");
  assert.equal(normalizeSetting("look-canvas", "flat-grey"), "flat-grey");
  assert.equal(normalizeSetting("look-canvas", "plain"), "dots");
  assert.equal(normalizeSetting("look-sections", "pastel"), "pastel");
  assert.equal(normalizeSetting("look-sections", "wash"), "none");
  assert.equal(normalizeSetting("look-highlights", "tint"), "tint");
  assert.equal(normalizeSetting("look-highlights", "fill"), "bar");

  const panel = createSettingsPanel();
  const ids = panel.settings.map((row) => row.id);
  const board = ids.slice(ids.indexOf("group-board") + 1, ids.indexOf("group-performance"));
  const at = board.indexOf("look-canvas");
  assert.deepEqual(board.slice(at, at + 3), ["look-canvas", "look-sections", "look-highlights"]);
  const rows = Object.fromEntries(panel.settings.map((row) => [row.id, row]));
  assert.equal(rows["look-canvas"].name, "Canvas");
  assert.equal(rows["look-sections"].name, "Section fill");
  assert.equal(rows["look-highlights"].name, "Highlight cards");
  assert.deepEqual(rows["look-canvas"].action.items, ["dots", "flat-grey"]);
  assert.deepEqual(rows["look-sections"].action.items, ["none", "pastel"]);
  assert.deepEqual(rows["look-highlights"].action.items, ["bar", "tint"]);
});

test("root classes follow the look settings on mount and on setSettings", () => {
  const off = mount();
  try {
    assert.deepEqual(classesOf(off.root), []);
    off.view.setSettings({
      "look-canvas": "flat-grey",
      "look-sections": "pastel",
      "look-highlights": "tint",
    });
    assert.deepEqual(classesOf(off.root), LOOKS);
    off.view.setSettings({ "look-canvas": "dots", "look-sections": "none", "look-highlights": "bar" });
    assert.deepEqual(classesOf(off.root), []);
    off.view.setSettings({ "look-canvas": "flat-grey" });
    assert.deepEqual(classesOf(off.root), ["pxd-look--flat"]);
  } finally {
    off.close();
  }

  const on = mount({ "look-canvas": "flat-grey", "look-sections": "pastel", "look-highlights": "tint" });
  try {
    assert.deepEqual(classesOf(on.root), LOOKS);
  } finally {
    on.close();
  }
});

test("look CSS covers the light canvas and the dark border-and-fill", () => {
  const css = readFileSync(new URL("../src/css/looks.css", import.meta.url), "utf8");
  assert.equal(css.includes("prefers-color-scheme"), false);
  assert.match(css, /\.pxd-look--flat[\s\S]*#f2f2f0/);
  assert.match(css, /\.pxd-look--flat \.pxd-grid \{[^}]*background-image:\s*none/);
  assert.match(css, /color-mix\(in srgb, var\(--pxd-fill\) 14%, var\(--pxd-bg\)\)/);
  assert.match(css, /\.pxd-look--tint \.pxd-highlight-bar \{[^}]*width:\s*0/);
  for (const name of ["flat", "pastel", "tint"]) {
    assert.match(css, new RegExp(`\\.bp3-dark \\.pxd-root\\.pxd-look--${name}`));
    assert.match(css, new RegExp(`\\.pxd-root\\.pxd-root--dark\\.pxd-look--${name}`));
    assert.match(css, new RegExp(`body\\.bt-theme-dark \\.pxd-root\\.pxd-look--${name}`));
  }
  assert.match(css, /\.pxd-root\.pxd-root--dark\.pxd-look--flat \{[^}]*background-color:\s*var\(--pxd-surface\)/);
  assert.match(css, /\.pxd-root--dark\.pxd-look--pastel \.pxd-section \{[^}]*color-mix\(in srgb, var\(--pxd-line, var\(--pxd-border-strong\)\) 6%, transparent\)/);
  assert.match(css, /\.pxd-root--dark\.pxd-look--tint[\s\S]*?color-mix\(in srgb, var\(--pxd-line, var\(--pxd-border-strong\)\) 6%, transparent\)/);
});
