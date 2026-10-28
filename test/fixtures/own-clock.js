// A test-owned clock for the background budget and the host's check timers. performance.now is virtual and moves
// only when the test moves it (advance, or a turn of untilTurns). Background-budget and check-retry timers
// of 300 ms to 10 s (the check's quiet window, retry backoff, duty-cycle gaps) are armed at 1 ms instead: they are decided by the virtual
// clock when they fire, and re-arm until the test has moved it far enough. So no test waits real seconds, and a busy
// machine only makes each turn slower. `tick` is a real short wait; it is not compressed.
const realSetTimeout = globalThis.setTimeout;
export const tick = (ms = 5) => new Promise((resolve) => { realSetTimeout(resolve, ms); });

export function installOwnClock() {
  const realNow = globalThis.performance.now;
  const clock = { t: 1_000_000 };
  globalThis.performance.now = () => clock.t;
  // Only the budget's waits and the host's check retries are armed short (the virtual clock still decides whether
  // they have waited long enough). Other long timers stay real: the IDB open cap and the minute-long split hold are not ours to speed up.
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms >= 300 && ms <= 10_000 && /bg-budget\.js|host\/roam\.js/.test(new Error().stack.split("\n")[2] || "")) {
      return realSetTimeout(fn, 1, ...rest);
    }
    return realSetTimeout(fn, ms, ...rest);
  };
  return {
    clock,
    advance(ms) { clock.t += ms; },
    restore() {
      globalThis.performance.now = realNow;
      globalThis.setTimeout = realSetTimeout;
    },
  };
}

// Waits for fn() by turns, not by wall time. Each turn moves the virtual clock on, then yields a short real wait.
export async function untilTurns(own, fn, turns = 3000, stepMs = 500) {
  for (let i = 0; !fn(); i += 1) {
    if (i >= turns) throw new Error("timed out");
    own.advance(stepMs);
    await tick(5);
  }
}
