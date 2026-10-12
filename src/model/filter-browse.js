// Search filters with an empty search box: the panel's Roam filters (days, created/edited by, under page, linked refs,
// children, PDF filters, board filters) browse the graph directly. Pure. This module turns the filters into ONE bounded
// datalog query and orders what it returns; the host (filterBrowse in host/roam.js) runs it, pulls the rows in chunks and
// keeps at most BROWSE_ROWS for the meta and sort path.
//
// Roam datalog has no :limit. The result set is bounded by a time window, a page (Under page) or a block kind (a string
// pattern). A filter set with none of those would scan the whole graph, so it gets a 30-day edited window and says so.

import { normalizeLibraryFilter } from "./library.js";
import { metaFilterActive, normalizeMetaFilter, normalizeSort } from "./search-sort.js";

export const BROWSE_DEFAULT_DAYS = 30;
export const BROWSE_ROWS = 200;
export const BROWSE_SCAN = 2000;
export const BROWSE_CHUNK = 200;
export const FILTER_BROWSE_TTL_MS = 30000;
export const FILTER_BROWSE_MAX = 20;
export const FILTER_DEBOUNCE_MS = 200;
export const DEFAULT_WINDOW_NOTE = `Showing the last ${BROWSE_DEFAULT_DAYS} days — set days to widen`;
const DAY_MS = 86400000;
// Block kinds a string pattern can find. Order is the alternation order in the query.
export const BROWSE_KINDS = Object.freeze(["pdf", "image", "web", "region", "pin", "board"]);

// Empty search box, no tag, and a filter that needs the graph: a days value, a Roam filter, a PDF or board filter.
export function wantsFilterBrowse(filter) {
  const f = normalizeLibraryFilter(filter);
  if (f.text || f.tag) return false;
  return f.days > 0 || f.orphan || metaFilterActive(filter);
}

// The filters as a query plan, or null when no card type the browse can list is selected (parts only).
// shape: "pages" (titles only), "blocks" (any block), "kinds" (blocks matching a kind pattern), "any" (pages and blocks).
export function browseSpec(filter, { now = Date.now() } = {}) {
  const f = normalizeLibraryFilter(filter);
  const m = normalizeMetaFilter(filter);
  const pdf = m.parsed || m.highlights;
  const all = f.types.length === 0;
  const has = (t) => all || f.types.includes(t);
  const pages = !pdf && (has("page") || has("daily"));
  const plain = !pdf && has("block");
  const kinds = pdf ? (has("pdf") ? ["pdf"] : []) : BROWSE_KINDS.filter(has);
  if (!pages && !plain && !kinds.length) return null;
  const shape = pages && (plain || kinds.length) ? "any" : pages ? "pages" : plain ? "blocks" : "kinds";
  const bounded = f.days > 0 || Boolean(m.under) || shape === "kinds";
  const days = f.days > 0 ? f.days : bounded ? 0 : BROWSE_DEFAULT_DAYS;
  return {
    shape,
    kinds: shape === "kinds" ? kinds : [],
    types: f.types,
    mode: f.days > 0 ? m.dayMode : "edited",
    days,
    since: days ? now - days * DAY_MS : null,
    defaulted: !bounded,
    under: m.under,
    createdBy: m.createdBy,
    editedBy: m.editedBy,
    refs: m.refs,
    children: m.children,
    parsed: m.parsed,
    highlights: m.highlights,
    pdf,
    orphan: f.orphan,
    thisBoard: m.thisBoard,
  };
}

// The cache key: the plan without the clock (days, not the since time).
export function browseKey(spec, sort, limit, extra = "") {
  if (!spec) return "";
  const { since: _since, ...rest } = spec;
  return JSON.stringify([rest, normalizeSort(sort), limit, extra]);
}

// The time a browse orders by: the sort's own time, else the days box's time.
export function browseTime(spec, sort) {
  const id = normalizeSort(sort);
  if (id === "created" || id === "oldest") return "created";
  if (id === "edited") return "edited";
  return spec?.mode === "created" ? "created" : "edited";
}

// One datalog query for the plan. `patterns` maps a kind to its string regex; `users` maps "created"/"edited" to the user
// entity ids for the chosen name (null when no such user: nothing can match). Most selective clause first: the page
// (Under page), the kind pattern, the time window; then the type, the users, the ordering time, and the existence of
// linked refs / children. Finds [?b ?t]. No aggregates and no get-else: both cost more than the rest of the query
// (in-query ref counts tripled a 30-day read); the host counts by entity id afterwards when the sort needs numbers.
export function browseQuery(spec, { patterns = {}, users = {}, sort = "best" } = {}) {
  if (!spec) return null;
  const inputs = ["$"];
  const where = [];
  const args = [];
  if (spec.under) {
    inputs.push("?under");
    args.push(spec.under);
    where.push("[?pg :node/title ?under]", "[?b :block/page ?pg]");
  }
  if (spec.shape === "kinds") {
    const alt = spec.kinds.map((k) => patterns[k]).filter(Boolean).map((p) => `(?:${p})`).join("|");
    if (!alt) return null;
    inputs.push("?kpat");
    args.push(alt);
    where.push("[?b :block/string ?s]", "[(re-pattern ?kpat) ?kre]", "[(re-find ?kre ?s)]");
  }
  const attr = (t) => (t === "created" ? ":create/time" : ":edit/time");
  const time = browseTime(spec, sort);
  const windowed = spec.since != null;
  if (windowed) {
    const v = spec.mode === time ? "?t" : "?w";
    inputs.push("?since");
    args.push(spec.since);
    where.push(`[?b ${attr(spec.mode)} ${v}]`, `[(> ${v} ?since)]`);
  }
  if (spec.shape === "pages") where.push("[?b :node/title _]");
  else if (spec.shape === "blocks") where.push("[?b :block/page _]");
  for (const [key, a, v] of [["createdBy", ":create/user", "?cu"], ["editedBy", ":edit/user", "?eu"]]) {
    if (!spec[key]) continue;
    const ids = users[key === "createdBy" ? "created" : "edited"];
    if (!Array.isArray(ids) || !ids.length) return null;
    inputs.push(`[${v} ...]`);
    args.push(ids);
    where.push(`[?b ${a} ${v}]`);
  }
  if (!windowed || spec.mode !== time) where.push(`[?b ${attr(time)} ?t]`);
  if (spec.refs) where.push("[?r :block/refs ?b]");
  if (spec.children) where.push("[?b :block/children ?k]");
  return { query: `[:find ?b ?t :in ${inputs.join(" ")} :where ${where.join(" ")}]`, args, time };
}

// The count the sort orders by, when the query's filter already limits rows to ones that have it: "refs" / "children".
export function browseCountBy(spec, sort) {
  const id = normalizeSort(sort);
  if (id === "linked" && spec?.refs) return "refs";
  if (id === "children" && spec?.children) return "children";
  return null;
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Query rows [eid, time] → [{ eid, time, count }] in the order the sort wants. `counts` (eid → n) orders Most linked /
// Most children (ties by time); Oldest is ascending; everything else is newest first.
export function orderBrowse(rows, sort, counts = null) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && r[0] != null)
    .map((r) => ({ eid: r[0], time: n(r[1]) || null, count: counts ? n(counts.get(r[0])) : null }));
  const oldest = normalizeSort(sort) === "oldest";
  const byTime = (a, b) => (oldest ? (a.time || Infinity) - (b.time || Infinity) : (b.time || 0) - (a.time || 0));
  return list.sort(counts ? (a, b) => b.count - a.count || byTime(a, b) : byTime);
}

// Sorts whose order the query already gave; the rest need every kept row's meta before sorting.
export function browseOrdered(spec, sort) {
  const id = normalizeSort(sort);
  if (id === "linked" || id === "children") return Boolean(browseCountBy(spec, sort));
  return id === "best" || id === "edited" || id === "created" || id === "oldest";
}

// The line when nothing came back.
export function browseEmptyText(spec) {
  if (spec?.parsed && spec?.highlights) return "No parsed PDFs with highlights";
  if (spec?.parsed) return "No parsed PDFs";
  if (spec?.highlights) return "No PDFs with highlights";
  return spec?.defaulted ? `Nothing edited in the last ${BROWSE_DEFAULT_DAYS} days — set days to widen` : "No matches";
}
