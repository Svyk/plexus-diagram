import assert from "node:assert/strict";
import test from "node:test";

import extension from "../src/extension.js";
import { createSettingsPanel, initializeSettings, normalizeSetting, readSettings, resetPlexusSettings, settingsDefaults, onSettingsChange } from "../src/settings.js";

function stubDeps() {
  return {
    host: { api: { data: { pull: () => null } }, stats: { writes: 0, watches: 0, renders: 0 }, pageUid: () => null },
    acquireSession: () => { throw new Error("no board should mount in this test"); },
    mountView: () => { throw new Error("no board should mount in this test"); },
    storage: null,
  };
}

function fakeExtensionApi() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    settings: {
      canSet: true,
      get: (key) => values.get(key) ?? null,
      set: async (key, value) => { values.set(key, value); calls.push(["setting:set", key, value]); return null; },
      panel: {
        create: async (config) => { calls.push(["panel:create", config.tabTitle]); return null; },
      },
    },
    ui: {
      commandPalette: {
        addCommand: async ({ label }) => { calls.push(["command:add", label]); return null; },
        removeCommand: async ({ label }) => { calls.push(["command:remove", label]); return null; },
      },
      slashCommand: {
        addCommand: async ({ label }) => { calls.push(["slash:add", label]); return null; },
        removeCommand: async ({ label }) => { calls.push(["slash:remove", label]); return null; },
      },
      blockContextMenu: {
        addCommand: async ({ label }) => { calls.push(["context:add", label]); return null; },
        removeCommand: async ({ label }) => { calls.push(["context:remove", label]); return null; },
      },
      getFocusedBlock: () => null,
    },
    platform: { isMobile: () => false },
  };
}

test("settings panel follows spec section 6 ids, defaults and row types", () => {
  const panel = createSettingsPanel();
  assert.equal(panel.tabTitle, "Plexus Diagram");
  const ids = panel.settings.map((row) => row.id);
  const settingIds = ids.filter((id) => Object.hasOwn(settingsDefaults(), id));
  assert.deepEqual(settingIds.sort(), Object.keys(settingsDefaults()).sort());
  assert.deepEqual(settingIds.sort(), [
    "attr-styles", "collapse-outline", "default-card-height", "default-card-look", "default-card-width", "disable-on-mobile", "enable-shortcuts", "enabled",
    "controls-position", "fullscreen-on-zoom", "graph-links", "grid", "show-minimap", "show-version-badge", "snap-grid", "snap-guides", "wheel",
    "auto-fit-sections", "board-tone", "map-zoom", "motion", "show-card-badges", "show-palette", "space-out",
  ].sort());
  const byId = Object.fromEntries(panel.settings.map((row) => [row.id, row]));
  assert.equal(byId["graph-links"].action.type, "select");
  assert.equal(byId["attr-styles"].action.type, "input");
  assert.deepEqual(byId["graph-links"].action.items, ["all", "attributes", "off"]);
  assert.equal(byId.wheel.action.type, "select");
  assert.equal(byId.grid.action.type, "select");
  assert.equal(byId["default-card-width"].action.type, "input");
  assert.equal(byId.enabled.action.type, "switch");
  const defaults = settingsDefaults();
  assert.equal(defaults["fullscreen-on-zoom"], true);
  assert.equal(defaults["graph-links"], "all");
  assert.equal(defaults["attr-styles"], "");
  assert.equal(defaults.wheel, "pan");
  assert.equal(defaults.grid, "dots");
  assert.equal(defaults["default-card-width"], 280);
  assert.equal(defaults["default-card-height"], 160);
  assert.equal(defaults["disable-on-mobile"], true);
  assert.equal(defaults["snap-guides"], true);
  assert.equal(defaults["snap-grid"], false);
});

test("readSettings coerces stored values and falls back to defaults", () => {
  const store = { "default-card-width": "320", "graph-links": "bogus", "show-minimap": "false", wheel: "zoom" };
  const settings = readSettings({ settings: { get: (id) => store[id] ?? null } });
  assert.equal(settings["default-card-width"], 320);
  assert.equal(settings["graph-links"], "all");
  assert.equal(settings["show-minimap"], false);
  assert.equal(settings.wheel, "zoom");
  assert.equal(settings.enabled, true);
});

test("1.2 settings: defaults, normalization and panel rows", () => {
  const defaults = settingsDefaults();
  assert.equal(defaults["board-tone"], "none");
  assert.equal(defaults["map-zoom"], "0.45");
  assert.equal(defaults["auto-fit-sections"], true);
  assert.equal(defaults["space-out"], false);
  assert.equal(defaults["show-card-badges"], true);
  assert.equal(normalizeSetting("grid", "grid"), "grid");
  assert.equal(normalizeSetting("grid", "bogus"), "dots");
  assert.equal(normalizeSetting("board-tone", "teal"), "teal");
  assert.equal(normalizeSetting("board-tone", "mauve"), "none");
  assert.equal(normalizeSetting("map-zoom", "0.6"), "0.6");
  assert.equal(normalizeSetting("map-zoom", 0.3), "0.3");
  assert.equal(normalizeSetting("map-zoom", "0.9"), "0.45");
  assert.equal(normalizeSetting("auto-fit-sections", "false"), false);
  assert.equal(normalizeSetting("space-out", "true"), true);
  assert.equal(normalizeSetting("show-card-badges", "nope"), true);
  const rows = Object.fromEntries(createSettingsPanel().settings.map((row) => [row.id, row]));
  assert.equal(rows["board-tone"].action.type, "select");
  assert.equal(rows["board-tone"].action.items.length, 12);
  assert.deepEqual(rows["map-zoom"].action.items, ["0.3", "0.45", "0.6"]);
  assert.match(rows["map-zoom"].name, /Map view below/);
  assert.deepEqual(rows.grid.action.items, ["dots", "lines", "grid", "plain"]);
  assert.match(rows.grid.name, /Default board background: pattern/);
  assert.equal(rows["auto-fit-sections"].action.type, "switch");
  assert.equal(rows["space-out"].action.type, "switch");
  assert.equal(rows["show-card-badges"].action.type, "switch");
});

test("initializeSettings seeds the 1.2 defaults", async () => {
  const store = new Map();
  await initializeSettings({ settings: { get: (id) => store.get(id) ?? null, set: async (id, v) => { store.set(id, v); } } });
  assert.equal(store.get("board-tone"), "none");
  assert.equal(store.get("map-zoom"), "0.45");
  assert.equal(store.get("auto-fit-sections"), true);
  assert.equal(store.get("space-out"), false);
  assert.equal(store.get("show-card-badges"), true);
});

test("every settings row fires onSettingsChange with its id and value", () => {
  const seen = [];
  const off = onSettingsChange((id, value) => seen.push([id, value]));
  const rows = Object.fromEntries(createSettingsPanel().settings.map((row) => [row.id, row]));
  rows.enabled.action.onChange({ target: { checked: false } });
  rows.wheel.action.onChange("zoom");
  rows["default-card-width"].action.onChange({ target: { value: "300" } });
  off();
  rows.enabled.action.onChange({ target: { checked: true } });
  assert.deepEqual(seen, [["enabled", false], ["wheel", "zoom"], ["default-card-width", "300"]]);
});

test("UI-10: settings are grouped, described in plain language, and reset applies every default", async () => {
  const panel = createSettingsPanel();
  const defaults = settingsDefaults();
  const groups = [];
  const members = {};
  let current = null;
  for (const row of panel.settings) {
    assert.equal(typeof row.description, "string");
    assert.match(row.description, /[a-z]/);
    assert.equal(row.description.includes("1.2"), false);
    if (row.id.startsWith("group-")) {
      current = row.name;
      groups.push(current);
      members[current] = [];
      assert.equal(row.action.type, "reactComponent");
    } else if (row.id === "reset-plexus-settings") {
      assert.equal(current, "Performance");
      assert.equal(row.action.type, "button");
      assert.equal(row.action.content, "Reset Plexus settings");
    } else {
      members[current].push(row.id);
    }
  }
  assert.deepEqual(groups, ["Cards", "Sections", "Connections", "Board", "Performance"]);
  assert.deepEqual(members.Cards, ["default-card-look", "default-card-width", "default-card-height", "show-card-badges", "space-out"]);
  assert.deepEqual(members.Sections, ["auto-fit-sections"]);
  assert.deepEqual(members.Connections, ["graph-links", "attr-styles"]);
  assert.ok(members.Board.includes("enabled"));
  assert.ok(members.Performance.includes("motion"));
  assert.deepEqual([...members.Cards, ...members.Sections, ...members.Connections, ...members.Board, ...members.Performance].sort(), Object.keys(defaults).sort());

  const saved = [];
  const seen = [];
  await initializeSettings({
    settings: {
      get: () => true,
      set: async (id, value) => { saved.push([id, value]); },
    },
  });
  const off = onSettingsChange((id, value) => seen.push([id, value]));
  try {
    await resetPlexusSettings();
  } finally {
    off();
  }
  assert.deepEqual(saved.map(([id]) => id).sort(), Object.keys(defaults).sort());
  assert.deepEqual(seen.map(([id]) => id).sort(), Object.keys(defaults).sort());
  for (const [id, value] of saved) assert.equal(value, defaults[id]);
  for (const [id, value] of seen) assert.equal(value, defaults[id]);
});

test("extension exports the Roam lifecycle contract and survives repeated unload", async () => {
  assert.equal(typeof extension.onload, "function");
  assert.equal(typeof extension.onunload, "function");

  const api = fakeExtensionApi();
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "0.1.0" }, deps: stubDeps() });
  assert.equal(typeof cleanup, "function");
  await cleanup();
  await extension.onunload();
  await extension.onunload();

  const slashLabels = ["Plexus: Enhance this diagram", "Plexus: New whiteboard here", "Plexus: Restore native diagram", "Plexus: Fullscreen this diagram", "Plexus: Export board as SVG", "Plexus: Copy board as text"];
  const paletteLabels = ["Plexus: Commands…", "Plexus: New whiteboard here"];
  for (const label of paletteLabels) {
    assert.ok(api.calls.some(([name, l]) => name === "command:add" && l === label), `command:add ${label}`);
    assert.ok(api.calls.some(([name, l]) => name === "command:remove" && l === label), `command:remove ${label}`);
  }
  for (const label of slashLabels) {
    assert.ok(api.calls.some(([name, l]) => name === "slash:add" && l === label), `slash:add ${label}`);
    assert.ok(api.calls.some(([name, l]) => name === "slash:remove" && l === label), `slash:remove ${label}`);
    if (label !== "Plexus: New whiteboard here") {
      assert.equal(api.calls.some(([name, l]) => name === "command:add" && l === label), false, `palette keeps ${label} off`);
    }
  }
  assert.ok(api.calls.some(([name, label]) => name === "context:add" && label === "Plexus: Enhance"));
  assert.ok(api.calls.some(([name, label]) => name === "context:remove" && label === "Plexus: Enhance"));
  assert.deepEqual(api.calls.filter(([name]) => name === "command:add").map(([, label]) => label), paletteLabels);
  assert.deepEqual(api.calls.filter(([name]) => name === "slash:add").map(([, label]) => label), slashLabels);
  assert.ok(api.calls.some(([name, title]) => name === "panel:create" && title === "Plexus Diagram"));
});

test("a second load disposes the previous runtime before registering again", async () => {
  const firstApi = fakeExtensionApi();
  const secondApi = fakeExtensionApi();

  await extension.onload({ extensionAPI: firstApi, extension: { version: "one" }, deps: stubDeps() });
  const cleanup = await extension.onload({ extensionAPI: secondApi, extension: { version: "two" }, deps: stubDeps() });

  assert.equal(firstApi.calls.filter(([name]) => name === "command:remove").length >= 1, true);
  assert.equal(secondApi.calls.filter(([name]) => name === "command:add").length >= 1, true);
  await cleanup();
});
