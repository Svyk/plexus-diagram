import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { enhancedUidGuardCss } from "../src/discovery.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("enhancedUidGuardCss targets rm-diagram hosts for a uid", () => {
  const css = enhancedUidGuardCss(new Set(["abc123"]));
  assert.match(css, /\.rm-diagram/);
  assert.match(css, /abc123/);
  assert.match(css, /\[id\$="abc123"\]/);
  assert.doesNotMatch(css, /overflow:\s*visible/);
});

test("enhancedUidGuardCss caps over-budget uid sets", () => {
  const over = new Set(Array.from({ length: 2001 }, (_, index) => `uid${index}`));
  assert.equal(enhancedUidGuardCss(over), "");
});

test("extension.css hides enhanced native diagrams with pxd-native-hidden", async () => {
  const css = await readFile(resolve(repoRoot, "src/extension.css"), "utf8");
  assert.match(css, /\.rm-diagram\.pxd-native-hidden\s*\{[^}]*display:\s*none\s*!important/);
});
