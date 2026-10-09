import assert from "node:assert/strict";
import test from "node:test";

import { takeArgs } from "../tools/parse-bench/scan.mjs";

test("scan.mjs --helper-url points the bench at another /v1/ocr", () => {
  const args = takeArgs(["page.pdf", "truth.json", "--helper-url", "http://127.0.0.1:48766", "--helper-token", "tok", "--pages", "1-2"]);
  assert.equal(args.files[0], "page.pdf");
  assert.equal(args.files[1], "truth.json");
  assert.equal(args.helperUrl, "http://127.0.0.1:48766");
  assert.equal(args.helperToken, "tok");
  assert.equal(args.pages, "1-2");
  assert.equal(args.source, "vision");
  const plain = takeArgs(["page.pdf"]);
  assert.equal(plain.helperUrl, null);
  assert.equal(plain.helperToken, null);
});
