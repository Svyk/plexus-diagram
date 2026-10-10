// Paired statistics for the beat-LlamaParse loop (tools/parse-bench/paired-stats.mjs).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { gritsCon } from "../tools/parse-bench/grits.mjs";
import { scorePage } from "../tools/parse-bench/scan-score.mjs";
import {
  MIN_FIGURE_AREA, MIN_TEXT_CHARS, applicable, avgRanks, bootstrapCI, cohenDz, components, evaluate, foldPrint, indexDocsDir, informative, mulberry32, pageScore, parseArgs, resolveDoc, scoreWith, sureTextChars, textScore, wilcoxon, withoutFigureText,
} from "../tools/parse-bench/paired-stats.mjs";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// Reference numbers: scipy 1.17.1 wilcoxon(d, alternative="greater", zero_method="wilcox", method="exact" | "approx",
// correction=True) and numpy mean/std(ddof=1), 2026-10-09. scipy's exact method ignores ties and zeros (it uses integer
// ranks), so for tied vectors the exact reference is a brute-force enumeration of all 2^n sign assignments over the
// average ranks (the tie-aware permutation p, which is what this module computes).
const A = [1.5, -0.5, 2, 3, -1, 4, 0.7, 2.2]; // no ties: scipy exact p 0.02734375 (= 7/256), approx 0.0293537042156025, W+ 32, W- 4, dz 0.8771979164144673
const B = [0.3, 0.2, 0.2, -0.1, 0.5, 0, 0.4, 0.4, -0.2, 0.6, 0.3, 0.1]; // ties + one zero: brute exact 0.00634765625, scipy approx 0.007999495149173846, W+ 60.5, W- 5.5, dz 0.9309841660896965
const C = [1.11, -0.01, 0.04, -0.24, 0.73, -0.85, 1.17, -0.08, 0.46, 0.18, 1.03, -0.73, 0.14, 0.11, 0.87, -0.25, 0.21, -0.14]; // brute exact 0.09624862670898438, scipy approx 0.09563683623169483, W+ 116, W- 55, dz 0.3538330708805394

test("wilcoxon on a no-tie vector matches scipy exact and approx", () => {
  const w = wilcoxon(A);
  assert.equal(w.n, 8);
  assert.equal(w.wPlus, 32);
  assert.equal(w.wMinus, 4);
  near(w.pExact, 0.02734375);
  near(w.pNormal, 0.0293537042156025, 2e-7);
  near(w.r, 28 / 36);
  near(cohenDz(A), 0.8771979164144673);
});

test("ties get average ranks and zeros are dropped", () => {
  assert.deepEqual(avgRanks([1, 2, 2, 3]), [1, 2.5, 2.5, 4]);
  const w = wilcoxon(B);
  assert.equal(w.zeros, 1);
  assert.equal(w.n, 11);
  assert.equal(w.wPlus, 60.5);
  assert.equal(w.wMinus, 5.5);
  near(w.pExact, 0.00634765625);
  near(w.pNormal, 0.007999495149173846, 2e-7);
  near(w.r, 55 / 66);
  near(cohenDz(B), 0.9309841660896965);
  const c = wilcoxon(C);
  assert.equal(c.wPlus, 116);
  near(c.pExact, 0.09624862670898438);
  near(c.pNormal, 0.09563683623169483, 2e-7);
});

test("n = 1, all zeros, and an all-negative sample", () => {
  const one = wilcoxon([0.4]);
  assert.equal(one.n, 1);
  near(one.pExact, 0.5);
  assert.equal(one.r, 1);
  const zeros = wilcoxon([0, 0, 0]);
  assert.equal(zeros.n, 0);
  assert.equal(zeros.pExact, 1);
  assert.equal(zeros.r, 0);
  assert.equal(cohenDz([0, 0]), 0);
  assert.equal(cohenDz([]), null);
  const neg = wilcoxon([-1, -2, -3]);
  near(neg.pExact, 1);
  assert.equal(neg.r, -1);
  near(wilcoxon([1, 2, 3, 4, 5]).pExact, 1 / 32);
});

test("exact p at n = 300 runs in well under a second", () => {
  const rnd = mulberry32(7);
  const d = Array.from({ length: 300 }, () => rnd() - 0.4);
  const t = Date.now();
  const w = wilcoxon(d);
  assert.ok(Date.now() - t < 1000);
  assert.ok(w.pExact >= 0 && w.pExact <= 1);
  assert.ok(Math.abs(w.pExact - w.pNormal) < 0.01 || w.pExact < 1e-6);
});

test("seeded bootstrap is reproducible and the CI brackets the mean", () => {
  const x = bootstrapCI(A, { seed: 5 });
  const y = bootstrapCI(A, { seed: 5 });
  assert.deepEqual(x, y);
  assert.notDeepEqual(bootstrapCI(A, { seed: 5, resamples: 20 }), bootstrapCI(A, { seed: 6, resamples: 20 }));
  assert.ok(x.lo < x.mean && x.mean < x.hi);
  assert.deepEqual(bootstrapCI([]), { lo: null, hi: null, mean: null });
  const flat = bootstrapCI([0.2, 0.2, 0.2]);
  near(flat.lo, 0.2);
  near(flat.hi, 0.2);
  const r = mulberry32(1);
  const first = [r(), r()];
  const r2 = mulberry32(1);
  assert.deepEqual(first, [r2(), r2()]);
});

const LONG = "the quick brown fox jumps over the lazy dog again and again";

test("component applicability follows the truth", () => {
  assert.deepEqual(applicable({}), { cell: false, struct: false, fig: false, cap: false, text: false });
  assert.deepEqual(applicable({ tables: [] }), { cell: true, struct: true, fig: false, cap: false, text: false });
  assert.equal(applicable({ figures: [] }).fig, true);
  assert.equal(applicable({ figures: [{ caption: "" }] }).cap, false);
  assert.equal(applicable({ figures: [{ caption: "" }, { caption: "Fig. 1" }] }).cap, true);
  assert.equal(applicable({ textComplete: true, lines: [] }).text, false);
  assert.equal(applicable({ textComplete: true, lines: [{ text: "x", unsure: true }] }).text, false);
  assert.equal(applicable({ textComplete: false, lines: ["abc"] }).text, false);
  assert.equal(applicable({ textComplete: true, lines: [LONG] }).text, true);
  assert.equal(applicable({ textComplete: true, lines: ["abcde"] }).text, false);
});

test("text needs at least 40 sure characters, spaces and unsure lines not counted", () => {
  assert.equal(MIN_TEXT_CHARS, 40);
  const c39 = "a".repeat(39), c40 = "a".repeat(40);
  assert.equal(sureTextChars({ lines: ["a b c", { text: "zzzzzzzz", unsure: true }] }), 3);
  assert.equal(applicable({ textComplete: true, lines: [c39] }).text, false);
  assert.equal(applicable({ textComplete: true, lines: [c40] }).text, true);
  assert.equal(applicable({ textComplete: true, lines: ["a".repeat(20) + " " + "a".repeat(19)] }).text, false);
  assert.equal(applicable({ textComplete: true, lines: ["a".repeat(20) + " " + "a".repeat(20)] }).text, true);
  assert.equal(applicable({ textComplete: true, lines: [c39, { text: "z".repeat(50), unsure: true }] }).text, false);
  assert.equal(informative({ textComplete: true, lines: ["abcde"] }), false);
  assert.equal(informative({ textComplete: true, lines: ["abcde"], tables: [], figures: [] }), false);
  assert.equal(informative({ textComplete: true, lines: [c39] }), false);
  assert.equal(informative({ textComplete: true, lines: [c40] }), true);
  assert.equal(informative({ textComplete: true, lines: ["abcde"], figures: [{ caption: "" }] }), true);
  assert.deepEqual(components({ text: { cer: 0 } }, { tables: [], textComplete: true, lines: ["abcde"] }), { cell: 0, struct: 0 });
});

test("components: empty-array rule, text from cer, failed read is zero", () => {
  const emptyDoc = { order: [], blocks: {}, pages: [] };
  const truth = { tables: [], figures: [], textComplete: true, lines: [LONG] };
  const c = components({ tables: { f1: 0.2, structure: { f1: 0.2 } }, grits: { con: 1, top: 1 }, figures: { f1: 1, caption: { recall: 0 } }, text: { cer: 0.25 } }, truth);
  assert.deepEqual(c, { cell: 1, struct: 1, fig: 1, text: 0.75 });
  assert.equal(pageScore(c), 0.9375);
  assert.equal(components({ text: { cer: 3 } }, { textComplete: true, lines: [LONG] }).text, 0);
  assert.deepEqual(components(null, { tables: [], figures: [{ caption: "x" }] }), { cell: 0, struct: 0, fig: 0, cap: 0 });
  assert.equal(pageScore({}), null);
  assert.ok(emptyDoc);
});

test("doc resolution: id first, then pdf + page, p1 does not match p12", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pstats-"));
  try {
    await writeFile(path.join(dir, "a-p3.pxd.json"), "{}");
    await writeFile(path.join(dir, "doc.pdf.p12.llamaparse.pxd.json"), "{}");
    await writeFile(path.join(dir, "doc.pdf.p1.llamaparse.pxd.json"), "{}");
    await writeFile(path.join(dir, "doc.pdf.p1.llamaparse.raw.json"), "{}");
    const names = indexDocsDir(dir);
    assert.equal(resolveDoc(dir, names, { id: "a-p3", file: "a.pdf", page: 3 }), path.join(dir, "a-p3.pxd.json"));
    assert.equal(resolveDoc(dir, names, { id: "x", file: "doc.pdf", page: 1 }), path.join(dir, "doc.pdf.p1.llamaparse.pxd.json"));
    assert.equal(resolveDoc(dir, names, { id: "x", file: "doc.pdf", page: 12 }), path.join(dir, "doc.pdf.p12.llamaparse.pxd.json"));
    assert.equal(resolveDoc(dir, names, { id: "x", file: "doc.pdf", page: 2 }), null);
    assert.deepEqual(indexDocsDir(path.join(dir, "nope")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("informative: needs a scored cell, a figure, or complete text with lines", () => {
  const cell = (c) => ({ cells: [c] });
  assert.equal(informative({ tables: [cell({ text: "a", unsure: true })] }), false);
  assert.equal(informative({ tables: [cell({ text: "a", unsure: true }), cell({ text: "b" })] }), true);
  assert.equal(informative({ tables: [], figures: [], textComplete: false }), false);
  assert.equal(informative({ figures: [{ caption: "" }] }), true);
  assert.equal(informative({ textComplete: true, lines: [LONG] }), true);
  assert.equal(informative({ textComplete: true, lines: [{ text: "x", unsure: true }] }), false);
  assert.equal(informative({ textComplete: false, lines: ["abc"] }), false);
  assert.equal(informative({}), false);
});

const emptyDocJson = JSON.stringify({ order: [], blocks: {}, pages: [{ w: 1, h: 1 }] });
const textDocJson = JSON.stringify({ order: ["x"], blocks: { x: { type: "paragraph", text: LONG } }, pages: [{ w: 1, h: 1 }] });
const textTruth = JSON.stringify({ textComplete: true, lines: [LONG] });

test("evaluate: uninformative pages are left out, missing docs count as failed reads, categories and gate are reported", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pstats-"));
  try {
    for (const d of ["truth", "a", "b"]) await mkdir(path.join(dir, d));
    const pages = [];
    for (let i = 1; i <= 8; i++) {
      pages.push({ id: `p${i}`, file: "f.pdf", page: i, class: ["text"], ...(i > 6 ? { category: "photo" } : {}) });
      await writeFile(path.join(dir, "truth", `p${i}.json`), textTruth);
      // a reads the text exactly (score 1); b has no doc for any page (score 0)
      await writeFile(path.join(dir, "a", `p${i}.pxd.json`), textDocJson);
    }
    await writeFile(path.join(dir, "truth", "empty.json"), JSON.stringify({ tables: [], figures: [] }));
    await writeFile(path.join(dir, "a", "empty.pxd.json"), emptyDocJson);
    pages.push({ id: "empty", file: "f.pdf", page: 9, class: "text" });
    await writeFile(path.join(dir, "truth", "nocomp.json"), JSON.stringify({ textComplete: false }));
    pages.push({ id: "nocomp", file: "f.pdf", page: 10, class: "text" });
    pages.push({ id: "ghost", file: "f.pdf", page: 11, class: "text" });
    const res = evaluate({ root: dir, manifest: { pages }, aDir: path.join(dir, "a"), bDir: path.join(dir, "b"), resamples: 200, gate: "dev" });
    assert.equal(res.n, 8);
    assert.deepEqual(res.uninformative.sort(), ["empty", "nocomp"]);
    assert.equal(res.failedReads.b, 8);
    assert.equal(res.failedReads.a, 0);
    assert.deepEqual(res.skipped.map((s) => s.reason), ["no truth file"]);
    near(res.meanA, 1);
    near(res.meanB, 0);
    assert.equal(res.wilcoxon.pExact, 1 / 256);
    assert.equal(res.categories.find((c) => c.name === "photo").n, 2);
    assert.equal(res.categories.find((c) => c.name === "text").wins, 6);
    // every page here is text-only, so the table and figure non-inferiority checks have no evidence and fail closed
    assert.equal(res.nonInferiority.cell.n, 0);
    assert.deepEqual(res.gate.checks.filter((c) => !c.pass).map((c) => c.name), ["non-inferiority cell: CI lower > -0.05", "non-inferiority fig: CI lower > -0.05"]);
    // the effect-size bar is rank-biserial r; Cohen's d_z is reported, not gated
    assert.ok(res.gate.checks.some((c) => c.name === "rank-biserial r >= 0.5"));
    assert.equal(res.gate.checks.some((c) => /d_z/.test(c.name)), false);
    assert.equal(typeof res.dz, "number");
    const sealed = evaluate({ root: dir, manifest: { pages }, aDir: path.join(dir, "a"), bDir: path.join(dir, "b"), resamples: 200, gate: "sealed" });
    assert.equal(sealed.gate.pass, false);
    assert.equal(sealed.gate.checks.find((c) => c.name === "n >= 30").pass, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sealed gate: a category with 2 documents and a document with 4 pages fail", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pstats-"));
  try {
    for (const d of ["truth", "a", "b"]) await mkdir(path.join(dir, d));
    const pages = [];
    // rough-scan: 6 pages from 2 documents, 4 of them from one; modern-digital: 6 pages from 3 documents, 2 each
    const plan = [["rough-scan", "d1", 4], ["rough-scan", "d2", 2], ["modern-digital", "e1", 2], ["modern-digital", "e2", 2], ["modern-digital", "e3", 2]];
    let i = 0;
    for (const [category, file, k] of plan) {
      for (let j = 0; j < k; j++, i++) {
        const id = `s${i}`;
        pages.push({ id, file, page: j + 1, category });
        await writeFile(path.join(dir, "truth", `${id}.json`), textTruth);
        await writeFile(path.join(dir, "a", `${id}.pxd.json`), textDocJson);
      }
    }
    const res = evaluate({ root: dir, manifest: { pages }, aDir: path.join(dir, "a"), bDir: path.join(dir, "b"), resamples: 200, gate: "sealed" });
    const check = (name) => res.gate.checks.find((c) => c.name === name);
    assert.equal(check(">= 3 documents in rough-scan").value, 2);
    assert.equal(check(">= 3 documents in rough-scan").pass, false);
    assert.equal(check("<= 3 pages per document in rough-scan").value, 4);
    assert.equal(check("<= 3 pages per document in rough-scan").pass, false);
    assert.equal(check(">= 3 documents in modern-digital").pass, true);
    assert.equal(check("<= 3 pages per document in modern-digital").pass, true);
    assert.equal(check(">= 3 documents in photo").value, 0);
    assert.equal(res.gate.pass, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseArgs", () => {
  const o = parseArgs(["--root", "r", "--manifest", "m", "--a", "x", "--b", "y", "--fold-quotes", "--gate", "sealed", "--seed", "3"]);
  assert.equal(o.foldQuotes, true);
  assert.equal(o.gate, "sealed");
  assert.equal(o.seed, 3);
  assert.equal(o.aName, "Plexus");
  assert.throws(() => parseArgs(["--root", "r"]), /required/);
  assert.throws(() => parseArgs(["--root", "r", "--manifest", "m", "--a", "x", "--b", "y", "--gate", "z"]), /gate/);
  assert.throws(() => parseArgs(["--nope"]), /unknown/);
});

test("text inside a truth figure is dropped before the text score; text outside still counts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pxs-fig-"));
  try {
    const mk = (blocks) => ({
      pages: [{ n: 1, w: 100, h: 100 }],
      order: Object.keys(blocks),
      blocks,
    });
    const body = { type: "para", page: 1, text: "the quick brown fox", bbox: [10, 80, 90, 90] };
    const label = { type: "para", page: 1, text: "axis 10 20 30", bbox: [30, 30, 40, 36] };
    const truth = { tables: [], figures: [{ bbox: [0.2, 0.2, 0.8, 0.6], caption: "" }], textComplete: true, lines: ["the quick brown fox"] };
    const file = path.join(dir, "d.pxd.json");
    await writeFile(file, JSON.stringify(mk({ a: body, b: label })));
    const s = scoreWith(file, truth, false);
    assert.equal(s.textDroppedInFigures, 1);
    assert.equal(s.text.cer, 0);
    assert.ok(scorePage(JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8")), truth).text.cer > 0);
    await writeFile(file, JSON.stringify(mk({ a: { ...body, bbox: [10, 30, 90, 36] } })));
    const out = scoreWith(file, truth, false);
    assert.equal(out.textDroppedInFigures, 1);
    assert.equal(out.text.cer, 1);
    const kept = withoutFigureText(mk({ a: { type: "para", page: 1, text: "no box" } }), truth.figures);
    assert.equal(kept.dropped, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foldPrint drops leader dots and reads digit middle dots as decimal points, on copies", () => {
  const cell = (r, c, text) => ({ r, c, rowSpan: 1, colSpan: 1, text });
  const doc = {
    order: ["b1", "l1"],
    blocks: {
      b1: { type: "table", cells: [cell(0, 0, "PADD 1 ....."), cell(0, 1, "0·01")] },
      l1: { type: "list", items: [{ text: "Total . . . . . 12" }, { text: "see 1·121 …… ok" }, { text: "wait.. no. Done." }] },
    },
  };
  const truth = {
    lines: ["Item .... 5", { text: "x … y" }],
    tables: [{ cells: [cell(0, 0, "PADD 1"), cell(0, 1, "0.01")] }],
    figures: [{ caption: "Fig. 2 ..... Flow" }],
  };
  const before = JSON.stringify([doc, truth]);
  const [d, t] = foldPrint(doc, truth);
  assert.equal(JSON.stringify([doc, truth]), before);
  assert.equal(d.blocks.b1.cells[0].text, "PADD 1");
  assert.equal(d.blocks.b1.cells[1].text, "0.01");
  assert.equal(d.blocks.l1.items[0].text, "Total 12");
  assert.equal(d.blocks.l1.items[1].text, "see 1.121 ok");
  assert.equal(d.blocks.l1.items[2].text, "wait.. no. Done.");
  assert.equal(t.lines[0], "Item 5");
  assert.equal(t.lines[1].text, "x y");
  assert.equal(t.figures[0].caption, "Fig. 2 Flow");
  assert.equal(foldPrint({ a: { text: "A plain sentence. Nothing here, 3.5 ok." } }, {})[0].a.text, "A plain sentence. Nothing here, 3.5 ok.");
  assert.equal(foldPrint({ a: { text: "a·b 0·x" } }, {})[0].a.text, "a·b 0·x");
});

test("a leader-dot cell and a middle-dot decimal score 1 against clean truth once folded", () => {
  const cell = (r, c, text) => ({ r, c, rowSpan: 1, colSpan: 1, text });
  const doc = { order: ["t"], blocks: { t: { type: "table", cells: [cell(0, 0, "PADD 1 ....."), cell(0, 1, "0·01")] } } };
  const truth = { tables: [{ cells: [cell(0, 0, "PADD 1"), cell(0, 1, "0.01")] }] };
  assert.ok(gritsCon(doc.blocks.t.cells, truth.tables[0].cells).score < 1);
  const [d, t] = foldPrint(doc, truth);
  assert.equal(gritsCon(d.blocks.t.cells, t.tables[0].cells).score, 1);
});

const docOf = (...texts) => {
  const blocks = {};
  texts.forEach((t, i) => { blocks[`b${i}`] = { type: "para", page: 1, text: t }; });
  return { pages: [{ n: 1, w: 100, h: 100 }], order: Object.keys(blocks), blocks };
};

test("textScore: an unsure middle line is a wildcard, read right, wrong, or absent", () => {
  const truth = { textComplete: true, lines: ["alpha beta gamma", { text: "smudged words here", unsure: true }, "delta epsilon zeta"] };
  const absent = textScore(docOf("alpha beta gamma", "delta epsilon zeta"), truth).cer;
  const right = textScore(docOf("alpha beta gamma", "smudged words here", "delta epsilon zeta"), truth).cer;
  const wrong = textScore(docOf("alpha beta gamma", "totally different junk text", "delta epsilon zeta"), truth).cer;
  assert.equal(absent, 0);
  assert.equal(right, 0);
  assert.equal(wrong, 0);
});

test("textScore: reading only the sure lines is perfect; extra text away from an unsure line costs", () => {
  const truth = { textComplete: true, lines: ["alpha beta gamma", { text: "x", unsure: true }, "delta epsilon zeta"] };
  assert.equal(textScore(docOf("alpha beta gamma delta epsilon zeta"), truth).cer, 0);
  assert.ok(textScore(docOf("header junk", "alpha beta gamma", "delta epsilon zeta"), truth).cer > 0);
  assert.ok(textScore(docOf("alpha beta gamma", "delta epsilon zeta", "footer junk"), truth).cer > 0);
  const trailing = { textComplete: true, lines: ["alpha beta", { text: "x", unsure: true }] };
  assert.equal(textScore(docOf("alpha beta", "anything more"), trailing).cer, 0);
});

test("textScore: a paragraph made of table-cell text is dropped", () => {
  const truth = {
    textComplete: true,
    lines: ["alpha beta gamma"],
    tables: [{ cells: [{ r: 0, c: 0, text: "Sample" }, { r: 0, c: 1, text: "Result 12" }, { r: 1, c: 0, text: "Unsure cell", unsure: true }] }],
  };
  const s = textScore(docOf("alpha beta gamma", "Sample Result 12 Unsure cell"), truth);
  assert.equal(s.cer, 0);
  assert.equal(s.droppedTableText, 1);
  assert.ok(textScore(docOf("alpha beta gamma", "Sample something else entirely"), truth).cer > 0);
});

test("textScore: with no unsure lines and no table text it equals the old 1 - CER", () => {
  const truth = { textComplete: true, lines: ["the quick brown fox", "jumps over"] };
  const doc = docOf("the quick brwn fox", "jumps ovr the");
  const old = scorePage(doc, truth).text.cer;
  near(textScore(doc, truth).cer, old);
  assert.ok(old > 0);
});

test("figures under 1% of the page are ignored on both sides", async () => {
  assert.equal(MIN_FIGURE_AREA, 0.01);
  const dir = await mkdtemp(path.join(tmpdir(), "pxs-tiny-"));
  try {
    const file = path.join(dir, "d.pxd.json");
    const mk = (blocks) => ({ pages: [{ n: 1, w: 100, h: 100 }], order: Object.keys(blocks), blocks });
    const icon = { type: "figure", page: 1, bbox: [5, 5, 17, 17] }; // 1.44% is kept; 9x9 is dropped
    const tinyIcon = { type: "figure", page: 1, bbox: [5, 5, 14, 14] };
    const chart = { type: "figure", page: 1, bbox: [20, 20, 80, 60], caption: "cap" };
    const cap = { type: "para", page: 1, text: "Figure 1 sales", bbox: [20, 62, 80, 66] };
    // tiny predicted icon on a no-figure page
    await writeFile(file, JSON.stringify(mk({ i: tinyIcon })));
    let s = scoreWith(file, { figures: [] }, false);
    assert.equal(components(s, { figures: [] }).fig, 1);
    assert.equal(scorePage(JSON.parse(JSON.stringify(mk({ i: tinyIcon }))), { figures: [] }).figures.f1, 0);
    // an icon above 1% still counts
    await writeFile(file, JSON.stringify(mk({ i: icon })));
    s = scoreWith(file, { figures: [] }, false);
    assert.equal(components(s, { figures: [] }).fig, 0);
    // tiny truth QR code plus a real chart: only the chart is scored
    const truth = { figures: [{ bbox: [0.9, 0.9, 0.95, 0.95] }, { bbox: [0.2, 0.2, 0.8, 0.6], caption: "Figure 1 sales" }] };
    await writeFile(file, JSON.stringify(mk({ c: chart, cp: cap })));
    s = scoreWith(file, truth, false);
    assert.equal(s.figures.truthN ?? s.figureCounts.truthN, 1);
    assert.equal(components(s, truth).fig, 1);
    // captions follow the same filter: the tiny figure's caption is not required
    const capTruth = { figures: [{ bbox: [0.9, 0.9, 0.95, 0.95], caption: "QR code" }, { bbox: [0.2, 0.2, 0.8, 0.6] }] };
    assert.equal(applicable(capTruth).cap, false);
    assert.equal(applicable(capTruth).fig, true);
    assert.equal(applicable({ figures: [{ bbox: [0.2, 0.2, 0.8, 0.6], caption: "x" }] }).cap, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a page whose only truth figures are tiny has no figure component and is uninformative", () => {
  const qr = { bbox: [0.9, 0.9, 0.95, 0.95], caption: "QR" };
  const a = applicable({ figures: [qr] });
  assert.equal(a.fig, false);
  assert.equal(a.cap, false);
  assert.equal(informative({ figures: [qr] }), false);
  assert.equal(informative({ figures: [qr, { bbox: [0.1, 0.1, 0.6, 0.6] }] }), true);
  assert.equal(informative({ figures: [qr], tables: [{ cells: [{ text: "a" }] }] }), true);
  assert.deepEqual(components(null, { figures: [qr] }), {});
  assert.equal(applicable({ figures: [] }).fig, true);
});
