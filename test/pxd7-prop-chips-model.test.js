// PXD-7: property chip helpers (pure).
import test from "node:test";
import assert from "node:assert/strict";
import { PROP_CHIPS_CAP, PROP_VALUE_MAX, propChipsOf, readPropChips, togglePropChip } from "../src/model/prop-chips.js";

test("PXD-7 readPropChips: keeps valid unique names, drops the rest, caps at six", () => {
  assert.deepEqual(readPropChips({ chips: [" Status ", "Author", "Status", 3, "", "BT_attrDue", null] }), ["Status", "Author"]);
  assert.deepEqual(readPropChips({ chips: "Status" }), []);
  assert.deepEqual(readPropChips(null), []);
  assert.deepEqual(readPropChips({}), []);
  const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.deepEqual(readPropChips({ chips: many }), many.slice(0, PROP_CHIPS_CAP));
});

test("PXD-7 togglePropChip: adds, removes, and refuses past the cap", () => {
  assert.deepEqual(togglePropChip([], "Status"), ["Status"]);
  assert.deepEqual(togglePropChip(["Status", "Author"], "Status"), ["Author"]);
  const full = ["a", "b", "c", "d", "e", "f"];
  assert.equal(togglePropChip(full, "g"), full);
  assert.deepEqual(togglePropChip(full, "a"), ["b", "c", "d", "e", "f"]);
  const same = ["a"];
  assert.equal(togglePropChip(same, "BT_attrDue"), same);
});

const row = (attrs) => ({ attrs });

test("PXD-7 propChipsOf: names order, first attr wins, refs and tags unwrap, many tokens join", () => {
  const r = row([
    { name: "Author", value: "[[Ada Lovelace]]" },
    { name: "Status", value: "#[[In progress]] #review" },
    { name: "Status", value: "ignored" },
    { name: "Note", value: "**bold** text" },
  ]);
  assert.deepEqual(propChipsOf(r, ["Status", "Author", "Missing"]), [
    { name: "Status", text: "In progress, review" },
    { name: "Author", text: "Ada Lovelace" },
  ]);
  assert.deepEqual(propChipsOf(r, ["Note"]), [{ name: "Note", text: "bold text" }]);
});

test("PXD-7 propChipsOf: empty values and missing rows give nothing; long values are cut", () => {
  assert.deepEqual(propChipsOf(row([{ name: "Status", value: "  " }]), ["Status"]), []);
  assert.deepEqual(propChipsOf(null, ["Status"]), []);
  assert.deepEqual(propChipsOf(row([{ name: "Status", value: "x" }]), []), []);
  const [chip] = propChipsOf(row([{ name: "Status", value: "w".repeat(100) }]), ["Status"]);
  assert.equal(chip.text.length, PROP_VALUE_MAX);
  assert.ok(chip.text.endsWith("…"));
});
