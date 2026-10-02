import assert from "node:assert/strict";
import test from "node:test";

import { dueChip, parseRoamDay } from "../src/model/tasks.js";

const today = new Date(2026, 9, 2);
const child = (string) => ({ ":block/string": string });

test("parseRoamDay accepts a real daily title and rejects a bad suffix", () => {
  assert.deepEqual(parseRoamDay("October 2nd, 2026"), { y: 2026, m: 10, d: 2 });
  assert.equal(parseRoamDay("October 2th, 2026"), null);
  assert.equal(parseRoamDay("October 11st, 2026"), null);
  assert.deepEqual(parseRoamDay("October 11th, 2026"), { y: 2026, m: 10, d: 11 });
});

test("dueChip reads BT_attrDue and marks only a past day overdue", () => {
  const past = "BT_attrDue:: [[January 1st, 2020]]";
  const chip = dueChip([child("note"), child(past)], today);
  assert.equal(chip.text, "January 1st, 2020");
  assert.equal(chip.overdue, true);
  assert.equal(chip.raw, past);
  assert.equal(dueChip([child("BT_attrDue:: [[October 2nd, 2026]]")], today).overdue, false);
  assert.equal(dueChip([child("BT_attrDue:: [[October 3rd, 2026]]")], today).overdue, false);
  assert.equal(dueChip([child("BT_attrDue:: soon")], today).overdue, false);
  assert.equal(dueChip([child("BT_attrDue::")], today), null);
  assert.equal(dueChip([child("Due:: [[January 1st, 2020]]")], today), null);
});
