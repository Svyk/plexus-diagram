// Parse step: borderless and booktabs (stream) tables from aligned text. Pure.

import { cellTextOf, isNumericText, LEADER_RE } from "./lattice.js";
import { median, round } from "./lines.js";
import { markerOf } from "./lists.js";
import { CAPTION_RE } from "./headings.js";
import { equationRowSignals } from "./formulas.js";

const GAP_MIN = 3;

export function tokenizeLine(line) {
  const chars = Math.max(1, line.words.reduce((n, w) => n + w.text.length, 0));
  const inkW = line.words.reduce((n, w) => n + (w.x1 - w.x0), 0);
  const charW = inkW / chars || 0.5 * line.size;
  const threshold = Math.max(1.8 * charW, 0.6 * line.size);
  const tokens = [];
  let cur = null;
  const dots = (s) => /^[.·…]+$/.test(s);
  // OCR often leaves only a few points between numeric columns, inside the ordinary
  // word-space threshold, and splits a thousands group more tightly than that.
  // A comma-group ("10," "533,") stays one token. Two numbers a column-gap apart do not.
  const ocr = line.words.some((w) => w.conf != null);
  const yearSpan = (text) => /^(1[89]|20)\d{2}\s*[-–—]\s*(1[89]|20)\d{2}[.,]?$/.test(String(text || "").trim());
  const columnGap = (prev, w) => {
    if (!ocr || !prev) return false;
    const left = prev.words?.[prev.words.length - 1]?.text || "";
    // A year range and the quantity beside it are different cells even when the
    // boxes touch. A thousands group ("10," "533,") is a smaller gap and stays one token.
    if (yearSpan(left) && /\d/.test(w.text || "")) return true;
    // "10," "533," is one number even when the groups sit a few points apart.
    if (/,$/.test(String(left).trim())) return false;
    const gap = w.x0 - (prev.x1 ?? 0);
    if (gap < Math.max(2, 0.5 * (line.size || 8))) return false;
    return /\d/.test(left) && /\d/.test(w.text || "");
  };
  for (const w of line.words) {
    const prev = cur && cur.words[cur.words.length - 1];
    // A footnote letter sits in the value ("c 0.1654"), and a run of leader dots is one token.
    const glueLetter = cur && cur.words.length === 1 && /^[a-z]$/.test(cur.words[0].text) && isNumericText(w.text) && w.x0 - cur.x1 < 1.2 * (line.size || 10);
    const glueDots = prev && dots(prev.text) && dots(w.text);
    if (cur && !columnGap(cur, w) && (w.x0 - cur.x1 < threshold || glueLetter || glueDots)) { cur.words.push(w); cur.x1 = Math.max(cur.x1, w.x1); }
    else { cur = { x0: w.x0, x1: w.x1, words: [w] }; tokens.push(cur); }
  }
  for (const t of tokens) t.text = t.words.map((w) => w.text).join(" ");
  return tokens;
}

// Column intervals from the token coverage of the fullest rows.
export function projectColumns(rows) {
  const counts = rows.map((r) => r.length).sort((a, b) => a - b);
  const q = counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.6))] || 0;
  const full = rows.filter((r) => r.length >= q && r.length >= 2);
  // Leader dots between a name and its values are not a column.
  const ivs = full.flat().filter((t) => !/^[.·…\s]+$/.test(t.text)).map((t) => [t.x0, t.x1]).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of ivs) {
    const last = cols[cols.length - 1];
    if (last && a <= last.x1 + GAP_MIN) last.x1 = Math.max(last.x1, b);
    else cols.push({ x0: a, x1: b });
  }
  return cols;
}

// Column separators the coarse projection misses: a band of whitespace that nearly every row
// leaves free inside one coarse column, with text aligned on at least one side of it. Dense
// numeric tables keep neighbouring columns apart by less than the token gap, and group
// headers bridge them; the body's shared whitespace still shows the boundary.
export function refineColumns(rowsIn, cols) {
  const words = rowsIn.flatMap((r) => r.tokens.flatMap((t) => t.words));
  const size = median(words.map((w) => w.size)) || 10;
  const out = [];
  const seps = [];
  for (const col of cols) {
    const pieces = splitColumn(rowsIn, col, size);
    out.push(...pieces.cols);
    seps.push(...pieces.seps);
  }
  return { cols: out, seps };
}

function splitColumn(rowsIn, col, size) {
  const rows = [];
  for (const r of rowsIn) {
    const ws = r.tokens.flatMap((t) => t.words).filter((w) => !LEADER_RE.test(w.text) && w.x1 > col.x0 + 0.5 && w.x0 < col.x1 - 0.5).sort((a, b) => a.x0 - b.x0);
    if (ws.length) rows.push(ws);
  }
  if (rows.length < 3 || col.x1 - col.x0 < 2 * size) return { cols: [col], seps: [] };
  // Ink coverage across the column at half-point steps.
  const step = 0.5;
  const n = Math.ceil((col.x1 - col.x0) / step) + 1;
  const cover = new Int16Array(n);
  for (const ws of rows) {
    for (const w of ws) {
      const i0 = Math.max(0, Math.floor((w.x0 - col.x0) / step));
      const i1 = Math.min(n - 1, Math.ceil((w.x1 - col.x0) / step));
      for (let i = i0; i <= i1; i++) cover[i]++;
    }
  }
  // Header lines and spanning cells may cross a separator: up to a fifth of the rows.
  const allow = Math.floor(0.2 * rows.length);
  const minGap = Math.max(2, 0.3 * size);
  const seps = [];
  let i = 0;
  while (i < n) {
    if (cover[i] > allow) { i++; continue; }
    let j = i;
    while (j < n && cover[j] <= allow) j++;
    const g0 = col.x0 + i * step; const g1 = col.x0 + (j - 1) * step;
    i = j;
    if (g1 - g0 < minGap || g0 <= col.x0 + 0.5 || g1 >= col.x1 - 0.5) continue;
    // Words beside the gap: the last word ending before it, the first word starting after it.
    const left = []; const right = [];
    for (const ws of rows) {
      const l = ws.filter((w) => w.x1 <= g0 + 0.75).pop();
      const r = ws.find((w) => w.x0 >= g1 - 0.75);
      if (l) left.push(l);
      if (r) right.push(r);
    }
    if (left.length < 3 || right.length < 3) continue;
    // A repeated unit or symbol beside the gap ("40 years", "$ 12") is part of the cell.
    const same = (ws) => new Set(ws.map((w) => w.text.toLowerCase())).size === 1;
    if (same(right) || same(left)) continue;
    const spread = (v) => Math.max(...v) - Math.min(...v);
    const tol = Math.max(1.5, 0.2 * size);
    const tightL = spread(left.map((w) => w.x1)) <= tol;
    const tightR = spread(right.map((w) => w.x0)) <= tol;
    const numeric = (ws) => ws.filter((w) => isNumericText(w.text)).length >= 0.6 * ws.length;
    // "15 455": a space as the thousands separator is not a column gap.
    const groups = right.every((w) => /^\d{3}$/.test(w.text)) && left.every((w) => /^\d{1,3}$/.test(w.text));
    if (groups) continue;
    if (tightL || tightR || (numeric(left) && numeric(right))) seps.push({ x0: g0, x1: g1 });
  }
  if (!seps.length) return { cols: [col], seps: [] };
  const edges = [col.x0, ...seps.map((g) => (g.x0 + g.x1) / 2), col.x1];
  const cols = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const inside = rows.flat().filter((w) => (w.x0 + w.x1) / 2 >= edges[k] && (w.x0 + w.x1) / 2 < edges[k + 1]);
    if (!inside.length) continue;
    cols.push({ x0: Math.max(edges[k], Math.min(...inside.map((w) => w.x0))), x1: Math.min(edges[k + 1], Math.max(...inside.map((w) => w.x1))) });
  }
  return { cols: cols.length >= 2 ? cols : [col], seps: cols.length >= 2 ? seps : [] };
}

// A token whose words part exactly at a validated separator is two tokens (the separator was
// found as whitespace, so a token with ink across it is a spanning cell and stays whole).
export function splitTokensAt(tokens, seps) {
  if (!seps.length) return tokens;
  const out = [];
  for (const t of tokens) {
    let parts = [t.words];
    for (const g of seps) {
      if (g.x0 <= t.x0 || g.x1 >= t.x1) continue;
      const next = [];
      for (const ws of parts) {
        const l = ws.filter((w) => w.x1 <= g.x0 + 0.75);
        const r = ws.filter((w) => w.x0 >= g.x1 - 0.75);
        if (l.length && r.length && l.length + r.length === ws.length && !r.every((w) => LEADER_RE.test(w.text)) && !l.every((w) => LEADER_RE.test(w.text))) next.push(l, r);
        else next.push(ws);
      }
      parts = next;
    }
    if (parts.length === 1) { out.push(t); continue; }
    for (const ws of parts) out.push({ x0: Math.min(...ws.map((w) => w.x0)), x1: Math.max(...ws.map((w) => w.x1)), words: ws, text: ws.map((w) => w.text).join(" "), rowSpan: t.rowSpan });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

function assignToken(t, cols) {
  const hits = [];
  cols.forEach((c, i) => {
    const o = Math.min(t.x1, c.x1) - Math.max(t.x0, c.x0);
    if (o > 0) hits.push({ i, o, frac: o / (c.x1 - c.x0), tfrac: o / (t.x1 - t.x0) });
  });
  if (!hits.length) {
    const mid = (t.x0 + t.x1) / 2;
    let best = 0;
    cols.forEach((c, i) => { if (Math.abs((c.x0 + c.x1) / 2 - mid) < Math.abs((cols[best].x0 + cols[best].x1) / 2 - mid)) best = i; });
    return { c: best, span: 1 };
  }
  const strong = hits.filter((h) => h.frac >= 0.4 || h.tfrac >= 0.4);
  if (strong.length >= 2) {
    // Centred multi-column text may only brush its outermost columns: pick the span whose
    // centre sits closest to the token centre.
    const mid = (t.x0 + t.x1) / 2;
    let first = strong[0].i; let last = strong[strong.length - 1].i;
    const centre = (a, b) => (cols[a].x0 + cols[b].x1) / 2;
    let best = Math.abs(centre(first, last) - mid);
    const lo = hits[0].i; const hi = hits[hits.length - 1].i;
    for (const [a, b] of [[lo, last], [first, hi], [lo, hi]]) {
      const d = Math.abs(centre(a, b) - mid);
      if (d + 0.5 < best) { best = d; first = a; last = b; }
    }
    return { c: first, span: last - first + 1 };
  }
  // A short token centred in the gap between two columns (a group header) spans both.
  if (hits.length >= 2 && !strong.length) {
    const mid = (t.x0 + t.x1) / 2;
    const a = cols[hits[0].i]; const b = cols[hits[hits.length - 1].i];
    if (mid > a.x1 && mid < b.x0) return { c: hits[0].i, span: hits[hits.length - 1].i - hits[0].i + 1 };
  }
  let best = hits[0];
  for (const h of hits) if (h.o > best.o) best = h;
  return { c: best.i, span: 1 };
}

function medianSize(words) {
  const sizes = [];
  for (const w of words || []) if (w && w.size > 0) sizes.push(w.size);
  if (!sizes.length) return 0;
  sizes.sort((a, b) => a - b);
  return sizes[sizes.length >> 1];
}

// Vision sometimes returns a line-height box for one word (several times the body size).
// That box must not set the em used to decide which baseline a neighbour belongs to.
function joinSize(word, typical) {
  const size = word?.size || typical || 8;
  if (!typical || word?.conf == null || size <= typical * 1.45) return size;
  return typical;
}

// Visual rows: words chained by vertical overlap of their boxes.
export function visualRows(words) {
  const typical = medianSize(words);
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rows = [];
  for (const w of sorted) {
    const r = rows[rows.length - 1];
    if (r && w.y0 < r.y1 - 1 && !ocrApart(r, w, sorted, typical)) {
      r.words.push(w); r.y1 = Math.max(r.y1, w.y1); r.y0 = Math.min(r.y0, w.y0);
    } else rows.push({ y0: w.y0, y1: w.y1, words: [w] });
  }
  return rows;
}

// OCR words (they carry `conf`) join a row by baseline, not by box overlap alone: their boxes
// are estimates, and the rows of a tightly set scan sit closer than one box height. A word
// belongs when its baseline is within 0.7 em of the row's first one, or when it is the second
// line of a wrapped cell: stacked under a row word at line pitch with a centred cell between.
// The centred cell itself can arrive before the wrapped second line and sit a little past 0.7 em
// (half a pitch plus baseline noise): it joins when, within 0.8 em, a later word stacks under a
// row word at line pitch with w's line centred between them and clear of that column.
// `typical` is the median size of the words being grouped. An inflated box uses that median
// so one tall word does not pull the next several baselines into its row.
function ocrApart(row, w, words = [], typical = 0) {
  if (w.conf == null) return false;
  const anchor = row.words[0];
  if (anchor.conf == null) return false;
  const em = Math.max(joinSize(w, typical), joinSize(anchor, typical));
  if (Math.abs(w.base - anchor.base) <= 0.7 * em) return false;
  for (const u of row.words) {
    const gap = Math.abs(w.base - u.base);
    if (gap < 0.8 * em || gap > 1.6 * em) continue;
    if (Math.min(w.x1, u.x1) - Math.max(w.x0, u.x0) <= 0) continue;
    const lo = Math.min(w.base, u.base) + 0.2 * em; const hi = Math.max(w.base, u.base) - 0.2 * em;
    if (row.words.some((v) => v.base > lo && v.base < hi)) return false;
  }
  return !centredLine(row, w, words, em);
}

function centredLine(row, w, words, em) {
  if (w.base - row.words[0].base > 0.8 * em) return false;
  const line = words.filter((v) => v.conf != null && !row.words.includes(v) && Math.abs(v.base - w.base) <= 0.3 * em);
  // Evenly spaced table rows sit about one pitch apart, so the middle baseline is
  // halfway between the row above and the row below — the same geometry as a value
  // centred in a wrapped cell. A real row repeats its columns on the line below.
  // A wrapped cell's centred values do not: the line below continues the label only.
  const lower = words.filter((v) => v.conf != null && v.base > w.base + 0.4 * em && v.base < w.base + 1.3 * em);
  const mid = (p) => (p.x0 + p.x1) / 2;
  let echoed = 0;
  for (const m of line) {
    if (lower.some((v) => Math.abs(mid(v) - mid(m)) <= Math.max(6, 0.9 * em))) echoed += 1;
  }
  if (echoed >= 2) return false;
  const overlaps = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;
  for (const u of row.words) {
    if (Math.abs(u.base - row.words[0].base) > 0.3 * em) continue;
    if (line.some((v) => overlaps(u, v))) continue;
    for (const v of words) {
      if (v.conf == null || row.words.includes(v) || line.includes(v) || !overlaps(u, v)) continue;
      const gap = v.base - u.base;
      if (gap < 0.8 * em || gap > 1.6 * em) continue;
      if (Math.abs(w.base - (u.base + v.base) / 2) <= 0.15 * em) return true;
    }
  }
  return false;
}

// Rows inside one rule band. A lone word whose box bridges two baseline rows (a multirow
// label set in the middle of its group) is reported as floating instead of merging the rows.
export function bandRows(words) {
  const base = baselineGroups(words);
  const floating = [];
  const keep = [];
  for (let i = 0; i < base.length; i++) {
    const g = base[i];
    const prev = base[i - 1];
    const next = base[i + 1];
    const bridges = g.words.length === 1 && prev && next && g.y0 < prev.y1 - 1 && g.y1 > next.y0 + 1
      && !(prev.y0 < next.y1 - 1 && prev.y1 > next.y0 + 1);
    if (bridges) floating.push(g.words[0]);
    else keep.push(...g.words);
  }
  return { rows: visualRows(keep), floating };
}

function baselineGroups(words) {
  const sorted = [...words].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const groups = [];
  for (const w of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.base - w.base) <= 0.3 * Math.max(g.size, w.size)) { g.words.push(w); g.y0 = Math.min(g.y0, w.y0); g.y1 = Math.max(g.y1, w.y1); }
    else groups.push({ base: w.base, size: w.size, y0: w.y0, y1: w.y1, words: [w] });
  }
  return groups;
}

function rowTokens(row) {
  // Tokens across the row: words grouped by baseline, split at wide gaps. Super/subscripts
  // ride with the nearest base-line word so "10" and its exponent stay one token.
  const byLine = new Map();
  const scripts = [];
  for (const w of row.words) {
    if (w.sup || w.sub) { scripts.push(w); continue; }
    const k = Math.round(w.base * 2) / 2;
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(w);
  }
  const tokens = [];
  for (const ws of byLine.values()) {
    ws.sort((a, b) => a.x0 - b.x0);
    const line = { words: ws, x0: ws[0].x0, x1: Math.max(...ws.map((w) => w.x1)), size: ws[0].size };
    tokens.push(...tokenizeLine(line));
  }
  for (const sw of scripts) {
    let best = null;
    let dist = Infinity;
    for (const t of tokens) {
      const d = sw.x0 >= t.x0 && sw.x0 <= t.x1 ? 0 : Math.min(Math.abs(sw.x0 - t.x1), Math.abs(sw.x1 - t.x0));
      if (d < dist) { dist = d; best = t; }
    }
    if (best && dist <= 0.6 * sw.rowSize) { best.words.push(sw); best.words.sort((a, b) => a.x0 - b.x0 || a.base - b.base); best.x1 = Math.max(best.x1, sw.x1); best.x0 = Math.min(best.x0, sw.x0); }
    else tokens.push({ x0: sw.x0, x1: sw.x1, words: [sw], text: sw.text });
  }
  for (const t of tokens) t.text = t.words.map((w) => w.text).join(" ");
  return tokens.sort((a, b) => a.x0 - b.x0);
}

// Right edges of numeric tokens, clustered. Small-type scans put the next column
// a point or two away, inside the gap that would merge the intervals, and a spanning
// header covers the whitespace. The shared right edge is still the column.
export function alignNumericColumns(tokenRows, size = 8) {
  const yearSpan = (text) => /^(1[89]|20)\d{2}\s*[-–—]\s*(1[89]|20)\d{2}/.test(String(text || "").trim());
  const edges = [];
  const years = [];
  let used = 0;
  let textX0 = Infinity;
  let textX1 = -Infinity;
  let firstNum = Infinity;
  for (const tokens of tokenRows) {
    const nums = tokens.filter((t) => /\d/.test(t.text || ""));
    if (nums.length < 2) continue;
    used += 1;
    for (const t of tokens) {
      if (!/\d/.test(t.text || "")) {
        textX0 = Math.min(textX0, t.x0);
        textX1 = Math.max(textX1, t.x1);
        continue;
      }
      firstNum = Math.min(firstNum, t.x0);
      if (yearSpan(t.text)) years.push(t.x1);
      else edges.push(t.x1);
    }
  }
  if (used < 4 || !edges.length) return null;
  edges.sort((a, b) => a - b);
  const tol = Math.max(3.5, 0.5 * size);
  const clusters = [];
  for (const x of edges) {
    const c = clusters[clusters.length - 1];
    if (c && x <= c.mean + tol) {
      c.xs.push(x);
      c.mean = c.xs.reduce((s, v) => s + v, 0) / c.xs.length;
    } else clusters.push({ mean: x, xs: [x] });
  }
  const minN = Math.max(3, Math.ceil(used * 0.22));
  const rights = clusters.filter((c) => c.xs.length >= minN).map((c) => c.mean);
  // A year range is its own column. Its right edge wanders more than a right-aligned
  // quantity, so the edges are taken together instead of failing the cluster test.
  if (years.length >= Math.max(3, Math.ceil(used * 0.2))) {
    const ys = [...years].sort((a, b) => a - b);
    rights.push(ys[ys.length >> 1]);
  }
  rights.sort((a, b) => a - b);
  const merged = [];
  for (const r of rights) {
    if (merged.length && r - merged[merged.length - 1] <= tol) merged[merged.length - 1] = (merged[merged.length - 1] + r) / 2;
    else merged.push(r);
  }
  if (merged.length < 2) return null;
  // The label column runs up to the first aligned quantity. A stray digit in the
  // label (firstNum) is not a column of its own.
  const edgeX0 = [];
  for (const tokens of tokenRows) {
    for (const t of tokens) {
      if (!/\d/.test(t.text || "")) continue;
      if (Math.abs(t.x1 - merged[0]) <= tol * 2.2) edgeX0.push(t.x0);
    }
  }
  edgeX0.sort((a, b) => a - b);
  // Median, not the minimum: one token that also holds the row label starts far to the left.
  const firstEdgeX0 = edgeX0.length ? edgeX0[edgeX0.length >> 1] : Infinity;
  // Columns meet at the right edges and do not overlap, so a token that ends on one
  // edge is not also a span across the next column.
  const cols = [];
  if (textX1 > textX0) {
    const stop = Number.isFinite(firstEdgeX0) ? firstEdgeX0 - 1 : firstNum - 1;
    const x1 = Math.min(textX1, stop);
    if (x1 > textX0 + 1) cols.push({ x0: textX0, x1 });
  }
  let prev = cols.length ? cols[cols.length - 1].x1 : firstNum - 1;
  for (const r of merged) {
    const x0 = prev + 0.5;
    if (r > x0 + 1) cols.push({ x0, x1: r });
    prev = r;
  }
  return cols.length >= 2 ? cols : null;
}

// Rows that carry the column grid: numeric body lines. A spanning header is one wide
// token and would glue every column it sits over into a single interval. Born-digital
// rows (no OCR confidence) keep the old projection, which already matches those pages.
function numericBodyRows(rowsIn) {
  const ocr = rowsIn.some((r) => r.tokens.some((t) => (t.words || []).some((w) => w.conf != null)));
  if (!ocr) return null;
  const body = [];
  for (const r of rowsIn) {
    const ws = r.tokens.flatMap((t) => t.words || []);
    if (ws.length < 3) continue;
    let nums = 0;
    for (const w of ws) if (/\d/.test(w.text || "")) nums += 1;
    if (nums >= 3 && nums / ws.length >= 0.45) body.push(r);
  }
  if (body.length < 4 || body.length >= rowsIn.length) return null;
  return body;
}

function sidesAt(rowsIn, x) {
  const left = new Set();
  const right = new Set();
  let straddle = 0;
  rowsIn.forEach((r, i) => {
    for (const w of r.tokens.flatMap((t) => t.words || [])) {
      if (w.x1 <= x + 0.5) left.add(i);
      else if (w.x0 >= x - 0.5) right.add(i);
      else if (w.x0 < x - 1 && w.x1 > x + 1) straddle++;
    }
  });
  return { left: left.size, right: right.size, straddle };
}

// Cuts inside one coarse column. A partial vertical rule, or a gap that
// repeats between two numeric words, is a column the token gap had glued.
function columnCuts(rowsIn, col, rules, size) {
  const cuts = [];
  const add = (x) => {
    if (x <= col.x0 + 1.5 || x >= col.x1 - 1.5) return;
    if (cuts.some((c) => Math.abs(c - x) <= 2)) return;
    cuts.push(x);
  };
  for (const rule of rules || []) {
    const vertical = rule.axis === "v" || Math.abs((rule.x1 ?? 0) - (rule.x0 ?? 0)) + 0.5 < Math.abs((rule.y1 ?? 0) - (rule.y0 ?? 0));
    if (!vertical) continue;
    const x = (rule.x0 + rule.x1) / 2;
    const y0 = Math.min(rule.y0, rule.y1);
    const y1 = Math.max(rule.y0, rule.y1);
    if (rowsIn.filter((r) => r.y1 > y0 - 1 && r.y0 < y1 + 1).length < 4) continue;
    const sides = sidesAt(rowsIn, x);
    if (sides.left >= 3 && sides.right >= 3 && sides.straddle <= 1) add(x);
  }
  const gaps = [];
  for (const r of rowsIn) {
    const ws = r.tokens.flatMap((t) => t.words || [])
      .filter((w) => (w.x0 + w.x1) / 2 > col.x0 && (w.x0 + w.x1) / 2 < col.x1)
      .sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < ws.length; i++) {
      const a = ws[i - 1];
      const b = ws[i];
      const gap = b.x0 - a.x1;
      if (gap < 1.5 || gap > Math.max(6, 0.9 * size)) continue;
      if (!isNumericText(a.text) || !isNumericText(b.text)) continue;
      // "(1)" beside a quantity is a footnote, not the next column.
      if (/^\(\d{1,2}\)$/.test(String(b.text || "").trim())) continue;
      if (/,$/.test(String(a.text).trim())) continue;
      if (/^\d{3}$/.test(b.text) && /^\d{1,3},?$/.test(String(a.text).trim())) continue;
      gaps.push((a.x1 + b.x0) / 2);
    }
  }
  gaps.sort((a, b) => a - b);
  let cluster = [];
  const flush = () => {
    if (cluster.length >= 4) add(cluster.reduce((s, v) => s + v, 0) / cluster.length);
    cluster = [];
  };
  for (const g of gaps) {
    if (cluster.length && g - cluster[cluster.length - 1] > 2.5) flush();
    cluster.push(g);
  }
  flush();
  cuts.sort((a, b) => a - b);
  return cuts;
}

function narrowSplits(rowsIn, cols, rules = []) {
  const size = medianSize(rowsIn.flatMap((r) => r.tokens.flatMap((t) => t.words || []))) || 8;
  const out = [];
  const seps = [];
  for (const col of cols) {
    const cuts = columnCuts(rowsIn, col, rules, size);
    if (!cuts.length) { out.push(col); continue; }
    const edges = [col.x0, ...cuts, col.x1];
    const pieces = [];
    for (let k = 0; k + 1 < edges.length; k++) {
      const inside = [];
      for (const r of rowsIn) {
        for (const w of r.tokens.flatMap((t) => t.words || [])) {
          const cx = (w.x0 + w.x1) / 2;
          if (cx >= edges[k] - 0.2 && cx < edges[k + 1] + 0.2 && w.x1 > col.x0 - 0.5 && w.x0 < col.x1 + 0.5) inside.push(w);
        }
      }
      if (!inside.length) continue;
      pieces.push({
        x0: Math.max(edges[k], Math.min(...inside.map((w) => w.x0))),
        x1: Math.min(edges[k + 1], Math.max(...inside.map((w) => w.x1))),
      });
    }
    if (pieces.length < 2) { out.push(col); continue; }
    out.push(...pieces);
    for (const x of cuts) seps.push({ x0: x - 0.6, x1: x + 0.6 });
  }
  return { cols: out, seps };
}

function overlapsX(a, b) {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1;
}

// A centred title and the stub beside it sit on different baselines, and the
// unit ("C.") sits on a third. They are one header row when the lower line
// fills only columns the upper line left empty, or is a single unit token
// under a label. A line of numbers is the body and stops the fold.
function foldHeaderLines(rows) {
  const out = rows.map((r) => ({ ...r, tokens: r.tokens.map((t) => ({ ...t, words: [...(t.words || [])] })) }));
  let i = 0;
  while (i + 1 < out.length && i < 4) {
    const a = out[i];
    const b = out[i + 1];
    // A number on the lower line is a body row, or a rate sitting under a title.
    // An equals sign is an equation, which folding would turn into a false table.
    if (b.tokens.some((t) => isNumericText(t.text) || /[=≈≡]/.test(String(t.text || "")))) break;
    if (a.tokens.some((t) => /[=≈≡]/.test(String(t.text || "")))) break;
    const complementary = a.tokens.length > 0 && b.tokens.length > 0 && b.tokens.length <= a.tokens.length + 1
      && b.tokens.every((t) => !a.tokens.some((u) => overlapsX(u, t)));
    const unitTok = b.tokens.length === 1 ? b.tokens[0] : null;
    const unit = unitTok && !isNumericText(unitTok.text) && String(unitTok.text || "").trim().length <= 12
      && a.tokens.some((u) => overlapsX(u, unitTok));
    if (complementary) {
      a.tokens.push(...b.tokens);
      a.tokens.sort((p, q) => p.x0 - q.x0);
      a.y1 = Math.max(a.y1, b.y1);
      out.splice(i + 1, 1);
      continue;
    }
    if (unit) {
      const host = a.tokens.find((u) => overlapsX(u, unitTok));
      host.words.push(...(unitTok.words || []));
      host.x0 = Math.min(host.x0, unitTok.x0);
      host.x1 = Math.max(host.x1, unitTok.x1);
      host.text = host.words.map((w) => w.text).join(" ");
      a.y1 = Math.max(a.y1, b.y1);
      out.splice(i + 1, 1);
      continue;
    }
    i++;
  }
  return out;
}

function buildTable(rowsIn, { bands = null, headerRowsHint = 0, caption = null, rules = [] }) {
  if (!bands) rowsIn = foldHeaderLines(rowsIn);
  // rowsIn: [{ y0, y1, tokens, band }]
  const body = numericBodyRows(rowsIn);
  const bodySize = medianSize((body || rowsIn).flatMap((r) => r.tokens.flatMap((t) => t.words || []))) || 8;
  const fromPage = projectColumns(rowsIn.map((r) => r.tokens));
  const bodyProjected = body ? projectColumns(body.map((r) => r.tokens)) : null;
  // A spanning header merges several body columns into one interval. Read the body
  // only when that separates more than the single column whitespace refinement would
  // add; an ordinary grid keeps the header in the projection.
  const useBody = bodyProjected && bodyProjected.length >= fromPage.length + 2;
  const source = useBody ? body : rowsIn;
  const projected = useBody ? bodyProjected : fromPage;
  const aligned = useBody ? alignNumericColumns(source.map((r) => r.tokens), bodySize) : null;
  // Right edges recover columns the body intervals still merged, as when a year
  // range sits against the quantity beside it. A one-column difference is noise.
  const useAligned = aligned && aligned.length >= projected.length + 3;
  const coarse = useAligned ? aligned : projected;
  if (coarse.length < 2) return null;
  // Alignment already placed the boundaries on the numeric right edges. The whitespace
  // splitter would cut through a year range that nearly touches the next quantity.
  const refined = useAligned ? { cols: aligned, seps: [] } : refineColumns(source, coarse);
  const narrowed = narrowSplits(rowsIn, refined.cols, rules);
  const cols = narrowed.cols;
  const seps = [...refined.seps, ...narrowed.seps];
  if (seps.length) for (const r of rowsIn) r.tokens = splitTokensAt(r.tokens, seps);
  const k = cols.length;
  const placed = rowsIn.map((r) => r.tokens.map((t) => ({ t, ...assignToken(t, cols) })));
  let conforming = 0;
  let counted = 0;
  placed.forEach((row) => {
    // Group labels and spanning headers (one token) enter a run on their own terms.
    if (row.length < 2) return;
    counted++;
    const seen = new Set();
    let dup = false;
    for (const p of row) { if (seen.has(p.c)) dup = true; seen.add(p.c); }
    // Single-line rows (free mode) must map one token per column; banded rows may wrap inside a cell.
    const ok = seen.size >= 2 && (bands ? true : !dup);
    if (ok) conforming++;
  });
  const stability = counted ? conforming / counted : 0;
  if (stability < 0.7 && !bands) return null;
  if (stability < 0.5) return null;
  // Cells
  const rows = rowsIn.length;
  const cellMap = new Map();
  placed.forEach((row, r) => {
    for (const p of row) {
      const key = `${r}:${p.c}`;
      let cell = cellMap.get(key);
      if (!cell) { cell = { r, c: p.c, rowSpan: 1, colSpan: p.span, words: [], fixedRowSpan: 0 }; cellMap.set(key, cell); }
      cell.colSpan = Math.max(cell.colSpan, p.span);
      if (p.t.rowSpan > 1) cell.fixedRowSpan = Math.max(cell.fixedRowSpan, p.t.rowSpan);
      cell.words.push(...p.t.words);
    }
  });
  // Header rows
  let headerRows = headerRowsHint;
  if (!headerRows) {
    const numericRow = (r) => { const cs = [...cellMap.values()].filter((c) => c.r === r && c.c > 0); return cs.length && cs.filter((c) => isNumericText(cellTextOf(c.words))).length >= 0.5 * cs.length; };
    const boldRow = (r) => { const ws = [...cellMap.values()].filter((c) => c.r === r).flatMap((c) => c.words); return ws.length && ws.every((w) => w.bold); };
    const yearRow = (r) => { const cs = [...cellMap.values()].filter((c) => c.r === r && c.c > 0); return cs.length >= 2 && cs.every((c) => /^(1[89]|20)\d\d[a-z*]?$/.test(cellTextOf(c.words))); };
    while (headerRows < rows - 1 && boldRow(headerRows)) headerRows++;
    // A name row ("Volume", "Pressure") opens the header. A lone quantity whose
    // other cells were not read is a data row with a hole, not a header.
    const texts0 = [...cellMap.values()].filter((c) => c.r === 0).map((c) => cellTextOf(c.words).trim()).filter(Boolean);
    const hasLabel = texts0.some((t) => !isNumericText(t) && /[A-Za-z]/.test(t));
    if (!headerRows && (hasLabel || yearRow(0)) && rows >= 2 && (!numericRow(0) || yearRow(0)) && numericRow(1) && !yearRow(1)) headerRows = 1;
    // A unit line under the names ("C. c.", "Mm. of mercury") is a header row
    // even when it is not bold. A row whose own cells are numbers is data,
    // including a row where only the stub was read.
    const labelRow = (r) => {
      const cs = [...cellMap.values()].filter((c) => c.r === r && cellTextOf(c.words).trim());
      if (!cs.length) return false;
      const nums = cs.filter((c) => isNumericText(cellTextOf(c.words))).length;
      return nums < 2 && nums < cs.length;
    };
    const pageList = rowsIn.length >= 2 && rowsIn.some((r) => contentsEntry(r.tokens))
      && rowsIn.every((r) => r.tokens.length < 2 || contentsEntry(r.tokens));
    while (!pageList && headerRows < rows - 1 && headerRows < 4 && labelRow(headerRows)) {
      let later = false;
      for (let r = headerRows + 1; r < rows; r++) if (numericRow(r)) later = true;
      if (!later) break;
      headerRows++;
    }
    // Lab numbers under the names (22954, 22955, …) are a header row. A comma
    // quantity ("1,275") and a 4-digit year are not.
    const idRow = (r) => {
      const cs = [...cellMap.values()].filter((c) => c.r === r && cellTextOf(c.words).trim());
      return cs.length >= 4 && cs.every((c) => /^\d{5,6}$/.test(cellTextOf(c.words).trim()));
    };
    if (headerRows > 0 && headerRows < rows - 1 && idRow(headerRows)) headerRows++;
  }
  // Row spans: header band cells with nothing below in their column; body group labels (col 0 only).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < k; c++) {
      const cell = cellMap.get(`${r}:${c}`);
      if (!cell) continue;
      if (cell.fixedRowSpan > 1) { cell.rowSpan = Math.min(cell.fixedRowSpan, rows - r); continue; }
      if (r < headerRows) {
        let rr = r + 1;
        while (rr < headerRows && !coveredAt(cellMap, rr, c, cell.colSpan)) rr++;
        cell.rowSpan = rr - r;
      } else if (c === 0 && rowsIn[r].tokens.length === 1 && cell.colSpan === 1) {
        let rr = r + 1;
        while (rr < rows && !cellMap.get(`${rr}:0`) && rowsIn[rr].tokens.length > 0) rr++;
        if (rr - r > 1) cell.rowSpan = rr - r;
      }
    }
  }
  // A rule drawn under a header cell (a \cmidrule) fixes its span to the columns it covers.
  const underlines = [...(bands ? bands.ys.filter((b) => !b.full).flatMap((b) => b.parts.map(([a, c]) => ({ a, b: c, y: b.y }))) : []), ...rules.filter((r) => r.axis === "h").map((r) => ({ a: r.x0, b: r.x1, y: (r.y0 + r.y1) / 2 }))];
  const fixedSpan = new Set();
  if (underlines.length) {
    for (const cell of [...cellMap.values()]) {
      if (cell.r >= headerRows) continue;
      const x0 = Math.min(...cell.words.map((w) => w.x0)); const x1 = Math.max(...cell.words.map((w) => w.x1));
      const y1 = Math.max(...cell.words.map((w) => w.y1)); const size = cell.words[0].size;
      const under = underlines.find((u) => u.y > y1 - 0.3 * size && u.y <= y1 + 1.5 * size && u.a <= x0 + 2 && u.b >= x1 - 2 && u.b - u.a < 0.95 * (cols[k - 1].x1 - cols[0].x0));
      if (!under) continue;
      const covered = [];
      cols.forEach((c, i) => { const o = Math.min(c.x1, under.b) - Math.max(c.x0, under.a); if (o > 0.5 * (c.x1 - c.x0)) covered.push(i); });
      // The rule must cover the cell's own column and at least one more, contiguously.
      if (covered.length < 2 || covered[covered.length - 1] - covered[0] + 1 !== covered.length) continue;
      if (covered[0] > cell.c || covered[covered.length - 1] < cell.c + cell.colSpan - 1) continue;
      const c0 = covered[0]; const span = covered[covered.length - 1] - c0 + 1;
      let free = true;
      for (let c = c0; c < c0 + span; c++) { const o = cellMap.get(`${cell.r}:${c}`); if (o && o !== cell) free = false; }
      if (!free) continue;
      cellMap.delete(`${cell.r}:${cell.c}`); cell.c = c0; cell.colSpan = span; cellMap.set(`${cell.r}:${c0}`, cell);
      fixedSpan.add(cell);
    }
  }
  // Centred text that does not touch the outer column of its span: widen into empty neighbours
  // while the span centre moves closer to the text centre. A header cell centred over a group
  // of columns widens on both sides at once.
  const emptyAt = (r, c) => c >= 0 && c < k && !cellMap.has(`${r}:${c}`);
  for (const cell of [...cellMap.values()]) {
    if (fixedSpan.has(cell)) continue;
    const mid = (Math.min(...cell.words.map((w) => w.x0)) + Math.max(...cell.words.map((w) => w.x1))) / 2;
    let guard = 0;
    while (guard++ < k) {
      const c0 = cell.c; const c1 = cell.c + cell.colSpan - 1;
      const cur = Math.abs((cols[c0].x0 + cols[c1].x1) / 2 - mid);
      const dist = (a, b) => Math.abs((cols[a].x0 + cols[b].x1) / 2 - mid);
      const canLeft = emptyAt(cell.r, c0 - 1) && dist(c0 - 1, c1) < cur - 1;
      const canRight = emptyAt(cell.r, c1 + 1) && dist(c0, c1 + 1) < cur - 1;
      // A header wider than the columns under it is a group header: it may sit a little
      // off-centre over its group.
      const textW = Math.max(...cell.words.map((w) => w.x1)) - Math.min(...cell.words.map((w) => w.x0));
      const wide = textW > cols[c1].x1 - cols[c0].x0;
      const slack = (a, b) => (wide ? 0.5 * ((cols[b].x1 - cols[a].x0) / (b - a + 1)) : 0);
      const canBoth = cell.r < headerRows && c0 > 0 && emptyAt(cell.r, c0 - 1) && emptyAt(cell.r, c1 + 1) && dist(c0 - 1, c1 + 1) <= Math.max(cur + 1, slack(c0 - 1, c1 + 1));
      if (canBoth) {
        cellMap.delete(`${cell.r}:${c0}`); cell.c = c0 - 1; cell.colSpan += 2; cellMap.set(`${cell.r}:${cell.c}`, cell);
      } else if (canLeft && (!canRight || dist(c0 - 1, c1) <= dist(c0, c1 + 1))) {
        cellMap.delete(`${cell.r}:${c0}`); cell.c = c0 - 1; cell.colSpan++; cellMap.set(`${cell.r}:${cell.c}`, cell);
      } else if (canRight) cell.colSpan++;
      else break;
    }
    // Columns of uneven width can hide the centred span from the one-step walk: a header
    // cell still off-centre takes the narrowest span through empty neighbours that is
    // centred on its text.
    if (cell.r < headerRows) {
      const c0 = cell.c; const c1 = cell.c + cell.colSpan - 1;
      if (Math.abs((cols[c0].x0 + cols[c1].x1) / 2 - mid) > 2) {
        let a0 = c0; while (emptyAt(cell.r, a0 - 1)) a0--;
        let b1 = c1; while (emptyAt(cell.r, b1 + 1)) b1++;
        let best = null;
        for (let a = a0; a <= c0; a++) for (let b = c1; b <= b1; b++) {
          const d = Math.abs((cols[a].x0 + cols[b].x1) / 2 - mid);
          if (d <= 2 && (!best || b - a < best.b - best.a)) best = { a, b };
        }
        if (best) { cellMap.delete(`${cell.r}:${c0}`); cell.c = best.a; cell.colSpan = best.b - best.a + 1; cellMap.set(`${cell.r}:${cell.c}`, cell); }
      }
    }
  }
  // A header label wrapped over two header baselines ("Total" / "population"): the lower
  // line is a continuation (lower-case or bracketed) in the same single column.
  for (const cell of [...cellMap.values()].sort((a, b) => a.r - b.r)) {
    if (cell.r === 0 || cell.r >= headerRows || cell.colSpan !== 1) continue;
    const above = cellMap.get(`${cell.r - 1}:${cell.c}`);
    if (!above || above.colSpan !== 1 || above.rowSpan !== 1) continue;
    const text = cellTextOf(cell.words);
    if (!/^[a-z(]/.test(text) || isNumericText(text)) continue;
    above.words.push(...cell.words);
    above.rowSpan = cell.rowSpan + 1;
    cellMap.delete(`${cell.r}:${cell.c}`);
  }
  // A header cell with nothing above it in its columns starts at the top of the header band
  // ("Characteristic" set on the last header line spans every header row).
  const coveredBy = (r, c0, c1) => [...cellMap.values()].some((o) => o.r <= r && r < o.r + o.rowSpan && o.c <= c1 && o.c + o.colSpan - 1 >= c0);
  for (const cell of [...cellMap.values()].sort((a, b) => a.r - b.r)) {
    if (cell.r === 0 || cell.r >= headerRows) continue;
    if (isNumericText(cellTextOf(cell.words))) continue;
    let r = cell.r;
    while (r > 0 && !coveredBy(r - 1, cell.c, cell.c + cell.colSpan - 1)) r--;
    if (r < cell.r) { cellMap.delete(`${cell.r}:${cell.c}`); cell.rowSpan += cell.r - r; cell.r = r; cellMap.set(`${r}:${cell.c}`, cell); }
  }
  // Row labels set once per rule band ("(C)" beside seven rows) span the band.
  if (bands) {
    const byBand = new Map();
    rowsIn.forEach((row, r) => { if (!byBand.has(row.band)) byBand.set(row.band, []); byBand.get(row.band).push(r); });
    for (const rs of byBand.values()) {
      if (rs.length < 2 || rs[0] < headerRows) continue;
      const labels = rs.filter((r) => cellMap.get(`${r}:0`));
      if (labels.length !== 1) continue;
      const cell = cellMap.get(`${labels[0]}:0`);
      if (cell.colSpan > 1 || isNumericText(cellTextOf(cell.words))) continue;
      // Other rows of a wide table still have their own row label, even when that
      // label was assigned to the next column. One label does not cover those rows.
      const edge = Math.min(...cell.words.map((w) => w.x0));
      const size = cell.words[0].size || 8;
      const ownLabel = rs.some((r) => r !== labels[0] && rowsIn[r].tokens.some((t) => t.x0 <= edge + 1.5 * size && !isNumericText(t.text) && /[A-Za-z]/.test(t.text || "")));
      if (ownLabel) continue;
      cellMap.delete(`${labels[0]}:0`);
      cell.r = rs[0];
      cell.rowSpan = rs.length;
      cellMap.set(`${rs[0]}:0`, cell);
    }
  }
  const covered = new Set();
  for (const cell of cellMap.values()) {
    for (let r = cell.r; r < cell.r + cell.rowSpan; r++) for (let c = cell.c; c < cell.c + cell.colSpan; c++) if (r !== cell.r || c !== cell.c) covered.add(`${r}:${c}`);
  }
  const xs = [];
  for (let c = 0; c < k; c++) xs.push(c === 0 ? cols[0].x0 - 2 : (cols[c - 1].x1 + cols[c].x0) / 2);
  xs.push(cols[k - 1].x1 + 2);
  const ys = [];
  for (let r = 0; r < rows; r++) ys.push(r === 0 ? rowsIn[0].y0 - 1 : (rowsIn[r - 1].y1 + rowsIn[r].y0) / 2);
  ys.push(rowsIn[rows - 1].y1 + 1);
  if (bands) {
    const ruleYs = bands.ys.filter((b) => b.full).map((b) => b.y);
    if (ruleYs.length) { ys[0] = Math.min(ys[0], ruleYs[0]); ys[ys.length - 1] = Math.max(ys[ys.length - 1], ruleYs[ruleYs.length - 1]); }
  }
  // Column alignment from body tokens.
  const colAlign = [];
  for (let c = 0; c < k; c++) {
    const body = [...cellMap.values()].filter((cell) => cell.c === c && cell.colSpan === 1 && cell.r >= headerRows);
    const numeric = body.filter((cell) => isNumericText(cellTextOf(cell.words)));
    const x1s = body.map((cell) => Math.max(...cell.words.map((w) => w.x1)));
    const x0s = body.map((cell) => Math.min(...cell.words.map((w) => w.x0)));
    const spread = (v) => (v.length ? Math.max(...v) - Math.min(...v) : 0);
    const right = body.length >= 2 && spread(x1s) + 1 < spread(x0s) && numeric.length >= 0.8 * body.length;
    colAlign[c] = right ? "right" : (body.length >= 2 && numeric.length >= 0.8 * body.length && spread(x1s) <= 1.5 ? "right" : "left");
  }
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < k; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = cellMap.get(`${r}:${c}`) || { r, c, rowSpan: 1, colSpan: 1, words: [] };
      const text = cellTextOf(cell.words);
      cells.push({
        r, c, rowSpan: cell.rowSpan, colSpan: cell.colSpan, text,
        header: r < headerRows,
        bbox: [round(xs[c]), round(ys[r]), round(xs[c + cell.colSpan]), round(ys[r + cell.rowSpan])],
        align: cell.colSpan > 1 ? "center" : colAlign[c],
        numeric: isNumericText(text),
      });
    }
  }
  let tight = 0;
  let n = 0;
  for (let c = 0; c < k; c++) {
    const body = cells.filter((cell) => cell.c === c && cell.colSpan === 1 && cell.text);
    if (body.length < 2) continue;
    n++;
    const edge = colAlign[c] === "right" ? body.map((cell) => cell.bbox[2]) : body.map((cell) => cell.bbox[0]);
    tight += Math.max(...edge) - Math.min(...edge) <= 2 ? 1 : 0.5;
  }
  const alignment = n ? tight / n : 1;
  return {
    type: "table",
    bbox: [round(xs[0]), round(ys[0]), round(xs[k]), round(ys[rows])],
    rows, cols: k, headerRows, headerCols: 0,
    cells, method: "stream",
    grid: { xs: xs.map(round), ys: ys.map(round) },
    confidence: round(Math.max(0, Math.min(1, 0.6 * stability + 0.4 * alignment))),
    caption,
  };
}

// Is any column of [c, c + span) on row r taken by a cell (including a spanning one)?
function coveredAt(cellMap, r, c, span) {
  for (const o of cellMap.values()) {
    if (o.r !== r) continue;
    if (o.c < c + span && o.c + o.colSpan > c) return true;
  }
  return false;
}

// Banded mode: words inside a rule band (booktabs) -> rows by rules and vertical overlap.
export function tableFromBand(band, words) {
  const inside = words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2; const cy = w.base - 0.3 * w.size;
    return cx >= band.x0 - 4 && cx <= band.x1 + 4 && cy >= band.y0 - 1 && cy <= band.y1 + 1;
  });
  if (!inside.length) return null;
  const fullYs = band.ys.filter((b) => b.full).map((b) => b.y);
  const partial = band.ys.filter((b) => !b.full);
  const rowsIn = [];
  const bandsOf = [];
  let headerBands = 0;
  const edges = [band.y0 - 1, ...fullYs.filter((y) => y > band.y0 + 1 && y < band.y1 - 1), band.y1 + 1];
  for (let i = 0; i + 1 < edges.length; i++) {
    const ws = inside.filter((w) => { const cy = w.base - 0.3 * w.size; return cy >= edges[i] && cy < edges[i + 1]; });
    if (!ws.length) continue;
    const { rows: vrowsRaw, floating } = bandRows(ws);
    let vrows = vrowsRaw;
    const parts = partial.filter((p) => p.y > edges[i] && p.y < edges[i + 1]);
    // Header bands: the first rule band, and following bands that carry partial rules
    // (\cmidrules under group headers) while no body band has been seen.
    const isHeader = edges.length > 2 && (bandsOf.length === 0 || (headerBands === bandsOf.length && headerBands < 2 && parts.length > 0 && !hasSubRows(ws, band)));
    if (isHeader) headerBands++;
    // Between two full rules the text is one row of (wrapped) cells unless it holds data
    // sub-rows: baselines with numbers in two columns, or several label lines at the left edge.
    if (!isHeader && edges.length > 2 && vrows.length > 1 && !hasSubRows(ws, band)) {
      vrows = [{ y0: Math.min(...ws.map((w) => w.y0)), y1: Math.max(...ws.map((w) => w.y1)), words: ws }];
    }
    if (isHeader && (vrows.length > 1 || parts.length)) {
      if (parts.length) {
        // Split header rows at partial rules, merge rows between rules.
        const cuts = [edges[i], ...parts.map((p) => p.y), edges[i + 1]];
        const merged = [];
        for (let j = 0; j + 1 < cuts.length; j++) {
          const rws = ws.filter((w) => { const cy = w.base - 0.3 * w.size; return cy >= cuts[j] && cy < cuts[j + 1]; });
          if (rws.length) merged.push({ y0: Math.min(...rws.map((w) => w.y0)), y1: Math.max(...rws.map((w) => w.y1)), words: rws });
        }
        vrows = merged;
      } else {
        vrows = headerRowGroups(ws);
      }
    }
    bandsOf.push(vrows.length);
    const firstRow = rowsIn.length;
    for (const r of vrows) rowsIn.push({ y0: r.y0, y1: r.y1, tokens: rowTokens(r).sort((a, b) => a.x0 - b.x0), band: i });
    // A multirow label spans the rows its box covers ("(A)" beside two rows), and only
    // when those rows have no word of their own in that column. A one-line word whose
    // box merely overlaps the neighbours belongs to the nearest row.
    for (const fw of floating) {
      const hit = [];
      vrows.forEach((r, j) => { if (fw.y0 < r.y1 - 1 && fw.y1 > r.y0 + 1) hit.push(j); });
      const overlapsX = (r) => r.words.some((w) => Math.min(w.x1, fw.x1) - Math.max(w.x0, fw.x0) > 2);
      const crowded = hit.some((j) => overlapsX(vrows[j]));
      let dest = 0;
      let rowSpan = 1;
      if (hit.length >= 2 && !crowded && hit[hit.length - 1] - hit[0] + 1 === hit.length) {
        dest = hit[0];
        rowSpan = hit.length;
      } else {
        let bestD = Infinity;
        vrows.forEach((r, j) => {
          const b = r.words[0]?.base ?? (r.y0 + r.y1) / 2;
          const d = Math.abs(b - fw.base);
          if (d < bestD) { bestD = d; dest = j; }
        });
      }
      const tok = { x0: fw.x0, x1: fw.x1, words: [fw], text: fw.text, rowSpan };
      rowsIn[firstRow + dest].tokens.push(tok);
      rowsIn[firstRow + dest].tokens.sort((a, b) => a.x0 - b.x0);
    }
  }
  if (rowsIn.length < 2) return null;
  // A framed code listing or display equation is not a table; the free pass reads its lines.
  const run = rowsIn.map((r) => ({ row: { words: r.tokens.flatMap((t) => t.words), lines: [] }, tokens: r.tokens }));
  if (equationRun(run, { x0: band.x0, x1: band.x1 })) return null;
  // A framed box of prose and numbered monospace code: rows that are one long token, or a line
  // number plus monospace text, are not table rows; a table needs three others.
  let prose = 0;
  let tabular = 0;
  const numbered = run.filter((r) => r.tokens.length >= 2 && /^\d{1,4}$/.test(r.tokens[0].text));
  const mono = isMonospace(numbered.flatMap((r) => r.tokens.slice(1).flatMap((t) => t.words)));
  for (const r of run) {
    const first = r.tokens[0];
    const codeLike = mono && r.tokens.length >= 2 && /^\d{1,4}$/.test(first.text);
    if (r.tokens.length === 1 && r.row.words.length >= 5) prose++;
    else if (r.tokens.length >= 2 && !codeLike) tabular++;
  }
  if (tabular < 2 || prose >= 0.4 * run.length) return null;
  const headerRowsHint = edges.length > 2 ? bandsOf.slice(0, headerBands).reduce((n, k) => n + k, 0) : 0;
  mergeWrappedLabelRows(rowsIn, headerRowsHint);
  const table = buildTable(rowsIn, { bands: band, headerRowsHint });
  if (!table) return null;
  table.usedWords = inside;
  return table;
}

function hasSubRows(words, band) {
  const base = baselineGroups(words);
  if (base.length < 2) return false;
  let numeric = 0;
  let labels = 0;
  // Placeholders ("-", "NA", "..") stand for values too.
  const value = (t) => isNumericText(t.text) || /^[-–—.]{1,3}$|^n\/?a$/i.test(t.text);
  for (const g of base) {
    const toks = tokenizeLine({ words: [...g.words].sort((a, b) => a.x0 - b.x0), size: g.size });
    if (toks.filter(value).length >= 2) numeric++;
    const first = toks[0];
    if (toks.length >= 2 && first.x0 - band.x0 <= 1.5 * g.size && /^[A-Z0-9(]/.test(first.text)) labels++;
  }
  return numeric >= 2 || labels >= 2;
}

// Header baselines without rules between them: stacked fragments of one label merge into a
// row; a baseline whose token spans two or more tokens of the next one, a change of font
// size, or a blank line starts a new header row.
export function headerRowGroups(words) {
  const base = baselineGroups(words);
  const toks = base.map((g) => tokenizeLine({ words: [...g.words].sort((a, b) => a.x0 - b.x0), size: g.size }));
  const groups = [];
  for (let i = 0; i < base.length; i++) {
    const g = base[i];
    const prev = base[i - 1];
    let split = i === 0;
    if (!split) {
      const spans = toks[i - 1].some((t) => toks[i].filter((u) => u.x0 < t.x1 - 1 && u.x1 > t.x0 + 1).length >= 2);
      split = spans || Math.abs(g.size - prev.size) > 0.6 || g.base - prev.base > 1.9 * Math.max(g.size, prev.size);
    }
    if (split) groups.push({ y0: g.y0, y1: g.y1, words: [...g.words] });
    else { const last = groups[groups.length - 1]; last.words.push(...g.words); last.y0 = Math.min(last.y0, g.y0); last.y1 = Math.max(last.y1, g.y1); }
  }
  return groups;
}

// A label-only line right under a data row, flush with its label and followed by another
// data row that is not indented under it, is the label's wrapped second line.
function mergeWrappedLabelRows(rowsIn, headerRows = 0) {
  for (let i = Math.max(1, headerRows + 1); i < rowsIn.length; i++) {
    const row = rowsIn[i];
    const prev = rowsIn[i - 1];
    const next = rowsIn[i + 1];
    if (row.tokens.length !== 1 || prev.tokens.length < 2) continue;
    if (prev.tokens.flatMap((t) => t.words).every((w) => w.bold)) continue; // a header row
    const tok = row.tokens[0];
    if (tok.words.length > 3 || !/[A-Za-z]/.test(tok.text)) continue;
    const size = tok.words[0].size;
    if (row.y0 - prev.y1 > 0.8 * size) continue;
    const host = prev.tokens.find((t) => t.x0 < tok.x1 + 1 && t.x1 > tok.x0 - 1);
    if (!host) continue;
    const continuation = /^[a-z(\-–]/.test(tok.text) || tok.x0 - host.x0 >= 0.5 * size
      || (next && next.y0 - row.y1 <= 0.8 * size && next.tokens[0].x0 - tok.x0 < 0.5 * size);
    if (!continuation) continue;
    host.words.push(...tok.words);
    host.x0 = Math.min(host.x0, tok.x0); host.x1 = Math.max(host.x1, tok.x1);
    host.text = host.words.map((w) => w.text).join(" ");
    prev.y1 = Math.max(prev.y1, row.y1);
    rowsIn.splice(i, 1);
    i--;
  }
}

// Line fragments on one baseline form a row (lines.js splits rows at wide gaps).
export function baselineRows(lines) {
  const sorted = [...lines].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const rows = [];
  for (const l of sorted) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r.base - l.base) <= 0.3 * Math.max(r.size, l.size)) { r.lines.push(l); r.x1 = Math.max(r.x1, l.x1); }
    else rows.push({ base: l.base, size: l.size, x0: l.x0, x1: l.x1, lines: [l] });
  }
  for (const r of rows) {
    r.lines.sort((a, b) => a.x0 - b.x0);
    r.words = r.lines.flatMap((l) => l.words);
    r.y0 = Math.min(...r.lines.map((l) => l.y0));
    r.y1 = Math.max(...r.lines.map((l) => l.y1));
    r.text = r.lines.map((l) => l.text).join(" ");
  }
  return rows;
}

// A figure or table caption in the body has no page number beside it. The same
// words in a contents list do: the label, a wide gap, then the page.
function contentsEntry(tokens) {
  if (!tokens || tokens.length < 2) return false;
  const page = tokens[tokens.length - 1];
  const label = tokens[tokens.length - 2];
  if (!/^\d{1,4}$/.test(String(page.text || "").trim())) return false;
  const labelTokens = tokens.slice(0, -1);
  if (!labelTokens.some((t) => /[A-Za-z]/.test(t.text || ""))) return false;
  // A numeric body row also ends in a small integer. Its other cells are numbers.
  // A leading "2." is the figure's own number, not one of those cells.
  const body = labelTokens.filter((t, i) => !(i === 0 && /^\d{1,3}[.)]?$/.test(String(t.text || "").trim())));
  const nums = body.filter((t) => isNumericText(t.text)).length;
  if (nums >= 1 && nums >= body.length / 2) return false;
  return page.x0 - label.x1 >= 12;
}

// Two rows are enough when every value cell is a page number at one right edge.
// A contents page lists illustrations and tables in pairs, under their own heads.
function contentsList(run) {
  if (!run || run.length < 2) return false;
  const shaped = run.filter((r) => r.tokens.length >= 2);
  if (!shaped.length) return false;
  if (!shaped.every((r) => contentsEntry(r.tokens))) return false;
  const rights = shaped.map((r) => r.tokens[r.tokens.length - 1].x0);
  if (Math.max(...rights) - Math.min(...rights) > 18) return false;
  const right = Math.min(...rights);
  for (const r of run) {
    if (r.tokens.length >= 2) continue;
    if (r.tokens.length !== 1) return false;
    const tok = r.tokens[0];
    if (/^\d{1,4}$/.test(String(tok.text || "").trim())) continue;
    if (tok.x1 >= right - 4) return false;
  }
  return true;
}

// A contents list: labels on the left, a page number at one shared right edge.
// A title whose number landed on the line above is still a row of that list.
// An all-caps section head ("ILLUSTRATIONS.") ends it.
function contentsContinuation(row, tokens, run) {
  if (!run.length || tokens.length !== 1) return false;
  const head = String(row.text || "").trim();
  if (/^[A-Z][A-Z .]{2,40}$/.test(head)) return false;
  // Every row so far is a label plus one page number. A data row with more cells is not a contents list.
  const shaped = run.filter((r) => r.tokens.length >= 2);
  if (!shaped.length || !shaped.every((r) => contentsEntry(r.tokens))) return false;
  const right = Math.min(...shaped.map((r) => r.tokens[r.tokens.length - 1].x0));
  const tok = tokens[0];
  if (/^\d{1,4}$/.test(tok.text)) return tok.x0 >= right - 12;
  if (!/[A-Za-z]/.test(tok.text || "") || row.words.length > 18) return false;
  // A wrapped title continues under the label. A centred section head does not.
  const prev = shaped[shaped.length - 1];
  const label = prev.tokens.slice(0, -1);
  const lx0 = Math.min(...label.map((t) => t.x0));
  const lx1 = Math.max(...label.map((t) => t.x1));
  if (tok.x0 > (lx0 + lx1) / 2) return false;
  return tok.x1 < right - 4;
}

// A row of prose: many words, long on average, few gap tokens and none of them short.
export function proseRow(row, tokens, columnWidth = Infinity) {
  const words = row.words;
  const n = words.length;
  if (n < 6) return false;
  const chars = words.reduce((k, w) => k + w.text.length, 0);
  if (chars / n < 3.5) return false;
  if (Number.isFinite(columnWidth) && row.x1 - row.x0 < 0.6 * columnWidth) return false;
  const short = tokens.filter((t) => t.words.length <= 2 || isNumericText(t.text)).length;
  return tokens.length === 1 || (tokens.length < n / 2 && short === 0);
}

// Free mode: runs of aligned multi-token rows inside one column. Returns tables, and the
// candidates that read as display equations ("formula") or numbered code listings ("code").
export function detectStreamRuns(lines, { dots = [], column = null, rules = [], bridgeGaps = true } = {}) {
  const out = [];
  const rows = baselineRows(lines);
  const colBox = column || (lines.length ? { x0: Math.min(...lines.map((l) => l.x0)), x1: Math.max(...lines.map((l) => l.x1)) } : null);
  const colW = colBox ? colBox.x1 - colBox.x0 : Infinity;
  const tokensOf = (row) => row.lines.flatMap((l) => tokenizeLine(l)).sort((a, b) => a.x0 - b.x0);
  let i = 0;
  while (i < rows.length) {
    const run = [];
    const ruleLines = [];
    let headerRowsHint = 0;
    let lead = null; // first line of a wrapped label, waiting for its multi-token row
    let lastBase = null; // baseline of the last line taken into the run (rows, rules, wraps)
    let j = i;
    while (j < rows.length) {
      const row = rows[j];
      const tokens = tokensOf(row);
      if ((markerOf(row.lines[0], dots) && !contentsEntry(tokens) && !contentsContinuation(row, tokens, run)) || (CAPTION_RE.test(row.text) && !contentsEntry(tokens))) break;
      // A contents list ends at the next section head. Growing it further would
      // fail the list and drop the entries already read.
      if (run.length >= 2 && contentsList(run) && !contentsEntry(tokens) && !contentsContinuation(row, tokens, run)) break;
      // A rule drawn as a dash ("-" or "-----") is not a row and does not end the table.
      const ruleText = row.text.replace(/\s+/g, "");
      // A drawn rule (a dash, or four or more leader marks) is not a row. A bullet or a
      // star is a placeholder cell and stays. A stray ";" from a broken leader is not a cell.
      if (/^[-–—−_=.·•]{4,}$/.test(ruleText) || /^[-–—−]$/.test(ruleText) || ruleText === ";") {
        ruleLines.push(...row.lines);
        if (run.length && !headerRowsHint && run.length <= 3 && ruleText.length >= 4) headerRowsHint = run.length;
        lastBase = row.base;
        j++;
        continue;
      }
      if (lastBase != null && row.base - lastBase > 2.2 * row.size) {
        // A page whose rules already made a table does not bridge: the gap would join a
        // stacked rate or a row the lattice had already split. Unruled pages still do.
        // Monospaced tables are often double-spaced (about 2.5 em). Keep the row when its
        // numbers sit on the run's columns, or when it is a section banner whose next line
        // repeats the column heads. A wider gap still ends the table.
        if (!bridgeGaps) break;
        const gap = row.base - lastBase;
        const header = headerOf(run);
        const next = rows[j + 1];
        const nextTokens = next ? tokensOf(next) : null;
        const head = repeatsHeader(tokens, header) ? tokens : (nextTokens || tokens);
        const numericNext = nextTokens && nextTokens.filter((t) => isNumericText(t.text)).length >= 2;
        const numericHere = tokens.filter((t) => isNumericText(t.text)).length >= 2;
        const yearHeader = tokens.filter((t) => /^(1[89]|20)\d{2}$/.test(String(t.text).replace(/[^\d]/g, ""))).length >= 2;
        const near = next && next.base - row.base <= 2.8 * row.size;
        const bannerOnly = run.length > 0 && run.length <= 2 && run.every((r) => r.tokens.length < 3);
        // The same centred title again is a second table, not a new section.
        const title = normCell(row.text);
        const repeatedTitle = tokens.length < 3 && title.length >= 6 && run.some((r) => r.tokens.length < 3 && normCell(r.row.text) === title);
        const keep = !repeatedTitle && gap <= 3.4 * row.size && (
          (tokens.length >= 2 && alignsWithRun(run, tokens, row.size))
          || (near && repeatsHeader(head, header))
          || (near && tokens.length < 3 && numericNext && bannerOnly && !(nextTokens && nextTokens.filter((t) => /^(1[89]|20)\d{2}$/.test(String(t.text).replace(/[^\d]/g, ""))).length >= 2))
          || (numericHere && bannerOnly && !yearHeader)
        );
        if (!keep) break;
      }
      // A rule drawn as text ("-----") separates header from body; it is not a row.
      if (run.length && TEXT_RULE_RE.test(row.text.replace(/\s+/g, ""))) {
        ruleLines.push(...row.lines);
        if (!headerRowsHint && run.length <= 3) headerRowsHint = run.length;
        lastBase = row.base;
        j++;
        continue;
      }
      if (tokens.length < 2) {
        // A section line double-spaced above the first numeric header opens the table.
        // "Page." sits in the number column above the first contents entry.
        if (!run.length && tokens.length === 1) {
          const nxt = rows[j + 1];
          const nt = nxt ? tokensOf(nxt) : [];
          const num = nt.find((t) => /^\d{1,4}$/.test(t.text));
          const label = nt.find((t) => /[A-Za-z]/.test(t.text || "") && num && t.x1 < num.x0 - 4);
          if (num && label && tokens[0].x0 > label.x1 && Math.abs(tokens[0].x0 - num.x0) <= 24) {
            run.push({ row, tokens });
            headerRowsHint = Math.max(headerRowsHint, 1);
            lastBase = row.base;
            j++;
            continue;
          }
        }
        if (!run.length && row.words.length <= 8) {
          const nxt = rows[j + 1];
          const nt = nxt ? tokensOf(nxt) : [];
          const nextYears = nt.filter((t) => /^(1[89]|20)\d{2}$/.test(String(t.text).replace(/[^\d]/g, ""))).length;
          if (nextYears < 2 && nxt && nxt.base - row.base <= 3.4 * row.size && nt.filter((t) => isNumericText(t.text)).length >= 2) {
            run.push({ row, tokens });
            lastBase = row.base;
            j++;
            continue;
          }
        }
        // A contents title with no page number on its line is one token. Keep it as its
        // own row before the wrapped-cell rule glues it to the entry above.
        if (contentsContinuation(row, tokens, run)) {
          run.push({ row, tokens });
          lastBase = row.base;
          j++;
          continue;
        }
        const peek = (k) => (rows[k] ? { row: rows[k], tokens: tokensOf(rows[k]) } : null);
        const single = singleTokenRow(row, tokens, run, peek(j + 1), colBox, lead, peek(j + 2));
        if (single === "attach") { lastBase = row.base; j++; continue; }
        if (single === "lead") { lead = { row, tokens }; lastBase = row.base; j++; continue; }
        if (single === "row") { run.push({ row, tokens }); lastBase = row.base; j++; continue; }
        // A section title on its own line, then the same column heads again, is one table.
        const nxt = rows[j + 1];
        if (nxt && nxt.base - row.base <= 2.6 * row.size && repeatsHeader(tokensOf(nxt), headerOf(run))) {
          run.push({ row, tokens });
          lastBase = row.base;
          j++;
          continue;
        }
        break;
      }
      if (proseRow(row, tokens, colW)) break;
      if (lead) {
        // The wrapped label's first line joins this row as its leading token.
        const merged = mergeRows(lead, { row, tokens });
        run.push(merged);
        lead = null;
        lastBase = row.base;
        j++;
        continue;
      }
      run.push({ row, tokens });
      lastBase = row.base;
      j++;
    }
    if (lead) { j--; lead = null; }
    const multi = run.filter((r) => r.tokens.length >= 2).length;
    if (run.length >= 2) {
      const eq = equationRun(run, colBox);
      if (eq) { out.push(eq); i = j; continue; }
    }
    // Two rows are a contents list only when the page named it (figures, tables).
    // A numbered index has the same shape and is not a table by itself.
    const namedList = contentsList(run) && run.some((r) => /\b(figures?|tables?|illustrations?|plates?)\b/i.test(r.row.text || ""));
    if (multi >= 3 || namedList) {
      const code = codeRun(run);
      if (code) { out.push(code); i = j; continue; }
      const rowsIn = run.map((r) => ({ y0: r.row.y0, y1: r.row.y1, tokens: r.tokens }));
      if (contentsList(run)) {
        for (const r of rowsIn) {
          if (!contentsEntry(r.tokens)) continue;
          const page = r.tokens[r.tokens.length - 1];
          const label = r.tokens.slice(0, -1);
          const words = label.flatMap((t) => t.words || []);
          r.tokens = [{
            x0: Math.min(...label.map((t) => t.x0)),
            x1: Math.max(...label.map((t) => t.x1)),
            words,
            text: words.map((w) => w.text).join(" "),
          }, page];
        }
      }
      const table = buildTable(rowsIn, { headerRowsHint, rules });
      if (table && (contentsList(run) || !looksLikeProse(run)) && !sparseAxis(table) && !tickGrid(table) && !phraseTable(table)) {
        table.usedWords = run.flatMap((r) => r.row.words);
        table.lines = [...run.flatMap((r) => r.row.lines), ...ruleLines];
        out.push(table);
        i = j;
        continue;
      }
    }
    i = i + 1;
  }
  return out;
}

const TEXT_RULE_RE = /^[-–—_=.·•]{4,}$/;

// A single-token row inside a run: a wrapped cell line that attaches to the token above it,
// the first line of a wrapped label whose values sit on the next baseline ("lead"), a group
// label at the left edge, or a group header centred over the columns ("row"); else the run ends.
function singleTokenRow(row, tokens, run, next, colBox, lead, next2 = null) {
  if (tokens.length !== 1 || row.words.length > 8 || lead) return null;
  const tok = tokens[0];
  const near = (a, b) => Math.abs(a.base - b.base) <= 1.6 * Math.max(a.size, b.size);
  const overlapping = (toks) => toks.find((t) => t.x0 < tok.x1 + 1 && t.x1 > tok.x0 - 1);
  const prev = run[run.length - 1];
  // A footnote mark or bullet on its own baseline rides with the row above, in its column.
  if (prev && near(row, prev.row) && row.words.length === 1 && /^[^A-Za-z0-9]{1,2}$|^[a-z0-9]$/.test(tok.text) && !overlapping(prev.tokens)) {
    prev.tokens.push({ ...tok });
    prev.tokens.sort((a, b) => a.x0 - b.x0);
    prev.row.words.push(...tok.words);
    prev.row.lines.push(...row.lines);
    return "attach";
  }
  if (prev && near(row, prev.row)) {
    const host = overlapping(prev.tokens);
    // A wrapped cell's second line reads as a continuation (lower case, bracket, dash) or
    // is indented under its first line; a capitalised line at the label edge is a new row.
    let continuation = /^[a-z(\-–]/.test(tok.text) || (host && tok.x0 - host.x0 >= 0.5 * row.size);
    // A short capitalised line flush with the label above, between two data rows that are
    // not indented under it, is the label's second line ("American Indian/Alaska" / "Native").
    const prevHeader = prev.row.words.every((w) => w.bold) || (run.length === 1 && prev.tokens.slice(1).every((t) => !isNumericText(t.text)));
    if (!continuation && host && !prevHeader && row.words.length <= 3 && next && near(row, next.row) && next.tokens[0].x0 - tok.x0 < 0.5 * row.size) continuation = true;
    if (host && prev.tokens.length >= 2 && continuation && /[A-Za-z]/.test(tok.text)) {
      host.words.push(...tok.words);
      host.x0 = Math.min(host.x0, tok.x0); host.x1 = Math.max(host.x1, tok.x1);
      host.text = host.words.map((w) => w.text).join(" ");
      prev.row.words.push(...tok.words);
      prev.row.lines.push(...row.lines);
      prev.row.y1 = Math.max(prev.row.y1, row.y1);
      return "attach";
    }
  }
  if (!next || !near(row, next.row)) return null;
  // Stacked spanning headers ("2007" over "Inadequate housing"): look one line further.
  const after = next.tokens.length >= 2 ? next : (next2 && next2.tokens.length >= 2 && near(next.row, next2.row) ? next2 : null);
  if (!after) return null;
  const leftEdge = colBox ? colBox.x0 : Math.min(...(prev ? prev.tokens : after.tokens).map((t) => t.x0));
  const atLeft = tok.x0 - leftEdge <= 1.5 * row.size;
  if (next.tokens.length >= 2 && !overlapping(next.tokens) && atLeft) return "lead";
  // A group label at the left edge joins the run; a header centred over the columns only
  // opens a run (after body rows it is the next table's header).
  if (row.words.length <= 6 && (atLeft ? run.length >= 1 : run.length <= 2)) return "row";
  return null;
}

function mergeRows(lead, cur) {
  const tok = lead.tokens[0];
  const row = cur.row;
  row.words.push(...tok.words);
  row.lines.push(...lead.row.lines);
  row.y0 = Math.min(row.y0, lead.row.y0);
  return { row, tokens: [...cur.tokens, { ...tok }].sort((a, b) => a.x0 - b.x0) };
}

// Bracketed matrices and other multi-line display equations: an equation number at the column
// edge or a "D =" lead-in on one row, plus delimiter or math glyphs.
function equationRun(run, column) {
  let number = null;
  let lead = false;
  let delimiters = false;
  let math = 0;
  for (const r of run) {
    const sig = equationRowSignals(r.row.words, { column });
    if (sig.number) number = sig.number;
    if (sig.lead) lead = true;
    if (sig.delimiters) delimiters = true;
    if (sig.math) math++;
  }
  const strong = (number && (lead || delimiters || math >= run.length / 2)) || (lead && delimiters) || (delimiters && math >= run.length / 2);
  if (!strong) return null;
  const lines = run.flatMap((r) => r.row.lines);
  return { type: "formula", number, lines, usedWords: run.flatMap((r) => r.row.words) };
}

// Monospace text: every word's width per glyph is the same (within 15%). Digits share one
// width in proportional fonts too, so only words with letters count, and three are needed.
export function isMonospace(words) {
  const letters = words.filter((w) => w.text.length >= 2 && /[A-Za-z].*[A-Za-z]/.test(w.text));
  if (letters.length >= 2 && letters.filter((w) => w.mono).length >= 0.6 * letters.length) return true;
  const widths = words.filter((w) => w.text.length >= 2 && !w.sup && !w.sub && /[A-Za-z].*[A-Za-z]/.test(w.text)).map((w) => (w.x1 - w.x0) / w.text.length).sort((a, b) => a - b);
  if (widths.length < 3) return false;
  const med = widths[widths.length >> 1];
  const agree = widths.filter((w) => Math.abs(w - med) <= 0.12 * med).length;
  return agree >= 0.8 * widths.length;
}

// A listing: the first token of every row is the line number, counting up by one, and the
// code after it is set in a monospace font (a "No." column in a proportional font is a table).
function codeRun(run) {
  let expect = null;
  let withCode = 0;
  for (const r of run) {
    const first = r.tokens[0];
    if (!first || !/^\d{1,4}$/.test(first.text)) return null;
    const n = Number(first.text);
    if (expect != null && n !== expect) return null;
    expect = n + 1;
    if (r.tokens.length >= 2) withCode++; // a blank line keeps its number only
  }
  if (withCode < 2) return null;
  if (!isMonospace(run.flatMap((r) => r.tokens.slice(1).flatMap((t) => t.words)))) return null;
  const lines = run.flatMap((r) => r.row.lines);
  const text = run.map((r) => r.tokens.slice(1).map((t) => t.text).join(" ")).join("\n");
  return { type: "code", lines, text, usedWords: run.flatMap((r) => r.row.words) };
}

// Axis ticks of a chart on a scanned page (no vector graphics to make a figure): a few rows
// of short numbers with most cells empty.
function sparseAxis(table) {
  if (table.rows > 3) return false;
  const filled = table.cells.filter((c) => c.text).length;
  return filled < 0.6 * table.cells.length;
}

// Chart ticks read as a short table: a few short numbers, each spanning the grid, so the
// cell list looks full while most of the row/column slots are empty.
export function tickGrid(table) {
  if (!table || table.rows > 4 || table.cols < 4) return false;
  const slots = table.rows * table.cols;
  const filled = (table.cells || []).filter((c) => String(c.text || "").trim());
  if (filled.length < 4 || filled.length / slots >= 0.5) return false;
  const tick = (s) => /^\d{1,3}$/.test(s);
  return filled.filter((c) => tick(c.text.trim())).length / filled.length >= 0.75;
}

function normCell(s) {
  return String(s || "").replace(/[^\w.]/g, "").toLowerCase();
}

function valueTokens(tokens) {
  return (tokens || []).slice(1).map((t) => normCell(t.text)).filter((s) => s && s.length <= 12);
}

// The first row of short column heads ("0", "12", "15"), not a section banner.
function headerOf(run) {
  const multi = run.filter((r) => valueTokens(r.tokens).length >= 2);
  return multi.length ? multi[0].tokens : null;
}

// The same heads again: the value cells agree, so a new section is not a new table.
function repeatsHeader(tokens, header) {
  if (!header || !tokens) return false;
  const a = valueTokens(header);
  const b = valueTokens(tokens);
  if (a.length < 2 || b.length < 2) return false;
  let same = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  if (same >= 2 && same / n >= 0.6) return true;
  // A label that split ("in." "of Hg" "0" "12" "15") still ends with the heads.
  const tail = b.slice(-a.length);
  return tail.length === a.length && tail.every((s, i) => s === a[i]);
}

// Number columns of a monospaced table: token starts land on an earlier row's starts.
function alignsWithRun(run, tokens, size) {
  if (!tokens || tokens.length < 2) return false;
  const prev = [];
  for (const r of run) for (const t of r.tokens.slice(1)) prev.push(t.x0);
  if (prev.length < 2) return false;
  const tol = Math.max(4, 0.6 * size);
  let hit = 0;
  for (const t of tokens.slice(1)) if (prev.some((x) => Math.abs(x - t.x0) <= tol)) hit++;
  return hit >= 2;
}

// A paragraph read as a table: most filled cells are phrases of five or more words.
export function phraseTable(table) {
  const filled = (table.cells || []).filter((c) => String(c.text || "").trim());
  if (filled.length < 4) return false;
  const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
  const phrases = filled.filter((c) => words(c.text).length >= 5).length;
  if (phrases / filled.length > 0.5) return true;
  // The same sentence split one word to a cell: the row joins into a phrase, and almost
  // no cell is a number. A numeric table keeps its values.
  const numeric = filled.filter((c) => isNumericText(c.text)).length;
  if (numeric / filled.length >= 0.2) return false;
  const byRow = new Map();
  for (const c of filled) {
    if (!byRow.has(c.r)) byRow.set(c.r, []);
    byRow.get(c.r).push(c.text);
  }
  let long = 0;
  for (const ts of byRow.values()) if (words(ts.join(" ")).length >= 8) long++;
  return byRow.size >= 3 && long / byRow.size > 0.5;
}

// Justified prose splits into tokens at random x; tables keep short cells with wide gaps.
function looksLikeProse(run) {
  let wordy = 0;
  for (const r of run) {
    const words = r.row.words.length;
    const chars = r.row.words.reduce((n, w) => n + w.text.length, 0);
    if (words >= 6 && chars / words >= 3.5 && r.tokens.length < words / 2) wordy++;
  }
  return wordy >= run.length * 0.5;
}
