// Board geometry for the builder. Pure. Plexus stores x/y relative to the parent section (or the board);
// blueprints may give absolute board coordinates or section-relative ones, detected per board.

export const SIZES = {
  text: { w: 240, h: 48 }, note: { w: 280, h: 160 }, quote: { w: 280, h: 160 }, claim: { w: 280, h: 160 }, question: { w: 280, h: 160 },
  pageref: { w: 280, h: 160 }, blockref: { w: 280, h: 160 }, pdf: { w: 240, h: 320 }, image: { w: 320, h: 240 },
  board: { w: 320, h: 220 }, query: { w: 360, h: 280 }, "ai-answer": { w: 360, h: 260 }, todo: { w: 280, h: 80 },
  embed: { w: 320, h: 220 }, formula: { w: 280, h: 120 }, code: { w: 420, h: 260 }, web: { w: 280, h: 120 },
};

// Card size for a table of `rows` x `cols` (caption form, native Roam table).
export function tableSize(rows) {
  const r = Array.isArray(rows) ? rows.length : 0;
  const c = Math.max(1, ...(Array.isArray(rows) ? rows.map((row) => (Array.isArray(row) ? row.length : 1)) : [1]));
  return { w: Math.min(1200, 16 + c * 150), h: Math.min(900, 48 + Math.max(1, r) * 32) };
}

export function sizeOf(card) {
  if (card.type === "table") return tableSize(card.table?.rows);
  if (card.type === "chart") return tableSize(card.table?.rows || chartRows(card.chart));
  return SIZES[card.type] || SIZES.note;
}

// Chart series -> table rows: header [x, series...], one row per x value in first-seen order.
export function chartRows(chart) {
  const series = Array.isArray(chart?.series) ? chart.series : [];
  const xs = [];
  const seen = new Set();
  for (const s of series) for (const p of s.points || s.data || []) {
    const x = Array.isArray(p) ? p[0] : p?.x;
    const key = String(x);
    if (!seen.has(key)) { seen.add(key); xs.push(x); }
  }
  const header = [chart?.x?.label || "x", ...series.map((s, i) => s.name || `series ${i + 1}`)];
  const rows = xs.map((x) => [String(x), ...series.map((s) => {
    const hit = (s.points || s.data || []).find((p) => String(Array.isArray(p) ? p[0] : p?.x) === String(x));
    const y = hit === undefined ? "" : (Array.isArray(hit) ? hit[1] : hit.y);
    return y === undefined ? "" : String(y);
  })]);
  return [header, ...rows];
}

const inside = (pt, r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;

// Absolute rect of every section (sections nest by `parent`; their x/y follow the board's coordinate mode).
export function sectionRects(board, mode) {
  const byId = new Map((board.sections || []).map((s) => [s.id, s]));
  const memo = new Map();
  const abs = (s) => {
    if (memo.has(s.id)) return memo.get(s.id);
    let r = { x: s.x, y: s.y, w: s.w, h: s.h };
    if (mode === "relative" && s.parent && byId.has(s.parent)) {
      const p = abs(byId.get(s.parent));
      r = { ...r, x: p.x + s.x, y: p.y + s.y };
    }
    memo.set(s.id, r);
    return r;
  };
  for (const s of byId.values()) abs(s);
  return memo;
}

// "absolute" when most sectioned cards (and nested sections) sit inside their section's absolute rect, else "relative".
export function detectMode(board, cards) {
  if (board.coords === "absolute" || board.coords === "relative") return board.coords;
  const rects = sectionRects(board, "absolute");
  let abs = 0;
  let rel = 0;
  const vote = (x, y, w, h, sec) => {
    if (!sec || typeof x !== "number" || typeof y !== "number") return;
    const c = { x: x + (w || 0) / 2, y: y + (h || 0) / 2 };
    if (inside(c, sec)) abs += 1;
    else if (c.x >= 0 && c.y >= 0 && c.x <= sec.w && c.y <= sec.h) rel += 1;
  };
  for (const c of cards) {
    const size = sizeOf(c);
    vote(c.x, c.y, c.w ?? size.w, c.h ?? size.h, c.section ? rects.get(c.section) : null);
  }
  for (const s of board.sections || []) if (s.parent) vote(s.x, s.y, s.w, s.h, rects.get(s.parent));
  return rel > abs ? "relative" : "absolute";
}

// Places one board: { mode, sections: Map(id -> {x,y,w,h} relative to parent), cards: Map(id -> {x,y,w,h} relative
// to its section or the board) }. Cards without x/y are packed in a grid inside their section (or below the board).
export function placeBoard(board, cards) {
  const mode = detectMode(board, cards);
  const absSec = sectionRects(board, mode);
  const sections = new Map();
  for (const s of board.sections || []) {
    // rx/ry: the blueprint already gives the parent-relative position.
    if (typeof s.rx === "number" && typeof s.ry === "number") { sections.set(s.id, { x: s.rx, y: s.ry, w: s.w, h: s.h }); continue; }
    const r = absSec.get(s.id);
    const p = s.parent ? absSec.get(s.parent) : null;
    sections.set(s.id, { x: p ? r.x - p.x : r.x, y: p ? r.y - p.y : r.y, w: r.w, h: r.h });
  }
  const out = new Map();
  const cursor = new Map();
  let free = 0;
  const bottom = Math.max(0, ...[...absSec.values()].map((r) => r.y + r.h));
  for (const c of cards) {
    const size = sizeOf(c);
    const w = typeof c.w === "number" ? c.w : size.w;
    const h = typeof c.h === "number" ? c.h : size.h;
    const sec = c.section ? absSec.get(c.section) : null;
    if (typeof c.rx === "number" && typeof c.ry === "number") { out.set(c.id, { x: c.rx, y: c.ry, w, h }); continue; }
    if (typeof c.x === "number" && typeof c.y === "number") {
      const x = mode === "absolute" && sec ? c.x - sec.x : c.x;
      const y = mode === "absolute" && sec ? c.y - sec.y : c.y;
      out.set(c.id, { x, y, w, h });
      continue;
    }
    if (sec) {
      const n = cursor.get(c.section) || 0;
      cursor.set(c.section, n + 1);
      const cols = Math.max(1, Math.floor((sec.w - 24) / 300));
      out.set(c.id, { x: 24 + (n % cols) * 300, y: 56 + Math.floor(n / cols) * 340, w, h });
    } else {
      out.set(c.id, { x: (free % 10) * 320, y: bottom + 80 + Math.floor(free / 10) * 360, w, h });
      free += 1;
    }
  }
  return { mode, sections, cards: out };
}

// Pairs of overlapping cards that share a parent (for the report). Sweep on x; O(n log n + k).
export function overlaps(items, limit = 50) {
  const list = items.filter((i) => i && i.w > 0 && i.h > 0).sort((a, b) => a.x - b.x);
  const hits = [];
  for (let i = 0; i < list.length && hits.length < limit; i += 1) {
    const a = list[i];
    for (let j = i + 1; j < list.length && list[j].x < a.x + a.w; j += 1) {
      const b = list[j];
      if (a.parent === b.parent && b.y < a.y + a.h && a.y < b.y + b.h) hits.push([a.id, b.id]);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
