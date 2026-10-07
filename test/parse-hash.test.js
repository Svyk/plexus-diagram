import assert from "node:assert/strict";
import test from "node:test";

import { canonicalOptionsJson, optionsHash, sha256Hex } from "../src/model/parse-hash.js";

test("sha256Hex matches the empty digest and accepts a Uint8Array", async () => {
  assert.equal(
    await sha256Hex(new Uint8Array()),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(await sha256Hex("abc"), await sha256Hex(new TextEncoder().encode("abc")));
});

test("optionsHash ignores key order and drops scope", async () => {
  const a = { b: 1, a: { d: 2, c: [3, 1] }, scope: { page: 4, bbox: [0, 0, 1, 1] }, ocr: "auto" };
  const b = { ocr: "auto", a: { c: [3, 1], d: 2 }, b: 1 };
  assert.equal(canonicalOptionsJson(a), canonicalOptionsJson(b));
  assert.equal(canonicalOptionsJson(a).includes("scope"), false);
  assert.equal(await optionsHash(a), await optionsHash(b));
  assert.notEqual(await optionsHash(a), await optionsHash({ ...b, formula: true }));
});
