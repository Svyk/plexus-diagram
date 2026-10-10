// Parse step: ruled (lattice) tables from rules and boxes. Pure.

import { relineWords, round } from "./lines.js";
import { luminanceOf, snapRules } from "./rules.js";

export const NUMERIC_RE = /^[\s\d.,%±+\-–−()$€£¢×·^]*\d[\s\d.,%±+\-–−()$€£¢×·^]*$/;

export function isNumericText(text) {
  return NUMERIC_RE.test(text.trim()) && /\d/.test(text);
}

// Words of one cell -> text; wrapped lines ending in "-" join without a space.
export const LEADER_RE = /^[.·…]{4,}$/;

function wordBox(w) {
  if (w.boxY) return [w.x0, w.boxY[0], w.x1, w.boxY[1]];
  if (w.y0 != null && w.y1 != null) return [w.x0, w.y0, w.x1, w.y1];
  return null;
}

// A low-confidence single digit sitting on a surer word is a second boxing of that word
// (a nearest-neighbour speck read as "1" inside "25").
function withoutEchoDigits(words) {
  return words.filter((w) => {
    if (w.conf == null || w.conf > 0.3 || !/^\d$/.test(w.text)) return true;
    const a = wordBox(w);
    if (!a) return true;
    const area = Math.max(0.01, (a[2] - a[0]) * (a[3] - a[1]));
    return !words.some((o) => {
      if (o === w || (o.conf != null && o.conf <= w.conf)) return false;
      const b = wordBox(o);
      if (!b) return false;
      const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      return ox > 0 && oy > 0 && ox * oy >= 0.25 * area;
    });
  });
}

// "Tempera" / "ture" is one word broken across baselines. "Total" / "population"
// and "wet" / "clean" stay two words. A short lowercase tail that is not itself
// a word joins the longer word above it.
const STANDALONE = new Set("a an of the and or in on at to for per from by with no as if be is it vs day year man men all not but its are was than into over note unit each both such only also more most less high low net out new old age end use oil gas".split(" "));

function midWordWrap(prev, next) {
  const last = String(prev || "").trim().split(/\s+/).pop() || "";
  const first = (String(next || "").trim().split(/\s+/)[0] || "").replace(/[.,;:]+$/, "");
  if (!/[A-Za-z]$/.test(last) || last.length < 5) return false;
  if (!/^[a-z]{1,4}$/.test(first) || STANDALONE.has(first)) return false;
  return true;
}

export function cellTextOf(words) {
  const lines = relineWords(withoutEchoDigits(words).filter((w) => !LEADER_RE.test(w.text)));
  if (!lines.length) return "";
  let text = "";
  for (const line of lines) {
    let t = "";
    for (const w of line.words) {
      const piece = w.sup && /^\d+$/.test(w.text) ? sup(w.text) : w.text;
      if ((w.sup || w.sub) && t) t += piece;
      else t += (t ? " " : "") + piece;
    }
    if (!text) { text = t; continue; }
    if (text.endsWith("-") && /^[A-Za-z0-9]/.test(t)) text += t;
    else if (midWordWrap(text, t)) text += t;
    else text += ` ${t}`;
  }
  text = text.replace(/\s+/g, " ").trim();
  // OCR labels run into the leader ("d..", "h1.."). A born-digital leader is part of the
  // text the ICDAR set scores. A cell of only dots is a placeholder, and "c 0.1654" has none.
  const ocr = (words || []).some((w) => w && (w.font === "ocr" || w.conf != null));
  if (!ocr || /^[.·…]+$/u.test(text)) return text;
  return text.replace(/(?:\s*[.·…]){2,}$/u, "").trim();
}

const SUPERS = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
function sup(t) { return t.split("").map((c) => SUPERS[c] ?? c).join(""); }

class UF {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { const x = this.find(a); const y = this.find(b); if (x !== y) this.p[y] = x; }
}

function segmentsOf(snapped) {
  const segs = [];
  for (const g of snapped.h) for (const iv of g.intervals) segs.push({ axis: "h", pos: g.pos, a: iv.a, b: iv.b, thick: iv.thick, fromBox: iv.fromBox });
  for (const g of snapped.v) for (const iv of g.intervals) segs.push({ axis: "v", pos: g.pos, a: iv.a, b: iv.b, thick: iv.thick, fromBox: iv.fromBox });
  return segs;
}

function connected(s, t, tol = 4) {
  // Only crossing or touching rules connect. Collinear rules were merged by snapRules; two
  // parallel horizontals never join on their own (stacked tables share a width).
  if (s.axis === t.axis) {
    // A double rule (two horizontals a few points apart over the same extent) is one boundary.
    if (s.axis !== "h" || Math.abs(s.pos - t.pos) > 4) return false;
    const overlap = Math.min(s.b, t.b) - Math.max(s.a, t.a);
    return overlap >= 0.9 * Math.max(s.b - s.a, t.b - t.a);
  }
  const h = s.axis === "h" ? s : t;
  const v = s.axis === "h" ? t : s;
  return v.pos >= h.a - tol && v.pos <= h.b + tol && h.pos >= v.a - tol && h.pos <= v.b + tol;
}

// Words between two y positions inside [x0, x1], grouped into baseline rows with gap tokens.
export function rowsBetween(words, { x0, x1, y0, y1 }) {
  const inside = words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2; const cy = w.base - 0.3 * w.size;
    return cx >= x0 - 2 && cx <= x1 + 2 && cy > y0 && cy < y1;
  }).sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const rows = [];
  for (const w of inside) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r.base - w.base) <= 0.3 * Math.max(r.size, w.size)) r.words.push(w);
    else rows.push({ base: w.base, size: w.size, words: [w] });
  }
  for (const r of rows) {
    r.words.sort((a, b) => a.x0 - b.x0);
    r.x0 = r.words[0].x0; r.x1 = Math.max(...r.words.map((w) => w.x1));
    const chars = Math.max(1, r.words.reduce((n, w) => n + w.text.length, 0));
    const charW = r.words.reduce((n, w) => n + (w.x1 - w.x0), 0) / chars || 0.5 * r.size;
    const threshold = Math.max(1.8 * charW, 0.6 * r.size);
    let tokens = 0; let last = null;
    for (const w of r.words) { if (!last || w.x0 - last.x1 >= threshold) tokens++; last = w; }
    r.tokens = tokens;
    r.text = r.words.map((w) => w.text).join(" ");
  }
  return rows;
}

// Does the text between two rules read as table rows (not prose, not a caption)?
export function tabularBetween(words, box) {
  const rows = rowsBetween(words, box);
  if (!rows.length) return { rows, tabular: true, empty: true };
  const width = box.x1 - box.x0;
  for (const r of rows) {
    const n = r.words.length;
    const chars = r.words.reduce((k, w) => k + w.text.length, 0);
    // Prose: a long full-width line that does not break into gap-separated tokens, or whose
    // tokens are all long runs. Any short or numeric token beside a label makes a table row.
    const prose = n >= 7 && chars / n >= 3.5 && r.x1 - r.x0 >= 0.7 * width && (r.tokens === 1 || (r.tokens < n / 2 && shortTokens(r) === 0 && longestToken(r) >= 5));
    if (prose) return { rows, tabular: false, reason: "prose" };
    if (CAPTION_START_RE.test(r.text) && r.words.length >= 3 && r.x0 - box.x0 <= 0.15 * width) return { rows, tabular: false, reason: "caption" };
  }
  // One short single-token line between two rules is a group label or a wrapped cell line.
  if (rows.length === 1 && rows[0].tokens === 1 && rows[0].words.length <= 6) return { rows, tabular: true, reason: "label row" };
  // Visual rows: baseline rows chained by box overlap, so a label wrapped onto two baselines
  // with its numbers centred between them counts once, as one multi-token row.
  const groups = [];
  for (const r of rows) {
    const y0 = r.base - 0.8 * r.size; const y1 = r.base + 0.22 * r.size;
    const g = groups[groups.length - 1];
    if (g && y0 < g.y1 - 1) { g.y1 = Math.max(g.y1, y1); g.rows.push(r); }
    else groups.push({ y0, y1, rows: [r] });
  }
  let multi = 0;
  for (const g of groups) {
    if (g.rows.some((r) => r.tokens >= 2)) { multi++; continue; }
    // Two single-token baselines in distinct x ranges (label, then a value beside it).
    const spans = g.rows.map((r) => [r.x0, r.x1]);
    const disjoint = spans.some((a, i) => spans.some((b, j) => j > i && (a[1] < b[0] - 2 || b[1] < a[0] - 2)));
    if (disjoint) multi++;
  }
  // Wrapped cells put short single-token fragments on their own baselines around the row.
  const fragments = rows.every((r) => r.tokens >= 2 || r.words.length <= 4);
  return { rows, tabular: multi >= Math.ceil(groups.length * 0.5) || (multi >= 1 && fragments), reason: "single-token rows" };
}

// Filled boxes that tile a rectangle (coloured header rows, zebra shading, framed cells) carry
// the table grid in their edges. Boxes nested inside another box (padding insets) are dropped;
// a sparse set of boxes (chart bars) is not a tiling.
export function boxGridRules(boxes) {
  // White boxes are line backgrounds and knockouts, not tiles.
  const big = (boxes || []).filter((b) => b.x1 - b.x0 >= 8 && b.y1 - b.y0 >= 4 && !((luminanceOf(b.fill) ?? 0) >= 0.97));
  const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const outer = big.filter((b) => !big.some((o) => o !== b && o.x0 <= b.x0 + 0.5 && o.x1 >= b.x1 - 0.5 && o.y0 <= b.y0 + 0.5 && o.y1 >= b.y1 - 0.5 && area(o) > area(b) + 1));
  // Clusters of touching boxes.
  const clusters = outer.map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, items: [b] }));
  // Zebra stripes sit one unshaded row apart: boxes of overlapping width join across a
  // vertical gap of up to one typical box height.
  const heights = outer.map((b) => b.y1 - b.y0).sort((a, b) => a - b);
  const rowH = heights.length ? heights[heights.length >> 1] : 0;
  let merged = true;
  let guard = 0;
  while (merged && guard++ < 50) {
    merged = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i]; const b = clusters[j];
        const vgap = Math.max(a.y0 - b.y1, b.y0 - a.y1);
        const xo = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const stripe = vgap <= 1.3 * rowH && xo >= 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
        if (a.x0 > b.x1 + 3 || b.x0 > a.x1 + 3 || (vgap > 3 && !stripe)) continue;
        a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
        a.items.push(...b.items);
        clusters.splice(j, 1); j--; merged = true;
      }
    }
  }
  const rules = [];
  const used = [];
  for (const cl of clusters) {
    if (cl.items.length < 4) continue;
    const xs = uniqPositions(cl.items.flatMap((b) => [b.x0, b.x1]), 3);
    const ys = uniqPositions(cl.items.flatMap((b) => [b.y0, b.y1]), 3);
    if (xs.length < 3 || ys.length < 3) continue;
    const covered = cl.items.reduce((n, b) => n + area(b), 0);
    if (covered < 0.45 * area(cl)) continue;
    // Boxes must not overlap each other (a tiling), beyond a sliver.
    let overlap = 0;
    for (let i = 0; i < cl.items.length; i++) for (let j = i + 1; j < cl.items.length; j++) {
      const a = cl.items[i]; const b = cl.items[j];
      overlap += Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    }
    if (overlap > 0.05 * covered) continue;
    // The tiling's outer frame: unshaded rows between stripes keep their side boundaries.
    rules.push({ axis: "h", x0: cl.x0, x1: cl.x1, y0: cl.y0, y1: cl.y0, thick: 0.5, fromBox: true });
    rules.push({ axis: "h", x0: cl.x0, x1: cl.x1, y0: cl.y1, y1: cl.y1, thick: 0.5, fromBox: true });
    rules.push({ axis: "v", x0: cl.x0, x1: cl.x0, y0: cl.y0, y1: cl.y1, thick: 0.5, fromBox: true });
    rules.push({ axis: "v", x0: cl.x1, x1: cl.x1, y0: cl.y0, y1: cl.y1, thick: 0.5, fromBox: true });
    for (const b of cl.items) {
      rules.push({ axis: "h", x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y0, thick: 0.5, fromBox: true });
      rules.push({ axis: "h", x0: b.x0, x1: b.x1, y0: b.y1, y1: b.y1, thick: 0.5, fromBox: true });
      rules.push({ axis: "v", x0: b.x0, x1: b.x0, y0: b.y0, y1: b.y1, thick: 0.5, fromBox: true });
      rules.push({ axis: "v", x0: b.x1, x1: b.x1, y0: b.y0, y1: b.y1, thick: 0.5, fromBox: true });
      used.push(b);
    }
  }
  return { rules, boxes: used };
}

// Word count of the longest gap-separated token of a row.
function longestToken(row) {
  const chars = Math.max(1, row.words.reduce((n, w) => n + w.text.length, 0));
  const charW = row.words.reduce((n, w) => n + (w.x1 - w.x0), 0) / chars || 0.5 * row.size;
  const threshold = Math.max(1.8 * charW, 0.6 * row.size);
  let best = 0; let cur = 0; let last = null;
  for (const w of row.words) {
    if (last && w.x0 - last.x1 < threshold) cur++; else cur = 1;
    best = Math.max(best, cur);
    last = w;
  }
  return best;
}

// Gap-separated tokens of a row that are numbers or at most two words.
function shortTokens(row) {
  const chars = Math.max(1, row.words.reduce((n, w) => n + w.text.length, 0));
  const charW = row.words.reduce((n, w) => n + (w.x1 - w.x0), 0) / chars || 0.5 * row.size;
  const threshold = Math.max(1.8 * charW, 0.6 * row.size);
  let count = 0;
  let cur = null;
  const flush = () => { if (cur && (cur.n <= 2 || isNumericText(cur.text))) count++; };
  for (const w of row.words) {
    if (cur && w.x0 - cur.x1 < threshold) { cur.x1 = Math.max(cur.x1, w.x1); cur.n++; cur.text += ` ${w.text}`; }
    else { flush(); cur = { x1: w.x1, n: 1, text: w.text }; }
  }
  flush();
  return count;
}

const CAPTION_START_RE = /^(table|fig(ure)?\.?|chart|exhibit|box)\s*\d+/i;

function uniqPositions(values, tol) {
  const s = [...values].sort((a, b) => a - b);
  const out = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last.sum / last.n <= tol) { last.sum += v; last.n++; last.double = true; }
    else out.push({ sum: v, n: 1 });
  }
  return out.map((o) => ({ pos: o.sum / o.n, double: Boolean(o.double) }));
}

function unionLength(segs) {
  const iv = segs.map((s) => [Math.min(s.a, s.b), Math.max(s.a, s.b)]).sort((a, b) => a[0] - b[0]);
  let len = 0;
  let end = -Infinity;
  for (const [a, b] of iv) {
    const start = Math.max(a, end);
    if (b > start) len += b - start;
    end = Math.max(end, b);
  }
  return len;
}

// A column rule crosses a row line. A header subcolumn tick is only one row
// tall and stops on the header's bottom rule; it still names a column for the
// rows below. A bracket inside a body cell does neither: it stays in one
// column and does not end on a rule shared across the table. Row rules are
// horizontals that cross the table, or that run from one frame vertical to
// another and cross a frame in between (a row boundary under a spanning cell).
// A bar that starts and ends on the two sides of a single cell is a fraction bar.
function frameRuling(hs, vs) {
  if (hs.length < 2 || vs.length < 2) return null;
  const x0 = Math.min(...hs.map((s) => Math.min(s.a, s.b)));
  const x1 = Math.max(...hs.map((s) => Math.max(s.a, s.b)));
  const y0 = Math.min(...vs.map((s) => Math.min(s.a, s.b)));
  const y1 = Math.max(...vs.map((s) => Math.max(s.a, s.b)));
  const width = x1 - x0;
  const height = y1 - y0;
  if (!(width >= 40) || !(height >= 20)) return null;
  const rowYs = uniqPositions(hs.map((s) => s.pos), 4).map((o) => o.pos);
  const crossesRow = (s) => {
    const lo = Math.min(s.a, s.b);
    const hi = Math.max(s.a, s.b);
    return rowYs.some((y) => y > lo + 1 && y < hi - 1);
  };
  const multiRow = vs.filter((s) => s.b - s.a >= 36 && crossesRow(s));
  let headerBottom = null;
  const short = vs.filter((s) => s.b - s.a < 0.55 * height);
  for (const o of uniqPositions(short.map((s) => Math.max(s.a, s.b)), 4)) {
    const group = short.filter((s) => Math.abs(Math.max(s.a, s.b) - o.pos) <= 4);
    if (group.length < 3) continue;
    const gx0 = Math.min(...group.map((s) => s.pos));
    const gx1 = Math.max(...group.map((s) => s.pos));
    if (gx1 - gx0 < 0.5 * width) continue;
    if (o.pos > y0 + 0.6 * height) continue;
    if (!rowYs.some((y) => Math.abs(y - o.pos) <= 4)) continue;
    if (headerBottom == null || o.pos > headerBottom) headerBottom = o.pos;
  }
  const headerTick = (s) => headerBottom != null && Math.max(s.a, s.b) <= headerBottom + 4;
  const frames = uniqPositions(vs.filter((s) => multiRow.includes(s) || headerTick(s)).map((s) => s.pos), 4).map((o) => o.pos);
  // Two long verticals are only the outer frame. Interior columns are then the
  // shorter rules, and dropping them collapses the table to one column.
  if (frames.length < 3 || frames[frames.length - 1] - frames[0] < 0.9 * width) return null;
  const ys = [];
  for (const o of uniqPositions(hs.map((s) => s.pos), 4)) {
    const segs = hs.filter((s) => Math.abs(s.pos - o.pos) <= 4);
    if (!segs.length) continue;
    const covered = unionLength(segs);
    if (covered >= 0.55 * width) { ys.push(o.pos); continue; }
    const left = Math.min(...segs.map((s) => Math.min(s.a, s.b)));
    const right = Math.max(...segs.map((s) => Math.max(s.a, s.b)));
    let a = null;
    let b = null;
    for (const f of frames) {
      if (Math.abs(f - left) <= 4) a = f;
      if (Math.abs(f - right) <= 4) b = f;
    }
    if (a == null || b == null || !(b > a)) continue;
    const between = frames.some((f) => f > a + 1 && f < b - 1);
    const claimed = b - a;
    if (!between || claimed < 0.12 * width || covered < 0.7 * claimed) continue;
    ys.push(o.pos);
  }
  if (ys.length < 2) return null;
  return { xs: frames, ys };
}

function coverage(segs, axis, pos, a, b, tol = 1.5) {
  let covered = 0;
  for (const s of segs) {
    if (s.axis !== axis || Math.abs(s.pos - pos) > tol) continue;
    covered += Math.max(0, Math.min(s.b, b) - Math.max(s.a, a));
  }
  return b > a ? Math.min(1, covered / (b - a)) : 0;
}

// Returns { tables, bands, usedWords:Set, usedRules:Set(segment index), components }
export function findLatticeTables({ rules = [], boxes = [], words = [] }, { minW = 40, minH = 20 } = {}) {
  const tiling = boxGridRules(boxes);
  const snapped = snapRules(tiling.rules.length ? [...rules, ...tiling.rules] : rules);
  const segs = segmentsOf(snapped);
  const uf = new UF(segs.length);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (connected(segs[i], segs[j])) uf.union(i, j);
  const comps = new Map();
  segs.forEach((s, i) => { const r = uf.find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(s); });

  const tables = [];
  const bands = [];
  const usedWords = new Set();
  const usedRules = new Set();
  const released = []; // words of frame rows (title, notes) handed back to the text pass
  const leftover = []; // horizontal rules not consumed by a grid table
  for (const comp of comps.values()) {
    const hs = comp.filter((s) => s.axis === "h");
    const vs = comp.filter((s) => s.axis === "v");
    const ysAll = uniqPositions(hs.map((s) => s.pos), 4);
    const xsAll = uniqPositions(vs.map((s) => s.pos), 4);
    const x0 = Math.min(...comp.map((s) => (s.axis === "h" ? s.a : s.pos)));
    const x1 = Math.max(...comp.map((s) => (s.axis === "h" ? s.b : s.pos)));
    const y0 = Math.min(...comp.map((s) => (s.axis === "v" ? s.a : s.pos)));
    const y1 = Math.max(...comp.map((s) => (s.axis === "v" ? s.b : s.pos)));
    if (x1 - x0 < minW || y1 - y0 < minH) {
      // Too small for a grid; a lone horizontal rule may still bound a booktabs table.
      for (const s of hs) if (s.b - s.a >= minW) { s.compVs = vs; leftover.push(s); }
      continue;
    }
    const ruled = frameRuling(hs, vs);
    const xs = ruled ? ruled.xs : xsAll.map((o) => o.pos);
    const ys = ruled ? ruled.ys : ysAll.map((o) => o.pos);
    let grid = null;
    // Verticals must span the ruled width (and horizontals the ruled height), or the grid is
    // hollow: partial column separators inside a wider booktabs table.
    const hx0 = hs.length ? Math.min(...hs.map((s) => s.a)) : x0;
    const hx1 = hs.length ? Math.max(...hs.map((s) => s.b)) : x1;
    const vy0 = vs.length ? Math.min(...vs.map((s) => s.a)) : y0;
    const vy1 = vs.length ? Math.max(...vs.map((s) => s.b)) : y1;
    const spansWidth = xs.length >= 2 && xs[xs.length - 1] - xs[0] >= 0.9 * (hx1 - hx0);
    const spansHeight = ys.length >= 2 && ys[ys.length - 1] - ys[0] >= 0.9 * (vy1 - vy0);
    if (xs.length >= 2 && ys.length >= 2 && spansWidth && spansHeight) grid = buildGrid(comp, xs, ys);
    if (grid && grid.coverage >= 0.4 && grid.rows >= 2 && grid.cols >= 2) {
      const table = assembleTable(grid, comp, boxes, words, ysAll, usedWords, rules);
      if (table) {
        // Tick marks in a graph's grid are not cells. Leave the rules for the figure pass.
        if (chartGrid(table)) continue;
        released.push(...(table.released || []));
        delete table.released;
        tables.push(table);
        for (const s of comp) usedRules.add(s);
        continue;
      }
    }
    // Hollow grid (partial verticals inside wider horizontals): one band when its text reads
    // as rows. Otherwise the horizontals are free rules; a frame around prose is not a table.
    const innerV = xs.filter((x) => x > hx0 + 3 && x < hx1 - 3).length;
    if (ys.length >= 2 && vs.length && (innerV > 0 || tabularBetween(words, { x0, x1, y0, y1 }).tabular)) {
      bands.push(makeBand(hs, xs));
      continue;
    }
    for (const s of hs) { s.compVs = vs; leftover.push(s); }
  }
  // Bands: free horizontal rules sorted by y; consecutive rules of overlapping extent join when
  // the text between them reads as table rows (or nothing sits between two close rules).
  leftover.sort((a, b) => a.pos - b.pos || a.a - b.a);
  const taken = new Set();
  for (let i = 0; i < leftover.length; i++) {
    if (taken.has(leftover[i])) continue;
    const group = [leftover[i]];
    taken.add(leftover[i]);
    let last = leftover[i];
    for (let j = i + 1; j < leftover.length; j++) {
      const s = leftover[j];
      if (taken.has(s)) continue;
      if (s.pos - last.pos < -0.5) continue;
      const overlap = Math.min(s.b, last.b) - Math.max(s.a, last.a);
      const shorter = Math.min(s.b - s.a, last.b - last.a);
      if (overlap < 0.6 * shorter) continue;
      const gx0 = Math.min(s.a, last.a); const gx1 = Math.max(s.b, last.b);
      const between = tabularBetween(words, { x0: gx0, x1: gx1, y0: last.pos, y1: s.pos });
      if (between.empty && s.pos - last.pos > 6) break;
      if (!between.tabular) break;
      group.push(s);
      taken.add(s);
      last = s;
    }
    if (group.length < 2) continue;
    const band = makeBand(group, uniqPositions(group.flatMap((s) => (s.compVs || []).map((v) => v.pos)), 4).map((o) => o.pos));
    if (band.x1 - band.x0 < minW || band.y1 - band.y0 < minH) continue;
    bands.push(band);
  }
  // Boxes that drew a table's grid or sit inside one are the table's, not a figure's.
  const usedBoxes = new Set();
  for (const b of boxes) {
    const inside = tables.some((t) => b.x0 >= t.bbox[0] - 2 && b.x1 <= t.bbox[2] + 2 && b.y0 >= t.bbox[1] - 2 && b.y1 <= t.bbox[3] + 2);
    if (inside) usedBoxes.add(b);
  }
  return { tables, bands, usedWords, usedRules, usedBoxes, released, segments: segs };
}

function makeBand(group, xs) {
  const bx0 = Math.min(...group.map((s) => s.a));
  const bx1 = Math.max(...group.map((s) => s.b));
  const ysG = uniqPositions(group.map((s) => s.pos), 4);
  return {
    x0: bx0, x1: bx1, y0: ysG[0].pos, y1: ysG[ysG.length - 1].pos,
    ys: ysG.map((o) => ({ y: o.pos, full: coverage(group, "h", o.pos, bx0, bx1, 4) >= 0.85, thick: Math.max(...group.filter((s) => Math.abs(s.pos - o.pos) <= 4).map((s) => s.thick)), parts: group.filter((s) => Math.abs(s.pos - o.pos) <= 4).map((s) => [s.a, s.b]) })),
    xs,
    fullWidth: Math.max(...group.map((s) => s.b - s.a)),
    segs: group,
  };
}

function buildGrid(segs, xs, ys) {
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const top = []; // top[r][c] boundary exists above cell (r,c)
  const left = [];
  let present = 0;
  let total = 0;
  for (let r = 0; r <= rows; r++) {
    top[r] = [];
    for (let c = 0; c < cols; c++) {
      const ok = coverage(segs, "h", ys[r], xs[c], xs[c + 1], 2.5) >= 0.6;
      top[r][c] = ok; total++; if (ok) present++;
    }
  }
  for (let r = 0; r < rows; r++) {
    left[r] = [];
    for (let c = 0; c <= cols; c++) {
      const ok = coverage(segs, "v", xs[c], ys[r], ys[r + 1], 2.5) >= 0.6;
      left[r][c] = ok; total++; if (ok) present++;
    }
  }
  return { xs, ys, rows, cols, top, left, coverage: total ? present / total : 0 };
}

// Grid rows that hold several aligned text rows (numbers or short labels on shared baselines
// in two or more columns) split at the baselines: ruled columns, unruled body rows.
export function splitRowsByText(grid, words) {
  const { xs, ys, cols } = grid;
  const newYs = [ys[0]];
  const newTop = [grid.top[0]];
  const newLeft = [];
  let changed = false;
  for (let r = 0; r + 1 < ys.length; r++) {
    const rowsIn = rowsBetween(words, { x0: xs[0], x1: xs[cols], y0: ys[r], y1: ys[r + 1] });
    let cuts = [];
    if (rowsIn.length >= 3) {
      const colOf = (w) => { const mid = (w.x0 + w.x1) / 2; for (let c = 0; c < cols; c++) if (mid >= xs[c] && mid < xs[c + 1]) return c; return -1; };
      const perCol = Array.from({ length: cols }, () => ({ lines: 0, numeric: 0, short: 0 }));
      for (const row of rowsIn) {
        const byCol = new Map();
        for (const w of row.words) { const c = colOf(w); if (c < 0) continue; if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(w); }
        for (const [c, ws] of byCol) {
          const text = ws.map((w) => w.text).join(" ");
          perCol[c].lines++;
          if (isNumericText(text)) perCol[c].numeric++;
          if (ws.length <= 2 || isNumericText(text)) perCol[c].short++;
        }
      }
      const aligned = perCol.filter((p) => p.lines >= 2 && p.short === p.lines);
      const numericCols = perCol.filter((p) => p.lines >= 2 && p.numeric >= 0.5 * p.lines);
      // Data rows carry numbers in two or more columns on one baseline; a wrapped header
      // stacks words with at most a stray number per line.
      const numericRows = rowsIn.filter((row) => {
        const cs = new Set();
        for (const w of row.words) { const c = colOf(w); if (c >= 0 && isNumericText(w.text)) cs.add(c); }
        return cs.size >= 2;
      }).length;
      if (aligned.length >= 2 && numericCols.length >= 1 && numericRows >= 2) {
        // A line in one column set tighter than the row pitch is a wrapped cell, not a row.
        const pitches = rowsIn.slice(1).map((row, i) => row.base - rowsIn[i].base).sort((a, b) => a - b);
        const pitch = pitches[pitches.length >> 1];
        const colsOf = (row) => new Set(row.words.map(colOf).filter((c) => c >= 0));
        const dataLine = (row) => {
          const cs = new Set();
          for (const w of row.words) { const c = colOf(w); if (c >= 0 && isNumericText(w.text)) cs.add(c); }
          return cs.size >= 2;
        };
        for (let i = 1; i < rowsIn.length; i++) {
          const a = rowsIn[i - 1]; const b = rowsIn[i];
          const gap = b.base - a.base;
          const tight = gap < 0.7 * pitch;
          if (tight && (colsOf(a).size <= 1 || colsOf(b).size <= 1)) continue;
          // A hyphenated head ("Mm. of" / "mer-") or a unit line wraps across
          // several columns. A section label stacked on the next section label
          // is one column and stays its own row.
          const wrapped = colsOf(a).size >= 2 && colsOf(b).size >= 2
            || a.words.some((w) => /[-–]$/.test(String(w.text || "").trim()));
          if (!dataLine(a) && !dataLine(b) && wrapped && gap <= Math.max(1.2 * Math.max(a.size, b.size), 0.9 * pitch)) continue;
          cuts.push((a.base + 0.22 * a.size + b.base - 0.8 * b.size) / 2);
        }
      } else cuts = proseRowCuts(rowsIn, colOf);
    } else if (rowsIn.length === 2) {
      const colOf = (w) => { const mid = (w.x0 + w.x1) / 2; for (let c = 0; c < cols; c++) if (mid >= xs[c] && mid < xs[c + 1]) return c; return -1; };
      cuts = proseRowCuts(rowsIn, colOf);
    }
    for (const y of cuts) { newYs.push(y); newTop.push(Array.from({ length: cols }, () => true)); newLeft.push(grid.left[r]); changed = true; }
    newYs.push(ys[r + 1]);
    newTop.push(grid.top[r + 1]);
    newLeft.push(grid.left[r]);
  }
  if (!changed) return grid;
  return { ...grid, ys: newYs, rows: newYs.length - 1, top: newTop, left: newLeft, splitRows: true };
}

// Unruled rows of prose cells inside one ruled row: baselines fall into groups separated by
// a blank line, and most groups start with text in two or more columns on one baseline.
function proseRowCuts(rowsIn, colOf) {
  const groups = [[rowsIn[0]]];
  const hasLabel = (r) => r.words.some((w) => colOf(w) === 0);
  for (let i = 1; i < rowsIn.length; i++) {
    const a = rowsIn[i - 1]; const b = rowsIn[i];
    if (b.base - a.base > 1.7 * Math.min(a.size, b.size) && hasLabel(b)) groups.push([b]);
    else groups[groups.length - 1].push(b);
  }
  if (groups.length < 2) return [];
  let aligned = 0;
  for (const g of groups) {
    const cols = new Set();
    for (const w of g[0].words) { const c = colOf(w); if (c >= 0) cols.add(c); }
    if (cols.size >= 2) aligned++;
  }
  if (aligned < Math.ceil(groups.length * 0.5)) return [];
  const cuts = [];
  for (let i = 1; i < groups.length; i++) {
    const a = groups[i - 1][groups[i - 1].length - 1]; const b = groups[i][0];
    cuts.push((a.base + 0.22 * a.size + b.base - 0.8 * b.size) / 2);
  }
  return cuts;
}

const NOTES_RE = /^(notes?|sources?|exhibit reads|table reads|figure reads|\*|[a-z]\s|\d\s)/i;

// A ruled frame that encloses the title above the table and the notes below it: leading rows
// made of one full-width cell that reads as a caption, and trailing full-width rows of notes.
function frameRows(cells, rows, cols) {
  const fullRow = (r) => {
    const at = cells.filter((k) => r >= k.r && r < k.r + k.rowSpan);
    if (at.length !== 1 || at[0].colSpan !== cols || at[0].rowSpan !== 1) return null;
    return at[0];
  };
  const drop = new Set();
  for (let r = 0; r < rows - 1; r++) {
    const k = fullRow(r);
    if (!k) break;
    const text = cellTextOf(k.words);
    const n = text ? text.split(/\s+/).length : 0;
    if (!text || CAPTION_START_RE.test(text) || (r === 0 && n >= 6)) drop.add(r);
    else break;
  }
  // Trailing block of full-width rows: dropped from the topmost row that reads as a note
  // downward (continuation lines of a note are short, so the block is judged as a whole).
  const trailing = [];
  for (let r = rows - 1; r > 0; r--) {
    const k = fullRow(r);
    if (!k || drop.has(r)) break;
    trailing.unshift({ r, text: cellTextOf(k.words) });
  }
  const first = trailing.findIndex((t) => !t.text || NOTES_RE.test(t.text) || t.text.split(/\s+/).length >= 8);
  if (first >= 0) for (const t of trailing.slice(first)) drop.add(t.r);
  if (drop.size >= rows - 1) return new Set();
  return drop;
}

function verticalRule(rule) {
  if (!rule) return false;
  if (rule.axis === "v") return true;
  if (rule.axis === "h") return false;
  return Math.abs(rule.x1 - rule.x0) + 0.5 < Math.abs(rule.y1 - rule.y0);
}

// A vertical that does not reach the top and bottom rules is still a column
// when body words sit on both sides of it and almost none straddle it.
function partialColumnCuts(grid, rules, words) {
  const { xs, ys } = grid;
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  const height = y1 - y0;
  const cuts = [];
  for (const rule of rules || []) {
    if (!verticalRule(rule)) continue;
    const x = (rule.x0 + rule.x1) / 2;
    if (x <= xs[0] + 3 || x >= xs[xs.length - 1] - 3) continue;
    if (xs.some((v) => Math.abs(v - x) <= 3.5)) continue;
    if (cuts.some((v) => Math.abs(v.x - x) <= 3.5)) continue;
    const ry0 = Math.min(rule.y0, rule.y1);
    const ry1 = Math.max(rule.y0, rule.y1);
    const overlap = Math.min(ry1, y1) - Math.max(ry0, y0);
    if (overlap < Math.max(16, 0.22 * height)) continue;
    const left = new Set();
    const right = new Set();
    let straddle = 0;
    for (const w of words || []) {
      const cy = (w.base ?? 0) - 0.3 * (w.size || 8);
      if (cy <= y0 || cy >= y1) continue;
      const key = Math.round(cy);
      if (w.x1 <= x - 0.6) left.add(key);
      else if (w.x0 >= x + 0.6) right.add(key);
      else if (w.x0 < x - 1 && w.x1 > x + 1) straddle++;
    }
    if (left.size < 3 || right.size < 3 || straddle > 1) continue;
    cuts.push({ x, y0: Math.max(ry0, y0), y1: Math.min(ry1, y1) });
  }
  return cuts;
}

function insertColumn(grid, cut) {
  const { xs, ys, top, left } = grid;
  let at = xs.findIndex((v) => v > cut.x);
  if (at < 1) return grid;
  const xs2 = xs.slice();
  xs2.splice(at, 0, cut.x);
  const cols = xs2.length - 1;
  const rows = ys.length - 1;
  const splitCol = at - 1;
  const newTop = [];
  for (let r = 0; r <= rows; r++) {
    newTop[r] = [];
    for (let c = 0; c < cols; c++) {
      const oldC = c > splitCol ? c - 1 : c;
      newTop[r][c] = top[r][oldC];
    }
  }
  const newLeft = [];
  for (let r = 0; r < rows; r++) {
    newLeft[r] = [];
    const mid = (ys[r] + ys[r + 1]) / 2;
    const ruled = mid >= cut.y0 - 1 && mid <= cut.y1 + 1;
    for (let c = 0; c <= cols; c++) {
      if (c === at) { newLeft[r][c] = ruled; continue; }
      const oldC = c > at ? c - 1 : c;
      newLeft[r][c] = left[r][oldC];
    }
  }
  return { ...grid, xs: xs2, cols, top: newTop, left: newLeft };
}

// A last column whose right rule was not drawn: words continue one pitch
// past the frame, on the same baselines, and are short numbers or ids.
function extendRightEdge(grid, words) {
  const { xs, ys } = grid;
  const gaps = xs.slice(1).map((x, i) => x - xs[i]).filter((g) => g > 4).sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[gaps.length >> 1] : 0;
  if (pitch < 8 || pitch > 80) return grid;
  const right = xs[xs.length - 1];
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  const out = (words || []).filter((w) => {
    const cy = (w.base ?? 0) - 0.3 * (w.size || 8);
    // The missing rule sits just after the frame. A gutter to the next table is wider.
    return cy > y0 && cy < y1 && w.x0 > right + 0.4 && w.x0 < right + Math.max(8, 0.55 * pitch) && String(w.text || "").trim().length <= 10;
  });
  const bases = new Set(out.map((w) => Math.round((w.base || 0) / 2)));
  const numeric = out.filter((w) => /\d/.test(w.text || "")).length;
  if (bases.size < 3 || numeric < 0.5 * out.length) return grid;
  const x1 = Math.max(...out.map((w) => w.x1)) + 1.5;
  const cols = xs.length;
  const rows = ys.length - 1;
  const top = grid.top.map((row) => [...row, row[row.length - 1]]);
  const left = grid.left.map((row) => [...row, false]);
  return { ...grid, xs: [...xs, x1], cols, rows, top, left };
}

function assembleTable(gridIn, segs, boxes, words, ysAll, usedWords, pageRules) {
  let shaped = gridIn;
  for (const cut of partialColumnCuts(gridIn, pageRules, words)) shaped = insertColumn(shaped, cut);
  shaped = extendRightEdge(shaped, words);
  const grid = splitRowsByText(shaped, words);
  const { xs, ys, rows, cols, top, left } = grid;
  const uf = new UF(rows * cols);
  const id = (r, c) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && !left[r][c + 1]) uf.union(id(r, c), id(r, c + 1));
      if (r + 1 < rows && !top[r + 1][c]) uf.union(id(r, c), id(r + 1, c));
    }
  }
  const regions = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = uf.find(id(r, c));
    if (!regions.has(k)) regions.set(k, []);
    regions.get(k).push([r, c]);
  }
  let splitFixes = 0;
  const cells = [];
  for (const cellsIn of regions.values()) {
    const r0 = Math.min(...cellsIn.map((x) => x[0]));
    const r1 = Math.max(...cellsIn.map((x) => x[0]));
    const c0 = Math.min(...cellsIn.map((x) => x[1]));
    const c1 = Math.max(...cellsIn.map((x) => x[1]));
    if ((r1 - r0 + 1) * (c1 - c0 + 1) === cellsIn.length) {
      // A region spanning columns without a rule between them is still several cells when its
      // text falls into gap-separated tokens that each sit in their own sub-column (ruled
      // header, unruled body rows).
      if (c1 > c0 && tokensSplitColumns(words, xs, ys, r0, r1, c0, c1)) {
        for (const [r, c] of cellsIn) cells.push({ r, c, rowSpan: 1, colSpan: 1 });
      } else cells.push({ r: r0, c: c0, rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 });
    } else {
      splitFixes += cellsIn.length;
      for (const [r, c] of cellsIn) cells.push({ r, c, rowSpan: 1, colSpan: 1 });
    }
  }
  cells.sort((a, b) => a.r - b.r || a.c - b.c);
  const bx0 = xs[0]; const bx1 = xs[cols]; const by0 = ys[0]; const by1 = ys[rows];
  for (const cell of cells) {
    cell.bbox = [round(xs[cell.c]), round(ys[cell.r]), round(xs[cell.c + cell.colSpan]), round(ys[cell.r + cell.rowSpan])];
    cell.words = [];
  }
  const lookup = (x, y) => {
    let c = -1; let r = -1;
    for (let i = 0; i < cols; i++) if (x >= xs[i] && x <= xs[i + 1]) { c = i; break; }
    for (let j = 0; j < rows; j++) if (y >= ys[j] && y <= ys[j + 1]) { r = j; break; }
    if (c < 0 || r < 0) return null;
    return cells.find((k) => r >= k.r && r < k.r + k.rowSpan && c >= k.c && c < k.c + k.colSpan) || null;
  };
  let inWords = 0;
  for (const w of words) {
    const cx = (w.x0 + w.x1) / 2; const cy = (w.base - 0.3 * w.size);
    if (cx < bx0 - 1 || cx > bx1 + 1 || cy < by0 - 1 || cy > by1 + 1) continue;
    const cell = lookup(cx, cy);
    if (!cell) continue;
    cell.words.push(w);
    inWords++;
  }
  if (!inWords) return null;
  const framed = frameRows(cells, rows, cols);
  const released = [];
  if (framed.size) {
    const keep = [];
    for (const k of cells) { if (framed.has(k.r)) released.push(...k.words); else keep.push(k); }
    const rowMap = [];
    const newYs = [];
    let next = 0;
    for (let r = 0; r < rows; r++) { rowMap[r] = framed.has(r) ? -1 : next++; if (!framed.has(r)) newYs.push(ys[r]); }
    newYs.push(ys[rows]);
    for (let r = rows - 1; r >= 0; r--) if (!framed.has(r)) { newYs[newYs.length - 1] = ys[r + 1]; break; }
    for (const k of keep) { k.r = rowMap[k.r]; k.bbox = [round(xs[k.c]), round(newYs[k.r]), round(xs[k.c + k.colSpan]), round(newYs[k.r + k.rowSpan])]; }
    return finishTable({ xs, ys: newYs, rows: newYs.length - 1, cols, coverage: grid.coverage }, keep, boxes, ysAll, usedWords, splitFixes, released, pageRules);
  }
  return finishTable(grid, cells, boxes, ysAll, usedWords, splitFixes, released, pageRules);
}

function rowCells(cells, r) {
  return cells.filter((k) => r >= k.r && r < k.r + (k.rowSpan || 1));
}

function rowNumericCount(cells, r) {
  return rowCells(cells, r).filter((k) => (k.colSpan || 1) === 1 && isNumericText(k.text)).length;
}

function rowIsLabel(cells, r) {
  const texts = rowCells(cells, r).map((k) => String(k.text || "").trim()).filter(Boolean);
  if (!texts.length) return false;
  return rowNumericCount(cells, r) < 2;
}

function idHeaderRow(cells, r) {
  const texts = cells.filter((k) => k.r === r && (k.colSpan || 1) === 1).map((k) => String(k.text || "").trim()).filter(Boolean);
  const ids = texts.filter((t) => /^\d{4,6}$/.test(t));
  // One cell may hold a number that belongs to the row below. The rest are plain ids.
  return ids.length >= 4 && ids.length >= texts.length - 1 && ids.length / texts.length >= 0.6;
}

function ruleUnderRow(rules, grid, r) {
  const y = grid.ys?.[r + 1];
  if (y == null) return false;
  const x0 = grid.xs[0];
  const x1 = grid.xs[grid.xs.length - 1];
  const width = x1 - x0;
  if (!(width > 0)) return false;
  let cover = 0;
  for (const rule of rules || []) {
    const horiz = rule.axis === "h" || Math.abs(rule.y1 - rule.y0) + 0.5 < Math.abs(rule.x1 - rule.x0);
    if (!horiz) continue;
    const ry = (rule.y0 + rule.y1) / 2;
    if (Math.abs(ry - y) > 4) continue;
    cover += Math.max(0, Math.min(rule.x1, x1) - Math.max(rule.x0, x0));
  }
  return cover >= 0.45 * width;
}

function finishTable(grid, cells, boxes, ysAll, usedWords, splitFixes, released, pageRules) {
  const { xs, ys, rows, cols } = grid;
  const bx0 = xs[0]; const bx1 = xs[cols]; const by0 = ys[0]; const by1 = ys[rows];
  for (const cell of cells) for (const w of cell.words) usedWords.add(w);
  // Header rows: shaded (light box over the row) or all-bold leading rows, or a double rule below.
  // Header shading: a fill (light or dark) that covers the leading rows and no later row;
  // zebra striping recurs down the body and is not a header.
  const rowFill = [];
  for (let r = 0; r < rows; r++) {
    const rowH = ys[r + 1] - ys[r];
    const byFill = new Map();
    for (const b of boxes) {
      const oy = Math.min(b.y1, ys[r + 1]) - Math.max(b.y0, ys[r]);
      const ox = Math.min(b.x1, bx1) - Math.max(b.x0, bx0);
      if (oy > 0.5 * rowH && ox > 0) { const k = JSON.stringify(b.fill ?? (b.light ? "light" : "dark")); byFill.set(k, (byFill.get(k) || 0) + ox); }
    }
    let best = null;
    for (const [k, v] of byFill) if (v >= 0.5 * (bx1 - bx0) && (!best || v > best.v)) best = { k, v };
    rowFill[r] = best ? best.k : null;
  }
  const rowShaded = [];
  for (let r = 0; r < rows; r++) {
    const k = rowFill[r];
    rowShaded[r] = Boolean(k) && rowFill.slice(0, r + 1).every((f) => f === k) && !rowFill.slice(r + 1).includes(k);
  }
  const rowBold = [];
  for (let r = 0; r < rows; r++) {
    const ws = cells.filter((k) => r >= k.r && r < k.r + k.rowSpan).flatMap((k) => k.words);
    rowBold[r] = ws.length > 0 && ws.every((w) => w.bold);
  }
  let headerRows = 0;
  while (headerRows < rows - 1 && (rowShaded[headerRows] || rowBold[headerRows])) headerRows++;
  if (!headerRows && ysAll[1] && ysAll[1].double) headerRows = 1;
  for (const cell of cells) cell.text = cellTextOf(cell.words);
  // Leading rows of labels (a name line, then a unit line) are the header even
  // when nothing is bold or shaded. An identifier row under them (lab numbers)
  // is too, when a rule closes it and every cell is a plain id.
  const numericLater = (from) => {
    for (let r = from; r < rows; r++) if (rowNumericCount(cells, r) >= 2) return true;
    return false;
  };
  if (!headerRows) {
    let lead = 0;
    while (lead < rows - 1 && lead < 4 && rowIsLabel(cells, lead)) lead++;
    if (lead > 0 && numericLater(lead)) headerRows = lead;
  }
  while (headerRows < rows - 1 && headerRows < 4 && rowIsLabel(cells, headerRows) && rowCells(cells, headerRows).filter((k) => String(k.text || "").trim()).length >= 2 && numericLater(headerRows + 1)) headerRows++;
  if (headerRows > 0 && headerRows < rows - 1 && headerRows < 4 && idHeaderRow(cells, headerRows) && ruleUnderRow(pageRules, grid, headerRows)) headerRows++;
  // A header cell spanning into body rows extends the header band, but not
  // through a row that already holds the numbers.
  for (const k of cells) {
    if (!(k.r < headerRows && k.r + k.rowSpan > headerRows && k.r + k.rowSpan < rows)) continue;
    let end = k.r + k.rowSpan;
    while (end > headerRows && rowNumericCount(cells, end - 1) >= 2) end--;
    if (end > headerRows) headerRows = end;
  }
  let withText = 0;
  for (const cell of cells) {
    cell.header = cell.r < headerRows;
    cell.numeric = isNumericText(cell.text);
    cell.align = alignOf(cell);
    if (cell.text) withText++;
    delete cell.words;
  }
  let headerCols = 0;
  const bodyCol0 = cells.filter((k) => !k.header && k.c === 0);
  const bodyRest = cells.filter((k) => !k.header && k.c > 0 && k.text);
  if (bodyCol0.length && bodyCol0.every((k) => !k.numeric && k.text) && bodyRest.length && bodyRest.filter((k) => k.numeric).length >= 0.5 * bodyRest.length) headerCols = 1;
  // Axes and gridlines of a chart form a grid too; a table has text in most of its cells.
  if (withText < 0.3 * cells.length) return null;
  const confidence = Math.max(0, Math.min(1, 0.5 * grid.coverage + 0.3 * (withText / cells.length) + 0.2 * (1 - splitFixes / cells.length)));
  return {
    type: "table",
    bbox: [round(bx0), round(by0), round(bx1), round(by1)],
    rows, cols, headerRows, headerCols,
    cells, method: "lattice",
    grid: { xs: xs.map(round), ys: ys.map(round) },
    confidence: round(confidence),
    released,
  };
}

// Words of a merged region: tokens split at wide gaps; true when at least two tokens land in
// different sub-columns and none straddles an inner boundary.
function tokensSplitColumns(words, xs, ys, r0, r1, c0, c1) {
  const box = { x0: xs[c0], x1: xs[c1 + 1], y0: ys[r0], y1: ys[r1 + 1] };
  const rows = rowsBetween(words, box);
  if (!rows.length) return false;
  const inner = xs.slice(c0 + 1, c1 + 1);
  let split = 0;
  let considered = 0;
  for (const row of rows) {
    const chars = Math.max(1, row.words.reduce((n, w) => n + w.text.length, 0));
    const charW = row.words.reduce((n, w) => n + (w.x1 - w.x0), 0) / chars || 0.5 * row.size;
    const threshold = Math.max(1.8 * charW, 0.6 * row.size);
    const tokens = [];
    let cur = null;
    for (const w of row.words) {
      if (cur && w.x0 - cur.x1 < threshold) { cur.x1 = Math.max(cur.x1, w.x1); }
      else { cur = { x0: w.x0, x1: w.x1 }; tokens.push(cur); }
    }
    if (tokens.length < 2) continue;
    const cols = new Set();
    for (const t of tokens) {
      if (inner.some((x) => t.x0 < x - 1 && t.x1 > x + 1)) return false;
      const mid = (t.x0 + t.x1) / 2;
      let c = c0;
      for (let i = c0; i <= c1; i++) if (mid >= xs[i] && mid < xs[i + 1]) { c = i; break; }
      cols.add(c);
    }
    if (cols.size >= 2) split++;
    considered++;
  }
  if (!considered) return false;
  // A one-token row is a spanning head. It does not veto a split the other rows show.
  return split >= Math.ceil(considered * 0.5);
}

// A ruled grid whose cells are tick marks (".2", "—", "10") is a graph, not a table.
// Graph paper puts a tick on many rulings, so the interior is mostly empty rather than
// blank only on the outer frame. A dense numeric table (Smithsonian: a header of
// "0 1 2 3 …", a numeric stub, every cell filled) has the same short tokens and must stay a table.
export function chartGrid(table) {
  if (!table || table.rows < 8 || table.cols < 4) return false;
  const texts = (table.cells || []).map((c) => ({ c: c.c, r: c.r, text: String(c.text || "").trim() })).filter((c) => c.text);
  if (texts.length < 8) return false;
  const rows = table.rows;
  const cols = table.cols;
  const onAxis = (k) => k.r === 0 || k.r === rows - 1 || k.c === 0 || k.c === cols - 1;
  const interiorSlots = (rows - 2) * (cols - 2);
  if (interiorSlots <= 0) return false;
  // A tick sits on a ruling. The lattice cuts every line, so a number on an inner
  // gridline is an interior cell: the propeller pages fill 0.25–0.35 of the interior
  // and only a quarter to a half of the labels sit on the outer frame. A data table
  // fills that interior (Redwood 0.78, a Smithsonian numeric grid 1).
  const interiorFilled = texts.filter((k) => !onAxis(k)).length;
  if (interiorFilled / interiorSlots >= 0.45) return false;
  // A tick is a short token or a number. Glued ticks ("1 — —") and one crossed caption stay ticks
  // as long as they are not a column of words.
  const tick = (s) => s.length <= 4 || /^[-–—−.·\d\s]+$/.test(s);
  if (texts.filter((c) => tick(c.text)).length / texts.length < 0.75) return false;
  for (let col = 0; col < cols; col++) {
    const inCol = texts.filter((k) => k.c === col);
    const words = inCol.filter((k) => /[A-Za-z]{4,}/.test(k.text));
    if (words.length >= 3 && words.length >= 0.4 * Math.max(1, inCol.length)) return false;
  }
  const header = texts.filter((k) => k.r === 0 && /[A-Za-z]{4,}/.test(k.text));
  if (header.length >= 2) return false;
  return true;
}

// Bars of a chart: several filled boxes inside the band that span well under its width. Row
// shading and header fills span the whole table width and do not count.
export function looksLikeChart(band, graphics) {
  const width = band.x1 - band.x0;
  let bars = 0;
  for (const b of graphics.boxes || []) {
    const inside = b.x0 >= band.x0 - 2 && b.x1 <= band.x1 + 2 && b.y0 >= band.y0 - 2 && b.y1 <= band.y1 + 2;
    if (!inside || b.light) continue; // light fills are cell shading
    if (b.x1 - b.x0 < 0.6 * width && b.y1 - b.y0 > 4 && b.x1 - b.x0 > 4) bars++;
  }
  return bars >= 4;
}

export function alignOf(cell) {
  if (!cell.words || !cell.words.length) return "left";
  const x0 = Math.min(...cell.words.map((w) => w.x0));
  const x1 = Math.max(...cell.words.map((w) => w.x1));
  const dl = x0 - cell.bbox[0];
  const dr = cell.bbox[2] - x1;
  if (Math.abs(dl - dr) <= 2) return dl > 4 ? "center" : "left";
  return dl < dr ? "left" : "right";
}
