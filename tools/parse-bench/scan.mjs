#!/usr/bin/env node
// Scanned-table bench (dev only). Runs the built-in pass, then the same "Read the scan" flow the
// view runs (helper OCR → engine → merge → cell re-read), with the helper's CLI standing in for
// /v1/ocr. Prints the timing, the score against a truth file, and every wrong cell.
//   node tools/parse-bench/scan.mjs <file.pdf> [truth.json] [--out doc.json] [--pages 1-3] [--layer]
// --layer keeps the page's own text layer (no OCR) for the comparison column.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assembleDocument, parsePageGeometry } from "../../src/model/parse/index.js";
import { loadPageData, readScan } from "../../src/view/parse-engine.js";
import { scanPagesOf } from "../../src/model/parse/ocr-merge.js";
import { scoreDoc } from "../../test/parse-metrics.js";
import { printScore } from "../parse-score.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = join(root, "tools/parse-helper/bin/plexus-parse-helper");

export function cliHelper({ pdfPath, log = () => {} }) {
  const dir = mkdtempSync(join(tmpdir(), "pxd-scan-"));
  return {
    async ocr({ pages, cells } = {}) {
      const out = join(dir, cells ? "cells.json" : "pages.json");
      const args = ["ocr", pdfPath, "--json", out];
      if (cells) {
        const req = join(dir, "cells-req.json");
        writeFileSync(req, JSON.stringify(cells.map((c) => ({ page: c.page, bbox: c.bbox }))));
        args.push("--cells", req);
      } else if (pages && pages.length) args.push("--pages", pages.join(","));
      const t0 = performance.now();
      execFileSync(HELPER, args, { stdio: ["ignore", "ignore", "inherit"] });
      log(`helper ${cells ? `cells(${cells.length})` : `pages(${pages.join(",")})`} ${(performance.now() - t0).toFixed(0)} ms`);
      const body = JSON.parse(readFileSync(out, "utf8"));
      if (cells) body.cells = body.cells.map((c, i) => ({ ...cells[i], ...c }));
      return body;
    },
  };
}

export async function builtinRecords(pdfPath, { pages } = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const info = (await doc.getMetadata()).info;
  const [from, to] = pages || [1, doc.numPages];
  const records = [];
  for (let n = from; n <= to; n++) records.push(parsePageGeometry(await loadPageData(await doc.getPage(n)), n));
  const numPages = doc.numPages;
  await doc.destroy();
  return { records, info, numPages, from, to, bytes };
}

export async function runScan(pdfPath, { pages, log = () => {}, layerOnly = false } = {}) {
  const t0 = performance.now();
  const { records, info, numPages, from, to, bytes } = await builtinRecords(pdfPath, { pages });
  const base = assembleDocument(records, { numPages, info, from, to });
  const builtinMs = performance.now() - t0;
  if (layerOnly) return { doc: base, base, ms: builtinMs, builtinMs, pages: [], choices: [], rereads: [] };
  const helper = cliHelper({ pdfPath, log });
  const wanted = scanPagesOf(base);
  const result = await readScan({ helper, bytes, base, records, pages: wanted, numPages, info, from, to, onPhase: (p) => log(`phase ${JSON.stringify(p)}`) });
  return { ...result, base, ms: performance.now() - t0, builtinMs };
}

async function main(argv) {
  const files = argv.filter((a) => !a.startsWith("--"));
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const [pdfPath, truthPath] = files;
  if (!pdfPath) { process.stderr.write("usage: scan.mjs <file.pdf> [truth.json] [--out doc.json] [--pages a-b] [--layer]\n"); process.exitCode = 2; return; }
  const range = flag("--pages") ? flag("--pages").split("-").map(Number) : null;
  const result = await runScan(pdfPath, { pages: range, log: (m) => process.stderr.write(`${m}\n`), layerOnly: argv.includes("--layer") });
  if (flag("--out")) writeFileSync(flag("--out"), JSON.stringify(result.doc, null, 1));
  const tables = result.doc.order.map((id) => result.doc.blocks[id]).filter((b) => b.type === "table");
  process.stdout.write(`${pdfPath}: ${(result.ms / 1000).toFixed(2)} s total (built-in ${(result.builtinMs / 1000).toFixed(2)} s), OCR pages ${result.pages.join(",") || "none"}, tables ${tables.map((t) => `${t.id} ${t.rows}x${t.cols} ${t.method}${t.ocrSource ? ` ${t.ocrSource}` : ""}`).join(", ")}\n`);
  if (result.choices?.length) process.stdout.write(`choices ${JSON.stringify(result.choices)}\n`);
  if (result.rereads?.length) process.stdout.write(`re-read cells ${JSON.stringify(result.rereads)}\n`);
  if (truthPath) {
    const truth = JSON.parse(readFileSync(truthPath, "utf8"));
    process.stdout.write(`${printScore(scoreDoc(result.doc, truth))}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
