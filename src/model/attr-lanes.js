// PXD-11 attribute lanes. A lane section bound to one Name:: attribute splits along its long axis into one band
// per value plus a "none" band. A card's band is its block's value; a drop into another band plans one write on the
// first Name:: child (or a new one). Positions are never derived from values: a value changed in Roam moves the
// card's mark, not the card. Pure helpers, no Roam calls. BT_attr* names are refused here (Kanban owns them).

import { HIGHLIGHT_FIELD, TODO_FIELD, kanbanFields } from "./kanban.js";
import { columnNameOk, planAttrCell } from "./table.js";

// Lane plexus keys: the bound attribute name and the band order seen at bind (raw values, none excluded).
export const LANE_ATTR_KEY = "attr";
export const LANE_BANDS_KEY = "bands";
export const LANE_NONE_LABEL = "none";
export const LANE_BAND_CAP = 16;
export const LANE_PAD = 16;
export const LANE_GAP = 12;

export const laneAttrOk = (name) => columnNameOk(name);

// Attribute names a lane can bind to: the Kanban field list without the marker and highlight fields.
export function laneFields(rows) {
  return kanbanFields(rows).filter((name) => name !== TODO_FIELD && name !== HIGHLIGHT_FIELD && laneAttrOk(name));
}

const TOKEN = /#\[\[[^\]]+\]\]|\[\[[^\]]+\]\]|#[^\s,#\[\]]+/g;

// Value tokens with their offsets. A value made only of page refs and tags (spaces or commas between) is one token
// per ref; anything else is the whole trimmed value.
export function valueTokens(value) {
  const text = String(value ?? "");
  const trimmed = text.trim();
  if (!trimmed) return [];
  const out = [];
  let rest = text;
  TOKEN.lastIndex = 0;
  let hit;
  while ((hit = TOKEN.exec(text))) out.push({ raw: hit[0], at: hit.index });
  if (out.length) {
    for (const t of out) rest = rest.replace(t.raw, "");
    if (/^[\s,]*$/.test(rest)) return out;
  }
  return [{ raw: trimmed, at: text.indexOf(trimmed) }];
}

export function valueKey(raw) {
  const s = String(raw ?? "").trim();
  const m = /^#?\[\[([^\]]+)\]\]$/.exec(s) || /^#([^\s,#\[\]]+)$/.exec(s);
  return (m ? m[1] : s).trim();
}

// { key, raw, attr, tokens, two }. key "" is none. `two` when the card has a second Name:: child or a second value.
export function laneValueOf(row, name) {
  const attrs = (row?.attrs || []).filter((a) => a?.name === name);
  const attr = attrs[0] || null;
  const tokens = valueTokens(attr?.value);
  const raw = tokens[0]?.raw ?? "";
  return { key: valueKey(raw), raw, attr, tokens, two: attrs.length > 1 || tokens.length > 1 };
}

export function readLaneBind(plexus) {
  const name = typeof plexus?.[LANE_ATTR_KEY] === "string" ? plexus[LANE_ATTR_KEY].trim() : "";
  if (!name || !laneAttrOk(name)) return null;
  const bands = Array.isArray(plexus?.[LANE_BANDS_KEY])
    ? plexus[LANE_BANDS_KEY].filter((v) => typeof v === "string" && valueKey(v)).slice(0, LANE_BAND_CAP)
    : [];
  return { name, bands };
}

// Stored band order first, then values in card order, then none. Past the cap, more values sit in none.
export function laneBands(rows, name, stored = []) {
  const bands = [];
  const seen = new Set();
  const add = (raw) => {
    const key = valueKey(raw);
    if (!key || seen.has(key) || bands.length >= LANE_BAND_CAP) return;
    seen.add(key);
    bands.push({ key, raw: String(raw).trim(), label: key });
  };
  for (const raw of stored || []) add(raw);
  for (const row of rows || []) {
    const v = laneValueOf(row, name);
    if (v.key) add(v.raw);
  }
  bands.push({ key: "", raw: "", label: LANE_NONE_LABEL, none: true });
  return bands;
}

export const serializeBands = (bands) => (bands || []).filter((b) => !b.none && b.key).map((b) => b.raw);

// The band a card sits in by value: its key's band, none when the key has no band (or past the cap).
export function bandOfRow(bands, row, name) {
  const { key } = laneValueOf(row, name);
  const i = key ? bands.findIndex((b) => b.key === key) : -1;
  return i >= 0 ? i : bands.length - 1;
}

const axisOf = (axis) => (axis === "vertical" ? "vertical" : "horizontal");

// Horizontal lanes band along x, vertical lanes along y.
export function bandRect(rect, axis, count, i) {
  const n = Math.max(1, count);
  if (axisOf(axis) === "vertical") {
    const h = rect.h / n;
    return { x: rect.x, y: rect.y + h * i, w: rect.w, h };
  }
  const w = rect.w / n;
  return { x: rect.x + w * i, y: rect.y, w, h: rect.h };
}

export function bandIndexAt(rect, axis, count, point) {
  const n = Math.max(1, count);
  const vertical = axisOf(axis) === "vertical";
  const span = vertical ? rect.h : rect.w;
  if (!(span > 0)) return 0;
  const off = vertical ? point.y - rect.y : point.x - rect.x;
  return Math.min(n - 1, Math.max(0, Math.floor((off / span) * n)));
}

function rewriteTokens(value, tokens, band) {
  const text = String(value ?? "");
  const first = tokens[0];
  const same = tokens.findIndex((t, i) => i > 0 && valueKey(t.raw) === band.key);
  if (same > 0) {
    // The target is already a later value: swap it to the front so no value is lost or doubled.
    const other = tokens[same];
    return text.slice(0, first.at) + other.raw + text.slice(first.at + first.raw.length, other.at) + first.raw + text.slice(other.at + other.raw.length);
  }
  return text.slice(0, first.at) + band.raw + text.slice(first.at + first.raw.length);
}

// One drop into `band`. Rewrites only the first Name:: child (a second child and later values are kept), or
// creates Name:: under `row.writeUid ?? row.uid` when the card has none. The none band clears a single value; a card
// with two values cannot become none without losing one, so it plans nothing.
export function planLaneDrop({ name, row, band } = {}) {
  if (!row?.uid || !band || !laneAttrOk(name)) return null;
  const v = laneValueOf(row, name);
  if (band.none) {
    if (!v.key || v.two || !v.attr?.uid) return null;
    return { op: "string", uid: v.attr.uid, string: `${name.trim()}::` };
  }
  if (v.key === band.key) return null;
  if (v.tokens.length > 1 && v.attr?.uid) {
    const value = rewriteTokens(v.attr.value, v.tokens, band).trim();
    return { op: "string", uid: v.attr.uid, string: `${name.trim()}:: ${value}` };
  }
  const plan = planAttrCell({ name, value: band.raw, blockUid: v.attr?.uid || null, parentUid: row.writeUid ?? row.uid });
  if (!plan) return null;
  if (plan.op === "update") return { op: "string", uid: plan.uid, string: plan.string };
  return plan;
}

// Bind layout: each card centered in its band, stacked across the lane. The lane grows so every band fits its
// widest card (horizontal) or tallest card (vertical) and the longest stack. Positions are relative to the lane.
export function arrangeLane({ w, h, axis, bands, cards, pad = LANE_PAD, gap = LANE_GAP } = {}) {
  const n = Math.max(1, bands?.length || 1);
  const vertical = axisOf(axis) === "vertical";
  const along = (c) => (vertical ? c.h : c.w);
  const across = (c) => (vertical ? c.w : c.h);
  const list = cards || [];
  const bandSize = Math.max((vertical ? h : w) / n, ...list.map((c) => along(c) + pad * 2));
  const stacks = Array.from({ length: n }, () => pad);
  const out = [];
  for (const c of list) {
    const i = Math.min(n - 1, Math.max(0, c.band ?? n - 1));
    const a = bandSize * i + (bandSize - along(c)) / 2;
    const b = stacks[i];
    stacks[i] += across(c) + gap;
    out.push(vertical ? { uid: c.uid, x: b, y: a } : { uid: c.uid, x: a, y: b });
  }
  const cross = Math.max(vertical ? w : h, ...stacks.map((s) => s - gap + pad));
  const size = vertical ? { w: cross, h: bandSize * n } : { w: bandSize * n, h: cross };
  return { ...size, cards: out };
}
