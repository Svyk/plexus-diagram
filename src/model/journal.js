// Daily-page journal rows. No Roam calls. Titles match Roam ("October 6th, 2026").
// The daily page uid Roam assigns is MM-DD-YYYY.

import { pageTitleToDate } from "./resurface.js";
import { dailyPageTitle } from "./schema.js";

export function startOfDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Local calendar step. A millisecond day would skip or repeat across a DST change.
export function stepDay(date, delta = 1) {
  const d = new Date(startOfDay(date));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + Number(delta || 0)).getTime();
}

export function dailyTitle(date) {
  return dailyPageTitle(startOfDay(date));
}

export function dailyUid(date) {
  const d = new Date(startOfDay(date));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

export function titleToTime(title) {
  return pageTitleToDate(title);
}

export function firstLine(string) {
  const text = String(string ?? "");
  const cut = text.search(/\r?\n/);
  return cut < 0 ? text : text.slice(0, cut);
}

function childList(tree) {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree;
  if (Array.isArray(tree[":block/children"])) return tree[":block/children"];
  if (Array.isArray(tree.children)) return tree.children;
  if (Array.isArray(tree.blocks)) return tree.blocks;
  return [];
}

function orderOf(node, index) {
  const raw = node?.[":block/order"] ?? node?.order;
  return Number.isFinite(Number(raw)) ? Number(raw) : index;
}

// Top-level blocks only. `string` is the block ref the board drop already understands.
export function journalRows(tree) {
  const kids = childList(tree)
    .map((node, index) => ({ node, index }))
    .sort((a, b) => orderOf(a.node, a.index) - orderOf(b.node, b.index) || a.index - b.index);
  const rows = [];
  for (const { node } of kids) {
    const uid = node?.[":block/uid"] ?? node?.uid;
    if (!uid) continue;
    const body = node?.[":block/string"] ?? node?.string ?? "";
    rows.push({
      uid: String(uid),
      string: `((${uid}))`,
      text: firstLine(body),
    });
  }
  return rows;
}
