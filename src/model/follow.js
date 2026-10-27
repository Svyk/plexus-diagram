// PXD-9 live board source. A board can follow one source elsewhere in the graph (a block's children or tree, a
// {{query}} block, the linked references of a page or block) and keep a tray of what the source holds that the board
// does not show yet. Pure helpers: the pointer in the board's props, the new / left / skipped diff and the "Place all"
// column. Source kinds and their reads live in src/host/follow-sources.js; the writes are session calls
// (src/session-follow.js). Nothing here touches Roam.

import { firstLine, parseBoardTitle, plainText } from "./schema.js";

// Board plexus key: { kind, uid, tree?, skip? }. Written only from the Follow menu and the tray's own buttons.
export const FOLLOW_KEY = "follow";
// Board plexus key: [{ kind, uid, skip }] of sources the board stopped following, newest last: at most
// FOLLOW_KEPT_SOURCES of them and FOLLOW_SKIP_CAP uids in all (the oldest sources go first; the newest always stays).
export const FOLLOW_KEPT_KEY = "followSkip";
export const FOLLOW_KEPT_SOURCES = 5;
// A placed card's plexus key: the source key it came from, so "left the source" only marks this source's cards.
export const FOLLOW_SRC = "src";
export const FOLLOW_MIME = "application/x-plexus-follow";
// "Don't bring back" uids per board. Past the cap the oldest go first.
export const FOLLOW_SKIP_CAP = 300;
// Items read per source. Past it the read is partial, and a partial read never marks a card as gone.
export const FOLLOW_READ_CAP = 300;
// "The whole tree" lists this many levels. A placed card further down is still found by its parents, so it is never
// marked as left, and the tray says that deeper blocks are not listed.
export const FOLLOW_TREE_DEPTH = 8;
// Placed cards a tree read looks up by their parents when the listed levels missed them. Past it the read is partial.
export const FOLLOW_PARENT_CAP = 60;
// The read runs this long after a change, at idle (graph links wait the same 1.5 s).
export const FOLLOW_QUIET_MS = 1500;
// Edits on other devices and deep tree edits are read again this often while on screen.
export const FOLLOW_POLL_MS = 60000;
// A slow read stretches the quiet period to this many times its own length (a TODO query on a big graph reads at most
// a tenth of the time), never past the poll.
export const FOLLOW_BACKOFF = 10;
// PXD-20: a read this long or longer is a long task, so it waits while the user types (and so does a source's first
// read, whose cost is not known yet). One longer than FOLLOW_SLOW_MS runs at most once per FOLLOW_POLL_MS while edits go
// on, and once when they stop. Roam's only other query read, data.backend.q, does not block but trails a save by 1.2-3.6 s
// (sometimes past 8 s), and on an encrypted graph it runs here and blocks like q.
export const FOLLOW_TYPING_MS = 50;
export const FOLLOW_SLOW_MS = 200;
export const followQuietMs = (lastMs) => Math.min(FOLLOW_POLL_MS, Math.max(FOLLOW_QUIET_MS, FOLLOW_BACKOFF * (Number(lastMs) || 0)));
// A card is marked "left the source" after this many complete reads in a row without it.
export const LEFT_CONFIRM = 2;
export const FOLLOW_COLUMN_GAP = 48;
export const FOLLOW_STACK_GAP = 24;

const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const UID_RE = /^[\w-]{1,64}$/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function cleanSkip(list, cap = FOLLOW_SKIP_CAP) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (typeof v !== "string" || !UID_RE.test(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length > cap ? out.slice(out.length - cap) : out;
}

// Any well-formed kind name is kept, so a pointer to a kind a newer version added survives here unread.
export function normalizePointer(raw) {
  if (!isObject(raw)) return null;
  const kind = typeof raw.kind === "string" && KIND_RE.test(raw.kind) ? raw.kind : null;
  const uid = typeof raw.uid === "string" && UID_RE.test(raw.uid) ? raw.uid : null;
  if (!kind || !uid) return null;
  return { kind, uid, ...(raw.tree === true ? { tree: true } : {}), skip: cleanSkip(raw.skip) };
}

export function serializePointer(pointer) {
  const p = normalizePointer(pointer);
  if (!p) return null;
  const out = { kind: p.kind, uid: p.uid };
  if (p.tree) out.tree = true;
  if (p.skip.length) out.skip = p.skip;
  return out;
}

export function readFollow(plexus) {
  return isObject(plexus) ? normalizePointer(plexus[FOLLOW_KEY]) : null;
}

export const sourceKey = (pointer) => (pointer?.kind && pointer?.uid ? `${pointer.kind}:${pointer.uid}` : "");

// The skip list of a source the board stopped following, as a pointer ({ kind, uid, skip }) that is not followed.
function keptList(plexus) {
  const raw = isObject(plexus) ? plexus[FOLLOW_KEPT_KEY] : null;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(normalizePointer).filter((p) => p && p.skip.length);
}

// The kept skip list of source `key` ("<kind>:<uid>"), as a pointer that is not followed, or null.
export function keptFollow(plexus, key) {
  return keptList(plexus).find((p) => sourceKey(p) === key) || null;
}

// The board's plexus with `pointer` set; null removes it. When the board stops following a source (Stop, or a switch
// to another source) that source's skip list is kept under FOLLOW_KEPT_KEY, so following it again does not bring back
// what the user removed; following a kept source again moves its list back into the pointer. Every other key stays.
export function withFollow(plexus, pointer) {
  const base = isObject(plexus) ? { ...plexus } : {};
  const next = pointer ? serializePointer(pointer) : null;
  const prev = readFollow(base);
  const nextKey = sourceKey(next);
  const kept = keptList(base).filter((p) => sourceKey(p) !== nextKey);
  if (prev && sourceKey(prev) !== nextKey && prev.skip.length) kept.push(prev);
  let list = kept.slice(-FOLLOW_KEPT_SOURCES).map((p) => ({ kind: p.kind, uid: p.uid, skip: p.skip }));
  while (list.length > 1 && list.reduce((n, p) => n + p.skip.length, 0) > FOLLOW_SKIP_CAP) list = list.slice(1);
  if (list.length) base[FOLLOW_KEPT_KEY] = list;
  else delete base[FOLLOW_KEPT_KEY];
  if (next) base[FOLLOW_KEY] = next;
  else delete base[FOLLOW_KEY];
  return base;
}

// Following the same source again keeps its skip list and tree choice; a new source starts clean.
export function followPointerFor(current, kind, uid, { tree } = {}) {
  const same = current?.kind === kind && current?.uid === uid;
  const deep = tree === undefined ? same && current.tree === true : tree === true;
  return { kind, uid, ...(deep ? { tree: true } : {}), skip: same ? current.skip : [] };
}

export function addSkip(skip, uids, cap = FOLLOW_SKIP_CAP) {
  const add = (uids || []).filter((u) => typeof u === "string" && UID_RE.test(u));
  const drop = new Set(add);
  return cleanSkip([...(skip || []).filter((u) => !drop.has(u)), ...add], cap);
}

// `{{[[diagram]]: ((uid))}}`: the colon text is one block ref. Roam's native diagram still renders with it (checked
// live 2026-10-23), but parseBoardTitle reads that text as the title, so it is offered in the Follow menu and never
// followed by itself. Roam renders `{{diagram ((uid))}}` (no colon) as a plain button, not a diagram.
// Roam's own uids are 9 characters; blocks made through the API may carry longer ones, and Roam renders those refs too.
export function textSourceUid(boardString) {
  const m = /^\(\(([\w-]{6,64})\)\)$/.exec(parseBoardTitle(boardString));
  return m ? m[1] : null;
}

const QUERY_BODY = /^\{\{\s*(?:\[\[query\]\]|query)\s*:([\s\S]*)\}\}$/;
// The words of a {{query}} block (its clauses without braces), or null for any other block.
export function queryBody(string) {
  const m = QUERY_BODY.exec(String(string || "").trim());
  return m ? plainText(m[1].replace(/[{}]/g, " "), 120) : null;
}

// A row's text: the first line, or "Query …" for a {{query}} block (plainText alone leaves a stray brace).
export function sourceText(string) {
  const body = queryBody(string);
  return body === null ? firstLine(string) : `Query ${body}`.trim();
}

// Ids a source item answers to: its uid, and a page's title (a page card may only know the title).
export function itemIds(item) {
  const out = [];
  if (item?.uid) out.push(`u:${item.uid}`);
  if (item?.kind === "page" && item.title) out.push(`p:${item.title}`);
  return out;
}

// Ids a board item stands for: what a ref card shows, a page card's page, and the block itself.
export function cardIds(card) {
  const out = [];
  if (!card) return out;
  const t = card.target;
  if (t?.kind === "page") {
    if (t.uid) out.push(`u:${t.uid}`);
    if (t.title) out.push(`p:${t.title}`);
    return out;
  }
  if (t?.kind === "block" && t.uid) out.push(`u:${t.uid}`);
  if (card.uid) out.push(`u:${card.uid}`);
  return out;
}

export function followIndex(board, key = "") {
  const on = new Map();
  const followed = [];
  for (const item of board?.items?.values?.() || []) {
    for (const id of cardIds(item)) if (!on.has(id)) on.set(id, item.uid);
    if (key && item.src === key) followed.push(item);
  }
  return { on, followed };
}

export function membership(read) {
  const set = new Set();
  for (const item of read?.items || []) for (const id of itemIds(item)) set.add(id);
  // Uids still in the source that the tray does not list (a block below the listed tree levels).
  for (const uid of read?.members || []) if (typeof uid === "string" && uid) set.add(`u:${uid}`);
  return set;
}

// One step of each followed card's "not in the source" count. Run once per read, never for a board change alone.
// A failed read changes nothing. A partial read clears the cards it saw and never counts one it did not see.
export function absentStep(prev, read, board, key) {
  const before = prev instanceof Map ? prev : new Map();
  if (!read?.ok) return new Map(before);
  const members = membership(read);
  const next = new Map();
  for (const card of followIndex(board, key).followed) {
    if (cardIds(card).some((id) => members.has(id))) continue;
    const n = (before.get(card.uid) || 0) + (read.complete ? 1 : 0);
    if (n > 0) next.set(card.uid, n);
  }
  return next;
}

// True while a card is between its first and its confirming miss: one more read settles it.
export const leftUnsettled = (absent) => [...(absent instanceof Map ? absent.values() : [])].some((n) => n > 0 && n < LEFT_CONFIRM);

// The tray: source items not on the board and not skipped, in source order, and the followed cards that left.
// `since` is this device's last visit to the board (createVisitStore); an item made or edited after it is new.
export function followDiff(read, board, { key = "", skip = [], absent = new Map(), since = null } = {}) {
  const { on, followed } = followIndex(board, key);
  const skipped = new Set(skip);
  const pending = [];
  let placed = 0;
  let dismissed = 0;
  const seen = new Set();
  for (const item of read?.ok ? read.items || [] : []) {
    if (!item?.uid || seen.has(item.uid)) continue;
    seen.add(item.uid);
    if (itemIds(item).some((id) => on.has(id))) { placed += 1; continue; }
    if (skipped.has(item.uid)) { dismissed += 1; continue; }
    if (item.blank) continue;
    pending.push({ ...item, fresh: Number.isFinite(since) && Number(item.time) > since });
  }
  const gone = absent instanceof Map ? absent : new Map();
  const left = followed.filter((card) => (gone.get(card.uid) || 0) >= LEFT_CONFIRM).map((card) => card.uid);
  return { pending, left, placed, dismissed };
}

// Counts for the tray headline. `leftBefore` is the left set this device saw when it last closed the board.
export function sinceVisit(diff, { since = null, leftBefore = null } = {}) {
  if (!Number.isFinite(since)) return { newCount: 0, leftCount: 0, baseline: false };
  const before = leftBefore instanceof Set ? leftBefore : null;
  return {
    newCount: (diff?.pending || []).filter((row) => row.fresh).length,
    leftCount: (diff?.left || []).filter((uid) => !before?.has(uid)).length,
    baseline: true,
  };
}

export function trayHeadline({ newCount = 0, leftCount = 0, baseline = false } = {}) {
  if (!baseline) return "";
  const parts = [];
  if (newCount > 0) parts.push(`${newCount} new`);
  if (leftCount > 0) parts.push(`${leftCount} left`);
  return parts.length ? `${parts.join(", ")} since your last visit` : "Nothing new since your last visit";
}

export const followPill = (n) => `Following (${n})`;

export function followCardString(item) {
  if (item?.kind === "page" && item.title) return `[[${item.title}]]`;
  return `((${item?.uid}))`;
}

export function followBatches(list, cap) {
  const size = Math.max(1, Math.floor(Number(cap) || 1));
  const out = [];
  for (let i = 0; i < (list || []).length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// World top-left of each card in one batch: a column right of the board's cards (or at `at`), one column per batch.
export function followColumn(bounds, count, { w, h, column = 0, at = null, gap = FOLLOW_COLUMN_GAP, stack = FOLLOW_STACK_GAP } = {}) {
  const x0 = at ? at.x : bounds ? bounds.x + bounds.w + gap : 0;
  const y0 = at ? at.y : bounds ? bounds.y : 0;
  const x = x0 + column * (w + gap);
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({ x, y: y0 + i * (h + stack) }));
}

// Per device, like the visit stamp: the cards that had left when the board last closed, so the headline counts only
// what left since.
export function createLeftMemory({ storage = globalThis.localStorage, graph = "" } = {}) {
  const key = (uid) => `plexus-diagram:follow-left:${graph}:${uid}`;
  return {
    get(uid) {
      try {
        const raw = storage?.getItem?.(key(uid));
        const list = raw ? JSON.parse(raw) : null;
        return Array.isArray(list) ? new Set(list.filter((u) => typeof u === "string")) : null;
      } catch { return null; }
    },
    set(uid, uids) {
      try { storage?.setItem?.(key(uid), JSON.stringify([...(uids || [])].slice(0, FOLLOW_SKIP_CAP))); } catch { /* quota or private mode */ }
    },
  };
}
