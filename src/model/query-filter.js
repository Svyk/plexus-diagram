// PXD-17. A query card as a filter lens: cards whose target is in the query's results stay bright, the rest dim.
// Pure: which uids a card stands for, and which cards stay bright. Nothing here reads Roam or writes.

import { isQueryString } from "./query.js";

// The query block a card holds: its own string, or the block a ((ref)) card points at.
export function filterQueryUid(item, blockString) {
  if (!item || item.type === "section") return null;
  if (isQueryString(item.string)) return item.uid;
  if (item.target?.kind === "block" && item.target.uid) {
    let s = null;
    try { s = blockString?.(item.target.uid); } catch { s = null; }
    if (isQueryString(s)) return item.target.uid;
  }
  return null;
}

// The uids a card stands for: the block itself, the block it points at, or its page.
export function filterTargets(item, pageUid) {
  const out = [];
  if (!item?.uid || item.type === "section") return out;
  out.push(item.uid);
  const t = item.target;
  if (t?.kind === "block" && t.uid) out.push(t.uid);
  if (t?.kind === "page") {
    if (t.uid) out.push(t.uid);
    else if (t.title && typeof pageUid === "function") {
      let uid = null;
      try { uid = pageUid(t.title); } catch { uid = null; }
      if (uid) out.push(uid);
    }
  }
  if (item.highlight?.uid) out.push(item.highlight.uid);
  return out;
}

// Bright cards. The filtering card itself always stays bright, so the lens shows where it comes from.
export function filterBright(items, results, filterCardUid, pageUid) {
  const hits = results instanceof Set ? results : new Set(results || []);
  const bright = new Set();
  if (filterCardUid) bright.add(filterCardUid);
  for (const item of items || []) {
    if (!item?.uid || item.type === "section") continue;
    if (filterTargets(item, pageUid).some((u) => hits.has(u))) bright.add(item.uid);
  }
  return bright;
}

// Lens and filter together: only the overlap stays bright. Either may be null (no limit).
export function intersectBright(a, b) {
  if (!a) return b ? new Set(b) : null;
  if (!b) return new Set(a);
  const out = new Set();
  for (const uid of a) if (b.has(uid)) out.add(uid);
  return out;
}

export function filterLabel(title, count, { partial = false, waiting = false } = {}) {
  const name = String(title || "Query").trim() || "Query";
  if (waiting) return `Filter: ${name} · running…`;
  const n = Number(count) || 0;
  return `Filter: ${name} · ${n} ${n === 1 ? "match" : "matches"}${partial ? " · partial" : ""}`;
}
