// Query cards. A block whose whole string is a Roam query stays a live renderBlock.
// "Add results as cards" reads the uids Roam rendered and places ref cards around it.

export const QUERY_CARD_CAP = 45;
const CARD_W = 280;
const CARD_H = 160;
const UID_RE = /^[A-Za-z0-9_-]{9}$/;

export function isQueryString(s) {
  const t = String(s ?? "").trim();
  return /^\{\{\s*\[\[query\]\]\s*(?::[\s\S]*)?\}\}$/.test(t)
    || /^\{\{\s*query\s*(?::[\s\S]*)?\}\}$/.test(t);
}

// Roam block ids end in -<uid>. Outline editors use -body-outline-<page>-<uid>.
// Query result rows use -roam-query-<queryUid>-<uid>. A uuid's last segment is
// 12 hex chars, so the hyphen immediately before the last 9 is the uid boundary.
export function blockUidFromDomId(id) {
  const s = String(id || "");
  if (UID_RE.test(s)) return s;
  if (s.length < 10 || s.slice(-10, -9) !== "-") return null;
  const uid = s.slice(-9);
  return UID_RE.test(uid) ? uid : null;
}

export function queryResultUids(root, skipUid) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  const seen = new Set();
  if (skipUid) seen.add(skipUid);
  const out = [];
  for (const node of root.querySelectorAll("[id]")) {
    const uid = blockUidFromDomId(node.id);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

// Ref cards in a ring around the query card. One result sits above it. Capped at 45.
export function queryResultLayout(rect, uids) {
  if (!rect) return [];
  const list = [];
  const seen = new Set();
  for (const uid of uids || []) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    list.push(uid);
    if (list.length >= QUERY_CARD_CAP) break;
  }
  const n = list.length;
  if (!n) return [];
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const radius = Math.max(rect.w, rect.h) / 2 + 240;
  return list.map((uid, i) => {
    const angle = -Math.PI / 2 + (n === 1 ? 0 : (i / n) * Math.PI * 2);
    return {
      string: `((${uid}))`,
      x: Math.round(cx + Math.cos(angle) * radius - CARD_W / 2),
      y: Math.round(cy + Math.sin(angle) * radius - CARD_H / 2),
    };
  });
}
