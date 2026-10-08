#!/usr/bin/env node
// ICDAR 2013, rasterised and read by the PP-OCR web source (the text layer is ignored).
//   node tools/parse-bench/icdar2013-scan.mjs <dataset-dir> --dpi 300 [--only eu|us] [--files a,b] [--out json] [--limit N]
// The dataset is not committed. One dpi per run; repeat for 150 and 300.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleDocument, parsePageGeometry } from "../../src/model/parse/index.js";
import { applyCellOcr, cellsToReread } from "../../src/model/parse/ocr-fix.js";
import { evaluateDoc, parseRegions, parseStructure, prf } from "./icdar2013.mjs";
import { createPpocrSource, loadLexicon } from "./ppocr-node.mjs";
import { rereadLines } from "../../src/view/parse-engine.js";

function listDocs(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).sort();
}

async function viewsOf(pdfPath) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0, disableFontFace: true }).promise;
  const views = {};
  for (let n = 1; n <= doc.numPages; n++) views[n] = (await doc.getPage(n)).view;
  const numPages = doc.numPages;
  let info = null;
  try { info = (await doc.getMetadata()).info; } catch { info = null; }
  await doc.destroy();
  return { views, numPages, info };
}

async function ocrDocument(pdfPath, dpi) {
  const { views, numPages, info } = await viewsOf(pdfPath);
  const source = createPpocrSource({ pdfPath, dpi, log: (m) => process.stderr.write(`  ${m}\n`) });
  const pages = Array.from({ length: numPages }, (_, i) => i + 1);
  const t0 = performance.now();
  const got = await source.ocr({ pages });
  const assemble = (ocrPages) => assembleDocument(ocrPages.map((p) => parsePageGeometry(p, p.n)), { numPages, info, options: { ocr: "ppocr-web" }, from: 1, to: numPages });
  let doc = assemble(got.pages || []);
  // Text-line re-read, as readScan runs it (PXD_OCR_LINES=0 for the before column).
  if (process.env.PXD_OCR_LINES !== "0") {
    const lined = await rereadLines({ doc, ocrPages: got.pages || [], ocr: (req) => source.ocr({ cells: req }), lexicon: loadLexicon() });
    if (lined.applied.length) {
      process.stderr.write(`  re-read ${lined.applied.length} lines\n`);
      doc = assemble(lined.pages);
    }
  }
  const tables = doc.order.map((id) => doc.blocks[id]).filter((b) => b && b.type === "table" && b.repairs);
  const requests = tables.flatMap((t) => cellsToReread(t, { numericCols: t.repairs.numericCols }));
  if (requests.length) {
    process.stderr.write(`  re-read ${requests.length} cells\n`);
    const answer = await source.ocr({ cells: requests });
    const results = (answer.cells || []).map((c, i) => ({ ...requests[i], ...c }));
    for (const t of tables) applyCellOcr(t, results.filter((r) => r.id === t.id));
  }
  return { doc, views, ms: performance.now() - t0, pages: numPages };
}

function emptyAgg() {
  return { det: { tp: 0, fp: 0, fn: 0 }, rel: { tp: 0, fp: 0, fn: 0 }, relE2E: { tp: 0, fp: 0, fn: 0 }, cells: { tp: 0, fp: 0, fn: 0 }, pages: 0, ms: 0, docs: 0 };
}

function add(agg, ev, pages, ms) {
  for (const k of ["det", "rel", "relE2E", "cells"]) {
    agg[k].tp += ev[k].tp;
    agg[k].fp += ev[k].fp;
    agg[k].fn += ev[k].fn;
  }
  agg.pages += pages;
  agg.ms += ms;
  agg.docs += 1;
}

function finish(agg) {
  return {
    docs: agg.docs, pages: agg.pages, ms: agg.ms,
    det: prf(agg.det.tp, agg.det.fp, agg.det.fn),
    rel: prf(agg.rel.tp, agg.rel.fp, agg.rel.fn),
    relE2E: prf(agg.relE2E.tp, agg.relE2E.fp, agg.relE2E.fn),
    cells: prf(agg.cells.tp, agg.cells.fp, agg.cells.fn),
  };
}

function takeArgs(argv) {
  const out = { dpi: 300, only: null, files: null, out: null, limit: Infinity };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dpi") out.dpi = Number(argv[++i]);
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--files") out.files = new Set(argv[++i].split(","));
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else rest.push(a);
  }
  out.dataset = rest[0];
  return out;
}

async function main(argv) {
  const args = takeArgs(argv);
  if (!args.dataset) {
    process.stderr.write("usage: icdar2013-scan.mjs <dataset-dir> --dpi 300 [--only eu|us] [--files a,b] [--out json] [--limit N]\n");
    process.exitCode = 2;
    return;
  }
  const splits = [["eu", join(args.dataset, "competition-dataset-eu")], ["us", join(args.dataset, "competition-dataset-us")]].filter(([k]) => !args.only || args.only === k);
  const results = { dpi: args.dpi, engine: "ppocr-web", eu: emptyAgg(), us: emptyAgg(), all: emptyAgg(), docs: [] };
  let seen = 0;
  for (const [split, dir] of splits) {
    if (!existsSync(dir)) continue;
    for (const name of listDocs(dir)) {
      if (args.files && !args.files.has(name)) continue;
      if (seen >= args.limit) break;
      seen += 1;
      const pdfPath = join(dir, `${name}.pdf`);
      const gtRegions = parseRegions(readFileSync(join(dir, `${name}-reg.xml`), "utf8"));
      const gtStructure = parseStructure(readFileSync(join(dir, `${name}-str.xml`), "utf8"));
      process.stderr.write(`${name} dpi ${args.dpi}\n`);
      const run = await ocrDocument(pdfPath, args.dpi);
      const ev = evaluateDoc({ gtRegions, gtStructure, doc: run.doc, views: run.views });
      add(results[split], ev, run.pages, run.ms);
      add(results.all, ev, run.pages, run.ms);
      const row = {
        name, split, pages: run.pages, ms: Math.round(run.ms),
        detF1: prf(ev.det.tp, ev.det.fp, ev.det.fn).f1,
        relF1: prf(ev.rel.tp, ev.rel.fp, ev.rel.fn).f1,
        cellF1: prf(ev.cells.tp, ev.cells.fp, ev.cells.fn).f1,
      };
      results.docs.push(row);
      process.stdout.write(`${name.padEnd(8)} p${String(run.pages).padStart(2)} det ${row.detF1.toFixed(3)} adj ${row.relF1.toFixed(3)} cell ${row.cellF1.toFixed(3)} ${Math.round(run.ms)} ms\n`);
      if (args.out) writeFileSync(args.out, JSON.stringify({ ...results, eu: finish(results.eu), us: finish(results.us), all: finish(results.all) }, null, 1));
    }
  }
  const done = { ...results, eu: finish(results.eu), us: finish(results.us), all: finish(results.all) };
  process.stdout.write(`\ndpi ${args.dpi} adj F1 ${done.all.rel.f1.toFixed(3)} det F1 ${done.all.det.f1.toFixed(3)} cell F1 ${done.all.cells.f1.toFixed(3)} docs ${done.all.docs} ${(done.all.ms / 1000).toFixed(1)} s\n`);
  if (args.out) writeFileSync(args.out, JSON.stringify(done, null, 1));
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
