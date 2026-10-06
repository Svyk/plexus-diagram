// DOC-1. The spec tables list every accepted plexus key, and every decorated macro in src.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectKeys, missingKeys } from "../tools/spec-keys.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docPath = join(root, "docs/spec-plexus-3.0.md");
const doc = readFileSync(docPath, "utf8");

function srcText() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".js")) out.push(readFileSync(path, "utf8"));
    }
  };
  walk(join(root, "src"));
  return out.join("\n");
}

// Button claims, plus the host nodes Plexus mounts for diagram, pdf, drawing, and query.
export function decoratedMacros(src) {
  const found = new Set();
  for (const match of src.matchAll(/button\.rm-xparser-default-([a-z0-9-]+)/g)) {
    found.add(`{{[[${match[1]}]]}}`);
  }
  if (src.includes(".rm-diagram") && src.includes("[[diagram]]")) found.add("{{[[diagram]]}}");
  if (src.includes(".rm-pdf-container") && src.includes("[[pdf]]")) found.add("{{[[pdf]]}}");
  if (src.includes("{{[[excalidraw]]}}")) found.add("{{[[excalidraw]]}}");
  if (src.includes("[[query]]") && src.includes("isQueryString")) found.add("{{[[query]]}}");
  return [...found].sort();
}

test("every accepted plexus key is in a spec table", () => {
  const missing = missingKeys(doc, collectKeys());
  assert.deepEqual(missing, []);
});

test("every decorated macro string in src is in the spec", () => {
  const macros = decoratedMacros(srcText());
  assert.ok(macros.length >= 6, macros.join(", "));
  const absent = macros.filter((macro) => !doc.includes(macro));
  assert.deepEqual(absent, []);
});
