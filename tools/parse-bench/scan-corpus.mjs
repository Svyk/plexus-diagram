#!/usr/bin/env node
// Scanned technical PDFs, 1900–1950. One command, one scoreboard.
//   node tools/parse-bench/scan-corpus.mjs [--engines builtin,web-ocr,helper] [--only name] [--json out.json] [--dump dir]
// --dump writes <dir>/<engine>/<page id>.pxd.json when that file is not already there.
//
// builtin  — parseFile/assemble on the PDF as shipped (embedded text layer, or a scan block).
// web-ocr  — that parse plus readScan --source ppocr-web (what a user without the helper gets).
// helper   — that parse plus readScan through the local Vision helper CLI.
//
// PDFs and the full truth set live outside the repo (see docs/parse-bench.md). Default root
// is /tmp/wo/pxd14/scans, override with PXD_SCAN_DIR. OCR responses are cached under
// <root>/cache keyed by the OCR sources, so a parse-only change re-scores without re-reading.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleDocument } from "../../src/model/parse/index.js";
import { scanPagesOf } from "../../src/model/parse/ocr-merge.js";
import { readScan } from "../../src/view/parse-engine.js";
import { builtinRecords, cliHelper } from "./scan.mjs";
import { fmt, micro, scorePage } from "./scan-score.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ROOT = "/tmp/wo/pxd14/scans";

function takeArgs(argv) {
  const consumed = new Set();
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    consumed.add(i);
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) consumed.add(i + 1);
    return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  return {
    engines: (flag("--engines") || "builtin,web-ocr,helper").split(",").map((s) => s.trim()).filter(Boolean),
    only: flag("--only"),
    json: flag("--json"),
    dump: flag("--dump"),
  };
}

// One pxd document per page: <dir>/<engine>/<page id>.pxd.json. Existing files are left in place.
export function dumpTarget(dir, engine, id) {
  return join(dir, engine, `${id}.pxd.json`);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashTree(dir) {
  const files = readdirSync(dir).filter((n) => n.endsWith(".js")).sort();
  const h = createHash("sha256");
  for (const name of files) h.update(name).update(readFileSync(join(dir, name)));
  return h.digest("hex").slice(0, 16);
}

function ocrKey(engine) {
  if (engine === "builtin") return "layer";
  const parts = [
    hashTree(join(repo, "src/model/ocr")),
    sha256File(join(repo, "src/host/ocr-web.js")).slice(0, 16),
    sha256File(join(repo, "tools/parse-bench/ppocr-node.mjs")).slice(0, 16),
  ];
  if (engine === "helper") parts.push("vision-cli");
  return parts.join("-");
}

function cacheWrap(helper, cacheDir, stamp) {
  mkdirSync(cacheDir, { recursive: true });
  return {
    async ocr(req) {
      const id = createHash("sha256").update(stamp).update(JSON.stringify({
        pages: req.pages || null,
        cells: (req.cells || []).map((c) => [c.page, c.bbox, Boolean(c.line)]),
      })).digest("hex").slice(0, 24);
      const path = join(cacheDir, `${id}.json`);
      if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
      const body = await helper.ocr(req);
      writeFileSync(path, JSON.stringify(body));
      return body;
    },
  };
}

async function helperFor(engine, pdfPath, cacheDir) {
  if (engine === "builtin") return null;
  const raw = engine === "helper"
    ? cliHelper({ pdfPath, log: (m) => process.stderr.write(`${m}\n`) })
    : (await import("./ppocr-node.mjs")).createPpocrSource({ pdfPath, dpi: 300, log: (m) => process.stderr.write(`${m}\n`) });
  return cacheWrap(raw, cacheDir, `${engine}:${ocrKey(engine)}:${sha256File(pdfPath)}`);
}

async function runEngine(pdfPath, page, engine, cacheDir) {
  const t0 = performance.now();
  const { records, info, numPages, from, to, bytes } = await builtinRecords(pdfPath, { pages: [page, page] });
  const base = assembleDocument(records, { numPages, info, from, to });
  const builtinMs = performance.now() - t0;
  if (engine === "builtin") return { doc: base, ms: builtinMs, builtinMs };
  const helper = await helperFor(engine, pdfPath, cacheDir);
  const wanted = scanPagesOf(base);
  const lexicon = engine === "web-ocr" ? (await import("./ppocr-node.mjs")).loadLexicon() : null;
  const lines = process.env.PXD_OCR_LINES !== "0";
  const result = await readScan({
    helper, bytes, base, records, pages: wanted, numPages, info, from, to, lexicon, lines,
    onPhase: (p) => process.stderr.write(`phase ${JSON.stringify(p)}\n`),
  });
  return { ...result, ms: performance.now() - t0, builtinMs };
}

function classesOf(truth) {
  const c = truth.class;
  return Array.isArray(c) ? c : c ? [c] : ["unclassified"];
}

const DRAW = `
import json, sys
from PIL import Image, ImageDraw
spec = json.loads(sys.stdin.read())
im = Image.open(spec["png"]).convert("RGB")
w, h = im.size
d = ImageDraw.Draw(im)
def rect(box, color):
    if not box or len(box) < 4: return
    d.rectangle([box[0]*w, box[1]*h, box[2]*w, box[3]*h], outline=color, width=3)
for b in spec.get("truth") or []: rect(b, (20, 140, 40))
for b in spec.get("pred") or []: rect(b, (210, 40, 40))
im.save(spec["out"])
`;

function evidence(root, id, engine, pdf, page, truth, scored, doc) {
  const dir = join(root, "out", id);
  mkdirSync(dir, { recursive: true });
  const misses = {
    engine,
    tables: scored.tables ? { f1: scored.tables.f1, structure: scored.tables.structure.f1, extras: scored.tables.extras, misses: scored.tables.misses || [] } : null,
    figures: scored.figures ? { f1: scored.figures.f1, captionRecall: scored.figures.caption.recall, pairs: (scored.figureCounts?.pairs || []).map((p) => ({ iou: p.iou, caption: p.caption, truth: p.truth && p.truth.caption, pred: p.pred && p.pred.caption })) } : null,
    text: scored.text || null,
  };
  writeFileSync(join(dir, `${engine}.json`), JSON.stringify(misses, null, 1));
  const badFig = scored.figures && scored.figures.f1 < 0.999;
  const badTable = scored.tables && (scored.tables.f1 < 0.999 || scored.tables.extras);
  if (!badFig && !badTable) return;
  const png = join(dir, "page.png");
  if (!existsSync(png)) {
    execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-r", "80", "-png", pdf, join(dir, "page")]);
    const made = readdirSync(dir).find((n) => n.startsWith("page-") && n.endsWith(".png"));
    if (made) execFileSync("mv", [join(dir, made), png]);
  }
  if (!existsSync(png)) return;
  const size = (doc.pages || [])[0];
  const pred = (doc.order || []).map((i) => doc.blocks[i]).filter((b) => b && (b.type === "figure" || b.type === "table") && b.bbox);
  const norm = (b) => {
    const box = b.bbox.length === 4 ? b.bbox : [b.bbox.x0, b.bbox.y0, b.bbox.x1, b.bbox.y1];
    const w = size && size.w ? size.w : 1;
    const h = size && size.h ? size.h : 1;
    return Math.max(...box) <= 1.5 ? box : [box[0] / w, box[1] / h, box[2] / w, box[3] / h];
  };
  const spec = {
    png,
    out: join(dir, `${engine}-boxes.png`),
    truth: [...(truth.figures || []).map((f) => f.bbox), ...(truth.tables || []).map((t) => t.bbox).filter(Boolean)],
    pred: pred.map(norm),
  };
  execFileSync("python3", ["-c", DRAW], { input: JSON.stringify(spec) });
}

function add(bucket, key, counts) {
  if (!bucket[key]) bucket[key] = { tp: 0, predN: 0, truthN: 0 };
  bucket[key].tp += counts.tp;
  bucket[key].predN += counts.predN;
  bucket[key].truthN += counts.truthN;
}

function line(cells) {
  return cells.map((c) => String(c).padEnd(10)).join(" ");
}

async function main(argv) {
  const args = takeArgs(argv);
  const root = process.env.PXD_SCAN_DIR || DEFAULT_ROOT;
  const manifestPath = join(repo, "tools/parse-bench/scan-corpus.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pages = manifest.pages.filter((p) => !args.only || p.id.includes(args.only));
  if (!pages.length) { process.stderr.write("no pages\n"); process.exitCode = 2; return; }
  const cacheDir = join(root, "cache");
  const rows = [];
  for (const page of pages) {
    const pdf = join(root, "pdfs", page.file);
    const truthPath = join(root, "truth", `${page.id}.json`);
    if (!existsSync(pdf) || !existsSync(truthPath)) {
      process.stderr.write(`missing ${existsSync(pdf) ? truthPath : pdf}\n`);
      continue;
    }
    const truth = JSON.parse(readFileSync(truthPath, "utf8"));
    for (const engine of args.engines) {
      process.stderr.write(`\n== ${page.id} ${engine}\n`);
      const result = await runEngine(pdf, page.page, engine, cacheDir);
      const scored = scorePage(result.doc, truth);
      scored.id = page.id;
      scored.engine = engine;
      scored.class = classesOf(truth);
      scored.seconds = Math.round(result.ms) / 1000;
      rows.push(scored);
      evidence(root, page.id, engine, pdf, page.page, truth, scored, result.doc);
      if (args.dump) {
        const dumped = dumpTarget(args.dump, engine, page.id);
        if (!existsSync(dumped)) {
          mkdirSync(dirname(dumped), { recursive: true });
          writeFileSync(dumped, JSON.stringify(result.doc));
        }
      }
      const cell = scored.tables ? fmt(scored.tables.f1) : "—";
      const fig = scored.figures ? fmt(scored.figures.f1) : "—";
      process.stderr.write(`  cell ${cell}  fig ${fig}  ${scored.seconds}s\n`);
    }
  }
  const board = summarise(rows, args.engines);
  const text = render(board);
  process.stdout.write(text);
  if (args.json) writeFileSync(args.json, JSON.stringify({ board, rows }, null, 1));
  writeFileSync(join(root, "out", "scoreboard.json"), JSON.stringify({ board, rows }, null, 1));
}

function summarise(rows, engines) {
  const byEngine = {};
  for (const engine of engines) {
    const mine = rows.filter((r) => r.engine === engine);
    const cell = micro(mine, (r) => r.tableCounts && { tp: r.tableCounts.cellTp, predN: r.tableCounts.predN, truthN: r.tableCounts.truthN });
    const cellAt09 = micro(mine, (r) => r.tableCounts && { tp: r.tableCounts.cellSoftTp || 0, predN: r.tableCounts.predN, truthN: r.tableCounts.truthN });
    const structure = micro(mine, (r) => r.tableCounts && { tp: r.tableCounts.structureTp, predN: r.tableCounts.predN, truthN: r.tableCounts.truthN });
    let simSum = 0;
    let simN = 0;
    for (const r of mine) {
      if (!r.tableCounts) continue;
      simSum += r.tableCounts.cellSimSum || 0;
      simN += r.tableCounts.structureTp || 0;
    }
    const figures = micro(mine, (r) => r.figureCounts && { tp: r.figureCounts.hits, predN: r.figureCounts.predN, truthN: r.figureCounts.truthN });
    const captions = micro(mine, (r) => r.figureCounts && { tp: r.figureCounts.linked, predN: r.figureCounts.truthN, truthN: r.figureCounts.truthN });
    let charDist = 0; let charN = 0; let wordDist = 0; let wordN = 0; let matched = 0; let tauSum = 0; let tauN = 0; let seconds = 0; let n = 0;
    const byClass = {};
    for (const r of mine) {
      seconds += r.seconds; n++;
      if (r.textCounts) { charDist += r.textCounts.charDist; charN += r.textCounts.charN; wordDist += r.textCounts.wordDist; wordN += r.textCounts.wordN; matched += r.textCounts.matched; }
      if (r.order && r.order.matched >= 2) { tauSum += r.order.tau; tauN++; }
      for (const cls of r.class) {
        if (!byClass[cls]) byClass[cls] = { cell: { tp: 0, predN: 0, truthN: 0 }, fig: { tp: 0, predN: 0, truthN: 0 }, n: 0 };
        byClass[cls].n++;
        if (r.tableCounts) { byClass[cls].cell.tp += r.tableCounts.cellTp; byClass[cls].cell.predN += r.tableCounts.predN; byClass[cls].cell.truthN += r.tableCounts.truthN; }
        if (r.figureCounts) { byClass[cls].fig.tp += r.figureCounts.hits; byClass[cls].fig.predN += r.figureCounts.predN; byClass[cls].fig.truthN += r.figureCounts.truthN; }
      }
    }
    const worst = [...mine].sort((a, b) => rank(a) - rank(b)).slice(0, 10);
    byEngine[engine] = {
      pages: n,
      cell, cellAt09, cellSim: simN ? Math.round((simSum / simN) * 1000) / 1000 : null, structure, figures,
      captionRecall: captions.recall,
      cer: charN ? Math.round((charDist / charN) * 1000) / 1000 : null,
      wer: wordN ? Math.round((wordDist / wordN) * 1000) / 1000 : null,
      textAccuracy: wordN ? Math.round((matched / wordN) * 1000) / 1000 : null,
      tau: tauN ? Math.round((tauSum / tauN) * 1000) / 1000 : null,
      seconds: Math.round(seconds * 10) / 10,
      secPerPage: n ? Math.round((seconds / n) * 100) / 100 : null,
      byClass, worst,
    };
  }
  return byEngine;
}

function rank(row) {
  const parts = [];
  if (row.tables) parts.push(row.tables.f1);
  if (row.figures) parts.push(row.figures.f1);
  if (row.text) parts.push(1 - row.text.cer);
  if (!parts.length) return 1;
  return parts.reduce((s, n) => s + n, 0) / parts.length;
}

function render(board) {
  const engines = Object.keys(board);
  let out = "Scanned technical PDFs, 1900–1950\n\n";
  out += line(["engine", "pages", "cellF1", "cell@0.9", "cellSim", "structF1", "figF1", "capR", "CER", "WER", "textAcc", "tau", "s/page"]) + "\n";
  for (const engine of engines) {
    const b = board[engine];
    out += line([engine, b.pages, fmt(b.cell.f1), fmt(b.cellAt09.f1), fmt(b.cellSim), fmt(b.structure.f1), fmt(b.figures.f1), fmt(b.captionRecall), fmt(b.cer), fmt(b.wer), fmt(b.textAccuracy), fmt(b.tau), b.secPerPage ?? "—"]) + "\n";
  }
  out += "\nPer class (cell F1 / figure F1)\n";
  const classes = [...new Set(engines.flatMap((e) => Object.keys(board[e].byClass)))].sort();
  out += line(["class", ...engines]) + "\n";
  for (const cls of classes) {
    out += line([cls, ...engines.map((e) => {
      const c = board[e].byClass[cls];
      if (!c) return "—";
      const cell = c.cell.truthN || c.cell.predN ? fmt(micro([{ tableCounts: { cellTp: c.cell.tp, predN: c.cell.predN, truthN: c.cell.truthN } }], (r) => ({ tp: r.tableCounts.cellTp, predN: r.tableCounts.predN, truthN: r.tableCounts.truthN })).f1) : "—";
      const fig = c.fig.truthN || c.fig.predN ? fmt(micro([{ figureCounts: { hits: c.fig.tp, predN: c.fig.predN, truthN: c.fig.truthN } }], (r) => ({ tp: r.figureCounts.hits, predN: r.figureCounts.predN, truthN: r.figureCounts.truthN })).f1) : "—";
      return `${cell}/${fig}`;
    })]) + "\n";
  }
  for (const engine of engines) {
    out += `\nWorst 10, ${engine}\n`;
    for (const w of board[engine].worst) {
      out += `  ${w.id}  cell ${w.tables ? fmt(w.tables.f1) : "—"}  fig ${w.figures ? fmt(w.figures.f1) : "—"}  cer ${w.text ? fmt(w.text.cer) : "—"}  ${w.seconds}s\n`;
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
