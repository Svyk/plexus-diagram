// Pure slices of a card for the Info panel. Roam stays the store; this file only shapes strings.

import { attrNameOf } from "./schema.js";

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
