// Opt-in timing log (FAST-2). Memory only: no network, no Roam writes, no localStorage.
// Off: nothing here constructs a PerformanceObserver or schedules a frame.

export const PERF_CAP = 256;
const OPEN_FRAMES = 120;

export function perfNow() {
  const clock = globalThis.performance;
  if (clock && typeof clock.now === "function") return clock.now();
  return Date.now();
}

// Nearest rank on a sorted copy. p50 is index floor((n - 1) * 0.5), p75 floor((n - 1) * 0.75).
export function percentile(samples, p) {
  const n = samples.length;
  if (!n) return null;
  const sorted = samples.slice().sort((a, b) => a - b);
  return sorted[Math.floor((n - 1) * p)];
}

function ring(cap) {
  const samples = [];
  return {
    push(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      samples.push(n);
      if (samples.length > cap) samples.splice(0, samples.length - cap);
      return true;
    },
    clear() { samples.length = 0; },
    get n() { return samples.length; },
    summary() {
      return { p50: percentile(samples, 0.5), p75: percentile(samples, 0.75), n: samples.length };
    },
  };
}

// The bundle's own URL: a Pages URL when installed, a blob: URL when a dev build is injected.
// Other extensions also load from blobs and also ship an extension.js, so only an exact match counts.
const OWN_URL = (() => { try { return String(import.meta.url || ""); } catch { return ""; } })();

export function isPlexusExtensionUrl(url, own = OWN_URL) {
  const text = String(url || "");
  if (typeof own !== "string") own = OWN_URL;
  if (!text) return false;
  if (own && text.split(/[?#]/)[0] === own.split(/[?#]/)[0]) return true;
  if (text.startsWith("blob:")) return false;
  let path = text;
  try { path = new URL(text).pathname; } catch { /* a bare path has no origin */ }
  return /(?:^|\/)plexus-diagram\/extension\.js$/i.test(path);
}

function addUrl(out, value) {
  if (typeof value === "string" && value) out.push(value);
}

// Long-task script URLs. Only this bundle's own URL counts as Plexus (see isPlexusExtensionUrl).
export function scriptUrlsOf(entry) {
  const out = [];
  if (!entry || typeof entry !== "object") return out;
  addUrl(out, entry.sourceURL);
  addUrl(out, entry.scriptUrl);
  addUrl(out, entry.scriptURL);
  addUrl(out, entry.url);
  const lists = [entry.attribution, entry.scripts];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") { addUrl(out, item); continue; }
      addUrl(out, item.sourceURL);
      addUrl(out, item.scriptUrl);
      addUrl(out, item.scriptURL);
      addUrl(out, item.url);
      addUrl(out, item.containerSrc);
      addUrl(out, item.containerName);
      addUrl(out, item.name);
    }
  }
  return out;
}

export function isPlexusLongTask(entry) {
  return scriptUrlsOf(entry).some((url) => isPlexusExtensionUrl(url));
}

export function clickInsideRoot(entry) {
  if (!entry || entry.name !== "click") return false;
  let node = entry.target;
  if (node && node.nodeType === 3) node = node.parentElement;
  if (!node || typeof node.closest !== "function") return false;
  return Boolean(node.closest(".pxd-root"));
}

// 1000 / median rAF delta. Median uses the same p50 index as the other series.
export function panFps(deltas) {
  const finite = [];
  for (const value of deltas || []) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) finite.push(n);
  }
  const median = percentile(finite, 0.5);
  if (!(median > 0)) return null;
  return 1000 / median;
}

function numText(value) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

export function perfReadoutText(perf) {
  const bit = (label, series) => `${label} p50 ${numText(series?.p50)} p75 ${numText(series?.p75)}`;
  return [
    bit("Open", perf?.open),
    bit("Click", perf?.click),
    bit("Pan", perf?.fps),
    bit("Long tasks", perf?.longtask),
  ].join(" · ");
}

let latestPerf = null;
let readoutRow = null;
let readoutBlurb = "";

export function readHostPerf() {
  const win = globalThis.window ?? globalThis;
  const stats = win.__plexusDiagram?.stats;
  if (stats && Object.prototype.hasOwnProperty.call(stats, "perf")) return stats.perf ?? null;
  return latestPerf;
}

export function bindPerfReadout(row, blurb) {
  readoutRow = row || null;
  readoutBlurb = blurb || "";
  paintReadout();
}

function paintReadout() {
  if (!readoutRow) return;
  const text = perfReadoutText(latestPerf);
  readoutRow.description = readoutBlurb ? `${readoutBlurb} ${text}` : text;
}

function publishLatest(perf) {
  latestPerf = perf ?? null;
  paintReadout();
}

export function createPerfLog({ cap = PERF_CAP } = {}) {
  const open = ring(cap);
  const click = ring(cap);
  const fps = ring(cap);
  const longtask = ring(cap);
  let longCount = 0;
  let on = false;
  let stats = null;
  let eventObserver = null;
  let longObserver = null;
  let tracked = false;
  const watches = new Set();
  const pan = { deltas: null, last: null, raf: 0 };

  const current = () => {
    if (!on) return null;
    const tasks = longtask.summary();
    tasks.count = longCount;
    return { open: open.summary(), click: click.summary(), fps: fps.summary(), longtask: tasks };
  };

  const publish = () => {
    const snap = current();
    if (stats) stats.perf = snap;
    publishLatest(snap);
    return snap;
  };

  // The PerformanceObserver wrapper calls onEntry and, when it returns true, the owner publishes.
  // Recreate the observer so the callback closes over `on` and `publish`.
  const makeObserver = (type, take) => {
    const PO = globalThis.PerformanceObserver;
    if (typeof PO !== "function") return null;
    let observer;
    try {
      observer = new PO((list) => {
        if (!on) return;
        const entries = typeof list?.getEntries === "function" ? list.getEntries() : [];
        let changed = false;
        for (const entry of entries) if (take(entry)) changed = true;
        if (changed) publish();
      });
    } catch {
      return null;
    }
    const attempts = type === "event"
      ? [{ type, durationThreshold: 0 }, { type, durationThreshold: 16 }, { type }, { entryTypes: [type] }]
      : [{ type }, { entryTypes: [type] }];
    for (const opts of attempts) {
      try {
        observer.observe(opts);
        return observer;
      } catch { /* try the next shape */ }
    }
    try { observer.disconnect(); } catch { /* already gone */ }
    return null;
  };

  const track = (lifecycle) => {
    if (!lifecycle?.add || tracked) return;
    tracked = true;
    lifecycle.add(() => stop());
  };

  const armEvent = (lifecycle) => {
    track(lifecycle);
    if (!on || eventObserver) return eventObserver;
    eventObserver = makeObserver("event", (entry) => {
      if (!clickInsideRoot(entry)) return false;
      return click.push(entry.duration);
    });
    return eventObserver;
  };

  const armLongTask = (lifecycle) => {
    track(lifecycle);
    if (!on || longObserver) return longObserver;
    longObserver = makeObserver("longtask", (entry) => {
      if (!isPlexusLongTask(entry)) return false;
      longCount += 1;
      longtask.push(entry?.duration);
      return true;
    });
    return longObserver;
  };

  const bind = (next) => {
    if (!next || typeof next !== "object") return;
    stats = next;
    if (!on) stats.perf = null;
  };

  const cancelPan = () => {
    pan.deltas = null;
    pan.last = null;
    if (pan.raf) {
      try { globalThis.cancelAnimationFrame?.(pan.raf); } catch { /* stub */ }
      pan.raf = 0;
    }
  };

  const cancelOpens = () => {
    for (const cancel of watches) {
      try { cancel(); } catch { /* already stopped */ }
    }
    watches.clear();
  };

  function stop() {
    on = false;
    cancelPan();
    cancelOpens();
    try { eventObserver?.disconnect(); } catch { /* already disconnected */ }
    try { longObserver?.disconnect(); } catch { /* already disconnected */ }
    eventObserver = null;
    longObserver = null;
    open.clear();
    click.clear();
    fps.clear();
    longtask.clear();
    longCount = 0;
    if (stats) stats.perf = null;
    publishLatest(null);
  }

  const start = ({ stats: next, lifecycle, events = true, tasks = true } = {}) => {
    if (next) bind(next);
    track(lifecycle);
    on = true;
    if (events) armEvent(lifecycle);
    if (tasks) armLongTask(lifecycle);
    publish();
  };

  const beginPan = () => {
    if (!on || pan.deltas) return false;
    pan.deltas = [];
    pan.last = null;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== "function") return true;
    const step = (t) => {
      if (!pan.deltas) return;
      if (pan.last != null) pan.deltas.push(t - pan.last);
      pan.last = t;
      pan.raf = raf(step);
    };
    pan.raf = raf(step);
    return true;
  };

  const endPan = () => {
    if (!pan.deltas) return null;
    const deltas = pan.deltas;
    cancelPan();
    if (!on) return null;
    const value = panFps(deltas);
    if (value == null) return null;
    fps.push(value);
    publish();
    return value;
  };

  const watchOpen = (mountEl, t0) => {
    if (!on || !mountEl) return () => {};
    const finish = () => {
      const ms = perfNow() - t0;
      if (Number.isFinite(ms) && ms >= 0) open.push(ms);
      publish();
    };
    if (mountEl.querySelector?.(".pxd-item")) {
      finish();
      return () => {};
    }
    let stopped = false;
    const cancel = () => { stopped = true; };
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== "function") {
      queueMicrotask(() => {
        if (!stopped && on && mountEl.querySelector?.(".pxd-item")) finish();
      });
      watches.add(cancel);
      return cancel;
    }
    let left = OPEN_FRAMES;
    let id = 0;
    const step = () => {
      if (stopped || !on) return;
      if (mountEl.isConnected === false) return;
      if (mountEl.querySelector?.(".pxd-item")) { finish(); return; }
      left -= 1;
      if (left <= 0) return;
      id = raf(step);
    };
    const stopWatch = () => {
      stopped = true;
      if (id) try { globalThis.cancelAnimationFrame?.(id); } catch { /* stub */ }
    };
    watches.add(stopWatch);
    id = raf(step);
    return stopWatch;
  };

  return {
    bind,
    start,
    stop,
    armEvent,
    armLongTask,
    beginPan,
    endPan,
    cancelPan,
    watchOpen,
    current,
    get enabled() { return on; },
  };
}
