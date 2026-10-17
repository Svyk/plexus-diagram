// E2-5 (perf2): which Plexus job ran inside each long task. Plexus code that can take a while runs through `span(name,
// fn)` (the view's frame, settle, resume and slices, the shell pump, the content frames, every background-budget job by
// its label). The browser's long tasks (PerformanceObserver "longtask") are matched against those spans; where the
// observer does not exist (or before the first read arms it), a span of LONG_MS or more stands in for its task. Read
// with view.longTasks(); call it once before the gesture to arm the observer.
export const LONG_MS = 100;
const SPAN_MIN_MS = 2;
const MAX_SPANS = 600;
const MAX_TASKS = 60;

export function createTaskProbe({ now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()), win = globalThis } = {}) {
  const spans = [];
  const tasks = [];
  let depth = 0;
  let observer = null;
  const observe = () => {
    if (observer || typeof win?.PerformanceObserver !== "function") return;
    try {
      observer = new win.PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration < LONG_MS) continue;
          tasks.push({ start: e.startTime, ms: e.duration });
          if (tasks.length > MAX_TASKS) tasks.shift();
        }
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch { observer = null; }
  };
  // Nested spans count once, under the outermost name (a settle that runs a content pass is the settle's time).
  // name: a string, or a function that returns it (read only for a span that is kept).
  // phase: what the board was doing (wheel, pan, settle, slice, idle...), from the caller.
  const span = (name, fn, phase = "") => {
    if (depth > 0) return fn();
    depth += 1;
    const t0 = now();
    try {
      return fn();
    } finally {
      depth -= 1;
      const ms = now() - t0;
      if (ms >= SPAN_MIN_MS) {
        let label = name;
        if (typeof name === "function") { try { label = String(name()); } catch { label = "?"; } }
        spans.push({ name: label, start: t0, ms, phase });
        if (spans.length > MAX_SPANS) spans.shift();
      }
    }
  };
  // [{ start, ms, jobs: [{ name, ms }], phase, plexusMs }] newest last. `jobs` is Plexus time inside the task by job;
  // the rest of the task is the browser (style, layout, paint), Roam or another extension.
  // The first call arms the browser's long-task observer (no page observer until a probe asks; spans are always kept).
  const longTasks = () => {
    observe();
    const source = observer && tasks.length ? tasks : spans.filter((s) => s.ms >= LONG_MS).map((s) => ({ start: s.start, ms: s.ms }));
    return source.map((t) => {
      const by = new Map();
      let phase = "";
      for (const s of spans) {
        if (s.start + s.ms < t.start || s.start > t.start + t.ms) continue;
        by.set(s.name, (by.get(s.name) || 0) + s.ms);
        if (!phase && s.phase) phase = s.phase;
      }
      const jobs = [...by].map(([name, ms]) => ({ name, ms: Math.round(ms) })).sort((a, b) => b.ms - a.ms);
      return { start: Math.round(t.start), ms: Math.round(t.ms), jobs, phase, plexusMs: jobs.reduce((n, j) => n + j.ms, 0) };
    });
  };
  return {
    span,
    longTasks,
    spans: () => spans.slice(),
    observe,
    clear: () => { spans.length = 0; tasks.length = 0; },
    dispose: () => { try { observer?.disconnect?.(); } catch { /* gone */ } observer = null; },
  };
}

let shared = null;
export function sharedTaskProbe() {
  if (!shared) shared = createTaskProbe();
  return shared;
}
export function resetSharedTaskProbe() {
  shared?.dispose();
  shared = null;
}
