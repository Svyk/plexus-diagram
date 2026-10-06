// Task Status Tags palette. Read-only: colours and glyphs match that extension's defaults,
// and a live API (apiVersion 1) replaces the table. Plexus never writes a status tag itself.

import { taskMeta } from "./tasks.js";

const STATUS_TAG = /#\[\[task-status\/([^\]]+)\]\]/;

// Pill colours from Roam-Task-Status-Tags buildStatusPillColors on the default base hexes
// (light surface 245,248,250, dark 32,43,51, text contrast 4.8).
const NEUTRAL = Object.freeze({
  light: Object.freeze({ base: "rgba(100, 116, 139, 0.1)", text: "rgb(88, 102, 122)" }),
  dark: Object.freeze({ base: "rgba(100, 116, 139, 0.2)", text: "rgb(158, 168, 183)" }),
});

const FALLBACK = Object.freeze([
  row("ACTIVE", "Active", "active", "rgba(20, 184, 166, 0.1)", "rgb(13, 116, 104)", "rgba(20, 184, 166, 0.2)", "rgb(68, 198, 184)"),
  row("WAITING", "Waiting", "waiting", "rgba(234, 179, 8, 0.1)", "rgb(131, 100, 4)", "rgba(234, 179, 8, 0.2)", "rgb(234, 179, 8)"),
  row("IN_REVIEW", "In Review", "in-review", "rgba(14, 165, 233, 0.1)", "rgb(9, 109, 154)", "rgba(14, 165, 233, 0.2)", "rgb(76, 188, 239)"),
  row("HOLDING", "Holding", "holding", "rgba(148, 163, 184, 0.1)", "rgb(95, 104, 118)", "rgba(148, 163, 184, 0.2)", "rgb(169, 181, 198)"),
  row("INCUBATING", "Incubating", "incubating", "rgba(99, 102, 241, 0.1)", "rgb(84, 86, 203)", "rgba(99, 102, 241, 0.2)", "rgb(158, 160, 246)"),
  row("ALERT", "Alert", "alert", "rgba(244, 63, 94, 0.1)", "rgb(184, 48, 71)", "rgba(244, 63, 94, 0.2)", "rgb(248, 130, 150)"),
  row("CANCELLED", "Cancelled", "cancelled", "rgba(30, 41, 59, 0.1)", "rgb(30, 41, 59)", "rgba(30, 41, 59, 0.2)", "rgb(145, 150, 159)"),
]);

function row(key, name, glyph, lightBase, lightText, darkBase, darkText) {
  return Object.freeze({
    key,
    name,
    tag: `task-status/${name}`,
    glyph,
    light: Object.freeze({ base: lightBase, text: lightText }),
    dark: Object.freeze({ base: darkBase, text: darkText }),
  });
}

function side(value) {
  if (!value || typeof value !== "object") return { base: "", text: "" };
  return { base: String(value.base || ""), text: String(value.text || "") };
}

// Lower-case slug. A rename ("Waiting" → "Blocked") is a different key.
export function statusKey(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function statusApi(win) {
  const api = win?.RoamTaskStatusTags;
  if (!api || api.apiVersion !== 1 || typeof api.statuses !== "function") return null;
  return api;
}

function normalize(raw) {
  const name = String(raw?.name || "").trim();
  if (!name) return null;
  const glyphRaw = String(raw?.glyph || "").trim();
  const glyph = !glyphRaw || glyphRaw === "custom" ? "diamond" : glyphRaw;
  const known = FALLBACK.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  return {
    key: raw?.key ? String(raw.key) : (known?.key || statusKey(name).toUpperCase().replace(/-/g, "_")),
    name,
    tag: raw?.tag ? String(raw.tag) : `task-status/${name}`,
    glyph: glyph === "diamond" && known ? known.glyph : glyph,
    light: raw?.light ? side(raw.light) : (known ? { ...known.light } : { ...NEUTRAL.light }),
    dark: raw?.dark ? side(raw.dark) : (known ? { ...known.dark } : { ...NEUTRAL.dark }),
  };
}

// Ordered Map keyed by lower-case name. No API, or an empty list, uses the seven defaults.
export function statusPalette(api) {
  let rows = null;
  if (api && typeof api.statuses === "function") {
    try {
      const got = api.statuses();
      if (Array.isArray(got) && got.length) rows = got;
    } catch { rows = null; }
  }
  const map = new Map();
  for (const raw of rows || FALLBACK) {
    const entry = rows ? normalize(raw) : raw;
    if (!entry?.name) continue;
    const id = entry.name.toLowerCase();
    if (map.has(id)) continue;
    map.set(id, entry);
  }
  return map;
}

export function paletteEntries(palette) {
  if (!palette) return [];
  if (typeof palette.values === "function" && !Array.isArray(palette)) return [...palette.values()];
  return [...palette];
}

function findEntry(palette, name) {
  const id = String(name ?? "").trim().toLowerCase();
  if (!id) return null;
  if (palette && typeof palette.get === "function") {
    const hit = palette.get(id);
    if (hit) return hit;
  }
  for (const entry of paletteEntries(palette)) {
    if (!entry?.name) continue;
    if (entry.name.toLowerCase() === id || String(entry.key || "").toLowerCase() === id) return entry;
  }
  return null;
}

// The board passes "dark" or "light" from its own theme token, never from the OS scheme.
export function paletteVars(entry, theme) {
  const dark = theme === "dark" || theme === "bp3-dark";
  const pair = (dark ? entry?.dark : entry?.light) || {};
  return {
    "--pxd-status-base": pair.base || "",
    "--pxd-status-text": pair.text || "",
  };
}

// Canonical palette name for a #[[task-status/…]] tag, or null when the tag is missing or unknown.
export function taskStatusOf(string, palette) {
  const text = String(string ?? "");
  let raw = "";
  const meta = taskMeta(text, []);
  if (meta?.status) raw = meta.status;
  else {
    const tag = STATUS_TAG.exec(text);
    if (tag) raw = tag[1].trim();
  }
  if (!raw) return null;
  const entry = findEntry(palette, raw);
  return entry ? entry.name : null;
}

// Unknown names keep a neutral diamond so a renamed or foreign tag still has a shape.
export function statusLook(name, palette) {
  const hit = findEntry(palette, name);
  if (hit) return hit;
  const label = String(name ?? "").trim();
  return {
    key: statusKey(label) || "unknown",
    name: label,
    tag: label ? `task-status/${label}` : "",
    glyph: "diamond",
    light: { base: NEUTRAL.light.base, text: NEUTRAL.light.text },
    dark: { base: NEUTRAL.dark.base, text: NEUTRAL.dark.text },
  };
}
