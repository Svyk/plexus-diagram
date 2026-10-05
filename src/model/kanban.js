// Kanban columns for one board. Grouping is the TODO/DONE marker, Highlight
// colour, or one Name:: attribute. A drop plans a single write. No Roam calls.
// BT_attr* stays with Better Tasks: a Done drop asks Better Tasks to complete the task when it is loaded.

import { HIGHLIGHT_COLORS, rewriteHighlightTag } from "./highlight.js";
import { columnNameOk, planAttrCell, tableRows } from "./table.js";

export const TODO_FIELD = "To do";
export const DONE_COLUMN = "Done";
export const HIGHLIGHT_FIELD = "Highlight colour";
const MARK = /\{\{\[\[(TODO|DONE)\]\]\}\}/;

export function todoState(string) {
  const hit = MARK.exec(String(string || ""));
  if (!hit) return "";
  return hit[1] === "DONE" ? DONE_COLUMN : TODO_FIELD;
}

export function kanbanRows(board, resolve) {
  const items = board?.items;
  return tableRows(board, resolve).map((row) => {
    const item = items?.get?.(row.uid);
    const next = { ...row, string: item?.string ?? row.title ?? "" };
    if (item?.kind !== "highlight") return next;
    const targetUid = item.target?.uid;
    let targetString;
    if (typeof resolve === "function") {
      try { targetString = resolve(targetUid); } catch { targetString = undefined; }
    }
    next.highlightColor = item.highlight?.color;
    next.targetUid = targetUid;
    next.targetString = targetString;
    return next;
  });
}

export function kanbanFields(rows) {
  const names = [];
  let highlight = false;
  for (const row of rows || []) {
    if (typeof row?.highlightColor === "string" && row.highlightColor !== "") highlight = true;
    for (const attr of row.attrs || []) {
      if (attr?.name && columnNameOk(attr.name) && !names.includes(attr.name)) names.push(attr.name);
    }
  }
  return highlight ? [TODO_FIELD, HIGHLIGHT_FIELD, ...names] : [TODO_FIELD, ...names];
}

function columnOf(row, field) {
  if (field === TODO_FIELD) return todoState(row?.string);
  if (field === HIGHLIGHT_FIELD) {
    const color = row?.highlightColor;
    return typeof color === "string" && color !== "" ? color : "";
  }
  const hit = (row?.attrs || []).find((attr) => attr.name === field);
  return hit ? String(hit.value ?? "") : "";
}

// To do and Done are always present for the marker field, so a card can move
// into an empty Done column. Attribute columns are the values on the cards.
export function kanbanColumns(rows, field) {
  const list = rows || [];
  if (field === TODO_FIELD) {
    const columns = [
      { name: TODO_FIELD, cards: [] },
      { name: DONE_COLUMN, cards: [] },
    ];
    const extra = [];
    for (const row of list) {
      const name = columnOf(row, field);
      if (name === TODO_FIELD) columns[0].cards.push(row);
      else if (name === DONE_COLUMN) columns[1].cards.push(row);
      else extra.push(row);
    }
    if (extra.length) columns.push({ name: "", cards: extra });
    return columns;
  }
  if (!columnNameOk(field)) return [];
  const columns = [];
  const byName = new Map();
  for (const row of list) {
    const name = columnOf(row, field);
    if (!byName.has(name)) {
      const column = { name, cards: [] };
      byName.set(name, column);
      columns.push(column);
    }
    byName.get(name).cards.push(row);
  }
  return columns;
}

function withMarker(string, column) {
  const mark = column === DONE_COLUMN ? "{{[[DONE]]}}" : "{{[[TODO]]}}";
  const current = String(string || "");
  if (MARK.test(current)) return current.replace(MARK, mark);
  return current.trim() ? `${mark} ${current}` : mark;
}

// One drop. The marker field rewrites the card string. An attribute field
// rewrites that Name:: child, or creates it when the card has none.
export function planKanbanMove({ field, column, row } = {}) {
  if (!row?.uid || column == null || column === "") return null;
  if (field === TODO_FIELD) {
    if (column !== TODO_FIELD && column !== DONE_COLUMN) return null;
    if (todoState(row.string) === column) return null;
    const string = withMarker(row.string, column);
    if (string === String(row.string || "")) return null;
    // `status` lets a host with Better Tasks complete the task through it (Completed date, next occurrence).
    return { op: "string", uid: row.uid, string, status: column === DONE_COLUMN ? "DONE" : "TODO" };
  }
  if (field === HIGHLIGHT_FIELD) {
    if (row.kind === "note") return null;
    const targetUid = row.targetUid;
    const targetString = row.targetString;
    if (!targetUid || typeof targetString !== "string" || targetString === "") return null;
    if (row.highlightColor === column) return null;
    // Lanes outside the seven colours would rewrite nothing: an empty undo step.
    if (!HIGHLIGHT_COLORS.includes(column)) return null;
    return { op: "string", uid: targetUid, string: rewriteHighlightTag(targetString, column) };
  }
  if (!columnNameOk(field)) return null;
  const attr = (row.attrs || []).find((item) => item.name === field);
  if (String(attr?.value ?? "") === column) return null;
  const plan = planAttrCell({
    name: field,
    value: column,
    blockUid: attr?.uid || null,
    parentUid: row.uid,
  });
  if (!plan) return null;
  if (plan.op === "update") return { op: "string", uid: plan.uid, string: plan.string };
  return plan;
}
