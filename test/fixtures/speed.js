import { cpuNow } from "./cpu-clock.js";

// Speed budgets in reference-machine milliseconds. CPU time alone still fails on a shared CI runner: its cores do the
// same work 2-3x slower (PXD-14: 7.7 ms here, 20.1 ms there). So a fixed yardstick workload is timed right before and
// after the code under test, and the budget grows by how much slower than the reference the yardstick ran, never
// shrinking below the stated budget. A real regression still moves the code against the yardstick.

// Best yardstick CPU time on the machine the budgets were set on (Apple M-series, Node 22).
export const YARDSTICK_MS = 2.8;

const POINTS = Array.from({ length: 64 }, (_, i) => ({ lab: [(i * 37) % 100 / 100, ((i * 11) % 80 - 40) / 100, ((i * 53) % 80 - 40) / 100], weight: (i % 7 + 1) / 28 }));

// Float maths over small arrays of objects plus short strings and a map: roughly the model code these budgets time.
export function yardstick() {
  let sink = 0;
  const seen = new Map();
  for (let round = 0; round < 600; round += 1) {
    for (let i = 0; i < POINTS.length; i += 1) {
      const a = POINTS[i];
      for (let j = i + 1; j < POINTS.length; j += 4) {
        const b = POINTS[j];
        const dl = a.lab[0] - b.lab[0];
        const da = a.lab[1] - b.lab[1];
        const db = a.lab[2] - b.lab[2];
        sink += Math.sqrt(dl * dl + da * da + db * db) * Math.min(a.weight, b.weight);
      }
      const key = `k${(i * round) % 97}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  return sink + seen.size;
}

export function bestCpuMs(fn, runs = 5) {
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const t0 = cpuNow();
    fn();
    best = Math.min(best, cpuNow() - t0);
  }
  return best;
}

// How many times slower than the reference machine this one runs right now; at least 1.
export function slowdown() {
  let sink = 0;
  const ms = bestCpuMs(() => { sink += yardstick(); }, 5);
  if (!(sink > 0)) throw new Error("yardstick sink");
  return Math.max(1, ms / YARDSTICK_MS);
}

// Times fn (best of `runs`; pass runs: 1 when a second call would hit a cache) and returns the verdict pieces.
export function measureBudget(fn, budgetMs, { runs = 5 } = {}) {
  const before = slowdown();
  const ms = bestCpuMs(fn, runs);
  const scale = Math.max(before, slowdown());
  return { ms, scale, limit: budgetMs * scale, ok: ms < budgetMs * scale };
}

export function budgetMessage(label, { ms, scale, limit }) {
  return `${label} took ${ms.toFixed(1)} ms; limit ${limit.toFixed(1)} ms (${scale.toFixed(2)}x slowdown)`;
}
