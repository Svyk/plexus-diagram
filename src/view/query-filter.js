// PXD-17. One query card filters the board. A query Plexus translates runs through query-run with the query-card
// backend and runs again after a save in this window, an edit to the query, or a slow poll (changes from another
// window). Anything else reads the uids Roam rendered in the card (the same DOM read as "Add results as cards") and
// watches that render. Every read checks the query text again, so an edit can move it between the two. Never writes.

import { parseQuery, runQuery } from "../model/query-run.js";
import { queryResultUids } from "../model/query.js";
import { createQueryBackend } from "../host/query-backend.js";
import { editState, watchEditing, watchLocalSaves } from "../host/local-saves.js";

export const FILTER_QUIET_MS = 800;
export const FILTER_RETRY_MS = 1200;
export const FILTER_SLOW_RETRY_MS = 4000;
export const FILTER_POLL_MS = 20000;
const FALLBACK_TRIES = 8;

// onResults({ queryUid, cardUid, uids: Set, partial, mode: "run" | "dom", status }) after every read.
// liveNode(cardUid) returns the Roam render of a query Plexus does not translate, or null while it is not mounted.
export function createQueryFilter({ host, doc = globalThis.document, liveNode = () => null, onResults = () => {}, backend, later, cancel } = {}) {
  const win = doc?.defaultView || globalThis;
  const wait = later || ((fn, ms) => win.setTimeout(fn, ms));
  const unwait = cancel || ((id) => win.clearTimeout(id));
  let cur = null;

  const excludeOf = (uid) => {
    const out = new Set([uid]);
    const walk = (nodes) => {
      for (const node of Array.isArray(nodes) ? nodes : []) {
        const id = node?.uid || node?.[":block/uid"];
        if (typeof id === "string") out.add(id);
        walk(node?.children || node?.[":block/children"]);
      }
    };
    try { walk(host?.pullTree?.(uid, 6, 400)); } catch { /* the query block alone is excluded */ }
    return out;
  };

  const sameSet = (a, b) => a === b || (a instanceof Set && b instanceof Set && a.size === b.size && [...a].every((u) => b.has(u)));

  const emit = (f, uids, partial, status) => {
    if (cur !== f) return;
    // A poll or a re-render that finds the same results repaints nothing.
    const last = f.last;
    if (last && f.mode === last.mode && f.title === last.title && partial === last.partial && status === last.status && sameSet(uids, f.uids)) return;
    f.last = { mode: f.mode, title: f.title, partial, status };
    f.uids = uids;
    onResults({ queryUid: f.queryUid, cardUid: f.cardUid, uids, partial, mode: f.mode, status });
  };

  const schedule = (f, ms = FILTER_QUIET_MS) => {
    if (cur !== f) return;
    if (f.timer != null) unwait(f.timer);
    f.timer = wait(() => {
      f.timer = null;
      if (cur !== f) return;
      // Never read while the user types in this window: the next pause runs it.
      if (editState(doc).typing) { schedule(f); return; }
      void read(f);
    }, ms);
  };

  const runOnce = async (f, parsed) => {
    f.title = parsed.title || f.title;
    const gen = ++f.gen;
    const exclude = excludeOf(f.queryUid);
    const src = backend || createQueryBackend(host);
    const res = await runQuery(parsed.ast, src, { tick: () => new Promise((r) => wait(r, 0)), isCancelled: () => cur !== f || gen !== f.gen });
    if (cur !== f || gen !== f.gen) return;
    if (res.status !== "ok") {
      if (res.status !== "cancelled") emit(f, f.uids, true, res.status);
      return;
    }
    emit(f, new Set(res.uids.filter((u) => !exclude.has(u))), res.partial, "ok");
    // Backstop for changes a save in this window does not signal (another window or device).
    if (f.timer == null) schedule(f, FILTER_POLL_MS);
  };

  const watchDom = (f, node) => {
    if (f.observed === node) return;
    f.mo?.disconnect?.();
    f.mo = null;
    f.observed = node;
    const MO = win.MutationObserver;
    if (typeof MO !== "function") return;
    f.mo = new MO(() => schedule(f, 300));
    try { f.mo.observe(node, { childList: true, subtree: true }); } catch { f.mo = null; }
  };

  function readDom(f) {
    const node = liveNode(f.cardUid);
    if (!node) {
      // Not mounted (off screen, map tier) or Roam has not rendered yet: keep the last results and look again,
      // slower after the first tries (one querySelector a look).
      f.tries += 1;
      schedule(f, f.tries <= FALLBACK_TRIES ? FILTER_RETRY_MS : FILTER_SLOW_RETRY_MS);
      if (!f.uids && !f.waited) { f.waited = true; emit(f, null, true, "waiting"); }
      return;
    }
    f.tries = 0;
    watchDom(f, node);
    // Roam paints the result rows a moment after the query block mounts.
    const uids = queryResultUids(node, f.queryUid);
    const failed = Boolean(node.querySelector?.(".rm-render-failed, .rm-api-render--failed"));
    emit(f, new Set(uids), failed, failed ? "error" : "ok");
  }

  // The query text decides the mode on every read: an edit can turn a query Plexus runs into one only Roam renders
  // (and then the card shows Roam's list), or back (the card shows Plexus' list and Roam's render is gone).
  async function read(f) {
    const parsed = parseQuery(host?.blockString?.(f.queryUid));
    const mode = parsed.ok && parsed.ast ? "run" : "dom";
    if (mode !== f.mode) {
      f.mode = mode;
      f.tries = 0;
      f.mo?.disconnect?.();
      f.mo = null;
      f.observed = null;
    }
    if (mode === "dom") { readDom(f); return; }
    try { await runOnce(f, parsed); } catch { emit(f, f.uids, true, "error"); }
  }

  const stop = () => {
    const f = cur;
    if (!f) return false;
    cur = null;
    if (f.timer != null) unwait(f.timer);
    f.mo?.disconnect?.();
    for (const off of f.offs) { try { off(); } catch { /* already gone */ } }
    onResults(null);
    return true;
  };

  const start = ({ queryUid, cardUid }) => {
    if (!queryUid || !cardUid) return false;
    stop();
    const parsed = parseQuery(host?.blockString?.(queryUid));
    const f = {
      queryUid,
      cardUid,
      mode: parsed.ok && parsed.ast ? "run" : "dom",
      title: parsed.ok ? parsed.title : "",
      uids: null,
      gen: 0,
      tries: 0,
      waited: false,
      last: null,
      timer: null,
      mo: null,
      observed: null,
      offs: [],
    };
    cur = f;
    f.offs.push(watchLocalSaves(doc, () => schedule(f)));
    // Keeps the edit state tracked, so a read waits out typing (the pending timer retries).
    f.offs.push(watchEditing(doc, () => {}));
    if (typeof host?.watchBlock === "function") {
      try { f.offs.push(host.watchBlock(queryUid, () => schedule(f))); } catch { /* the save signal still re-reads */ }
    }
    void read(f);
    return true;
  };

  // The board redrew: a DOM-read filter may have a new render to watch.
  const poke = () => {
    const f = cur;
    if (!f || f.mode !== "dom") return;
    const node = liveNode(f.cardUid);
    if (node && node !== f.observed) { f.tries = 0; schedule(f, 300); }
  };

  return {
    start,
    stop,
    poke,
    refresh: () => { if (cur) void read(cur); },
    active: () => (cur ? { queryUid: cur.queryUid, cardUid: cur.cardUid, title: cur.title, mode: cur.mode } : null),
    dispose: stop,
  };
}
