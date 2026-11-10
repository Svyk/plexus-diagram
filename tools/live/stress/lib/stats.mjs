// Small pure statistics helpers for the stress tools. Node: `node stats.mjs --selftest`.
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const nums = (list) => (list || []).filter((x) => typeof x === "number" && Number.isFinite(x));

// nearest-rank percentile on a sorted copy; p in 0..100
export function pct(list, p) {
  const a = nums(list).sort((x, y) => x - y);
  if (!a.length) return null;
  const rank = Math.ceil((p / 100) * a.length);
  return a[Math.min(a.length - 1, Math.max(0, rank - 1))];
}
export function median(list) {
  const a = nums(list).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function mean(list) {
  const a = nums(list);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
// median absolute deviation
export function mad(list) {
  const a = nums(list);
  if (!a.length) return null;
  const m = median(a);
  return median(a.map((x) => Math.abs(x - m)));
}
export function summarize(list) {
  const a = nums(list);
  if (!a.length) return { n: 0, min: null, p50: null, mean: null, max: null, mad: null };
  return { n: a.length, min: Math.min(...a), p50: median(a), mean: mean(a), max: Math.max(...a), mad: mad(a) };
}
// A/A run pair: how far two identical runs drift apart
export function noiseFloor(a, b) {
  const delta = Math.abs((median(a) ?? 0) - (median(b) ?? 0));
  const spread = Math.max(mad(a) ?? 0, mad(b) ?? 0);
  return { delta, spread, floor: Math.max(delta, spread) };
}
// a is the baseline, b the candidate; lower is better
export function verdict(a, b, floor) {
  const ma = median(a), mb = median(b);
  if (ma == null || mb == null) return { delta: null, rel: null, beats: false, better: null };
  const delta = mb - ma;
  const rel = ma !== 0 ? delta / Math.abs(ma) : null;
  const beats = Math.abs(delta) > (floor ?? 0);
  return { delta, rel, beats, better: beats ? (delta < 0 ? "b" : "a") : null };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--selftest")) {
  assert.strictEqual(pct([], 50), null);
  assert.strictEqual(pct([5, 1, 3, 2, 4], 50), 3);
  assert.strictEqual(pct([5, 1, 3, 2, 4], 95), 5);
  assert.strictEqual(pct([5, 1, 3, 2, 4], 0), 1);
  assert.strictEqual(pct([10, 20, 30, 40], 25), 10);
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(median([]), null);
  assert.strictEqual(mean([1, 2, 3]), 2);
  assert.strictEqual(mad([1, 2, 3, 4, 100]), 1);
  assert.deepStrictEqual(summarize([]), { n: 0, min: null, p50: null, mean: null, max: null, mad: null });
  assert.deepStrictEqual(summarize([1, 3, 5]), { n: 3, min: 1, p50: 3, mean: 3, max: 5, mad: 2 });
  const nf = noiseFloor([10, 10, 12], [11, 11, 13]);
  assert.strictEqual(nf.delta, 1);
  assert.strictEqual(nf.spread, 0);
  assert.strictEqual(nf.floor, 1);
  const v = verdict([100, 100, 100], [60, 60, 60], 5);
  assert.deepStrictEqual(v, { delta: -40, rel: -0.4, beats: true, better: "b" });
  assert.strictEqual(verdict([100], [103], 5).beats, false);
  assert.strictEqual(verdict([100], [130], 5).better, "a");
  assert.strictEqual(verdict([], [1], 1).better, null);
  console.log("selftest ok");
}
