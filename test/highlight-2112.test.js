// PDF-6 / PDF-5: one #h tag rewrite and natural size from :image-size. No writes.
import assert from "node:assert/strict";
import test from "node:test";

import { HIGHLIGHT_COLORS, naturalSize, rewriteHighlightTag } from "../src/model/highlight.js";

test("seven highlight colours are yellow green blue pink purple orange red", () => {
  assert.deepEqual(HIGHLIGHT_COLORS, ["yellow", "green", "blue", "pink", "purple", "orange", "red"]);
});

test("rewrite yellow to green keeps the other words", () => {
  assert.equal(
    rewriteHighlightTag("notes before #h/yellow notes after #h/red", "green"),
    "notes before #h/green notes after #h/red",
  );
});

test("a missing highlight tag is appended with one space", () => {
  assert.equal(rewriteHighlightTag("selected passage", "yellow"), "selected passage #h/yellow");
});

test("a name outside the seven returns the string unchanged", () => {
  const tagged = "notes before #h/yellow notes after";
  assert.equal(rewriteHighlightTag(tagged, "teal"), tagged);
  assert.equal(rewriteHighlightTag("selected passage", "teal"), "selected passage");
});

test("naturalSize reads width 133 and height 47 under a url key", () => {
  assert.deepEqual(naturalSize({
    ":image-size": {
      url: { ":width": 1, ":height": 2 },
      "https://example.test/figure.png": { ":width": 133, ":height": 47 },
    },
  }), { w: 133, h: 47 });
  assert.deepEqual(naturalSize({
    "image-size": {
      url: { width: 1, height: 2 },
      "https://example.test/figure.png": { width: 133, height: 47 },
    },
  }), { w: 133, h: 47 });
});
