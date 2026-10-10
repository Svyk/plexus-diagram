// GriTS (Smock, Pesala, Abraham 2022, arXiv 2203.12555) with the factored 2D-MSS approximation:
// rows and columns are each aligned by an order-preserving DP, then f is summed over the aligned grid.
import { jaccard, normText } from "../../test/parse-metrics.js";

const fold = (s) => normText(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

export function toGrid(cells, infos = new Map()) {
  let rows = 0;
  let cols = 0;
  for (const c of cells || []) {
    rows = Math.max(rows, c.r + (c.rowSpan || 1));
    cols = Math.max(cols, c.c + (c.colSpan || 1));
  }
  const grid = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => ({ text: "", info: null, box: [i, j, i, j], unsure: false })));
  for (const c of cells || []) {
    const r1 = c.r + (c.rowSpan || 1) - 1;
    const c1 = c.c + (c.colSpan || 1) - 1;
    const text = fold(c.text);
    let info = infos.get(text);
    if (!info) { info = makeInfo(text, infos.size); infos.set(text, info); }
    for (let i = c.r; i <= r1; i++) {
      for (let j = c.c; j <= c1; j++) grid[i][j] = { text, info, box: [c.r, c.c, r1, c1], unsure: !!c.unsure };
    }
  }
  return { rows, cols, grid };
}

// Per distinct text: length and, when it fits in 30 bits, an ASCII mask table for bit-parallel LCS.
function makeInfo(text, id) {
  const info = { text, len: text.length, id, masks: null };
  if (text.length && text.length <= 30) {
    const masks = new Int32Array(128);
    let ascii = true;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch >= 128) { ascii = false; break; }
      masks[ch] |= 1 << i;
    }
    if (ascii) info.masks = masks;
  }
  return info;
}

// LCS length, Hyyro bit-parallel when the mask side is short ASCII; plain DP otherwise.
function lcsInfo(x, y) {
  const [a, b] = x.len >= y.len ? [x, y] : [y, x];
  if (!b.len) return 0;
  if (b.masks) {
    const M = b.masks;
    const full = 2 ** b.len - 1;
    const t = a.text;
    let V = full;
    for (let i = 0; i < t.length; i++) {
      const ch = t.charCodeAt(i);
      const mk = ch < 128 ? M[ch] : 0;
      if (!mk) continue;
      const U = V & mk;
      V = ((V + U) | (V - U)) & full;
    }
    let z = ~V & full;
    z -= (z >>> 1) & 0x55555555;
    z = (z & 0x33333333) + ((z >>> 2) & 0x33333333);
    return Math.imul((z + (z >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }
  const ta = a.text;
  const tb = b.text;
  let prev = new Uint16Array(tb.length + 1);
  let cur = new Uint16Array(tb.length + 1);
  for (let i = 1; i <= ta.length; i++) {
    for (let j = 1; j <= tb.length; j++) {
      cur[j] = ta.charCodeAt(i - 1) === tb.charCodeAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[tb.length];
}

function boxIou(a, b) {
  const r0 = Math.max(a[0], b[0]);
  const c0 = Math.max(a[1], b[1]);
  const r1 = Math.min(a[2], b[2]);
  const c1 = Math.min(a[3], b[3]);
  const inter = r1 >= r0 && c1 >= c0 ? (r1 - r0 + 1) * (c1 - c0 + 1) : 0;
  const area = (x) => (x[2] - x[0] + 1) * (x[3] - x[1] + 1);
  return inter / (area(a) + area(b) - inter);
}

// Order-preserving alignment maximising the summed score; returns { total, pairs }.
function align(n, m, score, wantPairs) {
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + score(i - 1, j - 1));
    }
  }
  const pairs = [];
  if (wantPairs) {
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      const s = score(i - 1, j - 1);
      if (s > 0 && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + s)) < 1e-9) { pairs.push([i - 1, j - 1]); i--; j--; }
      else if (dp[i][j] === dp[i - 1][j]) i--;
      else j--;
    }
    pairs.reverse();
  }
  return { total: dp[n][m], pairs };
}

function gritsWith(predCells, truthCells, makeFn) {
  const infosA = new Map();
  const infosB = new Map();
  const A = toGrid(predCells, infosA);
  const B = toGrid(truthCells, infosB);
  const sizeA = A.rows * A.cols;
  const sizeB = B.rows * B.cols;
  if (!sizeA || !sizeB) return { score: sizeA + sizeB ? 0 : 1, matched: 0, sizeA, sizeB };
  const fn = makeFn(infosA.size, infosB.size);
  const { rows: nA, cols: mA } = A;
  const { rows: nB, cols: mB } = B;
  // F[(i, j, k, l)] = f(A[i][j], B[k][l]), laid out so both alignment passes are plain array reads.
  const F = new Float64Array(sizeA * sizeB);
  for (let i = 0; i < nA; i++) {
    for (let j = 0; j < mA; j++) {
      const base = (i * mA + j) * sizeB;
      for (let k = 0; k < nB; k++) {
        for (let l = 0; l < mB; l++) F[base + k * mB + l] = fn(A.grid[i][j], B.grid[k][l], i, j, k, l);
      }
    }
  }
  const at = (i, j, k, l) => F[(i * mA + j) * sizeB + k * mB + l];
  const rowScore = (i, k) => align(mA, mB, (j, l) => at(i, j, k, l), false).total;
  const rowAl = align(nA, nB, rowScore, true).pairs;
  const colScore = (j, l) => align(nA, nB, (i, kk) => at(i, j, kk, l), false).total;
  const colAl = align(mA, mB, colScore, true).pairs;
  let matched = 0;
  for (const [i, k] of rowAl) for (const [j, l] of colAl) matched += at(i, j, k, l);
  return { score: (2 * matched) / (sizeA + sizeB), matched, sizeA, sizeB };
}

export function gritsCon(predCells, truthCells) {
  return gritsWith(predCells, truthCells, () => (a, b) => {
    if (b.unsure || a.text === b.text) return 1;
    if (!a.info || !b.info) return 0;
    return (2 * lcsInfo(a.info, b.info)) / (a.info.len + b.info.len);
  });
}

export function gritsTop(predCells, truthCells) {
  return gritsWith(predCells, truthCells, () => (a, b, i, j, k, l) =>
    boxIou([a.box[0] - i, a.box[1] - j, a.box[2] - i, a.box[3] - j], [b.box[0] - k, b.box[1] - l, b.box[2] - k, b.box[3] - l]));
}

// Same pairing as scan-score.scorePage: greedy per truth table, text Jaccard > 0.2, unsure truth cells ignored.
export function matchTable(t, preds, used) {
  let best = null;
  for (const p of preds) {
    if (used.has(p.id)) continue;
    const s = jaccard(
      (p.cells || []).map((c) => normText(c.text)).filter(Boolean),
      (t.cells || []).filter((c) => !c.unsure).map((c) => normText(c.text)).filter(Boolean),
    );
    if (!best || s > best.score) best = { p, score: s };
  }
  return best && best.score > 0.2 ? best.p : null;
}

export function gritsPage(predTables, truthTables, { match = matchTable } = {}) {
  const preds = predTables || [];
  const truths = truthTables || [];
  if (!truths.length && !preds.length) return { con: 1, top: 1 };
  if (!truths.length) return { con: 0, top: 0 };
  const used = new Set();
  const acc = { con: { m: 0, n: 0 }, top: { m: 0, n: 0 } };
  const add = (k, r) => { acc[k].m += r.matched; acc[k].n += r.sizeA + r.sizeB; };
  for (const t of truths) {
    const p = match(t, preds, used);
    if (p) used.add(p.id);
    const pc = p ? p.cells || [] : [];
    add("con", gritsCon(pc, t.cells || []));
    add("top", gritsTop(pc, t.cells || []));
  }
  for (const p of preds) {
    if (used.has(p.id)) continue;
    add("con", gritsCon(p.cells || [], []));
    add("top", gritsTop(p.cells || [], []));
  }
  const fin = (a) => (a.n ? (2 * a.m) / a.n : 1);
  return { con: fin(acc.con), top: fin(acc.top) };
}
