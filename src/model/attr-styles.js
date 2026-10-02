// Attribute-edge styles and the legend filter. Both are derived from the links
// the session already computed. Nothing here writes a block or an edge.
import { PALETTE } from "./schema.js";

export const ATTR_DASHES = ["solid", "dashed", "dotted"];

export function parseAttrStyles(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try { obj = JSON.parse(text); } catch { return {}; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [name, spec] of Object.entries(obj)) {
    const key = String(name).trim();
    if (!key || !spec || typeof spec !== "object" || Array.isArray(spec)) continue;
    const row = {};
    if (PALETTE.includes(spec.color)) row.color = spec.color;
    if (ATTR_DASHES.includes(spec.dash)) row.dash = spec.dash;
    if (row.color || row.dash) out[key] = row;
  }
  return out;
}

function attrName(link) {
  return link?.kind === "attr" ? link.labels?.[0] || "" : "";
}

export function styleAttrLinks(links, styles, hidden) {
  const hide = hidden instanceof Set ? hidden : new Set(hidden || []);
  const map = styles && typeof styles === "object" && !Array.isArray(styles) ? styles : {};
  const out = [];
  for (const link of links || []) {
    const name = attrName(link);
    if (name && hide.has(name)) continue;
    const spec = name ? map[name] : null;
    if (!spec) { out.push(link); continue; }
    const next = { ...link };
    if (spec.color) next.color = spec.color;
    if (spec.dash) next.dash = spec.dash;
    out.push(next);
  }
  return out;
}

export function attrLegend(links, hidden, styles) {
  const hide = hidden instanceof Set ? hidden : new Set(hidden || []);
  const map = styles && typeof styles === "object" && !Array.isArray(styles) ? styles : {};
  const seen = new Set();
  const rows = [];
  for (const link of links || []) {
    const name = attrName(link);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const spec = map[name];
    rows.push({
      name,
      color: spec?.color || link.color || "gray",
      dash: spec?.dash || "dashed",
      on: !hide.has(name),
    });
  }
  return rows;
}
