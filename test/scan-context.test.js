import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { contextOf, pageOnly, runEngine } from "../tools/parse-bench/scan-corpus.mjs";

const pdf = join(dirname(fileURLToPath(import.meta.url)), "fixtures/pdf/report.pdf");

test("contextOf: 0 by default, a page count, or all", () => {
  assert.equal(contextOf(undefined), 0);
  assert.equal(contextOf(null), 0);
  assert.equal(contextOf("0"), 0);
  assert.equal(contextOf("2"), 2);
  assert.equal(contextOf("all"), "all");
  assert.throws(() => contextOf("-1"), /--context/);
  assert.throws(() => contextOf("1.5"), /--context/);
  assert.throws(() => contextOf("some"), /--context/);
});

test("pageOnly keeps one page's blocks, order, removed furniture and page entry", () => {
  const doc = {
    pages: [{ n: 1 }, { n: 2 }],
    order: ["a", "b", "c"],
    blocks: { a: { id: "a", page: 1 }, b: { id: "b", page: 2 }, c: { id: "c", page: 2 } },
    removed: [{ page: 1, text: "x" }, { page: 2, text: "y" }],
    stats: { range: [1, 2] },
  };
  const one = pageOnly(doc, 2);
  assert.deepEqual(one.order, ["b", "c"]);
  assert.deepEqual(Object.keys(one.blocks), ["b", "c"]);
  assert.deepEqual(one.removed, [{ page: 2, text: "y" }]);
  assert.deepEqual(one.pages, [{ n: 2 }]);
  assert.deepEqual(one.stats, { range: [1, 2] });
  assert.equal(doc.order.length, 3);
});

test("runEngine builtin: context 0 parses one page, context 1 and all parse more but keep only that page", async () => {
  const base = await runEngine(pdf, 2, "builtin", "/nonexistent", "python");
  const pagesOf = (d) => [...new Set(Object.values(d.blocks).map((b) => b.page))];
  assert.deepEqual(base.doc.stats.range, [2, 2]);
  const ctx = await runEngine(pdf, 2, "builtin", "/nonexistent", "python", 1);
  assert.deepEqual(ctx.doc.stats.range, [1, 3]);
  assert.deepEqual(pagesOf(ctx.doc), pagesOf(base.doc));
  assert.deepEqual(ctx.doc.pages.map((p) => p.n), [2]);
  const all = await runEngine(pdf, 3, "builtin", "/nonexistent", "python", "all");
  assert.deepEqual(all.doc.stats.range, [1, 3]);
  assert.deepEqual(pagesOf(all.doc), [3]);
  const edge = await runEngine(pdf, 3, "builtin", "/nonexistent", "python", 2);
  assert.deepEqual(edge.doc.stats.range, [1, 3]);
});
