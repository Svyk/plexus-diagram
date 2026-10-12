// Add-panel sort and the filters that use what Roam records about every block and page: when it was created and last
// edited, by whom, how many blocks link to it, how many children it has. Pure. The host fetches the numbers for the rows
// it is about to show (rowMeta in host/roam.js, cached by uid); nothing here reads the graph.
//
// A row's `meta`: { created, edited, createdBy, editedBy, refs, children, length } (missing numbers are null).

export const SORTS = Object.freeze([
  { id: "best", label: "Best match" },
  { id: "edited", label: "Recently edited" },
  { id: "created", label: "Recently created" },
  { id: "oldest", label: "Oldest created" },
  { id: "linked", label: "Most linked" },
  { id: "children", label: "Most children" },
  { id: "longest", label: "Longest" },
  { id: "title", label: "Title A–Z" },
]);
export const DEFAULT_SORT = "best";
const SORT_IDS = new Set(SORTS.map((s) => s.id));

export const normalizeSort = (raw) => (SORT_IDS.has(raw) ? raw : DEFAULT_SORT);
export const sortLabel = (id) => SORTS.find((s) => s.id === normalizeSort(id))?.label || "Best match";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const titleOf = (row) => String(row?.title ?? row?.text ?? row?.string ?? "");
const lengthOf = (row) => num(row?.meta?.length) ?? String(row?.string ?? row?.text ?? row?.title ?? "").length;

// Higher-first by `pick`; rows without the number go last; ties keep the incoming order (stable).
const byNumber = (pick, dir) => (a, b) => {
  const x = pick(a);
  const y = pick(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return dir * (x - y);
};

const COMPARE = {
  edited: byNumber((r) => num(r.meta?.edited ?? r.edited), -1),
  created: byNumber((r) => num(r.meta?.created), -1),
  oldest: byNumber((r) => num(r.meta?.created), 1),
  linked: byNumber((r) => num(r.meta?.refs), -1),
  children: byNumber((r) => num(r.meta?.children), -1),
  longest: byNumber((r) => lengthOf(r), -1),
  title: (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: "base", numeric: true }),
};

// A new array; "best" keeps the order the search gave (relevance).
export function sortRows(rows, sort) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const cmp = COMPARE[normalizeSort(sort)];
  if (!cmp) return list;
  return list.map((row, i) => [row, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map((x) => x[0]);
}

// Does the sort need numbers beyond what the search query returned?
export const sortNeedsMeta = (sort) => normalizeSort(sort) !== DEFAULT_SORT && normalizeSort(sort) !== "title";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function ago(time, now) {
  const s = Math.max(0, Math.floor((now - time) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} ${d === 1 ? "day" : "days"} ago` : "";
}
function dateText(time, now) {
  const d = new Date(time);
  const nowY = new Date(now).getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === nowY ? "" : `, ${d.getFullYear()}`}`;
}
// "by Ann" only for a short name: API tokens and device names would crowd the line out.
const by = (name) => (name && String(name).length <= 20 ? ` by ${name}` : "");
const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// The muted line under a row: the value the sort is about ("edited 2 h ago", "12 refs", "created Oct 6"). "" when the
// row has nothing for it.
export function metaLine(row, sort, now = Date.now()) {
  const meta = row?.meta;
  if (!meta) return "";
  const id = normalizeSort(sort);
  if (id === "edited") {
    const t = num(meta.edited);
    return t ? `edited ${ago(t, now) || dateText(t, now)}${by(meta.editedBy)}` : "";
  }
  if (id === "created" || id === "oldest") {
    const t = num(meta.created);
    return t ? `created ${dateText(t, now)}${by(meta.createdBy)}` : "";
  }
  if (id === "linked") return num(meta.refs) != null ? plural(meta.refs, "ref", "refs") : "";
  if (id === "children") return num(meta.children) != null ? plural(meta.children, "child", "children") : "";
  if (id === "longest") return `${plural(lengthOf(row), "character", "characters")}`;
  return "";
}

// ------------------------------------------------------------------ Roam-powered filters

const DAY_MS = 86400000;

// { by: { created, edited } names, dayMode: "edited" | "created", refs, children, under, parsed, highlights, thisBoard }
export function normalizeMetaFilter(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const name = (v) => String(v ?? "").trim();
  return {
    createdBy: name(src.createdBy),
    editedBy: name(src.editedBy),
    dayMode: src.dayMode === "created" ? "created" : "edited",
    refs: src.refs === true,
    children: src.children === true,
    under: name(src.under),
    parsed: src.parsed === true,
    highlights: src.highlights === true,
    thisBoard: src.thisBoard === true,
  };
}

// Filters the host can answer from `meta` (everything but parsed / highlights / thisBoard, which the board answers).
// "Days box counts: Created" filters only when the days box holds a number.
export function metaFilterHostActive(raw) {
  const f = normalizeMetaFilter(raw);
  const days = Math.floor(Number(raw?.days) || 0) > 0;
  return Boolean(f.createdBy || f.editedBy || f.refs || f.children || f.under || (f.dayMode === "created" && days));
}
export function metaFilterActive(raw) {
  const f = normalizeMetaFilter(raw);
  return metaFilterHostActive(f) || f.parsed || f.highlights || f.thisBoard;
}

// Rows narrowed by their meta. `days` is the existing days box; with dayMode "created" it counts from creation, otherwise
// the row's last edit (the host's own days filter already ran for "edited").
export function narrowByMeta(rows, raw, { days = 0, now = Date.now() } = {}) {
  const f = normalizeMetaFilter(raw);
  const n = Math.max(0, Math.floor(Number(days) || 0));
  const lower = (s) => String(s ?? "").toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const m = row?.meta || {};
    if (f.dayMode === "created" && n) {
      const t = num(m.created);
      if (t == null || t <= now - n * DAY_MS) return false;
    }
    if (f.createdBy && lower(m.createdBy) !== lower(f.createdBy)) return false;
    if (f.editedBy && lower(m.editedBy) !== lower(f.editedBy)) return false;
    if (f.refs && !(num(m.refs) > 0)) return false;
    if (f.children && !(num(m.children) > 0)) return false;
    if (f.under) {
      const where = row?.kind === "page" ? row.title : row?.pageTitle;
      if (lower(where) !== lower(f.under)) return false;
    }
    return true;
  });
}

// ------------------------------------------------------------------ the numbers (host)

// The numbers for rowMeta(uids): one pull_many over the uid list (times, string, who, children) and one aggregate count of
// linked references bound by entity id. Datalog bound by [?u ...] uid costs ~45 ms a call in a large graph whatever the
// list; the pull and the eid-bound count cost a few ms. Users carry :user/display-name in some graphs; in others (the
// Readwisenotes graph) the name is the title of the user's display page.
const USER_PULL = "[:user/display-name {:user/display-page [:node/title]}]";
export const META_PULL = `[:db/id :block/uid :create/time :edit/time :block/string {:create/user ${USER_PULL}} {:edit/user ${USER_PULL}} {:block/children [:db/id]}]`;
export const META_REFS = "[:find ?b (count ?r) :in $ [?b ...] :where [?r :block/refs ?b]]";
export const USER_NAME_QUERIES = Object.freeze([
  "[:find ?n :where [?x :user/display-name ?n]]",
  "[:find ?n :where [?x :user/uid ?i] [?x :user/display-page ?d] [?d :node/title ?n]]",
]);
export const META_CHUNK = 100;
export const META_TTL_MS = 60000;
export const META_MAX = 2000;

// A cache of row meta by uid. `read(uids)` → Map(uid → meta) for the uids asked; only the missing or stale ones are read.
// Holds at most `max` uids (the oldest reads go first).
export function createMetaCache(read, { ttl = META_TTL_MS, now = () => Date.now(), max = META_MAX } = {}) {
  const cache = new Map();
  return {
    get(uids) {
      const out = new Map();
      const need = new Set();
      const t = now();
      for (const uid of uids || []) {
        const hit = cache.get(uid);
        if (hit && t - hit.at < ttl) out.set(uid, hit.meta);
        else if (uid) need.add(uid);
      }
      if (need.size) {
        const list = [...need];
        let got = null;
        try { got = read(list); } catch { got = null; }
        for (const uid of list) {
          const meta = got?.get?.(uid) || null;
          if (!meta) continue;
          cache.delete(uid);
          cache.set(uid, { meta, at: t });
          out.set(uid, meta);
        }
        for (const uid of cache.keys()) { if (cache.size <= max) break; cache.delete(uid); }
      }
      return out;
    },
    size: () => cache.size,
    clear: () => cache.clear(),
  };
}

const userName = (u) => {
  if (!u || typeof u !== "object") return "";
  const n = u[":user/display-name"] ?? u[":user/display-page"]?.[":node/title"];
  return typeof n === "string" ? n : "";
};

// The META_PULL nodes and the META_REFS counts → Map(uid → meta). `pullMany(pattern, eids)` is roamAlphaAPI.data.pull_many
// (null for a uid that is gone); `q` runs datalog.
export function assembleMeta(uids, { pullMany, q }) {
  const out = new Map();
  const list = (uids || []).filter(Boolean);
  for (let i = 0; i < list.length; i += META_CHUNK) {
    const chunk = list.slice(i, i + META_CHUNK);
    let nodes = [];
    try { nodes = pullMany(META_PULL, chunk.map((u) => [":block/uid", u])) || []; } catch { nodes = []; }
    const byEid = new Map();
    for (const node of nodes) {
      const uid = node?.[":block/uid"];
      if (typeof uid !== "string") continue;
      const s = node[":block/string"];
      const kids = node[":block/children"];
      const meta = {
        created: num(node[":create/time"]) || null,
        edited: num(node[":edit/time"]) || null,
        createdBy: userName(node[":create/user"]),
        editedBy: userName(node[":edit/user"]),
        refs: 0,
        children: Array.isArray(kids) ? kids.length : 0,
        length: typeof s === "string" ? s.length : null,
      };
      out.set(uid, meta);
      if (node[":db/id"] != null) byEid.set(node[":db/id"], meta);
    }
    if (!byEid.size) continue;
    let counts = [];
    try { counts = q(META_REFS, [...byEid.keys()]) || []; } catch { counts = []; }
    for (const [eid, n] of Array.isArray(counts) ? counts : []) { const m = byEid.get(eid); if (m) m.refs = Number(n) || 0; }
  }
  return out;
}
