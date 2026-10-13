import test from "node:test";
import assert from "node:assert/strict";

import { components, norm, paired, pool, rotBox, scoreFormPage, semiGlobal, tiers, wildDist, parseArgs } from "../tools/parse-bench/form-score.mjs";

// ---- synthetic fixtures (made up; nothing here comes from a real record) ----

const key = (extra = {}) => ({
  id: "t1", source: "d0.pdf p1", spec: "keyspec-v2", keyer: "final", rotation: 0, blank: false, textComplete: false,
  fields: [], tables: [], lines: [], checks: [], marks: [], figures: [], ignore: [], ...extra,
});
const field = (k, value, extra = {}) => ({ group: "free", key: k, n: 1, value, ink: "hand", type: "text", decision: false, unsure: false, ...extra });
const kcell = (r, c, text, extra = {}) => ({ r, c, rowSpan: 1, colSpan: 1, text, header: false, ink: text ? "hand" : "empty", unsure: false, ...extra });
const ktable = (rows, cols, cells, extra = {}) => ({ rows, cols, headerRows: 1, caption: "", cells, bbox: null, panel: null, ...extra });
const line = (text, kind = "body", extra = {}) => ({ text, kind, ink: "printed", unsure: false, ...extra });

const pcell = (r, c, text, extra = {}) => ({ r, c, rowSpan: 1, colSpan: 1, text, header: false, ...extra });
const doc = (blocks) => {
  const out = { pages: [{ n: 1, w: 612, h: 792 }], order: [], blocks: {}, removed: [] };
  blocks.forEach((b, i) => { const id = `b${i}`; out.blocks[id] = { id, page: 1, ...b }; out.order.push(id); });
  return out;
};
const para = (text, bbox) => ({ type: "para", text, bbox });
const ptable = (rows, cols, cells, bbox) => ({ type: "table", rows, cols, headerRows: 1, cells, bbox });

const val = (page, name) => components(page.acc)[name];

// ---- normalisation and tiers ----

test("circled digits fold to (n) before NFKC, curly quotes straighten", () => {
  assert.equal(norm("38 ①"), "38 (1)");
  assert.equal(norm("it’s “ok”"), "it's \"ok\"");
  assert.equal(norm("x", "tick"), "X");
  assert.equal(norm("√", "tick"), "✓");
});

test("question mark in the key matches one character", () => {
  assert.equal(wildDist("3?", "36"), 0);
  assert.equal(wildDist("3?", "366"), 1);
  assert.equal(semiGlobal("n/a?ar", "xxn/a2arxx"), 0);
});

test("tiers: exact, case-folded, confusable, date whitespace", () => {
  const t = tiers("Abc", "abc");
  assert.deepEqual([t.exact, t.folded], [false, true]);
  const c = tiers("B0X-5", "BOX-S");
  assert.deepEqual([c.exact, c.folded, c.conf], [false, false, true]);
  assert.equal(tiers("05 MAR 2031", "05MAR2031", { type: "date" }).exact, true);
  assert.equal(tiers("05 MAR 2031", "05MAR2031", { type: "text", ink: "hand" }).exact, false);
  assert.equal(tiers("1.5", "1,5").conf, true);
  assert.equal(tiers("1.5", "1,5").folded, false);
});

test("rotBox maps the render frame to the upright frame", () => {
  const b = rotBox([0.1, 0.2, 0.3, 0.4], 90);
  assert.deepEqual(b.map((x) => Math.round(x * 100) / 100), [0.6, 0.1, 0.8, 0.3]);
  assert.deepEqual(rotBox([0.1, 0.2, 0.3, 0.4], 0), [0.1, 0.2, 0.3, 0.4]);
});

// ---- fields ----

test("fields: inline value, label with a value cell to the right, cut at the next label", () => {
  const k = key({
    fields: [
      field("Lot", "K-77/31", { ink: "hand" }),
      field("Form", "CS-9", { group: "header", ink: "printed", type: "id" }),
      field("Rev", "B", { group: "header", ink: "printed", type: "id" }),
      field("Checked by", "RTP", { group: "review", type: "initials" }),
    ],
  });
  const d = doc([
    para("lot: k-77/31", [0.1, 0.1, 0.4, 0.15]),
    para("Form: CS-9 Rev: B", [0.1, 0.2, 0.6, 0.25]),
    ptable(1, 2, [pcell(0, 0, "Checked by:"), pcell(0, 1, "RTP")], [0.1, 0.3, 0.6, 0.35]),
  ]);
  const p = scoreFormPage(d, k);
  assert.equal(val(p, "fieldsFound"), 1);
  assert.equal(val(p, "fieldsHeader"), 1);
  assert.equal(val(p, "fieldsFree"), 1);
  assert.equal(val(p, "fieldsReview"), 1);
  assert.equal(val(p, "fields"), 1);
});

test("fields: printed fields need the exact value; hand fields fold case", () => {
  const k = key({ fields: [field("Form", "CS-9", { group: "header", ink: "printed" }), field("Lot", "ABC", { ink: "hand" })] });
  const d = doc([para("Form: cs-9", [0.1, 0.1, 0.5, 0.15]), para("Lot: abc", [0.1, 0.2, 0.5, 0.25])]);
  const p = scoreFormPage(d, k);
  assert.equal(val(p, "fieldsHeader"), 0);
  assert.equal(val(p, "fieldsFree"), 1);
  assert.equal(val(p, "fieldsHandExact"), 0);
});

test("fields: a decision field weighs 2 and header, free and review stay apart", () => {
  const k = key({ fields: [field("Lot", "A1", { decision: true }), field("Note", "zz", { group: "review" })] });
  const d = doc([para("Lot: A1", [0.1, 0.1, 0.5, 0.15]), para("Note: no", [0.1, 0.2, 0.5, 0.25])]);
  const p = scoreFormPage(d, k);
  assert.ok(Math.abs(val(p, "fields") - 2 / 3) < 1e-9);
  assert.equal(val(p, "fieldsDecision"), 1);
  assert.equal(val(p, "fieldsReview"), 0);
});

test("fields: an empty field is correct only when nothing is paired; a missing label scores wrong", () => {
  const k = key({ fields: [field("Spare", "", { ink: "empty" }), field("Lot", "A1"), field("Other", "ghost")] });
  const d = doc([para("Spare:", [0.1, 0.1, 0.3, 0.15]), para("Lot: A1", [0.1, 0.2, 0.5, 0.25])]);
  const p = scoreFormPage(d, k);
  assert.equal(val(p, "fieldsEmpty"), 1);
  assert.equal(val(p, "fieldsFound"), 0.5);
  assert.equal(val(p, "fieldsFree"), 0.5);
});

test("fields: the n-th occurrence of a label pairs in reading order", () => {
  const k = key({ fields: [field("Date", "01 JAN 2030", { type: "date", n: 1 }), field("Date", "02 JAN 2030", { type: "date", n: 2, group: "review" })] });
  const d = doc([para("Date: 01JAN2030", [0.1, 0.1, 0.5, 0.15]), para("Date: 02JAN2030", [0.1, 0.5, 0.5, 0.55])]);
  const p = scoreFormPage(d, k);
  assert.equal(val(p, "fields"), 1);
});

// ---- hand and printed cells, drop rate ----

test("hand cells: exact, case-folded, wrong and dropped are told apart; unsure leaves accuracy", () => {
  const cells = [
    kcell(0, 0, "Name", { header: true, ink: "printed" }), kcell(0, 1, "Value", { header: true, ink: "printed" }),
    kcell(1, 0, "A", { ink: "printed" }), kcell(1, 1, "Hello"),
    kcell(2, 0, "B", { ink: "printed" }), kcell(2, 1, "World"),
    kcell(3, 0, "C", { ink: "printed" }), kcell(3, 1, "Third"),
    kcell(4, 0, "D", { ink: "printed" }), kcell(4, 1, "Fourth"),
    kcell(5, 0, "E", { ink: "printed" }), kcell(5, 1, "murky", { unsure: true }),
  ];
  const k = key({ tables: [ktable(6, 2, cells)] });
  const pc = [
    pcell(0, 0, "Name"), pcell(0, 1, "Value"), pcell(1, 0, "A"), pcell(1, 1, "Hello"), pcell(2, 0, "B"), pcell(2, 1, "world"),
    pcell(3, 0, "C"), pcell(3, 1, "Thxrd"), pcell(4, 0, "D"), pcell(4, 1, ""), pcell(5, 0, "E"), pcell(5, 1, ""),
  ];
  const p = scoreFormPage(doc([ptable(6, 2, pc)]), k);
  assert.equal(val(p, "handExact"), 0.25);
  assert.equal(val(p, "handFolded"), 0.5);
  assert.ok(Math.abs(val(p, "handDrop") - 2 / 5) < 1e-9, `drop ${val(p, "handDrop")}`);
  assert.equal(val(p, "printed"), 1);
  assert.equal(val(p, "gritsTop"), 1);
  assert.ok(val(p, "gritsCon") < 1);
});

test("hand cells: confusable tier counts for initials; decision cells weigh 2", () => {
  const cells = [kcell(0, 0, "Who", { header: true, ink: "printed" }), kcell(0, 1, "Reading", { header: true, ink: "printed" }),
    kcell(1, 0, "SASZ", { type: "initials" }), kcell(1, 1, "unit one", { ink: "printed" }), kcell(2, 0, "12", { decision: true, type: "number" }), kcell(2, 1, "unit two", { ink: "printed" })];
  const k = key({ tables: [ktable(3, 2, cells)] });
  const pc = [pcell(0, 0, "Who"), pcell(0, 1, "Reading"), pcell(1, 0, "SAS2"), pcell(1, 1, "unit one"), pcell(2, 0, "13"), pcell(2, 1, "unit two")];
  const p = scoreFormPage(doc([ptable(3, 2, pc)]), k);
  assert.equal(val(p, "handConf"), 0.5);
  assert.ok(Math.abs(val(p, "hand") - 1 / 3) < 1e-9);
  assert.equal(val(p, "handDecision"), 0);
});

test("hand cells: a span-ink mark compares the concatenated cells", () => {
  const cells = [kcell(0, 0, "H", { header: true, ink: "printed" }), kcell(0, 1, "H2", { header: true, ink: "printed" }), kcell(0, 2, "H3", { header: true, ink: "printed" }),
    kcell(1, 0, "overflowing"), kcell(1, 1, ""), kcell(1, 2, "")];
  const k = key({ tables: [ktable(2, 3, cells)], marks: [{ type: "span-ink", at: { table: 0, r: 1, cols: [0, 2] }, text: "overflowing" }] });
  const pc = [pcell(0, 0, "H"), pcell(0, 1, "H2"), pcell(0, 2, "H3"), pcell(1, 0, "over"), pcell(1, 1, "flow"), pcell(1, 2, "ing")];
  const p = scoreFormPage(doc([ptable(2, 3, pc)]), k);
  assert.equal(val(p, "handExact"), 1);
});

test("a struck value read as the old text counts as a struck-read error", () => {
  const cells = [kcell(0, 0, "T", { header: true, ink: "printed" }), kcell(1, 0, "38")];
  const k = key({ tables: [ktable(2, 1, cells)], marks: [{ type: "struck-value", at: { table: 0, r: 1, c: 0 }, old: "41", new: "38", note: null }] });
  const p = scoreFormPage(doc([ptable(2, 1, [pcell(0, 0, "T"), pcell(1, 0, "41")])]), k);
  assert.deepEqual(p.acc.struckReadError, [1, 1]);
});

// ---- tables ----

test("table matching: bbox first, and an unmatched predicted table is charged", () => {
  const cells = [kcell(0, 0, "a", { header: true, ink: "printed" }), kcell(0, 1, "b", { header: true, ink: "printed" })];
  const k = key({ tables: [ktable(1, 2, cells, { bbox: [0.1, 0.1, 0.5, 0.2] })] });
  const good = ptable(1, 2, [pcell(0, 0, "a"), pcell(0, 1, "b")], [0.11, 0.1, 0.5, 0.21]);
  assert.equal(val(scoreFormPage(doc([good]), k), "gritsCon"), 1);
  const extra = ptable(1, 2, [pcell(0, 0, "zz"), pcell(0, 1, "yy")], [0.1, 0.6, 0.5, 0.7]);
  const p = scoreFormPage(doc([good, extra]), k);
  assert.ok(val(p, "gritsCon") < 1 && val(p, "gritsCon") > 0.5);
  assert.equal(val(scoreFormPage(doc([para("none", [0, 0, 0.1, 0.1])]), k), "gritsCon"), 0);
});

test("twin panels: one merged side-by-side table scores like two tables", () => {
  const panel = (index, texts) => ktable(2, 2, [
    kcell(0, 0, texts[0], { header: true, ink: "printed" }), kcell(0, 1, texts[1], { header: true, ink: "printed" }),
    kcell(1, 0, texts[2]), kcell(1, 1, texts[3]),
  ], { panel: { group: "oxygen", index, layout: "side" } });
  const k = key({ tables: [panel(0, ["Time", "O2", "10:01", "20.9"]), panel(1, ["Time2", "O2b", "10:05", "20.7"])] });
  const merged = ptable(2, 4, [pcell(0, 0, "Time"), pcell(0, 1, "O2"), pcell(0, 2, "Time2"), pcell(0, 3, "O2b"), pcell(1, 0, "10:01"), pcell(1, 1, "20.9"), pcell(1, 2, "10:05"), pcell(1, 3, "20.7")]);
  const two = [
    ptable(2, 2, [pcell(0, 0, "Time"), pcell(0, 1, "O2"), pcell(1, 0, "10:01"), pcell(1, 1, "20.9")], [0.05, 0.1, 0.45, 0.4]),
    ptable(2, 2, [pcell(0, 0, "Time2"), pcell(0, 1, "O2b"), pcell(1, 0, "10:05"), pcell(1, 1, "20.7")], [0.55, 0.1, 0.95, 0.4]),
  ];
  const a = scoreFormPage(doc([merged]), k);
  const b = scoreFormPage(doc(two), k);
  assert.equal(val(a, "gritsCon"), 1);
  assert.equal(val(a, "gritsTop"), 1);
  assert.equal(val(b, "gritsCon"), 1);
  assert.equal(val(a, "handExact"), 1);
});

test("twin panels: a stacked table drops the repeated header of the second panel", () => {
  const panel = (index, rows) => ktable(2, 2, [
    kcell(0, 0, "Time", { header: true, ink: "printed" }), kcell(0, 1, "Val", { header: true, ink: "printed" }),
    kcell(1, 0, rows[0]), kcell(1, 1, rows[1]),
  ], { panel: { group: "x", index, layout: "stack" } });
  const k = key({ tables: [panel(0, ["a1", "b1"]), panel(1, ["a2", "b2"])] });
  const stacked = ptable(3, 2, [pcell(0, 0, "Time"), pcell(0, 1, "Val"), pcell(1, 0, "a1"), pcell(1, 1, "b1"), pcell(2, 0, "a2"), pcell(2, 1, "b2")]);
  const p = scoreFormPage(doc([stacked]), k);
  assert.equal(val(p, "gritsCon"), 1);
  assert.equal(val(p, "handExact"), 1);
});

test("an outer column of row numbers is dropped before GriTS when the key has row-label marks", () => {
  const cells = [kcell(0, 0, "Item", { header: true, ink: "printed" }), kcell(1, 0, "alpha", { ink: "printed" }), kcell(2, 0, "beta", { ink: "printed" })];
  const k = key({ tables: [ktable(3, 1, cells)], marks: [{ type: "row-label", at: { table: 0, r: 1 }, text: "1" }, { type: "row-label", at: { table: 0, r: 2 }, text: "2" }] });
  const pc = [pcell(0, 0, ""), pcell(0, 1, "Item"), pcell(1, 0, "1"), pcell(1, 1, "alpha"), pcell(2, 0, "2"), pcell(2, 1, "beta")];
  const p = scoreFormPage(doc([ptable(3, 2, pc)]), k);
  assert.equal(val(p, "gritsCon"), 1);
});

// ---- checks ----

test("checks: option group in a cell, single box, and a missing glyph", () => {
  const cells = [kcell(0, 0, "Result", { header: true, ink: "printed" }), kcell(1, 0, "A REJ", { ink: "printed" })];
  const k = key({
    tables: [ktable(2, 1, cells)],
    checks: [
      { label: "", at: { table: 0, r: 1, c: 0 }, options: ["A", "REJ"], state: "selected", selected: ["A"], struck: [], via: "tick", decision: true, unsure: false },
      { label: "Sealed", state: "checked", decision: false, unsure: false },
      { label: "Clean", state: "unchecked", decision: false, unsure: false },
    ],
  });
  const d = doc([ptable(2, 1, [pcell(0, 0, "Result"), pcell(1, 0, "✓ A REJ")], [0.1, 0.1, 0.4, 0.3]), para("Sealed: ☑", [0.1, 0.5, 0.4, 0.55]), para("Clean:", [0.1, 0.6, 0.4, 0.65])]);
  const p = scoreFormPage(d, k);
  assert.equal(val(p, "checks"), 1);
  assert.equal(val(p, "checksDecision"), 1);
  const none = scoreFormPage(doc([ptable(2, 1, [pcell(0, 0, "Result"), pcell(1, 0, "A REJ")]), para("Sealed:", [0.1, 0.5, 0.4, 0.55])]), k);
  assert.ok(val(none, "checks") < 1);
});

// ---- marks ----

test("strike: the strike text must be found and nothing else may sit in the covered cells", () => {
  const cells = [kcell(0, 0, "H", { header: true, ink: "printed" }), kcell(0, 1, "H2", { header: true, ink: "printed" }), kcell(1, 0, ""), kcell(1, 1, "")];
  const k = key({ tables: [ktable(2, 2, cells)], marks: [{ type: "na-strike", at: { table: 0, rows: [1, 1], cols: [0, 1] }, text: "N/A 24JUL2025 TVF" }] });
  const good = scoreFormPage(doc([ptable(2, 2, [pcell(0, 0, "H"), pcell(0, 1, "H2"), pcell(1, 0, "N/A 24JUL"), pcell(1, 1, "2025 TVF")])]), k);
  assert.equal(val(good, "strike"), 1);
  const invented = scoreFormPage(doc([ptable(2, 2, [pcell(0, 0, "H"), pcell(0, 1, "H2"), pcell(1, 0, "N/A 24JUL2025 TVF"), pcell(1, 1, "999 777")])]), k);
  assert.equal(val(invented, "strikeFound"), 1);
  assert.equal(val(invented, "strike"), 0);
  const missed = scoreFormPage(doc([ptable(2, 2, [pcell(0, 0, "H"), pcell(0, 1, "H2")])]), k);
  assert.equal(val(missed, "strikeFound"), 0);
});

test("signature: a marker at the position scores, junk text counts against, absence is a miss", () => {
  const k = key({ marks: [{ type: "signature", at: { field: "By", n: 1 }, bbox: [0.2, 0.7, 0.5, 0.75] }], fields: [field("By", "[signature]", { group: "review", type: "signature", decision: true })] });
  const marker = scoreFormPage(doc([para("[signature]", [0.22, 0.71, 0.45, 0.74])]), k);
  assert.equal(val(marker, "sig"), 1);
  assert.equal(val(marker, "sigMarker"), 1);
  const junk = scoreFormPage(doc([para("xqz lkj", [0.22, 0.71, 0.45, 0.74])]), k);
  assert.equal(val(junk, "sigPresence"), 1);
  assert.equal(val(junk, "sig"), 0);
  const none = scoreFormPage(doc([para("elsewhere", [0.6, 0.1, 0.9, 0.15])]), k);
  assert.equal(val(none, "sigPresence"), 0);
  const stray = scoreFormPage(doc([para("[signature]", [0.22, 0.71, 0.45, 0.74]), para("[signature]", [0.6, 0.1, 0.9, 0.15])]), k);
  assert.ok(Math.abs(val(stray, "sig") - 2 / 3) < 1e-9);
});

test("footnote marks: (n) in a cell and a footnote-ref beside a row", () => {
  const cells = [kcell(0, 0, "Probe", { header: true, ink: "printed" }), kcell(0, 1, "Temp", { header: true, ink: "printed" }),
    kcell(1, 0, "North door", { ink: "printed" }), kcell(1, 1, "38 (1)"), kcell(2, 0, "South door", { ink: "printed" }), kcell(2, 1, "40")];
  const k = key({ tables: [ktable(3, 2, cells)], marks: [{ type: "footnote-ref", at: { table: 0, r: 2 }, n: 2, side: "left" }] });
  const rows = (a, b) => [pcell(0, 0, "Probe"), pcell(0, 1, "Temp"), pcell(1, 0, "North door"), pcell(1, 1, a), pcell(2, 0, b), pcell(2, 1, "40")];
  const hit = scoreFormPage(doc([ptable(3, 2, rows("38 ①", "(2) South door"))]), k);
  assert.equal(val(hit, "footnote"), 1);
  const miss = scoreFormPage(doc([ptable(3, 2, rows("38", "South door"))]), k);
  assert.equal(val(miss, "footnote"), 0);
});

// ---- lines, insertion, blank ----

test("body lines: a merged paragraph still matches; a missing line costs its length", () => {
  const k = key({ lines: [line("Check each door seal at start of shift."), line("Record any deviation immediately."), line("Confidential", "furniture")] });
  const merged = scoreFormPage(doc([para("Check each door seal at start of shift. Record any deviation immediately.", [0.1, 0.1, 0.9, 0.2])]), k);
  assert.equal(val(merged, "body"), 1);
  const half = scoreFormPage(doc([para("Check each door seal at start of shift.", [0.1, 0.1, 0.9, 0.2])]), k);
  assert.ok(val(half, "body") > 0.5 && val(half, "body") < 0.7, `body ${val(half, "body")}`);
  const typo = scoreFormPage(doc([para("Chek each door seal at start of shift.", [0.1, 0.1, 0.9, 0.2]), para("Record any deviation immediately.", [0.1, 0.3, 0.9, 0.4])]), k);
  assert.ok(val(typo, "body") > 0.95 && val(typo, "body") < 1);
});

test("insertion: unsupported text counts, furniture and logo boxes are neutral", () => {
  const k = key({ lines: [line("Door seal check"), line("Confidential", "furniture")], ignore: [{ bbox: [0, 0, 0.3, 0.1], why: "logo" }] });
  const clean = scoreFormPage(doc([para("Door seal check", [0.1, 0.2, 0.5, 0.25]), para("Confidential", [0.1, 0.95, 0.5, 0.99]), para("Brandname Inc", [0.02, 0.02, 0.2, 0.06])]), k);
  assert.equal(val(clean, "insertion"), 0);
  const junk = scoreFormPage(doc([para("Door seal check", [0.1, 0.2, 0.5, 0.25]), para("zzzzzzzz qqqqqqqq", [0.1, 0.5, 0.5, 0.55])]), k);
  assert.ok(val(junk, "insertion") > 0.5);
});

test("insertion: a repeated word is charged once the key words are used up", () => {
  const k = key({ lines: [line("alpha beta")] });
  const p = scoreFormPage(doc([para("alpha beta alpha beta", [0.1, 0.1, 0.5, 0.15])]), k);
  assert.equal(val(p, "insertion"), 0.5);
});

test("blank pages: junk text and figures are false positives; a clean page scores 1", () => {
  const blank = key({ blank: true });
  assert.equal(val(scoreFormPage(doc([]), blank), "blankClean"), 1);
  const junk = scoreFormPage(doc([para("ghost text", [0.1, 0.1, 0.5, 0.15]), { type: "figure", bbox: [0.1, 0.2, 0.3, 0.4] }]), blank);
  assert.equal(val(junk, "blankClean"), 0);
  assert.equal(val(junk, "blankChars"), 9);
  assert.equal(val(junk, "blankFigures"), 1);
});

test("show-through text is tallied apart from the page's own text", () => {
  const k = key({ lines: [line("real line")], ignore: [{ bbox: [0.1, 0.5, 0.9, 0.6], why: "show-through" }] });
  const p = scoreFormPage(doc([para("real line", [0.1, 0.1, 0.5, 0.15]), para("mirrored words", [0.2, 0.52, 0.8, 0.58])]), k);
  assert.equal(p.acc.ghostChars[0], 13);
  assert.equal(val(p, "insertion"), 0);
});

// ---- rotated page ----

test("rotated page: tables match by text, predicted boxes map to the upright frame", () => {
  const cells = [kcell(0, 0, "Alpha", { header: true, ink: "printed" }), kcell(0, 1, "Beta", { header: true, ink: "printed" }), kcell(1, 0, "one"), kcell(1, 1, "two")];
  const k = key({
    rotation: 90,
    tables: [ktable(2, 2, cells, { bbox: [0.1, 0.1, 0.9, 0.3] })],
    marks: [{ type: "signature", at: { field: "By", n: 1 }, bbox: [0.6, 0.1, 0.8, 0.2] }],
    fields: [field("By", "[signature]", { group: "review", type: "signature" })],
  });
  const d = doc([
    ptable(2, 2, [pcell(0, 0, "Alpha"), pcell(0, 1, "Beta"), pcell(1, 0, "one"), pcell(1, 1, "two")], [0.7, 0.1, 0.9, 0.9]),
    para("[signature]", [0.1, 0.2, 0.2, 0.4]),
  ]);
  const p = scoreFormPage(d, k);
  assert.equal(val(p, "gritsCon"), 1);
  assert.equal(val(p, "handExact"), 1);
  assert.equal(val(p, "sigMarker"), 1);
});

// ---- pooling, composite, paired ----

test("composite uses the synthesis weights over the components that exist", () => {
  const k = key({ fields: [field("Lot", "A1")], lines: [line("Some body line here")] });
  const p = scoreFormPage(doc([para("Lot: A1", [0.1, 0.1, 0.5, 0.15]), para("Some body line here", [0.1, 0.3, 0.5, 0.35])]), k);
  const c = components(p.acc);
  assert.equal(c.fields, 1);
  assert.equal(c.body, 1);
  assert.equal(c.composite, 1);
  assert.equal(c.hand, null);
  const pooled = components(pool([p, p]));
  assert.equal(pooled.composite, 1);
});

test("paired mode: per-component delta, bootstrap CI and Wilcoxon p", () => {
  const pages = (good) => Array.from({ length: 8 }, (_, i) => {
    const k = key({ id: `p${i}`, fields: [field("Lot", "A1"), field("Cat", "B2")] });
    const d = good ? doc([para("Lot: A1", [0.1, 0.1, 0.5, 0.15]), para(`Cat: B${i % 2 ? 2 : 2}`, [0.1, 0.2, 0.5, 0.25])]) : doc([para("Lot: A1", [0.1, 0.1, 0.5, 0.15])]);
    const p = scoreFormPage(d, k);
    p.id = `p${i}`;
    return p;
  });
  const res = paired(pages(true), pages(false), ["fields", "body"]);
  assert.equal(res.fields.n, 8);
  assert.ok(Math.abs(res.fields.mean - 0.5) < 1e-9);
  assert.ok(res.fields.lo > 0 && res.fields.p < 0.01);
  assert.equal(res.body.n, 0);
  assert.equal(res.body.p, null);
});

test("arguments: --engine needs name=dir and --pair needs two names", () => {
  assert.throws(() => parseArgs(["--keys", "k", "--engine", "nodir"]), /name=dir/);
  assert.throws(() => parseArgs(["--keys", "k", "--engine", "a=d", "--pair", "a"]), /two engine names/);
  const o = parseArgs(["--keys", "k", "--engine", "a=d", "--engine", "b=e", "--pair", "a,b", "--per-page"]);
  assert.equal(o.engines.length, 2);
  assert.equal(o.perPage, true);
});
