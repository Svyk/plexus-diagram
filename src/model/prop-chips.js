// PXD-7 property chips. A board picks Name:: attributes to show as read-only chips on its cards. The only stored
// state is the board block's own plexus `chips` list. Pure helpers, no Roam calls.

import { laneAttrOk, valueKey, valueTokens } from "./attr-lanes.js";
import { plainText } from "./schema.js";

export const PROP_CHIPS_KEY = "chips";
export const PROP_CHIPS_CAP = 6;
export const PROP_VALUE_MAX = 40;

export function readPropChips(plexus) {
  const list = plexus?.[PROP_CHIPS_KEY];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name || !laneAttrOk(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length >= PROP_CHIPS_CAP) break;
  }
  return out;
}

// Remove `name` when picked, else append it. Past the cap the list is returned unchanged.
export function togglePropChip(list, name) {
  const cur = Array.isArray(list) ? list : [];
  if (cur.includes(name)) return cur.filter((n) => n !== name);
  if (!laneAttrOk(name) || cur.length >= PROP_CHIPS_CAP) return cur;
  return [...cur, name];
}

// [{ name, text }] in `names` order, for the names the row has (first Name:: attribute of each). Empty values skip.
export function propChipsOf(row, names) {
  const out = [];
  if (!row || !Array.isArray(names)) return out;
  for (const name of names) {
    const attr = (row.attrs || []).find((a) => a?.name === name);
    if (!attr) continue;
    const joined = valueTokens(attr.value).map((t) => valueKey(t.raw)).join(", ");
    const text = plainText(joined, PROP_VALUE_MAX);
    if (text) out.push({ name, text });
  }
  return out;
}
