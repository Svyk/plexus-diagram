// PDF cards that link the PDF's own page. A card `[[Title]]` (or `[label]([[Title]])`) is a PDF card when the
// first top-level `{{[[pdf]]: url}}` / `{{pdf: url}}` block on that page is the PDF. The pdf block keeps its uid,
// children, highlights and pins; the board only holds the page link, so an unfolded outline mounts no reader.
// Pure: no graph reads, no writes.

import { edgeString, semanticRef } from "./schema.js";
import { pdfFileTitle } from "./pdf.js";

const PDF_HEAD = /^\{\{\s*(?:\[\[pdf\]\]|pdf)\s*:/;
const ALIAS_PAGE = /^\[([^\]]*)\]\(\[\[([^\]]+)\]\]\)$/;

export function isPdfString(s) {
  return typeof s === "string" && PDF_HEAD.test(s.trim());
}

// `[[Title]]` or `[label]([[Title]])` -> { title, label }. Anything else (nested refs, extra text) is null.
export function pageCardRef(s) {
  const t = String(s ?? "").trim();
  if (t.startsWith("[[") && t.endsWith("]]")) {
    const title = t.slice(2, -2);
    if (title && !title.includes("[[") && !title.includes("]]")) return { title, label: "" };
    return null;
  }
  const m = ALIAS_PAGE.exec(t);
  if (!m || !m[2] || m[2].includes("[[")) return null;
  return { title: m[2], label: m[1].trim() };
}

const kidsOf = (node) => {
  const kids = node?.[":block/children"];
  return Array.isArray(kids) ? kids.slice().sort((a, b) => (a?.[":block/order"] ?? 0) - (b?.[":block/order"] ?? 0)) : [];
};

// A pulled page (`:node/title`, `:block/uid`, `:block/children` with string and order) -> its PDF, or null.
// Only top-level blocks count: a pdf block nested in a note on the page is not the page's PDF.
// `children` (the pdf block's children, sorted) is present only when the pull carried them.
export function pdfOfPageNode(node) {
  if (!node || typeof node !== "object") return null;
  const pageUid = typeof node[":block/uid"] === "string" ? node[":block/uid"] : "";
  const title = typeof node[":node/title"] === "string" ? node[":node/title"] : "";
  if (!title) return null;
  for (const kid of kidsOf(node)) {
    const string = kid?.[":block/string"];
    const uid = kid?.[":block/uid"];
    if (typeof uid === "string" && uid && isPdfString(string)) {
      // The pdf block's own children (the pins container) when the pull carried them: pin marks and arrow ends.
      const kids = kid[":block/children"];
      return { pageUid, title, pdfUid: uid, string, ...(Array.isArray(kids) ? { children: kidsOf(kid) } : {}) };
    }
  }
  return null;
}

// Roam names a PDF page "<title> -- <authors> -- <journal> -- <doi> -- <hash>". A card shows the first part.
export function pdfPageName(title) {
  const t = String(title ?? "").trim();
  const head = t.split(" -- ")[0].trim();
  return head || t;
}

const TITLE_MAX = 100;

// A page title from what the card shows. One line, no Roam syntax ([[ ]] # { } ` ^^ ** __ ~~ (( ))), no "/" (a Roam
// namespace separator, so it becomes "-"), no ellipsis. Longer than `max` is cut at a word boundary.
export function cleanPageTitle(s, max = 150) {
  let t = String(s ?? "").replace(/[\r\n\t]+/g, " ");
  t = t.replace(/\u2026|\.{3,}/g, " ").replace(/\s*\/+\s*/g, (m) => (/\s/.test(m) ? " - " : "-"));
  t = t.replace(/\(\(|\)\)|\^\^|\*\*|__|~~|::/g, " ").replace(/[\[\]{}#`]/g, " ");
  t = t.replace(/^[\s\-:;,.]+|[\s\-:;,]+$/g, "").replace(/\s+/g, " ").trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const space = cut.lastIndexOf(" ");
    t = (t[max] === " " || space < max / 2 ? cut : cut.slice(0, space)).replace(/[\s\-:;,(]+$/, "");
  }
  return t;
}

const MEANINGLESS = /^(?:pdf|untitled(?:\b.*)?|document|scan(?:ned)?)$/i;
const meaningful = (t) => t.length >= 3 && !MEANINGLESS.test(t);

// A storage id, not a name: up to 12 characters of [A-Za-z0-9_ -] with a capital after the first letter ("Y_Wx3LSX7k").
export function looksRandomName(name) {
  const n = String(name ?? "").trim();
  if (!n) return true;
  return /^[A-Za-z0-9_ -]{1,12}$/.test(n) && /[A-Z]/.test(n.slice(1));
}

// The first "name.pdf" in the blocks that mention the file: "report-scan.pdf: Fixture" -> "report-scan".
export function pdfNameFromRefs(strings) {
  for (const raw of Array.isArray(strings) ? strings : []) {
    const m = /\b([\w.-]+)\.pdf\b/i.exec(String(raw ?? "").replace(/\{\{[^}]*\}\}|\(\([^)]*\)\)|https?:\/\/\S+/g, " "));
    if (!m) continue;
    const name = cleanPageTitle(m[1].replace(/_+/g, " "), TITLE_MAX);
    if (meaningful(name)) return name;
  }
  return "";
}

const shortDate = (now) => {
  const d = new Date(Number.isFinite(now) ? now : Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// The parsed document title when it says something, then the card's alias label, a file name in a block that
// refers to the PDF, the file name of a url that is not a storage id, and last "PDF <date>". Never "PDF (2)".
export function pdfPageBaseTitle({ display = "", alias = "", refs = [], fileName = "", now } = {}) {
  const shown = cleanPageTitle(display, TITLE_MAX);
  if (meaningful(shown)) return shown;
  const label = cleanPageTitle(alias, TITLE_MAX);
  if (meaningful(label)) return label;
  const named = pdfNameFromRefs(refs);
  if (named) return named;
  const raw = String(fileName ?? "").replace(/\.pdf$/i, "");
  const file = cleanPageTitle(raw.replace(/_+/g, " "), TITLE_MAX);
  if (meaningful(file) && !looksRandomName(raw.replace(/_+/g, " ").trim())) return file;
  return `PDF ${shortDate(now)}`;
}

// "Title", then "Title (2)", "Title (3)", ... `taken(title)` is true for a title already used.
export function uniquePageTitle(base, taken) {
  const root = cleanPageTitle(base, TITLE_MAX) || `PDF ${shortDate()}`;
  const used = (t) => {
    try { return typeof taken === "function" && taken(t) === true; } catch { return true; }
  };
  if (!used(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const next = `${root} (${n})`;
    if (!used(next)) return next;
  }
  return `${root} (${Date.now()})`;
}

export const pageCardString = (title) => `[[${title}]]`;

// An old-style PDF card: the pdf block itself sits on the board.
export function isInlinePdfCard(item) {
  return Boolean(item && item.type === "card" && item.kind === "pdf" && item.target?.kind === "self");
}

export function inlinePdfCards(board) {
  const out = [];
  for (const item of board?.items?.values?.() || []) if (isInlinePdfCard(item)) out.push(item);
  return out;
}

// The dry-run plan for "Move PDFs to their own pages". One board only.
// deps:
//   urlOf(item)            -> the pdf url of an old-style card
//   layoutOf(uid)          -> the raw :plexus props on the pdf block (copied to the new card)
//   findPage({url, uid})   -> { uid, title, pdfUid? } of a page that already holds this file, or null
//   pageExists(title)      -> true when a page with that title exists
//   titleFor(item)         -> the title the card shows today ("PDF" when unknown)
//   aliasOf(item)          -> the card's alias label ("" when none)
//   refsOf(item)           -> strings of the blocks that refer to the pdf block
//   now()                  -> ms, for the "PDF <date>" fallback
//   newUid()               -> a fresh block uid
// Out: { graph, boardUid, moves, edges, skipped }. moves[i] = { pdfUid, url, parentUid, order, cardUid, cardString,
// layout, page: { uid, title, reuse, why } } where page.uid is null for a page to create (newUid in page.newUid).
export function planPdfMigration(board, { graph = "", urlOf, layoutOf, findPage, pageExists, titleFor, aliasOf, refsOf, now, newUid } = {}) {
  const plan = { graph, boardUid: board?.uid || "", moves: [], edges: [], skipped: [] };
  if (!board?.items) return plan;
  const call = (fn, ...args) => {
    try { return typeof fn === "function" ? fn(...args) : null; } catch { return null; }
  };
  const plannedTitles = new Set();
  const byUrl = new Map();
  const moved = new Map();
  for (const item of inlinePdfCards(board)) {
    const url = String(call(urlOf, item) || "");
    const shown = cleanPageTitle(call(titleFor, item) || "", TITLE_MAX) || "PDF";
    if (url && byUrl.has(url)) {
      plan.skipped.push({ pdfUid: item.uid, title: shown, reason: "same-file" });
      continue;
    }
    const found = call(findPage, { url, uid: item.uid });
    if (found?.pdfUid && found.pdfUid !== item.uid) {
      plan.skipped.push({ pdfUid: item.uid, title: found.title || shown, reason: "page-has-pdf" });
      continue;
    }
    let page;
    if (found?.uid && found.title) {
      page = { uid: found.uid, title: found.title, reuse: true, why: found.why || "url" };
    } else {
      const title = uniquePageTitle(pdfPageBaseTitle({ display: shown, alias: call(aliasOf, item) || "", refs: call(refsOf, item) || [], fileName: pdfFileTitle(url), now: call(now) }), (t) => plannedTitles.has(t) || call(pageExists, t) === true);
      page = { uid: null, newUid: String(call(newUid) || ""), title, reuse: false, why: "new" };
    }
    plannedTitles.add(page.title);
    if (url) byUrl.set(url, page.title);
    const layout = call(layoutOf, item.uid);
    const move = {
      pdfUid: item.uid,
      url,
      parentUid: item.parentUid,
      order: Number.isInteger(item.order) ? item.order : 0,
      cardUid: String(call(newUid) || ""),
      cardString: pageCardString(page.title),
      layout: layout && typeof layout === "object" ? { ...layout } : { type: "card", x: item.x, y: item.y, w: item.w, h: item.h },
      page,
    };
    plan.moves.push(move);
    moved.set(item.uid, move);
  }
  if (!moved.size) return plan;
  const refOf = (id) => {
    const m = moved.get(id);
    if (m) return pageCardString(m.page.title);
    const item = board.items.get(id);
    return item ? semanticRef(item) : `((${id}))`;
  };
  for (const edge of board.edges?.values?.() || []) {
    if (!moved.has(edge.from) && !moved.has(edge.to)) continue;
    const from = moved.get(edge.from)?.cardUid || edge.from;
    const to = moved.get(edge.to)?.cardUid || edge.to;
    const string = edgeString({
      srcRef: refOf(edge.from),
      dstRef: refOf(edge.to),
      dir: edge.dir,
      label: edge.label || "",
      srcBlock: edge.fromBlock,
      dstBlock: edge.toBlock,
    });
    plan.edges.push({ uid: edge.uid, from, to, string });
  }
  return plan;
}

// Lines for the dry-run dialog.
export function migrationLines(plan) {
  const lines = [];
  for (const m of plan?.moves || []) {
    lines.push(m.page.reuse ? `${m.page.title}: move to its existing page` : `${m.page.title}: new page`);
  }
  for (const s of plan?.skipped || []) {
    lines.push(s.reason === "same-file"
      ? `${s.title}: left on the board (the same file is already moving)`
      : `${s.title}: left on the board (its page already holds a PDF block)`);
  }
  if (plan?.edges?.length) lines.push(`${plan.edges.length} ${plan.edges.length === 1 ? "connection" : "connections"} rewritten`);
  return lines;
}
