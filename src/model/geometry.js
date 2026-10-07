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
export function blockInner({ rect, side, point, rowLeft, rowRight } = {}) {
  if (!rect || !point || rowLeft == null || !Number.isFinite(rowLeft)) return null;
  const right = side === "right";
  const reach = right
    ? rect.w - (Number.isFinite(rowRight) ? rowRight : rect.w) + 2
    : rowLeft - 2;
  const depth = Math.min(Math.max(reach, INNER_MIN), Math.max(INNER_MIN, rect.w / 2));
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

export function edgePath({ a, b, fromSide = "auto", toSide = "auto", route = "curve", offset = 0, via, fromPoint, toPoint } = {}) {
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
    const STUB = 24;
    const s1 = { x: start.x + nf.x * STUB, y: start.y + nf.y * STUB };
    const e1 = { x: end.x + nt.x * STUB, y: end.y + nt.y * STUB };
    const fromH = nf.y === 0;
    const toH = nt.y === 0;
    const pts = [start, s1];
    if (fromH && toH) {
      const mx = (s1.x + e1.x) / 2;
      pts.push({ x: mx, y: s1.y }, { x: mx, y: e1.y });
    } else if (!fromH && !toH) {
      const my = (s1.y + e1.y) / 2;
      pts.push({ x: s1.x, y: my }, { x: e1.x, y: my });
    } else if (fromH) {
      pts.push({ x: e1.x, y: s1.y });
    } else {
      pts.push({ x: s1.x, y: e1.y });
    }
    pts.push(e1, end);
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

  const k = Math.max(40, 0.4 * dist);
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
