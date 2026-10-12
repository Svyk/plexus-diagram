// Node side of the bulk writer: level the ops (a parent before its children), skip what exists, send chunks to
// page.writeOps, and back off when Roam's main thread stalls.
import { existing, pagesByTitle, pendingCount, waitSynced, writeOps } from "./page.mjs";
import { limiter } from "./limit.mjs";

// depth 0 = pages; a block whose parent is not in this op list hangs off something that already exists (depth 1).
export function levels(ops) {
  const byUid = new Map(ops.map((op) => [op.uid, op]));
  const depth = new Map();
  const of = (op) => {
    if (depth.has(op.uid)) return depth.get(op.uid);
    let d = 0;
    if (op.kind !== "page") {
      const p = byUid.get(op.parent);
      d = p ? of(p) + 1 : 1;
    }
    depth.set(op.uid, d);
    return d;
  };
  const out = [];
  for (const op of ops) {
    const d = of(op);
    (out[d] ||= []).push(op);
  }
  return out.filter(Boolean);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Roam confirms queued writes one at a time and each confirmation costs time in proportion to the queue (18k queued
// writes drained at ~5 a minute, CPU at 100%). Hold new writes until the queue is back under `max`.
export const MAX_PENDING = Number(process.env.PHD_MAX_PENDING || 300);
export async function waitPending(cdp, { max = MAX_PENDING, log = () => {}, label = "", maxWaitMs = 45 * 60000 } = {}) {
  const t0 = Date.now();
  let n = await cdp.call(pendingCount);
  if (n == null || n <= max) return { waitedMs: 0, pending: n };
  log(`  ${label}: Roam has ${n} unsynced writes; waiting for <= ${max}`);
  while (n != null && n > max && Date.now() - t0 < maxWaitMs) {
    await sleep(n > max * 4 ? 10000 : 2000);
    n = await cdp.call(pendingCount);
  }
  if (n > max) throw new Error(`Roam sync backlog stayed at ${n} for ${Math.round(maxWaitMs / 60000)} min; stopping (re-run resumes)`);
  return { waitedMs: Date.now() - t0, pending: n };
}

// ops are already resolved ({ kind, uid, parent, title, string, props, open, key }). alias maps a planned uid to the
// uid that really exists (a page title that was already there). Returns stats.
export async function writeAll(cdp, ops, { alias = {}, conc = 8, chunk = 150, log = () => {}, label = "", syncWaitMs = Number(process.env.PHD_SYNC_WAIT_MS ?? 30000) } = {}) {
  const stats = { planned: ops.length, written: 0, skipped: 0, failed: [], ms: 0, calls: 0, maxGap: 0, backoffs: 0, syncWaitMs: 0, pendingWaitMs: 0, maxPending: 0 };
  const t0 = Date.now();
  const mapUid = (u) => alias[u] || u;
  for (const level of levels(ops)) {
    const pages = level.filter((op) => op.kind === "page");
    if (pages.length) {
      const found = await cdp.call(pagesByTitle, pages.map((p) => p.title));
      for (const p of pages) if (found[p.title] && found[p.title] !== p.uid) alias[p.uid] = found[p.title];
    }
    const want = level.map((op) => ({ ...op, uid: mapUid(op.uid), parent: op.parent ? mapUid(op.parent) : op.parent }));
    const have = new Set();
    for (let i = 0; i < want.length; i += 2000) {
      for (const u of await cdp.call(existing, want.slice(i, i + 2000).map((op) => op.uid))) have.add(u);
    }
    const todo = want.filter((op) => !have.has(op.uid));
    stats.skipped += want.length - todo.length;
    for (let i = 0; i < todo.length; i += chunk) {
      const part = todo.slice(i, i + chunk).map(({ kind, uid, parent, title, string, props, open, key }) => ({ kind, uid, parent, title, string, props, open, key }));
      const pw = await waitPending(cdp, { log, label });
      stats.pendingWaitMs += pw.waitedMs;
      stats.maxPending = Math.max(stats.maxPending, pw.pending || 0);
      let r = await cdp.mut(part.length, writeOps, { ops: part, conc });
      stats.calls += 1;
      // Roam refused part of the chunk (mutation cap): wait out the window and write the rest, still in order.
      for (let tries = 0; r.limited && r.rest.length && tries < 10; tries += 1) {
        stats.rateLimited = (stats.rateLimited || 0) + 1;
        log(`  ${label}: Roam mutation cap hit; ${r.rest.length} ops wait for the next window`);
        await limiter.saturate();
        const left = new Set(r.rest.map((o) => o.uid));
        const again = part.filter((o) => left.has(o.uid));
        const prev = r;
        r = await cdp.mut(again.length, writeOps, { ops: again, conc });
        r.done += prev.done;
        r.failed = [...prev.failed, ...r.failed];
        r.maxGap = Math.max(prev.maxGap, r.maxGap);
      }
      if (r.limited) r.failed.push(...r.rest.map((o) => ({ uid: o.uid, key: o.key, err: "rate limited" })));
      stats.written += r.done;
      stats.failed.push(...r.failed);
      stats.maxGap = Math.max(stats.maxGap, r.maxGap);
      if (r.maxGap > 1000) {
        // Roam stalled: fewer writers in flight and a pause twice the stall, so it can catch up before the next chunk.
        stats.backoffs += 1;
        conc = Math.max(1, Math.floor(conc / 2));
        chunk = Math.max(40, Math.floor(chunk / 2));
        const pause = Math.min(15000, r.maxGap * 2);
        log(`  ${label}: main thread stalled ${r.maxGap} ms; concurrency ${conc}, chunk ${chunk}, pause ${pause} ms`);
        await sleep(pause);
      } else if (r.maxGap > 600) {
        await sleep(600);
      } else if (r.maxGap < 300 && conc < 8) {
        conc += 1;
      }
      if (r.failed.length) log(`  ${label}: ${r.failed.length} failed, e.g. ${r.failed[0].key}: ${r.failed[0].err}`);
      // Without Roam's queue count, fall back to the sync icon (still "saving" = still uploading).
      if (syncWaitMs > 0 && (await cdp.call(pendingCount)) == null) stats.syncWaitMs += await cdp.call(waitSynced, { maxMs: syncWaitMs }, syncWaitMs + 30000);
    }
  }
  stats.ms = Date.now() - t0;
  stats.perSec = stats.written ? Math.round((stats.written / Math.max(1, stats.ms)) * 1000) : 0;
  stats.conc = conc;
  return stats;
}
