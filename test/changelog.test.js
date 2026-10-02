import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { changelogEntry } from "../src/model/changelog.js";
import { CHANGELOG_TEXT } from "../src/changelog-text.js";

const file = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

test("UI-9: the bundled changelog is the repo file, and the entry is only the running version", () => {
  assert.equal(CHANGELOG_TEXT, file);
  const entry = changelogEntry(file, "1.3.0");
  assert.match(entry, /^## 1\.3\.0 /);
  assert.match(entry, /Native parity on an enhanced board/);
  assert.equal(entry.includes("## 1.2.0"), false);
  assert.match(changelogEntry(file, "v1.2.0"), /^## 1\.2\.0 /);
  assert.equal(changelogEntry(file, "9.9.9"), "");
  assert.equal(changelogEntry("## 1.0.0\n\nOnly this.\n", "1.0.0").includes("Only this."), true);
});
