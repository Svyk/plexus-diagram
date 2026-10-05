// PDF-1: macro url, page match by url, cover label, one open reader, :pdf-settings kept.
import assert from "node:assert/strict";
import test from "node:test";

import {
  PDF_READER_H,
  PDF_READER_W,
  coverModel,
  pdfMacroUrl,
  pdfPagePlan,
  readerRule,
} from "../src/model/pdf.js";
import { mergePropsForWrite } from "../src/model/schema.js";

const URL = "https://example.test/papers/Risk%20model.pdf";
const MACRO = `{{[[pdf]]: ${URL}}}`;

test("pdfMacroUrl returns the http(s) url only when the trimmed string starts with the pdf macro", () => {
  assert.equal(pdfMacroUrl(MACRO), URL);
  assert.equal(pdfMacroUrl(` \n${MACRO} `), URL);
  assert.equal(pdfMacroUrl("{{[[pdf]]:http://example.test/a.pdf}}"), "http://example.test/a.pdf");
  assert.equal(pdfMacroUrl("{{[[pdf]]: https://example.test/a.pdf?x=1}}"), "https://example.test/a.pdf?x=1");
  assert.equal(pdfMacroUrl("{{[[pdf]]: https://example.test/a.pdf.enc?alt=media&token=x}}"), "https://example.test/a.pdf.enc?alt=media&token=x");
  assert.equal(pdfMacroUrl("{{[[pdf]]: https://example.test/dir.encyclopedia/a.pdf}}"), "https://example.test/dir.encyclopedia/a.pdf");
  assert.equal(pdfMacroUrl("see {{[[pdf]]: https://example.test/a.pdf}}"), "");
  assert.equal(pdfMacroUrl("{{[[pdf]]: ftp://example.test/a.pdf}}"), "");
  assert.equal(pdfMacroUrl("{{pdf: https://example.test/a.pdf}}"), "");
  assert.equal(pdfMacroUrl("{{[[PDF]]: https://example.test/a.pdf}}"), "");
  assert.equal(pdfMacroUrl("{{[[pdf]]:}}"), "");
  assert.equal(pdfMacroUrl(""), "");
  assert.equal(pdfMacroUrl("   "), "");
  assert.equal(pdfMacroUrl(null), "");
  assert.equal(pdfMacroUrl(undefined), "");
  assert.equal(pdfMacroUrl(9), "");
});

test("pdfPagePlan returns the row whose url equals the argument and does not match titles", () => {
  const hit = { uid: "pageUid01", title: "Risk model.pdf", url: URL };
  const titled = { uid: "pageUid02", title: URL, url: "https://example.test/other.pdf" };
  const pages = [titled, hit];
  assert.equal(pdfPagePlan(URL, pages), hit);
  assert.equal(pdfPagePlan("https://example.test/other.pdf", pages), titled);
  assert.equal(pdfPagePlan("Risk model.pdf", pages), null);
  assert.equal(pdfPagePlan(URL, [{ uid: "pageUid03", title: URL }]), null);
  assert.equal(pdfPagePlan(URL, []), null);
  assert.equal(pdfPagePlan(URL, null), null);
  assert.equal(pdfPagePlan(URL, undefined), null);
});

test("coverModel uses the page title, else the file name without .pdf, else PDF", () => {
  assert.deepEqual(coverModel({ title: "Risk model.pdf", url: URL, count: 2 }), {
    title: "Risk model.pdf",
    count: 2,
    label: "2 highlights",
  });
  assert.deepEqual(coverModel({ title: "  ", url: URL, count: 1 }), {
    title: "Risk model",
    count: 1,
    label: "1 highlight",
  });
  assert.deepEqual(coverModel({ url: "https://example.test/papers/Note.pdf?dl=1", count: 3 }), {
    title: "Note",
    count: 3,
    label: "3 highlights",
  });
  assert.deepEqual(coverModel({ url: "https://example.test/", count: 0 }), {
    title: "PDF",
    count: 0,
    label: "0 highlights",
  });
  assert.deepEqual(coverModel({}), { title: "PDF", count: 0, label: "0 highlights" });
  assert.equal(coverModel({ url: URL, count: -2 }).count, 0);
  assert.equal(coverModel({ url: URL, count: 0.4 }).label, "0 highlights");
  assert.equal(coverModel({ url: URL, count: 1 }).label, "1 highlight");
});

test("readerRule keeps the same uid open and closes the previous when another opens", () => {
  assert.deepEqual(readerRule("cardA", "cardA"), { open: "cardA", close: null });
  assert.deepEqual(readerRule("cardA", "cardB"), { open: "cardB", close: "cardA" });
  assert.deepEqual(readerRule("cardA", ""), { open: "cardA", close: null });
  assert.deepEqual(readerRule("cardA", null), { open: "cardA", close: null });
  assert.deepEqual(readerRule("cardA", undefined), { open: "cardA", close: null });
  assert.deepEqual(readerRule(null, "cardB"), { open: "cardB", close: null });
  assert.deepEqual(readerRule("", ""), { open: null, close: null });
  assert.equal(PDF_READER_W, 640);
  assert.equal(PDF_READER_H, 820);
});

test("mergePropsForWrite keeps :pdf-settings deep-equal when plexus is replaced", () => {
  const settings = {
    "user-1": {
      "current-scale": "auto",
      "current-page": 3,
      "text-selection-color": "yellow",
      "highlights-visible?": true,
    },
  };
  const props = {
    ":pdf-settings": settings,
    ":plexus": { ":x": 1, ":y": 2 },
  };
  const merged = mergePropsForWrite(props, { x: 40, y: 80, v: 2 });
  assert.deepEqual(merged["pdf-settings"], settings);
  assert.deepEqual(merged.plexus, { x: 40, y: 80, v: 2 });
  assert.deepEqual(props[":pdf-settings"], settings);
});
