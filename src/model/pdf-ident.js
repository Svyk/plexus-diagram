// What a PDF is, read from its first page: title, authors line, venue line, page count, and the first words.
// The Add panel names PDF rows with it and matches keyword searches against it. Pure: no fetch, no graph read.

import { cleanPdfTitle, isStorageTitle, pdfFileTitle } from "./pdf.js";
import { pdfPageName } from "./pdf-page.js";

// Bump when the derivation changes, so cached identities are read again.
export const IDENT_V = 2;
export const IDENT_TEXT_CHARS = 400;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).toLowerCase().replace(/[…]+$/, "").replace(/\.\.\.$/, "").trim();

const LABEL_LINE = /^(?:major|original|research|review|brief|short|clinical|invited|special)?(?:article|report|communication|paper|letter|review|research)s?$/i;
const AFFILIATION = /\b(?:abstract|universit|department|dept\.|institut|school|hospital|center|centre|college|laborator|faculty|division|ministry|inc\.|ltd|gmbh|corresponding|received|accepted|published|keywords?|background)\b|@|https?:|www\.|doi\b/i;
const VENUE_WORDS = /\b(?:journal|proceedings|transactions|annals|bulletin|review|letters|forum|reports?|science|medicine|diseases|research|quarterly|magazine|conference|symposium|archives|international|food|microbiology|nature|cell|plos)\b/i;
const PARTICLES = new Set(["and", "&", "et", "al", "al.", "de", "van", "von", "da", "di", "la", "le", "der", "den", "du", "del", "y", "e"]);

// An authors line: names separated by commas or "and", nearly every word capitalised, no affiliation words.
export function looksLikeAuthors(text) {
  const t = clean(text);
  if (t.length < 5 || t.length > 400) return false;
  if (AFFILIATION.test(t)) return false;
  if (/[.!?]\s+[a-z]/.test(t)) return false;
  const words = t.replace(/[^\p{L}\p{M}\s.'’-]+/gu, " ").split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const named = words.filter((w) => !PARTICLES.has(w.toLowerCase()));
  if (named.length < 2) return false;
  const capital = named.filter((w) => /^[A-ZÀ-Þ]/.test(w)).length;
  if (capital / named.length < 0.85) return false;
  return /,|\band\b|&/.test(t) || (named.length <= 4 && named.some((w) => /^\p{Lu}\.$/u.test(w)));
}

const FIELD = /^(title|journal|source|authors?|publication)$/i;

// Repository cover sheets (eScholarship and the like) label their fields: "Title", "Journal", "Authors".
function labeledFields(rows) {
  const out = {};
  for (let i = 0; i < rows.length - 1 && i < 60; i += 1) {
    const m = FIELD.exec(rows[i].text);
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/s$/, "").replace("source", "journal");
    const values = [];
    for (let j = i + 1; j < rows.length && j <= i + 6 && !FIELD.test(rows[j].text) && !/^(permalink|issn|publication date|copyright|doi)\b/i.test(rows[j].text); j += 1) values.push(rows[j].text);
    if (!values.length || out[key]) continue;
    out[key] = key === "author" ? values.join(", ").replace(/,\s*(?=et al\.?)/i, " ") : values[0];
  }
  return out.title ? out : null;
}

// A name a page owns: anything but a storage path, a macro, or a bare mixed-case id (a Roam upload name).
export function pageNameOk(title) {
  const t = clean(title);
  if (!t || t.startsWith("{{") || /imgs\/app\//i.test(t)) return false;
  return !/^(?=.*[A-Z])(?=.*[a-z])[A-Za-z0-9_-]{9,12}$/.test(t) || /\s/.test(t);
}

// "Michelle M. Nerandzic, 1 Thriveen Sankar C, 2 Peter Setlow, 3 and Curtis J. Donskey 2,4" → the names only.
export function cleanAuthors(text) {
  return clean(String(text ?? "")
    .replace(/[^\p{L}\p{M}\d\s.,'’&-]+/gu, " ")
    .replace(/(^|[\s,])\d+(?:\s*,\s*\d+)*(?=[\s,]|$)/g, "$1")
    .replace(/\s+,/g, ","))
    .replace(/,\s*,+/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "");
}

// A journal or venue line: words, not a label ("MAJOR ARTICLE"), not a url, doi, or bare number. Trailing volume and year cut.
export function venueText(text) {
  const t = clean(text);
  if (!t || t.length > 120) return "";
  if (LABEL_LINE.test(t.replace(/\s+/g, ""))) return "";
  if (/[:–—-]$|\b(?:in|of|the|and|for)$/i.test(t)) return "";
  if (/https?:|www\.|doi[:\s]|^\d|©|copyright/i.test(t)) return "";
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  if (words.length < 2) return "";
  const cut = t.replace(/\s+(?:\d|vol\.|volume\b|\().*$/i, "").trim();
  return cut.split(/\s+/).length >= 2 ? cut : t;
}

// Page-1 lines → identity. `lines`: [{ text, size }] in reading order. `pageTitle` is the page-title read
// (quickPageTitle; may end in "…"); without it the largest type near the top is the title.
export function identFromLines(lines, { pageTitle = "", pageCount = null, metaTitle = "" } = {}) {
  const rows = (Array.isArray(lines) ? lines : []).map((l) => ({ text: clean(l?.text), size: Number(l?.size) || 0 })).filter((l) => l.text);
  const fields = labeledFields(rows);
  if (fields) {
    const pages = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null;
    const text = clean(rows.filter((l) => !FIELD.test(l.text)).map((l) => l.text).join(" ")).slice(0, IDENT_TEXT_CHARS);
    return { v: IDENT_V, title: cleanPdfTitle(fields.title), authors: cleanAuthors(fields.author || ""), venue: clean(String(fields.journal || "").replace(/[,(]?\s*\d.*$/, "")), pages, text };
  }
  let at = -1;
  const head = norm(pageTitle).slice(0, 24);
  if (head) at = rows.findIndex((l) => norm(l.text).startsWith(head) || head.startsWith(norm(l.text).slice(0, 24)) && l.text.length >= 8);
  if (at < 0) {
    const wordy = (t) => t.length >= 8 && (t.match(/\p{L}/gu) || []).length >= 0.7 * t.replace(/\s/g, "").length;
    const top = rows.slice(0, 25).filter((l) => wordy(l.text));
    const sizes = rows.map((l) => l.size).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] || 0;
    const big = Math.max(0, ...top.map((l) => l.size));
    if (big > 0 && big >= body * 1.25) at = rows.findIndex((l) => l.size === big && wordy(l.text));
  }
  let end = at;
  if (at >= 0) {
    // Same type size continues the title; a line that repeats the title's start (a running head) ends it.
    while (end + 1 < rows.length && end - at < 5 && Math.abs(rows[end + 1].size - rows[at].size) < 0.6 && rows[at].size > 0) {
      const next = norm(rows[end + 1].text);
      if (next.length >= 8 && norm(rows.slice(at, end + 1).map((l) => l.text).join(" ")).startsWith(next.slice(0, 24))) break;
      end += 1;
    }
  }
  const fullTitle = at >= 0 ? clean(rows.slice(at, end + 1).map((l) => l.text).join(" ")) : "";
  const read = cleanPdfTitle(fullTitle) || cleanPdfTitle(pageTitle);
  const title = read && !isStorageTitle(read) ? read : cleanPdfTitle(metaTitle);
  let authors = "";
  let authorsAt = -1;
  for (let i = end + 1; at >= 0 && i < Math.min(rows.length, end + 4); i += 1) {
    if (looksLikeAuthors(rows[i].text)) { authors = cleanAuthors(rows[i].text); authorsAt = i; break; }
  }
  let venue = "";
  const above = at > 0 ? rows.slice(0, at) : [];
  const named = above.map((l) => venueText(l.text)).filter(Boolean);
  // Only a line that reads like a journal: running heads above a title are as often a section or a lab name.
  venue = named.find((v) => VENUE_WORDS.test(v) && !/^supplementary\b/i.test(v)) || "";
  if (!venue) {
    const footer = rows.map((l) => l.text).find((t) => t.length <= 80 && /\b(?:journal|proceedings|transactions|annals|bulletin)\b/i.test(t));
    venue = footer ? venueText(footer) : "";
  }
  const after = Math.max(end, authorsAt) + 1;
  // Body words first; affiliation lines still count, after them.
  const rest = rows.slice(after).map((l) => l.text);
  const text = clean([...rest.filter((t) => !AFFILIATION.test(t) || /^(?:abstract|background)\b/i.test(t)), ...rest.filter((t) => AFFILIATION.test(t) && !/^(?:abstract|background)\b/i.test(t))].join(" ")).slice(0, IDENT_TEXT_CHARS);
  const pages = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null;
  return { v: IDENT_V, title, authors, venue, pages, text };
}

// Page records from parsePageGeometry → the lines identFromLines reads.
export function linesOfRecord(record) {
  const out = [];
  for (const line of record?.lines || []) {
    const text = (line?.words || []).map((w) => w?.text ?? "").join(" ");
    if (clean(text)) out.push({ text, size: Number(line.size) || 0 });
  }
  return out;
}

// A stored parse → identity, without fetching the file. Headings count as large type.
export function identFromParse(doc, { title = "" } = {}) {
  if (!doc || typeof doc !== "object") return null;
  const blocks = doc.blocks && typeof doc.blocks === "object" ? doc.blocks : {};
  const ids = Array.isArray(doc.order) ? doc.order : Object.keys(blocks);
  const lines = [];
  for (const r of Array.isArray(doc.removed) ? doc.removed : []) {
    if (r?.page === 1 && r.text && r.reason !== "page-number") lines.push({ text: r.text, size: 9 });
  }
  for (const id of ids) {
    const b = blocks[id];
    if (!b || (b.page || 1) !== 1 || typeof b.text !== "string") continue;
    lines.push({ text: b.text, size: b.type === "heading" ? 20 - Math.min(5, b.level || 1) : 10 });
    if (lines.length >= 60) break;
  }
  const count = Number(doc.numPages) || (Array.isArray(doc.pages) ? doc.pages.length : 0);
  const out = identFromLines(lines, { pageTitle: title, pageCount: count || null });
  if (title && !out.title) out.title = cleanPdfTitle(title);
  return out;
}

// Lowercased text a keyword query is matched against.
export function identHaystack(ident) {
  if (!ident) return "";
  return [ident.title, ident.authors, ident.venue, ident.text].filter(Boolean).join("\n").toLowerCase();
}

export function identMatches(ident, terms) {
  const list = Array.isArray(terms) ? terms.filter(Boolean) : [];
  if (!list.length || !ident) return false;
  const hay = identHaystack(ident);
  return list.every((t) => hay.includes(t));
}

// The name a PDF row shows, best first: its own page, its Roam PDF page, a parse, the cover read,
// the file's metadata Title, the first-page read, the file name. `loading` while nothing better is known yet.
export function pdfRowName({ ownTitle = "", pdfPageTitle = "", parsedTitle = "", coverTitle = "", metaTitle = "", ident = null, url = "", pending = false } = {}) {
  const pick = [
    pageNameOk(ownTitle) ? pdfPageName(ownTitle) : "",
    pageNameOk(pdfPageTitle) ? pdfPageName(pdfPageTitle) : "",
    cleanPdfTitle(parsedTitle),
    cleanPdfTitle(coverTitle),
    cleanPdfTitle(metaTitle),
    ident?.title || "",
  ].find(Boolean);
  if (pick) return { title: pick, loading: false };
  return { title: pdfFileTitle(url) || "PDF", loading: Boolean(pending) };
}

// "Open Forum Infectious Diseases · 7 pages · on October 6th, 2026". The page is left out when it is the name.
export function pdfRowSub({ ident = null, pageTitle = "", title = "" } = {}) {
  const parts = [];
  if (ident?.venue && norm(ident.venue) !== norm(title)) parts.push(ident.venue);
  else if (ident?.authors) parts.push(ident.authors.length > 60 ? `${ident.authors.slice(0, 58).replace(/[,\s]+\S*$/, "")}…` : ident.authors);
  if (ident?.pages) parts.push(`${ident.pages} ${ident.pages === 1 ? "page" : "pages"}`);
  const page = clean(pageTitle);
  if (page && norm(pdfPageName(page)) !== norm(title)) parts.push(`on ${page}`);
  return parts.join(" · ");
}

// Text cut at every occurrence of any term: [{ text, hit }]. Case-insensitive; overlapping terms merge.
export function markTerms(text, terms) {
  const s = String(text ?? "");
  const list = (Array.isArray(terms) ? terms : []).map((t) => String(t || "").toLowerCase()).filter(Boolean);
  if (!s || !list.length) return s ? [{ text: s, hit: false }] : [];
  const low = s.toLowerCase();
  const marks = new Array(s.length).fill(false);
  for (const t of list) {
    for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + 1)) marks.fill(true, i, i + t.length);
  }
  const out = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j < s.length && marks[j] === marks[i]) j += 1;
    out.push({ text: s.slice(i, j), hit: marks[i] });
    i = j;
  }
  return out;
}
