// DOC-1. Keys normalizeItemLayout and normalizeEdge read, plus board plexus keys.
// Item and edge names come from the function bodies (p.<key>). Board names are
// the ones src reads on the board block. `fold` is not one of them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../src/model/schema.js";

const SCHEMA_URL = new URL("../src/model/schema.js", import.meta.url);

// Board block `:block/props` plexus keys read in src.
// v               src/model/board.js buildBoard (plexus.v)
// native          src/model/board.js buildBoard (plexus.native)
// bg, bgColor     src/model/board.js buildBoard background
// bgImage         src/view/board-view.js applyBackground
// lodZoom         src/view/board-view.js mapThreshold
// dock            src/view/board-view.js menuContext
// defaults        src/model/board.js buildBoard (plexus.defaults.section)
// kanban          src/view/kanban-view.js open
// highlighterTags src/view/board-view.js tagMode
const BOARD_KEYS = [
  "v",
  "native",
  "bg",
  "bgColor",
  "bgImage",
  "lodZoom",
  "dock",
  "defaults",
  "kanban",
  "highlighterTags",
];

function functionBody(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const next = source.indexOf("\nexport function ", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

// p.color and p.fromSide inside one function. Nested calls are not key names.
function propKeys(body) {
  const keys = new Set();
  for (const match of body.matchAll(/\bp\.([A-Za-z][A-Za-z0-9]*)/g)) keys.add(match[1]);
  return keys;
}

export function schemaSource(text = readFileSync(SCHEMA_URL, "utf8")) {
  return text;
}

export function collectKeys(source = schemaSource()) {
  const item = propKeys(functionBody(source, "normalizeItemLayout"));
  const edge = propKeys(functionBody(source, "normalizeEdge"));
  if (!item.has("type") || !item.has("landmark") || !item.has("size")) {
    throw new Error("normalizeItemLayout key parse missed a known key");
  }
  if (!edge.has("from") || !edge.has("via") || !edge.has("fromBlock")) {
    throw new Error("normalizeEdge key parse missed a known key");
  }
  if (SCHEMA_VERSION !== 2) throw new Error(`expected schema version 2, got ${SCHEMA_VERSION}`);
  return [...new Set([...item, ...edge, ...BOARD_KEYS])].sort();
}

// Code spans in markdown table rows. A span is one key, so `from` is not `fromSide`.
export function tableKeys(markdown) {
  const keys = new Set();
  for (const line of String(markdown).split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    for (const match of line.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)) keys.add(match[1]);
  }
  return keys;
}

export function missingKeys(markdown, keys = collectKeys()) {
  const present = tableKeys(markdown);
  return keys.filter((key) => !present.has(key));
}

function main() {
  const keys = collectKeys();
  const flag = process.argv.indexOf("--check");
  if (flag === -1) {
    for (const key of keys) console.log(key);
    return;
  }
  const path = process.argv[flag + 1];
  if (!path) {
    console.error("missing path after --check");
    process.exit(1);
  }
  const missing = missingKeys(readFileSync(path, "utf8"), keys);
  if (missing.length) {
    for (const key of missing) console.log(key);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
