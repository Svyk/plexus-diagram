// Paired statistics for the beat-LlamaParse loop (tools/parse-bench/paired-stats.mjs).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applicable, avgRanks, bootstrapCI, cohenDz, components, evaluate, indexDocsDir, mulberry32, pageScore, parseArgs, resolveDoc, wilcoxon,
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

test("component applicability follows the truth", () => {
  assert.deepEqual(applicable({}), { cell: false, struct: false, fig: false, cap: false, text: false });
  assert.deepEqual(applicable({ tables: [] }), { cell: true, struct: true, fig: false, cap: false, text: false });
  assert.equal(applicable({ figures: [] }).fig, true);
  assert.equal(applicable({ figures: [{ caption: "" }] }).cap, false);
  assert.equal(applicable({ figures: [{ caption: "" }, { caption: "Fig. 1" }] }).cap, true);
  assert.equal(applicable({ textComplete: true, lines: [] }).text, false);
  assert.equal(applicable({ textComplete: true, lines: [{ text: "x", unsure: true }] }).text, false);
  assert.equal(applicable({ textComplete: false, lines: ["abc"] }).text, false);
  assert.equal(applicable({ textComplete: true, lines: ["abc"] }).text, true);
});

test("components: empty-array rule, text from cer, failed read is zero", () => {
  const emptyDoc = { order: [], blocks: {}, pages: [] };
  const truth = { tables: [], figures: [], textComplete: true, lines: ["abc"] };
  const c = components({ tables: { f1: 1, structure: { f1: 1 } }, figures: { f1: 1, caption: { recall: 0 } }, text: { cer: 0.25 } }, truth);
  assert.deepEqual(c, { cell: 1, struct: 1, fig: 1, text: 0.75 });
  assert.equal(pageScore(c), 0.9375);
  assert.equal(components({ text: { cer: 3 } }, { textComplete: true, lines: ["a"] }).text, 0);
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

test("evaluate: missing docs count as failed reads, categories and gate are reported", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pstats-"));
  try {
    for (const d of ["truth", "a", "b"]) await mkdir(path.join(dir, d));
    const pages = [];
    for (let i = 1; i <= 8; i++) {
      pages.push({ id: `p${i}`, file: "f.pdf", page: i, class: ["text"], ...(i > 6 ? { category: "photo" } : {}) });
      await writeFile(path.join(dir, "truth", `p${i}.json`), JSON.stringify({ tables: [], figures: [] }));
      // a reads every page as "no table, no figure" (score 1); b has no doc for any page (score 0)
      await writeFile(path.join(dir, "a", `p${i}.pxd.json`), JSON.stringify({ order: [], blocks: {}, pages: [{ w: 1, h: 1 }] }));
    }
    await writeFile(path.join(dir, "truth", "nocomp.json"), JSON.stringify({ textComplete: false }));
    pages.push({ id: "nocomp", file: "f.pdf", page: 9, class: "text" });
    pages.push({ id: "ghost", file: "f.pdf", page: 10, class: "text" });
    const res = evaluate({ root: dir, manifest: { pages }, aDir: path.join(dir, "a"), bDir: path.join(dir, "b"), resamples: 200, gate: "dev" });
    assert.equal(res.n, 8);
    assert.equal(res.failedReads.b, 9);
    assert.equal(res.failedReads.a, 1);
    assert.deepEqual(res.skipped.map((s) => s.reason).sort(), ["no applicable component", "no truth file"]);
    near(res.meanA, 1);
    near(res.meanB, 0);
    assert.equal(res.wilcoxon.pExact, 1 / 256);
    assert.equal(res.categories.find((c) => c.name === "photo").n, 2);
    assert.equal(res.categories.find((c) => c.name === "text").wins, 6);
    // no page here supports text, so that non-inferiority check has no evidence and fails closed
    assert.equal(res.nonInferiority.text.n, 0);
    assert.deepEqual(res.gate.checks.filter((c) => !c.pass).map((c) => c.name), ["non-inferiority text: CI lower > -0.05"]);
    const sealed = evaluate({ root: dir, manifest: { pages }, aDir: path.join(dir, "a"), bDir: path.join(dir, "b"), resamples: 200, gate: "sealed" });
    assert.equal(sealed.gate.pass, false);
    assert.equal(sealed.gate.checks.find((c) => c.name === "n >= 30").pass, false);
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
