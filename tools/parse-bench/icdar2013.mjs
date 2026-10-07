#!/usr/bin/env node
// ICDAR 2013 Table Competition benchmark for the built-in parse engine (dev only).
//   node tools/parse-bench/icdar2013.mjs <dataset-dir> [--docling <dir>] [--only eu|us] [--files a,b] [--out <json>] [--dump <dir>]
// <dataset-dir> holds competition-dataset-eu/ and competition-dataset-us/ with <name>.pdf,
// <name>-reg.xml (regions) and <name>-str.xml (cells). The dataset is not committed.
// Metrics: detection (bbox IoU >= 0.5 per page) P/R/F1; structure = ICDAR 2013 adjacency
// relations (Göbel et al.) micro-averaged over GT tables; cell F1 (exact r,c,spans,text).
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePdf } from "../../src/model/parse/index.js";
import { loadPageData } from "../../src/view/parse-engine.js";
import { doclingToPxd } from "../parse-score.mjs";

// ---------- ground truth ----------

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)) out[m[1]] = m[2];
  return out;
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}

// -reg.xml -> [{ id, regions: [{ page, bbox: [x1, y1(bottom), x2, y2(top)] }] }]
export function parseRegions(xml) {
  const tables = [];
  for (const t of xml.matchAll(/<table\s+([^>]*)>([\s\S]*?)<\/table>/g)) {
    const id = attrs(t[1]).id;
    const regions = [];
    for (const r of t[2].matchAll(/<region\s+([^>]*)>([\s\S]*?)<\/region>/g)) {
      const a = attrs(r[1]);
      const bb = /<bounding-box\s+([^>]*)\/>/.exec(r[2]);
      if (!bb) continue;
      const b = attrs(bb[1]);
      regions.push({ page: Number(a.page), bbox: [Number(b.x1), Number(b.y1), Number(b.x2), Number(b.y2)] });
    }
    tables.push({ id, regions });
  }
  return tables;
}

// -str.xml -> [{ id, cells: [{ r, c, r1, c1, text, page }] }]
export function parseStructure(xml) {
  const tables = [];
  for (const t of xml.matchAll(/<table\s+([^>]*)>([\s\S]*?)<\/table>/g)) {
    const id = attrs(t[1]).id;
    const cells = [];
    for (const r of t[2].matchAll(/<region\s+([^>]*)>([\s\S]*?)<\/region>/g)) {
      const ra = attrs(r[1]);
      const page = Number(ra.page);
      const rowInc = Number(ra["row-increment"] || 0);
      const colInc = Number(ra["col-increment"] || 0);
      for (const c of r[2].matchAll(/<cell\s+([^>]*)>([\s\S]*?)<\/cell>/g)) {
        const a = attrs(c[1]);
        const content = /<content>([\s\S]*?)<\/content>/.exec(c[2]);
        const bb = /<bounding-box\s+([^>]*)\/>/.exec(c[2]);
        const b = bb ? attrs(bb[1]) : null;
        const r0 = Number(a["start-row"]) + rowInc;
        const c0 = Number(a["start-col"]) + colInc;
        cells.push({
          r: r0, c: c0,
          r1: a["end-row"] != null ? Number(a["end-row"]) + rowInc : r0,
          c1: a["end-col"] != null ? Number(a["end-col"]) + colInc : c0,
          text: content ? unescapeXml(content[1]) : "",
          page,
          bbox: b ? [Number(b.x1), Number(b.y1), Number(b.x2), Number(b.y2)] : null,
        });
      }
    }
    // US files index from 1, EU from 0: both become 0-based.
    const r0 = Math.min(...cells.map((k) => k.r), 0 + Infinity);
    const c0 = Math.min(...cells.map((k) => k.c), 0 + Infinity);
    for (const k of cells) { k.r -= r0; k.r1 -= r0; k.c -= c0; k.c1 -= c0; }
    tables.push({ id, cells });
  }
  return tables;
}

// ---------- metrics ----------

// The GT itself is inconsistent about spaces ("domestic(%)" for "domestic (%)"), so content
// compares with all whitespace removed after NFKC.
export function normText(s) {
  return (s || "").normalize("NFKC").replace(/\s+/g, "");
}

// cells: [{ r, c, r1, c1, text }] -> Map "a\u0001b\u0001dir" -> count
export function adjacencyRelations(cells) {
  const grid = new Map();
  const norm = cells.map((k) => ({ ...k, text: normText(k.text) }));
  for (const k of norm) {
    for (let r = k.r; r <= k.r1; r++) for (let c = k.c; c <= k.c1; c++) grid.set(`${r}:${c}`, k);
  }
  let maxR = 0; let maxC = 0;
  for (const k of norm) { maxR = Math.max(maxR, k.r1); maxC = Math.max(maxC, k.c1); }
  const rel = new Map();
  const add = (a, b, dir) => { const key = `${a}\u0001${b}\u0001${dir}`; rel.set(key, (rel.get(key) || 0) + 1); };
  for (const k of norm) {
    if (!k.text) continue;
    for (let r = k.r; r <= k.r1; r++) {
      for (let c = k.c1 + 1; c <= maxC; c++) {
        const n = grid.get(`${r}:${c}`);
        if (n && n !== k) { if (n.text) { add(k.text, n.text, "h"); break; } c = n.c1; }
      }
    }
    for (let c = k.c; c <= k.c1; c++) {
      for (let r = k.r1 + 1; r <= maxR; r++) {
        const n = grid.get(`${r}:${c}`);
        if (n && n !== k) { if (n.text) { add(k.text, n.text, "v"); break; } r = n.r1; }
      }
    }
  }
  return rel;
}

export function prf(tp, fp, fn) {
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  const f1 = p + r ? (2 * p * r) / (p + r) : 0;
  return { tp, fp, fn, p, r, f1 };
}

function multisetMatch(a, b) {
  let tp = 0; let fp = 0; let fn = 0;
  for (const [k, n] of a) { const m = b.get(k) || 0; tp += Math.min(n, m); fp += Math.max(0, n - m); }
  for (const [k, m] of b) { const n = a.get(k) || 0; fn += Math.max(0, m - n); }
  return { tp, fp, fn };
}

export function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const u = area(a) + area(b) - inter;
  return u > 0 ? inter / u : 0;
}

function overlapOfPred(pred, gt) {
  const ix = Math.max(0, Math.min(pred[2], gt[2]) - Math.max(pred[0], gt[0]));
  const iy = Math.max(0, Math.min(pred[3], gt[3]) - Math.max(pred[1], gt[1]));
  const a = Math.max(0, pred[2] - pred[0]) * Math.max(0, pred[3] - pred[1]);
  return a > 0 ? (ix * iy) / a : 0;
}

function pxdCells(table) {
  return (table.cells || []).map((k) => ({ r: k.r, c: k.c, r1: k.r + (k.rowSpan || 1) - 1, c1: k.c + (k.colSpan || 1) - 1, text: k.text || "" }));
}

// GT cells of one table (possibly over several regions/pages) vs the predicted tables that
// cover its regions. Predicted tables chained with `continues` count as one.
export function scoreTable(gt, predTables) {
  const gtRel = adjacencyRelations(gt.cells);
  const predRel = new Map();
  for (const t of predTables) for (const [k, n] of adjacencyRelations(pxdCells(t))) predRel.set(k, (predRel.get(k) || 0) + n);
  const rel = multisetMatch(predRel, gtRel);
  // Cell F1: exact placement + text. Several predicted tables (a split) can only match
  // against the first region's indexes; cells of later pieces count as misses.
  const gtKeys = new Map();
  for (const k of gt.cells) { const key = `${k.r}:${k.c}:${k.r1 - k.r + 1}:${k.c1 - k.c + 1}:${normText(k.text)}`; gtKeys.set(key, (gtKeys.get(key) || 0) + 1); }
  const predKeys = new Map();
  let rowOffset = 0;
  for (const t of predTables) {
    for (const k of t.cells || []) { const key = `${k.r + rowOffset}:${k.c}:${k.rowSpan || 1}:${k.colSpan || 1}:${normText(k.text)}`; predKeys.set(key, (predKeys.get(key) || 0) + 1); }
    rowOffset += t.rows || 0;
  }
  const cells = multisetMatch(predKeys, gtKeys);
  return { rel, cells, gtRelations: [...gtRel.values()].reduce((a, b) => a + b, 0), predRelations: [...predRel.values()].reduce((a, b) => a + b, 0) };
}

// ---------- engines ----------

async function pdfjs() { return import("pdfjs-dist/legacy/build/pdf.mjs"); }

export async function runBuiltin(pdfPath) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const views = {};
  const adapterMs = [];
  const t0 = performance.now();
  const parsed = await parsePdf({
    numPages: doc.numPages,
    getPage: async (n) => {
      const t = performance.now();
      const page = await doc.getPage(n);
      views[n] = page.view;
      const d = await loadPageData(page);
      adapterMs.push(performance.now() - t);
      return d;
    },
  });
  const ms = performance.now() - t0;
  await doc.destroy();
  return { doc: parsed, views, ms, pages: doc.numPages };
}

// GT bbox (PDF user space, y up) -> top-left page points like pxd-parse.
function gtToTopLeft(bbox, view, pageH) {
  const [x1, y1, x2, y2] = bbox;
  const ox = view ? view[0] : 0;
  const oy = view ? view[1] : 0;
  return [x1 - ox, pageH - (y2 - oy), x2 - ox, pageH - (y1 - oy)];
}

function tablesOf(doc) {
  return doc.order.map((id) => doc.blocks[id]).filter((b) => b && b.type === "table");
}

// Group predicted tables chained by `continues`.
function chains(tables) {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const head = new Map();
  for (const t of tables) {
    let h = t;
    const seen = new Set();
    while (h.continues && byId.has(h.continues) && !seen.has(h.id)) { seen.add(h.id); h = byId.get(h.continues); }
    head.set(t.id, h.id);
  }
  const groups = new Map();
  for (const t of tables) { const k = head.get(t.id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  return [...groups.values()];
}

export function evaluateDoc({ gtRegions, gtStructure, doc, views }) {
  const pageH = {};
  for (const p of doc.pages) pageH[p.n] = p.h;
  const pred = tablesOf(doc);
  const det = { tp: 0, fp: 0, fn: 0 };
  const matchedPred = new Set();
  const regionPred = new Map(); // gt table id -> Set(pred table)
  const gtRegionsTL = [];
  for (const gt of gtRegions) {
    for (const reg of gt.regions) {
      const h = pageH[reg.page];
      if (h == null) { det.fn++; continue; }
      const box = gtToTopLeft(reg.bbox, views ? views[reg.page] : null, h);
      gtRegionsTL.push({ gt: gt.id, page: reg.page, box });
    }
  }
  const candidates = [];
  for (const g of gtRegionsTL) for (const t of pred) if (t.page === g.page) candidates.push({ g, t, iou: iou(g.box, t.bbox) });
  candidates.sort((a, b) => b.iou - a.iou);
  const usedG = new Set();
  for (const c of candidates) {
    if (c.iou < 0.5 || usedG.has(c.g) || matchedPred.has(c.t)) continue;
    usedG.add(c.g); matchedPred.add(c.t);
    det.tp++;
  }
  det.fn += gtRegionsTL.length - usedG.size;
  det.fp += pred.length - matchedPred.size;
  // Structure: every predicted table whose area lies mostly inside a GT region covers it.
  for (const g of gtRegionsTL) {
    for (const t of pred) {
      if (t.page !== g.page) continue;
      if (overlapOfPred(t.bbox, g.box) >= 0.5 || iou(t.bbox, g.box) >= 0.5) {
        if (!regionPred.has(g.gt)) regionPred.set(g.gt, new Set());
        regionPred.get(g.gt).add(t);
      }
    }
  }
  // Continuation chains: a piece on a later page that continues a matched piece joins it.
  const chainOf = new Map();
  for (const ch of chains(pred)) for (const t of ch) chainOf.set(t, ch);
  const rel = { tp: 0, fp: 0, fn: 0 };
  const cells = { tp: 0, fp: 0, fn: 0 };
  const perTable = [];
  const consumed = new Set();
  for (const gt of gtStructure) {
    const set = regionPred.get(gt.id) || new Set();
    const all = new Set();
    for (const t of set) { all.add(t); for (const o of chainOf.get(t) || []) if (overlapsAnyRegion(o, gtRegionsTL.filter((g) => g.gt === gt.id))) all.add(o); }
    const list = [...all].sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1]);
    for (const t of list) consumed.add(t);
    const s = scoreTable(gt, list);
    rel.tp += s.rel.tp; rel.fp += s.rel.fp; rel.fn += s.rel.fn;
    cells.tp += s.cells.tp; cells.fp += s.cells.fp; cells.fn += s.cells.fn;
    perTable.push({ id: gt.id, pred: list.map((t) => t.id), relF1: prf(s.rel.tp, s.rel.fp, s.rel.fn).f1, cellF1: prf(s.cells.tp, s.cells.fp, s.cells.fn).f1, gtRelations: s.gtRelations, predRelations: s.predRelations, gtCells: gt.cells.length, predCells: list.reduce((n, t) => n + (t.cells || []).length, 0) });
  }
  // End-to-end: relations of unmatched predicted tables are false positives too.
  let extraRel = 0;
  for (const t of pred) if (!consumed.has(t)) extraRel += [...adjacencyRelations(pxdCells(t)).values()].reduce((a, b) => a + b, 0);
  return { det, rel, relE2E: { tp: rel.tp, fp: rel.fp + extraRel, fn: rel.fn }, cells, perTable, predCount: pred.length, gtRegionCount: gtRegionsTL.length };
}

function overlapsAnyRegion(t, regions) {
  return regions.some((g) => g.page === t.page && (overlapOfPred(t.bbox, g.box) >= 0.5 || iou(t.bbox, g.box) >= 0.5));
}

// ---------- driver ----------

function listDocs(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).sort();
}

function sum(agg, part) {
  for (const k of ["det", "rel", "relE2E", "cells"]) { agg[k].tp += part[k].tp; agg[k].fp += part[k].fp; agg[k].fn += part[k].fn; }
}

function emptyAgg() {
  return { det: { tp: 0, fp: 0, fn: 0 }, rel: { tp: 0, fp: 0, fn: 0 }, relE2E: { tp: 0, fp: 0, fn: 0 }, cells: { tp: 0, fp: 0, fn: 0 }, pages: 0, ms: 0, msPerPage: [], docs: 0 };
}

function finish(agg) {
  const sorted = [...agg.msPerPage].sort((a, b) => a - b);
  const median = sorted.length ? sorted[sorted.length >> 1] : 0;
  return { ...agg, det: prf(agg.det.tp, agg.det.fp, agg.det.fn), rel: prf(agg.rel.tp, agg.rel.fp, agg.rel.fn), relE2E: prf(agg.relE2E.tp, agg.relE2E.fp, agg.relE2E.fn), cells: prf(agg.cells.tp, agg.cells.fp, agg.cells.fn), medianMsPerPage: median, msPerPage: undefined };
}

export async function main(argv) {
  const args = [...argv];
  const dataset = args.shift();
  if (!dataset) { process.stderr.write("usage: icdar2013.mjs <dataset-dir> [--docling <dir>] [--only eu|us] [--files a,b] [--out json] [--dump dir]\n"); process.exitCode = 2; return; }
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--docling") opt.docling = args[++i];
    else if (args[i] === "--only") opt.only = args[++i];
    else if (args[i] === "--files") opt.files = new Set(args[++i].split(","));
    else if (args[i] === "--out") opt.out = args[++i];
    else if (args[i] === "--dump") opt.dump = args[++i];
    else if (args[i] === "--quiet") opt.quiet = true;
  }
  const splits = [["eu", join(dataset, "competition-dataset-eu")], ["us", join(dataset, "competition-dataset-us")]].filter(([k]) => !opt.only || opt.only === k);
  const results = { builtin: { eu: emptyAgg(), us: emptyAgg(), all: emptyAgg() }, docling: { eu: emptyAgg(), us: emptyAgg(), all: emptyAgg() }, docs: [] };
  if (opt.dump) mkdirSync(opt.dump, { recursive: true });
  for (const [split, dir] of splits) {
    if (!existsSync(dir)) continue;
    for (const name of listDocs(dir)) {
      if (opt.files && !opt.files.has(name)) continue;
      const gtRegions = parseRegions(readFileSync(join(dir, `${name}-reg.xml`), "utf8"));
      const gtStructure = parseStructure(readFileSync(join(dir, `${name}-str.xml`), "utf8"));
      const run = await runBuiltin(join(dir, `${name}.pdf`));
      if (opt.dump) writeFileSync(join(opt.dump, `${name}.pxd.json`), JSON.stringify(run.doc, null, 1));
      const ev = evaluateDoc({ gtRegions, gtStructure, doc: run.doc, views: run.views });
      for (const k of [split, "all"]) { sum(results.builtin[k], ev); results.builtin[k].pages += run.pages; results.builtin[k].ms += run.ms; results.builtin[k].msPerPage.push(run.ms / run.pages); results.builtin[k].docs++; }
      const row = { name, split, pages: run.pages, builtin: { det: ev.det, rel: prf(ev.rel.tp, ev.rel.fp, ev.rel.fn), cells: prf(ev.cells.tp, ev.cells.fp, ev.cells.fn), perTable: ev.perTable, predCount: ev.predCount, gtRegionCount: ev.gtRegionCount, ms: Math.round(run.ms) } };
      if (opt.docling) {
        const dj = join(opt.docling, `${name}.json`);
        if (existsSync(dj)) {
          const dd = doclingToPxd(JSON.parse(readFileSync(dj, "utf8")));
          const evd = evaluateDoc({ gtRegions, gtStructure, doc: dd, views: run.views });
          for (const k of [split, "all"]) { sum(results.docling[k], evd); results.docling[k].pages += run.pages; results.docling[k].docs++; }
          row.docling = { det: evd.det, rel: prf(evd.rel.tp, evd.rel.fp, evd.rel.fn), cells: prf(evd.cells.tp, evd.cells.fp, evd.cells.fn), perTable: evd.perTable, predCount: evd.predCount };
        } else row.docling = null;
      }
      results.docs.push(row);
      if (!opt.quiet) {
        const f = (x) => x.toFixed(3);
        const d = row.docling ? `  | docling det ${row.docling.det.tp}/${row.docling.det.fp}/${row.docling.det.fn} rel ${f(row.docling.rel.f1)} cell ${f(row.docling.cells.f1)}` : "";
        process.stdout.write(`${name.padEnd(8)} p${String(run.pages).padStart(2)} gt ${String(ev.gtRegionCount).padStart(2)} pred ${String(ev.predCount).padStart(2)}  det tp/fp/fn ${ev.det.tp}/${ev.det.fp}/${ev.det.fn}  rel F1 ${f(row.builtin.rel.f1)}  cell F1 ${f(row.builtin.cells.f1)}  ${String(Math.round(run.ms)).padStart(5)} ms${d}\n`);
      }
    }
  }
  for (const eng of ["builtin", "docling"]) for (const k of ["eu", "us", "all"]) results[eng][k] = finish(results[eng][k]);
  process.stdout.write(`\n${formatTable(results)}\n`);
  if (opt.out) writeFileSync(opt.out, JSON.stringify(results, null, 1));
  return results;
}

export function formatTable(results) {
  const f = (x) => x.toFixed(3);
  const lines = ["| Split | Engine | Docs | GT regions | Det P | Det R | Det F1 | Adj P | Adj R | Adj F1 | Adj F1 (e2e) | Cell F1 | ms/page (median) | total s |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const k of ["eu", "us", "all"]) {
    for (const eng of ["builtin", "docling"]) {
      const r = results[eng][k];
      if (!r.docs) continue;
      lines.push(`| ${k.toUpperCase()} | ${eng === "builtin" ? "Built-in" : "Docling 2.91"} | ${r.docs} | ${r.det.tp + r.det.fn} | ${f(r.det.p)} | ${f(r.det.r)} | ${f(r.det.f1)} | ${f(r.rel.p)} | ${f(r.rel.r)} | ${f(r.rel.f1)} | ${f(r.relE2E.f1)} | ${f(r.cells.f1)} | ${eng === "builtin" ? r.medianMsPerPage.toFixed(1) : "n/a"} | ${eng === "builtin" ? (r.ms / 1000).toFixed(1) : "n/a"} |`);
    }
  }
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
