import assert from "node:assert/strict";
import test from "node:test";

import {
  blockKind,
  libraryFilterActive,
  librarySelective,
  libraryKind,
  narrowLibrary,
  normalizeLibraryFilter,
  parsePageRange,
  wantsParts,
  wantsType,
} from "../src/model/library.js";
import { buildPartsIndex, finishPartsIndex, partSnippet, searchParts } from "../src/model/parts-search.js";
import { serializeRegion } from "../src/model/regions.js";
import { cpuNow } from "./fixtures/cpu-clock.js";

test("types accept a set, a legacy string, and collapse a full set to all", () => {
  assert.deepEqual(normalizeLibraryFilter({ types: ["pdf", "table", "nope", "pdf"] }).types, ["pdf", "table"]);
  assert.deepEqual(normalizeLibraryFilter({ type: "board" }).types, ["board"]);
  assert.deepEqual(normalizeLibraryFilter({ type: "all" }).types, []);
  assert.deepEqual(normalizeLibraryFilter({ types: [] }).types, []);
  const every = ["page", "block", "board", "daily", "pdf", "image", "web", "paragraph", "table", "figure", "caption", "heading", "formula", "region", "pin"];
  assert.deepEqual(normalizeLibraryFilter({ types: every }).types, []);
  assert.equal(normalizeLibraryFilter({ pages: " p. 3-8 " }).pages, "p. 3-8");
});

test("active, selective and want helpers follow the set", () => {
  assert.equal(libraryFilterActive({ types: ["pdf"] }), true);
  assert.equal(libraryFilterActive({}), false);
  assert.equal(librarySelective({ types: ["pdf"] }), true);
  assert.equal(librarySelective({ types: ["page"] }), false);
  assert.equal(librarySelective({ types: ["page"], text: "x" }), true);
  assert.equal(wantsType({}, "pin"), true);
  assert.equal(wantsType({ types: ["page"] }, "pin"), false);
  assert.equal(wantsParts({ types: ["page"] }), false);
  assert.equal(wantsParts({ types: ["page", "table"] }), true);
  assert.equal(wantsParts({}), true);
});

test("libraryKind recognises pdf, image, web, region and pin blocks", () => {
  const region = serializeRegion({ kind: "img", drawingUid: "abc123", f: [0.1, 0.1, 0.5, 0.5], caption: "x" });
  assert.equal(blockKind("{{[[pdf]]: https://x.test/a.pdf}}"), "pdf");
  assert.equal(blockKind("{{pdf: https://x.test/a.pdf}}"), "pdf");
  assert.equal(blockKind("see ![](https://x.test/a.png) here"), "image");
  assert.equal(blockKind("https://example.com/a?b=1"), "web");
  assert.equal(blockKind("[Title](https://example.com/a)"), "web");
  assert.equal(blockKind("read https://example.com/a today"), "block");
  assert.equal(blockKind("plain words"), "block");
  assert.equal(blockKind("{{[[plexus-regions]]}}"), "block");
  assert.equal(blockKind("{{[[plexus-pin]]: k=pdf d=abc123 pg=2 f=0.1,0.1,0.5,0.5}} note"), "pin");
  assert.equal(blockKind(region), "region");
  assert.equal(libraryKind({ kind: "block", string: "https://example.com" }), "web");
  assert.equal(libraryKind({ kind: "part", part: "table" }), "table");
});

test("narrowLibrary keeps only the selected kinds", () => {
  const rows = [
    { kind: "block", uid: "a", string: "plain" },
    { kind: "block", uid: "b", string: "{{[[pdf]]: https://x.test/a.pdf}}" },
    { kind: "block", uid: "c", string: "https://example.com" },
    { kind: "page", uid: "d", title: "Notes" },
  ];
  assert.deepEqual(narrowLibrary(rows, { types: ["pdf", "web"] }).map((r) => r.uid), ["b", "c"]);
  assert.deepEqual(narrowLibrary(rows, { types: ["block"] }).map((r) => r.uid), ["a"]);
  assert.deepEqual(narrowLibrary(rows, { type: "page" }).map((r) => r.uid), ["d"]);
  assert.equal(narrowLibrary(rows, {}).length, 4);
});

test("page ranges", () => {
  assert.deepEqual(parsePageRange("p. 3-8"), { from: 3, to: 8 });
  assert.deepEqual(parsePageRange("5"), { from: 5, to: 5 });
  assert.deepEqual(parsePageRange("4-"), { from: 4, to: Infinity });
  assert.deepEqual(parsePageRange("-6"), { from: 1, to: 6 });
  assert.equal(parsePageRange(""), null);
  assert.equal(parsePageRange("8-3"), null);
  assert.equal(parsePageRange("abc"), null);
});

function fixtureDoc() {
  const blocks = {
    h1: { id: "h1", type: "heading", page: 1, text: "Sanitation Program", level: 1 },
    p1: { id: "p1", type: "para", page: 1, text: "Swab the zone weekly. Swab results are logged." },
    t1: { id: "t1", type: "table", page: 4, cells: [{ text: "Zone" }, { text: "Swab limit" }, { text: "Zone 1" }, { text: "0 CFU" }] },
    c1: { id: "c1", type: "caption", page: 4, text: "Table 2 limits for swab sites", for: "t1" },
    f1: { id: "f1", type: "figure", page: 9, caption: "Figure 3 plant layout" },
    q1: { id: "q1", type: "formula", page: 9, latex: "E = mc^2" },
    s1: { id: "s1", type: "scan", page: 10 },
  };
  return { sha256: "abc", engine: "builtin", optsHash: "oh", blocks, order: Object.keys(blocks) };
}

test("parts index flattens tables, attaches captions, and skips scans", () => {
  const rows = buildPartsIndex(fixtureDoc(), { url: "https://x.test/a.pdf", docTitle: "Plan", pdfUid: "u1" });
  assert.deepEqual(rows.map((r) => r.kind), ["heading", "paragraph", "table", "caption", "figure", "formula"]);
  const table = rows.find((r) => r.kind === "table");
  assert.match(table.text, /Swab limit Zone 1 0 CFU/);
  assert.match(table.text, /Table 2 limits/);
  assert.equal(table.pdfUid, "u1");
  assert.equal(table.optsHash, "oh");
  assert.equal(rows.find((r) => r.kind === "figure").text, "Figure 3 plant layout");
});

test("search ranks by hits then reading order, filters kind and page range", () => {
  const rows = buildPartsIndex(fixtureDoc(), { docTitle: "Plan" });
  const hits = searchParts(rows, { text: "SWAB" });
  assert.equal(hits[0].kind, "paragraph");
  assert.equal(hits[0].hits, 2);
  assert.deepEqual(hits.map((r) => r.kind), ["paragraph", "table", "caption"]);
  assert.deepEqual(searchParts(rows, { text: "swab", kinds: ["table"] }).map((r) => r.kind), ["table"]);
  assert.deepEqual(searchParts(rows, { text: "swab", pages: "p. 3-8" }).map((r) => r.kind), ["table", "caption"]);
  assert.deepEqual(searchParts(rows, { kinds: ["figure", "formula"] }).map((r) => r.kind), ["figure", "formula"]);
  assert.deepEqual(searchParts(rows, { text: "nomatch" }), []);
  assert.equal(searchParts(rows, { text: "swab" }, 1).length, 1);
});

test("multi-word search needs every term, phrase rows rank first, quotes keep a phrase", () => {
  const rows = buildPartsIndex({
    blocks: {
      a: { id: "a", type: "para", page: 1, text: "Listeria criteria are microbiological in nature." },
      b: { id: "b", type: "para", page: 2, text: "Microbiological criteria listeria monocytogenes." },
      c: { id: "c", type: "para", page: 3, text: "Microbiological criteria only." },
    },
    order: ["a", "b", "c"],
  });
  const hits = searchParts(rows, { text: "microbiological criteria listeria" });
  assert.deepEqual(hits.map((r) => r.blockId), ["b", "a"]);
  assert.deepEqual(searchParts(rows, { text: "listeria  MICROBIOLOGICAL" }).map((r) => r.blockId), ["a", "b"]);
  assert.deepEqual(searchParts(rows, { text: '"criteria listeria"' }).map((r) => r.blockId), ["b"]);
  assert.deepEqual(searchParts(rows, { text: "criteria nomatch" }), []);
  const s = partSnippet(rows[0].text, "microbiological criteria listeria");
  assert.equal(s.hit.toLowerCase(), "microbiological");
});

test("snippet marks the hit", () => {
  const s = partSnippet("x ".repeat(100) + "Swab results " + "y ".repeat(100), "swab");
  assert.equal(s.hit, "Swab");
  assert.ok(s.before.startsWith("…"));
  assert.ok(s.after.endsWith("…"));
  assert.deepEqual(partSnippet("short text", ""), { before: "", hit: "", after: "short text" });
});

test("a 300-page index searches well under 50 ms", () => {
  const blocks = {};
  const order = [];
  for (let page = 1; page <= 300; page += 1) {
    for (let i = 0; i < 20; i += 1) {
      const id = `b${page}-${i}`;
      const type = i === 0 ? "heading" : i === 1 ? "table" : "para";
      blocks[id] = type === "table"
        ? { id, type, page, cells: Array.from({ length: 12 }, (_, c) => ({ text: `cell ${page} ${c} value` })) }
        : { id, type, page, text: `Page ${page} paragraph ${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor` };
      order.push(id);
    }
  }
  blocks["b150-5"].text += " needle phrase";
  const rows = buildPartsIndex({ sha256: "big", blocks, order }, { docTitle: "Big" });
  assert.equal(rows.length, 6000);
  finishPartsIndex(rows);
  const t0 = cpuNow();
  const hit = searchParts(rows, { text: "needle phrase" });
  const ms = cpuNow() - t0;
  assert.equal(hit.length, 1);
  assert.equal(hit[0].page, 150);
  const t2 = cpuNow();
  const multi = searchParts(rows, { text: "needle lorem phrase" });
  const ms3 = cpuNow() - t2;
  assert.equal(multi.length, 1);
  assert.ok(ms3 < 50, `multi-term search took ${ms3}ms`);
  const t1 = cpuNow();
  searchParts(rows, { text: "lorem", pages: "100-200" });
  const ms2 = cpuNow() - t1;
  assert.ok(ms < 50, `needle search took ${ms}ms`);
  assert.ok(ms2 < 50, `broad search took ${ms2}ms`);
});

test("a figure with no caption is still indexed, so colour search can find it", async () => {
  const { buildPartsIndex } = await import("../src/model/parts-search.js");
  const rows = buildPartsIndex({ sha256: "s", order: ["f1"], blocks: { f1: { id: "f1", type: "figure", page: 3 } } }, { url: "u", docTitle: "D" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "figure");
  assert.equal(rows[0].page, 3);
});
