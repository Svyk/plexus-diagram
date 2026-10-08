// Footnotes from parsed PDFs in the native format of the fbgallet Footnotes extension.
// A reference is the alias [(N)](((noteUid))), wrapped as #sup^^…^^ while its
// "Superscript note number" setting is on (the default). Notes are children of a
// page-level header block ("#footnotes", numbered children), under an optional "---".
// All of it is plain Roam: it works without the extension and upgrades when installed.
//
// The model never knows the page. toRoamMarkdown (and prepareTable) leave tokens in the
// text; the session reads the page, then planFootnotes numbers the notes and rewrites them.
//   ref token   OPEN id SEP mark CLOSE
//   def line    "- " DEF id SEP mark CLOSE text      (depth 0, text is raw, not escaped)

import { escapeMarkdownText } from "./parse-to-roam-md.js";

export const FN_OPEN = "";
export const FN_CLOSE = "";
export const FN_DEF = "";
export const FN_SEP = "";

export const FOOTNOTE_FORMATS = Object.freeze(["extension", "plain", "off"]);
export const FOOTNOTES_HEADER = "#footnotes";
// Notes written for one gesture. The header and its rule take up to 2 more writes.
export const FOOTNOTE_CAP = 40;
export const WRITE_BUDGET = 45;

export function footnoteFormat(value) {
  return value === "plain" || value === "off" ? value : "extension";
}

const SUP_MAP = Object.freeze({
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "ᵃ": "a", "ᵇ": "b", "ᶜ": "c", "ᵈ": "d", "ᵉ": "e", "ᶠ": "f", "ᵍ": "g", "ʰ": "h", "ⁱ": "i", "ʲ": "j",
  "ᵏ": "k", "ˡ": "l", "ᵐ": "m", "ⁿ": "n", "ᵒ": "o", "ᵖ": "p", "ʳ": "r", "ˢ": "s", "ᵗ": "t", "ᵘ": "u",
  "ᵛ": "v", "ʷ": "w", "ˣ": "x", "ʸ": "y", "ᶻ": "z",
});
const SUP_CLASS = Object.keys(SUP_MAP).join("");
const SYMBOLS = "*†‡§";
const BRACKET_INNER = `(?:[${SUP_CLASS}]+|[A-Za-z0-9]{1,2}|[${SYMBOLS}]+)`;
const LEAD_RE = new RegExp(`^(\\s*)([(\\[])\\s*(${BRACKET_INNER})\\s*([)\\]])`);
const TRAIL_RE = new RegExp(`(\\s*)([(\\[])\\s*(${BRACKET_INNER})\\s*([)\\]])\\s*$`);
const RUN_RE = new RegExp(`[${SUP_CLASS}]+|[${SYMBOLS}]+`, "g");

// "(¹)", "[a]", "ᵃ", "1.", "**" → "1", "a", "a", "1", "**".
export function normalizeMark(mark) {
  let s = String(mark ?? "").trim();
  s = s.replace(/^[(\[]\s*/, "").replace(/\s*[)\]]$/, "").replace(/[.:]$/, "").trim();
  let out = "";
  for (const ch of s) out += SUP_MAP[ch] ?? ch;
  return out;
}

export const refToken = (id, mark) => `${FN_OPEN}${id}${FN_SEP}${mark ?? ""}${FN_CLOSE}`;
export const defLine = (id, mark, text) => `- ${FN_DEF}${id}${FN_SEP}${mark ?? ""}${FN_CLOSE}${text ?? ""}`;
export const hasFootnoteTokens = (strings) => (Array.isArray(strings) ? strings : [strings]).some((s) => typeof s === "string" && (s.includes(FN_OPEN) || s.includes(FN_DEF)));

const REF_RE = new RegExp(`${FN_OPEN}([^${FN_SEP}${FN_CLOSE}]*)${FN_SEP}([^${FN_CLOSE}]*)${FN_CLOSE}`, "g");
const DEF_RE = new RegExp(`^[ \\t]*- ${FN_DEF}([^${FN_SEP}${FN_CLOSE}]*)${FN_SEP}([^${FN_CLOSE}]*)${FN_CLOSE}(.*)$`);

export function aliasFor(n, uid, sup = true) {
  const alias = `[(${n})](((${uid})))`;
  return sup ? `#sup^^${alias}^^` : alias;
}

// ---- numbering and rewriting -------------------------------------------------------------

// strings: markdown (or cell text) with tokens. defs: extra { id: { mark, text } } (tables).
// startAt: highest number already on the page. cap: how many notes may become page blocks.
// Returns { notes: [{ id, uid, n, mark, text }], overflow: [{ id, n, mark, text }], apply(string) }.
export function planFootnotes(strings, { startAt = 0, cap = FOOTNOTE_CAP, defs = {}, sup = true, uid } = {}) {
  const list = Array.isArray(strings) ? strings : [strings];
  const known = new Map();
  for (const [id, d] of Object.entries(defs || {})) known.set(id, { mark: d.mark ?? "", text: d.text ?? "" });
  for (const s of list) {
    for (const line of String(s ?? "").split("\n")) {
      const m = DEF_RE.exec(line);
      if (m) known.set(m[1], { mark: m[2], text: m[3] });
    }
  }
  const order = [];
  const seen = new Set();
  for (const s of list) {
    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(String(s ?? "")))) {
      if (seen.has(m[1]) || !known.has(m[1])) continue;
      seen.add(m[1]);
      order.push(m[1]);
    }
  }
  const make = typeof uid === "function" ? uid : () => `fn${Math.random().toString(36).slice(2, 11)}`;
  const limit = Math.max(0, Math.min(FOOTNOTE_CAP, Math.floor(Number(cap) || 0)));
  const notes = [];
  const overflow = [];
  const byId = new Map();
  order.forEach((id, i) => {
    const d = known.get(id);
    const n = Math.max(0, Math.floor(startAt)) + i + 1;
    if (i < limit) {
      const note = { id, uid: make(), n, mark: d.mark, text: d.text };
      notes.push(note);
      byId.set(id, { kind: "note", note });
    } else {
      const item = { id, n, mark: d.mark, text: d.text };
      overflow.push(item);
      byId.set(id, { kind: "overflow", item });
    }
  });
  const apply = (input) => {
    const out = [];
    for (const line of String(input ?? "").split("\n")) {
      const m = DEF_RE.exec(line);
      if (!m) { out.push(line); continue; }
      const hit = byId.get(m[1]);
      if (hit?.kind === "note") continue;
      if (hit?.kind === "overflow") out.push(`- (${hit.item.n}) ${escapeMarkdownText(hit.item.text, { leading: false })}`);
      else out.push(`- [${m[2]}] ${escapeMarkdownText(m[3], { leading: false })}`);
    }
    return out.join("\n").replace(REF_RE, (full, id, mark) => {
      const hit = byId.get(id);
      if (hit?.kind === "note") return aliasFor(hit.note.n, hit.note.uid, sup);
      if (hit?.kind === "overflow") return `(${hit.item.n})`;
      return mark ? `[${mark}]` : "";
    });
  };
  return { notes, overflow, apply };
}

// Plain "(N)" text: numbers from 1 inside the insert, notes stay lines. No page.
export function plainFootnotes(strings, opts = {}) {
  return planFootnotes(strings, { ...opts, startAt: 0, cap: 0 });
}

// ---- tables -----------------------------------------------------------------------------

function markSpans(text) {
  const spans = [];
  const lead = LEAD_RE.exec(text);
  if (lead) spans.push({ start: lead[1].length, end: lead[0].length, raw: lead[3], bracket: true });
  const trail = TRAIL_RE.exec(text);
  if (trail) {
    const start = trail.index + trail[1].length;
    if (!spans.some((s) => start < s.end)) spans.push({ start, end: trail.index + trail[0].replace(/\s+$/, "").length, raw: trail[3], bracket: true, eat: trail[1].length });
  }
  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (spans.some((s) => start < s.end && end > s.start)) continue;
    spans.push({ start, end, raw: m[0], bracket: false });
  }
  return spans.sort((a, b) => a.start - b.start);
}

const NOTE_ROW_RE = new RegExp(`^(\\(?(?:[${SUP_CLASS}]+|[${SYMBOLS}]+|[A-Za-z0-9]{1,2})[)\\].:]?)\\s+(\\S.*)$`, "s");

function noteRows(table) {
  const rows = Number.isInteger(table?.rows) ? table.rows : 0;
  const header = Number.isInteger(table?.headerRows) ? table.headerRows : 0;
  const out = [];
  for (let r = rows - 1; r > header; r -= 1) {
    const cells = (table.cells || []).filter((c) => c.r === r);
    const filled = cells.filter((c) => String(c.text ?? "").trim());
    if (filled.length !== 1 || (filled[0].rowSpan ?? 1) !== 1) break;
    const m = NOTE_ROW_RE.exec(String(filled[0].text).trim());
    if (!m) break;
    // A symbol or letter mark is a note; a plain number needs a bracket, dot or colon.
    const lead = m[1];
    if (/^\d+$/.test(lead)) break;
    out.unshift({ r, mark: lead, text: m[2].trim() });
  }
  return out;
}

function tableCellText(cell) { return String(cell?.text ?? ""); }

// Cell-level marks → tokens (extension) or "(N)" plus note rows (plain).
// available: [{ id, mark, text }] footnote blocks that belong to this table's page.
// Returns { table, notes: [{ id, mark, text }], used }. `table` is the same object when
// no mark matched. Note rows under the table are consumed only when a cell cites them.
export function prepareTable(table, available = [], { format = "extension" } = {}) {
  if (format === "off" || !table || !Array.isArray(table.cells)) return { table, notes: [], used: 0 };
  const rows = noteRows(table);
  const byMark = new Map();
  for (const row of rows) {
    const key = normalizeMark(row.mark);
    if (key && !byMark.has(key)) byMark.set(key, { id: `${table.id ?? "t"}:row:${row.r}`, mark: row.mark, text: row.text, row: row.r });
  }
  for (const note of available || []) {
    const key = normalizeMark(note?.mark);
    if (key && !byMark.has(key)) byMark.set(key, { id: String(note.id), mark: note.mark, text: note.text ?? "" });
  }
  if (!byMark.size) return { table, notes: [], used: 0 };
  const noteRowSet = new Set(rows.map((r) => r.r));
  const found = [];
  const edits = new Map();
  const order = [...table.cells].map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => !noteRowSet.has(cell.r))
    .sort((a, b) => a.cell.r - b.cell.r || a.cell.c - b.cell.c);
  for (const { cell, index } of order) {
    const text = tableCellText(cell);
    const spans = markSpans(text).filter((s) => byMark.has(normalizeMark(s.raw)));
    if (!spans.length) continue;
    edits.set(index, spans);
    for (const s of spans) {
      const note = byMark.get(normalizeMark(s.raw));
      if (!found.includes(note)) found.push(note);
    }
  }
  if (!found.length) return { table, notes: [], used: 0 };
  const numberOf = new Map(found.map((note, i) => [note, i + 1]));
  const cells = table.cells.map((cell, index) => {
    const spans = edits.get(index);
    if (!spans) return cell;
    let out = "";
    let at = 0;
    const text = tableCellText(cell);
    for (const s of spans) {
      const note = byMark.get(normalizeMark(s.raw));
      out += text.slice(at, s.start - (s.eat || 0));
      out += format === "plain" ? `(${numberOf.get(note)})` : refToken(note.id, note.mark);
      at = s.end;
    }
    out += text.slice(at);
    return { ...cell, text: out.trim() };
  });
  const used = new Set(found.filter((n) => n.row != null).map((n) => n.row));
  let next = cells.filter((cell) => !used.has(cell.r)).map((cell) => {
    const shift = [...used].filter((r) => r < cell.r).length;
    return shift ? { ...cell, r: cell.r - shift } : cell;
  });
  let rowCount = (Number.isInteger(table.rows) ? table.rows : 0) - used.size;
  const cols = Number.isInteger(table.cols) ? table.cols : 1;
  if (format === "plain") {
    found.forEach((note, i) => {
      next = [...next, { r: rowCount + i, c: 0, rowSpan: 1, colSpan: Math.max(1, cols), text: `(${i + 1}) ${note.text}`.trim() }];
    });
    rowCount += found.length;
  }
  const prepared = { ...table, rows: rowCount, cells: next };
  return { table: prepared, notes: format === "plain" ? [] : found.map(({ id, mark, text }) => ({ id, mark, text })), used: found.length };
}

// Footnote blocks of a parse that sit on the page of `block` (or on any page when it has none).
export function pageNoteBlocks(doc, block) {
  const out = [];
  const page = block?.page;
  for (const id of Array.isArray(doc?.order) ? doc.order : []) {
    const b = doc.blocks?.[id];
    if (b?.type !== "footnote") continue;
    if (page != null && b.page != null && b.page !== page) continue;
    out.push({ id: b.id ?? id, mark: b.mark ?? "", text: b.text ?? "" });
  }
  return out;
}
