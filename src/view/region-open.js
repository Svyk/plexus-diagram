// REG-5. Open target, the pending show stash, and the hover popover.

import { placePopover } from "../relchips.js";

const STASH_MS = 8000;
const STOP_TYPES = ["pointerdown", "mousedown", "mouseup", "dblclick"];

// No uid: the main mount, even when a sidebar copy is listed first.
// A uid: the sidebar mount of that board when it has a view.
export function pickCameraMount(rows, boardUid, isSidebar = () => false, current = (row) => row?.current ?? row?.uid) {
  const list = Array.isArray(rows) ? rows : [];
  const side = typeof isSidebar === "function" ? isSidebar : () => false;
  const idOf = typeof current === "function" ? current : (row) => row?.uid;
  if (!boardUid) {
    return list.find((row) => row && !side(row) && row.view)
      || list.find((row) => row && !side(row))
      || list.find((row) => row?.view)
      || list[0]
      || null;
  }
  const hits = list.filter((row) => row && (idOf(row) === boardUid || row.uid === boardUid));
  return hits.find((row) => side(row) && row.view) || hits.find((row) => row.view) || hits[0] || null;
}

export function resolveRegionTarget(hit, outline) {
  if (hit?.boardUid && hit.pageUid && hit.cardUid) {
    return { kind: "board", boardUid: hit.boardUid, pageUid: hit.pageUid, cardUid: hit.cardUid };
  }
  return { kind: "outline", blockUid: outline?.blockUid, pageUid: outline?.pageUid };
}

export function createShowStash(now = () => Date.now()) {
  const clock = typeof now === "function" ? now : () => Date.now();
  let entry = null;
  const live = () => {
    if (!entry) return null;
    if (entry.until < clock()) {
      entry = null;
      return null;
    }
    return entry;
  };
  return {
    stash(spec) {
      const uid = spec?.uid;
      if (uid == null || uid === "") return live();
      const t = clock();
      const requested = Number(spec.until);
      const until = Number.isFinite(requested) ? Math.max(requested, t + STASH_MS) : t + STASH_MS;
      entry = { uid, until };
      return entry;
    },
    peek(uid) {
      const cur = live();
      if (!cur) return null;
      if (uid == null || uid === "") return cur;
      return cur.uid === uid ? cur : null;
    },
    clear() {
      entry = null;
    },
  };
}

function clientRect(node) {
  const r = node?.getBoundingClientRect?.() || {};
  const left = Number.isFinite(r.left) ? r.left : 0;
  const top = Number.isFinite(r.top) ? r.top : 0;
  const width = Number.isFinite(r.width) ? r.width : 0;
  const height = Number.isFinite(r.height) ? r.height : 0;
  return {
    left,
    top,
    right: Number.isFinite(r.right) ? r.right : left + width,
    bottom: Number.isFinite(r.bottom) ? r.bottom : top + height,
  };
}

export function openHoverPopover({ doc, win, anchor, delayMs, build, obstacles, timers } = {}) {
  const document = doc || globalThis.document;
  const view = win || document?.defaultView || globalThis;
  const el = document.createElement("div");
  el.className = "pxd-root pxd-region-pop";
  el.style.position = "fixed";

  const stop = (event) => { event.stopPropagation?.(); };
  for (const type of STOP_TYPES) el.addEventListener(type, stop);

  let closed = false;
  let shown = false;
  let cancelTimer = null;
  const offs = [];
  const on = (target, type, fn, opts) => {
    target?.addEventListener?.(type, fn, opts);
    offs.push(() => target.removeEventListener?.(type, fn, opts));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    cancelTimer?.();
    cancelTimer = null;
    for (const type of STOP_TYPES) el.removeEventListener(type, stop);
    for (const off of offs.splice(0)) off();
    el.remove?.();
  };
  const place = () => {
    if (closed) return;
    if (anchor && anchor.isConnected === false) {
      close();
      return;
    }
    const spec = {
      anchor: clientRect(anchor),
      size: {
        w: Number(el.offsetWidth) || Number(el.clientWidth) || 240,
        h: Number(el.offsetHeight) || Number(el.clientHeight) || 120,
      },
      viewport: {
        left: 0,
        top: 0,
        right: Number(view?.innerWidth) || 1024,
        bottom: Number(view?.innerHeight) || 768,
      },
    };
    if (obstacles !== undefined) spec.obstacles = obstacles;
    const at = placePopover(spec);
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
    el.style.maxHeight = at.maxHeight ? `${at.maxHeight}px` : "";
    el.style.overflowY = at.scroll ? "auto" : "";
  };
  const show = () => {
    cancelTimer = null;
    if (closed || shown) return;
    shown = true;
    if (anchor && anchor.isConnected === false) {
      close();
      return;
    }
    document.body?.append(el);
    build?.(el);
    if (closed) return;
    place();
    if (closed) return;
    on(document, "keydown", (event) => {
      if (event.key === "Escape" || event.key === "Esc") close();
    }, true);
    on(document, "pointerdown", (event) => {
      if (!el.contains?.(event.target)) close();
    }, true);
    const again = () => { if (!closed) place(); };
    on(view, "scroll", again, true);
    on(document, "scroll", again, true);
    on(view, "resize", again);
  };

  const wait = Math.max(0, Number(delayMs) || 0);
  if (typeof timers?.later === "function") cancelTimer = timers.later(show, wait);
  else {
    const set = view?.setTimeout?.bind(view) || globalThis.setTimeout.bind(globalThis);
    const clear = view?.clearTimeout?.bind(view) || globalThis.clearTimeout.bind(globalThis);
    const id = set(show, wait);
    cancelTimer = () => clear(id);
  }
  return { close, el };
}
