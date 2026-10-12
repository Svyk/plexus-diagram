import assert from "node:assert/strict";
import test from "node:test";

import { createParseStore, restorableByUrl } from "../src/host/parse-store.js";
import { PARSE_REV } from "../src/model/parse/index.js";
import { fillFreePages, paidPagesOnly } from "../src/model/cloud-merge.js";
import { validateParse } from "../src/model/parse-schema.js";

const PLAIN = { ocr: "none", formula: false, tables: "builtin" };

function freeDoc(n) {
  const pages = [];
  const blocks = {};
  const order = [];
  for (let p = 1; p <= n; p++) {
    pages.push({ n: p, kind: "text", w: 612, h: 792 });
    blocks[`b${p}`] = { id: `b${p}`, type: "para", text: `free ${p}`, page: p, bbox: [0, 0, 10, 10] };
    order.push(`b${p}`);
  }
  blocks.t1 = { id: "t1", type: "table", page: 2, rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "x" }], bbox: [0, 20, 10, 30], caption: "c9" };
  blocks.c9 = { id: "c9", type: "caption", page: 2, text: "Table 1", for: "t1", bbox: [0, 12, 10, 18] };
  order.splice(2, 0, "c9", "t1");
  return { schema: "pxd-parse/1", sha256: "sha", engine: "builtin", parseRev: PARSE_REV, options: { ...PLAIN }, pageCount: n, title: "Free title", pages, blocks, order };
}

function paidDoc() {
  return {
    schema: "pxd-parse/1", sha256: "sha", engine: "cloud", options: { provider: "llamaparse", tier: "agentic", region: "us", ocr: "none", formula: false, tables: "llamaparse" },
    pageCount: 2, title: null,
    pages: [{ n: 2, w: 612, h: 792 }, { n: 3, w: 612, h: 792 }],
    blocks: {
      b1: { id: "b1", type: "para", text: "paid 2", page: 2, bbox: [0, 0, 10, 10] },
      t1: { id: "t1", type: "table", page: 3, rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "paid" }], bbox: [0, 0, 10, 10] },
    },
    order: ["b1", "t1"],
  };
}

const textOf = (doc) => doc.order.map((id) => doc.blocks[id]).filter((b) => b.type === "para").map((b) => b.text);

async function storeWith(first, second) {
  let t = 0;
  const store = createParseStore({ now: () => ++t });
  await store.indexUrl("u.pdf", { sha256: "sha", pageCount: 5 });
  await store.putParse(first);
  await store.putParse(second);
  return store;
}

for (const [name, order] of [["paid first", (f, p) => [p, f]], ["free first", (f, p) => [f, p]]]) {
  test(`P4 (${name}): the paid read's pages win and the fuller free parse fills the rest`, async () => {
    const store = await storeWith(...order(freeDoc(5), paidDoc()));
    const got = await restorableByUrl(store, "u.pdf", { plainOptions: PLAIN });
    assert.equal(got.engine, "cloud");
    assert.deepEqual(got.pages.map((p) => p.n), [1, 2, 3, 4, 5]);
    assert.deepEqual(textOf(got), ["free 1", "paid 2", "free 4", "free 5"]);
    // Page 3 is the paid table, not the free one; the free table on page 2 is dropped with its page.
    const tables = got.order.map((id) => got.blocks[id]).filter((b) => b.type === "table");
    assert.deepEqual(tables.map((b) => [b.page, b.cells[0].text]), [[3, "paid"]]);
    assert.deepEqual(got.filledFrom.pages, [1, 4, 5]);
    assert.equal(got.title, "Free title");
    assert.equal(validateParse(got).ok, true);
  });
}

test("P4: a paid read that covers every page is returned alone", async () => {
  const paid = paidDoc();
  const store = await storeWith(freeDoc(3), paid);
  // The free parse has page 1 the paid one lacks; make the paid read whole by adding page 1.
  const whole = { ...paid, pages: [{ n: 1 }, ...paid.pages], blocks: { ...paid.blocks, z: { id: "z", type: "para", text: "paid 1", page: 1, bbox: [0, 0, 1, 1] } }, order: ["z", ...paid.order] };
  await store.putParse(whole);
  const got = await restorableByUrl(store, "u.pdf", { plainOptions: PLAIN });
  assert.equal(got.filledFrom, undefined);
  assert.deepEqual(textOf(got), ["paid 1", "paid 2"]);
});

test("P4: clashing free ids are renamed and their caption links follow", () => {
  const free = freeDoc(4);
  free.blocks.c9.page = 4;
  free.blocks.t1.page = 4;
  const got = fillFreePages(paidDoc(), free);
  const table = Object.values(got.blocks).find((b) => b.type === "table" && b.page === 4);
  assert.equal(table.id, "t1~f");
  assert.equal(got.blocks[table.caption].for, "t1~f");
  assert.equal(got.blocks.t1.cells[0].text, "paid");
  assert.equal(validateParse(got).ok, true);
});

test("P4: saving a filled doc keeps only the paid pages", async () => {
  const store = createParseStore({ now: () => 1 });
  const filled = fillFreePages(paidDoc(), freeDoc(5));
  await store.putParse(filled);
  const rows = await store.listParses("sha");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].doc.pages.map((p) => p.n), [2, 3]);
  assert.equal(rows[0].doc.filledFrom, undefined);
  assert.equal(rows[0].doc.pageCount, 2);
  assert.deepEqual(paidPagesOnly(paidDoc()), paidDoc());
});
