import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { paletteVars, statusApi, statusKey, statusLook, statusPalette, taskStatusOf } from "../src/model/status-tags.js";

const NAMES = ["Active", "Waiting", "In Review", "Holding", "Incubating", "Alert", "Cancelled"];

const pair = (base, text) => ({ base, text });

function apiRow(key, name, glyph, light, dark) {
  return { key, name, tag: `task-status/${name}`, glyph, light, dark };
}

test("statusKey slugs a name; a rename is a different key", () => {
  assert.equal(statusKey("In Review"), "in-review");
  assert.equal(statusKey("  Waiting "), "waiting");
  assert.equal(statusKey("Blocked"), "blocked");
  assert.notEqual(statusKey("Blocked"), statusKey("Waiting"));
});

test("without the API the palette is the seven defaults, in order", () => {
  const map = statusPalette(null);
  assert.equal(map.size, 7);
  assert.deepEqual([...map.values()].map((entry) => entry.name), NAMES);
  assert.deepEqual([...map.keys()], NAMES.map((name) => name.toLowerCase()));
  assert.equal(map.get("in review").glyph, "in-review");
  assert.equal(map.get("in review").key, "IN_REVIEW");
  assert.equal(statusPalette({ statuses() { return []; } }).size, 7);
  assert.equal(statusPalette({ statuses() { throw new Error("down"); } }).size, 7);
});

test("a live palette keeps API order, and a rename drops the old key", () => {
  const light = pair("rgba(1, 2, 3, 0.1)", "rgb(1, 2, 3)");
  const dark = pair("rgba(1, 2, 3, 0.2)", "rgb(4, 5, 6)");
  const rows = [
    apiRow("ACTIVE", "Active", "active", light, dark),
    apiRow("BLOCKED", "Blocked", "pause", light, dark),
    apiRow("IN_REVIEW", "In Review", "in-review", light, dark),
    apiRow("HOLDING", "Holding", "holding", light, dark),
    apiRow("INCUBATING", "Incubating", "incubating", light, dark),
    apiRow("ALERT", "Alert", "alert", light, dark),
    apiRow("CANCELLED", "Cancelled", "cancelled", light, dark),
  ];
  const map = statusPalette({ statuses: () => rows });
  assert.equal(map.size, 7);
  assert.deepEqual([...map.values()].map((entry) => entry.name), ["Active", "Blocked", "In Review", "Holding", "Incubating", "Alert", "Cancelled"]);
  assert.equal(map.has("waiting"), false);
  assert.equal(map.get("blocked").key, "BLOCKED");
  assert.equal(statusKey(map.get("blocked").name), "blocked");
  assert.equal(map.get("blocked").glyph, "pause");
});

test("paletteVars follows the board theme token", () => {
  const active = statusPalette(null).get("active");
  assert.equal(paletteVars(active, "light")["--pxd-status-text"], "rgb(13, 116, 104)");
  assert.equal(paletteVars(active, "light")["--pxd-status-base"], "rgba(20, 184, 166, 0.1)");
  assert.equal(paletteVars(active, "dark")["--pxd-status-text"], "rgb(68, 198, 184)");
  assert.equal(paletteVars(active, "bp3-dark")["--pxd-status-base"], "rgba(20, 184, 166, 0.2)");
  assert.notEqual(paletteVars(active, "light")["--pxd-status-text"], paletteVars(active, "dark")["--pxd-status-text"]);
});

test("an unknown name is a neutral diamond, and taskStatusOf returns the palette name or null", () => {
  const palette = statusPalette(null);
  const foreign = statusLook("Nope", palette);
  assert.equal(foreign.glyph, "diamond");
  assert.equal(foreign.light.text, "rgb(88, 102, 122)");
  assert.equal(paletteVars(foreign, "dark")["--pxd-status-text"], "rgb(158, 168, 183)");
  const custom = statusPalette({
    statuses: () => [apiRow("ODD", "Odd", "custom", pair("rgba(9, 9, 9, 0.1)", "rgb(9, 9, 9)"), pair("rgba(9, 9, 9, 0.2)", "rgb(8, 8, 8)"))],
  });
  assert.equal(custom.get("odd").glyph, "diamond");
  assert.equal(taskStatusOf("{{[[TODO]]}} Wash #[[task-status/Active]]", palette), "Active");
  assert.equal(taskStatusOf("{{[[TODO]]}} Wash #[[task-status/active]]", palette), "Active");
  assert.equal(taskStatusOf("plain #[[task-status/Waiting]]", palette), "Waiting");
  assert.equal(taskStatusOf("{{[[TODO]]}} Wash #[[task-status/Nope]]", palette), null);
  assert.equal(taskStatusOf("{{[[TODO]]}} Wash", palette), null);
  assert.equal(taskStatusOf("", palette), null);
});

test("statusApi accepts apiVersion 1 only", () => {
  assert.equal(statusApi({}), null);
  assert.equal(statusApi({ RoamTaskStatusTags: { apiVersion: 2, statuses() { return []; } } }), null);
  const api = { apiVersion: 1, statuses() { return []; } };
  assert.equal(statusApi({ RoamTaskStatusTags: api }), api);
});

test("status.css masks every glyph, sizes the map mark, and stops the Alert pulse", () => {
  const css = readFileSync(new URL("../src/css/status.css", import.meta.url), "utf8");
  for (const key of ["active", "play", "waiting", "pause", "holding", "stop", "incubating", "ring", "alert", "exclamation", "cancelled", "x", "diamond", "in-review"]) {
    assert.match(css, new RegExp(`data-status="${key}"`));
  }
  assert.match(css, /mask:\s*var\(--pxd-status-mask\)/);
  assert.match(css, /calc\(22px \* var\(--pxd-screen-px/);
  assert.match(css, /pxd-chip--status/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /pxd-root--motion-off/);
  assert.match(css, /animation:\s*pxd-status-alert 5\.2s/);
  assert.match(css, /pxd-task-check--done\[data-status\]::before/);
  assert.match(css, /margin-right:\s*14px/);
  assert.match(css, /\.pxd-root\.pxd-root--dark \.pxd-task-check\[data-status\] \{\s*background:\s*transparent;/);
});
