#!/usr/bin/env node
// Table-structure bench. Does not edit the scorer: it calls scorePage.
//   node tools/parse-bench/table-structure.mjs prepare [pack.json]
//   node tools/parse-bench/table-structure.mjs score results.json
//
// prepare writes one record per truth page that has tables: Vision words (cached helper
// OCR), rule-assembly tables, and the lattice/stream boxes our detector would crop.
// score reads model output { id, engine, seconds, tables: [{ page, bbox, rows, cols, cells }] }
// and fills cells from those words.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleDocument, parsePageGeometry } from "../../src/model/parse/index.js";
import { tableFromStructure, wordsFromOcrPage } from "../../src/model/parse/table-structure.js";
import { normText } from "../../test/parse-metrics.js";
import { cellKey, levenshtein, scorePage } from "./scan-score.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROOT = process.env.PXD_SCAN_DIR || "/tmp/wo/pxd14/scans";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashTree(dir) {
  const files = readdirSync(dir).filter((n) => n.endsWith(".js")).sort();
  const h = createHash("sha256");
  for (const name of files) h.update(name).update(readFileSync(join(dir, name)));
  return h.digest("hex").slice(0, 16);
}

function ocrKey() {
  return [
    hashTree(join(repo, "src/model/ocr")),
    sha256File(join(repo, "src/host/ocr-web.js")).slice(0, 16),
    sha256File(join(repo, "tools/parse-bench/ppocr-node.mjs")).slice(0, 16),
    "vision-cli",
  ].join("-");
}

function cachePath(pdfPath, page) {
  const stamp = `helper:${ocrKey()}:${sha256File(pdfPath)}`;
  const id = createHash("sha256").update(stamp).update(JSON.stringify({ pages: [page], cells: [] })).digest("hex").slice(0, 24);
  return join(ROOT, "cache", `${id}.json`);
}

function tablePages() {
  const manifest = JSON.parse(readFileSync(join(repo, "tools/parse-bench/scan-corpus.json"), "utf8"));
  const out = [];
  for (const page of manifest.pages) {
    const truthPath = join(ROOT, "truth", `${page.id}.json`);
    if (!existsSync(truthPath)) continue;
    const truth = JSON.parse(readFileSync(truthPath, "utf8"));
    if (!(truth.tables || []).length) continue;
    out.push({ ...page, truth });
  }
  return out;
}

function llamaBoxes(page) {
  const path = join("/tmp/wo/pxd14/cloud-out/llamaparse", `${page.file}.p${page.page}.llamaparse.pxd.json`);
  if (!existsSync(path)) return [];
  const doc = JSON.parse(readFileSync(path, "utf8"));
  return Object.values(doc.blocks || [])
    .filter((b) => b && b.type === "table" && b.page === page.page && b.bbox)
    .map((b) => b.bbox);
}

export function preparePack() {
  const pages = [];
  for (const page of tablePages()) {
    const pdf = join(ROOT, "pdfs", page.file);
    const cached = cachePath(pdf, page.page);
    if (!existsSync(cached)) throw new Error(`missing vision cache ${page.id} ${cached}`);
    const body = JSON.parse(readFileSync(cached, "utf8"));
    const record = (body.pages || []).find((p) => p.n === page.page) || body.pages?.[0];
    if (!record) throw new Error(`no ocr page ${page.id}`);
    const geometry = parsePageGeometry(record, page.page);
    const doc = assembleDocument([geometry], {
      numPages: body.pageCount || page.page,
      from: page.page,
      to: page.page,
      options: { ocr: "vision" },
    });
    const words = wordsFromOcrPage(record);
    // Stream tables are found while the document is assembled, so the crop is the
    // table the rule pass actually kept, not only the lattice list on the page record.
    const detector = (doc.order || [])
      .map((id) => doc.blocks[id])
      .filter((b) => b && b.type === "table" && b.bbox)
      .map((b) => (Array.isArray(b.bbox) ? b.bbox : [b.bbox.x0, b.bbox.y0, b.bbox.x1, b.bbox.y1]));
    pages.push({
      id: page.id,
      file: page.file,
      page: page.page,
      pdf,
      w: record.w,
      h: record.h,
      deskew: record.deskew || 0,
      words,
      detector,
      oracle: llamaBoxes(page),
      rulesDoc: doc,
    });
  }
  return { built: new Date().toISOString(), pages };
}

function docFromTables(page, tables) {
  const blocks = {};
  const order = [];
  tables.forEach((t, i) => {
    const id = `m${i}`;
    blocks[id] = { ...t, id, type: "table", page: page.page };
    order.push(id);
  });
  return { order, blocks, pages: [{ n: page.page, w: page.w, h: page.h }] };
}

function cellSimOf(doc, truth) {
  const preds = (doc.order || []).map((id) => doc.blocks[id]).filter((b) => b && b.type === "table");
  let sim = 0;
  let n = 0;
  const used = new Set();
  for (const t of truth.tables || []) {
    let best = null;
    for (const p of preds) {
      if (used.has(p.id)) continue;
      const score = jaccardText(p, t);
      if (!best || score > best.score) best = { p, score };
    }
    const pred = best && best.score > 0.2 ? best.p : null;
    if (pred) used.add(pred.id);
    const byKey = new Map((pred?.cells || []).map((c) => [cellKey(c), c]));
    for (const cell of t.cells || []) {
      if (cell.unsure) continue;
      n++;
      const hit = byKey.get(cellKey(cell));
      if (!hit) continue;
      const a = normText(cell.text).replace(/ /g, "");
      const b = normText(hit.text).replace(/ /g, "");
      const denom = Math.max(a.length, b.length, 1);
      sim += 1 - levenshtein(a, b) / denom;
    }
  }
  return n ? sim / n : 0;
}

function jaccardText(pred, truth) {
  const A = new Set((pred.cells || []).map((c) => normText(c.text)).filter(Boolean));
  const B = new Set((truth.cells || []).filter((c) => !c.unsure).map((c) => normText(c.text)).filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function micro(rows) {
  let cellTp = 0;
  let structureTp = 0;
  let predN = 0;
  let truthN = 0;
  let sim = 0;
  let simN = 0;
  let seconds = 0;
  let tables = 0;
  for (const row of rows) {
    const c = row.tableCounts;
    if (!c) continue;
    cellTp += c.cellTp;
    structureTp += c.structureTp;
    predN += c.predN;
    truthN += c.truthN;
    sim += row.cellSim * (c.truthN || 0);
    simN += c.truthN || 0;
    seconds += row.seconds || 0;
    tables += row.nTables || 0;
  }
  const f1 = (tp) => {
    const precision = predN ? tp / predN : 0;
    const recall = truthN ? tp / truthN : 0;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  };
  return {
    cellF1: f1(cellTp),
    structureF1: f1(structureTp),
    cellSim: simN ? sim / simN : 0,
    seconds,
    secPerTable: tables ? seconds / tables : 0,
    predN,
    truthN,
    tables,
  };
}

export function scoreResults(pack, results) {
  const byId = new Map(pack.pages.map((p) => [p.id, p]));
  const rows = [];
  for (const result of results) {
    const page = byId.get(result.id);
    if (!page) continue;
    const truth = JSON.parse(readFileSync(join(ROOT, "truth", `${page.id}.json`), "utf8"));
    let doc;
    if (result.engine === "rules") doc = page.rulesDoc;
    else {
      const tables = (result.tables || []).map((structure, i) => tableFromStructure(structure, page.words, { id: `m${i}`, method: result.engine }));
      doc = docFromTables(page, tables);
    }
    const scored = scorePage(doc, truth);
    rows.push({
      id: page.id,
      engine: result.engine,
      region: result.region || (result.engine === "rules" ? "detector" : null),
      seconds: result.seconds || 0,
      nTables: (result.tables || page.detector || []).length,
      cellF1: scored.tables?.f1 ?? null,
      structureF1: scored.tables?.structure?.f1 ?? null,
      cellSim: cellSimOf(doc, truth),
      tableCounts: scored.tableCounts,
      per: scored.tables?.per || [],
    });
  }
  return rows;
}

function fmt(n) {
  return n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(3);
}

function render(rows) {
  const engines = [...new Set(rows.map((r) => `${r.engine}${r.region ? `/${r.region}` : ""}`))];
  const lines = ["engine            region     cellF1  structF1  cellSim  sec/table  tables"];
  for (const key of engines) {
    const [engine, region] = key.split("/");
    const mine = rows.filter((r) => r.engine === engine && (r.region || "") === (region || ""));
    const m = micro(mine);
    lines.push([
      engine.padEnd(16),
      (region || "—").padEnd(10),
      fmt(m.cellF1).padStart(6),
      fmt(m.structureF1).padStart(8),
      fmt(m.cellSim).padStart(8),
      fmt(m.secPerTable).padStart(9),
      String(m.tables).padStart(7),
    ].join("  "));
  }
  return lines.join("\n");
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === "prepare") {
    const pack = preparePack();
    const out = argv[1] || "/tmp/pxd-table-bench/pack.json";
    mkdirSync(dirname(out), { recursive: true });
    const slim = {
      ...pack,
      pages: pack.pages.map((p) => ({ ...p, rulesDoc: undefined, rulesTables: (p.rulesDoc.order || []).map((id) => p.rulesDoc.blocks[id]).filter((b) => b?.type === "table").length })),
    };
    // Keep the full pack: the score step needs rulesDoc. It is local, not committed.
    writeFileSync(out, JSON.stringify(pack));
    process.stdout.write(`prepared ${pack.pages.length} pages, ${pack.pages.reduce((n, p) => n + p.detector.length, 0)} detector boxes, ${pack.pages.reduce((n, p) => n + p.oracle.length, 0)} oracle boxes → ${out}\n`);
    process.stdout.write(`words ${pack.pages.reduce((n, p) => n + p.words.length, 0)} rules tables ${slim.pages.reduce((n, p) => n + p.rulesTables, 0)}\n`);
    return;
  }
  if (cmd === "score") {
    const pack = JSON.parse(readFileSync(argv[1] || "/tmp/pxd-table-bench/pack.json", "utf8"));
    const results = JSON.parse(readFileSync(argv[2] || "/tmp/pxd-table-bench/results.json", "utf8"));
    const rules = pack.pages.map((p) => ({ id: p.id, engine: "rules", region: "detector", seconds: 0, tables: p.detector.map((bbox) => ({ bbox })) }));
    const rows = scoreResults(pack, [...rules, ...results]);
    const out = argv[3] || "/tmp/pxd-table-bench/score.json";
    writeFileSync(out, JSON.stringify(rows, null, 1));
    process.stdout.write(`${render(rows)}\n`);
    return;
  }
  process.stderr.write("usage: table-structure.mjs prepare [pack.json] | score [pack.json] [results.json]\n");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
