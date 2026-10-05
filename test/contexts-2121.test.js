import assert from "node:assert/strict";
import test from "node:test";

import { breadcrumb, filterRows, groupRefs, rowChunks, snippetOf } from "../src/model/contexts.js";

test("rows group by year, newest first, and the cap hides the rest", () => {
  const rows = [];
  for (let i = 0; i < 250; i += 1) {
    const year = i < 3 ? 2026 : 2024;
    rows.push({ uid: `u${String(i).padStart(3, "0")}`, time: new Date(year, 5, 15).getTime() + i, crumb: "Lab › note", snippet: "line" });
  }
  const got = groupRefs(rows);
  assert.equal(got.total, 250);
  assert.equal(got.hidden, 50);
  assert.equal(got.groups[0].year, 2026);
  assert.equal(got.groups[0].rows.length, 3);
  assert.equal(got.groups[1].year, 2024);
  assert.equal(rowChunks(got.groups.flatMap((group) => group.rows))[0].length, 25);
});

test("a breadcrumb keeps two levels and clips", () => {
  assert.equal(breadcrumb("Lab", "Parent"), "Lab › Parent");
  assert.equal(breadcrumb("Lab", "Lab"), "Lab");
  assert.equal(breadcrumb("", ""), "Untitled");
  assert.ok(breadcrumb("x".repeat(80), "y").includes("…"));
  assert.equal(snippetOf("z".repeat(240)).length, 200);
});

test("the filter matches the crumb or the snippet", () => {
  const rows = [
    { uid: "a", crumb: "Lab › Alpha", snippet: "seal" },
    { uid: "b", crumb: "Other", snippet: "zone" },
  ];
  assert.equal(filterRows(rows, "seal").length, 1);
  assert.equal(filterRows(rows, "").length, 2);
});
