import assert from "node:assert/strict";
import test from "node:test";

import { TIP_TEXT } from "../src/view/tooltip-text.js";
import { createSettingsPanel, normalizeSetting, settingsDefaults } from "../src/settings.js";

test("parse settings have defaults, rows, a password token, and tooltip strings", () => {
  const defaults = settingsDefaults();
  assert.equal(defaults["parse-helper-url"], "http://127.0.0.1:48765");
  assert.equal(defaults["parse-helper-token"], "");
  assert.equal(defaults["parse-engine-default"], "auto");
  assert.equal(defaults["parse-formula"], false);
  assert.equal(defaults["parse-ocr"], "auto");
  assert.equal(defaults["parse-link-safe"], true);
  assert.equal(defaults["parse-numbered"], false);
  assert.equal(defaults["parse-footnotes"], "inline");
  assert.equal(normalizeSetting("parse-engine-default", "docling"), "docling");
  assert.equal(normalizeSetting("parse-engine-default", "nope"), "auto");
  assert.equal(normalizeSetting("parse-ocr", "off"), "off");
  assert.equal(normalizeSetting("parse-footnotes", "end"), "end");
  assert.equal(normalizeSetting("parse-footnotes", "bottom"), "inline");
  assert.equal(normalizeSetting("parse-formula", true), true);
  assert.equal(normalizeSetting("parse-helper-url", ""), "http://127.0.0.1:48765");

  const panel = createSettingsPanel();
  const ids = panel.settings.map((row) => row.id);
  const byId = Object.fromEntries(panel.settings.map((row) => [row.id, row]));
  assert.ok(ids.indexOf("parse-helper-url") > ids.indexOf("group-parse"));
  assert.equal(byId["parse-helper-url"].name, "Parse helper address");
  assert.equal(byId["parse-helper-token"].action.type, "input");
  assert.equal(byId["parse-helper-token"].action.inputType, "password");
  assert.deepEqual(byId["parse-engine-default"].action.items, ["auto", "builtin", "docling"]);
  assert.equal(byId["parse-formula"].action.type, "switch");
  assert.deepEqual(byId["parse-ocr"].action.items, ["auto", "on", "off"]);
  assert.equal(byId["parse-link-safe"].action.type, "switch");
  assert.equal(byId["parse-numbered"].action.type, "switch");
  assert.deepEqual(byId["parse-footnotes"].action.items, ["inline", "end"]);
  assert.equal(TIP_TEXT["parse.helper-token"].name, "Parse helper token");
  assert.equal(TIP_TEXT["parse.merges-flat"].name, "Merged cells shown flat");
  assert.ok(TIP_TEXT["parse.merges-flat"].desc.includes("Roam Grid draws merges"));
  assert.equal(TIP_TEXT["parse.insert-flat"].name, "Insert as flat table");
});
