// Search over the parts of parsed PDFs. Pure: a parse doc becomes flat index rows, rows are matched in memory.
// The host decides which docs to index and when; nothing here touches IndexedDB or the graph.

import { parsePageRange, queryTerms } from "./library.js";

const PART_OF = { heading: "heading", para: "paragraph", list: "paragraph", footnote: "paragraph", code: "paragraph", table: "table", figure: "figure", formula: "formula", caption: "caption" };
const SNIPPET_W = 120;

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

function tableText(block) {
  const cells = Array.isArray(block?.cells) ? block.cells : [];
  return cells.map((cell) => squash(cell?.text)).filter(Boolean).join(" ");
}

function blockText(block) {
  switch (block.type) {
    case "table": return tableText(block);
    case "list": return (block.items || []).map((item) => squash(item?.text)).filter(Boolean).join(" ");
    case "formula": return squash(block.latex || block.text);
    default: return squash(block.text);
  }
}

// Rows for one parsed doc, in reading order. A caption's text is also attached to the table or figure it names.
export function buildPartsIndex(doc, { url = "", docTitle = "", pdfUid = "" } = {}) {
  const blocks = doc?.blocks && typeof doc.blocks === "object" ? doc.blocks : {};
  const order = Array.isArray(doc?.order) ? doc.order : Object.keys(blocks);
  const attached = new Map();
  for (const id of order) {
    const b = blocks[id];
    if (b?.type === "caption" && b.for && blocks[b.for]) {
      const text = squash(b.text);
      if (text) attached.set(b.for, attached.has(b.for) ? `${attached.get(b.for)} ${text}` : text);
    }
  }
  const rows = [];
  for (const id of order) {
    const b = blocks[id];
    const kind = b && PART_OF[b.type];
    if (!kind) continue;
    let text = blockText(b);
    const cap = attached.get(b.id ?? id) || (typeof b.caption === "string" && !blocks[b.caption] ? squash(b.caption) : "");
    if (cap && kind !== "caption" && !text.includes(cap)) text = text ? `${text} ${cap}` : cap;
    if (!text && kind === "figure") text = "Figure";
    if (!text) continue;
    rows.push({
      kind,
      page: Number(b.page) || 0,
      text,
      lower: text.toLowerCase(),
      docTitle,
      url,
      pdfUid,
      sha256: doc?.sha256 || "",
      engine: doc?.engine || "",
      optsHash: doc?.optsHash || "",
      blockId: b.id ?? id,
    });
  }
  return rows;
}

function countHits(hay, needle) {
  let n = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    n += 1;
    at = hay.indexOf(needle, at + needle.length);
  }
  return n;
}

// rows: index rows (possibly from several docs, in doc order). kinds: [] means any part kind.
// A row matches when every query term (whitespace-split; "quoted phrase" stays one term) is in it.
// Ranked: rows holding the whole query as a phrase, then total term hits, then reading order. With no text, reading order only.
export function searchParts(rows, { text = "", kinds = [], pages = "" } = {}, limit = 40) {
  const phrase = String(text ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  const terms = queryTerms(text);
  const kindSet = kinds && kinds.length ? new Set(kinds) : null;
  const range = parsePageRange(pages);
  const hits = [];
  let seq = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    seq += 1;
    if (kindSet && !kindSet.has(row.kind)) continue;
    if (range && (row.page < range.from || row.page > range.to)) continue;
    let count = 1;
    let exact = 0;
    if (terms.length) {
      count = 0;
      let all = true;
      for (const t of terms) {
        const n = countHits(row.lower, t);
        if (!n) { all = false; break; }
        count += n;
      }
      if (!all) continue;
      if (terms.length > 1 && row.lower.includes(phrase)) exact = 1;
    }
    hits.push({ row, count, seq, exact });
  }
  hits.sort((a, b) => b.exact - a.exact || b.count - a.count || a.seq - b.seq);
  return hits.slice(0, Math.max(1, Math.floor(Number(limit) || 40))).map(({ row, count }) => ({ ...row, hits: terms.length ? count : 0 }));
}

// {before, hit, after} around the first matching term (the whole phrase when the text holds it); the text head when nothing matches.
export function partSnippet(text, needle, width = SNIPPET_W) {
  const t = squash(text);
  const low = t.toLowerCase();
  const phrase = String(needle ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  let n = "";
  let at = -1;
  if (phrase) {
    at = low.indexOf(phrase);
    if (at !== -1) n = phrase;
    else {
      for (const term of queryTerms(needle)) {
        at = low.indexOf(term);
        if (at !== -1) { n = term; break; }
      }
    }
  }
  if (at === -1) return { before: "", hit: "", after: t.length > width ? `${t.slice(0, width)}…` : t };
  const room = Math.max(0, width - n.length);
  const start = Math.max(0, at - Math.floor(room / 3));
  const end = Math.min(t.length, at + n.length + room - (at - start));
  return {
    before: `${start > 0 ? "…" : ""}${t.slice(start, at)}`,
    hit: t.slice(at, at + n.length),
    after: `${t.slice(at + n.length, end)}${end < t.length ? "…" : ""}`,
  };
}

export const PART_LABELS = { paragraph: "Paragraph", table: "Table", figure: "Figure", caption: "Caption", heading: "Heading", formula: "Formula" };
