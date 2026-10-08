// P-ONBOARD. The auto-read setting, the Pages installer copy, and the tooltips the new UI names.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSettingsPanel, normalizeSetting, settingsDefaults } from "../src/settings.js";
import { TIP_TEXT } from "../src/view/tooltip-text.js";

test("Auto-read scanned pages is a switch, on by default, in the PDF parse group", () => {
  assert.equal(settingsDefaults()["parse-auto-read"], true);
  assert.equal(normalizeSetting("parse-auto-read", false), false);
  const panel = createSettingsPanel();
  const ids = panel.settings.map((row) => row.id);
  const row = panel.settings.find((r) => r.id === "parse-auto-read");
  assert.equal(row.name, "Auto-read scanned pages");
  assert.equal(row.action.type, "switch");
  assert.ok(ids.indexOf("parse-auto-read") > ids.indexOf("group-parse"));
  assert.equal(TIP_TEXT["parse.auto-read"].name, "Auto-read scanned pages");
});

test("Pages serves the installer, byte for byte the source next to the helper", async () => {
  const source = await readFile(new URL("../tools/parse-helper/install.sh", import.meta.url), "utf8");
  const served = await readFile(new URL("../deploy/helper/install.sh", import.meta.url), "utf8");
  assert.equal(served, source);
  assert.match(served, /^#!\/bin\/sh/);
  assert.match(served, /Back to Roam: click Pair\./);
});
