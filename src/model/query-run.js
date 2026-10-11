// Query cards, part two. Plexus runs the simple Roam query forms itself and paints a list.
// Anything it cannot translate returns { ok: false } and the card keeps Roam's own render.
// No Roam calls here: the backend (src/host/query-backend.js) is injected, so every rule is testable.

import { dailyPageTitle, firstLine } from "./schema.js";
import { pageTitleToDate } from "./resurface.js";

export const QUERY_RESULT_CAP = 200;
export const QUERY_SHOW = 30;
export const QUERY_BETWEEN_DAYS = 31;
export const QUERY_BUDGET_MS = 4000;
const DAY = 86400000;
const ROW_TEXT = 160;

const WRAP = /^\{\{\s*(?:\[\[query\]\]|query)\s*(?::([\s\S]*))?\}\}$/;
const RELATIVE = new Set(["today", "yesterday", "tomorrow", "last week", "next week", "last month", "next month"]);
const BLOCK_UID = /^[A-Za-z0-9_-]{9}$/;

const unsupported = (reason) => ({ ok: false, reason });

function skipSpace(s, i) {
  let k = i;
  while (k < s.length && /\s/.test(s[k])) k += 1;
  return k;
}

// `[[A [[B]]]]` nests; return the index after the closing brackets, or -1.
function pageEnd(s, i) {
  let depth = 0;
  let k = i;
  while (k < s.length - 1) {
    if (s[k] === "[" && s[k + 1] === "[") { depth += 1; k += 2; continue; }
    if (s[k] === "]" && s[k + 1] === "]") {
      depth -= 1;
      k += 2;
      if (depth === 0) return k;
      continue;
    }
    k += 1;
  }
  return -1;
}

function parseNode(s, i, now) {
  const at = skipSpace(s, i);
  if (at >= s.length) return unsupported("empty");
  if (s.startsWith("[[", at) || s.startsWith("#[[", at)) {
    const open = s[at] === "#" ? at + 1 : at;
    const end = pageEnd(s, open);
    if (end < 0) return unsupported("unclosed page");
    const title = s.slice(open + 2, end - 2).trim();
    if (!title) return unsupported("empty page");
    return { ok: true, node: pageNode(title, now), next: end };
  }
  if (s[at] === "#") {
    const m = /^#([^\s#{}[\]()]+)/.exec(s.slice(at));
    if (!m) return unsupported("tag");
    return { ok: true, node: pageNode(m[1], now), next: at + m[0].length };
  }
  if (s.startsWith("((", at)) {
    const m = /^\(\(([A-Za-z0-9_-]{9})\)\)/.exec(s.slice(at));
    if (!m) return unsupported("block ref");
    return { ok: true, node: { op: "block", uid: m[1] }, next: at + m[0].length };
  }
  if (s[at] === "{") return parseCurly(s, at, now);
  return unsupported("bare word");
}

// Relative page names Roam resolves for a date range. Anything else is not translated.
function pageNode(title, now) {
  return { op: "page", title, date: dateOfName(title, now) };
}

function dateOfName(name, now) {
  const key = String(name).trim().toLowerCase();
  const base = now instanceof Date ? now : new Date(now ?? Date.now());
  const day = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0, 0);
  if (key === "today") return day.getTime();
  if (key === "yesterday") return new Date(day.getTime() - DAY).getTime();
  if (key === "tomorrow") return new Date(day.getTime() + DAY).getTime();
  return pageTitleToDate(name);
}

function parseCurly(s, at, now) {
  const m = /^\{\s*([a-z-]+)\s*:/.exec(s.slice(at));
  if (!m) return unsupported("curly");
  const name = m[1];
  let k = at + m[0].length;
  const args = [];
  for (;;) {
    k = skipSpace(s, k);
    if (k >= s.length) return unsupported("unclosed clause");
    if (s[k] === "}") { k += 1; break; }
    const got = parseNode(s, k, now);
    if (!got.ok) return got;
    args.push(got.node);
    k = got.next;
  }
  if (name === "and" || name === "or") {
    if (!args.length) return unsupported(`empty ${name}`);
    return { ok: true, node: { op: name, args }, next: k };
  }
  if (name === "not") {
    if (args.length !== 1) return unsupported("not takes one clause");
    return { ok: true, node: { op: "not", arg: args[0] }, next: k };
  }
  if (name === "between") {
    if (args.length !== 2 || args.some((a) => a.op !== "page" || a.date == null)) return unsupported("between dates");
    const [a, b] = args.map((n) => n.date).sort((x, y) => x - y);
    const days = Math.round((b - a) / DAY) + 1;
    if (days > QUERY_BETWEEN_DAYS) return unsupported("between range too long");
    const titles = [];
    for (let t = a; t <= b + DAY / 2; t += DAY) titles.push(dailyPageTitle(new Date(t)));
    const pages = titles.map((title) => ({ op: "page", title, date: null }));
    return { ok: true, node: pages.length === 1 ? pages[0] : { op: "or", args: pages }, next: k };
  }
  return unsupported(`clause ${name}`);
}

// A date word as a page name is only a date inside {between:}; elsewhere it stays a plain page ref.
function settle(node) {
  if (node.op === "page") return { op: "page", title: node.title };
  if (node.op === "block") return node;
  if (node.op === "not") return { op: "not", arg: settle(node.arg) };
  return { op: node.op, args: node.args.map(settle) };
}

// Every `and` needs a positive clause, and `not` only means something inside an `and`.
function shapeOk(node, inAnd = false) {
  if (node.op === "page" || node.op === "block") return true;
  if (node.op === "not") return inAnd && shapeOk(node.arg);
  if (node.op === "and") {
    if (!node.args.some((a) => a.op !== "not")) return false;
    return node.args.every((a) => shapeOk(a, true));
  }
  return node.args.every((a) => shapeOk(a, false));
}

export function parseQuery(string, { now = Date.now() } = {}) {
  const wrap = WRAP.exec(String(string ?? "").trim());
  if (!wrap) return unsupported("not a query");
  let body = String(wrap[1] ?? "").trim();
  let title = "";
  const quoted = /^"([^"]*)"\s*/.exec(body);
  if (quoted) { title = quoted[1]; body = body.slice(quoted[0].length); }
  if (!body) return unsupported("empty query");
  // `{{query: [[A]] [[B]]}}` with no combinator is an and.
  const nodes = [];
  let k = 0;
  while (skipSpace(body, k) < body.length) {
    const got = parseNode(body, k, now);
    if (!got.ok) return got;
    nodes.push(got.node);
    k = got.next;
  }
  const tree = nodes.length === 1 ? nodes[0] : { op: "and", args: nodes };
  const ast = settle(tree);
  if (!shapeOk(ast)) return unsupported("shape");
  if (queryLeaves(ast).some((l) => l.op === "page" && RELATIVE.has(l.title.toLowerCase()))) return unsupported("relative date");
  return { ok: true, ast: ast.op === "not" ? null : ast, title };
}

export function queryIsTranslatable(string, opts) {
  const parsed = parseQuery(string, opts);
  return parsed.ok && Boolean(parsed.ast);
}

export function leafKey(node) {
  return node.op === "page" ? `p:${node.title}` : `b:${node.uid}`;
}

function listLeaves(node, out = new Map()) {
  if (node.op === "page" || node.op === "block") out.set(leafKey(node), node);
  else if (node.op === "not") listLeaves(node.arg, out);
  else for (const a of node.args) listLeaves(a, out);
  return out;
}

export function queryLeaves(ast) {
  return [...listLeaves(ast).values()];
}

const defaultTick = () => new Promise((resolve) => setTimeout(resolve, 0));

// backend.hits(leaf) -> { uids: string[], partial: boolean }. A leaf is read once per run.
// Between leaves the runner yields and checks the time budget, so one run never holds the page past Roam's 5 s limit.
export async function runQuery(ast, backend, { tick = defaultTick, budgetMs = QUERY_BUDGET_MS, clock = Date.now, isCancelled = () => false } = {}) {
  if (!ast) return { status: "unsupported", uids: [], partial: false };
  const started = clock();
  const sets = new Map();
  let partial = false;
  for (const leaf of queryLeaves(ast)) {
    if (isCancelled()) return { status: "cancelled", uids: [], partial };
    if (clock() - started > budgetMs) return { status: "slow", uids: [], partial: true };
    let hit;
    try { hit = await backend.hits(leaf); } catch { return { status: "error", uids: [], partial: true }; }
    sets.set(leafKey(leaf), new Set(hit?.uids || []));
    if (hit?.partial) partial = true;
    await tick();
  }
  const evalNode = (node) => {
    if (node.op === "page" || node.op === "block") return sets.get(leafKey(node)) || new Set();
    if (node.op === "or") {
      const out = new Set();
      for (const a of node.args) for (const u of evalNode(a)) out.add(u);
      return out;
    }
    if (node.op === "and") {
      const pos = node.args.filter((a) => a.op !== "not").map(evalNode).sort((a, b) => a.size - b.size);
      let out = pos[0];
      for (const next of pos.slice(1)) out = new Set([...out].filter((u) => next.has(u)));
      for (const neg of node.args.filter((a) => a.op === "not")) {
        const drop = evalNode(neg.arg);
        out = new Set([...out].filter((u) => !drop.has(u)));
      }
      return out;
    }
    return new Set();
  };
  return { status: "ok", uids: [...evalNode(ast)], partial };
}

// Newest edit first, then capped. `times` is uid -> ms.
export function rankUids(uids, times, cap = QUERY_RESULT_CAP) {
  const t = (u) => Number(times?.get?.(u) ?? times?.[u] ?? 0);
  return [...new Set(uids)].sort((a, b) => t(b) - t(a) || (a < b ? -1 : 1)).slice(0, cap);
}

// One full run: leaves, ranking, details. Rows are capped at QUERY_RESULT_CAP; `total` is the match count before the cap.
// `opts.exclude` (uids) drops the query block itself and what sits under it before ranking and counting, so the count
// is the number of rows the list can show.
export async function loadQueryRows(ast, backend, opts = {}) {
  const run = await runQuery(ast, backend, opts);
  if (run.status !== "ok") return { status: run.status, rows: [], total: 0, partial: run.partial };
  const tick = opts.tick || defaultTick;
  const skip = new Set(opts.exclude || []);
  const uids = skip.size ? run.uids.filter((u) => !skip.has(u)) : run.uids;
  const times = backend.times(uids);
  await tick();
  const order = rankUids(uids, times, QUERY_RESULT_CAP);
  const details = backend.details(order);
  const rows = queryRows(details, order);
  const total = uids.length - (order.length - rows.length);
  return { status: "ok", rows, total, partial: run.partial || total > QUERY_RESULT_CAP };
}

// One painted row. A page result is a [[page]] card, a block result a ((uid)) card.
export function queryRow(detail) {
  const uid = String(detail?.uid ?? "");
  const title = String(detail?.title ?? "");
  const isPage = Boolean(title);
  const text = (isPage ? title : firstLine(detail?.string)).slice(0, ROW_TEXT) || (isPage ? title : "(empty block)");
  const crumbs = [];
  if (!isPage && detail?.page) crumbs.push(String(detail.page));
  if (!isPage && detail?.parent) crumbs.push(firstLine(detail.parent).slice(0, 60));
  return {
    uid,
    kind: isPage ? "page" : "block",
    text,
    crumb: crumbs.filter(Boolean).join(" › "),
    string: isPage ? `[[${title}]]` : `((${uid}))`,
    time: Number(detail?.time) || 0,
  };
}

export function queryRows(details, order) {
  const by = new Map((details || []).map((d) => [String(d?.uid), d]));
  const list = order || [...by.keys()];
  const rows = [];
  for (const uid of list) {
    const d = by.get(uid);
    if (d && BLOCK_UID.test(uid)) rows.push(queryRow(d));
  }
  return rows;
}

// What a row puts on the drag: the same string the panel rows use for application/x-plexus-card.
export function rowDragPayload(row) {
  return row?.string ? String(row.string) : "";
}

export function visibleRows(rows, shown = QUERY_SHOW) {
  const n = Math.max(0, Math.floor(Number(shown) || 0));
  return { rows: rows.slice(0, n), hidden: Math.max(0, rows.length - n) };
}

// Last result per query card, so a card paints at once on the next open. localStorage; a private tab skips it.
export function createQueryCache(storage, graph = "") {
  const key = (uid) => `plexus-diagram:qc:${graph}:${uid}`;
  return {
    get(uid) {
      try {
        const raw = storage?.getItem?.(key(uid));
        const v = raw ? JSON.parse(raw) : null;
        return v && Array.isArray(v.rows) ? v : null;
      } catch { return null; }
    },
    set(uid, rows, extra = {}) {
      try {
        storage?.setItem?.(key(uid), JSON.stringify({ rows: rows.slice(0, QUERY_SHOW), total: extra.total ?? rows.length, partial: Boolean(extra.partial), at: extra.at ?? Date.now() }));
      } catch { /* quota or private mode */ }
    },
  };
}
