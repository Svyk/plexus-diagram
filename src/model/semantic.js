// Roam's semantic search, turned into Add-panel rows. The engine returns 25 ranked {type, uid, topUids}
// with no text and no score; the text is pulled. One long page would fill the list, so hits are grouped
// by page. Pure: the caller passes `pull` (uid → pulled map or null).

import { isPdfString } from "./pdf-page.js";
import { pdfMacroUrl } from "./pdf.js";

export const SEM_PER_PAGE = 2;
export const RELATED_CHARS = 600;
export const RELATED_CHILDREN = 10;

export const SEM_PULL = "[:block/uid :block/string :node/title :edit/time {:block/refs [:node/title]} {:block/page [:block/uid :node/title :pdf/url]} {:block/parents [:block/uid :block/string :node/title]}]";

// Roam markup → readable text (display and queries only).
export function cleanText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\^\^([^^]+)\^\^/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/#([\w-]+)/g, "$1")
    .replace(/\(\([^()]+\)\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DAILY = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(st|nd|rd|th), \d{4}$/;

// The query for "Find related": the card's title (not a daily title) + its own text + its first ten children, ≤600 chars.
export function relatedQueryText({ title = "", string = "", children = [] } = {}) {
  const head = title && !DAILY.test(title) ? cleanText(title) : "";
  const own = cleanText(string);
  const kids = (Array.isArray(children) ? children : []).map((c) => cleanText(typeof c === "string" ? c : c?.string)).filter(Boolean).slice(0, RELATED_CHILDREN);
  return [head, own, ...kids].filter(Boolean).join("\n").slice(0, RELATED_CHARS).trim();
}

const str = (v) => (typeof v === "string" ? v : "");

// The PDF a hit belongs to: the hit is the pdf block, sits under one, or lives on a Roam PDF page (:pdf/url).
function pdfOf(pulled) {
  if (isPdfString(pulled?.[":block/string"])) return { uid: str(pulled[":block/uid"]), string: pulled[":block/string"] };
  const parents = Array.isArray(pulled?.[":block/parents"]) ? pulled[":block/parents"] : [];
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    if (isPdfString(parents[i]?.[":block/string"])) return { uid: str(parents[i][":block/uid"]), string: parents[i][":block/string"] };
  }
  const url = str(pulled?.[":block/page"]?.[":pdf/url"]);
  return url ? { uid: "", string: "", url } : null;
}

const DIAGRAM = /^\s*\{\{(?:\[\[)?diagram/i;

// A board's connection line ("((a)) → ((b))" under the board's Connections block) is not a note.
function isConnection(pulled) {
  const parents = Array.isArray(pulled?.[":block/parents"]) ? pulled[":block/parents"] : [];
  return parents.some((p) => str(p?.[":block/string"]).trim() === "Connections") && parents.some((p) => DIAGRAM.test(str(p?.[":block/string"])));
}

// raw engine results → candidate rows in rank order, at most `perPage` per page, deduped by target.
// `pdfBlockOf(url)` → { uid, string, pageTitle } | null resolves a Roam PDF page to its pdf block.
export function semanticCandidates(raw, { pull, pdfBlockOf = () => null, perPage = SEM_PER_PAGE } = {}) {
  const out = [];
  const seen = new Set();
  const perPageCount = new Map();
  const list = Array.isArray(raw) ? raw : [];
  for (let rank = 0; rank < list.length; rank += 1) {
    const item = list[rank];
    if (!item || !item.uid) continue;
    const uids = Array.isArray(item.topUids) && item.topUids.length ? item.topUids : [item.uid];
    let row = null;
    const hits = [];
    for (const uid of uids) {
      let pulled = null;
      try { pulled = pull(uid); } catch { pulled = null; }
      if (!pulled) continue;
      const title = str(pulled[":node/title"]);
      if (title) {
        if (title.startsWith("roam/")) continue;
        row = { kind: "page", uid: str(pulled[":block/uid"]) || uid, title, pageUid: uid, edited: pulled[":edit/time"] ?? null, tags: [] };
        break;
      }
      const string = str(pulled[":block/string"]);
      const page = pulled[":block/page"] || {};
      const pageTitle = str(page[":node/title"]);
      if (pageTitle.startsWith("roam/")) continue;
      const tags = (Array.isArray(pulled[":block/refs"]) ? pulled[":block/refs"] : []).map((r) => str(r?.[":node/title"])).filter(Boolean);
      const pdf = pdfOf(pulled);
      if (pdf) {
        let target = pdf.uid ? { uid: pdf.uid, string: pdf.string, pageTitle } : null;
        if (!target && pdf.url) { try { target = pdfBlockOf(pdf.url); } catch { target = null; } }
        if (target?.uid && pdfMacroUrl(target.string)) {
          row = { kind: "block", uid: target.uid, string: target.string, pageTitle: target.pageTitle || pageTitle, pageUid: str(page[":block/uid"]), edited: pulled[":edit/time"] ?? null, tags, via: uid };
          break;
        }
      }
      if (!cleanText(string) || isConnection(pulled)) continue;
      hits.push({ kind: "block", uid: str(pulled[":block/uid"]) || uid, string, pageTitle, pageUid: str(page[":block/uid"]), edited: pulled[":edit/time"] ?? null, tags });
    }
    // The shown hit: the first with real text (≥20 characters, not an attribute line like "Due:: [[date]]").
    if (!row && hits.length) {
      const attr = (h) => /^[^:\n]{1,40}::/.test(h.string);
      row = hits.find((h) => !attr(h) && cleanText(h.string).length >= 20) || hits.find((h) => !attr(h)) || hits[0];
    }
    if (!row) continue;
    const key = `${row.kind}:${row.uid}`;
    if (seen.has(key)) continue;
    const pageKey = row.pageUid || row.uid;
    const n = perPageCount.get(pageKey) || 0;
    if (n >= perPage) continue;
    perPageCount.set(pageKey, n + 1);
    seen.add(key);
    out.push({ ...row, rank, semantic: true });
  }
  return out;
}

// Keyword rows first, then semantic rows not already shown (by card string), each marked.
export function mergeSemantic(keywordRows, semanticRows, limit = 40) {
  const shown = new Set((Array.isArray(keywordRows) ? keywordRows : []).map((r) => r?.string).filter(Boolean));
  const extra = [];
  for (const row of Array.isArray(semanticRows) ? semanticRows : []) {
    if (!row?.string || shown.has(row.string)) continue;
    shown.add(row.string);
    extra.push({ ...row, semantic: true });
    if (extra.length >= limit) break;
  }
  return extra;
}
