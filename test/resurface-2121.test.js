import assert from "node:assert/strict";
import test from "node:test";

import { intervalLabel, matchResurface, parseIntervals } from "../src/model/resurface.js";

const DAY = 86400000;
const OCT_5 = new Date(2026, 9, 5).getTime();
const OCT_12 = new Date(2026, 9, 12).getTime();
const SEP_5 = new Date(2026, 8, 5).getTime();

test("a card made on October 5 shows under 1 week on October 12", () => {
  const rows = [
    { uid: "card", time: OCT_5 + 3600000, title: "Halo" },
    { uid: "far", time: OCT_5 - 10 * DAY, title: "Old" },
  ];
  const tabs = matchResurface(rows, OCT_12, parseIntervals(""));
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].label, "1 week ago");
  assert.deepEqual(tabs[0].items.map((item) => item.uid), ["card"]);
  assert.equal(intervalLabel(30), "1 month ago");
  assert.equal(intervalLabel(90), "3 months ago");
  assert.equal(intervalLabel(365), "1 year ago");
});

test("an older page date uses that date, and each tab keeps six", () => {
  const rows = [];
  for (let i = 0; i < 8; i += 1) rows.push({ uid: `w${i}`, time: SEP_5 - 7 * DAY + i });
  const tabs = matchResurface(rows, SEP_5, [7, 30]);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].days, 7);
  assert.equal(tabs[0].items.length, 6);
  assert.equal(matchResurface(rows, "nope", [7]).length, 0);
});
