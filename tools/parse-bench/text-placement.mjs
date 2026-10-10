// Block-level placement check for page transcriptions (the text score cannot see this).
//   node tools/parse-bench/text-placement.mjs <docs dir> [<docs dir> ...] [--json out.json]
// Docs are scan-corpus.mjs dumps written with PXD_KEEP_VISION=1: doc.ocr.pageReads holds each page
// transcription and its hosts' Vision text in document order. For every host block the tool
// counts how many of its poured words (three or more letters or digits) also appear in that
// block's own Vision text, and how many appear only in a neighbouring host's Vision text.
// Three placements are scored from the same reads: `count` (an equal share of words per host,
// round 1), `align` (placePageText) and `shipped` (the text in the dump).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { placePageText } from "../../src/model/parse/vlm-tables.js";

function keys(text) {
  return (String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]+/gu) || []).filter((k) => k.length >= 3);
}

function pourByCount(text, hosts) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const base = Math.floor(words.length / hosts.length);
  let extra = words.length % hosts.length;
  const out = [];
  let at = 0;
  for (let i = 0; i < hosts.length; i++) {
    const count = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    out.push(words.slice(at, at + count).join(" "));
    at += count;
  }
  return out;
}

// For one page: poured words that sit in their own host's Vision text, in a neighbour's only, or in neither.
export function scorePlacement(parts, hosts) {
  const vision = hosts.map((host) => new Set(keys(host.vision)));
  let own = 0;
  let neighbour = 0;
  let total = 0;
  parts.forEach((part, i) => {
    for (const key of keys(part)) {
      total += 1;
      if (vision[i].has(key)) own += 1;
      else if ((i > 0 && vision[i - 1].has(key)) || (i + 1 < hosts.length && vision[i + 1].has(key))) neighbour += 1;
    }
  });
  return { own, neighbour, total };
}

function add(sum, s) {
  sum.own += s.own;
  sum.neighbour += s.neighbour;
  sum.total += s.total;
}

function fmt(s) {
  const pct = (n) => (s.total ? ((100 * n) / s.total).toFixed(1) : "-");
  return `own ${pct(s.own)}% neighbour ${pct(s.neighbour)}% (${s.total} words)`;
}

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const dirs = args;
if (!dirs.length) {
  console.error("usage: node tools/parse-bench/text-placement.mjs <docs dir> [...] [--json out.json]");
  process.exit(2);
}
const totals = { count: { own: 0, neighbour: 0, total: 0 }, align: { own: 0, neighbour: 0, total: 0 }, shipped: { own: 0, neighbour: 0, total: 0 } };
const pages = [];
for (const dir of dirs) {
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".pxd.json")).sort()) {
    const doc = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const reads = doc?.ocr?.pageReads || [];
    if (!reads.length) continue;
    const row = { id: name.replace(/\.pxd\.json$/, ""), hosts: 0, count: { own: 0, neighbour: 0, total: 0 }, align: { own: 0, neighbour: 0, total: 0 }, shipped: { own: 0, neighbour: 0, total: 0 } };
    for (const read of reads) {
      const hosts = read.hosts || [];
      if (!hosts.length) continue;
      row.hosts += hosts.length;
      add(row.count, scorePlacement(pourByCount(read.text, hosts), hosts));
      add(row.align, scorePlacement(placePageText(read.text, hosts.map((h) => ({ text: h.vision, bbox: doc.blocks?.[h.id]?.bbox }))), hosts));
      add(row.shipped, scorePlacement(hosts.map((h) => doc.blocks?.[h.id]?.text || ""), hosts));
    }
    for (const k of ["count", "align", "shipped"]) add(totals[k], row[k]);
    pages.push(row);
    console.log(`${row.id.padEnd(34)} hosts ${String(row.hosts).padStart(3)}  count: ${fmt(row.count)}  align: ${fmt(row.align)}  shipped: ${fmt(row.shipped)}`);
  }
}
console.log(`\n${pages.length} pages with a page transcription`);
for (const k of ["count", "align", "shipped"]) console.log(`${k.padEnd(8)} ${fmt(totals[k])}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ pages, totals }, null, 1));
