#!/usr/bin/env node
// Score, parse and convert for the built-in PDF parse engine (dev only; needs pdfjs-dist for `parse`).
//   node tools/parse-score.mjs score <pxd-parse.json> <truth.json> [report.html]
//   node tools/parse-score.mjs parse <file.pdf> [out.json] [from-to]
//   node tools/parse-score.mjs docling <DoclingDocument.json> [out.json]   (scoring-only conversion)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreDoc } from "../test/parse-metrics.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function doclingToPxd(dd) {
  const pageH = {};
  for (const [k, p] of Object.entries(dd.pages || {})) pageH[Number(k)] = p.size.height;
  const flip = (prov) => {
    const b = prov.bbox; const h = pageH[prov.page_no] || 792;
    return b.coord_origin === "BOTTOMLEFT" ? [b.l, h - b.t, b.r, h - b.b] : [b.l, b.t, b.r, b.b];
  };
  const blocks = {};
  const order = [];
  const removed = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const refOf = (ref) => { const [, kind, idx] = ref.$ref.split("/"); return dd[kind][Number(idx)]; };
  const walk = (children, levelBase) => {
    for (const ch of children || []) {
      const node = refOf(ch);
      if (!node) continue;
      const kind = ch.$ref.split("/")[1];
      if (kind === "groups") { walk(node.children, levelBase); continue; }
      if (kind === "texts") {
        const prov = node.prov && node.prov[0];
        const page = prov ? prov.page_no : 1;
        const bbox = prov ? flip(prov) : [];
        const label = node.label;
        if (label === "page_header" || label === "page_footer") { removed.push({ page, bbox, text: node.text, reason: label === "page_header" ? "running-header" : "running-footer" }); continue; }
        if (label === "section_header" || label === "title") {
          const bid = id("b"); blocks[bid] = { id: bid, type: "heading", level: label === "title" ? 1 : (node.level || 1) + (dd.hasTitle ? 1 : 0), page, bbox, text: node.text, confidence: 0.9, engine: "docling" }; order.push(bid); continue;
        }
        if (label === "list_item") {
          const last = blocks[order[order.length - 1]];
          if (last && last.type === "list") { last.items.push({ text: node.text, level: 0, marker: node.marker || "" }); continue; }
          const lid = id("l"); blocks[lid] = { id: lid, type: "list", ordered: Boolean(node.enumerated), items: [{ text: node.text, level: 0, marker: node.marker || "" }], page, bbox, confidence: 0.9, engine: "docling" }; order.push(lid); continue;
        }
        const type = { caption: "caption", footnote: "footnote", formula: "formula", code: "code" }[label] || "para";
        const bid = id(type === "para" ? "b" : type[0]);
        blocks[bid] = { id: bid, type, page, bbox, text: node.text, confidence: 0.9, engine: "docling" };
        if (type === "formula") blocks[bid].latex = node.text;
        order.push(bid);
        continue;
      }
      if (kind === "tables") {
        const prov = node.prov && node.prov[0];
        const tid = id("t");
        const data = node.data;
        const cells = data.table_cells.map((c) => ({
          r: c.start_row_offset_idx, c: c.start_col_offset_idx, rowSpan: c.row_span, colSpan: c.col_span, text: c.text, header: Boolean(c.column_header), align: "left", numeric: /^[\d.,%()±-]+$/.test(c.text),
        }));
        let headerRows = 0;
        while (cells.some((c) => c.r === headerRows && c.header)) headerRows++;
        let capId = null;
        if (node.captions && node.captions[0]) { const cap = refOf(node.captions[0]); capId = id("c"); blocks[capId] = { id: capId, type: "caption", page: prov ? prov.page_no : 1, bbox: [], text: cap.text, for: tid, confidence: 0.9, engine: "docling" }; order.push(capId); }
        blocks[tid] = { id: tid, type: "table", page: prov ? prov.page_no : 1, bbox: prov ? flip(prov) : [], rows: data.num_rows, cols: data.num_cols, headerRows, headerCols: 0, cells, caption: capId, method: "tableformer", confidence: 0.9, engine: "docling" };
        order.push(tid);
        continue;
      }
      if (kind === "pictures") {
        const prov = node.prov && node.prov[0];
        const fid = id("f");
        let capId = null;
        if (node.captions && node.captions[0]) { const cap = refOf(node.captions[0]); capId = id("c"); blocks[capId] = { id: capId, type: "caption", page: prov ? prov.page_no : 1, bbox: [], text: cap.text, for: fid, confidence: 0.9, engine: "docling" }; }
        blocks[fid] = { id: fid, type: "figure", page: prov ? prov.page_no : 1, bbox: prov ? flip(prov) : [], caption: capId, image: { kind: "crop" }, confidence: 0.9, engine: "docling" };
        order.push(fid);
        if (capId) order.push(capId);
      }
    }
  };
  walk(dd.body.children, 0);
  const pages = Object.keys(pageH).map((k) => ({ n: Number(k), w: dd.pages[k].size.width, h: pageH[k], rotation: 0, kind: "text", parsed: true }));
  return { schema: "pxd-parse/1", sha256: null, engine: "docling", engineVersion: `docling-${dd.version}`, options: {}, createdAt: new Date().toISOString(), pageCount: pages.length, title: null, pages, order, blocks, removed, stats: { ms: 0, perPage: [] } };
}

export function printScore(s) {
  const lines = [];
  for (const t of s.tables) {
    lines.push(`table  ${t.caption.slice(0, 44).padEnd(44)} ${t.matched ? `${t.id} ${t.method}`.padEnd(14) : "MISSING".padEnd(14)} struct F1 ${fmt(t.structure.f1)}  cell F1 ${fmt(t.cells.f1)}  rows ${t.rowsOk ? "ok" : "x"} cols ${t.colsOk ? "ok" : "x"} hdr ${t.headerRowsOk ? "ok" : "x"}`);
    if (t.alignChecks && t.alignChecks.length) lines.push(`       numeric right-aligned: ${t.alignChecks.map((a) => `${a.col}:${a.right ? "ok" : "x"}`).join(" ")}`);
  }
  if (s.extraTables) lines.push(`extra tables: ${s.extraTables}`);
  if (s.headings) lines.push(`headings level accuracy ${fmt(s.headings.accuracy)} (${s.headings.levelOk}/${s.headings.total}, ${s.headings.extra} extra)`);
  if (s.order) lines.push(`reading order tau ${fmt(s.order.tau)} (matched ${s.order.matched}/${s.order.truthCount})`);
  if (s.furniture) lines.push(`furniture removed ${s.furniture.removed}, missing ${s.furniture.missing.length}, leaked ${s.furniture.leaked.length}`);
  if (s.footnotes) lines.push(`footnotes linked ${s.footnotes.linked}/${s.footnotes.total}`);
  lines.push(`pages ${s.pages.join(",")}  blocks ${JSON.stringify(s.counts)}`);
  return lines.join("\n");
}

function fmt(v) { return (Math.round(v * 1000) / 1000).toFixed(3); }

async function main(argv) {
  const [cmd, a, b, c] = argv;
  if (cmd === "score") {
    const doc = JSON.parse(readFileSync(a, "utf8"));
    const truth = JSON.parse(readFileSync(b, "utf8"));
    if (c) {
      const { htmlOrder } = await import("../test/parse-engine-fixtures.js");
      truth.order = htmlOrder(readFileSync(c, "utf8"));
      truth.body = truth.order;
    }
    const s = scoreDoc(doc, truth);
    process.stdout.write(`${printScore(s)}\n`);
    return;
  }
  if (cmd === "parse") {
    const { parseFile } = await import("../test/parse-engine-fixtures.js");
    const range = c ? c.split("-").map(Number) : undefined;
    const doc = await parseFile(a, { pages: range });
    if (b) writeFileSync(b, JSON.stringify(doc, null, 1));
    process.stdout.write(`${a}: ${doc.pages.length} pages, ${doc.order.length} blocks, pure ms/page ${doc.stats.perPage.map((v) => v.toFixed(1)).join(" ")}, adapter ms/page ${doc.stats.adapterMs.map((v) => v.toFixed(0)).join(" ")}\n`);
    return;
  }
  if (cmd === "docling") {
    const out = doclingToPxd(JSON.parse(readFileSync(a, "utf8")));
    if (b) writeFileSync(b, JSON.stringify(out, null, 1));
    process.stdout.write(`${a}: ${out.order.length} blocks\n`);
    return;
  }
  process.stderr.write("usage: parse-score.mjs score <pxd.json> <truth.json> [html] | parse <pdf> [out.json] [from-to] | docling <docling.json> [out.json]\n");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
export { root };
