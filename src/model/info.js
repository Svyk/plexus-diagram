// Pure slices of a card for the Info panel. Roam stays the store; this file only shapes strings.

import { attrNameOf } from "./schema.js";

export const PANEL_WIDTH_MIN = 260;
export const PANEL_WIDTH_MAX = 640;
export const PANEL_WIDTH_DEFAULT = 340;

// Dragging the panel's left edge. A negative screen delta widens it. The result stays in range.
export function nextPanelWidth(current, delta, { min = PANEL_WIDTH_MIN, max = PANEL_WIDTH_MAX } = {}) {
  const base = Number(current);
  const d = Number(delta);
  const start = Number.isFinite(base) ? base : PANEL_WIDTH_DEFAULT;
  const next = start + (Number.isFinite(d) ? d : 0);
  return Math.min(max, Math.max(min, Math.round(next)));
}

// Session list of open info cards. `add` appends a new uid; an existing uid only becomes current.
export function infoTabList(tabs, uid, { add = false } = {}) {
  const id = String(uid || "");
  const list = (tabs || []).filter((t) => t && t.uid).map((t) => ({ uid: String(t.uid) }));
  if (!id) return { tabs: list, current: list[0]?.uid || null };
  if (list.some((t) => t.uid === id)) return { tabs: list, current: id };
  if (!add) return { tabs: list, current: list[0]?.uid || null };
  const next = list.concat([{ uid: id }]);
  return { tabs: next, current: id };
}

// Drop one tab. Closing the current tab selects the neighbor that slides into its place.
export function closeInfoTab(tabs, current, uid) {
  const list = (tabs || []).filter((t) => t && t.uid && t.uid !== uid);
  let cur = current === uid ? null : current;
  if (!cur || !list.some((t) => t.uid === cur)) {
    const idx = (tabs || []).findIndex((t) => t && t.uid === uid);
    cur = list[idx]?.uid || list[idx - 1]?.uid || null;
  }
  return { tabs: list, current: cur };
}

// Direct child strings of the form `Name:: value`. The page card's own `[[title]]` is not an attribute.
export function attributeRows(strings) {
  const out = [];
  for (const raw of strings || []) {
    const name = attrNameOf(raw);
    if (!name) continue;
    const text = String(raw);
    const cut = text.indexOf("::");
    out.push({ name, value: cut >= 0 ? text.slice(cut + 2).trim() : "" });
  }
  return out;
}

// `#tag` and `#[[Page]]`. The same name is listed once, in first-seen order.
export function tagNames(text) {
  const out = [];
  const re = /#\[\[([^\]\n]+)\]\]|#([^\s#[\]()]+)/g;
  let match;
  const source = String(text ?? "");
  while ((match = re.exec(source))) {
    const name = String(match[1] || match[2] || "").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// Boards already filtered toward plexus v2. A missing `v` is kept; any other `v` is dropped.
export function boardsFromRows(rows, { limit = 20 } = {}) {
  const seen = new Set();
  const out = [];
  const cap = Number.isFinite(limit) && limit > 0 ? limit : 20;
  for (const row of rows || []) {
    if (!row?.uid || seen.has(row.uid)) continue;
    if (row.v != null && row.v !== 2) continue;
    seen.add(row.uid);
    out.push({
      uid: row.uid,
      title: row.title || "Untitled board",
      pageTitle: row.pageTitle || "",
    });
    if (out.length >= cap) break;
  }
  return out;
}
