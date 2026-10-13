// "Fold queries on this page": Roam renders every open {{query}} on a page (all its results) in the page's first
// render, before anything else paints; a query under a folded block is never mounted. Each query block Roam would
// render on the board's page becomes a folded caption block in its place with the query moved under it. Queries
// inside any {{[[diagram]]}} block are left alone: on a board they are Plexus's own query cards.

const QUERY_RE = /\{\{\s*(?:\[\[query\]\]|query)\s*:/i;
const DIAGRAM_RE = /\{\{(?:\[\[)?diagram(?:\]\])?/;
export const QUERY_CAPTION_MAX = 120;
export const QUERY_CAPTION_PREFIX = "Query · ";

export const hasQueryMacro = (s) => QUERY_RE.test(String(s ?? ""));
export const isDiagramString = (s) => DIAGRAM_RE.test(String(s ?? ""));

// The query macro's body without its wrapper; text around the macro stays.
function unwrapQuery(s) {
  const m = QUERY_RE.exec(s);
  if (!m) return s;
  const start = m.index;
  let i = start + m[0].length;
  let depth = 2; // the two opening braces of the macro
  for (; i < s.length && depth > 0; i += 1) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") depth -= 1;
  }
  const end = depth === 0 ? i : s.length;
  const body = s.slice(start + m[0].length, depth === 0 ? end - 2 : end);
  return `${s.slice(0, start)} ${body} ${s.slice(end)}`;
}

// Plain text that adds no reference, tag, attribute or macro to the graph.
export function plainQueryText(string) {
  let s = unwrapQuery(String(string ?? ""));
  for (let pass = 0; pass < 8; pass += 1) {
    const next = s
      .replace(/\[\[([^[\]]*)\]\]/g, "$1")
      .replace(/\(\(([^()]*)\)\)/g, "$1");
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/\[\[|\]\]|\(\(|\)\)/g, "")
    .replace(/#/g, "")
    .replace(/::/g, ":");
  while (/\{\{|\}\}/.test(s)) s = s.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
  return s.replace(/\s+/g, " ").trim();
}

export function queryCaption(string) {
  const text = plainQueryText(string);
  if (!text) return QUERY_CAPTION_PREFIX.trim().replace(/\s*·$/, "");
  const full = QUERY_CAPTION_PREFIX + text;
  if (full.length <= QUERY_CAPTION_MAX) return full;
  return `${full.slice(0, QUERY_CAPTION_MAX - 1).trimEnd()}…`;
}

// The dry-run plan. Walks the page outline the way Roam renders it: into open blocks only, never into a
// {{[[diagram]]}} block, never below a query (once the query is folded its children are hidden too).
// deps:
//   kidsOfMany(parentUids) -> Map(parentUid -> [{ uid, string, open, order }]) one outline level per call
//   newUid() -> a fresh block uid
//   limit -> stop after this many blocks (plan.truncated)
// Out: { graph, boardUid, pageUid, folds, visited, truncated }. folds[i] = { queryUid, captionUid, parentUid, order,
// caption, string }.
export function planQueryFolds({ pageUid = "", boardUid = "", graph = "", kidsOfMany, newUid, limit = 20000 } = {}) {
  const plan = { graph, boardUid, pageUid, folds: [], visited: 0, truncated: false };
  if (!pageUid || typeof kidsOfMany !== "function") return plan;
  let level = [pageUid];
  const seen = new Set(level);
  while (level.length && !plan.truncated) {
    let kids = null;
    try { kids = kidsOfMany(level); } catch { kids = null; }
    if (!(kids instanceof Map)) break;
    const next = [];
    for (const parentUid of level) {
      const list = (kids.get(parentUid) || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (let i = 0; i < list.length; i += 1) {
        const kid = list[i];
        if (!kid?.uid || seen.has(kid.uid)) continue;
        seen.add(kid.uid);
        plan.visited += 1;
        if (plan.visited > limit) { plan.truncated = true; break; }
        const string = String(kid.string ?? "");
        if (isDiagramString(string)) continue;
        if (hasQueryMacro(string)) {
          let captionUid = "";
          try { captionUid = String(newUid?.() || ""); } catch { captionUid = ""; }
          if (!captionUid) continue;
          plan.folds.push({ queryUid: kid.uid, captionUid, parentUid, order: i, caption: queryCaption(string), string });
          continue;
        }
        if (kid.open !== false) next.push(kid.uid);
      }
      if (plan.truncated) break;
    }
    level = next;
  }
  return plan;
}

// Lines for the dry-run dialog.
export function queryFoldLines(plan, max = 12) {
  const folds = plan?.folds || [];
  const lines = folds.slice(0, max).map((f) => f.caption);
  if (folds.length > max) lines.push(`and ${folds.length - max} more`);
  return lines;
}

// The nudge after an open: shown once per page per device, only when Roam held the board's first paint long enough.
export const QUERY_NUDGE_HELD_MS = 1500;
export const queryNudgeKey = (graph, pageUid) => `plexus-diagram:query-nudge:${graph || ""}:${pageUid || ""}`;
export function shouldNudgeQueries({ entry, seen = false } = {}) {
  if (seen || !entry || entry.kind === "sidebar") return false;
  const held = Number(entry.firstPaintMs) - Number(entry.paintTaskMs);
  return Number.isFinite(held) && held >= QUERY_NUDGE_HELD_MS;
}
