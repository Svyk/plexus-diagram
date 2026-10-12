// Roam caps API mutations at 1500 per 60 s per window ("roamAlphaApi maximum mutation rate limit exceeded"), and
// navigation (openDailyNotes, openBlock) counts too. One sliding-window budget for every writer in this process,
// kept under the cap so Plexus and the user still have room.
export const WINDOW_MS = 60000;
export const BUDGET = Number(process.env.PHD_MUTATION_BUDGET || 1300);
export const RATE_RE = /maximum mutation rate limit/i;

export function createLimiter({ budget = BUDGET, windowMs = WINDOW_MS, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const log = []; // [time, cost]
  let waitedMs = 0;
  const used = (t) => {
    while (log.length && log[0][0] <= t - windowMs) log.shift();
    return log.reduce((n, [, c]) => n + c, 0);
  };
  return {
    // Waits until `cost` more mutations fit in the window, then books them. A cost above the budget books the budget.
    async take(cost) {
      const c = Math.min(Math.max(0, cost), budget);
      for (;;) {
        const t = now();
        if (used(t) + c <= budget) { log.push([t, c]); return; }
        const wait = Math.max(50, log[0][0] + windowMs - t + 10);
        waitedMs += wait;
        await sleep(wait);
      }
    },
    // After Roam refused a write: treat the window as full for one window from now.
    async saturate() {
      log.length = 0;
      log.push([now(), budget]);
    },
    used: () => used(now()),
    waitedMs: () => waitedMs,
  };
}

export const limiter = createLimiter();
