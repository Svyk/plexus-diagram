// DOC-2. The 3.0 API doc names every listed export, and the README tables match shortcuts and settings.
import assert from "node:assert/strict";
import test from "node:test";

import { missingExports, missingSettings, missingShortcuts } from "../tools/doc-check.mjs";

test("every listed module export is in the 3.0 API doc", () => {
  assert.deepEqual(missingExports(), []);
});

test("every shortcut row is in the README Shortcuts table", () => {
  assert.deepEqual(missingShortcuts(), []);
});

test("every SETTING_IDS label is in the README Settings section", () => {
  assert.deepEqual(missingSettings(), []);
});

test("matchResurface on a page with no daily date returns nothing", async () => {
  const { matchResurface } = await import("../src/model/resurface.js");
  const rows = [{ uid: "a", time: 0 }];
  assert.deepEqual(matchResurface(rows, null, [1]), []);
  assert.deepEqual(matchResurface(rows, "", [1]), []);
});
