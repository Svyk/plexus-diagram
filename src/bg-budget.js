// P8 U2. One background budget for the work that follows an open (links, ref and stat priming, PDF title repaints,
// snapshot capture). A job runs in requestIdleCallback slices that stop at the idle deadline and at BG_SLICE_MS of
// work, never while wheel, pointer or key input is active or for BG_QUIET_MS after it, and a job may ask for a longer
// quiet start (derived links wait for the board to sit still). No scheduler.yield: it starves Roam's timers.
// Speed flag bgBudget off: plain requestIdleCallback as before.

export const BG_SLICE_MS = 30;
export const BG_QUIET_MS = 300;
// Background work takes at most this share of the main thread: after a slice of X ms (any job) the next slice
// (any job) waits X * (1 - BG_DUTY) / BG_DUTY ms (3X).
export const BG_DUTY = 0.25;
export const BG_GAP_MIN_MS = 5;
const INPUT_EVENTS = ["wheel", "pointerdown", "pointermove", "keydown", "touchstart", "touchmove"];

export function createBgBudget({
  win = globalThis,
  now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
  ric = (fn, opts) => (typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(fn, opts) : setTimeout(() => fn({ timeRemaining: () => 12, didTimeout: true }), 0)),
  cic = (id) => { try { if (typeof win.cancelIdleCallback === "function") win.cancelIdleCallback(id); else clearTimeout(id); } catch { /* gone */ } },
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  sliceMs = BG_SLICE_MS,
  quietMs = BG_QUIET_MS,
  duty = BG_DUTY,
  enabled = () => true,
} = {}) {
  let lastInput = -Infinity;
  let listening = false;
  // A hover is not a gesture: pointermove counts only with a button down.
  const onInput = (ev) => {
    if (ev?.type === "pointermove" && !ev.buttons) return;
    lastInput = now();
  };
  const listen = () => {
    if (listening || typeof win?.addEventListener !== "function") return;
    listening = true;
    for (const type of INPUT_EVENTS) {
      try { win.addEventListener(type, onInput, { capture: true, passive: true }); } catch { /* no window */ }
    }
  };
  const quietFor = () => now() - lastInput;
  let nextAt = -Infinity;
  listen();

  // fn(deadline) runs once, in a quiet idle slice. deadline.timeRemaining() is the smaller of the browser's idle time
  // and what is left of this slice's work budget; didTimeout is always false (a callback forced by its timeout in a
  // busy window gets 0 ms and should do one small part at most). Returns cancel().
  // `since`: quiet also counts from this time (a job that must wait `quiet` ms after it was scheduled).
  // `delay`: wait this long before asking for the idle slice (the duty-cycle gap of a job in parts).
  function idle(fn, { timeout = 1500, quiet = quietMs, since = -Infinity, delay = 0 } = {}) {
    if (!enabled()) {
      let id = null;
      try { id = ric((d) => fn(d), { timeout }); } catch { id = null; }
      return () => { if (id != null) cic(id); };
    }
    listen();
    let idleId = null;
    let timerId = null;
    let cancelled = false;
    const arm = () => {
      if (cancelled) return;
      idleId = ric(run, { timeout });
    };
    const run = (d) => {
      idleId = null;
      if (cancelled) return;
      const wait = Math.max(quiet - Math.min(quietFor(), now() - since), nextAt - now());
      if (wait > 0) {
        timerId = setTimer(() => { timerId = null; arm(); }, Math.ceil(wait));
        try { timerId?.unref?.(); } catch { /* fake timer */ }
        return;
      }
      const t0 = now();
      const real = typeof d?.timeRemaining === "function" ? d : null;
      const deadline = {
        didTimeout: false,
        timeRemaining: () => {
          if (quietFor() < quietMs) return 0;
          const left = sliceMs - (now() - t0);
          const idleLeft = real ? (d.didTimeout ? 0 : real.timeRemaining()) : left;
          return Math.max(0, Math.min(left, idleLeft));
        },
      };
      try {
        fn(deadline);
      } finally {
        const spent = now() - t0;
        // A slice of a few ms does not move the share; only real work owes a gap.
        if (duty > 0 && duty < 1 && spent >= BG_GAP_MIN_MS) nextAt = now() + (spent * (1 - duty)) / duty;
      }
    };
    if (delay > 0) {
      timerId = setTimer(() => { timerId = null; arm(); }, Math.ceil(delay));
      try { timerId?.unref?.(); } catch { /* fake timer */ }
    } else arm();
    return () => {
      cancelled = true;
      if (idleId != null) cic(idleId);
      if (timerId != null) clearTimer(timerId);
      idleId = null;
      timerId = null;
    };
  }

  // A job in parts: part(deadline) does one part and returns true when the job is finished. Parts run while the slice
  // has `partMs` left (one at least per slice; a number or a function), then the job waits out its duty-cycle gap and
  // the next quiet idle slice. Returns cancel().
  function run(part, { timeout = 1500, quiet = quietMs, firstQuiet = quiet, partMs = 0 } = {}) {
    let cancel = null;
    let stopped = false;
    const need = () => Math.max(0.001, typeof partMs === "function" ? Number(partMs()) || 0 : partMs);
    const slice = (deadline) => {
      if (stopped) return;
      let done = false;
      do {
        try { done = part(deadline) === true; } catch (err) { done = true; console.error("[plexus-diagram] background job", err); }
      } while (!done && !stopped && deadline.timeRemaining() >= need());
      if (!done && !stopped) cancel = idle(slice, { timeout, quiet });
    };
    cancel = idle(slice, { timeout, quiet: firstQuiet, since: firstQuiet > quiet ? now() : -Infinity });
    return () => { stopped = true; cancel?.(); };
  }

  return {
    idle,
    run,
    noteInput: () => { lastInput = now(); },
    quietFor,
    dispose() {
      if (!listening) return;
      listening = false;
      for (const type of INPUT_EVENTS) {
        try { win.removeEventListener(type, onInput, { capture: true }); } catch { /* gone */ }
      }
    },
  };
}

// The one budget every board on the page shares.
let shared = null;
let flagOn = () => true;
export function bindBgBudgetFlag(fn) { flagOn = typeof fn === "function" ? fn : () => true; }
export function sharedBgBudget() {
  if (!shared) shared = createBgBudget({ enabled: () => flagOn() });
  return shared;
}
export function resetSharedBgBudget() {
  shared?.dispose();
  shared = null;
}
