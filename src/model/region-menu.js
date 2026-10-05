// REG-8. Caption edits keep the macro text. The menu is data for menu-model.

import { regionsOf } from "./regions.js";

const MACRO_RE = /^(\s*\{\{\[\[plexus-region\]\]:\s*[^}]*\}\})(?: [\s\S]*)?$/;

export function imageRegionRows(content) {
  return regionsOf({ ":block/children": content || [] })
    .filter((row) => row.owner === "plexus-diagram" && row.kind === "img" && row.supported === true && row.uid)
    .map((row) => ({ uid: row.uid, caption: row.caption || "", f: row.f }));
}

export function renameRegionCaption(blockString, caption) {
  if (typeof blockString !== "string") return null;
  const match = MACRO_RE.exec(blockString);
  if (!match) return null;
  const next = String(caption ?? "").replace(/\s+/g, " ").trim();
  return next ? `${match[1]} ${next}` : match[1];
}

export function regionBadge(count) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) return "";
  return `\u25EC ${n}`;
}

// fast.q returns [[n]]. A scalar find returns n or [n]. A missing row stays null.
export function regionRefCount(raw) {
  if (raw == null || raw === "") return null;
  const value = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0][0] : raw[0]) : raw;
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function regionDeleteCopy(count) {
  if (count == null || count === "") return null;
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === 0) return "";
  const noun = n === 1 ? "block" : "blocks";
  return `Referenced in ${n} ${noun}. Delete anyway?`;
}

export function regionMenu(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row.uid === "string" && row.uid);
  if (!list.length) return null;
  return {
    id: "regions",
    label: "Regions",
    children: list.map((row) => ({
      id: `region:${row.uid}`,
      label: row.caption || "Region",
      children: [
        { id: `region-go:${row.uid}`, label: "Go" },
        { id: `region-copy:${row.uid}`, label: "Copy ref" },
        { id: `region-rename:${row.uid}`, label: "Rename" },
        { id: `region-delete:${row.uid}`, label: "Delete", danger: true },
      ],
    })),
  };
}
