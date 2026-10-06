// Opt-in layout-shift log (FAST-6). Off: no PerformanceObserver and no frame.
// The live gate counts shifts itself. This watcher is for the timing-log setting.

import { perfNow } from "../perf-log.js";

const OPEN_FRAMES = 120;
const REGIONS = new Set(["cards", "chrome", "panel", "page"]);

export function attributeShiftNode(node) {
  let el = node;
  if (el && el.nodeType === 3) el = el.parentElement || el.parentNode;
  if (!el || typeof el.closest !== "function") return null;
  if (el.closest(".pxd-item")) return "cards";
  if (el.closest(".pxd-toolbar") || el.closest(".pxd-dock")) return "chrome";
  if (el.closest(".pxd-panel")) return "panel";
  if (el.closest(".pxd-root")) return null;
  return "page";
}

function regionOf(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(entry, "region")) return entry.region || null;
  const sources = entry.sources;
  if (!Array.isArray(sources) || !sources.length) return null;
  return attributeShiftNode(sources[0]?.node);
}

// A failing shift is after usable, has a positive value, was not from recent input,
// and lands in one of the four regions. Inside .pxd-root but outside those regions does not fail.
export function shiftEntryFails(entry, usableAt) {
  if (!entry || entry.hadRecentInput) return false;
  const region = regionOf(entry);
  if (!REGIONS.has(region)) return false;
  if (!(Number(entry.value) > 0)) return false;
  if (typeof usableAt !== "number" || !Number.isFinite(usableAt)) return false;
  if (!(Number(entry.startTime) > usableAt)) return false;
  return true;
}

// grown is cards whose border box grew by more than 1px after the usable snapshot.
// No usable mark means the sample does not fail, even when grown is set.
export function summarizeGateShifts({ entries, usableAt, grown } = {}) {
  if (typeof usableAt !== "number" || !Number.isFinite(usableAt)) return 0;
  let n = 0;
  for (const entry of entries || []) if (shiftEntryFails(entry, usableAt)) n += 1;
  const extra = Number(grown);
  if (Number.isFinite(extra) && extra > 0) n += extra;
  return n;
}

export function shiftDebugOn() {
  return globalThis.__PXD_SHIFT_DEBUG === true;
}

function emptyTally(usableAt) {
  return { cards: 0, chrome: 0, panel: 0, page: 0, before: 0, after: 0, failing: 0, usableAt };
}

export function createShiftWatch() {
  let on = false;
  let observer = null;
  let stats = null;
  let tracked = false;
  let usableAt = null;
  let raf = 0;
  let frames = 0;
  const rows = [];

  const publish = () => {
    if (!stats) return;
    if (!on) {
      stats.shifts = null;
      return;
    }
    const tally = emptyTally(usableAt);
    for (const row of rows) {
      if (REGIONS.has(row.region)) tally[row.region] += 1;
      if (typeof usableAt === "number" && row.startTime > usableAt) tally.after += 1;
      else tally.before += 1;
      if (shiftEntryFails(row, usableAt)) tally.failing += 1;
    }
    stats.shifts = tally;
  };

  const take = (entry) => {
    rows.push({
      value: Number(entry?.value) || 0,
      startTime: Number(entry?.startTime),
      hadRecentInput: Boolean(entry?.hadRecentInput),
      region: regionOf(entry),
      sources: entry?.sources,
    });
    publish();
  };

  const cancelWatch = () => {
    if (!raf) return;
    try { globalThis.cancelAnimationFrame?.(raf); } catch { /* stub */ }
    raf = 0;
  };

  function stop() {
    on = false;
    cancelWatch();
    frames = 0;
    try { observer?.disconnect(); } catch { /* already disconnected */ }
    observer = null;
    rows.length = 0;
    usableAt = null;
    if (stats) stats.shifts = null;
  }

  const makeObserver = () => {
    const PO = globalThis.PerformanceObserver;
    if (typeof PO !== "function") return null;
    let next;
    try {
      next = new PO((list) => {
        if (!on) return;
        const entries = typeof list?.getEntries === "function" ? list.getEntries() : [];
        for (const entry of entries) take(entry);
      });
    } catch {
      return null;
    }
    const attempts = [
      { type: "layout-shift", buffered: true },
      { type: "layout-shift" },
      { entryTypes: ["layout-shift"] },
    ];
    for (const opts of attempts) {
      try {
        next.observe(opts);
        return next;
      } catch { /* try the next shape */ }
    }
    try { next.disconnect(); } catch { /* already gone */ }
    return null;
  };

  const track = (lifecycle) => {
    if (!lifecycle?.add || tracked) return;
    tracked = true;
    lifecycle.add(() => stop());
  };

  const start = ({ stats: next, lifecycle, enabled } = {}) => {
    if (next && typeof next === "object") stats = next;
    track(lifecycle);
    const want = enabled === true || shiftDebugOn();
    if (!want) {
      stop();
      return;
    }
    on = true;
    if (!observer) observer = makeObserver();
    publish();
  };

  const markUsable = (t) => {
    if (!on) return false;
    const n = Number(t);
    usableAt = Number.isFinite(n) ? n : perfNow();
    publish();
    return true;
  };

  const watchMount = (mountEl) => {
    if (!on || usableAt != null || raf) return;
    const seen = () => {
      if (mountEl?.classList?.contains?.("pxd-item")) return mountEl;
      const scope = mountEl?.querySelector ? mountEl : globalThis.document;
      return scope?.querySelector?.(".pxd-item") || null;
    };
    if (seen()) {
      markUsable(perfNow());
      return;
    }
    const rafFn = globalThis.requestAnimationFrame;
    if (typeof rafFn !== "function") return;
    const step = () => {
      raf = 0;
      if (!on || usableAt != null) return;
      if (seen()) {
        markUsable(perfNow());
        return;
      }
      frames += 1;
      if (frames >= OPEN_FRAMES) return;
      raf = rafFn(step);
    };
    raf = rafFn(step);
  };

  return {
    start,
    stop,
    watchMount,
    markUsable,
    ingest(entry) { if (on) take(entry); },
    get enabled() { return on; },
  };
}
