// Parse step: ruled (lattice) tables from rules and boxes. Pure.

import { relineWords, round } from "./lines.js";
import { snapRules } from "./rules.js";

export const NUMERIC_RE = /^[\s\d.,%±+\-–−()$€£¢×·^]*\d[\s\d.,%±+\-–−()$€£¢×·^]*$/;

export function isNumericText(text) {
  return NUMERIC_RE.test(text.trim()) && /\d/.test(text);
}

// Words of one cell -> text; wrapped lines ending in "-" join without a space.
export function cellTextOf(words) {
  const lines = relineWords(words);
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
    else text += ` ${t}`;
  }
  return text.replace(/\s+/g, " ").trim();
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
  for (const g of snapped.h) for (const iv of g.intervals) segs.push({ axis: "h", pos: g.pos, a: iv.a, b: iv.b, thick: iv.thick });
  for (const g of snapped.v) for (const iv of g.intervals) segs.push({ axis: "v", pos: g.pos, a: iv.a, b: iv.b, thick: iv.thick });
  return segs;
}

function connected(s, t, tol = 2) {
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
  let multi = 0;
  for (const r of rows) {
    if (r.tokens >= 2) multi++;
    const n = r.words.length;
    const chars = r.words.reduce((k, w) => k + w.text.length, 0);
    // Prose: a long full-width line that does not break into gap-separated tokens, or whose
    // tokens are all long runs. Any short or numeric token beside a label makes a table row.
    const prose = n >= 7 && chars / n >= 3.5 && r.x1 - r.x0 >= 0.7 * width && (r.tokens === 1 || (r.tokens < n / 2 && shortTokens(r) === 0));
    if (prose) return { rows, tabular: false, reason: "prose" };
    if (CAPTION_START_RE.test(r.text) && r.words.length >= 3 && r.x0 - box.x0 <= 0.15 * width) return { rows, tabular: false, reason: "caption" };
  }
  // One short single-token line between two rules is a group label or a wrapped cell line.
  if (rows.length === 1 && rows[0].tokens === 1 && rows[0].words.length <= 6) return { rows, tabular: true, reason: "label row" };
  // Wrapped cells put short single-token fragments on their own baselines around the row.
  const fragments = rows.every((r) => r.tokens >= 2 || r.words.length <= 4);
  return { rows, tabular: multi >= Math.ceil(rows.length * 0.5) || (multi >= 1 && fragments), reason: "single-token rows" };
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
  const snapped = snapRules(rules);
  const segs = segmentsOf(snapped);
  const uf = new UF(segs.length);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (connected(segs[i], segs[j])) uf.union(i, j);
  const comps = new Map();
  segs.forEach((s, i) => { const r = uf.find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(s); });

  const tables = [];
  const bands = [];
  const usedWords = new Set();
  const usedRules = new Set();
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
    const xs = xsAll.map((o) => o.pos);
    const ys = ysAll.map((o) => o.pos);
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
      const table = assembleTable(grid, comp, boxes, words, ysAll, usedWords);
      if (table) {
        tables.push(table);
        for (const s of comp) usedRules.add(s);
        continue;
      }
    }
    // Hollow grid (partial verticals inside wider horizontals): one band when its text reads
    // as rows. Otherwise the horizontals are free rules; a frame around prose is not a table.
    const innerV = xs.filter((x) => x > hx0 + 3 && x < hx1 - 3).length;
    if (hs.length >= 2 && vs.length && (innerV > 0 || tabularBetween(words, { x0, x1, y0, y1 }).tabular)) {
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
  return { tables, bands, usedWords, usedRules, segments: segs };
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
      if (aligned.length >= 2 && numericCols.length >= 1) {
        for (let i = 1; i < rowsIn.length; i++) {
          const a = rowsIn[i - 1]; const b = rowsIn[i];
          cuts.push((a.base + 0.22 * a.size + b.base - 0.8 * b.size) / 2);
        }
      }
    }
    for (const y of cuts) { newYs.push(y); newTop.push(Array.from({ length: cols }, () => true)); newLeft.push(grid.left[r]); changed = true; }
    newYs.push(ys[r + 1]);
    newTop.push(grid.top[r + 1]);
    newLeft.push(grid.left[r]);
  }
  if (!changed) return grid;
  return { ...grid, ys: newYs, rows: newYs.length - 1, top: newTop, left: newLeft, splitRows: true };
}

function assembleTable(gridIn, segs, boxes, words, ysAll, usedWords) {
  const grid = splitRowsByText(gridIn, words);
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
    usedWords.add(w);
    inWords++;
  }
  if (!inWords) return null;
  // Header rows: shaded (light box over the row) or all-bold leading rows, or a double rule below.
  const rowShaded = [];
  for (let r = 0; r < rows; r++) {
    const rowH = ys[r + 1] - ys[r];
    let shade = 0;
    for (const b of boxes) {
      if (!b.light) continue;
      const oy = Math.min(b.y1, ys[r + 1]) - Math.max(b.y0, ys[r]);
      const ox = Math.min(b.x1, bx1) - Math.max(b.x0, bx0);
      if (oy > 0.5 * rowH && ox > 0) shade += ox;
    }
    rowShaded[r] = shade >= 0.5 * (bx1 - bx0);
  }
  const rowBold = [];
  for (let r = 0; r < rows; r++) {
    const ws = cells.filter((k) => r >= k.r && r < k.r + k.rowSpan).flatMap((k) => k.words);
    rowBold[r] = ws.length > 0 && ws.every((w) => w.bold);
  }
  let headerRows = 0;
  while (headerRows < rows - 1 && (rowShaded[headerRows] || rowBold[headerRows])) headerRows++;
  if (!headerRows && ysAll[1] && ysAll[1].double) headerRows = 1;
  // A header cell spanning into body rows extends the header band.
  for (const k of cells) if (k.r < headerRows && k.r + k.rowSpan > headerRows && k.r + k.rowSpan < rows) headerRows = k.r + k.rowSpan;
  let withText = 0;
  for (const cell of cells) {
    cell.text = cellTextOf(cell.words);
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
    if (tokens.length < 2) return false;
    const cols = new Set();
    for (const t of tokens) {
      if (inner.some((x) => t.x0 < x - 1 && t.x1 > x + 1)) return false;
      const mid = (t.x0 + t.x1) / 2;
      let c = c0;
      for (let i = c0; i <= c1; i++) if (mid >= xs[i] && mid < xs[i + 1]) { c = i; break; }
      cols.add(c);
    }
    if (cols.size >= 2) split++;
  }
  return split >= Math.ceil(rows.length * 0.5);
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
