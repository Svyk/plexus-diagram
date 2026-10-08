import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  cleanWord, correctWord, lineCase, normalizeCase, oddCase, parseLexicon, properNouns, splitJoined, suspiciousWord,
} from "../src/model/ocr/lexicon.js";
import { LEXICON_FILE } from "../src/model/ocr/manifest.js";
import { recognizeCells } from "../src/model/ocr/recognize.js";
import { applyLineReads, fixTokens, linesToReread, repairTokens, textLines } from "../src/model/parse/ocr-lines.js";
import { rereadLines } from "../src/view/parse-engine.js";
import { createDeviceOcr } from "../src/host/device-ocr.js";
import { createOcrWeb } from "../src/host/ocr-web.js";

const WORDS = parseLexicon("summary\nof\nreported\ncases\nper\npopulation\nunited\nstates\ndiseases\nnote\nrates\nless\nthan\nafter\nrounding\nare\nshown\nas\nenvironmental\nmonitoring\nlive\nbirths\nform\nfrom\n");

function item(str, x, base, { size = 6, width = null, conf = 1 } = {}) {
  const w = width ?? str.length * size * 0.5;
  return { str, transform: [size, 0, 0, size, x, base], width: w, height: size, y0: base - 0.8 * size, y1: base + 0.22 * size, fontName: "ocr", conf };
}

function lineOf(words, base, x0 = 100, opts = {}) {
  let x = x0;
  return words.map((w) => {
    const it = item(w, x, base, opts);
    x += it.width + 2;
    return it;
  });
}

function page(items, n = 1) {
  return { n, w: 600, h: 400, scan: true, engine: "ppocr-web", items, rules: [], fills: [] };
}

test("the shipped word list matches its manifest, stays under 150 KB, and holds common words", () => {
  const buf = readFileSync(new URL(`../assets/ocr/${LEXICON_FILE.file}`, import.meta.url));
  assert.equal(buf.length, LEXICON_FILE.bytes);
  assert.ok(buf.length <= 150 * 1024, `${buf.length} bytes`);
  assert.equal(createHash("sha256").update(buf).digest("hex"), LEXICON_FILE.sha256);
  const set = parseLexicon(gunzipSync(buf).toString("utf8"));
  assert.ok(set.size > 30000, `${set.size} words`);
  for (const w of ["reported", "population", "united", "states", "summary", "cases", "diseases", "calculation"]) assert.ok(set.has(w), w);
});

test("odd case inside a word is normalised to the line's case; CamelCase names stay", () => {
  assert.equal(oddCase("NOtiFIABLE"), true);
  assert.equal(oddCase("DISEASeS"), true);
  assert.equal(oddCase("Summary"), false);
  assert.equal(oddCase("BlendHouse"), false);
  assert.equal(lineCase(["NOTiFIABlE", "DISEASES", "-", "SUMMARY"]), "upper");
  assert.equal(lineCase(["Note:", "Rates", "LESS"]), "mixed");
  assert.equal(normalizeCase("NOtiFIABLE", "upper"), "NOTIFIABLE");
  assert.equal(normalizeCase("NOtiFIABLE", "mixed"), "NOTIFIABLE");
  assert.equal(normalizeCase("populAtion", "mixed"), "population");
  assert.equal(normalizeCase("BlendHouse", "upper"), "BlendHouse");
});

test("a non-dictionary word is corrected only through low-confidence confusable letters, and only when unambiguous", () => {
  const low = (word, at) => [...word].map((_, i) => (at.includes(i) ? 0.6 : 0.99));
  assert.equal(correctWord("populetion,", { lexicon: WORDS, confs: low("populetion", [5]) }), "population,");
  assert.equal(correctWord("reparted", { lexicon: WORDS, confs: low("reparted", [3]) }), "reported");
  // The confusable letter was read with confidence: left alone.
  assert.equal(correctWord("reparted", { lexicon: WORDS, confs: low("reparted", []) }), "reparted");
  // Without letter confidences a word needs a low conf of its own and gets one swap.
  assert.equal(correctWord("Rotes", { lexicon: WORDS, conf: 0.5 }), "Rates");
  assert.equal(correctWord("Rotes", { lexicon: WORDS, conf: 1 }), "Rotes");
  // Case of the original survives the fix.
  assert.equal(correctWord("UNITMD", { lexicon: WORDS, confs: low("UNITMD", [4]) }), "UNITED");
  // Numbers, mixed alphanumerics, dictionary words and kept proper nouns are never touched.
  assert.equal(correctWord("1,000", { lexicon: WORDS, conf: 0 }), "1,000");
  assert.equal(correctWord("O.00.", { lexicon: WORDS, conf: 0 }), "O.00.");
  assert.equal(correctWord("form", { lexicon: WORDS, conf: 0 }), "form");
  assert.equal(correctWord("Smeth", { lexicon: parseLexicon("smith\nsmeeth\n"), conf: 0, keep: new Set(["smeth"]) }), "Smeth");
  // Two dictionary words within reach: ambiguous, unchanged.
  assert.equal(correctWord("fram", { lexicon: parseLexicon("from\nfrom\nfrem\n"), conf: 0 }), "fram");
  assert.equal(correctWord("populetion", { lexicon: null, conf: 0 }), "populetion");
});

test("suspicious words: odd case, digits in letters, punctuation inside letters, not in the list; footnote marks pass", () => {
  assert.equal(suspiciousWord("NOtiFIABLE"), true);
  assert.equal(suspiciousWord("1,000live"), true);
  assert.equal(suspiciousWord("O.00."), true);
  assert.equal(suspiciousWord("(EM)programs", { lexicon: WORDS }), true);
  assert.equal(suspiciousWord("Kleshchev1,", {}), false);
  assert.equal(suspiciousWord("1Quality", {}), false);
  assert.equal(suspiciousWord("celculation.", { lexicon: WORDS }), true);
  assert.equal(suspiciousWord("cases,", { lexicon: WORDS }), false);
  assert.equal(suspiciousWord("1,000", { lexicon: WORDS }), false);
  assert.equal(suspiciousWord("Iymph", { lexicon: WORDS, keep: new Set(["iymph"]) }), false);
  assert.equal(cleanWord("States,", WORDS), true);
  assert.equal(cleanWord("of", WORDS), false);
});

test("a run-together pair splits only where exactly one cut gives two listed words", () => {
  assert.deepEqual(splitJoined("Environmentalmonitoring", WORDS, { low: true }), ["Environmental", "monitoring"]);
  assert.deepEqual(splitJoined("environmental", WORDS, { low: true }), ["environmental"]);
  assert.deepEqual(splitJoined("1,000live", WORDS, { low: true }), ["1,000live"]);
  assert.deepEqual(properNouns(["Kleshchev", "Kleshchev,", "BlendHouse", "BlendHouse", "Boyd"]).has("kleshchev"), true);
  assert.deepEqual(properNouns(["BlendHouse", "BlendHouse"]).has("blendhouse"), true);
  assert.deepEqual(properNouns(["Boyd"]).has("boyd"), false);
});

test("text lines skip table words and rotated words, split columns, and clip clear of their neighbours", () => {
  const title = lineOf(["NOTiFIABlE", "DISEASeS", "Summary"], 15);
  const cell = item("Amebiasis", 110, 40);
  const rotated = { ...item("DISEASES", 580, 300), width: 10, y0: 250, y1: 320 };
  const left = lineOf(["Note:", "Rates"], 342);
  const right = lineOf(["Per", "live"], 342, 500);
  const next = lineOf(["Population", "data"], 347.5);
  const p = page([...title, cell, rotated, ...left, ...right, ...next]);
  const lines = textLines(p, [[100, 20, 570, 334]]);
  const texts = lines.map((l) => l.idx.map((i) => p.items[i].str).join(" "));
  assert.deepEqual(texts.sort(), ["NOTiFIABlE DISEASeS Summary", "Note: Rates", "Per live", "Population data"].sort());
  const note = lines.find((l) => p.items[l.idx[0]].str === "Note:");
  assert.ok(note.bbox[3] <= 347.5 - 0.72 * 6 + 1e-6, `clipped bottom ${note.bbox[3]}`);
  assert.ok(note.bbox[1] >= 334, "clipped below the table");
});

test("only doubtful lines of in-browser pages are asked for; Vision pages and clean lines are not", () => {
  const clean = lineOf(["Summary", "of", "cases"], 20);
  const odd = lineOf(["NOTiFIABlE", "DISEASES"], 40);
  const lowConf = lineOf(["rates", "less"], 60, 100, { conf: 0.5 });
  const unknown = lineOf(["populetion", "cases"], 80);
  const p = page([...clean, ...odd, ...lowConf, ...unknown]);
  const doc = { blocks: {}, order: [] };
  const reqs = linesToReread(doc, [p], { lexicon: WORDS });
  assert.deepEqual(reqs.map((r) => r.key), ["1:3,4", "1:5,6", "1:7,8"]);
  assert.ok(reqs.every((r) => r.line === true && r.page === 1 && r.bbox.length === 4));
  assert.equal(linesToReread(doc, [p], {}).length, 2, "without the list only case and confidence count");
  assert.deepEqual(linesToReread(doc, [{ ...p, engine: undefined }], { lexicon: WORDS }), []);
  const long = lineOf(Array.from({ length: 40 }, () => "populetion"), 100);
  const split = linesToReread(doc, [page(long)], { lexicon: WORDS });
  assert.ok(split.length >= 2, "a long line goes in pieces");
});

test("a re-read replaces a line only when it leaves fewer suspicious words, and keeps dashes and numbers", () => {
  const old = lineOf(["NOTiFIABlE", "DISEASeS", "-", "Summary", "of", "reported", "cases", "per", "100,000", "populetion,", "Unitmd", "States,", "1980"], 15);
  old[2].width = 6.2;
  const p = page([...old, item("Amebiasis", 110, 40)]);
  const reqs = [{ page: 1, bbox: [0, 0, 1, 1], line: true, key: `1:${old.map((_, i) => i).join(",")}` }];
  const read = (text, conf = 0.95) => ({ text, conf, confs: [...text].map((ch) => (ch === " " ? 1 : 0.95)) });
  const results = [{
    ...read("NOTIFIABLE DISEASES Summary of reparted cases per 100,000 population, United States, 1971-1980"),
    reads: [
      read("NOTIFIABLE DISEASES - Summary of reparted cases per 100,000 population, United States, 1971-1980", 0.94),
      { ...read("NOTIFIABLE DISEASES Summary of reported cases per 100,000 population, Unitnd States, 1971-1980"), conf: 0.96 },
      read("NOTIFIABLE DISEASES Summary of reparted cases per 100,000 population, United States, 1971-1980", 0.97),
    ],
  }];
  const out = applyLineReads([p], reqs, results, { lexicon: WORDS });
  assert.equal(out.applied.length, 1);
  const text = out.pages[0].items.map((it) => it.str).join(" ");
  assert.equal(text, "NOTIFIABLE DISEASES — Summary of reported cases per 100,000 population, United States, 1971-1980 Amebiasis");
  assert.notEqual(out.pages[0], p, "the input page is not mutated");
  assert.equal(p.items[0].str, "NOTiFIABlE");
  assert.equal(out.pages[0].items.at(-1).str, "Amebiasis", "words outside the line are kept");

  // A worse read (garbage) is refused; the case fix and the dash glyph (an em wide) still land.
  const worse = applyLineReads([p], reqs, [{ reads: [read("No a an .", 0.43), read("NOTIFIABLE DISEASES Sumary", 0.9)] }], { lexicon: WORDS });
  assert.equal(worse.pages[0].items.slice(0, 4).map((it) => it.str).join(" "), "NOTIFIABLE DISEASES — Summary");
  // No answer at all (the source had no cached models): only the case fix.
  const none = applyLineReads([p], reqs, [], { lexicon: WORDS });
  assert.equal(none.pages[0].items[1].str, "DISEASES");
});

test("a re-read that drops a dictionary word gets it back when it misread it by one letter", () => {
  const old = lineOf(["Note:", "Aates", "less", "than", "0.01", "after", "rounding", "are", "sth", "Dwn", "as", "O.00."], 342);
  old[5] = { ...old[5], transform: [6, 0, 0, 6, old[5].transform[4], 339.6] };
  const p = page(old);
  const reqs = [{ page: 1, bbox: [0, 0, 1, 1], line: true, key: `1:${old.map((_, i) => i).join(",")}` }];
  const text = "Not: Rates less than 0.01 after rounding are sh wn as 0.00.";
  const out = applyLineReads([p], reqs, [{ reads: [{ text, conf: 0.9, confs: [...text].map(() => 0.95) }] }], { lexicon: WORDS });
  const items = out.pages[0].items;
  assert.equal(items.map((it) => it.str).join(" "), "Note: Rates less than 0.01 after rounding are sh wn as 0.00.");
  assert.equal(new Set(items.map((it) => it.transform[5])).size, 1, "one line, one baseline");
});

test("repairTokens takes a clean close word from another scale", () => {
  assert.deepEqual(repairTokens(["of", "reparted", "cases"], [["of", "reported", "cases"]], { lexicon: WORDS }), ["of", "reported", "cases"]);
  assert.deepEqual(repairTokens(["of", "reparted"], [["of", "xyzzyq"]], { lexicon: WORDS }), ["of", "reparted"]);
  assert.deepEqual(fixTokens(["Environmentalmonitoring", "(EM)"], { lexicon: WORDS, wordConfs: [0.5, 1] }), ["Environmental", "monitoring", "(EM)"]);
});

test("line reads crop at 1x, 2x and 3x and return each read with letter confidences", async () => {
  const width = 200;
  const height = 60;
  const rgb = new Uint8Array(width * height * 3).fill(255);
  const dims = [];
  const dict = ["A", "b"];
  const runRec = async (_data, d) => {
    dims.push(d);
    const classes = 4;
    const frames = [1, 0, 3, 2];
    const logits = new Float32Array(frames.length * classes);
    frames.forEach((c, t) => { logits[t * classes + c] = 0.9; });
    return { logits, time: frames.length, classes };
  };
  const pages = new Map([[1, { rgb, width, height, dpi: 72 }]]);
  const got = await recognizeCells({ pages, cells: [{ page: 1, bbox: [10, 20, 150, 32], line: true, key: "1:0" }], runRec, dict });
  const cell = got.cells[0];
  assert.equal(cell.reads.length, 3);
  assert.deepEqual(cell.reads.map((r) => r.scale), [1, 2, 3]);
  assert.equal(cell.text, "A b");
  assert.equal(cell.confs.length, cell.text.length);
  assert.equal(dims.length, 3);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(() => recognizeCells({ pages, cells: [{ page: 1, bbox: [10, 20, 150, 32], line: true }], runRec, dict, signal: ctl.signal }), (e) => e.name === "AbortError");
});

test("rereadLines asks the same source once, under the signal, and skips Vision pages without loading the list", async () => {
  const p = page(lineOf(["Note:", "Aates", "less"], 342));
  const doc = { blocks: {}, order: [] };
  let loads = 0;
  const lexicon = async () => { loads += 1; return WORDS; };
  const vision = await rereadLines({ doc, ocrPages: [{ ...p, engine: undefined }], ocr: async () => { throw new Error("no"); }, lexicon });
  assert.deepEqual(vision.applied, []);
  assert.equal(loads, 0);
  const asked = [];
  const phases = [];
  const out = await rereadLines({
    doc, ocrPages: [p], lexicon, onPhase: (ph) => phases.push(ph.phase),
    ocr: async (req) => { asked.push(req); return { cells: [{ reads: [{ text: "Note: Rates less", conf: 0.95, confs: [..."Note: Rates less"].map(() => 0.95) }] }] }; },
  });
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0].line, true);
  assert.deepEqual(phases, ["lines"]);
  assert.equal(out.pages[0].items.map((it) => it.str).join(" "), "Note: Rates less");
  const ctl = new AbortController();
  await assert.rejects(() => rereadLines({ doc, ocrPages: [p], lexicon, signal: ctl.signal, ocr: async () => { ctl.abort(); return { cells: [] }; } }), (e) => e.name === "AbortError");
  // A failed list load reads without it.
  const noList = await rereadLines({ doc, ocrPages: [p], lexicon: async () => { throw new Error("offline"); }, ocr: async () => ({ cells: [] }) });
  assert.deepEqual(noList.applied, []);
});

test("device lexicon never downloads without cached models", async () => {
  const fetches = [];
  const env = {
    WebAssembly: {},
    crypto: { subtle: {} },
    fetch: async (url) => { fetches.push(url); throw new Error("must not fetch"); },
    caches: { open: async () => ({ match: async () => undefined, put: async () => {} }) },
  };
  const device = createDeviceOcr({ env, createSource: (opts) => createOcrWeb({ ...opts, fetch: env.fetch, caches: env.caches, crypto: env.crypto }) });
  assert.equal(await device.lexicon(), null);
  assert.deepEqual(fetches, []);
  let asked = 0;
  const ready = createDeviceOcr({ env, source: { cached: async () => true, lexicon: async () => { asked += 1; return WORDS; } } });
  assert.equal(await ready.lexicon(), WORDS);
  assert.equal(await ready.lexicon(), WORDS);
  assert.equal(asked, 1);
});

test("ocr-web loads the word list from our origin, checks its hash, caches it, and does not fetch it at load", async () => {
  const body = gzipSync(Buffer.from("reported\ncases\n"));
  const sha = createHash("sha256").update(body).digest("hex");
  const realSha = LEXICON_FILE.sha256;
  const realBytes = LEXICON_FILE.bytes;
  LEXICON_FILE.sha256 = sha;
  LEXICON_FILE.bytes = body.length;
  try {
    const fetched = [];
    const stored = new Map();
    const caches = { async open() { return { async match(url) { return stored.has(url) ? new Response(stored.get(url)) : null; }, async put(url, res) { stored.set(url, new Uint8Array(await res.arrayBuffer())); } }; } };
    const source = createOcrWeb({ useWorker: false, assetBase: "https://example.test/", caches, fetch: async (url) => { fetched.push(url); return new Response(body); } });
    assert.deepEqual(fetched, []);
    const set = await source.lexicon();
    assert.ok(set.has("reported") && set.has("cases"));
    assert.deepEqual(fetched, ["https://example.test/assets/ocr/en-words.txt.gz"]);
    assert.equal(stored.size, 1);
    const again = createOcrWeb({ useWorker: false, assetBase: "https://example.test/", caches, fetch: async () => { throw new Error("must not fetch"); } });
    assert.ok((await again.lexicon()).has("cases"), "second source reads the cache");
    const bad = createOcrWeb({ useWorker: false, assetBase: "https://other.test/", caches: { async open() { return { async match() { return null; }, async put() {} }; } }, fetch: async () => new Response(new Uint8Array([1, 2])) });
    await assert.rejects(() => bad.lexicon(), /sha256 mismatch/);
  } finally {
    LEXICON_FILE.sha256 = realSha;
    LEXICON_FILE.bytes = realBytes;
  }
});

test("textLines puts squeezed or split-off words back into the gap of their line", () => {
  const it = (str, x, w, base, extra = {}) => ({ str, transform: [6, 0, 0, 6, x, base], width: w, y0: base - 4.8, y1: base + 1.32, mean: 1, ...extra });
  const page = {
    n: 1,
    engine: "ppocr-web",
    items: [
      it("Summary", 268.5, 29.5, 15.12),
      it("of", 298, 7.7, 15.12),
      it("reported", 305.7, 51.1, 15.12),
      it("100,000", 359.4, 56.1, 15.12),
      it("population,", 418.5, 30, 15.12),
      // The CDC title on a pdf.js raster: "cases per" boxed apart, 1 pt wide and 3.8 pt lower.
      it("csses", 357.05, 0.96, 18.95),
      it("per", 358.49, 0.72, 18.95),
      // A rotated page-edge word stays out.
      it("NOTIFIABLE", 580, 6, 120, { y0: 90, y1: 126 }),
      // A separate line well below is not absorbed.
      it("Note:", 100, 20, 40),
      it("rates", 122, 20, 40),
    ],
  };
  const lines = textLines(page, []);
  const words = lines.map((l) => l.idx.map((i) => page.items[i].str).join(" "));
  assert.ok(words.includes("Summary of reported csses per 100,000 population,"), words.join(" | "));
  assert.ok(words.includes("Note: rates"));
  assert.equal(words.some((w) => w.includes("NOTIFIABLE")), false);
  const split = { ...page, items: page.items.map((x) => (x.str === "csses" || x.str === "per" ? { ...x, width: x.str === "csses" ? 1.2 * 6 * 2 : 6 } : x)) };
  split.items[5] = { ...split.items[5], transform: [6, 0, 0, 6, 357.1, 18.4] };
  const again = textLines(split, []).map((l) => l.idx.map((i) => split.items[i].str).join(" "));
  assert.equal(again.filter((w) => w.includes("csses")).length, 1, "never twice");
});
