// PXD-9 source kinds. A kind reads its source into { ok, complete, items } with bounded Roam reads, may watch it, and
// names it for the tray. Built in: a block's children or whole tree, a {{query}} block, and the linked references of a
// page or block. Later kinds (a journal window, the board Inbox, another board's section) register with
// defineFollowKind. Reads never write; a failed or partial read is reported as such so nothing is marked as gone.
// Bounds: a block source pulls one block's children at a time (at most CHILD_LIMIT, each with one child uid that says
// whether it has more) and stops once it has FOLLOW_READ_CAP items, so even the whole tree pulls about
// FOLLOW_READ_CAP + FOLLOW_TREE_DEPTH × CHILD_LIMIT blocks at most. A query stops at its result cap, linked references
// at FOLLOW_READ_CAP + 1. A page by headings pulls the page's top-level blocks and the children of each.
// Triggers: a block source watches its block. A query and linked references read again after a save in this window
// (typing, a checkbox, a drop, Roam's sync dot: watchLocalSaves). A reverse-ref watch would be pulled again on every
// transaction in the graph, about 8 ms for a page with 2,500 backlinks. Edits on other devices come with the tray's
// poll and focus refresh.
//
// An item is { uid, kind: "block" | "page", text, time, title? (page), crumb?, depth?, parent? (block tree), blank? }. `time` is the later of
// create and edit time, so the tray can say what is new since the last visit.

import { FOLLOW_PARENT_CAP, FOLLOW_READ_CAP, FOLLOW_TREE_DEPTH, queryBody, sourceText as textOf } from "../model/follow.js";
import { headingItems } from "../model/follow-headings.js";
import { classifyString, plainText, readPlexus } from "../model/schema.js";
import { loadQueryRows, parseQuery } from "../model/query-run.js";
import { createQueryBackend } from "./query-backend.js";
import { watchLocalSaves } from "./local-saves.js";

const UID = ":block/uid";
const STR = ":block/string";
const ORD = ":block/order";
const KIDS = ":block/children";
const FIELDS = ":block/uid :block/string :block/order :create/time :edit/time";
// Better Tasks keeps its attributes as child blocks; they are not items.
const META = /^BT_attr[\w-]*::/;
// One more than the cap, so a full list says the read was partial.
const REFS_LIMIT = FOLLOW_READ_CAP + 1;
const CHILD_LIMIT = FOLLOW_READ_CAP + 1;

const kinds = new Map();

// kind: { id, title, describe(pointer, host), read(pointer, ctx), watch?(pointer, host, cb, env) -> off, tree? }.
// env: { doc } of the board.
// ctx: { host, boardUid, inBoard() -> Set of the board's own block uids, tick() -> Promise }.
export function defineFollowKind(kind) {
  if (!kind || typeof kind.id !== "string" || typeof kind.read !== "function") return () => {};
  kinds.set(kind.id, kind);
  return () => { if (kinds.get(kind.id) === kind) kinds.delete(kind.id); };
}

export const followKind = (id) => kinds.get(id) || null;

const quote = (text) => `“${plainText(text, 48) || "Untitled"}”`;
const timeOf = (node) => Math.max(Number(node?.[":create/time"]) || 0, Number(node?.[":edit/time"]) || 0);
const sorted = (node) => (Array.isArray(node?.[KIDS]) ? node[KIDS].slice().sort((a, b) => (a?.[ORD] ?? 0) - (b?.[ORD] ?? 0)) : []);

// Nested children joins, `depth` levels below the root, each at most CHILD_LIMIT children (Roam's default would stop
// at 1,000 without saying so). Only the query kind uses it, for the few blocks under a query block.
export function treePattern(depth) {
  let inner = `[${FIELDS}]`;
  for (let d = 1; d < depth; d += 1) inner = `[${FIELDS} {(limit :block/children ${CHILD_LIMIT}) ${inner}}]`;
  return `[:node/title ${FIELDS} {(limit :block/children ${CHILD_LIMIT}) ${inner}}]`;
}

// One block's children, each with one child uid: the pull a block source makes per block it opens.
export const CHILDREN_PULL = `[:node/title ${FIELDS} {(limit :block/children ${CHILD_LIMIT}) [${FIELDS} {(limit :block/children 1) [:block/uid]}]}]`;

// Outline order, depth first, at most `cap` items. `skip` drops a block and everything under it: the board itself
// when it sits on the page it follows. `deeper`: a block on the last level has children that are not listed. A level
// with more children than the cap came back cut at CHILD_LIMIT, so the read is partial. `load(uid)`, when given,
// pulls a block's children before the walk goes into it (null: that pull failed, so the read is partial); without
// it the walk reads the nested `root` it was given.
export function treeItems(root, { depth = 1, cap = FOLLOW_READ_CAP, skip = new Set(), load = null } = {}) {
  const items = [];
  let complete = true;
  let deeper = false;
  let cut = false;
  const walk = (node, level, parent) => {
    const kids = sorted(node);
    if (kids.length > cap) cut = true;
    for (const kid of kids) {
      if (!complete) return;
      const uid = kid?.[UID];
      if (typeof uid !== "string" || skip.has(uid)) continue;
      const string = typeof kid[STR] === "string" ? kid[STR] : "";
      if (META.test(string.trim())) continue;
      if (items.length >= cap) { complete = false; return; }
      items.push({ uid, kind: "block", text: textOf(string), time: timeOf(kid), depth: level, parent, ...(string.trim() ? {} : { blank: true }) });
      const more = Array.isArray(kid[KIDS]) && kid[KIDS].length > 0;
      if (!more) continue;
      if (level >= depth) { deeper = true; continue; }
      const inner = load ? load(uid) : kid;
      if (inner) walk(inner, level + 1, uid);
      else cut = true;
    }
  };
  walk(root, 1, root?.[UID]);
  return { items, complete: complete && !cut, deeper };
}

export const PARENTS_PULL = "[:block/uid {:block/parents [:block/uid]}]";

// True when `uid` still sits somewhere under `sourceUid` (and not inside the board). A failed pull says yes, so a
// card is never marked as left on a read that could not see it.
function underSource(host, uid, sourceUid, boardUid) {
  let node;
  try { node = host?.pullEntity?.(PARENTS_PULL, uid); } catch { return true; }
  const parents = Array.isArray(node?.[":block/parents"]) ? node[":block/parents"].map((p) => p?.[UID]) : [];
  return parents.includes(sourceUid) && !parents.includes(boardUid);
}

function nameOf(host, uid) {
  let node = null;
  try { node = host?.pullEntity?.("[:node/title :block/string]", uid) || null; } catch { node = null; }
  if (!node) return "";
  return typeof node[":node/title"] === "string" ? node[":node/title"] : textOf(node[STR] || "");
}

const watchBlock = (pointer, host, cb) => (typeof host?.watchBlock === "function" ? host.watchBlock(pointer.uid, cb) : () => {});
const watchSaves = (env, cb) => watchLocalSaves(env?.doc, cb);

defineFollowKind({
  id: "block",
  title: "A block's children",
  tree: true,
  describe: (p, host) => `${p.tree ? "Everything under" : "Children of"} ${quote(nameOf(host, p.uid))}`,
  // The watch covers the direct children (add, remove, reorder, edit). Deeper edits come with the poll.
  watch: watchBlock,
  // ctx.followed(): the uids this board's cards from the source show.
  async read(p, { host, boardUid, followed }) {
    const tree = p.tree === true;
    const depth = tree ? FOLLOW_TREE_DEPTH : 1;
    const pullKids = (uid) => {
      try { return host?.pullEntity?.(CHILDREN_PULL, uid) || null; } catch { return null; }
    };
    const node = pullKids(p.uid);
    if (!node) return { ok: false, reason: "missing" };
    const { items, complete, deeper } = treeItems(node, { depth, skip: new Set([boardUid]), load: pullKids });
    if (!tree || !deeper || !complete) return { ok: true, complete, items };
    // The tree goes on below the listed levels: a placed card the read did not list may sit down there.
    const listed = new Set(items.map((item) => item.uid));
    const unseen = [...new Set(typeof followed === "function" ? followed() : [])].filter((uid) => !listed.has(uid));
    if (unseen.length > FOLLOW_PARENT_CAP) return { ok: true, complete: false, deeper, items };
    const members = unseen.filter((uid) => underSource(host, uid, p.uid, boardUid));
    return { ok: true, complete, deeper, items, members };
  },
});

function subtreeUids(node, out = new Set()) {
  for (const kid of Array.isArray(node?.[KIDS]) ? node[KIDS] : []) {
    if (typeof kid?.[UID] === "string") out.add(kid[UID]);
    subtreeUids(kid, out);
  }
  return out;
}

const queryString = (host, uid) => {
  try { return host?.pullEntity?.("[:block/string]", uid)?.[STR] ?? null; } catch { return null; }
};

defineFollowKind({
  id: "query",
  title: "A query",
  describe(p, host) {
    const string = queryString(host, p.uid) || "";
    const parsed = parseQuery(string);
    return `Query ${quote(parsed.ok && parsed.title ? parsed.title : queryBody(string) || "")}`;
  },
  // An edit to the query text, and any save in this window (a new or removed result), read again after the quiet time.
  watch(p, host, cb, env) {
    const offs = [watchBlock(p, host, cb), watchSaves(env, cb)];
    return () => { for (const off of offs) off(); };
  },
  async read(p, { host, inBoard, tick }) {
    const string = queryString(host, p.uid);
    if (typeof string !== "string") return { ok: false, reason: "missing" };
    const parsed = parseQuery(string);
    if (!parsed.ok || !parsed.ast) return { ok: false, reason: "unsupported" };
    // The query block, what sits under it, and the board's own blocks are never results.
    const exclude = new Set(typeof inBoard === "function" ? inBoard() : []);
    exclude.add(p.uid);
    try { subtreeUids(host.pullEntity(treePattern(3), p.uid), exclude); } catch { /* the block alone is excluded */ }
    const res = await loadQueryRows(parsed.ast, createQueryBackend(host), { exclude, tick });
    if (res.status !== "ok") return { ok: false, reason: res.status };
    const items = res.rows.map((row) => (row.kind === "page"
      ? { uid: row.uid, kind: "page", title: row.string.slice(2, -2), text: row.text, time: row.time }
      : { uid: row.uid, kind: "block", text: row.text, crumb: row.crumb, time: row.time }));
    return { ok: true, complete: !res.partial, items };
  },
});

const pick = (obj, key) => obj?.[`:${key}`] ?? obj?.[key];

// The reverse pull Roam's linked references use, capped. A block whose whole text is a card for the target (another
// board's [[Page]] or ((uid)) card) and Plexus connection blocks are not references worth a card.
export const refsQuery = () => `[:find (pull ?p [:node/title :block/string {(limit :block/_refs ${REFS_LIMIT}) [:block/uid :block/string :block/props :create/time :edit/time {:block/page [:node/title]}]}]) :in $ ?uid :where [?p :block/uid ?uid]]`;

defineFollowKind({
  id: "refs",
  title: "Linked references",
  describe: (p, host) => `Linked references of ${quote(nameOf(host, p.uid))}`,
  watch: (p, host, cb, env) => watchSaves(env, cb),
  async read(p, { host, inBoard }) {
    let rows = null;
    try { rows = host?.q?.(refsQuery(), p.uid); } catch { rows = null; }
    if (!Array.isArray(rows)) return { ok: false, reason: "error" };
    const row = rows[0];
    const node = Array.isArray(row) ? row[0] : row;
    if (!node) return { ok: false, reason: "missing" };
    const title = pick(node, "node/title");
    const refs = pick(node, "block/_refs") ?? node._refs ?? [];
    if (!Array.isArray(refs)) return { ok: false, reason: "error" };
    const own = new Set(typeof inBoard === "function" ? inBoard() : []);
    const items = [];
    for (const ref of refs) {
      const uid = pick(ref, "block/uid");
      if (typeof uid !== "string" || own.has(uid) || uid === p.uid) continue;
      const string = String(pick(ref, "block/string") ?? "");
      const type = readPlexus(pick(ref, "block/props"))?.type;
      if (type === "edge" || type === "edges") continue;
      const cls = classifyString(string);
      if ((cls.kind === "page" && typeof title === "string" && cls.title === title) || (cls.kind === "block" && cls.refUid === p.uid)) continue;
      const page = pick(ref, "block/page");
      const pageNode = Array.isArray(page) ? page[0] : page;
      const crumb = pick(pageNode, "node/title");
      items.push({ uid, kind: "block", text: textOf(string), time: timeOf(ref), ...(typeof crumb === "string" ? { crumb } : {}), ...(string.trim() ? {} : { blank: true }) });
    }
    items.sort((a, b) => b.time - a.time || (a.uid < b.uid ? -1 : 1));
    return { ok: true, complete: refs.length < REFS_LIMIT, items: items.slice(0, FOLLOW_READ_CAP) };
  },
});

// PXD-14: the page's top-level blocks (with their heading level) and the children of each, in one pull.
export const HEADINGS_PULL = `[:node/title :block/uid {(limit :block/children ${CHILD_LIMIT}) [${FIELDS} :block/heading {(limit :block/children ${CHILD_LIMIT}) [${FIELDS}]}]}]`;

defineFollowKind({
  id: "headings",
  title: "A page by headings",
  describe: (p, host) => `Headings of ${quote(nameOf(host, p.uid))}`,
  // The block watch covers the page's top level; edits below come with the saves in this window and the poll.
  watch(p, host, cb, env) {
    const offs = [watchBlock(p, host, cb), watchSaves(env, cb)];
    return () => { for (const off of offs) off(); };
  },
  async read(p, { host, boardUid }) {
    let node = null;
    try { node = host?.pullEntity?.(HEADINGS_PULL, p.uid) || null; } catch { node = null; }
    if (!node) return { ok: false, reason: "missing" };
    const { items, complete } = headingItems(node, { skip: new Set([boardUid]) });
    return { ok: true, complete, items, heads: items.filter((item) => item.kind === "heading").map((item) => item.uid) };
  },
});
