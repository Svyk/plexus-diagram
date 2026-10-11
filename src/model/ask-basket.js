// Ask AI basket. Parts collected from different PDFs, asked about in one question. In memory, per graph: it survives
// closing the dialog, not a reload. Pure state; the views draw it.

import { buildFocusContext, chipText } from "./ai-context.js";
import { pdfCardForUrl } from "./pdf.js";

export const BASKET_MAX = 8;

// A part: { key, label, docTitle, page, pdfUid, url, blockId, selection, wholeDoc, doc, image, source }.
// `doc` is the parsed document it came from (or a stand-in), `source` is answerSource()'s result ({ pin } | { sourceUid } | {}).
export function createBasket(max = BASKET_MAX) {
  const parts = [];
  const subs = new Set();
  const tell = () => { for (const fn of [...subs]) { try { fn(parts.slice()); } catch { /* view */ } } };
  return {
    max,
    list: () => parts.slice(),
    size: () => parts.length,
    has: (key) => parts.some((p) => p.key === key),
    // -> "added" | "have" | "full"
    add(part) {
      if (!part || !part.key) return "have";
      if (parts.some((p) => p.key === part.key)) return "have";
      if (parts.length >= max) return "full";
      parts.push(part);
      tell();
      return "added";
    },
    remove(key) {
      const at = parts.findIndex((p) => p.key === key);
      if (at < 0) return false;
      parts.splice(at, 1);
      tell();
      return true;
    },
    clear() { if (!parts.length) return; parts.length = 0; tell(); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

const baskets = new Map();
export function basketFor(graph) {
  const id = String(graph || "");
  let b = baskets.get(id);
  if (!b) { b = createBasket(); baskets.set(id, b); }
  return b;
}

export const partKey = ({ pdfUid = "", url = "", blockId = "", selection = "", page = null, wholeDoc = false } = {}) =>
  [pdfUid || url, wholeDoc ? "doc" : blockId || (selection ? `sel:${String(selection).slice(0, 80)}` : page != null ? `pg${page}` : "x")].join("|");

export const BASKET_MESSAGES = Object.freeze({
  added: "Added to your question",
  have: "Already in your question",
  full: `Your question holds ${BASKET_MAX} parts. Remove one first`,
});

export const pillText = (n) => `${n} part${n === 1 ? "" : "s"} · Ask`;

// The card on a board that stands for a source: the PDF card itself, or a pin card (the item's OWN block is the pin or a
// bare ref to it; never a card that merely has Source:: ((pin)) as a child, and never an "AI answer" card), else the PDF
// card whose source URL is the part's url. items: iterable of ALL board items, section members included.
// pdfSourceOf(item) -> the item's `{{[[pdf]]: url}}` string (defaults to item.string). -> uid or "".
export function findSourceCard(items, { pinUid = "", pdfUid = "", url = "", pdfSourceOf = null } = {}) {
  const list = [...(items || [])];
  if (pinUid) {
    const isAnswer = (it) => /^\s*AI answer\b/.test(String(it?.string ?? ""));
    const hit = list.find((it) => it && !isAnswer(it) && (it.uid === pinUid || (it.target?.kind !== "self" && it.target?.uid === pinUid)));
    if (hit) return hit.uid;
  }
  if (pdfUid) {
    const hit = list.find((it) => it?.uid === pdfUid && it.kind === "pdf") || list.find((it) => it?.uid === pdfUid);
    if (hit) return hit.uid;
  }
  if (url) {
    const cards = list
      .filter((it) => it?.kind === "pdf")
      .map((it) => {
        let source = "";
        try { source = typeof pdfSourceOf === "function" ? pdfSourceOf(it) : it.string; } catch { source = ""; }
        return { uid: it.uid, source };
      });
    const hit = pdfCardForUrl(url, cards);
    if (hit) return hit;
  }
  return "";
}

// A part for the basket from a parsed document and what to ask about: focus = { blockId | blockIds | selection | page | wholeDoc }.
// label "Table 3 · p. 10 · <doc>"; a whole document is "Whole document · <title>".
export function makePart({ doc, focus = {}, pdfUid = "", url = "", image = null, source = null, kind = "pdf" } = {}) {
  const chip = buildFocusContext(doc, focus).chip;
  const whole = focus.wholeDoc === true && !focus.blockId && !focus.selection && !Number.isInteger(focus.page);
  const label = whole ? `Whole document · ${chip.label || "PDF"}` : chipText(chip);
  return {
    key: partKey({ pdfUid, url, blockId: focus.blockId || "", selection: focus.selection || "", page: focus.page ?? null, wholeDoc: whole }),
    kind,
    label: label || "Part",
    docTitle: whole ? chip.label : chip.docTitle || "",
    page: chip.page ?? null,
    pdfUid,
    url,
    blockId: focus.blockId || "",
    ...(focus.blockIds ? { blockIds: focus.blockIds } : {}),
    selection: focus.selection || "",
    wholeDoc: whole,
    doc,
    image: image || null,
    source: source || {},
  };
}
