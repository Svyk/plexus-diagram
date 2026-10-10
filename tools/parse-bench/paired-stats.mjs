#!/usr/bin/env node
// Paired statistics for two parsers over the same truth pages (the beat-LlamaParse loop).
//   node tools/parse-bench/paired-stats.mjs --root <corpus dir> --manifest <manifest.json> --a <docs dir> --b <docs dir>
//     [--a-name Plexus] [--b-name LlamaParse] [--fold-quotes] [--gate dev|sealed] [--seed 20261009] [--json out.json] [--md out.md]
// Truth is <root>/truth/<id>.json. A docs dir holds <id>.pxd.json or <pdf file>.p<N>.<anything>.pxd.json.
// Pages come from the manifest's `pages`. Scoring is scorePage (scan-score.mjs); this file adds only the
// per-page score S, the paired tests and the gate.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { foldQuotes } from "./scan-corpus.mjs";
import { normBox, pageSize, predTables, scorePage, truthLines } from "./scan-score.mjs";
import { gritsPage } from "./grits.mjs";
import { normText, readingTexts } from "../../test/parse-metrics.js";

export const CATEGORIES = ["rough-scan", "modern-digital", "photo", "handwritten", "mixed"];
export const COMPONENTS = ["cell", "struct", "fig", "cap", "text"];
const MARGIN = 0.05;

// ---- doc resolution ----

export function indexDocsDir(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".pxd.json")) : [];
}

// By id first, then by pdf file + page. Returns a path or null.
export function resolveDoc(dir, names, page) {
  const byId = `${page.id}.pxd.json`;
  if (names.includes(byId)) return join(dir, byId);
  const prefix = `${page.file}.p${page.page}.`;
  const hit = names.filter((n) => n.startsWith(prefix)).sort()[0];
  return hit ? join(dir, hit) : null;
}

// ---- page score ----

// The text component needs at least this many sure characters (normText-ed, space-free) on the page.
export const MIN_TEXT_CHARS = 40;

export function sureTextChars(truth) {
  return truthSegments(truth).reduce((a, s) => a + (s === WILD ? 0 : s.length), 0);
}

// Figures smaller than this share of the page (icons, QR codes, small logos) are ignored on both sides.
export const MIN_FIGURE_AREA = 0.01;

function boxArea(b) {
  return Array.isArray(b) && b.length >= 4 ? Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) : null;
}

function tinyTruthFigure(f) {
  const a = boxArea(f && f.bbox);
  return a !== null && a < MIN_FIGURE_AREA;
}

// Truth figures that count; null when the truth has no figure list.
function bigTruthFigures(truth) {
  return Array.isArray(truth.figures) ? truth.figures.filter((f) => !tinyTruthFigure(f)) : null;
}

// A figure list whose every entry is tiny says nothing about "no figure here".
function figuresApply(truth) {
  const big = bigTruthFigures(truth);
  return !!big && !(truth.figures.length > 0 && big.length === 0);
}

// Copies of truth and doc without sub-1% figures, for the figure and caption components only.
export function withoutTinyFigures(doc, truth) {
  const t = Array.isArray(truth.figures) ? { ...truth, figures: bigTruthFigures(truth) } : truth;
  const dropIds = new Set();
  for (const id of doc.order || []) {
    const b = doc.blocks[id];
    if (!b || b.type !== "figure" || !Array.isArray(b.bbox) || b.bbox.length < 4) continue;
    const size = pageSize(doc, b.page);
    const nb = normBox(b.bbox, size.w, size.h);
    const a = boxArea(nb);
    if (a !== null && a < MIN_FIGURE_AREA) dropIds.add(id);
  }
  const d = dropIds.size ? { ...doc, order: doc.order.filter((id) => !dropIds.has(id)) } : doc;
  return { doc: d, truth: t, changed: dropIds.size > 0 || (t !== truth && t.figures.length !== truth.figures.length) };
}

function textApplies(truth) {
  return !!truth.textComplete && truthLines(truth).length > 0 && sureTextChars(truth) >= MIN_TEXT_CHARS;
}

// Which components the truth supports.
export function applicable(truth) {
  const tables = Array.isArray(truth.tables);
  const figs = figuresApply(truth);
  return {
    cell: tables,
    struct: tables,
    fig: figs,
    cap: figs && bigTruthFigures(truth).some((f) => f && typeof f.caption === "string" && f.caption.trim() !== ""),
    text: textApplies(truth),
  };
}

// A page is worth scoring only when its truth holds something to score: a table with a scored cell, a figure, or complete text.
export function informative(truth) {
  if (!truth) return false;
  if (Array.isArray(truth.tables) && truth.tables.some((t) => t && Array.isArray(t.cells) && t.cells.some((c) => c && !c.unsure))) return true;
  const big = bigTruthFigures(truth);
  if (big && big.length > 0) return true;
  return textApplies(truth);
}

// Component values for one scored page; scored === null is a failed read (every applicable component 0).
export function components(scored, truth) {
  const ap = applicable(truth);
  const out = {};
  for (const k of COMPONENTS) if (ap[k]) out[k] = 0;
  if (!scored) return out;
  if (ap.cell) out.cell = scored.grits?.con ?? 0;
  if (ap.struct) out.struct = scored.grits?.top ?? 0;
  if (ap.fig) out.fig = scored.figures?.f1 ?? 0;
  if (ap.cap) out.cap = scored.figures?.caption?.recall ?? 0;
  if (ap.text) out.text = Math.max(0, 1 - (scored.text?.cer ?? 1));
  return out;
}

// Anchor-matched table F1 from scorePage; diagnostics only, never part of S or the gate.
export function exactOf(scored, truth) {
  if (!Array.isArray(truth.tables)) return {};
  return { cellExact: scored?.tables?.f1 ?? 0, structExact: scored?.tables?.structure?.f1 ?? 0 };
}

export function pageScore(comp) {
  const v = Object.values(comp);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Shallow copy of the doc without text blocks whose bbox centre sits inside a truth figure (chart labels are not page text).
// Blocks without a bbox are kept; figure boxes are page-normalised [x0, y0, x1, y1].
export function withoutFigureText(doc, truthFigures) {
  const boxes = (truthFigures || []).map((f) => f && f.bbox).filter((b) => Array.isArray(b) && b.length >= 4);
  if (!boxes.length) return { doc, dropped: 0 };
  const dropIds = new Set();
  for (const id of doc.order || []) {
    const b = doc.blocks[id];
    if (!b || b.type === "table" || !Array.isArray(b.bbox) || b.bbox.length < 4) continue;
    if (!b.text && b.type !== "list") continue;
    const size = pageSize(doc, b.page);
    const nb = normBox(b.bbox, size.w, size.h);
    if (!nb) continue;
    const cx = (nb[0] + nb[2]) / 2;
    const cy = (nb[1] + nb[3]) / 2;
    if (boxes.some((f) => cx >= f[0] && cx <= f[2] && cy >= f[1] && cy <= f[3])) dropIds.add(id);
  }
  if (!dropIds.size) return { doc, dropped: 0 };
  return { doc: { ...doc, order: doc.order.filter((id) => !dropIds.has(id)) }, dropped: dropIds.size };
}

// Printing artefacts: leader-dot runs and the "0·01" decimal middle dot. Folded on both sides, on copies.
function foldPrintString(s) {
  const LEADER = /(?:\.[ \t]*){3,}|…+(?:[ \t]*…+)*/g;
  let out = s;
  if (LEADER.test(s)) out = s.replace(LEADER, " ").replace(/[ \t]{2,}/g, " ").trim();
  return out.replace(/(\d)\u00B7(?=\d)/g, "$1.");
}

export function foldPrint(doc, truth) {
  const walk = (node, linesToo) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, linesToo);
    } else if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        const v = node[key];
        if ((key === "text" || key === "caption") && typeof v === "string") node[key] = foldPrintString(v);
        else if (linesToo && key === "lines" && Array.isArray(v)) {
          node[key] = v.map((x) => (typeof x === "string" ? foldPrintString(x) : walk(x, linesToo)));
        } else walk(v, linesToo);
      }
    }
    return node;
  };
  return [walk(structuredClone(doc), false), walk(structuredClone(truth), true)];
}

const WILD = null;

function alnumTokens(s) {
  return String(s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

// Truth as segments: one entry per sure line (normText-ed, space-free), WILD for each run of unsure lines.
function truthSegments(truth) {
  const segs = [];
  for (const line of truth.lines || []) {
    const unsure = !!(line && typeof line === "object" && line.unsure);
    if (unsure) {
      if (segs.length && segs[segs.length - 1] === WILD) continue;
      segs.push(WILD);
      continue;
    }
    const t = normText(typeof line === "string" ? line : (line && line.text) || "").replace(/ /g, "");
    if (t) segs.push(t);
  }
  return segs;
}

// Edit distance of the truth segments against the predicted characters; the prediction is consumed for free at a WILD.
export function wildcardDistance(segs, pred) {
  const n = pred.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (const seg of segs) {
    const cur = new Array(n + 1);
    if (seg === WILD) {
      let m = Infinity;
      for (let j = 0; j <= n; j++) {
        if (prev[j] < m) m = prev[j];
        cur[j] = m;
      }
      prev = cur;
      continue;
    }
    for (const ch of seg) {
      cur[0] = prev[0] + 1;
      for (let j = 1; j <= n; j++) {
        const sub = prev[j - 1] + (ch === pred[j - 1] ? 0 : 1);
        const del = prev[j] + 1;
        const ins = cur[j - 1] + 1;
        cur[j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
      }
      prev = cur.slice();
    }
  }
  return prev[n];
}

// Text score for the paired stats: unsure truth lines are wildcards, predicted blocks made of table-cell text are left out.
export function textScore(doc, truth) {
  const segs = truthSegments(truth);
  const sure = segs.reduce((a, s) => a + (s === WILD ? 0 : s.length), 0);
  const cellTokens = new Set();
  for (const t of truth.tables || []) for (const c of t.cells || []) for (const w of alnumTokens(c.text)) cellTokens.add(w);
  let droppedTableText = 0;
  const kept = [];
  for (const { text } of readingTexts(doc)) {
    const toks = alnumTokens(text);
    if (toks.length >= 3 && cellTokens.size && toks.filter((w) => cellTokens.has(w)).length / toks.length >= 0.8) {
      droppedTableText++;
      continue;
    }
    kept.push(text);
  }
  const pred = normText(kept.join("\n")).replace(/ /g, "");
  const dist = wildcardDistance(segs, pred);
  const cer = sure ? dist / sure : (pred.length ? 1 : 0);
  return { cer, charDist: dist, charN: sure, droppedTableText };
}

export function scoreWith(docPath, truth, fold) {
  if (!docPath) return null;
  try {
    const doc = JSON.parse(readFileSync(docPath, "utf8"));
    const [d, t] = fold ? foldPrint(...foldQuotes(doc, truth)) : [doc, truth];
    const scored = scorePage(d, t);
    if (Array.isArray(t.tables)) scored.grits = gritsPage(predTables(d), t.tables);
    const tiny = withoutTinyFigures(d, t);
    if (tiny.changed) {
      const again = scorePage(tiny.doc, tiny.truth);
      if (again.figures) scored.figures = again.figures;
      else delete scored.figures;
    }
    const stripped = withoutFigureText(d, t.figures);
    scored.textDroppedInFigures = stripped.dropped;
    if (stripped.dropped && scored.text) {
      const again = scorePage(stripped.doc, t);
      scored.text = again.text;
      scored.textCounts = again.textCounts;
    }
    if (scored.text) {
      scored.textExact = scored.text;
      const ts = textScore(stripped.doc, t);
      scored.text = { ...scored.text, cer: ts.cer };
      scored.textDroppedTable = ts.droppedTableText;
    }
    return scored;
  } catch {
    return null;
  }
}

export function categoryOf(page) {
  if (page.category) return page.category;
  const c = Array.isArray(page.class) ? page.class[0] : page.class;
  return c || "unclassified";
}

// ---- statistics ----

export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// Average ranks of |d| (zeros already dropped). Returns ranks aligned with the input.
export function avgRanks(abs) {
  const idx = abs.map((v, i) => i).sort((i, j) => abs[i] - abs[j]);
  const ranks = new Array(abs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && abs[idx[j + 1]] === abs[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    i = j + 1;
  }
  return ranks;
}

function normalSf(z) {
  return 0.5 * erfc(z / Math.SQRT2);
}

function erfc(x) {
  // Numerical Recipes erfcc (Chebyshev fit), fractional error below 1.2e-7; only the approximate p uses it.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(
    -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
  );
  return x >= 0 ? r : 2 - r;
}

// Wilcoxon signed-rank, H1: x > y (d = x - y). Zero differences dropped.
export function wilcoxon(d) {
  const nz = d.filter((x) => x !== 0);
  const n = nz.length;
  const out = { n, nTotal: d.length, zeros: d.length - n, wPlus: 0, wMinus: 0, pExact: 1, pNormal: 1, r: 0, z: 0 };
  if (!n) return out;
  const ranks = avgRanks(nz.map(Math.abs));
  let wPlus = 0;
  let wMinus = 0;
  nz.forEach((x, i) => { if (x > 0) wPlus += ranks[i]; else wMinus += ranks[i]; });
  out.wPlus = wPlus;
  out.wMinus = wMinus;
  out.r = (wPlus - wMinus) / (wPlus + wMinus);
  // Exact: probability mass over doubled ranks, each sign +/- with prob 1/2.
  const dr = ranks.map((r) => Math.round(r * 2));
  const total = dr.reduce((a, b) => a + b, 0);
  let dp = new Float64Array(total + 1);
  dp[0] = 1;
  let top = 0;
  for (const r of dr) {
    const next = new Float64Array(total + 1);
    for (let s = 0; s <= top; s++) {
      const v = dp[s] * 0.5;
      next[s] += v;
      next[s + r] += v;
    }
    top += r;
    dp = next;
  }
  const obs = Math.round(wPlus * 2);
  let p = 0;
  for (let s = obs; s <= total; s++) p += dp[s];
  out.pExact = Math.min(1, p);
  // Normal approximation with tie and continuity correction.
  const mu = (n * (n + 1)) / 4;
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  let tie = 0;
  for (const t of counts.values()) tie += t ** 3 - t;
  const varW = (n * (n + 1) * (2 * n + 1)) / 24 - tie / 48;
  if (varW > 0) {
    out.z = (wPlus - mu - 0.5) / Math.sqrt(varW);
    out.pNormal = normalSf(out.z);
  } else out.pNormal = wPlus > mu ? 0 : 1;
  return out;
}

export function cohenDz(d) {
  if (!d.length) return null;
  const s = sd(d);
  const m = mean(d);
  if (s === 0) return m === 0 ? 0 : m > 0 ? Infinity : -Infinity;
  return m / s;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bootstrap percentile CI of the mean: resamples of the pairs, mulberry32(seed).
export function bootstrapCI(d, { resamples = 10000, seed = 20261009, level = 0.95 } = {}) {
  if (!d.length) return { lo: null, hi: null, mean: null };
  const rnd = mulberry32(seed);
  const n = d.length;
  const means = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(rnd() * n)];
    means[b] = s / n;
  }
  means.sort();
  const a = (1 - level) / 2;
  const lo = means[Math.floor(a * resamples)];
  const hi = means[Math.min(resamples - 1, Math.ceil((1 - a) * resamples) - 1)];
  return { lo, hi, mean: mean(d) };
}

// ---- run ----

export function evaluate({ root, manifest, aDir, bDir, foldQuotes: fold = false, seed = 20261009, resamples = 10000, gate = "dev" }) {
  const namesA = indexDocsDir(aDir);
  const namesB = indexDocsDir(bDir);
  const pages = [];
  const skipped = [];
  const uninformative = [];
  const missing = { a: [], b: [] };
  for (const page of manifest.pages) {
    const tp = join(root, "truth", `${page.id}.json`);
    if (!existsSync(tp)) { skipped.push({ id: page.id, reason: "no truth file" }); continue; }
    const truth = JSON.parse(readFileSync(tp, "utf8"));
    if (!informative(truth)) { uninformative.push(page.id); continue; }
    const pa = resolveDoc(aDir, namesA, page);
    const pb = resolveDoc(bDir, namesB, page);
    if (!pa) missing.a.push(page.id);
    if (!pb) missing.b.push(page.id);
    const scA = scoreWith(pa, truth, fold);
    const scB = scoreWith(pb, truth, fold);
    const ca = components(scA, truth);
    const cb = components(scB, truth);
    const sa = pageScore(ca);
    const sb = pageScore(cb);
    if (sa == null) { skipped.push({ id: page.id, reason: "no applicable component" }); continue; }
    pages.push({ id: page.id, category: categoryOf(page), doc: page.file ?? page.pdf ?? page.id, a: ca, b: cb, sA: sa, sB: sb, d: sa - sb, aExact: exactOf(scA, truth), bExact: exactOf(scB, truth), textDroppedInFigures: { a: scA?.textDroppedInFigures ?? 0, b: scB?.textDroppedInFigures ?? 0 }, textExact: { a: scA?.textExact?.cer ?? null, b: scB?.textExact?.cer ?? null } });
  }
  const d = pages.map((p) => p.d);
  const w = wilcoxon(d);
  const ci = bootstrapCI(d, { resamples, seed });
  const dz = cohenDz(d);
  const nonInf = {};
  for (const k of ["cell", "text", "fig"]) {
    const dk = pages.filter((p) => k in p.a).map((p) => p.a[k] - p.b[k]);
    const c = bootstrapCI(dk, { resamples, seed });
    nonInf[k] = { n: dk.length, mean: c.mean, lo: c.lo, hi: c.hi, pass: c.lo != null && c.lo > -MARGIN };
  }
  const cats = {};
  for (const p of pages) {
    const c = (cats[p.category] ||= { n: 0, sumA: 0, sumB: 0, wins: 0, ties: 0, losses: 0 });
    c.n++;
    c.sumA += p.sA;
    c.sumB += p.sB;
    if (p.d > 0) c.wins++; else if (p.d < 0) c.losses++; else c.ties++;
  }
  const categories = Object.entries(cats).map(([name, c]) => ({ name, n: c.n, meanA: c.sumA / c.n, meanB: c.sumB / c.n, wins: c.wins, ties: c.ties, losses: c.losses }));
  const sealed = gate === "sealed";
  const checks = [];
  const add = (name, value, pass) => checks.push({ name, value, pass: !!pass });
  if (sealed) {
    add("n >= 30", pages.length, pages.length >= 30);
    for (const c of CATEGORIES) {
      const n = cats[c] ? cats[c].n : 0;
      add(`>= 5 pages in ${c}`, n, n >= 5);
      const perDoc = {};
      for (const p of pages) if (p.category === c) perDoc[p.doc] = (perDoc[p.doc] || 0) + 1;
      const docs = Object.keys(perDoc).length;
      const most = Math.max(0, ...Object.values(perDoc));
      add(`>= 3 documents in ${c}`, docs, docs >= 3);
      add(`<= 3 pages per document in ${c}`, most, most <= 3);
    }
  }
  add("exact one-sided p < 0.01", w.pExact, w.pExact < 0.01);
  add("rank-biserial r >= 0.5", w.r, w.r >= 0.5);
  add("bootstrap CI lower bound of mean(d) > 0", ci.lo, ci.lo != null && ci.lo > 0);
  for (const k of ["cell", "text", "fig"]) add(`non-inferiority ${k}: CI lower > -${MARGIN}`, nonInf[k].lo, nonInf[k].pass);
  const meanOf = (side, k) => {
    const v = pages.map((p) => p[side][k]).filter((x) => x != null);
    return v.length ? mean(v) : null;
  };
  const exact = { cellA: meanOf("aExact", "cellExact"), cellB: meanOf("bExact", "cellExact"), structA: meanOf("aExact", "structExact"), structB: meanOf("bExact", "structExact") };
  return {
    n: pages.length,
    exact,
    meanA: pages.length ? mean(pages.map((p) => p.sA)) : null,
    meanB: pages.length ? mean(pages.map((p) => p.sB)) : null,
    meanD: ci.mean,
    wilcoxon: w,
    dz,
    ci: { lo: ci.lo, hi: ci.hi, resamples, seed },
    nonInferiority: nonInf,
    categories,
    failedReads: { a: missing.a.length, b: missing.b.length, aIds: missing.a, bIds: missing.b },
    skipped,
    uninformative,
    gate: { mode: gate, pass: checks.every((c) => c.pass), checks },
    pages,
  };
}

// ---- output ----

const f3 = (x) => (x == null ? "-" : !Number.isFinite(x) ? String(x) : Math.abs(x) < 0.001 && x !== 0 ? x.toExponential(2) : x.toFixed(3));

export function table(res, aName, bName) {
  const w = res.wilcoxon;
  const L = [];
  L.push(`pages ${res.n}  failed reads ${aName} ${res.failedReads.a}, ${bName} ${res.failedReads.b}  left out ${res.skipped.length}  uninformative ${res.uninformative.length}`);
  L.push(`mean S ${aName} ${f3(res.meanA)}  ${bName} ${f3(res.meanB)}  mean d ${f3(res.meanD)}  95% CI [${f3(res.ci.lo)}, ${f3(res.ci.hi)}]`);
  L.push(`Wilcoxon (n=${w.n}, zeros ${w.zeros}) W+ ${w.wPlus} W- ${w.wMinus}  exact p ${f3(w.pExact)}  normal p ${f3(w.pNormal)} (z ${f3(w.z)})`);
  L.push(`rank-biserial r ${f3(w.r)}  Cohen d_z ${f3(res.dz)}`);
  L.push(`diagnostic, exact-anchor table F1 (not in S): cell ${aName} ${f3(res.exact.cellA)} ${bName} ${f3(res.exact.cellB)}  struct ${aName} ${f3(res.exact.structA)} ${bName} ${f3(res.exact.structB)}`);
  for (const [k, v] of Object.entries(res.nonInferiority)) L.push(`non-inferiority ${k}: n ${v.n}  mean ${f3(v.mean)}  CI [${f3(v.lo)}, ${f3(v.hi)}]  ${v.pass ? "ok" : "FAIL"}`);
  L.push("");
  L.push(["category".padEnd(16), "n".padStart(4), aName.padStart(10), bName.padStart(10), "W/T/L"].join(" "));
  for (const c of res.categories) L.push([c.name.padEnd(16), String(c.n).padStart(4), f3(c.meanA).padStart(10), f3(c.meanB).padStart(10), `${c.wins}/${c.ties}/${c.losses}`].join(" "));
  L.push("");
  L.push(`gate ${res.gate.mode}: ${res.gate.pass ? "PASS" : "FAIL"}`);
  for (const c of res.gate.checks) L.push(`  ${c.pass ? "pass" : "FAIL"}  ${c.name}  (${f3(c.value)})`);
  return L.join("\n");
}

function compStr(c) {
  return COMPONENTS.filter((k) => k in c).map((k) => `${k} ${f3(c[k])}`).join(", ");
}

export function markdown(res, aName, bName) {
  const w = res.wilcoxon;
  const L = [];
  L.push(`# ${aName} vs ${bName}, paired statistics`, "");
  L.push("| | |", "|---|---|");
  L.push(`| pages | ${res.n} (failed reads: ${aName} ${res.failedReads.a}, ${bName} ${res.failedReads.b}; left out ${res.skipped.length}) |`);
  L.push(`| mean S ${aName} / ${bName} | ${f3(res.meanA)} / ${f3(res.meanB)} |`);
  L.push(`| mean difference, 95% bootstrap CI | ${f3(res.meanD)} [${f3(res.ci.lo)}, ${f3(res.ci.hi)}] (${res.ci.resamples} resamples, seed ${res.ci.seed}) |`);
  L.push(`| Wilcoxon exact one-sided p | ${f3(w.pExact)} (normal approx ${f3(w.pNormal)}; n ${w.n}, zeros ${w.zeros}) |`);
  L.push(`| rank-biserial r / Cohen d_z | ${f3(w.r)} / ${f3(res.dz)} |`);
  L.push(`| diagnostic: exact-anchor cell F1 ${aName} / ${bName} (not in S) | ${f3(res.exact.cellA)} / ${f3(res.exact.cellB)} |`, "");
  L.push(`## Gate (${res.gate.mode}): ${res.gate.pass ? "PASS" : "FAIL"}`, "");
  for (const c of res.gate.checks) L.push(`- [${c.pass ? "x" : " "}] ${c.name}: ${f3(c.value)}`);
  L.push("", "## By category", "", `| category | n | ${aName} | ${bName} | wins / ties / losses |`, "|---|---|---|---|---|");
  for (const c of res.categories) L.push(`| ${c.name} | ${c.n} | ${f3(c.meanA)} | ${f3(c.meanB)} | ${c.wins} / ${c.ties} / ${c.losses} |`);
  const sorted = [...res.pages].sort((x, y) => x.d - y.d);
  const row = (p) => `| ${p.id} | ${f3(p.d)} | ${aName}: ${compStr(p.a)} | ${bName}: ${compStr(p.b)} |`;
  L.push("", "## Ten biggest losses", "", "| page | d | a | b |", "|---|---|---|---|");
  for (const p of sorted.slice(0, 10)) L.push(row(p));
  L.push("", "## Ten biggest wins", "", "| page | d | a | b |", "|---|---|---|---|");
  for (const p of sorted.slice(-10).reverse()) L.push(row(p));
  if (res.failedReads.aIds.length) L.push("", `${aName} failed reads: ${res.failedReads.aIds.join(", ")}`);
  if (res.failedReads.bIds.length) L.push("", `${bName} failed reads: ${res.failedReads.bIds.join(", ")}`);
  L.push("", `Uninformative pages left out (nothing to score in the truth): ${res.uninformative.length}${res.uninformative.length ? ` (${res.uninformative.join(", ")})` : ""}`);
  if (res.skipped.length) L.push("", `Left out: ${res.skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}`);
  return L.join("\n") + "\n";
}

export function parseArgs(argv) {
  const o = { aName: "Plexus", bName: "LlamaParse", gate: "dev", seed: 20261009, foldQuotes: false };
  const val = (i) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${argv[i]} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fold-quotes") o.foldQuotes = true;
    else if (a === "--root") o.root = val(i++);
    else if (a === "--manifest") o.manifest = val(i++);
    else if (a === "--a") o.a = val(i++);
    else if (a === "--b") o.b = val(i++);
    else if (a === "--a-name") o.aName = val(i++);
    else if (a === "--b-name") o.bName = val(i++);
    else if (a === "--gate") o.gate = val(i++);
    else if (a === "--seed") o.seed = Number(val(i++));
    else if (a === "--json") o.json = val(i++);
    else if (a === "--md") o.md = val(i++);
    else throw new Error(`unknown argument ${a}`);
  }
  for (const k of ["root", "manifest", "a", "b"]) if (!o[k]) throw new Error(`--${k} is required`);
  if (!["dev", "sealed"].includes(o.gate)) throw new Error("--gate is dev or sealed");
  if (!Number.isFinite(o.seed)) throw new Error("--seed must be a number");
  return o;
}

function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 2;
    return;
  }
  const manifest = JSON.parse(readFileSync(o.manifest, "utf8"));
  const res = evaluate({ root: o.root, manifest, aDir: o.a, bDir: o.b, foldQuotes: o.foldQuotes, seed: o.seed, gate: o.gate });
  process.stdout.write(table(res, o.aName, o.bName) + "\n");
  if (o.json) writeFileSync(o.json, JSON.stringify({ aName: o.aName, bName: o.bName, args: o, ...res }, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 1));
  if (o.md) writeFileSync(o.md, markdown(res, o.aName, o.bName));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
