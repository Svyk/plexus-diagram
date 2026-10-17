// PERF5-P1: where the time goes between a key and its paint. Two browser timelines, read together:
// - Event Timing ("event"): per keydown/input, the input delay, the handlers' time and the presentation delay (style,
//   layout, paint and any other task until the next frame is shown).
// - Long Animation Frames ("long-animation-frame"): each slow frame with its render phase, its style+layout phase and
//   the scripts that ran in it by source file and function, with the style/layout each script forced.
// Plexus spans (long-tasks.js) inside the same frames give the Plexus share. Read with view.typingProfile(): the first
// call arms both observers, later calls return the summary since arming; { reset: true } re-arms.
const KEY_EVENTS = new Set(["keydown", "keypress", "beforeinput", "input", "keyup"]);
const MAX_ENTRIES = 400;

const base = (url) => {
  const s = String(url || "");
  if (!s) return "";
  const cut = s.split(/[?#]/)[0];
  return cut.slice(cut.lastIndexOf("/") + 1) || cut;
};
const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] * 10) / 10;
};
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

export function createInputProfile({ win = globalThis, spans = () => [] } = {}) {
  let events = [];
  let frames = [];
  let observers = [];
  let armedAt = 0;
  const now = () => (win?.performance?.now ? win.performance.now() : Date.now());
  const watch = (type, opts, sink) => {
    const PO = win?.PerformanceObserver;
    if (typeof PO !== "function") return false;
    try {
      const o = new PO((list) => {
        for (const e of list.getEntries()) {
          sink.push(e);
          if (sink.length > MAX_ENTRIES) sink.shift();
        }
      });
      o.observe({ type, buffered: false, ...opts });
      observers.push(o);
      return true;
    } catch { return false; }
  };
  const disarm = () => {
    for (const o of observers) { try { o.disconnect(); } catch { /* gone */ } }
    observers = [];
  };
  const arm = () => {
    disarm();
    events = [];
    frames = [];
    armedAt = now();
    const ev = watch("event", { durationThreshold: 16 }, events);
    const lf = watch("long-animation-frame", {}, frames);
    return { armed: true, event: ev, loaf: lf };
  };
  const summary = () => {
    const keys = events.filter((e) => KEY_EVENTS.has(e.name)).map((e) => {
      const start = Number(e.startTime) || 0;
      const ps = Number(e.processingStart) || start;
      const pe = Number(e.processingEnd) || ps;
      const end = start + (Number(e.duration) || 0);
      return { at: Math.round(start - armedAt), type: e.name, ms: r1(e.duration), delay: r1(ps - start), handlers: r1(pe - ps), present: r1(end - pe) };
    });
    const bySrc = new Map();
    let renderSum = 0;
    let styleSum = 0;
    let scriptSum = 0;
    let forcedSum = 0;
    const plexusSpans = spans() || [];
    let plexusMs = 0;
    const frameRows = frames.map((f) => {
      const start = Number(f.startTime) || 0;
      const end = start + (Number(f.duration) || 0);
      const render = f.renderStart > 0 ? end - f.renderStart : 0;
      const style = f.styleAndLayoutStart > 0 ? end - f.styleAndLayoutStart : 0;
      renderSum += render;
      styleSum += style;
      for (const s of f.scripts || []) {
        const key = `${base(s.sourceURL)}|${s.sourceFunctionName || ""}|${s.invokerType || ""}:${String(s.invoker || "").slice(0, 60)}`;
        const row = bySrc.get(key) || { src: base(s.sourceURL), fn: s.sourceFunctionName || "", invoker: `${s.invokerType || ""}:${String(s.invoker || "").slice(0, 60)}`, ms: 0, forcedMs: 0, n: 0 };
        row.ms += Number(s.duration) || 0;
        row.forcedMs += Number(s.forcedStyleAndLayoutDuration) || 0;
        row.n += 1;
        bySrc.set(key, row);
        scriptSum += Number(s.duration) || 0;
        forcedSum += Number(s.forcedStyleAndLayoutDuration) || 0;
      }
      let px = 0;
      for (const s of plexusSpans) if (s.start < end && s.start + s.ms > start) px += Math.min(end, s.start + s.ms) - Math.max(start, s.start);
      plexusMs += px;
      return { at: Math.round(start - armedAt), ms: r1(f.duration), blocking: r1(f.blockingDuration), render: r1(render), styleLayout: r1(style), scripts: (f.scripts || []).length, plexus: r1(px) };
    });
    const scripts = [...bySrc.values()].map((s) => ({ ...s, ms: r1(s.ms), forcedMs: r1(s.forcedMs) })).sort((a, b) => b.ms - a.ms).slice(0, 15);
    const keydowns = keys.filter((k) => k.type === "keydown");
    return {
      sinceMs: Math.round(now() - armedAt),
      keys: keydowns.length,
      key: { ms: median(keydowns.map((k) => k.ms)), delay: median(keydowns.map((k) => k.delay)), handlers: median(keydowns.map((k) => k.handlers)), present: median(keydowns.map((k) => k.present)) },
      events: keys.slice(-60),
      frames: { n: frameRows.length, ms: r1(frameRows.reduce((n, f) => n + f.ms, 0)), render: r1(renderSum), styleLayout: r1(styleSum), script: r1(scriptSum), forced: r1(forcedSum), plexus: r1(plexusMs), list: frameRows.slice(-40) },
      scripts,
    };
  };
  return {
    read({ reset = false } = {}) {
      if (!observers.length || reset) return arm();
      return summary();
    },
    dispose: disarm,
  };
}
