import assert from "node:assert/strict";
import test from "node:test";

import extension from "../src/extension.js";
import { createSettingsPanel } from "../src/settings.js";

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
    data: {
      pull: () => null,
      q: () => [],
      block: {
        create: async () => "new-uid",
        update: async () => null,
        delete: async () => null,
      },
      addPullWatch: () => {},
      removePullWatch: () => {},
    },
    q: () => [],
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
      rightSidebar: {
        addWindow: async () => () => {},
      },
      getFocusedBlock: () => null,
    },
    platform: {
      isMobile: () => false,
    },
  };
}

test("settings panel uses Plexus Diagram tab title and required ids", () => {
  const panel = createSettingsPanel();
  assert.equal(panel.tabTitle, "Plexus Diagram");
  assert.ok(panel.settings.some((row) => row.id === "enabled"));
  assert.ok(!panel.settings.some((row) => row.id === "include-timestamp"));
});

test("extension exports the Roam lifecycle contract and survives repeated unload", async () => {
  assert.equal(typeof extension.onload, "function");
  assert.equal(typeof extension.onunload, "function");

  const api = fakeExtensionApi();
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "0.1.0" } });
  assert.equal(typeof cleanup, "function");
  await cleanup();
  await extension.onunload();
  await extension.onunload();

  assert.ok(api.calls.some(([name, label]) => name === "command:add" && label === "Plexus Diagram: Enhance this diagram"));
  assert.ok(api.calls.some(([name, label]) => name === "command:add" && label === "Plexus Diagram: Restore native diagram"));
  assert.ok(api.calls.some(([name, label]) => name === "command:add" && label === "Plexus Diagram: Fullscreen this diagram"));
  assert.ok(api.calls.some(([name, label]) => name === "slash:add" && label === "Plexus Diagram: Enhance this diagram"));
  assert.ok(api.calls.some(([name, label]) => name === "slash:add" && label === "Plexus Diagram: Restore native diagram"));
  assert.ok(api.calls.some(([name, label]) => name === "slash:add" && label === "Plexus Diagram: Fullscreen this diagram"));
  assert.ok(api.calls.some(([name, label]) => name === "context:add" && label === "Plexus Diagram: Enhance"));
  const palette = api.calls.filter(([name]) => name === "command:add").map(([, label]) => label);
  assert.deepEqual(palette, [
    "Plexus Diagram: Enhance this diagram",
    "Plexus Diagram: Restore native diagram",
    "Plexus Diagram: Fullscreen this diagram",
  ]);
  assert.ok(!palette.includes("Plexus Diagram: Add card"));
  assert.ok(!api.calls.some(([, label]) => label === "Plexus Diagram: Connect selected"));
  assert.ok(!api.calls.some(([, label]) => label === "Plexus Diagram: Toggle connect tool"));
  assert.ok(!api.calls.some(([, label]) => label === "Plexus Diagram: Open nested diagram"));
  assert.ok(!api.calls.some(([, label]) => label === "Plexus Diagram: Show library"));
  assert.ok(!api.calls.some(([, label]) => label === "Plexus Diagram: Appearances of this block"));
  assert.ok(!api.calls.some(([, label]) => label === "Plexus Diagram: Snap selection to grid"));
  assert.ok(!api.calls.some(([, label]) => label === "Plexus Diagram: Auto-layout"));
  assert.ok(api.calls.some(([name, title]) => name === "panel:create" && title === "Plexus Diagram"));
  assert.ok(!api.calls.some(([, key]) => key === "include-timestamp"));
});

test("a second load disposes the previous runtime before registering again", async () => {
  const firstApi = fakeExtensionApi();
  const secondApi = fakeExtensionApi();

  await extension.onload({ extensionAPI: firstApi, extension: { version: "one" } });
  const cleanup = await extension.onload({ extensionAPI: secondApi, extension: { version: "two" } });

  assert.equal(firstApi.calls.filter(([name]) => name === "command:remove").length >= 1, true);
  assert.equal(secondApi.calls.filter(([name]) => name === "command:add").length >= 1, true);
  await cleanup();
});
