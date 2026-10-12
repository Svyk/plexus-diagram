// Small read-only Roam lookups for the Ask AI composer: page titles for [[ and # mentions, block text search for ((,
// #liveai/prompt and #liveai/style blocks, and the page open in the main view. Throw-free: no Roam, no results.

const api = (w) => (w || globalThis)?.roamAlphaAPI || globalThis.roamAlphaAPI || null;
function q(w, query, ...inputs) {
  const data = api(w)?.data;
  if (!data) return [];
  try {
    const rows = data.fast?.q ? data.fast.q(query, ...inputs) : data.q?.(query, ...inputs);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
// A literal, case-insensitive pattern for re-pattern (Roam's Datascript has no lower-case; "(?i)" becomes the JS flag).
export const ciPattern = (text) => `(?i)${String(text ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;

// Every page title, once per call (the composer keeps the list for the open window).
export function pageTitles(w) {
  return q(w, "[:find ?t :where [?p :node/title ?t]]").map((r) => r[0]).filter((t) => typeof t === "string" && t);
}

// Blocks whose text contains `text` (case-insensitive), shortest first: [{ uid, string, page }].
export function searchBlocks(w, text, limit = 20) {
  const needle = String(text ?? "").trim();
  if (needle.length < 2) return [];
  const rows = q(w, `[:find ?u ?s ?t :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`, ciPattern(needle));
  return rows
    .filter(([, s, t]) => typeof s === "string" && !String(t).startsWith("roam/"))
    .sort((a, b) => a[1].length - b[1].length)
    .slice(0, limit)
    .map(([uid, string, page]) => ({ uid, string, page }));
}

const CHILDREN = "[:block/string :block/order {(limit :block/children nil) ...}]";
const sortKids = (node) => {
  const kids = (node?.[":block/children"] || node?.children || []).slice().sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0));
  return kids.map((k) => ({ string: k[":block/string"] ?? k.string ?? "", children: sortKids(k) }));
};

// Blocks that reference the page `tag` (e.g. "liveai/prompt"), with their children: [{ uid, string, children }].
export function taggedBlocks(w, tag) {
  const rows = q(w, `[:find ?u ?s :in $ ?tag :where [?t :node/title ?tag] [?b :block/refs ?t] [?b :block/uid ?u] [?b :block/string ?s]]`, tag);
  const pull = api(w)?.data?.pull;
  return rows.map(([uid, string]) => {
    let tree = null;
    try { tree = typeof pull === "function" ? pull.call(api(w).data, CHILDREN, [":block/uid", uid]) : null; } catch { tree = null; }
    return { uid, string, children: sortKids(tree) };
  });
}

// The uid of the page with exactly this title, or "" when there is none.
export function pageUid(w, title) {
  const row = q(w, "[:find ?u :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]", String(title ?? ""))[0];
  return typeof row?.[0] === "string" ? row[0] : "";
}

export function blockString(w, uid) {
  const row = q(w, "[:find ?s :in $ ?u :where [?b :block/uid ?u] [?b :block/string ?s]]", uid)[0];
  return typeof row?.[0] === "string" ? row[0] : "";
}

// The title of the page open in Roam's main view (the page of a zoomed block), or "".
export async function currentPageTitle(w) {
  let uid = "";
  try { uid = String((await api(w)?.ui?.mainWindow?.getOpenPageOrBlockUid?.()) || ""); } catch { uid = ""; }
  if (!uid) return "";
  const own = q(w, "[:find ?t :in $ ?u :where [?p :block/uid ?u] [?p :node/title ?t]]", uid)[0];
  if (own?.[0]) return own[0];
  const page = q(w, "[:find ?t :in $ ?u :where [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]", uid)[0];
  return page?.[0] || "";
}
