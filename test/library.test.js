import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { filterLibraryTitles } from "../src/library.js";

test("library drawer CSS contains an opaque #ffffff background", async () => {
  const css = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../src/extension.css"), "utf8");
  assert.match(css, /\.pxd-library-drawer\s*\{[^}]*background:\s*#ffffff/s);
});

test("filterLibraryTitles skips roam/js titles when query is empty and includes them when query is non-empty", () => {
  const titles = ["Inbox", "roam/js/settings", "Daily notes"];
  assert.deepEqual(filterLibraryTitles(titles, ""), ["Inbox", "Daily notes"]);
  assert.deepEqual(filterLibraryTitles(titles, "roam"), ["roam/js/settings"]);
  assert.deepEqual(filterLibraryTitles(titles, "inbox"), ["Inbox"]);
});

test("filterLibraryTitles skips blank titles", () => {
  assert.deepEqual(filterLibraryTitles(["", "  ", "Keep", null], ""), ["Keep"]);
});
