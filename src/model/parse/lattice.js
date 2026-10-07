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
  if (s.axis === t.axis) {
    if (s.axis !== "h") return false;
    const overlap = Math.min(s.b, t.b) - Math.max(s.a, t.a);
    const shorter = Math.min(s.b - s.a, t.b - t.a);
    return overlap >= 0.6 * shorter && Math.abs(s.pos - t.pos) <= 400;
  }
  const h = s.axis === "h" ? s : t;
  const v = s.axis === "h" ? t : s;
  return v.pos >= h.a - tol && v.pos <= h.b + tol && h.pos >= v.a - tol && h.pos <= v.b + tol;
}

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
  for (const comp of comps.values()) {
    const hs = comp.filter((s) => s.axis === "h");
    const vs = comp.filter((s) => s.axis === "v");
    const ysAll = uniqPositions(hs.map((s) => s.pos), 4);
    const xsAll = uniqPositions(vs.map((s) => s.pos), 4);
    const x0 = Math.min(...comp.map((s) => (s.axis === "h" ? s.a : s.pos)));
    const x1 = Math.max(...comp.map((s) => (s.axis === "h" ? s.b : s.pos)));
    const y0 = Math.min(...comp.map((s) => (s.axis === "v" ? s.a : s.pos)));
    const y1 = Math.max(...comp.map((s) => (s.axis === "v" ? s.b : s.pos)));
    if (x1 - x0 < minW || y1 - y0 < minH) continue;
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
    if (grid && grid.coverage >= 0.4) {
      const table = assembleTable(grid, comp, boxes, words, ysAll, usedWords);
      if (table) {
        tables.push(table);
        for (const s of comp) usedRules.add(s);
        continue;
      }
    }
    if (hs.length >= 2) {
      // Horizontal bands (booktabs) or a sparse grid: the stream detector takes the rules as hints.
      const spans = hs.map((s) => s.b - s.a);
      const full = Math.max(...spans);
      bands.push({
        x0, x1, y0, y1,
        ys: ysAll.map((o) => ({ y: o.pos, full: coverage(comp, "h", o.pos, x0, x1, 4) >= 0.85, thick: Math.max(...hs.filter((s) => Math.abs(s.pos - o.pos) <= 4).map((s) => s.thick)), parts: hs.filter((s) => Math.abs(s.pos - o.pos) <= 4).map((s) => [s.a, s.b]) })),
        xs,
        fullWidth: full,
        segs: comp,
      });
    }
  }
  return { tables, bands, usedWords, usedRules, segments: segs };
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

function assembleTable(grid, segs, boxes, words, ysAll, usedWords) {
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
      cells.push({ r: r0, c: c0, rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 });
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

export function alignOf(cell) {
  if (!cell.words || !cell.words.length) return "left";
  const x0 = Math.min(...cell.words.map((w) => w.x0));
  const x1 = Math.max(...cell.words.map((w) => w.x1));
  const dl = x0 - cell.bbox[0];
  const dr = cell.bbox[2] - x1;
  if (Math.abs(dl - dr) <= 2) return dl > 4 ? "center" : "left";
  return dl < dr ? "left" : "right";
}
