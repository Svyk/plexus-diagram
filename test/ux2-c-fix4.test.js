// Lane C fix round 4. A pasted figure at 100% was 280×184 and the Source chip
// covered the last caption line. The height has to count every wrapped line at
// the card's real line box, then the chip, for a short caption and a long one.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { copiedPartPlan, figureCopySize } from "../src/model/pdf-pin.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// .pxd-item__string is 13px with line-height 1.4. The line box is 19px.
const LINE = Math.ceil(13 * 1.4);
const LIVE = "Figure 1. Presumptive positives per month. Peaks follow wet-clean months.";
// This crop is the live 280×184 card: two 20px lines, and the third line under the chip.
const BOX = [0, 0, 480, 170];

function sized(caption, source = true) {
  return figureCopySize({ type: "figure", bbox: BOX, caption }, { blocks: {} }, { source });
}

test("the live figure caption keeps the Source chip under every line", () => {
  const chip = sized("", true);
  const card = sized(LIVE, true);
  assert.equal(card.w, 280);
  assert.ok(card.h > 184, `live card was 184 and the chip covered the last line, got ${card.h}`);
  const lines = card.h - chip.h;
  assert.ok(lines >= 3 * LINE, `caption added ${lines}px, need at least 3 lines of ${LINE}px`);
  assert.ok(lines <= 4 * LINE, `caption added ${lines}px, which is more than 4 lines`);

  const one = sized("Fig.", true);
  const oneLines = one.h - chip.h;
  assert.ok(oneLines >= LINE && oneLines < 3 * LINE, `a one-word caption added ${oneLines}px`);

  const text = `![Figure](https://files/a.png) ${LIVE}\nSource:: ((pinuid01))`;
  const plan = copiedPartPlan({ markdown: text });
  assert.ok(plan.size.h > 184, `clipboard plan stayed at ${plan.size.h}`);
  assert.equal(plan.image, true);
  assert.equal(plan.sourceUid, "pinuid01");
});

test("a long caption grows the card by every line, chip included", () => {
  const chip = sized("", true);
  const long = "Peaks follow wet-clean months. ".repeat(12).trim();
  const card = sized(long, true);
  const lines = card.h - chip.h;
  assert.ok(lines >= 7 * LINE, `a 300-character caption added ${lines}px, need at least 7 lines`);
  assert.ok(card.h > chip.h + lines - LINE, "the chip was dropped to keep the old cap");
  const bare = figureCopySize({ type: "figure", bbox: [0, 0, 254, 127] }, null, { source: false });
  assert.equal(bare.h, 153);
});

test("the Source chip flows under the caption with no overlay", () => {
  const css = src("../src/css/source-chip.css");
  const body = css.slice(css.indexOf(".pxd-item__body:has(> .pxd-chip--source)"));
  assert.match(body, /display:\s*flex/);
  assert.match(body, /flex-direction:\s*column/);
  const chip = css.slice(css.indexOf(".pxd-item__body > .pxd-chip.pxd-chip--source"));
  assert.match(chip, /position:\s*static/);
  assert.doesNotMatch(chip, /position:\s*absolute/);
  assert.doesNotMatch(chip, /position:\s*relative/);
  assert.doesNotMatch(chip, /z-index/);
  assert.match(chip, /margin-top:\s*4px/);
  assert.doesNotMatch(chip, /margin-top:\s*auto/);
  const text = css.slice(css.indexOf(".pxd-item__body > .pxd-rs:has(~ .pxd-chip--source)"));
  assert.match(text, /flex:\s*0\s+0\s+auto/);
  assert.doesNotMatch(css, /position:\s*absolute/);
});
