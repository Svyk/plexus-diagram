// Ceilings for the big-board CI bench (test/big-board-budgets.test.js). A write may only lower a number.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BIG_BUDGETS_PATH = join(dirname(fileURLToPath(import.meta.url)), "big-board-budgets.json");

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function readBigBudgets(file = BIG_BUDGETS_PATH) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("big-board budgets: not an object");
  for (const [key, value] of Object.entries(parsed)) if (!finite(value)) throw new Error(`big-board budget not a number: ${key}`);
  return parsed;
}

// Throws when any measured count is above its ceiling, or a ceiling is missing for a measured key.
export function checkBigCeilings(counts, ceilings = readBigBudgets()) {
  const over = [];
  for (const [key, value] of Object.entries(counts || {})) {
    const limit = ceilings?.[key];
    if (!finite(value) || !finite(limit) || value > limit) over.push(`${key} ${value} > ${limit}`);
  }
  if (over.length) throw new Error(`big-board budget over ceiling: ${over.join(", ")}`);
}

// Writes a key only when the new number is strictly smaller. Any raise throws first, so the file stays put.
export function lowerBigCeilings(next, file = BIG_BUDGETS_PATH) {
  const current = readBigBudgets(file);
  const draft = { ...current };
  const raises = [];
  let changed = false;
  for (const [key, value] of Object.entries(next || {})) {
    if (!finite(current[key])) throw new Error(`big-board budget unknown key: ${key}`);
    if (!finite(value)) throw new Error(`big-board budget bad value: ${key}`);
    if (value > current[key]) raises.push(`${key} ${value} > ${current[key]}`);
    else if (value < current[key]) { draft[key] = value; changed = true; }
  }
  if (raises.length) throw new Error(`big-board budget may only go down: ${raises.join(", ")}`);
  if (changed) writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  return { changed, budgets: draft };
}
