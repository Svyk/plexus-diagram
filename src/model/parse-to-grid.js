// A pxd-parse table → the object Roam Grid's createTableFromModel takes.
// Covered cells are "" in `rows`. flatRows repeats the anchor text instead.

import { tableGrid } from "./parse-schema.js";
import { flattenLine, linkSafeText } from "./parse-to-roam-md.js";

// Strip %, ±, thousands separators, (negatives), and a trailing [a] / [1] mark.
export function isNumericCell(value) {
  let s = String(value ?? "").trim();
  if (!s) return false;
  s = s.replace(/\s*\[[A-Za-z0-9]+\]\s*$/g, "");
  s = s.replace(/[%±]/g, "");
  s = s.replace(/(\d),(?=\d)/g, "$1");
  s = s.trim();
  const wrapped = /^\(([^)]+)\)$/.exec(s);
  if (wrapped) s = `-${wrapped[1].trim()}`;
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) return false;
  return Number.isFinite(Number(s));
}

// Roam Grid's createTableFromModel escapes cells itself, so cells stay plain text.
export function gridCellText(text, { linkSafe = true } = {}) {
  const line = flattenLine(text);
  return linkSafe ? linkSafeText(line) : line;
}

function cellText(slot, repeatAnchor) {
  if (!slot || slot.cell == null) return "";
  if (slot.covered && !repeatAnchor) return "";
  return gridCellText(slot.text ?? "");
}

export function toGridSpec(table) {
  const grid = tableGrid(table);
  const rows = grid.map((row) => row.map((slot) => cellText(slot, false)));
  const merges = [];
  for (const cell of table?.cells || []) {
    const rowSpan = cell.rowSpan ?? 1;
    const colSpan = cell.colSpan ?? 1;
    if (rowSpan > 1 || colSpan > 1) {
      merges.push({ row: cell.r, col: cell.c, rowSpan, colSpan });
    }
  }
  const headerCount = Number.isInteger(table?.headerRows) && table.headerRows > 0 ? table.headerRows : 0;
  const headerRows = Array.from({ length: headerCount }, (_, i) => i);
  const cols = grid[0]?.length || 0;
  const alignments = [];
  for (let c = 0; c < cols; c += 1) {
    const values = [];
    for (let r = headerCount; r < grid.length; r += 1) {
      const slot = grid[r][c];
      if (!slot || slot.covered || slot.cell == null) continue;
      const text = String(slot.text ?? "").trim();
      if (!text) continue;
      values.push(text);
    }
    if (!values.length) continue;
    const numeric = values.filter(isNumericCell).length / values.length;
    if (numeric >= 0.8) alignments.push({ col: c, align: "right" });
  }
  return { rows, merges, headerRows, alignments, widths: null, enhance: true };
}

// Anchor text copied into every covered cell. For "Insert as flat table".
export function flatRows(table) {
  return tableGrid(table).map((row) => row.map((slot) => cellText(slot, true)));
}

const PX_PER_PT = 96 / 72;

// toGridSpec reshaped for Roam Grid's createTableFromModel: headerRows is a count,
// alignments are per column, widths are pixels keyed by column index (from the ruled grid).
export function toGridModelSpec(table) {
  const base = toGridSpec(table);
  const cols = base.rows[0]?.length || 0;
  const columnAlignments = Array.from({ length: cols }, () => "");
  for (const a of base.alignments) if (a.col < cols) columnAlignments[a.col] = a.align;
  let widths = null;
  const xs = table?.grid?.xs;
  if (Array.isArray(xs) && xs.length === cols + 1) {
    widths = {};
    for (let c = 0; c < cols; c += 1) {
      const pt = Number(xs[c + 1]) - Number(xs[c]);
      if (Number.isFinite(pt) && pt > 0) widths[c] = Math.round(pt * PX_PER_PT);
    }
    if (!Object.keys(widths).length) widths = null;
  }
  return {
    rows: base.rows,
    merges: base.merges,
    headerRows: base.headerRows.length,
    columnAlignments: columnAlignments.some(Boolean) ? columnAlignments : null,
    widths,
    enhance: true,
  };
}
