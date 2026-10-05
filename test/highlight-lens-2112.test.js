// PDF-6: a highlight colour is a lens tag. Imports the shipped helpers.
import assert from "node:assert/strict";
import test from "node:test";

import { highlightLensTag, lensBright } from "../src/model/lens.js";

const NAMES = ["yellow", "green", "blue", "pink", "purple", "orange", "red"];

test("highlight lens pink stays bright and gray is not a tag", () => {
  assert.equal(highlightLensTag("pink"), "h/pink");
  assert.equal(highlightLensTag("gray"), "");
  for (const name of NAMES) assert.equal(highlightLensTag(name), `h/${name}`);
  assert.equal(highlightLensTag("teal"), "");
  assert.equal(highlightLensTag(""), "");
  const byUid = new Map([
    ["area", ["h/pink"]],
    ["text", ["h/yellow"]],
    ["plain", []],
  ]);
  assert.deepEqual([...lensBright(byUid, "h/pink")], ["area"]);
});
