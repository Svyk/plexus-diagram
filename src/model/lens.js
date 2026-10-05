// Tag lens. Pure: which cards stay bright. Roam stays the store; nothing here writes.

import { tagNames } from "./info.js";

// The card string, its own outline children, and any text the caller already read off the page or target block.
export function tagsForCard(item, extra = "") {
  const parts = [];
  if (item?.string) parts.push(String(item.string));
  for (const kid of item?.content || []) {
    const text = kid?.[":block/string"] ?? kid?.string ?? "";
    if (text) parts.push(String(text));
  }
  if (extra) parts.push(String(extra));
  return tagNames(parts.join("\n"));
}

// First-seen tag order. `byUid` is the tag list for every card that was offered.
export function lensCatalog(cards) {
  const tags = [];
  const seen = new Set();
  const byUid = new Map();
  for (const card of cards || []) {
    if (!card?.uid) continue;
    const list = [];
    for (const tag of card.tags || []) {
      const name = String(tag || "").trim();
      if (!name || list.includes(name)) continue;
      list.push(name);
      if (!seen.has(name)) {
        seen.add(name);
        tags.push(name);
      }
    }
    byUid.set(card.uid, list);
  }
  return { tags, byUid };
}

// Cards carrying `tag`. With a focus set, only the overlap stays bright. No tag leaves the focus set as-is.
export function lensBright(byUid, tag, focusSet = null) {
  const name = String(tag || "").trim();
  if (!name) return focusSet ? new Set(focusSet) : null;
  const bright = new Set();
  for (const [uid, tags] of byUid || []) {
    if ((tags || []).includes(name)) bright.add(uid);
  }
  if (!focusSet) return bright;
  const both = new Set();
  for (const uid of bright) if (focusSet.has(uid)) both.add(uid);
  return both;
}

// Highlight lens tag. Seven colour names only. Gray and anything else are not a row.
const HIGHLIGHT_LENS_NAMES = ["yellow", "green", "blue", "pink", "purple", "orange", "red"];

export function highlightLensTag(color) {
  const name = String(color ?? "").trim().toLowerCase();
  return HIGHLIGHT_LENS_NAMES.includes(name) ? `h/${name}` : "";
}
