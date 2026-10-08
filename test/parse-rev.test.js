import assert from "node:assert/strict";
import test from "node:test";

import { createParseStore, isStaleParse, restorableByUrl, restorableParse } from "../src/host/parse-store.js";
import { PARSE_REV, assembleDocument } from "../src/model/parse/index.js";
import { optionsHash } from "../src/model/parse-hash.js";

const PLAIN = { ocr: "none", formula: false, tables: "builtin" };

function doc(over = {}) {
  return { schema: "pxd-parse/1", sha256: "sha", engine: "builtin", options: { ...PLAIN }, pages: [{ n: 1, kind: "text" }], blocks: {}, order: [], ...over };
}

async function seeded(d) {
  const store = createParseStore({ now: () => 1 });
  await store.putParse(d);
  return store;
}

test("assembled documents carry the current parseRev", () => {
  const out = assembleDocument([], { numPages: 0, sha256: "x" });
  assert.equal(out.parseRev, PARSE_REV);
});

test("a stale built-in doc (no rev or older) is treated as absent", async () => {
  const hash = await optionsHash(PLAIN);
  for (const d of [doc(), doc({ parseRev: PARSE_REV - 1 })]) {
    const store = await seeded(d);
    assert.equal(await restorableParse(store, "sha", { engines: ["builtin"], plainHash: hash }), null);
  }
});

test("a current-rev doc is restored as is", async () => {
  const d = doc({ parseRev: PARSE_REV, title: "T" });
  const store = await seeded(d);
  const hash = await optionsHash(PLAIN);
  const got = await restorableParse(store, "sha", { engines: ["builtin"], plainHash: hash });
  assert.equal(got.title, "T");
});

test("an OCR-read doc with an old rev is kept", async () => {
  const d = doc({ options: { ...PLAIN, ocr: "vision" }, ocr: { pages: [1] }, title: "Read" });
  const store = await seeded(d);
  const hash = await optionsHash(PLAIN);
  const got = await restorableParse(store, "sha", { engines: ["builtin"], plainHash: hash });
  assert.equal(got.title, "Read");
  assert.equal(isStaleParse(d), false);
});

test("helper docs are not judged", () => {
  assert.equal(isStaleParse(doc({ engine: "docling" })), false);
});

test("restore by url re-requests a stale parse; saving the fresh one replaces the old key", async () => {
  const store = createParseStore({ now: () => 1 });
  await store.indexUrl("u.pdf", { sha256: "sha", pageCount: 1 });
  await store.putParse(doc({ options: { ...PLAIN, extra: 1 } }));
  assert.equal(await restorableByUrl(store, "u.pdf", { plainOptions: PLAIN }), null);
  assert.equal((await store.listParses("sha")).length, 1);
  await store.putParse(doc({ parseRev: PARSE_REV, title: "New" }));
  const rows = await store.listParses("sha");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doc.title, "New");
  assert.equal((await restorableByUrl(store, "u.pdf", { plainOptions: PLAIN })).title, "New");
});
