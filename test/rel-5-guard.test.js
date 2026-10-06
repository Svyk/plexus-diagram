// REL-5. Error budget for callbacks, and the settings row.
import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";

import { guardCallback } from "../src/guard.js";
import { bindErrorStats, clearErrorStats, createSettingsPanel, SETTING_IDS } from "../src/settings.js";
import { createLifecycle } from "../src/lifecycle.js";

const origError = console.error;

afterEach(() => {
  console.error = origError;
  clearErrorStats();
  mock.timers.reset();
});

function throwNamed(name) {
  const error = new Error(name);
  error.name = name;
  throw error;
}

test("19 throws log once and leave errors at 19", () => {
  const stats = { errors: 0 };
  const logs = [];
  console.error = (...args) => logs.push(args);
  const fn = guardCallback("boom", () => throwNamed("NineteenErr"), { stats });
  for (let i = 0; i < 19; i++) fn();
  assert.equal(logs.length, 1);
  assert.equal(stats.errors, 19);
  assert.equal(logs[0][0], "[plexus-diagram]");
  assert.equal(logs[0][2].name, "NineteenErr");
});

test("the 20th throw silences the callback and the 21st neither throws nor counts", () => {
  const stats = { errors: 0 };
  console.error = () => {};
  let ran = 0;
  const fn = guardCallback("boom", () => {
    ran += 1;
    throwNamed("SilenceErr");
  }, { stats });
  for (let i = 0; i < 20; i++) fn();
  assert.equal(ran, 20);
  assert.equal(stats.errors, 20);
  assert.doesNotThrow(() => fn());
  assert.equal(ran, 20);
  assert.equal(stats.errors, 20);
});

test("a second signature still logs and increments", () => {
  const stats = { errors: 0 };
  const logs = [];
  console.error = (...args) => logs.push(args);
  const first = guardCallback("one", () => throwNamed("FirstSig"), { stats });
  const second = guardCallback("two", () => throwNamed("SecondSig"), { stats });
  first();
  second();
  assert.equal(logs.length, 2);
  assert.equal(stats.errors, 2);
  for (let i = 0; i < 19; i++) first();
  const errors = stats.errors;
  const logged = logs.length;
  assert.doesNotThrow(() => first());
  assert.equal(stats.errors, errors);
  second();
  assert.equal(stats.errors, errors + 1);
  assert.equal(logs.length, logged);
});

test("fake timers arm the silenced callback again after 60s", () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  const stats = { errors: 0 };
  console.error = () => {};
  let ran = 0;
  const fn = guardCallback("later", () => {
    ran += 1;
    throwNamed("RearmErr");
  }, { stats });
  for (let i = 0; i < 21; i++) fn();
  assert.equal(ran, 20);
  assert.equal(stats.errors, 20);
  mock.timers.tick(60000);
  fn();
  assert.equal(ran, 21);
  assert.equal(stats.errors, 21);
});

test("the settings panel has no errors line at 0 and shows 3 errors at 3", () => {
  const quiet = createSettingsPanel({ stats: { errors: 0 } });
  assert.equal(quiet.settings.some((row) => row.id === "plexus-errors"), false);
  const loud = createSettingsPanel({ stats: { errors: 3 } });
  const row = loud.settings.find((entry) => entry.id === "plexus-errors");
  const badge = loud.settings.findIndex((entry) => entry.id === SETTING_IDS.showVersionBadge);
  assert.equal(loud.settings[badge + 1], row);
  assert.equal(row.name, "3 errors");
  assert.equal(row.action.component(), "3 errors");
  assert.equal(row.action.type, "reactComponent");
});

test("unload removes the errors line", async () => {
  const stats = { errors: 0 };
  const panel = createSettingsPanel();
  bindErrorStats(stats);
  assert.equal(panel.settings.some((row) => row.id === "plexus-errors"), false);
  console.error = () => {};
  const fn = guardCallback("settings", () => throwNamed("PanelErr"), { stats });
  fn();
  fn();
  fn();
  const row = panel.settings.find((entry) => entry.id === "plexus-errors");
  assert.equal(row?.name, "3 errors");
  const lifecycle = createLifecycle();
  lifecycle.add(() => clearErrorStats());
  await lifecycle.dispose();
  assert.equal(panel.settings.some((entry) => entry.id === "plexus-errors"), false);
});

test("an async callback that rejects is counted and logged like a throw, and the rejection does not escape", async () => {
  const { guardCallback } = await import("../src/guard.js");
  const stats = { errors: 0 };
  const logs = [];
  const fn = guardCallback("async", async () => { throw new TypeError("async boom"); }, { stats, log: (...a) => logs.push(a) });
  const out = fn();
  assert.equal(typeof out?.then, "function");
  assert.equal(await out, undefined);
  assert.equal(stats.errors, 1);
  assert.equal(logs.length, 1);
});
