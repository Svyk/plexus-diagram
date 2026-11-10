// Query card body. The list paints after first paint: cached rows at once, then one idle run.
// A query Plexus cannot translate stays a live Roam render; its uids are kept as static rows for the next open.

import { CARD_MIME } from "../model/drop.js";
import {
  QUERY_SHOW,
  createQueryCache,
  loadQueryRows,
  parseQuery,
  queryRows,
  rowDragPayload,
  visibleRows,
} from "../model/query-run.js";
import { queryResultUids } from "../model/query.js";
import { createQueryBackend } from "../host/query-backend.js";

const REUSE_MS = 15000;
const FALLBACK_WAIT_MS = 1800;

export function createQueryCards({ doc = globalThis.document, host, storage, graph = "", backend, now = Date.now, schedule, keep = null, busy = null, idle = null } = {}) {
  const cache = createQueryCache(storage, typeof graph === "function" ? graph() : graph);
  const source = backend || (host?.q ? createQueryBackend(host) : null);
  const runs = new Map();
  const jobs = new Set();
  // keep is the speed flag stepSettle. Off (or omitted) is the 15s reuse. On, rows stay until the graph,
  // a watch, or this card's own query text changes, and a new read waits until the board is idle.
  const keepOn = () => { try { return typeof keep === "function" ? keep() !== false : keep === true; } catch { return false; } };
  const isBusy = () => { try { return typeof busy === "function" && busy() === true; } catch { return false; } };
  const astKey = (ast) => { try { return JSON.stringify(ast); } catch { return ""; } };
  const later = schedule || ((fn, ms = 0) => {
    const win = doc?.defaultView || globalThis;
    if (!ms && typeof win.requestIdleCallback === "function") return win.requestIdleCallback(() => fn(), { timeout: 1500 });
    return setTimeout(fn, ms);
  });

  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  const swallow = (event) => event.stopPropagation();

  // One run per query card at a time; a remount inside REUSE_MS shows the last result without a new read.
  // The query block itself and everything under it never count as results.
  function excludeOf(uid) {
    const out = new Set([uid]);
    const walk = (nodes) => {
      for (const node of Array.isArray(nodes) ? nodes : []) {
        const id = node?.uid || node?.[":block/uid"];
        if (typeof id === "string") out.add(id);
        walk(node?.children || node?.[":block/children"]);
      }
    };
    try { walk(host?.pullTree?.(uid, 6, 400)); } catch { /* the card block alone is excluded */ }
    return out;
  }

  function freshHit(uid, ast) {
    const hit = runs.get(uid);
    return Boolean(hit?.result && hit.key === astKey(ast) && !hit.stale);
  }

  // A kept card does not start a read while a gesture or a settle is in progress. The caller asks again when idle.
  function fetchRows(uid, ast, force) {
    const hit = runs.get(uid);
    const key = astKey(ast);
    if (!keepOn()) {
      if (!force && hit?.result && now() - hit.at < REUSE_MS) return Promise.resolve(hit.result);
    } else if (!force && freshHit(uid, ast)) {
      return Promise.resolve(hit.result);
    }
    if (hit?.promise && hit.key === key && !force) return hit.promise;
    if (keepOn() && isBusy()) {
      return Promise.resolve(hit?.result && hit.key === key ? hit.result : { status: "cancelled", rows: [], total: 0, partial: true });
    }
    const entry = { at: now(), result: null, promise: null, key, stale: false };
    entry.promise = loadQueryRows(ast, source, { exclude: excludeOf(uid), tick: () => new Promise((resolve) => later(resolve)) })
      .catch(() => ({ status: "error", rows: [], total: 0, partial: true }))
      .then((result) => {
        entry.promise = null;
        entry.at = now();
        if (result.status === "ok") {
          entry.result = result;
          cache.set(uid, result.rows, { total: result.total, partial: result.partial });
        } else entry.result = null;
        return result;
      });
    runs.set(uid, entry);
    return entry.promise;
  }

  function rowEl(parent, row) {
    const node = el("div", "pxd-qc__row", parent);
    node.draggable = true;
    node.setAttribute("draggable", "true");
    node.dataset.uid = row.uid;
    node.setAttribute("data-uid", row.uid);
    node.setAttribute("data-kind", row.kind);
    el("span", "pxd-qc__text", node, row.text);
    if (row.crumb) el("span", "pxd-qc__crumb", node, row.crumb);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) node.addEventListener(type, swallow);
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      if (row.kind === "page") {
        const title = row.string.slice(2, -2);
        const pageUid = host?.pageUid?.(title);
        if (pageUid) host?.openInSidebar?.(pageUid, "outline");
      } else host?.openInSidebar?.(row.uid, "block");
    });
    node.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      const payload = rowDragPayload(row);
      try {
        event.dataTransfer?.setData?.(CARD_MIME, payload);
        event.dataTransfer?.setData?.("text/plain", payload);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* the drag still leaves the source block alone */ }
    });
    return node;
  }

  function paintList(list, rows, shown) {
    list.replaceChildren?.();
    const { rows: head, hidden } = visibleRows(rows, shown);
    for (const row of head) rowEl(list, row);
    return hidden;
  }

  // Translated query: our own list. Returns the card body element, or null when the query needs Roam's renderer.
  function mount(parent, uid, string) {
    const parsed = parseQuery(string);
    if (!parsed.ok || !parsed.ast || !source) return null;
    const root = el("div", "pxd-qc", parent);
    root.dataset.uid = uid;
    const bar = el("div", "pxd-qc__bar", root);
    const count = el("span", "pxd-qc__count", bar, parsed.title || "Query");
    const refresh = el("button", "pxd-qc__refresh", bar, "↻");
    refresh.type = "button";
    refresh.title = "Run the query again";
    refresh.setAttribute("aria-label", "Run the query again");
    for (const type of ["pointerdown", "mousedown", "dblclick"]) refresh.addEventListener(type, swallow);
    const list = el("div", "pxd-qc__list", root);
    const more = el("button", "pxd-qc__more", root);
    more.type = "button";
    more.hidden = true;
    for (const type of ["pointerdown", "mousedown", "dblclick"]) more.addEventListener(type, swallow);

    let rows = [];
    let shown = QUERY_SHOW;
    let total = 0;
    let partial = false;
    let stale = false;
    const label = (extra) => {
      const base = parsed.title || "Query";
      count.textContent = extra ? `${base} · ${extra}` : base;
    };
    const paint = () => {
      const hidden = paintList(list, rows, shown);
      more.hidden = hidden === 0;
      if (hidden) more.textContent = `Show ${Math.min(QUERY_SHOW, hidden)} more (${hidden} left)`;
      if (!rows.length) {
        el("div", "pxd-qc__empty", list, stale ? "Could not run this query. Open it in Roam." : "No results");
      }
      const parts = [`${total || rows.length} ${(total || rows.length) === 1 ? "result" : "results"}`];
      if (partial) parts.push("partial");
      if (stale) parts.push("last run");
      label(rows.length || !stale ? parts.join(" · ") : "");
    };
    more.addEventListener("click", (event) => { event.stopPropagation(); shown += QUERY_SHOW; paint(); });

    const cached = cache.get(uid);
    if (cached) {
      rows = cached.rows;
      total = cached.total;
      partial = cached.partial;
      stale = true;
      paint();
    } else {
      el("div", "pxd-qc__empty", list, "Running…");
    }

    const run = (force) => {
      root.classList.add("pxd-qc--busy");
      return fetchRows(uid, parsed.ast, force).then((result) => {
        root.classList.remove("pxd-qc--busy");
        if (root.isConnected === false) return;
        if (result.status === "ok") {
          rows = result.rows;
          total = result.total;
          partial = result.partial;
          stale = false;
          shown = Math.max(QUERY_SHOW, Math.min(shown, rows.length));
        } else if (result.status !== "cancelled") stale = true;
        paint();
      });
    };
    const job = { uid, root, run, ast: parsed.ast };
    for (const old of jobs) if (old.uid === uid && old.root?.isConnected === false) jobs.delete(old);
    jobs.add(job);
    refresh.addEventListener("click", (event) => { event.stopPropagation(); kick(job, true); });
    if (keepOn()) {
      if (freshHit(uid, parsed.ast)) {
        const hit = runs.get(uid).result;
        rows = hit.rows;
        total = hit.total;
        partial = hit.partial;
        stale = false;
        paint();
      } else {
        const stored = cache.get(uid);
        if (stored?.rows && !runs.get(uid)?.result) {
          runs.set(uid, {
            at: now(), result: { status: "ok", rows: stored.rows, total: stored.total, partial: stored.partial },
            promise: null, key: astKey(parsed.ast), stale: false,
          });
        }
        if (!freshHit(uid, parsed.ast)) kick(job, false);
      }
    } else {
      later(() => { if (root.isConnected !== false) void run(false); });
    }
    return root;
  }

  // Idle, and not during a gesture or a settle. `idle` is the shared background budget when the flag is on.
  function arm(fn) {
    if (keepOn() && typeof idle === "function") idle(fn);
    else later(fn);
  }
  function kick(job, force) {
    const go = () => {
      if (job.root?.isConnected === false) return;
      if (keepOn() && isBusy()) { arm(go); return; }
      if (!force && freshHit(job.uid, job.ast)) return;
      void job.run(Boolean(force));
    };
    arm(go);
  }
  // The graph or a watch changed. Mounted cards read again once the board is idle.
  function noteGraph() {
    if (!keepOn()) return;
    for (const hit of runs.values()) hit.stale = true;
    for (const job of jobs) kick(job, false);
  }
  // This card's query text changed.
  function invalidate(uid) {
    const hit = uid ? runs.get(uid) : null;
    if (hit) hit.stale = true;
    for (const job of jobs) if (!uid || job.uid === uid) kick(job, false);
  }

  // Query Plexus cannot translate: Roam keeps rendering it. After it settles, remember the uids it rendered,
  // and when the render failed or stayed empty put the last remembered rows in its place.
  function watchFallback(card, live, uid) {
    if (!card || !live || !source) return;
    later(() => {
      if (card.isConnected === false) return;
      const uids = queryResultUids(live, uid);
      const failed = Boolean(live.querySelector?.(".rm-render-failed, .rm-api-render--failed"));
      if (uids.length && !failed) {
        const order = uids.slice(0, 200);
        let details = [];
        try { details = source.details(order); } catch { details = []; }
        const rows = queryRows(details, order);
        if (rows.length) cache.set(uid, rows, { total: uids.length, partial: uids.length > order.length });
        return;
      }
      const cached = cache.get(uid);
      if (!cached?.rows?.length) return;
      const box = el("div", "pxd-qc pxd-qc--static", null);
      const bar = el("div", "pxd-qc__bar", box);
      el("span", "pxd-qc__count", bar, `Last results · ${cached.total} saved`);
      const list = el("div", "pxd-qc__list", box);
      for (const row of cached.rows.slice(0, QUERY_SHOW)) rowEl(list, row);
      card.append(box);
    }, FALLBACK_WAIT_MS);
  }

  return { mount, watchFallback, cache, noteGraph, invalidate };
}
