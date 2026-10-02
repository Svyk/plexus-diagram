// Neighbour cards around a page or block. The ring is cards only.
// Derived links are drawn by the existing graph-link pass and are not written.

import { attrNameOf } from "./schema.js";

export const NEIGHBOR_CAP = 24;
const CARD_W = 280;
const CARD_H = 160;

export function pageRefString(title) {
  const s = String(title ?? "").trim();
  if (!s || s.includes("]]") || /[\n\r]/.test(s)) return null;
  return `[[${s}]]`;
}

export function splitNeighbors({ outgoing = [], incoming = [], selfTitle = "", selfUid = "" } = {}) {
  const out = [];
  const attr = [];
  const counts = new Map();
  const seenOut = new Set();
  const seenAttr = new Set();
  for (const row of outgoing) {
    const title = row?.[0];
    if (typeof title !== "string" || !title) continue;
    const name = attrNameOf(row?.[1]);
    if (name && title === name) continue;
    if (selfTitle && title === selfTitle) continue;
    if (name) {
      if (seenAttr.has(title)) continue;
      seenAttr.add(title);
      attr.push(title);
    } else if (!seenOut.has(title)) {
      seenOut.add(title);
      out.push(title);
    }
  }
  for (const row of incoming) {
    const uid = row?.[0];
    const title = row?.[2];
    if (typeof title !== "string" || !title) continue;
    if (selfUid && uid === selfUid) continue;
    if (selfTitle && title === selfTitle) continue;
    if (attrNameOf(row?.[1])) continue;
    counts.set(title, (counts.get(title) || 0) + 1);
  }
  const inn = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([title]) => title);
  return {
    out: out.slice(0, NEIGHBOR_CAP),
    in: inn.slice(0, NEIGHBOR_CAP),
    attr: attr.slice(0, NEIGHBOR_CAP),
  };
}

export function neighborLayout(rect, titles, { skip = [] } = {}) {
  if (!rect) return [];
  const skipSet = new Set(skip);
  const list = [];
  const seen = new Set();
  for (const title of titles || []) {
    const string = pageRefString(title);
    if (!string || seen.has(string) || skipSet.has(String(title).trim())) continue;
    seen.add(string);
    list.push(string);
    if (list.length >= NEIGHBOR_CAP) break;
  }
  const n = list.length;
  if (!n) return [];
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const radius = Math.max(rect.w, rect.h) / 2 + 240;
  return list.map((string, i) => {
    const angle = -Math.PI / 2 + (n === 1 ? 0 : (i / n) * Math.PI * 2);
    return {
      string,
      x: Math.round(cx + Math.cos(angle) * radius - CARD_W / 2),
      y: Math.round(cy + Math.sin(angle) * radius - CARD_H / 2),
    };
  });
}
