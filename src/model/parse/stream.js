// Parse step: borderless and booktabs (stream) tables from aligned text. Pure.

import { cellTextOf, isNumericText } from "./lattice.js";
import { round } from "./lines.js";
import { markerOf } from "./lists.js";
import { CAPTION_RE } from "./headings.js";

const GAP_MIN = 3;

export function tokenizeLine(line) {
  const chars = Math.max(1, line.words.reduce((n, w) => n + w.text.length, 0));
  const inkW = line.words.reduce((n, w) => n + (w.x1 - w.x0), 0);
  const charW = inkW / chars || 0.5 * line.size;
  const threshold = Math.max(1.8 * charW, 0.6 * line.size);
  const tokens = [];
  let cur = null;
  for (const w of line.words) {
    if (cur && w.x0 - cur.x1 < threshold) { cur.words.push(w); cur.x1 = Math.max(cur.x1, w.x1); }
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
  const ivs = full.flat().map((t) => [t.x0, t.x1]).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of ivs) {
    const last = cols[cols.length - 1];
    if (last && a <= last.x1 + GAP_MIN) last.x1 = Math.max(last.x1, b);
    else cols.push({ x0: a, x1: b });
  }
  return cols;
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

// Visual rows: words chained by vertical overlap of their boxes.
export function visualRows(words) {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rows = [];
  for (const w of sorted) {
    const r = rows[rows.length - 1];
    if (r && w.y0 < r.y1 - 1) { r.words.push(w); r.y1 = Math.max(r.y1, w.y1); r.y0 = Math.min(r.y0, w.y0); }
    else rows.push({ y0: w.y0, y1: w.y1, words: [w] });
  }
  return rows;
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

function buildTable(rowsIn, { bands = null, headerRowsHint = 0, caption = null }) {
  // rowsIn: [{ y0, y1, tokens, band }]
  const cols = projectColumns(rowsIn.map((r) => r.tokens));
  if (cols.length < 2) return null;
  const k = cols.length;
  const placed = rowsIn.map((r) => r.tokens.map((t) => ({ t, ...assignToken(t, cols) })));
  let conforming = 0;
  placed.forEach((row) => {
    const seen = new Set();
    let dup = false;
    for (const p of row) { if (seen.has(p.c)) dup = true; seen.add(p.c); }
    // Single-line rows (free mode) must map one token per column; banded rows may wrap inside a cell.
    const ok = seen.size >= 2 && (bands ? true : !dup);
    if (ok) conforming++;
  });
  const stability = conforming / rowsIn.length;
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
    while (headerRows < rows - 1 && boldRow(headerRows)) headerRows++;
    if (!headerRows && rows >= 2 && !numericRow(0) && numericRow(1)) headerRows = 1;
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
  // Centred text that does not touch the outer column of its span: widen into empty neighbours
  // while the span centre moves closer to the text centre.
  for (const cell of [...cellMap.values()]) {
    const mid = (Math.min(...cell.words.map((w) => w.x0)) + Math.max(...cell.words.map((w) => w.x1))) / 2;
    let guard = 0;
    while (guard++ < k) {
      const c0 = cell.c; const c1 = cell.c + cell.colSpan - 1;
      const cur = Math.abs((cols[c0].x0 + cols[c1].x1) / 2 - mid);
      const canLeft = c0 > 0 && !cellMap.has(`${cell.r}:${c0 - 1}`) && Math.abs((cols[c0 - 1].x0 + cols[c1].x1) / 2 - mid) < cur - 1;
      const canRight = c1 + 1 < k && !cellMap.has(`${cell.r}:${c1 + 1}`) && Math.abs((cols[c0].x0 + cols[c1 + 1].x1) / 2 - mid) < cur - 1;
      if (canLeft && (!canRight || Math.abs((cols[c0 - 1].x0 + cols[c1].x1) / 2 - mid) <= Math.abs((cols[c0].x0 + cols[c1 + 1].x1) / 2 - mid))) {
        cellMap.delete(`${cell.r}:${c0}`); cell.c = c0 - 1; cell.colSpan++; cellMap.set(`${cell.r}:${cell.c}`, cell);
      } else if (canRight) cell.colSpan++;
      else break;
    }
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

function coveredAt(cellMap, r, c, span) {
  for (let cc = c; cc < c + span; cc++) if (cellMap.get(`${r}:${cc}`)) return true;
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
  const edges = [band.y0 - 1, ...fullYs.filter((y) => y > band.y0 + 1 && y < band.y1 - 1), band.y1 + 1];
  for (let i = 0; i + 1 < edges.length; i++) {
    const ws = inside.filter((w) => { const cy = w.base - 0.3 * w.size; return cy >= edges[i] && cy < edges[i + 1]; });
    if (!ws.length) continue;
    const { rows: vrowsRaw, floating } = bandRows(ws);
    let vrows = vrowsRaw;
    const parts = partial.filter((p) => p.y > edges[i] && p.y < edges[i + 1]);
    const isHeader = bandsOf.length === 0 && edges.length > 2;
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
        vrows = [{ y0: Math.min(...ws.map((w) => w.y0)), y1: Math.max(...ws.map((w) => w.y1)), words: ws }];
      }
    }
    bandsOf.push(vrows.length);
    const firstRow = rowsIn.length;
    for (const r of vrows) rowsIn.push({ y0: r.y0, y1: r.y1, tokens: rowTokens(r).sort((a, b) => a.x0 - b.x0), band: i });
    // Multirow labels centred on the band ("(A)" beside four rows) span every row of the band.
    for (const fw of floating) {
      const tok = { x0: fw.x0, x1: fw.x1, words: [fw], text: fw.text, rowSpan: vrows.length };
      rowsIn[firstRow].tokens.push(tok);
      rowsIn[firstRow].tokens.sort((a, b) => a.x0 - b.x0);
    }
  }
  if (rowsIn.length < 2) return null;
  const headerRowsHint = edges.length > 2 ? bandsOf[0] : 0;
  const table = buildTable(rowsIn, { bands: band, headerRowsHint });
  if (!table) return null;
  table.usedWords = inside;
  return table;
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

// Free mode: runs of aligned multi-token rows inside one column.
export function detectStreamRuns(lines, { dots = [] } = {}) {
  const out = [];
  const rows = baselineRows(lines);
  let i = 0;
  while (i < rows.length) {
    const run = [];
    let j = i;
    while (j < rows.length) {
      const row = rows[j];
      const tokens = row.lines.flatMap((l) => tokenizeLine(l)).sort((a, b) => a.x0 - b.x0);
      const prev = run[run.length - 1];
      if (tokens.length < 2 || markerOf(row.lines[0], dots) || CAPTION_RE.test(row.text)) break;
      if (prev && row.base - prev.row.base > 2.2 * row.size) break;
      run.push({ row, tokens });
      j++;
    }
    if (run.length >= 3) {
      const rowsIn = run.map((r) => ({ y0: r.row.y0, y1: r.row.y1, tokens: r.tokens }));
      const table = buildTable(rowsIn, {});
      if (table && !looksLikeProse(run)) {
        table.usedWords = run.flatMap((r) => r.row.words);
        table.lines = run.flatMap((r) => r.row.lines);
        out.push(table);
        i = j;
        continue;
      }
    }
    i = i + 1;
  }
  return out;
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
