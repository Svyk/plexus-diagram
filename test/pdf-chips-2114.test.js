// PDF-7: page chips sort by page and keep uid order.
import assert from "node:assert/strict";
import test from "node:test";

import { firstChipUid, highlightPill, pageChips } from "../src/model/pdf-chips.js";

const URL = "https://example.test/papers/Risk%20model.pdf";
const OTHER = "https://example.test/papers/Other.pdf";

test("pages 3 then 2 with one other url become chips 2 then 3", () => {
  const rows = [
    { url: URL, page: 3, uid: "hl-c" },
    { url: URL, page: 2, uid: "hl-a" },
    { url: OTHER, page: 1, uid: "hl-other" },
    { url: URL, page: 3, uid: "hl-d" },
    { page: 2, uid: "hl-missing" },
  ];
  const chips = pageChips(rows, URL);
  assert.deepEqual(chips.map((chip) => chip.page), [2, 3]);
  const page3 = chips.find((chip) => chip.page === 3);
  assert.deepEqual(page3.uids, ["hl-c", "hl-d"]);
  assert.equal(page3.count, 2);
  assert.equal(firstChipUid(page3), "hl-c");
  assert.equal(chips.some((chip) => chip.uids.includes("hl-other")), false);
  assert.equal(chips.some((chip) => chip.uids.includes("hl-missing")), false);
});

test("an empty url returns no chips", () => {
  const rows = [{ url: "", page: 2, uid: "hl-a" }];
  assert.deepEqual(pageChips(rows, ""), []);
});

test("highlightPill formats an integer page and rejects zero", () => {
  assert.equal(highlightPill(3), "p. 3");
  assert.equal(highlightPill(0), "");
});
