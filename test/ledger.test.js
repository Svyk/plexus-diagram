import assert from "node:assert/strict";
import test from "node:test";

import { parseLedger, planCleanup, TEST_PAGES } from "../tools/live/ledger.mjs";

test("parseLedger keeps uid rows and skips torn lines", () => {
  const entries = parseLedger('{"uid":"a","why":"one"}\nnot json\n\n{"uid":"b"}\n');
  assert.deepEqual(entries.map((entry) => entry.uid), ["a", "b"]);
});

test("planCleanup deletes test-page blocks newest first and keeps the page", () => {
  const entries = [
    { uid: "page", why: "page", graph: "Svy" },
    { uid: "old", why: "card", graph: "Svy" },
    { uid: "new", why: "card", graph: "Svy" },
    { uid: "other", why: "card", graph: "Readwisenotes" },
    { uid: "gone", why: "card", graph: "Svy" },
    { uid: "daily", why: "card", graph: "Svy" },
  ];
  const pages = {
    page: { exists: true, isPage: true, page: TEST_PAGES[0] },
    old: { exists: true, isPage: false, page: TEST_PAGES[0] },
    new: { exists: true, isPage: false, page: "diagram testing" },
    gone: { exists: false },
    daily: { exists: true, isPage: false, page: "September 30th, 2026" },
  };
  const plan = planCleanup(entries, { graph: "Svy", pagesOf: (uid) => pages[uid] });
  assert.deepEqual(plan.remove, ["new", "old"]);
  assert.deepEqual(plan.skip.map((row) => row.uid), ["daily", "page"]);
  assert.deepEqual(plan.keep.map((entry) => entry.uid), ["page", "other", "daily"]);
});
