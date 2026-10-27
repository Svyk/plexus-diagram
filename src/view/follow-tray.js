// PXD-9 place tray: what the followed source holds that the board does not show yet. The board never writes a card by
// itself; rows wait here until the user places them (drag one onto the board, Place, or Place all into a column right
// of the cards). Reads run at idle a quiet period after a trigger: the source's watch (a block source's block; for a
// query or linked references, any save in this window), the tray opening, the window coming back, a slow poll. At most
// one read per quiet period and never two at once, only while the board is on screen and the tab is visible; a slow
// read stretches the quiet period (followQuietMs). A board change only sorts the last read again. Cards that left the
// source get a mark (onLeft) after two complete reads without them; a partial or failed read never adds one.
// PXD-14: a page followed by headings groups the tray by heading, and cards whose block moved under another heading
// get a "moved" mark (onMoved) and a list; the card stays where it is until the user dismisses the mark.
// PXD-20: a read that would start while the user types waits for editing to go idle when its source's last read was a
// long task (or it has none yet); a slow one also waits out FOLLOW_POLL_MS since the last read while edits go on.
// PXD-13: the board and up to FOLLOW_SECTION_CAP sections each follow a source, one lane per owner. Each lane keeps its
// own quiet period and hold; a lane whose period ends is due, and one shared pass (one bgIdle job) reads every due lane
// one after another in owner order, then sorts and dedupes all lanes once and paints once. One poll and one set of
// window / on-screen listeners per tray.
// PXD-18: following the board's Inbox, the board's rows are an Arrivals strip of at most ARRIVALS_CAP per visit (this
// tray's life); the rest say how many wait, and "Show more" makes room for another ARRIVALS_CAP. The visit's placed
// count is read from the board (visitPlaced), so a drag counts like Place and an undo gives the room back.

import { CARD_MIME } from "../model/drop.js";
import {
  ARRIVALS_CAP,
  BOARD_OWNER_NAME,
  FOLLOW_MIME,
  FOLLOW_SECTION_CAP,
  FOLLOW_POLL_MS,
  FOLLOW_SLOW_MS,
  FOLLOW_TREE_DEPTH,
  FOLLOW_TYPING_MS,
  INBOX_KIND,
  absentStep,
  arrivalsLine,
  arrivalsPill,
  arrivalsView,
  createLeftMemory,
  dedupeFollow,
  followCardString,
  followDiff,
  followIndex,
  followOwnersOf,
  followPill,
  followedUids,
  followQuietMs,
  leftUnsettled,
  sinceVisit,
  sourceKey,
  textSourceUid,
  trayHeadline,
  visitPlaced,
} from "../model/follow.js";
import { headingsEmpty, headingsNote, movedCards } from "../model/follow-headings.js";
import { itemLabel, plainText } from "../model/schema.js";
import { followKind } from "../host/follow-sources.js";
import { editState, watchEditing } from "../host/local-saves.js";
import { SPREAD_CAP } from "../session-clip.js";

const REASONS = {
  missing: "The source block is gone.",
  missingText: "The block in the board text does not exist.",
  unsupported: "Plexus cannot run this query. It reads page and block refs with and, or and not.",
  slow: "The query took too long to read.",
  unknown: "This board follows a kind of source this version cannot read.",
};


const EMPTY_DIFF = { pending: [], left: [], placed: 0, dismissed: 0 };

export function createFollowTray({
  doc = globalThis.document,
  root,
  host,
  session,
  timers,
  board,
  since = null,
  storage = globalThis.localStorage,
  graph = "",
  onLeft,
  onParents,
  onMoved,
  onShowCard,
  onPlaced,
  onSource,
  toast,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  const boardUid = session?.uid;
  const memory = createLeftMemory({ storage, graph });
  // Owner uid -> lane, and the lanes in owner order (sections in outline order, then the board).
  let lanes = new Map();
  let order = [];
  let leftShown = "";
  let moved = [];
  let movedShown = "";
  let open = false;
  let autoOpened = false;
  let disposed = false;
  let btn = null;
  let panel = null;
  let groupEls = new Map();
  // The drawer's scrollers (the groups, or the one-source list) and the group Show in tray asked for.
  let groupsEl = null;
  let listEl = null;
  let showAnchor = null;
  let poll = null;
  let placing = false;
  // The shared pass: one bgIdle job reads every due lane in turn (never two reads at once on the board).
  let job = null;
  let passing = false;
  let passAgain = false;
  let passes = 0;
  let paints = 0;
  let readsNow = 0;
  let maxReads = 0;
  let offEditing = () => {};
  // The root's IntersectionObserver: null until it reports.
  let seen = null;
  let io = null;

  const newLane = (uid) => ({
    uid,
    section: uid !== boardUid,
    name: "",
    over: false,
    dup: null,
    pointer: null,
    key: "",
    read: null,
    status: "idle",
    reason: "",
    absent: new Map(),
    diff: EMPTY_DIFF,
    pending: [],
    hints: [],
    label: "",
    reads: 0,
    unwatch: () => {},
    quiet: null,
    // Its quiet period ended (or the tray opened): the next pass reads it.
    due: false,
    inFlight: false,
    again: false,
    // How long the last read took: the next quiet period is ten times that (at least FOLLOW_QUIET_MS).
    lastMs: 0,
    // How long the last read waited for the shared background budget after its quiet period.
    waitMs: 0,
    queuedAt: 0,
    // PXD-20: a read is owed but waits for editing to go idle (held), or for the slow-read floor (floorWait).
    held: false,
    floorWait: null,
    // When this source's last read started, and whether it has one (an unknown cost counts as slow).
    lastStart: -Infinity,
    known: false,
    // A trigger came while the board was off screen or the tab hidden: read when it shows again.
    stale: false,
    // The cards that had left when the board last closed (per owner, per device).
    leftBefore: uid ? memory.get(uid) : null,
    // PXD-18: this visit's Arrivals room, and the source's cards already on the board when the visit (or the source)
    // began: every other card of the source counts as placed this visit, however it was made.
    allowance: ARRIVALS_CAP,
    before: new Set(),
  });
  // Over the section cap, or a source an earlier owner follows already: listed, never read.
  const readable = (lane) => Boolean(lane?.pointer) && !lane.over && !lane.dup;

  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  const swallow = (event) => event.stopPropagation();
  const shield = (node, types = ["pointerdown", "mousedown", "dblclick"]) => {
    for (const type of types) node.addEventListener(type, swallow);
  };
  const button = (parent, cls, text, run, aria) => {
    const b = el("button", cls, parent, text);
    b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    shield(b);
    b.addEventListener("click", (event) => { event.stopPropagation(); run(); });
    return b;
  };

  const ctx = (lane) => ({
    host,
    boardUid,
    boardTitle: () => board()?.title || "",
    inBoard: () => session.followExclude?.() || new Set([boardUid]),
    tick: () => new Promise((resolve) => timers.idle(resolve)),
    followed: () => followIndex(board(), lane.key).followed.map((card) => card.target?.uid).filter(Boolean),
  });

  // A pointer read from the board text (never stored) at a block that is not there.
  const textMissing = (lane) => !lane.section && lane.reason === "missing" && lane.pointer?.kind === "block" && board()?.followDerived === true;
  const describe = (lane) => {
    const kind = lane.pointer ? followKind(lane.pointer.kind) : null;
    if (textMissing(lane)) return "a block that does not exist";
    try { return kind?.describe?.(lane.pointer, host) || kind?.title || "a source"; } catch { return kind?.title || "a source"; }
  };

  const allLeft = () => {
    const out = [];
    for (const lane of order) out.push(...lane.diff.left);
    return out;
  };
  const waiting = () => order.reduce((n, lane) => n + lane.pending.length, 0);

  function recompute() {
    const b = board();
    for (const lane of order) {
      lane.diff = readable(lane) ? followDiff(lane.read, b, { key: lane.key, skip: lane.pointer.skip, absent: lane.absent, since }) : EMPTY_DIFF;
    }
    const live = order.filter(readable);
    const sorted = dedupeFollow(live.map((lane) => ({ name: lane.name, read: lane.read, skip: lane.pointer.skip, diff: lane.diff })));
    for (const lane of order) { lane.pending = []; lane.hints = []; }
    live.forEach((lane, i) => { lane.pending = sorted[i].pending; lane.hints = sorted[i].hints; });
    const left = allLeft();
    const next = left.slice().sort().join("\n");
    if (next !== leftShown) {
      leftShown = next;
      onLeft?.(new Set(left));
    }
    // PXD-14: only the board follows headings.
    const own = lanes.get(boardUid);
    moved = readable(own) && own.pointer.kind === "headings" ? movedCards(own.read, b, own.key) : [];
    const mark = moved.map((m) => `${m.uid}>${m.to}`).join("\n");
    if (mark !== movedShown) {
      movedShown = mark;
      onMoved?.(new Map(moved.map((m) => [m.uid, m.toText])));
    }
  }

  function sync() {
    if (disposed) return;
    paints += 1;
    recompute();
    paintPill();
    paintPanel();
  }

  // ---- reads ----
  const showing = () => doc?.visibilityState !== "hidden" && seen !== false;

  function gate(lane) {
    const edit = editState(doc);
    const cost = lane.known ? lane.lastMs : Infinity;
    if (edit.typing && cost >= FOLLOW_TYPING_MS) return "typing";
    if (edit.busy && cost > FOLLOW_SLOW_MS && now() - lane.lastStart < FOLLOW_POLL_MS) return "floor";
    return "";
  }

  function hold(lane, why) {
    lane.held = true;
    if (why !== "floor" || lane.floorWait) return;
    lane.floorWait = timers.later(() => {
      lane.floorWait = null;
      if (lane.held) markDue(lane);
    }, Math.max(0, lane.lastStart + FOLLOW_POLL_MS - now()));
  }

  function unhold(lane) {
    lane.held = false;
    lane.floorWait?.();
    lane.floorWait = null;
  }

  // Editing went idle (or may have): a held read runs now. When the user's typing stops (a pause, or leaving the
  // editors), a quiet period stretched by a slow read ends early. The floor still holds until the saves stop as well,
  // so typing in bursts with short pauses does not read a slow source at every pause. Save signals that stop on their
  // own (another extension's writes) do not end the quiet period.
  const onEditing = (why) => {
    if (disposed) return;
    for (const lane of order) {
      const cut = why === "typing" && Boolean(lane.quiet) && !lane.due;
      if (cut) {
        lane.quiet();
        lane.quiet = null;
      }
      if (cut || (lane.held && !gate(lane))) markDue(lane);
    }
  };

  function requestPass() {
    if (disposed) return;
    if (passing) { passAgain = true; return; }
    if (job) return;
    job = timers.bgIdle(() => { void runPass(); }, "follow");
  }

  // The lane is read in the next pass. One whose read is running gets one more quiet period after it instead.
  function markDue(lane) {
    if (disposed || !readable(lane) || lane.due) return;
    if (lane.inFlight) { lane.again = true; return; }
    lane.due = true;
    lane.queuedAt = now();
    requestPass();
  }

  // One read. Resolves true when the lane took a result (or an error) to paint.
  async function readLane(lane, kind) {
    const mine = lane.key;
    lane.inFlight = true;
    lane.stale = false;
    lane.waitMs = Math.max(0, now() - lane.queuedAt);
    if (!lane.read) paintPanel();
    const started = now();
    readsNow += 1;
    maxReads = Math.max(maxReads, readsNow);
    const res = await Promise.resolve().then(() => kind.read(lane.pointer, ctx(lane))).catch(() => ({ ok: false, reason: "error" }));
    readsNow -= 1;
    lane.inFlight = false;
    if (disposed) return false;
    // The source changed (or the owner went) during the read: its result is dropped, and a read the new source asked
    // for runs after it.
    if (mine !== lane.key || lanes.get(lane.uid) !== lane) {
      if (lane.again) { lane.again = false; schedule(lane); }
      return false;
    }
    lane.lastMs = Math.max(0, now() - started);
    lane.lastStart = started;
    lane.known = true;
    lane.reads += 1;
    if (res?.ok) {
      lane.read = res;
      // PXD-16: the board's own whole-tree source gives the view its blocks' parents (one map: the board's lane only).
      if (!lane.section && lane.pointer.tree && typeof onParents === "function") {
        const parents = new Map();
        for (const item of res.items || []) if (item?.parent && item.uid) parents.set(item.uid, item.parent);
        try { onParents(parents); } catch { /* view */ }
      }
      lane.absent = absentStep(lane.absent, res, board(), lane.key);
      lane.status = "ok";
      lane.reason = "";
    } else {
      // The last good read stays: a failed read neither empties the tray nor marks a card.
      lane.status = "error";
      lane.reason = res?.reason || "error";
    }
    lane.label = describe(lane);
    lane.ok = res?.ok === true && res.complete === true;
    return true;
  }

  async function runPass() {
    job = null;
    if (disposed) return;
    passing = true;
    passes += 1;
    const read = [];
    let paint = false;
    for (const lane of order.filter((l) => l.due)) {
      if (disposed) break;
      lane.due = false;
      if (lanes.get(lane.uid) !== lane || !readable(lane)) continue;
      // Off screen: the held read becomes a stale one, read when the board shows again.
      if (!showing()) { lane.stale = true; unhold(lane); continue; }
      const kind = followKind(lane.pointer.kind);
      if (!kind) { lane.status = "error"; lane.reason = "unknown"; paint = true; continue; }
      const why = gate(lane);
      if (why) { hold(lane, why); continue; }
      unhold(lane);
      if (await readLane(lane, kind)) { read.push(lane); paint = true; }
    }
    passing = false;
    if (disposed) return;
    if (paint) sync();
    // A card with one miss gets its confirming read, but only after a complete read: a partial read adds no miss,
    // so asking again would read the source every quiet period for as long as it stays partial.
    for (const lane of read) {
      if (lane.again) { lane.again = false; schedule(lane); } else if (lane.ok && leftUnsettled(lane.absent)) schedule(lane);
    }
    if (passAgain || order.some((l) => l.due)) {
      passAgain = false;
      if (order.some((l) => l.due)) requestPass();
    }
  }

  // Every trigger comes here. While a quiet period runs, more triggers join it: one read at its end.
  function schedule(lane) {
    if (disposed || !readable(lane)) return;
    if (!showing()) { lane.stale = true; return; }
    // A held read already covers this trigger: it runs when editing goes idle.
    if (lane.quiet || lane.held) return;
    lane.quiet = timers.later(() => {
      lane.quiet = null;
      if (disposed || lane.due) return;
      markDue(lane);
    }, followQuietMs(lane.lastMs));
  }
  const scheduleAll = () => { for (const lane of order) schedule(lane); };

  // The poll, the focus / visibility listeners and the on-screen observer exist only while the board follows
  // something: a board that follows nothing adds no window listener (each one counts against the listeners-per-board
  // budget).
  let listening = false;
  function listen(on) {
    if (on === listening) return;
    listening = on;
    const method = on ? "addEventListener" : "removeEventListener";
    win?.[method]?.("focus", onFocus);
    doc?.[method]?.("visibilitychange", onVisible);
    offEditing();
    offEditing = on ? watchEditing(doc, onEditing) : () => {};
    try { io?.disconnect?.(); } catch { /* gone */ }
    io = null;
    seen = null;
    const IO = win?.IntersectionObserver || globalThis.IntersectionObserver;
    if (!on || typeof IO !== "function" || !root) return;
    try {
      io = new IO((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry || disposed) return;
        seen = Boolean(entry.isIntersecting);
        if (seen) for (const lane of order) if (lane.stale) schedule(lane);
      });
      io.observe(root);
    } catch { io = null; }
  }

  function armPoll() {
    poll?.();
    poll = null;
    const on = order.some(readable) && !disposed;
    listen(on);
    if (!on) return;
    poll = timers.later(() => {
      poll = null;
      scheduleAll();
      armPoll();
    }, FOLLOW_POLL_MS);
  }

  // One owner's pointer. Returns true when its source changed (a new key, or it became readable or not).
  function adoptLane(lane, owner) {
    const wasReadable = readable(lane);
    lane.name = owner?.name || "";
    lane.over = owner?.over === true;
    lane.dup = owner?.dup || null;
    const next = owner?.pointer || null;
    const nextKey = owner?.key || "";
    if (nextKey === lane.key && wasReadable === readable({ ...lane, pointer: next })) {
      // Same source, other options (the whole tree): a new name and a read, but the gone counts carry on.
      const reshaped = (lane.pointer?.tree === true) !== (next?.tree === true);
      lane.pointer = next;
      if (reshaped) {
        lane.label = describe(lane);
        schedule(lane);
      }
      return false;
    }
    try { lane.unwatch(); } catch { /* watch already gone */ }
    lane.unwatch = () => {};
    // A new source starts at the plain quiet period: the old one's cost and its armed period are not its own.
    lane.quiet?.();
    lane.quiet = null;
    lane.lastMs = 0;
    lane.lastStart = -Infinity;
    lane.known = false;
    unhold(lane);
    lane.pointer = next;
    lane.key = nextKey;
    lane.read = null;
    lane.allowance = ARRIVALS_CAP;
    lane.before = followedUids(board(), nextKey);
    lane.absent = new Map();
    lane.status = next ? "reading" : "idle";
    lane.reason = "";
    lane.label = next ? describe(lane) : "";
    if (readable(lane)) {
      const kind = followKind(next.kind);
      try { lane.unwatch = kind?.watch?.(next, host, () => schedule(lane), { doc }) || (() => {}); } catch { lane.unwatch = () => {}; }
      schedule(lane);
    }
    return true;
  }

  function dropLane(lane) {
    try { lane.unwatch(); } catch { /* watch already gone */ }
    lane.unwatch = () => {};
    lane.quiet?.();
    lane.quiet = null;
    lane.due = false;
    unhold(lane);
  }

  // The board's and the sections' pointers are the only source of truth: Follow, Stop and an undo all arrive as a
  // board change.
  function adopt() {
    const was = lanes.get(boardUid)?.pointer?.kind || "";
    const { owners } = followOwnersOf(board());
    const next = new Map();
    let changed = false;
    for (const owner of owners) {
      let lane = lanes.get(owner.uid);
      if (!lane) { lane = newLane(owner.uid); changed = true; }
      next.set(owner.uid, lane);
    }
    for (const [uid, lane] of lanes) if (!next.has(uid)) { dropLane(lane); changed = true; }
    lanes = next;
    order = owners.map((owner) => lanes.get(owner.uid));
    for (const owner of owners) if (adoptLane(lanes.get(owner.uid), owner)) changed = true;
    if (!changed) return false;
    if (!order.length && open) close();
    armPoll();
    const kind = lanes.get(boardUid)?.pointer?.kind || "";
    if (kind !== was) {
      try { onSource?.(kind, was); } catch { /* the listener's own problem */ }
    }
    return true;
  }

  const isInbox = (lane) => !lane?.section && lane?.pointer?.kind === INBOX_KIND;
  // The rows a lane offers: every pending row, or for the board's Inbox the Arrivals strip.
  const strip = (lane) => (isInbox(lane)
    ? arrivalsView(lane.pending, { allowance: lane.allowance, placed: visitPlaced(board(), lane.key, lane.before) })
    : { rows: lane?.pending || [], waiting: 0 });

  // ---- placing ----
  const entryOf = (row) => ({
    uid: row.uid,
    kind: row.kind,
    ...(row.title ? { title: row.title } : {}),
    // PXD-14: the heading a row sits under, so a placed card knows its section.
    ...(row.heading ? { heading: row.heading, ...(row.kind === "heading" ? { text: row.text } : { headingText: row.headingText }) } : {}),
  });
  // One place at a time: a second click while the first is still writing does nothing.
  function place(rows, lane) {
    if (!rows.length || placing) return Promise.resolve(null);
    placing = true;
    paintPanel();
    const entries = rows.map(entryOf);
    const opts = lane?.section ? { owner: lane.uid } : lane?.pointer?.kind === "headings" ? { order: lane.read?.heads } : undefined;
    return Promise.resolve(session.placeFollowed?.(entries, opts)).then((res) => {
      if (disposed || !res) return res;
      if (res.batches > 1) toast?.(`Placed ${res.placed} cards in ${res.batches} batches of up to ${SPREAD_CAP}. Each Cmd+Z takes back one batch.`);
      if (res.uids?.length) onPlaced?.(res.uids);
      return res;
    }).catch(() => null).finally(() => {
      placing = false;
      if (!disposed) paintPanel();
    });
  }

  // ---- paint ----
  function counts() {
    const out = { newCount: 0, leftCount: 0, baseline: false };
    for (const lane of order) {
      const c = sinceVisit({ pending: lane.pending, left: lane.diff.left }, { since, leftBefore: lane.leftBefore });
      out.newCount += c.newCount;
      out.leftCount += c.leftCount;
      out.baseline = out.baseline || c.baseline;
    }
    return out;
  }

  function paintPill() {
    if (!order.length) { btn?.remove(); btn = null; return; }
    if (!btn) {
      btn = el("button", "pxd-follow pxd-chrome", root);
      btn.type = "button";
      shield(btn);
      btn.addEventListener("click", (event) => { event.stopPropagation(); toggle(); });
    }
    const c = counts();
    const n = waiting();
    btn.textContent = order.length === 1 && isInbox(order[0]) ? arrivalsPill(n) : followPill(n);
    btn.classList.toggle("pxd-follow--new", c.newCount > 0 || c.leftCount > 0);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const head = trayHeadline(c);
    const from = order.length === 1 ? order[0].label || "the source" : `${order.length} sources`;
    btn.setAttribute("aria-label", `${n} waiting from ${from}${head ? `. ${head}` : ""}`);
  }

  // A ref card's own title is empty: its label is the first line of the block it shows.
  const cardTitle = (uid) => {
    const item = board()?.items.get(uid);
    if (!item) return "Card";
    const label = itemLabel(item, (id) => host?.blockString?.(id));
    return plainText(label || item.string || "", 80) || "Card";
  };
  const rowText = (row) => (row.kind === "page" ? row.title : row.text || "(empty block)");

  function rowEl(list, row, lane) {
    const node = el("div", "pxd-follow__row", list);
    node.draggable = true;
    node.setAttribute("draggable", "true");
    node.dataset.uid = row.uid;
    if (row.depth > 1) node.style.paddingLeft = `${6 + (row.depth - 1) * 12}px`;
    const text = el("div", "pxd-follow__text", node);
    if (row.fresh) el("span", "pxd-follow__new", text, "new");
    el("span", "", text, rowText(row));
    if (row.crumb) el("div", "pxd-follow__crumb", node, row.crumb);
    const acts = el("div", "pxd-follow__acts", node);
    button(acts, "pxd-follow__place", "Place", () => { void place([row], lane); });
    button(acts, "pxd-follow__skip", "Don't bring back", () => { void (lane.section ? session.dontBringBack?.([row.uid], lane.uid) : session.dontBringBack?.([row.uid])); });
    shield(node);
    node.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      const string = followCardString(row);
      try {
        // The row names its board, source and owner: dropped on any other board it is a plain ref card.
        event.dataTransfer?.setData?.(FOLLOW_MIME, JSON.stringify({ ...entryOf(row), board: boardUid, src: lane.key, ...(lane.section ? { owner: lane.uid } : {}) }));
        event.dataTransfer?.setData?.(CARD_MIME, string);
        event.dataTransfer?.setData?.("text/plain", string);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* the drag still leaves the source alone */ }
    });
  }

  // PXD-13: the same item waiting in an earlier owner's source: shown, not placeable here.
  function hintEl(list, row) {
    const node = el("div", "pxd-follow__row pxd-follow__row--hint", list);
    node.dataset.uid = row.uid;
    el("div", "pxd-follow__text", node, rowText(row));
    // On its own line: a long title ellipsizes and would hide it.
    el("div", "pxd-follow__also", node, `Also in ${row.also}`);
    shield(node);
  }

  function noteOf(lane) {
    if (lane.over) return `Not read: over the limit of ${FOLLOW_SECTION_CAP}.`;
    if (lane.dup) return `Not read: ${lane.dup === BOARD_OWNER_NAME ? "the board" : lane.dup} follows this source already.`;
    if (lane.status === "reading" && !lane.read) return "Reading the source…";
    if (lane.status === "error") return textMissing(lane) ? REASONS.missingText : REASONS[lane.reason] || "Could not read the source. The last list stays.";
    if (lane.read && !lane.read.complete) return "Only part of the source was read, so nothing is marked as left.";
    if (lane.read?.deeper) return `Blocks more than ${FOLLOW_TREE_DEPTH} levels down are not listed. Cards placed from there still count as in the source.`;
    return "";
  }

  function paintLane(parent, lane, grouped) {
    if (grouped) {
      const head = el("div", "pxd-follow__owner-head", parent);
      el("div", "pxd-follow__owner-title", head, lane.section ? lane.name : "This board");
      if (lane.label) el("div", "pxd-follow__owner-source", head, lane.label);
    }
    const note = noteOf(lane);
    if (note) el("div", "pxd-follow__note", parent, note);
    if (!readable(lane)) return;
    const heads = lane.pointer.kind === "headings";
    if (heads) {
      el("div", "pxd-follow__note", parent, headingsNote);
      if (lane.read?.ok && !lane.read.items.some((row) => row.kind === "heading")) el("div", "pxd-follow__note", parent, headingsEmpty);
    }
    const inbox = isInbox(lane);
    const shown = strip(lane);
    const bar = el("div", "pxd-follow__bar", parent);
    if (inbox) {
      el("span", "pxd-follow__arrivals", bar, "Arrivals");
      el("span", "pxd-follow__count", bar, `${arrivalsLine(shown)} · ${lane.diff.placed} on the board`);
    } else el("span", "pxd-follow__count", bar, `${lane.pending.length} waiting · ${lane.diff.placed} on the board`);
    const all = button(bar, "pxd-follow__all", shown.rows.length > SPREAD_CAP ? `Place all (batches of ${SPREAD_CAP})` : "Place all", () => { void place(shown.rows.slice(), lane); });
    all.disabled = shown.rows.length === 0 || placing;
    const list = el("div", "pxd-follow__list", parent);
    if (!lane.pending.length && !lane.hints.length) el("div", "pxd-follow__empty", list, lane.read ? (inbox ? "No daily-note block waits." : "Everything in the source is on the board.") : "");
    if (heads) groupRows(list, lane);
    else for (const row of shown.rows) rowEl(list, row, lane);
    if (shown.waiting > 0) {
      const more = el("div", "pxd-follow__more", list);
      el("span", "pxd-follow__count", more, `${shown.waiting} more wait`);
      const n = Math.min(ARRIVALS_CAP, shown.waiting);
      button(more, "pxd-follow__show-more", `Show ${n} more`, () => { lane.allowance += ARRIVALS_CAP; paintPanel(); });
    }
    for (const row of lane.hints) hintEl(list, row);
    if (lane.diff.left.length) {
      el("div", "pxd-follow__section", parent, `Left the source (${lane.diff.left.length})`);
      const gone = el("div", "pxd-follow__list pxd-follow__list--left", parent);
      for (const uid of lane.diff.left) {
        const node = el("div", "pxd-follow__row pxd-follow__row--left", gone);
        node.dataset.uid = uid;
        el("div", "pxd-follow__text", node, cardTitle(uid));
        const acts = el("div", "pxd-follow__acts", node);
        button(acts, "pxd-follow__show", "Show", () => onShowCard?.(uid));
        button(acts, "pxd-follow__dismiss", "Dismiss", () => { void session.dismissLeft?.([uid]); });
        button(acts, "pxd-follow__delete", "Delete", () => { void session.deleteItems?.([uid]); });
        shield(node);
      }
    }
    if (!lane.section && moved.length) {
      el("div", "pxd-follow__section", parent, `Moved (${moved.length})`);
      const moves = el("div", "pxd-follow__list pxd-follow__list--left", parent);
      for (const m of moved) {
        const node = el("div", "pxd-follow__row pxd-follow__row--left", moves);
        node.dataset.uid = m.uid;
        el("div", "pxd-follow__text", node, cardTitle(m.uid));
        el("div", "pxd-follow__crumb", node, `Moved to ${m.toText || "another heading"}`);
        const acts = el("div", "pxd-follow__acts", node);
        button(acts, "pxd-follow__show", "Show", () => onShowCard?.(m.uid));
        button(acts, "pxd-follow__dismiss", "Dismiss", () => { void session.dismissMoved?.({ [m.uid]: m.to }); });
        shield(node);
      }
    }
  }

  // PXD-14: pending rows under a header per heading, in source order. A heading already on the board has a header
  // only while it has blocks waiting.
  function groupRows(list, lane) {
    const groups = new Map();
    for (const row of lane.pending) {
      const head = row.kind === "heading" ? row.uid : row.heading;
      if (!head) continue;
      if (!groups.has(head)) groups.set(head, { head, text: "", row: null, blocks: [] });
      const g = groups.get(head);
      if (row.kind === "heading") { g.row = row; g.text = row.text; } else {
        g.blocks.push(row);
        if (!g.text) g.text = row.headingText || "";
      }
    }
    for (const g of groups.values()) {
      const bar = el("div", "pxd-follow__group", list);
      el("span", "pxd-follow__text", bar, g.text || "(empty heading)");
      const acts = el("div", "pxd-follow__acts", bar);
      button(acts, "pxd-follow__place", "Place", () => { void place(g.row ? [g.row, ...g.blocks] : g.blocks, lane); });
      if (g.row) button(acts, "pxd-follow__skip", "Don't bring back", () => { void session.dontBringBack?.([g.head]); });
      shield(bar);
      for (const row of g.blocks) rowEl(list, row, lane);
    }
  }

  // A board that follows only its own source looks as it did before sections could follow one.
  // Every read and every place paints again, so the drawer keeps its place: the groups scroller stays on the group at
  // its top (rows read or placed above it do not move the view), and the one-source list keeps its scrollTop. Show in
  // tray sets that group as the anchor.
  function scrollAnchor() {
    if (listEl) return { top: Number(listEl.scrollTop) || 0 };
    if (!groupsEl) return null;
    const top = Number(groupsEl.scrollTop) || 0;
    const base = Number(groupsEl.offsetTop) || 0;
    let anchor = { top };
    for (const [owner, group] of groupEls) {
      const at = Number(group.offsetTop);
      if (Number.isFinite(at) && at - base <= top) anchor = { top, owner, delta: top - (at - base) };
    }
    return anchor;
  }

  function restoreScroll(anchor) {
    if (!anchor) return;
    if (listEl) { listEl.scrollTop = anchor.top; return; }
    if (!groupsEl) return;
    const group = anchor.owner ? groupEls.get(anchor.owner) : null;
    const at = Number(group?.offsetTop);
    if (group && Number.isFinite(at)) groupsEl.scrollTop = Math.max(0, at - (Number(groupsEl.offsetTop) || 0) + (anchor.delta || 0));
    else if (group && anchor.show) {
      try { group.scrollIntoView?.({ block: "start" }); } catch { /* no scrolling here */ }
    } else groupsEl.scrollTop = anchor.top || 0;
  }

  function paintPanel() {
    if (!panel) return;
    const anchor = showAnchor || scrollAnchor();
    showAnchor = null;
    panel.replaceChildren?.();
    groupEls = new Map();
    groupsEl = null;
    listEl = null;
    const single = order.length === 1 && !order[0].section ? order[0] : null;
    const head = el("div", "pxd-follow__head", panel);
    el("div", "pxd-follow__title", head, single?.label ? `Following ${single.label}` : "Following");
    button(head, "pxd-follow__close", "×", () => close(), "Close");
    const line = trayHeadline(counts());
    if (line) el("div", "pxd-follow__since", panel, line);
    if (single) {
      paintLane(panel, single, false);
      listEl = panel.querySelector?.(".pxd-follow__list") || null;
    } else {
      groupsEl = el("div", "pxd-follow__owners", panel);
      for (const lane of order) {
        const group = el("div", "pxd-follow__owner", groupsEl);
        group.dataset.owner = lane.uid;
        groupEls.set(lane.uid, group);
        paintLane(group, lane, true);
      }
    }
    restoreScroll(anchor);
  }

  // `owner`: scroll to that section's (or the board's) group.
  function openPanel(owner) {
    if (disposed || !order.length) return;
    if (!open) {
      open = true;
      panel = el("div", "pxd-follow__panel pxd-chrome", root);
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Followed source");
      shield(panel, ["pointerdown", "mousedown", "dblclick", "wheel"]);
    }
    if (typeof owner === "string" && owner && lanes.has(owner)) showAnchor = { top: 0, owner, delta: 0, show: true };
    for (const lane of order) markDue(lane);
    sync();
  }

  function close() {
    if (!open) return;
    open = false;
    panel?.remove();
    panel = null;
    groupEls = new Map();
    groupsEl = null;
    listEl = null;
    paintPill();
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  const onFocus = () => scheduleAll();
  const onVisible = () => { if (doc?.visibilityState !== "hidden") scheduleAll(); };
  const win = doc?.defaultView || null;
  const offChange = session?.on?.("change", (change) => {
    if (disposed) return;
    const dirty = change?.dirty;
    const b = board();
    // A section's pointer lives on the section block: a dirty section (or a gone owner) may change the lanes.
    const owners = Boolean(change?.structural) || Boolean(dirty?.has?.(boardUid))
      || [...(dirty || [])].some((uid) => lanes.has(uid) || b?.items.get(uid)?.type === "section");
    if (owners) { adopt(); autoOpen(); }
    // Stop (or an undo of Follow) clears the left and moved marks of the sources no longer followed.
    if (!order.length) { recompute(); paintPill(); return; }
    const keys = new Set(order.map((lane) => lane.key));
    if (owners || allLeft().some((uid) => dirty?.has?.(uid))) sync();
    else if (dirty && [...dirty].some((uid) => keys.has(b?.items.get(uid)?.src))) sync();
  }) || (() => {});

  // A pointer derived from the board text on an empty board opens the tray once, so the source's items show on open.
  function autoOpen() {
    if (autoOpened || disposed || !lanes.has(boardUid) || open) return;
    const b = board();
    if (b?.followDerived !== true || b.roots.length > 0) return;
    autoOpened = true;
    openPanel();
  }

  adopt();
  sync();
  autoOpen();

  const laneStats = (lane) => ({
    key: lane?.key || "",
    reads: lane?.reads || 0,
    lastMs: lane?.lastMs || 0,
    waitMs: lane?.waitMs || 0,
    quietMs: followQuietMs(lane?.lastMs || 0),
    stale: lane?.stale === true,
    held: lane?.held === true,
  });
  const menuOf = (lane, extra = {}) => ({
    following: Boolean(lane?.pointer),
    kind: lane?.pointer?.kind || "",
    tree: lane?.pointer?.tree === true,
    label: lane?.label || "",
    waiting: lane?.pending.length || 0,
    ...extra,
  });

  return {
    sync,
    refresh: () => scheduleAll(),
    open: openPanel,
    close,
    isOpen: () => open,
    // Placeable rows over every owner, or one owner's.
    rows: (owner) => (owner ? lanes.get(owner)?.pending.slice() || [] : order.flatMap((lane) => lane.pending)),
    hints: (owner) => (owner ? lanes.get(owner)?.hints.slice() || [] : order.flatMap((lane) => lane.hints)),
    left: (owner) => (owner ? lanes.get(owner)?.diff.left.slice() || [] : allLeft()),
    // PXD-18: the board's Arrivals strip ({ rows, waiting }) while it follows its Inbox, else its pending rows.
    arrivals: () => { const v = strip(lanes.get(boardUid)); return { rows: v.rows.slice(), waiting: v.waiting }; },
    moved: () => moved.slice(),
    reads: () => order.reduce((n, lane) => n + lane.reads, 0),
    // Source keys of every owner that is read (a card from any of them is a followed card).
    keys: () => order.filter(readable).map((lane) => lane.key),
    // The F10 probe: the board's source, reads so far, how long the last one took and waited, and the quiet period that
    // sets; PXD-13: the same per owner (lanes), shared passes, sorts painted, and the most reads that ever ran at once.
    stats: () => ({
      ...laneStats(lanes.get(boardUid)),
      moved: moved.length,
      editing: editState(doc),
      lanes: order.map((lane) => ({ owner: lane.uid, ...laneStats(lane), over: lane.over, dup: lane.dup })),
      passes,
      paints,
      maxReads,
    }),
    // The board menu: what Follow shows and offers.
    menuState() {
      const lane = lanes.get(boardUid);
      const textUid = lane ? null : textSourceUid(board()?.string || "");
      return menuOf(lane, { textUid });
    },
    // PXD-13: a section's Follow menu. `capped`: no more sections can follow a source on this board.
    sectionMenuState(uid) {
      const lane = lanes.get(uid);
      return menuOf(lane, { over: lane?.over === true, capped: !lane && followOwnersOf(board()).capped });
    },
    dispose() {
      if (disposed) return;
      // Only a lane that was read knows what had left; closing before the first read keeps the old memory.
      for (const lane of order) if (lane.pointer && lane.read) memory.set(lane.uid, lane.diff.left);
      disposed = true;
      try { offChange(); } catch { /* listener gone */ }
      for (const lane of order) dropLane(lane);
      job?.();
      poll?.();
      listen(false);
      btn?.remove();
      panel?.remove();
      btn = null;
      panel = null;
    },
  };
}
