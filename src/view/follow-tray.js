// PXD-9 place tray: what the followed source holds that the board does not show yet. The board never writes a card by
// itself; rows wait here until the user places them (drag one onto the board, Place, or Place all into a column right
// of the cards). Reads run at idle FOLLOW_QUIET_MS after a trigger: the source's watch (block kinds), the tray opening,
// the window coming back, a slow poll. A board change only sorts the last read again. Cards that left the source get a
// mark (onLeft) after two complete reads without them; a partial or failed read never adds one.

import { CARD_MIME } from "../model/drop.js";
import {
  FOLLOW_MIME,
  FOLLOW_POLL_MS,
  FOLLOW_QUIET_MS,
  absentStep,
  createLeftMemory,
  followCardString,
  followDiff,
  followPill,
  leftUnsettled,
  readFollow,
  sinceVisit,
  sourceKey,
  textSourceUid,
  trayHeadline,
} from "../model/follow.js";
import { itemLabel, plainText } from "../model/schema.js";
import { followKind } from "../host/follow-sources.js";
import { SPREAD_CAP } from "../session-clip.js";

const REASONS = {
  missing: "The source block is gone.",
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
  onShowCard,
  onPlaced,
  toast,
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
  let reads = 0;
  let open = false;
  let disposed = false;
  let btn = null;
  let panel = null;
  let unwatch = () => {};
  let quiet = null;
  let job = null;
  let poll = null;
  let inFlight = false;
  let again = false;

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
    inBoard: () => session.followExclude?.() || new Set([boardUid]),
    tick: () => new Promise((resolve) => timers.idle(resolve)),
  });

  const describe = () => {
    const kind = pointer ? followKind(pointer.kind) : null;
    try { return kind?.describe?.(pointer, host) || kind?.title || "a source"; } catch { return kind?.title || "a source"; }
  };

  function recompute() {
    diff = pointer ? followDiff(read, board(), { key, skip: pointer.skip, absent, since }) : { pending: [], left: [], placed: 0, dismissed: 0 };
    const next = diff.left.slice().sort().join("\n");
    if (next !== leftShown) {
      leftShown = next;
      onLeft?.(new Set(diff.left));
    }
  }

  function sync() {
    if (disposed) return;
    recompute();
    paintPill();
    paintPanel();
  }

  // ---- reads ----
  function runRead() {
    job = null;
    if (disposed || !pointer) return;
    if (inFlight) { again = true; return; }
    const kind = followKind(pointer.kind);
    if (!kind) { status = "error"; reason = "unknown"; sync(); return; }
    const mine = key;
    inFlight = true;
    status = read ? status : "reading";
    if (!read) paintPanel();
    Promise.resolve().then(() => kind.read(pointer, ctx())).catch(() => ({ ok: false, reason: "error" })).then((res) => {
      inFlight = false;
      if (disposed || mine !== key) return;
      reads += 1;
      if (res?.ok) {
        read = res;
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
      if (again) { again = false; schedule(); } else if (res?.ok && leftUnsettled(absent)) schedule();
    });
  }

  function schedule() {
    if (disposed || !pointer || quiet) return;
    quiet = timers.later(() => {
      quiet = null;
      if (disposed || job) return;
      job = timers.bgIdle(runRead, "follow");
    }, FOLLOW_QUIET_MS);
  }

  const readSoon = () => {
    if (disposed || !pointer || job) return;
    job = timers.bgIdle(runRead, "follow");
  };

  // The poll and the focus / visibility listeners exist only while the board follows something: a board that follows
  // nothing adds no window listener (each one counts against the listeners-per-board budget).
  let listening = false;
  function listen(on) {
    if (on === listening) return;
    listening = on;
    const method = on ? "addEventListener" : "removeEventListener";
    win?.[method]?.("focus", onFocus);
    doc?.[method]?.("visibilitychange", onVisible);
  }

  function armPoll() {
    poll?.();
    poll = null;
    listen(Boolean(pointer) && !disposed);
    if (!pointer || disposed) return;
    poll = timers.later(() => {
      poll = null;
      if (doc?.visibilityState !== "hidden") schedule();
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
    pointer = next;
    key = nextKey;
    read = null;
    absent = new Map();
    status = pointer ? "reading" : "idle";
    reason = "";
    label = pointer ? describe() : "";
    if (pointer) {
      const kind = followKind(pointer.kind);
      try { unwatch = kind?.watch?.(pointer, host, () => schedule()) || (() => {}); } catch { unwatch = () => {}; }
      schedule();
    } else if (open) close();
    armPoll();
    return true;
  }

  // ---- placing ----
  const entryOf = (row) => ({ uid: row.uid, kind: row.kind, ...(row.title ? { title: row.title } : {}) });
  function place(rows) {
    if (!rows.length) return Promise.resolve(null);
    return Promise.resolve(session.placeFollowed?.(rows.map(entryOf))).then((res) => {
      if (disposed || !res) return res;
      if (res.batches > 1) toast?.(`Placed ${res.placed} cards in ${res.batches} batches of up to ${SPREAD_CAP}. Each Cmd+Z takes back one batch.`);
      if (res.uids?.length) onPlaced?.(res.uids);
      return res;
    }).catch(() => null);
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
    btn.textContent = followPill(diff.pending.length);
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
        event.dataTransfer?.setData?.(FOLLOW_MIME, JSON.stringify(entryOf(row)));
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
    else if (status === "error") note = REASONS[reason] || "Could not read the source. The last list stays.";
    else if (read && !read.complete) note = "Only part of the source was read, so nothing is marked as left.";
    if (note) el("div", "pxd-follow__note", panel, note);
    const bar = el("div", "pxd-follow__bar", panel);
    el("span", "pxd-follow__count", bar, `${diff.pending.length} waiting · ${diff.placed} on the board`);
    const all = button(bar, "pxd-follow__all", diff.pending.length > SPREAD_CAP ? `Place all (batches of ${SPREAD_CAP})` : "Place all", () => { void place(diff.pending.slice()); });
    all.disabled = diff.pending.length === 0;
    const list = el("div", "pxd-follow__list", panel);
    if (!diff.pending.length) el("div", "pxd-follow__empty", list, read ? "Everything in the source is on the board." : "");
    for (const row of diff.pending) rowEl(list, row);
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
    if (dirty?.has?.(boardUid) || change?.structural) adopt();
    if (!pointer) { paintPill(); return; }
    if (change?.structural || dirty?.has?.(boardUid) || diff.left.some((uid) => dirty?.has?.(uid))) sync();
    else if (dirty && [...dirty].some((uid) => board()?.items.get(uid)?.src === key)) sync();
  }) || (() => {});

  adopt();
  sync();

  return {
    sync,
    refresh: () => schedule(),
    open: openPanel,
    close,
    isOpen: () => open,
    rows: () => diff.pending.slice(),
    left: () => diff.left.slice(),
    reads: () => reads,
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
      listen(false);
      btn?.remove();
      panel?.remove();
      btn = null;
      panel = null;
    },
  };
}
