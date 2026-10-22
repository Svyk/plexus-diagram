import { SHAPES, shapePoint } from "./shapes.js";

const num = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

export function screenToWorld(vp, p) {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

export function worldToScreen(vp, p) {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

export function clampZoom(z, min = 0.1, max = 4) {
  return Math.min(max, Math.max(min, z));
}

export function zoomAt(vp, screenPoint, factor, { min = 0.1, max = 4 } = {}) {
  const zoom = clampZoom(vp.zoom * factor, min, max);
  const w = screenToWorld(vp, screenPoint);
  return { x: screenPoint.x - w.x * zoom, y: screenPoint.y - w.y * zoom, zoom };
}

// `insets` are screen strips the content must stay out of (toolbar on top, an open side panel on the right).
export function fitViewport(bounds, size, { padding = 64, maxZoom = 1.5, minZoom = 0.1, insets = null } = {}) {
  const inset = { top: 0, right: 0, bottom: 0, left: 0, ...(insets || {}) };
  const areaW = Math.max(1, size.width - inset.left - inset.right);
  const areaH = Math.max(1, size.height - inset.top - inset.bottom);
  const cx = inset.left + areaW / 2;
  const cy = inset.top + areaH / 2;
  if (!bounds) return { x: cx, y: cy, zoom: 1 };
  const availW = Math.max(1, areaW - 2 * padding);
  const availH = Math.max(1, areaH - 2 * padding);
  let zoom = Math.min(bounds.w > 0 ? availW / bounds.w : Infinity, bounds.h > 0 ? availH / bounds.h : Infinity);
  if (!Number.isFinite(zoom)) zoom = maxZoom;
  zoom = clampZoom(zoom, minZoom, maxZoom);
  const c = center(bounds);
  return { x: cx - c.x * zoom, y: cy - c.y * zoom, zoom };
}

// Pan so `rect` sits inside the viewport. Zoom stays put when the rect fits.
// Zoom out only when it is off-screen and larger than the padded viewport. Never zoom in.
export function panToShow(vp, size, rect, { pad = 24 } = {}) {
  const zoom0 = Number(vp?.zoom);
  const width = Number(size?.width);
  const height = Number(size?.height);
  const same = { x: Number(vp?.x) || 0, y: Number(vp?.y) || 0, zoom: zoom0 > 0 ? zoom0 : 1, moved: false };
  if (!vp || !(zoom0 > 0) || !(width > 0) || !(height > 0) || !rect || !(Number(rect.w) > 0) || !(Number(rect.h) > 0)) return same;
  const view = visibleWorldRect(vp, size, 0);
  const padW = pad / zoom0;
  const padH = pad / zoom0;
  const left = rect.x - padW;
  const top = rect.y - padH;
  const right = rect.x + rect.w + padW;
  const bottom = rect.y + rect.h + padH;
  const fits = rect.w + 2 * padW <= view.w + 0.5 && rect.h + 2 * padH <= view.h + 0.5;
  const onScreen = left >= view.x - 0.5 && top >= view.y - 0.5 && right <= view.x + view.w + 0.5 && bottom <= view.y + view.h + 0.5;
  if (onScreen) return { x: vp.x, y: vp.y, zoom: zoom0, moved: false };
  if (fits) {
    let dx = 0;
    let dy = 0;
    if (left < view.x) dx = left - view.x;
    else if (right > view.x + view.w) dx = right - (view.x + view.w);
    if (top < view.y) dy = top - view.y;
    else if (bottom > view.y + view.h) dy = bottom - (view.y + view.h);
    return { x: vp.x - dx * zoom0, y: vp.y - dy * zoom0, zoom: zoom0, moved: dx !== 0 || dy !== 0 };
  }
  const availW = Math.max(1, width - 2 * pad);
  const availH = Math.max(1, height - 2 * pad);
  const zoom = clampZoom(Math.min(zoom0, availW / rect.w, availH / rect.h));
  return {
    x: width / 2 - (rect.x + rect.w / 2) * zoom,
    y: height / 2 - (rect.y + rect.h / 2) * zoom,
    zoom,
    moved: true,
  };
}

export function visibleWorldRect(vp, size, margin = 0) {
  const mw = size.width * margin;
  const mh = size.height * margin;
  return {
    x: (-vp.x - mw) / vp.zoom,
    y: (-vp.y - mh) / vp.zoom,
    w: (size.width + 2 * mw) / vp.zoom,
    h: (size.height + 2 * mh) / vp.zoom,
  };
}

// Inverse of visibleWorldRect with margin 0. Zoom is the tighter axis, so the whole rect stays on screen.
// A view saved from the same window size has the same aspect, so the width alone gives the same zoom.
export function viewportFromWorldRect(rect, size) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0) || !size || !(size.width > 0)) return null;
  const zoom = clampZoom(size.height > 0 ? Math.min(size.width / rect.w, size.height / rect.h) : size.width / rect.w);
  return { x: -rect.x * zoom, y: -rect.y * zoom, zoom };
}

export function lodForZoom(zoom) {
  return zoom < 0.45 ? "map" : "detail";
}

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Three-tier level of detail with hysteresis so the tier does not flicker at a threshold.
export function lodTier(zoom, prev = "detail", { threshold = 0.45, overview = 0.2 } = {}) {
  if (prev === "overview") {
    if (zoom >= overview * 1.15) return zoom >= threshold * 1.1 ? "detail" : "map";
    return "overview";
  }
  if (prev === "map") {
    if (zoom < overview) return "overview";
    return zoom >= threshold * 1.1 ? "detail" : "map";
  }
  if (zoom < overview) return "overview";
  return zoom < threshold ? "map" : "detail";
}

// World-unit font sizes that keep on-screen text readable at low zoom.
export function lodFonts(zoom) {
  return {
    map: clampNum(13 / zoom, 14, 42),
    section: clampNum(16 / zoom, 15, 160),
    ui: clampNum(1 / zoom, 1, 4),
  };
}

// PO-5: world px per screen px, clamped. Grips, ports and end handles multiply their screen size by this.
// RE-3: world px per screen px with no clamp (invZoom stops at 4), for marks that must stay readable at 13% zoom.
export const screenPx = (zoom) => Math.round(clampNum(1 / (Number(zoom) > 0 ? Number(zoom) : 1), 0.05, 40) * 10000) / 10000;
export const invZoom = (zoom) => Math.round(clampNum(1 / (Number(zoom) > 0 ? Number(zoom) : 1), 0.25, 4) * 10000) / 10000;

const CONE = (68 * Math.PI) / 180;

// Arrow-key navigation: the closest rect beyond the source center along `dir`, preferring a 68-degree cone.
export function nearestInDirection(rects, fromUid, dir, { candidates = null } = {}) {
  const src = rects.get(fromUid);
  if (!src) return null;
  const c = { x: src.x + src.w / 2, y: src.y + src.h / 2 };
  const list = candidates ? [...candidates] : [...rects.keys()];
  let best = null;
  let bestScore = Infinity;
  let fallback = null;
  let fallbackScore = Infinity;
  for (const uid of list) {
    if (uid === fromUid) continue;
    const r = rects.get(uid);
    if (!r) continue;
    const dx = r.x + r.w / 2 - c.x;
    const dy = r.y + r.h / 2 - c.y;
    let primary;
    let ortho;
    if (dir === "right") { primary = dx; ortho = dy; }
    else if (dir === "left") { primary = -dx; ortho = dy; }
    else if (dir === "down") { primary = dy; ortho = dx; }
    else if (dir === "up") { primary = -dy; ortho = dx; }
    else return null;
    if (primary <= 0) continue;
    const score = primary + 2 * Math.abs(ortho);
    const better = (cur, curUid) => score < cur || (score === cur && (curUid === null || uid < curUid));
    if (Math.atan2(Math.abs(ortho), primary) <= CONE && better(bestScore, best)) { best = uid; bestScore = score; }
    if (better(fallbackScore, fallback)) { fallback = uid; fallbackScore = score; }
  }
  return best ?? fallback;
}

export function center(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function inflate(r, n) {
  return { x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n };
}

export function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectContains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function sidePoint(rect, side) {
  if (rect && SHAPES.includes(rect.shape)) return shapePoint(rect, rect.shape, side);
  switch (side) {
    case "top": return { x: rect.x + rect.w / 2, y: rect.y };
    case "bottom": return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case "left": return { x: rect.x, y: rect.y + rect.h / 2 };
    default: return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
  }
}

const SIDES = ["top", "right", "bottom", "left"];

export function nearestSide(rect, point) {
  let best = "top";
  let bestD = Infinity;
  for (const s of SIDES) {
    const p = sidePoint(rect, s);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function autoSides(a, b) {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}

// BA-3: where a block end sits on a page card. `rowTop` / `rowHeight` are relative to the card's top and already
// scroll-adjusted; `bodyTop` / `bodyBottom` are the visible body range in the same space; `other` is the far
// end's center. A row inside the range gets its vertical center on the card side facing `other`. A row outside
// it (or `rowTop == null`: not rendered) sticks to the card's top or bottom edge and reports `clamped`.
export function blockAnchor({ rect, rowTop, rowHeight = 0, bodyTop = 0, bodyBottom, other } = {}) {
  const right = !other || other.x >= rect.x + rect.w / 2;
  const side = right ? "right" : "left";
  const x = right ? rect.x + rect.w : rect.x;
  const bottom = bodyBottom ?? rect.h;
  if (rowTop == null) return { point: { x, y: rect.y + bodyTop }, side, clamped: "top" };
  const cy = rowTop + rowHeight / 2;
  if (cy < bodyTop) return { point: { x, y: rect.y }, side, clamped: "top" };
  if (cy > bottom) return { point: { x, y: rect.y + rect.h }, side, clamped: "bottom" };
  return { point: { x, y: rect.y + cy }, side, clamped: null };
}

// RF-2: where a block arrow's inner segment lives once the row is on screen. `point` is the card-edge anchor from
// blockAnchor, `side` the facing side, `rowLeft` / `rowRight` the row's horizontal extent relative to the card's
// left edge (world px). The segment starts a few px inside the card (the notch that reads as "entering") and runs
// to a tip in the gutter just outside the row's text on the facing side. `angle` points into the card.
export const INNER_NOTCH = 4;
export const INNER_MIN = 10;
// `cell` (a table cell end) lands the tip a few px inside the cell on the facing side, however far in it sits.
export const CELL_INSET = 3;
export function blockInner({ rect, side, point, rowLeft, rowRight, cell = false } = {}) {
  if (!rect || !point || rowLeft == null || !Number.isFinite(rowLeft)) return null;
  const right = side === "right";
  const reach = cell
    ? (right ? rect.w - (Number.isFinite(rowRight) ? rowRight : rect.w) + CELL_INSET : rowLeft + CELL_INSET)
    : right
      ? rect.w - (Number.isFinite(rowRight) ? rowRight : rect.w) + 2
      : rowLeft - 2;
  const depth = Math.min(Math.max(reach, INNER_MIN), cell ? Math.max(INNER_MIN, rect.w) : Math.max(INNER_MIN, rect.w / 2));
  const dir = right ? -1 : 1;
  return {
    from: { x: point.x + dir * INNER_NOTCH, y: point.y },
    tip: { x: point.x + dir * depth, y: point.y },
    angle: right ? Math.PI : 0,
  };
}

const NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

// A polyline from `start` to `end`: its path, its midpoint along its length and the angles of its first and last legs.
function polyGeo(pts, start, end, fromSide, toSide) {
  const poly = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
  const lens = [];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    const l = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    lens.push(l);
    total += l;
  }
  let mid = { ...start };
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    if (acc + lens[i] >= total / 2) {
      const t = lens[i] === 0 ? 0 : (total / 2 - acc) / lens[i];
      mid = {
        x: poly[i].x + (poly[i + 1].x - poly[i].x) * t,
        y: poly[i].y + (poly[i + 1].y - poly[i].y) * t,
      };
      break;
    }
    acc += lens[i];
  }
  const last = poly[poly.length - 1];
  const prev = poly[poly.length - 2] || start;
  const second = poly[1] || end;
  return {
    d: poly.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(""),
    start,
    end,
    mid,
    points: poly,
    startAngle: Math.atan2(second.y - start.y, second.x - start.x),
    endAngle: Math.atan2(last.y - prev.y, last.x - prev.x),
    fromSide,
    toSide,
  };
}

// `wrap` (PXD-3, rowEndPath only): elbow stubs that face the same way meet on the outer lane, not halfway between them.
// `reach` (PXD-3, rowEndPath only) scales a curve's control arms and an elbow's stubs: longer to swing wide round a
// card, shorter to fit the gap between two cards.
export function edgePath({ a, b, fromSide = "auto", toSide = "auto", route = "curve", offset = 0, via, fromPoint, toPoint, wrap = false, reach = 1 } = {}) {
  if (fromSide === "auto" || toSide === "auto") {
    const auto = autoSides(a, b);
    if (fromSide === "auto") fromSide = auto.fromSide;
    if (toSide === "auto") toSide = auto.toSide;
  }
  const start = fromPoint ?? sidePoint(a, fromSide);
  const end = toPoint ?? sidePoint(b, toSide);
  const bends = Array.isArray(via) ? via.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 8) : [];
  if (bends.length) {
    const pts = [start, ...bends, end];
    const mid = pts[Math.floor((pts.length - 1) / 2)];
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    return {
      d: pts.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`).join(""),
      start,
      end,
      mid,
      points: pts,
      startAngle: angle,
      endAngle: angle,
      fromSide,
      toSide,
    };
  }
  const nf = NORMALS[fromSide];
  const nt = NORMALS[toSide];
  const dist = Math.hypot(end.x - start.x, end.y - start.y);

  if (route === "straight") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    return {
      d: `M${num(start.x)} ${num(start.y)}L${num(end.x)} ${num(end.y)}`,
      start,
      end,
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      points: [start, end],
      startAngle: angle,
      endAngle: angle,
      fromSide,
      toSide,
    };
  }

  if (route === "elbow") {
    const STUB = 24 * reach;
    const s1 = { x: start.x + nf.x * STUB, y: start.y + nf.y * STUB };
    const e1 = { x: end.x + nt.x * STUB, y: end.y + nt.y * STUB };
    const fromH = nf.y === 0;
    const toH = nt.y === 0;
    const pts = [start, s1];
    if (fromH && toH) {
      const mx = wrap && nf.x === nt.x ? (nf.x > 0 ? Math.max(s1.x, e1.x) : Math.min(s1.x, e1.x)) : (s1.x + e1.x) / 2;
      pts.push({ x: mx, y: s1.y }, { x: mx, y: e1.y });
    } else if (!fromH && !toH) {
      const my = wrap && nf.y === nt.y ? (nf.y > 0 ? Math.max(s1.y, e1.y) : Math.min(s1.y, e1.y)) : (s1.y + e1.y) / 2;
      pts.push({ x: s1.x, y: my }, { x: e1.x, y: my });
    } else if (fromH) {
      pts.push({ x: e1.x, y: s1.y });
    } else {
      pts.push({ x: s1.x, y: e1.y });
    }
    pts.push(e1, end);
    return polyGeo(pts, start, end, fromSide, toSide);
  }

  const k = Math.max(40, 0.4 * dist) * reach;
  let px = 0;
  let py = 0;
  if (offset && dist > 0) {
    px = (-(end.y - start.y) / dist) * offset;
    py = ((end.x - start.x) / dist) * offset;
  }
  const c1 = { x: start.x + nf.x * k + px, y: start.y + nf.y * k + py };
  const c2 = { x: end.x + nt.x * k + px, y: end.y + nt.y * k + py };
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
  return {
    d: `M${num(start.x)} ${num(start.y)}C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(end.x)} ${num(end.y)}`,
    start,
    end,
    mid,
    points: [start, c1, c2, end],
    startAngle: Math.atan2(c1.y - start.y, c1.x - start.x),
    endAngle: Math.atan2(end.y - c2.y, end.x - c2.x),
    fromSide,
    toSide,
  };
}

// PXD-3: how long a path runs inside `box`, inset half a px so a path along its border or ending on it does not count.
// A curve is flattened into CROSS_STEPS chords and each chord is clipped against the box (Liang-Barsky), so a clip
// of a corner between two samples still counts.
const CROSS_STEPS = 128;
const CROSS_INSET = 0.5;
function chordInside(p, q, x0, y0, x1, y1) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [d, room] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
    if (d === 0) { if (room <= 0) return 0; continue; }
    const r = room / d;
    if (d < 0) { if (r > t1) return 0; if (r > t0) t0 = r; }
    else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dy) : 0;
}
function pathLine(geo) {
  const pts = geo.points || [];
  if (pts.length !== 4 || !geo.d.includes("C")) return pts;
  const [p0, p1, p2, p3] = pts;
  const line = [p0];
  for (let i = 1; i <= CROSS_STEPS; i++) {
    const t = i / CROSS_STEPS;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    line.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  return line;
}
function lineInside(line, box, inset) {
  if (!box) return 0;
  const x0 = box.x + inset;
  const y0 = box.y + inset;
  const x1 = box.x + box.w - inset;
  const y1 = box.y + box.h - inset;
  if (x1 <= x0 || y1 <= y0) return 0;
  let n = 0;
  for (let i = 1; i < line.length; i++) n += chordInside(line[i - 1], line[i], x0, y0, x1, y1);
  return n;
}
// A polyline without its first `head` and last `tail` px.
function trimLine(line, head, tail) {
  const cut = (pts, len) => {
    if (!len) return pts;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (l >= len) {
        const t = l ? len / l : 0;
        return [{ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }, ...pts.slice(i)];
      }
      len -= l;
    }
    return [];
  };
  return cut(cut(line, head).reverse(), tail).reverse();
}
// How long a path runs along `box`'s border (within HUG px outside or CROSS_INSET inside), half hidden by the card
// and lost in its outline. The first and last HUG_SKIP px of an end on the border do not count (an end leaves it
// straight out), nor does a run under HUG_MIN px (a path passing a corner).
const HUG = 2;
const HUG_SKIP = 4;
const HUG_MIN = 8;
function lineHug(line, box) {
  if (!box || line.length < 2) return 0;
  const on = (p) => p.x >= box.x - CROSS_INSET && p.x <= box.x + box.w + CROSS_INSET && p.y >= box.y - CROSS_INSET && p.y <= box.y + box.h + CROSS_INSET
    && Math.min(Math.abs(p.x - box.x), Math.abs(p.x - box.x - box.w), Math.abs(p.y - box.y), Math.abs(p.y - box.y - box.h)) <= CROSS_INSET;
  const rest = trimLine(line, on(line[0]) ? HUG_SKIP : 0, on(line[line.length - 1]) ? HUG_SKIP : 0);
  const run = lineInside(rest, box, -HUG) - lineInside(rest, box, CROSS_INSET);
  return run >= HUG_MIN ? run : 0;
}

// PXD-3: an arrow with an end on a row (or cell) of a card. A row end sits on its card's side edge at the row's y,
// on the side facing the other card, and leaves outward; the rest of the path can still run back through that card
// (a card below leaving from its top port ran behind the card and curled round into the row). The path as stored
// stays unless it crosses a row's card or runs along its border. Then the first tier whose path does neither for
// every row's card wins; inside a tier the path that crosses its own card least, then stock curve arms and elbow
// stubs before longer ones and longer before shorter, then the earliest candidate (a bent straight line: the
// shortest):
//   one row end: the other end's sides (its stored side, then the row's side, so the arrow wraps round the outside
//     of the card), with longer or shorter curve arms and elbow stubs; then for a straight line, a short stub beside
//     the row, reached past a corner of the row's card if need be; then the row end on its card's far side; then,
//     for a curve or an elbow too close to fit, a plain straight line;
//   both ends on rows: longer or shorter arms and stubs; then one row end on its card's far side, then both; then
//     for a straight line, stubs beside the rows and bends past the cards' corners, or for a curve or an elbow too
//     close to fit, a plain straight line.
// Elbow stubs that face the same way meet on the outer lane. If nothing clears, the path that crosses least, then
// runs along a border least.
// `rowEnd` is "from", "to" or "both"; args as edgePath's, with each row end's point and side in them.
const REACH = [1, 1.5, 2, 3, 4, 0.5, 0.25];
const ELBOW_REACH = [1, 0.5, 0.25];
const CORNER_GAP = 16;
const flipSide = (box, point, side) => ({
  side: side === "right" ? "left" : "right",
  point: { x: side === "right" ? box.x : box.x + box.w, y: point.y },
});
// A row end's way out for a bent straight line, from the row outward: a stub beside the row, then optionally the
// corner of its card on that side.
function rowLeg(box, point, side, corner) {
  const x = side === "right" ? box.x + box.w + CORNER_GAP : box.x - CORNER_GAP;
  const leg = [{ x, y: point.y }];
  if (corner === "top") leg.push({ x, y: box.y - CORNER_GAP });
  if (corner === "bottom") leg.push({ x, y: box.y + box.h + CORNER_GAP });
  return leg;
}
export function rowEndPath(args, rowEnd) {
  const geo = edgePath(args);
  if (rowEnd !== "from" && rowEnd !== "to" && rowEnd !== "both") return geo;
  if (Array.isArray(args.via) && args.via.length) return geo;
  const { a, b } = args;
  if (!a || !b || rectsIntersect(a, b)) return geo;
  const both = rowEnd === "both";
  if (both ? !args.fromPoint || !args.toPoint : rowEnd === "to" ? !args.toPoint || args.fromPoint : !args.fromPoint || args.toPoint) return geo;
  const rowBoxes = both ? [a, b] : [rowEnd === "to" ? b : a];
  const ownBox = both ? null : rowEnd === "to" ? a : b;
  // rank: a curve's or an elbow's place in its reach list (stock arms first), a bent straight line's length.
  const rate = (g, tier, rank, n) => {
    const line = pathLine(g);
    let across = 0;
    let hug = 0;
    for (const box of rowBoxes) {
      across += lineInside(line, box, CROSS_INSET);
      hug += lineHug(line, box);
    }
    return { geo: g, across, hug, own: lineInside(line, ownBox, CROSS_INSET), tier, rank, n };
  };
  let best = rate(geo, -1, 0, -1);
  if (!best.across && !best.hug) return geo;
  const route = args.route;
  const reaches = route === "straight" ? [1] : route === "elbow" ? ELBOW_REACH : REACH;
  let n = 0;
  const consider = (g, tier, rank) => {
    const c = rate(g, tier, rank, n++);
    const key = (x) => [x.across, x.hug, x.tier, x.own, x.rank, x.n];
    const kc = key(c);
    const kb = key(best);
    for (let i = 0; i < kc.length; i++) {
      if (kc[i] !== kb[i]) {
        if (kc[i] < kb[i]) best = c;
        return;
      }
    }
  };
  const curves = (tier, over) => {
    for (let r = 0; r < reaches.length; r++) consider(edgePath({ ...args, ...over, wrap: true, reach: reaches[r] }), tier, r);
  };
  // Each row end as stored and on its card's far side.
  const ends = (key, box) => {
    const point = args[key === "from" ? "fromPoint" : "toPoint"];
    const side = args[key === "from" ? "fromSide" : "toSide"];
    return [{ point, side, flip: 0 }, { ...flipSide(box, point, side), flip: 1 }];
  };
  const bent = (tier, from, to) => {
    // from / to: { point, side, box, corner } for a row end, { side, box } for the other end.
    const start = from.point ?? sidePoint(from.box, from.side);
    const end = to.point ?? sidePoint(to.box, to.side);
    const out = from.point ? rowLeg(from.box, from.point, from.side, from.corner) : [];
    const back = to.point ? rowLeg(to.box, to.point, to.side, to.corner).reverse() : [];
    const pts = [start, ...out, ...back, end];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    consider(polyGeo(pts, start, end, from.side, to.side), tier, len);
  };
  const CORNERS = ["top", "bottom"];
  const tiers = [];
  if (both) {
    const fromEnds = ends("from", a);
    const toEnds = ends("to", b);
    for (const flips of [0, 1, 2]) {
      tiers.push((tier) => {
        for (const f of fromEnds) for (const t of toEnds) {
          if (f.flip + t.flip !== flips) continue;
          curves(tier, { fromPoint: f.point, fromSide: f.side, toPoint: t.point, toSide: t.side });
        }
      });
    }
    if (route === "straight") {
      tiers.push((tier) => {
        for (const f of fromEnds) for (const t of toEnds) {
          for (const fc of [null, ...CORNERS]) for (const tc of [null, ...CORNERS]) {
            bent(tier, { ...f, box: a, corner: fc }, { ...t, box: b, corner: tc });
          }
        }
      });
    } else {
      tiers.push((tier) => {
        for (const f of fromEnds) for (const t of toEnds) {
          consider(edgePath({ ...args, route: "straight", fromPoint: f.point, fromSide: f.side, toPoint: t.point, toSide: t.side }), tier, 0);
        }
      });
    }
  } else {
    const freeKey = rowEnd === "to" ? "fromSide" : "toSide";
    const rowKey = rowEnd === "to" ? "to" : "from";
    const rowBox = rowBoxes[0];
    const rowEnds = ends(rowKey, rowBox);
    const freeSides = [...new Set([geo[freeKey], geo[rowKey === "to" ? "toSide" : "fromSide"], ...SIDES])];
    const rowOver = (r) => (rowKey === "to" ? { toPoint: r.point, toSide: r.side } : { fromPoint: r.point, fromSide: r.side });
    const bentAll = (tier, r) => {
      for (const side of SIDES) for (const corner of [null, ...CORNERS]) {
        const row = { ...r, box: rowBox, corner };
        const free = { side, box: ownBox };
        if (rowKey === "to") bent(tier, free, row);
        else bent(tier, row, free);
      }
    };
    tiers.push((tier) => { for (const side of freeSides) curves(tier, { [freeKey]: side, ...rowOver(rowEnds[0]) }); });
    if (route === "straight") tiers.push((tier) => bentAll(tier, rowEnds[0]));
    tiers.push((tier) => {
      for (const side of freeSides) curves(tier, { [freeKey]: side, ...rowOver(rowEnds[1]) });
      if (route === "straight") bentAll(tier, rowEnds[1]);
    });
    if (route !== "straight") {
      tiers.push((tier) => {
        for (const r of rowEnds) for (const side of freeSides) consider(edgePath({ ...args, route: "straight", [freeKey]: side, ...rowOver(r) }), tier, 0);
      });
    }
  }
  for (let t = 0; t < tiers.length; t++) {
    tiers[t](t);
    if (!best.across && !best.hug) break;
  }
  return best.geo;
}

export function arrowHeadPath(point, angle, size) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const bx = point.x - dx * size;
  const by = point.y - dy * size;
  const hw = size * 0.45;
  const p1 = { x: bx - dy * hw, y: by + dx * hw };
  const p2 = { x: bx + dy * hw, y: by - dx * hw };
  return `M${num(point.x)} ${num(point.y)}L${num(p1.x)} ${num(p1.y)}L${num(p2.x)} ${num(p2.y)}Z`;
}

export function arrowSize(zoom, weight = 1) {
  return Math.max(8 + 2 * weight, 6 / zoom);
}

function bestSnap(values, targets, threshold) {
  let best = null;
  for (const v of values) {
    for (const t of targets) {
      const diff = t - v;
      if (Math.abs(diff) <= threshold && (best === null || Math.abs(diff) < Math.abs(best))) best = diff;
    }
  }
  return best ?? 0;
}

const xs = (r) => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = (r) => [r.y, r.y + r.h / 2, r.y + r.h];
const EPS = 1e-6;

export const GRID_PITCH = 24;

// Snap the top-left corner onto the world grid when it is already within threshold.
// An axis farther than that stays where the drag put it.
export function snapToGrid(rect, pitch = GRID_PITCH, threshold = pitch) {
  const axis = (value) => {
    if (!pitch) return 0;
    const diff = Math.round(value / pitch) * pitch - value;
    return Math.abs(diff) <= threshold ? diff : 0;
  };
  return { dx: axis(rect.x), dy: axis(rect.y) };
}

export function snapMove(moving, others, threshold) {
  const dx = bestSnap(xs(moving), others.flatMap(xs), threshold);
  const dy = bestSnap(ys(moving), others.flatMap(ys), threshold);
  const m = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h };
  const guides = [];
  for (const o of others) {
    for (const mx of xs(m)) {
      if (xs(o).some((ox) => Math.abs(ox - mx) < EPS)) {
        guides.push({ x1: mx, y1: Math.min(m.y, o.y), x2: mx, y2: Math.max(m.y + m.h, o.y + o.h) });
      }
    }
    for (const my of ys(m)) {
      if (ys(o).some((oy) => Math.abs(oy - my) < EPS)) {
        guides.push({ x1: Math.min(m.x, o.x), y1: my, x2: Math.max(m.x + m.w, o.x + o.w), y2: my });
      }
    }
  }
  return { dx, dy, guides };
}

export function alignRects(list, mode) {
  if (!list.length) return [];
  const minX = Math.min(...list.map((r) => r.x));
  const maxX = Math.max(...list.map((r) => r.x + r.w));
  const minY = Math.min(...list.map((r) => r.y));
  const maxY = Math.max(...list.map((r) => r.y + r.h));
  return list.map((r) => {
    let x = r.x;
    let y = r.y;
    if (mode === "left") x = minX;
    else if (mode === "right") x = maxX - r.w;
    else if (mode === "center") x = (minX + maxX) / 2 - r.w / 2;
    else if (mode === "top") y = minY;
    else if (mode === "bottom") y = maxY - r.h;
    else if (mode === "middle") y = (minY + maxY) / 2 - r.h / 2;
    return { uid: r.uid, x, y };
  });
}

export function distributeRects(list, axis) {
  const h = axis === "h";
  const pos = h ? "x" : "y";
  const dim = h ? "w" : "h";
  const sorted = [...list].sort((p, q) => p[pos] - q[pos]);
  if (sorted.length < 3) return sorted.map((r) => ({ uid: r.uid, x: r.x, y: r.y }));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last[pos] + last[dim] - first[pos];
  const total = sorted.reduce((s, r) => s + r[dim], 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = first[pos];
  return sorted.map((r, i) => {
    const p = i === sorted.length - 1 ? last[pos] : cursor;
    cursor += r[dim] + gap;
    return h ? { uid: r.uid, x: p, y: r.y } : { uid: r.uid, x: r.x, y: p };
  });
}

const MIN_GRID_PITCH = 8;

export function gridBackground(vp, style, base = GRID_PITCH) {
  if (style === "plain") return null;
  // Zoomed far out the pitch collapses into a grey moire; coarsen it by 5x steps (a lattice of the same world grid).
  let size = base * vp.zoom;
  while (size > 0 && size < MIN_GRID_PITCH) size *= 5;
  const mod = (v) => ((v % size) + size) % size;
  return { size, x: mod(vp.x), y: mod(vp.y), major: size * 5 };
}
