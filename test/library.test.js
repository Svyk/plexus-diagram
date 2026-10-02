import assert from "node:assert/strict";
import test from "node:test";

import {
  editedSince,
  isDailyTitle,
  libraryCard,
  libraryFilterActive,
  libraryKind,
  librarySelective,
  narrowLibrary,
  normalizeLibraryFilter,
  recentDailyTitles,
} from "../src/model/library.js";
import { dailyPageTitle } from "../src/model/schema.js";

const NOW = Date.parse("2026-10-01T19:00:00Z");
const DAY = 86400000;

const ROWS = [
  { uid: "p1", kind: "page", title: "Plexus Notes", edited: NOW - DAY, tags: ["TODO"], onBoard: false },
  { uid: "d1", kind: "page", title: "October 1st, 2026", edited: NOW - DAY, tags: [], onBoard: false },
  { uid: "k1", kind: "block", string: "fixture alpha", pageTitle: "Lab", edited: NOW - DAY, tags: ["TODO"], onBoard: true },
  { uid: "k2", kind: "block", string: "fixture orphan", pageTitle: "Lab", edited: NOW - 10 * DAY, tags: [], onBoard: false },
  { uid: "bd", kind: "board", title: "P1 fixture", pageTitle: "Lab", edited: NOW, tags: ["TODO"], onBoard: true },
  { uid: "old", kind: "block", string: "fixture stale", pageTitle: "Lab", tags: ["TODO"], onBoard: false },
];

const ids = (rows) => rows.map((r) => r.uid);

test("normalize keeps tag case, strips a leading hash, and floors days", () => {
  assert.deepEqual(normalizeLibraryFilter({ type: "nope", tag: "#TODO", days: 2.9, orphan: true, text: " a " }), {
    type: "all",
    tag: "TODO",
    days: 2,
    orphan: true,
    text: "a",
  });
  assert.equal(normalizeLibraryFilter({ days: -4 }).days, 0);
  assert.equal(normalizeLibraryFilter({ tag: "[[TODO]]" }).tag, "TODO");
  assert.equal(normalizeLibraryFilter({ orphan: "true" }).orphan, false);
});

test("a daily title uses the same suffix rule as dailyPageTitle", () => {
  assert.equal(isDailyTitle(dailyPageTitle(new Date(2026, 8, 1, 12))), true);
  assert.equal(isDailyTitle(dailyPageTitle(new Date(2026, 8, 11, 12))), true);
  assert.equal(isDailyTitle(dailyPageTitle(new Date(2026, 8, 23, 12))), true);
  assert.equal(isDailyTitle("September 1th, 2026"), false);
  assert.equal(isDailyTitle("September 11st, 2026"), false);
  assert.equal(isDailyTitle("Plexus Notes"), false);
  const noon = new Date(2026, 9, 1, 23, 30);
  assert.deepEqual(recentDailyTitles(3, noon), [0, 1, 2].map((i) => dailyPageTitle(new Date(2026, 9, 1 - i, 12))));
});

test("editedSince treats days 0 as off and a missing time as a miss", () => {
  assert.equal(editedSince(null, 3, NOW), false);
  assert.equal(editedSince(NOW, 0, NOW), true);
  assert.equal(editedSince(NOW - 3 * DAY, 3, NOW), false);
  assert.equal(editedSince(NOW - 3 * DAY + 1, 3, NOW), true);
});

test("each library filter is a subset of the wider row set", () => {
  const base = narrowLibrary(ROWS, { text: "fixture" }, NOW);
  assert.deepEqual(ids(base), ["k1", "k2", "bd", "old"]);
  for (const filter of [
    { text: "fixture", type: "block" },
    { text: "fixture", type: "board" },
    { text: "fixture", orphan: true },
    { text: "fixture", days: 3 },
    { text: "fixture", tag: "TODO" },
    { text: "fixture", type: "block", orphan: true, days: 3 },
  ]) {
    const got = narrowLibrary(ROWS, filter, NOW);
    assert.ok(got.length < base.length, JSON.stringify(filter));
    const have = new Set(ids(base));
    assert.ok(got.every((row) => have.has(row.uid)), JSON.stringify(filter));
  }
  assert.deepEqual(ids(narrowLibrary(ROWS, { text: "fixture", type: "block", orphan: true }, NOW)), ["k2", "old"]);
  assert.deepEqual(ids(narrowLibrary(ROWS, { text: "fixture", days: 3 }, NOW)), ["k1", "bd"]);
  assert.deepEqual(ids(narrowLibrary(ROWS, { text: "fixture", tag: "#TODO" }, NOW)), ["k1", "bd", "old"]);
});

test("daily is not a page, boards are never orphans, and tag case is exact", () => {
  assert.deepEqual(ids(narrowLibrary(ROWS, { type: "page" }, NOW)), ["p1"]);
  assert.deepEqual(narrowLibrary(ROWS, { type: "daily" }, NOW).map(libraryKind), ["daily"]);
  assert.equal(narrowLibrary([{ uid: "b", kind: "board", title: "B", onBoard: false, tags: [] }], { orphan: true }, NOW).length, 0);
  const tagged = [{ uid: "a", kind: "block", string: "x", tags: ["todo"], onBoard: false }];
  assert.equal(narrowLibrary(tagged, { tag: "TODO" }, NOW).length, 0);
  assert.equal(narrowLibrary(tagged, { tag: "#todo" }, NOW).length, 1);
  assert.deepEqual(ids(narrowLibrary([
    { uid: "a", kind: "block", string: "x", edited: NOW, tags: [] },
    { uid: "b", kind: "block", string: "x", tags: [] },
  ], { days: 1 }, NOW)), ["a"]);
});

test("libraryCard builds a page ref or a block ref", () => {
  const daily = narrowLibrary(ROWS, { type: "daily" }, NOW)[0];
  assert.deepEqual(libraryCard(daily), { string: "[[October 1st, 2026]]", text: "October 1st, 2026", kind: "daily", label: "daily" });
  assert.equal(libraryCard(ROWS[0]).string, "[[Plexus Notes]]");
  assert.equal(libraryCard(ROWS[2]).string, "((k1))");
  assert.equal(libraryCard(ROWS[2]).label, "in Lab");
  assert.equal(libraryCard(ROWS[4]).string, "((bd))");
  assert.equal(libraryCard(ROWS[4]).text, "P1 fixture");
  assert.equal(libraryCard({ kind: "block", uid: "u", string: "x".repeat(200) }).text.length, 120);
});

test("orphan-only and days-only are not selective searches", () => {
  assert.equal(libraryFilterActive({}), false);
  assert.equal(libraryFilterActive({ type: "daily" }), true);
  assert.equal(libraryFilterActive({ orphan: true }), true);
  assert.equal(librarySelective({ orphan: true }), false);
  assert.equal(librarySelective({ days: 5 }), false);
  assert.equal(librarySelective({ type: "page", days: 5 }), false);
  assert.equal(librarySelective({ type: "block" }), false);
  assert.equal(librarySelective({ type: "daily" }), true);
  assert.equal(librarySelective({ type: "board" }), true);
  assert.equal(librarySelective({ text: "a" }), true);
  assert.equal(librarySelective({ tag: "#TODO" }), true);
});
