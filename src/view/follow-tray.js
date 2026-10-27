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
// PXD-18: following the board's Inbox, the rows are an Arrivals strip of at most ARRIVALS_CAP per visit (this tray's
// life); the rest say how many wait, and "Show more" makes room for another ARRIVALS_CAP.

import { CARD_MIME } from "../model/drop.js";
import {
  ARRIVALS_CAP,
  FOLLOW_MIME,
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
  followedUids,
  followCardString,
  followDiff,
  followIndex,
  followPill,
  followQuietMs,
  leftUnsettled,
  readFollow,
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
  const leftBefore = boardUid ? memory.get(boardUid) : null;
  let pointer = null;
  let key = "";
  let read = null;
  let status = "idle";
  let reason = "";
  let absent = new Map();
  let diff = { pending: [], left: [], placed: 0, dismissed: 0 };
  let label = "";
  let leftShown = "";
  let moved = [];
  let movedShown = "";
  let reads = 0;
  let open = false;
  let autoOpened = false;
  let disposed = false;
  let btn = null;
  let panel = null;
  let unwatch = () => {};
  let quiet = null;
  let job = null;
  let poll = null;
  let inFlight = false;
  let again = false;
  let placing = false;
  // PXD-18: this visit's Arrivals room, and the source's cards already on the board when the visit (or the source)
  // began: every other card of the source counts as placed this visit, however it was made.
  let allowance = ARRIVALS_CAP;
  let before = new Set();
  // How long the last read took: the next quiet period is ten times that (at least FOLLOW_QUIET_MS).
  let lastMs = 0;
  // How long the last read waited for the shared background budget after its quiet period.
  let waitMs = 0;
  let queuedAt = 0;
  // PXD-20: a read is owed but waits for editing to go idle (held), or for the slow-read floor (floorWait).
  let held = false;
  let floorWait = null;
  let offEditing = () => {};
  // When this source's last read started, and whether it has one (an unknown cost counts as slow).
  let lastStart = -Infinity;
  let known = false;
  // A trigger came while the board was off screen or the tab hidden: read when it shows again.
  let stale = false;
  // The root's IntersectionObserver: null until it reports.
  let seen = null;
  let io = null;

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

  const ctx = () => ({
    host,
    boardUid,
    boardTitle: () => board()?.title || "",
    inBoard: () => session.followExclude?.() || new Set([boardUid]),
    tick: () => new Promise((resolve) => timers.idle(resolve)),
    followed: () => followIndex(board(), key).followed.map((card) => card.target?.uid).filter(Boolean),
  });

  // A pointer read from the board text (never stored) at a block that is not there.
  const textMissing = () => reason === "missing" && pointer?.kind === "block" && board()?.followDerived === true;
  const describe = () => {
    const kind = pointer ? followKind(pointer.kind) : null;
    if (textMissing()) return "a block that does not exist";
    try { return kind?.describe?.(pointer, host) || kind?.title || "a source"; } catch { return kind?.title || "a source"; }
  };

  function recompute() {
    diff = pointer ? followDiff(read, board(), { key, skip: pointer.skip, absent, since }) : { pending: [], left: [], placed: 0, dismissed: 0 };
    const next = diff.left.slice().sort().join("\n");
    if (next !== leftShown) {
      leftShown = next;
      onLeft?.(new Set(diff.left));
    }
    moved = pointer?.kind === "headings" ? movedCards(read, board(), key) : [];
    const mark = moved.map((m) => `${m.uid}>${m.to}`).join("\n");
    if (mark !== movedShown) {
      movedShown = mark;
      onMoved?.(new Map(moved.map((m) => [m.uid, m.toText])));
    }
  }

  function sync() {
    if (disposed) return;
    recompute();
    paintPill();
    paintPanel();
  }

  // ---- reads ----
  const showing = () => doc?.visibilityState !== "hidden" && seen !== false;

  function gate() {
    const edit = editState(doc);
    const cost = known ? lastMs : Infinity;
    if (edit.typing && cost >= FOLLOW_TYPING_MS) return "typing";
    if (edit.busy && cost > FOLLOW_SLOW_MS && now() - lastStart < FOLLOW_POLL_MS) return "floor";
    return "";
  }

  function hold(why) {
    held = true;
    if (why !== "floor" || floorWait) return;
    floorWait = timers.later(() => {
      floorWait = null;
      if (held) readSoon();
    }, Math.max(0, lastStart + FOLLOW_POLL_MS - now()));
  }

  function unhold() {
    held = false;
    floorWait?.();
    floorWait = null;
  }

  // Editing went idle (or may have): a held read runs now. When the user's typing stops (a pause, or leaving the
  // editors), a quiet period stretched by a slow read ends early. The floor still holds until the saves stop as well,
  // so typing in bursts with short pauses does not read a slow source at every pause. Save signals that stop on their
  // own (another extension's writes) do not end the quiet period.
  const onEditing = (why) => {
    if (disposed) return;
    const cut = why === "typing" && Boolean(quiet) && !job;
    if (cut) {
      quiet();
      quiet = null;
    }
    if (cut || (held && !gate())) readSoon();
  };

  function runRead() {
    job = null;
    if (disposed || !pointer) return;
    // Off screen: the held read becomes a stale one, read when the board shows again.
    if (!showing()) { stale = true; unhold(); return; }
    if (inFlight) { again = true; return; }
    const kind = followKind(pointer.kind);
    if (!kind) { status = "error"; reason = "unknown"; sync(); return; }
    const why = gate();
    if (why) { hold(why); return; }
    unhold();
    const mine = key;
    inFlight = true;
    stale = false;
    waitMs = Math.max(0, now() - queuedAt);
    status = read ? status : "reading";
    if (!read) paintPanel();
    const started = now();
    Promise.resolve().then(() => kind.read(pointer, ctx())).catch(() => ({ ok: false, reason: "error" })).then((res) => {
      inFlight = false;
      if (disposed) return;
      // The source changed during the read: its result is dropped, and a read the new source asked for runs now.
      if (mine !== key) {
        if (again) { again = false; schedule(); }
        return;
      }
      lastMs = Math.max(0, now() - started);
      lastStart = started;
      known = true;
      reads += 1;
      if (res?.ok) {
        read = res;
        if (pointer.tree && typeof onParents === "function") {
          const parents = new Map();
          for (const item of res.items || []) if (item?.parent && item.uid) parents.set(item.uid, item.parent);
          try { onParents(parents); } catch { /* view */ }
        }
        absent = absentStep(absent, res, board(), key);
        status = "ok";
        reason = "";
      } else {
        // The last good read stays: a failed read neither empties the tray nor marks a card.
        status = "error";
        reason = res?.reason || "error";
      }
      label = describe();
      sync();
      // A card with one miss gets its confirming read, but only after a complete read: a partial read adds no miss,
      // so asking again would read the source every quiet period for as long as it stays partial.
      if (again) { again = false; schedule(); } else if (res?.ok && res.complete && leftUnsettled(absent)) schedule();
    });
  }

  // Every trigger comes here. While a quiet period runs, more triggers join it: one read at its end.
  function schedule() {
    if (disposed || !pointer) return;
    if (!showing()) { stale = true; return; }
    // A held read already covers this trigger: it runs when editing goes idle.
    if (quiet || held) return;
    quiet = timers.later(() => {
      quiet = null;
      if (disposed || job) return;
      queuedAt = now();
      job = timers.bgIdle(runRead, "follow");
    }, followQuietMs(lastMs));
  }

  const readSoon = () => {
    if (disposed || !pointer || job) return;
    queuedAt = now();
    job = timers.bgIdle(runRead, "follow");
  };

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
        if (seen && stale) schedule();
      });
      io.observe(root);
    } catch { io = null; }
  }

  function armPoll() {
    poll?.();
    poll = null;
    listen(Boolean(pointer) && !disposed);
    if (!pointer || disposed) return;
    poll = timers.later(() => {
      poll = null;
      schedule();
      armPoll();
    }, FOLLOW_POLL_MS);
  }

  // The board's pointer is the only source of truth: Follow, Stop and an undo all arrive as a board change.
  function adopt() {
    const next = readFollow(board()?.plexus);
    const nextKey = sourceKey(next);
    if (nextKey === key) {
      // Same source, other options (the whole tree): a new name and a read, but the gone counts carry on.
      const reshaped = (pointer?.tree === true) !== (next?.tree === true);
      pointer = next;
      if (reshaped) {
        label = describe();
        schedule();
      }
      return reshaped;
    }
    try { unwatch(); } catch { /* watch already gone */ }
    unwatch = () => {};
    // A new source starts at the plain quiet period: the old one's cost and its armed period are not its own.
    quiet?.();
    quiet = null;
    lastMs = 0;
    lastStart = -Infinity;
    known = false;
    unhold();
    const was = pointer?.kind || "";
    pointer = next;
    key = nextKey;
    read = null;
    allowance = ARRIVALS_CAP;
    before = followedUids(board(), nextKey);
    absent = new Map();
    status = pointer ? "reading" : "idle";
    reason = "";
    label = pointer ? describe() : "";
    if (pointer) {
      const kind = followKind(pointer.kind);
      try { unwatch = kind?.watch?.(pointer, host, () => schedule(), { doc }) || (() => {}); } catch { unwatch = () => {}; }
      schedule();
    } else if (open) close();
    armPoll();
    try { onSource?.(pointer?.kind || "", was); } catch { /* the listener's own problem */ }
    return true;
  }

  const isInbox = () => pointer?.kind === INBOX_KIND;
  // The rows the tray offers: every pending row, or for the Inbox the Arrivals strip.
  const strip = () => (isInbox() ? arrivalsView(diff.pending, { allowance, placed: visitPlaced(board(), key, before) }) : { rows: diff.pending, waiting: 0 });

  // ---- placing ----
  const entryOf = (row) => ({
    uid: row.uid,
    kind: row.kind,
    ...(row.title ? { title: row.title } : {}),
    // PXD-14: the heading a row sits under, so a placed card knows its section.
    ...(row.heading ? { heading: row.heading, ...(row.kind === "heading" ? { text: row.text } : { headingText: row.headingText }) } : {}),
  });
  // One place at a time: a second click while the first is still writing does nothing.
  function place(rows) {
    if (!rows.length || placing) return Promise.resolve(null);
    placing = true;
    paintPanel();
    const opts = pointer?.kind === "headings" ? { order: read?.heads } : undefined;
    return Promise.resolve(session.placeFollowed?.(rows.map(entryOf), opts)).then((res) => {
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
  function paintPill() {
    if (!pointer) { btn?.remove(); btn = null; return; }
    if (!btn) {
      btn = el("button", "pxd-follow pxd-chrome", root);
      btn.type = "button";
      shield(btn);
      btn.addEventListener("click", (event) => { event.stopPropagation(); toggle(); });
    }
    const counts = sinceVisit(diff, { since, leftBefore });
    btn.textContent = isInbox() ? arrivalsPill(diff.pending.length) : followPill(diff.pending.length);
    btn.classList.toggle("pxd-follow--new", counts.newCount > 0 || counts.leftCount > 0);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    const head = trayHeadline(counts);
    btn.setAttribute("aria-label", `${diff.pending.length} waiting from ${label || "the source"}${head ? `. ${head}` : ""}`);
  }

  // A ref card's own title is empty: its label is the first line of the block it shows.
  const cardTitle = (uid) => {
    const item = board()?.items.get(uid);
    if (!item) return "Card";
    const label = itemLabel(item, (id) => host?.blockString?.(id));
    return plainText(label || item.string || "", 80) || "Card";
  };

  function rowEl(list, row) {
    const node = el("div", "pxd-follow__row", list);
    node.draggable = true;
    node.setAttribute("draggable", "true");
    node.dataset.uid = row.uid;
    if (row.depth > 1) node.style.paddingLeft = `${6 + (row.depth - 1) * 12}px`;
    const text = el("div", "pxd-follow__text", node);
    if (row.fresh) el("span", "pxd-follow__new", text, "new");
    el("span", "", text, row.kind === "page" ? row.title : row.text || "(empty block)");
    if (row.crumb) el("div", "pxd-follow__crumb", node, row.crumb);
    const acts = el("div", "pxd-follow__acts", node);
    button(acts, "pxd-follow__place", "Place", () => { void place([row]); });
    button(acts, "pxd-follow__skip", "Don't bring back", () => { void session.dontBringBack?.([row.uid]); });
    shield(node);
    node.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      const string = followCardString(row);
      try {
        // The row names its board and source: dropped on any other board it is a plain ref card.
        event.dataTransfer?.setData?.(FOLLOW_MIME, JSON.stringify({ ...entryOf(row), board: boardUid, src: key }));
        event.dataTransfer?.setData?.(CARD_MIME, string);
        event.dataTransfer?.setData?.("text/plain", string);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* the drag still leaves the source alone */ }
    });
  }

  function paintPanel() {
    if (!panel) return;
    panel.replaceChildren?.();
    const head = el("div", "pxd-follow__head", panel);
    el("div", "pxd-follow__title", head, label ? `Following ${label}` : "Following");
    button(head, "pxd-follow__close", "×", () => close(), "Close");
    const counts = sinceVisit(diff, { since, leftBefore });
    const line = trayHeadline(counts);
    if (line) el("div", "pxd-follow__since", panel, line);
    let note = "";
    if (status === "reading" && !read) note = "Reading the source…";
    else if (status === "error") note = textMissing() ? REASONS.missingText : REASONS[reason] || "Could not read the source. The last list stays.";
    else if (read && !read.complete) note = "Only part of the source was read, so nothing is marked as left.";
    else if (read?.deeper) note = `Blocks more than ${FOLLOW_TREE_DEPTH} levels down are not listed. Cards placed from there still count as in the source.`;
    if (note) el("div", "pxd-follow__note", panel, note);
    const shown = strip();
    const heads = pointer?.kind === "headings";
    if (heads) {
      el("div", "pxd-follow__note", panel, headingsNote);
      if (read?.ok && !read.items.some((row) => row.kind === "heading")) el("div", "pxd-follow__note", panel, headingsEmpty);
    }
    const bar = el("div", "pxd-follow__bar", panel);
    if (isInbox()) {
      el("span", "pxd-follow__arrivals", bar, "Arrivals");
      el("span", "pxd-follow__count", bar, `${arrivalsLine(shown)} · ${diff.placed} on the board`);
    } else el("span", "pxd-follow__count", bar, `${diff.pending.length} waiting · ${diff.placed} on the board`);
    const all = button(bar, "pxd-follow__all", shown.rows.length > SPREAD_CAP ? `Place all (batches of ${SPREAD_CAP})` : "Place all", () => { void place(shown.rows.slice()); });
    all.disabled = shown.rows.length === 0 || placing;
    const list = el("div", "pxd-follow__list", panel);
    if (!diff.pending.length) el("div", "pxd-follow__empty", list, read ? (isInbox() ? "No daily-note block waits." : "Everything in the source is on the board.") : "");
    if (heads) groupRows(list);
    else for (const row of shown.rows) rowEl(list, row);
    if (shown.waiting > 0) {
      const more = el("div", "pxd-follow__more", list);
      el("span", "pxd-follow__count", more, `${shown.waiting} more wait`);
      const n = Math.min(ARRIVALS_CAP, shown.waiting);
      button(more, "pxd-follow__show-more", `Show ${n} more`, () => { allowance += ARRIVALS_CAP; paintPanel(); });
    }
    if (diff.left.length) {
      el("div", "pxd-follow__section", panel, `Left the source (${diff.left.length})`);
      const gone = el("div", "pxd-follow__list pxd-follow__list--left", panel);
      for (const uid of diff.left) {
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
    if (moved.length) {
      el("div", "pxd-follow__section", panel, `Moved (${moved.length})`);
      const moves = el("div", "pxd-follow__list pxd-follow__list--left", panel);
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
  function groupRows(list) {
    const groups = new Map();
    for (const row of diff.pending) {
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
      button(acts, "pxd-follow__place", "Place", () => { void place(g.row ? [g.row, ...g.blocks] : g.blocks); });
      if (g.row) button(acts, "pxd-follow__skip", "Don't bring back", () => { void session.dontBringBack?.([g.head]); });
      shield(bar);
      for (const row of g.blocks) rowEl(list, row);
    }
  }

  function openPanel() {
    if (disposed || !pointer) return;
    if (!open) {
      open = true;
      panel = el("div", "pxd-follow__panel pxd-chrome", root);
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Followed source");
      shield(panel, ["pointerdown", "mousedown", "dblclick", "wheel"]);
    }
    readSoon();
    sync();
  }

  function close() {
    if (!open) return;
    open = false;
    panel?.remove();
    panel = null;
    paintPill();
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  const onFocus = () => schedule();
  const onVisible = () => { if (doc?.visibilityState !== "hidden") schedule(); };
  const win = doc?.defaultView || null;
  const offChange = session?.on?.("change", (change) => {
    if (disposed) return;
    const dirty = change?.dirty;
    if (dirty?.has?.(boardUid) || change?.structural) { adopt(); autoOpen(); }
    // Stop (or an undo of Follow) clears the left and moved marks of the source the board no longer follows.
    if (!pointer) { recompute(); paintPill(); return; }
    if (change?.structural || dirty?.has?.(boardUid) || diff.left.some((uid) => dirty?.has?.(uid))) sync();
    else if (dirty && [...dirty].some((uid) => board()?.items.get(uid)?.src === key)) sync();
  }) || (() => {});

  // A pointer derived from the board text on an empty board opens the tray once, so the source's items show on open.
  function autoOpen() {
    if (autoOpened || disposed || !pointer || open) return;
    const b = board();
    if (b?.followDerived !== true || b.roots.length > 0) return;
    autoOpened = true;
    openPanel();
  }

  adopt();
  sync();
  autoOpen();

  return {
    sync,
    refresh: () => schedule(),
    open: openPanel,
    close,
    isOpen: () => open,
    rows: () => diff.pending.slice(),
    // PXD-18: the Arrivals strip ({ rows, waiting }) while the board follows its Inbox, else every pending row.
    arrivals: () => { const v = strip(); return { rows: v.rows.slice(), waiting: v.waiting }; },
    left: () => diff.left.slice(),
    moved: () => moved.slice(),
    reads: () => reads,
    // The F10 probe: the source, reads so far, how long the last one took and waited, and the quiet period that sets.
    stats: () => ({ key, moved: moved.length, reads, lastMs, waitMs, quietMs: followQuietMs(lastMs), stale, held, editing: editState(doc) }),
    // The board menu: what Follow shows and offers.
    menuState() {
      const textUid = pointer ? null : textSourceUid(board()?.string || "");
      return {
        following: Boolean(pointer),
        kind: pointer?.kind || "",
        tree: pointer?.tree === true,
        label,
        waiting: diff.pending.length,
        textUid,
      };
    },
    dispose() {
      if (disposed) return;
      // Only a board that was read knows what had left; closing before the first read keeps the old memory.
      if (pointer && boardUid && read) memory.set(boardUid, diff.left);
      disposed = true;
      try { unwatch(); } catch { /* watch already gone */ }
      try { offChange(); } catch { /* listener gone */ }
      quiet?.();
      job?.();
      poll?.();
      unhold();
      listen(false);
      btn?.remove();
      panel?.remove();
      btn = null;
      panel = null;
    },
  };
}
