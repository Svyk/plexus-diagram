// @-mentions of context parts in the Ask AI question: naming the parts, the list that "@" opens, parsing "@Part 3" in the
// text, keeping the numbers true when a part goes, and the preamble that tells the model which context block each one is.
// Pure: no DOM, no Roam. The view passes the parts in the shape buildMultiContext() takes (+ key, label, docTitle, docName).

import { pdfFileTitle } from "./pdf.js";

export const AT_ALL = "@All parts";
export const atToken = (n) => `@Part ${n}`;

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export const clipText = (text, max) => {
  const t = squash(text);
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).replace(/\s+\S*$/, "").trimEnd() || t.slice(0, max - 1)}…`;
};

// "MA J O R A R T I C L E": a banner set in spaced capitals comes out of the text layer as one-letter words.
export function letterSpaced(text) {
  const words = squash(text).split(" ").filter(Boolean);
  return words.length >= 5 && words.filter((w) => w.length <= 2).length / words.length >= 0.7;
}

// The name of the PDF a part comes from: the host's name for it (pdf-ident title, page title, file name), else the parse's
// title unless it is a letter-spaced banner, else the file name.
export function partPdfName(part) {
  for (const c of [part?.docName, part?.docTitle]) {
    const t = squash(c);
    if (t && !letterSpaced(t)) return t;
  }
  return (part?.url && pdfFileTitle(part.url)) || "PDF";
}

// What kind of thing the part is, for the icon-less list and for filtering ("@fig", "@table").
export function partType(part) {
  if (!part) return "part";
  if (part.wholeDoc) return "whole";
  if (part.kind === "image") return "figure";
  if (part.image) return "figure";
  const b = part.doc?.blocks?.[part.blockId];
  const t = b?.type;
  if (t === "figure" || t === "table" || t === "heading") return t;
  if (t === "caption") return "figure";
  if (part.selection) return "selection";
  if (t === "para" || t === "list" || t === "text") return "paragraph";
  if (part.page != null && !part.blockId) return "page";
  return "part";
}

const TYPE_WORDS = {
  figure: "figure fig image chart picture",
  table: "table",
  heading: "heading section title",
  paragraph: "paragraph text para",
  selection: "selection highlight text",
  page: "page",
  whole: "whole pdf document",
  part: "",
};

// The part's own label without the trailing PDF name chipText() put there: "Table 3 · p. 10".
export function partBase(part) {
  let label = squash(part?.label);
  const doc = squash(part?.docTitle);
  if (doc && label.endsWith(` · ${doc}`)) label = label.slice(0, -(doc.length + 3)).trim();
  if (part?.wholeDoc) return "Whole document";
  return label || "Part";
}

// [{ n, key, type, base, pdf, full, short, thumb }] numbered the way buildMultiContext() numbers the parts.
export function describeParts(parts) {
  return (parts || []).filter(Boolean).map((p, i) => {
    const pdf = partPdfName(p);
    const base = partBase(p);
    const thumb = p.image && typeof p.image.thumb === "string" ? p.image.thumb : "";
    return {
      n: i + 1,
      key: p.key,
      type: partType(p),
      base,
      pdf,
      full: `${base} · ${pdf}`,
      short: `${clipText(base, 30)} · ${clipText(pdf, 26)}`,
      thumb,
    };
  });
}

// ------------------------------------------------------------------ the @ list

// Items for "@": All parts, each part (figures show their thumbnail), whole PDFs, and the pages and blocks already
// mentioned. { id, group, label, detail, thumb, token | insert, mention, n, key, hay }.
export function atItems({ parts = [], mentions = [] } = {}) {
  const d = Array.isArray(parts) && parts.length && parts[0]?.n ? parts : describeParts(parts);
  const items = [];
  if (d.length > 1) items.push({ id: "all", group: "All", label: "All parts", detail: `${d.length} parts`, token: AT_ALL, all: true, hay: "all parts every everything" });
  for (const x of d) {
    items.push({
      id: `part:${x.key}`,
      group: x.type === "whole" ? "Whole PDF" : "Parts",
      label: `Part ${x.n} · ${x.base}`,
      detail: x.pdf,
      thumb: x.thumb,
      token: atToken(x.n),
      n: x.n,
      key: x.key,
      hay: `part ${x.n} ${TYPE_WORDS[x.type] || ""} ${x.base} ${x.pdf}`.toLowerCase(),
    });
  }
  for (const m of mentions || []) {
    if (m.kind === "block") items.push({ id: `block:${m.uid}`, group: "Pages and blocks", label: `Block: ${clipText(m.label || m.uid, 60)}`, detail: "", insert: `((${m.uid}))`, mention: m, hay: `block ${m.label || ""} ${m.uid}`.toLowerCase() });
    else items.push({ id: `page:${m.title}`, group: "Pages and blocks", label: `Page: ${m.title}`, detail: "", insert: `[[${m.title}]]`, mention: m, hay: `page ${m.title}`.toLowerCase() });
  }
  return items;
}

const GROUPS = ["All", "Parts", "Whole PDF", "Pages and blocks"];

// Every word of the query must match (a number matches the part number's start; "3" does not match "Table 13").
export function filterAtItems(items, query, limit = 30) {
  const words = squash(query).toLowerCase().split(" ").filter(Boolean);
  const hits = [];
  (items || []).forEach((it, order) => {
    let rank = 2;
    for (const w of words) {
      if (/^\d+$/.test(w)) {
        if (it.n == null) { if (!it.hay.includes(w)) return; continue; }
        const s = String(it.n);
        if (s === w) rank = Math.min(rank, 0);
        else if (s.startsWith(w)) rank = Math.min(rank, 1);
        else return;
      } else if (!it.hay.includes(w)) return;
    }
    hits.push([GROUPS.indexOf(it.group), rank, order, it]);
  });
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return hits.slice(0, limit).map((h) => h[3]);
}

// ------------------------------------------------------------------ @Part N in the text

const REF_RE = /(^|[^\w@])@(?:Part\s+(\d{1,3})(?!\d)(\s*\(removed\))?|All parts\b)/gi;

// [{ index, length, n, all, removed }] for every @Part N / @All parts in the text, in order.
export function parseAtRefs(text) {
  const src = String(text ?? "");
  const out = [];
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(src))) {
    const index = m.index + m[1].length;
    out.push({ index, length: m[0].length - m[1].length, n: m[2] ? Number(m[2]) : null, all: !m[2], removed: Boolean(m[3]) });
  }
  return out;
}

// References that point at nothing: a part removed after it was mentioned, or a number past the last part.
export function danglingAtRefs(text, count) {
  const seen = new Set();
  const out = [];
  for (const r of parseAtRefs(text)) {
    if (r.all) continue;
    if (!r.removed && r.n >= 1 && r.n <= count) continue;
    if (seen.has(r.n)) continue;
    seen.add(r.n);
    out.push({ n: r.n, token: atToken(r.n), removed: r.removed });
  }
  return out;
}

// A part goes: its references stay visible as "@Part 3 (removed)", the later parts move up by one and so do their
// references. -> { text, hit } where hit says a reference to the removed part was in the text.
export function afterPartRemoved(text, removedNo) {
  let hit = false;
  const next = String(text ?? "").replace(REF_RE, (all, pre, n, gone) => {
    if (!n || gone) return all;
    const k = Number(n);
    if (k === removedNo) { hit = true; return `${pre}@Part ${k} (removed)`; }
    if (k > removedNo) return `${pre}@Part ${k - 1}`;
    return all;
  });
  return { text: next, hit };
}

export function danglingMessage(dangling) {
  if (!dangling.length) return "";
  const names = dangling.map((d) => d.token).join(", ");
  const verb = dangling.length === 1 ? "no longer exists" : "no longer exist";
  return `${names} ${verb}. Delete ${dangling.length === 1 ? "it" : "them"} from the question or add the part back.`;
}

// The text with `token` at the caret (a space before it when the character before is not one).
export function insertToken(text, caret, token) {
  const src = String(text ?? "");
  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, src.length)) : src.length;
  const head = src.slice(0, at);
  const tail = src.slice(at);
  const lead = head && !/\s$/.test(head) ? " " : "";
  const trail = tail && /^\s/.test(tail) ? "" : " ";
  const next = `${head}${lead}${token}${trail}${tail}`;
  return { text: next, caret: head.length + lead.length + token.length + trail.length };
}

// ------------------------------------------------------------------ what the model is told

const where = (d) => (d.type === "whole" ? `the whole PDF "${d.pdf}"` : `${d.base.replace(/ · /g, ", ")} of "${d.pdf}"`);

// "In my question, @Part 3 means Part 3 of the context: Figure 1, p. 4 of "Report"." One entry per distinct reference;
// "" when the question mentions none. `numbered` is false when the context is one part with no "Part N" headings.
export function atPreamble(text, descs, { numbered = true } = {}) {
  const seen = new Set();
  const lines = [];
  for (const r of parseAtRefs(text)) {
    if (r.removed) continue;
    if (r.all) {
      if (seen.has("all") || !descs.length) continue;
      seen.add("all");
      lines.push(`@All parts means every part of the context (${descs.length}).`);
      continue;
    }
    const d = descs[r.n - 1];
    if (!d || seen.has(r.n)) continue;
    seen.add(r.n);
    lines.push(`${atToken(r.n)} means ${numbered ? `Part ${r.n} of the context` : "the part in the context"}: ${where(d)}.`);
  }
  return lines.length ? `In my question, ${lines.join(" ")}` : "";
}

export function withAtPreamble(prompt, preamble) {
  return preamble ? `${preamble}\n\n${prompt}` : String(prompt ?? "");
}
