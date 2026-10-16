import assert from "node:assert/strict";
import test from "node:test";

import {
  PDF_TEXT_OPEN_TIP,
  boxForQuery,
  docsFromPartRows,
  editDistance1,
  pageFromTextContent,
  pdfHitOpenDetail,
  pdfTextActivate,
  rankPostingHits,
  searchPdfText,
} from "../src/model/pdf-text-search.js";

const page = (n, text, spans = []) => ({ n, text, lower: text.toLowerCase(), spans });

test("rank stops at the limit and reads a page only while a phrase can still win", () => {
  let reads = 0;
  const doc = { hash: "h", url: "https://x.test/a.pdf", pdfUid: "p", title: "T" };
  const candidates = [];
  for (let i = 0; i < 80; i += 1) {
    const text = i < 5 ? "brain age cohort" : "brain other words here";
    const page = { n: i + 1, text, spans: [] };
    Object.defineProperty(page, "lower", { get() { reads += 1; return text; }, enumerable: true });
    candidates.push({ doc, page, n: i + 1, count: 2, seq: i + 1, fuzzy: false });
  }
  const hits = rankPostingHits(candidates, { text: "brain age" }, 5);
  assert.equal(hits.length, 5);
  assert.equal(hits[0].page, 1);
  assert.equal(hits[0].exact, true);
  assert.ok(reads <= 5, `read ${reads} pages`);
  reads = 0;
  const one = rankPostingHits(candidates, { text: "brain" }, 5);
  assert.equal(one.length, 5);
  assert.equal(reads, 0);
});

test("a hit open can recompute the flash box from a pdf.js page", () => {
  const got = pageFromTextContent({
    n: 1,
    width: 100,
    height: 200,
    items: [{ str: "Brain age", transform: [1, 0, 0, 12, 10, 150], width: 40, height: 12 }],
  });
  const frac = boxForQuery(got, "brain");
  assert.ok(Array.isArray(frac) && frac.length >= 4);
  assert.ok(Math.abs(frac[0] - 0.1) < 0.001);
  assert.equal(boxForQuery({ ...got, spans: [] }, "brain"), null);
});

test("pdf.js text items become a page with a top-left flash box", () => {
  const got = pageFromTextContent({
    n: 2,
    width: 100,
    height: 200,
    items: [
      { str: "Brain", transform: [1, 0, 0, 12, 10, 150], width: 40, height: 12 },
      { str: "age", transform: [1, 0, 0, 12, 55, 150], width: 20, height: 12 },
    ],
  });
  assert.equal(got.n, 2);
  assert.equal(got.text, "Brain age");
  assert.equal(got.spans[0].str, "Brain");
  assert.ok(Math.abs(got.spans[0].frac[0] - 0.1) < 0.001);
  assert.ok(Math.abs(got.spans[0].frac[1] - ((200 - 150 - 12) / 200)) < 0.001);
});

test("phrase ranks above split words, fuzzy matches one edit, page range holds", () => {
  const docs = [{
    hash: "h1",
    url: "https://x.test/a.pdf",
    pdfUid: "pdf1",
    title: "Plasticity",
    pages: [
      page(2, "local and global plasticity", [
        { str: "local and global", frac: [0.2, 0.3, 0.4, 0.05] },
        { str: "plasticity", frac: [0.6, 0.3, 0.3, 0.05] },
      ]),
      page(4, "plasticity was local then global"),
      page(9, "unrelated methods section"),
    ],
  }];
  const phrase = searchPdfText(docs, { text: "local and global" });
  assert.equal(phrase[0].page, 2);
  assert.equal(phrase[0].exact, true);
  assert.match(phrase[0].snippet.hit, /local and global/i);
  assert.deepEqual(phrase[0].frac, [0.2, 0.3, 0.4, 0.05]);

  const fuzzy = searchPdfText(docs, { text: "plasticty" });
  assert.deepEqual(fuzzy.map((h) => h.page), [2, 4]);
  assert.equal(fuzzy[0].fuzzy, true);
  assert.deepEqual(fuzzy[0].frac, [0.6, 0.3, 0.3, 0.05]);

  const ranged = searchPdfText(docs, { text: "plasticity", pages: "p. 3-8" });
  assert.deepEqual(ranged.map((h) => h.page), [4]);
  assert.equal(editDistance1("plasticity", "plasticty"), true);
  assert.equal(editDistance1("plasticity", "method"), false);
});

test("parsed part rows become page text, and a hit opens the reader with the pin frac", () => {
  const docs = docsFromPartRows([
    { sha256: "s", url: "https://x.test/a.pdf", pdfUid: "pdf1", docTitle: "Report", page: 3, kind: "paragraph", text: "Brain age model" },
    { sha256: "s", url: "https://x.test/a.pdf", pdfUid: "pdf1", docTitle: "Report", page: 3, kind: "figure", text: "Figure 2" },
    { sha256: "s", url: "https://x.test/a.pdf", pdfUid: "pdf1", docTitle: "Report", page: 5, kind: "table", text: "N = 1240" },
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].pages.find((p) => p.n === 3).text, "Brain age model");
  const hits = searchPdfText(docs, { text: "\"brain age\"" });
  assert.equal(hits[0].page, 3);
  assert.equal(hits[0].hash, "s");
  const detail = pdfHitOpenDetail(hits[0], {
    uid: "card1",
    string: "{{pdf: https://x.test/a.pdf}}",
    target: { kind: "block", uid: "block1" },
  });
  assert.equal(detail.cardUid, "card1");
  assert.equal(detail.blockUid, "block1");
  assert.equal(detail.page, 3);
  assert.equal(pdfHitOpenDetail(hits[0], null), null);
  const off = pdfTextActivate(hits[0], {});
  assert.equal(off.action, "reader");
  assert.equal(off.blockUid, "pdf1");
  assert.equal(off.cardUid, "");
  assert.equal(off.page, 3);
  assert.equal(pdfTextActivate(hits[0], { add: true }).action, "add");
  assert.equal(PDF_TEXT_OPEN_TIP.includes("Shift+Enter"), true);
});
