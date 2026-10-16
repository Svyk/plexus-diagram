// Full-text hits inside a PDF: parsed pages and a pdf.js text layer.
// Pure. The host caches pages and only looks up an index while the user types.

import { parsePageRange, queryTerms } from "./library.js";
import { partSnippet } from "./parts-search.js";

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

export function editDistance1(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return true;
  const la = left.length;
  const lb = right.length;
  if (!la || !lb || Math.abs(la - lb) > 1) return false;
  const [s, t] = la <= lb ? [left, right] : [right, left];
  let i = 0;
  let j = 0;
  let used = false;
  while (i < s.length && j < t.length) {
    if (s[i] === t[j]) { i += 1; j += 1; continue; }
    if (used) return false;
    used = true;
    if (s.length === t.length) i += 1;
    j += 1;
  }
  return true;
}

function fracOf(item, width, height) {
  const tr = Array.isArray(item?.transform) ? item.transform : [];
  const x = Number(tr[4]) || 0;
  const baseline = Number(tr[5]) || 0;
  const w = Number(item?.width) || 0;
  const h = Number(item?.height) || Math.abs(Number(tr[3])) || 0;
  const top = height - baseline - h;
  return [clamp01(x / width), clamp01(top / height), clamp01(w / width), clamp01(h / height)];
}

// One pdf.js page: items are getTextContent().items. y is from the bottom. The frac is top-left, for the pin flash.
export function pageFromTextContent({ n = 1, width = 0, height = 0, items = [] } = {}) {
  const spans = [];
  const bits = [];
  const pageW = Number(width) || 0;
  const pageH = Number(height) || 0;
  for (const item of Array.isArray(items) ? items : []) {
    const str = String(item?.str || "");
    if (!str) continue;
    bits.push(str);
    if (pageW > 0 && pageH > 0) spans.push({ str, frac: fracOf(item, pageW, pageH) });
  }
  const text = bits.join(" ").replace(/\s+/g, " ").trim();
  return { n: Number(n) || 0, text, lower: text.toLowerCase(), spans };
}

// Parsed rows (parts-search) folded into the same page records. Figure captions stay with image search.
export function docsFromPartRows(rows) {
  const docs = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.kind === "figure") continue;
    const text = String(row.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const hash = String(row.sha256 || row.url || "");
    if (!hash) continue;
    let doc = docs.get(hash);
    if (!doc) {
      doc = {
        hash,
        url: row.url || "",
        pdfUid: row.pdfUid || "",
        title: row.docTitle || "",
        pages: new Map(),
      };
      docs.set(hash, doc);
    }
    const n = Number(row.page) || 0;
    const page = doc.pages.get(n) || { n, bits: [] };
    page.bits.push(text);
    doc.pages.set(n, page);
  }
  return [...docs.values()].map((doc) => ({
    hash: doc.hash,
    url: doc.url,
    pdfUid: doc.pdfUid,
    title: doc.title,
    pages: [...doc.pages.values()].map((page) => {
      const text = page.bits.join(" ").replace(/\s+/g, " ").trim();
      return { n: page.n, text, lower: text.toLowerCase(), spans: [] };
    }),
  }));
}

function wordsOf(lower) {
  return lower.match(/[a-z0-9]+/g) || [];
}

function termHit(page, term) {
  if (!term) return null;
  if (page.lower.includes(term)) return { fuzzy: false };
  if (term.length < 4 || /\s/.test(term)) return null;
  for (const word of wordsOf(page.lower)) {
    if (Math.abs(word.length - term.length) > 1) continue;
    if (editDistance1(word, term)) return { fuzzy: true, word };
  }
  return null;
}

// The pin box for a query, from a page that still has pdf.js spans. Null when the page is text only.
export function boxForQuery(page, text) {
  const needle = String(text ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  if (!needle || !page) return null;
  const lower = page.lower || String(page.text || "").toLowerCase();
  const terms = queryTerms(needle);
  const term = terms[0] || needle;
  const fuzzy = term.length >= 4 && !lower.includes(term) && !/\s/.test(term);
  return flashFrac({ ...page, lower }, fuzzy ? term : needle, fuzzy ? term : "");
}

function flashFrac(page, needle, fuzzyWord) {
  const spans = Array.isArray(page.spans) ? page.spans : [];
  const want = String(fuzzyWord || needle || "").toLowerCase();
  if (!want) return null;
  for (const span of spans) {
    const str = String(span?.str || "").toLowerCase();
    if (str.includes(want)) return span.frac || null;
  }
  if (fuzzyWord) {
    for (const span of spans) {
      for (const word of wordsOf(String(span?.str || "").toLowerCase())) {
        if (editDistance1(word, needle)) return span.frac || null;
      }
    }
  }
  return null;
}

// docs: [{ hash, url, pdfUid, title, pages: [{ n, text, lower, spans }] }].
// Phrase (the whole query, or one quoted term) ranks first. A word one edit away still matches.
export function searchPdfText(docs, { text = "", pages = "" } = {}, limit = 40) {
  const terms = queryTerms(text);
  if (!terms.length) return [];
  const phrase = String(text ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  const range = parsePageRange(pages);
  const cap = Math.max(1, Math.floor(Number(limit) || 40));
  const hits = [];
  let seq = 0;
  for (const doc of Array.isArray(docs) ? docs : []) {
    for (const page of Array.isArray(doc?.pages) ? doc.pages : []) {
      seq += 1;
      const n = Number(page?.n) || 0;
      if (range && (n < range.from || n > range.to)) continue;
      const lower = page.lower || String(page.text || "").toLowerCase();
      const view = { lower, spans: page.spans };
      let fuzzy = false;
      let fuzzyWord = "";
      let count = 0;
      let all = true;
      for (const term of terms) {
        const hit = termHit(view, term);
        if (!hit) { all = false; break; }
        if (hit.fuzzy) { fuzzy = true; fuzzyWord = fuzzyWord || hit.word; }
        count += 1;
      }
      if (!all) continue;
      const exact = Boolean(phrase) && lower.includes(phrase) && (terms.length > 1 || phrase.includes(" "));
      hits.push({
        doc, page, n, count, seq, exact, fuzzy, fuzzyWord, lower,
      });
    }
  }
  hits.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(a.fuzzy) - Number(b.fuzzy) || b.count - a.count || a.seq - b.seq);
  return hits.slice(0, cap).map((hit) => ({
    hash: hit.doc.hash || "",
    url: hit.doc.url || "",
    pdfUid: hit.doc.pdfUid || "",
    title: hit.doc.title || "",
    page: hit.n,
    text: hit.page.text || "",
    snippet: partSnippet(hit.page.text || "", text),
    frac: flashFrac(hit.page, phrase && hit.exact ? phrase : (hit.fuzzyWord || terms[0]), hit.fuzzy ? terms[0] : ""),
    exact: hit.exact,
    fuzzy: hit.fuzzy,
  }));
}

function exactOf(hit, phrase) {
  if (typeof hit.exact === "boolean") return hit.exact;
  const lower = hit.page?.lower ?? hit.lower ?? "";
  const exact = lower.includes(phrase);
  hit.exact = exact;
  return exact;
}

// Candidates are page postings ({ doc, page, n, count, seq, fuzzy }). A single word never reads `.lower`.
// A phrase reads it only until `limit` exact pages are in hand: a later exact page sorts worse.
export function rankPostingHits(candidates, { text = "", pages = "" } = {}, limit = 40) {
  const terms = queryTerms(text);
  if (!terms.length) return [];
  const phrase = String(text ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  const range = parsePageRange(pages);
  const cap = Math.max(1, Math.floor(Number(limit) || 40));
  const phraseMatters = Boolean(phrase) && (terms.length > 1 || phrase.includes(" "));
  const rows = [];
  for (const hit of Array.isArray(candidates) ? candidates : []) {
    const n = Number(hit?.n) || 0;
    if (range && (n < range.from || n > range.to)) continue;
    rows.push(hit);
  }
  rows.sort((a, b) => Number(a.fuzzy) - Number(b.fuzzy) || (b.count || 0) - (a.count || 0) || (a.seq || 0) - (b.seq || 0));
  const chosen = [];
  let exacts = 0;
  for (const hit of rows) {
    const exact = phraseMatters ? exactOf(hit, phrase) : false;
    if (exact) exacts += 1;
    chosen.push(exact ? { ...hit, exact: true } : hit);
    if (!phraseMatters && chosen.length >= cap) break;
    if (phraseMatters && exacts >= cap) break;
  }
  chosen.sort((a, b) => Number(Boolean(b.exact)) - Number(Boolean(a.exact)) || Number(a.fuzzy) - Number(b.fuzzy) || (b.count || 0) - (a.count || 0) || (a.seq || 0) - (b.seq || 0));
  const needle = phraseMatters ? phrase : (terms[0] || "");
  return chosen.slice(0, cap).map((hit) => {
    const page = hit.page || {};
    const fuzzyWord = hit.fuzzy ? (terms[0] || "") : "";
    return {
      hash: hit.doc?.hash || "",
      url: hit.doc?.url || "",
      pdfUid: hit.doc?.pdfUid || "",
      title: hit.doc?.title || "",
      page: Number(hit.n) || 0,
      text: page.text || "",
      snippet: partSnippet(page.text || "", text),
      frac: Array.isArray(page.spans) && page.spans.length ? flashFrac(page, hit.exact ? phrase : (hit.fuzzyWord || needle), fuzzyWord) : null,
      exact: Boolean(hit.exact),
      fuzzy: Boolean(hit.fuzzy),
    };
  });
}

// The reader open() detail a pin already flashes. Null when the PDF is not a card on this board.
export function pdfHitOpenDetail(hit, item) {
  if (!hit || !item?.uid) return null;
  const blockUid = item.target?.kind === "block" && item.target.uid ? item.target.uid : item.uid;
  const frac = Array.isArray(hit.frac) && hit.frac.length >= 4 ? hit.frac.slice(0, 4) : null;
  return {
    cardUid: item.uid,
    blockUid,
    page: Number(hit.page) || 1,
    frac,
    source: item.string || "",
    title: hit.title || "",
  };
}
