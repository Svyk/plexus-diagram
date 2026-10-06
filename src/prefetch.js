// FAST-4. One hover warm for a board the cache already knows. Read-only.
// pointerover stands in for pointerenter: the timer starts once per target and a leave clears it.

const DEFAULT_DELAY_MS = 80;
const DEFAULT_LIMIT = 4;
const DEFAULT_WINDOW_MS = 60000;

let current = null;

function dedupe(list) {
  const out = [];
  for (const uid of list || []) {
    const id = String(uid ?? "");
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const HOVER_SEL = ".pxd-cardchip, .pxd-boardchip, .pxd-crumb, .rm-block-ref, .rm-page-ref, [data-link-title], .pxd-item--board";

export function schedulePrefetch(uids, el) {
  current?.schedule(uids, el);
}

export function cancelPrefetch(el) {
  current?.cancel(el);
}

export function createPrefetch({
  doc = globalThis.document,
  cache,
  warm = () => null,
  isWarm = (uid) => Boolean(cache?.blockOf?.(uid)?.[":block/uid"]),
  refBoards = (uid) => cache?.refBoardsOf?.(uid) || [],
  pageBoards = (title) => cache?.pageBoardsOf?.(title) || [],
  delayMs = DEFAULT_DELAY_MS,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now,
  enabled = () => true,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let timer = null;
  let pending = [];
  let pendingEl = null;
  let misses = [];
  let inflight = 0;
  let queued = null;

  const pageTitle = (node) => String(node?.getAttribute?.("data-link-title") || node?.getAttribute?.("data-page-title") || "").trim();

  // The deepest hover target wins. A ref the cache does not know yields no uids, so it is left alone.
  const targetOf = (node) => {
    if (!node?.closest) return null;
    // One ancestor walk for ordinary mouse movement; the specific checks run only on a hit.
    if (!node.closest(HOVER_SEL)) return null;
    const cardChip = node.closest(".pxd-cardchip");
    if (cardChip) {
      const uid = cardChip.getAttribute?.("data-board") || "";
      return { el: cardChip, uids: uid ? [uid] : [] };
    }
    const boardChip = node.closest(".pxd-boardchip");
    if (boardChip) {
      const blockUid = boardChip.getAttribute?.("data-block-uid")
        || boardChip.closest?.("[data-block-uid]")?.getAttribute?.("data-block-uid")
        || "";
      return { el: boardChip, uids: blockUid ? dedupe(cache?.boardsOf?.(blockUid) || []) : [] };
    }
    const crumb = node.closest(".pxd-crumb");
    if (crumb) {
      if (crumb.classList?.contains?.("pxd-crumb--current") || crumb.classList?.contains?.("pxd-crumb__more")) {
        return { el: crumb, uids: [] };
      }
      const uid = crumb.getAttribute?.("data-board") || "";
      return { el: crumb, uids: uid ? [uid] : [] };
    }
    const blockRef = node.closest(".rm-block-ref");
    if (blockRef) {
      const uid = blockRef.getAttribute?.("data-uid") || "";
      if (!uid) return { el: blockRef, uids: [] };
      return { el: blockRef, uids: dedupe([...(refBoards(uid) || []), ...(cache?.boardsOf?.(uid) || [])]) };
    }
    const pageRef = node.closest(".rm-page-ref") || node.closest("[data-link-title]");
    if (pageRef) {
      const title = pageTitle(pageRef);
      return { el: pageRef, uids: title ? dedupe(pageBoards(title) || []) : [] };
    }
    const boardCard = node.closest(".pxd-item--board");
    if (boardCard) {
      const uid = boardCard.getAttribute?.("data-uid") || "";
      return { el: boardCard, uids: uid ? [uid] : [] };
    }
    return null;
  };

  const prune = (t) => {
    misses = misses.filter((at) => t - at < windowMs);
  };

  const settle = () => {
    inflight = 0;
    const next = queued;
    queued = null;
    if (next) fire(next);
  };

  const warmOne = (uid) => {
    let hot = false;
    try { hot = isWarm(uid) === true; } catch { hot = false; }
    if (hot) {
      try { return warm(uid); } catch { return null; }
    }
    const t = now();
    prune(t);
    if (misses.length >= limit) return null;
    misses.push(t);
    try { return warm(uid); } catch { return null; }
  };

  function fire(uids) {
    if (enabled() === false) return;
    if (inflight >= 1) {
      queued = uids;
      return;
    }
    inflight = 1;
    const jobs = [];
    for (const uid of uids) {
      const job = warmOne(uid);
      if (job && typeof job.then === "function") jobs.push(job);
    }
    if (jobs.length) Promise.all(jobs).then(settle, settle);
    else settle();
  }

  function schedule(uids, el) {
    if (enabled() === false) return;
    const list = dedupe(Array.isArray(uids) ? uids : [uids]);
    if (!list.length) return;
    if (timer && same(pending, list)) {
      if (el) pendingEl = el;
      return;
    }
    cancel();
    pending = list;
    pendingEl = el || null;
    timer = setTimer(() => {
      timer = null;
      const batch = pending;
      pending = [];
      pendingEl = null;
      fire(batch);
    }, delayMs);
  }

  function cancel(el) {
    if (el && pendingEl !== el) return;
    if (timer != null) clearTimer(timer);
    timer = null;
    pending = [];
    pendingEl = null;
    queued = null;
  }

  const onOver = (event) => {
    const hit = targetOf(event?.target);
    if (!hit?.uids?.length) return;
    if (hit.el?.contains?.(event.relatedTarget)) return;
    schedule(hit.uids, hit.el);
  };

  const onOut = (event) => {
    const hit = targetOf(event?.target);
    if (!hit?.el) return;
    if (hit.el.contains?.(event.relatedTarget)) return;
    cancel(hit.el);
  };

  if (doc?.addEventListener) {
    doc.addEventListener("pointerover", onOver);
    doc.addEventListener("pointerout", onOut);
  }

  function dispose() {
    cancel();
    doc?.removeEventListener?.("pointerover", onOver);
    doc?.removeEventListener?.("pointerout", onOut);
    if (current === api) current = null;
  }

  const api = { schedule, cancel, dispose, misses: () => misses.length };
  current = api;
  return api;
}
