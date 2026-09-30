import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { readCss } from "../build.mjs";

async function fixture(files) {
  const directory = await mkdtemp(resolve(tmpdir(), "plexus-css-"));
  for (const [name, content] of Object.entries(files)) {
    const target = resolve(directory, name);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return directory;
}

test("readCss returns src/extension.css unchanged when src/css is missing", async () => {
  const dir = await fixture({ "src/extension.css": "a{}\n" });
  try {
    assert.equal(await readCss(dir), "a{}\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("readCss appends src/css/*.css in sorted filename order joined with a newline", async () => {
  const dir = await fixture({
    "src/extension.css": "base{}",
    "src/css/20-b.css": "b{}",
    "src/css/10-a.css": "a{}",
    "src/css/30-c.css": "c{}",
  });
  try {
    assert.equal(await readCss(dir), "base{}\na{}\nb{}\nc{}");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("readCss ignores non-css files in src/css", async () => {
  const dir = await fixture({
    "src/extension.css": "base{}",
    "src/css/a.css": "a{}",
    "src/css/notes.txt": "nope",
    "src/css/b.css.bak": "nope",
  });
  try {
    assert.equal(await readCss(dir), "base{}\na{}");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("readCss handles an empty src/css directory", async () => {
  const dir = await fixture({ "src/extension.css": "base{}" });
  await mkdir(resolve(dir, "src/css"));
  try {
    assert.equal(await readCss(dir), "base{}");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
