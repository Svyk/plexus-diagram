// DOC-2. Three diffs: module exports vs the 3.0 API doc, shortcut rows vs the
// README Shortcuts table, SETTING_IDS labels vs the README Settings section.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SHEET_KEYS, SHORTCUTS } from "../src/view/shortcuts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Roadmap names, plus the view file when the paint or popover lives beside the model.
export const MODULE_FILES = [
  "src/model/regions.js",
  "src/view/minimap-svg.js",
  "src/model/halo.js",
  "src/view/halo-pop.js",
  "src/model/trails.js",
  "src/model/strength.js",
  "src/view/strength-lens.js",
  "src/model/resurface.js",
  "src/view/resurface-panel.js",
  "src/model/highlighter.js",
  "src/model/status-tags.js",
  "src/model/detect.js",
  "src/model/source-chip.js",
  "src/model/pdf-pin.js",
  "src/view/pdf-pin-view.js",
  "src/model/timeline.js",
  "src/view/timeline.js",
  "src/model/landmarks.js",
  "src/model/journal.js",
  "src/model/tabs.js",
  "src/model/touch.js",
  "src/model/public-api.js",
];

const API_DOC = "docs/api-plexus-3.0.md";
const README = "README.md";

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

// `export function|const|class NAME` and `export { a, b as c }`.
export function exportedNames(source) {
  const names = [];
  const decl = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(decl)) names.push(match[1]);
  const brace = /export\s*\{([^}]+)\}/g;
  for (const match of source.matchAll(brace)) {
    for (const part of match[1].split(",")) {
      const bit = part.trim();
      if (!bit || bit.startsWith("type ")) continue;
      const sides = bit.split(/\s+as\s+/);
      const name = (sides[1] || sides[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return [...new Set(names)];
}

export function moduleExports(files = MODULE_FILES) {
  const out = [];
  for (const file of files) {
    for (const name of exportedNames(read(file))) out.push({ file, name });
  }
  return out;
}

// A hit is its own code span, or the start of a call span. A path span does not count.
export function nameMentioned(markdown, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("`" + escaped + "`|`" + escaped + "\\(").test(markdown);
}

export function missingExports(markdown = read(API_DOC), exports = moduleExports()) {
  return exports
    .filter((row) => !nameMentioned(markdown, row.name))
    .map((row) => `${row.file} ${row.name}`);
}

function section(markdown, heading) {
  const start = markdown.indexOf(`\n## ${heading}`);
  const from = start === -1 ? markdown.indexOf(`## ${heading}`) : start + 1;
  if (from < 0) return "";
  const rest = markdown.slice(from + `## ${heading}`.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

function tableRows(markdown) {
  const rows = [];
  for (const line of markdown.split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/`/g, ""));
    if (!cells.length || cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows;
}

export function shortcutRows() {
  return [...SHORTCUTS, ...SHEET_KEYS].map((row) => ({
    group: row.group,
    keys: row.keys,
    label: row.label,
  }));
}

export function missingShortcuts(markdown = read(README), rows = shortcutRows()) {
  const tables = tableRows(section(markdown, "Shortcuts"));
  const missing = [];
  for (const row of rows) {
    const hit = tables.some((cells) => cells[0] === row.group && cells[1] === row.keys && cells[2] === row.label);
    if (!hit) missing.push(`${row.group} | ${row.keys} | ${row.label}`);
  }
  return missing;
}

// Id string → panel label. speed-flags has no row; the id itself is the label to find.
export function settingLabels(source = read("src/settings.js")) {
  const block = source.match(/export const SETTING_IDS = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  if (!block) throw new Error("SETTING_IDS not found");
  const ids = new Map();
  for (const match of block[1].matchAll(/(\w+):\s*"([^"]+)"/g)) ids.set(match[1], match[2]);
  const labels = new Map();
  const rowRe = /\[SETTING_IDS\.(\w+)\]:\s*\(\)\s*=>\s*(?:switch|select|input)Row\(\s*SETTING_IDS\.\1\s*,\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of source.matchAll(rowRe)) {
    if (!ids.has(match[1])) continue;
    labels.set(ids.get(match[1]), match[2]);
  }
  return [...ids.values()].map((id) => ({ id, label: labels.get(id) || "" }));
}

export function missingSettings(markdown = read(README), rows = settingLabels()) {
  const tables = tableRows(section(markdown, "Settings"));
  const missing = [];
  for (const row of rows) {
    if (row.label) {
      const hit = tables.some((cells) => cells.some((cell) => cell === row.label));
      if (!hit) missing.push(`${row.id} ${row.label}`);
    } else if (!tables.some((cells) => cells.some((cell) => cell === row.id))) {
      missing.push(row.id);
    }
  }
  return missing;
}

export function docCounts() {
  return {
    exports: moduleExports().length,
    shortcuts: shortcutRows().length,
    settings: settingLabels().length,
  };
}

function main() {
  const exports = missingExports();
  const shortcuts = missingShortcuts();
  const settings = missingSettings();
  const check = process.argv.includes("--check");
  if (!check) {
    const counts = docCounts();
    console.log(`exports ${counts.exports}`);
    console.log(`shortcuts ${counts.shortcuts}`);
    console.log(`settings ${counts.settings}`);
  }
  for (const line of exports) console.log(`export ${line}`);
  for (const line of shortcuts) console.log(`shortcut ${line}`);
  for (const line of settings) console.log(`setting ${line}`);
  if (check && (exports.length || shortcuts.length || settings.length)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
