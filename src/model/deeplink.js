import { semanticRef } from "./schema.js";

const UID_RE = /^[\w-]{1,32}$/;

export function isShowableCard(plexus) {
  if (!plexus || typeof plexus !== "object") return false;
  if (plexus.type === "section" || plexus.type === "edges" || plexus.type === "edge") return false;
  return Number.isFinite(Number(plexus.x)) && Number.isFinite(Number(plexus.y));
}

function decodePart(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function pageUidFromHash(hash) {
  const match = /#\/app\/[^/]+\/page\/([^/?#]+)/.exec(String(hash ?? ""));
  return match ? decodePart(match[1]) : "";
}

export function graphFromDeepLink(hash) {
  const match = /#\/app\/([^/?#]+)/.exec(String(hash ?? ""));
  return match ? decodePart(match[1]) : "";
}

export function cardDeepLink({ graph, pageUid, cardUid } = {}) {
  const g = String(graph ?? "").trim();
  const page = String(pageUid ?? "").trim();
  const card = String(cardUid ?? "").trim();
  if (!g || !UID_RE.test(page) || !UID_RE.test(card)) return "";
  return `#/app/${encodeURIComponent(g)}/page/${encodeURIComponent(page)}?pxd=${encodeURIComponent(card)}`;
}

// Roam rewrites location.hash and drops ?pxd= before listeners run. The
// hashchange event's newURL still has the link we assigned.
export function hashFromUrl(url) {
  const text = String(url ?? "");
  const mark = text.indexOf("#");
  return mark >= 0 ? text.slice(mark) : "";
}

export function pxdTarget(hash) {
  const text = String(hash ?? "");
  const q = text.indexOf("?");
  if (q < 0) return null;
  let card = "";
  try {
    card = new URLSearchParams(text.slice(q + 1).split("#")[0]).get("pxd") || "";
  } catch {
    return null;
  }
  if (!UID_RE.test(card)) return null;
  return { cardUid: card, pageUid: pageUidFromHash(text), graph: graphFromDeepLink(text) };
}

export function copyLinkText(item, { graph, pageUid, cardUid } = {}) {
  const ref = semanticRef(item);
  const url = cardDeepLink({ graph, pageUid, cardUid: cardUid || item?.uid });
  return url ? `${ref}\n${url}` : ref;
}

// The block is the card, or a card on a board references it. A card beats a ref.
// Several boards sort by board uid, then card uid.
export function locateShowTarget(uid, placements) {
  const id = String(uid ?? "").trim();
  if (!id) return null;
  const hits = [];
  const seen = new Set();
  for (const row of placements || []) {
    const boardUid = String(row?.boardUid ?? "").trim();
    const cardUid = String(row?.cardUid ?? "").trim();
    const pageUid = String(row?.pageUid ?? "").trim();
    if (!boardUid || !cardUid) continue;
    const refs = Array.isArray(row.refUids) ? row.refUids.map((r) => String(r)) : [];
    if (cardUid !== id && !refs.includes(id)) continue;
    const key = `${boardUid}\n${cardUid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ boardUid, pageUid, cardUid });
  }
  if (!hits.length) return null;
  const self = hits.filter((hit) => hit.cardUid === id);
  const pool = self.length ? self : hits;
  pool.sort((a, b) => a.boardUid.localeCompare(b.boardUid) || a.cardUid.localeCompare(b.cardUid));
  return pool[0];
}

export function assignDeepLink(loc, { graph, pageUid, cardUid } = {}, onSame) {
  const link = cardDeepLink({ graph, pageUid, cardUid });
  if (!link || !loc) return "";
  if (loc.hash === link) {
    if (typeof onSame === "function") onSame();
    return link;
  }
  loc.hash = link;
  return link;
}
