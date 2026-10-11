// Add-panel library filters. Queries stay in the host. This module only narrows rows the host already fetched.
import { dailyPageTitle } from "./schema.js";
import { PIN_COMPONENT, parseRegion } from "./regions.js";
import { pdfFileTitle } from "./pdf.js";

// Card types. An empty selection means every type. Parts are the pieces of a parsed PDF; region and pin are graph blocks.
export const LIBRARY_DOC_TYPES = ["page", "block", "board", "daily", "pdf", "image", "web"];
export const LIBRARY_PART_TYPES = ["paragraph", "table", "figure", "caption", "heading", "formula", "region", "pin"];
export const LIBRARY_TYPES = ["all", ...LIBRARY_DOC_TYPES, ...LIBRARY_PART_TYPES];
// Part types that come from the parse index. Region and pin are found in the graph.
export const PARSE_PART_TYPES = ["paragraph", "table", "figure", "caption", "heading", "formula"];
// Types whose host query is bounded by a title list, a diagram marker, or a string pattern.
const BOUNDED_TYPES = ["board", "daily", "pdf", "image", "web", "region", "pin"];
const TYPE_SET = new Set(LIBRARY_TYPES.filter((t) => t !== "all"));
const LIBRARY_CAP = 80;
const DAY_MS = 86400000;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DAILY_RE = new RegExp(`^(${MONTHS}) (\\d{1,2})(st|nd|rd|th), (\\d{4})$`);

export function isDailyTitle(title) {
  const m = DAILY_RE.exec(String(title ?? ""));
  if (!m) return false;
  const day = Number(m[2]);
  if (day < 1 || day > 31) return false;
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return m[3] === suffix;
}

function cleanTag(raw) {
  let tag = String(raw ?? "").trim();
  if (tag.startsWith("#")) tag = tag.slice(1).trim();
  const wiki = /^\[\[([\s\S]+)\]\]$/.exec(tag);
  if (wiki) tag = wiki[1].trim();
  return tag;
}

export function normalizeTypes(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const t of list) if (TYPE_SET.has(t) && !out.includes(t)) out.push(t);
  return out.length === TYPE_SET.size ? [] : out;
}

// "3-8", "p. 3-8", "5", "4-" and "-6" become {from, to}; anything else is no range.
export function parsePageRange(raw) {
  const m = /^\s*(?:p(?:ages?)?\.?\s*)?(\d+)?\s*(?:[-\u2013]\s*(\d+)?)?\s*$/i.exec(String(raw ?? ""));
  if (!m || (m[1] == null && m[2] == null)) return null;
  const dash = /[-\u2013]/.test(String(raw));
  const from = m[1] != null ? Number(m[1]) : 1;
  const to = m[2] != null ? Number(m[2]) : (dash ? Infinity : from);
  if (!(from >= 1) || !(to >= from)) return null;
  return { from, to };
}

export function normalizeLibraryFilter(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  // Legacy callers pass one `type` string.
  const types = Array.isArray(src.types) ? normalizeTypes(src.types) : (TYPE_SET.has(src.type) ? [src.type] : []);
  const daysN = Number(src.days);
  const days = Number.isFinite(daysN) ? Math.max(0, Math.floor(daysN)) : 0;
  return {
    types,
    tag: cleanTag(src.tag),
    days,
    orphan: src.orphan === true,
    text: String(src.text ?? "").trim(),
    pages: String(src.pages ?? "").trim(),
  };
}

// True when `type` is selected (an empty selection selects all).
export function wantsType(filter, type) {
  const f = normalizeLibraryFilter(filter);
  return f.types.length === 0 || f.types.includes(type);
}

export function wantsParts(filter) {
  const f = normalizeLibraryFilter(filter);
  return f.types.length === 0 || f.types.some((t) => PARSE_PART_TYPES.includes(t));
}

export function libraryFilterActive(filter) {
  const f = normalizeLibraryFilter(filter);
  return Boolean(f.text || f.tag || f.days || f.orphan || f.types.length);
}

// A full-graph scan for "edited in N days" or "not on any board" alone is too wide.
// Daily titles and diagram boards are bounded. Text and tag hit an index.
export function librarySelective(filter) {
  const f = normalizeLibraryFilter(filter);
  if (f.text || f.tag) return true;
  return f.types.some((t) => BOUNDED_TYPES.includes(t));
}

export function editedSince(edited, days, now = Date.now()) {
  const n = Math.max(0, Math.floor(Number(days) || 0));
  if (!n) return true;
  const t = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(edited) && edited > t - n * DAY_MS;
}

const PDF_BLOCK_RE = /\{\{(?:\[\[)?pdf(?:\]\])?:/i;
const IMAGE_RE = /!\[[^\]]*\]\([^)\s]+[^)]*\)/;
const WEB_RE = /^(?:\[[^\]]*\]\(\s*https?:\/\/[^\s)]+\s*\)|https?:\/\/\S+)$/i;

// What a block string is: region, pin, pdf, image, web link, or a plain block.
export function blockKind(string) {
  const s = typeof string === "string" ? string : "";
  if (!s) return "block";
  if (s.includes("plexus-region") || s.includes(PIN_COMPONENT)) {
    const r = parseRegion(s);
    if (r) return r.macro === PIN_COMPONENT ? "pin" : "region";
  }
  if (PDF_BLOCK_RE.test(s)) return "pdf";
  if (IMAGE_RE.test(s)) return "image";
  if (WEB_RE.test(s.trim())) return "web";
  return "block";
}

export function libraryKind(row) {
  if (row?.kind === "board") return "board";
  if (row?.kind === "part") return LIBRARY_PART_TYPES.includes(row.part) ? row.part : "paragraph";
  if (row?.kind === "block") return blockKind(row.string ?? row.text);
  const title = row?.title ?? "";
  if (row?.kind === "daily" || isDailyTitle(title)) return "daily";
  return "page";
}

// Search terms: whitespace-separated, lowercased; a "quoted phrase" stays one term.
export function queryTerms(text) {
  const terms = [];
  for (const m of String(text ?? "").toLowerCase().matchAll(/"([^"]*)"|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? "").replace(/\s+/g, " ").trim();
    if (t) terms.push(t);
  }
  return terms;
}

export function narrowLibrary(rows, filter, now = Date.now()) {
  const f = normalizeLibraryFilter(filter);
  const terms = queryTerms(f.text);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const kind = libraryKind(row);
    if (f.types.length && !f.types.includes(kind)) return false;
    if (f.tag) {
      const tags = Array.isArray(row?.tags) ? row.tags : [];
      if (!tags.includes(f.tag)) return false;
    }
    if (terms.length) {
      const hay = [row?.title, row?.string, row?.text].filter((v) => v != null).join("\n").toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (f.days && !editedSince(row?.edited, f.days, now)) return false;
    if (f.orphan && (kind === "board" || row?.onBoard)) return false;
    return true;
  });
}

const PDF_URL_RE = /\{\{(?:\[\[)?pdf(?:\]\])?:\s*(https?:\/\/[^\s}]+)/i;
const IMAGE_PARTS_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/;

function urlFileName(url) {
  let path = String(url ?? "");
  try { path = new URL(path).pathname; } catch { path = path.split("#")[0].split("?")[0]; }
  let seg = path.split("/").filter(Boolean).pop() || "";
  try { seg = decodeURIComponent(seg); } catch { /* keep the raw segment */ }
  return (seg.split("/").filter(Boolean).pop() || "").trim();
}

// A readable line for a pdf, image or web-link block string. { text, url, thumb }. `pdfTitle(url)` may name a parsed PDF.
export function blockDisplay(string, kind = blockKind(string), { pdfTitle = null } = {}) {
  const s = String(string ?? "");
  if (kind === "pdf") {
    const url = PDF_URL_RE.exec(s)?.[1] || "";
    let parsed = "";
    try { parsed = (typeof pdfTitle === "function" ? pdfTitle(url) : "") || ""; } catch { parsed = ""; }
    return { text: parsed || (url && pdfFileTitle(url)) || "PDF", url, thumb: "" };
  }
  if (kind === "image") {
    const m = IMAGE_PARTS_RE.exec(s);
    const url = m?.[2] || "";
    const alt = (m?.[1] || "").trim();
    return { text: alt || urlFileName(url) || "Image", url, thumb: url };
  }
  if (kind === "web") {
    const t = s.trim();
    const md = /^\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)$/i.exec(t);
    const url = md ? md[2] : t;
    const label = md ? md[1].trim() : "";
    let text = url;
    try {
      const u = new URL(url);
      const path = u.pathname === "/" ? "" : u.pathname;
      text = `${u.hostname.replace(/^www\./, "")}${path}`;
    } catch { /* keep the raw url */ }
    return { text: label || text, url, thumb: "" };
  }
  return { text: s.slice(0, 120), url: "", thumb: "" };
}

export function libraryCard(row) {
  const kind = libraryKind(row);
  if (kind === "page" || kind === "daily") {
    const title = String(row?.title ?? row?.text ?? "");
    return { string: `[[${title}]]`, text: title, kind, label: kind === "daily" ? "daily" : "page" };
  }
  const uid = String(row?.uid ?? "");
  if (kind === "board") {
    const title = String(row?.title || "Untitled board");
    const label = row?.pageTitle ? `board · ${row.pageTitle}` : "board";
    return { string: `((${uid}))`, text: title, kind, label };
  }
  const label = row?.pageTitle ? `in ${row.pageTitle}` : "block";
  if (kind === "pdf" || kind === "image" || kind === "web") {
    const shown = blockDisplay(row?.string ?? row?.text, kind);
    return { string: `((${uid}))`, text: shown.text, kind, label, ...(shown.url ? { url: shown.url } : {}), ...(shown.thumb ? { thumb: shown.thumb } : {}) };
  }
  return { string: `((${uid}))`, text: String(row?.string ?? row?.text ?? "").slice(0, 120), kind, label };
}

// Local noon, so a DST shift does not skip a daily note. `days` is how many titles, newest first.
export function recentDailyTitles(days = 14, now = new Date()) {
  const n = Math.max(1, Math.min(366, Math.floor(Number(days) || 14)));
  const base = now instanceof Date ? now : new Date(now);
  const titles = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, 12, 0, 0, 0);
    titles.push(dailyPageTitle(d));
  }
  return titles;
}

export function libraryCap() {
  return LIBRARY_CAP;
}
