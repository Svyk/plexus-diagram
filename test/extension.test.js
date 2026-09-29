import assert from "node:assert/strict";
import test from "node:test";

import extension from "../src/extension.js";
import { createSettingsPanel, readSettings, settingsDefaults, onSettingsChange } from "../src/settings.js";

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
  assert.deepEqual(ids.sort(), Object.keys(settingsDefaults()).sort());
  assert.deepEqual(ids.sort(), [
    "collapse-outline", "default-card-height", "default-card-width", "disable-on-mobile", "enable-shortcuts", "enabled",
    "fullscreen-on-zoom", "graph-links", "grid", "show-minimap", "show-version-badge", "snap-guides", "wheel",
  ]);
  const byId = Object.fromEntries(panel.settings.map((row) => [row.id, row]));
  assert.equal(byId["graph-links"].action.type, "select");
  assert.deepEqual(byId["graph-links"].action.items, ["all", "attributes", "off"]);
  assert.equal(byId.wheel.action.type, "select");
  assert.equal(byId.grid.action.type, "select");
  assert.equal(byId["default-card-width"].action.type, "input");
  assert.equal(byId.enabled.action.type, "switch");
  const defaults = settingsDefaults();
  assert.equal(defaults["fullscreen-on-zoom"], true);
  assert.equal(defaults["graph-links"], "all");
  assert.equal(defaults.wheel, "pan");
  assert.equal(defaults.grid, "dots");
  assert.equal(defaults["default-card-width"], 280);
  assert.equal(defaults["default-card-height"], 160);
  assert.equal(defaults["disable-on-mobile"], true);
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

test("extension exports the Roam lifecycle contract and survives repeated unload", async () => {
  assert.equal(typeof extension.onload, "function");
  assert.equal(typeof extension.onunload, "function");

  const api = fakeExtensionApi();
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "0.1.0" }, deps: stubDeps() });
  assert.equal(typeof cleanup, "function");
  await cleanup();
  await extension.onunload();
  await extension.onunload();

  const labels = ["Plexus: Enhance this diagram", "Plexus: New whiteboard here", "Plexus: Restore native diagram", "Plexus: Fullscreen this diagram"];
  for (const label of labels) {
    for (const kind of ["command", "slash"]) {
      assert.ok(api.calls.some(([name, l]) => name === `${kind}:add` && l === label), `${kind}:add ${label}`);
      assert.ok(api.calls.some(([name, l]) => name === `${kind}:remove` && l === label), `${kind}:remove ${label}`);
    }
  }
  assert.ok(api.calls.some(([name, label]) => name === "context:add" && label === "Plexus: Enhance"));
  assert.ok(api.calls.some(([name, label]) => name === "context:remove" && label === "Plexus: Enhance"));
  assert.deepEqual(api.calls.filter(([name]) => name === "command:add").map(([, label]) => label), labels);
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
