// Ceilings for the FAST-1 node harness. A write may only lower a number.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BUDGET_KEYS = [
  "dataCallsPerOpen",
  "rendersSelect",
  "rendersDrag",
  "rendersType",
  "domMutationsSelect",
  "domMutationsDrag",
  "domMutationsType",
  "listenersPerBoard",
  "layoutReadsPerPanFrame",
];

export const SIZES = ["40", "300"];

export const BUDGETS_PATH = join(dirname(fileURLToPath(import.meta.url)), "perf-budgets.json");

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function readBudgets(file = BUDGETS_PATH) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  for (const size of SIZES) {
    const row = parsed?.[size];
    if (!row || typeof row !== "object") throw new Error(`perf budget missing size: ${size}`);
    for (const key of BUDGET_KEYS) {
      if (!finite(row[key])) throw new Error(`perf budget missing ceiling: ${size}.${key}`);
    }
  }
  return parsed;
}

// Throws when any measured count is above its ceiling. The node test asserts that throw.
export function checkCeilings(counts, ceilings = readBudgets()) {
  const over = [];
  for (const size of SIZES) {
    for (const key of BUDGET_KEYS) {
      const value = counts?.[size]?.[key];
      const limit = ceilings?.[size]?.[key];
      if (!finite(value) || !finite(limit) || value > limit) over.push(`${size}.${key} ${value} > ${limit}`);
    }
  }
  if (over.length) throw new Error(`perf budget over ceiling: ${over.join(", ")}`);
}

// Writes a key only when the new count is strictly smaller. Any raise throws first, so the file stays put.
export function lowerCeilings(next, file = BUDGETS_PATH) {
  const current = readBudgets(file);
  const draft = structuredClone(current);
  const raises = [];
  const drops = [];
  for (const size of Object.keys(next || {})) {
    if (!SIZES.includes(size)) throw new Error(`perf budget unknown size: ${size}`);
    const row = next[size];
    if (!row || typeof row !== "object") throw new Error(`perf budget bad row: ${size}`);
    for (const key of Object.keys(row)) {
      if (!BUDGET_KEYS.includes(key)) throw new Error(`perf budget unknown key: ${size}.${key}`);
      const value = row[key];
      if (!finite(value)) throw new Error(`perf budget non-finite: ${size}.${key}`);
      const prev = draft[size][key];
      if (!finite(prev)) throw new Error(`perf budget missing ceiling: ${size}.${key}`);
      if (value > prev) raises.push(`${size}.${key} ${prev} -> ${value}`);
      else if (value < prev) drops.push({ size, key, value });
    }
  }
  if (raises.length) throw new Error(`perf budget refuses to raise: ${raises.join(", ")}`);
  if (!drops.length) return { changed: false, budgets: current };
  for (const drop of drops) draft[drop.size][drop.key] = drop.value;
  writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  return { changed: true, budgets: draft };
}
