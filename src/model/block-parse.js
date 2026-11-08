// "Plexus: Parse PDF" on a normal block: what counts as a PDF block, the marker left on the result, and
// the plan of what to write under the block. Pure: no host, no DOM, no writes.

import { pdfMacroUrl } from "./pdf.js";
import { selectBlocks } from "./parse-schema.js";
import { toRoamMarkdown } from "./parse-to-roam-md.js";
import { parsedTableCaption } from "./roam-table.js";
import { plainKeys } from "./schema.js";

export const BLOCK_PARSE_LABEL = "Plexus: Parse PDF";
export const PARSED_PROP = "plexus-parsed-pdf";
export const BLOCK_PARSE_CHUNK = 400;
export const BLOCK_PARSE_CAP = 4000;

const URL_TOKEN = /https?:\/\/[^\s<>"'`]+/g;
const PDF_PATH = /\.pdf(?:\.enc)?$/i;

function isPdfPath(url) {
  const bare = url.split(/[?#]/, 1)[0];
  let decoded = bare;
  try { decoded = decodeURIComponent(bare); } catch { /* keep the raw path */ }
  return PDF_PATH.test(bare) || PDF_PATH.test(decoded);
}

export function pdfSourceOf(string) {
  if (typeof string !== "string" || !string) return null;
  const macro = pdfMacroUrl(string);
  if (macro) return { url: macro, kind: "pdf" };
  for (const match of string.matchAll(URL_TOKEN)) {
    const url = match[0].replace(/[)\]]+$/, "");
    if (url && isPdfPath(url)) return { url, kind: "link" };
  }
  return null;
}

export function parsedMarker({ url, sha256, from, to, pageCount, highlights, at } = {}) {
  return {
    [PARSED_PROP]: {
      v: 1,
      url: url ?? "",
      sha256: sha256 ?? "",
      from: from ?? null,
      to: to ?? null,
      pageCount: pageCount ?? null,
      highlights: Boolean(highlights),
      at: at ?? null,
    },
  };
}

export function parsedOf(props) {
  if (!props || typeof props !== "object") return null;
  const raw = props[PARSED_PROP] ?? props[`:${PARSED_PROP}`];
  if (!raw || typeof raw !== "object") return null;
  const flat = plainKeys(raw);
  return flat && typeof flat === "object" ? flat : null;
}

export function containerString({ from, to, pageCount } = {}) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return "Parsed PDF";
  if (a === b) return `Parsed PDF · page ${a}`;
  if (a === 1 && Number.isInteger(pageCount) && b === pageCount) return `Parsed PDF · ${pageCount} pages`;
  return `Parsed PDF · pages ${a}–${b}`;
}

function pageNumber(text) {
  const t = String(text ?? "").trim();
  if (!t) return { blank: true };
  if (!/^\d+$/.test(t)) return { bad: true };
  return { n: Number(t) };
}

export function parsePageRange(fromText, toText, pageCount) {
  const known = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null;
  const a = pageNumber(fromText);
  const b = pageNumber(toText);
  if (a.bad || b.bad || a.n === 0 || b.n === 0) return { ok: false, error: "Enter page numbers as whole numbers" };
  if (a.blank && b.blank) return { ok: true, whole: true, from: 1, to: known };
  let from = a.blank ? 1 : a.n;
  let to = b.blank ? known : b.n;
  if (known) {
    from = Math.min(Math.max(from, 1), known);
    if (to != null) to = Math.min(Math.max(to, 1), known);
  }
  if (to == null) return { ok: true, whole: false, from, to: null };
  if (from > to) return { ok: false, error: "First page is after the last page" };
  return { ok: true, whole: Boolean(known) && from === 1 && to === known, from, to };
}

function bulletCount(markdown) {
  return (String(markdown ?? "").match(/^\s*- /gm) || []).length;
}

function topLevelTrees(markdown) {
  const trees = [];
  let current = null;
  for (const line of String(markdown ?? "").split("\n")) {
    if (/^- /.test(line)) {
      current = [line];
      trees.push(current);
    } else if (current) current.push(line);
  }
  return trees;
}

// Same rule as the board's parse insert: a top-level tree is never split.
function chunkMarkdown(markdown) {
  const chunks = [];
  let buf = [];
  let count = 0;
  for (const tree of topLevelTrees(markdown)) {
    const n = tree.filter((line) => /^\s*- /.test(line)).length;
    if (count > 0 && count + n > BLOCK_PARSE_CHUNK) {
      chunks.push(buf.join("\n"));
      buf = [];
      count = 0;
    }
    buf.push(...tree);
    count += n;
  }
  if (buf.length) chunks.push(buf.join("\n"));
  return chunks;
}

export function planBlockParse(doc, { from = null, to = null } = {}) {
  const lo = from ?? 1;
  const hi = to ?? (Number.isInteger(doc?.pageCount) && doc.pageCount > 0 ? doc.pageCount : Number.MAX_SAFE_INTEGER);
  const blocks = selectBlocks(doc, [lo, hi]);
  const tableIds = new Set(blocks.filter((b) => b.type === "table").map((b) => b.id));
  const captionIds = new Set();
  for (const b of blocks) {
    if (b.type === "table" && typeof b.caption === "string" && b.caption) captionIds.add(b.caption);
    if (b.type === "caption" && b.for && tableIds.has(b.for)) captionIds.add(b.id);
  }
  const steps = [];
  let blockTotal = 0;
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const { markdown } = toRoamMarkdown(doc, run, { footnoteFormat: "plain" });
    run = [];
    for (const chunk of chunkMarkdown(markdown)) {
      steps.push({ kind: "md", markdown: chunk });
      blockTotal += bulletCount(chunk);
    }
  };
  for (const b of blocks) {
    if (b.type === "table") {
      flush();
      steps.push({ kind: "table", table: b, caption: parsedTableCaption(b, doc) });
      blockTotal += (Number(b.rows) || 0) * (Number(b.cols) || 0) + 2;
    } else if (!captionIds.has(b.id)) {
      run.push(b.id);
    }
  }
  flush();
  if (blockTotal > BLOCK_PARSE_CAP) return { ok: false, reason: "too-large" };
  return { ok: true, steps, blocks: blockTotal };
}

export function highlightRefLines(rows, from, to) {
  const lo = from ?? 1;
  const hi = to ?? Number.MAX_SAFE_INTEGER;
  const uids = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row.uid === "string" && row.uid && (row.page == null || (row.page >= lo && row.page <= hi)))
    .map((row) => row.uid);
  if (!uids.length) return "";
  return ["- Highlights", ...uids.map((uid) => `  - ((${uid}))`)].join("\n");
}

function pageList(pages) {
  if (pages.length === 1) return String(pages[0]);
  return `${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
}

export function scanNote(pages, { helper = false } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) return "";
  const head = list.length === 1
    ? `Page ${list[0]} is a scan and needs OCR, so it was left as a placeholder.`
    : `Pages ${pageList(list)} are scans and need OCR, so they were left as placeholders.`;
  return helper ? head : `${head} Start the Plexus helper to read scans, then run Parse PDF again.`;
}
