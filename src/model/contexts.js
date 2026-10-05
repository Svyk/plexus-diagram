// All-contexts drawer rows. No Roam calls.

export const CONTEXT_CAP = 200;
export const CONTEXT_CHUNK = 25;
export const CONTEXT_FILTER_AT = 20;

const clip = (text, max) => {
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1).trimEnd()}…`;
};

export function breadcrumb(page, parent) {
  const a = clip(page, 42);
  const b = clip(parent, 42);
  if (!a) return b || "Untitled";
  if (!b || b === a) return a;
  return `${a} › ${b}`;
}

export function snippetOf(text, max = 200) {
  return clip(text, max);
}

export function filterRows(rows, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return rows || [];
  return (rows || []).filter((row) => `${row.crumb || ""} ${row.snippet || ""}`.toLowerCase().includes(q));
}

export function groupRefs(rows, cap = CONTEXT_CAP) {
  const sorted = [...(rows || [])]
    .filter((row) => row?.uid)
    .sort((a, b) => (b.time || 0) - (a.time || 0) || String(a.uid).localeCompare(String(b.uid)));
  const shown = sorted.slice(0, cap);
  const groups = [];
  for (const row of shown) {
    const year = Number.isFinite(row.time) ? new Date(row.time).getFullYear() : 0;
    let group = groups.find((item) => item.year === year);
    if (!group) {
      group = { year, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return { groups, total: sorted.length, hidden: Math.max(0, sorted.length - shown.length) };
}

export function rowChunks(rows, size = CONTEXT_CHUNK) {
  const list = rows || [];
  const out = [];
  const step = Math.max(1, size);
  for (let i = 0; i < list.length; i += step) out.push(list.slice(i, i + step));
  return out;
}
