import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseLexicon, splitJoined } from "../src/model/ocr/lexicon.js";
import { segmentToken, segmentTitle, TITLE_REV } from "../src/model/title-cap.js";
import { coverModel } from "../src/model/pdf.js";
import { fixTokens } from "../src/model/parse/ocr-lines.js";
import { PARSE_REV } from "../src/model/parse/index.js";
import { createPdfWarm } from "../src/view/pdf-warm.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const LEX = parseLexicon(gunzipSync(readFileSync(new URL("../deploy/assets/ocr/en-words.txt.gz", import.meta.url))).toString("utf8"));

const TECHNICAL = `Supplementation Traceability Recontamination Metagenomics Ultrasonication Reformulation Benchmarking
Interlaboratory Supercomputing Videoconference Pasteurization Homogenization Microbiological Epidemiological
Contamination Decontamination Sterilization Sanitization Environmental Verification Validation Qualification
Calibration Standardization Characterization Quantification Identification Bioinformatics Chromatography
Spectrophotometry Electrophoresis Immunoassay Toxicological Pharmacokinetics Gastrointestinal Cardiovascular
Neurodegenerative Immunosuppression Antimicrobial Bacteriological Mycotoxicology Cronobacteriosis Salmonellosis
Listeriosis Enterobacteriaceae Staphylococcus Thermophilic Psychrotrophic Sporulation Biofilm Disinfection
Preoperational Postoperational Nonconformance Corrective Preventive Documentation Implementation Infrastructure
Misclassification Reproducibility Repeatability Interoperability Compartmentalization Sustainability
Counterintuitive Uncharacteristic Hypersensitivity Immunocompromised Overrepresentation Underestimation
Multidisciplinary Interdisciplinary Transdisciplinary Biodegradability Biocompatibility Electrochemical
Photosynthesis Thermodynamics Hydrodynamics Microstructure Nanostructure Crystallization Polymerization
Fermentation Hydrolysis Lyophilization Reconstitution Rehydration Dehydration Bioavailability Bioequivalence`.split(/\s+/);

test("the technical regression list has 83+ words and none splits with the shipped list", () => {
  assert.ok(TECHNICAL.length >= 83, String(TECHNICAL.length));
  for (const w of TECHNICAL) {
    assert.equal(segmentToken(w, LEX), null, w);
    assert.equal(segmentTitle(w, LEX), w, w);
    assert.equal(segmentTitle(w.toUpperCase(), LEX), w.toUpperCase(), w);
  }
});

test("long non-dictionary technical words with function-word look-alikes stay whole", () => {
  for (const w of ["Hydroxymethylfurfural", "Electroencephalography", "Immunohistochemistry", "Polytetrafluoroethylene"]) {
    assert.equal(segmentToken(w, LEX), null, w);
  }
});

test("titles with real words are unchanged", () => {
  for (const t of ["Vitamin D Supplementation in Infants", "Food Traceability and Recontamination Risk"]) {
    assert.equal(coverModel({ alias: t }).title, t);
    assert.equal(coverModel({ metadataTitle: t }).title, t);
  }
});

test("a long run-together title still splits", () => {
  assert.deepEqual(segmentToken("Summaryofreportedcasesper", LEX), ["Summary", "of", "reported", "cases", "per"]);
  assert.equal(segmentTitle("Summaryofreportedcasesper", LEX), "Summary of reported cases per");
});

test("the rule: 18+ letters, 3+ pieces, a function word, other pieces 4+ letters in the list", () => {
  const tiny = new Set(["summary", "reported", "cases", "population"]);
  assert.equal(segmentToken("Summaryreportedcases", tiny), null, "no function word");
  assert.equal(segmentToken("Summaryofcases", tiny), null, "under 18 letters");
  assert.equal(segmentToken("Summaryofreportedcases", tiny)?.join(" "), "Summary of reported cases");
  assert.equal(segmentToken("Summaryofreportedxyzcases", tiny), null, "unknown piece");
  assert.equal(segmentToken("Summaryofreportedpopulation", new Set(["summary", "reported", "population", "port"]))?.length, 4);
});

test("revisions moved", () => {
  assert.equal(PARSE_REV, 16);
  assert.equal(TITLE_REV, 3);
});

test("OCR line pass keeps correct words and still splits a low-confidence run-together pair", () => {
  const toks = "Product traceability records for Cronobacter testing".split(" ");
  assert.deepEqual(fixTokens(toks, { lexicon: LEX }), toks);
  for (const w of ["Benchmarking", "Interlaboratory", "Supercomputing", "Videoconference"]) {
    assert.deepEqual(fixTokens([w], { lexicon: LEX }), [w], w);
    assert.deepEqual(fixTokens([w], { lexicon: LEX, wordConfs: [0.95] }), [w], w);
  }
  assert.deepEqual(fixTokens(["Environmentalmonitoring"], { lexicon: LEX }), ["Environmentalmonitoring"], "confident read is kept");
  assert.deepEqual(fixTokens(["Environmentalmonitoring"], { lexicon: LEX, wordConfs: [0.5] }), ["Environmental", "monitoring"]);
  const word = "Environmentalmonitoring";
  const confs = new Array(word.length).fill(0.99);
  assert.deepEqual(splitJoined(word, LEX), [word]);
  assert.deepEqual(fixTokens([word], { lexicon: LEX, confs }), [word], "all letters confident");
  confs[5] = 0.7;
  assert.deepEqual(fixTokens([word], { lexicon: LEX, confs }), ["Environmental", "monitoring"], "one doubtful letter");
});

test("OCR line pass applies the title rule to a long low-confidence run-together token", () => {
  assert.deepEqual(fixTokens(["Summaryofreportedcasesper"], { lexicon: LEX, wordConfs: [0.5] }), ["Summary", "of", "reported", "cases", "per"]);
  assert.deepEqual(fixTokens(["Summaryofreportedcasesper"], { lexicon: LEX }), ["Summaryofreportedcasesper"]);
});

function memoryStore(seed = []) {
  const map = new Map(seed.map((r) => [r.url, r]));
  return { map, async get(url) { return map.get(url) || null; }, async put(r) { map.set(r.url, r); return r; } };
}
function warmRig(store, renderFirst) {
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  stub.document.body.append(root);
  const timers = { setTimeout: (fn, ms) => Number(setTimeout(fn, ms)), clearTimeout: (id) => clearTimeout(id) };
  return createPdfWarm({ doc: stub.document, root, host: { renderBlock() {}, unmount() {} }, store, renderFirst, timers });
}

test("a busy renderer stores no title and spends no slot; no title on the page still stores an empty one", async () => {
  const url = "https://example.test/p.pdf";
  const store = memoryStore([{ url, hash: "", first: "data:image/jpeg;base64,AAAA", w: 10, h: 12, ts: 1 }]);
  const warm = warmRig(store, async () => ({ busy: true }));
  await warm.request({ uid: "c1", blockUid: "b1", url });
  assert.equal(store.map.get(url).pageTitle, undefined, "nothing stored");
  assert.equal(warm.spent(), 0);
  const warm2 = warmRig(store, async () => ({ pageCount: 1, pageTitle: "", titleLines: [] }));
  await warm2.request({ uid: "c1", blockUid: "b1", url });
  assert.equal(store.map.get(url).pageTitle, "");
  assert.equal(store.map.get(url).titleRev, TITLE_REV);
});
