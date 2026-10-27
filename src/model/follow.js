// PXD-9 live board source. A board can follow one source elsewhere in the graph (a block's children or tree, a
// {{query}} block, the linked references of a page or block) and keep a tray of what the source holds that the board
// does not show yet. Pure helpers: the pointer in the board's props, the new / left / skipped diff and the "Place all"
// column. Source kinds and their reads live in src/host/follow-sources.js; the writes are session calls
// (src/session-follow.js). Nothing here touches Roam.

import { firstLine, parseBoardRef, plainText } from "./schema.js";

// Board plexus key: { kind, uid, tree?, columns?, section?, skip? }. Written only from the Follow menu and the tray's own buttons.
export const FOLLOW_KEY = "follow";
// Board plexus key: [{ kind, uid, skip }] of sources the board stopped following, newest last: at most
// FOLLOW_KEPT_SOURCES of them and FOLLOW_SKIP_CAP uids in all (the oldest sources go first; the newest always stays).
export const FOLLOW_KEPT_KEY = "followSkip";
export const FOLLOW_KEPT_SOURCES = 5;
// A placed card's plexus key: the source key it came from, so "left the source" only marks this source's cards.
export const FOLLOW_SRC = "src";
// PXD-15: a card placed from a journal window also keeps its day (MM-DD-YYYY), so its column is found again.
export const FOLLOW_DAY = "day";
// The journals source: uid "days-N" (today and the N-1 days before) or "week" (Monday to Sunday of this week).
export const JOURNAL_DEFAULT_DAYS = 7;
export const JOURNAL_MAX_DAYS = 31;
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
  const section = typeof raw.section === "string" && UID_RE.test(raw.section) ? raw.section : null;
  return { kind, uid, ...(raw.tree === true ? { tree: true } : {}), ...(raw.columns === true ? { columns: true } : {}), ...(section ? { section } : {}), skip: cleanSkip(raw.skip) };
}

export function serializePointer(pointer) {
  const p = normalizePointer(pointer);
  if (!p) return null;
  const out = { kind: p.kind, uid: p.uid };
  if (p.tree) out.tree = true;
  if (p.columns) out.columns = true;
  if (p.section) out.section = p.section;
  if (p.skip.length) out.skip = p.skip;
  return out;
}

export function readFollow(plexus) {
  return isObject(plexus) ? normalizePointer(plexus[FOLLOW_KEY]) : null;
}

// PXD-19: a section of another board is "board:<board>/<section>" (a uid never holds "/").
export const sourceKey = (pointer) => (pointer?.kind && pointer?.uid
  ? `${pointer.kind}:${pointer.uid}${typeof pointer.section === "string" && pointer.section ? `/${pointer.section}` : ""}`
  : "");

// The skip list of a source the board stopped following, as a pointer ({ kind, uid, skip }) that is not followed.
function keptList(plexus) {
  const raw = isObject(plexus) ? plexus[FOLLOW_KEPT_KEY] : null;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(normalizePointer).filter((p) => p && p.skip.length);
}

// The kept skip list of source `key` (sourceKey), as a pointer that is not followed, or null.
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
  let list = kept.slice(-FOLLOW_KEPT_SOURCES).map((p) => ({ kind: p.kind, uid: p.uid, ...(p.section ? { section: p.section } : {}), skip: p.skip }));
  while (list.length > 1 && list.reduce((n, p) => n + p.skip.length, 0) > FOLLOW_SKIP_CAP) list = list.slice(1);
  if (list.length) base[FOLLOW_KEPT_KEY] = list;
  else delete base[FOLLOW_KEPT_KEY];
  if (next) base[FOLLOW_KEY] = next;
  else delete base[FOLLOW_KEY];
  return base;
}

// Following the same source again keeps its skip list and tree choice; a new source starts clean. Another section of
// the same board is another source.
export function followPointerFor(current, kind, uid, { tree, columns, section } = {}) {
  const sec = typeof section === "string" && UID_RE.test(section) ? section : "";
  const same = current?.kind === kind && current?.uid === uid && (current.section || "") === sec;
  const deep = tree === undefined ? same && current.tree === true : tree === true;
  const cols = columns === undefined ? same && current.columns === true : columns === true;
  return { kind, uid, ...(deep ? { tree: true } : {}), ...(cols ? { columns: true } : {}), ...(sec ? { section: sec } : {}), skip: same ? current.skip : [] };
}

// PXD-19: boards a mirror chain looks through before it gives up (a longer chain is not called a loop).
export const MIRROR_CHAIN_CAP = 8;

// Why board `boardUid` cannot mirror `pointer` (a board-kind pointer), or "". "self": the source is this board or one
// of its sections. "cycle": the source board, or a board it mirrors (and so on), mirrors this board. followsOf(uid)
// gives the boards a board mirrors (its own pointer and its sections' pointers); one that throws mirrors nothing.
export function mirrorRefusal({ boardUid, pointer, followsOf } = {}) {
  if (!pointer || pointer.kind !== "board" || !pointer.uid) return "";
  if (pointer.uid === boardUid) return "self";
  const seen = new Set();
  const queue = [pointer.uid];
  while (queue.length && seen.size < MIRROR_CHAIN_CAP) {
    const uid = queue.shift();
    if (seen.has(uid)) continue;
    seen.add(uid);
    let next = [];
    try { next = typeof followsOf === "function" ? followsOf(uid) || [] : []; } catch { next = []; }
    for (const n of next) {
      if (n === boardUid) return "cycle";
      if (typeof n === "string" && n && !seen.has(n)) queue.push(n);
    }
  }
  return "";
}

// The source boards of the board-kind pointers in a set of plexus props (a board's own, its sections').
export function mirroredBoards(plexusList) {
  const out = [];
  for (const plexus of plexusList || []) {
    const p = readFollow(plexus);
    if (p?.kind === "board" && !out.includes(p.uid)) out.push(p.uid);
  }
  return out;
}

// "days-N" -> { days: N } (1..JOURNAL_MAX_DAYS), "week" -> { week: true }, anything else null.
export function journalSpec(uid) {
  if (uid === "week") return { week: true };
  const m = /^days-([1-9]\d?)$/.exec(String(uid ?? ""));
  const days = m ? Number(m[1]) : 0;
  return days >= 1 && days <= JOURNAL_MAX_DAYS ? { days } : null;
}

export function journalUid(spec) {
  if (spec?.week) return "week";
  const days = Math.floor(Number(spec?.days));
  return days >= 1 && days <= JOURNAL_MAX_DAYS ? `days-${days}` : "";
}

export function addSkip(skip, uids, cap = FOLLOW_SKIP_CAP) {
  const add = (uids || []).filter((u) => typeof u === "string" && UID_RE.test(u));
  const drop = new Set(add);
  return cleanSkip([...(skip || []).filter((u) => !drop.has(u)), ...add], cap);
}

// The block a board's own text points at: `{{diagram ((uid))}}` or `{{[[diagram]] ((uid))}}` (no colon, with or without
// title text), or the colon form whose text is only the ref. Live facts (2026-10-26): Roam renders `{{[[diagram]] ((uid))}}`
// and `{{[[diagram]]: ((uid))}}` as its native diagram, so Plexus mounts through the ordinary path; only the bare
// `{{diagram ((uid))}}` is a plain `button.rm-xparser-default-diagram`, which Plexus mounts on itself. A colon form with
// more text after the ref (`: ((uid)) Reading list`) is a title, not a source. Roam's own uids are 9 characters; blocks
// made through the API may carry longer ones, and Roam renders those refs too.
export function boardRefSource(boardString) {
  const ref = parseBoardRef(boardString);
  if (!ref) return null;
  if (ref.colon && ref.title !== "") return null;
  return ref.uid;
}

// The Follow menu's "The block in the board text" offer.
export const textSourceUid = boardRefSource;

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
  // PXD-14: a heading's section stands for the heading, so the heading is on the board while its section is.
  if (card.type === "section" && typeof card.head === "string" && card.head) out.push(`u:${card.head}`);
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
    // PXD-14: a block under a heading the user took off the board is dismissed with it.
    if (skipped.has(item.uid) || (item.heading && item.heading !== item.uid && skipped.has(item.heading))) { dismissed += 1; continue; }
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

// PXD-18: the board's own Inbox (daily-note blocks that cite it) as a source. Its pointer is { kind: "inbox", uid: the
// board }. New citing blocks arrive in the tray's Arrivals strip, at most ARRIVALS_CAP per visit, so a board opened
// after a month does not get a wall of rows; the rest say how many wait. The cap is under SPREAD_CAP, so placing the
// whole strip is one batch and one undo.
export const INBOX_KIND = "inbox";
export const ARRIVALS_CAP = 20;

// The strip: the first rows of `pending` (newest first) that this visit still has room for. `allowance` is how many
// arrivals this visit shows (ARRIVALS_CAP, more after "Show more"); `placed` how many it already placed from the
// strip (visitPlaced). A row taken away by a "Don't bring back" or by a card made without the source key uses no room.
export function arrivalsView(pending, { allowance = ARRIVALS_CAP, placed = 0 } = {}) {
  const list = Array.isArray(pending) ? pending : [];
  const room = Math.max(0, Math.floor(Number(allowance) || 0) - Math.max(0, Math.floor(Number(placed) || 0)));
  const rows = list.slice(0, room);
  return { rows, waiting: list.length - rows.length };
}

// Cards of source `key` on the board now that were not there when the visit began (`before`: their uids). Read from
// the board, so a drag counts like Place, and an undo or a delete gives the room back.
export function visitPlaced(board, key, before) {
  const had = before instanceof Set ? before : new Set();
  return followIndex(board, key).followed.filter((card) => !had.has(card.uid)).length;
}

export const followedUids = (board, key) => new Set(followIndex(board, key).followed.map((card) => card.uid));

export function arrivalsLine({ rows = [], waiting = 0 } = {}) {
  const n = rows.length;
  if (!n) return waiting > 0 ? `${waiting} wait for your next visit` : "No arrivals";
  const head = `${n} arrival${n === 1 ? "" : "s"}`;
  return waiting > 0 ? `${head} · ${waiting} more wait` : head;
}

export const arrivalsPill = (n) => `Arrivals (${n})`;

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

// PXD-15: world top-left of each entry for a journal source with one column per day. `existing`: [{ day, x, y, w, h }]
// rects of the board's cards from this source. A day's column is the x band of its lowest card that no other day's
// card shares (page cards the plain mode stacked one under another are in no day's column); its new cards go under
// that card. A day without one gets a new column right of every journal card (or of `bounds`), oldest day first.
// Nothing placed moves.
const dayKey = (day) => {
  const m = /^(\d\d)-(\d\d)-(\d{4})$/.exec(String(day ?? ""));
  return m ? `${m[3]}${m[1]}${m[2]}` : String(day ?? "");
};
export function journalColumnSpots(existing, entries, { bounds = null, w, h, gap = FOLLOW_COLUMN_GAP, stack = FOLLOW_STACK_GAP } = {}) {
  const rects = (existing || []).filter((r) => r?.day);
  const cols = new Map();
  let right = -Infinity;
  let top = Infinity;
  for (const r of rects) {
    right = Math.max(right, r.x + r.w);
    top = Math.min(top, r.y);
    const shared = rects.some((o) => o.day !== r.day && o.x < r.x + r.w && o.x + o.w > r.x);
    const col = cols.get(r.day);
    if (!shared && (!col || r.y + r.h > col.bottom)) cols.set(r.day, { x: r.x, bottom: r.y + r.h });
  }
  const x0 = Number.isFinite(right) ? right + gap : bounds ? bounds.x + bounds.w + gap : 0;
  const y0 = Number.isFinite(top) ? top : bounds ? bounds.y : 0;
  const fresh = [...new Set((entries || []).map((e) => e?.day ?? "").filter((d) => !cols.has(d)))].sort((a, b) => (dayKey(a) < dayKey(b) ? -1 : dayKey(a) > dayKey(b) ? 1 : 0));
  const made = new Map(fresh.map((d, i) => [d, { x: x0 + i * (w + gap), next: y0 }]));
  const below = new Map();
  return (entries || []).map((e) => {
    const day = e?.day ?? "";
    const col = cols.get(day);
    if (col) {
      const y = below.has(day) ? below.get(day) : col.bottom + stack;
      below.set(day, y + h + stack);
      return { x: col.x, y };
    }
    const c = made.get(day);
    const y = c.next;
    c.next += h + stack;
    return { x: c.x, y };
  });
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

// ---- PXD-13: a source per section ----
// A section follows a source through plexus.follow on its own block (same shape as the board's). An owner is the board
// or one section; owners in order are the sections in outline order, then the board (the catch-all). One owner per
// source key on a board, so a placed card's src names exactly one owner.

// Sections per board that follow a source (the board's own source comes on top).
export const FOLLOW_SECTION_CAP = 8;
export const followCapText = () => `Up to ${FOLLOW_SECTION_CAP} sections follow a source on one board`;
export const BOARD_OWNER_NAME = "this board";

export function sectionOwnerName(item) {
  return `“${plainText(item?.title || item?.string || "", 48) || "Untitled section"}”`;
}

// Sections that follow a source, depth first in block order, then the board when it follows one.
// Each: { uid, section, pointer, key, name, over (past the cap: not read), dup (name of the earlier owner of the same
// key: not read) }. `capped`: the cap is reached, so one more section cannot follow.
export function followOwnersOf(board) {
  const out = [];
  if (!board?.items) return { owners: out, capped: false, sections: 0 };
  const byOrder = (uids) => (uids || [])
    .map((u, i) => ({ u, i, o: board.items.get(u)?.order ?? i }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map(({ u }) => u);
  const visit = (uids) => {
    for (const uid of byOrder(uids)) {
      const item = board.items.get(uid);
      if (item?.type !== "section") continue;
      if (item.follow) out.push({ uid, section: true, pointer: item.follow, key: sourceKey(item.follow), name: sectionOwnerName(item) });
      visit(item.members);
    }
  };
  visit(board.roots);
  let sections = 0;
  for (const o of out) { sections += 1; o.over = sections > FOLLOW_SECTION_CAP; }
  const pointer = readFollow(board.plexus);
  if (pointer) out.push({ uid: board.uid, section: false, pointer, key: sourceKey(pointer), name: BOARD_OWNER_NAME, over: false });
  const first = new Map();
  for (const o of out) {
    o.dup = !o.over && first.has(o.key) ? first.get(o.key) : null;
    if (!o.over && !first.has(o.key)) first.set(o.key, o.name);
  }
  return { owners: out, capped: sections >= FOLLOW_SECTION_CAP, sections };
}

// One item waiting in several sources shows once, placeable in the first owner (owner order); later owners show it
// as a hint ("also in …") that Place all skips. An item the first owner skipped is not offered by later owners at all.
// lanes: [{ name, read, skip, diff }] in owner order. Returns [{ pending, hints: [{ ...row, also }] }] in the same order.
export function dedupeFollow(lanes) {
  const claimed = new Map();
  return (lanes || []).map((lane) => {
    const pending = [];
    const hints = [];
    for (const row of lane?.diff?.pending || []) {
      const ids = itemIds(row);
      const by = ids.map((id) => claimed.get(id)).find(Boolean);
      if (by?.skip) continue;
      if (by) { hints.push({ ...row, also: by.name }); continue; }
      for (const id of ids) claimed.set(id, { name: lane.name });
      pending.push(row);
    }
    const skipped = new Set(lane?.skip || []);
    for (const item of lane?.read?.ok ? lane.read.items || [] : []) {
      if (!item?.uid || !skipped.has(item.uid)) continue;
      for (const id of itemIds(item)) if (!claimed.has(id)) claimed.set(id, { name: lane.name, skip: true });
    }
    return { pending, hints };
  });
}

// World top-left of `count` cards in a grid inside a section: columns fit the inner width, the first row one stack gap
// below the section's current members (or at the top-left inside the padding when it has none). `start` continues the
// grid of an earlier batch.
export function sectionGrid(section, members, count, { w, h, pad = 24, gap = FOLLOW_STACK_GAP, start = 0 } = {}) {
  const inner = Math.max(0, (section?.w || 0) - 2 * pad);
  const cols = Math.max(1, Math.floor((inner + gap) / (w + gap)));
  const x0 = (section?.x || 0) + pad;
  const bottom = (members || []).reduce((m, r) => Math.max(m, r.y + r.h), -Infinity);
  const y0 = Number.isFinite(bottom) ? bottom + gap : (section?.y || 0) + pad;
  return Array.from({ length: Math.max(0, count) }, (_, k) => {
    const i = start + k;
    return { x: x0 + (i % cols) * (w + gap), y: y0 + Math.floor(i / cols) * (h + gap) };
  });
}
