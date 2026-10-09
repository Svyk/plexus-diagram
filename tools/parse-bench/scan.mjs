#!/usr/bin/env node
// Scanned-table bench (dev only). Runs the built-in pass, then the same "Read the scan" flow the
// view runs (helper OCR → engine → merge → cell re-read), with the helper's CLI standing in for
// /v1/ocr. Prints the timing, the score against a truth file, and every wrong cell.
//   node tools/parse-bench/scan.mjs <file.pdf> [truth.json] [--out doc.json] [--pages 1-3] [--layer] [--source vision|ppocr-web] [--text lines.json|src.html] [--helper-url http://127.0.0.1:48766] [--helper-token TOKEN] [--vlm]
// --helper-url posts the PDF to that helper's /v1/ocr instead of the Python CLI. The token is
// --helper-token, else $PXD_HELPER_TOKEN, else ~/Library/Application Support/plexus-parse-helper/token.
// --vlm is the High accuracy path: the helper client's vlm() posts /v1/vlm. It needs --helper-url.
// --text scores the words outside tables against a list of lines (tools/parse-bench/text-lines.mjs).
// PXD_OCR_LINES=0 skips the text-line re-read (the before column).
// --layer keeps the page's own text layer (no OCR) for the comparison column.
// --source ppocr-web runs the in-browser models through onnxruntime-node. Default stays vision.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createHelperClient } from "../../src/host/parse-helper-client.js";
import { assembleDocument, parsePageGeometry } from "../../src/model/parse/index.js";
import { loadPageData, readScan } from "../../src/view/parse-engine.js";
import { scanPagesOf } from "../../src/model/parse/ocr-merge.js";
import { scoreDoc } from "../../test/parse-metrics.js";
import { printScore } from "../parse-score.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = join(root, "tools/parse-helper/bin/plexus-parse-helper");

export function httpHelper({ pdfPath, url, token, log = () => {} }) {
  const base = String(url).replace(/\/$/, "");
  return {
    async ocr({ pages, cells } = {}) {
      const bytes = readFileSync(pdfPath);
      const options = {};
      if (cells) options.cells = cells.map((c) => ({ page: c.page, bbox: c.bbox }));
      else if (pages && pages.length) options.pages = pages;
      const t0 = performance.now();
      const res = await fetch(`${base}/v1/ocr`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/pdf",
          "X-Pxd-Options": JSON.stringify(options),
        },
        body: bytes,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `ocr ${res.status}`);
      log(`helper ${cells ? `cells(${cells.length})` : `pages(${(pages || []).join(",")})`} ${(performance.now() - t0).toFixed(0)} ms`);
      if (cells) body.cells = body.cells.map((c, i) => ({ ...cells[i], ...c }));
      return body;
    },
  };
}

// High accuracy through the same client the pane uses. Node's fetch rejects
// `targetAddressSpace`, so that browser-only field is stripped here.
export function vlmHelper({ url, token, fetchImpl = globalThis.fetch } = {}) {
  const client = createHelperClient({
    fetch: (input, init = {}) => {
      const rest = { ...init };
      delete rest.targetAddressSpace;
      return fetchImpl(input, rest);
    },
    settings: { "parse-helper-url": url, "parse-helper-token": token },
  });
  return {
    vlmHigh: true,
    vlm(req) { return client.vlm(req); },
  };
}

export function readHelperToken(explicit) {
  if (explicit) return String(explicit).trim();
  if (process.env.PXD_HELPER_TOKEN) return process.env.PXD_HELPER_TOKEN.trim();
  return readFileSync(join(homedir(), "Library/Application Support/plexus-parse-helper/token"), "utf8").trim();
}

export function cliHelper({ pdfPath, log = () => {}, bin = HELPER } = {}) {
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
      execFileSync(bin, args, { stdio: ["ignore", "ignore", "inherit"] });
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

async function sourceHelper(pdfPath, source, log, helper) {
  if (helper?.url) return httpHelper({ pdfPath, url: helper.url, token: helper.token, log });
  if (!source || source === "vision") return cliHelper({ pdfPath, log });
  if (source === "ppocr-web") {
    const { createPpocrSource } = await import("./ppocr-node.mjs");
    return createPpocrSource({ pdfPath, dpi: 300, log });
  }
  throw new Error(`unknown ocr source ${source}`);
}

export async function runScan(pdfPath, { pages, log = () => {}, layerOnly = false, source = "vision", helper = null, vlm = false } = {}) {
  const t0 = performance.now();
  const { records, info, numPages, from, to, bytes } = await builtinRecords(pdfPath, { pages });
  const base = assembleDocument(records, { numPages, info, from, to });
  const builtinMs = performance.now() - t0;
  if (layerOnly) return { doc: base, base, ms: builtinMs, builtinMs, pages: [], choices: [], rereads: [], source };
  const ocrSource = await sourceHelper(pdfPath, source, log, helper);
  if (vlm) {
    if (!helper?.url) throw new Error("--vlm needs --helper-url");
    const high = vlmHelper({ url: helper.url, token: helper.token });
    ocrSource.vlm = (req) => high.vlm(req);
    ocrSource.vlmHigh = true;
  }
  const wanted = scanPagesOf(base);
  const lines = process.env.PXD_OCR_LINES !== "0";
  const lexicon = lines && source === "ppocr-web" ? (await import("./ppocr-node.mjs")).loadLexicon() : null;
  const result = await readScan({ helper: ocrSource, bytes, base, records, pages: wanted, numPages, info, from, to, lexicon, lines, onPhase: (p) => log(`phase ${JSON.stringify(p)}`) });
  return { ...result, base, ms: performance.now() - t0, builtinMs, source };
}

export function takeArgs(argv) {
  const consumed = new Set();
  const flag = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    consumed.add(i);
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) consumed.add(i + 1);
    return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const source = flag("--source") || "vision";
  const text = flag("--text");
  const out = flag("--out");
  const pages = flag("--pages");
  const helperUrl = flag("--helper-url");
  const helperToken = flag("--helper-token");
  if (argv.includes("--layer")) consumed.add(argv.indexOf("--layer"));
  if (argv.includes("--vlm")) consumed.add(argv.indexOf("--vlm"));
  const files = argv.filter((a, i) => !consumed.has(i) && !a.startsWith("--"));
  return { files, source, out, pages, text, helperUrl, helperToken, layer: argv.includes("--layer"), vlm: argv.includes("--vlm") };
}

async function main(argv) {
  const args = takeArgs(argv);
  const [pdfPath, truthPath] = args.files;
  if (!pdfPath) { process.stderr.write("usage: scan.mjs <file.pdf> [truth.json] [--out doc.json] [--pages a-b] [--layer] [--vlm] [--source vision|ppocr-web] [--helper-url URL]\n"); process.exitCode = 2; return; }
  const range = args.pages ? args.pages.split("-").map(Number) : null;
  const helper = args.helperUrl ? { url: args.helperUrl, token: readHelperToken(args.helperToken) } : null;
  const result = await runScan(pdfPath, { pages: range, log: (m) => process.stderr.write(`${m}\n`), layerOnly: args.layer, source: args.source, helper, vlm: args.vlm });
  if (args.out) writeFileSync(args.out, JSON.stringify(result.doc, null, 1));
  const tables = result.doc.order.map((id) => result.doc.blocks[id]).filter((b) => b.type === "table");
  process.stdout.write(`${pdfPath}: ocrSource ${args.source}, ${(result.ms / 1000).toFixed(2)} s total (built-in ${(result.builtinMs / 1000).toFixed(2)} s), OCR pages ${result.pages.join(",") || "none"}, tables ${tables.map((t) => `${t.id} ${t.rows}x${t.cols} ${t.method}${t.ocrSource ? ` ${t.ocrSource}` : ""}`).join(", ")}\n`);
  if (result.choices?.length) process.stdout.write(`choices ${JSON.stringify(result.choices)}\n`);
  if (result.rereads?.length) process.stdout.write(`re-read cells ${JSON.stringify(result.rereads)}\n`);
  if (result.lines?.length) process.stdout.write(`re-read lines ${JSON.stringify(result.lines)}\n`);
  if (truthPath) {
    const truth = JSON.parse(readFileSync(truthPath, "utf8"));
    process.stdout.write(`${printScore(scoreDoc(result.doc, truth))}\n`);
  }
  if (args.text) {
    const { scoreTextLines, textTruth } = await import("./text-lines.mjs");
    const s = scoreTextLines(result.doc, textTruth(args.text));
    process.stdout.write(`text lines word accuracy ${s.accuracy.toFixed(3)} (${s.matched}/${s.words}), exact lines ${s.exact}/${s.lines}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
