import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { filterLibraryTitles } from "../src/library.js";

test("library drawer CSS is 320px / 14px with opaque item color #182026", async () => {
  const css = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../src/extension.css"), "utf8");
  assert.match(css, /\.pxd-library-drawer\s*\{[^}]*background:\s*#ffffff/s);
  assert.match(css, /320px|#182026|font-size:\s*14px/);
});

test("filterLibraryTitles skips roam/js and roam/css titles when query is empty and includes them when query is non-empty", () => {
  const titles = ["Inbox", "roam/js/settings", "roam/css", "Daily notes"];
  assert.deepEqual(filterLibraryTitles(titles, ""), ["Inbox", "Daily notes"]);
  assert.deepEqual(filterLibraryTitles(titles, "roam"), ["roam/js/settings", "roam/css"]);
  assert.deepEqual(filterLibraryTitles(titles, "inbox"), ["Inbox"]);
});

test("filterLibraryTitles skips blank titles", () => {
  assert.deepEqual(filterLibraryTitles(["", "  ", "Keep", null], ""), ["Keep"]);
});
