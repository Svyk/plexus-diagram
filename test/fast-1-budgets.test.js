import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stressBoardTree } from "../src/model/stress-board.js";
import {
  BUDGET_KEYS,
  BUDGETS_PATH,
  SIZES,
  checkCeilings,
  lowerCeilings,
  readBudgets,
} from "../tools/live/perf-budgets.mjs";
import { boardTree40, countCards, lastTraces, measureCounts } from "./fast-1-measure.js";

function tempCopy() {
  const dir = mkdtempSync(join(tmpdir(), "fast-1-"));
  const file = join(dir, "perf-budgets.json");
  copyFileSync(BUDGETS_PATH, file);
  return { dir, file, bytes: readFileSync(file) };
}

test("the 40-card tree has 40 notes and the 300-card tree is the stress board", () => {
  assert.equal(countCards(boardTree40()), 40);
  assert.equal(countCards(stressBoardTree()), 300);
});

test("checked-in ceilings cover both boards and the 40-card open cap stays at most 20", { timeout: 120000 }, async () => {
  const budgets = readBudgets();
  for (const size of SIZES) {
    for (const key of BUDGET_KEYS) {
      assert.equal(typeof budgets[size][key], "number", `${size}.${key}`);
      assert.equal(Number.isFinite(budgets[size][key]), true, `${size}.${key}`);
    }
  }
  assert.equal(budgets["40"].dataCallsPerOpen <= 20, true, "the ratchet only lowers the open cap");
  const counts = await measureCounts();
  assert.equal(counts["40"].dataCallsPerOpen <= 20, true, JSON.stringify(lastTraces["40"]));
  try {
    checkCeilings(counts, budgets);
  } catch (error) {
    assert.fail(`${error.message}\n${JSON.stringify(lastTraces)}`);
  }
});

test("a count one above a ceiling fails", () => {
  const budgets = readBudgets();
  const counts = structuredClone(budgets);
  counts["40"].rendersSelect = budgets["40"].rendersSelect + 1;
  assert.throws(() => checkCeilings(counts, budgets), /40\.rendersSelect/);
});

test("lowerCeilings writes a strictly lower number and the file stays lower", () => {
  const { dir, file } = tempCopy();
  try {
    const before = readBudgets(file);
    const lower = before["40"].domMutationsSelect - 1;
    const result = lowerCeilings({ "40": { domMutationsSelect: lower } }, file);
    assert.equal(result.changed, true);
    const after = readBudgets(file);
    assert.equal(after["40"].domMutationsSelect, lower);
    assert.equal(after["40"].dataCallsPerOpen, before["40"].dataCallsPerOpen);
    assert.equal(after["300"].domMutationsDrag, before["300"].domMutationsDrag);
    const parked = readFileSync(file);
    const same = lowerCeilings({ "40": { domMutationsSelect: lower, rendersDrag: before["40"].rendersDrag } }, file);
    assert.equal(same.changed, false);
    assert.deepEqual(readFileSync(file), parked);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lowerCeilings throws when asked to raise any key and the file is unchanged", () => {
  const { dir, file, bytes } = tempCopy();
  try {
    const budgets = readBudgets(file);
    assert.throws(
      () => lowerCeilings({ "300": { listenersPerBoard: budgets["300"].listenersPerBoard + 1 } }, file),
      /refuses to raise/,
    );
    assert.deepEqual(readFileSync(file), bytes);
    assert.throws(
      () => lowerCeilings({
        "40": { dataCallsPerOpen: budgets["40"].dataCallsPerOpen - 1 },
        "300": { layoutReadsPerPanFrame: budgets["300"].layoutReadsPerPanFrame + 1 },
      }, file),
      /refuses to raise/,
    );
    assert.deepEqual(readFileSync(file), bytes);
    assert.equal(readBudgets(file)["40"].dataCallsPerOpen, budgets["40"].dataCallsPerOpen);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
