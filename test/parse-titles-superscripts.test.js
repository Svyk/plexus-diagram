// PDF titles come from the biggest page-1 type, not running headers; superscripts keep their place.
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { FIX, parseFile } from "./parse-engine-fixtures.js";
import { findPageTitle } from "../src/model/parse/title.js";
import { inlineUnlinkedRefs, lineTextWithRefs } from "../src/model/parse/blocks.js";
import { parsedDocTitle } from "../src/model/pdf.js";
import { isJunkTitleText } from "../src/model/title-cap.js";
import { toRoamMarkdown } from "../src/model/parse-to-roam-md.js";
import { planFootnotes } from "../src/model/footnotes.js";

const word = (text, x0, size = 10, extra = {}) => ({ text, x0, x1: x0 + text.length * size * 0.5, base: 100, size, sup: false, sub: false, ...extra });
const lineOf = (words) => ({ words, text: words.map((w) => w.text).join(" ") });

test("journal paper: the title is the biggest page-1 text, not the journal banner", async () => {
  const doc = await parseFile(join(FIX, "journal.pdf"));
  assert.equal(doc.pageTitle, "Novel risk assessment model of food quality and safety considering…");
  assert.equal(doc.title, doc.pageTitle);
  assert.ok(!/Science of the Total/.test(doc.title));
  assert.equal(parsedDocTitle(doc), doc.title);
});

test("official journal regulation: the stacked bold title wins over the running date", async () => {
  const doc = await parseFile(join(FIX, "regulation.pdf"));
  assert.ok(doc.title.startsWith("COMMISSION REGULATION (EC) No 2073/2005 of 15 November 2005"), doc.title);
  assert.ok(doc.title.length <= 81);
  assert.notEqual(doc.title, "22.12.2005");
  assert.equal(parsedDocTitle(doc), doc.title);
});

test("report.pdf: the page title is the h1; a metadata title wins unless it is a running header", async () => {
  const doc = await parseFile(join(FIX, "report.pdf"));
  assert.equal(doc.pageTitle, "Environmental Monitoring of a Dry-Blend Powder Line");
  assert.equal(doc.title, "Plexus parse fixture: Environmental monitoring report");
  const running = await parseFile(join(FIX, "report.pdf"), { info: { Title: "BlendHouse QA Technical Report 2026-07 · Environmental Monitoring Program review" } });
  assert.equal(running.title, "Environmental Monitoring of a Dry-Blend Powder Line");
  const junk = await parseFile(join(FIX, "report.pdf"), { info: { Title: "22.12.2005" } });
  assert.equal(junk.title, "Environmental Monitoring of a Dry-Blend Powder Line");
});

test("parsedDocTitle skips a stored title that equals a running header and old parses without pageTitle", () => {
  const doc = {
    title: "22.12.2005",
    removed: [{ page: 1, text: "22.12.2005", reason: "running-header" }],
    order: ["b1", "b2", "b3"],
    blocks: {
      b1: { id: "b1", type: "para", page: 1, text: "22.12.2005" },
      b2: { id: "b2", type: "heading", level: 1, page: 1, text: "I" },
      b3: { id: "b3", type: "para", page: 1, text: "COMMISSION REGULATION on microbiological criteria" },
    },
  };
  assert.equal(parsedDocTitle(doc), "COMMISSION REGULATION on microbiological criteria");
  assert.equal(parsedDocTitle({ ...doc, pageTitle: "Real paper title here" }), "Real paper title here");
});

test("CDC scan keeps the first OCR heading behavior (no page title from scans)", async () => {
  const doc = await parseFile(join(FIX, "cdc1980-p25.pdf"));
  assert.equal(doc.pageTitle, null);
});

test("CDC text-layer sheet: the heading above the table is the title, never the Note line", async () => {
  const doc = await parseFile(join(FIX, "cdc1980-p25.pdf"));
  const title = parsedDocTitle(doc);
  assert.ok(title.startsWith("NOTIFIABLE DISEASES"), title);
  assert.ok(!/^Note/i.test(title));
});

test("note, source and footnote lines are never titles", () => {
  for (const t of ["Note: Rates less than 0.01 after rounding are shown as 0.00.", "Notes: see text", "Source: CDC 1980", "*Not previously notifiable nationally.", "† Per 1,000 live births.", "Rates less than 0.01 after rounding"]) assert.ok(isJunkTitleText(t), t);
  for (const t of ["Notes on the Biology of Listeria", "Sources of Contamination in Powder Lines"]) assert.ok(!isJunkTitleText(t), t);
  const doc = { order: ["b1", "b2"], blocks: { b1: { id: "b1", type: "table", page: 1 }, b2: { id: "b2", type: "para", page: 1, text: "Note: Rates less than 0.01 after rounding are shown as 0.00." } } };
  assert.equal(parsedDocTitle(doc), "");
});

test("title junk filter: dates, pages, volume lines, URLs, DOIs, banners", () => {
  for (const t of ["22.12.2005", "Page 3 of 10", "March 2024", "Vol. 12 No. 3", "https://doi.org/10.1016/x", "journal homepage: www.x.com", "Contents lists available at ScienceDirect", "Science of the Total Environment 912 (2024) 169204", "L 338/1"]) assert.ok(isJunkTitleText(t), t);
  for (const t of ["Environmental Monitoring of a Dry-Blend Powder Line", "COMMISSION REGULATION (EC) No 2073/2005"]) assert.ok(!isJunkTitleText(t), t);
});

test("findPageTitle: biggest type wins, ties go to bold then higher, needs 3 words", () => {
  const big = { ...lineOf([word("A", 50, 20), word("Long", 60, 20), word("Paper", 70, 20), word("Title", 80, 20)]), size: 20, base: 120, x0: 50, x1: 200, bold: true };
  const ban = { ...lineOf([word("Journal", 50, 14), word("Of", 60, 14), word("Things", 70, 14)]), size: 14, base: 60, x0: 50, x1: 160, bold: false };
  const short = { ...lineOf([word("Hi", 50, 30)]), size: 30, base: 30, x0: 50, x1: 80, bold: true };
  assert.equal(findPageTitle([{ n: 1, free: [ban, big, short] }], { bodySize: 10 }), "A Long Paper Title");
  assert.equal(findPageTitle([{ n: 1, free: [short] }, { n: 2, free: [ban, big] }], { bodySize: 10 }), "A Long Paper Title");
  assert.equal(findPageTitle([{ n: 1, free: [big], ocr: true }], { bodySize: 10 }), "");
});

test("report.pdf: author line marks sit between the right words as plain superscripts", async () => {
  const doc = await parseFile(join(FIX, "report.pdf"));
  const author = Object.values(doc.blocks).find((b) => b.type === "para" && b.text.startsWith("S. Kleshchev"));
  assert.equal(author.text, "S. Kleshchev¹, L. Boyd¹˒² ¹Quality Assurance, BlendHouse Portland ²Food Safety Mentor Program");
  assert.equal(author.footnoteRefs, undefined);
  assert.ok(author.text.includes("BlendHouse Portland"));
});

test("report.pdf: zone mark links to the page-2 note and the unit stays cm²", async () => {
  const doc = await parseFile(join(FIX, "report.pdf"));
  const b2 = Object.values(doc.blocks).find((b) => b.type === "para" && b.text.startsWith("Dry powder facilities"));
  const at = b2.text.indexOf("whole zone") + "whole zone".length;
  assert.equal(b2.footnoteRefs.length, 1);
  assert.equal(b2.footnoteRefs[0].mark, "3");
  assert.equal(b2.footnoteRefs[0].at, at);
  const note = doc.blocks[b2.footnoteRefs[0].to];
  assert.equal(note.type, "footnote");
  assert.equal(note.page, 2);
  const sampling = Object.values(doc.blocks).find((b) => b.type === "para" && b.text.startsWith("Sites were swabbed"));
  assert.ok(sampling.text.includes("100 cm² where"));
  assert.equal(sampling.footnoteRefs, undefined);
  const md = toRoamMarkdown(doc, [b2.id], { footnoteFormat: "extension" }).markdown;
  const out = planFootnotes(md, { uid: () => "UID" }).apply(md);
  assert.equal(out.match(/#sup\^\^\[\(1\)\]\(\(\(UID\)\)\)\^\^/g).length, 1);
  assert.ok(out.includes("whole zone#sup^^[(1)](((UID)))^^. Environmental"));
});

test("two refs in one paragraph land at their own positions, never inside a word", () => {
  const doc = { blocks: { p: { id: "p", type: "para", page: 1, text: "Alpha beta gamma delta", footnoteRefs: [{ mark: "1", at: 5, to: null }, { mark: "2", at: 10, to: null }] } } };
  const md = toRoamMarkdown(doc, ["p"]).markdown;
  assert.equal(md, "- Alpha[1] beta[2] gamma delta");
  const inside = { blocks: { p: { id: "p", type: "para", page: 1, text: "Portland and more", footnoteRefs: [{ mark: "2", at: 4, to: null }] } } };
  assert.equal(toRoamMarkdown(inside, ["p"]).markdown, "- Portland[2] and more");
});

test("line text: unit and exponent scripts stay inline, 1,2 becomes ¹˒², a standing-apart mark leads the next word", () => {
  const unit = lineOf([word("100", 0), word("cm", 20), word("2", 32, 6, { sup: true }), word("where", 45)]);
  assert.deepEqual(lineTextWithRefs(unit), { text: "100 cm² where", refs: [] });
  const pow = lineOf([word("10", 0), word("5", 12, 6, { sup: true }), word("cells", 25)]);
  assert.equal(lineTextWithRefs(pow).text, "10⁵ cells");
  const run = lineOf([word("Boyd", 0), word("1,2", 22, 6, { sup: true }), word("Quality", 50)]);
  assert.equal(lineTextWithRefs(run).text, "Boyd¹˒² Quality");
  const lead = lineOf([word("Boyd", 0), word("1", 40, 6, { sup: true }), word("Quality", 48)]);
  assert.deepEqual(lineTextWithRefs(lead), { text: "Boyd Quality", refs: [{ mark: "1", at: 5 }] });
  const trail = lineOf([word("zone", 0), word("3", 21, 6, { sup: true }), word(".", 25)]);
  assert.deepEqual(lineTextWithRefs(trail), { text: "zone.", refs: [{ mark: "3", at: 4 }] });
});

test("inlineUnlinkedRefs puts unlinked marks back as superscripts and keeps linked ones aligned", () => {
  const block = { text: "One, Two three.", footnoteRefs: [{ mark: "1", at: 3, to: null }, { mark: "2", at: 14, to: "n1" }] };
  inlineUnlinkedRefs(block);
  assert.equal(block.text, "One¹, Two three.");
  assert.deepEqual(block.footnoteRefs, [{ mark: "2", at: 15, to: "n1" }]);
  const all = { text: "x", footnoteRefs: [{ mark: "1", at: 1, to: null }] };
  inlineUnlinkedRefs(all);
  assert.equal(all.text, "x¹");
  assert.equal("footnoteRefs" in all, false);
});
