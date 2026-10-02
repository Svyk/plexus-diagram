import assert from "node:assert/strict";
import test from "node:test";

import { lensBright, lensCatalog, tagsForCard } from "../src/model/lens.js";

test("RG-8: a card carries tags from its block, its children, and text read from its page", () => {
  const note = { string: "hello #rg8a", content: [{ ":block/string": "also #rg8c" }, { string: "plain" }] };
  const page = { string: "[[Beta]]", content: [] };
  assert.deepEqual(tagsForCard(note), ["rg8a", "rg8c"]);
  assert.deepEqual(tagsForCard(page, "page body #rg8b\n#[[Tag Page]]"), ["rg8b", "Tag Page"]);
  assert.deepEqual(tagsForCard({ string: "((srcBLOCK1))" }, "target #rg8a"), ["rg8a"]);
  assert.deepEqual(tagsForCard({ string: "[[Beta]]" }), []);
});

test("RG-8: the lens keeps tagged cards, and focus keeps only the overlap", () => {
  const catalog = lensCatalog([
    { uid: "page", tags: ["rg8b"] },
    { uid: "block", tags: ["rg8a"] },
    { uid: "note", tags: ["rg8a", "rg8c"] },
    { uid: "plain" },
  ]);
  assert.deepEqual(catalog.tags, ["rg8b", "rg8a", "rg8c"]);
  assert.deepEqual([...lensBright(catalog.byUid, "rg8a")].sort(), ["block", "note"]);
  assert.deepEqual([...lensBright(catalog.byUid, "rg8a", new Set(["note", "page"]))], ["note"]);
  assert.deepEqual([...lensBright(catalog.byUid, "", new Set(["page"]))], ["page"]);
  assert.equal(lensBright(catalog.byUid, "", null), null);
});
