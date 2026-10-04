// Table view of one board. Rows are cards and nested boards. Columns are
// Title, Section, Type, Edited, then each Name:: attribute found on those
// blocks. No Roam calls. A new column writes nothing until a cell is filled.

import { attrNameOf, itemLabel } from "./schema.js";

const FIXED = ["Title", "Section", "Type", "Edited"];

function cleanName(name) {
  if (name == null) return "";
  const attr = String(name).trim();
  if (!attr || attr.startsWith("BT_attr") || FIXED.includes(attr)) return "";
  return attr;
}

export function columnNameOk(name) {
  return Boolean(cleanName(name));
}

// A card on this board, including a nested board card. Sections and text are not rows.
// `kind: "card"` covers rows built without a layout type.
export function isTableRow(item) {
  if (!item) return false;
  if (item.type === "section" || item.type === "text") return false;
  if (item.type === "card") return true;
  return item.kind === "card" || item.kind === "board";
}

export function tableColumns(rows) {
  const names = [];
  for (const row of rows || []) {
    for (const attr of row.attrs || []) {
      if (attr?.name && !names.includes(attr.name)) names.push(attr.name);
    }
  }
  return FIXED.concat(names);
}

export function cellText(row, column) {
  if (!row) return "";
  if (column === "Title") return String(row.title ?? "");
  if (column === "Section") return String(row.section ?? "");
  if (column === "Type") return String(row.type ?? "");
  if (column === "Edited") return row.edited == null ? "" : String(row.edited);
  const hit = (row.attrs || []).find((attr) => attr.name === column);
  return hit ? String(hit.value ?? "") : "";
}

export function filterRows(rows, text) {
  const needle = String(text ?? "").trim().toLowerCase();
  if (!needle) return (rows || []).slice();
  const cols = tableColumns(rows);
  return (rows || []).filter((row) => cols.some((column) => cellText(row, column).toLowerCase().includes(needle)));
}

export function sortRows(rows, column, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  const list = (rows || []).slice();
  list.sort((a, b) => {
    if (column === "Edited") {
      const av = Number(a.edited) || 0;
      const bv = Number(b.edited) || 0;
      return (av - bv) * sign;
    }
    return cellText(a, column).localeCompare(cellText(b, column)) * sign;
  });
  return list;
}

// One attribute cell. Empty text on a missing block writes nothing, so adding
// a column does not create Name:: children until a cell is filled.
// BT_attr* belongs to Better Tasks.
export function planAttrCell({ name, value, blockUid = null, parentUid = null } = {}) {
  const attr = cleanName(name);
  if (!attr) return null;
  const text = String(value ?? "").trim();
  const string = text ? `${attr}:: ${text}` : `${attr}::`;
  if (blockUid) return { op: "update", uid: blockUid, string };
  if (!text || !parentUid) return null;
  return { op: "create", parent: parentUid, string };
}

// One row per card and nested board, in board order. Attribute children keep
// their block uid so a cell can mount renderBlock. BT_attr* and the fixed
// column names are not columns.
export function tableRows(board, resolve) {
  const items = board?.items;
  if (!items || typeof items.get !== "function") return [];
  const order = Array.isArray(board.order) ? board.order : [...items.keys()];
  const rows = [];
  for (const uid of order) {
    const item = items.get(uid);
    if (!isTableRow(item)) continue;
    const parent = items.get(item.parentUid);
    const section = parent?.type === "section" ? String(parent.title || "") : "";
    const attrs = [];
    for (const child of item.content || []) {
      const string = child?.[":block/string"] ?? child?.string ?? "";
      const name = cleanName(attrNameOf(String(string)));
      if (!name) continue;
      const text = String(string);
      const cut = text.indexOf("::");
      attrs.push({
        name,
        value: cut >= 0 ? text.slice(cut + 2).trim() : "",
        uid: child?.[":block/uid"] ?? child?.uid ?? null,
      });
    }
    rows.push({
      uid: item.uid,
      kind: item.kind,
      title: itemLabel(item, resolve),
      section,
      type: item.kind || "",
      edited: item.edited ?? null,
      attrs,
    });
  }
  return rows;
}
