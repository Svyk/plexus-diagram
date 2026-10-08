// Parse step: page columns and reading order. Pure.
// Columns come from dominant left edges of text lines; wide units (titles, tables, figures)
// cut the page horizontally, and each slice is read column by column, top to bottom.

export function detectColumns(lines, { pageW, minLines = 4 } = {}) {
  const clusters = [];
  for (const l of lines) {
    if (l.chars < 8) continue;
    let c = clusters.find((k) => Math.abs(k.x - l.x0) <= 3);
    if (!c) { c = { x: l.x0, lines: [] }; clusters.push(c); }
    c.lines.push(l);
  }
  const wideEnough = (c) => c.lines.filter((l) => l.x1 - l.x0 >= 0.25 * (pageW || 612)).length >= 3;
  const dominant = clusters.filter((c) => c.lines.length >= minLines && wideEnough(c)).sort((a, b) => a.x - b.x);
  const gutters = [];
  for (let i = 1; i < dominant.length; i++) {
    const right = dominant[i];
    const leftX = dominant[i - 1].x;
    if (right.x - leftX < 0.2 * (pageW || 612)) continue;
    // Only left lines beside the right column bound the gutter: a front-matter line far above or
    // below it (a title tail, a copyright line) may run almost to the right column's edge.
    const beside = (l) => right.lines.some((r) => Math.abs(r.base - l.base) <= 2.5 * Math.max(l.size, r.size));
    const leftLines = lines.filter((l) => l.x0 >= leftX - 3 && l.x0 < right.x - 10 && l.x1 <= right.x + 1);
    const besideEnds = leftLines.filter(beside).map((l) => l.x1);
    const leftEnds = besideEnds.length >= 3 ? besideEnds : leftLines.map((l) => l.x1);
    if (leftEnds.length < 3) continue;
    const g0 = Math.max(...leftEnds);
    const g1 = right.x;
    if (g1 - g0 >= 6) gutters.push({ x0: g0, x1: g1 });
  }
  return gutters;
}

// Lines whose words straddle a gutter at a word gap are two lines (one per column).
export function splitAtGutters(lines, gutters, makeLine) {
  if (!gutters.length) return lines;
  const out = [];
  for (const line of lines) {
    let parts = [line];
    for (const g of gutters) {
      const next = [];
      for (const part of parts) {
        if (!crossesGutter(part, g) || part.words.length < 2) { next.push(part); continue; }
        const left = part.words.filter((w) => (w.x0 + w.x1) / 2 < (g.x0 + g.x1) / 2);
        const right = part.words.filter((w) => (w.x0 + w.x1) / 2 >= (g.x0 + g.x1) / 2);
        const leftEnd = left.length ? Math.max(...left.map((w) => w.x1)) : -Infinity;
        const rightStart = right.length ? Math.min(...right.map((w) => w.x0)) : Infinity;
        if (left.length && right.length && rightStart - leftEnd >= 0.6 * (g.x1 - g.x0)) next.push(makeLine(left), makeLine(right));
        else next.push(part);
      }
      parts = next;
    }
    out.push(...parts);
  }
  return out;
}

export function crossesGutter(unit, g) {
  return unit.x0 < g.x0 - 1 && unit.x1 > g.x1 + 1;
}

// Horizontal rules that run across a gutter on both sides at one height (one long rule, or one
// rule per column): the bands above and below are read separately, like a wide unit.
export function ruleCuts(rules, gutters, units) {
  if (!gutters.length || !units.length) return [];
  const minX = Math.min(...units.map((u) => u.x0));
  const maxX = Math.max(...units.map((u) => u.x1));
  // A figure's or table's own frame is not a band separator.
  const framed = (r) => units.some((u) => r.x0 >= u.x0 - 2 && r.x1 <= u.x1 + 2 && r.y0 > u.y0 + 1 && r.y0 < u.y1 - 1);
  const hs = (rules || []).filter((r) => r.axis === "h" && !framed(r)).sort((a, b) => a.y0 - b.y0);
  const rows = [];
  for (const r of hs) {
    const row = rows.find((w) => Math.abs(w.y - r.y0) <= 2);
    if (row) row.rules.push(r); else rows.push({ y: r.y0, rules: [r] });
  }
  const cuts = [];
  for (const row of rows) {
    const spans = gutters.some((g) => {
      const left = row.rules.some((r) => r.x0 < g.x0 - 1 && Math.min(r.x1, g.x0) - Math.max(r.x0, minX) >= 0.5 * (g.x0 - minX));
      const right = row.rules.some((r) => r.x1 > g.x1 + 1 && Math.min(r.x1, maxX) - Math.max(r.x0, g.x1) >= 0.5 * (maxX - g.x1));
      return left && right;
    });
    if (spans) cuts.push(row.y);
  }
  return cuts;
}

// units: [{ x0, y0, x1, y1, ... }]. Returns { order: units[], columns }.
// `cuts`: heights where a full-width rule separates bands. A cut under a row of column headings
// (one short unit per column, at most `2 * lineHeight` tall) does not separate them from their text.
export function orderUnits(units, { gutters = [], cuts = [], lineHeight = 0 } = {}) {
  const active = gutters.filter((g) => units.some((u) => u.x1 <= g.x0 + 1) && units.some((u) => u.x0 >= g.x1 - 1));
  if (!active.length) return { order: byPosition(units), columns: 1 };
  const sorted = [...units].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const wide = (u) => active.some((g) => crossesGutter(u, g));
  const out = [];
  let slice = [];
  const flush = () => {
    if (!slice.length) return;
    const cols = splitColumns(slice, active);
    for (const col of cols) out.push(...byPosition(col));
    slice = [];
  };
  const headingRow = () => lineHeight > 0 && splitColumns(slice, active).every((c) => c.length === 1 && c[0].y1 - c[0].y0 <= 2 * lineHeight);
  const pending = [...cuts].sort((a, b) => a - b);
  for (const u of sorted) {
    while (pending.length && pending[0] <= u.y0 + 1) {
      pending.shift();
      if (!headingRow()) flush();
    }
    if (wide(u)) {
      // Narrow units that started above this wide unit's top but overlap it belong before it.
      flush();
      out.push(u);
    } else slice.push(u);
  }
  flush();
  return { order: out, columns: active.length + 1 };
}

function splitColumns(units, gutters) {
  const cols = gutters.map(() => []);
  cols.push([]);
  for (const u of units) {
    const mid = (u.x0 + u.x1) / 2;
    let idx = gutters.findIndex((g) => mid < (g.x0 + g.x1) / 2);
    if (idx < 0) idx = gutters.length;
    cols[idx].push(u);
  }
  return cols.filter((c) => c.length);
}

function byPosition(units) {
  return [...units].sort((a, b) => {
    const dy = a.y0 - b.y0;
    if (Math.abs(dy) <= 2) return a.x0 - b.x0;
    return dy;
  });
}

// Column box for a set of units.
export function boxOfUnits(units) {
  return {
    x0: Math.min(...units.map((u) => u.x0)),
    y0: Math.min(...units.map((u) => u.y0)),
    x1: Math.max(...units.map((u) => u.x1)),
    y1: Math.max(...units.map((u) => u.y1)),
  };
}
