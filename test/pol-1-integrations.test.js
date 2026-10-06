import assert from "node:assert/strict";
import test from "node:test";

import {
  betterTasks,
  compass,
  highlighter,
  integrations,
  roamPlexus,
  statusLine,
  taskStatusTags,
} from "../src/model/detect.js";
import { createSettingsPanel, refreshIntegrations, settingsDefaults } from "../src/settings.js";

const LOADED = {
  RoamExtensionTools: { "better-tasks": { name: "Better Tasks", version: "1.3" } },
  RoamTaskStatusTags: { apiVersion: 1 },
  RoamPlexus: { apiVersion: 7 },
  RoamCompass: { apiVersion: 1 },
  __ROAM_COMPASS_VERSION: "0.8.0",
  document: {
    body: {},
    defaultView: {
      getComputedStyle() {
        return { getPropertyValue: (name) => (name === "--cl-lh-blue" ? "#cee9ff" : "") };
      },
    },
  },
};

function row(panel, id) {
  return panel.settings.find((entry) => entry.id === id);
}

function textOf(panel, id) {
  return row(panel, id).action.component();
}

test("statusLine names the state, the version, and the switch", () => {
  assert.equal(statusLine({ label: "Better Tasks", state: "detected", version: "1.3" }, false), "Better Tasks: detected 1.3 · off");
  assert.equal(statusLine({ label: "Better Tasks", state: "detected", version: "1.3" }, true), "Better Tasks: detected 1.3 · on");
  assert.equal(statusLine({ label: "Task Status Tags", state: "not installed", version: "" }), "Task Status Tags: not installed");
  assert.equal(statusLine({ label: "Roam Plexus", state: "detected", version: "apiVersion 7" }, true), "Roam Plexus: detected apiVersion 7 · on");
  assert.equal(statusLine({ label: "Colour highlighter", state: "detected", version: "" }), "Colour highlighter: detected");
  assert.equal(statusLine({ label: "Compass", state: "not installed", version: "0.8.0" }, false), "Compass: not installed · off");
});

test("each detector reports detected or not installed", () => {
  assert.deepEqual(betterTasks(null), { id: "better-tasks", label: "Better Tasks", state: "not installed", version: "" });
  assert.equal(betterTasks({ betterTasks: false }).state, "not installed");
  assert.deepEqual(betterTasks(LOADED), { id: "better-tasks", label: "Better Tasks", state: "detected", version: "1.3" });
  assert.equal(betterTasks({ betterTasks: { v1: { version: "2.4.0" } } }).version, "2.4.0");
  assert.equal(betterTasks({
    get RoamExtensionTools() { throw new Error("gone"); },
    get betterTasks() { throw new Error("gone"); },
  }).state, "not installed");

  assert.equal(taskStatusTags({}).state, "not installed");
  assert.deepEqual(taskStatusTags(LOADED), { id: "task-status-tags", label: "Task Status Tags", state: "detected", version: "apiVersion 1" });

  assert.equal(roamPlexus({}).state, "not installed");
  assert.deepEqual(roamPlexus(LOADED), { id: "roam-plexus", label: "Roam Plexus", state: "detected", version: "apiVersion 7" });

  assert.equal(compass({}).state, "not installed");
  assert.equal(compass(LOADED).version, "0.8.0");
  assert.equal(compass({ RoamCompass: { apiVersion: 1 } }).version, "apiVersion 1");

  assert.equal(highlighter({}).state, "not installed");
  assert.equal(highlighter(LOADED).state, "detected");
  assert.equal(highlighter({
    document: {
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === "style" ? [{ textContent: '[data-tag^=".bg-"]{display:none}' }] : []),
    },
  }).state, "detected");
  assert.equal(highlighter({
    document: { querySelector: (sel) => (String(sel).includes("color-highlighter") ? { id: "plugin-style" } : null) },
  }).state, "detected");
  assert.deepEqual(highlighter({ RoamColorHighlighter: { version: "4.2" } }), {
    id: "highlighter", label: "Colour highlighter", state: "detected", version: "4.2",
  });

  const found = integrations(LOADED);
  assert.equal(found.length, 5);
  assert.deepEqual(found.map((entry) => entry.state), ["detected", "detected", "detected", "detected", "detected"]);
  assert.deepEqual(found.slice(0, 4).map((entry) => entry.version), ["1.3", "apiVersion 1", "apiVersion 7", "0.8.0"]);
  assert.equal(found[4].version, "");
});

test("Integrations group has a status row beside each switch, and new switches keep today's behaviour", () => {
  const defaults = settingsDefaults();
  assert.equal(defaults["better-tasks"], false);
  assert.equal(defaults["task-tool"], false);
  assert.equal(defaults["card-chips"], true);
  assert.equal(defaults.resurface, true);
  assert.equal(defaults["regions-inline"], true);
  assert.equal(defaults.interop, true);

  const panel = createSettingsPanel();
  const ids = panel.settings.map((entry) => entry.id);
  const from = ids.indexOf("group-integrations");
  const to = ids.indexOf("group-sections");
  const group = ids.slice(from + 1, to);
  assert.deepEqual(group, [
    "status-better-tasks", "better-tasks", "status-task-status-tags", "task-tool", "task-chips", "task-default-project",
    "status-roam-plexus", "status-compass", "interop", "status-highlighter", "card-chips", "resurface", "regions-inline",
  ]);
  for (const id of ["status-better-tasks", "status-task-status-tags", "status-roam-plexus", "status-compass", "status-highlighter"]) {
    assert.equal(row(panel, id).action.type, "reactComponent");
    assert.match(textOf(panel, id), /not installed/);
  }
  assert.equal(textOf(panel, "status-better-tasks"), "Better Tasks: not installed · off");
  assert.equal(textOf(panel, "status-task-status-tags"), "Task Status Tags: not installed");
  assert.equal(textOf(panel, "status-roam-plexus"), "Roam Plexus: not installed · on");
  assert.equal(row(panel, "resurface").action.type, "switch");
  assert.equal(row(panel, "regions-inline").action.type, "switch");
  assert.equal(row(panel, "interop").action.type, "switch");
});

test("a React global renders the status as an element; tests without it get the string", () => {
  const panel = createSettingsPanel();
  const previous = globalThis.React;
  globalThis.React = { createElement: (type, props, child) => ({ type, props, child }) };
  try {
    const node = textOf(panel, "status-compass");
    assert.equal(node.type, "span");
    assert.equal(node.props.className, "pxd-integration-status");
    assert.equal(node.child, "Compass: not installed · on");
  } finally {
    if (previous === undefined) delete globalThis.React;
    else globalThis.React = previous;
  }
  assert.equal(typeof textOf(panel, "status-compass"), "string");
});

test("refreshIntegrations rewrites the row when a sibling loads and unloads", () => {
  const panel = createSettingsPanel();
  const win = {
    RoamCompass: { apiVersion: 1 },
    __ROAM_COMPASS_VERSION: "0.8.0",
    RoamExtensionTools: { "better-tasks": { version: "1.3" } },
    RoamTaskStatusTags: { apiVersion: 1 },
    RoamPlexus: { apiVersion: 7 },
    document: {
      body: {},
      defaultView: { getComputedStyle: () => ({ getPropertyValue: (name) => (name === "--cl-dk-red" ? "#0254a0" : "") }) },
    },
  };
  refreshIntegrations(win);
  assert.equal(textOf(panel, "status-better-tasks"), "Better Tasks: detected 1.3 · off");
  assert.equal(textOf(panel, "status-task-status-tags"), "Task Status Tags: detected apiVersion 1");
  assert.equal(textOf(panel, "status-roam-plexus"), "Roam Plexus: detected apiVersion 7 · on");
  assert.equal(textOf(panel, "status-compass"), "Compass: detected 0.8.0 · on");
  assert.equal(row(panel, "status-compass").description, "Compass: detected 0.8.0 · on");
  assert.equal(textOf(panel, "status-highlighter"), "Colour highlighter: detected");
  assert.equal(integrations(win).filter((entry) => entry.state === "detected").length, 5);

  delete win.RoamCompass;
  delete win.__ROAM_COMPASS_VERSION;
  refreshIntegrations(win);
  assert.equal(textOf(panel, "status-compass"), "Compass: not installed · on");
  assert.equal(row(panel, "status-compass").description, "Compass: not installed · on");
  assert.equal(textOf(panel, "status-better-tasks"), "Better Tasks: detected 1.3 · off");
});

test("flipping the Better Tasks switch updates the status line", () => {
  const previous = globalThis.window;
  globalThis.window = { RoamExtensionTools: { "better-tasks": { version: "1.3" } } };
  let panel = null;
  try {
    panel = createSettingsPanel();
    assert.equal(textOf(panel, "status-better-tasks"), "Better Tasks: detected 1.3 · off");
    row(panel, "better-tasks").action.onChange({ target: { checked: true } });
    assert.equal(textOf(panel, "status-better-tasks"), "Better Tasks: detected 1.3 · on");
    assert.equal(row(panel, "status-better-tasks").description, "Better Tasks: detected 1.3 · on");
  } finally {
    try { row(panel, "better-tasks").action.onChange({ target: { checked: false } }); } catch { /* panel never built */ }
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
