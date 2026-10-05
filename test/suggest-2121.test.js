import assert from "node:assert/strict";
import test from "node:test";

import { bareMention, isDailyTitle, linkMention, suggestPairs } from "../src/model/suggest.js";

test("unlinked titles and shared refs become two reasons", () => {
  const cards = [
    { uid: "A", text: "sanitation drift", pageTitle: "", refs: [] },
    { uid: "B", text: "", pageTitle: "Sanitation", refs: [] },
    { uid: "C", text: "", pageTitle: "Left", refs: ["Zone 2"] },
    { uid: "D", text: "", pageTitle: "Right", refs: ["Zone 2"] },
    { uid: "E", text: "October 5th, 2026 note", pageTitle: "October 5th, 2026", refs: [] },
  ];
  assert.equal(isDailyTitle("October 5th, 2026"), true);
  assert.equal(bareMention("see [[Sanitation]] today", "Sanitation"), false);
  const got = suggestPairs(cards, { mode: "both" });
  const reasons = got.pairs.map((pair) => pair.reason).sort();
  assert.deepEqual(reasons, ["Both reference [[Zone 2]]", "Mentions 'Sanitation' without a link"]);
  assert.equal(suggestPairs(cards, { mode: "off" }).pairs.length, 0);
  assert.equal(suggestPairs(cards, { mode: "shared" }).pairs.length, 1);
});

test("link text wraps the bare word and leaves a real link alone", () => {
  assert.equal(linkMention("sanitation drift", "Sanitation"), "[[Sanitation]] drift");
  assert.equal(linkMention("see [[Sanitation]]", "Sanitation"), null);
  assert.equal(linkMention("san", "Sanitation"), null);
});

test("300 cards finish under 150ms and 301 is too many", () => {
  const cards = [];
  for (let i = 0; i < 300; i += 1) {
    cards.push({ uid: `c${i}`, text: i === 0 ? "alpha drift" : "note", pageTitle: i === 1 ? "Alpha" : "", refs: i < 4 ? ["Zone 2"] : [] });
  }
  const start = Date.now();
  const got = suggestPairs(cards, { mode: "both" });
  const ms = Date.now() - start;
  assert.ok(ms < 150, String(ms));
  assert.equal(got.tooMany, false);
  assert.ok(got.pairs.length >= 1);
  cards.push({ uid: "extra", text: "n", refs: [] });
  assert.equal(suggestPairs(cards, { mode: "both" }).tooMany, true);
  const only = new Set(["c0", "c1"]);
  assert.equal(suggestPairs(cards, { mode: "both", only }).tooMany, false);
});
