import test from "node:test";
import assert from "node:assert/strict";
import { segmentToken, segmentTitle, capTitle, setTitleLexicon } from "../src/model/title-cap.js";

const lex = new Set("summary of reported cases per population notifiable diseases a i in the".split(" "));

test("run-together words split into dictionary words", () => {
  assert.equal(segmentTitle("Summaryofreportedcasesper100,000population", lex), "Summary of reported cases per 100,000 population");
  assert.deepEqual(segmentToken("Summaryofreportedcases", lex), ["Summary", "of", "reported", "cases"]);
});

test("case per letter is kept", () => {
  assert.equal(segmentTitle("SUMMARYOFREPORTEDCASES", lex), "SUMMARY OF REPORTED CASES");
});

test("ambiguous or unknown tokens are left alone", () => {
  assert.equal(segmentTitle("Summaryofreportedxyzcases", lex), "Summaryofreportedxyzcases");
  assert.equal(segmentToken("Epidemiologically", lex), null);
});

test("dictionary words, short tokens, acronyms and proper nouns are untouched", () => {
  assert.equal(segmentTitle("Notifiable Diseases", lex), "Notifiable Diseases");
  assert.equal(segmentTitle("Population", lex), "Population");
  assert.equal(segmentTitle("ByHeartBlendHousePortland", lex), "ByHeartBlendHousePortland");
  assert.equal(segmentTitle("SARS-CoV-2 100,000", lex), "SARS-CoV-2 100,000");
});

test("a single-letter piece other than a or i is refused", () => {
  assert.equal(segmentToken("populationxreportedcases", new Set([...lex, "x"])), null);
});

test("no lexicon is a no-op", () => {
  assert.equal(segmentTitle("Summaryofreportedcasesper100,000population", null), "Summaryofreportedcasesper100,000population");
  assert.equal(capTitle("Summaryofreportedcases"), "Summaryofreportedcases");
});

test("capTitle uses the supplied or set lexicon", () => {
  assert.equal(capTitle("NOTIFIABLE DISEASES — Summaryofreportedcasesper100,000population", 80, lex), "NOTIFIABLE DISEASES — Summary of reported cases per 100,000 population");
  setTitleLexicon(lex);
  try {
    assert.equal(capTitle("Summaryofreportedcases"), "Summary of reported cases");
  } finally { setTitleLexicon(null); }
  assert.equal(capTitle("Summaryofreportedcases"), "Summaryofreportedcases");
});

test("parsedDocTitle shows the segmented title once a lexicon is set", async () => {
  const { parsedDocTitle } = await import("../src/model/pdf.js");
  const doc = { title: "Summaryofreportedcasesper100,000population", blocks: {}, order: [] };
  assert.equal(parsedDocTitle(doc), "Summaryofreportedcasesper100,000population");
  setTitleLexicon(lex);
  try { assert.equal(parsedDocTitle(doc), "Summary of reported cases per 100,000 population"); } finally { setTitleLexicon(null); }
});
