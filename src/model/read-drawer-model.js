// Highlight drawer row model. The pane used to sort and filter this list itself.
// No writes, no DOM. The pane width stays the first token of readPaneKey; the
// drawer fraction is the second token, so a resize does not drop the pane width.

import { CARD_MIME } from "./drop.js";
import { HIGHLIGHT_COLORS } from "./highlight.js";
import { highlightRows } from "./highlight-pick.js";

export { CARD_MIME, highlightRows };

const COLOR_ORDER = ["gray", ...HIGHLIGHT_COLORS];

function listOf(rows) {
  return Array.isArray(rows) ? rows : [];
}

// Page order, stable when two rows share a page. Rows with no page go last.
export function sortRows(rows) {
  return listOf(rows).map((row, index) => ({ row, index })).sort((a, b) => {
    const ap = typeof a.row?.page === "number" ? a.row.page : Infinity;
    const bp = typeof b.row?.page === "number" ? b.row.page : Infinity;
    if (ap !== bp) return ap - bp;
    return a.index - b.index;
  }).map((entry) => entry.row);
}

// Empty colours means every colour. A page filters only when it is a finite number.
export function filterRows(rows, { colors, page, needle } = {}) {
  const set = colors instanceof Set && colors.size > 0 ? colors : null;
  const pageWant = typeof page === "number" && Number.isFinite(page) ? page : null;
  const q = typeof needle === "string" ? needle.trim().toLowerCase() : "";
  return listOf(rows).filter((row) => {
    if (!row || typeof row !== "object") return false;
    if (set && !set.has(row.color)) return false;
    if (pageWant != null && row.page !== pageWant) return false;
    if (q && !String(row.snippet || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

// Uids present in rows that were not in the previous set. Order follows rows.
export function diffNew(prevUids, rows) {
  const prev = prevUids instanceof Set ? prevUids : new Set(Array.isArray(prevUids) ? prevUids : []);
  const seen = new Set();
  const out = [];
  for (const row of listOf(rows)) {
    const uid = typeof row === "string" ? row : row?.uid;
    if (typeof uid !== "string" || uid === "" || prev.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

export function colorsPresent(rows) {
  const have = new Set();
  for (const row of listOf(rows)) {
    if (typeof row?.color === "string" && row.color) have.add(row.color);
  }
  const known = COLOR_ORDER.filter((name) => have.has(name));
  const rest = [...have].filter((name) => !COLOR_ORDER.includes(name)).sort();
  return known.concat(rest);
}

export function pagesPresent(rows) {
  const pages = new Set();
  for (const row of listOf(rows)) {
    if (typeof row?.page === "number" && Number.isFinite(row.page)) pages.add(row.page);
  }
  return [...pages].sort((a, b) => a - b);
}

// Board items mark a highlight placed when their target uid matches. A bare string does too.
export function placedUidSet(placed) {
  const out = new Set();
  const list = placed instanceof Set ? placed : (Array.isArray(placed) ? placed : []);
  for (const value of list) {
    if (typeof value === "string" && value) out.add(value);
    else if (value && typeof value === "object" && typeof value.target?.uid === "string" && value.target.uid) {
      out.add(value.target.uid);
    }
  }
  return out;
}

// "420" or "420 0.4". Width is the pane. Drawer is a fraction in (0, 1].
// Number("420 0.4") is NaN, so the pane must read the width with readKeyPair.
export function readKeyPair(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { width: null, drawer: null };
  const parts = text.split(/\s+/);
  const width = Number(parts[0]);
  const drawer = parts.length > 1 ? Number(parts[1]) : NaN;
  return {
    width: Number.isFinite(width) && width > 0 ? width : null,
    drawer: Number.isFinite(drawer) && drawer > 0 && drawer <= 1 ? drawer : null,
  };
}

export function writeKeyPair(raw, drawer) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const n = Number(drawer);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return text;
  const first = text ? text.split(/\s+/)[0] : "0";
  const second = String(Math.round(n * 1000) / 1000);
  return `${first} ${second}`;
}

// Same payload the list row used to put on dragstart: CARD_MIME and text/plain.
export function cardDragPayload(uid) {
  if (typeof uid !== "string" || uid === "") return "";
  return `((${uid}))`;
}

export function fillCardDrag(data, uid) {
  const payload = cardDragPayload(uid);
  if (!payload || !data || typeof data.setData !== "function") return "";
  try { data.setData(CARD_MIME, payload); } catch { return ""; }
  try { data.setData("text/plain", payload); } catch { /* second type */ }
  try { data.effectAllowed = "copy"; } catch { /* read only */ }
  return payload;
}
