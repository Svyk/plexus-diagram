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
// E5 (perf2, speed flag gestureQuiet): no background slice while a board gesture is held (wheel burst, drag pan,
// pinch, card drag; the view holds it until its settle) or until the camera has been still this long. The open
// tail's reader, captures and primes ran inside pan bursts and the first seconds after live on the PhD main board.
export const BG_CAMERA_QUIET_MS = 500;
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
  gestureQuiet = () => false,
  cameraQuietMs = BG_CAMERA_QUIET_MS,
} = {}) {
  let lastInput = -Infinity;
  let lastCamera = -Infinity;
  const holds = new Set();
  const quietOn = () => { try { return gestureQuiet() === true; } catch { return false; } };
  // How long the gesture rules still hold background work back (0 = free to run).
  const gestureWait = () => {
    if (!quietOn()) return 0;
    if (holds.size) return quietMs;
    return Math.max(0, cameraQuietMs - (now() - lastCamera));
  };
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
  // Slices that ran past twice the slice budget, by job label (the last 40), for the live speed checks.
  const overruns = [];
  listen();

  // fn(deadline) runs once, in a quiet idle slice. deadline.timeRemaining() is the smaller of the browser's idle time
  // and what is left of this slice's work budget; didTimeout is always false (a callback forced by its timeout in a
  // busy window gets 0 ms and should do one small part at most). Returns cancel().
  // `since`: quiet also counts from this time (a job that must wait `quiet` ms after it was scheduled).
  // `delay`: wait this long before asking for the idle slice (the duty-cycle gap of a job in parts).
  // `urgent`: no duty-cycle wait before this job's slices (it still waits for quiet and still owes a gap to others).
  function idle(fn, { timeout = 1500, quiet = quietMs, since = -Infinity, delay = 0, label = "", urgent = false } = {}) {
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
      const wait = Math.max(quiet - Math.min(quietFor(), now() - since), urgent ? 0 : nextAt - now(), gestureWait());
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
          if (quietFor() < quietMs || gestureWait() > 0) return 0;
          const left = sliceMs - (now() - t0);
          const idleLeft = real ? (d.didTimeout ? 0 : real.timeRemaining()) : left;
          return Math.max(0, Math.min(left, idleLeft));
        },
      };
      try {
        fn(deadline);
      } finally {
        const spent = now() - t0;
        if (spent > 2 * sliceMs) { overruns.push({ label: label || "?", ms: Math.round(spent) }); if (overruns.length > 40) overruns.shift(); }
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
  function run(part, { timeout = 1500, quiet = quietMs, firstQuiet = quiet, partMs = 0, label = "", urgent = false } = {}) {
    let cancel = null;
    let stopped = false;
    const need = () => Math.max(0.001, typeof partMs === "function" ? Number(partMs()) || 0 : partMs);
    const slice = (deadline) => {
      if (stopped) return;
      let done = false;
      do {
        try { done = part(deadline) === true; } catch (err) { done = true; console.error("[plexus-diagram] background job", err); }
      } while (!done && !stopped && deadline.timeRemaining() >= need());
      if (!done && !stopped) cancel = idle(slice, { timeout, quiet, label, urgent });
    };
    cancel = idle(slice, { timeout, quiet: firstQuiet, since: firstQuiet > quiet ? now() : -Infinity, label, urgent });
    return () => { stopped = true; cancel?.(); };
  }

  return {
    idle,
    run,
    noteInput: () => { lastInput = now(); },
    // The camera moved (any cause: wheel, drag, Fit, zoom buttons, an eased move).
    noteCamera: () => { lastCamera = now(); },
    // hold(key, true) while a gesture runs; hold(key, false) at its settle starts the input quiet from there.
    hold: (key, on) => {
      if (on) holds.add(key);
      else if (holds.delete(key) && quietOn()) lastInput = now();
    },
    held: () => holds.size > 0,
    quietFor,
    overruns,
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
let quietFlag = () => false;
export function bindBgBudgetFlag(fn) { flagOn = typeof fn === "function" ? fn : () => true; }
export function bindBgGestureFlag(fn) { quietFlag = typeof fn === "function" ? fn : () => false; }
export function sharedBgBudget() {
  if (!shared) shared = createBgBudget({ enabled: () => flagOn(), gestureQuiet: () => quietFlag() });
  return shared;
}
export function resetSharedBgBudget() {
  shared?.dispose();
  shared = null;
}
