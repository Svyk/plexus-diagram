/* Plexus Diagram v2.0.0 | MIT | generated; edit src/ */

// src/model/shapes.js
var SHAPES = ["rectangle", "rounded", "ellipse", "diamond", "parallelogram", "cylinder"];
var n = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
var box = (rect) => {
  const x = rect?.x || 0;
  const y = rect?.y || 0;
  const w = rect?.w || 0;
  const h = rect?.h || 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h };
};
var skewOf = (w) => Math.min(Math.max(0, w) * 0.18, 28);
var cylinderRy = (h) => Math.min(h * 0.22, 18, Math.max(1, h / 2 - 0.5));
function shapePoint(rect, shape, side) {
  const b = box(rect);
  if (shape === "parallelogram") {
    const skew = skewOf(b.w);
    if (side === "top") return { x: b.cx + skew / 2, y: b.y };
    if (side === "bottom") return { x: b.cx - skew / 2, y: b.bottom };
    if (side === "left") return { x: b.x + skew / 2, y: b.cy };
    return { x: b.right - skew / 2, y: b.cy };
  }
  if (side === "top") return { x: b.cx, y: b.y };
  if (side === "bottom") return { x: b.cx, y: b.bottom };
  if (side === "left") return { x: b.x, y: b.cy };
  return { x: b.right, y: b.cy };
}
function shapePath(rect, shape) {
  const b = box(rect);
  const { x, y, w, h, cx, cy, right, bottom } = b;
  if (shape === "ellipse") {
    const rx = w / 2;
    const ry = h / 2;
    return `M${n(cx)} ${n(y)}A${n(rx)} ${n(ry)} 0 0 1 ${n(cx)} ${n(bottom)}A${n(rx)} ${n(ry)} 0 0 1 ${n(cx)} ${n(y)}Z`;
  }
  if (shape === "diamond") {
    return `M${n(cx)} ${n(y)}L${n(right)} ${n(cy)}L${n(cx)} ${n(bottom)}L${n(x)} ${n(cy)}Z`;
  }
  if (shape === "parallelogram") {
    const s = skewOf(w);
    return `M${n(x + s)} ${n(y)}L${n(right)} ${n(y)}L${n(right - s)} ${n(bottom)}L${n(x)} ${n(bottom)}Z`;
  }
  if (shape === "cylinder") {
    const rx = w / 2;
    const ry = cylinderRy(h);
    const top = y + ry;
    const bot = bottom - ry;
    return `M${n(x)} ${n(top)}A${n(rx)} ${n(ry)} 0 0 0 ${n(right)} ${n(top)}L${n(right)} ${n(bot)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(bot)}ZM${n(x)} ${n(top)}A${n(rx)} ${n(ry)} 0 0 1 ${n(right)} ${n(top)}`;
  }
  if (shape === "rounded") {
    const rx = Math.min(16, w / 4, h / 4);
    return `M${n(x + rx)} ${n(y)}H${n(right - rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(right)} ${n(y + rx)}V${n(bottom - rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(right - rx)} ${n(bottom)}H${n(x + rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(x)} ${n(bottom - rx)}V${n(y + rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(x + rx)} ${n(y)}Z`;
  }
  return `M${n(x)} ${n(y)}H${n(right)}V${n(bottom)}H${n(x)}Z`;
}

// src/model/geometry.js
var num = (n2) => {
  const r = Math.round(n2 * 1e3) / 1e3;
  return Object.is(r, -0) ? 0 : r;
};
function screenToWorld(vp, p) {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}
function worldToScreen(vp, p) {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}
function clampZoom(z, min = 0.1, max = 4) {
  return Math.min(max, Math.max(min, z));
}
function zoomAt(vp, screenPoint, factor, { min = 0.1, max = 4 } = {}) {
  const zoom = clampZoom(vp.zoom * factor, min, max);
  const w = screenToWorld(vp, screenPoint);
  return { x: screenPoint.x - w.x * zoom, y: screenPoint.y - w.y * zoom, zoom };
}
function fitViewport(bounds, size, { padding = 64, maxZoom = 1.5, minZoom = 0.1, insets = null } = {}) {
  const inset = { top: 0, right: 0, bottom: 0, left: 0, ...insets || {} };
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
function visibleWorldRect(vp, size, margin = 0) {
  const mw = size.width * margin;
  const mh = size.height * margin;
  return {
    x: (-vp.x - mw) / vp.zoom,
    y: (-vp.y - mh) / vp.zoom,
    w: (size.width + 2 * mw) / vp.zoom,
    h: (size.height + 2 * mh) / vp.zoom
  };
}
function lodForZoom(zoom) {
  return zoom < 0.45 ? "map" : "detail";
}
var clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function lodTier(zoom, prev = "detail", { threshold = 0.45, overview = 0.2 } = {}) {
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
function lodFonts(zoom) {
  return {
    map: clampNum(13 / zoom, 14, 42),
    section: clampNum(16 / zoom, 15, 160),
    ui: clampNum(1 / zoom, 1, 4)
  };
}
var CONE = 68 * Math.PI / 180;
function nearestInDirection(rects, fromUid, dir, { candidates = null } = {}) {
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
    if (dir === "right") {
      primary = dx;
      ortho = dy;
    } else if (dir === "left") {
      primary = -dx;
      ortho = dy;
    } else if (dir === "down") {
      primary = dy;
      ortho = dx;
    } else if (dir === "up") {
      primary = -dy;
      ortho = dx;
    } else return null;
    if (primary <= 0) continue;
    const score = primary + 2 * Math.abs(ortho);
    const better = (cur, curUid) => score < cur || score === cur && (curUid === null || uid < curUid);
    if (Math.atan2(Math.abs(ortho), primary) <= CONE && better(bestScore, best)) {
      best = uid;
      bestScore = score;
    }
    if (better(fallbackScore, fallback)) {
      fallback = uid;
      fallbackScore = score;
    }
  }
  return best ?? fallback;
}
function center(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
function inflate(r, n2) {
  return { x: r.x - n2, y: r.y - n2, w: r.w + 2 * n2, h: r.h + 2 * n2 };
}
function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function sidePoint(rect, side) {
  if (rect && SHAPES.includes(rect.shape)) return shapePoint(rect, rect.shape, side);
  switch (side) {
    case "top":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case "left":
      return { x: rect.x, y: rect.y + rect.h / 2 };
    default:
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
  }
}
var SIDES = ["top", "right", "bottom", "left"];
function nearestSide(rect, point) {
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
function autoSides(a, b) {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}
function blockAnchor({ rect, rowTop, rowHeight = 0, bodyTop = 0, bodyBottom, other } = {}) {
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
var NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
function edgePath({ a, b, fromSide = "auto", toSide = "auto", route = "curve", offset = 0, via, fromPoint, toPoint } = {}) {
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
    const mid2 = pts[Math.floor((pts.length - 1) / 2)];
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    return {
      d: pts.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`).join(""),
      start,
      end,
      mid: mid2,
      points: pts,
      startAngle: angle,
      endAngle: angle,
      fromSide,
      toSide
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
      toSide
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
    let mid2 = { ...start };
    let acc = 0;
    for (let i = 0; i < lens.length; i++) {
      if (acc + lens[i] >= total / 2) {
        const t = lens[i] === 0 ? 0 : (total / 2 - acc) / lens[i];
        mid2 = {
          x: poly[i].x + (poly[i + 1].x - poly[i].x) * t,
          y: poly[i].y + (poly[i + 1].y - poly[i].y) * t
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
      mid: mid2,
      points: poly,
      startAngle: Math.atan2(second.y - start.y, second.x - start.x),
      endAngle: Math.atan2(last.y - prev.y, last.x - prev.x),
      fromSide,
      toSide
    };
  }
  const k = Math.max(40, 0.4 * dist);
  let px = 0;
  let py = 0;
  if (offset && dist > 0) {
    px = -(end.y - start.y) / dist * offset;
    py = (end.x - start.x) / dist * offset;
  }
  const c1 = { x: start.x + nf.x * k + px, y: start.y + nf.y * k + py };
  const c2 = { x: end.x + nt.x * k + px, y: end.y + nt.y * k + py };
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8
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
    toSide
  };
}
function arrowHeadPath(point, angle, size) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const bx = point.x - dx * size;
  const by = point.y - dy * size;
  const hw = size * 0.45;
  const p1 = { x: bx - dy * hw, y: by + dx * hw };
  const p2 = { x: bx + dy * hw, y: by - dx * hw };
  return `M${num(point.x)} ${num(point.y)}L${num(p1.x)} ${num(p1.y)}L${num(p2.x)} ${num(p2.y)}Z`;
}
function arrowSize(zoom, weight = 1) {
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
var xs = (r) => [r.x, r.x + r.w / 2, r.x + r.w];
var ys = (r) => [r.y, r.y + r.h / 2, r.y + r.h];
var EPS = 1e-6;
var GRID_PITCH = 24;
function snapToGrid(rect, pitch = GRID_PITCH, threshold = pitch) {
  const axis = (value) => {
    if (!pitch) return 0;
    const diff = Math.round(value / pitch) * pitch - value;
    return Math.abs(diff) <= threshold ? diff : 0;
  };
  return { dx: axis(rect.x), dy: axis(rect.y) };
}
function snapMove(moving, others, threshold) {
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
function alignRects(list, mode) {
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
function distributeRects(list, axis) {
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
var MIN_GRID_PITCH = 8;
function gridBackground(vp, style, base = GRID_PITCH) {
  if (style === "plain") return null;
  let size = base * vp.zoom;
  while (size > 0 && size < MIN_GRID_PITCH) size *= 5;
  const mod = (v) => (v % size + size) % size;
  return { size, x: mod(vp.x), y: mod(vp.y), major: size * 5 };
}

// src/model/schema.js
var PLEXUS_KEY = "plexus";
var SCHEMA_VERSION = 2;
var PALETTE = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
var ITEM_TYPES = ["card", "section", "text"];
var DEFAULT_SIZES = { card: { w: 280, h: 160 }, section: { w: 480, h: 320 }, text: { w: 240, h: 48 } };
var PAGE_CARD = { w: 360, h: 480 };
var MIN_SIZES = { card: { w: 200, h: 80 }, section: { w: 160, h: 100 }, text: { w: 60, h: 24 } };
var DEFAULT_BOARD_CARD = { w: 320, h: 220 };
var UNTITLED_BOARD = "Untitled board";
var FONT_SIZES = [16, 24, 32, 48];
var CARD_LOOKS = ["block", "card"];
var TEXT_LOOKS = ["section-note", "sticky"];
var STICKY_SIZE = { w: 200, h: 200 };
var STICKY_COLOR = "yellow";
var SECTION_LOOKS = ["lane", "calendar", "timer"];
var LANE_SIZE = { horizontal: { w: 960, h: 180 }, vertical: { w: 240, h: 640 } };
var CARD_FONT_MIN = 10;
var CARD_FONT_MAX = 48;
var CARD_FONT_DEFAULT = 14;
var SECTION_TITLE_MIN = 10;
var SECTION_TITLE_MAX = 48;
var SECTION_TITLE_DEFAULT = 18;
var ALIGNS = ["left", "center", "right", "justify"];
var EDGE_DEFAULTS = { fromSide: "auto", toSide: "auto", dir: "one", route: "curve", dash: "solid", weight: 1 };
var EDGE_WEIGHTS = [1, 2, 3, 4];
var SIDES2 = ["auto", "top", "right", "bottom", "left"];
var ARROWS = { one: "→", two: "↔", none: "—" };
var DIRS = ["one", "two", "none"];
var ROUTES = ["curve", "straight", "elbow", "around"];
var DASHES = ["solid", "dashed", "animated"];
var BOARD_PATTERNS = ["dots", "lines", "cross", "grid", "plain"];
var BOARD_TONES = ["paper", ...PALETTE];
var FIT_PAD = 24;
var NATIVE_SWATCHES = [
  "#000000",
  "#a7b6c2",
  "#ffffff",
  "#f55656",
  "#ff66a1",
  "#c274c2",
  "#ad99ff",
  "#48aff0",
  "#2ee6d6",
  "#3dcc91",
  "#ffb366",
  "#f2b824",
  "#c99765"
];
var ITEM_STYLE_KEYS = ["fontSize", "textColor", "align", "fill", "border", "shape"];
var SECTION_STYLE_KEYS = ["titleSize", "titleColor", "titleFill", "areaFill", "border"];
var ARROW_TOKENS = Object.values(ARROWS);
var HEX_RE = /^#[0-9a-f]{6}$/;
var BLOCK_UID_RE = /^[\w-]{1,36}$/;
var blockUid = (v) => typeof v === "string" && BLOCK_UID_RE.test(v) ? v : void 0;
var intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi ? v : void 0;
function hexColor(v) {
  if (typeof v !== "string") return void 0;
  const s = v.trim().toLowerCase();
  return HEX_RE.test(s) ? s : void 0;
}
function styleColor(v) {
  if (PALETTE.includes(v)) return v;
  return hexColor(v);
}
function boardColor(v) {
  if (BOARD_TONES.includes(v)) return v;
  return hexColor(v);
}
function cssColor(value, role = "line") {
  if (PALETTE.includes(value)) {
    const part = role === "text" ? "text" : role === "fill" ? "fill" : "line";
    return `var(--pxd-${value}-${part})`;
  }
  return hexColor(value);
}
function shadeHex(hex, amount) {
  const h = hexColor(hex);
  if (!h || typeof amount !== "number" || !Number.isFinite(amount)) return void 0;
  const mix = (c) => amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
  const chan = (i) => Math.max(0, Math.min(255, Math.round(mix(parseInt(h.slice(i, i + 2), 16)))));
  return `#${[1, 3, 5].map((i) => chan(i).toString(16).padStart(2, "0")).join("")}`;
}
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
function plainKeys(value) {
  if (Array.isArray(value)) return value.map(plainKeys);
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.startsWith(":") ? k.slice(1) : k] = plainKeys(v);
    }
    return out;
  }
  return value;
}
function readPlexus(props) {
  if (!isObject(props)) return null;
  const plexus = plainKeys(props)[PLEXUS_KEY];
  return isObject(plexus) ? plexus : null;
}
function mergePropsForWrite(props, plexus) {
  const out = isObject(props) ? plainKeys(props) : {};
  if (plexus == null) delete out[PLEXUS_KEY];
  else out[PLEXUS_KEY] = plainKeys(plexus);
  return out;
}
function normalizeItemLayout(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const num3 = (v) => isNum(v) ? v : void 0;
  const type = ITEM_TYPES.includes(p.type) ? p.type : "card";
  const section2 = type === "section";
  return {
    type,
    x: num3(p.x),
    y: num3(p.y),
    w: num3(p.w),
    h: num3(p.h),
    color: styleColor(p.color),
    collapsed: p.collapsed === true ? true : p.collapsed === false ? false : void 0,
    // Sections use titleSize. Cards and text take an integer 10–48 (text used to be the four steps only).
    fontSize: section2 ? void 0 : intIn(p.fontSize, CARD_FONT_MIN, CARD_FONT_MAX),
    pinned: p.pinned === true,
    kids: type === "card" && p.kids === true ? true : void 0,
    fit: p.fit === false ? false : void 0,
    look: type === "text" ? TEXT_LOOKS.includes(p.look) ? p.look : void 0 : type === "section" ? SECTION_LOOKS.includes(p.look) ? p.look : void 0 : CARD_LOOKS.includes(p.look) ? p.look : void 0,
    axis: type === "section" && p.look === "lane" ? p.axis === "vertical" ? "vertical" : "horizontal" : void 0,
    textColor: section2 ? void 0 : styleColor(p.textColor),
    align: section2 || !ALIGNS.includes(p.align) ? void 0 : p.align,
    fill: section2 ? void 0 : styleColor(p.fill),
    border: styleColor(p.border),
    titleSize: section2 ? intIn(p.titleSize, SECTION_TITLE_MIN, SECTION_TITLE_MAX) : void 0,
    titleColor: section2 ? styleColor(p.titleColor) : void 0,
    titleFill: section2 ? styleColor(p.titleFill) : void 0,
    areaFill: section2 ? styleColor(p.areaFill) : void 0,
    shape: type === "text" && SHAPES.includes(p.shape) ? p.shape : void 0
  };
}
function normalizeSectionDefaults(raw) {
  const p = isObject(raw) ? raw : {};
  const out = {};
  const ts = intIn(p.titleSize, SECTION_TITLE_MIN, SECTION_TITLE_MAX);
  if (ts !== void 0 && ts !== SECTION_TITLE_DEFAULT) out.titleSize = ts;
  for (const k of ["titleColor", "titleFill", "areaFill", "border"]) {
    const c = styleColor(p[k]);
    if (c) out[k] = c;
  }
  return out;
}
function cardLook(kind, stored) {
  if (CARD_LOOKS.includes(stored)) return stored;
  return kind === "note" ? "block" : "card";
}
function lookForNewString(string, preferred) {
  if (classifyString(string).kind !== "note") return void 0;
  return preferred === "card" ? "card" : "block";
}
var round1 = (n2) => Math.round(n2 * 10) / 10;
function serializeItemLayout(layout) {
  const l = isObject(layout) ? layout : {};
  const out = {};
  if (l.type && l.type !== "card") out.type = l.type;
  for (const k of ["x", "y", "w", "h"]) if (isNum(l[k])) out[k] = round1(l[k]);
  const color = styleColor(l.color);
  if (color) out.color = color;
  if (l.collapsed === true) out.collapsed = true;
  const type = ITEM_TYPES.includes(l.type) ? l.type : "card";
  if (type === "section") {
    const ts = intIn(l.titleSize, SECTION_TITLE_MIN, SECTION_TITLE_MAX);
    if (ts !== void 0 && ts !== SECTION_TITLE_DEFAULT) out.titleSize = ts;
    for (const k of ["titleColor", "titleFill", "areaFill", "border"]) {
      const c = styleColor(l[k]);
      if (c) out[k] = c;
    }
  } else {
    const fs = intIn(l.fontSize, CARD_FONT_MIN, CARD_FONT_MAX);
    if (fs !== void 0 && !(type === "card" && fs === CARD_FONT_DEFAULT)) out.fontSize = fs;
    const textColor = styleColor(l.textColor);
    if (textColor) out.textColor = textColor;
    if (ALIGNS.includes(l.align)) out.align = l.align;
    const fill = styleColor(l.fill);
    if (fill) out.fill = fill;
    const border = styleColor(l.border);
    if (border) out.border = border;
  }
  if (l.v === SCHEMA_VERSION) out.v = SCHEMA_VERSION;
  if (l.pinned === true) out.pinned = true;
  if (type === "card" && l.kids === true) out.kids = true;
  if (l.type === "section" && l.fit === false) out.fit = false;
  if (type === "text") {
    if (TEXT_LOOKS.includes(l.look)) out.look = l.look;
    if (SHAPES.includes(l.shape)) out.shape = l.shape;
  } else if (type === "section" && SECTION_LOOKS.includes(l.look)) {
    out.look = l.look;
    if (l.look === "lane") out.axis = l.axis === "vertical" ? "vertical" : "horizontal";
  } else if (CARD_LOOKS.includes(l.look)) out.look = l.look;
  if (BOARD_PATTERNS.includes(l.bg)) out.bg = l.bg;
  const tone = boardColor(l.bgColor);
  if (tone) out.bgColor = tone;
  return out;
}
function withBoardMarker(plexus, on) {
  const base = isObject(plexus) ? plainKeys(plexus) : {};
  if (on) return { ...base, v: SCHEMA_VERSION };
  delete base.v;
  delete base.bg;
  delete base.bgColor;
  delete base.bgImage;
  delete base.lodZoom;
  return Object.keys(base).length ? base : null;
}
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dailyPageTitle(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDate();
  const suffix = day >= 11 && day <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${MONTHS[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
}
function cleanVia(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    if (out.length >= 8) break;
  }
  return out;
}
function normalizeEdge(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const pick = (v, list, def) => list.includes(v) ? v : def;
  const via = cleanVia(p.via);
  return {
    from: typeof p.from === "string" ? p.from : "",
    to: typeof p.to === "string" ? p.to : "",
    fromSide: pick(p.fromSide, SIDES2, EDGE_DEFAULTS.fromSide),
    toSide: pick(p.toSide, SIDES2, EDGE_DEFAULTS.toSide),
    dir: pick(p.dir, DIRS, EDGE_DEFAULTS.dir),
    route: pick(p.route, ROUTES, EDGE_DEFAULTS.route),
    dash: pick(p.dash, DASHES, EDGE_DEFAULTS.dash),
    weight: EDGE_WEIGHTS.includes(p.weight) ? p.weight : EDGE_DEFAULTS.weight,
    color: styleColor(p.color),
    ...blockUid(p.fromBlock) ? { fromBlock: p.fromBlock } : {},
    ...blockUid(p.toBlock) ? { toBlock: p.toBlock } : {},
    ...via.length ? { via } : {}
  };
}
function serializeEdge(edge) {
  const e = isObject(edge) ? edge : {};
  const out = { type: "edge", from: e.from, to: e.to };
  for (const k of ["fromSide", "toSide", "dir", "route", "dash", "weight"]) {
    if (e[k] !== void 0 && e[k] !== EDGE_DEFAULTS[k]) out[k] = e[k];
  }
  const color = styleColor(e.color);
  if (color) out.color = color;
  if (blockUid(e.fromBlock)) out.fromBlock = e.fromBlock;
  if (blockUid(e.toBlock)) out.toBlock = e.toBlock;
  const via = cleanVia(e.via);
  if (via.length) out.via = via;
  return out;
}
function isSingleWikiRef(s) {
  if (!s.startsWith("[[") || !s.endsWith("]]") || s.length < 5) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[", i)) {
      depth++;
      i++;
    } else if (s.startsWith("]]", i)) {
      depth--;
      i++;
      if (depth === 0 && i !== s.length - 1) return false;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}
function classifyString(s) {
  const t = String(s ?? "").trim();
  if (isSingleWikiRef(t)) return { kind: "page", title: t.slice(2, -2) };
  if (t.startsWith("#[[") && isSingleWikiRef(t.slice(1))) return { kind: "page", title: t.slice(3, -2) };
  const tag = /^#([^\s[\]#]+)$/.exec(t);
  if (tag) return { kind: "page", title: tag[1] };
  const block = /^\(\(([\w-]+)\)\)$/.exec(t);
  if (block) return { kind: "block", refUid: block[1] };
  if (/^\{\{(\[\[)?diagram/i.test(t)) return { kind: "board" };
  if (/^!\[[^\]]*\]\([^)]*\)$/.test(t)) return { kind: "image" };
  return { kind: "note" };
}
function parseBoardTitle(s) {
  const m = /^\s*\{\{\s*(?:\[\[)?diagram(?:\]\])?\s*:([\s\S]*?)\}\}\s*$/i.exec(String(s ?? ""));
  return m ? m[1].trim() : "";
}
var cleanBoardTitle = (title) => String(title ?? "").replace(/\s*[\r\n]+\s*/g, " ").split("}}").join("").trim();
function boardString(title) {
  return `{{[[diagram]]:${cleanBoardTitle(title) || UNTITLED_BOARD}}}`;
}
function setBoardTitle(s, title) {
  const cur = String(s ?? "");
  const m = /^(\s*\{\{\s*(?:\[\[)?diagram(?:\]\])?)\s*(?::[^}]*)?\}\}/i.exec(cur);
  if (!m) return boardString(title);
  return `${m[1]}:${cleanBoardTitle(title) || UNTITLED_BOARD}}}${cur.slice(m[0].length)}`;
}
function isUntitledBoard(title) {
  const t = String(title ?? "").trim().toLowerCase();
  return t === "" || t === UNTITLED_BOARD.toLowerCase();
}
function plainText(s, max = 200) {
  let t = String(s ?? "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^[\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\(\([\w-]+\)\)/g, "");
  t = t.replace(/\{\{[^}]*\}\}/g, "");
  let prev;
  do {
    prev = t;
    t = t.replace(/#?\[\[([^[\]]*)\]\]/g, "$1");
  } while (t !== prev);
  t = t.replace(/(^|\s)#([^\s#]+)/g, "$1$2");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/\^\^(.+?)\^\^/g, "$1").replace(/~~(.+?)~~/g, "$1").replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > max) t = `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  return t;
}
function firstLine(s) {
  const line = String(s ?? "").split("\n").find((l) => l.trim() !== "");
  return line === void 0 ? "" : plainText(line);
}
function semanticRef(item) {
  const t = item?.target;
  if (t?.kind === "page") return `[[${t.title}]]`;
  if (t?.kind === "block") return `((${t.refUid ?? t.uid}))`;
  return `((${item?.uid}))`;
}
function edgeString({ srcRef, dstRef, dir = "one", label = "", srcBlock, dstBlock }) {
  if (blockUid(srcBlock)) srcRef = `((${srcBlock}))`;
  if (blockUid(dstBlock)) dstRef = `((${dstBlock}))`;
  const a = ARROWS[dir] ?? ARROWS.one;
  return label ? `${srcRef} ${a} ${label} ${a} ${dstRef}` : `${srcRef} ${a} ${dstRef}`;
}
function parseEdgeLabel(s, srcRef, dstRef) {
  const str2 = String(s ?? "").trim();
  if (srcRef && dstRef) {
    let rest = null;
    for (const a of ARROW_TOKENS) {
      const prefix = `${srcRef} ${a} `;
      if (str2.startsWith(prefix)) {
        rest = str2.slice(prefix.length);
        break;
      }
    }
    if (rest !== null) {
      if (rest === dstRef) return "";
      for (const b of ARROW_TOKENS) {
        const suffix = ` ${b} ${dstRef}`;
        if (rest.endsWith(suffix)) return rest.slice(0, rest.length - suffix.length).trim();
      }
    }
  }
  let out = str2;
  for (const token of [srcRef, dstRef, ...ARROW_TOKENS]) {
    if (token) out = out.split(token).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}
function colorForLabel(label) {
  if (label == null || label === "" || label === "mentions") return "gray";
  let h = 2166136261;
  const str2 = String(label);
  for (let i = 0; i < str2.length; i++) {
    h ^= str2.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return PALETTE[1 + h % 9];
}
function attrNameOf(s) {
  if (typeof s !== "string") return null;
  const m = /^\s*([^:\n]{1,60})::/.exec(s);
  if (!m) return null;
  const name = m[1].trim();
  return name ? name : null;
}

// src/model/query.js
var QUERY_CARD_CAP = 45;
var CARD_W = 280;
var CARD_H = 160;
var UID_RE = /^[A-Za-z0-9_-]{9}$/;
function isQueryString(s) {
  const t = String(s ?? "").trim();
  return /^\{\{\s*\[\[query\]\]\s*(?::[\s\S]*)?\}\}$/.test(t) || /^\{\{\s*query\s*(?::[\s\S]*)?\}\}$/.test(t);
}
function blockUidFromDomId(id) {
  const s = String(id || "");
  if (UID_RE.test(s)) return s;
  if (s.length < 10 || s.slice(-10, -9) !== "-") return null;
  const uid = s.slice(-9);
  return UID_RE.test(uid) ? uid : null;
}
function queryResultUids(root, skipUid) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  const seen = /* @__PURE__ */ new Set();
  if (skipUid) seen.add(skipUid);
  const out = [];
  for (const node2 of root.querySelectorAll("[id]")) {
    const uid = blockUidFromDomId(node2.id);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}
function queryResultLayout(rect, uids) {
  if (!rect) return [];
  const list = [];
  const seen = /* @__PURE__ */ new Set();
  for (const uid of uids || []) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    list.push(uid);
    if (list.length >= QUERY_CARD_CAP) break;
  }
  const n2 = list.length;
  if (!n2) return [];
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const radius = Math.max(rect.w, rect.h) / 2 + 240;
  return list.map((uid, i) => {
    const angle = -Math.PI / 2 + (n2 === 1 ? 0 : i / n2 * Math.PI * 2);
    return {
      string: `((${uid}))`,
      x: Math.round(cx + Math.cos(angle) * radius - CARD_W / 2),
      y: Math.round(cy + Math.sin(angle) * radius - CARD_H / 2)
    };
  });
}

// src/model/snapshots.js
var SNAPSHOTS_TITLE = "Snapshots";
var SNAPSHOT_KEEP = 10;
var SNAPSHOT_CHUNK = 45;
var pad = (n2) => String(n2).padStart(2, "0");
function snapshotTitle(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function captureLayout(board2) {
  const items = [];
  for (const uid of board2?.order || []) {
    const item = board2.items?.get?.(uid);
    if (!item) continue;
    items.push({
      uid,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      color: item.color || null,
      collapsed: item.collapsed === true,
      parent: item.parentUid
    });
  }
  return items;
}
function snapshotProps(items) {
  return { type: "snapshot", json: JSON.stringify({ items: items || [] }) };
}
function parseSnapshot(plexus) {
  if (!plexus || plexus.type !== "snapshot" || typeof plexus.json !== "string") return null;
  try {
    const data = JSON.parse(plexus.json);
    if (!Array.isArray(data?.items)) return null;
    return data.items.filter((item) => item && typeof item.uid === "string");
  } catch {
    return null;
  }
}
function listFromNodes(nodes) {
  const out = [];
  for (const node2 of nodes || []) {
    const items = parseSnapshot(readPlexus(node2?.[":block/props"]));
    if (!items) continue;
    out.push({
      uid: node2[":block/uid"],
      title: node2[":block/string"] || "",
      items
    });
  }
  return out;
}
function partitionSnapshots(list) {
  const all = (list || []).filter((item) => item?.uid && item.title);
  const olderCount = Math.max(0, all.length - SNAPSHOT_KEEP);
  return {
    newest: all.slice(olderCount).reverse(),
    older: all.slice(0, olderCount).reverse()
  };
}
function changed(item, entry) {
  return item.x !== entry.x || item.y !== entry.y || item.w !== entry.w || item.h !== entry.h || (item.color || null) !== (entry.color || null) || item.collapsed !== (entry.collapsed === true);
}
function planRestore(entries, board2) {
  const units = [];
  for (const entry of entries || []) {
    const item = board2?.items?.get?.(entry?.uid);
    if (!item || !entry) continue;
    const unit = [];
    const parent = entry.parent;
    const parentOk = parent === board2.uid || board2.items.get(parent)?.type === "section";
    if (parentOk && parent !== item.parentUid) unit.push({ op: "move", uid: item.uid, parent });
    if (changed(item, entry)) {
      unit.push({
        op: "props",
        uid: item.uid,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        color: entry.color || null,
        collapsed: entry.collapsed === true
      });
    }
    if (unit.length) units.push(unit);
  }
  const chunks = [];
  let chunk = [];
  for (const unit of units) {
    if (chunk.length && chunk.length + unit.length > SNAPSHOT_CHUNK) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(...unit);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

// src/model/board.js
var AUTO_GAP = 40;
var AUTO_OFFSET = 48;
var AUTO_ROWS = 4;
var TITLE_BAND = 32;
var BORDER_BAND = 8;
var isNum2 = (v) => typeof v === "number" && Number.isFinite(v);
function sortedChildren(node2) {
  const kids = Array.isArray(node2?.[":block/children"]) ? node2[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function rectOf(o) {
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
function unionRect2(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function contains(r, p) {
  if (!r || !p) return false;
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
function containsRect(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function centerOf(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
function autoPlace(siblings) {
  const placed = siblings.filter((s) => s.hasLayout);
  const loose = siblings.filter((s) => !s.hasLayout);
  if (!loose.length) return;
  let startX = 0;
  let startY = 0;
  if (placed.length) {
    const u = placed.map(rectOf).reduce(unionRect2);
    startX = u.x + u.w + AUTO_OFFSET;
    startY = u.y;
  }
  let colX = startX;
  let colW = 0;
  let y = startY;
  loose.forEach((item, i) => {
    const row2 = i % AUTO_ROWS;
    if (i > 0 && row2 === 0) {
      colX += colW + AUTO_GAP;
      colW = 0;
      y = startY;
    }
    item.x = colX;
    item.y = y;
    y += item.h + AUTO_GAP;
    colW = Math.max(colW, item.w);
  });
}
function buildBoard(pulled, { defaults } = {}) {
  if (!pulled || typeof pulled !== "object") return null;
  const uid = pulled[":block/uid"];
  const string = pulled[":block/string"] ?? "";
  const plexus = readPlexus(pulled[":block/props"]);
  const sizes = { ...DEFAULT_SIZES, card: defaults?.card ?? DEFAULT_SIZES.card };
  const items = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const roots = [];
  const preorder = [];
  let containerUid = null;
  let containerIndex = -1;
  const boardKids = sortedChildren(pulled);
  let snapshotsUid = null;
  boardKids.forEach((child, index) => {
    const marker = readPlexus(child[":block/props"])?.type;
    if (containerUid === null && marker === "edges") {
      containerUid = child[":block/uid"];
      containerIndex = index;
    }
    if (snapshotsUid === null && marker === "snapshots") snapshotsUid = child[":block/uid"];
  });
  const sectionDefaults = normalizeSectionDefaults(plexus?.defaults?.section);
  const walk = (children, parentUid, depth) => {
    const siblings = [];
    for (const child of children) {
      const cuid = child[":block/uid"];
      if (cuid === containerUid || cuid === snapshotsUid) continue;
      const cplexus = readPlexus(child[":block/props"]);
      const cstring = child[":block/string"] ?? "";
      const heading = child[":block/heading"] || 0;
      const kids = sortedChildren(child);
      const layout = normalizeItemLayout(cplexus);
      let type = layout.type;
      if (!cplexus && heading > 0 && kids.length) type = "section";
      const cls = classifyString(cstring);
      const kind = type === "section" ? "section" : type === "text" ? "text" : cls.kind;
      const size = sizes[type];
      const hasLayout = isNum2(layout.x) && isNum2(layout.y);
      let title;
      if (kind === "page") title = cls.title;
      else if (kind === "board") title = parseBoardTitle(cstring) || "Untitled board";
      else if (isQueryString(cstring)) title = "Query";
      else title = firstLine(cstring);
      let target;
      if (kind === "page") target = { kind: "page", title: cls.title };
      else if (kind === "block") target = { kind: "block", uid: cls.refUid };
      else target = { kind: "self", uid: cuid };
      const item = {
        uid: cuid,
        type,
        kind,
        string: cstring,
        heading,
        parentUid,
        order: child[":block/order"] ?? siblings.length,
        depth,
        x: hasLayout ? layout.x : 0,
        y: hasLayout ? layout.y : 0,
        w: layout.w ?? size.w,
        h: layout.h ?? size.h,
        hasLayout,
        color: layout.color,
        collapsed: layout.collapsed === true,
        fontSize: layout.fontSize,
        textColor: type === "section" ? void 0 : layout.textColor,
        align: type === "section" ? void 0 : layout.align,
        fill: type === "section" ? void 0 : layout.fill,
        border: layout.border,
        titleSize: type === "section" ? layout.titleSize : void 0,
        titleColor: type === "section" ? layout.titleColor : void 0,
        titleFill: type === "section" ? layout.titleFill : void 0,
        areaFill: type === "section" ? layout.areaFill : void 0,
        sectionDefaults: type === "section" ? sectionDefaults : void 0,
        pinned: layout.pinned,
        kids: type === "card" && layout.kids === true,
        look: type === "card" ? cardLook(kind, layout.look) : type === "text" || type === "section" ? layout.look : void 0,
        ...type === "section" && layout.look === "lane" ? { axis: layout.axis || "horizontal" } : {},
        ...type === "text" && layout.shape ? { shape: layout.shape } : {},
        open: type === "card" ? child[":block/open"] !== false : void 0,
        autofit: !(type === "section" && layout.fit === false),
        title,
        target,
        enhanced: kind === "board" && cplexus?.v === 2,
        members: [],
        content: type === "section" ? [] : kids
      };
      items.set(cuid, item);
      preorder.push(cuid);
      siblings.push(item);
      if (type === "section") {
        item.members = walk(kids, cuid, depth + 1).map((m) => m.uid);
      }
    }
    autoPlace(siblings);
    return siblings;
  };
  for (const item of walk(boardKids, uid, 0)) roots.push(item.uid);
  const sections = preorder.filter((u) => items.get(u).type === "section");
  const rest = preorder.filter((u) => items.get(u).type !== "section");
  sections.sort((a, b) => items.get(a).depth - items.get(b).depth);
  const order = [...sections, ...rest];
  if (containerUid !== null) {
    const container = boardKids[containerIndex];
    for (const e of sortedChildren(container)) {
      const eplexus = readPlexus(e[":block/props"]);
      if (eplexus?.type !== "edge") continue;
      const euid = e[":block/uid"];
      const estring = e[":block/string"] ?? "";
      const n2 = normalizeEdge(eplexus);
      const a = items.get(n2.from);
      const b = items.get(n2.to);
      edges.set(euid, {
        uid: euid,
        string: estring,
        ...n2,
        label: parseEdgeLabel(estring, n2.fromBlock ? `((${n2.fromBlock}))` : a ? semanticRef(a) : "", n2.toBlock ? `((${n2.toBlock}))` : b ? semanticRef(b) : ""),
        valid: Boolean(a && b)
      });
    }
  }
  return {
    uid,
    string,
    title: parseBoardTitle(string),
    plexus,
    enhanced: plexus?.v === 2,
    background: {
      pattern: BOARD_PATTERNS.includes(plexus?.bg) ? plexus.bg : null,
      tone: BOARD_TONES.includes(plexus?.bgColor) ? plexus.bgColor : hexColor(plexus?.bgColor) || null
    },
    defaults: { section: sectionDefaults },
    items,
    roots,
    order,
    containerUid,
    containerIndex,
    snapshotsUid,
    snapshots: listFromNodes(sortedChildren(snapshotsUid ? boardKids.find((child) => child[":block/uid"] === snapshotsUid) : null)),
    childCount: boardKids.length,
    edges
  };
}
var COLLAPSED_SECTION_H = 8;
function anchorUid(board2, uid) {
  const start = board2?.items.get(uid);
  if (!start) return uid;
  let cur = uid;
  if (start.type === "text" && start.look === "section-note") {
    const parent = board2.items.get(start.parentUid);
    if (parent?.type === "section") cur = parent.uid;
  }
  let collapsed = null;
  let walk = cur;
  while (walk && walk !== board2.uid) {
    const item = board2.items.get(walk);
    if (!item) break;
    if (item.type === "section" && item.collapsed) collapsed = item.uid;
    walk = item.parentUid;
  }
  return collapsed || cur;
}
function sectionNoteUid(board2, sectionUid) {
  const item = board2?.items.get(sectionUid);
  if (!item || item.type !== "section") return null;
  for (const m of item.members || []) {
    const kid = board2.items.get(m);
    if (kid?.type === "text" && kid.look === "section-note") return kid.uid;
  }
  return null;
}
function displayRects(board2, stored) {
  const base = stored ?? (board2 ? worldRects(board2) : /* @__PURE__ */ new Map());
  if (!board2) return new Map(base);
  const out = /* @__PURE__ */ new Map();
  for (const [uid, r] of base) {
    if (!r || anchorUid(board2, uid) !== uid) continue;
    const item = board2.items.get(uid);
    const next = item?.type === "section" && item.collapsed ? { x: r.x, y: r.y, w: r.w, h: COLLAPSED_SECTION_H } : { x: r.x, y: r.y, w: r.w, h: r.h };
    if (item?.type === "text" && item.shape) next.shape = item.shape;
    out.set(uid, next);
  }
  return out;
}
function routedEdge(board2, edge, rects) {
  if (!board2 || !edge) return null;
  const from = anchorUid(board2, edge.from);
  const to = anchorUid(board2, edge.to);
  if (!from || !to || from === to) return null;
  const a = rects?.get(from);
  const b = rects?.get(to);
  if (!a || !b) return null;
  return { from, to, a, b };
}
function worldRects(board2) {
  const rects = /* @__PURE__ */ new Map();
  for (const item of board2.items.values()) {
    const p = item.parentUid === board2.uid ? null : rects.get(item.parentUid);
    const rect = { x: item.x + (p?.x ?? 0), y: item.y + (p?.y ?? 0), w: item.w, h: item.h };
    if (item.type === "text" && item.shape) rect.shape = item.shape;
    rects.set(item.uid, rect);
  }
  return rects;
}
function worldRect(board2, uid, rects) {
  if (rects) return rects.get(uid) ?? null;
  const item = board2.items.get(uid);
  if (!item) return null;
  let x = item.x;
  let y = item.y;
  let parent = board2.items.get(item.parentUid);
  while (parent) {
    x += parent.x;
    y += parent.y;
    parent = board2.items.get(parent.parentUid);
  }
  const rect = { x, y, w: item.w, h: item.h };
  if (item.type === "text" && item.shape) rect.shape = item.shape;
  return rect;
}
function descendantsOf(board2, uid) {
  const out = /* @__PURE__ */ new Set();
  const stack = [...board2.items.get(uid)?.members ?? []];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...board2.items.get(u)?.members ?? []);
  }
  return out;
}
function hasAncestorIn(board2, uid, set) {
  let p = board2.items.get(uid)?.parentUid;
  while (p && p !== board2.uid) {
    if (set.has(p)) return true;
    p = board2.items.get(p)?.parentUid;
  }
  return false;
}
function topLevelOf(board2, uids) {
  const list = [...uids].filter((u) => board2.items.has(u));
  const set = new Set(list);
  return list.filter((u) => !hasAncestorIn(board2, u, set));
}
function containerAt(board2, point, { exclude = /* @__PURE__ */ new Set(), rects } = {}) {
  const r = rects ?? worldRects(board2);
  const ex = exclude instanceof Set ? exclude : new Set(exclude);
  let best = null;
  for (const uid of board2.order) {
    const item = board2.items.get(uid);
    if (item.type !== "section" || ex.has(uid) || hasAncestorIn(board2, uid, ex)) continue;
    if (!contains(r.get(uid), point)) continue;
    if (!best || item.depth >= best.depth) best = item;
  }
  return best ? best.uid : board2.uid;
}
function toRelative(board2, containerUid, worldPoint, rects) {
  if (containerUid === board2.uid) return { x: worldPoint.x, y: worldPoint.y };
  const c = worldRect(board2, containerUid, rects);
  return { x: worldPoint.x - c.x, y: worldPoint.y - c.y };
}
function hitTest(board2, point, rects, { sectionInterior = false, exclude = null } = {}) {
  for (let i = board2.order.length - 1; i >= 0; i--) {
    const item = board2.items.get(board2.order[i]);
    if (item.type === "section" || exclude?.has(item.uid)) continue;
    if (contains(rects.get(item.uid), point)) return { uid: item.uid, part: "body" };
  }
  for (let i = board2.order.length - 1; i >= 0; i--) {
    const item = board2.items.get(board2.order[i]);
    if (item.type !== "section" || exclude?.has(item.uid)) continue;
    const r = rects.get(item.uid);
    if (!contains(r, point)) continue;
    if (point.y - r.y <= TITLE_BAND) return { uid: item.uid, part: "title" };
    const edge = Math.min(point.x - r.x, r.x + r.w - point.x, point.y - r.y, r.y + r.h - point.y);
    if (edge <= BORDER_BAND) return { uid: item.uid, part: "border" };
    if (sectionInterior) return { uid: item.uid, part: "interior" };
  }
  return null;
}
function boundsOf(rectList) {
  const list = [...rectList];
  return list.length ? list.reduce(unionRect2) : null;
}
function cardAtCenter(bounds, size) {
  const w = size?.w || 0;
  const h = size?.h || 0;
  const cx = bounds ? bounds.x + bounds.w / 2 : 0;
  const cy = bounds ? bounds.y + bounds.h / 2 : 0;
  return { x: cx - w / 2, y: cy - h / 2 };
}
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var PREVIEW_MIN = { w: DEFAULT_SIZES.card.w * 2, h: DEFAULT_SIZES.card.h * 2 };
var PREVIEW_TITLE = 40;
function boardPreview(item, { max = 60, aspect = null, pad: pad2 = 0.12 } = {}) {
  const empty = { count: 0, aspect: 1.6, rects: [], edges: [], bounds: null, empty: true };
  const child = buildBoard({
    ":block/uid": item?.uid,
    ":block/string": item?.string ?? "",
    ":block/children": item?.content ?? []
  });
  if (!child) return empty;
  const world = worldRects(child);
  const bounds = boundsOf([...world.values()]);
  if (!bounds) return empty;
  const bw = bounds.w || 1;
  const bh = bounds.h || 1;
  let w = Math.max(bw, PREVIEW_MIN.w);
  let h = Math.max(bh, PREVIEW_MIN.h);
  const p = Math.max(FIT_PAD, pad2 * Math.max(bw, bh));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  w += 2 * p;
  h += 2 * p;
  const target = isNum2(aspect) && aspect > 0 ? aspect : clamp(w / h, 0.25, 4);
  if (w / h < target) w = h * target;
  else h = w / target;
  const fx = cx - w / 2;
  const fy = cy - h / 2;
  const rects = [];
  for (const uid of child.order) {
    if (rects.length >= max) break;
    const r = world.get(uid);
    const it = child.items.get(uid);
    let title;
    if (it.type === "section") title = it.title;
    else title = firstLine(it.string).slice(0, PREVIEW_TITLE) || (it.kind === "board" ? it.title.slice(0, PREVIEW_TITLE) : "");
    rects.push({
      x: (r.x - fx) / w,
      y: (r.y - fy) / h,
      w: r.w / w,
      h: r.h / h,
      type: it.type,
      kind: it.kind,
      color: it.color,
      title,
      ...!title && it.kind === "block" && it.target?.uid ? { ref: it.target.uid } : {}
    });
  }
  const edges = [];
  for (const e of child.edges.values()) {
    if (!e.valid) continue;
    const a = centerOf(world.get(e.from));
    const b = centerOf(world.get(e.to));
    edges.push({ x1: (a.x - fx) / w, y1: (a.y - fy) / h, x2: (b.x - fx) / w, y2: (b.y - fy) / h });
  }
  return { count: child.items.size, aspect: target, rects, edges, bounds, empty: false };
}
function sectionFitPlan(board2, rects, touchedUids, {
  pad: pad2 = FIT_PAD,
  skip = /* @__PURE__ */ new Set(),
  parentOf = (u) => board2.items.get(u)?.parentUid
} = {}) {
  const work = /* @__PURE__ */ new Map();
  const same = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  for (const touched of touchedUids) {
    let cur = touched;
    for (let guard = 0; guard < 256; guard++) {
      const pid = parentOf(cur);
      if (!pid || pid === board2.uid) break;
      const sec = board2.items.get(pid);
      if (!sec || sec.type !== "section" || sec.autofit === false || sec.pinned || skip.has(pid)) break;
      const secRect = work.get(pid) ?? rects.get(pid);
      const childRect = work.get(cur) ?? rects.get(cur);
      if (!secRect || !childRect) break;
      const need = unionRect2(secRect, inflate(childRect, pad2));
      if (same(need, secRect)) break;
      work.set(pid, need);
      cur = pid;
    }
  }
  const depthOf = (u) => {
    let d = 0;
    let cur = u;
    for (let i = 0; i < 256; i++) {
      const pid = parentOf(cur);
      if (!pid || pid === board2.uid) break;
      d++;
      cur = pid;
    }
    return d;
  };
  return [...work.entries()].map(([uid, rect]) => ({ uid, rect, depth: depthOf(uid) })).sort((a, b) => b.depth - a.depth).map(({ uid, rect }) => ({ uid, rect }));
}
function sidebarOutlineUids(board2) {
  if (!board2) return [];
  const uids = [...board2.roots || []];
  if (board2.containerUid) uids.push(board2.containerUid);
  return uids;
}
function readingOrder(board2, rects) {
  if (!board2) return [];
  const key = (uid) => {
    const r = rects?.get?.(uid);
    const item = board2.items.get(uid);
    return { y: r?.y ?? item?.y ?? 0, x: r?.x ?? item?.x ?? 0 };
  };
  const byPos = (uids) => [...uids || []].sort((a, b) => {
    const pa = key(a);
    const pb = key(b);
    return pa.y - pb.y || pa.x - pb.x || (a < b ? -1 : a > b ? 1 : 0);
  });
  const groups = [];
  const visit = (parent, uids) => {
    const sorted = byPos(uids);
    if (!sorted.length) return;
    groups.push({ parent, uids: sorted });
    for (const uid of sorted) {
      const item = board2.items.get(uid);
      if (item?.type === "section") visit(uid, item.members);
    }
  };
  visit(board2.uid, board2.roots);
  return groups;
}
function outlineOrder(board2) {
  const byOrder = (uids) => uids.map((u, i) => ({ u, i, o: board2.items.get(u)?.order ?? i })).sort((a, b) => a.o - b.o || a.i - b.i).map(({ u }) => u);
  const out = [];
  const visit = (uid) => {
    out.push(uid);
    for (const m of byOrder(board2.items.get(uid).members)) visit(m);
  };
  for (const uid of byOrder(board2.roots)) visit(uid);
  return out;
}
function itemsInRect(board2, rect, rects, { mode = "contain" } = {}) {
  const test = mode === "intersect" ? intersects : (r, a) => containsRect(r, a);
  const hits = [];
  for (const uid of board2.order) {
    const r = rects.get(uid);
    if (r && test(rect, r)) hits.push(uid);
  }
  return topLevelOf(board2, hits);
}
function onSegment(a, b, p) {
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -1e-9) return false;
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= len2 + 1e-9;
}
function pointInPolygon(point, polygon) {
  const n2 = polygon?.length ?? 0;
  if (!point || n2 < 3) return false;
  for (let i = 0, j = n2 - 1; i < n2; j = i++) {
    if (onSegment(polygon[j], polygon[i], point)) return true;
  }
  let inside3 = false;
  for (let i = 0, j = n2 - 1; i < n2; j = i++) {
    const yi = polygon[i].y;
    const yj = polygon[j].y;
    const xi = polygon[i].x;
    const xj = polygon[j].x;
    const intersect = yi > point.y !== yj > point.y && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi;
    if (intersect) inside3 = !inside3;
  }
  return inside3;
}
function itemsInPolygon(board2, polygon, rects) {
  if (!board2 || !Array.isArray(polygon) || polygon.length < 3) return [];
  const r = rects ?? worldRects(board2);
  const hits = [];
  for (const uid of board2.order) {
    const rect = r.get(uid);
    if (rect && pointInPolygon(centerOf(rect), polygon)) hits.push(uid);
  }
  return topLevelOf(board2, hits);
}
function sameColorUids(board2, uid) {
  const seed = board2?.items.get(uid);
  if (!seed) return [];
  const color = seed.color || null;
  const out = [];
  for (const id of board2.order) {
    const item = board2.items.get(id);
    if ((item.color || null) === color) out.push(id);
  }
  return out;
}
function connectedUids(board2, uid) {
  if (!board2?.items.has(uid)) return [];
  const adj = /* @__PURE__ */ new Map();
  const link = (a, b) => {
    if (!board2.items.has(a) || !board2.items.has(b) || a === b) return;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (const edge of board2.edges.values()) {
    if (!edge.valid) continue;
    link(edge.from, edge.to);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set([uid]);
  const queue = [uid];
  while (queue.length) {
    const current2 = queue.shift();
    out.push(current2);
    for (const next of adj.get(current2) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return out;
}
function sectionAllUids(board2, uid) {
  const item = board2?.items.get(uid);
  if (!item || item.type !== "section") return [];
  const kids = descendantsOf(board2, uid);
  return board2.order.filter((id) => kids.has(id));
}
function membershipPlan(board2, movedUids, rects) {
  const moved = topLevelOf(board2, movedUids);
  const exclude = new Set(moved);
  const plan = [];
  for (const uid of moved) {
    const item = board2.items.get(uid);
    const r = rects.get(uid);
    const toParent = containerAt(board2, centerOf(r), { exclude, rects });
    if (toParent === item.parentUid) continue;
    const rel = toRelative(board2, toParent, { x: r.x, y: r.y }, rects);
    plan.push({ uid, fromParent: item.parentUid, toParent, x: rel.x, y: rel.y });
  }
  return plan;
}
function sectionAdoptPlan(board2, sectionUid, rects) {
  const section2 = board2.items.get(sectionUid);
  if (!section2) return [];
  const sr = rects.get(sectionUid);
  const parentUid = section2.parentUid;
  const siblings = parentUid === board2.uid ? board2.roots : board2.items.get(parentUid).members;
  const plan = [];
  for (const uid of siblings) {
    if (uid === sectionUid) continue;
    const r = rects.get(uid);
    if (!contains(sr, centerOf(r))) continue;
    const rel = toRelative(board2, sectionUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: sectionUid, x: rel.x, y: rel.y });
  }
  for (const uid of section2.members) {
    const r = rects.get(uid);
    if (contains(sr, centerOf(r))) continue;
    const rel = toRelative(board2, parentUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: parentUid, x: rel.x, y: rel.y });
  }
  return plan;
}
function edgesTouching(board2, uidSet) {
  const full = new Set(uidSet);
  for (const u of uidSet) for (const d of descendantsOf(board2, u)) full.add(d);
  const out = /* @__PURE__ */ new Set();
  for (const e of board2.edges.values()) if (full.has(e.from) || full.has(e.to)) out.add(e.uid);
  return out;
}
function findEdge(board2, from, to) {
  for (const e of board2.edges.values()) if (e.from === from && e.to === to) return e;
  return null;
}
function diffBoards(prev, next) {
  if (!prev || !next) {
    const dirty2 = /* @__PURE__ */ new Set();
    if (next) {
      for (const u of next.items.keys()) dirty2.add(u);
      for (const u of next.edges.keys()) dirty2.add(u);
    }
    return { structural: true, dirty: dirty2 };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let structural = prev.containerUid !== next.containerUid || prev.items.size !== next.items.size || prev.edges.size !== next.edges.size || !same(prev.roots, next.roots) || !same(prev.order, next.order);
  const dirty = /* @__PURE__ */ new Set();
  if (prev.string !== next.string || !same(prev.plexus, next.plexus)) dirty.add(next.uid);
  for (const [uid, item] of next.items) {
    const old = prev.items.get(uid);
    if (!old) {
      structural = true;
      dirty.add(uid);
      continue;
    }
    if (old.parentUid !== item.parentUid || !same(old.members, item.members)) structural = true;
    if (!same(old, item)) dirty.add(uid);
  }
  for (const [uid, edge] of next.edges) {
    const old = prev.edges.get(uid);
    if (!old) {
      structural = true;
      dirty.add(uid);
      continue;
    }
    if (!same(old, edge)) dirty.add(uid);
  }
  return { structural, dirty };
}

// src/model/clipboard.js
var PLEXUS_MIME = "application/x-plexus-cards";
var MAX_PASTED_LINES = 50;
function copyPayload(board2, uids, rects) {
  const top = topLevelOf(board2, [...uids]);
  const items = [];
  const boxes = [];
  for (const uid of top) {
    const item = board2.items.get(uid);
    const r = rects.get(uid);
    if (!item || !r) continue;
    boxes.push(r);
    items.push({
      uid,
      type: item.type,
      kind: item.kind,
      string: item.string,
      target: item.target,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      color: item.color
    });
  }
  const bounds = boundsOf(boxes);
  return {
    mime: JSON.stringify({ v: 1, board: board2.uid, bounds, items }),
    text: items.map((i) => semanticRef(i)).join("\n")
  };
}
function parsePastedText(text2) {
  const out = [];
  for (const raw of String(text2 ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, "").trim();
    if (!line) continue;
    out.push({ string: line });
    if (out.length >= MAX_PASTED_LINES) break;
  }
  return out;
}
function parseClipboard(data) {
  const get = (type) => {
    try {
      return data?.getData?.(type) ?? "";
    } catch {
      return "";
    }
  };
  const raw = get(PLEXUS_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1 && Array.isArray(parsed.items)) return { kind: "plexus", data: parsed };
    } catch {
    }
  }
  const files = [...data?.files ?? []].filter((f) => typeof f?.type === "string" && f.type.startsWith("image/"));
  if (files.length) return { kind: "images", files };
  const entries = parsePastedText(get("text/plain"));
  return entries.length ? { kind: "text", entries } : null;
}
var MAX_EDITOR_LINES = 45;
function editorPastePlan({
  text: text2 = "",
  imageCount = 0,
  value = "",
  selectionStart = 0,
  selectionEnd = 0,
  isRoot = false
} = {}) {
  if ((Number(imageCount) || 0) > 0) return { type: "images" };
  if (!isRoot) return { type: "roam" };
  const raw = String(text2 ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!raw.includes("\n")) return { type: "roam" };
  let lines = raw.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= 1) return { type: "roam" };
  if (lines.length > MAX_EDITOR_LINES) lines = lines.slice(0, MAX_EDITOR_LINES);
  const v = String(value ?? "");
  let a = Number(selectionStart);
  let b = Number(selectionEnd);
  if (!Number.isFinite(a)) a = v.length;
  if (!Number.isFinite(b)) b = a;
  const start = Math.max(0, Math.min(Math.min(a, b), v.length));
  const end = Math.max(start, Math.min(Math.max(a, b), v.length));
  return {
    type: "blocks",
    string: v.slice(0, start) + lines[0] + v.slice(end),
    children: lines.slice(1)
  };
}
function inlineAtCaret(value, selectionStart, selectionEnd, insert) {
  const v = String(value ?? "");
  const chunk = String(insert ?? "");
  let a = Number(selectionStart);
  let b = Number(selectionEnd);
  if (!Number.isFinite(a)) a = v.length;
  if (!Number.isFinite(b)) b = a;
  const start = Math.max(0, Math.min(Math.min(a, b), v.length));
  const end = Math.max(start, Math.min(Math.max(a, b), v.length));
  return { string: v.slice(0, start) + chunk + v.slice(end), caret: start + chunk.length };
}
function imageMarkdown(urls) {
  return [...urls ?? []].filter((u) => typeof u === "string" && u).map((u) => `![](${u})`).join("");
}
function refCardStrings(data, at) {
  const items = data?.items ?? [];
  if (!items.length) return [];
  const bounds = data.bounds ?? boundsOf(items) ?? { x: 0, y: 0 };
  return items.map((i) => ({
    string: semanticRef(i),
    x: at.x + (i.x - bounds.x),
    y: at.y + (i.y - bounds.y),
    w: i.w,
    h: i.h,
    color: i.color
  }));
}
var REF = /\(\(([\w-]+)\)\)/g;
var rewriteRefs = (string, uidMap) => String(string ?? "").replace(REF, (m, uid) => uidMap.has(uid) ? `((${uidMap.get(uid)}))` : m);
function sortedKids(node2) {
  const kids = Array.isArray(node2?.[":block/children"]) ? node2[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function planSubtreeClone(node2, { genUid, parentUid, order = "last", plexusPatch = null, uidMap = /* @__PURE__ */ new Map() } = {}) {
  const assign = (n2) => {
    uidMap.set(n2[":block/uid"], genUid());
    for (const c of sortedKids(n2)) assign(c);
  };
  assign(node2);
  const creates = [];
  const emit2 = (n2, parent, ord, isRoot) => {
    const props = n2[":block/props"] == null ? null : plainKeys(n2[":block/props"]);
    let outProps = props;
    if (isRoot && plexusPatch) {
      outProps = { ...props ?? {} };
      outProps[PLEXUS_KEY] = { ...outProps[PLEXUS_KEY] ?? {}, ...plexusPatch };
    }
    const uid = uidMap.get(n2[":block/uid"]);
    creates.push({
      uid,
      parent,
      order: ord,
      string: rewriteRefs(n2[":block/string"], uidMap),
      props: outProps,
      open: n2[":block/open"] !== false
    });
    sortedKids(n2).forEach((c, i) => emit2(c, uid, i, false));
  };
  emit2(node2, parentUid, order, true);
  return { creates, uidMap };
}
function planEdgeClones(edges, uidMap, { genUid, containerUid, refOfNew } = {}) {
  const list = edges instanceof Map ? [...edges.values()] : [...edges ?? []];
  const creates = [];
  for (const edge of list) {
    if (!uidMap.has(edge.from) || !uidMap.has(edge.to)) continue;
    const from = uidMap.get(edge.from);
    const to = uidMap.get(edge.to);
    creates.push({
      uid: genUid(),
      parent: containerUid,
      order: "last",
      string: edgeString({ srcRef: refOfNew(from), dstRef: refOfNew(to), dir: edge.dir, label: edge.label, srcBlock: edge.fromBlock, dstBlock: edge.toBlock }),
      props: { [PLEXUS_KEY]: serializeEdge({ ...edge, from, to }) },
      open: true
    });
  }
  return creates;
}

// src/model/layout.js
var num2 = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
var norm = (n2) => n2 + 0;
function unionOf(list) {
  let x0 = Infinity;
  let y0 = Infinity;
  for (const r of list) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
  }
  return { x: x0, y: y0 };
}
function gridPlace(items, origin, gap, columns) {
  const n2 = items.length;
  const cols = Math.max(1, Math.min(n2, Math.floor(num2(columns, 0)) || Math.ceil(Math.sqrt(n2))));
  const colW = new Array(cols).fill(0);
  const rowH = [];
  items.forEach((r, i) => {
    const c = i % cols;
    const row2 = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], r.w);
    rowH[row2] = Math.max(rowH[row2] ?? 0, r.h);
  });
  const colX = [];
  let x = origin.x;
  for (let c = 0; c < cols; c++) {
    colX[c] = x;
    x += colW[c] + gap;
  }
  const rowY = [];
  let y = origin.y;
  for (let row2 = 0; row2 < rowH.length; row2++) {
    rowY[row2] = y;
    y += rowH[row2] + gap;
  }
  return items.map((r, i) => ({ uid: r.uid, x: norm(colX[i % cols]), y: norm(rowY[Math.floor(i / cols)]) }));
}
function tidyRects(list, mode, { gap = 24, columns = null, order = null } = {}) {
  const rects = (list ?? []).map((r, i) => ({ ...r, i }));
  if (!rects.length) return [];
  const origin = unionOf(rects);
  if (mode === "row") {
    const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y || a.i - b.i);
    let x = origin.x;
    return sorted.map((r) => {
      const out = { uid: r.uid, x: norm(x), y: norm(origin.y) };
      x += r.w + gap;
      return out;
    });
  }
  if (mode === "column") {
    const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i);
    let y = origin.y;
    return sorted.map((r) => {
      const out = { uid: r.uid, x: norm(origin.x), y: norm(y) };
      y += r.h + gap;
      return out;
    });
  }
  const reading = [...rects].sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i);
  if (mode === "outline") {
    const byUid = new Map(rects.map((r) => [r.uid, r]));
    const seen = /* @__PURE__ */ new Set();
    const ordered = [];
    for (const uid of order ?? []) {
      const r = byUid.get(uid);
      if (r && !seen.has(uid)) {
        seen.add(uid);
        ordered.push(r);
      }
    }
    for (const r of reading) if (!seen.has(r.uid)) ordered.push(r);
    return gridPlace(ordered, origin, gap, columns);
  }
  return gridPlace(reading, origin, gap, columns);
}
var overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
var overlapY = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
function spaceOut(rects, movedUids, { gap = 16, maxPasses = 8, fixed = null } = {}) {
  const moved = movedUids instanceof Set ? movedUids : new Set(movedUids ?? []);
  const anchored = fixed instanceof Set ? fixed : new Set(fixed ?? []);
  const cur = /* @__PURE__ */ new Map();
  for (const [uid, r] of rects) cur.set(uid, { x: r.x, y: r.y, w: r.w, h: r.h });
  const displaced = /* @__PURE__ */ new Map();
  const pushers = [...cur.keys()].filter((u) => moved.has(u));
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed2 = false;
    for (const [uid, r] of cur) {
      if (moved.has(uid) || anchored.has(uid)) continue;
      const myOrder = displaced.has(uid) ? displaced.get(uid) : Infinity;
      for (const puid of pushers) {
        if (puid === uid) continue;
        if (!moved.has(puid) && displaced.get(puid) >= myOrder) continue;
        const p = cur.get(puid);
        const ox = overlapX(r, p);
        const oy = overlapY(r, p);
        if (ox <= 0 || oy <= 0) continue;
        if (ox <= oy) {
          r.x = r.x + r.w / 2 < p.x + p.w / 2 ? p.x - gap - r.w : p.x + p.w + gap;
        } else {
          r.y = r.y + r.h / 2 < p.y + p.h / 2 ? p.y - gap - r.h : p.y + p.h + gap;
        }
        if (!displaced.has(uid)) {
          displaced.set(uid, displaced.size);
          pushers.push(uid);
        }
        changed2 = true;
      }
    }
    if (!changed2) break;
  }
  return [...displaced.keys()].map((uid) => ({ uid, x: norm(cur.get(uid).x), y: norm(cur.get(uid).y) }));
}
function sameSize(list, primaryUid, mode = "both") {
  const primary = (list ?? []).find((r) => r.uid === primaryUid);
  if (!primary) return [];
  const out = [];
  for (const r of list) {
    if (r.uid === primaryUid) continue;
    const w = mode === "height" ? r.w : primary.w;
    const h = mode === "width" ? r.h : primary.h;
    if (w !== r.w || h !== r.h) out.push({ uid: r.uid, w, h });
  }
  return out;
}
function subtree(node2, sizeOf, levelGap, sibGap) {
  const { dd, bb } = sizeOf(node2);
  const kids = (node2.children ?? []).map((c) => ({ c, s: subtree(c, sizeOf, levelGap, sibGap), size: sizeOf(c) }));
  if (!kids.length) return { extent: bb, nodeB: 0, places: [{ uid: node2.uid, d: 0, b: 0 }] };
  let cursor = 0;
  const offs = kids.map((k) => {
    const o = cursor;
    cursor += k.s.extent + sibGap;
    return o;
  });
  const childrenExtent = cursor - sibGap;
  const centerOf3 = (i) => offs[i] + kids[i].s.nodeB + kids[i].size.bb / 2;
  const parentB = (centerOf3(0) + centerOf3(kids.length - 1)) / 2 - bb / 2;
  const min = Math.min(0, parentB);
  const max = Math.max(childrenExtent, parentB + bb);
  const places = [{ uid: node2.uid, d: 0, b: parentB - min }];
  kids.forEach((k, i) => {
    for (const p of k.s.places) places.push({ uid: p.uid, d: dd + levelGap + p.d, b: offs[i] - min + p.b });
  });
  return { extent: max - min, nodeB: parentB - min, places };
}
function mindMapLayout(root, { direction = "right", hGap = 80, vGap = 24 } = {}) {
  const out = /* @__PURE__ */ new Map();
  if (!root) return out;
  const down2 = direction === "down";
  const sizeOf = down2 ? (n2) => ({ dd: n2.h, bb: n2.w }) : (n2) => ({ dd: n2.w, bb: n2.h });
  const toXY = (d, b) => down2 ? { x: norm(b), y: norm(d) } : { x: norm(d), y: norm(b) };
  const groupPlaces = (kids2) => {
    const s = subtree({ ...root, children: kids2 }, sizeOf, hGap, vGap);
    return s.places.map((p) => ({ uid: p.uid, d: p.d, b: p.b - s.nodeB }));
  };
  const kids = root.children ?? [];
  if (direction === "balanced") {
    const rootDd = sizeOf(root).dd;
    const right = kids.filter((_, i) => i % 2 === 0);
    const left = kids.filter((_, i) => i % 2 === 1);
    out.set(root.uid, { x: 0, y: 0 });
    for (const p of groupPlaces(right)) if (p.uid !== root.uid) out.set(p.uid, toXY(p.d, p.b));
    for (const p of groupPlaces(left)) {
      if (p.uid === root.uid) continue;
      const w = sizeOf(findNode(root, p.uid)).dd;
      out.set(p.uid, toXY(rootDd - (p.d + w), p.b));
    }
    return out;
  }
  if (direction === "radial") {
    const radialSize = (n2) => {
      const span = Math.max(num2(n2?.w, 0), num2(n2?.h, 0), 1);
      return { dd: span, bb: span };
    };
    const s = subtree({ ...root, children: kids }, radialSize, hGap, vGap);
    const places = s.places.map((p) => ({ uid: p.uid, d: p.d, b: p.b - s.nodeB }));
    let minB = Infinity;
    let maxB = -Infinity;
    for (const p of places) {
      const bb = radialSize(findNode(root, p.uid) || root).bb;
      if (p.b < minB) minB = p.b;
      if (p.b + bb > maxB) maxB = p.b + bb;
    }
    const spanB = Math.max(maxB - minB, 1);
    const cx = num2(root.w, 0) / 2;
    const cy = num2(root.h, 0) / 2;
    for (const p of places) {
      if (p.uid === root.uid) {
        out.set(p.uid, { x: 0, y: 0 });
        continue;
      }
      const node2 = findNode(root, p.uid);
      const mid = p.b + radialSize(node2).bb / 2;
      const angle = (mid - minB) / spanB * Math.PI * 2 - Math.PI / 2;
      const x = cx + p.d * Math.cos(angle) - num2(node2.w, 0) / 2;
      const y = cy + p.d * Math.sin(angle) - num2(node2.h, 0) / 2;
      out.set(p.uid, { x: norm(x), y: norm(y) });
    }
    return out;
  }
  for (const p of groupPlaces(kids)) out.set(p.uid, toXY(p.d, p.b));
  return out;
}
function findNode(node2, uid) {
  if (node2.uid === uid) return node2;
  for (const c of node2.children ?? []) {
    const f = findNode(c, uid);
    if (f) return f;
  }
  return null;
}

// src/model/mindmap.js
var MIND_DIRECTIONS = Object.freeze(["right", "down", "balanced", "radial"]);
var MIND_SPACINGS = Object.freeze(["compact", "normal", "airy"]);
var MIND_DEPTH_MIN = 1;
var MIND_DEPTH_MAX = 4;
var MIND_PRESET_KEY = "plexus-diagram:mindmap-preset";
var MIND_GAPS = Object.freeze({
  compact: Object.freeze({ hGap: 40, vGap: 12 }),
  normal: Object.freeze({ hGap: 80, vGap: 24 }),
  airy: Object.freeze({ hGap: 140, vGap: 48 })
});
var DEFAULT_MIND_PRESET = Object.freeze({
  direction: "right",
  spacing: "normal",
  depth: 3,
  includeRefs: true,
  colorBranches: false
});
function normalizeMindPreset(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const depth = Number(src.depth);
  return {
    direction: MIND_DIRECTIONS.includes(src.direction) ? src.direction : DEFAULT_MIND_PRESET.direction,
    spacing: MIND_SPACINGS.includes(src.spacing) ? src.spacing : DEFAULT_MIND_PRESET.spacing,
    depth: Number.isInteger(depth) && depth >= MIND_DEPTH_MIN && depth <= MIND_DEPTH_MAX ? depth : DEFAULT_MIND_PRESET.depth,
    includeRefs: src.includeRefs === false ? false : DEFAULT_MIND_PRESET.includeRefs,
    colorBranches: src.colorBranches === true
  };
}
function readMindPreset(storage) {
  try {
    const raw = storage?.getItem?.(MIND_PRESET_KEY);
    if (!raw) return normalizeMindPreset(null);
    return normalizeMindPreset(JSON.parse(raw));
  } catch {
    return normalizeMindPreset(null);
  }
}
function writeMindPreset(storage, patch) {
  const next = normalizeMindPreset({ ...readMindPreset(storage), ...patch && typeof patch === "object" ? patch : {} });
  try {
    storage?.setItem?.(MIND_PRESET_KEY, JSON.stringify(next));
  } catch {
  }
  return next;
}
function branchColor(index) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  return PALETTE[i % PALETTE.length];
}

// src/model/namespace.js
function namespaceParent(title) {
  const name = String(title ?? "").trim();
  const slash = name.indexOf("/");
  if (slash <= 0 || slash >= name.length - 1) return null;
  return name.slice(0, slash);
}
function dropNamespace(strings) {
  const hits = [];
  for (let i = 0; i < (strings || []).length; i++) {
    const cls = classifyString(strings[i]);
    if (cls.kind !== "page") continue;
    const parent2 = namespaceParent(cls.title);
    if (!parent2) continue;
    hits.push({ i, parent: parent2 });
  }
  if (!hits.length) return null;
  const parent = hits[0].parent;
  if (hits.some((hit) => hit.parent !== parent)) return null;
  return { parent, indexes: hits.map((hit) => hit.i) };
}

// src/model/section6.js
var MONTHS2 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var DAY = /(\d{1,2})(?:st|nd|rd|th)?/;
var ATTRIBUTE_TEMPLATE = [
  { string: "Owner:: " },
  { string: "Status:: " },
  { string: "Due:: " }
];
var FOCUS_MS = 25 * 60 * 1e3;
var THUMBNAIL_CAP = 4;
var VIA_CAP = 8;
function cardLabel(item) {
  const title = String(item?.title ?? "").trim();
  if (title) return title;
  const line = String(item?.string ?? "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  return line.slice(0, 80);
}
function highlightHits(string) {
  const out = [];
  const re = /\^\^([\s\S]*?)\^\^/g;
  let m;
  const s = String(string ?? "");
  while (m = re.exec(s)) {
    const text2 = m[1].trim();
    if (text2) out.push(text2);
  }
  return out;
}
function imageSrcOf(string) {
  const m = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(String(string ?? ""));
  return m ? m[1] : null;
}
function galleryItems(board2) {
  const out = [];
  for (const item of board2?.items?.values?.() || []) {
    if (item.type !== "card") continue;
    const src = item.kind === "image" ? imageSrcOf(item.string) : imageSrcOf(item.string);
    if (item.kind !== "image" && !src) continue;
    out.push({ uid: item.uid, title: cardLabel(item), src });
  }
  return out;
}
function galleryGrid(items, { cols = 4, cell = 160, gap = 12 } = {}) {
  const n2 = Math.max(1, cols);
  return (items || []).map((item, i) => ({
    uid: item.uid,
    title: item.title || "",
    src: item.src || null,
    x: i % n2 * (cell + gap),
    y: Math.floor(i / n2) * (cell + gap),
    w: cell,
    h: cell
  }));
}
function parseCardDate(item) {
  const title = String(item?.title ?? "").trim();
  const daily = new RegExp(`^(${MONTHS2.join("|")})\\s+${DAY.source},\\s+(\\d{4})$`).exec(title);
  if (daily) {
    const month2 = MONTHS2.indexOf(daily[1]);
    const day2 = Number(daily[2]);
    const year2 = Number(daily[3]);
    if (month2 >= 0 && day2 >= 1 && day2 <= 31) return Date.UTC(year2, month2, day2);
  }
  const blob = `${title}
${item?.string ?? ""}`;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(blob);
  if (!iso) return null;
  const year = Number(iso[1]);
  const month = Number(iso[2]) - 1;
  const day = Number(iso[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return Date.UTC(year, month, day);
}
function calendarSlots(cards, { year, month } = {}) {
  const slots = [];
  for (const card2 of cards || []) {
    const t = parseCardDate(card2);
    if (t == null) continue;
    const d = new Date(t);
    if (year != null && d.getUTCFullYear() !== year) continue;
    if (month != null && d.getUTCMonth() !== month) continue;
    slots.push({ uid: card2.uid, day: d.getUTCDate(), t, title: card2.title || "" });
  }
  slots.sort((a, b) => a.t - b.t || String(a.uid).localeCompare(String(b.uid)));
  return slots;
}
function calendarLayout(cards, { year, month, x0 = 16, y0 = 48, col = 28 } = {}) {
  return calendarSlots(cards, { year, month }).map((slot) => ({
    uid: slot.uid,
    x: x0 + (slot.day - 1) * col,
    y: y0
  }));
}
function timelineAxis(cards, { width = 800 } = {}) {
  const dated = (cards || []).map((card2) => ({ card: card2, t: parseCardDate(card2) })).filter((row2) => row2.t != null).sort((a, b) => a.t - b.t || String(a.card.uid).localeCompare(String(b.card.uid)));
  if (!dated.length) return [];
  const min = dated[0].t;
  const span = dated[dated.length - 1].t - min || 1;
  return dated.map((row2) => ({
    uid: row2.card.uid,
    title: cardLabel(row2.card),
    t: row2.t,
    x: (row2.t - min) / span * width
  }));
}
function graphLayout(nodes, links, { iterations = 12 } = {}) {
  const ids = [...nodes || []];
  const pos = /* @__PURE__ */ new Map();
  const n2 = ids.length || 1;
  ids.forEach((id, i) => {
    const a = Math.PI * 2 * i / n2;
    pos.set(id, { x: Math.cos(a) * 120, y: Math.sin(a) * 120 });
  });
  const steps = Math.max(0, Math.min(40, iterations));
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]);
        const b = pos.get(ids[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const dist = Math.sqrt(d2);
        const push = 400 / d2;
        dx /= dist;
        dy /= dist;
        a.x += dx * push;
        a.y += dy * push;
        b.x -= dx * push;
        b.y -= dy * push;
      }
    }
    for (const link of links || []) {
      const a = pos.get(link[0]);
      const b = pos.get(link[1]);
      if (!a || !b) continue;
      a.x += (b.x - a.x) * 0.05;
      a.y += (b.y - a.y) * 0.05;
      b.x += (a.x - b.x) * 0.05;
      b.y += (a.y - b.y) * 0.05;
    }
  }
  return pos;
}
function derivedGraph(board2) {
  const nodes = [];
  const links = [];
  for (const item of board2?.items?.values?.() || []) {
    if (item.type === "card") nodes.push(item.uid);
  }
  for (const edge of board2?.edges?.values?.() || []) {
    if (edge.valid === false) continue;
    if (!edge.from || !edge.to) continue;
    links.push([edge.from, edge.to]);
  }
  return { nodes, links };
}
function commentCount(board2, uid) {
  const item = board2?.items?.get?.(uid);
  if (!item) return 0;
  let n2 = 0;
  for (const member of item.members || []) {
    const kid = board2.items.get(member);
    if (!kid) continue;
    const title = String(kid.title || "").trim();
    const text2 = `${title} ${kid.string || ""}`.trim();
    if (/^comments?$/i.test(title) && kid.members?.length) n2 += kid.members.length;
    else if (/\{\{\[\[comment\]\]\}\}|^\[\[comment\]\]|^comment::/i.test(text2)) n2 += 1;
  }
  return n2;
}
function cardTemplatePlan(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (!block || typeof block.string !== "string") continue;
    const string = block.string.trim();
    if (!string || string.startsWith("{{")) continue;
    out.push({ string: string.slice(0, 500) });
    if (out.length >= 45) break;
  }
  return out;
}
function cleanVia2(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
    out.push({ x: Math.round(Number(p.x) * 10) / 10, y: Math.round(Number(p.y) * 10) / 10 });
    if (out.length >= VIA_CAP) break;
  }
  return out;
}
function segmentHits(a, b, rect) {
  const pad2 = 8;
  const left = rect.x - pad2;
  const right = rect.x + rect.w + pad2;
  const top = rect.y - pad2;
  const bottom = rect.y + rect.h + pad2;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX < left || minX > right || maxY < top || minY > bottom) return false;
  return true;
}
function routeAround(start, end, obstacles = []) {
  const hit = (obstacles || []).filter((rect) => rect && segmentHits(start, end, rect));
  if (!hit.length) return [];
  const top = Math.min(...hit.map((rect) => rect.y)) - 28;
  return cleanVia2([{ x: start.x, y: top }, { x: end.x, y: top }]);
}
function sectionPair(uids, getItem) {
  const sections = [];
  for (const uid of uids || []) {
    if (getItem?.(uid)?.type === "section") sections.push(uid);
    if (sections.length === 2) break;
  }
  return sections.length === 2 ? sections : null;
}
function zoomThreshold(boardValue, settingValue) {
  const pick = (value) => {
    const n2 = Number(value);
    return Number.isFinite(n2) && n2 >= 0.05 && n2 <= 1.5 ? n2 : null;
  };
  return pick(boardValue) ?? pick(settingValue) ?? 0.45;
}
function thumbnailBudget(uids, { cap: cap2 = THUMBNAIL_CAP } = {}) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const limit = Math.max(0, Math.min(THUMBNAIL_CAP, cap2));
  for (const uid of uids || []) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
    if (out.length >= limit) break;
  }
  return out;
}
function timerStep(state, now2) {
  const remaining = Math.max(0, Number(state?.remainingMs) || 0);
  if (!state?.running || !state.endsAt) return { remainingMs: remaining, running: false, endsAt: null };
  const left = Math.max(0, state.endsAt - now2);
  return { remainingMs: left, running: left > 0, endsAt: left > 0 ? state.endsAt : null };
}
function presenterNote(board2, uid) {
  const item = board2?.items?.get?.(uid);
  if (!item) return "";
  for (const member of item.members || []) {
    const kid = board2.items.get(member);
    const raw = kid?.string || kid?.title || "";
    const text2 = String(raw).replace(/\s+/g, " ").trim();
    if (text2) return text2.slice(0, 240);
  }
  return "";
}
function printPages(board2) {
  const items = board2?.items;
  if (!items) return [];
  const roots = board2.roots || [];
  const sections = roots.map((uid) => items.get(uid)).filter((item) => item?.type === "section");
  const pages = sections.length ? sections : [...items.values()].filter((item) => item.type !== "edge");
  return pages.map((item) => ({ uid: item.uid, title: item.title || item.string || "Untitled" }));
}
function backgroundImage(url) {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (!s || s.length > 2e3) return null;
  if (!/^https:\/\//i.test(s)) return null;
  if (/[\s"'()<>]/.test(s)) return null;
  return s;
}
function versionPeekRequest(api) {
  if (!api || typeof api !== "object") return null;
  if (typeof api.block?.history === "function") return "block.history";
  if (typeof api.ui?.blockHistory === "function") return "ui.blockHistory";
  return null;
}

// src/model/links.js
var MAX_SOURCES = 20;
function linksQuery() {
  return `[:find ?a ?b ?su ?ss
 :in $ ?board [?a ...] [?b ...]
 :where
 [?src :block/refs ?b]
 (or [?src :block/page ?a] [?src :block/parents ?a] [(= ?src ?a)])
 [(not= ?a ?b)]
 (not [?src :block/parents ?board])
 [(not= ?src ?board)]
 [?src :block/uid ?su]
 [?src :block/string ?ss]]`;
}
function isBareAttr(s) {
  return typeof s === "string" && /^\s*[^:\n]{1,60}::\s*$/.test(s);
}
function reduceLinks(rows, { eidToItems, parentStrings = /* @__PURE__ */ new Map() } = {}) {
  const byKey = /* @__PURE__ */ new Map();
  for (const [aEid, bEid, su, ss] of rows) {
    const froms = eidToItems.get(aEid) || [];
    const tos = eidToItems.get(bEid) || [];
    if (!froms.length || !tos.length) continue;
    let label = attrNameOf(ss);
    if (label == null) {
      const ps = parentStrings.get(su);
      if (isBareAttr(ps)) label = attrNameOf(ps);
    }
    const isAttr = label != null;
    if (!isAttr) label = "mentions";
    for (const from of froms) {
      for (const to of tos) {
        if (from === to) continue;
        const key = `${from}->${to}`;
        let link = byKey.get(key);
        if (!link) {
          link = { key, from, to, kind: "ref", labels: [], sources: [], color: "gray" };
          byKey.set(key, link);
        }
        if (isAttr) link.kind = "attr";
        if (!link.labels.includes(label)) link.labels.push(label);
        if (link.sources.length < MAX_SOURCES && !link.sources.some((s) => s.uid === su)) {
          link.sources.push({ uid: su, string: ss });
        }
      }
    }
  }
  const out = [];
  for (const link of byKey.values()) {
    link.labels = [
      ...link.labels.filter((l) => l !== "mentions"),
      ...link.labels.filter((l) => l === "mentions")
    ];
    link.color = colorForLabel(link.labels[0]);
    out.push(link);
  }
  return out;
}
function filterLinks(links, mode) {
  if (mode === "off") return [];
  if (mode === "attributes") return links.filter((l) => l.kind === "attr");
  return links;
}
function coveredBy(links, board2) {
  const pairs = /* @__PURE__ */ new Map();
  for (const [uid, e] of board2.edges) {
    for (const k of [`${e.from}->${e.to}`, `${e.to}->${e.from}`]) {
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(uid);
    }
  }
  const visible = [];
  const coveredEdges = /* @__PURE__ */ new Set();
  for (const l of links) {
    const hit = pairs.get(`${l.from}->${l.to}`);
    if (hit) hit.forEach((u) => coveredEdges.add(u));
    else visible.push(l);
  }
  return { visible, coveredEdges };
}

// src/model/deeplink.js
var UID_RE2 = /^[\w-]{1,32}$/;
function isShowableCard(plexus) {
  if (!plexus || typeof plexus !== "object") return false;
  if (plexus.type === "section" || plexus.type === "edges" || plexus.type === "edge") return false;
  return Number.isFinite(Number(plexus.x)) && Number.isFinite(Number(plexus.y));
}
function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function pageUidFromHash(hash) {
  const match = /#\/app\/[^/]+\/page\/([^/?#]+)/.exec(String(hash ?? ""));
  return match ? decodePart(match[1]) : "";
}
function graphFromDeepLink(hash) {
  const match = /#\/app\/([^/?#]+)/.exec(String(hash ?? ""));
  return match ? decodePart(match[1]) : "";
}
function cardDeepLink({ graph, pageUid, cardUid } = {}) {
  const g = String(graph ?? "").trim();
  const page = String(pageUid ?? "").trim();
  const card2 = String(cardUid ?? "").trim();
  if (!g || !UID_RE2.test(page) || !UID_RE2.test(card2)) return "";
  return `#/app/${encodeURIComponent(g)}/page/${encodeURIComponent(page)}?pxd=${encodeURIComponent(card2)}`;
}
function hashFromUrl(url) {
  const text2 = String(url ?? "");
  const mark = text2.indexOf("#");
  return mark >= 0 ? text2.slice(mark) : "";
}
function pxdTarget(hash) {
  const text2 = String(hash ?? "");
  const q = text2.indexOf("?");
  if (q < 0) return null;
  let card2 = "";
  try {
    card2 = new URLSearchParams(text2.slice(q + 1).split("#")[0]).get("pxd") || "";
  } catch {
    return null;
  }
  if (!UID_RE2.test(card2)) return null;
  return { cardUid: card2, pageUid: pageUidFromHash(text2), graph: graphFromDeepLink(text2) };
}
function copyLinkText(item, { graph, pageUid, cardUid } = {}) {
  const ref = semanticRef(item);
  const url = cardDeepLink({ graph, pageUid, cardUid: cardUid || item?.uid });
  return url ? `${ref}
${url}` : ref;
}
function locateShowTarget(uid, placements) {
  const id = String(uid ?? "").trim();
  if (!id) return null;
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  for (const row2 of placements || []) {
    const boardUid = String(row2?.boardUid ?? "").trim();
    const cardUid = String(row2?.cardUid ?? "").trim();
    const pageUid = String(row2?.pageUid ?? "").trim();
    if (!boardUid || !cardUid) continue;
    const refs = Array.isArray(row2.refUids) ? row2.refUids.map((r) => String(r)) : [];
    if (cardUid !== id && !refs.includes(id)) continue;
    const key = `${boardUid}
${cardUid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ boardUid, pageUid, cardUid });
  }
  if (!hits.length) return null;
  const self = hits.filter((hit) => hit.cardUid === id);
  const pool = self.length ? self : hits;
  pool.sort((a, b) => a.boardUid.localeCompare(b.boardUid) || a.cardUid.localeCompare(b.cardUid));
  return pool[0];
}
function assignDeepLink(loc, { graph, pageUid, cardUid } = {}, onSame) {
  const link = cardDeepLink({ graph, pageUid, cardUid });
  if (!link || !loc) return "";
  if (loc.hash === link) {
    if (typeof onSame === "function") onSame();
    return link;
  }
  loc.hash = link;
  return link;
}

// src/model/info.js
var PANEL_WIDTH_MIN = 260;
var PANEL_WIDTH_MAX = 640;
var PANEL_WIDTH_DEFAULT = 340;
function nextPanelWidth(current2, delta, { min = PANEL_WIDTH_MIN, max = PANEL_WIDTH_MAX } = {}) {
  const base = Number(current2);
  const d = Number(delta);
  const start = Number.isFinite(base) ? base : PANEL_WIDTH_DEFAULT;
  const next = start + (Number.isFinite(d) ? d : 0);
  return Math.min(max, Math.max(min, Math.round(next)));
}
function infoTabList(tabs, uid, { add = false } = {}) {
  const id = String(uid || "");
  const list = (tabs || []).filter((t) => t && t.uid).map((t) => ({ uid: String(t.uid) }));
  if (!id) return { tabs: list, current: list[0]?.uid || null };
  if (list.some((t) => t.uid === id)) return { tabs: list, current: id };
  if (!add) return { tabs: list, current: list[0]?.uid || null };
  const next = list.concat([{ uid: id }]);
  return { tabs: next, current: id };
}
function closeInfoTab(tabs, current2, uid) {
  const list = (tabs || []).filter((t) => t && t.uid && t.uid !== uid);
  let cur = current2 === uid ? null : current2;
  if (!cur || !list.some((t) => t.uid === cur)) {
    const idx = (tabs || []).findIndex((t) => t && t.uid === uid);
    cur = list[idx]?.uid || list[idx - 1]?.uid || null;
  }
  return { tabs: list, current: cur };
}
function attributeRows(strings) {
  const out = [];
  for (const raw of strings || []) {
    const name = attrNameOf(raw);
    if (!name) continue;
    const text2 = String(raw);
    const cut = text2.indexOf("::");
    out.push({ name, value: cut >= 0 ? text2.slice(cut + 2).trim() : "" });
  }
  return out;
}
function tagNames(text2) {
  const out = [];
  const re = /#\[\[([^\]\n]+)\]\]|#([^\s#[\]()]+)/g;
  let match;
  const source = String(text2 ?? "");
  while (match = re.exec(source)) {
    const name = String(match[1] || match[2] || "").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
function boardsFromRows(rows, { limit = 20 } = {}) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const cap2 = Number.isFinite(limit) && limit > 0 ? limit : 20;
  for (const row2 of rows || []) {
    if (!row2?.uid || seen.has(row2.uid)) continue;
    if (row2.v != null && row2.v !== 2) continue;
    seen.add(row2.uid);
    out.push({
      uid: row2.uid,
      title: row2.title || "Untitled board",
      pageTitle: row2.pageTitle || ""
    });
    if (out.length >= cap2) break;
  }
  return out;
}

// src/model/library.js
var LIBRARY_TYPES = ["all", "page", "block", "board", "daily"];
var LIBRARY_CAP = 80;
var DAY_MS = 864e5;
var MONTHS3 = "January|February|March|April|May|June|July|August|September|October|November|December";
var DAILY_RE = new RegExp(`^(${MONTHS3}) (\\d{1,2})(st|nd|rd|th), (\\d{4})$`);
function isDailyTitle(title) {
  const m = DAILY_RE.exec(String(title ?? ""));
  if (!m) return false;
  const day = Number(m[2]);
  if (day < 1 || day > 31) return false;
  const suffix = day >= 11 && day <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return m[3] === suffix;
}
function cleanTag(raw) {
  let tag = String(raw ?? "").trim();
  if (tag.startsWith("#")) tag = tag.slice(1).trim();
  const wiki = /^\[\[([\s\S]+)\]\]$/.exec(tag);
  if (wiki) tag = wiki[1].trim();
  return tag;
}
function normalizeLibraryFilter(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const type = LIBRARY_TYPES.includes(src.type) ? src.type : "all";
  const daysN = Number(src.days);
  const days = Number.isFinite(daysN) ? Math.max(0, Math.floor(daysN)) : 0;
  return {
    type,
    tag: cleanTag(src.tag),
    days,
    orphan: src.orphan === true,
    text: String(src.text ?? "").trim()
  };
}
function libraryFilterActive(filter) {
  const f = normalizeLibraryFilter(filter);
  return Boolean(f.text || f.tag || f.days || f.orphan || f.type !== "all");
}
function librarySelective(filter) {
  const f = normalizeLibraryFilter(filter);
  if (f.text || f.tag) return true;
  return f.type === "board" || f.type === "daily";
}
function editedSince(edited, days, now2 = Date.now()) {
  const n2 = Math.max(0, Math.floor(Number(days) || 0));
  if (!n2) return true;
  const t = now2 instanceof Date ? now2.getTime() : Number(now2);
  return Number.isFinite(edited) && edited > t - n2 * DAY_MS;
}
function libraryKind(row2) {
  if (row2?.kind === "board") return "board";
  if (row2?.kind === "block") return "block";
  const title = row2?.title ?? "";
  if (row2?.kind === "daily" || isDailyTitle(title)) return "daily";
  return "page";
}
function narrowLibrary(rows, filter, now2 = Date.now()) {
  const f = normalizeLibraryFilter(filter);
  const needle = f.text.toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row2) => {
    const kind = libraryKind(row2);
    if (f.type !== "all" && kind !== f.type) return false;
    if (f.tag) {
      const tags = Array.isArray(row2?.tags) ? row2.tags : [];
      if (!tags.includes(f.tag)) return false;
    }
    if (needle) {
      const hay = [row2?.title, row2?.string, row2?.text].filter((v) => v != null).join("\n").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (f.days && !editedSince(row2?.edited, f.days, now2)) return false;
    if (f.orphan && (kind === "board" || row2?.onBoard)) return false;
    return true;
  });
}
function libraryCard(row2) {
  const kind = libraryKind(row2);
  if (kind === "page" || kind === "daily") {
    const title = String(row2?.title ?? row2?.text ?? "");
    return { string: `[[${title}]]`, text: title, kind, label: kind === "daily" ? "daily" : "page" };
  }
  const uid = String(row2?.uid ?? "");
  if (kind === "board") {
    const title = String(row2?.title || "Untitled board");
    const label2 = row2?.pageTitle ? `board · ${row2.pageTitle}` : "board";
    return { string: `((${uid}))`, text: title, kind, label: label2 };
  }
  const label = row2?.pageTitle ? `in ${row2.pageTitle}` : "block";
  return { string: `((${uid}))`, text: String(row2?.string ?? row2?.text ?? "").slice(0, 120), kind, label };
}
function recentDailyTitles(days = 14, now2 = /* @__PURE__ */ new Date()) {
  const n2 = Math.max(1, Math.min(366, Math.floor(Number(days) || 14)));
  const base = now2 instanceof Date ? now2 : new Date(now2);
  const titles = [];
  for (let i = 0; i < n2; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, 12, 0, 0, 0);
    titles.push(dailyPageTitle(d));
  }
  return titles;
}
function libraryCap() {
  return LIBRARY_CAP;
}

// src/model/neighbors.js
var NEIGHBOR_CAP = 24;
var CARD_W2 = 280;
var CARD_H2 = 160;
function pageRefString(title) {
  const s = String(title ?? "").trim();
  if (!s || s.includes("]]") || /[\n\r]/.test(s)) return null;
  return `[[${s}]]`;
}
function splitNeighbors({ outgoing = [], incoming = [], selfTitle = "", selfUid = "" } = {}) {
  const out = [];
  const attr = [];
  const counts = /* @__PURE__ */ new Map();
  const seenOut = /* @__PURE__ */ new Set();
  const seenAttr = /* @__PURE__ */ new Set();
  for (const row2 of outgoing) {
    const title = row2?.[0];
    if (typeof title !== "string" || !title) continue;
    const name = attrNameOf(row2?.[1]);
    if (name && title === name) continue;
    if (selfTitle && title === selfTitle) continue;
    if (name) {
      if (seenAttr.has(title)) continue;
      seenAttr.add(title);
      attr.push(title);
    } else if (!seenOut.has(title)) {
      seenOut.add(title);
      out.push(title);
    }
  }
  for (const row2 of incoming) {
    const uid = row2?.[0];
    const title = row2?.[2];
    if (typeof title !== "string" || !title) continue;
    if (selfUid && uid === selfUid) continue;
    if (selfTitle && title === selfTitle) continue;
    if (attrNameOf(row2?.[1])) continue;
    counts.set(title, (counts.get(title) || 0) + 1);
  }
  const inn = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([title]) => title);
  return {
    out: out.slice(0, NEIGHBOR_CAP),
    in: inn.slice(0, NEIGHBOR_CAP),
    attr: attr.slice(0, NEIGHBOR_CAP)
  };
}
function neighborLayout(rect, titles, { skip = [] } = {}) {
  if (!rect) return [];
  const skipSet = new Set(skip);
  const list = [];
  const seen = /* @__PURE__ */ new Set();
  for (const title of titles || []) {
    const string = pageRefString(title);
    if (!string || seen.has(string) || skipSet.has(String(title).trim())) continue;
    seen.add(string);
    list.push(string);
    if (list.length >= NEIGHBOR_CAP) break;
  }
  const n2 = list.length;
  if (!n2) return [];
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const radius = Math.max(rect.w, rect.h) / 2 + 240;
  return list.map((string, i) => {
    const angle = -Math.PI / 2 + (n2 === 1 ? 0 : i / n2 * Math.PI * 2);
    return {
      string,
      x: Math.round(cx + Math.cos(angle) * radius - CARD_W2 / 2),
      y: Math.round(cy + Math.sin(angle) * radius - CARD_H2 / 2)
    };
  });
}

// src/model/refs.js
var LINKED_REF_CAP = 20;
var UID_RE3 = /^[A-Za-z0-9_-]{9}$/;
function linkedRefLabel(count) {
  const n2 = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return n2 === 1 ? "1 linked reference" : `${n2} linked references`;
}
function linkedRefCard(uid) {
  const s = String(uid ?? "");
  return UID_RE3.test(s) ? `((${s}))` : null;
}

// src/host/roam.js
var BOARD_PATTERN = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
   {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
     {:block/children ...}]}]}]`;
var ciPattern = (text2) => `(?i)${String(text2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
var NATIVE_PATTERN = `[:block/props
 {:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}]`;
var DIAGRAM_RE = "^\\{\\{(\\[\\[)?diagram";
var DIAGRAM_STRING = /^\s*\{\{(?:\[\[)?diagram/i;
var SHOW_DIRECT_QUERY = `[:find ?board ?page :in $ ?uid ?pat :where
 [?block :block/uid ?uid] [?block :block/parents ?diagram] [?diagram :block/uid ?board]
 [?diagram :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?diagram :block/page ?p] [?p :block/uid ?page]]`;
var SHOW_REF_QUERY = `[:find ?board ?page ?card :in $ ?uid ?pat :where
 [?target :block/uid ?uid] [?cardblock :block/refs ?target] [?cardblock :block/uid ?card]
 [?cardblock :block/parents ?diagram] [?diagram :block/uid ?board] [?diagram :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?diagram :block/page ?p] [?p :block/uid ?page]]`;
var BOARD_META_PATTERN = "[:block/props :edit/time {:block/children [:block/props]}]";
var eidKey = (uid) => [":block/uid", uid];
var watchEntity = (uid) => `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
function sortedKids2(node2) {
  const kids = Array.isArray(node2?.[":block/children"]) ? node2[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function trimTree(node2, depth, budget) {
  const out = [];
  if (depth < 1) return out;
  for (const c of sortedKids2(node2)) {
    if (budget.left <= 0) break;
    budget.left--;
    out.push({
      uid: c[":block/uid"],
      string: c[":block/string"] ?? "",
      ...c[":block/open"] === false ? { open: false } : {},
      children: trimTree(c, depth - 1, budget)
    });
  }
  return out;
}
function graphName(hash = globalThis.location?.hash ?? "") {
  const m = /#\/app\/([^/?#]+)/.exec(hash);
  return m ? decodeURIComponent(m[1]) : "";
}
function createWriteQueue({ onBusy } = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  let waiters = [];
  return {
    run(fn) {
      pending++;
      if (pending === 1) onBusy?.(true);
      const p = tail.then(async () => {
        try {
          return await fn();
        } finally {
          pending--;
          if (pending === 0) {
            onBusy?.(false);
            const w = waiters;
            waiters = [];
            w.forEach((r) => r());
          }
        }
      });
      tail = p.then(() => {
      }, () => {
      });
      return p;
    },
    get pending() {
      return pending;
    },
    idle() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    }
  };
}
var canon = (v) => typeof v === "string" ? v : JSON.stringify(v);
function createEchoLedger({ graceMs = 800, now: now2 = Date.now } = {}) {
  const state = /* @__PURE__ */ new Map();
  const keyOf = (uid, field) => `${uid}\0${field}`;
  const get = (uid, field, create) => {
    const k = keyOf(uid, field);
    let s = state.get(k);
    if (!s && create) {
      s = { uid, field, pending: [], inflight: 0, graceUntil: 0 };
      state.set(k, s);
    }
    return s;
  };
  return {
    expect(uid, field, value) {
      const s = get(uid, field, true);
      s.pending.push(canon(value));
      s.inflight++;
    },
    settle(uid, field) {
      const s = get(uid, field, false);
      if (!s) return;
      s.inflight = Math.max(0, s.inflight - 1);
      if (s.inflight === 0) s.graceUntil = now2() + graceMs;
    },
    accept(uid, field, value) {
      const k = keyOf(uid, field);
      const s = state.get(k);
      if (!s) return true;
      const v = canon(value);
      const idle = s.inflight === 0;
      if (idle && now2() >= s.graceUntil) {
        state.delete(k);
        return true;
      }
      const idx = s.pending.lastIndexOf(v);
      if (idx >= 0 && idx === s.pending.length - 1) {
        s.pending = [];
        if (idle) s.graceUntil = now2() + graceMs;
        return false;
      }
      return false;
    },
    tracked() {
      return [...state.values()].map((s) => [s.uid, s.field]);
    },
    pendingCount(uid) {
      let n2 = 0;
      for (const s of state.values()) if (s.uid === uid) n2 += s.pending.length + s.inflight;
      return n2;
    },
    clear() {
      state.clear();
    }
  };
}
function createViewportStore({ storage = globalThis.localStorage, graph = "", now: now2 = Date.now } = {}) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const lastWrite = /* @__PURE__ */ new Map();
  const latest = /* @__PURE__ */ new Map();
  const timers = /* @__PURE__ */ new Map();
  const flush = (uid) => {
    timers.delete(uid);
    if (!latest.has(uid)) return;
    try {
      storage?.setItem(key(uid), JSON.stringify(latest.get(uid)));
    } catch {
    }
    lastWrite.set(uid, now2());
    latest.delete(uid);
  };
  return {
    get(uid) {
      try {
        const raw = storage?.getItem(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch {
        return null;
      }
    },
    set(uid, vp) {
      if (!vp) return;
      latest.set(uid, { x: vp.x, y: vp.y, zoom: vp.zoom });
      const since = now2() - (lastWrite.get(uid) ?? -Infinity);
      if (since >= 500) {
        flush(uid);
        return;
      }
      if (!timers.has(uid)) {
        const t = setTimeout(() => flush(uid), 500 - since);
        t.unref?.();
        timers.set(uid, t);
      }
    },
    flushAll() {
      for (const [uid, t] of timers) {
        clearTimeout(t);
        flush(uid);
      }
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      latest.clear();
    }
  };
}
function createHost({ api = globalThis.roamAlphaAPI, storage = globalThis.localStorage, graph } = {}) {
  const stats = { writes: 0, watches: 0, pageWatches: 0, renders: 0, items: {} };
  const data = api.data;
  const undoLog = [];
  const redoLog = [];
  const UNDO_LOG_MAX = 200;
  const MAX_GROUP_WRITES = 45;
  const UNDO_ECHO_MS = 900;
  let openGroup = null;
  let lastWriteAt = -Infinity;
  const noteWrite = () => {
    lastWriteAt = Date.now();
    redoLog.length = 0;
    if (openGroup) {
      if (openGroup.n >= MAX_GROUP_WRITES) {
        undoLog.push(openGroup);
        if (undoLog.length > UNDO_LOG_MAX) undoLog.shift();
        openGroup = { n: 0 };
      }
      openGroup.n++;
      return;
    }
    undoLog.push({ n: 1 });
    if (undoLog.length > UNDO_LOG_MAX) undoLog.shift();
  };
  const pull = (pattern, entity) => data.pull(pattern, entity);
  const gname = graph ?? graphName();
  const host = {
    api,
    stats,
    viewports: createViewportStore({ storage, graph: gname }),
    pullBoard(uid) {
      const res = pull(BOARD_PATTERN, eidKey(uid));
      return res && res[":block/uid"] ? res : null;
    },
    watchBoard(uid, cb) {
      const entity = watchEntity(uid);
      const wrapped = (before, after) => cb(after);
      data.addPullWatch(BOARD_PATTERN, entity, wrapped);
      stats.watches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        data.removePullWatch(BOARD_PATTERN, entity, wrapped);
        stats.watches--;
      };
    },
    pullNative(uid) {
      return pull(NATIVE_PATTERN, eidKey(uid)) ?? null;
    },
    pullProps(uid) {
      const res = pull("[:block/props]", eidKey(uid));
      const props = res?.[":block/props"];
      return props && typeof props === "object" ? plainKeys(props) : {};
    },
    pullTree(uid, depth = 2, limit = 12) {
      const res = pull(BOARD_PATTERN, eidKey(uid));
      return res ? trimTree(res, depth, { left: limit }) : [];
    },
    pullPage(title) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      return res && res[":block/uid"] ? res : null;
    },
    pagePreview(title, depth = 2, limit = 12) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      if (!res || !res[":block/uid"]) return { uid: null, exists: false, blocks: [] };
      return { uid: res[":block/uid"], exists: true, blocks: trimTree(res, depth, { left: limit }) };
    },
    // The whole outline of a page for a page card: every level, folded blocks flagged `open: false`.
    pageOutline(title, limit = 400) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      if (!res || !res[":block/uid"]) return { uid: null, exists: false, blocks: [] };
      return { uid: res[":block/uid"], exists: true, blocks: trimTree(res, 64, { left: limit }) };
    },
    // One pull watch on a page, for a page card on screen. The caller releases it.
    watchPage(title, cb) {
      const entity = `[:node/title ${JSON.stringify(String(title))}]`;
      const wrapped = (before, after) => cb(after);
      data.addPullWatch(BOARD_PATTERN, entity, wrapped);
      stats.pageWatches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        data.removePullWatch(BOARD_PATTERN, entity, wrapped);
        stats.pageWatches--;
      };
    },
    pageUid(title) {
      const res = pull("[:block/uid]", [":node/title", title]);
      return res?.[":block/uid"] ?? null;
    },
    // The templates page is created once. A second call returns the existing uid.
    async ensurePage(title) {
      const name = String(title ?? "").trim();
      if (!name) return null;
      const existing = host.pageUid(name);
      if (existing) return existing;
      stats.writes++;
      await data.page.create({ page: { title: name } });
      noteWrite();
      return host.pageUid(name);
    },
    // Blocks that link to the page. The card's own [[title]] counts as one.
    pageRefCount(title) {
      const name = String(title ?? "");
      if (!name) return 0;
      let rows;
      try {
        rows = host.q("[:find (count ?b) :in $ ?t :where [?p :node/title ?t] [?b :block/refs ?p]]", name);
      } catch {
        return 0;
      }
      const n2 = Array.isArray(rows) ? rows[0]?.[0] : 0;
      const count = Number(n2);
      return Number.isFinite(count) ? count : 0;
    },
    // One Roam undo step. Roam rewrites every [[old]] reference, including the card.
    // page.update takes the uid and the new title on the same page object.
    async renamePage(from, to) {
      const oldTitle = String(from ?? "").trim();
      const newTitle = String(to ?? "").trim();
      if (!oldTitle || !newTitle || oldTitle === newTitle) return false;
      const uid = host.pageUid(oldTitle);
      if (!uid) return false;
      stats.writes++;
      await data.page.update({ page: { uid, title: newTitle } });
      noteWrite();
      return true;
    },
    cardStringForUid(uid) {
      const id = String(uid ?? "").trim();
      if (!id) return null;
      let res;
      try {
        res = pull("[:block/uid :node/title]", eidKey(id));
      } catch {
        return null;
      }
      if (!res?.[":block/uid"]) return null;
      const title = res[":node/title"];
      return typeof title === "string" && title ? `[[${title}]]` : `((${id}))`;
    },
    blockString(uid) {
      const res = pull("[:block/string]", eidKey(uid));
      return typeof res?.[":block/string"] === "string" ? res[":block/string"] : null;
    },
    // Page uid that owns a block. Empty when the block is missing or is itself a page.
    blockPageUid(uid) {
      let res = null;
      try {
        res = pull("[{:block/page [:block/uid]}]", eidKey(uid));
      } catch {
        return "";
      }
      const page = res?.[":block/page"];
      const node2 = Array.isArray(page) ? page[0] : page;
      const id = node2?.[":block/uid"];
      return typeof id === "string" ? id : "";
    },
    // Page that owns a block. Empty when the block is missing or is itself a page.
    pageTitleOf(uid) {
      const res = pull("[{:block/page [:node/title]}]", eidKey(uid));
      const page = res?.[":block/page"];
      const node2 = Array.isArray(page) ? page[0] : page;
      const title = node2?.[":node/title"];
      return typeof title === "string" ? title : "";
    },
    // Bytes for a graph file. Encrypted graphs only decrypt through file.get; the URL itself taints a canvas.
    async getFile(url) {
      const get = api.file?.get;
      if (typeof get !== "function") return null;
      const src = String(url ?? "").trim();
      if (!src) return null;
      try {
        return await get.call(api.file, { url: src });
      } catch {
        return null;
      }
    },
    parentString(uid) {
      const res = pull("[{:block/_children [:block/string]}]", eidKey(uid));
      const p = res?.[":block/_children"];
      const first = Array.isArray(p) ? p[0] : p;
      return typeof first?.[":block/string"] === "string" ? first[":block/string"] : null;
    },
    resolveEid(ref) {
      const entity = ref?.uid ? eidKey(ref.uid) : ref?.title ? [":node/title", ref.title] : null;
      if (!entity) return null;
      const res = pull("[:db/id]", entity);
      return res?.[":db/id"] ?? null;
    },
    generateUid() {
      return api.util.generateUID();
    },
    async createBlock({ parentUid, order = "last", uid, string = "", props, open } = {}) {
      const id = uid ?? api.util.generateUID();
      const block = { uid: id, string };
      if (props !== void 0) block.props = plainKeys(props);
      if (open !== void 0) block.open = open;
      stats.writes++;
      await data.block.create({ location: { "parent-uid": parentUid, order }, block });
      noteWrite();
      return id;
    },
    async updateString(uid, string) {
      stats.writes++;
      await data.block.update({ block: { uid, string } });
      noteWrite();
    },
    async updateProps(uid, plexus) {
      const merged = mergePropsForWrite(host.pullProps(uid), plexus);
      stats.writes++;
      await data.block.update({ block: { uid, props: merged } });
      noteWrite();
    },
    async moveBlock(uid, parentUid, order = "last") {
      stats.writes++;
      await data.block.move({ location: { "parent-uid": parentUid, order }, block: { uid } });
      noteWrite();
    },
    async deleteBlock(uid) {
      stats.writes++;
      await data.block.delete({ block: { uid } });
      noteWrite();
    },
    async setOpen(uid, open) {
      stats.writes++;
      await data.block.update({ block: { uid, open } });
      noteWrite();
    },
    // Runs fn (a serialized write sequence) as one undo step. Groups do not nest; the write queue serializes callers.
    async group(fn) {
      if (openGroup) return fn();
      openGroup = { n: 0 };
      try {
        return await fn();
      } finally {
        const g = openGroup;
        openGroup = null;
        if (g.n) {
          undoLog.push(g);
          if (undoLog.length > UNDO_LOG_MAX) undoLog.shift();
        }
      }
    },
    // Undo/redo step over a whole recorded group; with nothing recorded (or after invalidateUndo) it is Roam's single step.
    async undo() {
      lastWriteAt = Date.now();
      const entry = undoLog.pop();
      const n2 = entry?.n ?? 1;
      let done = 0;
      try {
        for (; done < n2; done++) await data.undo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done >= n2) redoLog.push(entry);
          else {
            if (done > 0) redoLog.push({ n: done });
            undoLog.push({ n: n2 - done });
          }
        }
      }
    },
    async redo() {
      lastWriteAt = Date.now();
      const entry = redoLog.pop();
      const n2 = entry?.n ?? 1;
      let done = 0;
      try {
        for (; done < n2; done++) await data.redo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done > 0) undoLog.push(done >= n2 ? entry : { n: done });
          if (done < n2) redoLog.push({ n: n2 - done });
        }
      }
    },
    // Something else (a typed edit, another tool) touched the graph: the log no longer maps 1:1 onto Roam's stack.
    invalidateUndo() {
      if (openGroup || Date.now() - lastWriteAt < UNDO_ECHO_MS) return;
      undoLog.length = 0;
      redoLog.length = 0;
    },
    openInSidebar(uid, type = "block") {
      return api.ui.rightSidebar.addWindow({ window: { type, "block-uid": uid } });
    },
    openBlock(uid) {
      return api.ui.mainWindow.openBlock({ block: { uid } });
    },
    openPage(uid) {
      return api.ui.mainWindow.openPage({ page: { uid } });
    },
    renderString(el, string) {
      stats.renders++;
      return api.ui.components.renderString({ el, string });
    },
    renderBlock(el, uid) {
      stats.renders++;
      return api.ui.components.renderBlock({ uid, el, "open?": true });
    },
    renderPage(el, uid) {
      stats.renders++;
      return api.ui.components.renderPage({ uid, el });
    },
    unmount(el) {
      return api.ui.components.unmountNode({ el });
    },
    q(query, ...inputs) {
      return data.fast?.q ? data.fast.q(query, ...inputs) : data.q(query, ...inputs);
    },
    // Boards library: every enhanced (plexus.v === 2) board block in the graph. Read-only.
    listBoards({ limit = 200 } = {}) {
      const rows = host.q(
        `[:find ?u ?s ?pt ?pu :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt] [?p :block/uid ?pu]]`,
        DIAGRAM_RE
      ) || [];
      const out = [];
      for (const [uid, string, pageTitle, pageUid] of rows) {
        let res;
        try {
          res = pull(BOARD_META_PATTERN, eidKey(uid));
        } catch {
          continue;
        }
        const props = res?.[":block/props"];
        if (!props || typeof props !== "object" || plainKeys(props)?.plexus?.v !== 2) continue;
        const kids = Array.isArray(res[":block/children"]) ? res[":block/children"] : [];
        const count = kids.filter((k) => {
          const kp = k?.[":block/props"];
          return !(kp && typeof kp === "object" && plainKeys(kp)?.plexus?.type === "edges");
        }).length;
        const edited = res[":edit/time"];
        out.push({
          uid,
          title: parseBoardTitle(string) || "Untitled board",
          pageTitle,
          pageUid,
          count,
          edited: Number.isFinite(edited) ? edited : null
        });
      }
      out.sort((a, b) => String(a.pageTitle).localeCompare(String(b.pageTitle)) || a.title.localeCompare(b.title));
      return out.slice(0, limit);
    },
    // Card footer stats for many targets in at most four datalog queries.
    cardStats(targets, { boardUid } = {}) {
      const result = /* @__PURE__ */ new Map();
      const byEid = /* @__PURE__ */ new Map();
      for (const t of targets || []) {
        if (!t) continue;
        const ref = t.kind === "page" ? t.title ? { title: t.title } : null : t.uid ? { uid: t.uid } : null;
        if (!ref) continue;
        const key = t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`;
        if (result.has(key)) continue;
        result.set(key, { refs: 0, boards: 0, open: 0, done: 0 });
        const eid = host.resolveEid(ref);
        if (eid == null) continue;
        if (!byEid.has(eid)) byEid.set(eid, []);
        byEid.get(eid).push(key);
      }
      if (!byEid.size) return result;
      const eids = [...byEid.keys()];
      const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
      const tally = (rows, field) => {
        const seen = /* @__PURE__ */ new Map();
        for (const [t, x] of rows || []) {
          if (!seen.has(t)) seen.set(t, /* @__PURE__ */ new Set());
          seen.get(t).add(x);
        }
        for (const [t, set] of seen) for (const key of byEid.get(t) ?? []) result.get(key)[field] = set.size;
      };
      tally(host.q(
        `[:find ?t ?b :in $ [?t ...] ?board :where [?b :block/refs ?t] (not [?b :block/parents ?board]) [(not= ?b ?board)]]`,
        eids,
        boardEid
      ), "refs");
      tally(host.q(
        `[:find ?t ?d :in $ [?t ...] ?board ?pat :where [?b :block/refs ?t] [?b :block/parents ?d] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [(not= ?d ?board)]]`,
        eids,
        boardEid,
        DIAGRAM_RE
      ), "boards");
      const todoEid = host.resolveEid({ title: "TODO" });
      const doneEid = host.resolveEid({ title: "DONE" });
      const listFor = (statusEid) => host.q(
        `[:find ?t ?x :in $ [?t ...] ?status :where [?x :block/refs ?status] (or [?x :block/parents ?t] [?x :block/page ?t])]`,
        eids,
        statusEid
      );
      if (todoEid != null) tally(listFor(todoEid), "open");
      if (doneEid != null) tally(listFor(doneEid), "done");
      return result;
    },
    async uploadFile(file) {
      const upload = api.file?.upload;
      if (typeof upload !== "function") throw new Error("upload-unavailable");
      const res = await upload.call(api.file, { file });
      const raw = typeof res === "string" ? res : res?.url;
      const md = typeof raw === "string" ? /^\s*!\[[^\]]*\]\((.+)\)\s*$/s.exec(raw) : null;
      const url = md ? md[1] : raw;
      if (typeof url !== "string" || !url) throw new Error("upload-failed");
      stats.writes++;
      return url;
    },
    searchPages(text2, limit = 40) {
      const needle = String(text2 ?? "").toLowerCase();
      if (!needle) return [];
      const rows = host.q(
        `[:find ?t ?u :in $ ?pat :where [?p :node/title ?t] [(re-pattern ?pat) ?re] [(re-find ?re ?t)] [?p :block/uid ?u]]`,
        ciPattern(needle)
      ) || [];
      return rows.filter(([t]) => typeof t === "string" && !t.startsWith("roam/")).map(([t, u]) => ({ uid: u, title: t })).sort((a, b) => {
        const ap = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
        const bp = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
        return ap - bp || a.title.length - b.title.length || a.title.localeCompare(b.title);
      }).slice(0, limit);
    },
    searchBlocks(text2, limit = 40) {
      const needle = String(text2 ?? "").toLowerCase();
      if (!needle) return [];
      const rows = host.q(
        `[:find ?s ?u ?t :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
        ciPattern(needle)
      ) || [];
      return rows.filter(([, , t]) => typeof t === "string" && !t.startsWith("roam/")).slice(0, limit).map(([s, u, t]) => ({ uid: u, string: s, pageTitle: t }));
    },
    // Add-panel filters. Read-only. Each query is timed. Days and orphan never scan the graph alone.
    librarySearch(filter, limit = 40) {
      const f = normalizeLibraryFilter(filter);
      const queries = [];
      const lim = Math.max(1, Math.floor(Number(limit) || 40));
      if (!librarySelective(f)) return { rows: [], queries };
      const nowMs = Date.now();
      const since = f.days ? nowMs - f.days * 864e5 : null;
      const cap2 = libraryCap();
      const candidates = [];
      const seen = /* @__PURE__ */ new Set();
      const push = (row2) => {
        if (candidates.length >= cap2) return false;
        const key = `${row2.kind}:${row2.uid || row2.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        candidates.push(row2);
        return true;
      };
      const timed = (name, fn) => {
        const t0 = performance.now();
        let out = [];
        try {
          const res = fn();
          out = Array.isArray(res) ? res : [];
        } catch {
          out = [];
        }
        queries.push({ name, ms: performance.now() - t0 });
        return out;
      };
      const wantPage = f.type === "all" || f.type === "page";
      const wantBlock = f.type === "all" || f.type === "block";
      const wantBoard = f.type === "all" || f.type === "board";
      const wantDaily = f.type === "daily";
      const editedOf = (value) => Number.isFinite(value) ? value : null;
      if (wantPage && (f.text || f.tag) || wantDaily && f.tag) {
        const find = ["?t", "?u"];
        const inputs = ["$"];
        const where = [];
        const args = [];
        if (f.tag) {
          inputs.push("?name");
          args.push(f.tag);
          where.push("[?tag :node/title ?name]", "[?b :block/refs ?tag]", "[?b :block/page ?p]");
        }
        where.push("[?p :node/title ?t]");
        if (f.text) {
          inputs.push("?pat");
          args.push(ciPattern(f.text));
          where.push("[(re-pattern ?pat) ?re]", "[(re-find ?re ?t)]");
        }
        where.push("[?p :block/uid ?u]");
        if (since != null) {
          inputs.push("?since");
          args.push(since);
          find.push("?e");
          where.push("[?p :edit/time ?e]", "[(> ?e ?since)]");
        }
        const found = timed("pages", () => host.q(
          `[:find ${find.join(" ")} :in ${inputs.join(" ")} :where ${where.join(" ")}]`,
          ...args
        ));
        const needle = f.text.toLowerCase();
        const ranked = found.slice().sort((a, b) => {
          const at = String(a?.[0] ?? "");
          const bt = String(b?.[0] ?? "");
          const ap = needle && at.toLowerCase().startsWith(needle) ? 0 : 1;
          const bp = needle && bt.toLowerCase().startsWith(needle) ? 0 : 1;
          return ap - bp || at.length - bt.length || at.localeCompare(bt);
        });
        for (const rec of ranked) {
          const title = rec?.[0];
          const uid = rec?.[1];
          if (typeof title !== "string" || title.startsWith("roam/") || !uid) continue;
          if (!push({
            kind: "page",
            title,
            uid: String(uid),
            edited: editedOf(rec?.[2]),
            tags: f.tag ? [f.tag] : [],
            onBoard: false
          })) break;
        }
      }
      if (wantBlock && (f.text || f.tag)) {
        const find = ["?s", "?u", "?t"];
        const inputs = ["$"];
        const where = [];
        const args = [];
        if (f.tag) {
          inputs.push("?name");
          args.push(f.tag);
          where.push("[?tag :node/title ?name]", "[?b :block/refs ?tag]");
        }
        where.push("[?b :block/string ?s]");
        if (f.text) {
          inputs.push("?pat");
          args.push(ciPattern(f.text));
          where.push("[(re-pattern ?pat) ?re]", "[(re-find ?re ?s)]");
        }
        where.push("[?b :block/uid ?u]", "[?b :block/page ?p]", "[?p :node/title ?t]");
        if (since != null) {
          inputs.push("?since");
          args.push(since);
          find.push("?e");
          where.push("[?b :edit/time ?e]", "[(> ?e ?since)]");
        }
        const found = timed("blocks", () => host.q(
          `[:find ${find.join(" ")} :in ${inputs.join(" ")} :where ${where.join(" ")}]`,
          ...args
        ));
        for (const rec of found) {
          const string = rec?.[0];
          const uid = rec?.[1];
          const pageTitle = rec?.[2];
          if (typeof string !== "string" || !uid) continue;
          if (DIAGRAM_STRING.test(string)) continue;
          if (typeof pageTitle === "string" && pageTitle.startsWith("roam/")) continue;
          const edited = since != null ? editedOf(rec?.[3]) : null;
          if (!push({
            kind: "block",
            uid: String(uid),
            string,
            pageTitle: typeof pageTitle === "string" ? pageTitle : "",
            edited,
            tags: f.tag ? [f.tag] : [],
            onBoard: false
          })) break;
        }
      }
      if (wantBoard && (f.type === "board" || f.text || f.tag)) {
        let found;
        if (f.tag) {
          found = timed("boards", () => host.q(
            `[:find ?u ?s ?pt :in $ ?name ?pat :where [?tag :node/title ?name] [?child :block/refs ?tag]
 [?child :block/parents ?d] [?d :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?d :block/uid ?u] [?d :block/page ?p] [?p :node/title ?pt]]`,
            f.tag,
            DIAGRAM_RE
          ));
        } else {
          found = timed("boards", () => host.q(
            `[:find ?u ?s ?pt :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]`,
            DIAGRAM_RE
          ));
        }
        for (const rec of found) {
          if (candidates.length >= cap2) break;
          const uid = rec?.[0];
          const string = rec?.[1];
          const pageTitle = rec?.[2];
          if (!uid || typeof string !== "string") continue;
          const title = parseBoardTitle(string) || "Untitled board";
          if (f.text && !title.toLowerCase().includes(f.text.toLowerCase())) continue;
          let edited = null;
          let props = {};
          try {
            const res = pull("[:block/props :edit/time]", eidKey(uid));
            const raw = res?.[":block/props"];
            props = raw && typeof raw === "object" ? plainKeys(raw) : {};
            edited = editedOf(res?.[":edit/time"]);
          } catch {
            continue;
          }
          if (props?.plexus?.v !== 2) continue;
          push({
            kind: "board",
            uid: String(uid),
            title,
            string,
            pageTitle: typeof pageTitle === "string" ? pageTitle : "",
            edited,
            tags: f.tag ? [f.tag] : [],
            onBoard: true
          });
        }
      }
      if (wantDaily && !f.tag) {
        let titles = recentDailyTitles(f.days || 14, nowMs);
        if (f.text && isDailyTitle(f.text) && !titles.includes(f.text)) titles = titles.concat(f.text);
        if (titles.length) {
          const find = "?t ?u ?e";
          const inputs = "$ [?t ...]";
          const where = ["[?p :node/title ?t]", "[?p :block/uid ?u]", "[?p :edit/time ?e]"];
          const args = [titles];
          if (since != null) {
            where.push("[(> ?e ?since)]");
            args.push(since);
          }
          const found = timed("dailies", () => host.q(
            `[:find ${find} :in ${since != null ? `${inputs} ?since` : inputs} :where ${where.join(" ")}]`,
            ...args
          ));
          for (const rec of found) {
            const title = rec?.[0];
            const uid = rec?.[1];
            if (typeof title !== "string" || !uid) continue;
            push({
              kind: "page",
              title,
              uid: String(uid),
              edited: editedOf(rec?.[2]),
              tags: [],
              onBoard: false
            });
          }
        }
      }
      if (f.orphan) {
        const blockUids = candidates.filter((row2) => row2.kind === "block" && row2.uid).map((row2) => row2.uid);
        const pageTitles = candidates.filter((row2) => row2.kind === "page" && row2.title).map((row2) => row2.title);
        const onUid = /* @__PURE__ */ new Set();
        const onTitle = /* @__PURE__ */ new Set();
        if (blockUids.length) {
          const direct = timed("orphan-parents", () => host.q(
            `[:find ?u :in $ [?u ...] ?pat :where [?b :block/uid ?u] [?b :block/parents ?d] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)]]`,
            blockUids,
            DIAGRAM_RE
          ));
          const via = timed("orphan-refs", () => host.q(
            `[:find ?u :in $ [?u ...] ?pat :where [?b :block/uid ?u] [?card :block/refs ?b] [?card :block/parents ?d]
 [?d :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]]`,
            blockUids,
            DIAGRAM_RE
          ));
          for (const rec of [...direct, ...via]) if (rec?.[0]) onUid.add(rec[0]);
        }
        if (pageTitles.length) {
          const via = timed("orphan-pages", () => host.q(
            `[:find ?t :in $ [?t ...] ?pat :where [?p :node/title ?t] [?card :block/refs ?p] [?card :block/parents ?d]
 [?d :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]]`,
            pageTitles,
            DIAGRAM_RE
          ));
          for (const rec of via) if (rec?.[0]) onTitle.add(rec[0]);
        }
        for (const row2 of candidates) {
          if (row2.kind === "board") row2.onBoard = true;
          else if (row2.kind === "block") row2.onBoard = onUid.has(row2.uid);
          else row2.onBoard = onTitle.has(row2.title);
        }
      }
      const rows = narrowLibrary(candidates, f, nowMs).slice(0, lim).map(libraryCard);
      return { rows, queries };
    },
    // Graph neighbours of a card target, ordered for the Related panel:
    // attribute relations (both directions) → pages it links to → pages that link to it (grouped, counted).
    // The attribute-name page itself is not a neighbour, and blocks inside the current board are skipped.
    related(ref, limit = 60, { boardUid } = {}) {
      if (!ref || (ref.kind === "page" ? !ref.title : !ref.uid)) return [];
      const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
      const byPage = ref.kind === "page";
      const outgoing = host.q(
        byPage ? `[:find ?rt ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/page ?p] [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]` : `[:find ?rt ?ss :in $ ?uid :where [?s :block/uid ?uid] (or [?b :block/parents ?s] [(= ?b ?s)]) [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`,
        byPage ? ref.title : ref.uid
      ) || [];
      const incoming = host.q(
        byPage ? `[:find ?u ?ss ?pt :in $ ?title ?board :where [?p :node/title ?title] [?b :block/refs ?p] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]` : `[:find ?u ?ss ?pt :in $ ?uid ?board :where [?s :block/uid ?uid] [?b :block/refs ?s] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
        byPage ? ref.title : ref.uid,
        boardEid
      ) || [];
      const attrs = [];
      const links = [];
      const pages = /* @__PURE__ */ new Map();
      const seen = /* @__PURE__ */ new Set();
      const add = (list, relation, target, text2) => {
        const key = `${relation}|${target.kind}|${target.title ?? target.uid}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ relation, target, text: text2 });
      };
      for (const [rt, ss] of outgoing) {
        const attr = attrNameOf(ss);
        if (attr && rt === attr) continue;
        if (byPage && rt === ref.title) continue;
        if (attr) add(attrs, `${attr} →`, { kind: "page", title: rt }, rt);
        else add(links, "links to", { kind: "page", title: rt }, rt);
      }
      for (const [u, ss, pt] of incoming) {
        if (u === ref.uid || byPage && pt === ref.title) continue;
        const attr = attrNameOf(ss);
        if (attr) {
          add(attrs, `← ${attr}`, { kind: "page", title: pt }, pt);
          continue;
        }
        const g = pages.get(pt) || { count: 0 };
        g.count += 1;
        pages.set(pt, g);
      }
      const linkedFrom = [...pages.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([pt, g]) => ({ relation: "linked from", target: { kind: "page", title: pt }, text: g.count > 1 ? `${pt} (${g.count})` : pt }));
      return [...attrs, ...links, ...linkedFrom].slice(0, limit);
    },
    // Pages around a card: outgoing refs, pages that mention it, or attribute values.
    // Cards on this board are not backlinks. A throw yields nothing.
    neighborPages(item, mode, { boardUid } = {}) {
      if (!item || item.type === "section") return [];
      if (mode !== "out" && mode !== "in" && mode !== "attr") return [];
      const kind = item.target?.kind || item.kind || "self";
      if (kind === "board" || item.kind === "board") return [];
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      const blockUid2 = pageTitle ? "" : String(item.target?.uid || item.uid || "");
      if (!pageTitle && !blockUid2) return [];
      const byPage = Boolean(pageTitle);
      const outQuery = byPage ? `[:find ?rt ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/page ?p] [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]` : `[:find ?rt ?ss :in $ ?uid :where [?s :block/uid ?uid] (or [?b :block/parents ?s] [(= ?b ?s)]) [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`;
      const inQuery = byPage ? `[:find ?u ?ss ?pt :in $ ?title ?board :where [?p :node/title ?title] [?b :block/refs ?p] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]` : `[:find ?u ?ss ?pt :in $ ?uid ?board :where [?s :block/uid ?uid] [?b :block/refs ?s] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`;
      try {
        if (mode === "in") {
          const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
          const incoming = host.q(inQuery, pageTitle || blockUid2, boardEid) || [];
          return splitNeighbors({ incoming, selfTitle: pageTitle, selfUid: blockUid2 }).in;
        }
        const outgoing = host.q(outQuery, pageTitle || blockUid2) || [];
        const split = splitNeighbors({ outgoing, selfTitle: pageTitle, selfUid: blockUid2 });
        return mode === "attr" ? split.attr : split.out;
      } catch {
        return [];
      }
    },
    // Mentions of a page or block. The info panel's cardInfo also asks which boards
    // contain the card; this query does not, so a page card can list references on mount.
    linkedRefs(item, { limit = LINKED_REF_CAP } = {}) {
      if (!item || item.type === "section") return [];
      const kind = item.target?.kind || item.kind || "self";
      const cardUid = String(item.uid ?? "");
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      const targetUid = kind === "block" ? String(item.target?.uid || "") : pageTitle ? "" : cardUid;
      if (!pageTitle && !targetUid) return [];
      const cap2 = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : LINKED_REF_CAP;
      let rows = [];
      try {
        rows = host.q(
          pageTitle ? `[:find ?u ?ss ?pt :in $ ?title :where [?p :node/title ?title] [?b :block/refs ?p] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]` : `[:find ?u ?ss ?pt :in $ ?uid :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
          pageTitle || targetUid
        ) || [];
      } catch {
        return [];
      }
      const refs = [];
      const seen = /* @__PURE__ */ new Set();
      for (const row2 of rows) {
        const uid = row2?.[0];
        if (!uid || uid === cardUid || targetUid && uid === targetUid || seen.has(uid)) continue;
        seen.add(uid);
        refs.push({ uid, string: String(row2?.[1] ?? ""), pageTitle: row2?.[2] || "" });
        if (refs.length >= cap2) break;
      }
      return refs;
    },
    // Info panel. Page-card attributes come from the page's children, not the [[title]] card.
    // Two board queries: diagrams that parent the card, and diagrams that parent a block which refs the target.
    cardInfo(item, { refLimit = 20, boardLimit = 20 } = {}) {
      if (!item || item.type === "section") return null;
      const kind = item.target?.kind || "self";
      const cardUid = String(item.uid ?? "");
      const targetUid = kind === "block" ? String(item.target?.uid || cardUid) : cardUid;
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      let pageUid = null;
      let body = String(item.string ?? "");
      let attrSource = [];
      if (pageTitle) {
        const page = host.pullPage(pageTitle);
        pageUid = page?.[":block/uid"] ?? null;
        const kids = Array.isArray(page?.[":block/children"]) ? page[":block/children"] : [];
        attrSource = kids.map((k) => k?.[":block/string"] ?? "");
        body = pageTitle;
      } else if (targetUid) {
        let res = null;
        try {
          res = pull("[:block/string {:block/children [:block/string]}]", eidKey(targetUid));
        } catch {
          res = null;
        }
        if (res) {
          body = res[":block/string"] ?? body;
          const kids = Array.isArray(res[":block/children"]) ? res[":block/children"] : [];
          attrSource = kids.map((k) => k?.[":block/string"] ?? "");
        }
      }
      const parentRows = cardUid ? host.q(
        `[:find ?u ?s ?pt :in $ ?uid ?pat :where [?c :block/uid ?uid] [?c :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`,
        cardUid,
        DIAGRAM_RE
      ) || [] : [];
      const viaRows = pageTitle || targetUid ? host.q(
        pageTitle ? `[:find ?u ?s ?pt :in $ ?title ?pat :where [?t :node/title ?title] [?b :block/refs ?t] [?b :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]` : `[:find ?u ?s ?pt :in $ ?uid ?pat :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`,
        pageTitle || targetUid,
        DIAGRAM_RE
      ) || [] : [];
      const refRows = pageTitle || targetUid ? host.q(
        pageTitle ? `[:find ?u ?ss ?pt :in $ ?title :where [?p :node/title ?title] [?b :block/refs ?p] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]` : `[:find ?u ?ss ?pt :in $ ?uid :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
        pageTitle || targetUid
      ) || [] : [];
      const rawBoards = [];
      for (const [uid, string, pt] of [...parentRows, ...viaRows]) {
        if (!uid) continue;
        let props = {};
        try {
          props = host.pullProps(uid);
        } catch {
          continue;
        }
        if (props?.plexus?.v !== 2) continue;
        rawBoards.push({
          uid,
          title: parseBoardTitle(string) || "Untitled board",
          pageTitle: pt || "",
          v: 2
        });
      }
      const refs = [];
      const seenRef = /* @__PURE__ */ new Set();
      for (const [uid, string, pt] of refRows) {
        if (!uid || uid === cardUid || seenRef.has(uid)) continue;
        seenRef.add(uid);
        refs.push({ uid, string: String(string ?? "").slice(0, 160), pageTitle: pt || "" });
        if (refs.length >= refLimit) break;
      }
      return {
        kind,
        uid: pageTitle ? pageUid : targetUid,
        cardUid,
        pageUid,
        title: item.title || pageTitle || "",
        body,
        attributes: attributeRows(attrSource),
        refs,
        boards: boardsFromRows(rawBoards, { limit: boardLimit }),
        tags: tagNames([body, ...attrSource].join("\n"))
      };
    },
    // Where "Show on board" should land. Read-only. A placed card on a v2 board wins over a card that merely refs the block.
    showOnBoard(uid) {
      const id = String(uid ?? "").trim();
      if (!id) return null;
      const propsOf = (blockUid2) => {
        try {
          return host.pullProps(blockUid2);
        } catch {
          return {};
        }
      };
      let direct = [];
      let via = [];
      try {
        direct = host.q(SHOW_DIRECT_QUERY, id, DIAGRAM_RE) || [];
        via = host.q(SHOW_REF_QUERY, id, DIAGRAM_RE) || [];
      } catch {
        return null;
      }
      const boardOk = /* @__PURE__ */ new Map();
      const enhanced = (boardUid) => {
        if (!boardOk.has(boardUid)) boardOk.set(boardUid, propsOf(boardUid)?.plexus?.v === 2);
        return boardOk.get(boardUid);
      };
      const placements = [];
      for (const row2 of direct) {
        const boardUid = row2?.[0];
        const pageUid = row2?.[1];
        if (!boardUid || !pageUid || !enhanced(boardUid)) continue;
        if (!isShowableCard(propsOf(id)?.plexus)) continue;
        placements.push({ boardUid, pageUid, cardUid: id, refUids: [] });
      }
      for (const row2 of via) {
        const boardUid = row2?.[0];
        const pageUid = row2?.[1];
        const cardUid = row2?.[2];
        if (!boardUid || !pageUid || !cardUid || cardUid === id || !enhanced(boardUid)) continue;
        if (!isShowableCard(propsOf(cardUid)?.plexus)) continue;
        placements.push({ boardUid, pageUid, cardUid, refUids: [id] });
      }
      return locateShowTarget(id, placements);
    }
  };
  return host;
}

// src/host/migrate.js
var METADATA_PAGE = "plexus-diagram/metadata";
function sortedKids3(node2) {
  const kids = Array.isArray(node2?.[":block/children"]) ? node2[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
var str = (n2) => String(n2?.[":block/string"] ?? "").trim();
function pair(text2) {
  const p = String(text2).split(",").map((s) => Number(s.trim()));
  return p.length >= 2 && p.slice(0, 2).every(Number.isFinite) ? { a: p[0], b: p[1], c: p[2] } : null;
}
function prop(line, name) {
  return line.startsWith(`${name}::`) ? line.slice(name.length + 2).trim() : null;
}
var ROUTES2 = { bezier: "curve", curve: "curve", straight: "straight", step: "elbow", smoothstep: "elbow", elbow: "elbow" };
var DIRS2 = { oneWay: "one", twoWay: "two", none: "none" };
function readV06Entry(host, boardUid) {
  const page = host.pullPage(METADATA_PAGE);
  if (!page) return null;
  const root = sortedKids3(page).find((c) => str(c) === "enhanced::");
  if (!root) return null;
  const entryNode = sortedKids3(root).find((c) => str(c) === boardUid);
  if (!entryNode) return null;
  const out = { nodes: /* @__PURE__ */ new Map(), sections: [], edges: [], viewport: null, entryUid: entryNode[":block/uid"], migrated: false };
  for (const child of sortedKids3(entryNode)) {
    const line = str(child);
    const vp = prop(line, "viewport");
    if (vp !== null) {
      const p = pair(vp);
      if (p && Number.isFinite(p.c)) out.viewport = { x: p.a, y: p.b, zoom: p.c };
      continue;
    }
    if (line.startsWith("migrated::")) {
      out.migrated = true;
      continue;
    }
    if (line.startsWith("node ")) {
      const uid = line.slice(5).trim();
      const node2 = { x: void 0, y: void 0, w: void 0, h: void 0, color: void 0 };
      for (const k of sortedKids3(child)) {
        const l = str(k);
        const pos = prop(l, "pos");
        const size = prop(l, "size");
        const color = prop(l, "color");
        if (pos !== null) {
          const p = pair(pos);
          if (p) {
            node2.x = p.a;
            node2.y = p.b;
          }
        }
        if (size !== null) {
          const p = pair(size);
          if (p) {
            node2.w = p.a;
            node2.h = p.b;
          }
        }
        if (color !== null && PALETTE.includes(color)) node2.color = color;
      }
      out.nodes.set(uid, node2);
      continue;
    }
    if (line.startsWith("edge ")) {
      const m = /^(.+)->(.+)$/.exec(line.slice(5).trim());
      if (!m) continue;
      const edge = { from: m[1].trim(), to: m[2].trim(), route: "curve", label: "", fromSide: "auto", toSide: "auto", dir: "one", color: void 0 };
      for (const k of sortedKids3(child)) {
        const l = str(k);
        const kind = prop(l, "kind");
        const label = prop(l, "label");
        const from = prop(l, "from");
        const to = prop(l, "to");
        const dir = prop(l, "direction");
        const color = prop(l, "color");
        if (kind !== null) edge.route = ROUTES2[kind] ?? "curve";
        if (label !== null) edge.label = label;
        if (from !== null && SIDES2.includes(from)) edge.fromSide = from;
        if (to !== null && SIDES2.includes(to)) edge.toSide = to;
        if (dir !== null && DIRS2[dir]) edge.dir = DIRS2[dir];
        if (color !== null && PALETTE.includes(color)) edge.color = color;
      }
      out.edges.push(edge);
      continue;
    }
    if (line.startsWith("section ")) {
      const sec = { id: line.slice(8).trim(), x: void 0, y: void 0, w: void 0, h: void 0, title: "", color: void 0 };
      for (const k of sortedKids3(child)) {
        const l = str(k);
        const pos = prop(l, "pos");
        const size = prop(l, "size");
        const title = prop(l, "title");
        const color = prop(l, "color");
        if (pos !== null) {
          const p = pair(pos);
          if (p) {
            sec.x = p.a;
            sec.y = p.b;
          }
        }
        if (size !== null) {
          const p = pair(size);
          if (p) {
            sec.w = p.a;
            sec.h = p.b;
          }
        }
        if (title !== null) sec.title = title;
        if (color !== null && PALETTE.includes(color)) sec.color = color;
      }
      out.sections.push(sec);
    }
  }
  return out;
}
function parseData(raw) {
  if (typeof raw === "string") {
    try {
      return plainKeys(JSON.parse(raw)) ?? {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? plainKeys(raw) : {};
}
var finite = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
var asMap = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var NATIVE_STYLE = {
  block: {
    "block-font-size": "fontSize",
    "block-text-color": "textColor",
    "block-text-align": "align",
    "block-fill-color": "fill",
    "block-border-color": "border"
  },
  group: {
    "group-title-font-size": "titleSize",
    "group-title-text-color": "titleColor",
    "group-title-fill-color": "titleFill",
    "group-area-fill-color": "areaFill",
    "group-border-color": "border"
  },
  edge: {
    "edge-direction-type": "dir",
    "edge-decoration": "dash",
    "edge-type": "route",
    "edge-stroke-color": "color"
  },
  board: {
    "diagram-background-color": "bgColor",
    "diagram-background-texture": "bg"
  }
};
var NATIVE_DIR = { directed: "one", undirected: "none", bidirected: "two" };
var NATIVE_DASH = { solid: "solid", dashed: "dashed", animated: "animated" };
var NATIVE_ROUTE = {
  "floating-straight": "straight",
  straight: "straight",
  "floating-smooth-step": "elbow",
  smoothstep: "elbow",
  step: "elbow",
  "floating-bezier": "curve",
  bezier: "curve",
  default: "curve"
};
var NATIVE_ALIGN = { left: "left", center: "center", right: "right", justify: "justify" };
var CSS_NAMED = { black: "#000000", white: "#ffffff" };
function nativeColor(value) {
  if (typeof value !== "string") return void 0;
  const s = value.trim().toLowerCase();
  if (CSS_NAMED[s]) return CSS_NAMED[s];
  if (PALETTE.includes(s)) return s;
  let hex = s;
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  else if (/^#[0-9a-f]{8}$/.test(hex)) hex = hex.slice(0, 7);
  if (/^#[0-9a-f]{6}$/.test(hex)) return styleColor(hex);
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (!rgb) return void 0;
  const ch = (n2) => Math.max(0, Math.min(255, Number(n2))).toString(16).padStart(2, "0");
  return styleColor(`#${ch(rgb[1])}${ch(rgb[2])}${ch(rgb[3])}`);
}
function styleBags(data) {
  const top = asMap(data);
  const inner = asMap(top.data);
  return { top, inner, inferred: asMap(inner["inferred-defaults"]) };
}
function pickStyle(bags, defaults, key) {
  if (bags.inner[key] !== void 0) return bags.inner[key];
  if (bags.top[key] !== void 0) return bags.top[key];
  if (bags.inferred[key] !== void 0) return bags.inferred[key];
  if (defaults && defaults[key] !== void 0) return defaults[key];
  return void 0;
}
function mapNodeStyle(data, kind, defaults) {
  const bags = styleBags(data);
  const spec = kind === "group" ? NATIVE_STYLE.group : NATIVE_STYLE.block;
  const out = {};
  for (const [from, to] of Object.entries(spec)) {
    const raw = pickStyle(bags, defaults, from);
    if (raw === void 0) continue;
    if (to === "fontSize" || to === "titleSize") {
      const n2 = Math.round(Number(raw));
      if (!Number.isFinite(n2)) continue;
      out[to] = Math.max(CARD_FONT_MIN, Math.min(CARD_FONT_MAX, n2));
    } else if (to === "align") {
      if (NATIVE_ALIGN[raw]) out.align = NATIVE_ALIGN[raw];
    } else {
      const color = nativeColor(raw);
      if (color) out[to] = color;
    }
  }
  return out;
}
function mapEdgeStyle(data) {
  const bags = styleBags(data);
  const pick = (key) => bags.inner[key] !== void 0 ? bags.inner[key] : bags.top[key];
  const out = { dir: "one", dash: "solid", route: "straight" };
  const dir = NATIVE_DIR[pick("edge-direction-type")];
  if (dir) out.dir = dir;
  const dash = NATIVE_DASH[pick("edge-decoration")];
  if (dash) out.dash = dash;
  else if (bags.top.animated === true || bags.inner.animated === true) out.dash = "animated";
  else if (bags.top.style?.strokeDasharray || bags.inner.style?.strokeDasharray) out.dash = "dashed";
  out.route = NATIVE_ROUTE[pick("edge-type")] ?? NATIVE_ROUTE[bags.top.type] ?? "straight";
  const color = nativeColor(pick("edge-stroke-color")) ?? nativeColor(bags.inner.style?.stroke) ?? nativeColor(bags.top.style?.stroke);
  if (color) out.color = color;
  return out;
}
function readDiagramStyle(pulled) {
  const props = plainKeys(pulled?.[":block/props"]);
  const rf = asMap(props?.["rf-diagram"]);
  const bag = { ...rf, ...asMap(rf["diagram-property-data"]) };
  const boardStyle = {};
  if (BOARD_PATTERNS.includes(bag["diagram-background-texture"])) boardStyle.bg = bag["diagram-background-texture"];
  const bg = nativeColor(bag["diagram-background-color"]);
  if (bg) boardStyle.bgColor = bg;
  const over = asMap(rf["overridden-data-defaults"]);
  return { boardStyle, blockDefaults: asMap(over.block), groupDefaults: asMap(over.group) };
}
function readNative(host, boardUid) {
  const pulled = host.pullNative(boardUid);
  const rawNodes = Array.isArray(pulled?.[":diagram/nodes"]) ? pulled[":diagram/nodes"] : [];
  const rawEdges = Array.isArray(pulled?.[":diagram/edges"]) ? pulled[":diagram/edges"] : [];
  const { boardStyle, blockDefaults, groupDefaults } = readDiagramStyle(pulled);
  const keyById = /* @__PURE__ */ new Map();
  const nodes = rawNodes.map((n2) => {
    const id = n2[":db/id"];
    const blockUid2 = n2[":diagram.node/block"]?.[":block/uid"] ?? null;
    const key = blockUid2 ?? `n${id}`;
    keyById.set(id, key);
    const data = parseData(n2[":diagram.node/data"]);
    const abs = data.positionAbsolute && finite(data.positionAbsolute.x) !== void 0 ? data.positionAbsolute : null;
    const pos = abs ?? data.position ?? {};
    const type = data.type === "group" ? "group" : "node";
    return {
      key,
      blockUid: blockUid2,
      x: finite(pos.x) ?? 0,
      y: finite(pos.y) ?? 0,
      w: finite(data.width) ?? finite(data.measured?.width),
      h: finite(data.height) ?? finite(data.measured?.height),
      absolute: Boolean(abs),
      parentId: n2[":diagram.node/parent-node"]?.[":db/id"],
      type,
      title: n2[":diagram.node/block"]?.[":block/string"] ?? "",
      style: mapNodeStyle(data, type, type === "group" ? groupDefaults : blockDefaults)
    };
  });
  for (const n2 of nodes) {
    n2.parentNode = n2.parentId != null ? keyById.get(n2.parentId) : void 0;
    delete n2.parentId;
  }
  const edges = [];
  for (const e of rawEdges) {
    const from = keyById.get(e[":diagram.edge/source"]?.[":db/id"]);
    const to = keyById.get(e[":diagram.edge/target"]?.[":db/id"]);
    if (!from || !to) continue;
    const data = parseData(e[":diagram.edge/data"]);
    const style = mapEdgeStyle(data);
    edges.push({ from, to, label: typeof data.label === "string" ? data.label : typeof data.data?.label === "string" ? data.data.label : "", ...style });
  }
  return { nodes, edges, boardStyle };
}
var round12 = (n2) => Math.round(n2 * 10) / 10;
var centerOf2 = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
var inside = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
function defaultGen() {
  let n2 = 0;
  return () => `imp${String(++n2).padStart(6, "0")}`;
}
function refOf(board2, uid, sectionUids) {
  const item = board2.items.get(uid);
  if (item && !sectionUids.has(uid)) return semanticRef(item);
  return `((${uid}))`;
}
function edgePlan(board2, sectionUids, from, to, label, extra = {}) {
  const dir = extra.dir ?? "one";
  return {
    from,
    to,
    label,
    string: edgeString({ srcRef: refOf(board2, from, sectionUids), dstRef: refOf(board2, to, sectionUids), dir, label }),
    props: serializeEdge({ from, to, dir, ...extra, type: void 0 })
  };
}
function planV06(board2, source, gen) {
  const plan = { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: source.viewport ?? null, markMigratedUid: source.entryUid ?? null };
  const secs = source.sections.map((s) => {
    const uid = gen();
    const w = s.w ?? DEFAULT_SIZES.section.w;
    const h = s.h ?? DEFAULT_SIZES.section.h;
    const abs = { x: s.x ?? 0, y: s.y ?? 0, w, h };
    return {
      uid,
      abs,
      entry: { uid, title: s.title || "Section", layout: { type: "section", x: abs.x, y: abs.y, w, h, color: s.color }, members: [], parent: null }
    };
  });
  plan.sections = secs.map((s) => s.entry);
  const sectionUids = new Set(plan.sections.map((s) => s.uid));
  for (const [uid, node2] of source.nodes) {
    const item = board2.items.get(uid);
    if (!item || item.type === "section") continue;
    const abs = {
      x: node2.x ?? item.x,
      y: node2.y ?? item.y,
      w: node2.w ?? item.w,
      h: node2.h ?? item.h
    };
    const c = centerOf2(abs);
    let best = null;
    for (const s of secs) {
      if (!inside(s.abs, c)) continue;
      if (!best || s.abs.w * s.abs.h < best.abs.w * best.abs.h) best = s;
    }
    const layout = { type: item.type, w: abs.w, h: abs.h, color: node2.color };
    if (best) {
      best.entry.members.push(uid);
      plan.memberLayouts.push({ uid, layout: { ...layout, x: round12(abs.x - best.abs.x), y: round12(abs.y - best.abs.y) } });
    } else {
      plan.itemLayouts.push({ uid, layout: { ...layout, x: abs.x, y: abs.y } });
    }
  }
  for (const e of source.edges) {
    if (!board2.items.has(e.from) || !board2.items.has(e.to) || e.from === e.to) continue;
    plan.edges.push(edgePlan(board2, sectionUids, e.from, e.to, e.label ?? "", {
      fromSide: e.fromSide,
      toSide: e.toSide,
      dir: e.dir,
      route: e.route,
      color: e.color
    }));
  }
  return plan;
}
function planNative(board2, source, gen) {
  const plan = { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  const nodes = source.nodes;
  const byKey = new Map(nodes.map((n2) => [n2.key, n2]));
  const widths = nodes.filter((n2) => n2.type !== "group").map((n2) => n2.w).filter((w) => w > 0).sort((a, b) => a - b);
  const typical = widths.length ? widths[Math.floor(widths.length / 2)] : 165;
  const scale = Math.max(1, 240 / typical);
  const absCache = /* @__PURE__ */ new Map();
  const absOf = (n2, seen = /* @__PURE__ */ new Set()) => {
    if (absCache.has(n2.key)) return absCache.get(n2.key);
    let p = { x: n2.x, y: n2.y };
    if (!n2.absolute && n2.parentNode && !seen.has(n2.key)) {
      const parent = byKey.get(n2.parentNode);
      if (parent) {
        seen.add(n2.key);
        const pa = absOf(parent, seen);
        p = { x: pa.x + n2.x, y: pa.y + n2.y };
      }
    }
    absCache.set(n2.key, p);
    return p;
  };
  const sectionOf = /* @__PURE__ */ new Map();
  const groups = nodes.filter((n2) => n2.type === "group");
  for (const g of groups) {
    const existing = g.blockUid && board2.items.has(g.blockUid);
    const uid = existing ? g.blockUid : gen();
    const a = absOf(g);
    const abs = {
      x: a.x * scale,
      y: a.y * scale,
      w: (g.w ?? DEFAULT_SIZES.section.w / scale) * scale,
      h: (g.h ?? DEFAULT_SIZES.section.h / scale) * scale
    };
    sectionOf.set(g.key, {
      uid,
      abs,
      entry: { uid, title: g.title || board2.items.get(uid)?.title || "Section", layout: null, members: [], parent: null, existing: Boolean(existing) }
    });
  }
  for (const g of groups) {
    const s = sectionOf.get(g.key);
    const parent = g.parentNode ? sectionOf.get(g.parentNode) : null;
    const base = parent ? { x: parent.abs.x, y: parent.abs.y } : { x: 0, y: 0 };
    s.entry.parent = parent ? parent.uid : null;
    s.entry.layout = {
      type: "section",
      x: round12(s.abs.x - base.x),
      y: round12(s.abs.y - base.y),
      w: round12(s.abs.w),
      h: round12(s.abs.h),
      ...g.style || {}
    };
    plan.sections.push(s.entry);
  }
  const sectionUids = new Set(plan.sections.map((s) => s.uid));
  const uidOfKey = /* @__PURE__ */ new Map();
  for (const g of groups) uidOfKey.set(g.key, sectionOf.get(g.key).uid);
  for (const n2 of nodes) {
    if (n2.type === "group") continue;
    const item = n2.blockUid ? board2.items.get(n2.blockUid) : null;
    if (!item || item.type === "section") continue;
    uidOfKey.set(n2.key, item.uid);
    const a = absOf(n2);
    const abs = { x: a.x * scale, y: a.y * scale };
    const layout = {
      type: item.type,
      w: Math.max(MIN_SIZES.card.w, Math.round((n2.w ?? item.w / scale) * scale)),
      h: Math.max(MIN_SIZES.card.h, Math.round((n2.h ?? item.h / scale) * scale)),
      ...n2.style || {}
    };
    const sec = n2.parentNode ? sectionOf.get(n2.parentNode) : null;
    if (sec) {
      sec.entry.members.push(item.uid);
      plan.memberLayouts.push({ uid: item.uid, layout: { ...layout, x: round12(abs.x - sec.abs.x), y: round12(abs.y - sec.abs.y) } });
    } else {
      plan.itemLayouts.push({ uid: item.uid, layout: { ...layout, x: round12(abs.x), y: round12(abs.y) } });
    }
  }
  for (const e of source.edges) {
    const from = uidOfKey.get(e.from);
    const to = uidOfKey.get(e.to);
    if (!from || !to || from === to) continue;
    plan.edges.push(edgePlan(board2, sectionUids, from, to, e.label ?? "", {
      dir: e.dir,
      route: e.route,
      dash: e.dash,
      color: e.color
    }));
  }
  if (source.boardStyle && Object.keys(source.boardStyle).length) plan.boardStyle = source.boardStyle;
  return plan;
}
function planImport(board2, source, { gen = defaultGen() } = {}) {
  if (!source) return { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  return source.nodes instanceof Map ? planV06(board2, source, gen) : planNative(board2, source, gen);
}
async function executeImport(plan, host, board2) {
  const counts = { sections: 0, members: 0, items: 0, edges: 0 };
  const layoutProps = (layout) => serializeItemLayout(layout);
  const keepMarker = (uid, layout) => {
    const cur = readPlexus(host.pullProps?.(uid));
    return layoutProps(cur ? { ...layout, v: cur.v, bg: cur.bg } : layout);
  };
  for (const s of plan.sections) {
    if (s.existing) await host.updateProps(s.uid, keepMarker(s.uid, { ...s.layout, type: "section" }));
    else {
      await host.createBlock({
        parentUid: board2.uid,
        order: "last",
        uid: s.uid,
        string: s.title,
        props: { plexus: layoutProps({ ...s.layout, type: "section" }) }
      });
    }
    counts.sections++;
  }
  for (const s of plan.sections) {
    if (s.parent) await host.moveBlock(s.uid, s.parent, "last");
  }
  const memberLayouts = new Map(plan.memberLayouts.map((m) => [m.uid, m.layout]));
  for (const s of plan.sections) {
    for (const uid of s.members) {
      await host.moveBlock(uid, s.uid, "last");
      const layout = memberLayouts.get(uid);
      if (layout) await host.updateProps(uid, keepMarker(uid, layout));
      counts.members++;
    }
  }
  for (const { uid, layout } of plan.itemLayouts) {
    await host.updateProps(uid, keepMarker(uid, layout));
    counts.items++;
  }
  if (plan.edges.length) {
    let containerUid = board2.containerUid;
    if (!containerUid) {
      containerUid = await host.createBlock({
        parentUid: board2.uid,
        order: "last",
        string: "Connections",
        props: { plexus: { type: "edges" } },
        open: false
      });
    }
    for (const e of plan.edges) {
      await host.createBlock({ parentUid: containerUid, order: "last", string: e.string, props: { plexus: e.props } });
      counts.edges++;
    }
  }
  if (plan.markMigratedUid) {
    await host.createBlock({ parentUid: plan.markMigratedUid, order: "last", string: "migrated:: 2" });
  }
  if (plan.viewport) {
    host.viewports?.set(board2.uid, plan.viewport);
    host.viewports?.flushAll?.();
  }
  const markerBase = { ...board2.plexus || {} };
  if (plan.boardStyle && Object.keys(plan.boardStyle).length) Object.assign(markerBase, plan.boardStyle);
  await host.updateProps(board2.uid, withBoardMarker(markerBase, true));
  return counts;
}

// src/session.js
var UID = ":block/uid";
var STR = ":block/string";
var ORD = ":block/order";
var KIDS = ":block/children";
var PROPS = ":block/props";
var OPEN = ":block/open";
var LINK_MODES = ["off", "attributes", "all"];
var ITEM_KEYS = ["type", "x", "y", "w", "h", "color", "collapsed", "fontSize", "pinned", "kids", "fit", "look", "axis", "textColor", "align", "fill", "border", "titleSize", "titleColor", "titleFill", "areaFill", "shape"];
var EDGE_KEYS = ["type", "from", "to", "fromSide", "toSide", "dir", "route", "dash", "weight", "color", "fromBlock", "toBlock", "via"];
var MAX_PARENT_STRINGS = 200;
var DAILY_GAP = 20;
var registry = /* @__PURE__ */ new Map();
var extensions = [];
var BULK_CARD_CAP = 45;
function capBulk(list, emit2) {
  if (list.length <= BULK_CARD_CAP) return list;
  emit2("toast", { message: `Added ${BULK_CARD_CAP} of ${list.length} (Roam undo holds 50 changes)` });
  return list.slice(0, BULK_CARD_CAP);
}
function extendSession(fn) {
  if (typeof fn !== "function") return () => {
  };
  extensions.push(fn);
  return () => {
    const at = extensions.indexOf(fn);
    if (at >= 0) extensions.splice(at, 1);
  };
}
var clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
var round13 = (n2) => Math.round(n2 * 10) / 10;
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== void 0) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
var stable = (v) => v == null ? "null" : JSON.stringify(sortKeys(v));
function kidsOf(node2) {
  const kids = Array.isArray(node2?.[KIDS]) ? node2[KIDS] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[ORD] ?? a.i) - (b.c[ORD] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function indexTree(root) {
  const map = /* @__PURE__ */ new Map();
  const walk = (node2, parent) => {
    map.set(node2[UID], { node: node2, parent });
    for (const c of node2[KIDS] ?? []) walk(c, node2);
  };
  if (root) walk(root, null);
  return map;
}
function detach(idx, uid) {
  const hit = idx.get(uid);
  if (!hit?.parent) return null;
  const kids = hit.parent[KIDS] ?? [];
  const at = kids.indexOf(hit.node);
  if (at >= 0) kids.splice(at, 1);
  return hit;
}
function attach(parentNode, node2, order) {
  const kids = kidsOf(parentNode);
  if (order === "last" || typeof order !== "number") kids.push(node2);
  else kids.splice(Math.max(0, Math.min(order, kids.length)), 0, node2);
  kids.forEach((k, i) => {
    k[ORD] = i;
  });
  parentNode[KIDS] = kids;
}
function unknownKeys(plexus, known) {
  const out = {};
  for (const [k, v] of Object.entries(plexus ?? {})) if (!known.includes(k)) out[k] = v;
  return out;
}
function createSession(uid, { host, settings = null, raf: raf2, now: now2 = Date.now, idle, linkDelay = 1500, graceMs = 800 } = {}) {
  const schedule = raf2 ?? ((fn) => {
    if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(fn);
    const t = setTimeout(fn, 0);
    t.unref?.();
    return t;
  });
  const runIdle = idle ?? ((fn) => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(fn, { timeout: 2e3 });
    else fn();
  });
  const listeners2 = /* @__PURE__ */ new Map();
  const emit2 = (name, payload) => {
    for (const fn of [...listeners2.get(name) ?? []]) {
      try {
        fn(payload);
      } catch (err) {
        console.error("[plexus session]", err);
      }
    }
  };
  let busy = false;
  const queue = createWriteQueue({ onBusy: (b) => {
    busy = b;
    emit2("busy", b);
  } });
  const WRITE_ATTEMPTS = 4;
  let syncState = "idle";
  const setSyncState = (state) => {
    if (syncState === state) return;
    syncState = state;
    emit2("sync", state);
  };
  const ledger = createEchoLedger({ graceMs, now: now2 });
  let destroyed = false;
  let raw = clone(host.pullBoard(uid));
  let board2 = null;
  let rects = /* @__PURE__ */ new Map();
  let emitted = null;
  let rix = null;
  const ix = () => rix ?? (rix = indexTree(raw));
  const rebuild = () => {
    rix = null;
    board2 = raw ? buildBoard(raw) : null;
    rects = board2 ? worldRects(board2) : /* @__PURE__ */ new Map();
  };
  rebuild();
  emitted = board2;
  let allLinks = [];
  let visibleLinks = [];
  let covered = /* @__PURE__ */ new Set();
  let linkFingerprint = "";
  const initialMode = typeof settings?.get === "function" ? settings.get("graph-links") : settings?.["graph-links"];
  let linkMode = LINK_MODES.includes(initialMode) ? initialMode : "all";
  const setting = (name, fallback) => {
    const v = typeof settings?.get === "function" ? settings.get(name) : settings?.[name];
    return v == null || v === "" ? fallback : v;
  };
  const flag = (name, fallback) => {
    const v = setting(name, fallback);
    return v === true || v === "true" ? true : v === false || v === "false" ? false : fallback;
  };
  const sizeSetting = (name, fallback) => {
    const n2 = Number(setting(name, fallback));
    return Number.isFinite(n2) && n2 >= 40 ? n2 : fallback;
  };
  const collapseOutline = () => (typeof settings?.get === "function" ? settings.get("collapse-outline") : settings?.["collapse-outline"]) !== false;
  const rawNode = (id) => id === uid ? raw : ix().get(id)?.node ?? null;
  const insertOrder = (parentUid) => {
    const node2 = raw ? rawNode(parentUid) : null;
    if (!node2) return "last";
    const at = kidsOf(node2).findIndex((k) => readPlexus(k[PROPS])?.type === "edges");
    return at >= 0 ? at : "last";
  };
  const rawInsert = (parentUid, node2, order) => {
    const parent = rawNode(parentUid);
    if (!parent) return;
    attach(parent, node2, order);
    rix = null;
  };
  const rawMove = (id, parentUid, order) => {
    const hit = ix().get(id);
    if (!hit?.parent) return;
    detach(ix(), id);
    rix = null;
    const parent = rawNode(parentUid);
    if (parent) attach(parent, hit.node, order);
    rix = null;
  };
  const rawDelete = (id) => {
    detach(ix(), id);
    rix = null;
  };
  const rawProps = (id, plexus) => {
    const node2 = rawNode(id);
    if (node2) node2[PROPS] = mergePropsForWrite(node2[PROPS], plexus);
  };
  const rawString = (id, string) => {
    const node2 = rawNode(id);
    if (node2) node2[STR] = string;
  };
  const publish = () => {
    rebuild();
    if (!board2) return null;
    const diff = diffBoards(emitted, board2);
    emitted = board2;
    if (diff.structural || diff.dirty.size) emit2("change", diff);
    recomputeLinks(false);
    if (diff.structural) refreshLinks();
    return diff;
  };
  let gone = false;
  const markGone = () => {
    if (gone || destroyed) return;
    gone = true;
    emit2("gone", { uid });
  };
  const repull = () => {
    if (destroyed) return;
    const fresh = host.pullBoard(uid);
    if (!fresh) {
      markGone();
      return;
    }
    raw = clone(fresh);
    publish();
  };
  function rebase(incoming) {
    const tracked = ledger.tracked();
    if (!tracked.length) return incoming;
    const ours = ix();
    const inc = indexTree(incoming);
    const incUid = incoming[UID];
    for (const [id, field] of tracked) {
      if (field === "parent") {
        const mine = ours.get(id);
        const theirs = inc.get(id);
        const myParent = mine?.parent?.[UID] ?? "";
        const theirParent = theirs?.parent?.[UID] ?? "";
        if (ledger.accept(id, "parent", theirParent)) continue;
        if (myParent === theirParent) continue;
        if (!mine) {
          detach(inc, id);
          inc.delete(id);
        } else if (!theirs) {
          const target = myParent === incUid ? incoming : inc.get(myParent)?.node;
          if (!target) continue;
          const node2 = { ...mine.node, [KIDS]: [] };
          target[KIDS] = [...target[KIDS] ?? [], node2];
          inc.set(id, { node: node2, parent: target });
        } else {
          const target = myParent === incUid ? incoming : inc.get(myParent)?.node;
          if (!target) continue;
          detach(inc, id);
          theirs.node[ORD] = mine.node[ORD];
          target[KIDS] = [...target[KIDS] ?? [], theirs.node];
          inc.set(id, { node: theirs.node, parent: target });
        }
      } else if (field === "props") {
        const theirs = inc.get(id);
        const mine = ours.get(id);
        if (!theirs) continue;
        const theirPlexus = readPlexus(theirs.node[PROPS]);
        if (ledger.accept(id, "props", stable(theirPlexus))) continue;
        if (!mine) continue;
        const myPlexus = readPlexus(mine.node[PROPS]);
        theirs.node[PROPS] = mergePropsForWrite(theirs.node[PROPS], myPlexus);
      } else if (field === "string") {
        const theirs = inc.get(id);
        const mine = ours.get(id);
        if (!theirs) continue;
        if (ledger.accept(id, "string", theirs.node[STR] ?? "")) continue;
        if (mine) theirs.node[STR] = mine.node[STR] ?? "";
      }
    }
    return incoming;
  }
  let latest = null;
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (destroyed || !latest) return;
    const incoming = clone(latest);
    latest = null;
    raw = rebase(incoming);
    const diff = publish();
    if (diff && (diff.structural || diff.dirty.size) && !queue.pending) host.invalidateUndo?.();
  };
  const unwatch = raw ? host.watchBoard(uid, (after) => {
    if (destroyed) return;
    if (!after || !after[UID]) {
      if (!host.pullBoard(uid)) markGone();
      return;
    }
    latest = after;
    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  }) : () => {
  };
  const fieldsOf = (op) => {
    if (op.op === "create") {
      const out = [["parent", op.parent]];
      if (op.props?.plexus !== void 0) out.push(["props", stable(op.props.plexus)]);
      return out;
    }
    if (op.op === "move") return [["parent", op.parent]];
    if (op.op === "delete") return [["parent", ""]];
    if (op.op === "props") return [["props", stable(op.plexus)]];
    if (op.op === "string") return [["string", op.string]];
    return [];
  };
  const settleOp = (op) => {
    for (const [f] of fieldsOf(op)) ledger.settle(op.uid, f);
  };
  async function runOp(op) {
    switch (op.op) {
      case "create":
        await host.createBlock({ parentUid: op.parent, order: op.order, uid: op.uid, string: op.string, props: op.props, open: op.open });
        break;
      case "move":
        await host.moveBlock(op.uid, op.parent, op.order);
        break;
      case "delete":
        await host.deleteBlock(op.uid);
        break;
      case "props":
        await host.updateProps(op.uid, op.plexus);
        break;
      case "string":
        await host.updateString(op.uid, op.string);
        break;
      default:
        break;
    }
  }
  async function runOpWithRetry(op) {
    let last = null;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      setSyncState(attempt === 0 ? "writing" : "retrying");
      try {
        await runOp(op);
        return;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }
  async function execute(list) {
    let i = 0;
    try {
      for (; i < list.length; i++) {
        await runOpWithRetry(list[i]);
        settleOp(list[i]);
      }
      if (list.length) setSyncState("idle");
    } catch (err) {
      for (let j = i; j < list.length; j++) settleOp(list[j]);
      throw err;
    }
  }
  function coalesce(ops) {
    const out = [];
    const creates = /* @__PURE__ */ new Map();
    const props = /* @__PURE__ */ new Map();
    const strings = /* @__PURE__ */ new Map();
    for (const op of ops) {
      if (op.op === "create") {
        out.push(op);
        creates.set(op.uid, op);
        continue;
      }
      if (op.op === "props") {
        const c = creates.get(op.uid);
        if (c) {
          c.props = mergePropsForWrite(c.props, op.plexus);
          continue;
        }
        const prev = props.get(op.uid);
        if (prev) {
          prev.plexus = op.plexus;
          continue;
        }
        const next = { ...op };
        props.set(op.uid, next);
        out.push(next);
        continue;
      }
      if (op.op === "string") {
        const c = creates.get(op.uid);
        if (c) {
          c.string = op.string;
          continue;
        }
        const prev = strings.get(op.uid);
        if (prev) {
          prev.string = op.string;
          continue;
        }
        const next = { ...op };
        strings.set(op.uid, next);
        out.push(next);
        continue;
      }
      out.push(op);
    }
    return out;
  }
  function handleFailure(err) {
    console.error("[plexus session] write failed", err);
    ledger.clear();
    setSyncState("failed");
    emit2("toast", { message: "Couldn't save changes to Roam. Reloaded the board from the graph." });
    repull();
  }
  const grouped = (fn) => host.group ? host.group(fn) : fn();
  function commit(ops, result) {
    if (!ops.length) return Promise.resolve(result);
    const list = coalesce(ops);
    for (const op of list) for (const [f, v] of fieldsOf(op)) ledger.expect(op.uid, f, v);
    publish();
    return queue.run(() => grouped(() => execute(list))).then(() => result, (err) => {
      handleFailure(err);
      return result;
    });
  }
  function txn(fn) {
    if (!board2 || destroyed || gone) return Promise.resolve(void 0);
    const ops = [];
    const t = {
      create({ parent, uid: id, string = "", plexus, open, order }) {
        const newUid = id ?? host.generateUid();
        const ord = order ?? insertOrder(parent);
        const node2 = { [UID]: newUid, [STR]: string, [ORD]: 0, [KIDS]: [] };
        if (plexus) node2[PROPS] = { plexus: plainKeys(plexus) };
        if (open !== void 0) node2[OPEN] = open;
        rawInsert(parent, node2, ord);
        ops.push({ op: "create", uid: newUid, parent, order: ord, string, props: plexus ? { plexus } : void 0, open });
        return newUid;
      },
      move(id, parent, order = "last") {
        rawMove(id, parent, order);
        ops.push({ op: "move", uid: id, parent, order });
      },
      del(id) {
        rawDelete(id);
        ops.push({ op: "delete", uid: id });
      },
      props(id, plexus) {
        rawProps(id, plexus);
        ops.push({ op: "props", uid: id, plexus });
      },
      string(id, string) {
        rawString(id, string);
        ops.push({ op: "string", uid: id, string });
      },
      sync: rebuild
    };
    const result = fn(t);
    return commit(ops, result);
  }
  const rawPlexus = (id) => readPlexus(rawNode(id)?.[PROPS]) ?? {};
  function hasStoredLayout() {
    for (const item of board2.items.values()) {
      const stored = readPlexus(rawNode(item.uid)?.[PROPS]);
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return true;
    }
    return false;
  }
  function itemPlexus(id, patch) {
    const item = board2.items.get(id);
    const base = rawPlexus(id);
    const merged = { ...base, type: item?.type ?? base.type, ...patch };
    const known = serializeItemLayout(merged);
    return { ...unknownKeys(base, ITEM_KEYS), ...known };
  }
  function edgePlexus(id, patch) {
    const base = rawPlexus(id);
    const merged = { ...normalizeEdge(base), ...patch };
    return { ...unknownKeys(base, EDGE_KEYS), ...serializeEdge(merged) };
  }
  const clampSize = (type, w, h) => ({
    w: Math.max(MIN_SIZES[type]?.w ?? 1, w),
    h: Math.max(MIN_SIZES[type]?.h ?? 1, h)
  });
  const sectionFloor = (id, size) => {
    const item = board2.items.get(id);
    const own = rects.get(id);
    if (item?.type !== "section" || !own || !item.members.length) return size;
    const b = boundsOf(item.members.map((m) => rects.get(m)).filter(Boolean));
    if (!b) return size;
    return { w: Math.max(size.w, b.x + b.w + FIT_PAD - own.x), h: Math.max(size.h, b.y + b.h + FIT_PAD - own.y) };
  };
  function ensureContainer(t) {
    if (board2.containerUid) return board2.containerUid;
    const existing = kidsOf(raw).find((k) => readPlexus(k[PROPS])?.type === "edges");
    if (existing) return existing[UID];
    return t.create({ parent: uid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
  }
  function refOf2(id) {
    const item = board2.items.get(id);
    return item ? semanticRef(item) : `((${id}))`;
  }
  function edgeStringFor(from, to, dir, label, srcBlock, dstBlock) {
    return edgeString({ srcRef: refOf2(from), dstRef: refOf2(to), dir, label, srcBlock, dstBlock });
  }
  function applyFit(t, touched, { skip } = {}) {
    if (!flag("auto-fit-sections", true)) return;
    const list = [...touched ?? []];
    if (!list.length) return;
    t.sync();
    const plan = sectionFitPlan(board2, rects, list, skip ? { skip: new Set(skip) } : {});
    if (!plan.length) return;
    const grown = new Map(plan.map((p) => [p.uid, p.rect]));
    const finalWorld = new Map(rects);
    for (const [sid, r] of grown) finalWorld.set(sid, r);
    const originOf = (pid) => pid === uid ? { x: 0, y: 0 } : finalWorld.get(pid) ?? { x: 0, y: 0 };
    for (const [sid, r] of grown) {
      const p = originOf(board2.items.get(sid).parentUid);
      t.props(sid, itemPlexus(sid, { x: round13(r.x - p.x), y: round13(r.y - p.y), w: round13(r.w), h: round13(r.h) }));
    }
    for (const [sid, r] of grown) {
      const old = rects.get(sid);
      if (Math.abs(r.x - old.x) < 0.01 && Math.abs(r.y - old.y) < 0.01) continue;
      for (const m of board2.items.get(sid).members) {
        if (grown.has(m)) continue;
        const mr = rects.get(m);
        t.props(m, itemPlexus(m, { x: round13(mr.x - r.x), y: round13(mr.y - r.y) }));
      }
    }
  }
  function spaceOutAfter(t, moved) {
    t.sync();
    const byParent = /* @__PURE__ */ new Map();
    for (const id of moved) {
      const it = board2.items.get(id);
      if (!it) continue;
      if (!byParent.has(it.parentUid)) byParent.set(it.parentUid, []);
      byParent.get(it.parentUid).push(id);
    }
    const displacedIds = [];
    for (const [pid, here] of byParent) {
      const sibs = pid === uid ? board2.roots : board2.items.get(pid)?.members ?? [];
      const withSections = here.some((id) => board2.items.get(id).type === "section");
      const map = /* @__PURE__ */ new Map();
      const pinned = /* @__PURE__ */ new Set();
      for (const s of sibs) {
        const it = board2.items.get(s);
        if (!it || it.type === "section" && !withSections) continue;
        map.set(s, rects.get(s));
        if (it.pinned && !here.includes(s)) pinned.add(s);
      }
      const origin = pid === uid ? { x: 0, y: 0 } : rects.get(pid) ?? { x: 0, y: 0 };
      for (const d of spaceOut(map, new Set(here), { fixed: pinned })) {
        t.props(d.uid, itemPlexus(d.uid, { x: round13(d.x - origin.x), y: round13(d.y - origin.y) }));
        displacedIds.push(d.uid);
      }
    }
    applyFit(t, displacedIds);
  }
  const withCardLook = (layout, string) => {
    const look = lookForNewString(string, setting("default-card-look", "block"));
    return look ? { ...layout, look } : layout;
  };
  const cardAt = (t, string, x, y, size = null) => {
    const parent = containerAt(board2, { x: x + (size?.w ?? DEFAULT_SIZES.card.w) / 2, y: y + (size?.h ?? DEFAULT_SIZES.card.h) / 2 }, { rects });
    const rel = toRelative(board2, parent, { x, y }, rects);
    const layout = withCardLook({ x: rel.x, y: rel.y }, string);
    if (Number.isFinite(size?.w)) layout.w = size.w;
    if (Number.isFinite(size?.h)) layout.h = size.h;
    return t.create({ parent, string, plexus: serializeItemLayout(layout) });
  };
  const defaultSizeFor = (item) => {
    if (item.type === "section") return DEFAULT_SIZES.section;
    if (item.type === "text") return DEFAULT_SIZES.text;
    if (item.kind === "board") return DEFAULT_BOARD_CARD;
    return { w: sizeSetting("default-card-width", DEFAULT_SIZES.card.w), h: sizeSetting("default-card-height", DEFAULT_SIZES.card.h) };
  };
  function recomputeLinks(force) {
    if (!board2) return;
    const filtered = filterLinks(allLinks, linkMode);
    const res = coveredBy(filtered, board2);
    const fp = `${linkMode}|${res.visible.map((l) => l.key).join(",")}|${[...res.coveredEdges].sort().join(",")}`;
    const changed2 = fp !== linkFingerprint;
    visibleLinks = res.visible;
    covered = res.coveredEdges;
    linkFingerprint = fp;
    if (changed2 || force) emit2("links", { links: visibleLinks, coveredEdges: covered });
  }
  function computeLinks() {
    if (!board2) return;
    const boardEid = host.resolveEid({ uid });
    const eidToItems = /* @__PURE__ */ new Map();
    for (const item of board2.items.values()) {
      if (item.type !== "card") continue;
      const t = item.target;
      const ref = t.kind === "page" ? { title: t.title } : { uid: t.uid };
      const eid = host.resolveEid(ref);
      if (eid == null || eid === boardEid) continue;
      if (!eidToItems.has(eid)) eidToItems.set(eid, []);
      eidToItems.get(eid).push(item.uid);
    }
    const eids = [...eidToItems.keys()];
    if (!eids.length || boardEid == null) {
      allLinks = [];
      return;
    }
    const rows = host.q(linksQuery(), boardEid, eids, eids) || [];
    const parentStrings = /* @__PURE__ */ new Map();
    let budget = MAX_PARENT_STRINGS;
    for (const row2 of rows) {
      const su = row2[2];
      const ss = row2[3];
      if (budget <= 0) break;
      if (attrNameOf(ss) == null && !parentStrings.has(su)) {
        budget--;
        const ps = host.parentString?.(su);
        if (ps != null) parentStrings.set(su, ps);
      }
    }
    allLinks = reduceLinks(rows, { eidToItems, parentStrings });
  }
  let linkTimer = null;
  let linkPromise = null;
  let linkResolve = null;
  function runLinks() {
    linkTimer = null;
    if (!destroyed) {
      try {
        computeLinks();
        recomputeLinks(false);
      } catch (err) {
        console.error("[plexus session] links", err);
      }
    }
    const done = linkResolve;
    linkPromise = null;
    linkResolve = null;
    done?.();
  }
  function refreshLinks() {
    if (destroyed) return Promise.resolve();
    if (linkMode === "off") return Promise.resolve();
    if (!linkPromise) linkPromise = new Promise((resolve) => {
      linkResolve = resolve;
    });
    if (linkTimer) clearTimeout(linkTimer);
    linkTimer = setTimeout(() => runIdle(runLinks), linkDelay);
    linkTimer.unref?.();
    return linkPromise;
  }
  const session = {
    uid,
    host,
    settings,
    get board() {
      return board2;
    },
    get gone() {
      return gone;
    },
    get rects() {
      return rects;
    },
    get links() {
      return visibleLinks;
    },
    get coveredEdges() {
      return covered;
    },
    get busy() {
      return busy;
    },
    get linkMode() {
      return linkMode;
    },
    on(name, fn) {
      if (!listeners2.has(name)) listeners2.set(name, /* @__PURE__ */ new Set());
      listeners2.get(name).add(fn);
      return () => listeners2.get(name)?.delete(fn);
    },
    idle: () => queue.idle(),
    setLinkMode(mode) {
      if (!LINK_MODES.includes(mode)) return;
      linkMode = mode;
      recomputeLinks(true);
      if (mode !== "off" && !allLinks.length) refreshLinks();
    },
    refreshLinks,
    commitMove(uids, dx, dy) {
      if (!board2 || !dx && !dy) return Promise.resolve();
      return txn((t) => {
        const top = topLevelOf(board2, uids).filter((id) => !board2.items.get(id).pinned);
        if (!top.length) return;
        const moved = new Map(rects);
        for (const id of top) {
          const r = rects.get(id);
          moved.set(id, { ...r, x: r.x + dx, y: r.y + dy });
        }
        const plan = new Map(membershipPlan(board2, top, moved).map((p) => [p.uid, p]));
        for (const id of top) {
          const item = board2.items.get(id);
          const p = plan.get(id);
          if (p) {
            t.move(id, p.toParent, "last");
            t.props(id, itemPlexus(id, { x: p.x, y: p.y }));
          } else {
            t.props(id, itemPlexus(id, { x: item.x + dx, y: item.y + dy }));
          }
        }
        applyFit(t, top);
        if (flag("space-out", false)) spaceOutAfter(t, top);
      });
    },
    commitRects(list) {
      if (!board2 || !list?.length) return Promise.resolve();
      return txn((t) => {
        const changedSections = [];
        const fitTouched = [];
        for (const r of list) {
          const item = board2.items.get(r.uid);
          if (!item || item.pinned) continue;
          fitTouched.push(r.uid);
          const parentRect = item.parentUid === uid ? { x: 0, y: 0 } : rects.get(item.parentUid) ?? { x: 0, y: 0 };
          const size = clampSize(item.type, r.w ?? item.w, r.h ?? item.h);
          t.props(r.uid, itemPlexus(r.uid, {
            x: round13(r.x - parentRect.x),
            y: round13(r.y - parentRect.y),
            w: round13(size.w),
            h: round13(size.h)
          }));
          if (item.type === "section") changedSections.push(r.uid);
        }
        if (changedSections.length) {
          t.sync();
          for (const sid of changedSections) {
            const plan = sectionAdoptPlan(board2, sid, rects);
            for (const p of plan) {
              t.move(p.uid, p.toParent, "last");
              t.props(p.uid, itemPlexus(p.uid, { x: p.x, y: p.y }));
            }
            if (plan.length) t.sync();
          }
        }
        applyFit(t, fitTouched, { skip: changedSections });
      });
    },
    createCard({ x, y, string = "", w, h } = {}) {
      return txn((t) => {
        const size = { w: w ?? DEFAULT_SIZES.card.w, h: h ?? DEFAULT_SIZES.card.h };
        const parent = containerAt(board2, { x: x + size.w / 2, y: y + size.h / 2 }, { rects });
        const rel = toRelative(board2, parent, { x, y }, rects);
        const layout = withCardLook({ x: rel.x, y: rel.y }, string);
        if (w !== void 0) layout.w = w;
        if (h !== void 0) layout.h = h;
        const id = t.create({ parent, string, plexus: serializeItemLayout(layout) });
        applyFit(t, [id]);
        return id;
      });
    },
    createText({ x, y, string = "", look, w, h, color, shape } = {}) {
      return txn((t) => {
        const sticky = look === "sticky";
        const dw = sticky ? STICKY_SIZE.w : DEFAULT_SIZES.text.w;
        const dh = sticky ? STICKY_SIZE.h : DEFAULT_SIZES.text.h;
        const size = { w: typeof w === "number" ? w : dw, h: typeof h === "number" ? h : dh };
        const parent = containerAt(board2, { x: x + size.w / 2, y: y + size.h / 2 }, { rects });
        const rel = toRelative(board2, parent, { x, y }, rects);
        const layout = { type: "text", x: rel.x, y: rel.y };
        if (sticky || typeof w === "number") layout.w = size.w;
        if (sticky || typeof h === "number") layout.h = size.h;
        if (sticky) {
          layout.look = "sticky";
          layout.color = styleColor(color) || STICKY_COLOR;
        }
        if (SHAPES.includes(shape)) layout.shape = shape;
        const id = t.create({ parent, string, plexus: serializeItemLayout(layout) });
        applyFit(t, [id]);
        return id;
      });
    },
    createSection({ rect, title = "Section", color, look, axis } = {}) {
      return txn((t) => makeSection(t, rect, title, color, null, { look, axis }));
    },
    wrapInSection(uids) {
      return txn((t) => {
        const top = topLevelOf(board2, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const pad2 = 32;
        const rect = { x: b.x - pad2, y: b.y - pad2, w: b.w + pad2 * 2, h: b.h + pad2 * 2 };
        return makeSection(t, rect, "Section", void 0, top);
      });
    },
    // One undo. Creates a section titled `name`, or moves the pages into the one that already has that title.
    groupUnder(uids, title) {
      const name = String(title || "").trim();
      if (!name || !board2 || destroyed) return Promise.resolve(null);
      const pages = capBulk(topLevelOf(board2, uids), emit2).filter((id) => {
        const it = board2.items.get(id);
        return it?.type !== "section" && it?.kind === "page" && namespaceParent(it.title) === name;
      });
      if (!pages.length) return Promise.resolve(null);
      const existing = [...board2.items.values()].find((it) => it.type === "section" && it.title === name);
      const moving = pages.filter((id) => board2.items.get(id).parentUid !== existing?.uid);
      if (!moving.length) return Promise.resolve(existing?.uid ?? null);
      return txn((t) => {
        if (existing) {
          const sec = rects.get(existing.uid);
          let y = 24;
          for (const member of existing.members) {
            const r = rects.get(member);
            if (!r || !sec) continue;
            y = Math.max(y, round13(r.y - sec.y + r.h + 16));
          }
          let x = 24;
          for (const id of moving) {
            const r = rects.get(id);
            t.move(id, existing.uid, "last");
            t.props(id, itemPlexus(id, { x, y }));
            x += round13((r?.w || DEFAULT_SIZES.card.w) + 16);
          }
          applyFit(t, [existing.uid]);
          return existing.uid;
        }
        const b = boundsOf(moving.map((id) => rects.get(id)));
        if (!b) return null;
        const pad2 = 32;
        const rect = { x: b.x - pad2, y: b.y - pad2, w: b.w + pad2 * 2, h: b.h + pad2 * 2 };
        return makeSection(t, rect, name, void 0, moving);
      });
    },
    createBoard({ rect, title } = {}) {
      return txn((t) => {
        const d = DEFAULT_BOARD_CARD;
        const r = { x: rect?.x ?? 0, y: rect?.y ?? 0, w: rect?.w ?? d.w, h: rect?.h ?? d.h };
        const size = clampSize("card", r.w, r.h);
        const id = makeBoard(t, { x: r.x, y: r.y, w: size.w, h: size.h }, title, void 0);
        applyFit(t, [id]);
        return id;
      });
    },
    wrapInBoard(uids) {
      return txn((t) => {
        const top = topLevelOf(board2, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const card2 = { x: b.x, y: b.y, w: Math.min(480, Math.max(240, b.w)), h: Math.min(360, Math.max(180, b.h)) };
        const boardUid = makeBoard(t, card2, "", new Set(top), b);
        moveItemsInto(t, top, boardUid, { x: b.x, y: b.y }, { x: 0, y: 0 });
        applyFit(t, [boardUid]);
        return boardUid;
      });
    },
    moveIntoBoard(uids, boardUid) {
      if (!board2 || destroyed) return Promise.resolve(null);
      const target = board2.items.get(boardUid);
      if (!target || target.kind !== "board" || !target.enhanced) return Promise.resolve(null);
      const top = topLevelOf(board2, uids).filter((id) => id !== boardUid && !descendantsOf(board2, id).has(boardUid));
      if (!top.length) return Promise.resolve(null);
      const preview = boardPreview(target);
      const cb = preview.bounds;
      const place = cb ? { x: cb.x + cb.w + 48, y: cb.y } : { x: 0, y: 0 };
      const origin = boundsOf(top.map((id) => rects.get(id)));
      const moved = new Set(top);
      for (const id of top) for (const d of descendantsOf(board2, id)) moved.add(d);
      const undoItems = top.map((id) => {
        const hit = ix().get(id);
        return { uid: id, parentUid: hit.parent[UID], order: kidsOf(hit.parent).indexOf(hit.node), plexus: clone(readPlexus(hit.node[PROPS])) };
      }).sort((a, b) => a.order - b.order);
      const undoEdges = [];
      const info = { createdContainer: null };
      return txn((t) => {
        moveItemsInto(t, top, boardUid, origin, place, { moved, undoEdges, info });
        applyFit(t, [boardUid]);
        return {
          moved: top.slice(),
          title: target.title,
          boardUid,
          undo: () => txn((u) => {
            for (const it of undoItems) {
              u.move(it.uid, it.parentUid, it.order);
              u.props(it.uid, it.plexus);
            }
            for (const e of undoEdges.sort((a, b) => a.order - b.order)) {
              if (e.deleted) u.create({ uid: e.uid, parent: e.parent, order: e.order, string: e.string, plexus: e.plexus });
              else {
                if (e.relocated) u.move(e.uid, e.parent, e.order);
                u.props(e.uid, e.plexus);
                u.string(e.uid, e.string);
              }
            }
            if (info.createdContainer) u.del(info.createdContainer);
          })
        };
      });
    },
    renameBoard(id, title) {
      return txn((t) => {
        const cur0 = board2.items.get(id);
        if (cur0?.kind !== "board" || !cur0.enhanced) return;
        const cur = rawNode(id)?.[STR];
        if (cur === void 0) return;
        const next = setBoardTitle(cur, title);
        if (next !== cur) t.string(id, next);
      });
    },
    addRefCards(list) {
      const items = capBulk(list ?? [], emit2);
      return txn((t) => {
        const ids = items.map(({ string, x, y, w, h }) => cardAt(t, string, x, y, w || h ? { w, h } : null));
        applyFit(t, ids);
        return ids;
      });
    },
    // One ref card, centered on the board's content (the origin when nothing is placed yet).
    addBlockRef(blockUid2) {
      if (!blockUid2 || !board2) return Promise.resolve(null);
      const at = cardAtCenter(boundsOf([...rects.values()]), DEFAULT_SIZES.card);
      return this.addRefCards([{ string: `((${blockUid2}))`, x: at.x, y: at.y }]).then((ids) => ids?.[0] ?? null);
    },
    deleteItems(uids, { withContents = false, force = false } = {}) {
      return txn((t) => {
        const protectedItem = (id) => board2.items.get(id).pinned || withContents && [...descendantsOf(board2, id)].some((d) => board2.items.get(d).pinned);
        const set = new Set([...uids].filter((id) => board2.items.has(id) && (force || !protectedItem(id))));
        if (!set.size) return;
        let edgeSet;
        if (withContents) {
          edgeSet = edgesTouching(board2, set);
        } else {
          edgeSet = /* @__PURE__ */ new Set();
          for (const e of board2.edges.values()) if (set.has(e.from) || set.has(e.to)) edgeSet.add(e.uid);
          for (const id of set) {
            const item = board2.items.get(id);
            if (item.type !== "section") continue;
            let survivor = item.parentUid;
            while (survivor !== uid && set.has(survivor)) survivor = board2.items.get(survivor).parentUid;
            for (const m of item.members) {
              if (set.has(m)) continue;
              const r = rects.get(m);
              const rel = toRelative(board2, survivor, { x: r.x, y: r.y }, rects);
              t.move(m, survivor, "last");
              t.props(m, itemPlexus(m, { x: rel.x, y: rel.y }));
            }
          }
        }
        for (const id of edgeSet) t.del(id);
        const explicit = withContents ? topLevelOf(board2, set) : [...set].filter((id) => !set.has(board2.items.get(id).parentUid));
        for (const id of explicit) t.del(id);
      });
    },
    setColor(uids, color) {
      return txn((t) => {
        for (const id of uids) {
          if (board2.items.has(id)) t.props(id, itemPlexus(id, { color: color ?? void 0 }));
          else if (board2.edges.has(id)) t.props(id, edgePlexus(id, { color: color ?? void 0 }));
        }
      });
    },
    setCollapsed(id, value) {
      return txn((t) => {
        if (board2.items.has(id)) t.props(id, itemPlexus(id, { collapsed: value ? true : void 0 }));
      });
    },
    // Roam :block/open on the card block only. Fold stays on plexus collapsed.
    setBlockOpen(id, open) {
      const item = board2?.items.get(id);
      if (!item || item.type !== "card") return Promise.resolve(false);
      const node2 = rawNode(id);
      if (!node2) return Promise.resolve(false);
      const next = open !== false;
      if (node2[OPEN] !== false === next) return Promise.resolve(false);
      node2[OPEN] = next;
      publish();
      return queue.run(async () => {
        await host.setOpen(id, next);
        return true;
      }).catch((err) => {
        handleFailure(err);
        return false;
      });
    },
    // CH-1: show or hide a card's children inside it. One props write. Turning it on grows the card by `extraH`
    // (the renderer's estimate of the outline) in the same write, so one Cmd+Z undoes both.
    setKids(id, value, extraH = 0) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "card" || item.kind !== "note" && item.kind !== "block") return;
        const on = value === true;
        if (Boolean(item.kids) === on) return;
        const patch = { kids: on ? true : void 0 };
        if (on && extraH > 0) patch.h = Math.min(900, Math.ceil(item.h + extraH));
        t.props(id, itemPlexus(id, patch));
        if (patch.h > item.h) applyFit(t, [id]);
      });
    },
    setFontSize(id, size) {
      return txn((t) => {
        if (board2.items.has(id)) t.props(id, itemPlexus(id, { fontSize: size }));
      });
    },
    // One undo step. Cards and text only. null clears a key. Invalid values are dropped by serialize.
    setItemStyle(uids, patch = {}) {
      return txn((t) => {
        const ids = capBulk([...new Set(uids ?? [])].filter((id) => {
          const item = board2.items.get(id);
          return item && item.type !== "section";
        }), emit2);
        let n2 = 0;
        for (const id of ids) {
          const nextPatch = {};
          for (const k of ITEM_STYLE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
            nextPatch[k] = patch[k] == null ? void 0 : patch[k];
          }
          const next = itemPlexus(id, nextPatch);
          if (stable(next) !== stable(rawPlexus(id))) {
            t.props(id, next);
            n2++;
          }
        }
        return n2;
      });
    },
    resetItemStyle(uids) {
      const patch = {};
      for (const k of ITEM_STYLE_KEYS) patch[k] = null;
      return this.setItemStyle(uids, patch);
    },
    setSectionStyle(uids, patch = {}) {
      return txn((t) => {
        const ids = capBulk([...new Set(uids ?? [])].filter((id) => board2.items.get(id)?.type === "section"), emit2);
        let n2 = 0;
        for (const id of ids) {
          const nextPatch = {};
          for (const k of SECTION_STYLE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
            nextPatch[k] = patch[k] == null ? void 0 : patch[k];
          }
          const next = itemPlexus(id, nextPatch);
          if (stable(next) !== stable(rawPlexus(id))) {
            t.props(id, next);
            n2++;
          }
        }
        return n2;
      });
    },
    resetSectionStyle(uids) {
      const patch = {};
      for (const k of SECTION_STYLE_KEYS) patch[k] = null;
      return this.setSectionStyle(uids, patch);
    },
    // Board-level section defaults on plexus.defaults.section. null removes a key.
    setSectionDefaults(patch = {}) {
      return txn((t) => {
        if (!board2.enhanced) return false;
        const base = rawPlexus(uid);
        const prevDefaults = base.defaults && typeof base.defaults === "object" && !Array.isArray(base.defaults) ? base.defaults : {};
        const section2 = prevDefaults.section && typeof prevDefaults.section === "object" ? { ...prevDefaults.section } : {};
        for (const k of SECTION_STYLE_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
          if (patch[k] == null) delete section2[k];
          else section2[k] = patch[k];
        }
        const clean = normalizeSectionDefaults(section2);
        const next = { ...base, defaults: { ...prevDefaults } };
        if (Object.keys(clean).length) next.defaults.section = clean;
        else {
          delete next.defaults.section;
          if (!Object.keys(next.defaults).length) delete next.defaults;
        }
        if (stable(next) !== stable(base)) t.props(uid, next);
        return true;
      });
    },
    resetSectionDefaults() {
      const patch = {};
      for (const k of SECTION_STYLE_KEYS) patch[k] = null;
      return this.setSectionDefaults(patch);
    },
    setLook(id, look) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "card") return;
        if (look !== "block" && look !== "card") return;
        t.props(id, itemPlexus(id, { look }));
      });
    },
    setString(id, string) {
      return txn((t) => {
        const cur = rawNode(id)?.[STR];
        if (cur === void 0 || cur === string) return;
        t.string(id, string);
      });
    },
    growToFit(id, contentHeight) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type === "section") return;
        const target = Math.min(900, Math.ceil(contentHeight));
        if (!(target > item.h)) return;
        t.props(id, itemPlexus(id, { h: target }));
        applyFit(t, [id]);
      });
    },
    fitSection(id, { shrink = true } = {}) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "section" || !item.members.length) return false;
        const own = rects.get(id);
        const bounds = boundsOf(item.members.map((m) => rects.get(m)));
        let next = inflate(bounds, FIT_PAD);
        if (!shrink) next = unionRect(own, next);
        const size = clampSize("section", next.w, next.h);
        next = { x: round13(next.x), y: round13(next.y), w: round13(size.w), h: round13(size.h) };
        const origin = item.parentUid === uid ? { x: 0, y: 0 } : rects.get(item.parentUid) ?? { x: 0, y: 0 };
        const write = (target, patch) => {
          const plexus = itemPlexus(target, patch);
          if (stable(plexus) !== stable(rawPlexus(target))) t.props(target, plexus);
        };
        write(id, { x: round13(next.x - origin.x), y: round13(next.y - origin.y), w: next.w, h: next.h });
        for (const m of item.members) {
          const mr = rects.get(m);
          write(m, { x: round13(mr.x - next.x), y: round13(mr.y - next.y) });
        }
        applyFit(t, [id]);
        return true;
      });
    },
    setFit(id, on) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "section") return;
        const want = on === false ? false : void 0;
        if (item.autofit === false === (want === false)) return;
        t.props(id, itemPlexus(id, { fit: want }));
      });
    },
    setPinned(uids, on) {
      return txn((t) => {
        for (const id of new Set(uids ?? [])) {
          const item = board2.items.get(id);
          if (!item || item.pinned === Boolean(on)) continue;
          t.props(id, itemPlexus(id, { pinned: on ? true : void 0 }));
        }
      });
    },
    // One undo step. Pins or unpins the section and everything inside it. Does not write x/y/w/h.
    lockSection(id, on = true) {
      const item = board2?.items.get(id);
      if (!item || item.type !== "section") return Promise.resolve(false);
      return this.setPinned([id, ...descendantsOf(board2, id)], Boolean(on));
    },
    // Adds the description line, or deletes it. The block is a text child with look section-note.
    // No auto-fit: the section's stored size stays put.
    toggleSectionNote(id, string = "Description") {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "section") return null;
        const existing = item.members.find((m) => {
          const kid = board2.items.get(m);
          return kid?.type === "text" && kid.look === "section-note";
        });
        if (existing) {
          t.del(existing);
          return null;
        }
        const w = Math.max(80, Math.min(360, item.w - 32));
        return t.create({
          parent: id,
          string,
          plexus: serializeItemLayout({ type: "text", look: "section-note", x: 16, y: 12, w, h: 32 })
        });
      });
    },
    // bg / bgColor / bgImage / lodZoom: undefined leaves the key, null removes it.
    // bg is a pattern. bgColor is a tone name or #rrggbb. bgImage is an https URL, painted locked.
    // lodZoom is this board's map threshold (0.05–1.5).
    setBoardBackground({ bg, bgColor, bgImage, lodZoom } = {}) {
      return txn((t) => {
        if (!board2.enhanced) return false;
        let tone = bgColor;
        if (bg != null && !BOARD_PATTERNS.includes(bg)) return false;
        if (tone != null) {
          tone = boardColor(tone);
          if (!tone) return false;
        }
        let image = bgImage;
        if (image != null) {
          image = backgroundImage(image);
          if (!image) return false;
        }
        let zoom = lodZoom;
        if (zoom != null) {
          const picked = zoomThreshold(zoom, null);
          if (picked === 0.45 && Number(zoom) !== 0.45) return false;
          zoom = picked;
        }
        const base = rawPlexus(uid);
        const next = { ...base };
        for (const [key, value] of [["bg", bg], ["bgColor", tone], ["bgImage", image], ["lodZoom", zoom]]) {
          if (value === void 0) continue;
          if (value === null) delete next[key];
          else next[key] = value;
        }
        if (stable(next) !== stable(base)) t.props(uid, next);
        return true;
      });
    },
    setSectionLook(id, look) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "section") return false;
        if (look != null && look !== "lane" && look !== "calendar" && look !== "timer") return false;
        t.props(id, itemPlexus(id, { look: look ?? null }));
        return true;
      });
    },
    applyCardTemplate(id, blocks) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "card") return 0;
        const plan = cardTemplatePlan(blocks).slice(0, 45);
        for (const child of plan) t.create({ parent: id, order: "last", string: child.string });
        return plan.length;
      });
    },
    layoutByDate(id) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type !== "section") return 0;
        const cards = item.members.map((member) => board2.items.get(member)).filter(Boolean);
        const plan = calendarLayout(cards).slice(0, 45);
        for (const spot of plan) t.props(spot.uid, itemPlexus(spot.uid, { x: spot.x, y: spot.y }));
        return plan.length;
      });
    },
    setCollapsedMany(uids, value) {
      return txn((t) => {
        let count = 0;
        for (const id of new Set(uids ?? [])) {
          const item = board2.items.get(id);
          if (!item || item.type !== "card" || item.collapsed === Boolean(value)) continue;
          t.props(id, itemPlexus(id, { collapsed: value ? true : void 0 }));
          count++;
        }
        return count;
      });
    },
    collapseAll(value, { within = null, except = [] } = {}) {
      return txn((t) => {
        const skipIds = new Set(except ?? []);
        const pool = within ? [...descendantsOf(board2, within)] : [...board2.items.keys()];
        let count = 0;
        for (const id of pool) {
          const item = board2.items.get(id);
          if (!item || item.type !== "card" || skipIds.has(id) || item.collapsed === Boolean(value)) continue;
          t.props(id, itemPlexus(id, { collapsed: value ? true : void 0 }));
          count++;
        }
        return count;
      });
    },
    // Reorder each parent's blocks so the outline matches the board. Positions stay. Moves go through the
    // host group, which splits a long run into chunks of 45 so one undo step stays inside Roam's depth.
    sortOutline() {
      return txn((t) => {
        let moves = 0;
        for (const group of readingOrder(board2, rects)) {
          group.uids.forEach((id, index) => {
            const kids = kidsOf(rawNode(group.parent));
            const at = kids.findIndex((k) => k[UID] === id);
            if (at < 0 || at === index) return;
            t.move(id, group.parent, index);
            moves += 1;
          });
        }
        return moves;
      });
    },
    // Modes: row, column, grid, outline. A lone selected section tidies its members; otherwise each parent's
    // selected items are tidied among themselves. Writes only x and y. Resolves the number of items moved.
    tidyItems(uids, mode = "grid", { gap } = {}) {
      return txn((t) => {
        const top = topLevelOf(board2, uids ?? []);
        const groups = /* @__PURE__ */ new Map();
        if (top.length === 1 && board2.items.get(top[0]).type === "section") {
          groups.set(top[0], board2.items.get(top[0]).members.filter((m) => !board2.items.get(m).pinned));
        } else {
          for (const id of top) {
            const it = board2.items.get(id);
            if (it.pinned) continue;
            if (!groups.has(it.parentUid)) groups.set(it.parentUid, []);
            groups.get(it.parentUid).push(id);
          }
        }
        const opts = gap !== void 0 ? { gap } : {};
        if (mode === "outline") opts.order = outlineOrder(board2);
        const moved = [];
        for (const ids of groups.values()) {
          if (ids.length < 2) continue;
          const list = ids.map((id) => {
            const it = board2.items.get(id);
            return { uid: id, x: it.x, y: it.y, w: it.w, h: it.h };
          });
          for (const p of tidyRects(list, mode, opts)) {
            const it = board2.items.get(p.uid);
            if (Math.abs(p.x - it.x) < 0.05 && Math.abs(p.y - it.y) < 0.05) continue;
            t.props(p.uid, itemPlexus(p.uid, { x: round13(p.x), y: round13(p.y) }));
            moved.push(p.uid);
          }
        }
        applyFit(t, moved);
        return moved.length;
      });
    },
    sameSize(uids, primaryUid, mode = "both") {
      return txn((t) => {
        const ids = [.../* @__PURE__ */ new Set([...uids ?? [], primaryUid])].filter((id) => board2.items.has(id));
        const list = ids.map((id) => ({ uid: id, w: board2.items.get(id).w, h: board2.items.get(id).h }));
        const changed2 = [];
        for (const c of sameSize(list, primaryUid, mode)) {
          const item = board2.items.get(c.uid);
          if (item.pinned) continue;
          const size = sectionFloor(c.uid, clampSize(item.type, c.w, c.h));
          if (round13(size.w) === item.w && round13(size.h) === item.h) continue;
          t.props(c.uid, itemPlexus(c.uid, { w: round13(size.w), h: round13(size.h) }));
          changed2.push(c.uid);
        }
        applyFit(t, changed2);
        return changed2.length;
      });
    },
    resetSize(uids) {
      return txn((t) => {
        const changed2 = [];
        for (const id of new Set(uids ?? [])) {
          const item = board2.items.get(id);
          if (!item || item.pinned) continue;
          const d = sectionFloor(id, defaultSizeFor(item));
          const w = round13(d.w);
          const h = round13(d.h);
          if (item.w === w && item.h === h) continue;
          t.props(id, itemPlexus(id, { w, h }));
          changed2.push(id);
        }
        applyFit(t, changed2);
        return changed2.length;
      });
    },
    // Sets the height from measured content, shrinking as well as growing (growToFit only grows).
    fitToContent(id, contentHeight) {
      return txn((t) => {
        const item = board2.items.get(id);
        if (!item || item.type === "section" || !Number.isFinite(contentHeight)) return;
        const target = Math.min(900, Math.max(MIN_SIZES[item.type]?.h ?? 1, Math.ceil(contentHeight)));
        if (target === item.h) return;
        t.props(id, itemPlexus(id, { h: target }));
        applyFit(t, [id]);
      });
    },
    addDailyCards(dates, { x = 0, y = 0 } = {}) {
      return txn((t) => {
        const have = /* @__PURE__ */ new Set();
        for (const item of board2.items.values()) if (item.kind === "page") have.add(item.target.title);
        const made = [];
        const size = defaultSizeFor({ type: "card", kind: "page" });
        const occupied = [...board2.items.values()].filter((it) => it.type !== "section").map((it) => rects.get(it.uid)).filter(Boolean);
        let slotX = x;
        const freeSlot = () => {
          const at = () => ({ x: slotX, y, w: size.w, h: size.h });
          while (occupied.some((r) => rectsIntersect(r, at()))) slotX += size.w + DAILY_GAP;
          const spot = at();
          occupied.push(spot);
          slotX += size.w + DAILY_GAP;
          return spot.x;
        };
        for (const d of dates ?? []) {
          const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) : d;
          const title = dailyPageTitle(date);
          if (have.has(title)) continue;
          have.add(title);
          made.push(cardAt(t, `[[${title}]]`, freeSlot(), y));
        }
        applyFit(t, made);
        return made;
      });
    },
    addEdge({ from, to, fromSide, toSide, label = "", dir = "one", fromBlock, toBlock } = {}) {
      return txn((t) => {
        if (!from || !to || from === to || !board2.items.has(from) || !board2.items.has(to)) return null;
        const props = serializeEdge({ from, to, dir, fromSide, toSide, fromBlock, toBlock });
        const existing = [...board2.edges.values()].find((e) => e.from === from && e.to === to && (e.fromBlock ?? "") === (props.fromBlock ?? "") && (e.toBlock ?? "") === (props.toBlock ?? ""));
        if (existing && existing.dir === dir) return existing.uid;
        const container = ensureContainer(t);
        return t.create({ parent: container, order: "last", string: edgeStringFor(from, to, dir, label, props.fromBlock, props.toBlock), plexus: props });
      });
    },
    updateEdge(id, patch = {}) {
      return txn((t) => {
        const edge = board2.edges.get(id);
        if (!edge) return;
        const { label, ...rest } = patch;
        const next = edgePlexus(id, rest);
        t.props(id, next);
        const dir = rest.dir ?? edge.dir;
        const nextLabel = label ?? edge.label;
        const nextFrom = rest.from ?? edge.from;
        const nextTo = rest.to ?? edge.to;
        const merged = normalizeEdge(next);
        const blocksChanged = (merged.fromBlock ?? "") !== (edge.fromBlock ?? "") || (merged.toBlock ?? "") !== (edge.toBlock ?? "");
        if (rest.dir !== void 0 && rest.dir !== edge.dir || label !== void 0 && label !== edge.label || blocksChanged || nextFrom !== edge.from || nextTo !== edge.to) {
          t.string(id, edgeStringFor(nextFrom, nextTo, dir, nextLabel, merged.fromBlock, merged.toBlock));
        }
      });
    },
    flipEdge(id) {
      return txn((t) => {
        const edge = board2.edges.get(id);
        if (!edge) return;
        t.props(id, edgePlexus(id, { from: edge.to, to: edge.from, fromSide: edge.toSide, toSide: edge.fromSide, fromBlock: edge.toBlock, toBlock: edge.fromBlock }));
        t.string(id, edgeStringFor(edge.to, edge.from, edge.dir, edge.label, edge.toBlock, edge.fromBlock));
      });
    },
    deleteEdges(uids) {
      return txn((t) => {
        for (const id of uids) if (board2.edges.has(id)) t.del(id);
      });
    },
    pinLink(link) {
      const first = link?.labels?.[0];
      const label = first && first !== "mentions" ? first : "";
      return session.addEdge({ from: link.from, to: link.to, label, dir: "one" });
    },
    async writeToGraph(edgeUid) {
      const edge = board2?.edges.get(edgeUid);
      if (!edge) return { ok: false, reason: "unresolved" };
      const label = String(edge.label ?? "").trim();
      if (!label) return { ok: false, reason: "empty-label" };
      if (label.includes("::")) return { ok: false, reason: "invalid-label" };
      if (/^BT_attr/i.test(label)) return { ok: false, reason: "reserved-label" };
      if (label.length > 60) return { ok: false, reason: "too-long" };
      const src = board2.items.get(edge.from);
      const dst = board2.items.get(edge.to);
      if (!src || !dst) return { ok: false, reason: "unresolved" };
      const dstRef = edge.toBlock ? `((${edge.toBlock}))` : semanticRef(dst);
      try {
        if (src.kind === "page") {
          const page = host.pullPage(src.target.title);
          if (!page) return { ok: false, reason: "no-page" };
          const attr = kidsOf(page).find((k) => String(k[STR] ?? "").trim() === `${label}::`);
          if (attr) {
            await queue.run(() => host.createBlock({ parentUid: attr[UID], order: "last", string: dstRef }));
            return { ok: true, reason: "appended" };
          }
          await queue.run(() => host.createBlock({ parentUid: page[UID], order: "last", string: `${label}:: ${dstRef}` }));
          return { ok: true, reason: "created" };
        }
        const srcUid = src.kind === "block" ? src.target.uid : src.uid;
        if (host.blockString(srcUid) == null) return { ok: false, reason: "unresolved" };
        await queue.run(() => host.createBlock({ parentUid: srcUid, order: "last", string: `${label}:: ${dstRef}` }));
        return { ok: true, reason: "created" };
      } catch (err) {
        emit2("toast", { message: "Couldn't write the connection to the graph." });
        return { ok: false, reason: "write-failed" };
      }
    },
    async undo() {
      try {
        await queue.run(async () => {
          ledger.clear();
          await host.undo();
        });
        repull();
      } catch (err) {
        handleFailure(err);
      }
    },
    async redo() {
      try {
        await queue.run(async () => {
          ledger.clear();
          await host.redo();
        });
        repull();
      } catch (err) {
        handleFailure(err);
      }
    },
    async enhance() {
      if (!board2) return { enhanced: false, reason: "no-board" };
      if (board2.enhanced) return { enhanced: false, reason: "already" };
      if (hasStoredLayout()) {
        await txn((t) => {
          t.props(uid, withBoardMarker(rawPlexus(uid), true));
        });
        return { enhanced: true, kind: "kept", counts: null };
      }
      let source = readV06Entry(host, uid);
      let kind = "v06";
      if (!source) {
        const native = readNative(host, uid);
        source = native.nodes.length ? native : null;
        kind = source ? "native" : "none";
      }
      const plan = planImport(board2, source, { gen: () => host.generateUid() });
      const collapse = collapseOutline() && raw?.[OPEN] !== false;
      let counts = null;
      try {
        counts = await queue.run(() => grouped(async () => {
          ledger.clear();
          const done = await executeImport(plan, host, board2);
          if (collapse) await host.setOpen(uid, false);
          return done;
        }));
      } catch (err) {
        handleFailure(err);
        return { enhanced: false, reason: "write-failed" };
      }
      repull();
      return { enhanced: true, kind, counts };
    },
    restoreNative() {
      return txn((t) => {
        t.props(uid, withBoardMarker(rawPlexus(uid), false));
      });
    },
    release() {
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unwatch();
      if (linkTimer) clearTimeout(linkTimer);
      linkTimer = null;
      linkResolve?.();
      linkPromise = null;
      linkResolve = null;
      listeners2.clear();
      ledger.clear();
    }
  };
  function makeBoard(t, rect, title, exclude, centerOf3 = rect) {
    const parent = containerAt(board2, { x: centerOf3.x + centerOf3.w / 2, y: centerOf3.y + centerOf3.h / 2 }, { rects, exclude });
    const rel = toRelative(board2, parent, { x: rect.x, y: rect.y }, rects);
    return t.create({
      parent,
      string: boardString(title),
      plexus: serializeItemLayout({ x: rel.x, y: rel.y, w: rect.w, h: rect.h, v: SCHEMA_VERSION }),
      open: collapseOutline() ? false : void 0
    });
  }
  function moveItemsInto(t, top, boardUid, origin, place, track = {}) {
    const moved = track.moved ?? new Set([...top].flatMap((id) => [id, ...descendantsOf(board2, id)]));
    for (const id of top) {
      const r = rects.get(id);
      t.move(id, boardUid, insertOrder(boardUid));
      t.props(id, itemPlexus(id, { x: round13(r.x - origin.x + place.x), y: round13(r.y - origin.y + place.y) }));
    }
    let childContainer = null;
    const childEdges = () => {
      if (childContainer) return childContainer;
      const existing = kidsOf(rawNode(boardUid)).find((k) => readPlexus(k[PROPS])?.type === "edges");
      if (existing) {
        childContainer = existing[UID];
        return childContainer;
      }
      childContainer = t.create({ parent: boardUid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
      if (track.info) track.info.createdContainer = childContainer;
      return childContainer;
    };
    const taken = /* @__PURE__ */ new Set();
    const touched = [...board2.edges.values()].filter((e) => moved.has(e.from) || moved.has(e.to));
    const snapshots = /* @__PURE__ */ new Map();
    for (const e of touched) {
      const hit = ix().get(e.uid);
      if (hit?.parent) {
        snapshots.set(e.uid, { uid: e.uid, parent: hit.parent[UID], order: kidsOf(hit.parent).indexOf(hit.node), plexus: clone(readPlexus(hit.node[PROPS])), string: hit.node[STR] ?? "" });
      }
    }
    for (const e of touched) {
      const snapshot = snapshots.get(e.uid);
      if (snapshot) track.undoEdges?.push(snapshot);
      if (moved.has(e.from) && moved.has(e.to)) {
        if (snapshot) snapshot.relocated = true;
        t.move(e.uid, childEdges(), "last");
        continue;
      }
      const from = moved.has(e.from) ? boardUid : e.from;
      const to = moved.has(e.to) ? boardUid : e.to;
      const dup = findEdge(board2, from, to);
      const key = `${from}>${to}`;
      if (from === to || dup && dup.uid !== e.uid || taken.has(key)) {
        if (snapshot) snapshot.deleted = true;
        t.del(e.uid);
        continue;
      }
      taken.add(key);
      const fromBlock = moved.has(e.from) ? void 0 : e.fromBlock;
      const toBlock = moved.has(e.to) ? void 0 : e.toBlock;
      t.props(e.uid, edgePlexus(e.uid, { from, to, fromSide: moved.has(e.from) ? "auto" : e.fromSide, toSide: moved.has(e.to) ? "auto" : e.toSide, fromBlock, toBlock }));
      t.string(e.uid, edgeStringFor(from, to, e.dir, e.label, fromBlock, toBlock));
    }
  }
  function makeSection(t, rect, title, color, adopt, lane2) {
    const parent = containerAt(board2, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, { rects });
    const rel = toRelative(board2, parent, { x: rect.x, y: rect.y }, rects);
    const members = adopt ?? itemsInRect(board2, rect, rects, { mode: "contain" });
    const size = clampSize("section", rect.w, rect.h);
    const layout = { type: "section", x: rel.x, y: rel.y, w: size.w, h: size.h, color };
    if (lane2?.look === "lane") {
      layout.look = "lane";
      layout.axis = lane2.axis === "vertical" ? "vertical" : "horizontal";
    }
    const sectionUid = t.create({
      parent,
      string: title,
      plexus: serializeItemLayout(layout)
    });
    for (const id of members) {
      if (id === sectionUid) continue;
      const r = rects.get(id);
      t.move(id, sectionUid, "last");
      t.props(id, itemPlexus(id, { x: round13(r.x - rect.x), y: round13(r.y - rect.y) }));
    }
    return sectionUid;
  }
  if (linkMode !== "off" && board2) refreshLinks();
  const api = {
    uid,
    host,
    settings,
    txn,
    rawNode,
    ix,
    kidsOf,
    rawPlexus,
    itemPlexus,
    edgePlexus,
    insertOrder,
    ensureContainer,
    edgeStringFor,
    refOf: refOf2,
    applyFit,
    board: () => board2,
    rects: () => rects,
    queue,
    isGone: () => gone || destroyed,
    setting,
    clone,
    round1: round13,
    emit: emit2
  };
  for (const fn of [...extensions]) {
    try {
      fn(session, api);
    } catch (err) {
      console.error("[plexus session] extension", err);
    }
  }
  return session;
}
function acquireSession(boardUid, options = {}) {
  const { host } = options;
  const entry = registry.get(boardUid);
  if (entry && entry.host === host) {
    entry.refs++;
    return entry.session;
  }
  if (entry) {
    entry.session.destroy();
    registry.delete(boardUid);
  }
  const session = createSession(boardUid, options);
  const record = { host, session, refs: 1 };
  registry.set(boardUid, record);
  session.release = () => {
    if (registry.get(boardUid) !== record || record.refs <= 0) return;
    record.refs--;
    if (record.refs === 0) {
      session.destroy();
      registry.delete(boardUid);
    }
  };
  return session;
}

// src/session-clip.js
var UID2 = ":block/uid";
var STR2 = ":block/string";
var KIDS2 = ":block/children";
var PROPS2 = ":block/props";
var STACK_GAP = 24;
var OUTLINE_CARD = { w: 240, h: 72 };
var OUTLINE_DEPTH = 3;
var SPREAD_CAP = 22;
var SPREAD_GAP = 40;
function findNode2(node2, uid) {
  if (!node2) return null;
  if (node2[UID2] === uid) return node2;
  for (const c of node2[KIDS2] ?? []) {
    const hit = findNode2(c, uid);
    if (hit) return hit;
  }
  return null;
}
var isEnhancedBoardNode = (node2) => Boolean(node2) && readPlexus(node2[PROPS2])?.v === 2 && classifyString(node2[STR2]).kind === "board";
extendSession((session, api) => {
  const { host } = api;
  const gen = () => host.generateUid();
  function placeCard(t, string, x, y, { w, h, color } = {}, exclude) {
    const board2 = api.board();
    const rects = api.rects();
    const cw = w ?? DEFAULT_SIZES.card.w;
    const ch = h ?? DEFAULT_SIZES.card.h;
    const parent = containerAt(board2, { x: x + cw / 2, y: y + ch / 2 }, { rects, exclude });
    const rel = toRelative(board2, parent, { x, y }, rects);
    const layout = { x: rel.x, y: rel.y };
    if (w !== void 0) layout.w = w;
    if (h !== void 0) layout.h = h;
    if (color) layout.color = color;
    const look = lookForNewString(string, api.setting("default-card-look", "block"));
    if (look) layout.look = look;
    return t.create({ parent, string, plexus: serializeItemLayout(layout) });
  }
  function cloneSet(t, src, entries, exclude) {
    const board2 = api.board();
    const rects = api.rects();
    const at = new Map(entries.map((e) => [e.uid, e]));
    const uidMap = /* @__PURE__ */ new Map();
    const tops = [];
    for (const id of topLevelOf(src.board, entries.map((e) => e.uid))) {
      const e = at.get(id);
      const item = src.board.items.get(id);
      const node2 = src.node(id);
      if (!item || !node2) continue;
      if (item.kind === "board" && !item.enhanced) continue;
      const parent = containerAt(board2, { x: e.x + item.w / 2, y: e.y + item.h / 2 }, { rects, exclude });
      const rel = toRelative(board2, parent, { x: e.x, y: e.y }, rects);
      const x = api.round1(rel.x);
      const y = api.round1(rel.y);
      const simple = item.type === "text" || ["page", "block", "image"].includes(item.kind);
      if (simple) {
        const plexus = { ...readPlexus(node2[PROPS2]) ?? {}, x, y };
        delete plexus.pinned;
        const fresh = gen();
        uidMap.set(id, fresh);
        t.create({ parent, uid: fresh, string: node2[STR2] ?? "", plexus });
        tops.push(fresh);
        continue;
      }
      const patch = { x, y };
      if (item.type === "section") Object.assign(patch, { type: "section", w: item.w, h: item.h });
      const plan = planSubtreeClone(node2, { genUid: gen, parentUid: parent, order: api.insertOrder(parent), plexusPatch: patch, uidMap });
      const oldOf = new Map([...uidMap].map(([o, n2]) => [n2, o]));
      for (const c of plan.creates) {
        const plexus = c.props?.[PLEXUS_KEY] ? { ...c.props[PLEXUS_KEY] } : null;
        if (plexus) {
          if (src.board.items.has(oldOf.get(c.uid))) delete plexus.pinned;
          if (plexus.type === "edge") {
            if (uidMap.has(plexus.from)) plexus.from = uidMap.get(plexus.from);
            if (uidMap.has(plexus.to)) plexus.to = uidMap.get(plexus.to);
          }
        }
        t.create({
          parent: c.parent,
          uid: c.uid,
          string: c.string,
          plexus: plexus && Object.keys(plexus).length ? plexus : void 0,
          order: c.order,
          open: c.open === false ? false : void 0
        });
      }
      tops.push(plan.creates[0].uid);
    }
    const edges = [...src.board.edges.values()].filter((edge) => edge.valid && uidMap.has(edge.from) && uidMap.has(edge.to));
    if (edges.length) {
      const refs = /* @__PURE__ */ new Map();
      for (const [old, fresh] of uidMap) {
        const it = src.board.items.get(old);
        refs.set(fresh, it && (it.kind === "page" || it.kind === "block") ? semanticRef(it) : `((${fresh}))`);
      }
      const containerUid = api.ensureContainer(t);
      for (const c of planEdgeClones(edges, uidMap, { genUid: gen, containerUid, refOfNew: (fresh) => refs.get(fresh) })) {
        t.create({ parent: c.parent, uid: c.uid, string: c.string, plexus: c.props[PLEXUS_KEY], order: "last" });
      }
    }
    return tops;
  }
  const stackAt = (list, x, y) => list.map((string, i) => ({ string, x, y: y + i * (DEFAULT_SIZES.card.h + STACK_GAP) }));
  const outlineOrigin = (preview) => preview.bounds ? { x: preview.bounds.x + preview.bounds.w + 48, y: preview.bounds.y } : { x: 0, y: 0 };
  Object.assign(session, {
    // New top-level uids. asRef=true makes ref cards instead. The pinned flag is not copied.
    duplicateItems(uids, { dx = 24, dy = 24, asRef = false } = {}) {
      return api.txn((t) => {
        const board2 = api.board();
        const rects = api.rects();
        const top = topLevelOf(board2, uids ?? []);
        if (!top.length) return [];
        const exclude = new Set(top);
        let made;
        if (asRef) {
          made = top.map((id) => {
            const r = rects.get(id);
            return placeCard(t, api.refOf(id), r.x + dx, r.y + dy, {}, exclude);
          });
        } else {
          const entries = top.map((id) => ({ uid: id, x: rects.get(id).x + dx, y: rects.get(id).y + dy }));
          made = cloneSet(t, { board: board2, node: api.rawNode }, entries, exclude);
        }
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },
    // A detached copy of the items (and their subtrees and the connections between them) as a synthetic board
    // tree. A cut puts it in the clipboard payload, so the paste no longer depends on the deleted blocks.
    snapshotItems(uids) {
      const board2 = api.board();
      if (!board2) return null;
      const top = topLevelOf(board2, uids ?? []);
      if (!top.length) return null;
      const set = new Set(top);
      for (const id of top) for (const d of descendantsOf(board2, id)) set.add(d);
      const copy = (id) => JSON.parse(JSON.stringify(api.rawNode(id) ?? null));
      const nodes = top.map(copy).filter(Boolean);
      if (!nodes.length) return null;
      const edgeNodes = [...board2.edges.values()].filter((e) => e.valid && set.has(e.from) && set.has(e.to)).map((e) => copy(e.uid)).filter(Boolean);
      if (edgeNodes.length) nodes.push({ [UID2]: "plexus-cut-edges", [STR2]: "Connections", [PROPS2]: { [PLEXUS_KEY]: { type: "edges" } }, [KIDS2]: edgeNodes });
      return { [UID2]: session.uid, [STR2]: "", [KIDS2]: nodes };
    },
    // data comes from parseClipboard (the `plexus` payload or its `.data`). mode 'refs' makes ref cards,
    // 'clone' clones the copied items (from this board or, for another board, from its pulled tree). A payload
    // with a `snapshot` (a cut) is always cloned from the snapshot: the source blocks are gone.
    pasteItems(data, { x = 0, y = 0, mode = "refs" } = {}) {
      const payload = data?.kind === "plexus" ? data.data : data;
      if (!payload || !Array.isArray(payload.items) || !payload.items.length) return Promise.resolve([]);
      if (payload.snapshot && typeof payload.snapshot === "object") mode = "clone";
      return api.txn((t) => {
        let made;
        if (mode === "clone") {
          let src;
          if (payload.snapshot && typeof payload.snapshot === "object") {
            const board2 = buildBoard(payload.snapshot);
            if (!board2) return [];
            src = { board: board2, node: (id) => findNode2(payload.snapshot, id) };
          } else if (payload.board === session.uid) src = { board: api.board(), node: api.rawNode };
          else {
            const pulled = host.pullBoard(payload.board);
            const board2 = pulled ? buildBoard(pulled) : null;
            if (!board2) return [];
            src = { board: board2, node: (id) => findNode2(pulled, id) };
          }
          const bounds = payload.bounds ?? boundsOf(payload.items) ?? { x: 0, y: 0 };
          const entries = payload.items.map((i) => ({ uid: i.uid, x: x + (i.x - bounds.x), y: y + (i.y - bounds.y) }));
          made = cloneSet(t, src, entries);
        } else {
          made = capBulk(refCardStrings(payload, { x, y }), api.emit).map((c) => placeCard(t, c.string, c.x, c.y, { w: c.w, h: c.h, color: c.color }));
        }
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },
    // text: raw clipboard text or the entries parsePastedText returned.
    pasteText(text2, { x = 0, y = 0 } = {}) {
      const list = (Array.isArray(text2) ? text2 : parsePastedText(text2)).map((e) => typeof e === "string" ? e : e?.string).filter((s) => typeof s === "string" && s.trim() !== "");
      if (!list.length) return Promise.resolve([]);
      return api.txn((t) => {
        const made = capBulk(stackAt(list, x, y), api.emit).map((c) => placeCard(t, c.string, c.x, c.y));
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },
    // Adds ref cards for the items to the right of the target board's content. Resolves {added, title} or null.
    sendToBoard(uids, targetUid) {
      const board2 = api.board();
      if (!board2 || !targetUid || targetUid === session.uid) return Promise.resolve(null);
      const top = topLevelOf(board2, uids ?? []).filter((id) => id !== targetUid);
      if (!top.length) return Promise.resolve(null);
      const node2 = api.rawNode(targetUid);
      if (node2) {
        if (!isEnhancedBoardNode(node2)) return Promise.resolve(null);
        const origin2 = outlineOrigin(boardPreview({ uid: targetUid, string: node2[STR2], content: node2[KIDS2] ?? [] }));
        const title = parseBoardTitle(node2[STR2]) || UNTITLED_BOARD;
        return api.txn((t) => {
          for (const c of stackAt(top.map((id) => api.refOf(id)), origin2.x, origin2.y)) {
            t.create({ parent: targetUid, string: c.string, plexus: serializeItemLayout({ x: c.x, y: c.y }) });
          }
          return { added: top.length, title };
        }).then((res) => res ?? null);
      }
      const pulled = host.pullBoard(targetUid);
      if (!isEnhancedBoardNode(pulled)) return Promise.resolve(null);
      const target = buildBoard(pulled);
      const origin = outlineOrigin(boardPreview({ uid: targetUid, string: pulled[STR2], content: pulled[KIDS2] ?? [] }));
      const cards = stackAt(top.map((id) => api.refOf(id)), origin.x, origin.y);
      return api.queue.run(async () => {
        for (let i = 0; i < cards.length; i++) {
          await host.createBlock({
            parentUid: targetUid,
            order: target.containerIndex >= 0 ? target.containerIndex + i : "last",
            string: cards[i].string,
            props: { [PLEXUS_KEY]: serializeItemLayout({ x: cards[i].x, y: cards[i].y }) }
          });
        }
        return { added: cards.length, title: target.title || UNTITLED_BOARD };
      }).catch((err) => {
        console.error("[plexus session] sendToBoard", err);
        api.emit("toast", { message: "Couldn't send the cards to that board." });
        return null;
      });
    },
    // CH-4: one block-ref card per direct child in a column right of the card, an arrow from the card to each.
    // Children already on the board as ref cards are skipped. Two writes per child, so the cap is 22.
    spreadChildren(cardUid) {
      const none = { added: 0, skipped: 0 };
      const board2 = api.board();
      const item = board2?.items.get(cardUid);
      if (!item || item.type !== "card") return Promise.resolve(none);
      let kids;
      if (item.kind === "note") kids = (item.content ?? []).map((n2) => ({ uid: n2[UID2] ?? n2.uid, string: n2[STR2] ?? n2.string ?? "" }));
      else if (item.kind === "block") kids = (host.pullTree(item.target.uid, 1, 60) ?? []).map((n2) => ({ uid: n2[UID2] ?? n2.uid, string: n2[STR2] ?? n2.string ?? "" }));
      else return Promise.resolve(none);
      const onBoard = /* @__PURE__ */ new Set();
      for (const it of board2.items.values()) if (it.kind === "block" && it.target?.uid) onBoard.add(it.target.uid);
      const seen = /* @__PURE__ */ new Set();
      const fresh = [];
      let skipped = 0;
      for (const k of kids) {
        if (!k.uid || seen.has(k.uid)) continue;
        seen.add(k.uid);
        if (/^BT_attrDue::/.test(String(k.string).trim())) continue;
        if (onBoard.has(k.uid)) {
          skipped++;
          continue;
        }
        fresh.push(k);
      }
      if (!fresh.length) return Promise.resolve({ added: 0, skipped });
      const list = fresh.length > SPREAD_CAP ? fresh.slice(0, SPREAD_CAP) : fresh;
      if (fresh.length > SPREAD_CAP) api.emit("toast", { message: `Added ${SPREAD_CAP} of ${fresh.length} (Roam undo holds 50 changes)` });
      const own = api.rects().get(cardUid);
      if (!own) return Promise.resolve(none);
      const x = own.x + own.w + SPREAD_GAP;
      return api.txn((t) => {
        const refOfCard = api.refOf(cardUid);
        const container = api.ensureContainer(t);
        const made = [];
        let y = own.y;
        for (const k of list) {
          const id = placeCard(t, `((${k.uid}))`, x, y);
          made.push(id);
          t.create({
            parent: container,
            order: "last",
            string: edgeString({ srcRef: refOfCard, dstRef: `((${k.uid}))`, dir: "one", label: "" }),
            plexus: serializeEdge({ from: cardUid, to: id, dir: "one" })
          });
          y += DEFAULT_SIZES.card.h + STACK_GAP;
        }
        api.applyFit(t, made);
        return { added: made.length, skipped, total: fresh.length };
      }).then((res) => res ?? none);
    },
    // The source card's child blocks become a mind map of ref cards (blocks stay canonical in Roam) plus one
    // connection per parent -> child. Children that already have a card on this board are reused, not moved.
    // Options default to the pre-preset behavior: right, normal gaps, depth 3, refs included, no branch color.
    expandOutline(cardUid, options = {}) {
      const none = { added: 0, edges: 0 };
      const opts = options && typeof options === "object" ? options : {};
      const max = Number.isFinite(opts.max) ? opts.max : 24;
      const preset = normalizeMindPreset({
        direction: opts.direction,
        spacing: opts.spacing,
        depth: opts.depth ?? OUTLINE_DEPTH,
        includeRefs: opts.includeRefs,
        colorBranches: opts.colorBranches
      });
      const gaps = MIND_GAPS[preset.spacing];
      const board2 = api.board();
      const item = board2?.items.get(cardUid);
      if (!item || item.type !== "card") return Promise.resolve(none);
      const plain = (list) => list.filter((n2) => n2?.uid).map((n2) => ({
        uid: n2.uid,
        string: n2.string ?? "",
        children: plain(n2.children ?? [])
      }));
      const rawTree = (list) => list.filter((n2) => n2?.[UID2]).map((n2) => ({
        uid: n2[UID2],
        string: n2[STR2] ?? "",
        children: rawTree(api.kidsOf(n2))
      }));
      let tree;
      if (item.kind === "note") tree = rawTree(api.kidsOf({ [KIDS2]: item.content }));
      else if (item.kind === "block") tree = plain(host.pullTree(item.target.uid, preset.depth, max) ?? []);
      else if (item.kind === "page") tree = plain(host.pagePreview(item.target.title, preset.depth, max)?.blocks ?? []);
      else return Promise.resolve(none);
      const flat = [];
      const walk = (list, depth, parent) => {
        for (const n2 of list) {
          if (depth > preset.depth || flat.some((f) => f.uid === n2.uid)) continue;
          if (!preset.includeRefs && classifyString(n2.string).kind === "block") continue;
          const entry = { uid: n2.uid, depth, parent, at: flat.length };
          flat.push(entry);
          walk(n2.children, depth + 1, n2.uid);
        }
      };
      walk(tree, 1, null);
      const chosen = new Set([...flat].sort((a, b) => a.depth - b.depth || a.at - b.at).slice(0, Math.max(0, max)).map((f) => f.uid));
      const picked = flat.filter((f) => chosen.has(f.uid));
      if (!picked.length) return Promise.resolve(none);
      const rects = api.rects();
      const own = rects.get(cardUid);
      const onBoard = /* @__PURE__ */ new Map();
      for (const it of board2.items.values()) {
        if (it.uid !== cardUid && it.kind === "block" && !onBoard.has(it.target.uid)) onBoard.set(it.target.uid, it.uid);
      }
      const nodes = new Map(picked.map((f) => {
        const have = onBoard.get(f.uid);
        const r = have ? rects.get(have) : null;
        return [f.uid, { uid: f.uid, w: r?.w ?? OUTLINE_CARD.w, h: r?.h ?? OUTLINE_CARD.h, children: [] }];
      }));
      const root = { uid: cardUid, w: own.w, h: own.h, children: [] };
      for (const f of picked) (f.parent && nodes.has(f.parent) ? nodes.get(f.parent) : root).children.push(nodes.get(f.uid));
      const layout = mindMapLayout(root, { direction: preset.direction, hGap: gaps.hGap, vGap: gaps.vGap });
      const colorOf = /* @__PURE__ */ new Map();
      if (preset.colorBranches) {
        let branch = 0;
        for (const f of picked) {
          if (f.parent && colorOf.has(f.parent)) colorOf.set(f.uid, colorOf.get(f.parent));
          else colorOf.set(f.uid, branchColor(branch++));
        }
      }
      return api.txn((t) => {
        const cardOf = /* @__PURE__ */ new Map();
        const refOfCard = /* @__PURE__ */ new Map([[cardUid, api.refOf(cardUid)]]);
        const created = [];
        const shift = /* @__PURE__ */ new Map();
        for (const f of picked) {
          const p = layout.get(f.uid);
          const have = onBoard.get(f.uid);
          if (have) {
            const r = rects.get(have);
            shift.set(f.uid, r ? { dx: r.x - (own.x + p.x), dy: r.y - (own.y + p.y) } : { dx: 0, dy: 0 });
            cardOf.set(f.uid, have);
            refOfCard.set(have, api.refOf(have));
            continue;
          }
          const inherited = shift.get(f.parent) ?? { dx: 0, dy: 0 };
          const spec = colorOf.has(f.uid) ? { ...OUTLINE_CARD, color: colorOf.get(f.uid) } : OUTLINE_CARD;
          const id = placeCard(t, `((${f.uid}))`, own.x + p.x + inherited.dx, own.y + p.y + inherited.dy, spec);
          cardOf.set(f.uid, id);
          refOfCard.set(id, `((${f.uid}))`);
          created.push(id);
        }
        let edges = 0;
        let container = null;
        for (const f of picked) {
          const from = f.parent && cardOf.has(f.parent) ? cardOf.get(f.parent) : cardUid;
          const to = cardOf.get(f.uid);
          if (from === to || findEdge(board2, from, to)) continue;
          container ?? (container = api.ensureContainer(t));
          t.create({
            parent: container,
            order: "last",
            string: edgeString({ srcRef: refOfCard.get(from), dstRef: refOfCard.get(to), dir: "one", label: "" }),
            plexus: serializeEdge({ from, to, dir: "one" })
          });
          edges++;
        }
        api.applyFit(t, created);
        const skipped = flat.length - picked.length;
        return skipped > 0 ? { added: created.length, edges, skipped, total: flat.length } : { added: created.length, edges };
      }).then((res) => res ?? none);
    }
  });
});

// src/model/templates.js
var TEMPLATE_PAGE = "Plexus Diagram/Templates";
var TEMPLATE_WRITE_CAP = 45;
var node = (id, string, plexus, children = [], open = false) => ({
  ":block/uid": id,
  ":block/string": string,
  ":block/props": plexus ? { plexus } : void 0,
  ":block/children": children,
  ":block/open": open
});
var card = (id, string, x, y, w = 260, h = 140) => node(id, string, { type: "card", x, y, w, h, v: 2 });
var section = (id, title, x, y, w = 300, h = 220) => node(id, title, { type: "section", x, y, w, h, v: 2 });
var board = (id, title, children) => node(id, boardString(title), { v: 2 }, children, false);
var text = (id, string, x, y, shape, w = 200, h = 110) => node(id, string, { type: "text", x, y, w, h, shape, fontSize: 16, v: 2 });
var lane = (id, title, x, y, w, h, axis, children) => node(
  id,
  title,
  { type: "section", look: "lane", axis, x, y, w, h, v: 2 },
  children,
  true
);
function flow() {
  const lanes = [
    lane("in", "Warehouse", 0, 0, 480, 360, "vertical", [
      text("recv", "Receiving", 40, 40, "parallelogram"),
      text("store", "Storage", 300, 40, "cylinder")
    ]),
    lane("make", "Process", 480, 0, 280, 360, "vertical", [
      text("spec", "In spec?", 80, 20, "diamond", 200, 150),
      text("blend", "Blending", 80, 230, "rectangle")
    ]),
    lane("out", "Pack", 760, 0, 540, 360, "vertical", [
      text("fill", "Filling", 60, 230, "rounded"),
      text("pack", "Packing", 320, 230, "ellipse")
    ])
  ];
  const link = (id, from, to, label = "", sides = {}) => node(
    id,
    edgeString({ srcRef: `((${from}))`, dstRef: `((${to}))`, dir: "one", label }),
    { type: "edge", from, to, dir: "one", ...sides }
  );
  const edges = [
    link("e0", "recv", "store"),
    link("e1", "store", "spec"),
    link("ey", "spec", "blend", "Yes", { fromSide: "bottom", toSide: "top" }),
    link("en", "spec", "recv", "No", { fromSide: "top", toSide: "top" }),
    link("e4", "blend", "fill"),
    link("e5", "fill", "pack")
  ];
  return [...lanes, node("edges", "Connections", { type: "edges" }, edges, false)];
}
var row = (labels, y = 40, w = 300, h = 360, gap = 24) => labels.map((title, i) => section(
  `c${i}`,
  title,
  40 + i * (w + gap),
  y,
  w,
  h
));
var STARTERS = [
  { id: "five-why", title: "5-Why", tree: board("root", "5-Why", [1, 2, 3, 4, 5].map((n2) => card(`w${n2}`, `Why ${n2}`, 40, 40 + (n2 - 1) * 160))) },
  { id: "fishbone", title: "Fishbone (6M)", tree: board("root", "Fishbone (6M)", row(["Man", "Machine", "Method", "Material", "Measurement", "Environment"], 40, 240, 280, 16)) },
  { id: "8d", title: "8D", tree: board("root", "8D", row(["D1 Team", "D2 Problem", "D3 Containment", "D4 Root cause", "D5 Action", "D6 Implement", "D7 Prevent", "D8 Congratulate"], 40, 220, 240, 16)) },
  { id: "swot", title: "SWOT", tree: board("root", "SWOT", row(["Strengths", "Weaknesses", "Opportunities", "Threats"])) },
  { id: "kanban", title: "Kanban", tree: board("root", "Kanban", row(["To do", "Doing", "Done"])) },
  { id: "timeline", title: "Timeline", tree: board("root", "Timeline", ["Start", "Middle", "Next", "End"].map((title, i) => card(`t${i}`, title, 40 + i * 300, 80, 240, 120))) },
  { id: "process", title: "Process flow", tree: board("root", "Process flow", flow()) },
  { id: "meeting", title: "Meeting notes", tree: board("root", "Meeting notes", row(["Agenda", "Notes", "Actions"])) },
  { id: "retro", title: "Retro", tree: board("root", "Retro", row(["Went well", "To improve", "Actions"])) }
];
function starterById(id) {
  return STARTERS.find((s) => s.id === id) ?? null;
}
function rewriteEdgeEnds(creates, uidMap) {
  return creates.map((op) => {
    const px = op.props?.plexus;
    if (!px || px.type !== "edge") return op;
    const from = uidMap.has(px.from) ? uidMap.get(px.from) : px.from;
    const to = uidMap.has(px.to) ? uidMap.get(px.to) : px.to;
    return { ...op, props: { ...op.props, plexus: { ...px, from, to } } };
  });
}
function chunkCreates(creates, cap2 = TEMPLATE_WRITE_CAP) {
  const size = cap2 > 0 ? cap2 : TEMPLATE_WRITE_CAP;
  const chunks = [];
  for (let i = 0; i < creates.length; i += size) chunks.push(creates.slice(i, i + size));
  return chunks;
}
function planCopy(tree, { genUid, parentUid, plexusPatch = null } = {}) {
  const plan = planSubtreeClone(tree, { genUid, parentUid, plexusPatch });
  const creates = rewriteEdgeEnds(plan.creates, plan.uidMap);
  return { rootUid: creates[0]?.uid ?? null, creates, chunks: chunkCreates(creates), uidMap: plan.uidMap };
}
function planTemplate(id, opts) {
  const starter = starterById(id);
  if (!starter) return null;
  return { ...planCopy(starter.tree, opts), id: starter.id, title: starter.title };
}

// src/templates.js
var round14 = (n2) => Math.round(n2 * 10) / 10;
async function writeChunks(chunks, write, toast) {
  for (let i = 0; i < chunks.length; i += 1) {
    await write(chunks[i]);
    if (chunks.length > 1) toast(`Template ${i + 1} of ${chunks.length}`);
  }
}
extendSession((session, api) => {
  const { host } = api;
  session.insertTemplate = (id, rect) => {
    const starter = starterById(id);
    const board2 = api.board();
    if (!starter || !board2) return Promise.resolve(null);
    const d = DEFAULT_BOARD_CARD;
    const r = { x: rect?.x ?? 0, y: rect?.y ?? 0, w: rect?.w ?? d.w, h: rect?.h ?? d.h };
    const parent = containerAt(board2, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, { rects: api.rects() });
    const rel = toRelative(board2, parent, { x: r.x, y: r.y }, api.rects());
    const plan = planTemplate(id, {
      genUid: () => host.generateUid(),
      parentUid: parent,
      plexusPatch: { x: round14(rel.x), y: round14(rel.y), w: r.w, h: r.h, v: 2 }
    });
    if (!plan?.creates.length) return Promise.resolve(null);
    const rootUid = plan.rootUid;
    return writeChunks(plan.chunks, (chunk) => api.txn((t) => {
      for (const op of chunk) {
        t.create({
          uid: op.uid,
          parent: op.parent,
          order: op.order,
          string: op.string,
          plexus: op.props?.plexus,
          open: op.open
        });
      }
    }), (message) => api.emit("toast", { message })).then(() => {
      api.emit("toast", {
        message: `Inserted ${starter.title}`,
        action: { label: "Undo", run: () => api.txn((t) => t.del(rootUid)) }
      });
      return rootUid;
    });
  };
  session.saveAsTemplate = async () => {
    const tree = api.rawNode(api.uid);
    if (!tree) return null;
    const pageUid = await host.ensurePage?.(TEMPLATE_PAGE);
    if (!pageUid) {
      api.emit("toast", { message: "Couldn't open the templates page." });
      return null;
    }
    const plan = planCopy(tree, { genUid: () => host.generateUid(), parentUid: pageUid });
    if (!plan.creates.length) return null;
    const rootUid = plan.rootUid;
    await writeChunks(plan.chunks, async (chunk) => {
      await host.group(async () => {
        for (const op of chunk) {
          await host.createBlock({
            parentUid: op.parent,
            order: op.order,
            uid: op.uid,
            string: op.string,
            props: op.props,
            open: op.open
          });
        }
      });
    }, (message) => api.emit("toast", { message }));
    api.emit("toast", {
      message: "Saved board as template",
      action: { label: "Undo", run: () => host.deleteBlock(rootUid) }
    });
    return rootUid;
  };
});

// src/snapshots.js
extendSession((session, api) => {
  session.saveSnapshot = (now2 = /* @__PURE__ */ new Date()) => {
    const board2 = api.board();
    if (!board2) return Promise.resolve(null);
    const title = snapshotTitle(now2);
    if (!title) return Promise.resolve(null);
    const items = captureLayout(board2);
    return api.txn((t) => {
      let parent = board2.snapshotsUid;
      if (!parent) {
        parent = t.create({
          parent: api.uid,
          string: SNAPSHOTS_TITLE,
          plexus: { type: "snapshots" },
          open: false
        });
      }
      return t.create({
        parent,
        string: title,
        plexus: snapshotProps(items)
      });
    });
  };
  session.restoreSnapshot = async (snapUid) => {
    const board2 = api.board();
    const snap = board2?.snapshots?.find((item) => item.uid === snapUid);
    if (!snap) return false;
    const chunks = planRestore(snap.items, board2);
    for (const chunk of chunks) {
      await api.txn((t) => {
        for (const op of chunk) {
          if (op.op === "move") t.move(op.uid, op.parent);
          else {
            t.props(op.uid, api.itemPlexus(op.uid, {
              x: op.x,
              y: op.y,
              w: op.w,
              h: op.h,
              color: op.color || void 0,
              collapsed: op.collapsed ? true : void 0
            }));
          }
        }
      });
    }
    api.emit("toast", { message: `Restored ${snap.title}` });
    return true;
  };
  session.deleteSnapshot = (snapUid) => api.txn((t) => {
    const snap = api.board()?.snapshots?.find((item) => item.uid === snapUid);
    if (!snap) return false;
    t.del(snapUid);
    return true;
  });
});

// src/lifecycle.js
function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}
async function callSafely(disposer) {
  const result = disposer();
  if (isPromiseLike(result)) await result;
}
function createLifecycle() {
  let disposed = false;
  const disposers = [];
  const add = (disposer) => {
    if (typeof disposer !== "function") throw new TypeError("A disposer must be a function");
    if (disposed) {
      void callSafely(disposer).catch((error) => console.error("[plexus-diagram] Late cleanup failed", error));
      return disposer;
    }
    disposers.push(disposer);
    return disposer;
  };
  return {
    get disposed() {
      return disposed;
    },
    add,
    async command(commandApi, config) {
      if (!commandApi?.addCommand || !commandApi?.removeCommand) {
        throw new TypeError("A command API with addCommand/removeCommand is required");
      }
      await commandApi.addCommand(config);
      add(() => commandApi.removeCommand({ label: config.label }));
    },
    event(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      add(() => target.removeEventListener(type, listener, options));
      return listener;
    },
    interval(callback, delay, ...args) {
      const id = globalThis.setInterval(callback, delay, ...args);
      add(() => globalThis.clearInterval(id));
      return id;
    },
    timeout(callback, delay, ...args) {
      const id = globalThis.setTimeout(callback, delay, ...args);
      add(() => globalThis.clearTimeout(id));
      return id;
    },
    observer(observer, target, options) {
      observer.observe(target, options);
      add(() => observer.disconnect());
      return observer;
    },
    node(node2, parent = globalThis.document?.body) {
      if (!parent) throw new Error("A parent node is required outside the browser");
      parent.append(node2);
      add(() => node2.remove());
      return node2;
    },
    pullWatch(dataApi, pattern, entity, callback) {
      if (!dataApi?.addPullWatch || !dataApi?.removePullWatch) {
        throw new TypeError("A Roam data API with addPullWatch/removePullWatch is required");
      }
      dataApi.addPullWatch(pattern, entity, callback);
      add(() => dataApi.removePullWatch(pattern, entity, callback));
      return callback;
    },
    async settingsPanel(extensionAPI, config) {
      await extensionAPI.settings.panel.create(config);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const disposer of disposers.splice(0).reverse()) {
        try {
          await callSafely(disposer);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "One or more extension cleanups failed");
    }
  };
}

// package.json
var package_default = {
  name: "plexus-diagram",
  version: "2.0.0",
  private: true,
  description: "Heptabase-style whiteboard for Roam {{[[diagram]]}} blocks: cards, colored sections, and connections that are real Roam blocks and links",
  type: "module",
  main: "extension.js",
  scripts: {
    build: "node build.mjs",
    dev: "node build.mjs --watch",
    "scan:secrets": "node scripts/scan-secrets.mjs",
    test: "node --test test/*.test.js",
    "verify:generated": "node scripts/verify-generated.mjs",
    check: "npm run build && npm run scan:secrets && node --check extension.js && npm test && npm run verify:generated"
  },
  engines: {
    node: ">=20"
  },
  devDependencies: {
    esbuild: "0.28.1"
  },
  license: "MIT"
};

// src/model/find.js
function hayOf(item) {
  const bits = [item?.title, plainText(item?.string, 2e3)];
  const kids = Array.isArray(item?.content) ? item.content : [];
  for (const kid of kids) bits.push(plainText(kid?.[":block/string"] ?? kid?.string ?? "", 500));
  return bits.filter(Boolean).join("\n").toLowerCase();
}
function findOnBoard(board2, query, nested = []) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || !board2?.items) return [];
  const hits = [];
  for (const item of board2.items.values()) {
    if (!hayOf(item).includes(q)) continue;
    hits.push({ uid: item.uid, focus: item.uid, kind: item.type === "section" ? "section" : "card" });
  }
  for (const edge of board2.edges?.values?.() || []) {
    const label = `${edge.label || ""}
${plainText(edge.string, 500)}`.toLowerCase();
    if (!label.includes(q)) continue;
    hits.push({ uid: edge.uid, focus: edge.from, kind: "edge" });
  }
  for (const nest of nested || []) {
    if (!nest?.board || !nest.parentUid) continue;
    for (const hit of findOnBoard(nest.board, query)) {
      hits.push({ uid: hit.uid, focus: nest.parentUid, kind: "nested", via: nest.parentUid });
    }
  }
  return hits;
}

// src/model/attr-styles.js
var ATTR_DASHES = ["solid", "dashed", "dotted"];
function parseAttrStyles(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    const text2 = raw.trim();
    if (!text2) return {};
    try {
      obj = JSON.parse(text2);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [name, spec] of Object.entries(obj)) {
    const key = String(name).trim();
    if (!key || !spec || typeof spec !== "object" || Array.isArray(spec)) continue;
    const row2 = {};
    if (PALETTE.includes(spec.color)) row2.color = spec.color;
    if (ATTR_DASHES.includes(spec.dash)) row2.dash = spec.dash;
    if (row2.color || row2.dash) out[key] = row2;
  }
  return out;
}
function attrName(link) {
  return link?.kind === "attr" ? link.labels?.[0] || "" : "";
}
function styleAttrLinks(links, styles, hidden) {
  const hide = hidden instanceof Set ? hidden : new Set(hidden || []);
  const map = styles && typeof styles === "object" && !Array.isArray(styles) ? styles : {};
  const out = [];
  for (const link of links || []) {
    const name = attrName(link);
    if (name && hide.has(name)) continue;
    const spec = name ? map[name] : null;
    if (!spec) {
      out.push(link);
      continue;
    }
    const next = { ...link };
    if (spec.color) next.color = spec.color;
    if (spec.dash) next.dash = spec.dash;
    out.push(next);
  }
  return out;
}
function attrLegend(links, hidden, styles) {
  const hide = hidden instanceof Set ? hidden : new Set(hidden || []);
  const map = styles && typeof styles === "object" && !Array.isArray(styles) ? styles : {};
  const seen = /* @__PURE__ */ new Set();
  const rows = [];
  for (const link of links || []) {
    const name = attrName(link);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const spec = map[name];
    rows.push({
      name,
      color: spec?.color || link.color || "gray",
      dash: spec?.dash || "dashed",
      on: !hide.has(name)
    });
  }
  return rows;
}

// src/model/lens.js
function tagsForCard(item, extra = "") {
  const parts = [];
  if (item?.string) parts.push(String(item.string));
  for (const kid of item?.content || []) {
    const text2 = kid?.[":block/string"] ?? kid?.string ?? "";
    if (text2) parts.push(String(text2));
  }
  if (extra) parts.push(String(extra));
  return tagNames(parts.join("\n"));
}
function lensCatalog(cards) {
  const tags = [];
  const seen = /* @__PURE__ */ new Set();
  const byUid = /* @__PURE__ */ new Map();
  for (const card2 of cards || []) {
    if (!card2?.uid) continue;
    const list = [];
    for (const tag of card2.tags || []) {
      const name = String(tag || "").trim();
      if (!name || list.includes(name)) continue;
      list.push(name);
      if (!seen.has(name)) {
        seen.add(name);
        tags.push(name);
      }
    }
    byUid.set(card2.uid, list);
  }
  return { tags, byUid };
}
function lensBright(byUid, tag, focusSet = null) {
  const name = String(tag || "").trim();
  if (!name) return focusSet ? new Set(focusSet) : null;
  const bright = /* @__PURE__ */ new Set();
  for (const [uid, tags] of byUid || []) {
    if ((tags || []).includes(name)) bright.add(uid);
  }
  if (!focusSet) return bright;
  const both = /* @__PURE__ */ new Set();
  for (const uid of bright) if (focusSet.has(uid)) both.add(uid);
  return both;
}

// src/model/export.js
var HEX = {
  light: {
    gray: ["#6b7280", "#f3f4f6", "#374151"],
    red: ["#dc2626", "#fef2f2", "#991b1b"],
    orange: ["#ea580c", "#fff7ed", "#9a3412"],
    yellow: ["#ca8a04", "#fefce8", "#854d0e"],
    green: ["#16a34a", "#f0fdf4", "#166534"],
    teal: ["#0d9488", "#f0fdfa", "#115e59"],
    blue: ["#2563eb", "#eff6ff", "#1e40af"],
    indigo: ["#4f46e5", "#eef2ff", "#3730a3"],
    purple: ["#9333ea", "#faf5ff", "#6b21a8"],
    pink: ["#db2777", "#fdf2f8", "#9d174d"]
  },
  dark: {
    gray: ["#9ca3af", "#2b3540", "#d1d5db"],
    red: ["#f87171", "#3a2a30", "#fca5a5"],
    orange: ["#fb923c", "#3a3028", "#fdba74"],
    yellow: ["#facc15", "#38351f", "#fde047"],
    green: ["#4ade80", "#22392e", "#86efac"],
    teal: ["#2dd4bf", "#1f3a3a", "#5eead4"],
    blue: ["#60a5fa", "#232f45", "#93c5fd"],
    indigo: ["#818cf8", "#2a2f4a", "#a5b4fc"],
    purple: ["#c084fc", "#35284a", "#d8b4fe"],
    pink: ["#f472b6", "#3f2838", "#f9a8d4"]
  }
};
var THEME = {
  light: { bg: "#ffffff", card: "#ffffff", border: "#d0d7de", text: "#1f2937", muted: "#5f6b7c", edge: "#6b7a8a" },
  dark: { bg: "#1e2a35", card: "#26333f", border: "#3b4b58", text: "#e6edf3", muted: "#a7b6c2", edge: "#a7b6c2" }
};
var esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
var n1 = (n2) => Math.round(n2 * 10) / 10;
var titleOf = (item) => {
  if (item.title) return item.title;
  if (item.kind === "image") return "Image";
  return item.string || "Untitled";
};
function imageSrc(string) {
  const m = /!\[[^\]]*\]\(([^)]*)\)/.exec(String(string ?? "").trim());
  return m ? m[1].trim() : "";
}
function pngFileName({ boardTitle: boardTitle2 = "", pageTitle = "", date = "" } = {}) {
  const board2 = String(boardTitle2 ?? "").trim();
  const page = String(pageTitle ?? "").trim();
  const named = board2 && board2.toLowerCase() !== UNTITLED_BOARD.toLowerCase();
  const raw = (named ? board2 : page) || board2 || "board";
  const name = raw.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "board";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : "1970-01-01";
  return `${name} ${day}.png`;
}
function sliceBoard(board2, uids) {
  const want = new Set(uids || []);
  const items = /* @__PURE__ */ new Map();
  const order = [];
  for (const uid of board2?.order || []) {
    if (!want.has(uid)) continue;
    const item = board2.items.get(uid);
    if (!item) continue;
    items.set(uid, item);
    order.push(uid);
  }
  const edges = /* @__PURE__ */ new Map();
  for (const [uid, edge] of board2?.edges || []) {
    if (edge?.valid && want.has(edge.from) && want.has(edge.to)) edges.set(uid, edge);
  }
  return { ...board2, items, order, edges };
}
function dropExternalImages(svg) {
  return String(svg ?? "").replace(/<image\b[^>]*\/>/g, (tag) => {
    const href = /\shref="([^"]*)"/.exec(tag);
    if (!href) return tag;
    const value = href[1].replace(/&amp;/g, "&");
    return value.startsWith("data:") ? tag : "";
  });
}
var imageHrefOf = (item, imageHrefs) => {
  if (!imageHrefs || item.kind !== "image") return "";
  const href = typeof imageHrefs.get === "function" ? imageHrefs.get(item.uid) : imageHrefs[item.uid];
  return typeof href === "string" && href.startsWith("data:") ? href : "";
};
function boardToSvg(board2, rects, { dark = false, padding = 48, maxItems = 500, imageHrefs = null } = {}) {
  const mode = dark ? "dark" : "light";
  const theme = THEME[mode];
  const hex = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/.test(color) ? [color, color, color] : HEX[mode][PALETTE.includes(color) ? color : "gray"];
  const included = [];
  for (const uid of board2.order) {
    if (included.length >= maxItems) break;
    if (rects.get(uid)) included.push(board2.items.get(uid));
  }
  const inSet = new Set(included.map((i) => i.uid));
  const drawnEdges = [];
  for (const edge of board2.edges.values()) {
    if (!edge.valid || !inSet.has(edge.from) || !inSet.has(edge.to)) continue;
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    if (!a || !b) continue;
    drawnEdges.push({ edge, path: edgePath({ a, b, fromSide: edge.fromSide, toSide: edge.toSide, route: edge.route }) });
  }
  const rawBounds = boundsOf(included.map((i) => rects.get(i.uid))) ?? { x: 0, y: 0, w: 0, h: 0 };
  const bounds = { x: rawBounds.x, y: rawBounds.y, w: rawBounds.w, h: rawBounds.h };
  let minX = bounds.x;
  let minY = bounds.y;
  let maxX = bounds.x + bounds.w;
  let maxY = bounds.y + bounds.h;
  for (const { path } of drawnEdges) {
    for (const p of path.points || [path.start, path.end, path.mid]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  bounds.x = minX;
  bounds.y = minY;
  bounds.w = Math.max(0, maxX - minX);
  bounds.h = Math.max(0, maxY - minY);
  const vx = bounds.x - padding;
  const vy = bounds.y - padding;
  const vw = Math.max(1, bounds.w + padding * 2);
  const vh = Math.max(1, bounds.h + padding * 2);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(vx)} ${n1(vy)} ${n1(vw)} ${n1(vh)}" width="${n1(vw)}" height="${n1(vh)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
  out.push(`<title>${esc(board2.title || "Board")}</title>`);
  out.push(`<rect x="${n1(vx)}" y="${n1(vy)}" width="${n1(vw)}" height="${n1(vh)}" fill="${theme.bg}"/>`);
  const defs = [];
  const body = [];
  included.forEach((item, index) => {
    const r = rects.get(item.uid);
    const [line, fill, text2] = hex(item.color);
    if (item.type === "section") {
      const lane2 = item.look === "lane";
      const rx = lane2 ? 0 : 12;
      body.push(`<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${n1(r.w)}" height="${n1(r.h)}" rx="${rx}" fill="${fill}" fill-opacity="${dark ? 0.6 : 1}" stroke="${line}" stroke-width="2"/>`);
      if (lane2 && item.axis !== "vertical") {
        body.push(`<text x="${n1(r.x + 12)}" y="${n1(r.y + r.h / 2)}" font-size="16" font-weight="700" dominant-baseline="central" fill="${text2}">${esc(titleOf(item))}</text>`);
      } else {
        body.push(`<text x="${n1(r.x + 4)}" y="${n1(r.y - 10)}" font-size="16" font-weight="700" fill="${text2}">${esc(titleOf(item))}</text>`);
      }
    } else if (item.type === "text") {
      const size = item.fontSize || 16;
      if (SHAPES.includes(item.shape)) {
        const paint2 = item.fill ? hex(item.fill)[1] : theme.card;
        const stroke = item.border ? hex(item.border)[0] : item.color ? line : theme.border;
        const ink = item.textColor ? hex(item.textColor)[2] : theme.text;
        body.push(`<path d="${shapePath(r, item.shape)}" fill="${paint2}" stroke="${stroke}" stroke-width="2"/>`);
        body.push(`<text x="${n1(r.x + r.w / 2)}" y="${n1(r.y + r.h / 2)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="${ink}">${esc(titleOf(item))}</text>`);
      } else if (item.look === "sticky") {
        const paper = item.fill ? hex(item.fill)[1] : item.color ? fill : hex("yellow")[1];
        const ink = item.textColor ? hex(item.textColor)[2] : item.color ? text2 : hex("yellow")[2];
        if (!defs.some((d) => d.includes("pxd-sticky-shadow"))) {
          defs.push(`<filter id="pxd-sticky-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#1c1917" flood-opacity="0.22"/></filter>`);
        }
        body.push(`<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${n1(r.w)}" height="${n1(r.h)}" rx="2" fill="${paper}" filter="url(#pxd-sticky-shadow)"/>`);
        body.push(`<text x="${n1(r.x + 12)}" y="${n1(r.y + size + 8)}" font-size="${size}" fill="${ink}">${esc(titleOf(item))}</text>`);
      } else {
        body.push(`<text x="${n1(r.x)}" y="${n1(r.y + size)}" font-size="${size}" fill="${theme.text}">${esc(titleOf(item))}</text>`);
      }
    } else {
      const clip = `pxd-clip-${index}`;
      defs.push(`<clipPath id="${clip}"><rect x="${n1(r.x + 10)}" y="${n1(r.y)}" width="${n1(Math.max(1, r.w - 20))}" height="${n1(r.h)}"/></clipPath>`);
      body.push(`<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${n1(r.w)}" height="${n1(r.h)}" rx="8" fill="${theme.card}" stroke="${item.color ? line : theme.border}" stroke-width="${item.color ? 2 : 1}"/>`);
      const picture = imageHrefOf(item, imageHrefs);
      if (picture) {
        const ix = r.x + 8;
        const iy = r.y + 8;
        body.push(`<image href="${esc(picture)}" x="${n1(ix)}" y="${n1(iy)}" width="${n1(Math.max(1, r.w - 16))}" height="${n1(Math.max(1, r.h - 16))}" preserveAspectRatio="xMidYMid meet"/>`);
      } else {
        body.push(`<text x="${n1(r.x + 12)}" y="${n1(r.y + 26)}" font-size="14" font-weight="600" fill="${theme.text}" clip-path="url(#${clip})">${esc(titleOf(item))}</text>`);
      }
    }
  });
  if (defs.length) out.push(`<defs>${defs.join("")}</defs>`);
  out.push(...body);
  for (const { edge, path } of drawnEdges) {
    const stroke = edge.color ? hex(edge.color)[0] : theme.edge;
    const dash = edge.dash === "dashed" || edge.dash === "animated" ? ' stroke-dasharray="6 4"' : "";
    out.push(`<path d="${path.d}" fill="none" stroke="${stroke}" stroke-width="${edge.weight}"${dash}/>`);
    const size = arrowSize(1, edge.weight);
    if (edge.dir === "one" || edge.dir === "two") {
      out.push(`<path d="${arrowHeadPath(path.end, path.endAngle, size)}" fill="${stroke}" stroke="${stroke}" stroke-linejoin="round"/>`);
    }
    if (edge.dir === "two") {
      out.push(`<path d="${arrowHeadPath(path.start, path.startAngle + Math.PI, size)}" fill="${stroke}" stroke="${stroke}" stroke-linejoin="round"/>`);
    }
    if (edge.label) {
      const width = edge.label.length * 6.6 + 12;
      out.push(`<rect x="${n1(path.mid.x - width / 2)}" y="${n1(path.mid.y - 10)}" width="${n1(width)}" height="20" rx="4" fill="${theme.bg}" stroke="${stroke}" stroke-width="1"/>`);
      out.push(`<text x="${n1(path.mid.x)}" y="${n1(path.mid.y + 4)}" font-size="12" text-anchor="middle" fill="${theme.muted}">${esc(edge.label)}</text>`);
    }
  }
  out.push("</svg>");
  return out.join("\n");
}
var oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function boardToMarkdown(board2, rects) {
  const lines = [];
  const readingOrder2 = (uids) => uids.map((uid, i) => ({ uid, i, r: rects.get(uid) })).sort((a, b) => (a.r?.y ?? 0) - (b.r?.y ?? 0) || (a.r?.x ?? 0) - (b.r?.x ?? 0) || a.i - b.i).map((e) => e.uid);
  const content = (children, depth) => {
    for (const c of children ?? []) {
      const s = oneLine(c[":block/string"]);
      if (s) lines.push(`${"  ".repeat(depth)}- ${s}`);
      content(c[":block/children"], depth + 1);
    }
  };
  const walk = (uids) => {
    for (const uid of readingOrder2(uids)) {
      const item = board2.items.get(uid);
      if (!item) continue;
      if (item.type === "section") {
        if (lines.length) lines.push("");
        lines.push(`${"#".repeat(Math.min(6, item.depth + 1))} ${oneLine(titleOf(item))}`);
        walk(item.members);
      } else {
        lines.push(`- ${oneLine(titleOf(item))}`);
        const kids = [...item.content ?? []].sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0));
        content(kids, 1);
      }
    }
  };
  walk(board2.roots);
  const edges = [...board2.edges.values()].filter((e) => e.valid);
  if (edges.length) {
    if (lines.length) lines.push("");
    lines.push("## Connections");
    for (const e of edges) {
      const a = oneLine(titleOf(board2.items.get(e.from)));
      const b = oneLine(titleOf(board2.items.get(e.to)));
      lines.push(e.label ? `${a} -> ${e.label} -> ${b}` : `${a} -> ${b}`);
    }
  }
  return `${lines.join("\n")}
`;
}

// src/view/shortcuts.js
var down = (ev) => String(ev.key || "").toLowerCase();
var hasMod = (ev) => Boolean(ev.meta || ev.ctrl);
var letter = (ev, ch) => !hasMod(ev) && !ev.alt && down(ev) === ch;
function arrow(ev, { alt, shift }) {
  return !hasMod(ev) && Boolean(ev.alt) === alt && Boolean(ev.shift) === shift && String(ev.key || "").startsWith("Arrow");
}
function removeKey(ev, shift) {
  return !hasMod(ev) && !ev.alt && Boolean(ev.shift) === shift && (ev.key === "Delete" || ev.key === "Backspace");
}
var ARROWS2 = [{ key: "ArrowLeft" }, { key: "ArrowRight" }, { key: "ArrowUp" }, { key: "ArrowDown" }];
var ARROWS_SHIFT = ARROWS2.map((ev) => ({ ...ev, shift: true }));
var ARROWS_ALT = ARROWS2.map((ev) => ({ ...ev, alt: true }));
var ARROWS_BOTH = ARROWS2.map((ev) => ({ ...ev, alt: true, shift: true }));
var SHORTCUTS = [
  { group: "Tools", keys: "V", label: "Select", action: "tool", tool: "select", letter: "v", events: [{ key: "v" }], match: (ev) => letter(ev, "v") },
  { group: "Tools", keys: "H", label: "Hand", action: "tool", tool: "hand", letter: "h", events: [{ key: "h" }], match: (ev) => letter(ev, "h") },
  { group: "Tools", keys: "N", label: "Card", action: "tool", tool: "card", letter: "n", events: [{ key: "n" }], match: (ev) => letter(ev, "n") },
  { group: "Tools", keys: "T", label: "Text", action: "tool", tool: "text", letter: "t", events: [{ key: "t" }], match: (ev) => letter(ev, "t") },
  { group: "Tools", keys: "S", label: "Sticky", action: "tool", tool: "sticky", letter: "s", events: [{ key: "s" }], match: (ev) => letter(ev, "s") },
  { group: "Tools", keys: "R", label: "Shape", action: "tool", tool: "shape", letter: "r", events: [{ key: "r" }], match: (ev) => letter(ev, "r") },
  { group: "Tools", keys: "G", label: "Section", action: "tool", tool: "section", letter: "g", events: [{ key: "g" }], match: (ev) => letter(ev, "g") },
  { group: "Tools", keys: "W", label: "Board", action: "tool", tool: "board", letter: "w", events: [{ key: "w" }], match: (ev) => letter(ev, "w") },
  { group: "Tools", keys: "C", label: "Connect", action: "tool", tool: "connect", letter: "c", events: [{ key: "c" }], match: (ev) => letter(ev, "c") },
  { group: "Edit", keys: "Enter", label: "Edit, open, or rename", action: "enter", events: [{ key: "Enter" }], match: (ev) => !hasMod(ev) && !ev.alt && !ev.shift && ev.key === "Enter" },
  { group: "Edit", keys: "F2", label: "Rename page", action: "renamePage", events: [{ key: "F2" }], match: (ev) => !hasMod(ev) && !ev.alt && ev.key === "F2" },
  { group: "Edit", keys: "⌘D", label: "Duplicate", action: "duplicate", events: [{ key: "d", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && down(ev) === "d" },
  { group: "Edit", keys: "Delete", label: "Delete", action: "delete", events: [{ key: "Delete" }, { key: "Backspace" }], match: (ev) => removeKey(ev, false) },
  { group: "Edit", keys: "Shift+Delete", label: "Delete with contents", action: "delete", events: [{ key: "Delete", shift: true }, { key: "Backspace", shift: true }], match: (ev) => removeKey(ev, true) },
  { group: "Edit", keys: "⌘Z", label: "Undo", action: "undo", events: [{ key: "z", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && !ev.shift && down(ev) === "z" },
  { group: "Edit", keys: "⌘⇧Z", label: "Redo", action: "redo", events: [{ key: "z", meta: true, shift: true }], match: (ev) => hasMod(ev) && !ev.alt && ev.shift && down(ev) === "z" },
  { group: "Edit", keys: "⌘⌥Enter", label: "Fold selection", action: "fold", events: [{ key: "Enter", meta: true, alt: true }], match: (ev) => hasMod(ev) && ev.alt && down(ev) === "enter" },
  { group: "Edit", keys: "⌘G", label: "Wrap in a section", action: "wrap", events: [{ key: "g", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && down(ev) === "g" },
  { group: "Select", keys: "⌘A", label: "Select all", action: "selectAll", events: [{ key: "a", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && down(ev) === "a" },
  { group: "Select", keys: "Tab", label: "Next in outline", action: "outline", events: [{ key: "Tab" }], match: (ev) => ev.key === "Tab" && !ev.alt && !ev.shift && !hasMod(ev) },
  { group: "Select", keys: "Shift+Tab", label: "Previous in outline", action: "outline", events: [{ key: "Tab", shift: true }], match: (ev) => ev.key === "Tab" && !ev.alt && ev.shift && !hasMod(ev) },
  { group: "Select", keys: "⌥+arrows", label: "Select nearest", action: "nearest", events: ARROWS_ALT, match: (ev) => arrow(ev, { alt: true, shift: false }) },
  { group: "Select", keys: "Shift+⌥+arrows", label: "Add nearest", action: "nearest", events: ARROWS_BOTH, match: (ev) => arrow(ev, { alt: true, shift: true }) },
  { group: "Select", keys: "Shift+F10", label: "Card menu", action: "cardMenu", mode: "view", events: [{ key: "F10", shift: true }, { key: "ContextMenu" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "ContextMenu" || ev.shift && ev.key === "F10") },
  { group: "Select", keys: "M", label: "Expand outline", action: "expand", events: [{ key: "m" }], match: (ev) => letter(ev, "m") },
  { group: "View", keys: "Space", label: "Hold to pan", action: "space", mode: "always", events: [{ key: " ", code: "Space" }], match: (ev) => ev.code === "Space" || ev.key === " " },
  { group: "View", keys: "⌘+", label: "Zoom in", action: "zoomIn", events: [{ key: "=", meta: true }, { key: "+", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && (ev.key === "=" || ev.key === "+") },
  { group: "View", keys: "⌘-", label: "Zoom out", action: "zoomOut", events: [{ key: "-", meta: true }, { key: "_", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && (ev.key === "-" || ev.key === "_") },
  { group: "View", keys: "⇧0", label: "Zoom to 100%", action: "zoomReset", events: [{ key: ")", code: "Digit0", shift: true }], match: (ev) => !hasMod(ev) && !ev.alt && ev.shift && (ev.code === "Digit0" || ev.key === ")") },
  { group: "View", keys: "⇧1", label: "Fit all", action: "fitAll", events: [{ key: "!", code: "Digit1", shift: true }], match: (ev) => !hasMod(ev) && !ev.alt && ev.shift && (ev.code === "Digit1" || ev.key === "!") },
  { group: "View", keys: "⇧2", label: "Fit selection", action: "fitSelection", events: [{ key: "@", code: "Digit2", shift: true }], match: (ev) => !hasMod(ev) && !ev.alt && ev.shift && (ev.code === "Digit2" || ev.key === "@") },
  { group: "View", keys: "Arrows", label: "Nudge", action: "nudge", events: ARROWS2, match: (ev) => arrow(ev, { alt: false, shift: false }) },
  { group: "View", keys: "Shift+arrows", label: "Nudge by 10", action: "nudge", events: ARROWS_SHIFT, match: (ev) => arrow(ev, { alt: false, shift: true }) },
  { group: "View", keys: "L", label: "Cycle links", action: "links", events: [{ key: "l" }], match: (ev) => letter(ev, "l") },
  { group: "View", keys: "/ or ⌘F", label: "Find on board", action: "search", events: [{ key: "/" }, { key: "f", meta: true }], match: (ev) => !ev.alt && (ev.key === "/" && !hasMod(ev) || hasMod(ev) && down(ev) === "f") },
  { group: "View", keys: "I", label: "Info", action: "info", events: [{ key: "i" }, { key: "I" }], match: (ev) => letter(ev, "i") },
  { group: "View", keys: "F", label: "Focus", action: "focus", events: [{ key: "f" }], match: (ev) => letter(ev, "f") },
  { group: "View", keys: "Q", label: "Quick Look", action: "quickLook", events: [{ key: "q" }], match: (ev) => letter(ev, "q") },
  { group: "View", keys: "P", label: "Present", action: "present", events: [{ key: "p" }], match: (ev) => letter(ev, "p") },
  { group: "View", keys: "?", label: "Shortcuts", action: "help", events: [{ key: "?", shift: true, code: "Slash" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "?" || ev.code === "Slash" && ev.shift) },
  { group: "View", keys: "Escape", label: "Close or step back", action: "escape", mode: "always", events: [{ key: "Escape" }], match: (ev) => ev.key === "Escape" },
  { group: "Navigate", keys: "⌘[", label: "Back", action: "back", events: [{ key: "[", meta: true, code: "BracketLeft" }], match: (ev) => hasMod(ev) && !ev.shift && !ev.alt && (ev.code === "BracketLeft" || ev.key === "[") },
  { group: "Navigate", keys: "⌘]", label: "Forward", action: "forward", events: [{ key: "]", meta: true, code: "BracketRight" }], match: (ev) => hasMod(ev) && !ev.shift && !ev.alt && (ev.code === "BracketRight" || ev.key === "]") },
  { group: "Present", keys: "→ ↓ Space", label: "Next", action: "presentNext", mode: "present", events: [{ key: "ArrowRight" }, { key: "ArrowDown" }, { key: "PageDown" }, { key: " ", code: "Space" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "ArrowRight" || ev.key === "ArrowDown" || ev.key === "PageDown" || ev.code === "Space" || ev.key === " ") },
  { group: "Present", keys: "← ↑", label: "Previous", action: "presentPrev", mode: "present", events: [{ key: "ArrowLeft" }, { key: "ArrowUp" }, { key: "PageUp" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "PageUp") }
];
function findShortcut(ev, mode = "normal") {
  return SHORTCUTS.find((row2) => (row2.mode || "normal") === mode && row2.match(ev)) || null;
}

// src/view/interactions.js
var TOOL_KEYS = Object.fromEntries(SHORTCUTS.filter((row2) => row2.letter).map((row2) => [row2.letter, row2.tool]));
var TOOLS = ["select", "hand", "card", "text", "sticky", "shape", "section", "board", "connect"];
var SHAPE_PLACE = { w: 160, h: 100 };
var DRAG_THRESHOLD_PX = 4;
var SNAP_PX = 6;
var STICKY_TOOLS = /* @__PURE__ */ new Set(["select", "hand"]);
function normRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
function createInteractions({ actions, settings } = {}) {
  const a = actions || {};
  const call = (name, ...args) => typeof a[name] === "function" ? a[name](...args) : void 0;
  const setting = (key, def) => {
    const v = typeof settings?.get === "function" ? settings.get(key) : settings?.[key];
    return v === void 0 || v === null ? def : v;
  };
  const state = {
    tool: "select",
    locked: false,
    selection: /* @__PURE__ */ new Set(),
    edge: null,
    link: null,
    gesture: null,
    space: false,
    hover: null
  };
  const board2 = () => call("board");
  const rects = () => call("rects");
  const hitRects = () => call("hitRects") || rects();
  const vp = () => call("viewport") || { x: 0, y: 0, zoom: 1 };
  const zoom = () => vp().zoom || 1;
  const emitSelection = () => {
    call("onSelection", { items: [...state.selection], edge: state.edge, link: state.link });
  };
  const selectItems = (uids) => {
    state.selection = new Set(uids);
    state.edge = null;
    state.link = null;
    emitSelection();
  };
  const selectEdge = (uid) => {
    state.selection = /* @__PURE__ */ new Set();
    state.edge = uid;
    state.link = null;
    emitSelection();
  };
  const selectLink = (key) => {
    state.selection = /* @__PURE__ */ new Set();
    state.edge = null;
    state.link = key;
    emitSelection();
  };
  const clearSelection = () => {
    if (!state.selection.size && !state.edge && !state.link) return false;
    selectItems([]);
    return true;
  };
  const setTool = (tool, lock = false) => {
    if (!TOOLS.includes(tool)) return;
    state.tool = tool;
    state.locked = Boolean(lock) && !STICKY_TOOLS.has(tool);
    call("onTool", state.tool, state.locked);
  };
  const afterToolUse = () => {
    if (!state.locked && !STICKY_TOOLS.has(state.tool)) setTool("select");
  };
  const begin = (g) => {
    state.gesture = { moved: false, ...g };
    call("setGesturing", true);
  };
  const end = () => {
    const moved = Boolean(state.gesture?.moved);
    state.gesture = null;
    call("showMarquee", null);
    call("showLasso", null);
    call("showGuides", []);
    call("showTempWire", null);
    call("onHover", null);
    call("clearBlockTarget");
    call("showGhosts", null);
    call("cancelPreview");
    call("setGesturing", false, { moved });
  };
  const isPinned = (uid) => Boolean(board2()?.items.get(uid)?.pinned);
  const movingSet = (dup = false) => {
    const b = board2();
    if (!b) return [];
    const uids = dup ? [...state.selection] : [...state.selection].filter((u) => !isPinned(u));
    return topLevelOf(b, uids);
  };
  const movingBounds = (uids) => {
    const r = rects();
    return boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
  };
  const otherRects = (uids) => {
    const b = board2();
    const r = rects();
    const skip = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(b, u)) skip.add(d);
    const out = [];
    for (const uid of b.items.keys()) if (!skip.has(uid) && r.get(uid)) out.push(r.get(uid));
    return out;
  };
  const editingUid = () => call("editingUid") ?? null;
  const isEditing = () => Boolean(call("isEditing"));
  const blockTargetFor = (ev, uid) => {
    const item = uid ? board2()?.items.get(uid) : null;
    if (!item || item.kind !== "page") {
      call("clearBlockTarget");
      return null;
    }
    const bt = call("blockTarget", ev.client || null);
    return bt && bt.uid === uid ? bt : null;
  };
  const sameEdge = (b, from, to, fromBlock, toBlock) => {
    for (const e of b.edges.values()) {
      if (e.from === from && e.to === to && (e.fromBlock ?? "") === (fromBlock ?? "") && (e.toBlock ?? "") === (toBlock ?? "")) return e;
    }
    return null;
  };
  const beginConnect = (uid, side, world) => {
    begin({ kind: "connect", from: uid, fromSide: side, start: world });
    call("showTempWire", { from: uid, fromSide: side, point: world });
  };
  let openTimer = null;
  const cancelOpen = () => {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
  };
  const OPEN_DELAY_MS = 300;
  const onPointerDown = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
    cancelOpen();
    if (ev.button === 2) return;
    if (state.gesture) return;
    const editing = editingUid();
    if (editing) {
      if (t.kind === "item" && t.uid === editing && t.part !== "header") return;
      if (!(t.kind === "item" && t.uid === editing)) call("exitEdit");
    }
    const panRequested = ev.button === 1 || state.space || state.tool === "hand";
    if (panRequested) {
      begin({ kind: "pan", start: ev.screen, vp0: { ...vp() } });
      return;
    }
    if (ev.button !== 0) return;
    const b = board2();
    const r = rects();
    switch (t.kind) {
      case "port":
        if (t.uid) beginConnect(t.uid, t.side || "right", ev.world);
        return;
      case "grip": {
        if (!t.uid || !r?.get(t.uid) || isPinned(t.uid)) return;
        if (!state.selection.has(t.uid)) selectItems([t.uid]);
        begin({ kind: "resize", uid: t.uid, part: t.part || "corner", start: ev.world, rect0: { ...r.get(t.uid) } });
        return;
      }
      case "edge-marker":
        if (t.uid) {
          selectEdge(t.uid);
          call("revealBlockEnd", t.uid, t.end);
        }
        return;
      case "edge-end": {
        const edge = t.uid ? b?.edges.get(t.uid) : null;
        if (!edge || t.end !== "from" && t.end !== "to") return;
        const other = t.end === "from" ? edge.to : edge.from;
        begin({ kind: "edge-end", edge: t.uid, end: t.end, other, start: ev.world });
        call("showTempWire", { from: other, fromSide: "auto", point: ev.world });
        return;
      }
      case "edge":
      case "label":
        if (t.uid) selectEdge(t.uid);
        return;
      case "link":
        if (t.key || t.uid) selectLink(t.key || t.uid);
        return;
      case "item":
      case "section-title":
      case "section-border": {
        if (!t.uid || !b?.items.has(t.uid)) return;
        if (state.tool === "connect") {
          beginConnect(t.uid, nearestSide(r.get(t.uid), ev.world), ev.world);
          return;
        }
        if (state.tool !== "select") break;
        let deferred = false;
        const dup = Boolean(ev.alt);
        const pageItem = b.items.get(t.uid)?.kind === "page";
        const kidKind = b.items.get(t.uid)?.kind;
        const rowItem = pageItem || (kidKind === "note" || kidKind === "block") && Boolean(b.items.get(t.uid)?.kids);
        const pageHeader = pageItem && t.part === "header";
        const multi = !dup && (ev.meta || ev.ctrl || ev.shift && !pageHeader);
        if (multi) {
          const next = new Set(state.selection);
          if (next.has(t.uid)) next.delete(t.uid);
          else next.add(t.uid);
          selectItems(next);
        } else if (!state.selection.has(t.uid)) {
          selectItems([t.uid]);
        } else if (state.selection.size > 1) {
          deferred = true;
        } else if (state.edge || state.link) {
          selectItems([t.uid]);
        }
        if (!state.selection.has(t.uid)) return;
        const uids = movingSet(dup);
        begin({ kind: "move", uids, dup, multi, asRef: dup && Boolean(ev.shift), start: ev.screen, target: t.uid, deferred, pageHeader, pageRow: rowItem && t.part === "body" ? t.row || "" : "", bounds: movingBounds(uids), others: setting("snap-guides", true) ? otherRects(uids) : [] });
        return;
      }
      default:
        break;
    }
    if (state.tool === "section") {
      begin({ kind: "section-draw", start: ev.world });
      return;
    }
    if (state.tool === "board") {
      begin({ kind: "board-draw", start: ev.world });
      return;
    }
    if (state.tool === "card" || state.tool === "text" || state.tool === "sticky" || state.tool === "shape") {
      begin({ kind: "place", tool: state.tool, start: ev.world });
      return;
    }
    if (state.tool === "select" && ev.alt) {
      begin({
        kind: "lasso",
        start: ev.world,
        points: [{ x: ev.world.x, y: ev.world.y }],
        base: ev.shift ? new Set(state.selection) : /* @__PURE__ */ new Set(),
        shift: Boolean(ev.shift)
      });
      return;
    }
    begin({ kind: "marquee", start: ev.world, base: ev.shift ? new Set(state.selection) : /* @__PURE__ */ new Set(), shift: ev.shift });
  };
  const onPointerMove = (ev) => {
    const g = state.gesture;
    if (!g) return;
    if (g.kind === "connect") {
      const b = board2();
      const r = hitRects();
      call("showTempWire", { from: g.from, fromSide: g.fromSide, point: ev.world });
      const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
      const hover = hit && hit.uid !== g.from ? hit.uid : null;
      if (hover !== state.hover) {
        state.hover = hover;
        call("onHover", hover);
      }
      if (!g.moved && Math.hypot(ev.world.x - g.start.x, ev.world.y - g.start.y) * zoom() >= DRAG_THRESHOLD_PX) g.moved = true;
      blockTargetFor(ev, hover);
      return;
    }
    if (g.kind === "edge-end") {
      const b = board2();
      const r = hitRects();
      call("showTempWire", { from: g.other, fromSide: "auto", point: ev.world });
      const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
      const hover = hit && hit.uid !== g.other ? hit.uid : null;
      if (hover !== state.hover) {
        state.hover = hover;
        call("onHover", hover);
      }
      if (!g.moved && Math.hypot(ev.world.x - g.start.x, ev.world.y - g.start.y) * zoom() >= DRAG_THRESHOLD_PX) g.moved = true;
      blockTargetFor(ev, hover);
      return;
    }
    const sdx = ev.screen.x - (g.start.x ?? 0);
    const sdy = ev.screen.y - (g.start.y ?? 0);
    if (g.kind === "pan") {
      if (!g.moved && Math.hypot(sdx, sdy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      call("setViewport", { x: g.vp0.x + sdx, y: g.vp0.y + sdy, zoom: g.vp0.zoom });
      return;
    }
    if (g.kind === "move") {
      if (!g.moved && Math.hypot(sdx, sdy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      const z = zoom();
      let dx = sdx / z;
      let dy = sdy / z;
      let guides = [];
      if (!ev.alt && g.bounds) {
        const threshold = SNAP_PX / z;
        if (g.others.length) {
          const moving = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
          const snap = snapMove(moving, g.others, threshold);
          dx += snap.dx;
          dy += snap.dy;
          guides = snap.guides;
        }
        if (setting("snap-grid", false)) {
          const moving = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
          const grid = snapToGrid(moving, GRID_PITCH, threshold);
          if (!guides.some((line) => line.x1 === line.x2)) dx += grid.dx;
          if (!guides.some((line) => line.y1 === line.y2)) dy += grid.dy;
        }
      }
      g.dx = dx;
      g.dy = dy;
      if (g.dup) {
        const r0 = rects();
        call("showGhosts", g.uids.map((u) => r0?.get(u)).filter(Boolean).map((q) => ({ x: q.x + dx, y: q.y + dy, w: q.w, h: q.h })));
      } else if (g.uids.length) {
        call("previewMove", g.uids, dx, dy);
      }
      call("showGuides", guides);
      const b = board2();
      const r = hitRects();
      if (b && r && !g.dup && g.uids.length) {
        if (!g.exclude) {
          g.exclude = new Set(g.uids);
          for (const u of g.uids) for (const d of descendantsOf(b, u)) g.exclude.add(d);
        }
        const hit = hitTest(b, ev.world, r, { exclude: g.exclude });
        const drop = hit?.part === "body" && (b.items.get(hit.uid)?.kind === "board" && b.items.get(hit.uid)?.enhanced) ? hit.uid : null;
        if (drop !== (g.drop ?? null)) {
          g.drop = drop;
          call("onHover", drop);
        }
      }
      return;
    }
    const wdx = ev.world.x - g.start.x;
    const wdy = ev.world.y - g.start.y;
    if (!g.moved && Math.hypot(wdx, wdy) * zoom() < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    if (g.kind === "lasso") {
      const last = g.points[g.points.length - 1];
      const dx = ev.world.x - last.x;
      const dy = ev.world.y - last.y;
      if (dx * dx + dy * dy >= 0.25) g.points.push({ x: ev.world.x, y: ev.world.y });
      call("showLasso", g.points);
      const b = board2();
      const r = hitRects();
      if (b && r) {
        const hits = g.points.length >= 3 ? itemsInPolygon(b, g.points, r) : [];
        const next = new Set(g.base);
        hits.forEach((u) => next.add(u));
        state.selection = next;
        state.edge = null;
        state.link = null;
        emitSelection();
      }
      return;
    }
    if (g.kind === "marquee") {
      const rect = normRect(g.start, ev.world);
      g.rect = rect;
      call("showMarquee", rect, "select");
      const b = board2();
      const r = hitRects();
      if (b && r) {
        const hits = itemsInRect(b, rect, r, { mode: "contain" });
        const next = new Set(g.base);
        hits.forEach((u) => next.add(u));
        state.selection = next;
        state.edge = null;
        state.link = null;
        emitSelection();
      }
      return;
    }
    if (g.kind === "section-draw" || g.kind === "board-draw") {
      g.rect = normRect(g.start, ev.world);
      call("showMarquee", g.rect, g.kind === "board-draw" ? "board" : "section");
      return;
    }
    if (g.kind === "resize") {
      const b = board2();
      const item = b?.items.get(g.uid);
      if (!item) return;
      const min = MIN_SIZES[item.type] || MIN_SIZES.card;
      const r0 = g.rect0;
      const next = { uid: g.uid, x: r0.x, y: r0.y, w: r0.w, h: r0.h };
      if (g.part === "corner" || g.part === "right") next.w = Math.max(min.w, r0.w + wdx);
      if (g.part === "corner" || g.part === "bottom") next.h = Math.max(min.h, r0.h + wdy);
      g.rect = next;
      call("previewRects", [next]);
    }
  };
  const onPointerUp = (ev) => {
    const g = state.gesture;
    if (!g) return;
    const b = board2();
    const r = rects();
    switch (g.kind) {
      case "pan":
        break;
      case "marquee":
      case "lasso":
        if (!g.moved && !g.shift) clearSelection();
        break;
      case "section-draw": {
        const d = DEFAULT_SIZES.section;
        const rect = g.moved && g.rect && g.rect.w >= MIN_SIZES.section.w && g.rect.h >= MIN_SIZES.section.h ? g.rect : { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2, w: d.w, h: d.h };
        end();
        Promise.resolve(call("createSection", { rect })).then((uid) => {
          if (uid) selectItems([uid]);
        }).catch(() => {
        });
        afterToolUse();
        return;
      }
      case "board-draw": {
        const d = DEFAULT_BOARD_CARD;
        const rect = g.moved && g.rect && g.rect.w >= MIN_SIZES.card.w && g.rect.h >= MIN_SIZES.card.h ? g.rect : { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2, w: d.w, h: d.h };
        end();
        Promise.resolve(call("createBoard", { rect })).then((uid) => {
          if (uid) selectItems([uid]);
        }).catch(() => {
        });
        afterToolUse();
        return;
      }
      case "place": {
        if (!g.moved) {
          let p;
          if (g.tool === "sticky") {
            p = call("createText", { x: g.start.x - STICKY_SIZE.w / 2, y: g.start.y - STICKY_SIZE.h / 2, w: STICKY_SIZE.w, h: STICKY_SIZE.h, look: "sticky" });
          } else if (g.tool === "shape") {
            p = call("createText", { x: g.start.x - SHAPE_PLACE.w / 2, y: g.start.y - SHAPE_PLACE.h / 2, w: SHAPE_PLACE.w, h: SHAPE_PLACE.h, shape: "rectangle" });
          } else {
            const d = DEFAULT_SIZES[g.tool];
            const at = { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2 };
            p = g.tool === "text" ? call("createText", at) : call("createCard", at);
          }
          end();
          Promise.resolve(p).then((uid) => {
            if (uid) {
              selectItems([uid]);
              call("enterEdit", uid);
            }
          }).catch(() => {
          });
          afterToolUse();
          return;
        }
        break;
      }
      case "move":
        if (g.moved && g.dup) {
          call("duplicateItems", g.uids, { dx: g.dx || 0, dy: g.dy || 0, asRef: Boolean(g.asRef) });
        } else if (g.moved && g.drop) {
          call("moveIntoBoard", g.uids, g.drop, g.dx || 0, g.dy || 0);
        } else if (g.moved) {
          if (g.uids.length) call("commitMove", g.uids, g.dx || 0, g.dy || 0);
        } else if (g.deferred) {
          selectItems([g.target]);
        }
        if (!g.moved && !g.dup && !ev.alt && g.pageHeader && !ev.meta && !ev.ctrl && g.target) {
          const sidebar = Boolean(ev.shift);
          const target = g.target;
          cancelOpen();
          openTimer = setTimeout(() => {
            openTimer = null;
            call("openPage", target, { sidebar });
          }, OPEN_DELAY_MS);
        } else if (!g.moved && ev.shift && !ev.alt && !g.dup && g.target && b?.items.get(g.target)?.type !== "section") {
          call("addInfoTab", g.target);
        } else if (!g.moved && !g.dup && g.pageRow && !ev.shift && !ev.alt && !ev.meta && !ev.ctrl && editingUid() !== g.target) {
          call("enterEdit", g.target, { row: g.pageRow });
        }
        break;
      case "resize":
        if (g.moved && g.rect) call("commitRects", [g.rect]);
        break;
      case "edge-end": {
        const hr = hitRects();
        const hit = b && hr ? hitTest(b, ev.world, hr, { sectionInterior: true }) : null;
        const bt = hit && hit.uid !== g.other ? blockTargetFor(ev, hit.uid) : null;
        end();
        const edge = b?.edges.get(g.edge);
        if (g.moved && edge && hit && hit.uid !== g.other) {
          const key = g.end === "from" ? "from" : "to";
          const blockKey = g.end === "from" ? "fromBlock" : "toBlock";
          const nextBlock = bt?.row || void 0;
          const sameCard = hit.uid === edge[key];
          if (!sameCard || (edge[blockKey] ?? "") !== (nextBlock ?? "")) {
            const next = { from: edge.from, to: edge.to, fromBlock: edge.fromBlock, toBlock: edge.toBlock, [key]: hit.uid, [blockKey]: nextBlock };
            if (!sameEdge(b, next.from, next.to, next.fromBlock, next.toBlock)) {
              const patch = { [blockKey]: nextBlock };
              if (!sameCard) {
                patch[key] = hit.uid;
                patch[key === "from" ? "fromSide" : "toSide"] = nearestSide(hr.get(hit.uid), ev.world);
              }
              call("updateEdge", g.edge, patch);
            }
          }
        }
        afterToolUse();
        return;
      }
      case "connect": {
        const hr = hitRects();
        const hit = b && hr ? hitTest(b, ev.world, hr, { sectionInterior: true }) : null;
        const bt = hit && hit.uid !== g.from ? blockTargetFor(ev, hit.uid) : null;
        end();
        if (hit && hit.uid === g.from) {
          selectItems([g.from]);
        } else if (hit) {
          const toBlock = bt?.row || void 0;
          const existing = sameEdge(b, g.from, hit.uid, void 0, toBlock);
          if (existing) {
            selectEdge(existing.uid);
          } else {
            const toSide = nearestSide(hr.get(hit.uid), ev.world);
            Promise.resolve(call("addEdge", { from: g.from, to: hit.uid, fromSide: g.fromSide, toSide, ...toBlock ? { toBlock } : {} })).then((uid) => {
              if (uid) selectEdge(uid);
            }).catch(() => {
            });
          }
        } else if (g.moved) {
          const d = DEFAULT_SIZES.card;
          const at = { x: ev.world.x, y: ev.world.y - d.h / 2 };
          Promise.resolve(call("createCard", at)).then(async (uid) => {
            if (!uid) return;
            await call("addEdge", { from: g.from, to: uid, fromSide: g.fromSide, toSide: "auto" });
            selectItems([uid]);
            call("enterEdit", uid);
          }).catch(() => {
          });
        }
        afterToolUse();
        return;
      }
      default:
        break;
    }
    end();
  };
  const onPointerCancel = () => {
    if (!state.gesture) return;
    const g = state.gesture;
    if (g.kind === "move" && !g.dup && g.uids.length) call("previewMove", g.uids, 0, 0);
    if (g.kind === "resize") call("previewRects", []);
    end();
  };
  const onDblClick = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
    cancelOpen();
    const b = board2();
    if (t.kind === "item" && t.uid) {
      const item = b?.items.get(t.uid);
      if (!item) return;
      if (item.kind === "page" && t.part === "header") {
        selectItems([t.uid]);
        call("renamePage", t.uid);
        return;
      }
      if (item.kind === "board" || call("isBoardCard", t.uid)) call("openBoard", t.uid);
      else if (editingUid() !== t.uid) {
        selectItems([t.uid]);
        call("enterEdit", t.uid);
      }
      return;
    }
    if (t.kind === "grip") {
      if (t.uid && b?.items.has(t.uid) && !isPinned(t.uid)) {
        if (t.part === "bottom") call(b.items.get(t.uid).type === "section" ? "fitSection" : "fitHeight", t.uid);
        else if (t.part === "corner" || !t.part) call("resetSize", [t.uid]);
      }
      return;
    }
    if (t.kind === "port" && t.side === "bottom") {
      if (t.uid && b?.items.has(t.uid) && !isPinned(t.uid)) call(b.items.get(t.uid).type === "section" ? "fitSection" : "fitHeight", t.uid);
      return;
    }
    if (t.kind === "section-title" && t.uid) {
      selectItems([t.uid]);
      call("renameSection", t.uid);
      return;
    }
    if ((t.kind === "label" || t.kind === "edge") && t.uid) {
      selectEdge(t.uid);
      call("editLabel", t.uid);
      return;
    }
    if (t.kind === "section-border" || t.kind === "port" || t.kind === "link") return;
    if (state.tool !== "select") return;
    const d = DEFAULT_SIZES.card;
    Promise.resolve(call("createCard", { x: ev.world.x - d.w / 2, y: ev.world.y - d.h / 2 })).then((uid) => {
      if (uid) {
        selectItems([uid]);
        call("enterEdit", uid);
      }
    }).catch(() => {
    });
  };
  const onContextMenu = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return false;
    const b = board2();
    const editing = editingUid();
    if (editing && t.kind === "item" && t.uid === editing && t.part !== "header") return false;
    let kind = "canvas";
    let uid = null;
    if ((t.kind === "item" || t.kind === "section-title" || t.kind === "section-border") && t.uid && b?.items.has(t.uid)) {
      const item = b.items.get(t.uid);
      uid = t.uid;
      if (editing && editing !== uid) call("exitEdit");
      if (state.selection.has(uid) && state.selection.size > 1) kind = "multi";
      else {
        if (!state.selection.has(uid) || state.edge || state.link) selectItems([uid]);
        kind = item.type === "section" ? "section" : item.type === "text" ? "text" : "card";
      }
    } else if ((t.kind === "edge" || t.kind === "label") && t.uid) {
      kind = "edge";
      uid = t.uid;
      if (state.edge !== uid) selectEdge(uid);
    } else if (t.kind === "link" && (t.key || t.uid)) {
      kind = "link";
      uid = t.key || t.uid;
      if (state.link !== uid) selectLink(uid);
    }
    call("openMenu", { kind, uid, screen: ev.screen, world: ev.world, selection: [...state.selection] });
    return true;
  };
  const onWheel = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return false;
    const editing = editingUid();
    if (editing && t.kind === "item" && t.uid === editing) return false;
    const v = vp();
    const pinch = Boolean(ev.ctrl || ev.meta);
    const wheelMode = setting("wheel", "pan");
    if (pinch || wheelMode === "zoom") {
      const factor = Math.exp(-(ev.deltaY || 0) * (pinch ? 0.01 : 2e-3));
      call("setViewport", zoomAt(v, ev.screen, factor));
    } else {
      call("setViewport", { x: v.x - (ev.deltaX || 0), y: v.y - (ev.deltaY || 0), zoom: v.zoom });
    }
    return true;
  };
  const zoomBy = (factor) => {
    const s = call("size") || { width: 0, height: 0 };
    call("animateViewport", zoomAt(vp(), { x: s.width / 2, y: s.height / 2 }, factor));
  };
  const zoomTo = (z) => {
    const s = call("size") || { width: 0, height: 0 };
    const v = vp();
    call("animateViewport", zoomAt(v, { x: s.width / 2, y: s.height / 2 }, z / (v.zoom || 1)));
  };
  const deleteSelection = (withContents) => {
    if (state.edge) {
      const uid = state.edge;
      selectItems([]);
      call("deleteEdges", [uid]);
      call("toast", { message: "Connection deleted", action: { label: "Undo", run: () => call("undo") } });
      return true;
    }
    if (!state.selection.size) return false;
    const b = board2();
    const all = [...state.selection];
    const blocked = (u) => isPinned(u) || Boolean(withContents) && Boolean(b) && [...descendantsOf(b, u)].some(isPinned);
    const uids = all.filter((u) => !blocked(u));
    const kept = all.filter(blocked);
    if (kept.length) call("toast", { message: "Pinned items were not deleted. Unpin first." });
    if (!uids.length) return true;
    selectItems(kept);
    call("deleteItems", uids, { withContents: Boolean(withContents) });
    call("toast", { message: "Deleted", action: { label: "Undo", run: () => call("undo") } });
    return true;
  };
  const lastSelected = () => {
    let last = null;
    for (const u of state.selection) last = u;
    return last;
  };
  const selectNearest = (dir, add) => {
    const b = board2();
    const r = hitRects();
    const from = lastSelected();
    if (!b || !r || !from || !b.items.has(from)) return;
    const parent = b.items.get(from).parentUid;
    const candidates = [];
    for (const [uid, item] of b.items) {
      if (uid !== from && !r.get(uid)) continue;
      if (item.parentUid === parent && (uid === from || !state.selection.has(uid))) candidates.push(uid);
    }
    const next = nearestInDirection(r, from, dir, { candidates });
    if (!next) return;
    selectItems(add ? [...state.selection, next] : [next]);
  };
  const selectOutline = (back) => {
    const b = board2();
    if (!b) return false;
    const order = outlineOrder(b);
    if (!order.length) return false;
    const from = lastSelected();
    const i = from ? order.indexOf(from) : -1;
    let next;
    if (i < 0) next = back ? order[order.length - 1] : order[0];
    else next = order[(i + (back ? order.length - 1 : 1)) % order.length];
    selectItems([next]);
    return true;
  };
  const escape = () => {
    if (state.gesture) {
      onPointerCancel();
      return true;
    }
    if (call("closeQuickLook")) return true;
    if (call("exitPresent")) return true;
    if (isEditing()) {
      call("exitEdit");
      return true;
    }
    if (call("exitFocus")) return true;
    if (clearSelection()) return true;
    if (call("popBoard")) return true;
    if (call("isFullscreen")) {
      call("setFullscreen", false);
      return true;
    }
    return false;
  };
  const runShortcut = (row2, ev) => {
    const key = ev.key || "";
    const b = board2();
    switch (row2.action) {
      case "tool":
        setTool(row2.tool);
        return true;
      case "space":
        if (!state.space) {
          state.space = true;
          call("setSpace", true);
        }
        return true;
      case "escape":
        return escape();
      case "presentNext":
        call("presentNext");
        return true;
      case "presentPrev":
        call("presentPrev");
        return true;
      case "selectAll":
        if (b) selectItems([...b.items.keys()]);
        return true;
      case "wrap":
        if (state.selection.size) call("wrapInSection", [...state.selection]);
        return true;
      case "duplicate":
        if (!state.selection.size) return false;
        call("duplicateItems", [...state.selection], { dx: 24, dy: 24, asRef: false });
        return true;
      case "fold":
        call("foldSelection");
        return true;
      case "undo":
        call("undo");
        return true;
      case "redo":
        call("redo");
        return true;
      case "search":
        call("openSearch");
        return true;
      case "zoomIn":
        zoomBy(1.2);
        return true;
      case "zoomOut":
        zoomBy(1 / 1.2);
        return true;
      case "back":
        call("historyBack");
        return true;
      case "forward":
        call("historyForward");
        return true;
      case "fitAll":
        call("fitAll");
        return true;
      case "fitSelection":
        if (state.selection.size) call("fitSelection", [...state.selection]);
        return true;
      case "zoomReset":
        zoomTo(1);
        return true;
      case "delete":
        return deleteSelection(ev.shift);
      case "renamePage": {
        if (state.selection.size !== 1) return false;
        const uid = [...state.selection][0];
        const item = b?.items.get(uid);
        if (item?.kind !== "page") return false;
        call("renamePage", uid);
        return true;
      }
      case "enter": {
        if (state.selection.size !== 1) return false;
        const uid = [...state.selection][0];
        const item = b?.items.get(uid);
        if (item?.kind === "board" || item && call("isBoardCard", uid)) call("openBoard", uid);
        else if (item?.type === "section") call("renameSection", uid);
        else call("enterEdit", uid);
        return true;
      }
      case "nearest": {
        if (!state.selection.size) return false;
        const dir = key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : null;
        if (dir) selectNearest(dir, ev.shift);
        return true;
      }
      case "nudge": {
        if (!state.selection.size) return false;
        const step = ev.shift ? 10 : 1;
        const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
        const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
        const uids = movingSet();
        if (uids.length) call("commitMove", uids, dx, dy);
        return true;
      }
      case "outline":
        return ev.tabOwned === false ? false : selectOutline(ev.shift);
      case "links":
        call("cycleLinks");
        return true;
      case "info":
        call("openInfo");
        return true;
      case "focus":
        call("toggleFocus");
        return true;
      case "quickLook":
        call("quickLook");
        return true;
      case "present":
        call("present");
        return true;
      case "help":
        call("toggleShortcuts");
        return true;
      case "expand": {
        if (state.selection.size !== 1) return false;
        const uid = lastSelected();
        const item = b?.items.get(uid);
        if (!item || item.type !== "card" || item.kind === "board") return false;
        call("expandOutline", uid);
        return true;
      }
      default:
        return false;
    }
  };
  const onKeyDown = (ev) => {
    const key = ev.key || "";
    const mod = Boolean(ev.meta || ev.ctrl);
    if (ev.inputFocused) {
      if (key === "Escape" && isEditing() && !call("autocompleteOpen")) {
        call("exitEdit");
        return true;
      }
      return false;
    }
    if (call("presentActive") && !mod && !ev.alt) {
      const present = findShortcut(ev, "present");
      if (present) return runShortcut(present, ev);
    }
    const always = findShortcut(ev, "always");
    if (always) return runShortcut(always, ev);
    if (setting("enable-shortcuts", true) === false) return false;
    const row2 = findShortcut(ev, "normal");
    if (!row2) return false;
    return runShortcut(row2, ev);
  };
  const onKeyUp = (ev) => {
    if (ev.code === "Space" || ev.key === " ") {
      if (state.space) {
        state.space = false;
        call("setSpace", false);
      }
      return true;
    }
    return false;
  };
  const handle = (ev) => {
    switch (ev?.type) {
      case "pointerdown":
        return onPointerDown(ev);
      case "pointermove":
        return onPointerMove(ev);
      case "pointerup":
        return onPointerUp(ev);
      case "pointercancel":
        return onPointerCancel(ev);
      case "dblclick":
        return onDblClick(ev);
      case "contextmenu":
        return onContextMenu(ev);
      case "wheel":
        return onWheel(ev);
      case "keydown":
        return onKeyDown(ev);
      case "keyup":
        return onKeyUp(ev);
      default:
        return void 0;
    }
  };
  return {
    handle,
    setTool,
    getTool: () => state.tool,
    isLocked: () => state.locked,
    select: selectItems,
    selectEdge,
    selectLink,
    clearSelection,
    getSelection: () => ({ items: [...state.selection], edge: state.edge, link: state.link }),
    deleteSelection,
    escape,
    isGesturing: () => Boolean(state.gesture),
    gestureKind: () => state.gesture?.kind ?? null,
    cancel: () => {
      cancelOpen();
      onPointerCancel();
    },
    // Model changed under us: drop selection entries that no longer exist.
    reconcile() {
      const b = board2();
      if (!b) return;
      let changed2 = false;
      for (const u of [...state.selection]) if (!b.items.has(u)) {
        state.selection.delete(u);
        changed2 = true;
      }
      if (state.edge && !b.edges.has(state.edge)) {
        state.edge = null;
        changed2 = true;
      }
      if (changed2) emitSelection();
    }
  };
}

// src/view/board-picker.js
function recentBoardRows(rows) {
  return [...rows || []].filter((row2) => row2 && row2.uid).sort((a, b) => (Number(b.edited) || 0) - (Number(a.edited) || 0) || String(a.title || "").localeCompare(String(b.title || "")));
}
var current = null;
function openAddToBoard({ doc = globalThis.document, listBoards, onPick } = {}) {
  current?.close();
  const offs = [];
  const on = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const el = (tag, cls, parent, text2) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    if (text2 !== void 0) node2.textContent = text2;
    parent?.append(node2);
    return node2;
  };
  const back = el("div", "pxd-addboard-back", doc.body);
  const box2 = el("div", "pxd-addboard", doc.body);
  el("div", "pxd-addboard__title", box2, "Add to board");
  const filter = el("input", "pxd-addboard__filter", box2);
  filter.type = "text";
  filter.setAttribute("aria-label", "Filter boards");
  filter.placeholder = "Filter boards…";
  filter.setAttribute("placeholder", "Filter boards…");
  const list = el("div", "pxd-addboard__list", box2);
  el("div", "pxd-addboard__empty", list, "Loading boards…");
  let rows = [];
  let closed = false;
  let busy = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (current === api) current = null;
    for (const off of offs) off();
    back.remove();
    box2.remove();
  };
  const api = { close };
  current = api;
  const render = () => {
    list.replaceChildren();
    const q = String(filter.value || "").trim().toLowerCase();
    const shown = rows.filter((b) => !q || `${b.title || ""}
${b.pageTitle || b.page || ""}`.toLowerCase().includes(q));
    if (!shown.length) {
      el("div", "pxd-addboard__empty", list, rows.length ? "No matching boards" : "No boards found");
      return;
    }
    for (const b of shown) {
      const row2 = el("div", "pxd-addboard__row", list);
      row2.dataset.uid = b.uid;
      row2.setAttribute("data-uid", b.uid);
      const text2 = el("span", "pxd-addboard__text", row2);
      el("span", "pxd-addboard__name", text2, b.title || "Untitled board");
      const page = b.pageTitle || b.page;
      if (page) el("span", "pxd-addboard__page", text2, page);
    }
  };
  on(box2, "pxd-close", () => close());
  on(back, "pointerdown", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    close();
  });
  on(filter, "input", () => render());
  on(filter, "keydown", (event) => {
    event.stopPropagation?.();
    if (event.key !== "Escape") return;
    event.preventDefault?.();
    close();
  });
  on(list, "click", (event) => {
    const row2 = event.target?.closest?.(".pxd-addboard__row");
    const uid = row2?.dataset?.uid || row2?.getAttribute?.("data-uid");
    if (!uid || busy) return;
    const board2 = rows.find((b) => b.uid === uid);
    if (!board2) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    busy = true;
    Promise.resolve(onPick?.(board2)).then((ok) => {
      if (ok === false) {
        busy = false;
        return;
      }
      close();
    }, () => {
      busy = false;
    });
  });
  Promise.resolve(typeof listBoards === "function" ? listBoards() : []).then((got) => {
    if (closed) return;
    rows = recentBoardRows(got);
    render();
  }, () => {
    if (closed) return;
    rows = [];
    render();
  });
  try {
    filter.focus();
  } catch {
  }
  return api;
}
function openPagePicker({ doc = globalThis.document, search, onPick, debounceMs = 150 } = {}) {
  current?.close();
  const offs = [];
  const on = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const el = (tag, cls, parent, text2) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    if (text2 !== void 0) node2.textContent = text2;
    parent?.append(node2);
    return node2;
  };
  const back = el("div", "pxd-addboard-back", doc.body);
  const box2 = el("div", "pxd-addboard pxd-addpage", doc.body);
  el("div", "pxd-addboard__title", box2, "Add page");
  const filter = el("input", "pxd-addboard__filter", box2);
  filter.type = "text";
  filter.setAttribute("aria-label", "Search pages");
  filter.placeholder = "Search pages…";
  filter.setAttribute("placeholder", "Search pages…");
  const list = el("div", "pxd-addboard__list", box2);
  el("div", "pxd-addboard__empty", list, "Type to search pages");
  let closed = false;
  let busy = false;
  let timer = null;
  let ticket = 0;
  const close = () => {
    if (closed) return;
    closed = true;
    if (current === api) current = null;
    if (timer) clearTimeout(timer);
    for (const off of offs) off();
    back.remove();
    box2.remove();
  };
  const api = { close };
  current = api;
  const show = (rows, text2) => {
    list.replaceChildren();
    if (!rows.length) {
      el("div", "pxd-addboard__empty", list, text2 ? "No matching pages" : "Type to search pages");
      return;
    }
    for (const page of rows) {
      const row2 = el("div", "pxd-addboard__row", list);
      row2.dataset.title = page.title;
      row2.setAttribute("data-title", page.title);
      const label = el("span", "pxd-addboard__text", row2);
      el("span", "pxd-addboard__name", label, page.title);
    }
  };
  const run = () => {
    timer = null;
    const text2 = String(filter.value || "").trim();
    const mine = ++ticket;
    if (!text2) {
      show([], "");
      return;
    }
    Promise.resolve(typeof search === "function" ? search(text2) : []).then((got) => {
      if (closed || mine !== ticket) return;
      show((Array.isArray(got) ? got : []).filter((row2) => row2 && typeof row2.title === "string" && row2.title), text2);
    }, () => {
      if (closed || mine !== ticket) return;
      show([], text2);
    });
  };
  on(box2, "pxd-close", () => close());
  on(back, "pointerdown", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    close();
  });
  on(filter, "input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  });
  on(filter, "keydown", (event) => {
    event.stopPropagation?.();
    if (event.key === "Escape") {
      event.preventDefault?.();
      close();
      return;
    }
    if (event.key === "Enter") {
      const first = list.querySelector?.(".pxd-addboard__row");
      if (first) {
        event.preventDefault?.();
        first.click?.();
      }
    }
  });
  on(list, "click", (event) => {
    const row2 = event.target?.closest?.(".pxd-addboard__row");
    const title = row2?.dataset?.title || row2?.getAttribute?.("data-title");
    if (!title || busy) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    busy = true;
    Promise.resolve(onPick?.(title)).then((ok) => {
      if (ok === false) {
        busy = false;
        return;
      }
      close();
    }, () => {
      busy = false;
    });
  });
  try {
    filter.focus();
  } catch {
  }
  return api;
}

// src/model/tasks.js
var MONTHS4 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var DAILY_RE2 = new RegExp(`^(${MONTHS4.join("|")}) (\\d{1,2})(st|nd|rd|th), (\\d{4})$`);
function parseRoamDay(title) {
  const m = DAILY_RE2.exec(String(title ?? "").trim());
  if (!m) return null;
  const day = Number(m[2]);
  const suffix = day >= 11 && day <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  if (m[3] !== suffix || day < 1 || day > 31) return null;
  const month = MONTHS4.indexOf(m[1]);
  if (month < 0) return null;
  return { y: Number(m[4]), m: month + 1, d: day };
}
function childString(child) {
  return child?.[":block/string"] ?? child?.string ?? "";
}
function dayOf(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  return parseRoamDay(value);
}
function stamp(part) {
  return part.y * 1e4 + part.m * 100 + part.d;
}
function dueChip(content, today = /* @__PURE__ */ new Date()) {
  let raw = null;
  let title = "";
  for (const child of content || []) {
    const text2 = String(childString(child));
    if (attrNameOf(text2) !== "BT_attrDue") continue;
    raw = text2;
    const rest = text2.slice(text2.indexOf("::") + 2).trim();
    const wiki = /^\[\[([\s\S]+)\]\]$/.exec(rest);
    title = (wiki ? wiki[1] : rest).trim();
    break;
  }
  if (raw == null || !title) return null;
  const due = parseRoamDay(title);
  const now2 = dayOf(today);
  return { text: title, overdue: Boolean(due && now2 && stamp(due) < stamp(now2)), raw };
}

// src/model/drop.js
var CARD_MIME = "application/x-plexus-card";
var MAX_DROP = 50;
var URL_LINE = /^(?:https?|roam):\/\//i;
var APP_URL = /#\/app\/([^/?#]+)(?:\/page\/([\w-]+))?/;
function parseDropPayload(dataTransfer, { resolveUid, graph = "" } = {}) {
  if (!dataTransfer) return [];
  const take = (type) => {
    try {
      return String(dataTransfer.getData?.(type) || "");
    } catch {
      return "";
    }
  };
  const resolve = typeof resolveUid === "function" ? resolveUid : (uid) => `((${uid}))`;
  const own = take(CARD_MIME).trim();
  if (own) return [{ string: own }];
  const tokens = (text2) => text2.split(/\s+/).filter((t) => /^[\w-]+$/.test(t));
  let uids = tokens(take("roam/block-uid-list-only-parents"));
  if (!uids.length) uids = tokens(take("roam/block-uid-list"));
  if (!uids.length) {
    for (const type of ["roam/roam-uri-list", "text/uri-list", "text/plain"]) {
      for (const raw of take(type).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (type === "text/plain" && !URL_LINE.test(line)) continue;
        const app = APP_URL.exec(line);
        if (app && graph && decodeURIComponent(app[1]) !== graph) continue;
        const m = app ? app[2] ? [null, app[2]] : null : line.match(/\/page\/([\w-]+)/);
        if (m) uids.push(m[1]);
      }
      if (uids.length) break;
    }
  }
  if (!uids.length) {
    for (const m of take("text/html").matchAll(/data-link-uid="([\w-]+)"/g)) uids.push(m[1]);
  }
  if (uids.length) {
    const out = [];
    for (const uid of [...new Set(uids)].slice(0, MAX_DROP)) {
      let string = null;
      try {
        string = resolve(uid);
      } catch {
        string = null;
      }
      if (typeof string === "string" && string.trim()) out.push({ string });
    }
    if (out.length) return out;
  }
  const chunks = [take("text/plain"), take("text/html")];
  const types = dataTransfer.types;
  if (types) for (const type of types) chunks.push(take(type));
  const blob = chunks.join("\n");
  if (!blob.trim()) return [];
  const page = blob.match(/\[\[([^\]]+)\]\]/);
  if (page) return [{ string: `[[${page[1]}]]` }];
  const blockRef = blob.match(/\(\(([^)]+)\)\)/);
  if (blockRef) return [{ string: `((${blockRef[1]}))` }];
  const linked = take("text/html").match(/data-link-title="([^"]+)"/);
  if (linked) return [{ string: `[[${linked[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"')}]]` }];
  const plain = take("text/plain").trim();
  const tag = /^#([^\s#[\]/][^\s#[\]]*)$/.exec(plain);
  if (tag) return [{ string: `[[${tag[1]}]]` }];
  if (/^[A-Za-z0-9_-]{9}$/.test(plain)) {
    let string = null;
    try {
      string = resolve(plain);
    } catch {
      string = null;
    }
    if (typeof string === "string" && string.trim()) return [{ string }];
  }
  return [];
}

// src/view/panel.js
var DEBOUNCE_MS = 150;
var LIMIT = 40;
function createPanel({ doc = globalThis.document, root, host, timers, on = {}, width } = {}) {
  const listeners2 = [];
  const listen = (el2, type, fn, opts) => {
    el2.addEventListener(type, fn, opts);
    listeners2.push(() => el2.removeEventListener(type, fn, opts));
  };
  const el = (tag, cls, parent, text2) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    if (text2 !== void 0) node2.textContent = text2;
    parent?.append(node2);
    return node2;
  };
  const panel = el("aside", "pxd-panel pxd-chrome", root);
  panel.style.display = "none";
  if (Number.isFinite(Number(width))) panel.style.width = `${nextPanelWidth(width, 0)}px`;
  const resize = el("div", "pxd-panel__resize", panel);
  resize.title = "Resize";
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup"]) {
    listen(panel, type, (event) => {
      if ((type === "keydown" || type === "keyup") && event.target?.closest?.(".pxd-panel__info-mount")) return;
      event.stopPropagation();
    });
  }
  let resizing = null;
  listen(resize, "pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const measured = panel.getBoundingClientRect?.().width;
    const styled = parseFloat(panel.style.width);
    resizing = { x: event.clientX, w: measured || styled || PANEL_WIDTH_DEFAULT };
    try {
      resize.setPointerCapture?.(event.pointerId);
    } catch {
    }
  });
  listen(resize, "pointermove", (event) => {
    if (!resizing) return;
    panel.style.width = `${nextPanelWidth(resizing.w, resizing.x - event.clientX)}px`;
  });
  listen(resize, "pointerup", (event) => {
    if (!resizing) return;
    const next = nextPanelWidth(resizing.w, resizing.x - event.clientX);
    resizing = null;
    panel.style.width = `${next}px`;
    on.rememberWidth?.(next);
  });
  const head = el("div", "pxd-panel__head", panel);
  const tabs = el("div", "pxd-panel__tabs", head);
  const tabBtn = (name, label, icon, on2) => {
    const b = el("button", `pxd-btn pxd-iconbtn pxd-panel__tab${on2 ? " pxd-panel__tab--on" : ""}`, tabs);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.dataset.tab = name;
    b.setAttribute("data-tab", name);
    const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
    i.setAttribute("aria-hidden", "true");
    return b;
  };
  const tabSearch = tabBtn("search", "Search", "search", true);
  const tabRelated = tabBtn("related", "Related", "diagram-tree");
  const tabBoards = tabBtn("boards", "Boards", "applications");
  const tabOutline = tabBtn("outline", "Outline", "list");
  const tabInfo = tabBtn("info", "Info", "info-sign");
  const tabButtons = { search: tabSearch, related: tabRelated, boards: tabBoards, outline: tabOutline, info: tabInfo };
  const closeBtn = el("button", "pxd-btn pxd-iconbtn pxd-panel__close", head);
  closeBtn.type = "button";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  el("span", "bp3-icon bp3-icon-small-cross", closeBtn).setAttribute("aria-hidden", "true");
  const searchPane = el("div", "pxd-panel__pane pxd-panel__pane--search", panel);
  const relatedPane = el("div", "pxd-panel__pane pxd-panel__pane--related", panel);
  relatedPane.style.display = "none";
  const input = el("input", "pxd-input pxd-panel__input", searchPane);
  input.type = "text";
  input.setAttribute("aria-label", "Search pages and blocks");
  input.placeholder = "Search pages and blocks…";
  input.setAttribute("placeholder", "Search pages and blocks…");
  const filters = el("div", "pxd-panel__filters", searchPane);
  const typeSel = el("select", "pxd-panel__type", filters);
  typeSel.setAttribute("aria-label", "Type");
  const typeLabels = { all: "All", page: "Pages", block: "Blocks", board: "Boards", daily: "Dailies" };
  for (const value of LIBRARY_TYPES) {
    const opt = el("option", "pxd-panel__type-opt", typeSel, typeLabels[value]);
    opt.value = value;
    opt.setAttribute("value", value);
  }
  typeSel.value = "all";
  const tagInput = el("input", "pxd-panel__tag", filters);
  tagInput.type = "text";
  tagInput.placeholder = "#tag";
  tagInput.setAttribute("placeholder", "#tag");
  tagInput.setAttribute("aria-label", "Tag");
  const daysInput = el("input", "pxd-panel__days", filters);
  daysInput.type = "number";
  daysInput.min = "0";
  daysInput.placeholder = "days";
  daysInput.setAttribute("placeholder", "days");
  daysInput.setAttribute("aria-label", "Edited in the last N days");
  const orphanLabel = el("label", "pxd-panel__orphan", filters);
  const orphanBox = el("input", "pxd-panel__orphan-box", orphanLabel);
  orphanBox.type = "checkbox";
  orphanBox.setAttribute("aria-label", "Not on any board");
  orphanLabel.append("Not on any board");
  const results = el("div", "pxd-panel__list", searchPane);
  const relatedHead = el("div", "pxd-panel__related-head", relatedPane);
  const relatedTitle = el("span", "pxd-panel__related-title", relatedHead, "Select a card");
  const addAll = el("button", "pxd-btn pxd-panel__add-all", relatedHead, "Add all");
  addAll.type = "button";
  addAll.setAttribute("aria-label", "Add all");
  addAll.style.display = "none";
  const relatedList = el("div", "pxd-panel__list", relatedPane);
  const boardsPane = el("div", "pxd-panel__pane pxd-panel__pane--boards", panel);
  boardsPane.style.display = "none";
  const boardsFilter = el("input", "pxd-input pxd-panel__input pxd-panel__boards-filter", boardsPane);
  boardsFilter.type = "text";
  boardsFilter.setAttribute("aria-label", "Filter boards");
  boardsFilter.placeholder = "Filter boards…";
  boardsFilter.setAttribute("placeholder", "Filter boards…");
  const boardsList = el("div", "pxd-panel__list pxd-panel__boards", boardsPane);
  const outlinePane = el("div", "pxd-panel__pane pxd-panel__pane--outline", panel);
  outlinePane.style.display = "none";
  const outlineList = el("div", "pxd-panel__list pxd-panel__outline", outlinePane);
  const infoPane = el("div", "pxd-panel__pane pxd-panel__pane--info", panel);
  infoPane.style.display = "none";
  const infoTabsBar = el("div", "pxd-panel__infotabs", infoPane);
  const infoScroll = el("div", "pxd-panel__info", infoPane);
  let tab = "search";
  let debounce = null;
  let selected = null;
  let relatedRows = [];
  let queryId = 0;
  const row2 = (parent, { string, label, text: text2, kind }) => {
    const r = el("div", "pxd-panel__row", parent);
    r.setAttribute("draggable", "true");
    r.draggable = true;
    r.dataset.string = string;
    r.setAttribute("data-string", string);
    if (label) el("span", "pxd-panel__row-label", r, label);
    el("span", `pxd-panel__row-text pxd-panel__row-text--${kind || "page"}`, r, text2);
    if (on.isOnBoard?.(string)) {
      r.classList.add("pxd-panel__row--on");
      el("span", "pxd-panel__row-on", r, "on board");
    }
    listen(r, "click", (event) => {
      event.stopPropagation();
      on.addBeside?.(string);
      r.classList.add("pxd-panel__row--on");
    });
    listen(r, "dragstart", (event) => {
      try {
        event.dataTransfer?.setData?.(CARD_MIME, string);
        event.dataTransfer?.setData?.("text/plain", string);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch {
      }
    });
    return r;
  };
  const readFilter = () => ({
    text: input.value,
    type: typeSel.value || "all",
    tag: tagInput.value,
    days: daysInput.value,
    orphan: orphanBox.checked === true
  });
  const runSearch = async () => {
    const filter = readFilter();
    const id = queryId += 1;
    results.replaceChildren();
    if (!libraryFilterActive(filter)) return;
    let pack = null;
    try {
      if (typeof host?.librarySearch === "function") {
        pack = await Promise.resolve(host.librarySearch(filter, LIMIT));
      } else {
        const q = String(filter.text || "").trim();
        if (!q) return;
        const [pages, blocks] = await Promise.all([
          Promise.resolve(host?.searchPages?.(q, LIMIT) || []),
          Promise.resolve(host?.searchBlocks?.(q, LIMIT) || [])
        ]);
        pack = {
          rows: [
            ...(pages || []).map((p) => ({ string: `[[${p.title}]]`, text: p.title, kind: "page", label: "page" })),
            ...(blocks || []).map((b) => ({ string: `((${b.uid}))`, text: `${b.string || ""}`.slice(0, 120), kind: "block", label: b.pageTitle ? `in ${b.pageTitle}` : "block" }))
          ].slice(0, LIMIT),
          queries: []
        };
      }
    } catch {
    }
    if (id !== queryId) return;
    const queries = Array.isArray(pack?.queries) ? pack.queries : [];
    const ms = queries.reduce((max, q) => Math.max(max, Number(q?.ms) || 0), 0);
    results.dataset.queryMs = String(ms);
    results.setAttribute("data-query-ms", String(ms));
    const log = JSON.stringify(queries.map((q) => ({ name: q.name, ms: Math.round((Number(q.ms) || 0) * 10) / 10 })));
    results.dataset.queryLog = log;
    results.setAttribute("data-query-log", log);
    const rows = (Array.isArray(pack?.rows) ? pack.rows : []).slice(0, LIMIT);
    results.replaceChildren();
    if (!rows.length) {
      el("div", "pxd-panel__empty", results, "No matches");
      return;
    }
    rows.forEach((r) => row2(results, r));
  };
  const scheduleSearch = () => {
    debounce?.();
    debounce = timers.later(() => {
      debounce = null;
      void runSearch();
    }, DEBOUNCE_MS);
  };
  const searchNow = () => {
    debounce?.();
    debounce = null;
    void runSearch();
  };
  listen(input, "input", scheduleSearch);
  listen(tagInput, "input", scheduleSearch);
  listen(daysInput, "input", scheduleSearch);
  listen(typeSel, "change", searchNow);
  listen(orphanBox, "change", searchNow);
  listen(input, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      api.close();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      searchNow();
    }
  });
  for (const field of [tagInput, daysInput]) {
    listen(field, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchNow();
      }
    });
  }
  const setTab = (next) => {
    if (tab === "info" && next !== "info") unmountInfo();
    tab = next;
    for (const [name, b] of Object.entries(tabButtons)) b.classList.toggle("pxd-panel__tab--on", tab === name);
    searchPane.style.display = tab === "search" ? "" : "none";
    relatedPane.style.display = tab === "related" ? "" : "none";
    boardsPane.style.display = tab === "boards" ? "" : "none";
    outlinePane.style.display = tab === "outline" ? "" : "none";
    infoPane.style.display = tab === "info" ? "" : "none";
    if (tab === "related") void loadRelated();
    if (tab === "boards") void loadBoards();
    if (tab === "outline") renderOutline();
    if (tab === "info") void loadInfo();
  };
  for (const [name, b] of Object.entries(tabButtons)) listen(b, "click", () => setTab(name));
  listen(closeBtn, "click", () => api.close());
  listen(addAll, "click", () => {
    const strings = relatedRows.map((r) => r.string).filter((s) => !on.isOnBoard?.(s));
    if (strings.length) on.addMany?.(strings);
  });
  const loadRelated = async () => {
    relatedList.replaceChildren();
    relatedRows = [];
    addAll.style.display = "none";
    if (!selected || !host?.related) {
      relatedTitle.textContent = "Select a card";
      return;
    }
    const target = selected.target;
    const key = target.kind === "page" ? { kind: "page", title: target.title } : { kind: "block", uid: target.uid };
    relatedTitle.textContent = selected.title || "Related";
    const id = queryId += 1;
    let list = [];
    try {
      list = await Promise.resolve(host.related(key, 60, { boardUid: root?.dataset?.board })) || [];
    } catch {
      list = [];
    }
    if (id !== queryId || tab !== "related") return;
    relatedList.replaceChildren();
    for (const rel of list) {
      const t = rel.target || {};
      const string = t.kind === "page" ? `[[${t.title}]]` : `((${t.uid}))`;
      const text2 = rel.text || (t.kind === "page" ? t.title : t.uid) || "";
      relatedRows.push({ string });
      row2(relatedList, { string, label: rel.relation || "related", text: text2, kind: t.kind });
    }
    if (!list.length) el("div", "pxd-panel__empty", relatedList, "Nothing related yet");
    addAll.style.display = list.length ? "" : "none";
  };
  let boardRows = [];
  const renderBoards = () => {
    boardsList.replaceChildren();
    const q = String(boardsFilter.value || "").trim().toLowerCase();
    const shown = boardRows.filter((b) => !q || `${b.title || ""}
${b.page || b.pageTitle || ""}`.toLowerCase().includes(q));
    if (!shown.length) {
      el("div", "pxd-panel__empty", boardsList, boardRows.length ? "No matching boards" : "No boards found");
      return;
    }
    for (const b of shown) {
      const r = el("div", "pxd-panel__board-row", boardsList);
      r.dataset.uid = b.uid;
      r.setAttribute("data-uid", b.uid);
      const text2 = el("div", "pxd-panel__board-text", r);
      el("span", "pxd-panel__board-title", text2, b.title || "Untitled board");
      const page = b.page || b.pageTitle;
      if (page) el("span", "pxd-panel__board-page", text2, page);
      const n2 = b.count ?? b.itemCount ?? b.items;
      if (Number.isFinite(n2)) el("span", "pxd-panel__board-count", r, `${n2} ${n2 === 1 ? "item" : "items"}`);
      const add = el("button", "pxd-btn pxd-panel__board-add", r, "Add shortcut");
      add.type = "button";
      add.title = "Add a card for this board to the current board";
      add.setAttribute("aria-label", "Add shortcut");
    }
  };
  listen(boardsList, "click", (event) => {
    const row3 = event.target?.closest?.(".pxd-panel__board-row");
    const uid = row3?.dataset?.uid ?? row3?.getAttribute?.("data-uid");
    if (!uid) return;
    event.preventDefault?.();
    event.stopPropagation();
    if (event.target.closest(".pxd-panel__board-add")) on.addBoardCard?.(uid);
    else on.openBoardByUid?.(uid);
  });
  const loadBoards = async () => {
    const id = queryId += 1;
    boardsList.replaceChildren();
    el("div", "pxd-panel__empty", boardsList, "Loading boards…");
    let rows = [];
    try {
      rows = await Promise.resolve(on.listBoards?.()) || [];
    } catch {
      rows = [];
    }
    if (id !== queryId || tab !== "boards") return;
    boardRows = Array.isArray(rows) ? rows.filter((b) => b && b.uid) : [];
    renderBoards();
  };
  listen(boardsFilter, "input", () => renderBoards());
  listen(boardsFilter, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      api.close();
    }
  });
  const renderOutline = () => {
    outlineList.replaceChildren();
    let rows = [];
    try {
      rows = on.getOutline?.() || [];
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows) || !rows.length) {
      el("div", "pxd-panel__empty", outlineList, "Nothing on this board yet");
      return;
    }
    for (const o of rows) {
      const depth = Math.max(0, Number(o.depth) || 0);
      const r = el("div", "pxd-panel__outline-row", outlineList);
      r.dataset.uid = o.uid;
      r.setAttribute("data-uid", o.uid);
      r.dataset.depth = String(depth);
      r.setAttribute("data-depth", String(depth));
      r.style.paddingLeft = `${8 + depth * 14}px`;
      const dot = el("span", `pxd-panel__outline-dot${o.color ? ` pxd-c-${o.color}` : ""}`, r);
      dot.setAttribute("aria-hidden", "true");
      el("span", "pxd-panel__outline-title", r, o.title || "Untitled");
      if (Number.isFinite(o.count) && o.count > 0) el("span", "pxd-panel__outline-count", r, String(o.count));
    }
  };
  listen(outlineList, "click", (event) => {
    const row3 = event.target?.closest?.(".pxd-panel__outline-row");
    const uid = row3?.dataset?.uid ?? row3?.getAttribute?.("data-uid");
    if (!uid) return;
    event.stopPropagation();
    on.outlineClick?.(uid);
  });
  let cardTabs = [];
  const cardItems = /* @__PURE__ */ new Map();
  let cardCurrent = null;
  let followInfoSelection = true;
  const renderCardTabs = () => {
    infoTabsBar.replaceChildren();
    for (const t of cardTabs) {
      const row3 = el("span", t.uid === cardCurrent ? "pxd-panel__infotab pxd-panel__infotab--on" : "pxd-panel__infotab", infoTabsBar);
      const name = el("button", "pxd-btn pxd-panel__infotab-name", row3, cardItems.get(t.uid)?.title || "Untitled");
      name.type = "button";
      name.setAttribute("aria-label", name.textContent || "Untitled");
      name.dataset.uid = t.uid;
      name.setAttribute("data-uid", t.uid);
      const closer = el("button", "pxd-btn pxd-panel__infotab-x", row3, "×");
      closer.type = "button";
      closer.title = "Close";
      closer.setAttribute("aria-label", "Close");
      closer.dataset.uid = t.uid;
      closer.setAttribute("data-uid", t.uid);
    }
  };
  let infoMounted = false;
  const unmountInfo = () => {
    if (!infoMounted) return;
    infoMounted = false;
    const prev = infoScroll.querySelector(".pxd-panel__info-mount");
    if (prev) {
      try {
        host?.unmount?.(prev);
      } catch {
      }
    }
  };
  const infoSection = (label) => {
    const section2 = el("section", "pxd-panel__info-sec", infoScroll);
    el("div", "pxd-panel__info-h", section2, label);
    return section2;
  };
  const loadInfo = async () => {
    const id = queryId += 1;
    unmountInfo();
    infoScroll.replaceChildren();
    const tabItem = cardCurrent ? cardItems.get(cardCurrent) || null : null;
    const subject = followInfoSelection ? selected : tabItem || selected;
    if (!subject || subject.type === "section") {
      el("div", "pxd-panel__empty", infoScroll, "Select a card");
      return;
    }
    let info = null;
    try {
      info = await Promise.resolve(host?.cardInfo?.(subject)) ?? null;
    } catch {
      info = null;
    }
    if (id !== queryId || tab !== "info") return;
    unmountInfo();
    infoScroll.replaceChildren();
    if (!info) {
      el("div", "pxd-panel__empty", infoScroll, "Nothing to show");
      return;
    }
    const bodySec = infoSection("Card");
    el("div", "pxd-panel__info-body", bodySec, info.body || "");
    const mount = el("div", "pxd-panel__info-mount", bodySec);
    if (on.isFullscreen?.()) {
      try {
        if (info.kind === "page" && info.pageUid && host?.renderPage) {
          host.renderPage(mount, info.pageUid);
          infoMounted = true;
        } else if (info.uid && host?.renderBlock) {
          host.renderBlock(mount, info.uid);
          infoMounted = true;
        }
      } catch {
      }
    } else {
      el("div", "pxd-panel__info-note", mount, "Editing in the right sidebar");
      try {
        on.openSidebarEditor?.(subject);
      } catch {
      }
    }
    const attrSec = infoSection("Attributes");
    if (!info.attributes?.length) el("div", "pxd-panel__empty", attrSec, "No attributes");
    else for (const attr of info.attributes) {
      const row3 = el("div", "pxd-panel__info-attr", attrSec);
      el("span", "pxd-panel__info-name", row3, attr.name);
      el("span", "pxd-panel__info-value", row3, attr.value);
    }
    const refSec = infoSection("Linked references");
    if (!info.refs?.length) el("div", "pxd-panel__empty", refSec, "No linked references");
    else for (const ref of info.refs) {
      const row3 = el("button", "pxd-btn pxd-panel__info-ref", refSec, ref.string || ref.uid);
      row3.type = "button";
      row3.setAttribute("aria-label", ref.string || ref.uid);
      row3.dataset.uid = ref.uid;
      row3.setAttribute("data-uid", ref.uid);
      if (ref.pageTitle) row3.title = ref.pageTitle;
    }
    const boardSec = infoSection("On boards");
    if (!info.boards?.length) el("div", "pxd-panel__empty", boardSec, "Not on another board");
    else for (const board2 of info.boards) {
      const row3 = el("button", "pxd-btn pxd-panel__info-board", boardSec);
      row3.type = "button";
      row3.setAttribute("aria-label", board2.title || "Untitled board");
      row3.dataset.uid = board2.uid;
      row3.setAttribute("data-uid", board2.uid);
      el("span", "pxd-panel__info-board-title", row3, board2.title || "Untitled board");
      if (board2.pageTitle) el("span", "pxd-panel__info-board-page", row3, board2.pageTitle);
    }
    const tagSec = infoSection("Tags");
    if (!info.tags?.length) el("div", "pxd-panel__empty", tagSec, "No tags");
    else {
      const wrap = el("div", "pxd-panel__info-tags", tagSec);
      for (const name of info.tags) el("span", "pxd-panel__info-tag", wrap, name);
    }
  };
  listen(infoScroll, "click", (event) => {
    const board2 = event.target?.closest?.(".pxd-panel__info-board");
    const ref = event.target?.closest?.(".pxd-panel__info-ref");
    const node2 = board2 || ref;
    const uid = node2?.dataset?.uid ?? node2?.getAttribute?.("data-uid");
    if (!uid) return;
    event.preventDefault?.();
    event.stopPropagation();
    if (board2) on.openBoardByUid?.(uid);
    else on.openRef?.(uid);
  });
  listen(infoTabsBar, "click", (event) => {
    const closer = event.target?.closest?.(".pxd-panel__infotab-x");
    const name = event.target?.closest?.(".pxd-panel__infotab-name");
    const node2 = closer || name;
    const uid = node2?.dataset?.uid ?? node2?.getAttribute?.("data-uid");
    if (!uid) return;
    event.preventDefault?.();
    event.stopPropagation();
    if (closer) {
      const next = closeInfoTab(cardTabs, cardCurrent, uid);
      cardTabs = next.tabs;
      if (!next.tabs.some((t) => t.uid === uid)) cardItems.delete(uid);
      cardCurrent = next.current;
      followInfoSelection = false;
      renderCardTabs();
      void loadInfo();
      return;
    }
    cardCurrent = uid;
    followInfoSelection = false;
    renderCardTabs();
    on.focusInfoTab?.(uid);
    void loadInfo();
  });
  const api = {
    el: panel,
    open(which = tab) {
      panel.style.display = "";
      setTab(which);
      on.opened?.(true);
      const focusTarget = which === "search" ? input : which === "boards" ? boardsFilter : null;
      if (focusTarget) {
        try {
          focusTarget.focus({ preventScroll: true });
        } catch {
          focusTarget.focus?.();
        }
      }
    },
    currentTab: () => tab,
    refreshOutline() {
      if (api.isOpen() && tab === "outline") renderOutline();
    },
    close() {
      if (tab === "info") unmountInfo();
      panel.style.display = "none";
      on.opened?.(false);
    },
    toggle() {
      if (api.isOpen()) api.close();
      else api.open();
    },
    isOpen: () => panel.style.display !== "none",
    setSelection(item) {
      selected = item && item.type !== "section" ? item : null;
      followInfoSelection = true;
      if (selected && cardItems.has(selected.uid)) cardCurrent = selected.uid;
      if (api.isOpen() && tab === "related") void loadRelated();
      if (api.isOpen() && tab === "info") {
        renderCardTabs();
        void loadInfo();
      }
    },
    addInfoTab(item) {
      if (!item?.uid || item.type === "section") return cardTabs.map((t) => t.uid);
      const title = item.title || String(item.string || "").split("\n")[0].slice(0, 48) || "Untitled";
      cardItems.set(item.uid, { ...item, title });
      const next = infoTabList(cardTabs, item.uid, { add: true });
      cardTabs = next.tabs;
      cardCurrent = next.current;
      followInfoSelection = false;
      panel.style.display = "";
      setTab("info");
      on.opened?.(true);
      renderCardTabs();
      void loadInfo();
      return cardTabs.map((t) => t.uid);
    },
    infoTabs: () => cardTabs.map((t) => t.uid),
    infoCurrent: () => cardCurrent,
    refreshMarks() {
      for (const r of panel.querySelectorAll(".pxd-panel__row")) {
        const s = r.dataset?.string || r.getAttribute("data-string");
        r.classList.toggle("pxd-panel__row--on", Boolean(on.isOnBoard?.(s)));
      }
    },
    dispose() {
      debounce?.();
      queryId += 1;
      unmountInfo();
      listeners2.splice(0).forEach((off) => off());
      panel.remove();
    }
  };
  return api;
}

// src/view/editor-menus.js
var MENU_SELECTOR = ".rm-autocomplete__results, .bp3-datepicker, .rm-date-picker";
var claimed = /* @__PURE__ */ new WeakSet();
var computedTransform = (node2) => {
  if (!node2) return "";
  const view = node2.ownerDocument?.defaultView || globalThis;
  const cs = view.getComputedStyle?.(node2);
  if (!cs) return node2.style?.transform || "";
  if (typeof cs.transform === "string" && cs.transform) return cs.transform;
  const raw = typeof cs.getPropertyValue === "function" ? cs.getPropertyValue("transform") : "";
  return raw || "";
};
var portalShift = (menu) => {
  let node2 = menu?.parentElement;
  const stop = menu?.ownerDocument?.body;
  while (node2 && node2 !== stop) {
    const tf = computedTransform(node2);
    const parts = /matrix\(([^)]+)\)/.exec(tf || "");
    if (parts) {
      const n2 = parts[1].split(",").map((s) => Number(s.trim()));
      const x = n2[4] || 0;
      const y = n2[5] || 0;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) return { x, y };
    }
    node2 = node2.parentElement;
  }
  return null;
};
var releaseAncestorTransforms = (menu) => {
  let node2 = menu?.parentElement;
  const stop = menu?.ownerDocument?.body;
  while (node2 && node2 !== stop) {
    if (computedTransform(node2) && computedTransform(node2) !== "none") {
      node2.style?.setProperty?.("transform", "none", "important");
    }
    if (typeof node2.matches === "function" && node2.matches(".bp3-overlay, .bp3-transition-container, .bp3-portal")) {
      node2.style?.setProperty?.("pointer-events", "none", "important");
    }
    node2 = node2.parentElement;
  }
  menu?.style?.setProperty?.("pointer-events", "auto", "important");
};
var pin = (menu, left, top) => {
  const style = menu?.style;
  if (!style?.setProperty) return;
  style.setProperty("position", "fixed", "important");
  style.setProperty("transform", "none", "important");
  style.setProperty("margin", "0", "important");
  style.setProperty("zoom", "1", "important");
  style.setProperty("z-index", "4000", "important");
  style.setProperty("left", `${Math.round(left)}px`, "important");
  style.setProperty("top", `${Math.round(top)}px`, "important");
};
function placeEditorMenus(doc, anchor) {
  if (!doc || !anchor || typeof anchor.getBoundingClientRect !== "function") return 0;
  const box2 = anchor.getBoundingClientRect();
  if (!box2 || !((box2.width || 0) > 0 || (box2.height || 0) > 0)) return 0;
  const view = doc.defaultView || globalThis;
  const viewW = Number(view.innerWidth) || 0;
  const viewH = Number(view.innerHeight) || 0;
  const anchorIsField = typeof anchor.matches === "function" && (anchor.matches("textarea") || anchor.matches(".rm-block__input"));
  const anchorInBoard = Boolean(anchor.closest?.(".pxd-root"));
  let placed = 0;
  let nearest = null;
  let nearestD = Infinity;
  const pinAtAnchor = (menu) => {
    const width = Number(menu.offsetWidth) || Number(menu.getBoundingClientRect?.().width) || 320;
    const height = Number(menu.offsetHeight) || Number(menu.getBoundingClientRect?.().height) || 0;
    let left = box2.left;
    let top = box2.bottom + 2;
    if (viewW && left + width > viewW - 8) left = Math.max(8, viewW - width - 8);
    if (viewH && height && top + height > viewH - 8) top = Math.max(8, box2.top - height - 2);
    pin(menu, left, top);
    placed += 1;
  };
  for (const menu of doc.querySelectorAll?.(MENU_SELECTOR) || []) {
    if (!menu || menu === anchor) continue;
    const pageMenu = typeof menu.matches === "function" && menu.matches(".rm-autocomplete__results");
    const inBoard = Boolean(menu.closest?.(".pxd-root"));
    if (pageMenu) {
      if (!anchorIsField) continue;
      if (inBoard && doc.body) doc.body.append(menu);
      pinAtAnchor(menu);
      continue;
    }
    if (inBoard) {
      if (doc.body) doc.body.append(menu);
      releaseAncestorTransforms(menu);
      pinAtAnchor(menu);
      continue;
    }
    if (!anchorInBoard) continue;
    const overlay = menu.closest?.(".bp3-overlay");
    const overlayOpen = !overlay || overlay.classList?.contains?.("bp3-overlay-open") || String(overlay.className || "").includes("bp3-overlay-open");
    if (!overlayOpen) {
      claimed.delete(menu);
      continue;
    }
    if (!claimed.has(menu) && !portalShift(menu)) continue;
    if (claimed.has(menu)) {
      nearest = menu;
      nearestD = 0;
      break;
    }
    const own = menu.getBoundingClientRect?.();
    const d = own ? Math.hypot((own.left || 0) - box2.left, (own.top || 0) - box2.top) : Infinity;
    if (d < nearestD) {
      nearest = menu;
      nearestD = d;
    }
  }
  if (nearest && (claimed.has(nearest) || nearestD < 900)) {
    claimed.add(nearest);
    releaseAncestorTransforms(nearest);
    pinAtAnchor(nearest);
  }
  return placed;
}
function watchEditorMenus(doc, getAnchor, onIdle) {
  let stopped = false;
  let frame = 0;
  let misses = 0;
  const view = doc?.defaultView || globalThis;
  const tick = () => {
    frame = 0;
    if (stopped) return;
    const anchor = typeof getAnchor === "function" ? getAnchor() : null;
    if (!anchor) {
      misses += 1;
      if (misses > 12) {
        stopped = true;
        onIdle?.();
        return;
      }
    } else {
      misses = 0;
      placeEditorMenus(doc, anchor);
    }
    if (stopped) return;
    const raf2 = view.requestAnimationFrame;
    if (typeof raf2 !== "function") return;
    frame = raf2(tick);
  };
  tick();
  return () => {
    stopped = true;
    if (frame && typeof view.cancelAnimationFrame === "function") view.cancelAnimationFrame(frame);
    frame = 0;
  };
}

// src/view/editor-scale.js
var nearOne = (z) => Math.abs(z - 1) < 1e-3;
function editorCounterScale(zoom, baseFont = 14) {
  const z = Number(zoom);
  if (!(z > 0) || !Number.isFinite(z) || nearOne(z)) return null;
  const font = Number(baseFont);
  const base = font > 0 && Number.isFinite(font) ? font : 14;
  return {
    z,
    width: `${z * 100}%`,
    height: `${z * 100}%`,
    transform: `scale(${1 / z})`,
    fontPx: base * z
  };
}
var paint = (style, name, value) => {
  if (!style) return;
  if (value) style.setProperty?.(name, value);
  else style.removeProperty?.(name);
};
function applyEditorCounterScale(editor, zoom, baseFont = 14) {
  const style = editor?.style;
  if (!style?.setProperty) return false;
  const next = editorCounterScale(zoom, baseFont);
  const body = editor.parentElement;
  if (!next) {
    for (const name of ["position", "left", "top", "width", "height", "transform", "transform-origin"]) paint(style, name, "");
    style.removeProperty?.("--pxd-ed-z");
    for (const node2 of editor.querySelectorAll?.("textarea, .rm-block__input") || []) {
      node2.style?.removeProperty?.("font-size");
      node2.style?.removeProperty?.("height");
    }
    if (body?.dataset?.pxdScreen === "1" && body.style) {
      body.style.position = "";
      delete body.dataset.pxdScreen;
    }
    return false;
  }
  if (body?.style) {
    body.style.position = "relative";
    if (body.dataset) body.dataset.pxdScreen = "1";
  }
  paint(style, "position", "absolute");
  paint(style, "left", "0");
  paint(style, "top", "0");
  paint(style, "width", next.width);
  paint(style, "height", next.height);
  paint(style, "transform", next.transform);
  paint(style, "transform-origin", "top left");
  style.setProperty("--pxd-ed-z", String(next.z));
  const font = `${next.fontPx}px`;
  for (const node2 of editor.querySelectorAll?.("textarea, .rm-block__input") || []) {
    node2.style?.setProperty?.("font-size", font, "important");
    node2.style?.setProperty?.("height", "auto", "important");
  }
  return true;
}

// src/view/cards.js
var SIDES3 = ["top", "right", "bottom", "left"];
var CHUNK_MS = 8;
var LRU_CAP = 80;
var UNMOUNT_AFTER_MS = 4e3;
var HYDRATE_CAP_MS = 900;
var CONTENT_LIMIT = 12;
var CONTENT_DEPTH = 2;
var OUTLINE_CAP = 300;
var OUTLINE_FETCH = 2e3;
var PAGE_WATCH_MAX = 8;
var PAGE_REFRESH_MS = 250;
var GROW_CAP = 900;
var HEADER_H = 32;
var META_H = 28;
var REF_TITLE_MAX = 120;
var HEADER_TEXT_MAX = 160;
var TINY_MINI_PX = 28;
var ATTR_CHIPS_MAX = 3;
var SVG_NS = "http://www.w3.org/2000/svg";
var BOARD_KEY_DEPTH = 3;
var BOARD_KEY_NODES = 400;
var KID_ROW_H = 22;
var PEEK_DELAY_MS = 400;
var PEEK_TOP = 12;
var PEEK_SUB = 4;
var PEEK_TEXT_MAX = 140;
var now = () => globalThis.performance?.now ? globalThis.performance.now() : Date.now();
function isTextEntryTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  if (typeof target.getAttribute === "function" && target.getAttribute("contenteditable") === "true") return true;
  if (typeof target.closest !== "function") return false;
  const hit = target.closest('[contenteditable="true"], .pxd-label--editing, .pxd-section__title--editing, .pxd-input');
  return Boolean(hit && !hit.querySelector?.(".pxd-root"));
}
function pageBodyWantsWheel(target, event) {
  if (!target || typeof target.closest !== "function" || !event) return null;
  if (event.ctrlKey || event.metaKey) return null;
  const dy = Number(event.deltaY) || 0;
  if (!dy) return null;
  const body = target.closest(".pxd-item__body");
  const card2 = body?.closest(".pxd-item--page");
  if (!card2 || card2.classList?.contains("pxd-item--editing")) return null;
  const room = (Number(body.scrollHeight) || 0) - (Number(body.clientHeight) || 0);
  if (room <= 1) return null;
  const top = Number(body.scrollTop) || 0;
  if (dy > 0 ? top >= room - 1 : top <= 0) return null;
  return body;
}
function synthesizeBlockClick(host) {
  if (!host?.dispatchEvent) return false;
  const rect = host.getBoundingClientRect?.() || { left: 0, top: 0, height: 0 };
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: (Number(rect.left) || 0) + 2,
    clientY: (Number(rect.top) || 0) + (Number(rect.height) || 0) / 2
  };
  for (const type of ["mousedown", "mouseup", "click"]) {
    const Ctor = globalThis.MouseEvent || globalThis.Event;
    const event = typeof Ctor === "function" ? new Ctor(type, init) : { type, ...init };
    host.dispatchEvent(event);
  }
  return true;
}
function focusRoamInput(el) {
  if (!el) return false;
  try {
    el.focus?.({ preventScroll: true });
  } catch {
    try {
      el.focus?.();
    } catch {
    }
  }
  synthesizeBlockClick(el);
  return true;
}
function nextFrame() {
  return new Promise((resolve) => {
    const raf2 = globalThis.requestAnimationFrame;
    if (typeof raf2 === "function") raf2(() => resolve());
    else setTimeout(resolve, 16);
  });
}
async function waitHydrateQuiet(el, capMs = HYDRATE_CAP_MS) {
  const MO = globalThis.MutationObserver;
  if (!el || typeof MO !== "function") {
    await nextFrame();
    await nextFrame();
    return;
  }
  let mutations = 0;
  const observer = new MO(() => {
    mutations += 1;
  });
  try {
    observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch {
  }
  const start = Date.now();
  const grace = 250;
  let quiet = 0;
  let saw = false;
  try {
    while (Date.now() - start < capMs) {
      if (!saw && Date.now() - start >= grace) break;
      await nextFrame();
      if (mutations > 0) {
        saw = true;
        quiet = 0;
      } else if (saw) quiet += 1;
      mutations = 0;
      if (saw && quiet >= 2) break;
    }
  } finally {
    observer.disconnect();
  }
}
var childString2 = (c) => c?.[":block/string"] ?? c?.string ?? "";
var childKids = (c) => c?.[":block/children"] ?? c?.children ?? [];
var childUid = (c) => c?.[":block/uid"] ?? c?.uid ?? "";
var childProps = (c) => c?.[":block/props"] ?? c?.props;
var KIDS_KINDS = ["note", "block"];
var isKidsCard = (item) => item?.type === "card" && KIDS_KINDS.includes(item.kind);
var visibleKids = (list) => (list || []).filter((c) => attrNameOf(childString2(c)) !== "BT_attrDue");
function kidRowsOf(list, depth = 1, budget = { n: 0 }) {
  for (const c of visibleKids(list)) {
    if (budget.n >= CONTENT_LIMIT) break;
    budget.n += 1;
    const kids = childKids(c);
    if (kids.length && depth < CONTENT_DEPTH) kidRowsOf(kids, depth + 1, budget);
  }
  return budget.n;
}
function contentKeyOf(item) {
  const parts = [
    item.kind,
    item.enhanced ? "e" : "",
    item.string,
    item.collapsed ? "c" : "",
    item.open === false ? "x" : "",
    item.kids ? "k" : "",
    item.fontSize || "",
    item.textColor || "",
    item.align || "",
    item.fill || "",
    item.border || "",
    item.titleSize || "",
    item.titleColor || "",
    item.titleFill || "",
    item.areaFill || ""
  ];
  if (item.kind === "board") parts.push(item.w, item.h);
  if (item.kind === "board") {
    let budget = BOARD_KEY_NODES;
    const walkBoard = (kids, depth) => {
      if (depth > BOARD_KEY_DEPTH) return;
      for (const c of kids) {
        if (budget-- <= 0) return;
        parts.push(childUid(c), childString2(c), JSON.stringify(childProps(c) ?? null));
        walkBoard(childKids(c), depth + 1);
      }
    };
    walkBoard(item.content || [], 1);
    return parts.join("");
  }
  const walk = (kids, depth) => {
    if (depth > CONTENT_DEPTH) return;
    for (const c of kids) {
      parts.push(childString2(c));
      walk(childKids(c), depth + 1);
    }
  };
  walk(item.content || [], 1);
  return parts.join("");
}
function createItemRenderer({
  doc = globalThis.document,
  host,
  session,
  itemsLayer,
  sectionsLayer,
  timers,
  onGrow,
  onRenameCommit,
  onEditChange,
  onEditResize,
  onOpenBoard,
  onRenameBoard,
  onRenamePage,
  onBadgeClick,
  onPageLayout
} = {}) {
  const shells = /* @__PURE__ */ new Map();
  const mounted = /* @__PURE__ */ new Map();
  const noteRender = (uid) => {
    const bag = host?.stats;
    if (!bag || typeof bag !== "object") return;
    if (!bag.items || typeof bag.items !== "object") bag.items = {};
    bag.items[uid] = (Number(bag.items[uid]) || 0) + 1;
  };
  let lod = "detail";
  let focusSet = null;
  let badgeMap = /* @__PURE__ */ new Map();
  let showBadges = false;
  let zoomCache = 1;
  let paused = false;
  let editing = null;
  let stopMenus = null;
  let queue = [];
  let idleHandle = null;
  let wanted = /* @__PURE__ */ new Set();
  let lastBoard = null;
  let lastRects = null;
  let focusGuard = null;
  let floorTeardown = null;
  let floor = null;
  let floorRetry = null;
  let recoveries = [];
  let lastOutsideDown = -Infinity;
  let disposed = false;
  const menuAnchor = () => doc.querySelector?.(".pxd-item--editing textarea") || doc.querySelector?.(".pxd-root .bp3-popover-open") || null;
  const ensureMenus = (getAnchor = menuAnchor) => {
    if (disposed || stopMenus) return;
    const stop = watchEditorMenus(doc, getAnchor, () => {
      if (stopMenus === stop) stopMenus = null;
    });
    stopMenus = stop;
  };
  const onMenuPointer = () => {
    if (!disposed) ensureMenus();
  };
  doc.addEventListener?.("pointerup", onMenuPointer, true);
  const later = (fn, ms) => timers?.later ? timers.later(fn, ms) : (() => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  })();
  const idle = (fn) => {
    if (timers?.idle) return timers.idle(fn);
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === "function") {
      const id = ric(fn);
      return () => globalThis.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => fn({ timeRemaining: () => CHUNK_MS, didTimeout: true }), 0);
    return () => clearTimeout(t);
  };
  const el = (tag, cls, parent) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    parent?.append(node2);
    return node2;
  };
  const EMBED_SEL = "iframe, video, .rm-pdf-highlight, .rm-pdf-container, .twitter-tweet, .rm-xparser-default-tweet";
  const embedLive = (node2) => {
    for (const child of node2.children || []) if (child.classList?.contains("pxd-rs__live")) return child;
    return node2;
  };
  const armEmbedShield = (node2, live) => {
    const syncShield = () => {
      const hit = live.querySelector?.(EMBED_SEL);
      let shield = null;
      for (const child of node2.children || []) if (child.classList?.contains("pxd-embed-shield")) shield = child;
      if (hit && !shield) {
        const cover = el("div", "pxd-embed-shield", node2);
        cover.setAttribute("aria-hidden", "true");
      } else if (!hit && shield) shield.remove();
    };
    syncShield();
    const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (typeof MO !== "function") return;
    const mo = new MO(() => syncShield());
    try {
      mo.observe(live, { childList: true, subtree: true });
    } catch {
      return;
    }
    node2.__pxdEmbedMo = mo;
  };
  const mountQuery = (parent, uid) => {
    const live = el("div", "pxd-rs pxd-item__query", parent);
    const mount = el("div", "pxd-rs__live", live);
    try {
      host.renderBlock(mount, uid);
    } catch {
      mount.textContent = "Query";
    }
    return live;
  };
  const setHidden = (node2, hidden) => {
    node2.hidden = hidden;
    if (hidden) node2.setAttribute("hidden", "");
    else node2.removeAttribute("hidden");
  };
  const addRefRow = (list, rec, ref, on) => {
    const payload = linkedRefCard(ref?.uid);
    if (!payload) return;
    const row2 = el("div", "pxd-refs__row", list);
    row2.draggable = true;
    row2.setAttribute("draggable", "true");
    row2.dataset.uid = ref.uid;
    row2.setAttribute("data-uid", ref.uid);
    const liveWrap = el("div", "pxd-rs", row2);
    const live = el("div", "pxd-rs__live", liveWrap);
    try {
      if (host?.renderBlock) host.renderBlock(live, ref.uid);
      else live.textContent = String(ref.string || "");
    } catch {
      live.textContent = String(ref.string || "");
    }
    armEmbedShield(liveWrap, live);
    rec.roots.push(liveWrap);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) on(row2, type, stopEvent);
    on(row2, "dragstart", (event) => {
      event.stopPropagation();
      try {
        event.dataTransfer?.setData?.(CARD_MIME, payload);
        event.dataTransfer?.setData?.("text/plain", payload);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch {
      }
    });
  };
  const mountLinkedRefs = (body, rec, item) => {
    let refs = [];
    try {
      const got = host?.linkedRefs?.(item, { limit: LINKED_REF_CAP });
      if (Array.isArray(got)) refs = got.slice(0, LINKED_REF_CAP);
    } catch {
      refs = [];
    }
    const offs = [];
    const on = (node2, type, fn) => {
      node2.addEventListener(type, fn);
      offs.push(() => node2.removeEventListener(type, fn));
    };
    rec.refOff = () => {
      for (const off of offs.splice(0)) off();
    };
    const wrap = el("div", "pxd-refs", body);
    const toggle = el("button", "pxd-refs__toggle", wrap);
    toggle.type = "button";
    toggle.textContent = linkedRefLabel(refs.length);
    toggle.setAttribute("aria-label", toggle.textContent);
    toggle.setAttribute("aria-expanded", "false");
    const list = el("div", "pxd-refs__list", wrap);
    setHidden(list, true);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) on(toggle, type, stopEvent);
    let filled = false;
    on(toggle, "click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      wrap.classList.toggle("pxd-refs--open", open);
      setHidden(list, !open);
      if (!open || filled) return;
      filled = true;
      for (const ref of refs) addRefRow(list, rec, ref, on);
    });
  };
  const loggedRenderErrors = /* @__PURE__ */ new Set();
  const showRenderChip = (node2, uid) => {
    node2.classList.add("pxd-item--error");
    const chip = el("div", "pxd-render-chip", node2);
    el("span", "pxd-render-chip__label", chip).textContent = "Could not render";
    el("span", "pxd-render-chip__uid", chip).textContent = uid;
    const open = el("button", "pxd-btn pxd-render-chip__open", chip);
    open.type = "button";
    open.textContent = "Open";
    open.setAttribute("aria-label", "Open");
    for (const type of ["pointerdown", "mousedown", "dblclick", "click"]) {
      open.addEventListener(type, (event) => {
        stopEvent(event);
        if (type === "click" && uid) host?.openBlock?.(uid);
      });
    }
  };
  const RENDER_FAIL = "Error rendering component";
  const renderRoot = (parent, string, cls = "pxd-rs", uid = "") => {
    const node2 = el("div", cls, parent);
    if (!string) return node2;
    const live = el("div", "pxd-rs__live", node2);
    const buffered = [];
    const origError = console.error;
    console.error = (...args) => {
      buffered.push(args);
    };
    let thrown = null;
    try {
      if (host?.renderString) host.renderString(live, string);
      else live.textContent = plainText(string);
    } catch (error) {
      thrown = error;
    } finally {
      console.error = origError;
    }
    const renderedText = String(live.textContent || "");
    const failed = Boolean(thrown) || renderedText.includes(RENDER_FAIL);
    if (!failed) {
      for (const args of buffered) origError.apply(console, args);
      armEmbedShield(node2, live);
      return node2;
    }
    try {
      host?.unmount?.(live);
    } catch {
    }
    try {
      live.remove();
    } catch {
    }
    showRenderChip(node2, uid);
    if (!loggedRenderErrors.has(uid)) {
      loggedRenderErrors.add(uid);
      const reported = thrown || buffered[0]?.[0] || new Error(renderedText.slice(0, 180));
      origError.call(console, reported);
    }
    return node2;
  };
  const unmountRoots = (rec) => {
    try {
      rec.refOff?.();
    } catch {
    }
    rec.refOff = null;
    try {
      rec.pageUnwatch?.();
    } catch {
    }
    rec.pageUnwatch = null;
    rec.pageRoots = [];
    rec.pageHolder = null;
    rec.scrollOff?.();
    rec.scrollOff = null;
    if (!rec.roots?.length) return;
    for (const node2 of rec.roots) {
      try {
        node2.__pxdEmbedMo?.disconnect();
      } catch {
      }
      try {
        host?.unmount?.(embedLive(node2));
      } catch {
      }
    }
    rec.roots = [];
  };
  const buildPorts = (parent) => {
    const wrap = el("div", "pxd-ports", parent);
    for (const side of SIDES3) {
      const p = el("div", `pxd-port pxd-port--${side}`, wrap);
      p.dataset.side = side;
      p.setAttribute("data-side", side);
      p.title = "Drag to connect";
    }
    return wrap;
  };
  const buildGrips = (parent) => {
    for (const part of ["right", "bottom", "corner"]) {
      const g = el("div", `pxd-grip pxd-grip--${part}`, parent);
      g.dataset.part = part;
      g.setAttribute("data-part", part);
    }
  };
  const buildShell = (item) => {
    const rec = { uid: item.uid, type: item.type, roots: [], contentKey: null, rect: null, bare: item.type === "card" };
    if (item.type === "section") {
      const node2 = el("div", "pxd-section", null);
      rec.el = node2;
      rec.title = el("div", "pxd-section__title", node2);
      rec.note = el("div", "pxd-section__note", node2);
      for (const side of ["t", "r", "b", "l"]) el("div", `pxd-section__edge pxd-section__edge--${side}`, node2);
      buildGrips(node2);
      buildPorts(node2);
    } else {
      const node2 = el("div", `pxd-item pxd-item--${item.type}`, null);
      rec.el = node2;
      rec.header = el("div", "pxd-item__header", node2);
      rec.body = el("div", "pxd-item__body", node2);
      buildPorts(node2);
      buildGrips(node2);
    }
    rec.el.dataset.uid = item.uid;
    rec.el.setAttribute("data-uid", item.uid);
    rec.el.setAttribute("role", "group");
    rec.el.tabIndex = -1;
    rec.tabStop = -1;
    shells.set(item.uid, rec);
    return rec;
  };
  const setVar = (el2, name, value) => {
    if (value) el2.style.setProperty(name, value);
    else el2.style.removeProperty(name);
  };
  const applyStyle = (rec, item) => {
    const node2 = rec.el;
    if (item.type === "section") {
      const d = item.sectionDefaults || {};
      const area = item.areaFill ?? d.areaFill;
      const border = item.border ?? d.border;
      const titleSize = item.titleSize ?? d.titleSize;
      const titleColor = item.titleColor ?? d.titleColor;
      const titleFill = item.titleFill ?? d.titleFill;
      setVar(node2, "--pxd-fill", cssColor(area, "fill"));
      setVar(node2, "--pxd-line", cssColor(border, "line") || hexColor(item.color) || "");
      if (rec.title) {
        rec.title.style.fontSize = titleSize ? `${titleSize}px` : "";
        rec.title.style.color = cssColor(titleColor, "text") || "";
        rec.title.style.background = cssColor(titleFill, "fill") || "";
      }
      return;
    }
    const accent = hexColor(item.color);
    setVar(node2, "--pxd-card-fs", item.fontSize ? `${item.fontSize}px` : "");
    setVar(node2, "--pxd-text-fs", item.type === "text" && item.fontSize ? `${item.fontSize}px` : "");
    setVar(node2, "--pxd-text-c", cssColor(item.textColor, "text") || accent || "");
    setVar(node2, "--pxd-fill", cssColor(item.fill, "fill") || accent || "");
    setVar(node2, "--pxd-line", cssColor(item.border, "line") || accent || "");
    node2.style.textAlign = item.align || "";
    const stickyHex = item.type === "text" && item.look === "sticky" && !item.shape ? hexColor(item.fill) || accent || "" : "";
    node2.style.backgroundColor = stickyHex;
  };
  const syncShape = (rec, item, size) => {
    const name = item?.type === "text" && SHAPES.includes(item.shape) ? item.shape : "";
    if (!name) {
      if (rec.shapeEl) {
        rec.shapeEl.remove();
        rec.shapeEl = null;
        rec.shapePath = null;
      }
      rec.shapeName = "";
      rec.shapeKey = "";
      return;
    }
    if (!rec.shapeEl) {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "pxd-shape");
      svg.setAttribute("aria-hidden", "true");
      const path = doc.createElementNS(SVG_NS, "path");
      svg.append(path);
      const before = rec.body || null;
      if (before) rec.el.insertBefore(svg, before);
      else rec.el.append(svg);
      rec.shapeEl = svg;
      rec.shapePath = path;
    }
    const w = size?.w ?? item.w;
    const h = size?.h ?? item.h;
    const key = `${name}:${w}:${h}`;
    rec.shapeName = name;
    if (rec.shapeKey === key) return;
    rec.shapeEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    rec.shapePath.setAttribute("d", shapePath({ x: 0, y: 0, w, h }, name));
    rec.shapeKey = key;
  };
  const paintShell = (rec, item) => {
    const node2 = rec.el;
    if (item.type !== "section") {
      rec.refString = null;
      rec.refBoard = false;
      if (item.kind === "block" && item.target?.uid) {
        const refString = host?.blockString?.(item.target.uid);
        if (typeof refString === "string") {
          rec.refString = refString;
          rec.refBoard = classifyString(refString).kind === "board";
        }
        if (rec.refBoard) rec.refTitle = parseBoardTitle(rec.refString) || "Untitled board";
        else rec.refTitle = typeof refString === "string" ? firstLine(refString).slice(0, REF_TITLE_MAX) : "";
      } else rec.refTitle = "";
    }
    const base = item.type === "section" ? "pxd-section" : `pxd-item pxd-item--${item.type} pxd-item--${item.kind}`;
    const cls = [base];
    if (PALETTE.includes(item.color)) cls.push(`pxd-c-${item.color}`);
    if (item.collapsed && item.type !== "section") cls.push("pxd-item--collapsed");
    if (item.type === "section" && item.collapsed) cls.push("pxd-section--collapsed");
    if (item.type === "section" && item.look === "lane") cls.push("pxd-section--lane", item.axis === "vertical" ? "pxd-lane-v" : "pxd-lane-h");
    if (!item.string?.trim()) cls.push("pxd-item--empty");
    if (item.type === "text" && FONT_SIZES.includes(item.fontSize)) cls.push(`pxd-item--fs${item.fontSize}`);
    if (item.type !== "section" && item.fontSize) cls.push("pxd-fs");
    if (item.textColor) cls.push("pxd-has-textc");
    if (item.type === "text" && item.shape) cls.push("pxd-item--shape", `pxd-item--shape-${item.shape}`);
    else if (item.type === "text" && item.look === "sticky") cls.push("pxd-item--sticky");
    else if (item.type === "text" && (item.fill || item.border)) cls.push("pxd-text-paint");
    if (rec.selected) cls.push(item.type === "section" ? "pxd-section--selected" : "pxd-item--selected");
    if (rec.hover) cls.push("pxd-item--drop");
    if (editing?.uid === item.uid) cls.push("pxd-item--editing");
    if (item.pinned) cls.push(item.type === "section" ? "pxd-section--pinned" : "pxd-item--pinned");
    if (focusSet && !focusSet.has(item.uid)) cls.push(item.type === "section" ? "pxd-section--focus-dim" : "pxd-item--focus-dim");
    if (item.type !== "section") {
      if (isKidsCard(item)) cls.push(item.kids ? "pxd-item--kids" : "pxd-item--kidsoff");
      if (rec.bare) cls.push("pxd-item--bare");
      if (rec.refBoard) cls.push("pxd-item--wb");
      if (item.look === "block") cls.push("pxd-card--block");
      if (item.type === "card" && dueChip(item.content)?.overdue) cls.push("pxd-item--overdue");
    }
    node2.className = cls.join(" ");
    applyStyle(rec, item);
    if (item.type !== "section") syncShape(rec, item);
    if (item.type === "section") {
      if (!rec.titleRendered || rec.titleString !== item.string) {
        rec.title.textContent = item.title || "Section";
        rec.titleString = item.string;
        rec.titleRendered = false;
      }
      const noteUid = !item.collapsed && lastBoard ? sectionNoteUid(lastBoard, item.uid) : null;
      const note = noteUid ? lastBoard.items.get(noteUid) : null;
      if (rec.note) {
        if (note) {
          rec.note.style.display = "";
          rec.note.textContent = firstLine(note.string || "");
        } else rec.note.style.display = "none";
      }
    } else {
      if (editing?.uid !== item.uid && !rec.renaming) rec.header.textContent = item.type === "text" ? "" : String(rec.refTitle || item.title || "").slice(0, HEADER_TEXT_MAX);
      if (item.type === "text") rec.header.style.display = "none";
      rec.header.classList.toggle("pxd-item__header--muted", item.kind === "board" && isUntitledBoard(item.title));
    }
    node2.title = "";
    const announced = item.type === "section" ? item.title || "Section" : String(rec.refTitle || item.title || "Untitled");
    node2.setAttribute("aria-label", `${announced}, ${item.type}`);
  };
  const position = (rec, rect) => {
    const prev = rec.rect;
    rec.rect = rect;
    if (editing?.uid === rec.uid && prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
    rec.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    rec.el.style.width = `${rect.w}px`;
    rec.el.style.height = `${rect.h}px`;
    if (rec.shapeName) syncShape(rec, { type: "text", shape: rec.shapeName, w: rect.w, h: rect.h }, rect);
  };
  const removeShell = (uid) => {
    const rec = shells.get(uid);
    if (!rec) return;
    if (editing?.uid === uid) void exitEdit({ silent: true });
    unmountRoots(rec);
    rec.el.remove();
    shells.delete(uid);
    mounted.delete(uid);
  };
  let shellQueue = [];
  const placeShells = () => {
    if (typeof doc.createDocumentFragment !== "function") {
      for (const uid of lastBoard?.order || []) {
        const rec = shells.get(uid);
        if (!rec?.el) continue;
        const layer = rec.type === "section" ? sectionsLayer : itemsLayer;
        if (rec.el.parentElement !== layer || layer.lastChild !== rec.el) layer.append(rec.el);
      }
      return;
    }
    const sectionNodes = doc.createDocumentFragment();
    const itemNodes = doc.createDocumentFragment();
    for (const uid of lastBoard?.order || []) {
      const rec = shells.get(uid);
      if (!rec?.el) continue;
      (rec.type === "section" ? sectionNodes : itemNodes).append(rec.el);
    }
    if (sectionNodes.childNodes.length) sectionsLayer.append(sectionNodes);
    if (itemNodes.childNodes.length) itemsLayer.append(itemNodes);
  };
  const pumpShells = () => {
    const chunk = shellQueue.splice(0, 40);
    for (const uid of chunk) {
      const item = lastBoard?.items.get(uid);
      if (!item || shells.has(uid)) continue;
      const rec = buildShell(item);
      const rect = lastRects?.get(uid);
      rec.el.style.display = rect ? "" : "none";
      noteRender(uid);
      paintShell(rec, item);
      if (rect) position(rec, rect);
    }
    if (chunk.length) placeShells();
    if (shellQueue.length && timers?.frame) timers.frame(pumpShells);
  };
  const sync = ({ board: board2, rects, dirty = null, structural = false, view = null }) => {
    lastBoard = board2;
    lastRects = rects;
    if (dirty == null) shellQueue = [];
    for (const uid of [...shells.keys()]) if (!board2.items.has(uid)) removeShell(uid);
    let orderChanged = structural;
    let defer = null;
    if (!shells.size && board2.order.length > 80 && typeof timers?.frame === "function") {
      const now2 = [];
      const later2 = [];
      for (const uid of board2.order) {
        const rect = rects.get(uid);
        if (view && rect && rectsIntersect(rect, view)) now2.push(uid);
        else later2.push(uid);
      }
      if (!now2.length && view) {
        const cx = view.x + view.w / 2;
        const cy = view.y + view.h / 2;
        const dist = (uid) => {
          const r = rects.get(uid);
          return r ? (r.x + r.w / 2 - cx) ** 2 + (r.y + r.h / 2 - cy) ** 2 : Infinity;
        };
        later2.sort((a, b) => dist(a) - dist(b));
      }
      if (!now2.length) now2.push(...later2.splice(0, 24));
      if (now2.length && later2.length) defer = new Set(later2);
    }
    for (const uid of board2.order) {
      if (defer?.has(uid)) continue;
      const item = board2.items.get(uid);
      let rec = shells.get(uid);
      const fresh = !rec;
      if (!rec) {
        rec = buildShell(item);
        orderChanged = true;
      }
      const rect = rects.get(uid);
      rec.el.style.display = rect ? "" : "none";
      if (fresh || !dirty || dirty.has(uid)) {
        if (!fresh && editing?.uid === uid) {
          if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) position(rec, rect);
        } else {
          noteRender(uid);
          paintShell(rec, item);
          if (rect) position(rec, rect);
          const key = contentKeyOf(item);
          if (rec.contentKey !== null && rec.contentKey !== key && editing?.uid !== uid) {
            unmountRoots(rec);
            rec.body?.replaceChildren?.();
            rec.contentKey = null;
            mounted.delete(uid);
            rec.titleRendered = false;
            if (rec.type === "card") {
              rec.bare = true;
              rec.el.classList.add("pxd-item--bare");
            }
          }
          if (showBadges) renderBadges(rec);
        }
      } else if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) {
        position(rec, rect);
      }
    }
    if (orderChanged) placeShells();
    if (defer?.size) {
      shellQueue = [...defer];
      timers.frame(pumpShells);
    }
  };
  let peek = null;
  let peekTimer = null;
  const peekRoot = () => itemsLayer?.closest?.(".pxd-root") || null;
  const closePeek = () => {
    peekTimer?.();
    peekTimer = null;
    if (!peek) return;
    const p = peek;
    peek = null;
    p.off?.();
    try {
      p.node.remove();
    } catch {
    }
  };
  const peekRowsOf = (rec, item, done) => {
    const take = (list) => done(visibleKids(list).slice(0, PEEK_TOP));
    if (item.kind === "note") return take(item.content);
    const tree = host?.pullTree?.(item.target.uid, 2, 200);
    if (tree && typeof tree.then === "function") tree.then(take).catch(() => {
    });
    else take(tree);
  };
  const openPeek = (rec) => {
    peekTimer = null;
    const item = lastBoard?.items.get(rec.uid);
    const root = peekRoot();
    if (disposed || peek || !root || !rec.kidsBtn || !item || !isKidsCard(item) || editing || paused) return;
    peekRowsOf(rec, item, (rows) => {
      if (disposed || peek || !rec.kidsBtn?.isConnected || !rows.length) return;
      const node2 = el("div", "pxd-kids-peek", root);
      node2.setAttribute("role", "tooltip");
      for (const c of rows) {
        el("div", "pxd-kids-peek__row", node2).textContent = plainText(childString2(c), PEEK_TEXT_MAX);
        for (const g of visibleKids(childKids(c)).slice(0, PEEK_SUB)) {
          el("div", "pxd-kids-peek__row pxd-kids-peek__row--sub", node2).textContent = plainText(childString2(g), PEEK_TEXT_MAX);
        }
      }
      const b = rec.kidsBtn.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      node2.style.left = `${Math.round(b.left - r.left)}px`;
      node2.style.top = `${Math.round(b.bottom - r.top + 6)}px`;
      const close = () => closePeek();
      doc.addEventListener?.("pointerdown", close, true);
      doc.addEventListener?.("wheel", close, true);
      peek = { node: node2, rec, off: () => {
        doc.removeEventListener?.("pointerdown", close, true);
        doc.removeEventListener?.("wheel", close, true);
      } };
    });
  };
  const dropKidsBadge = (rec) => {
    if (!rec.kidsBtn) return;
    if (peek?.rec === rec) closePeek();
    for (const off of rec.kidsOffs || []) off();
    rec.kidsOffs = [];
    rec.kidsBtn.remove();
    rec.kidsBtn = null;
  };
  const toggleKids = (uid) => {
    const item = lastBoard?.items.get(uid);
    if (!isKidsCard(item)) return false;
    const rec = shells.get(uid);
    const on = !item.kids;
    const extra = on ? Math.ceil((Number(rec?.kidRows) || 0) * KID_ROW_H + 8) : 0;
    void session?.setKids?.(uid, on, extra);
    return true;
  };
  const syncKidsBadge = (rec, itemArg) => {
    const item = itemArg || lastBoard?.items.get(rec.uid);
    const want = Boolean(item) && isKidsCard(item) && lod === "detail" && editing?.uid !== rec.uid && !item.collapsed && !rec.refBoard && !rec.bare && Number(rec.kidCount) > 0;
    if (!want) return dropKidsBadge(rec);
    const text2 = `${item.kids ? "▾" : "▸"} ${rec.kidCount}`;
    if (!rec.kidsBtn) {
      const btn = el("button", "pxd-kids", rec.el);
      btn.type = "button";
      rec.kidsOffs = [];
      const on = (type, fn) => {
        btn.addEventListener(type, fn);
        rec.kidsOffs.push(() => btn.removeEventListener(type, fn));
      };
      for (const type of ["pointerdown", "mousedown", "dblclick"]) {
        on(type, (event) => {
          stopEvent(event);
          peekTimer?.();
          peekTimer = null;
        });
      }
      on("click", (event) => {
        stopEvent(event);
        closePeek();
        toggleKids(rec.uid);
      });
      on("mouseenter", (event) => {
        if (event.buttons || peek || peekTimer) return;
        peekTimer = later(() => openPeek(rec), PEEK_DELAY_MS);
      });
      on("mouseleave", () => closePeek());
      rec.kidsBtn = btn;
    }
    rec.kidsBtn.textContent = text2;
    rec.kidsBtn.setAttribute("aria-expanded", item.kids ? "true" : "false");
    rec.kidsBtn.setAttribute("aria-label", `${rec.kidCount} ${rec.kidCount === 1 ? "child" : "children"}`);
    rec.kidsBtn.title = item.kids ? "Hide children" : "Show children";
  };
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks) {
      if (budget.n >= CONTENT_LIMIT) return;
      const s = childString2(b);
      if (attrNameOf(s) === "BT_attrDue") continue;
      budget.n += 1;
      const row2 = el("div", "pxd-block", parent);
      row2.dataset.uid = childUid(b);
      row2.setAttribute("data-pxd-row", childUid(b));
      const node2 = renderRoot(row2, s, "pxd-rs pxd-block__text", childUid(b));
      budget.roots.push(node2);
      const kids = childKids(b);
      if (kids.length && depth < CONTENT_DEPTH) {
        const wrap = el("div", "pxd-block__children", row2);
        renderBlocks(wrap, kids, depth + 1, budget);
      }
    }
  };
  const openBoard = (uid) => {
    if (onOpenBoard) onOpenBoard(uid);
    else host?.openBlock?.(uid);
  };
  const commitBoardName = (uid, name) => (onRenameBoard || ((u, n2) => session?.renameBoard?.(u, n2)))(uid, name);
  const mountBoardBody = (body, item, { openUid = item.uid } = {}) => {
    const innerW = Math.max(1, (Number(item.w) || 0) - 24);
    const preview = boardPreview(item, { aspect: innerW / Math.max(40, (Number(item.h) || 0) - HEADER_H - META_H) });
    const wrap = el("div", "pxd-item__board", body);
    const holder = el("div", "pxd-board-preview", wrap);
    if (preview.empty) {
      el("div", "pxd-board-preview__empty", holder).textContent = "Empty board";
    } else {
      const canvas = el("div", "pxd-board-preview__canvas", holder);
      const pct = (n2) => `${Math.round(n2 * 1e4) / 100}%`;
      const addMini = (r) => {
        const cls = ["pxd-mini"];
        if (r.type === "section") cls.push("pxd-mini--section");
        else if (r.type === "text") cls.push("pxd-mini--text");
        if (r.color) cls.push(`pxd-c-${r.color}`);
        if (r.w * innerW < TINY_MINI_PX) cls.push("pxd-mini--tiny");
        const mini = el("div", cls.join(" "), canvas);
        mini.style.left = pct(r.x);
        mini.style.top = pct(r.y);
        mini.style.width = pct(r.w);
        mini.style.height = pct(r.h);
        let title = r.title;
        if (!title && r.ref) {
          const text2 = host?.blockString?.(r.ref);
          if (typeof text2 === "string") title = firstLine(text2).slice(0, REF_TITLE_MAX);
        }
        if (!title && r.kind === "image") title = "Image";
        if (title) el("div", "pxd-mini__title", mini).textContent = title;
      };
      for (const r of preview.rects) if (r.type === "section") addMini(r);
      if (preview.edges.length) {
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "pxd-board-preview__edges");
        svg.setAttribute("viewBox", "0 0 1 1");
        svg.setAttribute("preserveAspectRatio", "none");
        for (const e of preview.edges) {
          const line = doc.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", String(e.x1));
          line.setAttribute("y1", String(e.y1));
          line.setAttribute("x2", String(e.x2));
          line.setAttribute("y2", String(e.y2));
          svg.append(line);
        }
        canvas.append(svg);
      }
      for (const r of preview.rects) if (r.type !== "section") addMini(r);
    }
    if (item.enhanced && isUntitledBoard(item.title)) {
      const input = el("input", "pxd-input pxd-item__board-name", wrap);
      input.type = "text";
      input.setAttribute("aria-label", "Board name");
      input.placeholder = "Name this board…";
      input.setAttribute("placeholder", "Name this board…");
      for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) input.addEventListener(type, stopEvent);
      let done = false;
      const commit = () => {
        if (done) return;
        const name = String(input.value || "").trim();
        if (!name) return;
        done = true;
        commitBoardName(item.uid, name);
      };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          input.blur?.();
        } else if (event.key === "Escape") {
          event.preventDefault();
          input.value = "";
          input.blur?.();
        }
      });
      input.addEventListener("blur", commit);
    }
    const meta = el("div", "pxd-item__board-meta", wrap);
    el("span", "pxd-item__board-count", meta).textContent = `${preview.count} ${preview.count === 1 ? "item" : "items"}`;
    const open = el("button", "pxd-btn pxd-item__open", meta);
    open.type = "button";
    open.textContent = "Open";
    open.setAttribute("aria-label", "Open");
    open.dataset.action = "open";
    for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stopEvent);
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      openBoard(openUid);
    });
  };
  const fetchPage = (title) => host?.pageOutline ? host.pageOutline(title, OUTLINE_FETCH) : host?.pagePreview?.(title, 64, OUTLINE_FETCH);
  const pageKeyOf = (blocks) => {
    const parts = [];
    const walk = (list) => {
      for (const c of list) {
        parts.push(childUid(c), childString2(c), c.open === false ? "0" : "1");
        walk(childKids(c));
      }
    };
    walk(blocks || []);
    return parts.join("");
  };
  const countRows = (blocks) => {
    let n2 = 0;
    for (const c of blocks) {
      if (attrNameOf(childString2(c)) === "BT_attrDue") continue;
      n2 += 1;
      if (c.open !== false) n2 += countRows(childKids(c));
    }
    return n2;
  };
  const openPageByTitle = (title, uid) => {
    const id = uid || host?.pageUid?.(title);
    if (id) host?.openPage?.(id);
  };
  const moreRow = (parent, n2, title, uid) => {
    const more = el("button", "pxd-row__more", parent);
    more.type = "button";
    more.textContent = `+${n2} more`;
    more.setAttribute("aria-label", `${n2} more blocks, open the page`);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) more.addEventListener(type, stopEvent);
    more.addEventListener("click", (event) => {
      stopEvent(event);
      openPageByTitle(title, uid);
    });
    return more;
  };
  const renderOutline = (parent, blocks, b, rec) => {
    for (const blk of blocks) {
      const s = childString2(blk);
      if (attrNameOf(s) === "BT_attrDue") continue;
      const uid = childUid(blk);
      const kids = childKids(blk);
      const folded = blk.open === false && kids.length > 0;
      if (b.n >= OUTLINE_CAP) {
        b.more += 1 + (folded ? 0 : countRows(kids));
        continue;
      }
      b.n += 1;
      const row2 = el("div", "pxd-block pxd-prow", parent);
      row2.dataset.uid = uid;
      row2.setAttribute("data-uid", uid);
      const line = el("div", "pxd-row", row2);
      line.dataset.pxdRow = uid;
      line.setAttribute("data-pxd-row", uid);
      let wrap = null;
      let fold = null;
      if (kids.length) {
        fold = el("button", "pxd-row__fold", line);
        fold.type = "button";
        fold.setAttribute("aria-label", folded ? "Unfold" : "Fold");
        fold.setAttribute("aria-expanded", folded ? "false" : "true");
        for (const type of ["pointerdown", "mousedown", "dblclick"]) fold.addEventListener(type, stopEvent);
      }
      b.roots.push(renderRoot(line, s, "pxd-rs pxd-block__text", uid));
      if (!kids.length) continue;
      wrap = el("div", "pxd-block__children", row2);
      let filled = false;
      const fill = () => {
        if (filled) return;
        filled = true;
        const sub = { n: b.n, more: 0, roots: [] };
        renderOutline(wrap, kids, sub, rec);
        b.n = sub.n;
        if (sub.more) moreRow(wrap, sub.more, rec.pageTitle, rec.pageUid);
        if (rec.pageHolder && rec.pageHolder.isConnected !== false) {
          rec.pageRoots.push(...sub.roots);
          rec.roots.push(...sub.roots);
        }
      };
      if (folded) setHidden(wrap, true);
      else {
        filled = true;
        renderOutline(wrap, kids, b, rec);
      }
      row2.classList.toggle("pxd-prow--folded", folded);
      fold.addEventListener("click", (event) => {
        stopEvent(event);
        const open = fold.getAttribute("aria-expanded") !== "true";
        if (open) fill();
        fold.setAttribute("aria-expanded", open ? "true" : "false");
        fold.setAttribute("aria-label", open ? "Fold" : "Unfold");
        row2.classList.toggle("pxd-prow--folded", !open);
        setHidden(wrap, !open);
        onPageLayout?.(rec.uid);
      });
    }
  };
  const paintPage = (rec, holder, p) => {
    const old = new Set(rec.pageRoots || []);
    for (const node2 of old) {
      try {
        node2.__pxdEmbedMo?.disconnect();
      } catch {
      }
      try {
        host?.unmount?.(embedLive(node2));
      } catch {
      }
    }
    if (old.size && rec.roots) rec.roots = rec.roots.filter((node2) => !old.has(node2));
    holder.replaceChildren();
    rec.pageRoots = [];
    rec.pageTitle = p?.title || rec.pageTitle || "";
    if (!p?.exists) {
      rec.pageKey = "";
      el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
      onPageLayout?.(rec.uid);
      return [];
    }
    rec.pageUid = p.uid || null;
    rec.pageKey = pageKeyOf(p.blocks);
    const b = { n: 0, more: 0, roots: [] };
    renderOutline(holder, p.blocks || [], b, rec);
    if (!b.n) el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
    if (b.more) moreRow(holder, b.more, rec.pageTitle, rec.pageUid);
    rec.pageRoots = [...b.roots];
    onPageLayout?.(rec.uid);
    return b.roots;
  };
  const round15 = (n2) => Math.round(n2 * 10) / 10;
  const measureRow = (uid, rowUid) => {
    const rec = shells.get(uid);
    const holder = rec?.pageHolder;
    if (!rec?.body || !holder || holder.isConnected === false || editing?.uid === uid || !rec.pageKey) return null;
    const z = zoomCache || 1;
    const card2 = rec.el.getBoundingClientRect();
    const body = rec.body.getBoundingClientRect();
    const out = { bodyTop: round15((body.top - card2.top) / z), bodyBottom: round15((body.bottom - card2.top) / z) };
    const row2 = holder.querySelector?.(`[data-pxd-row="${rowUid}"]`);
    const r = row2 ? row2.getBoundingClientRect() : null;
    if (!r || !r.width && !r.height) return { ...out, rowTop: null, rowHeight: 0, rendered: false };
    return { ...out, rowTop: round15((r.top - card2.top) / z), rowHeight: round15(r.height / z), rendered: true };
  };
  const revealRow = (uid, rowUid) => {
    const rec = shells.get(uid);
    const row2 = rec?.pageHolder?.querySelector?.(`[data-pxd-row="${rowUid}"]`);
    if (!rec?.body || !row2) return false;
    const r = row2.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const body = rec.body.getBoundingClientRect();
    const delta = (r.top + r.height / 2 - (body.top + body.height / 2)) / (zoomCache || 1);
    rec.body.scrollTop = Math.max(0, (Number(rec.body.scrollTop) || 0) + delta);
    row2.classList.add("pxd-row--flash");
    later(() => row2.classList.remove("pxd-row--flash"), 600);
    onPageLayout?.(uid);
    return true;
  };
  let pageWatches = 0;
  const armPageWatch = (rec, item, holder) => {
    if (disposed || rec.pageUnwatch || !host?.watchPage || pageWatches >= PAGE_WATCH_MAX) return;
    let pending = null;
    const refresh = () => {
      pending = null;
      if (disposed || editing?.uid === rec.uid || rec.pageHolder !== holder || holder.isConnected === false) return;
      let got;
      try {
        got = fetchPage(item.title);
      } catch {
        return;
      }
      Promise.resolve(got).then((p) => {
        if (disposed || editing?.uid === rec.uid || rec.pageHolder !== holder) return;
        if (p?.exists ? pageKeyOf(p.blocks) === rec.pageKey : rec.pageKey === "") return;
        const keep = Number(rec.body?.scrollTop) || 0;
        rec.roots.push(...paintPage(rec, holder, p));
        if (rec.body && keep) rec.body.scrollTop = keep;
      }).catch(() => {
      });
    };
    let off = null;
    try {
      off = host.watchPage(item.title, () => {
        if (pending) return;
        pending = later(refresh, PAGE_REFRESH_MS);
      });
    } catch {
      return;
    }
    pageWatches += 1;
    rec.pageUnwatch = () => {
      rec.pageUnwatch = null;
      try {
        off?.();
      } catch {
      }
      pending?.();
      pending = null;
      pageWatches -= 1;
    };
  };
  const mountContentBody = (rec, item) => {
    noteRender(item.uid);
    rec.kidCount = 0;
    rec.kidRows = 0;
    const body = rec.body;
    unmountRoots(rec);
    body.replaceChildren();
    rec.bare = false;
    rec.el.classList.remove("pxd-item--bare");
    const budget = { n: 0, roots: [] };
    if (item.collapsed) {
      rec.contentKey = contentKeyOf(item);
      rec.roots = [];
      return;
    }
    if (item.type === "text") {
      budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__text", item.uid));
    } else if (item.kind === "image") {
      budget.roots.push(renderRoot(el("div", "pxd-item__media", body), item.string, "pxd-rs", item.uid));
    } else if (item.kind === "board") {
      mountBoardBody(body, item);
    } else if (item.kind === "page") {
      if (item.open === false) {
        rec.roots = [];
        rec.contentKey = contentKeyOf(item);
        return;
      }
      const holder = el("div", "pxd-item__page", body);
      rec.pageHolder = holder;
      if (onPageLayout && !rec.scrollOff) {
        const onScroll = () => onPageLayout(rec.uid);
        body.addEventListener("scroll", onScroll, { passive: true });
        rec.scrollOff = () => body.removeEventListener("scroll", onScroll, { passive: true });
      }
      rec.pageTitle = item.title;
      const preview = fetchPage(item.title);
      const apply = (p, sync2 = false) => {
        if (disposed || !holder.parentElement || !sync2 && rec.contentKey !== contentKeyOf(item)) return;
        const roots = paintPage(rec, holder, p);
        if (sync2) budget.roots.push(...roots);
        else rec.roots.push(...roots);
      };
      if (preview && typeof preview.then === "function") preview.then((p) => apply(p)).catch(() => {
      });
      else apply(preview, true);
      mountLinkedRefs(body, rec, item);
      armPageWatch(rec, item, holder);
    } else if (item.kind === "block") {
      const ref = item.target.uid;
      const refString = host?.blockString?.(ref);
      const isBoardRef = typeof refString === "string" && classifyString(refString).kind === "board";
      if (isBoardRef) rec.refTitle = parseBoardTitle(refString) || "Untitled board";
      else if (typeof refString === "string" && isQueryString(refString)) rec.refTitle = "Query";
      else rec.refTitle = typeof refString === "string" ? firstLine(refString).slice(0, REF_TITLE_MAX) : "";
      if (editing?.uid !== item.uid) rec.header.textContent = String(rec.refTitle || item.title || "").slice(0, HEADER_TEXT_MAX);
      if (isBoardRef) {
        if (item.open === false) {
          rec.roots = budget.roots;
          rec.contentKey = contentKeyOf(item);
          return;
        }
        const pulled = host?.pullBoard?.(ref);
        mountBoardBody(body, {
          uid: ref,
          string: refString,
          content: pulled?.[":block/children"] ?? pulled?.children ?? [],
          w: item.w,
          h: item.h,
          title: rec.refTitle,
          enhanced: false
        }, { openUid: ref });
      } else if (typeof refString === "string" && isQueryString(refString) && host?.renderBlock) {
        budget.roots.push(mountQuery(body, ref));
      } else {
        if (typeof refString === "string" && refString.trim()) budget.roots.push(renderRoot(body, refString, "pxd-rs pxd-item__string", ref));
        const tree = host?.pullTree?.(ref, item.kids ? CONTENT_DEPTH : 1, 200);
        const apply = (blocks, sync2 = false) => {
          if (disposed || !body.isConnected || !sync2 && rec.contentKey !== contentKeyOf(item)) return;
          if (!refString?.trim() && !blocks?.length) el("div", "pxd-item__placeholder", body).textContent = "Empty card";
          rec.kidCount = visibleKids(blocks).length;
          rec.kidRows = kidRowsOf(blocks);
          if (item.kids) {
            const b = { n: 0, roots: [] };
            renderBlocks(body, blocks || [], 1, b);
            if (sync2) budget.roots.push(...b.roots);
            else rec.roots.push(...b.roots);
          }
          if (!sync2) syncKidsBadge(rec, item);
        };
        if (tree && typeof tree.then === "function") tree.then((t) => apply(t)).catch(() => {
        });
        else apply(tree, true);
      }
    } else if (isQueryString(item.string) && host?.renderBlock) {
      budget.roots.push(mountQuery(body, item.uid));
    } else {
      if (item.string?.trim()) budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__string", item.uid));
      rec.kidCount = visibleKids(item.content).length;
      rec.kidRows = kidRowsOf(item.content);
      if (item.kids) renderBlocks(body, item.content || [], 1, budget);
      if (!item.string?.trim() && !(item.content || []).length) {
        el("div", "pxd-item__placeholder", body).textContent = "Empty card";
      }
    }
    rec.roots = budget.roots;
    rec.contentKey = contentKeyOf(item);
  };
  const mountContent = (rec, item) => {
    mountContentBody(rec, item);
    syncKidsBadge(rec, item);
  };
  const mountSectionTitle = (rec, item) => {
    noteRender(item.uid);
    unmountRoots(rec);
    rec.title.replaceChildren();
    const node2 = renderRoot(rec.title, item.string || "Section", "pxd-rs pxd-section__title-text", item.uid);
    if (!item.string) node2.textContent = "Section";
    rec.roots = [node2];
    rec.titleRendered = true;
    rec.contentKey = contentKeyOf(item);
  };
  const unmountContent = (uid) => {
    const rec = shells.get(uid);
    if (!rec || editing?.uid === uid) return;
    unmountRoots(rec);
    if (rec.type === "section") {
      rec.title.replaceChildren();
      rec.title.textContent = lastBoard?.items.get(uid)?.title || "Section";
      rec.titleRendered = false;
    } else {
      rec.body?.replaceChildren?.();
      dropKidsBadge(rec);
      if (rec.type === "card") {
        rec.bare = true;
        rec.el.classList.add("pxd-item--bare");
      }
      onPageLayout?.(uid);
    }
    rec.contentKey = null;
    mounted.delete(uid);
  };
  const pump = (deadline) => {
    idleHandle = null;
    if (disposed || paused || !lastBoard) return;
    const start = now();
    const has = deadline && typeof deadline.timeRemaining === "function" ? () => deadline.timeRemaining() > 1 : () => true;
    while (queue.length && now() - start < CHUNK_MS && has()) {
      const uid = queue.shift();
      if (!wanted.has(uid) || mounted.has(uid)) continue;
      const rec = shells.get(uid);
      const item = lastBoard.items.get(uid);
      if (!rec || !item || editing?.uid === uid) continue;
      if (rec.type === "section") mountSectionTitle(rec, item);
      else mountContent(rec, item);
      mounted.delete(uid);
      mounted.set(uid, now());
    }
    if (queue.length) idleHandle = idle(pump);
    evict();
  };
  const evict = () => {
    if (mounted.size <= LRU_CAP) return;
    const victims = [];
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!wanted.has(uid)) victims.push(uid);
    }
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!victims.includes(uid)) victims.push(uid);
    }
    victims.forEach(unmountContent);
  };
  let unmountTimer = null;
  const scheduleUnmounts = () => {
    if (unmountTimer) return;
    unmountTimer = later(() => {
      unmountTimer = null;
      if (disposed) return;
      const t = now();
      for (const [uid, seen] of [...mounted]) {
        if (!wanted.has(uid) && t - seen >= UNMOUNT_AFTER_MS - 1) unmountContent(uid);
      }
      if ([...mounted.keys()].some((u) => !wanted.has(u))) scheduleUnmounts();
    }, UNMOUNT_AFTER_MS);
  };
  let lastContent = null;
  let quieted = false;
  const holdQuiet = (rec, uid) => {
    if (!rec.roots?.length || editing?.uid === uid) return;
    if (rec.type === "section") {
      const text2 = rec.title?.textContent || lastBoard?.items.get(uid)?.title || "Section";
      unmountRoots(rec);
      if (rec.title) rec.title.textContent = text2;
      rec.titleRendered = false;
    } else if (rec.body) {
      const text2 = rec.body.textContent || "";
      unmountRoots(rec);
      rec.body.replaceChildren();
      if (text2) el("div", "pxd-quiet", rec.body).textContent = text2;
    } else {
      unmountRoots(rec);
    }
    rec.contentKey = null;
    mounted.delete(uid);
  };
  const fillContent = ({ visibleRect, zoom = zoomCache, tier = null }) => {
    zoomCache = zoom;
    if (!lastBoard || !lastRects) return;
    const next = /* @__PURE__ */ new Set();
    if ((tier ?? lodForZoom(zoom)) === "detail") {
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        if (r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    } else {
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        const keep = rec.type === "section" || rec.type === "text" || rec.refBoard || lastBoard.items.get(uid)?.kind === "board";
        if (keep && r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    }
    wanted = next;
    const t = now();
    for (const uid of next) if (mounted.has(uid)) mounted.set(uid, t);
    queue = [...next].filter((u) => !mounted.has(u));
    if (queue.length && !paused && !idleHandle) idleHandle = idle(pump);
    if ([...mounted.keys()].some((u) => !next.has(u))) scheduleUnmounts();
  };
  const scheduleContent = (args) => {
    lastContent = args;
    if (quieted) return;
    fillContent(args);
  };
  const quiet = (on) => {
    const next = Boolean(on);
    if (next === quieted) return;
    quieted = next;
    if (quieted) {
      if (idleHandle) {
        idleHandle();
        idleHandle = null;
      }
      queue = [];
      for (const [uid, rec] of shells) holdQuiet(rec, uid);
      return;
    }
    if (lastContent) fillContent(lastContent);
  };
  const setPaused = (on) => {
    paused = Boolean(on);
    if (paused && idleHandle) {
      idleHandle();
      idleHandle = null;
    }
    if (!paused && queue.length && !idleHandle) idleHandle = idle(pump);
  };
  const setZoom = (zoom) => {
    const next = Number(zoom);
    const prevZoom = zoomCache;
    zoomCache = next > 0 && Number.isFinite(next) ? next : 1;
    if (zoomCache !== prevZoom) closePeek();
    if (editing?.editor) applyEditorCounterScale(editing.editor, zoomCache);
  };
  const setLod = (nextLod, zoom) => {
    const prev = lod;
    lod = nextLod === "map" || nextLod === "overview" ? nextLod : "detail";
    setZoom(zoom);
    closePeek();
    if (prev !== lod) {
      for (const rec of shells.values()) if (rec.kidsBtn || rec.kidCount > 0) syncKidsBadge(rec);
    }
    if (showBadges && prev === "detail" !== (lod === "detail")) {
      if (lod !== "detail") {
        const pending = [];
        for (const rec of shells.values()) if (rec.badgeEl) pending.push(rec);
        const step = () => {
          for (const rec of pending.splice(0, 40)) {
            rec.badgeEl.remove();
            rec.badgeEl = null;
            rec.badgeKey = null;
          }
          if (pending.length) {
            if (timers?.frame) timers.frame(step);
            else step();
          }
        };
        if (timers?.frame) timers.frame(step);
        else step();
      } else {
        for (const rec of shells.values()) renderBadges(rec);
      }
    }
  };
  const previewMove = (uids, dx, dy, board2, rects) => {
    const set = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(board2, u)) set.add(d);
    const live = /* @__PURE__ */ new Map();
    for (const uid of set) {
      const rec = shells.get(uid);
      const r = rects.get(uid);
      if (!rec || !r) continue;
      const moved = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
      rec.el.style.transform = `translate(${moved.x}px, ${moved.y}px)`;
      live.set(uid, moved);
    }
    return live;
  };
  const previewRects = (list) => {
    const live = /* @__PURE__ */ new Map();
    for (const r of list) {
      const rec = shells.get(r.uid);
      if (!rec) continue;
      position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
      live.set(r.uid, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return live;
  };
  const previewSectionRects = (list) => {
    const live = /* @__PURE__ */ new Map();
    for (const r of list || []) {
      const rec = shells.get(r.uid);
      if (!rec || rec.type !== "section") continue;
      position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
      live.set(r.uid, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return live;
  };
  const resetRects = (rectsMap, uids = null) => {
    for (const uid of uids ? [...uids] : [...shells.keys()]) {
      const rec = shells.get(uid);
      const r = rectsMap?.get?.(uid);
      if (rec && r) position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
  };
  const measureContent = (uid) => {
    const rec = shells.get(uid);
    if (!rec || rec.type === "section" || lod !== "detail" || !mounted.has(uid) || rec.bare) return null;
    const body = rec.body;
    const st = body?.style;
    const saved = st ? { flex: st.flex, height: st.height } : null;
    if (st) {
      st.flex = "0 0 auto";
      st.height = "auto";
    }
    const natural = Number(body?.scrollHeight) || 0;
    if (st && saved) {
      st.flex = saved.flex;
      st.height = saved.height;
    }
    const h = (Number(rec.header?.offsetHeight) || 0) + natural;
    return h > 0 ? h : null;
  };
  const attrChipsOf = (rec, item) => {
    if (item.kind === "board") return [];
    const lines = [];
    const own = item.kind === "block" ? rec.refString : item.string;
    if (typeof own === "string") lines.push(...own.split("\n"));
    for (const c of item.content || []) lines.push(...String(childString2(c)).split("\n"));
    const out = [];
    for (const line of lines) {
      if (out.length >= ATTR_CHIPS_MAX) break;
      const name = attrNameOf(line);
      if (!name || name === "BT_attrDue") continue;
      const value = plainText(line.slice(line.indexOf("::") + 2), 40);
      if (value) out.push(`${plainText(name, 24)}: ${value}`);
    }
    return out;
  };
  const renderBadges = (rec) => {
    const item = lastBoard?.items.get(rec.uid);
    const visible = showBadges && lod === "detail" && rec.type === "card" && item && editing?.uid !== rec.uid;
    const clear = () => {
      if (rec.badgeEl) {
        rec.badgeEl.remove();
        rec.badgeEl = null;
      }
      rec.badgeKey = null;
    };
    if (!visible) return clear();
    const info = badgeMap?.get?.(rec.uid) || null;
    const chips = [];
    if (info?.refs > 0) chips.push({ cls: "refs", text: `${info.refs} refs`, title: `${info.refs} references to this card` });
    if (info?.boards > 0) chips.push({ cls: "boards", text: `on ${info.boards} boards`, title: "Shown on other boards", action: "boards" });
    if (info && (info.open > 0 || info.done > 0)) chips.push({ cls: "todo", text: `${info.open || 0}/${info.done || 0}`, title: `${info.open || 0} open, ${info.done || 0} done` });
    const comments = commentCount(lastBoard, rec.uid);
    if (comments > 0) chips.push({ cls: "comments", text: `${comments}`, title: `${comments} comments` });
    const due = item.type === "card" ? dueChip(item.content) : null;
    if (due) chips.unshift({ cls: "due", text: due.text, title: "Due", overdue: due.overdue });
    for (const text2 of attrChipsOf(rec, item)) chips.push({ cls: "attr", text: text2 });
    if (!chips.length) return clear();
    const key = JSON.stringify(chips);
    if (rec.badgeEl && rec.badgeKey === key) return;
    clear();
    const row2 = el("div", "pxd-item__badges", rec.el);
    for (const chip of chips) {
      const node2 = el(chip.action ? "button" : "span", `pxd-badge-chip pxd-badge-chip--${chip.cls}`, row2);
      node2.textContent = chip.text;
      if (chip.overdue) node2.classList.add("pxd-badge-chip--overdue");
      if (chip.title) node2.title = chip.title;
      if (chip.action) {
        node2.type = "button";
        node2.setAttribute("aria-label", chip.title || chip.text);
        for (const type of ["pointerdown", "mousedown", "dblclick"]) node2.addEventListener(type, stopEvent);
        node2.addEventListener("click", (event) => {
          event.stopPropagation();
          onBadgeClick?.(rec.uid, chip.action);
        });
      }
    }
    rec.badgeEl = row2;
    rec.badgeKey = key;
  };
  const setBadges = (map) => {
    badgeMap = map instanceof Map ? map : /* @__PURE__ */ new Map();
    if (showBadges) for (const rec of shells.values()) renderBadges(rec);
  };
  const setShowBadges = (on) => {
    const next = Boolean(on);
    if (next === showBadges) return;
    showBadges = next;
    for (const rec of shells.values()) renderBadges(rec);
  };
  const setFocus = (uids) => {
    focusSet = uids ? new Set(uids) : null;
    for (const [uid, rec] of shells) {
      const on = Boolean(focusSet && !focusSet.has(uid));
      if (rec.focusDim === on) continue;
      rec.focusDim = on;
      rec.el.classList.toggle(rec.type === "section" ? "pxd-section--focus-dim" : "pxd-item--focus-dim", on);
    }
  };
  const setSelection = (uids) => {
    const list = Array.isArray(uids) ? uids : [];
    const set = new Set(list);
    let primary = null;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (shells.has(list[i])) {
        primary = list[i];
        break;
      }
    }
    for (const [uid, rec] of shells) {
      const on = set.has(uid);
      if (rec.selected !== on) {
        rec.selected = on;
        rec.el.classList.toggle(rec.type === "section" ? "pxd-section--selected" : "pxd-item--selected", on);
      }
      const tab = uid === primary ? 0 : -1;
      if (rec.tabStop !== tab) {
        rec.tabStop = tab;
        rec.el.tabIndex = tab;
      }
    }
  };
  const setHover = (uid) => {
    for (const [u, rec] of shells) {
      const on = u === uid;
      if (rec.hover === on) continue;
      rec.hover = on;
      rec.el.classList.toggle("pxd-item--drop", on);
    }
  };
  const onFocusSteal = (event) => {
    if (!editing) return;
    const target = event.target;
    if (!target || editing.editor.contains?.(target)) return;
    const isInput = target.classList?.contains?.("rm-block__input") || String(target.tagName || "").toLowerCase() === "textarea";
    if (!isInput) return;
    const hostEl = typeof target.closest === "function" ? target.closest("[data-uid]") : null;
    const uid = hostEl?.dataset?.uid || String(target.id || "").match(/([A-Za-z0-9_-]{9})$/)?.[1];
    if (uid !== editing.targetUid) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  const onDocPointerDown = (event) => {
    if (!editing) return;
    if (editing.rec.el.contains?.(event.target)) return;
    lastOutsideDown = now();
  };
  const attachFocusGuard = () => {
    if (focusGuard || typeof doc.addEventListener !== "function") return;
    doc.addEventListener("focus", onFocusSteal, true);
    doc.addEventListener("scroll", onFocusSteal, true);
    doc.addEventListener("pointerdown", onDocPointerDown, true);
    focusGuard = () => {
      doc.removeEventListener("focus", onFocusSteal, true);
      doc.removeEventListener("scroll", onFocusSteal, true);
      doc.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  };
  const detachFocusGuard = () => {
    floorTeardown?.();
    floorTeardown = null;
    focusGuard?.();
    focusGuard = null;
  };
  const FLOOR_WINDOW_MS = 600;
  const FLOOR_POINTER_MS = 300;
  const FLOOR_MAX = 4;
  const FLOOR_SPAN_MS = 1500;
  const frameLater = (fn) => {
    if (timers?.frame) return timers.frame(fn);
    const raf2 = globalThis.requestAnimationFrame;
    if (typeof raf2 === "function") {
      const id = raf2(fn);
      return () => globalThis.cancelAnimationFrame?.(id);
    }
    const t = setTimeout(fn, 16);
    return () => clearTimeout(t);
  };
  const rootOfLayer = () => itemsLayer?.closest?.(".pxd-root") ?? null;
  const focusLost = (a) => !a || a === doc.body || a === doc.documentElement || a === rootOfLayer();
  const findLiveTextarea = (e) => {
    const list = [...e.editor.querySelectorAll?.("textarea") || []];
    if (!list.length) return null;
    const ta = [...list].reverse().find((n2) => String(n2.id || "").startsWith("block-input-")) || list[list.length - 1];
    return ta?.isConnected ? ta : null;
  };
  const floorTick = (e) => {
    const f = floor;
    if (!f) return;
    f.cancel = null;
    const stop = () => {
      if (floor === f) floor = null;
    };
    if (editing !== e || disposed || lastOutsideDown > f.start - FLOOR_POINTER_MS || doc.hasFocus?.() === false) return stop();
    const a = doc.activeElement;
    if (e.editor.contains?.(a)) return stop();
    if (!focusLost(a)) return stop();
    const ta = findLiveTextarea(e);
    if (ta) {
      recoveries.push(now());
      focusRoamInput(ta);
      return stop();
    }
    if (now() - f.start < FLOOR_WINDOW_MS) f.cancel = frameLater(() => floorTick(e));
    else stop();
  };
  const armFloor = () => {
    const e = editing;
    if (!e || disposed || !e.ready || floor) return false;
    const t = now();
    recoveries = recoveries.filter((x) => t - x < FLOOR_SPAN_MS);
    if (recoveries.length >= FLOOR_MAX) {
      if (!floorRetry) {
        floorRetry = later(() => {
          floorRetry = null;
          if (editing === e && !disposed && focusLost(doc.activeElement)) armFloor();
        }, FLOOR_SPAN_MS - (t - recoveries[0]) + 20);
      }
      return false;
    }
    floor = { start: t, cancel: null };
    floor.cancel = frameLater(() => floorTick(e));
    return true;
  };
  const attachFloor = (e) => {
    const onIn = () => {
      e.ready = true;
    };
    const onOut = (event) => {
      if (editing !== e || !e.ready) return;
      const to = event.relatedTarget;
      if (to) return;
      armFloor();
    };
    e.editor.addEventListener("focusin", onIn);
    e.editor.addEventListener("focusout", onOut);
    const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    let mo = null;
    if (typeof MO === "function") {
      mo = new MO(() => {
        if (editing === e && e.ready && focusLost(doc.activeElement)) armFloor();
      });
      try {
        mo.observe(e.editor, { childList: true, subtree: true });
      } catch {
      }
    }
    const RO = doc.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    let ro = null;
    if (typeof RO === "function" && onEditResize) {
      ro = new RO(() => {
        if (editing === e) onEditResize(e.uid, Number(e.rec.el?.offsetHeight) || 0);
      });
      try {
        ro.observe(e.editor);
      } catch {
      }
    }
    floorTeardown = () => {
      e.editor.removeEventListener("focusin", onIn);
      e.editor.removeEventListener("focusout", onOut);
      mo?.disconnect();
      ro?.disconnect();
      floor?.cancel?.();
      floor = null;
      floorRetry?.();
      floorRetry = null;
    };
  };
  const recoverFocus = () => armFloor();
  const stopEvent = (event) => event.stopPropagation();
  const EDITOR_STOPPED = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown"];
  const EDIT_FADE_MS = 80;
  const boxHeight = (node2) => {
    const h = Number(node2?.offsetHeight) || 0;
    return h > 0 ? h : 0;
  };
  const prefersReducedMotion = () => {
    const mq = doc.defaultView?.matchMedia;
    if (typeof mq !== "function") return false;
    try {
      return Boolean(mq.call(doc.defaultView, "(prefers-reduced-motion: reduce)")?.matches);
    } catch {
      return false;
    }
  };
  const clearEditFade = (e) => {
    e?.fadeCancel?.();
    e?.releaseCancel?.();
    if (e) {
      e.fadeCancel = null;
      e.releaseCancel = null;
    }
  };
  const dropStaticLayer = (rec) => {
    unmountRoots(rec);
    rec.ghost?.remove();
    rec.ghost = null;
  };
  const releaseEditLock = (rec) => {
    if (!rec?.el) return;
    rec.el.style.minHeight = "";
    if (rec.body?.style) rec.body.style.minHeight = "";
    rec.el.classList.remove("pxd-item--xfade");
  };
  const enterEdit = async (uid, { row: row2 = "" } = {}) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type === "section" || item.kind === "board" || rec.refBoard) return false;
    if (editing?.uid === uid) return true;
    if (editing) await exitEdit();
    if (!host?.renderBlock) {
      host?.openBlock?.(uid);
      return false;
    }
    const targetUid = item.target.kind === "block" ? item.target.uid : item.uid;
    const contentH = boxHeight(rec.body);
    const lockH = boxHeight(rec.el) || contentH || Number(rec.rect?.h) || 0;
    const reduced = prefersReducedMotion();
    const clickedRow = row2 ? rec.body.querySelector?.(`[data-pxd-row="${row2}"]`) : null;
    const rowOffset = clickedRow ? (Number(clickedRow.getBoundingClientRect?.().top) || 0) - (Number(rec.body.getBoundingClientRect?.().top) || 0) : null;
    const ghost = el("div", "pxd-item__ghost");
    ghost.setAttribute("aria-hidden", "true");
    for (const node2 of [...rec.body.children || []]) ghost.append(node2);
    rec.body.append(ghost);
    rec.ghost = ghost;
    rec.contentKey = null;
    mounted.delete(uid);
    const editor = el("div", "pxd-item__editor", rec.body);
    for (const type of EDITOR_STOPPED) editor.addEventListener(type, stopEvent);
    editing = { uid, rec, editor, targetUid, item, ready: false, fadeCancel: null, releaseCancel: null };
    rec.el.classList.add("pxd-item--editing");
    renderBadges(rec);
    syncKidsBadge(rec, item);
    if (lockH > 0) rec.el.style.minHeight = `${lockH}px`;
    if (reduced) dropStaticLayer(rec);
    else rec.el.classList.add("pxd-item--xfade");
    lastOutsideDown = -Infinity;
    attachFocusGuard();
    attachFloor(editing);
    onEditChange?.(uid);
    let ok = true;
    try {
      if (item.kind === "page") {
        const pageUid = host.pageUid?.(item.title);
        if (pageUid && host.renderPage) host.renderPage(editor, pageUid);
        else host.renderBlock(editor, item.uid);
      } else {
        host.renderBlock(editor, targetUid);
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      await exitEdit({ silent: true });
      return false;
    }
    const releaseIfFilled = () => {
      if (editing?.uid !== uid) return;
      const editorH = boxHeight(editor);
      if (!(editorH > 0 && editorH + 1 >= lockH)) return;
      releaseEditLock(rec);
    };
    if (reduced) {
      editing.releaseCancel = frameLater(() => {
        if (editing?.uid !== uid) return;
        editing.releaseCancel = null;
        releaseIfFilled();
      });
    } else {
      editing.fadeCancel = later(() => {
        if (editing?.uid !== uid) return;
        editing.fadeCancel = null;
        rec.el.classList.remove("pxd-item--xfade");
        dropStaticLayer(rec);
        editing.releaseCancel = frameLater(() => {
          if (editing?.uid !== uid) return;
          editing.releaseCancel = null;
          releaseIfFilled();
        });
      }, EDIT_FADE_MS);
    }
    await waitHydrateQuiet(editor, HYDRATE_CAP_MS);
    if (disposed || editing?.uid !== uid) return false;
    let input = null;
    if (rowOffset !== null) {
      for (const node2 of editor.querySelectorAll?.(".rm-block__input") || []) {
        if (String(node2.id || node2.getAttribute?.("id") || "").endsWith(`-${row2}`)) {
          input = node2;
          break;
        }
      }
      if (input) {
        const delta = (Number(input.getBoundingClientRect?.().top) || 0) - (Number(rec.body.getBoundingClientRect?.().top) || 0) - rowOffset;
        if (delta && rec.body) rec.body.scrollTop = Math.max(0, (Number(rec.body.scrollTop) || 0) + delta / (zoomCache || 1));
      }
    }
    if (!input) input = editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea");
    applyEditorCounterScale(editor, zoomCache);
    if (input) focusRoamInput(input);
    applyEditorCounterScale(editor, zoomCache);
    frameLater(() => {
      if (editing?.uid === uid) applyEditorCounterScale(editor, zoomCache);
    });
    if (editing?.uid === uid && editor.contains?.(doc.activeElement)) editing.ready = true;
    stopMenus?.();
    stopMenus = null;
    if (editing?.uid === uid) ensureMenus(() => editor.querySelector?.("textarea"));
    return true;
  };
  const exitEdit = async ({ silent = false } = {}) => {
    stopMenus?.();
    stopMenus = null;
    if (doc.querySelector?.(".pxd-root .bp3-popover-open")) ensureMenus();
    const e = editing;
    if (!e) return;
    editing = null;
    clearEditFade(e);
    detachFocusGuard();
    const { rec, editor, uid, item } = e;
    applyEditorCounterScale(editor, 1);
    const contentH = Number(editor.scrollHeight) || 0;
    for (const type of EDITOR_STOPPED) editor.removeEventListener(type, stopEvent);
    dropStaticLayer(rec);
    try {
      host?.unmount?.(editor);
    } catch {
    }
    editor.remove();
    rec.el.classList.remove("pxd-item--editing");
    releaseEditLock(rec);
    rec.contentKey = null;
    mounted.delete(uid);
    if (rec.type === "card") {
      rec.bare = true;
      rec.el.classList.add("pxd-item--bare");
    }
    if (!silent && !disposed) {
      const live = lastBoard?.items.get(uid) || item;
      if (live && shells.has(uid)) {
        mountContent(rec, live);
        paintShell(rec, live);
        mounted.set(uid, now());
        renderBadges(rec);
      }
      onEditChange?.(null);
      const need = contentH + (["page", "board"].includes(item.kind) || item.collapsed ? HEADER_H : 0) + 20;
      if (contentH > 0 && live && need > live.h) {
        const grow = Math.min(GROW_CAP, need);
        if (grow > live.h) (onGrow || ((u, h) => session?.growToFit?.(u, h)))(uid, grow);
      }
    }
  };
  const autocompleteOpen = () => Boolean(doc.querySelector?.(".rm-autocomplete__results"));
  const renameSection = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type !== "section") return false;
    const t = rec.title;
    unmountRoots(rec);
    t.replaceChildren();
    t.textContent = item.string || "";
    t.classList.add("pxd-section__title--editing");
    t.contentEditable = "true";
    t.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      t.contentEditable = "false";
      t.removeAttribute("contenteditable");
      t.classList.remove("pxd-section__title--editing");
      t.removeEventListener("keydown", onKey);
      t.removeEventListener("blur", onBlur);
      t.removeEventListener("pointerdown", stopEvent);
      const next = String(t.textContent || "").trim();
      rec.titleRendered = false;
      rec.contentKey = null;
      mounted.delete(uid);
      if (commit && next !== item.string) (onRenameCommit || ((u, s) => session?.setString?.(u, s)))(uid, next);
      else t.textContent = item.title || "Section";
    };
    const onKey = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    t.addEventListener("keydown", onKey);
    t.addEventListener("blur", onBlur);
    t.addEventListener("pointerdown", stopEvent);
    try {
      t.focus({ preventScroll: true });
    } catch {
      t.focus?.();
    }
    try {
      const d = t.ownerDocument;
      const r = d.createRange();
      r.selectNodeContents(t);
      const s = d.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch {
    }
    return true;
  };
  const renameBoard = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "board" || !item.enhanced || !rec.header || rec.renaming) return false;
    const h = rec.header;
    const seed = parseBoardTitle(item.string);
    rec.renaming = true;
    h.textContent = seed;
    h.classList.add("pxd-item__header--editing");
    h.classList.remove("pxd-item__header--muted");
    h.contentEditable = "true";
    h.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      if (!rec.renaming) return;
      rec.renaming = false;
      h.contentEditable = "false";
      h.removeAttribute("contenteditable");
      h.classList.remove("pxd-item__header--editing");
      h.removeEventListener("keydown", onKey);
      h.removeEventListener("blur", onBlur);
      h.removeEventListener("pointerdown", stopEvent);
      h.removeEventListener("dblclick", stopEvent);
      const next = String(h.textContent || "").trim();
      const live = lastBoard?.items.get(uid) || item;
      h.textContent = live.title || "";
      h.classList.toggle("pxd-item__header--muted", isUntitledBoard(live.title));
      if (commit && next !== seed) commitBoardName(uid, next);
    };
    const onKey = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    h.addEventListener("keydown", onKey);
    h.addEventListener("blur", onBlur);
    h.addEventListener("pointerdown", stopEvent);
    h.addEventListener("dblclick", stopEvent);
    try {
      h.focus({ preventScroll: true });
    } catch {
      h.focus?.();
    }
    try {
      const d = h.ownerDocument;
      const r = d.createRange();
      r.selectNodeContents(h);
      const sel = d.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
    }
    return true;
  };
  const renamePage = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "page" || !rec.header || rec.renaming) return false;
    const h = rec.header;
    const seed = String(item.title || "").trim();
    rec.renaming = true;
    h.textContent = seed;
    h.classList.add("pxd-item__header--editing");
    h.contentEditable = "true";
    h.setAttribute("contenteditable", "true");
    const win = doc.defaultView;
    const finish = (commit) => {
      if (!rec.renaming) return;
      rec.renaming = false;
      h.contentEditable = "false";
      h.removeAttribute("contenteditable");
      h.classList.remove("pxd-item__header--editing");
      win?.removeEventListener("keydown", onKey, true);
      h.removeEventListener("blur", onBlur);
      h.removeEventListener("pointerdown", stopEvent);
      h.removeEventListener("dblclick", stopEvent);
      const next = String(h.textContent || "").trim();
      const live = lastBoard?.items.get(uid) || item;
      h.textContent = String(live.title || seed).slice(0, HEADER_TEXT_MAX);
      if (commit && next && next !== seed) onRenamePage?.(seed, next);
    };
    const onKey = (event) => {
      const here = event.target === h || h.contains?.(event.target);
      if (!here) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    win?.addEventListener("keydown", onKey, true);
    h.addEventListener("blur", onBlur);
    h.addEventListener("pointerdown", stopEvent);
    h.addEventListener("dblclick", stopEvent);
    try {
      h.focus({ preventScroll: true });
    } catch {
      h.focus?.();
    }
    try {
      const d = h.ownerDocument;
      const r = d.createRange();
      r.selectNodeContents(h);
      const s = d.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch {
    }
    return true;
  };
  const dispose = () => {
    disposed = true;
    closePeek();
    doc.removeEventListener?.("pointerup", onMenuPointer, true);
    stopMenus?.();
    stopMenus = null;
    if (editing) {
      const e = editing;
      clearEditFade(e);
      editing = null;
      detachFocusGuard();
      for (const type of EDITOR_STOPPED) e.editor.removeEventListener(type, stopEvent);
      e.rec.ghost?.remove();
      e.rec.ghost = null;
      try {
        host?.unmount?.(e.editor);
      } catch {
      }
    }
    if (idleHandle) {
      idleHandle();
      idleHandle = null;
    }
    if (unmountTimer) {
      unmountTimer();
      unmountTimer = null;
    }
    for (const uid of [...shells.keys()]) {
      const rec = shells.get(uid);
      unmountRoots(rec);
      dropKidsBadge(rec);
      rec.el.remove();
    }
    shells.clear();
    mounted.clear();
    queue = [];
  };
  return {
    sync,
    scheduleContent,
    quiet,
    setPaused,
    setLod,
    setZoom,
    previewMove,
    previewRects,
    previewSectionRects,
    resetRects,
    measureContent,
    toggleKids,
    setBadges,
    setShowBadges,
    setFocus,
    setSelection,
    setHover,
    enterEdit,
    exitEdit,
    editingUid: () => editing?.uid ?? null,
    isEditing: () => Boolean(editing),
    recoverFocus,
    autocompleteOpen,
    renameSection,
    renameBoard,
    renamePage,
    shellOf: (uid) => shells.get(uid)?.el ?? null,
    measureRow,
    revealRow,
    expireContent(uids) {
      for (const uid of uids || []) {
        const rec = shells.get(uid);
        if (!rec || editing?.uid === uid) continue;
        unmountRoots(rec);
        rec.body?.replaceChildren?.();
        rec.contentKey = null;
        mounted.delete(uid);
        rec.titleRendered = false;
        if (rec.type === "card") {
          rec.bare = true;
          rec.el.classList.add("pxd-item--bare");
        }
        onPageLayout?.(uid);
      }
      if (uids?.length && lastContent) fillContent(lastContent);
    },
    mountedCount: () => mounted.size,
    mountedUids: () => [...mounted.keys()],
    shellCount: () => shells.size,
    lod: () => lod,
    dispose
  };
}

// src/view/editor-keys.js
var UID3 = /^[A-Za-z0-9_-]{9,15}$/;
function blockUidFromNode(node2) {
  let el = node2;
  while (el && el.nodeType === 1) {
    const id = String(el.id || el.getAttribute?.("id") || "");
    if (id.startsWith("block-input-")) {
      const rest = id.slice("block-input-".length);
      if (UID3.test(rest)) return rest;
    }
    if (UID3.test(id)) return id;
    const data = el.dataset?.uid || el.getAttribute?.("data-uid") || "";
    if (UID3.test(data)) return data;
    el = el.parentElement;
  }
  return null;
}
var inside2 = (node2, ancestor) => {
  let el = node2;
  while (el && el.nodeType === 1) {
    if (el === ancestor) return true;
    el = el.parentElement;
  }
  return false;
};
function inputBlockRole(node2, rootUid) {
  const uid = blockUidFromNode(node2);
  const editor = node2?.closest?.(".pxd-item__editor") || null;
  const nest = node2?.closest?.(".rm-block-children") || null;
  if (nest && inside2(nest, editor)) return { role: "child", uid };
  if (uid && rootUid && uid !== rootUid) return { role: "child", uid };
  return { role: "root", uid: uid || rootUid || null };
}
function editorKeyAction({
  key,
  shift = false,
  meta = false,
  ctrl = false,
  alt = false,
  autocomplete = false,
  isRoot = false,
  fresh = false,
  value = "",
  selectionStart = 0,
  selectionEnd = 0,
  enterMode = "newline"
} = {}) {
  if (autocomplete) return { type: "roam" };
  const mod = Boolean(meta || ctrl);
  if (key === "Tab" && !alt) return { type: "roam" };
  if (key === "Enter" && mod && !shift && !alt) return { type: "roam" };
  if (key === "Enter" && isRoot && !shift && !mod && !alt && enterMode !== "child") return { type: "newline" };
  if (key === "Backspace" && isRoot && fresh && !mod && !alt) {
    const text2 = String(value ?? "");
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    if (!text2.trim() && start === end) return { type: "delete-card" };
  }
  return { type: "roam" };
}

// src/view/edges.js
var SVG_NS2 = "http://www.w3.org/2000/svg";
var PAIR_OFFSET = 18;
var LABEL_HIDE_ZOOM = 0.3;
var setClass = (el, name) => {
  el.setAttribute("class", name);
  if (el.classList && !el.classList.contains(name.split(" ")[0])) el.className = name;
};
function createEdgeLayer({ doc = globalThis.document, svg, labelsLayer, overlaySvg, onLabelCommit, blockText } = {}) {
  const edgeEls = /* @__PURE__ */ new Map();
  const linkEls = /* @__PURE__ */ new Map();
  let wire = null;
  let marquee = null;
  let lasso = null;
  const guideEls = [];
  const ghostEls = [];
  let focusSet = null;
  let searchEdges = null;
  let zoomCache = 1;
  let editingLabel = null;
  const measures = /* @__PURE__ */ new Map();
  const listeners2 = [];
  const mk = (tag, cls, parent) => {
    const el = doc.createElementNS(SVG_NS2, tag);
    setClass(el, cls);
    parent?.append(el);
    return el;
  };
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners2.push(() => el.removeEventListener(type, fn, opts));
  };
  const pairOffset = (board2, edge) => {
    for (const other of board2.edges.values()) {
      if (other.uid !== edge.uid && other.from === edge.to && other.to === edge.from) {
        return edge.uid < other.uid ? PAIR_OFFSET : -PAIR_OFFSET;
      }
    }
    return 0;
  };
  const geometryFor = (board2, edge, rects) => {
    const routed = routedEdge(board2, edge, rects);
    if (!routed) return null;
    let via = edge.via;
    if ((!via || !via.length) && edge.route === "around") {
      const obstacles = [];
      for (const [uid, rect] of rects) {
        if (uid === edge.from || uid === edge.to || !rect) continue;
        const item = board2.items.get(uid);
        if (item?.type === "card" || item?.type === "text") obstacles.push(rect);
      }
      via = routeAround(center(routed.a), center(routed.b), obstacles);
    }
    let fromSide = edge.fromSide;
    let toSide = edge.toSide;
    let fromPoint;
    let toPoint;
    let fromClamp = null;
    let toClamp = null;
    const m = edge.fromBlock || edge.toBlock ? measures.get(edge.uid) : null;
    if (m) {
      if (m.from && edge.fromBlock && routed.from === edge.from) {
        const an = blockAnchor({ rect: routed.a, ...m.from, other: center(routed.b) });
        fromPoint = an.point;
        fromSide = an.side;
        fromClamp = an.clamped;
      }
      if (m.to && edge.toBlock && routed.to === edge.to) {
        const an = blockAnchor({ rect: routed.b, ...m.to, other: center(routed.a) });
        toPoint = an.point;
        toSide = an.side;
        toClamp = an.clamped;
      }
    }
    const geo = edgePath({ a: routed.a, b: routed.b, fromSide, toSide, route: edge.route, offset: pairOffset(board2, edge), via, fromPoint, toPoint });
    if (m) {
      geo.fromClamp = fromClamp;
      geo.toClamp = toClamp;
      geo.fromBlockAnchored = Boolean(fromPoint);
      geo.toBlockAnchored = Boolean(toPoint);
    }
    return geo;
  };
  const buildEdge = (edge) => {
    const g = mk("g", "pxd-edge", svg);
    g.dataset.uid = edge.uid;
    g.setAttribute("data-uid", edge.uid);
    const hit = mk("path", "pxd-edge__hit", g);
    const line = mk("path", "pxd-edge__line", g);
    const tail = mk("path", "pxd-edge__head pxd-edge__tail", g);
    const head = mk("path", "pxd-edge__head", g);
    const dot = mk("circle", "pxd-edge__dot", g);
    dot.setAttribute("r", "4");
    const label = doc.createElement("div");
    label.className = "pxd-label";
    label.dataset.uid = edge.uid;
    label.setAttribute("data-uid", edge.uid);
    labelsLayer?.append(label);
    const rec = { g, hit, line, head, tail, dot, label, geo: null };
    edgeEls.set(edge.uid, rec);
    return rec;
  };
  const bendOf = (rec, end) => {
    if (rec.bends?.[end]) return rec.bends[end];
    const g = mk("g", "pxd-edge__bend", rec.g);
    g.setAttribute("data-end", end);
    g.dataset.end = end;
    mk("circle", "pxd-edge__bend-dot", g).setAttribute("r", "5");
    mk("path", "pxd-edge__bend-chevron", g);
    const title = doc.createElementNS(SVG_NS2, "title");
    g.append(title);
    rec.bends = { ...rec.bends || {}, [end]: { g, title, clamp: null } };
    return rec.bends[end];
  };
  const dropBend = (rec, end) => {
    const bend = rec.bends?.[end];
    if (!bend) return;
    bend.g.remove();
    delete rec.bends[end];
  };
  const placeBend = (rec, end, point, clamp2, zoom) => {
    const bend = bendOf(rec, end);
    const scale = Math.min(3, Math.max(1, 1 / (zoom || 1)));
    bend.g.setAttribute("transform", `translate(${point.x} ${point.y}) scale(${scale})`);
    if (bend.clamp !== clamp2) {
      bend.clamp = clamp2;
      bend.g.setAttribute("class", `pxd-edge__bend${clamp2 ? " pxd-edge__bend--clamped" : ""}`);
      bend.g.setAttribute("data-clamp", clamp2 || "");
      bend.g.querySelector?.(".pxd-edge__bend-chevron")?.setAttribute("d", clamp2 === "bottom" ? "M-3 -1.5L0 1.5L3 -1.5" : "M-3 1.5L0 -1.5L3 1.5");
    }
  };
  const bendTitle = (rec, end, uid) => {
    const bend = rec.bends?.[end];
    if (!bend) return;
    let text2 = "";
    try {
      text2 = String(blockText?.(uid) ?? "").trim().slice(0, 120);
    } catch {
      text2 = "";
    }
    bend.title.textContent = text2 || "Block";
  };
  const placeEnds = (rec, geo) => {
    if (!rec.ends || !geo) return;
    for (const end of ["from", "to"]) {
      const p = end === "from" ? geo.start : geo.end;
      rec.ends[end].setAttribute("cx", String(p.x));
      rec.ends[end].setAttribute("cy", String(p.y));
    }
  };
  const syncEnds = (rec, on) => {
    if (!on) {
      if (!rec.ends) return;
      rec.ends.from.remove();
      rec.ends.to.remove();
      rec.ends = null;
      return;
    }
    if (rec.ends) return;
    rec.ends = {};
    for (const end of ["from", "to"]) {
      const c = mk("circle", "pxd-edge__end", rec.g);
      c.setAttribute("r", "6");
      c.setAttribute("data-end", end);
      c.dataset.end = end;
      rec.ends[end] = c;
    }
    placeEnds(rec, rec.geo);
  };
  const dimmed = (e) => Boolean(focusSet) && !(focusSet.has(e.from) && focusSet.has(e.to));
  const paintEdge = (board2, edge, rec, { covered, selected }) => {
    const cls = ["pxd-edge"];
    const named = PALETTE.includes(edge.color);
    const hex = hexColor(edge.color);
    if (named) cls.push(`pxd-c-${edge.color}`);
    if (edge.dash === "dashed") cls.push("pxd-edge--dashed");
    if (edge.dash === "animated") cls.push("pxd-edge--animated");
    if (edge.weight > 1) cls.push(`pxd-edge--w${edge.weight}`);
    if (selected) cls.push("pxd-edge--selected");
    if (covered) cls.push("pxd-edge--covered");
    if (!edge.valid) cls.push("pxd-edge--invalid");
    rec.from = edge.from;
    rec.to = edge.to;
    const searchOn = Boolean(searchEdges?.has(edge.uid));
    const dim = dimmed(edge) || (searchEdges ? !searchOn : false);
    if (dim) cls.push("pxd-edge--dim");
    if (searchOn) cls.push("pxd-edge--hit");
    setClass(rec.g, cls.join(" "));
    if (hex) rec.g.style.setProperty("--pxd-line", hex);
    else rec.g.style.removeProperty("--pxd-line");
    rec.label.className = `pxd-label${named ? ` pxd-c-${edge.color}` : ""}${edge.label ? "" : " pxd-label--empty"}${selected ? " pxd-label--selected" : ""}${dim ? " pxd-label--dim" : ""}`;
    rec.label.style.color = hex || "";
    if (editingLabel?.uid !== edge.uid) rec.label.textContent = edge.label || "";
    rec.dir = edge.dir;
    rec.weight = edge.weight;
    for (const end of ["from", "to"]) {
      const uid = end === "from" ? edge.fromBlock : edge.toBlock;
      if (!uid) {
        if (rec.bends?.[end]) dropBend(rec, end);
        continue;
      }
      bendOf(rec, end);
      bendTitle(rec, end, uid);
    }
  };
  const placeEdge = (board2, edge, rec, rects, zoom) => {
    const geo = geometryFor(board2, edge, rects);
    rec.geo = geo;
    if (!geo) {
      rec.g.setAttribute("display", "none");
      rec.label.style.display = "none";
      return;
    }
    rec.g.removeAttribute("display");
    rec.label.style.display = "";
    rec.hit.setAttribute("d", geo.d);
    rec.line.setAttribute("d", geo.d);
    const size = arrowSize(zoom, edge.weight);
    if (edge.dir === "none") {
      rec.head.setAttribute("display", "none");
      rec.tail.setAttribute("display", "none");
    } else {
      rec.head.removeAttribute("display");
      rec.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, size));
      if (edge.dir === "two") {
        rec.tail.removeAttribute("display");
        rec.tail.setAttribute("d", arrowHeadPath(geo.start, geo.startAngle + Math.PI, size));
      } else {
        rec.tail.setAttribute("display", "none");
      }
    }
    rec.dot.setAttribute("cx", String(geo.mid.x));
    rec.dot.setAttribute("cy", String(geo.mid.y));
    if (edge.fromBlock || edge.toBlock || rec.bends) {
      for (const end of ["from", "to"]) {
        const anchored = end === "from" ? geo.fromBlockAnchored : geo.toBlockAnchored;
        const uid = end === "from" ? edge.fromBlock : edge.toBlock;
        if (!uid || !anchored) {
          if (rec.bends?.[end]) rec.bends[end].g.setAttribute("display", "none");
          continue;
        }
        const bend = bendOf(rec, end);
        bend.g.removeAttribute("display");
        placeBend(rec, end, end === "from" ? geo.start : geo.end, end === "from" ? geo.fromClamp : geo.toClamp, zoom);
      }
    }
    placeEnds(rec, geo);
    rec.label.style.transform = `translate(${geo.mid.x}px, ${geo.mid.y}px) translate(-50%, -50%)`;
  };
  const buildLink = (link) => {
    const g = mk("g", "pxd-link", svg);
    g.dataset.key = link.key;
    g.setAttribute("data-key", link.key);
    const hit = mk("path", "pxd-link__hit", g);
    const line = mk("path", "pxd-link__line", g);
    const head = mk("path", "pxd-link__head", g);
    const label = doc.createElement("div");
    label.className = "pxd-label pxd-label--link";
    label.dataset.key = link.key;
    label.setAttribute("data-key", link.key);
    labelsLayer?.append(label);
    const rec = { g, hit, line, head, label, geo: null };
    linkEls.set(link.key, rec);
    return rec;
  };
  const placeLink = (link, rec, rects, zoom, selected) => {
    const a = rects.get(link.from);
    const b = rects.get(link.to);
    rec.from = link.from;
    rec.to = link.to;
    const dim = dimmed(link);
    const dash = link.dash === "solid" || link.dash === "dashed" || link.dash === "dotted" ? ` pxd-link--${link.dash}` : "";
    setClass(rec.g, `pxd-link pxd-c-${link.color || "gray"}${dash}${selected ? " pxd-link--selected" : ""}${dim ? " pxd-edge--dim" : ""}`);
    rec.label.className = `pxd-label pxd-label--link pxd-c-${link.color || "gray"}${selected ? " pxd-label--selected" : ""}${dim ? " pxd-label--dim" : ""}`;
    rec.label.textContent = link.labels?.[0] || "mentions";
    if (!a || !b) {
      rec.g.setAttribute("display", "none");
      rec.label.style.display = "none";
      return;
    }
    rec.g.removeAttribute("display");
    rec.label.style.display = "";
    const geo = edgePath({ a, b, route: "curve" });
    rec.geo = geo;
    rec.hit.setAttribute("d", geo.d);
    rec.line.setAttribute("d", geo.d);
    rec.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, arrowSize(zoom, 1) * 0.8));
    rec.label.style.transform = `translate(${geo.mid.x}px, ${geo.mid.y}px) translate(-50%, -50%)`;
  };
  const removeEdge = (uid) => {
    const rec = edgeEls.get(uid);
    if (!rec) return;
    rec.g.remove();
    rec.label.remove();
    edgeEls.delete(uid);
  };
  const removeLink = (key) => {
    const rec = linkEls.get(key);
    if (!rec) return;
    rec.g.remove();
    rec.label.remove();
    linkEls.delete(key);
  };
  const render = ({ board: board2, rects, links = [], coveredEdges = /* @__PURE__ */ new Set(), selection = {}, zoom = 1, dirty = null }) => {
    zoomCache = zoom;
    for (const uid of [...edgeEls.keys()]) if (!board2.edges.has(uid)) removeEdge(uid);
    for (const edge of board2.edges.values()) {
      let rec = edgeEls.get(edge.uid);
      const fresh = !rec;
      if (!rec) rec = buildEdge(edge);
      if (fresh || !dirty || dirty.has(edge.uid)) {
        paintEdge(board2, edge, rec, { covered: coveredEdges.has(edge.uid), selected: selection.edge === edge.uid });
        placeEdge(board2, edge, rec, rects, zoom);
      }
    }
    const keys = new Set(links.map((l) => l.key));
    for (const key of [...linkEls.keys()]) if (!keys.has(key)) removeLink(key);
    for (const link of links) {
      const rec = linkEls.get(link.key) || buildLink(link);
      placeLink(link, rec, rects, zoom, selection.link === link.key);
    }
    labelsLayer?.classList.toggle("pxd-labels--hidden", zoom < LABEL_HIDE_ZOOM);
  };
  const update = ({ board: board2, edgeUids, rects, zoom = zoomCache, linkKeys = null, links = [] }) => {
    for (const uid of edgeUids) {
      const edge = board2.edges.get(uid);
      const rec = edgeEls.get(uid);
      if (edge && rec) placeEdge(board2, edge, rec, rects, zoom);
    }
    if (linkKeys) {
      for (const link of links) {
        if (!linkKeys.has(link.key)) continue;
        const rec = linkEls.get(link.key);
        if (rec) placeLink(link, rec, rects, zoom, rec.g.getAttribute("class")?.includes("--selected"));
      }
    }
  };
  const setSelection = ({ edge = null, link = null } = {}) => {
    for (const [uid, rec] of edgeEls) {
      const on = uid === edge;
      const cls = String(rec.g.getAttribute("class") || "").replace(/\s*pxd-edge--selected/g, "");
      setClass(rec.g, on ? `${cls} pxd-edge--selected` : cls);
      rec.label.classList.toggle("pxd-label--selected", on);
      syncEnds(rec, on);
    }
    for (const [key, rec] of linkEls) {
      const on = key === link;
      const cls = String(rec.g.getAttribute("class") || "").replace(/\s*pxd-link--selected/g, "");
      setClass(rec.g, on ? `${cls} pxd-link--selected` : cls);
      rec.label.classList.toggle("pxd-label--selected", on);
    }
  };
  const setTempWire = (spec, rects, zoom = zoomCache) => {
    if (!spec) {
      wire?.line.remove();
      wire?.head.remove();
      wire = null;
      return;
    }
    if (!wire) {
      wire = { line: mk("path", "pxd-wire", overlaySvg), head: mk("path", "pxd-wire__head", overlaySvg) };
    }
    const a = rects.get(spec.from);
    if (!a) return;
    const b = { x: spec.point.x, y: spec.point.y, w: 0, h: 0 };
    const geo = edgePath({ a, b, fromSide: spec.fromSide || "auto", toSide: "auto", route: "curve" });
    wire.line.setAttribute("d", geo.d);
    wire.head.setAttribute("d", arrowHeadPath(geo.end, geo.endAngle, arrowSize(zoom, 1)));
  };
  const setGuides = (guides = []) => {
    while (guideEls.length > guides.length) guideEls.pop().remove();
    while (guideEls.length < guides.length) guideEls.push(mk("line", "pxd-guide", overlaySvg));
    guides.forEach((gd, i) => {
      const el = guideEls[i];
      el.setAttribute("x1", String(gd.x1));
      el.setAttribute("y1", String(gd.y1));
      el.setAttribute("x2", String(gd.x2));
      el.setAttribute("y2", String(gd.y2));
    });
  };
  const setMarquee = (rect, kind = "select") => {
    if (!rect) {
      marquee?.remove();
      marquee = null;
      return;
    }
    if (!marquee) marquee = mk("rect", "pxd-marquee", overlaySvg);
    setClass(marquee, `pxd-marquee${kind === "section" ? " pxd-marquee--section" : ""}`);
    marquee.setAttribute("x", String(rect.x));
    marquee.setAttribute("y", String(rect.y));
    marquee.setAttribute("width", String(rect.w));
    marquee.setAttribute("height", String(rect.h));
  };
  const setLasso = (points) => {
    if (!points || points.length < 2) {
      lasso?.remove();
      lasso = null;
      return;
    }
    if (!lasso) lasso = mk("polygon", "pxd-lasso", overlaySvg);
    lasso.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
  };
  const setGhosts = (list) => {
    const rects = list || [];
    while (ghostEls.length > rects.length) ghostEls.pop().remove();
    while (ghostEls.length < rects.length) ghostEls.push(mk("rect", "pxd-ghost", overlaySvg));
    rects.forEach((r, i) => {
      const el = ghostEls[i];
      el.setAttribute("x", String(r.x));
      el.setAttribute("y", String(r.y));
      el.setAttribute("width", String(r.w));
      el.setAttribute("height", String(r.h));
    });
  };
  const applySearchClasses = () => {
    for (const [uid, rec] of edgeEls) {
      const on = Boolean(searchEdges?.has(uid));
      const dim = dimmed(rec) || (searchEdges ? !on : false);
      rec.g.classList.toggle("pxd-edge--hit", on);
      rec.g.classList.toggle("pxd-edge--dim", dim);
      rec.label.classList.toggle("pxd-label--dim", dim);
    }
  };
  const setSearch = (uids) => {
    searchEdges = uids instanceof Set ? uids : null;
    applySearchClasses();
  };
  const setFocus = (set) => {
    focusSet = set && set.size !== void 0 ? set : null;
    for (const rec of [...edgeEls.values(), ...linkEls.values()]) {
      const dim = dimmed(rec) || (searchEdges ? !searchEdges.has(rec.g?.dataset?.uid) : false);
      rec.g.classList.toggle("pxd-edge--dim", dim);
      rec.label.classList.toggle("pxd-label--dim", dim);
    }
  };
  const editLabel = (uid) => {
    const rec = edgeEls.get(uid);
    if (!rec || editingLabel) return false;
    const el = rec.label;
    const previous = el.textContent || "";
    editingLabel = { uid, previous };
    el.classList.remove("pxd-label--empty");
    el.classList.add("pxd-label--editing");
    el.contentEditable = "true";
    el.setAttribute("contenteditable", "true");
    el.spellcheck = false;
    const finish = (commit) => {
      if (!editingLabel || editingLabel.uid !== uid) return;
      editingLabel = null;
      el.contentEditable = "false";
      el.removeAttribute("contenteditable");
      el.classList.remove("pxd-label--editing");
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", stop);
      const next = String(el.textContent || "").trim();
      if (commit && next !== previous) onLabelCommit?.(uid, next);
      else el.textContent = previous;
      if (!el.textContent) el.classList.add("pxd-label--empty");
    };
    const onKey = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    const stop = (event) => event.stopPropagation();
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", stop);
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus?.();
    }
    try {
      const d = el.ownerDocument;
      const r = d.createRange();
      r.selectNodeContents(el);
      const s = d.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch {
    }
    return true;
  };
  const setMeasures = (next) => {
    const changed2 = /* @__PURE__ */ new Set();
    for (const uid of measures.keys()) if (!next.has(uid)) changed2.add(uid);
    for (const [uid, m] of next) if (JSON.stringify(measures.get(uid) ?? null) !== JSON.stringify(m)) changed2.add(uid);
    measures.clear();
    for (const [uid, m] of next) measures.set(uid, m);
    return changed2;
  };
  const geometryOf = (uid) => edgeEls.get(uid)?.geo ?? null;
  const linkGeometryOf = (key) => linkEls.get(key)?.geo ?? null;
  const labelRect = (uid) => {
    const rec = edgeEls.get(uid);
    return rec ? rec.label.getBoundingClientRect() : null;
  };
  const dispose = () => {
    for (const uid of [...edgeEls.keys()]) removeEdge(uid);
    for (const key of [...linkEls.keys()]) removeLink(key);
    setTempWire(null);
    setGuides([]);
    setMarquee(null);
    setLasso(null);
    setGhosts(null);
    focusSet = null;
    searchEdges = null;
    listeners2.splice(0).forEach((off) => off());
    editingLabel = null;
  };
  return {
    render,
    update,
    setSelection,
    setTempWire,
    setGuides,
    setMarquee,
    setLasso,
    setGhosts,
    setFocus,
    setSearch,
    setMeasures,
    editLabel,
    isEditingLabel: () => Boolean(editingLabel),
    geometryOf,
    linkGeometryOf,
    labelRect,
    labelEl: (uid) => edgeEls.get(uid)?.label ?? null,
    portPoint: (rect, side) => sidePoint(rect, side),
    dispose,
    _els: edgeEls
  };
}

// src/model/changelog.js
function changelogEntry(markdown, version) {
  const text2 = String(markdown || "").replace(/^\uFEFF/, "");
  const ver = String(version || "").trim().replace(/^v/, "");
  if (!ver) return "";
  const lines = text2.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${ver} `) || line.startsWith(`## ${ver}
`) || line === `## ${ver}`);
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## [^#]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

// src/changelog-text.js
var CHANGELOG_TEXT = '# Changelog\n\n## Unreleased\n\n- Enter in a card adds a line to the card\'s block, like a node in a native Roam diagram. Settings, Cards, "Enter in a card" set to Child brings back the old behavior of making a child block.\n- An empty white panel with a Close button no longer covers boards.\n- Pasting one image into a card inserted it twice. It now inserts once.\n- Dragging an image onto a card that is being edited works. Dropping an image on a card adds it after the card\'s text instead of replacing the text.\n\n## 2.0.0 — 2026-10-03\n\n- Card editing, outline navigation, templates, the table, snapshots, and the graph tools that landed after 1.3.0.\n- Gallery, timeline, and a read-only graph of the board. A section can lay cards out by date. Connections can bend or route around cards. Present shows a section\'s first child as notes, plus a laser and a pen that are dropped on exit.\n- A diagram in the right sidebar stays a gap until that window is on screen. Opening the sidebar parks the boards on the page.\n- A 300-card board shows its first shells in about 1 second and finishes the rest over the following frames. Detail and overview pan hold 60 fps. Zooming across the detail threshold is about 57 to 59 fps, and that switch no longer produces a long task.\n- The same board in two Roam windows kept the same 6 cards and 4 connections across 30 moves.\n\n## 1.3.0 — 2026-10-01\n\n- Native parity on an enhanced board: plain block cards, a node hover toolbar, a right-hand control rail, a properties panel, PNG export, outline in the sidebar, boards in the sidebar, edge styles, native embeds, style import on Enhance, per-card expand, minimap drag, keyboard parity, and Edit Block.\n\n## 1.2.0 — 2026-09-29\n\nFixes from the second round of testing on 1.1.0:\n\n- **Zoomed-out cards stay inside their box.** Map view is a clean title-only tile: three-line clamp, font capped by the tile height, nothing spills below the card. Ref titles are cut at 120 characters and header text at 160. The level of detail now switches while you zoom (with hysteresis, one class toggle), not only when the gesture ends. A third tier below 20% shows section titles only.\n- **Nested board thumbnails are real thumbnails.** A padded frame with mini cards (border, fill, title), sections as tinted frames, connections, and an "Empty board" state, instead of one white box.\n- **Sections auto-fit.** A card moved, resized, created, or pasted past a section edge grows the section to contain it (24 px padding), live during the drag and saved as one undo step. It cascades through nested sections, never shrinks by itself, and can be turned off per section or with the `auto-fit-sections` setting.\n- **Board backgrounds.** Dots, lines, grid, and plain patterns and paper or ten palette tones, chosen per board from the Background button (stored in the board block\'s props) with a default in Settings.\n\nAdded:\n\n- **Right-click menus** for the board, cards, sections, text, connections, multi-selection, and the More menu.\n- **Duplicate and clipboard.** Alt+drag and Cmd+D duplicate (Alt+Shift makes `((ref))` cards); copy and paste as refs or as copies, across boards; pasted text and images become cards. Send to board, Boards tab (every board in the graph), Outline tab.\n- **Keyboard.** Tab and Shift+Tab step through the outline, F focus mode, Q quick look, P presentation, M mind map from a card\'s child blocks, Cmd/Ctrl+Alt+Enter fold, double-click a bottom or corner grip to fit or reset height. Arrow keys nudge the selection 1 px (Shift for 10 px); Alt+Arrow selects the nearest card in that direction (Alt+Shift adds), as in Heptabase.\n- **Layout tools.** Tidy (row, column, grid, outline order), same size, fit height, reset size, fit section, fold all, optional space-out after a move, "Back to content" button.\n- **Pin.** Pinned items do not move, resize, or delete.\n- **Card badges.** References, boards, and open and done TODO counts, read from Roam (never written); a `((ref))` to a board renders its thumbnail; journal cards for today and this week.\n- **Export.** Export board as SVG and Copy board as text (commands and board menu).\n- **Review fixes.** Cut and paste now moves a note, text or section (the clipboard carries a snapshot; before, the paste was a dead `((ref))`). The Open button, double-click and Enter open a whiteboard-shortcut card. Settings changes reach open boards\' sessions live. A pinned section is never grown by auto-fit. Fit height can shrink a card. Fit / Reset size / Same size never leave a card outside its section. A pinned card no longer pushes other cards in space-out. Escape closes the Background popover first. Right-clicking a ref, tag, link or image inside a card keeps Roam\'s or the browser\'s menu. Tab is only taken while the board itself has focus. A tall menu scrolls inside a small board. Thumbnails title `((ref))` and image cards. The section grows live while you type in a card at its edge. Card badge queries run in idle slots and are cached for two minutes.\n- New settings: default board tone, map view threshold, auto-fit sections, space out cards, show card badges; grid accepts `grid`. API and build: see `docs/api-plexus-1.0.md` ("1.2 additions") and `docs/spec-plexus-1.2.md`; `src/css/*.css` is appended to the bundle.\n\nFixed after live testing in Roam Desktop:\n\n- **One Cmd+Z per operation.** Duplicate, Alt+drag, mind map, Tidy, and a drag that grows a section each took one Cmd+Z per block written; the Undo toast button undid one block. Writes of a transaction are now grouped, and Undo and Redo step over the whole group.\n- Map-view cards clamp to exactly three lines (no fourth-line sliver, no ellipsis in the middle of a tall card); section titles show an ellipsis; far zoom-out no longer paints a dot moire; colored cards read at overview zoom; whiteboard-shortcut cards keep their thumbnail at map zoom.\n- Ctrl-wheel zoom and paste use the board\'s current position after the Roam page scrolls (they were off by the scroll distance).\n- Pasted images are `![](url)`, not `![](![](url))`.\n- The section preview no longer snaps back while you type in a card at its edge.\n- Fit keeps content below the toolbar and left of an open panel (Outline click fits the visible area); the context bar no longer covers the toolbar or the panel; double-click on the middle of a card\'s bottom edge fits its height.\n- Mind map from a card that already has child cards on the board lays the rest out around them, and says when the 24-branch cap left nodes out. Add this week no longer stacks a card on an existing one. Duplicating a section says "section".\n- The OS dark-mode hint no longer darkens a board on a light Roam theme.\n- **Typing in a card: Enter no longer drops you out of the card.** Root cause: the card editor stopped the mouseup that Roam uses to end its block drag-select, so a new block created under the resting pointer turned the edit into a block selection. Mouseup now passes through.\n- **Undo limits.** Roam keeps only the last 50 changes, so one Cmd+Z sequence can undo an operation only if it fits. Mind maps cap at 24 branches ("Mind map: 24 of 45 branches (cap)") and bulk adds (large pastes, multi-drops, Add all) at 45 cards ("Added 45 of N (Roam undo holds 50 changes)").\n\n## 1.1.0 — 2026-09-29\n\nFrom the first round of testing on 1.0.0:\n\n- **Cards show their content.** Note and block-reference cards render the whole block (and its children) instead of a truncated first line over an empty body. A long single-line `((ref))` card is readable again.\n- **Drag blocks in from Roam.** Dragging a bullet from the outline or the right sidebar onto a board adds it as a `((ref))` card (a page becomes a `[[page]]` card). Multi-block drags stack. The source block is never moved.\n- **Typing in a card.** Enter adds lines inside the card and keeps the caret there; if Roam drops focus while it moves between blocks, the editor takes it back. The card header no longer repeats and lags behind what you type, and text items keep their heading size while editing.\n- **Nested boards (Heptabase sub-whiteboards).** New Board tool (W): click or drag to add a board card, or select cards and choose **Move into new board**. Board cards show a mini map, item count, and a name field. Double-click or Open goes into the board in place with a `Parent › Child` breadcrumb; click a crumb or press Esc to go back up. Drag a card onto a board card to move it inside (with Undo). Boards opened from their own page get crumbs for their parent boards.\n- **Collapsed board blocks.** The board block is collapsed once so Roam does not list its cards as bullets under an inline board; expand the bullet to see them. Turn it off with **Collapse board blocks in the outline**. A nested board no longer opens a second overlay from an expanded outline.\n- Import and Restore keep a nested board\'s marker; a board deleted while open closes cleanly (a nested one pops to its parent).\n\n## 1.0.0 — 2026-09-28\n\nRewrite. The 0.6 canvas (one 2,200-line closure) is replaced by a model / host / session / view split with 204 unit tests and a live CDP gate on Roam Desktop.\n\n- **Everything is a Roam object.** Card layout lives in each block\'s `:block/props` (`plexus` key), not on `[[plexus-diagram/metadata]]`. Sections are parent blocks of their cards. Connections are blocks under a collapsed **Connections** child that read `[[A]] → label → [[B]]`, so both ends get a backlink and notes live as children.\n- **Graph links.** References and attributes that already exist between cards are drawn as dashed arrows colored by relation (`causes`, `Detected by`, `mentions`). **Write to graph** turns a labelled connection into `label:: [[B]]` on the source.\n- **Heptabase features.** 10 colors for cards, sections, text, and connections; sections drawn by drag or Cmd+G around a selection, with titles above the frame; ports on every edge; curve / straight / elbow routes, direction, dash, weight; selection box, alignment guides, align / distribute; text headings; minimap; board search; Add panel with Search and Related; card editing with Roam\'s own editor (page cards open the whole page); zoomed-out map view with readable titles.\n- **Fast by construction.** Pan and zoom move one transform (p95 frame 4.5 ms on a 120-card board, no renders, no writes). Only on-screen cards render content; zoomed out, cards show titles only. Opening a board writes nothing; the viewport is per device.\n- **Fixed from 0.6.4:** Section tool made two frames per drag and one per click; sections did not hold cards and had no color; the connection inspector covered the connection; text typed into a new card was lost; the sync indicator went pending on pan and zoom; diagrams on normal (non-daily) pages were never discovered; `[[links]]` inside cards did not open; keyboard shortcuts were swallowed by the diagram block.\n- **Migration.** Boards enhanced with 0.6 upgrade once on first open (positions, colors, sections with their cards, connections with labels and styles). Native diagrams import on **Enhance** (positions, groups as sections, edges as connections). Diagrams you never enhance are never written.\n- Commands: Enhance this diagram, New whiteboard here, Restore native diagram, Fullscreen this diagram.\n\n## 0.6.4 — 2026-09-05\n\n- **Inspector Comment** — converts the edge label to native Roam comments (one-way → target, two-way → both) then clears the pill.\n\n## 0.6.3 — 2026-09-05\n\n- **Idle card children** — after click-away, idle cards `renderBlock` the card uid so child bullets stay visible; deep pull includes nested `:block/children`; empty placeholder only when string is blank and there are no children.\n- **Board background** — toolbar cycles Dots / Lines / Solid (`grid-style` persisted).\n\n## 0.6.2 — 2026-09-05\n\n- **Connect hit-test** — targets resolve from the painted card rects (`getBoundingClientRect`, 12px handle inflate) before `elementsFromPoint` and world-rect math, and the card hovered on the last pointermove is the fallback for a captured pointerup.\n- **Rubber-band** — the edge and temp-wire SVGs cover content ∪ viewport (2000px pad) so the dashed wire paints across a panned board.\n- **No junk cards** — a click-click that misses a card cancels the arm; only a real drag onto empty board creates a linked card.\n- **Version badge** — the toolbar stamps the package version, not Roam\'s `DEV` developer-extension version.\n\n## 0.6.1 — 2026-09-05\n\n- **Connect hit-test** — when Electron\'s `elementsFromPoint` misses cards under `.pxd-world`, resolve targets from world-space node rects (12px handle inflate). Click-click arms and drag-to-card both work.\n- **Delete cards** — Delete/Backspace on a selected card removes it from the diagram (adapter + metadata), not just edges.\n- **Scratch children** — `blankScratch` deletes scratch-host children so a new card editor never inherits the previous card\'s bullet tree.\n\n## 0.6.0 — 2026-09-05\n\n- **Visible arrows** — connector stroke and marker fill are resolved colors, not `var()` in SVG attributes. Marker ids are unique per canvas. Heads scale with zoom (`clamp(10 / zoom, 6, 24)`).\n- **Ports** — drag from a card handle stores `from::` / `to::` (`auto|top|right|bottom|left`). Click-click and connect-to-empty still work.\n- **Per-edge direction** — `direction::` `oneWay|twoWay|none` on `edge A->B`. Global Arrowheads is the default for new edges only.\n- **Inspector** — click a line for a floating cluster: direction, Flip (disabled if the reverse exists), Route, Label, color, Delete. Mutations `await flushLayout()`.\n- **Schema** — optional `from::` `to::` `direction::` `color::` children under the existing edge row. `[[plexus-diagram/metadata]]` only. No `:diagram/*` / `:harc/*`.\n\n## 0.5.0 — 2026-08-29\n\n- **Connect two-click + temp wire** — Connect stays on after an edge. Click-click or drag; the rubber-band lives on `.pxd-edges-temp` above the cards and follows the cursor immediately. Handles are a 12px disc with a larger hit target.\n- **In-place nested boards** — opening a nested diagram does not call `openBlock` / change the hash. The parent session stays loaded; crumbs sit on the toolbar and Esc pops one level.\n- **Section and card color** — toolbar swatches (eight Blueprint-ish ids plus default) write `color::` on nodes and sections. Dark mode uses the border as the signal.\n- **Section click-rename** — a single click on the section title starts rename; pointerdown on the label does not drag the frame.\n- **Review pack** — session swap flushes the outgoing board then cancels persist timers; unused parent pull-watches stop; Esc nest-pop only when the overlay owns the pointer; connect-to-empty rolls back a failed edge persist.\n\n## 0.4.2 — 2026-08-28\n\n- **Svy Beam caret** — overlay inputs use native `caret-color` and `cursor: text` (higher specificity than Beam\'s custom hotspot cursor). `focus({ preventScroll: true })` plus a capture-phase guard stop Roam from scrolling the outline copy of an editing card into view.\n- **Right sidebar inset** — fullscreen also ResizeObserves the right sidebar and re-places on the next two animation frames after the article class changes. When the article\'s right edge is within 8px of the viewport, the overlay `right` inset is 0.\n- **Library portal** — the drawer mounts on `document.body` (fixed, 320px, 14px) so it is not scaled by `.pxd-world`. Items are opaque `#f5f8fa` / `#182026`. Empty search hides `roam/js/` and `roam/css` pages.\n- **Nested crumbs** — opening a nested board pushes the parent onto a crumb stack (`Parent › Current`). Clicking a crumb opens that block (or page). Nested cards show the parsed name; unnamed boards get an inline "Name this board…" field.\n- **Connect to empty** — dragging a handle onto empty board creates a card at the drop point, links it, and enters edit (Heptabase pull-from-port). Handles are 14px. An existing edge is kept if you connect the same pair again.\n- **Review pack** — nested open passes parent uid explicitly; nest stack truncates on multi-level back; drop parsing no longer treats incidental 9-char tokens as block refs; connect failures do not leave dangling edges; nested name timers clear on repaint and dispose.\n\n## 0.4.1 — 2026-08-28\n\n- **Pending-changes patch** — layout persist no longer delete-all/recreates the metadata tree. Existing diagram blocks are patched in place: only changed `pos::` / `size::` / `color::` / edge / section rows are written, identical strings are skipped, and gone ids are the only deletes. Viewport persist is still the one-line `setViewport` path.\n- **Article-pane fullscreen** — fullscreen follows `.rm-article-wrapper` (below the topbar, inset with the left sidebar) instead of `sidebar.right`. ResizeObserver on the article and sidebar plus a class MutationObserver re-place the overlay when the sidebar opens or closes. Drop `[[page]]` / block uid from the sidebar onto the board to add a card.\n- **Visible sections** — sections use a 2px solid border, a light blue fill, `pointer-events: auto`, a default "Section" label, drag, corner resize, and double-click rename.\n- **Opaque library** — the drawer sets its own `#ffffff` / `#1c2127` background so it stays readable when mounted outside `.pxd-root`. Blank titles and `roam/js/` pages are hidden until you search.\n- **Nested overlay** — adding or opening a nested `{{[[diagram]]}}` card registers it as enhanced and opens our overlay fullscreen, not native Empty Roam Diagram. Nested cards show "Nested diagram" instead of the raw macro. Nested open no longer waits on the parent canvas.\n- **Connect hit-testing** — `cardFromPoint` walks `elementsFromPoint` and ignores edge-hit strokes; temp edges are `pointer-events: none`; connect-tool handles stay visible.\n\n## 0.4.0 — 2026-08-28\n\n- **Fullscreen vs breadcrumbs** — fullscreen hides `#roam-breadcrumbs-panel` / `.breadcrumbs-content` only while `body.pxd-has-fullscreen`. The overlay sits below the remaining topbar and to the right of the left sidebar (article fill, not the whole window). Resize recomputes the inset. Inline boards leave breadcrumbs alone.\n- **Scratch-host card editor** — double-click no longer `renderBlock`s the card uid (the hidden native diagram still owns it). Edit mounts on a `pxd:scratch` child of `[[plexus-diagram/metadata]]`, hydrates until MutationObserver-quiet, then a trusted mousedown/mouseup/click. Commit pulls the scratch string onto the card; empty pulls never overwrite known text.\n- **Connection notes** — labels live on the connector (`label::` under `edge A->B`), not as extra cards. Double-click the line or click the midpoint pill. `show-edge-labels` defaults on.\n- **Commands** — palette and slash keep Enhance, Restore, and Fullscreen only. Toolbar is a single nowrap row. `V` / `C` / `N` / `F` when the overlay owns the pointer.\n- **Sync silence on open** — remounting an already-enhanced diagram no longer rewrites `[[plexus-diagram/metadata]]` or `:rf-diagram` viewport props when the stored snapshot already matches.\n- **Viewport-only persist** — pan/zoom/fit writes only the `viewport::` metadata line; node/edge/section children are left intact.\n- **Dirty flags** — initial fit, fullscreen resize, and dispose no longer schedule Roam writes; persist runs only after real user gestures (pan, zoom, drag, Fit, etc.).\n\n## 0.3.2 — 2026-08-28\n\nDouble-clicking a card no longer blanks its text: `setBlockFocusAndSelection` was focusing the outline copy of the same uid (Roam then cleared the overlay mount), and a same-tick `focusout` committed an empty pull. Overlay editors now keep a text fallback until `renderBlock` hydrates, ignore focusout for 1s, and refuse to commit an empty pull over known text. Fullscreen sits below `.rm-topbar` so RoamJS breadcrumbs stay clickable and the Plexus toolbar is not hidden under it.\n\n## 0.3.1 — 2026-08-28\n\nHouse / daily-tab navigation left a `position:fixed` overlay covering the daily notes. Native Maximize unmounts on route change; our mount often survives because the diagram block is still in the outline. `hashchange` / `popstate` now exit fullscreen, drop `--zoomed`, and restore the inline height whenever the open page uid is no longer the diagram. The 250ms reconcile does not do this, so a Fullscreen click on an inline embed is not immediately undone.\n\n## 0.3.0 — 2026-08-28\n\nCanvas rewrite: the board is usable. Imported native React Flow nodes (165×83 on the live graph) are floored to real cards (min 240×140, default 280×160), and a viewport that paints any card under 140px, has zoom below 0.7, or shows no card at all is rejected and replaced by a fit once the root has a size (single card fits at zoom 1.5, centred; fitted viewport persisted once). Pan, wheel zoom, card drag and corner resize touch only CSS (`.pxd-world` transform, one card\'s box, the edges hanging off it) — no `innerHTML` rebuild, no Roam write per pixel; viewport/layout persist on pointer-up and wheel-end with a 150 ms debounce, serialized through one queue per session. Cards render with `renderString`; double-click swaps in the native block editor (`renderBlock`) and blur/Esc commits it back, so Roam chrome no longer paints into every card. `render()` reconciles card elements by uid, so a pull during editing never tears down the caret. Drag from a card\'s connect dots (or any card with the Connect tool) onto another card to link. Double-click empty board adds a card at that point; Card/Nested tool clicks still add. A hint pill explains pan/add/fullscreen on boards with ≤1 card until the first pointer down. Zoomed diagram pages open in fullscreen (`fullscreen-on-zoom`, default on; inline embeds stay inline). Grid lives outside the world and tracks pan/zoom; a live minimap replaces the empty box; toolbar buttons are grouped, high-contrast, with a zoom readout. Dark mode: card and toolbar backgrounds from `--bc-main` / `--bc-menu`, 1px visible borders, 2px `--cl-blue` ring for selection — no tinted fills. `applyPull` keeps in-memory positions, sizes, edges, sections, and viewport (a pull only refreshes content), so a debounced persist can no longer be undone by a concurrent add.\n\n## 0.2.1 — 2026-08-27\n\nFix dead board on zoomed block pages. Navigating to `#/app/<graph>/page/<uid>` destroys the overlay DOM and the MutationObserver never remounted it. A reconcile pass (hashchange/popstate + 250ms interval) now prunes detached views, finds the native canvas — via the dated `block-input-…-body-outline-MM-DD-YYYY-<uid>` suffix or the location hash when ancestors carry no `data-uid` — and remounts the overlay. The pre-paint guard uses `display: none` (React Flow nodes punch through `visibility: hidden` by re-setting `visibility: visible` on themselves) and also hides the native `.rm-diagram-title-panel` and `.react-flow` chrome. Zoomed mounts fill the article (`pxd-mount--zoomed`). Every mount is stamped `data-diagram-uid` and remounts are idempotent per uid.\n\n## 0.2.0 — 2026-08-27\n\nHeptabase-usable overlay: full-bleed board sizing from native diagram (min 560px), horizontal labeled toolbar with zoom/fit/**Fullscreen** (Esc exits; covers the window like native Maximize), empty-canvas pan and cursor-anchored wheel zoom, Roam bullet/ref-count chrome hidden on cards, searchable library drawer that toggles without covering the board, and card titles off by default.\n\n## 0.1.4 — 2026-08-27\n\nSlash/command Enhance was a no-op: typing `/enh` puts the diagram block in edit mode, which unmounts `.rm-diagram`. The command now remembers the uid and waits for the native canvas to remount before overlaying.\n\n## 0.1.3 — 2026-08-27\n\nSlash commands use the same labels as the command palette (Roam Grid pattern), so `/enh` lists **Plexus Diagram: Enhance this diagram**.\n\n## 0.1.2 — 2026-08-27\n\nMetadata writes now generate UIDs before `block.create` / `page.create`. Live roamAlphaAPI returns `undefined` from those calls, so the first enhance was dropping `schema-version::`, `enhanced::`, and node/edge lines. Nested-diagram open uses `roamAlphaAPI.ui.mainWindow.openBlock`.\n\n## 0.1.1 — 2026-08-27\n\nLive-wire fixes against roamAlphaAPI (CDP, Svy graph):\n\n- Fix native hide inversion: `.pxd-native-hidden` now sets `display: none`; pending state uses visibility\n- Use EDN string pull pattern for `data.pull`; strip keyword colons from pull results\n- Generate child block UIDs via `util.generateUID()`; default create order `"last"`\n- Viewport writes try `roamAlphaAPI.updateBlock` before `data.block.update`\n- Register slash/context commands via `addCommand`/`removeCommand` with live callback shapes\n- Auto-enhance and focus checks pull `[:block/string]` via `roamAlphaAPI.data.pull`\n- Find native diagram hosts via `diagramElForUid` (id suffix, data-uid, block-ref)\n- Library mounts as overlay drawer; queries `roamAlphaAPI.data.q`; filters daily pages by UID\n- Card/Section toolbar tools place items at click position; library uses viewport center\n- Default `restore-native-on-unload` to false; unload disposes sessions without deleting metadata\n\n## 0.1.0 — 2026-08-27\n\nInitial release of Plexus Diagram.\n\n- Hide native `.rm-diagram` React Flow renderer for enhanced diagrams and mount a vanilla DOM/SVG canvas overlay\n- Keep Roam diagram children as the canonical card store; persist layout on `[[plexus-diagram/metadata]]`\n- Writable viewport via native `:rf-diagram` props; import native node positions when metadata is absent\n- Heptabase-like toolbar, cards, connectors, sections, library sidebar, and fat settings panel\n- Command palette, slash command, and block context menu integration\n- GitHub Pages developer extension at https://svyk.github.io/plexus-diagram\n';

// src/view/color-picker.js
var DARKER = -0.28;
var LIGHTER = 0.4;
function buildColorPicker(doc, onPick, listen) {
  const box2 = doc.createElement("div");
  box2.className = "pxd-picker";
  const on = (node2, type, fn) => {
    if (listen) listen(node2, type, fn);
    else node2.addEventListener(type, fn);
  };
  const stop = (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  const row2 = (label, colors, named) => {
    const wrap = doc.createElement("div");
    wrap.className = "pxd-picker__row";
    const cap2 = doc.createElement("div");
    cap2.className = "pxd-picker__cap";
    cap2.textContent = label;
    wrap.append(cap2);
    const swatches = doc.createElement("div");
    swatches.className = "pxd-picker__swatches";
    for (const color of colors) {
      if (!color) continue;
      const b = doc.createElement("button");
      b.type = "button";
      b.className = named ? `pxd-swatch pxd-picker__swatch pxd-c-${color}` : "pxd-swatch pxd-picker__swatch";
      b.title = color;
      b.setAttribute("aria-label", color);
      b.setAttribute("data-color", color);
      if (!named) b.style.background = color;
      on(b, "click", (event) => {
        stop(event);
        onPick?.(color);
      });
      swatches.append(b);
    }
    wrap.append(swatches);
    box2.append(wrap);
  };
  row2("Colors", NATIVE_SWATCHES, false);
  row2("Darker", NATIVE_SWATCHES.map((h) => shadeHex(h, DARKER)), false);
  row2("Lighter", NATIVE_SWATCHES.map((h) => shadeHex(h, LIGHTER)), false);
  const hexRow = doc.createElement("div");
  hexRow.className = "pxd-picker__hex";
  const preview = doc.createElement("span");
  preview.className = "pxd-picker__preview";
  const input = doc.createElement("input");
  input.type = "text";
  input.className = "pxd-input pxd-picker__input";
  input.placeholder = "#rrggbb";
  input.setAttribute("aria-label", "Hex color");
  input.spellcheck = false;
  const paint2 = () => {
    const hex = hexColor(input.value);
    preview.style.background = hex || "transparent";
    input.classList.toggle("pxd-picker__input--bad", input.value.trim() !== "" && !hex);
  };
  const commit = () => {
    const hex = hexColor(input.value);
    if (hex) onPick?.(hex);
  };
  on(input, "input", paint2);
  on(input, "change", commit);
  on(input, "keydown", (event) => {
    event.stopPropagation?.();
    if (event.key === "Enter") {
      event.preventDefault?.();
      commit();
    }
  });
  hexRow.append(preview, input);
  box2.append(hexRow);
  row2("Named", PALETTE, true);
  const clear = doc.createElement("button");
  clear.type = "button";
  clear.className = "pxd-btn pxd-picker__clear";
  clear.textContent = "No color";
  clear.setAttribute("aria-label", "No color");
  on(clear, "click", (event) => {
    stop(event);
    onPick?.(null);
  });
  box2.append(clear);
  return box2;
}

// src/view/chrome.js
var CTX_GAP = 12;
var CTX_EDGE_CLEARANCE = 28;
var CTX_MARGIN = 8;
var CTX_MIN_WIDTH = 180;
var TOAST_MS = 6e3;
var MINIMAP_W = 180;
var MINIMAP_H = 120;
var LINK_MODES2 = ["off", "attributes", "all"];
var LINK_LABELS = { off: "Links: Off", attributes: "Links: Attributes", all: "Links: All" };
var LINK_ICONS = { off: "disable", attributes: "inheritance", all: "graph" };
var TOOL_LIST = [
  ["select", "Select", "V", "select"],
  ["hand", "Hand", "H", "hand"],
  ["card", "Card", "N", "new-object"],
  ["text", "Text", "T", "new-text-box"],
  ["section", "Section", "G", "widget"],
  ["board", "Board", "W", "grid-view"],
  ["connect", "Connect", "C", "flows"]
];
var PALETTE_LIST = [
  ["select", "Select", "V", "select"],
  ["hand", "Hand", "H", "hand"],
  ["card", "Card", "N", "new-object"],
  ["text", "Text", "T", "new-text-box"],
  ["sticky", "Sticky", "S", "annotation"],
  ["shape", "Shape", "R", "square"],
  ["section", "Section", "G", "widget"],
  ["board", "Board", "W", "grid-view"],
  ["connect", "Connect", "C", "flows"]
];
var MAX_CRUMBS = 4;
var POPOVER_GAP = 6;
var POPOVER_MARGIN = 8;
var PATTERN_LABELS = { dots: "Dots", lines: "Lines", cross: "Cross", grid: "Grid", plain: "Plain" };
var NOTE_KINDS = ["note", "block", "page"];
function createChrome({ doc = globalThis.document, root, version = "", settings, timers, on = {}, crumbs = [] } = {}) {
  const setting = (k) => typeof settings?.get === "function" ? settings.get(k) : settings?.[k];
  const listeners2 = [];
  const listen = (el2, type, fn, opts) => {
    el2.addEventListener(type, fn, opts);
    listeners2.push(() => el2.removeEventListener(type, fn, opts));
  };
  const el = (tag, cls, parent, text2) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    if (text2 !== void 0) node2.textContent = text2;
    parent?.append(node2);
    return node2;
  };
  const button = (parent, cls, label, title, onClick) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (title) b.title = title;
    const name = String(label || "").trim() || title || "";
    if (name) b.setAttribute("aria-label", name);
    listen(b, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick?.(event);
    });
    listen(b, "pointerdown", (event) => event.stopPropagation());
    listen(b, "dblclick", (event) => event.stopPropagation());
    return b;
  };
  const iconButton = (parent, cls, icon, label, title, onClick) => {
    const b = button(parent, `pxd-iconbtn ${cls}`, "", title || label, onClick);
    b.setAttribute("aria-label", label);
    const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
    i.setAttribute("aria-hidden", "true");
    return b;
  };
  const setIcon = (node2, icon, label, title) => {
    if (label) node2.setAttribute("aria-label", label);
    if (title || label) node2.title = title || label;
    const i = node2.querySelector(".bp3-icon");
    if (i && icon) i.className = `bp3-icon bp3-icon-${icon}`;
  };
  const swatches = (parent, onPick, { key = "color", paper = false } = {}) => {
    const wrap = el("div", "pxd-swatches", parent);
    const none = button(wrap, "pxd-swatch pxd-swatch--none", "", key === "tone" ? "Default" : "No color", () => onPick(null));
    none.dataset[key] = "";
    if (key !== "color") none.setAttribute(`data-${key}`, "");
    if (paper) {
      const p = button(wrap, "pxd-swatch pxd-swatch--paper", "", "Paper", () => onPick("paper"));
      p.dataset[key] = "paper";
      p.setAttribute(`data-${key}`, "paper");
    }
    for (const c of PALETTE) {
      const s = button(wrap, `pxd-swatch pxd-c-${c}`, "", c, () => onPick(c));
      s.dataset[key] = c;
      s.setAttribute(`data-${key}`, c);
    }
    return wrap;
  };
  const stopAll = (node2) => {
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup", "contextmenu"]) {
      listen(node2, type, (event) => event.stopPropagation());
    }
  };
  const toolbar = el("div", "pxd-toolbar pxd-chrome", root);
  stopAll(toolbar);
  const crumbsEl = el("div", "pxd-toolbar__group pxd-crumbs", toolbar);
  let overflow = [];
  let crumbMenu = null;
  const closeCrumbMenu = () => {
    crumbMenu?.remove();
    crumbMenu = null;
  };
  const openCrumbMenu = () => {
    closeCrumbMenu();
    if (!overflow.length) return;
    crumbMenu = el("div", "pxd-crumb-menu", crumbsEl);
    for (const entry of overflow) {
      const b = el("button", "pxd-btn pxd-crumb", crumbMenu, entry.title);
      b.type = "button";
      b.title = entry.title;
      b.setAttribute("aria-label", entry.title);
      b.dataset.index = String(entry.index);
      b.setAttribute("data-index", String(entry.index));
    }
  };
  listen(crumbsEl, "click", (event) => {
    if (event.target?.closest?.(".pxd-crumb__more")) {
      event.preventDefault?.();
      event.stopPropagation();
      if (crumbMenu) closeCrumbMenu();
      else openCrumbMenu();
      return;
    }
    const hit = event.target?.closest?.(".pxd-crumb[data-index]");
    const raw = hit?.dataset?.index ?? hit?.getAttribute?.("data-index");
    if (raw == null) return;
    const index = Number(raw);
    if (!Number.isFinite(index)) return;
    event.preventDefault?.();
    event.stopPropagation();
    closeCrumbMenu();
    on.crumb?.(index);
  });
  listen(root, "pointerdown", (event) => {
    if (!crumbMenu) return;
    if (crumbMenu.contains(event.target)) return;
    if (event.target?.closest?.(".pxd-crumb__more")) return;
    closeCrumbMenu();
  });
  const renderCrumbs = (list) => {
    closeCrumbMenu();
    crumbsEl.replaceChildren();
    overflow = [];
    const items = Array.isArray(list) ? list : [];
    crumbsEl.style.display = items.length < 2 ? "none" : "";
    if (items.length < 2) return;
    const last = items.length - 1;
    let shown = items.map((c, i) => i);
    if (items.length > MAX_CRUMBS) {
      shown = [0, last - 2, last - 1, last];
      overflow = [];
      for (let i = 1; i < last - 2; i += 1) overflow.push({ index: i, title: items[i].title });
    }
    shown.forEach((i, n2) => {
      if (n2 === 1 && overflow.length) {
        const more = el("button", "pxd-crumb__more", crumbsEl, "…");
        more.type = "button";
        more.title = overflow.map((c2) => c2.title).join(" › ");
        more.setAttribute("aria-label", "Hidden boards");
        more.setAttribute("aria-haspopup", "menu");
        el("span", "pxd-crumb__sep", crumbsEl, "›");
      }
      const c = items[i];
      if (i === last) {
        const cur = el("span", "pxd-crumb pxd-crumb--current", crumbsEl, c.title);
        cur.title = c.title;
        return;
      }
      const b = el("button", "pxd-btn pxd-crumb", crumbsEl, c.title);
      b.type = "button";
      b.title = c.title;
      b.setAttribute("aria-label", c.title);
      b.dataset.index = String(i);
      b.setAttribute("data-index", String(i));
      el("span", "pxd-crumb__sep", crumbsEl, "›");
    });
  };
  renderCrumbs(crumbs);
  const toolGroup = el("div", "pxd-toolbar__group", toolbar);
  const toolButtons = /* @__PURE__ */ new Map();
  for (const [id, label, key, icon] of TOOL_LIST) {
    const b = iconButton(toolGroup, "pxd-tool", icon, label, `${label} (${key}). Double-click to lock`, () => on.setTool?.(id, false));
    b.dataset.tool = id;
    b.setAttribute("data-tool", id);
    listen(b, "dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      on.setTool?.(id, true);
    });
    toolButtons.set(id, b);
  }
  const group2 = el("div", "pxd-toolbar__group", toolbar);
  const addBtn = iconButton(group2, "pxd-toolbar__add", "plus", "Add", "Add cards from the graph", () => on.togglePanel?.());
  iconButton(group2, "pxd-toolbar__info", "info-sign", "Info", "Card info (I)", () => on.openInfo?.());
  const linksBtn = iconButton(group2, "pxd-toolbar__links", LINK_ICONS.all, LINK_LABELS.all, "Graph links (L)", () => on.cycleLinks?.());
  const groupView = el("div", "pxd-toolbar__group", toolbar);
  const tableBtn = iconButton(groupView, "pxd-toolbar__table", "th", "Table", "Table view", () => on.toggleTable?.());
  tableBtn.setAttribute("aria-pressed", "false");
  const kanbanBtn = iconButton(groupView, "pxd-toolbar__kanban", "layout-auto", "Kanban", "Kanban view", () => on.toggleKanban?.());
  kanbanBtn.setAttribute("aria-pressed", "false");
  const bgBtn = iconButton(groupView, "pxd-toolbar__bg", "style", "Background", "Background pattern and tone", () => popover.isOpen() ? popover.close() : popover.open());
  const lensBtn = iconButton(groupView, "pxd-toolbar__lens", "tag", "Tags", "Tag lens: keep cards with one tag bright", () => on.toggleLens?.());
  const focusBtn = iconButton(groupView, "pxd-toolbar__focus", "eye-open", "Focus", "Focus mode: fade everything but the selection", () => on.toggleFocus?.());
  iconButton(groupView, "pxd-toolbar__present", "presentation", "Present", "Present this board", () => on.present?.());
  const moreBtn = iconButton(groupView, "pxd-toolbar__more", "more", "More", "More board actions", () => {
    const r = moreBtn.getBoundingClientRect();
    on.openMore?.({ x: r.left, y: r.bottom, w: r.width, h: r.height });
  });
  const group3 = el("div", "pxd-toolbar__group pxd-toolbar__zoom", toolbar);
  iconButton(group3, "pxd-toolbar__zoom-out", "minus", "Zoom out", "Zoom out (Cmd −)", () => on.zoomOut?.());
  const zoomLabel = button(group3, "pxd-toolbar__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  iconButton(group3, "pxd-toolbar__zoom-in", "plus", "Zoom in", "Zoom in (Cmd =)", () => on.zoomIn?.());
  iconButton(group3, "pxd-toolbar__fit", "zoom-to-fit", "Fit", "Fit all (Shift 1)", () => on.fit?.());
  const minimapBtn = iconButton(group3, "pxd-toolbar__minimap", "map", "Minimap", "Toggle minimap", () => on.toggleMinimap?.());
  const editBtn = iconButton(group3, "pxd-toolbar__edit", "edit", "Edit Block", "Edit the diagram block", () => on.editBlock?.());
  const fullBtn = iconButton(group3, "pxd-toolbar__fullscreen", "fullscreen", "Fullscreen", "Fullscreen this board", () => on.toggleFullscreen?.());
  let logEl = null;
  const closeLog = () => {
    logEl?.remove();
    logEl = null;
  };
  const toggleLog = () => {
    if (logEl) {
      closeLog();
      return;
    }
    const ver = String(version || "").replace(/^v/, "");
    const entry = changelogEntry(CHANGELOG_TEXT, ver);
    logEl = el("div", "pxd-changelog pxd-chrome", root);
    logEl.setAttribute("role", "dialog");
    logEl.setAttribute("aria-label", "Changelog");
    el("div", "pxd-changelog__title", logEl, ver ? `v${ver}` : "Changelog");
    el("pre", "pxd-changelog__body", logEl, entry || "No changelog entry for this version.");
    listen(logEl, "pointerdown", (event) => event.stopPropagation());
  };
  const badge = button(toolbar, "pxd-badge", version ? `v${version}` : "", "Show changelog", toggleLog);
  const sync = el("span", "pxd-sync", toolbar);
  sync.title = "Synced";
  const railEl = el("div", "pxd-rail pxd-chrome", root);
  stopAll(railEl);
  railEl.setAttribute("role", "toolbar");
  railEl.setAttribute("aria-label", "Diagram controls");
  const railBtn = (cls, icon, title, fn) => {
    const b = button(railEl, `pxd-rail__btn ${cls}`, "", title, fn);
    b.setAttribute("aria-label", title);
    const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
    i.setAttribute("aria-hidden", "true");
    return b;
  };
  railBtn("pxd-rail__zoom-in", "plus", "zoom in", () => on.zoomIn?.());
  railBtn("pxd-rail__zoom-out", "minus", "zoom out", () => on.zoomOut?.());
  railBtn("pxd-rail__fit", "zoom-to-fit", "fit view", () => on.fit?.());
  const railMinimap = railBtn("pxd-rail__minimap", "eye-open", "Toggle Minimap", () => on.toggleMinimap?.());
  railBtn("pxd-rail__png", "media", "Save PNG", () => on.savePng?.());
  railBtn("pxd-rail__outline", "list", "Open outline in sidebar", () => on.openOutline?.());
  const railEdit = railBtn("pxd-rail__edit", "edit", "Edit Block", () => on.editBlock?.());
  const railFull = railBtn("pxd-rail__fullscreen", "maximize", "Maximize", () => on.toggleFullscreen?.());
  const railExtra = el("div", "pxd-rail__extra", railEl);
  const railZoom = button(railExtra, "pxd-rail__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  const railBadge = button(railExtra, "pxd-badge pxd-rail__badge", version ? `v${version}` : "", "Show changelog", toggleLog);
  const palette = el("div", "pxd-palette pxd-chrome", root);
  const paletteBar = el("div", "pxd-palette__bar", palette);
  const paletteButtons = /* @__PURE__ */ new Map();
  for (const [id, label, key, icon] of PALETTE_LIST) {
    const b = iconButton(paletteBar, "pxd-palette__btn", icon, label, `${label} (${key})`, () => on.setTool?.(id, false));
    b.dataset.tool = id;
    b.setAttribute("data-tool", id);
    listen(b, "dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      on.setTool?.(id, true);
    });
    paletteButtons.set(id, b);
  }
  const applyControls = () => {
    const rail = setting("controls-position") !== "bar";
    root.classList.toggle("pxd-root--rail", rail);
    railEl.style.display = rail ? "" : "none";
    group3.style.display = rail ? "none" : "";
    const showBadge = setting("show-version-badge") !== false;
    badge.style.display = !rail && showBadge ? "" : "none";
    railBadge.style.display = rail && showBadge ? "" : "none";
    palette.style.display = setting("show-palette") === false ? "none" : "";
  };
  applyControls();
  const toolbarApi = {
    el: toolbar,
    setCrumbs: renderCrumbs,
    setTool(tool, locked) {
      for (const [id, b] of toolButtons) {
        b.classList.toggle("pxd-tool--active", id === tool);
        b.classList.toggle("pxd-tool--locked", id === tool && Boolean(locked));
      }
      for (const [id, b] of paletteButtons) {
        b.classList.toggle("pxd-palette__btn--on", id === tool);
        b.classList.toggle("pxd-tool--locked", id === tool && Boolean(locked));
      }
    },
    setZoom(z) {
      const label = `${Math.round((z || 1) * 100)}%`;
      zoomLabel.textContent = label;
      railZoom.textContent = label;
    },
    setLinkMode(mode) {
      const key = LINK_ICONS[mode] ? mode : "all";
      setIcon(linksBtn, LINK_ICONS[key], LINK_LABELS[key], "Graph links (L)");
    },
    setSync(pending) {
      const name = pending === true ? "writing" : pending === false || pending == null ? "idle" : pending;
      const titles = { idle: "Synced", writing: "Saving…", retrying: "Retrying…", failed: "Couldn't save" };
      const state = titles[name] ? name : "idle";
      sync.classList.remove("pxd-sync--pending", "pxd-sync--writing", "pxd-sync--retrying", "pxd-sync--failed");
      if (state === "writing") sync.classList.add("pxd-sync--pending", "pxd-sync--writing");
      else if (state !== "idle") sync.classList.add(`pxd-sync--${state}`);
      sync.title = titles[state];
    },
    setFullscreen(on2) {
      editBtn.style.display = on2 ? "none" : "";
      railEdit.style.display = on2 ? "none" : "";
      setIcon(fullBtn, on2 ? "minimize" : "fullscreen", on2 ? "Exit fullscreen" : "Fullscreen", on2 ? "Exit fullscreen" : "Fullscreen this board");
      fullBtn.classList.toggle("pxd-btn--active", Boolean(on2));
      const title = on2 ? "Minimize" : "Maximize";
      railFull.title = title;
      railFull.setAttribute("aria-label", title);
      const icon = railFull.querySelector(".bp3-icon");
      if (icon) icon.className = `bp3-icon bp3-icon-${on2 ? "minimize" : "maximize"}`;
    },
    applyControls,
    // Called on every panel open/close: a floating context bar re-clears the panel now, not at the next pan.
    setPanel(open) {
      addBtn.classList.toggle("pxd-btn--active", Boolean(open));
      positionCtx();
    },
    setMinimap(open) {
      minimapBtn.classList.toggle("pxd-btn--active", Boolean(open));
      railMinimap.classList.toggle("pxd-btn--active", Boolean(open));
    },
    setFocus(active) {
      focusBtn.classList.toggle("pxd-btn--active", Boolean(active));
    },
    setLens(active) {
      lensBtn.classList.toggle("pxd-btn--active", Boolean(active));
    },
    lensButton: lensBtn,
    setTable(on2) {
      const active = Boolean(on2);
      tableBtn.classList.toggle("pxd-btn--active", active);
      setIcon(tableBtn, active ? "grid-view" : "th", active ? "Board" : "Table", active ? "Board view" : "Table view");
      tableBtn.setAttribute("aria-pressed", active ? "true" : "false");
    },
    setKanban(on2) {
      const active = Boolean(on2);
      kanbanBtn.classList.toggle("pxd-btn--active", active);
      setIcon(kanbanBtn, active ? "grid-view" : "layout-auto", active ? "Board" : "Kanban", active ? "Board view" : "Kanban view");
      kanbanBtn.setAttribute("aria-pressed", active ? "true" : "false");
    },
    setBackground(state) {
      popover.setState(state);
    },
    bgButton: bgBtn
  };
  const popEl = el("div", "pxd-popover pxd-popover--bg pxd-chrome", root);
  popEl.style.display = "none";
  popEl.setAttribute("role", "dialog");
  popEl.setAttribute("aria-label", "Background");
  stopAll(popEl);
  el("div", "pxd-popover__title", popEl, "Background");
  el("div", "pxd-popover__label", popEl, "Pattern");
  const patternSeg = el("div", "pxd-seg pxd-bg__pattern", popEl);
  const patternButtons = /* @__PURE__ */ new Map();
  for (const pattern of BOARD_PATTERNS) {
    const b = button(patternSeg, "pxd-seg__btn", PATTERN_LABELS[pattern] || pattern, PATTERN_LABELS[pattern] || pattern, () => on.setBackground?.({ bg: pattern }));
    b.dataset.value = pattern;
    b.setAttribute("data-value", pattern);
    patternButtons.set(pattern, b);
  }
  el("div", "pxd-popover__label", popEl, "Tone");
  const toneWrap = swatches(popEl, (tone) => on.setBackground?.({ bgColor: tone }), { key: "tone", paper: true });
  toneWrap.classList.add("pxd-bg__tones");
  const popFoot = el("div", "pxd-popover__foot", popEl);
  button(popFoot, "pxd-bg__default", "Use as default", "Use this pattern and tone for every board", () => on.useBackgroundAsDefault?.());
  const resetBtn = button(popFoot, "pxd-bg__reset", "Reset", "Clear this board's override", () => on.setBackground?.({ bg: null, bgColor: null }));
  let bgOffs = [];
  const popover = {
    el: popEl,
    isOpen: () => popEl.style.display !== "none",
    open() {
      if (popover.isOpen()) return;
      popEl.style.display = "";
      const rootRect = root.getBoundingClientRect();
      const b = bgBtn.getBoundingClientRect();
      const w = popEl.offsetWidth || 240;
      const h = popEl.offsetHeight || 200;
      const left = Math.max(POPOVER_MARGIN, Math.min(b.left - rootRect.left, (rootRect.width || 0) - w - POPOVER_MARGIN));
      let top = b.bottom - rootRect.top + POPOVER_GAP;
      if (rootRect.height && top + h > rootRect.height - POPOVER_MARGIN) top = Math.max(POPOVER_MARGIN, rootRect.height - h - POPOVER_MARGIN);
      popEl.style.left = `${Math.round(left)}px`;
      popEl.style.top = `${Math.round(top)}px`;
      bgBtn.classList.add("pxd-btn--active");
      const onDown = (event) => {
        if (popEl.contains(event.target) || bgBtn.contains(event.target)) return;
        popover.close();
      };
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault?.();
        event.stopPropagation?.();
        popover.close();
      };
      doc.addEventListener("pointerdown", onDown, true);
      doc.addEventListener("keydown", onKey, true);
      bgOffs = [() => doc.removeEventListener("pointerdown", onDown, true), () => doc.removeEventListener("keydown", onKey, true)];
    },
    close() {
      bgOffs.splice(0).forEach((off) => off());
      popEl.style.display = "none";
      bgBtn.classList.remove("pxd-btn--active");
    },
    setState({ pattern, tone, override } = {}) {
      bgState = { pattern: pattern ?? null, tone: tone ?? null, override: Boolean(override) };
      for (const [id, b] of patternButtons) b.classList.toggle("pxd-seg__btn--on", id === bgState.pattern);
      for (const s of toneWrap.querySelectorAll(".pxd-swatch")) {
        const value = s.dataset.tone ?? s.getAttribute("data-tone") ?? "";
        s.classList.toggle("pxd-swatch--on", value === (bgState.tone || ""));
      }
      resetBtn.classList.toggle("pxd-bg__reset--idle", !bgState.override);
      popEl.classList.toggle("pxd-popover--override", bgState.override);
    }
  };
  let bgState = { pattern: null, tone: null, override: false };
  popover.setState(bgState);
  const backEl = button(root, "pxd-backtocontent pxd-chrome", "Back to content", "Fit the view back to your cards", () => on.backToContent?.());
  backEl.style.display = "none";
  for (const type of ["pointerup", "wheel", "keydown", "keyup", "contextmenu"]) listen(backEl, type, (event) => event.stopPropagation());
  const backToContent = {
    el: backEl,
    setVisible(visible) {
      backEl.style.display = visible ? "" : "none";
    },
    isVisible: () => backEl.style.display !== "none"
  };
  const ctx = el("div", "pxd-ctx pxd-chrome", root);
  ctx.style.display = "none";
  stopAll(ctx);
  let ctxAnchor = null;
  const buildCtx = (kind, model) => {
    ctx.replaceChildren();
    ctx.dataset.kind = kind;
    ctx.setAttribute("data-kind", kind);
    const row2 = el("div", "pxd-ctx__row", ctx);
    const btn = (cls, icon, label, title, fn) => iconButton(row2, `pxd-ctx__btn ${cls}`, icon, label, title, fn);
    const seg = (cls, options, current2, fn) => {
      const wrap = el("div", `pxd-seg ${cls}`, row2);
      for (const [value, label, title, icon] of options) {
        const b = button(wrap, `pxd-seg__btn${value === current2 ? " pxd-seg__btn--on" : ""}${icon ? " pxd-iconbtn" : ""}`, icon ? "" : label, title || label, () => fn(value));
        if (icon) {
          b.setAttribute("aria-label", title || label);
          const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
          i.setAttribute("aria-hidden", "true");
        }
        b.dataset.value = String(value);
      }
      return wrap;
    };
    const opt = (name, cls, icon, label, title, fn) => {
      if (typeof on[name] === "function") btn(cls, icon, label, title, fn);
    };
    const optSeg = (name, cls, options, fn) => {
      if (typeof on[name] === "function") seg(cls, options, null, fn);
    };
    const pinButton = (pinned) => opt("pin", "pxd-ctx__pin-toggle", pinned ? "unpin" : "pin", pinned ? "Unpin" : "Pin", pinned ? "Unpin: allow moving and resizing again" : "Pin: lock position and size", () => on.pin(!pinned));
    const TIDY = [["grid", "Grid", "Tidy into a grid", "grid"], ["row", "Row", "Tidy into a row", "drag-handle-horizontal"], ["column", "Column", "Tidy into a column", "drag-handle-vertical"]];
    const iconBtn = (cls, icon, label, title, fn) => btn(cls, icon, label, title, fn);
    switch (kind) {
      case "card":
      case "cards": {
        if (kind === "card") {
          const picker = el("div", "pxd-ctx__picker", ctx);
          picker.style.display = "none";
          let pickerBuilt = false;
          iconBtn("pxd-ctx__color", "tint", "Color", "Color", () => {
            if (!pickerBuilt) {
              picker.append(buildColorPicker(doc, (c) => {
                on.setColor?.(c);
                picker.style.display = "none";
              }, listen));
              pickerBuilt = true;
            }
            picker.style.display = picker.style.display === "none" ? "" : "none";
          });
          const closed = model?.kind === "note" || model?.kind === "block" ? !model?.kids : model?.open === false;
          iconBtn(
            "pxd-ctx__expand",
            closed ? "expand-all" : "collapse-all",
            closed ? "Expand children" : "Collapse children",
            closed ? "Show children" : "Hide children",
            () => on.toggleOpen?.()
          );
          const n2 = Number(model?.refs) || 0;
          const refs = iconBtn("pxd-ctx__refs", "link", "References", `${n2} ${n2 === 1 ? "reference" : "references"}`, () => on.showRefs?.());
          el("span", "pxd-ctx__refs-count", refs, String(n2));
        }
        swatches(row2, (c) => on.setColor?.(c));
        if (kind === "card") {
          btn("pxd-ctx__edit", "edit", "Edit", "Edit (Enter)", () => on.edit?.());
          btn("pxd-ctx__sidebar", "panel-stats", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
          btn("pxd-ctx__collapse", model?.collapsed ? "expand-all" : "collapse-all", model?.collapsed ? "Expand" : "Collapse", "Collapse to title", () => on.collapse?.());
          btn("pxd-ctx__related", "diagram-tree", "Related…", "Show related pages and blocks", () => on.related?.());
          pinButton(Boolean(model?.pinned));
          opt("fitHeight", "pxd-ctx__fit-height", "arrows-vertical", "Fit height", "Grow or shrink the card to its text", () => on.fitHeight());
          opt("copyRef", "pxd-ctx__copy-ref", "clipboard", "Copy ref", "Copy a block or page reference", () => on.copyRef());
          opt("duplicate", "pxd-ctx__duplicate", "duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
          opt("sendTo", "pxd-ctx__send-to", "send-to", "Send to board…", "Move into another board", () => on.sendTo());
          if (NOTE_KINDS.includes(model?.kind)) opt("expandOutline", "pxd-ctx__mindmap", "layout-hierarchy", "Mind map", "Expand the children as a mind map", () => on.expandOutline());
          opt("selectSameColor", "pxd-ctx__same-color", "full-circle", "Select same color", "Select every item of this color", () => on.selectSameColor());
          opt("selectConnected", "pxd-ctx__connected", "flows", "Select connected", "Select items linked to this one", () => on.selectConnected());
        } else {
          seg("pxd-ctx__align", [["left", "L", "Align left", "alignment-left"], ["center", "C", "Align centers", "alignment-horizontal-center"], ["right", "R", "Align right", "alignment-right"], ["top", "T", "Align top", "alignment-top"], ["middle", "M", "Align middles", "alignment-vertical-center"], ["bottom", "B", "Align bottom", "alignment-bottom"]], null, (v) => on.align?.(v));
          seg("pxd-ctx__distribute", [["h", "H", "Distribute horizontally", "horizontal-distribution"], ["v", "V", "Distribute vertically", "vertical-distribution"]], null, (v) => on.distribute?.(v));
          btn("pxd-ctx__wrap", "group-objects", "Wrap in section", "Wrap in a new section (Cmd G)", () => on.wrap?.());
          btn("pxd-ctx__wrap-board", "folder-new", "Move into new board", "Move the selection into a new nested board", () => on.wrapBoard?.());
          optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
          optSeg("sameSize", "pxd-ctx__same-size", [["width", "W", "Same width"], ["height", "H", "Same height"], ["both", "WH", "Same width and height"]], (v) => on.sameSize(v));
          opt("fold", "pxd-ctx__fold", model?.anyCollapsed ? "expand-all" : "collapse-all", model?.anyCollapsed ? "Unfold" : "Fold", model?.anyCollapsed ? "Expand the collapsed cards" : "Collapse the cards to titles", () => on.fold(!model?.anyCollapsed));
          pinButton(Boolean(model?.allPinned));
          opt("duplicate", "pxd-ctx__duplicate", "duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
        }
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      }
      case "board":
        swatches(row2, (c) => on.setColor?.(c));
        btn("pxd-ctx__open-board", "document-open", "Open", "Open this board (Enter)", () => on.openBoard?.());
        opt("openOwnPage", "pxd-ctx__own-page", "document", "Own page", "Open nested board in its own page", () => on.openOwnPage());
        if (model?.enhanced) btn("pxd-ctx__rename-board", "edit", "Rename board", "Rename the board", () => on.renameBoard?.());
        btn("pxd-ctx__sidebar", "panel-stats", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "section":
        swatches(row2, (c) => on.setColor?.(c));
        btn("pxd-ctx__rename", "edit", "Rename", "Rename (Enter)", () => on.rename?.());
        btn("pxd-ctx__contents", "multi-select", "Select contents", "Select the section's members", () => on.selectContents?.());
        opt("selectAllInSection", "pxd-ctx__all-in-section", "select", "Select all in section", "Select everything inside the section", () => on.selectAllInSection());
        opt("selectSameColor", "pxd-ctx__same-color", "full-circle", "Select same color", "Select every item of this color", () => on.selectSameColor());
        opt("selectConnected", "pxd-ctx__connected", "flows", "Select connected", "Select items linked to this one", () => on.selectConnected());
        opt("collapseSection", "pxd-ctx__collapse-section", model?.collapsed ? "expand-all" : "collapse-all", model?.collapsed ? "Expand" : "Collapse", model?.collapsed ? "Expand the section" : "Collapse to the title", () => on.collapseSection?.());
        opt("sectionNote", "pxd-ctx__section-note", model?.hasNote ? "cross" : "annotation", model?.hasNote ? "Remove note" : "Description", model?.hasNote ? "Remove the section description" : "Add a description line", () => on.sectionNote?.());
        opt("lockSection", "pxd-ctx__lock", model?.locked ? "unlock" : "lock", model?.locked ? "Unlock" : "Lock", model?.locked ? "Unpin everything inside" : "Pin the section and everything inside", () => on.lockSection?.(!model?.locked));
        opt("presentSection", "pxd-ctx__present-section", "presentation", "Present", "Present this section", () => on.presentSection?.());
        opt("fitSection", "pxd-ctx__fit-section", "zoom-to-fit", "Fit to contents", "Resize the section around its cards", () => on.fitSection());
        opt("toggleFit", "pxd-ctx__auto-fit", "automatic-updates", model?.autofit ? "Auto-fit: on" : "Auto-fit: off", "Keep the section sized to its cards", () => on.toggleFit());
        optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
        opt("foldAll", "pxd-ctx__fold-all", "collapse-all", "Fold all", "Collapse every card in the section", () => on.foldAll(true));
        pinButton(Boolean(model?.pinned));
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete frame", "Delete the frame, keep the cards (Del). Shift+Del deletes contents too", () => on.delete?.());
        break;
      case "text":
        swatches(row2, (c) => on.setColor?.(c));
        seg("pxd-ctx__size", FONT_SIZES.map((s, i) => [s, ["S", "M", "L", "XL"][i], `${s}px`]), model?.fontSize || 24, (v) => on.setFontSize?.(v));
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "edge":
        seg("pxd-ctx__dir", [["one", "→", "One way"], ["two", "↔", "Two way"], ["none", "—", "No arrow"]], model?.dir, (v) => on.edgeDir?.(v));
        btn("pxd-ctx__flip", "swap-horizontal", "Flip", "Swap endpoints", () => on.flip?.());
        if (model?.fromBlock || model?.toBlock) btn("pxd-ctx__unblock", "document", "Page", "Connect to the page instead of a block", () => on.unblock?.());
        seg("pxd-ctx__route", [["curve", "Curve", "Curve", "path"], ["straight", "Straight", "Straight", "flow-linear"], ["elbow", "Elbow", "Elbow", "step-chart"]], model?.route, (v) => on.route?.(v));
        seg("pxd-ctx__dash", [["solid", "Solid", "Solid", "minus"], ["dashed", "Dashed", "Dashed", "slash"], ["animated", "Animated", "Animated", "pulse"]], model?.dash, (v) => on.dash?.(v));
        seg("pxd-ctx__weight", [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], model?.weight, (v) => on.weight?.(v));
        swatches(row2, (c) => on.setColor?.(c));
        btn("pxd-ctx__label", "tag", "Label", "Edit the label", () => on.label?.());
        btn("pxd-ctx__notes", "annotation", "Notes", "Open the connection block in the sidebar", () => on.notes?.());
        btn("pxd-ctx__write", "inheritance", "Write to graph", "Create an attribute on the source", () => on.writeToGraph?.());
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "link": {
        const list = el("div", "pxd-ctx__sources", row2);
        for (const s of model?.sources || []) {
          const b = button(list, "pxd-ctx__source", (s.string || s.uid || "").slice(0, 60), "Open in the sidebar", () => on.openSource?.(s.uid));
          b.dataset.uid = s.uid;
        }
        btn("pxd-ctx__pin", "new-link", "Pin as connection", "Create a board connection from this link", () => on.pinLink?.());
        break;
      }
      default:
        break;
    }
  };
  const positionCtx = () => {
    if (ctx.style.display === "none" || !ctxAnchor) return;
    const a = ctxAnchor();
    if (!a) {
      ctx.style.display = "none";
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const W = rootRect.width || 0;
    const H = rootRect.height || 0;
    const gap = a.kind === "edge" ? CTX_EDGE_CLEARANCE : CTX_GAP;
    const tb = toolbar.getBoundingClientRect();
    const propsEl = root.querySelector?.(".pxd-props");
    const propsBox = propsEl ? propsEl.getBoundingClientRect() : null;
    const propsRight = propsBox?.width ? propsBox.right - (rootRect.left || 0) : 0;
    const propsBot = propsBox?.height ? propsBox.bottom - (rootRect.top || 0) : 0;
    const topLimit = tb.height ? Math.max(CTX_MARGIN, tb.bottom - (rootRect.top || 0) + CTX_MARGIN) : CTX_MARGIN;
    const railBox = railEl.style.display !== "none" ? railEl.getBoundingClientRect() : null;
    const railClear = railBox?.width ? Math.max(0, rootRect.right - railBox.left) : 0;
    const panelEl = root.querySelector?.(".pxd-panel");
    const pr = panelEl && panelEl.style?.display !== "none" ? panelEl.getBoundingClientRect() : null;
    const room = pr?.width ? Math.min(W, pr.left - (rootRect.left || 0)) : W;
    ctx.style.maxWidth = pr?.width && room > 0 ? `${Math.max(CTX_MIN_WIDTH, Math.round(room - 2 * CTX_MARGIN))}px` : "";
    const barW = ctx.offsetWidth || 320;
    const barH = ctx.offsetHeight || 36;
    const rightLimit = pr?.width ? Math.max(barW + CTX_MARGIN, room) : Math.max(barW + CTX_MARGIN, W - railClear);
    let top = a.rect.y - gap - barH;
    if (top < topLimit) top = a.rect.y + a.rect.h + gap;
    if (top + barH > H - CTX_MARGIN && a.rect.y - gap - barH >= topLimit) top = a.rect.y - gap - barH;
    top = Math.max(top, topLimit);
    let left = a.rect.x + a.rect.w / 2 - barW / 2;
    left = Math.max(CTX_MARGIN, Math.min(left, rightLimit - barW - CTX_MARGIN));
    if (propsBox?.height && left < propsRight && top < propsBot) {
      const below = propsBot + CTX_MARGIN;
      if (below + barH <= H - CTX_MARGIN) top = Math.max(top, below);
      else left = Math.max(left, propsRight + CTX_MARGIN);
    }
    ctx.style.left = `${Math.round(left)}px`;
    ctx.style.top = `${Math.round(top)}px`;
    ctx.classList.toggle("pxd-ctx--below", top > a.rect.y);
  };
  const ctxApi = {
    el: ctx,
    show(kind, model, anchor) {
      buildCtx(kind, model);
      ctxAnchor = anchor;
      ctx.style.display = "";
      positionCtx();
    },
    hide() {
      ctx.style.display = "none";
      ctxAnchor = null;
      ctx.replaceChildren();
    },
    reposition: positionCtx,
    isOpen: () => ctx.style.display !== "none"
  };
  const toast = el("div", "pxd-toast pxd-chrome", root);
  toast.style.display = "none";
  stopAll(toast);
  let toastTimer = null;
  const toastApi = {
    el: toast,
    show({ message, action } = {}) {
      toast.replaceChildren();
      el("span", "pxd-toast__text", toast, message || "");
      if (action?.label) {
        button(toast, "pxd-toast__action", action.label, action.label, () => {
          action.run?.();
          toastApi.hide();
        });
      }
      toast.style.display = "";
      toastTimer?.();
      toastTimer = timers.later(() => toastApi.hide(), TOAST_MS);
    },
    hide() {
      toast.style.display = "none";
      toastTimer?.();
      toastTimer = null;
    }
  };
  const search = el("div", "pxd-search pxd-chrome", root);
  search.style.display = "none";
  stopAll(search);
  const searchInput = el("input", "pxd-input pxd-search__input", search);
  searchInput.type = "text";
  searchInput.setAttribute("aria-label", "Search this board");
  searchInput.placeholder = "Search this board…";
  searchInput.setAttribute("placeholder", "Search this board…");
  const searchCount = el("span", "pxd-search__count", search, "");
  listen(searchInput, "input", () => {
    const n2 = on.searchFilter?.(searchInput.value || "") ?? 0;
    searchCount.textContent = searchInput.value ? `${n2}` : "";
  });
  listen(searchInput, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      on.searchNext?.(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchApi.close();
    }
  });
  const searchApi = {
    el: search,
    open() {
      search.style.display = "";
      try {
        searchInput.focus({ preventScroll: true });
      } catch {
        searchInput.focus?.();
      }
      searchInput.select?.();
    },
    close() {
      search.style.display = "none";
      searchInput.value = "";
      searchCount.textContent = "";
      on.searchFilter?.("");
      on.searchClosed?.();
    },
    isOpen: () => search.style.display !== "none"
  };
  const minimap = el("div", "pxd-minimap pxd-chrome", root);
  stopAll(minimap);
  const canvas = el("canvas", "pxd-minimap__canvas", minimap);
  canvas.width = MINIMAP_W;
  canvas.height = MINIMAP_H;
  let mmDirty = true;
  let mmFrame = null;
  let mmState = null;
  let mmScale = null;
  const computeScale = (rects, size, vp) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (r) => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    };
    for (const r of rects.values()) add(r);
    const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: size.width / vp.zoom, h: size.height / vp.zoom };
    add(view);
    if (!Number.isFinite(minX)) return null;
    const pad2 = 40;
    minX -= pad2;
    minY -= pad2;
    maxX += pad2;
    maxY += pad2;
    const s = Math.min(MINIMAP_W / (maxX - minX), MINIMAP_H / (maxY - minY));
    return { s, ox: (MINIMAP_W - (maxX - minX) * s) / 2 - minX * s, oy: (MINIMAP_H - (maxY - minY) * s) / 2 - minY * s, view };
  };
  const draw = () => {
    mmFrame = null;
    if (!mmDirty || !mmState || minimap.style.display === "none") return;
    mmDirty = false;
    const { board: board2, rects, vp, size } = mmState;
    const g = canvas.getContext?.("2d");
    if (!g) return;
    const sc = computeScale(rects, size, vp);
    mmScale = sc;
    g.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    if (!sc) return;
    const colors = mmColors();
    for (const uid of board2.order) {
      const item = board2.items.get(uid);
      const r = rects.get(uid);
      if (!r) continue;
      g.fillStyle = item.type === "section" ? colors.section : colors.item;
      g.fillRect(r.x * sc.s + sc.ox, r.y * sc.s + sc.oy, Math.max(1, r.w * sc.s), Math.max(1, r.h * sc.s));
    }
    g.strokeStyle = colors.frame;
    g.lineWidth = 1;
    g.strokeRect(sc.view.x * sc.s + sc.ox, sc.view.y * sc.s + sc.oy, sc.view.w * sc.s, sc.view.h * sc.s);
  };
  const mmColors = () => {
    const dark = root.classList.contains("pxd-root--dark");
    return dark ? { item: "rgba(200, 210, 220, 0.6)", section: "rgba(120, 140, 160, 0.35)", frame: "#2dd4bf" } : { item: "rgba(60, 80, 100, 0.55)", section: "rgba(60, 80, 100, 0.2)", frame: "#0d9488" };
  };
  const navigateTo = (event) => {
    if (!mmScale || !mmState) return;
    const r = canvas.getBoundingClientRect();
    const px = event.clientX - r.left - mmScale.ox;
    const py = event.clientY - r.top - mmScale.oy;
    const world = { x: px / mmScale.s, y: py / mmScale.s };
    on.navigate?.(world);
  };
  let mmDragging = false;
  listen(canvas, "pointerdown", (event) => {
    event.stopPropagation();
    mmDragging = true;
    navigateTo(event);
  });
  listen(canvas, "pointermove", (event) => {
    if (mmDragging) navigateTo(event);
  });
  const stopDrag = () => {
    mmDragging = false;
  };
  listen(canvas, "pointerup", stopDrag);
  listen(canvas, "pointerleave", stopDrag);
  const minimapApi = {
    el: minimap,
    // Called from inside the view's render frame: draw now, no extra rAF.
    update(state) {
      mmState = state;
      mmDirty = true;
      if (minimap.style.display !== "none") draw();
    },
    setVisible(on2) {
      minimap.style.display = on2 ? "" : "none";
      palette.classList.toggle("pxd-palette--wide", !on2);
      toolbarApi.setMinimap(on2);
      if (on2) {
        mmDirty = true;
        if (!mmFrame) mmFrame = timers.frame(draw);
      }
    },
    isVisible: () => minimap.style.display !== "none",
    draw
  };
  const dispose = () => {
    toastTimer?.();
    mmFrame?.();
    bgOffs.splice(0).forEach((off) => off());
    listeners2.splice(0).forEach((off) => off());
    for (const node2 of [toolbar, railEl, palette, popEl, backEl, ctx, toast, search, minimap]) node2.remove();
  };
  return { toolbar: toolbarApi, ctx: ctxApi, toast: toastApi, search: searchApi, minimap: minimapApi, popover, changelog: { isOpen: () => Boolean(logEl), close: closeLog }, backToContent, badge, sync, dispose };
}

// src/view/empty-hint.js
var EMPTY_HINT = "Double-click to add a block · drag bullets from the outline · press ? for shortcuts";
function boardIsEmpty(board2) {
  return (board2?.items?.size || 0) === 0;
}
function syncEmptyHint(node2, board2) {
  if (!node2) return false;
  const show = boardIsEmpty(board2);
  node2.hidden = !show;
  if (show) {
    node2.removeAttribute?.("hidden");
    if (node2.textContent !== EMPTY_HINT) node2.textContent = EMPTY_HINT;
  } else node2.setAttribute?.("hidden", "");
  return show;
}

// src/view/motion.js
var MOTION_LEVELS = Object.freeze(["full", "reduced", "none"]);
var MOTION_PROFILE = Object.freeze({
  full: Object.freeze({ zoomMs: 180, presentMs: 160, pulseMs: 1800, edges: true }),
  reduced: Object.freeze({ zoomMs: 70, presentMs: 60, pulseMs: 400, edges: false }),
  none: Object.freeze({ zoomMs: 0, presentMs: 0, pulseMs: 0, edges: false })
});
function resolveMotion(value, prefersReduced = false) {
  const level = MOTION_LEVELS.includes(value) ? value : "full";
  if (level === "none") return "none";
  if (level === "reduced" || prefersReduced) return "reduced";
  return "full";
}
function motionProfile(level) {
  return MOTION_PROFILE[level] || MOTION_PROFILE.full;
}
function applyMotionClasses(root, level) {
  const resolved = MOTION_LEVELS.includes(level) ? level : "full";
  const profile = motionProfile(resolved);
  root.classList.toggle("pxd-root--motion-off", resolved !== "full");
  root.classList.toggle("pxd-root--motion-reduced", resolved === "reduced");
  root.classList.toggle("pxd-root--motion-none", resolved === "none");
  if (root.dataset) root.dataset.motion = resolved;
  root.style?.setProperty?.("--pxd-zoom-ms", `${profile.zoomMs}ms`);
  root.style?.setProperty?.("--pxd-present-ms", `${profile.presentMs}ms`);
  root.style?.setProperty?.("--pxd-pulse-ms", `${profile.pulseMs}ms`);
  return profile;
}

// src/model/table.js
var FIXED = ["Title", "Section", "Type", "Edited"];
function cleanName(name) {
  if (name == null) return "";
  const attr = String(name).trim();
  if (!attr || attr.startsWith("BT_attr") || FIXED.includes(attr)) return "";
  return attr;
}
function columnNameOk(name) {
  return Boolean(cleanName(name));
}
function isTableRow(item) {
  if (!item) return false;
  if (item.type === "section" || item.type === "text") return false;
  if (item.type === "card") return true;
  return item.kind === "card" || item.kind === "board";
}
function tableColumns(rows) {
  const names = [];
  for (const row2 of rows || []) {
    for (const attr of row2.attrs || []) {
      if (attr?.name && !names.includes(attr.name)) names.push(attr.name);
    }
  }
  return FIXED.concat(names);
}
function cellText(row2, column) {
  if (!row2) return "";
  if (column === "Title") return String(row2.title ?? "");
  if (column === "Section") return String(row2.section ?? "");
  if (column === "Type") return String(row2.type ?? "");
  if (column === "Edited") return row2.edited == null ? "" : String(row2.edited);
  const hit = (row2.attrs || []).find((attr) => attr.name === column);
  return hit ? String(hit.value ?? "") : "";
}
function filterRows(rows, text2) {
  const needle = String(text2 ?? "").trim().toLowerCase();
  if (!needle) return (rows || []).slice();
  const cols = tableColumns(rows);
  return (rows || []).filter((row2) => cols.some((column) => cellText(row2, column).toLowerCase().includes(needle)));
}
function sortRows(rows, column, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  const list = (rows || []).slice();
  list.sort((a, b) => {
    if (column === "Edited") {
      const av = Number(a.edited) || 0;
      const bv = Number(b.edited) || 0;
      return (av - bv) * sign;
    }
    return cellText(a, column).localeCompare(cellText(b, column)) * sign;
  });
  return list;
}
function planAttrCell({ name, value, blockUid: blockUid2 = null, parentUid = null } = {}) {
  const attr = cleanName(name);
  if (!attr) return null;
  const text2 = String(value ?? "").trim();
  const string = text2 ? `${attr}:: ${text2}` : `${attr}::`;
  if (blockUid2) return { op: "update", uid: blockUid2, string };
  if (!text2 || !parentUid) return null;
  return { op: "create", parent: parentUid, string };
}
function tableRows(board2) {
  const items = board2?.items;
  if (!items || typeof items.get !== "function") return [];
  const order = Array.isArray(board2.order) ? board2.order : [...items.keys()];
  const rows = [];
  for (const uid of order) {
    const item = items.get(uid);
    if (!isTableRow(item)) continue;
    const parent = items.get(item.parentUid);
    const section2 = parent?.type === "section" ? String(parent.title || "") : "";
    const attrs = [];
    for (const child of item.content || []) {
      const string = child?.[":block/string"] ?? child?.string ?? "";
      const name = cleanName(attrNameOf(String(string)));
      if (!name) continue;
      const text2 = String(string);
      const cut = text2.indexOf("::");
      attrs.push({
        name,
        value: cut >= 0 ? text2.slice(cut + 2).trim() : "",
        uid: child?.[":block/uid"] ?? child?.uid ?? null
      });
    }
    rows.push({
      uid: item.uid,
      kind: item.kind,
      title: item.title || "",
      section: section2,
      type: item.kind || "",
      edited: item.edited ?? null,
      attrs
    });
  }
  return rows;
}

// src/view/table-view.js
var EDITED_QUERY = "[:find ?u ?e :in $ [?u ...] :where [?b :block/uid ?u] [?b :edit/time ?e]]";
function editedLabel(value) {
  const n2 = Number(value);
  if (!Number.isFinite(n2) || n2 <= 0) return "";
  if (n2 < 1e11) return String(n2);
  try {
    const d = new Date(n2);
    return Number.isNaN(d.getTime()) ? String(n2) : d.toLocaleString();
  } catch {
    return String(n2);
  }
}
function mountTable({ doc = globalThis.document, root, host, getBoard } = {}) {
  const box2 = doc.createElement("div");
  box2.className = "pxd-table pxd-chrome";
  root?.append(box2);
  const bar = doc.createElement("div");
  bar.className = "pxd-table__bar";
  box2.append(bar);
  const filter = doc.createElement("input");
  filter.type = "text";
  filter.className = "pxd-input pxd-table__filter";
  filter.placeholder = "Filter";
  filter.setAttribute("aria-label", "Filter rows");
  bar.append(filter);
  const colName = doc.createElement("input");
  colName.type = "text";
  colName.className = "pxd-input pxd-table__colname";
  colName.placeholder = "Column name";
  colName.setAttribute("aria-label", "New column name");
  bar.append(colName);
  const addBtn = doc.createElement("button");
  addBtn.type = "button";
  addBtn.className = "pxd-btn pxd-table__add";
  addBtn.textContent = "Add column";
  addBtn.setAttribute("aria-label", "Add column");
  bar.append(addBtn);
  const grid = doc.createElement("table");
  grid.className = "pxd-table__grid";
  const thead = doc.createElement("thead");
  const tbody = doc.createElement("tbody");
  grid.append(thead, tbody);
  box2.append(grid);
  const offs = [];
  const paintOffs = [];
  const listen = (el, type, fn, bucket = offs) => {
    el.addEventListener(type, fn);
    bucket.push(() => el.removeEventListener(type, fn));
  };
  const stop = (event) => event.stopPropagation();
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(box2, type, stop);
  }
  let open = false;
  let filterText = "";
  let sortColumn = null;
  let sortDir = "asc";
  const pending = [];
  const filled = /* @__PURE__ */ new Map();
  const inflight = /* @__PURE__ */ new Set();
  const edited = /* @__PURE__ */ new Map();
  let paintQueued = false;
  const editing = () => {
    const active = doc.activeElement;
    return Boolean(active && box2.contains(active) && active.closest?.(".pxd-table__edit"));
  };
  const closeEditors = () => {
    for (const cell of [...box2.querySelectorAll(".pxd-table__edit")]) {
      try {
        host?.unmount?.(cell);
      } catch {
      }
      cell.classList.remove("pxd-table__edit");
    }
  };
  const sourceRows = () => {
    const rows = tableRows(getBoard?.() || null);
    const missing = rows.map((row2) => row2.uid).filter((uid) => !edited.has(uid));
    if (missing.length && typeof host?.q === "function") {
      let found = [];
      try {
        found = host.q(EDITED_QUERY, missing) || [];
      } catch {
        found = [];
      }
      for (const hit of found) {
        if (Array.isArray(hit) && hit.length >= 2) edited.set(hit[0], hit[1]);
      }
    }
    for (const row2 of rows) {
      if (edited.has(row2.uid)) row2.edited = edited.get(row2.uid);
      for (const attr of row2.attrs || []) filled.delete(`${row2.uid}\0${attr.name}`);
    }
    return rows;
  };
  const columnsOf = (rows) => {
    const cols = tableColumns(rows);
    for (const name of pending) if (!cols.includes(name)) cols.push(name);
    return cols;
  };
  const shownRows = (rows) => {
    const filtered = filterRows(rows, filterText);
    return sortColumn ? sortRows(filtered, sortColumn, sortDir) : filtered;
  };
  const commitFill = async (row2, column, raw) => {
    const key = `${row2.uid}\0${column}`;
    if (inflight.has(key) || filled.has(key)) return;
    const plan = planAttrCell({ name: column, value: raw, parentUid: row2.uid });
    if (!plan || plan.op !== "create") return;
    if (typeof host?.createBlock !== "function") return;
    inflight.add(key);
    try {
      const write = () => host.createBlock({ parentUid: plan.parent, order: "last", string: plan.string });
      if (typeof host.group === "function") await host.group(write);
      else await write();
      filled.set(key, String(raw).trim());
    } catch {
    } finally {
      inflight.delete(key);
    }
    paint2();
  };
  const openEditor = (cell, blockUid2) => {
    if (!blockUid2 || typeof host?.renderBlock !== "function") return;
    closeEditors();
    cell.classList.add("pxd-table__edit");
    cell.replaceChildren();
    try {
      host.renderBlock(cell, blockUid2);
    } catch {
    }
  };
  const paint2 = () => {
    if (!open) return;
    if (editing()) {
      paintQueued = true;
      return;
    }
    paintQueued = false;
    paintOffs.splice(0).forEach((off) => off());
    const rows = sourceRows();
    const cols = columnsOf(rows);
    const body = shownRows(rows);
    thead.replaceChildren();
    const head = doc.createElement("tr");
    for (const column of cols) {
      const th = doc.createElement("th");
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "pxd-btn pxd-table__sort";
      button.setAttribute("data-col", column);
      const mark = sortColumn === column ? sortDir === "desc" ? " ↓" : " ↑" : "";
      button.textContent = `${column}${mark}`;
      button.setAttribute("aria-label", `Sort by ${column}`);
      listen(button, "click", () => {
        if (sortColumn === column) sortDir = sortDir === "asc" ? "desc" : "asc";
        else {
          sortColumn = column;
          sortDir = "asc";
        }
        paint2();
      }, paintOffs);
      th.append(button);
      head.append(th);
    }
    thead.append(head);
    tbody.replaceChildren();
    for (const row2 of body) {
      const tr = doc.createElement("tr");
      tr.className = "pxd-table__row";
      tr.setAttribute("data-uid", row2.uid);
      for (const column of cols) {
        const td = doc.createElement("td");
        td.className = "pxd-table__cell";
        td.setAttribute("data-col", column);
        const attr = (row2.attrs || []).find((item) => item.name === column);
        const pendingValue = filled.get(`${row2.uid}\0${column}`);
        if (attr?.uid) {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "pxd-btn pxd-table__value";
          button.textContent = cellText(row2, column);
          button.setAttribute("aria-label", `${column} for ${row2.title || row2.uid}`);
          listen(button, "click", () => openEditor(td, attr.uid), paintOffs);
          td.append(button);
        } else if (pendingValue != null) {
          const span = doc.createElement("span");
          span.className = "pxd-table__text";
          span.textContent = pendingValue;
          td.append(span);
        } else if (column !== "Title" && column !== "Section" && column !== "Type" && column !== "Edited") {
          const input = doc.createElement("input");
          input.type = "text";
          input.className = "pxd-input pxd-table__fill";
          input.setAttribute("aria-label", `${column} for ${row2.title || row2.uid}`);
          const commit = () => {
            void commitFill(row2, column, input.value);
          };
          listen(input, "keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit();
          }, paintOffs);
          listen(input, "blur", commit, paintOffs);
          td.append(input);
        } else {
          const span = doc.createElement("span");
          span.className = "pxd-table__text";
          span.textContent = column === "Edited" ? editedLabel(row2.edited) : cellText(row2, column);
          td.append(span);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
  };
  listen(filter, "input", () => {
    filterText = filter.value;
    paint2();
  });
  const addColumn = () => {
    const name = colName.value.trim();
    if (!columnNameOk(name)) return;
    const rows = sourceRows();
    if (!tableColumns(rows).includes(name) && !pending.includes(name)) pending.push(name);
    colName.value = "";
    paint2();
  };
  listen(addBtn, "click", addColumn);
  listen(colName, "keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addColumn();
  });
  listen(box2, "focusout", () => {
    if (!paintQueued) return;
    const later = () => {
      if (open && paintQueued && !editing()) paint2();
    };
    if (typeof doc.defaultView?.setTimeout === "function") doc.defaultView.setTimeout(later, 0);
    else later();
  });
  const place = () => {
    const toolbar2 = root?.querySelector?.(".pxd-toolbar");
    if (!toolbar2 || typeof toolbar2.getBoundingClientRect !== "function" || typeof root.getBoundingClientRect !== "function") return;
    const top = toolbar2.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    if (top > 0) box2.style.top = `${Math.ceil(top)}px`;
  };
  let resizeObs = null;
  const toolbar = root?.querySelector?.(".pxd-toolbar");
  if (toolbar && typeof globalThis.ResizeObserver === "function") {
    resizeObs = new globalThis.ResizeObserver(() => {
      if (open) place();
    });
    resizeObs.observe(toolbar);
  }
  return {
    el: box2,
    open() {
      open = true;
      place();
      paint2();
    },
    close() {
      open = false;
      closeEditors();
    },
    refresh() {
      if (open) paint2();
    },
    dispose() {
      open = false;
      closeEditors();
      try {
        resizeObs?.disconnect();
      } catch {
      }
      paintOffs.splice(0).forEach((off) => off());
      offs.splice(0).forEach((off) => off());
      box2.remove();
    }
  };
}

// src/model/kanban.js
var TODO_FIELD = "To do";
var DONE_COLUMN = "Done";
var MARK = /\{\{\[\[(TODO|DONE)\]\]\}\}/;
function todoState(string) {
  const hit = MARK.exec(String(string || ""));
  if (!hit) return "";
  return hit[1] === "DONE" ? DONE_COLUMN : TODO_FIELD;
}
function kanbanRows(board2) {
  const items = board2?.items;
  return tableRows(board2).map((row2) => {
    const item = items?.get?.(row2.uid);
    return { ...row2, string: item?.string ?? row2.title ?? "" };
  });
}
function kanbanFields(rows) {
  const names = [];
  for (const row2 of rows || []) {
    for (const attr of row2.attrs || []) {
      if (attr?.name && columnNameOk(attr.name) && !names.includes(attr.name)) names.push(attr.name);
    }
  }
  return [TODO_FIELD, ...names];
}
function columnOf(row2, field) {
  if (field === TODO_FIELD) return todoState(row2?.string);
  const hit = (row2?.attrs || []).find((attr) => attr.name === field);
  return hit ? String(hit.value ?? "") : "";
}
function kanbanColumns(rows, field) {
  const list = rows || [];
  if (field === TODO_FIELD) {
    const columns2 = [
      { name: TODO_FIELD, cards: [] },
      { name: DONE_COLUMN, cards: [] }
    ];
    const extra = [];
    for (const row2 of list) {
      const name = columnOf(row2, field);
      if (name === TODO_FIELD) columns2[0].cards.push(row2);
      else if (name === DONE_COLUMN) columns2[1].cards.push(row2);
      else extra.push(row2);
    }
    if (extra.length) columns2.push({ name: "", cards: extra });
    return columns2;
  }
  if (!columnNameOk(field)) return [];
  const columns = [];
  const byName = /* @__PURE__ */ new Map();
  for (const row2 of list) {
    const name = columnOf(row2, field);
    if (!byName.has(name)) {
      const column = { name, cards: [] };
      byName.set(name, column);
      columns.push(column);
    }
    byName.get(name).cards.push(row2);
  }
  return columns;
}
function withMarker(string, column) {
  const mark = column === DONE_COLUMN ? "{{[[DONE]]}}" : "{{[[TODO]]}}";
  const current2 = String(string || "");
  if (MARK.test(current2)) return current2.replace(MARK, mark);
  return current2.trim() ? `${mark} ${current2}` : mark;
}
function planKanbanMove({ field, column, row: row2 } = {}) {
  if (!row2?.uid || column == null || column === "") return null;
  if (field === TODO_FIELD) {
    if (column !== TODO_FIELD && column !== DONE_COLUMN) return null;
    if (todoState(row2.string) === column) return null;
    const string = withMarker(row2.string, column);
    if (string === String(row2.string || "")) return null;
    return { op: "string", uid: row2.uid, string };
  }
  if (!columnNameOk(field)) return null;
  const attr = (row2.attrs || []).find((item) => item.name === field);
  if (String(attr?.value ?? "") === column) return null;
  const plan = planAttrCell({
    name: field,
    value: column,
    blockUid: attr?.uid || null,
    parentUid: row2.uid
  });
  if (!plan) return null;
  if (plan.op === "update") return { op: "string", uid: plan.uid, string: plan.string };
  return plan;
}

// src/view/kanban-view.js
function mountKanban({ doc = globalThis.document, root, host, getBoard } = {}) {
  const box2 = doc.createElement("div");
  box2.className = "pxd-kanban pxd-chrome";
  root?.append(box2);
  const bar = doc.createElement("div");
  bar.className = "pxd-kanban__bar";
  box2.append(bar);
  const label = doc.createElement("span");
  label.className = "pxd-kanban__label";
  label.textContent = "Group by";
  bar.append(label);
  const select = doc.createElement("select");
  select.className = "pxd-kanban__field";
  select.setAttribute("aria-label", "Group by");
  bar.append(select);
  const columnsEl = doc.createElement("div");
  columnsEl.className = "pxd-kanban__columns";
  box2.append(columnsEl);
  const offs = [];
  const paintOffs = [];
  const listen = (el, type, fn, bucket = offs) => {
    el.addEventListener(type, fn);
    bucket.push(() => el.removeEventListener(type, fn));
  };
  const stop = (event) => event.stopPropagation();
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(box2, type, stop);
  }
  let open = false;
  let field = TODO_FIELD;
  let dragUid = null;
  const place = () => {
    const toolbar2 = root?.querySelector?.(".pxd-toolbar");
    if (!toolbar2 || typeof toolbar2.getBoundingClientRect !== "function" || typeof root.getBoundingClientRect !== "function") return;
    const top = toolbar2.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    if (top > 0) box2.style.top = `${Math.ceil(top)}px`;
  };
  const commit = async (plan) => {
    try {
      if (plan.op === "string" && typeof host?.updateString === "function") {
        const write = () => host.updateString(plan.uid, plan.string);
        if (typeof host.group === "function") await host.group(write);
        else await write();
      } else if (plan.op === "create" && typeof host?.createBlock === "function") {
        const write = () => host.createBlock({ parentUid: plan.parent, order: "last", string: plan.string });
        if (typeof host.group === "function") await host.group(write);
        else await write();
      }
    } catch {
    }
    paint2();
  };
  const paint2 = () => {
    if (!open) return;
    paintOffs.splice(0).forEach((off) => off());
    const rows = kanbanRows(getBoard?.() || null);
    const fields = kanbanFields(rows);
    if (!fields.includes(field)) field = TODO_FIELD;
    select.replaceChildren();
    for (const name of fields) {
      const option = doc.createElement("option");
      option.value = name;
      option.textContent = name;
      if (name === field) option.selected = true;
      select.append(option);
    }
    select.value = field;
    columnsEl.replaceChildren();
    for (const column of kanbanColumns(rows, field)) {
      const col = doc.createElement("section");
      col.className = "pxd-kanban__column";
      col.setAttribute("data-column", column.name);
      const title = doc.createElement("h3");
      title.className = "pxd-kanban__heading";
      title.textContent = column.name || "None";
      col.append(title);
      for (const card2 of column.cards) {
        const item = doc.createElement("div");
        item.className = "pxd-kanban__card";
        item.setAttribute("data-uid", card2.uid);
        item.textContent = card2.title || card2.uid;
        listen(item, "pointerdown", (event) => {
          dragUid = card2.uid;
          event.stopPropagation();
        }, paintOffs);
        col.append(item);
      }
      listen(col, "pointerup", () => {
        const uid = dragUid;
        dragUid = null;
        if (!uid || column.name === "") return;
        const row2 = rows.find((item) => item.uid === uid);
        const plan = planKanbanMove({ field, column: column.name, row: row2 });
        if (plan) void commit(plan);
      }, paintOffs);
      columnsEl.append(col);
    }
  };
  listen(select, "change", () => {
    field = select.value || TODO_FIELD;
    paint2();
  });
  let resizeObs = null;
  const toolbar = root?.querySelector?.(".pxd-toolbar");
  if (toolbar && typeof globalThis.ResizeObserver === "function") {
    resizeObs = new globalThis.ResizeObserver(() => {
      if (open) place();
    });
    resizeObs.observe(toolbar);
  }
  return {
    el: box2,
    open() {
      open = true;
      place();
      paint2();
    },
    close() {
      open = false;
      dragUid = null;
    },
    refresh() {
      if (open) paint2();
    },
    dispose() {
      open = false;
      dragUid = null;
      try {
        resizeObs?.disconnect();
      } catch {
      }
      paintOffs.splice(0).forEach((off) => off());
      offs.splice(0).forEach((off) => off());
      box2.remove();
    }
  };
}

// src/view/props-panel.js
var STORAGE_KEY = "pxd-props-collapsed";
var PATTERN_LABELS2 = { dots: "Dots", lines: "Lines", cross: "Cross", grid: "Grid", plain: "Plain" };
var DIR_LABELS = [["one", "Directed"], ["none", "Undirected"], ["two", "Bidirected"]];
var DASH_LABELS = [["solid", "Solid"], ["dashed", "Dashed"], ["animated", "Animated"]];
var ROUTE_LABELS = [["straight", "Straight"], ["elbow", "Smooth step"], ["curve", "Curve"]];
function createPropsPanel({ doc = globalThis.document, root, storage, on = {} } = {}) {
  const listeners2 = [];
  const listen = (el2, type, fn) => {
    el2.addEventListener(type, fn);
    listeners2.push(() => el2.removeEventListener(type, fn));
  };
  const el = (tag, cls, parent, text2) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    if (text2 !== void 0) node2.textContent = text2;
    parent?.append(node2);
    return node2;
  };
  const button = (parent, cls, label, title, fn) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (title) b.title = title;
    const name = String(label || "").trim() || title || "";
    if (name) b.setAttribute("aria-label", name);
    listen(b, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      fn?.(event);
    });
    return b;
  };
  let collapsed = storage?.getItem?.(STORAGE_KEY) === "1";
  const panel = el("div", "pxd-props pxd-chrome", root);
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Properties");
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(panel, type, (event) => event.stopPropagation());
  }
  listen(panel, "keydown", (event) => event.stopPropagation());
  const head = button(panel, "pxd-props__toggle", "Properties", "Properties", () => {
    collapsed = !collapsed;
    storage?.setItem?.(STORAGE_KEY, collapsed ? "1" : "0");
    paintCollapsed();
    place();
  });
  head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const body = el("div", "pxd-props__body", panel);
  const paintCollapsed = () => {
    panel.classList.toggle("pxd-props--collapsed", collapsed);
    body.style.display = collapsed ? "none" : "";
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
  };
  const place = () => {
    const tb = root.querySelector?.(".pxd-toolbar");
    const h = tb?.offsetHeight || 0;
    panel.style.top = `${8 + (h ? h + 6 : 44)}px`;
  };
  const choice = (parent, options, current2, fn) => {
    const wrap = el("div", "pxd-seg pxd-props__choices", parent);
    for (const [value, label] of options) {
      const b = button(wrap, `pxd-seg__btn${value === current2 ? " pxd-seg__btn--on" : ""}`, label, label, () => fn(value));
      b.setAttribute("data-value", value);
    }
    return wrap;
  };
  const stepper = (parent, { value, fallback, min, max, aria, onCommit }) => {
    const shown = Number.isInteger(value) ? value : fallback;
    const row2 = el("div", "pxd-props__step", parent);
    const input = el("input", "pxd-input pxd-props__num", row2);
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(shown);
    input.setAttribute("aria-label", aria);
    const commit = (n2) => {
      const v = Number(n2);
      if (!Number.isInteger(v) || v < min || v > max) {
        input.value = String(shown);
        return;
      }
      onCommit(v);
    };
    const dec = button(row2, "pxd-props__dec", "−", "Smaller", () => commit(shown - 1));
    row2.insertBefore(dec, input);
    button(row2, "pxd-props__inc", "+", "Larger", () => commit(shown + 1));
    listen(input, "change", () => commit(input.value));
    listen(input, "keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        commit(input.value);
      }
    });
  };
  const colorField = (parent, label, value, fn) => {
    const row2 = el("div", "pxd-props__field", parent);
    el("span", "pxd-props__label", row2, label);
    const chip = button(row2, "pxd-props__chip", "", label, () => {
      const open = row2.querySelector(".pxd-picker");
      if (open) {
        open.remove();
        return;
      }
      const picker = buildColorPicker(doc, (c) => fn(c), listen);
      row2.append(picker);
    });
    chip.setAttribute("aria-label", label);
    const sw = el("span", "pxd-props__chip-swatch", chip);
    const painted = value === "paper" ? "#eeeded" : cssColor(value, "fill") || "";
    if (painted) sw.style.background = painted;
    else sw.classList.add("pxd-props__chip-swatch--empty");
  };
  const group = (title, key) => {
    const g = el("section", "pxd-props__group", body);
    g.setAttribute("data-group", key);
    el("h3", "pxd-props__heading", g, title);
    return g;
  };
  const blocks = (items) => {
    const g = group("Blocks", "blocks");
    const cards = items.filter((it) => it.type !== "text");
    const text2 = items.filter((it) => it.type === "text");
    const sample = cards[0] || text2[0];
    const fallback = sample?.type === "text" ? 24 : CARD_FONT_DEFAULT;
    const same = items.every((it) => (it.fontSize ?? fallback) === (sample.fontSize ?? fallback));
    el("span", "pxd-props__label", g, "Text size");
    stepper(g, {
      value: same ? sample.fontSize : void 0,
      fallback,
      min: CARD_FONT_MIN,
      max: CARD_FONT_MAX,
      aria: "Text size",
      onCommit: (v) => on.setItemStyle?.({ fontSize: v })
    });
    colorField(g, "Text color", same ? sample.textColor : void 0, (c) => on.setItemStyle?.({ textColor: c }));
    el("span", "pxd-props__label", g, "Align");
    const align = same ? sample.align || "" : "";
    choice(g, [["", "Default"], ...ALIGNS.map((a) => [a, a[0].toUpperCase() + a.slice(1)])], align, (v) => on.setItemStyle?.({ align: v || null }));
    colorField(g, "Fill", same ? sample.fill : void 0, (c) => on.setItemStyle?.({ fill: c }));
    colorField(g, "Border", same ? sample.border : void 0, (c) => on.setItemStyle?.({ border: c }));
    button(g, "pxd-props__reset", "Reset selected", "Remove text size, color, align, fill, and border", () => on.resetItems?.());
  };
  const edgeGroup = (edge) => {
    const g = group("Connection", "edge");
    el("span", "pxd-props__label", g, "Direction");
    choice(g, DIR_LABELS, DIRS.includes(edge.dir) ? edge.dir : "one", (v) => on.setEdge?.({ dir: v }));
    el("span", "pxd-props__label", g, "Decoration");
    choice(g, DASH_LABELS, edge.dash || "solid", (v) => on.setEdge?.({ dash: v }));
    el("span", "pxd-props__label", g, "Type");
    choice(g, ROUTE_LABELS, ROUTES.includes(edge.route) ? edge.route : "curve", (v) => on.setEdge?.({ route: v }));
    el("span", "pxd-props__label", g, "Weight");
    choice(g, [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], [1, 2, 3, 4].includes(edge.weight) ? edge.weight : 1, (v) => on.setEdge?.({ weight: v }));
    colorField(g, "Color", edge.color, (c) => on.setEdge?.({ color: c }));
    button(g, "pxd-props__reset", "Reset", "Remove direction, decoration, type, weight, and color", () => on.resetEdge?.());
  };
  const sectionGroup = (items, title, key, write, resetLabel, reset) => {
    const g = group(title, key);
    const sample = items[0];
    const defs = key === "group" ? sample.sectionDefaults || {} : {};
    const pick = (field, fallback) => {
      const values = items.map((it) => it[field] ?? defs[field] ?? fallback);
      return values.every((v) => v === values[0]) ? values[0] : void 0;
    };
    el("span", "pxd-props__label", g, "Title size");
    stepper(g, {
      value: sample.titleSize ?? defs.titleSize,
      fallback: SECTION_TITLE_DEFAULT,
      min: SECTION_TITLE_MIN,
      max: SECTION_TITLE_MAX,
      aria: "Title size",
      onCommit: (v) => write({ titleSize: v })
    });
    colorField(g, "Title color", pick("titleColor"), (c) => write({ titleColor: c }));
    colorField(g, "Title fill", pick("titleFill"), (c) => write({ titleFill: c }));
    colorField(g, "Area fill", pick("areaFill"), (c) => write({ areaFill: c }));
    colorField(g, "Border", pick("border"), (c) => write({ border: c }));
    button(g, "pxd-props__reset", resetLabel, resetLabel, reset);
  };
  const defaultsGroup = (board2) => {
    const stored = board2?.defaults?.section || {};
    sectionGroup(
      [{ ...stored, sectionDefaults: {} }],
      "Default groups",
      "defaults",
      (patch) => on.setDefaults?.(patch),
      "Reset default",
      () => on.resetDefaults?.()
    );
  };
  const diagram = (board2) => {
    const g = group("Diagram", "diagram");
    const bg = board2?.plexus || {};
    colorField(g, "Background", bg.bgColor, (c) => on.setBackground?.({ bgColor: c }));
    el("span", "pxd-props__label", g, "Texture");
    const pattern = BOARD_PATTERNS.includes(bg.bg) ? bg.bg : "";
    choice(g, [["", "Default"], ...BOARD_PATTERNS.map((p) => [p, PATTERN_LABELS2[p] || p])], pattern, (v) => on.setBackground?.({ bg: v || null }));
    button(g, "pxd-props__reset", "Reset default", "Clear this board's background", () => on.setBackground?.({ bg: null, bgColor: null }));
  };
  let last = null;
  const refresh = (state) => {
    last = state || last;
    const active = doc.activeElement;
    if (active && panel.contains(active) && String(active.tagName).toLowerCase() === "input") return;
    body.replaceChildren();
    const items = (last?.items || []).filter(Boolean);
    const edge = last?.edge || null;
    const board2 = last?.board;
    if (edge) edgeGroup(edge);
    else {
      const blocksItems = items.filter((it) => it.type === "card" || it.type === "text");
      const sections = items.filter((it) => it.type === "section");
      if (blocksItems.length) blocks(blocksItems);
      if (sections.length) {
        sectionGroup(sections, "Group", "group", (patch) => on.setSectionStyle?.(patch), "Reset", () => on.resetSections?.());
      }
      if (!blocksItems.length && !sections.length) defaultsGroup(board2);
    }
    diagram(board2);
    place();
  };
  paintCollapsed();
  place();
  return {
    el: panel,
    refresh,
    place,
    isCollapsed: () => collapsed,
    dispose() {
      listeners2.splice(0).forEach((off) => off());
      panel.remove();
    }
  };
}

// src/view/menu.js
var MARGIN = 4;
var ROW_HEIGHT = 28;
var MENU_WIDTH = 200;
var STOP_EVENTS = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu", "keydown"];
function createMenu({ doc = globalThis.document, root, on = {} } = {}) {
  let menuEl = null;
  let offs = [];
  const entries = /* @__PURE__ */ new Map();
  const levels = [];
  let disposed = false;
  const el = (tag, cls, parent, text2) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    if (text2 !== void 0) node2.textContent = text2;
    parent?.append(node2);
    return node2;
  };
  const on_ = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const selectable = (level) => level.rows.filter((row2) => !entries.get(row2).item.disabled);
  const setActive = (level, row2) => {
    for (const r of level.rows) r.classList.toggle("pxd-menu__item--active", r === row2);
    level.active = row2 || null;
    if (row2 && level.depth === 0 && menuEl?.classList?.contains("pxd-menu--scroll")) row2.scrollIntoView?.({ block: "nearest" });
  };
  const closeFrom = (depth) => {
    while (levels.length > depth) {
      const level = levels.pop();
      level.container.style.display = "none";
      level.container.classList?.remove("pxd-menu__sub--open");
      setActive(level, null);
    }
  };
  const placeSub = (sub, row2) => {
    const rootRect = root.getBoundingClientRect();
    sub.classList.remove("pxd-menu__sub--left");
    sub.style.top = "0px";
    const r = row2.getBoundingClientRect();
    const w = sub.offsetWidth || MENU_WIDTH;
    const h = sub.offsetHeight || 0;
    if (menuEl?.classList?.contains("pxd-menu--scroll")) {
      const fitsRight = !rootRect.width || r.right + w <= rootRect.right - MARGIN;
      const viewH = doc.defaultView?.innerHeight || 0;
      const viewTop = Math.max(rootRect.top || 0, 0);
      const viewBottom = viewH ? Math.min(rootRect.bottom || viewH, viewH) : rootRect.bottom || 0;
      const visibleSpan = viewBottom > viewTop ? viewBottom - viewTop : rootRect.height || 0;
      const available = visibleSpan ? Math.max(ROW_HEIGHT * 3, visibleSpan - 2 * MARGIN) : h;
      const used = h > available && available > 0 ? available : h;
      if (h > available && available > 0) {
        sub.style.maxHeight = `${Math.round(available)}px`;
        sub.style.overflowY = "auto";
        sub.style.overscrollBehavior = "contain";
      } else {
        sub.style.maxHeight = "";
        sub.style.overflowY = "";
        sub.style.overscrollBehavior = "";
      }
      const limitBottom = viewBottom || rootRect.bottom || 0;
      const topVp = visibleSpan ? Math.max(viewTop + MARGIN, Math.min(r.top, limitBottom - MARGIN - used)) : r.top;
      const leftVp = fitsRight ? r.right + 2 : r.left - w - 2;
      sub.style.left = `${Math.round(leftVp - (rootRect.left || 0))}px`;
      sub.style.top = `${Math.round(topVp - (rootRect.top || 0))}px`;
      return;
    }
    if (rootRect.width && r.right + w > rootRect.right - MARGIN) sub.classList.add("pxd-menu__sub--left");
    if (rootRect.height && h && r.top + h > rootRect.bottom - MARGIN) {
      sub.style.top = `${Math.round(Math.min(0, rootRect.bottom - MARGIN - (r.top + h)))}px`;
    }
  };
  const openSub = (row2) => {
    const entry = entries.get(row2);
    if (!entry?.sub || entry.item.disabled) return null;
    closeFrom(entry.level + 1);
    entry.sub.container.style.display = "";
    entry.sub.container.classList.add("pxd-menu__sub--open");
    levels.push(entry.sub);
    placeSub(entry.sub.container, row2);
    return entry.sub;
  };
  const build = (items, parent, depth) => {
    const level = { container: parent, rows: [], active: null, depth };
    for (const item of items) {
      if (item.separator) {
        el("div", "pxd-menu__sep", parent);
        continue;
      }
      let cls = "pxd-menu__item";
      if (item.disabled) cls += " pxd-menu__item--disabled";
      if (item.danger) cls += " pxd-menu__item--danger";
      if (item.checked) cls += " pxd-menu__item--checked";
      if (item.children?.length) cls += " pxd-menu__item--parent";
      const row2 = el("div", cls, parent);
      row2.setAttribute("role", item.checked ? "menuitemradio" : "menuitem");
      row2.setAttribute("aria-label", item.label || item.id);
      row2.tabIndex = item.disabled ? -1 : 0;
      if (item.checked) row2.setAttribute("aria-checked", "true");
      if (item.disabled) row2.setAttribute("aria-disabled", "true");
      row2.setAttribute("data-id", item.id);
      row2.dataset.id = item.id;
      el("span", "pxd-menu__label", row2, item.label);
      if (item.hint) el("span", "pxd-menu__hint", row2, item.hint);
      const entry = { item, level: depth, sub: null };
      entries.set(row2, entry);
      level.rows.push(row2);
      if (item.children?.length) {
        el("span", "pxd-menu__arrow", row2, "›");
        const container = el("div", "pxd-menu__sub", row2);
        container.style.display = "none";
        container.setAttribute("role", "menu");
        entry.sub = build(item.children, container, depth + 1);
      }
    }
    return level;
  };
  const close = () => {
    if (!menuEl) return;
    offs.splice(0).forEach((off) => off());
    menuEl.remove();
    menuEl = null;
    entries.clear();
    levels.length = 0;
    on.closed?.();
  };
  const pick = (row2) => {
    const entry = entries.get(row2);
    if (!entry || entry.item.disabled) return;
    if (entry.sub) {
      const sub = openSub(row2);
      const first = sub ? selectable(sub)[0] || null : null;
      if (sub) setActive(sub, first);
      first?.focus?.();
      return;
    }
    const { item } = entry;
    try {
      on.pick?.(item.id, item);
    } finally {
      close();
    }
  };
  const current2 = () => levels[levels.length - 1];
  const move = (step) => {
    const level = current2();
    const rows = selectable(level);
    if (!rows.length) return;
    const i = rows.indexOf(level.active);
    const next = i < 0 ? step > 0 ? 0 : rows.length - 1 : (i + step + rows.length) % rows.length;
    setActive(level, rows[next]);
    rows[next].focus?.();
  };
  const onTab = (event) => {
    if (!menuEl?.contains?.(doc.activeElement)) return;
    const level = current2();
    const rows = selectable(level);
    const focused = doc.activeElement?.closest?.(".pxd-menu__item");
    const from = rows.indexOf(level.active) >= 0 ? rows.indexOf(level.active) : rows.indexOf(focused);
    const nextIndex = event.shiftKey ? from - 1 : from + 1;
    if (from >= 0 && nextIndex >= 0 && nextIndex < rows.length) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setActive(level, rows[nextIndex]);
      rows[nextIndex].focus?.();
      return;
    }
    close();
  };
  const onKey = (event) => {
    const key = event.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", " ", "Home", "End", "Tab"].includes(key)) return;
    if (key === "Tab") return onTab(event);
    event.preventDefault?.();
    event.stopPropagation?.();
    const level = current2();
    if (key === "Escape") return close();
    if (key === "ArrowDown") return move(1);
    if (key === "ArrowUp") return move(-1);
    if (key === "Home" || key === "End") {
      const rows = selectable(level);
      const row2 = key === "Home" ? rows[0] : rows[rows.length - 1];
      setActive(level, row2);
      row2?.focus?.();
      return void 0;
    }
    if (key === "ArrowRight") {
      if (level.active && entries.get(level.active)?.sub) pick(level.active);
      return void 0;
    }
    if (key === "ArrowLeft") {
      if (levels.length > 1) closeFrom(levels.length - 1);
      return void 0;
    }
    if (level.active) pick(level.active);
    return void 0;
  };
  const rowOf = (event) => event.target?.closest?.(".pxd-menu__item") || null;
  const api = {
    el: null,
    open({ x = 0, y = 0, items = [] } = {}) {
      if (disposed) return false;
      close();
      const list = Array.isArray(items) ? items : [];
      if (!list.some((item) => !item.separator)) return false;
      menuEl = el("div", "pxd-menu pxd-chrome", root);
      api.el = menuEl;
      menuEl.setAttribute("role", "menu");
      menuEl.style.left = "0px";
      menuEl.style.top = "0px";
      for (const type of STOP_EVENTS) on_(menuEl, type, (event) => event.stopPropagation());
      on_(menuEl, "contextmenu", (event) => event.preventDefault?.());
      levels.push(build(list, menuEl, 0));
      on_(menuEl, "click", (event) => {
        const row2 = rowOf(event);
        if (!row2) return;
        event.preventDefault?.();
        pick(row2);
      });
      on_(menuEl, "pointerover", (event) => {
        const row2 = rowOf(event);
        if (!row2) return;
        const entry = entries.get(row2);
        const level = levels[entry.level];
        if (!level) return;
        closeFrom(entry.level + 1);
        if (entry.item.disabled) {
          setActive(level, null);
          return;
        }
        setActive(level, row2);
        if (entry.sub) openSub(row2);
      });
      const win = doc.defaultView || doc;
      on_(doc, "pointerdown", (event) => {
        if (menuEl && !menuEl.contains(event.target)) close();
      }, true);
      on_(win, "keydown", onKey, true);
      const rootRect = root.getBoundingClientRect();
      const rows = list.filter((item) => !item.separator).length;
      const w = menuEl.offsetWidth || MENU_WIDTH;
      let h = menuEl.offsetHeight || rows * ROW_HEIGHT;
      const W = rootRect.width || 0;
      const H = rootRect.height || 0;
      if (H && h > H - 2 * MARGIN) {
        h = Math.max(ROW_HEIGHT * 3, H - 2 * MARGIN);
        menuEl.classList.add("pxd-menu--scroll");
        menuEl.style.maxHeight = `${Math.round(h)}px`;
      }
      let left = x - (rootRect.left || 0);
      let top = y - (rootRect.top || 0);
      if (W) left = Math.max(MARGIN, Math.min(left, W - w - MARGIN));
      if (H) top = Math.max(MARGIN, Math.min(top, H - h - MARGIN));
      menuEl.style.left = `${Math.round(left)}px`;
      menuEl.style.top = `${Math.round(top)}px`;
      return true;
    },
    close,
    isOpen: () => Boolean(menuEl),
    focusFirst() {
      const level = current2();
      const row2 = level ? selectable(level)[0] || null : null;
      if (!row2) return;
      setActive(level, row2);
      row2.focus?.();
    },
    dispose() {
      close();
      disposed = true;
      api.el = null;
    }
  };
  return api;
}

// src/view/shortcut-sheet.js
function createShortcutSheet({ doc = globalThis.document, root, shortcuts = SHORTCUTS } = {}) {
  let sheet = null;
  const close = () => {
    sheet?.remove();
    sheet = null;
  };
  const open = () => {
    if (sheet) return;
    sheet = doc.createElement("div");
    sheet.className = "pxd-sheet pxd-chrome";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Shortcuts");
    const head = doc.createElement("div");
    head.className = "pxd-sheet__head";
    const title = doc.createElement("div");
    title.className = "pxd-sheet__title";
    title.textContent = "Shortcuts";
    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pxd-btn pxd-sheet__close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    head.append(title, closeBtn);
    const grid = doc.createElement("div");
    grid.className = "pxd-sheet__grid";
    let groupEl = null;
    let groupName = "";
    for (const row2 of shortcuts) {
      if (row2.group !== groupName) {
        groupName = row2.group;
        groupEl = doc.createElement("section");
        groupEl.className = "pxd-sheet__group";
        const heading = doc.createElement("h2");
        heading.className = "pxd-sheet__group-title";
        heading.textContent = row2.group;
        groupEl.append(heading);
        grid.append(groupEl);
      }
      const line = doc.createElement("div");
      line.className = "pxd-sheet__row";
      const keys = doc.createElement("span");
      keys.className = "pxd-sheet__keys";
      keys.textContent = row2.keys;
      const label = doc.createElement("span");
      label.className = "pxd-sheet__label";
      label.textContent = row2.label;
      line.append(keys, label);
      groupEl.append(line);
    }
    sheet.append(head, grid);
    sheet.addEventListener("pointerdown", (event) => event.stopPropagation());
    sheet.addEventListener("keydown", (event) => event.stopPropagation());
    root.append(sheet);
    try {
      closeBtn.focus({ preventScroll: true });
    } catch {
      closeBtn.focus?.();
    }
  };
  return {
    open,
    close,
    toggle() {
      if (sheet) close();
      else open();
    },
    isOpen: () => Boolean(sheet)
  };
}

// src/view/menu-model.js
var SIZE_LABELS = { 16: "Small", 24: "Medium", 32: "Large", 48: "Extra large" };
var SHAPE_LABELS = {
  rectangle: "Rectangle",
  rounded: "Rounded",
  ellipse: "Ellipse",
  diamond: "Diamond",
  parallelogram: "Parallelogram",
  cylinder: "Cylinder"
};
var cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);
var make = (id, label, extra = {}) => {
  const out = { id, label };
  for (const [key, value] of Object.entries(extra)) {
    if (value === void 0 || value === false) continue;
    out[key] = value;
  }
  return out;
};
function buildMenu(kind, ctx = {}) {
  const c = ctx || {};
  const count = Number.isFinite(c.count) ? c.count : null;
  const item = c.item || null;
  const empty = count === 0;
  let separators = 0;
  const sep = () => ({ id: `sep-${separators += 1}`, separator: true });
  const templateMenu = () => make("template", "New board from template…", {
    children: STARTERS.map((s) => make(`template:${s.id}`, s.title))
  });
  const mindPresetMenu = () => {
    const preset = normalizeMindPreset(c.mindPreset);
    const dirs = MIND_DIRECTIONS.map((d) => make(`mind-dir:${d}`, cap(d), { checked: preset.direction === d }));
    const spaces = MIND_SPACINGS.map((s) => make(`mind-space:${s}`, cap(s), { checked: preset.spacing === s }));
    const depths = [];
    for (let d = MIND_DEPTH_MIN; d <= MIND_DEPTH_MAX; d++) depths.push(make(`mind-depth:${d}`, `Depth ${d}`, { checked: preset.depth === d }));
    return make("mind-preset", "Mind map preset…", {
      children: [
        ...dirs,
        sep(),
        ...spaces,
        sep(),
        ...depths,
        sep(),
        make("mind-refs:include", "Include block refs", { checked: preset.includeRefs }),
        make("mind-refs:skip", "Skip block refs", { checked: !preset.includeRefs }),
        sep(),
        make("mind-color:on", "Color branches", { checked: preset.colorBranches }),
        make("mind-color:off", "No branch color", { checked: !preset.colorBranches })
      ]
    });
  };
  const snapshotMenus = () => {
    const parts = partitionSnapshots(c.snapshots);
    const items = [
      make("save-snapshot", "Save snapshot"),
      make("restore-snapshot", "Restore snapshot…", {
        disabled: parts.newest.length === 0,
        children: parts.newest.map((snap) => make(`snapshot:${snap.uid}`, snap.title))
      })
    ];
    if (parts.older.length) {
      items.push(make("older-snapshots", "Older snapshots", {
        children: parts.older.map((snap) => make(`older:${snap.uid}`, snap.title, {
          children: [
            make(`snapshot:${snap.uid}`, "Restore"),
            make(`delete-snapshot:${snap.uid}`, "Delete", { danger: true })
          ]
        }))
      }));
    }
    return items;
  };
  const colorMenu = () => {
    const current2 = item?.color || null;
    return make("color", "Color", {
      children: [
        make("color:none", "No color", { checked: !current2 }),
        ...PALETTE.map((name) => make(`color:${name}`, cap(name), { checked: current2 === name }))
      ]
    });
  };
  const pinItem = (pinned) => pinned ? make("unpin", "Unpin") : make("pin", "Pin");
  const foldItem = (folded) => folded ? make("unfold", "Unfold", { hint: "Cmd Alt Enter" }) : make("fold", "Fold", { hint: "Cmd Alt Enter" });
  const tidyMenu = (disabled) => make("tidy", "Tidy", {
    disabled,
    children: [
      make("tidy:grid", "Grid"),
      make("tidy:row", "Row"),
      make("tidy:column", "Column"),
      make("tidy:outline", "Outline order")
    ]
  });
  switch (kind) {
    case "canvas":
      return [
        make("new-card", "New card", { hint: "N" }),
        make("new-text", "New text", { hint: "T" }),
        make("new-sticky", "New sticky"),
        make("new-section", "New section", { hint: "G" }),
        make("new-lane-h", "Horizontal lane"),
        make("new-lane-v", "Vertical lane"),
        make("new-board", "New board", { hint: "W" }),
        templateMenu(),
        make("save-template", "Save board as template"),
        ...snapshotMenus(),
        sep(),
        make("paste", "Paste", { hint: "Cmd V", disabled: !c.canPaste }),
        make("paste-clone", "Paste as copies", { disabled: !c.canPaste }),
        sep(),
        make("add-page", "Add page…"),
        make("add-today", "Add today's journal"),
        make("add-week", "Add this week's journals"),
        sep(),
        make("select-all", "Select all", { hint: "Cmd A" }),
        make("fit-all", "Fit all", { hint: "Shift 1" }),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
        make("background", "Background…"),
        make("bg-image", "Lock copied image as background"),
        make("gallery", "Gallery"),
        make("timeline", "Timeline"),
        make("graph", "Graph"),
        make("print", "Print…"),
        make("highlights", "Highlight marks"),
        make("export-svg", "Export as SVG"),
        make("export-png", "Export as PNG"),
        make("copy-outline", "Copy as outline")
      ];
    case "card": {
      const folded = Boolean(c.collapsed);
      const out = [
        make("edit", c.isBoard ? "Rename board" : "Edit", { hint: "Enter" }),
        make("open", c.isBoard ? "Open board" : "Open"),
        ...c.isBoard ? [make("open-own-page", "Open nested board in its own page")] : [],
        make("open-sidebar", "Open in sidebar", { hint: "Shift Click" }),
        sep(),
        make("copy", "Copy", { hint: "Cmd C" }),
        make("copy-png", "Copy selection as PNG"),
        make("copy-ref", "Copy ref"),
        make("copy-link", "Copy link"),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        make("duplicate-ref", "Duplicate as ref"),
        sep(),
        colorMenu(),
        item?.look === "card" ? make("show-as-block", "Show as block") : make("show-as-card", "Show as card"),
        make("apply-template", "Add attribute template"),
        make("version-peek", "Version history"),
        foldItem(folded),
        make("fit-height", "Fit height", { disabled: folded }),
        make("reset-size", "Reset size", { disabled: folded }),
        pinItem(Boolean(c.pinned)),
        make("select-same-color", "Select same color"),
        make("select-connected", "Select connected")
      ];
      if (c.hasOutline) {
        out.push(make("mind-map", "Expand as mind map"));
        out.push(mindPresetMenu());
      }
      if (c.canSpread) out.push(make("spread-children", "Spread children as cards"));
      if (c.isQuery) out.push(make("query-results", "Add results as cards"));
      if (c.canExpand) {
        out.push(make("neighbors:out", "Add pages it links to"));
        out.push(make("neighbors:in", "Add pages that link here"));
        out.push(make("neighbors:attr", "Add attribute values"));
      }
      out.push(
        make("send-to", "Send to board…"),
        make("related", "Related…"),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true })
      );
      return out;
    }
    case "section":
      return [
        make("rename", "Rename", { hint: "Enter" }),
        make("select-contents", "Select contents", { disabled: empty }),
        make("select-all-in-section", "Select all in section", { disabled: empty }),
        make("select-same-color", "Select same color"),
        make("select-connected", "Select connected"),
        make("collapse-section", c.collapsed ? "Expand" : "Collapse"),
        make("section-note", c.hasNote ? "Remove description" : "Add description"),
        c.locked ? make("unlock-contents", "Unlock") : make("lock-contents", "Lock"),
        make("present-section", "Present this section"),
        make("layout-dates", "Lay out by date"),
        make("focus-timer", "Focus timer"),
        sep(),
        make("fit-section", "Fit to contents", { disabled: empty }),
        make("toggle-fit", "Auto-fit", { checked: Boolean(c.fitOn) }),
        tidyMenu(empty),
        make("fold-all-in", "Fold all inside", { disabled: empty }),
        make("unfold-all-in", "Unfold all inside", { disabled: empty }),
        sep(),
        colorMenu(),
        pinItem(Boolean(c.pinned)),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        make("copy-ref", "Copy ref"),
        make("copy-png", "Copy selection as PNG"),
        sep(),
        make("delete-frame", "Delete frame", { hint: "Del", danger: true }),
        make("delete-contents", "Delete frame and contents", { hint: "Shift Del", danger: true, disabled: empty })
      ];
    case "text":
      return [
        make("edit", "Edit", { hint: "Enter" }),
        colorMenu(),
        make("size", "Size", {
          children: FONT_SIZES.map((px) => make(`size:${px}`, `${SIZE_LABELS[px] || px} (${px}px)`, { checked: item?.fontSize === px }))
        }),
        make("shape", "Shape", {
          children: SHAPES.map((name) => make(`shape:${name}`, SHAPE_LABELS[name] || name, { checked: item?.shape === name }))
        }),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        pinItem(Boolean(c.pinned)),
        make("copy", "Copy", { hint: "Cmd C" }),
        make("copy-png", "Copy selection as PNG"),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true })
      ];
    case "edge":
      return [
        make("dir", "Direction", {
          children: [
            make("dir:one", "One way", { checked: c.dir === "one" }),
            make("dir:two", "Two way", { checked: c.dir === "two" }),
            make("dir:none", "No arrow", { checked: c.dir === "none" })
          ]
        }),
        make("flip", "Flip direction"),
        ...c.blockEnd ? [make("unblock", "Connect to the page instead")] : [],
        make("route", "Route", {
          children: [
            make("route:curve", "Curve", { checked: c.route === "curve" }),
            make("route:straight", "Straight", { checked: c.route === "straight" }),
            make("route:elbow", "Elbow", { checked: c.route === "elbow" }),
            make("route:around", "Around cards", { checked: c.route === "around" })
          ]
        }),
        make("dash", "Line", {
          children: [
            make("dash:solid", "Solid", { checked: c.dash === "solid" }),
            make("dash:dashed", "Dashed", { checked: c.dash === "dashed" })
          ]
        }),
        colorMenu(),
        sep(),
        make("add-bend", "Add bend"),
        make("clear-bends", "Clear bends"),
        make("label", "Label"),
        make("notes", "Notes"),
        make("write-to-graph", "Write to graph"),
        sep(),
        make("copy-png", "Copy selection as PNG"),
        make("delete", "Delete", { hint: "Del", danger: true })
      ];
    case "multi": {
      const few = count !== null && count < 2;
      return [
        make("copy", "Copy", { hint: "Cmd C" }),
        make("copy-png", "Copy selection as PNG"),
        make("duplicate", "Duplicate", { hint: "Cmd D" }),
        colorMenu(),
        sep(),
        make("align", "Align", {
          disabled: few,
          children: ["left", "center", "right", "top", "middle", "bottom"].map((side) => make(`align:${side}`, cap(side)))
        }),
        make("distribute", "Distribute", {
          disabled: count !== null && count < 3,
          children: [make("distribute:h", "Horizontally"), make("distribute:v", "Vertically")]
        }),
        tidyMenu(false),
        make("same-size", "Same size", {
          disabled: few,
          children: [make("same-size:width", "Width"), make("same-size:height", "Height"), make("same-size:both", "Width and height")]
        }),
        foldItem(Boolean(c.anyCollapsed)),
        pinItem(Boolean(c.allPinned)),
        sep(),
        ...c.sectionPair ? [make("group-connect", "Connect sections")] : [],
        make("wrap-section", "Wrap in section", { hint: "Cmd G" }),
        make("wrap-board", "Move into new board"),
        make("send-to", "Send to board…"),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true })
      ];
    }
    case "board-menu":
      return [
        templateMenu(),
        make("save-template", "Save board as template"),
        ...snapshotMenus(),
        sep(),
        make("export-svg", "Export as SVG"),
        make("export-png", "Export as PNG"),
        make("copy-outline", "Copy as outline"),
        make("sort-outline", "Sort outline by position"),
        make("open-outline", "Open outline in sidebar"),
        sep(),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
        make("add-page", "Add page…"),
        make("add-today", "Add today's journal"),
        make("add-week", "Add this week's journals"),
        sep(),
        make("background", "Background…"),
        make("tidy:grid", "Tidy into a grid")
      ];
    default:
      return [];
  }
}

// src/view/quicklook.js
var DEPTH = 3;
var LIMIT2 = 24;
var STOP_EVENTS2 = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "keydown", "keyup", "contextmenu"];
var childString3 = (c) => c?.[":block/string"] ?? c?.string ?? "";
var childKids2 = (c) => c?.[":block/children"] ?? c?.children ?? [];
function createQuickLook({ doc = globalThis.document, root, host, timers, on = {} } = {}) {
  let node2 = null;
  let roots = [];
  let current2 = null;
  let cancelPending = null;
  let disposed = false;
  const offs = [];
  const el = (tag, cls, parent, text2) => {
    const n2 = doc.createElement(tag);
    n2.className = cls;
    if (text2 !== void 0) n2.textContent = text2;
    parent?.append(n2);
    return n2;
  };
  const renderRoot = (parent, string, cls) => {
    const n2 = el("div", cls, parent);
    roots.push(n2);
    if (!string) return n2;
    try {
      if (host?.renderString) host.renderString(n2, string);
      else n2.textContent = string;
    } catch {
      n2.textContent = string;
    }
    return n2;
  };
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks || []) {
      if (budget.n >= LIMIT2 * 4) return;
      budget.n += 1;
      const row2 = el("div", "pxd-ql__block", parent);
      renderRoot(row2, childString3(b), "pxd-rs pxd-ql__text");
      const kids = childKids2(b);
      if (kids.length && depth < DEPTH) renderBlocks(el("div", "pxd-ql__children", row2), kids, depth + 1, budget);
    }
  };
  const unmountRoots = () => {
    for (const n2 of roots) {
      try {
        host?.unmount?.(n2);
      } catch {
      }
    }
    roots = [];
  };
  const close = () => {
    if (!node2) return false;
    cancelPending?.();
    cancelPending = null;
    unmountRoots();
    node2.remove();
    node2 = null;
    current2 = null;
    offs.splice(0).forEach((off) => off());
    on.close?.();
    return true;
  };
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };
  const fill = (body, item) => {
    const blocksInto = (result) => {
      if (!node2 || !body.parentElement) return;
      const budget = { n: 0 };
      renderBlocks(body, result || [], 1, budget);
    };
    const settle = (result, apply) => {
      if (result && typeof result.then === "function") {
        result.then((r) => {
          if (node2 && current2 === item) apply(r);
        }).catch(() => {
        });
      } else apply(result);
    };
    if (item.kind === "board") {
      let count = 0;
      try {
        count = boardPreview(item)?.count ?? 0;
      } catch {
        count = 0;
      }
      el("div", "pxd-ql__summary", body, `${count} ${count === 1 ? "item" : "items"}`);
    } else if (item.kind === "page") {
      settle(host?.pagePreview?.(item.title, DEPTH, LIMIT2), (p) => {
        if (!p?.exists) {
          el("div", "pxd-ql__placeholder", body, "Empty page");
          return;
        }
        blocksInto(p.blocks);
      });
    } else if (item.kind === "block") {
      const ref = item.target?.uid;
      const s = host?.blockString?.(ref);
      if (typeof s === "string" && s.trim()) renderRoot(body, s, "pxd-rs pxd-ql__string");
      settle(host?.pullTree?.(ref, DEPTH, LIMIT2), (t) => {
        if (!(typeof s === "string" && s.trim()) && !(t || []).length) el("div", "pxd-ql__placeholder", body, "Empty card");
        blocksInto(t);
      });
    } else {
      if (item.string?.trim()) renderRoot(body, item.string, "pxd-rs pxd-ql__string");
      const kids = item.content?.length ? item.content : null;
      if (kids) blocksInto(kids);
      else settle(host?.pullTree?.(item.uid, DEPTH, LIMIT2), (t) => {
        if (!item.string?.trim() && !(t || []).length) el("div", "pxd-ql__placeholder", body, "Empty card");
        blocksInto(t);
      });
    }
  };
  const open = (item) => {
    if (disposed || !item) return false;
    close();
    current2 = item;
    node2 = el("div", "pxd-quicklook pxd-chrome", root);
    node2.setAttribute("role", "dialog");
    node2.setAttribute("aria-label", "Quick Look");
    for (const type of STOP_EVENTS2) listen(node2, type, (event) => event.stopPropagation());
    const head = el("div", "pxd-ql__head", node2);
    el("div", "pxd-ql__title", head, item.kind === "board" ? item.title : item.title || item.string || "");
    let refs = null;
    try {
      refs = on.getRefCount?.(item);
    } catch {
      refs = null;
    }
    if (typeof refs === "number" && refs > 0) el("span", "pxd-ql__refs", head, String(refs));
    const body = el("div", "pxd-ql__body", node2);
    fill(body, item);
    listen(doc, "pointerdown", (event) => {
      if (node2 && !node2.contains(event.target)) close();
    }, true);
    listen(doc, "keydown", (event) => {
      if (event.key === "Escape" && node2) {
        event.preventDefault?.();
        event.stopPropagation?.();
        close();
      }
    }, true);
    return true;
  };
  return {
    open,
    close,
    toggle(item) {
      if (node2) {
        close();
        return false;
      }
      return open(item);
    },
    isOpen: () => Boolean(node2),
    dispose() {
      close();
      disposed = true;
    }
  };
}

// src/view/present.js
var collectMembers = (board2, uid) => {
  const out = /* @__PURE__ */ new Set();
  const stack = [uid];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...board2.items.get(u)?.members ?? []);
  }
  return out;
};
function createPresenter({ doc = globalThis.document, root, timers, on = {} } = {}) {
  let steps = [];
  let index = -1;
  let active = false;
  let hud = null;
  let titleEl = null;
  let countEl = null;
  let noteEl = null;
  let prevBtn = null;
  let nextBtn = null;
  let ink = null;
  let laserOn = false;
  let penOn = false;
  let drawing = false;
  const strokes = [];
  const offs = [];
  const el = (tag, cls, parent, text2) => {
    const n2 = doc.createElement(tag);
    n2.className = cls;
    if (text2 !== void 0) n2.textContent = text2;
    parent?.append(n2);
    return n2;
  };
  const button = (parent, cls, label, fn) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    const click = (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      fn();
    };
    const stop2 = (event) => event.stopPropagation?.();
    b.addEventListener("click", click);
    b.addEventListener("pointerdown", stop2);
    b.addEventListener("dblclick", stop2);
    offs.push(() => {
      b.removeEventListener("click", click);
      b.removeEventListener("pointerdown", stop2);
      b.removeEventListener("dblclick", stop2);
    });
    return b;
  };
  const paint2 = () => {
    const s = steps[index];
    if (!hud || !s) return;
    titleEl.textContent = s.title || "";
    if (noteEl) noteEl.textContent = s.note || "";
    countEl.textContent = `${index + 1} / ${steps.length}`;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= steps.length - 1;
    prevBtn.setAttribute("aria-disabled", String(index <= 0));
    nextBtn.setAttribute("aria-disabled", String(index >= steps.length - 1));
    hud.classList.remove("pxd-present-hud--step");
    void hud.offsetWidth;
    hud.classList.add("pxd-present-hud--step");
  };
  const goto = (i) => {
    if (!active || !steps.length) return false;
    const next = Math.max(0, Math.min(steps.length - 1, Math.trunc(Number(i))));
    if (!Number.isFinite(next)) return false;
    index = next;
    paint2();
    const s = steps[index];
    on.step?.({ index, total: steps.length, uid: s.uid, rect: s.rect, title: s.title, note: s.note || "", members: s.members });
    return true;
  };
  const teardown = () => {
    offs.splice(0).forEach((off) => off());
    ink?.remove();
    hud?.remove();
    hud = titleEl = countEl = noteEl = prevBtn = nextBtn = ink = null;
    laserOn = false;
    penOn = false;
    drawing = false;
    strokes.length = 0;
    root?.classList.remove("pxd-root--laser");
  };
  const stop = () => {
    if (!active) return false;
    active = false;
    teardown();
    steps = [];
    index = -1;
    on.exit?.();
    return true;
  };
  const start = (board2, rects, opts) => {
    if (!board2) return false;
    if (active) {
      teardown();
      active = false;
    }
    const only = opts && typeof opts === "object" ? opts.only : null;
    if (only) {
      const item = board2.items.get(only);
      const rect = rects?.get(only);
      if (!item || item.type !== "section" || !rect) return false;
      steps = [{ uid: only, rect, title: item.title || "", note: presenterNote(board2, only), members: collectMembers(board2, only) }];
    } else {
      const rootSet = new Set(board2.roots);
      const sections = outlineOrder(board2).filter((u) => rootSet.has(u) && board2.items.get(u)?.type === "section" && rects.get(u));
      steps = sections.map((uid) => ({
        uid,
        rect: rects.get(uid),
        title: board2.items.get(uid).title || "",
        note: presenterNote(board2, uid),
        members: collectMembers(board2, uid)
      }));
    }
    if (!steps.length) {
      const all = [...board2.items.keys()].filter((u) => rects.get(u));
      if (!all.length) return false;
      steps = [{ uid: null, rect: boundsOf(all.map((u) => rects.get(u))), title: board2.title || "", members: new Set(all) }];
    }
    active = true;
    hud = el("div", "pxd-present-hud pxd-chrome", root);
    titleEl = el("span", "pxd-present-hud__title", hud);
    noteEl = el("span", "pxd-present-hud__note", hud);
    countEl = el("span", "pxd-present-hud__count", hud);
    prevBtn = button(hud, "pxd-present-hud__prev", "Prev", () => goto(index - 1));
    nextBtn = button(hud, "pxd-present-hud__next", "Next", () => goto(index + 1));
    button(hud, "pxd-present-hud__laser", "Laser", () => {
      laserOn = !laserOn;
      penOn = false;
      root?.classList.toggle("pxd-root--laser", laserOn);
    });
    button(hud, "pxd-present-hud__pen", "Pen", () => {
      penOn = !penOn;
      laserOn = false;
      root?.classList.remove("pxd-root--laser");
    });
    button(hud, "pxd-present-hud__exit", "Exit", () => stop());
    ink = el("div", "pxd-present-ink", root);
    const dot = el("div", "pxd-present-laser", ink);
    const onMove = (event) => {
      if (!active) return;
      const box2 = root?.getBoundingClientRect?.();
      const x = (event.clientX ?? 0) - (box2?.left || 0);
      const y = (event.clientY ?? 0) - (box2?.top || 0);
      if (laserOn) {
        dot.hidden = false;
        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
      } else dot.hidden = true;
      if (penOn && drawing) strokes.push({ x, y });
    };
    const onDown = (event) => {
      if (!penOn || event.target?.closest?.(".pxd-present-hud")) return;
      drawing = true;
      strokes.push({ break: true });
    };
    const onUp = () => {
      if (!drawing) return;
      drawing = false;
      ink.querySelectorAll(".pxd-present-stroke").forEach((node2) => node2.remove());
      let run = [];
      const flush = () => {
        if (run.length < 2) {
          run = [];
          return;
        }
        const line = el("div", "pxd-present-stroke", ink);
        line.style.left = `${run[0].x}px`;
        line.style.top = `${run[0].y}px`;
        line.style.width = `${Math.hypot(run[run.length - 1].x - run[0].x, run[run.length - 1].y - run[0].y)}px`;
        run = [];
      };
      for (const point of strokes) {
        if (point.break) flush();
        else run.push(point);
      }
      flush();
    };
    root?.addEventListener("pointermove", onMove);
    root?.addEventListener("pointerdown", onDown);
    root?.addEventListener("pointerup", onUp);
    offs.push(() => {
      root?.removeEventListener("pointermove", onMove);
      root?.removeEventListener("pointerdown", onDown);
      root?.removeEventListener("pointerup", onUp);
    });
    goto(0);
    return true;
  };
  return {
    start,
    next: () => goto(index + 1),
    prev: () => goto(index - 1),
    goto,
    stop,
    isActive: () => active,
    index: () => index,
    total: () => steps.length,
    dispose() {
      if (active) stop();
      else teardown();
    }
  };
}

// src/view/clipboard-io.js
var CLONE_WINDOW_MS = 400;
var MAX_IMAGES = 10;
var defaultTextEntry = (node2) => {
  if (!node2 || node2.nodeType !== 1) return false;
  const tag = String(node2.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return node2.isContentEditable === true || node2.getAttribute?.("contenteditable") === "true" || node2.getAttribute?.("contenteditable") === "";
};
function filesFromDataTransfer(dt) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (f) => {
    if (!f || typeof f.type !== "string" || !f.type.startsWith("image/") || seen.has(f) || out.length >= MAX_IMAGES) return;
    seen.add(f);
    out.push(f);
  };
  for (const f of dt?.files ?? []) add(f);
  if (out.length) return out;
  for (const item of dt?.items ?? []) {
    if (item?.kind === "file") {
      try {
        add(item.getAsFile?.());
      } catch {
      }
    }
  }
  return out;
}
function dragHasImages(dt) {
  if (filesFromDataTransfer(dt).length) return true;
  for (const item of dt?.items ?? []) {
    if (item?.kind === "file" && String(item.type || "").startsWith("image/")) return true;
  }
  return false;
}
async function writeClipboard({ text: text2 = "", mime = null, data = null } = {}) {
  const nav = globalThis.navigator;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(String(text2));
      return true;
    }
  } catch {
  }
  const doc = globalThis.document;
  if (!doc?.body) return false;
  const area = doc.createElement("textarea");
  area.value = String(text2);
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  doc.body.append(area);
  const onCopy = (event) => {
    if (mime && data != null) {
      try {
        event.clipboardData?.setData(mime, typeof data === "string" ? data : JSON.stringify(data));
      } catch {
      }
    }
  };
  doc.addEventListener("copy", onCopy, true);
  let ok = false;
  try {
    area.focus?.();
    area.select?.();
    ok = Boolean(doc.execCommand?.("copy"));
  } catch {
    ok = false;
  }
  doc.removeEventListener("copy", onCopy, true);
  area.remove();
  return ok;
}
function createClipboardIO({ doc = globalThis.document, root, ownsKeyboard, isTextEntry, on = {}, now: now2 = () => Date.now() } = {}) {
  const offs = [];
  const win = doc.defaultView ?? globalThis.window;
  let lastCloneKey = -Infinity;
  const listen = (target, type, fn, opts) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };
  const textNode = (node2) => Boolean(isTextEntry?.(node2)) || defaultTextEntry(node2);
  const inText = (event) => textNode(event.target) || textNode(doc.activeElement);
  const editorNode = (event) => {
    const node2 = event.target?.nodeType === 1 ? event.target : null;
    const hit = textNode(node2) ? node2 : textNode(doc.activeElement) ? doc.activeElement : null;
    if (!hit || typeof hit.closest !== "function") return null;
    const editor = hit.closest(".pxd-item__editor");
    if (!editor) return null;
    if (root && typeof root.contains === "function" && !root.contains(editor)) return null;
    return hit;
  };
  const active = (event) => Boolean(ownsKeyboard?.()) && !inText(event);
  const copy = (event, cut = false) => {
    const payload = on.getPayload?.({ cut });
    if (!payload || !event.clipboardData) return false;
    event.clipboardData.setData(PLEXUS_MIME, payload.mime);
    event.clipboardData.setData("text/plain", payload.text);
    event.preventDefault();
    return true;
  };
  listen(doc, "copy", (event) => {
    if (active(event)) copy(event);
  }, true);
  listen(doc, "cut", (event) => {
    if (active(event) && copy(event, true)) on.cutDone?.();
  }, true);
  listen(win, "keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && String(event.key).toLowerCase() === "v") lastCloneKey = now2();
  }, true);
  listen(win, "paste", (event) => {
    if (!editorNode(event)) return;
    if (on.editorPaste?.(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  listen(doc, "paste", (event) => {
    if (editorNode(event)) return;
    if (!active(event)) return;
    const parsed = parseClipboard(event.clipboardData);
    if (!parsed) return;
    event.preventDefault();
    if (parsed.kind === "plexus") on.pastePlexus?.(parsed.data, { clone: now2() - lastCloneKey <= CLONE_WINDOW_MS });
    else if (parsed.kind === "images") on.pasteImages?.(parsed.files);
    else on.pasteText?.(parsed.entries);
  }, true);
  return { dispose() {
    offs.splice(0).forEach((off) => off());
  } };
}

// src/discovery.js
var DIAGRAM_MARKER = /\{\{\s*(\[\[)?diagram/i;
var MAX_GUARD_UIDS = 2e3;
var ENHANCED_UID_CACHE_PREFIX = "plexus-diagram:enhanced-uids:";
var PREPAINT_STYLE_ID = "plexus-diagram-prepaint-guard";
var PENDING_CLASS = "pxd-native-pending";
var NATIVE_HIDDEN_CLASS = "pxd-native-hidden";
var OUTLINE_NATIVE_CLASS = "pxd-outline-native";
function isDiagramString(value) {
  return DIAGRAM_MARKER.test(String(value ?? ""));
}
function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function graphCacheKey(locationHash = globalThis.location?.hash || "") {
  const match = String(locationHash).match(/#\/app\/([^/]+)/);
  return match ? `${ENHANCED_UID_CACHE_PREFIX}${match[1]}` : `${ENHANCED_UID_CACHE_PREFIX}unknown`;
}
function diagramUidFromLocation(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/[^/]+\/page\/([^/?#]+)/);
  return match ? match[1] : null;
}
function routeLeftZoomedDiagram(diagramUid, hash = globalThis.location?.hash || "") {
  if (!diagramUid) return true;
  return diagramUidFromLocation(hash) !== diagramUid;
}
function readEnhancedUidCache(storage = globalThis.localStorage, key = graphCacheKey()) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return /* @__PURE__ */ new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return /* @__PURE__ */ new Set();
    return new Set(parsed.map(String).filter(Boolean).sort());
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function writeEnhancedUidCache(uids, storage = globalThis.localStorage, key = graphCacheKey()) {
  const sorted = [...new Set([...uids].map(String).filter(Boolean))].sort();
  storage?.setItem?.(key, JSON.stringify(sorted));
  return sorted;
}
function enhancedUidGuardCss(uids) {
  const selectors = [];
  const unique = [...new Set([...uids].map(String).filter(Boolean))].sort();
  if (unique.length > MAX_GUARD_UIDS) {
    console.warn(`[plexus-diagram] Skipping the pre-paint guard: ${unique.length} cached diagram uids exceeds the ${MAX_GUARD_UIDS} cap`);
    return "";
  }
  for (const uid of unique) {
    const escaped = cssAttributeValue(uid);
    for (const host of [
      `[id$="${escaped}"]`,
      `[data-uid="${escaped}"]`,
      `.rm-block-ref[data-uid="${escaped}"]`
    ]) {
      selectors.push(
        `${host} .rm-diagram:not(.${NATIVE_HIDDEN_CLASS}):not(.${OUTLINE_NATIVE_CLASS})`,
        `${host} .rm-diagram-title-panel:not(.${OUTLINE_NATIVE_CLASS})`,
        `${host} .react-flow:not(.${OUTLINE_NATIVE_CLASS} *)`
      );
    }
  }
  const hideRule = selectors.length ? `${selectors.join(",\n")} { display: none !important; }` : "";
  const pendingRule = unique.length ? `.rm-diagram.${PENDING_CLASS}:not(.${NATIVE_HIDDEN_CLASS}):not(.${OUTLINE_NATIVE_CLASS}) { visibility: hidden !important; pointer-events: none !important; }` : "";
  return [hideRule, pendingRule].filter(Boolean).join("\n");
}
function uidFromBlockInputId(id, isDiagramUid) {
  const value = String(id || "");
  const prefix = "block-input-";
  if (!value.startsWith(prefix) || typeof isDiagramUid !== "function") return null;
  for (let i = value.length - 1; i >= prefix.length; i -= 1) {
    if (value[i] !== "-") continue;
    const candidate = value.slice(i + 1);
    if (candidate && isDiagramUid(candidate)) return candidate;
  }
  return null;
}
var BLOCK_CONTAINER_SELECTOR = ".roam-block-container";
function directChildWithClass(element, className) {
  for (const child of element?.children || []) {
    if (child.classList?.contains(className)) return child;
  }
  return null;
}
function blockContainerUid(container, isDiagramUid) {
  const main = directChildWithClass(container, "rm-block-main");
  const input = main?.querySelector?.('[id^="block-input-"]');
  return uidFromBlockInputId(input?.id, isDiagramUid);
}
var EMBED_WRAP_SELECTORS = [".rm-embed-container", ".block-embed", ".rm-embed"];
var EMBED_REF = /\{\{(?:\[\[embed\]\]|embed):\s*\(\(([A-Za-z0-9_-]+)\)\)/;
function embedOwnerFromInputId(id, readString) {
  const value = String(id || "");
  if (!value.startsWith("block-input-")) return "";
  const mark = "-body-outline-";
  const at = value.lastIndexOf(mark);
  if (at < 0) return "";
  const tail = value.slice(at + mark.length);
  if (!tail) return "";
  const candidates = [];
  for (let i = 0; i < tail.length; i += 1) {
    if (i === 0 || tail[i - 1] === "-") candidates.push(tail.slice(i));
  }
  candidates.sort((a, b) => b.length - a.length);
  if (typeof readString !== "function") return candidates[candidates.length - 1] || "";
  for (const candidate of candidates) {
    let string = "";
    try {
      string = String(readString(candidate) ?? "");
    } catch {
      string = "";
    }
    if (EMBED_REF.test(string)) return candidate;
  }
  return "";
}
function firstBlockInputId(root) {
  const stack = [root];
  while (stack.length) {
    const node2 = stack.shift();
    if (String(node2?.id || "").startsWith("block-input-")) return node2.id;
    const kids = node2?.children || [];
    for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
  }
  return "";
}
function embedWrap(native) {
  if (!native?.closest) return null;
  for (const sel of EMBED_WRAP_SELECTORS) {
    const hit = native.closest(sel);
    if (hit) return hit;
  }
  return null;
}
function embedOwnerUid(native, readString) {
  const wrap = embedWrap(native);
  if (wrap) {
    let node3 = wrap.parentElement;
    while (node3) {
      const uid = embedOwnerFromInputId(node3.id, readString);
      if (uid) return uid;
      node3 = node3.parentElement;
    }
    return "embed";
  }
  if (typeof readString !== "function") return null;
  let node2 = native?.parentElement;
  while (node2) {
    if (node2.matches?.(".roam-block-container")) {
      const uid = embedOwnerFromInputId(firstBlockInputId(node2), readString);
      if (uid) {
        let string = "";
        try {
          string = String(readString(uid) ?? "");
        } catch {
          string = "";
        }
        if (EMBED_REF.test(string)) return uid;
      }
    }
    node2 = node2.parentElement;
  }
  return null;
}
function embedScope(native, readString) {
  const wrap = embedWrap(native);
  if (wrap) return wrap;
  const owner = embedOwnerUid(native, readString);
  if (!owner || owner === "embed") return null;
  let node2 = native?.parentElement;
  while (node2) {
    if (node2.matches?.(".roam-block-container") && embedOwnerFromInputId(firstBlockInputId(node2), readString) === owner) return node2;
    node2 = node2.parentElement;
  }
  return null;
}
function embedBoardUid(native, readString) {
  const owner = embedOwnerUid(native, readString);
  if (!owner || owner === "embed" || typeof readString !== "function") return null;
  let string = "";
  try {
    string = String(readString(owner) ?? "");
  } catch {
    return null;
  }
  const match = EMBED_REF.exec(string);
  return match ? match[1] : null;
}
function findDiagramUidFromEl(element, isDiagramUid) {
  if (!element) return null;
  const ref = element.closest?.(".rm-block-ref[data-uid]");
  if (ref?.dataset?.uid) return ref.dataset.uid;
  const blockInput = element.closest?.('[id^="block-input-"]');
  const resolved = uidFromBlockInputId(blockInput?.id, isDiagramUid);
  if (resolved) return resolved;
  if (blockInput?.id) {
    const dated = blockInput.id.match(/block-input-.+-body-outline-\d{2}-\d{2}-\d{4}-(.+)$/);
    if (dated) return dated[1];
    const zoomed = blockInput.id.match(/block-input-.+-body-outline-(.+)$/);
    if (zoomed && !/^\d{2}-\d{2}-\d{4}(-|$)/.test(zoomed[1])) return zoomed[1];
  }
  if (element.closest?.(".rm-zoom-block-wrapper")) {
    const pageUid = diagramUidFromLocation();
    if (pageUid) return pageUid;
  }
  const host = element.closest?.("[data-uid]");
  if (host?.dataset?.uid) return host.dataset.uid;
  return null;
}
function diagramsWithin(root) {
  if (!root) return [];
  const values = [];
  if (root.matches?.(".rm-diagram")) values.push(root);
  for (const diagram of root.querySelectorAll?.(".rm-diagram") || []) {
    if (!values.includes(diagram)) values.push(diagram);
  }
  return values;
}
function isEnhancedProps(pulledProps) {
  return readPlexus(pulledProps)?.v === SCHEMA_VERSION;
}
function readEnhanced(api, uid) {
  if (!uid) return false;
  try {
    const pulled = api?.data?.pull?.("[:block/props]", [":block/uid", uid]);
    return isEnhancedProps(pulled?.[":block/props"] ?? pulled?.props ?? null);
  } catch {
    return false;
  }
}

// src/view/fullscreen.js
var SIDEBAR_SELECTORS = [".roam-sidebar-container", ".rm-left-sidebar", "#roam-sidebar-container"];
var RIGHT_SIDEBAR_SELECTORS = ["#right-sidebar", ".rm-right-sidebar", '[class*="right-sidebar"]'];
var RIGHT_INSET_COLLAPSE_PX = 8;
function raf(callback) {
  const fn = globalThis.requestAnimationFrame;
  if (typeof fn === "function") {
    const id2 = fn(callback);
    return () => globalThis.cancelAnimationFrame?.(id2);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}
function firstMatch(root, selectors) {
  if (!root?.querySelector) return null;
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}
function topbarOffset(root = globalThis.document) {
  const topbar = root?.querySelector?.(".rm-topbar");
  if (!topbar?.getBoundingClientRect) return 0;
  const bottom = topbar.getBoundingClientRect().bottom;
  return Number.isFinite(bottom) ? Math.max(0, Math.round(bottom)) : 0;
}
function fullscreenInsets(root = globalThis.document) {
  const topbarBottom = topbarOffset(root);
  const article = root?.querySelector?.(".rm-article-wrapper");
  if (!article?.getBoundingClientRect) return { top: topbarBottom, left: 0, right: 0, bottom: 0 };
  const rect = article.getBoundingClientRect();
  const top = Math.max(Number(rect.top) || 0, topbarBottom);
  const left = Number.isFinite(Number(rect.left)) ? Math.round(rect.left) : 0;
  const view = root.defaultView || globalThis;
  const vw = Number(view.innerWidth);
  const vh = Number(view.innerHeight);
  let right = 0;
  if (Number.isFinite(Number(rect.right)) && Number.isFinite(vw) && vw > 0) {
    const gap = vw - rect.right;
    right = gap <= RIGHT_INSET_COLLAPSE_PX ? 0 : Math.max(0, Math.round(gap));
  }
  let bottom = 0;
  if (Number.isFinite(Number(rect.bottom)) && Number.isFinite(vh) && vh > 0) bottom = Math.max(0, Math.round(vh - rect.bottom));
  return { top: Math.round(top), left, right, bottom };
}
function applyFullscreenChrome(mount, on, root = globalThis.document) {
  mount?.classList?.toggle?.("pxd-mount--fullscreen", Boolean(on));
  root?.body?.classList?.toggle?.("pxd-has-fullscreen", Boolean(on));
  if (!on) {
    if (mount?.style) {
      for (const k of ["top", "left", "right", "bottom", "width", "height", "minHeight"]) mount.style[k] = "";
    }
    return () => {
    };
  }
  let alive = true;
  const place = () => {
    if (!alive || !mount?.style) return;
    const box2 = fullscreenInsets(root);
    mount.style.top = `${box2.top}px`;
    mount.style.left = `${box2.left}px`;
    mount.style.right = `${box2.right}px`;
    mount.style.bottom = `${box2.bottom}px`;
    mount.style.width = "auto";
    mount.style.height = "auto";
    mount.style.minHeight = "0";
  };
  const placeAfterAnim = () => {
    place();
    raf(() => {
      place();
      raf(place);
    });
  };
  place();
  const disconnects = [];
  const article = root?.querySelector?.(".rm-article-wrapper");
  const sidebar = firstMatch(root, SIDEBAR_SELECTORS);
  const rightSidebar = firstMatch(root, RIGHT_SIDEBAR_SELECTORS);
  const RO = globalThis.ResizeObserver;
  if (typeof RO === "function") {
    try {
      const ro = new RO(() => place());
      if (article) ro.observe(article);
      if (sidebar) ro.observe(sidebar);
      if (rightSidebar && rightSidebar !== sidebar && rightSidebar !== article) ro.observe(rightSidebar);
      disconnects.push(() => ro.disconnect());
    } catch {
    }
  }
  const MO = globalThis.MutationObserver;
  if (typeof MO === "function" && article) {
    try {
      const mo = new MO(() => placeAfterAnim());
      mo.observe(article, { attributes: true, attributeFilter: ["class"] });
      disconnects.push(() => mo.disconnect());
    } catch {
    }
  }
  const cancel = raf(place);
  return () => {
    alive = false;
    cancel();
    disconnects.forEach((d) => d());
  };
}
function watchRouteExit({ boardUid, onExit, win = globalThis.window } = {}) {
  if (!win?.addEventListener) return () => {
  };
  const check = () => {
    const hash = win.location?.hash || "";
    if (routeLeftZoomedDiagram(boardUid, hash)) onExit?.();
  };
  win.addEventListener("hashchange", check);
  win.addEventListener("popstate", check);
  return () => {
    win.removeEventListener("hashchange", check);
    win.removeEventListener("popstate", check);
  };
}

// src/view/later-views.js
var TITLES = { gallery: "Gallery", timeline: "Timeline", graph: "Graph" };
function mountLater({ doc = globalThis.document, root, getBoard, onClose } = {}) {
  const box2 = doc.createElement("div");
  box2.className = "pxd-later pxd-chrome";
  box2.hidden = true;
  root?.append(box2);
  const bar = doc.createElement("div");
  bar.className = "pxd-later__bar";
  const title = doc.createElement("span");
  title.className = "pxd-later__title";
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "pxd-btn pxd-later__close";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close");
  bar.append(title, close);
  const body = doc.createElement("div");
  body.className = "pxd-later__body";
  box2.append(bar, body);
  let mode = null;
  const offs = [];
  const listen = (el, type, fn) => {
    el.addEventListener(type, fn);
    offs.push(() => el.removeEventListener(type, fn));
  };
  const stop = (event) => event.stopPropagation?.();
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"]) {
    listen(box2, type, stop);
  }
  listen(close, "click", (event) => {
    stop(event);
    onClose?.();
  });
  const paint2 = () => {
    body.replaceChildren();
    const board2 = getBoard?.();
    if (!board2 || !mode) return;
    if (mode === "gallery") {
      const tiles = galleryGrid(galleryItems(board2));
      if (!tiles.length) {
        body.textContent = "No images on this board";
        return;
      }
      for (const tile of tiles) {
        const cell = doc.createElement("figure");
        cell.className = "pxd-later__tile";
        if (tile.src) {
          const img = doc.createElement("img");
          img.alt = tile.title || "";
          img.src = tile.src;
          cell.append(img);
        }
        const cap2 = doc.createElement("figcaption");
        cap2.textContent = tile.title || "Image";
        cell.append(cap2);
        body.append(cell);
      }
      return;
    }
    if (mode === "timeline") {
      const cards = [...board2.items.values()].filter((item) => item.type === "card");
      const axis = timelineAxis(cards);
      if (!axis.length) {
        body.textContent = "No dated cards";
        return;
      }
      for (const spot of axis) {
        const node2 = doc.createElement("div");
        node2.className = "pxd-later__tick";
        node2.style.left = `${Math.round(spot.x)}px`;
        node2.textContent = spot.title || spot.uid;
        body.append(node2);
      }
      return;
    }
    const graph = derivedGraph(board2);
    const pos = graphLayout(graph.nodes, graph.links);
    if (!pos.size) {
      body.textContent = "No cards to graph";
      return;
    }
    for (const [uid, p] of pos) {
      const node2 = doc.createElement("div");
      node2.className = "pxd-later__node";
      node2.style.left = `${Math.round(160 + p.x)}px`;
      node2.style.top = `${Math.round(120 + p.y)}px`;
      node2.textContent = cardLabel(board2.items.get(uid)) || uid;
      body.append(node2);
    }
  };
  return {
    open(next) {
      if (!TITLES[next]) return false;
      mode = next;
      title.textContent = TITLES[next];
      box2.hidden = false;
      paint2();
      return true;
    },
    close() {
      mode = null;
      box2.hidden = true;
      body.replaceChildren();
    },
    refresh() {
      if (mode) paint2();
    },
    isOpen: () => Boolean(mode),
    mode: () => mode,
    dispose() {
      mode = null;
      offs.splice(0).forEach((off) => off());
      box2.remove();
    }
  };
}
function mountPrintSheet(doc, board2) {
  const sheet = doc.createElement("div");
  sheet.className = "pxd-print";
  for (const page of printPages(board2)) {
    const section2 = doc.createElement("section");
    section2.className = "pxd-print__page";
    section2.dataset.uid = page.uid;
    const heading = doc.createElement("h1");
    heading.textContent = page.title;
    section2.append(heading);
    sheet.append(section2);
  }
  return sheet;
}

// src/view/board-view.js
var SVG_NS3 = "http://www.w3.org/2000/svg";
var pointerBoard = null;
function sidebarMountKind(nativeEl) {
  const win = nativeEl?.closest?.(".rm-sidebar-window");
  if (!win) return "main";
  const id = String(win.id || "");
  if (id.includes("mentions")) return "mentions";
  if (id.includes("outline")) return "outline";
  return "block";
}
function viewportStorageId(nativeEl, boardUid, readString) {
  const kind = sidebarMountKind(nativeEl);
  if (kind !== "main") return `${boardUid}:${kind}`;
  const owner = embedOwnerUid(nativeEl, readString);
  if (owner) return `${boardUid}:embed:${owner}`;
  return boardUid;
}
var DEFAULT_HEIGHT = 560;
function rasterizeSvg(doc, svg) {
  return new Promise((resolve, reject) => {
    const Img = doc.defaultView?.Image || globalThis.Image;
    if (typeof Img !== "function" || typeof URL === "undefined" || typeof Blob === "undefined") {
      resolve(null);
      return;
    }
    const img = new Img();
    let url = "";
    try {
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    } catch {
      resolve(null);
      return;
    }
    img.onload = () => {
      try {
        const canvas = doc.createElement("canvas");
        const w = img.naturalWidth || img.width || 1;
        const h = img.naturalHeight || img.height || 1;
        canvas.width = Math.max(1, Math.round(w * 2));
        canvas.height = Math.max(1, Math.round(h * 2));
        const g = canvas.getContext?.("2d");
        if (!g || typeof canvas.toBlob !== "function") {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        g.setTransform(2, 0, 0, 2, 0, 0);
        g.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        }, "image/png");
      } catch (err) {
        try {
          URL.revokeObjectURL(url);
        } catch {
        }
        reject(err);
      }
    };
    img.onerror = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
      }
      resolve(null);
    };
    img.src = url;
  });
}
function freshCardIsBlank({ blockString, itemString, contentCount = 0, editorText = "" } = {}) {
  if (contentCount > 0) return false;
  return ![blockString, itemString, editorText].some((s) => String(s ?? "").trim());
}
function editingPlainText(root) {
  const editor = root.querySelector?.(".pxd-item--editing .pxd-item__editor");
  if (!editor) return "";
  const areas = typeof editor.querySelectorAll === "function" ? [...editor.querySelectorAll("textarea")] : [];
  if (areas.length) return areas.map((t) => t.value || "").join("\n");
  return typeof editor.textContent === "string" ? editor.textContent : "";
}
function commitTextareaValue(el, value) {
  if (!el) return;
  const view = el.ownerDocument?.defaultView || globalThis;
  const Proto = view.HTMLTextAreaElement;
  const set = Proto && Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set;
  if (typeof set === "function") {
    try {
      set.call(el, value);
    } catch {
      el.value = value;
    }
  } else el.value = value;
  try {
    const Ev = view.Event || globalThis.Event;
    if (typeof Ev === "function" && typeof el.dispatchEvent === "function") {
      el.dispatchEvent(new Ev("input", { bubbles: true }));
      el.dispatchEvent(new Ev("change", { bubbles: true }));
    }
  } catch {
  }
}
var MIN_HEIGHT = 240;
var RESUME_MS = 120;
var VP_PERSIST_MS = 500;
var SECTION_TITLE_ALLOWANCE = 32;
var CULL_MARGIN = 0.5;
var BADGE_TTL_MS = 12e4;
var BADGE_CHUNK = 12;
var NATIVE_MENU_TARGETS = ".rm-page-ref, .rm-block-ref, [data-link-uid], a[href], img";
function nativeClickKind(node2) {
  if (!node2 || typeof node2.closest !== "function") return null;
  if (node2.closest("img")) return "image";
  const box2 = node2.closest("input, label, .check-container");
  if (box2) {
    const tag = String(box2.tagName || "").toLowerCase();
    if (tag === "input") {
      if (String(box2.getAttribute?.("type") || "").toLowerCase() === "checkbox") return "checkbox";
    } else if (box2.classList?.contains("check-container") || box2.querySelector?.('input[type="checkbox"]')) {
      return "checkbox";
    }
  }
  if (node2.closest("[data-link-uid], .rm-page-ref, .rm-block-ref")) return "ref";
  return null;
}
function pageRenameNeedsConfirm(refCount) {
  return Number(refCount) > 10;
}
function toggleTodoAt(string, index = 0) {
  if (typeof string !== "string") return null;
  const marks = [...string.matchAll(/\{\{\[\[(?:TODO|DONE)\]\]\}\}/g)];
  const mark = marks[index];
  if (!mark) return null;
  const next = mark[0].includes("TODO") ? "{{[[DONE]]}}" : "{{[[TODO]]}}";
  return string.slice(0, mark.index) + next + string.slice(mark.index + mark[0].length);
}
var BADGE_MAX = 60;
var NOTE_KINDS2 = ["note", "block", "page"];
function createTimers() {
  const active = /* @__PURE__ */ new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      active.delete(entry);
      fn();
    }, ms);
    const entry = () => {
      clearTimeout(id);
      active.delete(entry);
    };
    active.add(entry);
    return entry;
  };
  const frame = (fn) => {
    const raf2 = globalThis.requestAnimationFrame;
    let entry;
    if (typeof raf2 === "function") {
      const id = raf2((t) => {
        active.delete(entry);
        fn(t);
      });
      entry = () => {
        globalThis.cancelAnimationFrame?.(id);
        active.delete(entry);
      };
    } else {
      const id = setTimeout(() => {
        active.delete(entry);
        fn(Date.now());
      }, 16);
      entry = () => {
        clearTimeout(id);
        active.delete(entry);
      };
    }
    active.add(entry);
    return entry;
  };
  const idle = (fn) => {
    const ric = globalThis.requestIdleCallback;
    let entry;
    if (typeof ric === "function") {
      const id = ric((d) => {
        active.delete(entry);
        fn(d);
      });
      entry = () => {
        globalThis.cancelIdleCallback?.(id);
        active.delete(entry);
      };
    } else {
      const id = setTimeout(() => {
        active.delete(entry);
        fn({ timeRemaining: () => 8, didTimeout: true });
      }, 0);
      entry = () => {
        clearTimeout(id);
        active.delete(entry);
      };
    }
    active.add(entry);
    return entry;
  };
  return { later, frame, idle, count: () => active.size, cancelAll: () => {
    for (const c of [...active]) c();
    active.clear();
  } };
}
function isDarkHost(root, doc = globalThis.document) {
  const has = (el, name) => Boolean(el?.classList?.contains?.(name));
  let node2 = root;
  while (node2) {
    if (has(node2, "bp3-dark") || has(node2, "rm-dark-theme") || has(node2, "bt-theme-dark")) return true;
    if (has(node2, "roam-body") && has(node2, "dark")) return true;
    node2 = node2.parentElement;
  }
  const body = doc?.body;
  const html = doc?.documentElement;
  if (has(html, "bp3-dark") || has(body, "bt-theme-dark") || has(body, "bp3-dark") || has(body, "rm-dark-theme")) return true;
  if (has(body, "roam-body") && has(body, "dark")) return true;
  return false;
}
var rgbOf = (value) => {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const a = m[4] == null ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
};
function isLightHost(root, doc = globalThis.document, win = globalThis.window) {
  if (isDarkHost(root, doc)) return false;
  if (typeof win?.getComputedStyle !== "function") return false;
  for (let node2 = root; node2; node2 = node2.parentElement) {
    let color;
    try {
      color = rgbOf(win.getComputedStyle(node2)?.backgroundColor);
    } catch {
      return false;
    }
    if (!color || color.a < 0.5) continue;
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255 > 0.6;
  }
  return false;
}
function graphName2(win = globalThis.window) {
  const m = /#\/app\/([^/]+)/.exec(String(win?.location?.hash || ""));
  return m ? decodeURIComponent(m[1]) : "graph";
}
function createLocalViewportStore({ storage, graph, timers }) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const pending = /* @__PURE__ */ new Map();
  return {
    get(uid) {
      try {
        const raw = storage?.getItem?.(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch {
        return null;
      }
    },
    set(uid, vp) {
      if (!storage?.setItem) return;
      const write = () => {
        pending.delete(uid);
        try {
          storage.setItem(key(uid), JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom }));
        } catch {
        }
      };
      if (pending.has(uid)) {
        pending.get(uid).vp = vp;
        return;
      }
      const entry = { vp, cancel: timers.later(() => write(), VP_PERSIST_MS) };
      pending.set(uid, entry);
    },
    flush() {
      for (const [uid, e] of pending) {
        e.cancel();
        try {
          storage?.setItem?.(key(uid), JSON.stringify(e.vp));
        } catch {
        }
      }
      pending.clear();
    }
  };
}
function mountBoardView({
  host,
  session,
  mountEl,
  nativeEl = null,
  settings,
  onRequestFullscreen,
  fullscreen = false,
  version = "",
  crumbs = null,
  onOpenBoard = null,
  onCrumb = null,
  onHistoryBack = null,
  onHistoryForward = null,
  initialViewport = null,
  routeUid = session.uid,
  autofocus = false,
  onSetDefaults = null
} = {}) {
  const doc = globalThis.document;
  const win = globalThis.window;
  let settingsRef = settings;
  const readSetting = (k) => typeof settingsRef?.get === "function" ? settingsRef.get(k) : settingsRef?.[k];
  const settingsProxy = { get: readSetting };
  const setting = (k, d) => {
    const v = readSetting(k);
    return v === void 0 || v === null ? d : v;
  };
  const flag = (k, d) => {
    const v = setting(k, d);
    return v === false || v === "false" ? false : v === true || v === "true" ? true : Boolean(v);
  };
  let motionMq = null;
  try {
    motionMq = win?.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
  } catch {
    motionMq = null;
  }
  const prefersReducedMotion = () => Boolean(motionMq?.matches);
  const currentMotion = () => resolveMotion(setting("motion", "full"), prefersReducedMotion());
  const timers = createTimers();
  const listeners2 = [];
  const observers = [];
  const subs = [];
  const listen = (el2, type, fn, opts) => {
    el2.addEventListener(type, fn, opts);
    const off = () => el2.removeEventListener(type, fn, opts);
    listeners2.push(off);
    return off;
  };
  const el = (tag, cls, parent) => {
    const node2 = doc.createElement(tag);
    node2.className = cls;
    parent?.append(node2);
    return node2;
  };
  const svg = (cls, parent) => {
    const node2 = doc.createElementNS(SVG_NS3, "svg");
    node2.setAttribute("class", cls);
    if (node2.classList && !node2.classList.contains(cls)) node2.className = cls;
    parent?.append(node2);
    return node2;
  };
  const boardUid = session.uid;
  const graph = host?.graph || graphName2(win);
  const storage = globalThis.localStorage;
  const vpStore = host?.viewports || host?.viewportStore || createLocalViewportStore({ storage, graph, timers });
  const heightKey = `plexus-diagram:h:${graph}:${routeUid}`;
  const root = el("div", "pxd-root", mountEl);
  root.tabIndex = 0;
  root.setAttribute("tabindex", "0");
  root.setAttribute("role", "region");
  root.setAttribute("aria-roledescription", "whiteboard");
  root.setAttribute("aria-label", "Diagram");
  root.dataset.tool = "select";
  root.setAttribute("data-tool", "select");
  root.dataset.board = boardUid;
  const viewport = el("div", "pxd-viewport", root);
  const grid = el("div", "pxd-grid", viewport);
  const world = el("div", "pxd-world", viewport);
  const sectionsLayer = el("div", "pxd-sections", world);
  const edgesSvg = svg("pxd-edges", world);
  const labelsLayer = el("div", "pxd-labels", world);
  const itemsLayer = el("div", "pxd-items", world);
  const overlaySvg = svg("pxd-overlay", world);
  const emptyHint = el("div", "pxd-empty pxd-chrome", root);
  const resizeGrip = el("div", "pxd-resize-grip pxd-chrome", root);
  resizeGrip.title = "Drag to resize the board";
  const applyTheme = () => {
    const dark = isDarkHost(mountEl, doc);
    root.classList.toggle("pxd-root--dark", dark);
    root.classList.toggle("pxd-root--light", !dark && isLightHost(mountEl, doc, globalThis.window));
  };
  applyTheme();
  const readBlock = (id) => {
    try {
      return host?.blockString?.(id);
    } catch {
      return null;
    }
  };
  const inSidebar = sidebarMountKind(nativeEl) !== "main";
  const vpId = viewportStorageId(nativeEl, boardUid, readBlock);
  const embedCopy = vpId !== boardUid && vpId.startsWith(`${boardUid}:embed:`);
  let vp = vpStore.get(vpId);
  if (!vp && embedCopy) {
    const main = vpStore.get(boardUid);
    if (main && Number.isFinite(main.x) && Number.isFinite(main.y) && Number.isFinite(main.zoom) && main.zoom > 0) {
      vp = { x: main.x, y: main.y, zoom: main.zoom };
    }
  }
  if (initialViewport && Number.isFinite(initialViewport.x) && Number.isFinite(initialViewport.y) && Number.isFinite(initialViewport.zoom) && initialViewport.zoom > 0) {
    vp = { x: initialViewport.x, y: initialViewport.y, zoom: initialViewport.zoom };
  }
  let size = { width: 0, height: 0 };
  let rootRect = { left: 0, top: 0, width: 0, height: 0 };
  let disposed = false;
  let released = false;
  let gesturing = false;
  let isFullscreen = false;
  let pointerInside = Boolean(mountEl?.matches?.(":hover"));
  let suppressClick = false;
  let swallowMouseUp = false;
  let linkMode = setting("graph-links", "all");
  let selection = { items: [], edge: null, link: null };
  let liveRects = null;
  let grown = /* @__PURE__ */ new Set();
  let tier = "detail";
  let bgPattern;
  let bgTone;
  let bgHex = null;
  let bgImage = null;
  let bgOverride = false;
  let timerHud = null;
  let timerState = null;
  let timerTick = null;
  let focusOn = false;
  let focusKey = null;
  let lensTag = null;
  let lensIndex = /* @__PURE__ */ new Map();
  let presentSet = null;
  let sendPending = null;
  let menuCtx = null;
  let lastPayload = null;
  let lastPointer = null;
  let backVisible = false;
  let badgeTimer = null;
  const badgeCache = /* @__PURE__ */ new Map();
  const badgePending = /* @__PURE__ */ new Set();
  let resumeTimer = null;
  let settleTimer = null;
  let searchMatches = [];
  let searchIndex = -1;
  let frameHandle = null;
  let fsDispose = () => {
  };
  let routeOff = () => {
  };
  const dirty = { viewport: false, items: /* @__PURE__ */ new Set(), edges: /* @__PURE__ */ new Set(), structural: false, all: true, selection: false, links: false, ctx: false, minimap: false };
  const board2 = () => session.board;
  let outlineMode = false;
  let outlineHost = null;
  let outlineKey = "";
  let outlineBtn = null;
  let boardBtn = null;
  const clearOutline = () => {
    if (!outlineHost) return;
    for (const row2 of [...outlineHost.children]) {
      try {
        host?.unmount?.(row2);
      } catch {
      }
    }
    outlineHost.replaceChildren();
  };
  const syncOutline = (force = false) => {
    if (!outlineMode || !outlineHost || disposed) return;
    const key = sidebarOutlineUids(board2()).join("\n");
    if (!force && key === outlineKey) return;
    outlineKey = key;
    clearOutline();
    if (typeof host?.renderBlock !== "function") return;
    for (const uid of sidebarOutlineUids(board2())) {
      const row2 = el("div", "pxd-sidebar-outline__row", outlineHost);
      row2.dataset.uid = uid;
      row2.setAttribute("data-uid", uid);
      try {
        host.renderBlock(row2, uid);
      } catch {
      }
    }
  };
  let tableMode = false;
  let tableCtl = { open() {
  }, close() {
  }, refresh() {
  }, dispose() {
  } };
  let kanbanMode = false;
  let kanbanCtl = { open() {
  }, close() {
  }, refresh() {
  }, dispose() {
  } };
  let laterCtl = { open() {
    return false;
  }, close() {
  }, refresh() {
  }, isOpen() {
    return false;
  }, dispose() {
  } };
  const leaveOutline = () => {
    outlineMode = false;
    root.classList.remove("pxd-root--outline");
    outlineBtn?.classList.toggle("pxd-mode__btn--on", false);
    boardBtn?.classList.toggle("pxd-mode__btn--on", true);
    outlineKey = "";
    clearOutline();
  };
  const setTable = (on) => {
    const next = Boolean(on);
    if (next && outlineMode) leaveOutline();
    if (next && kanbanMode) setKanban(false);
    if (next) laterCtl.close();
    tableMode = next;
    root.classList.toggle("pxd-root--table", tableMode);
    chrome?.toolbar?.setTable?.(tableMode);
    if (tableMode) tableCtl.open();
    else tableCtl.close();
  };
  const setKanban = (on) => {
    const next = Boolean(on);
    if (next && outlineMode) leaveOutline();
    if (next && tableMode) setTable(false);
    if (next) laterCtl.close();
    kanbanMode = next;
    root.classList.toggle("pxd-root--kanban", kanbanMode);
    chrome?.toolbar?.setKanban?.(kanbanMode);
    if (kanbanMode) kanbanCtl.open();
    else kanbanCtl.close();
  };
  const setOutline = (on) => {
    outlineMode = Boolean(on);
    if (outlineMode && tableMode) setTable(false);
    if (outlineMode && kanbanMode) setKanban(false);
    root.classList.toggle("pxd-root--outline", outlineMode);
    outlineBtn?.classList.toggle("pxd-mode__btn--on", outlineMode);
    boardBtn?.classList.toggle("pxd-mode__btn--on", !outlineMode);
    if (outlineMode) syncOutline(true);
    else {
      outlineKey = "";
      clearOutline();
    }
  };
  if (inSidebar) {
    root.classList.add("pxd-root--sidebar");
    const modeBar = el("div", "pxd-mode pxd-chrome", root);
    modeBar.setAttribute("role", "group");
    modeBar.setAttribute("aria-label", "Sidebar view");
    const modeBtn = (cls, label, on) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `pxd-mode__btn ${cls}`;
      b.textContent = label;
      b.setAttribute("aria-label", label);
      modeBar.append(b);
      listen(b, "click", on);
      return b;
    };
    outlineBtn = modeBtn("pxd-mode__outline", "Outline", () => setOutline(true));
    boardBtn = modeBtn("pxd-mode__board", "Board", () => setOutline(false));
    outlineHost = el("div", "pxd-sidebar-outline pxd-chrome", root);
  }
  const rects = () => session.rects || worldRects(board2());
  const effectiveRects = () => {
    if (!liveRects) return rects();
    const merged = new Map(rects());
    for (const [k, v] of liveRects) merged.set(k, v);
    return merged;
  };
  const paintRects = () => {
    const b = board2();
    const base = effectiveRects();
    return b ? displayRects(b, base) : base;
  };
  const measure = () => {
    const r = root.getBoundingClientRect();
    rootRect = { left: r.left || 0, top: r.top || 0, width: r.width || 0, height: r.height || 0 };
    size = { width: rootRect.width, height: rootRect.height };
  };
  const itemsR = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers,
    onEditChange: (uid) => {
      root.classList.toggle("pxd-root--editing", Boolean(uid));
      if (!uid && grown.size) {
        liveRects = null;
        resetGrown();
      }
    },
    onEditResize: (uid, h) => {
      const r = board2() && rects().get(uid);
      if (disposed || !r) return;
      liveRects = /* @__PURE__ */ new Map();
      if (h > r.h) liveRects.set(uid, { ...r, h });
      previewFit([uid]);
    },
    onOpenBoard: (uid) => {
      void openBoard(uid);
    },
    onRenameBoard: (uid, title) => session.renameBoard?.(uid, title),
    onRenamePage: (from, to) => {
      const n2 = Number(host?.pageRefCount?.(from)) || 0;
      const go = () => host?.renamePage?.(from, to);
      if (!pageRenameNeedsConfirm(n2)) return go();
      chrome.toast.show({
        message: `${n2} blocks link to ${from}. Rename it to ${to}?`,
        action: { label: "Rename", run: () => {
          void go();
        } }
      });
      return false;
    },
    onBadgeClick: (uid) => {
      ctl.select([uid]);
      panel.open("related");
    },
    onPageLayout: (uid) => {
      if (blockCards.has(uid)) scheduleAnchors();
    }
  });
  const edgesR = createEdgeLayer({
    doc,
    svg: edgesSvg,
    labelsLayer,
    overlaySvg,
    onLabelCommit: (uid, label) => session.updateEdge?.(uid, { label }),
    blockText: (uid) => host?.blockString?.(uid)
  });
  const blockCards = /* @__PURE__ */ new Set();
  let anchorFrame = false;
  const refreshBlockCards = () => {
    blockCards.clear();
    const b = board2();
    if (!b) return false;
    for (const e of b.edges.values()) {
      if (e.fromBlock) blockCards.add(e.from);
      if (e.toBlock) blockCards.add(e.to);
    }
    return blockCards.size > 0;
  };
  const runAnchors = () => {
    anchorFrame = false;
    const b = board2();
    if (disposed || !b) return;
    refreshBlockCards();
    const next = /* @__PURE__ */ new Map();
    for (const e of b.edges.values()) {
      if (!e.fromBlock && !e.toBlock) continue;
      const m = {};
      if (e.fromBlock) {
        const x = itemsR.measureRow(e.from, e.fromBlock);
        if (x) m.from = x;
      }
      if (e.toBlock) {
        const x = itemsR.measureRow(e.to, e.toBlock);
        if (x) m.to = x;
      }
      if (m.from || m.to) next.set(e.uid, m);
    }
    const changed2 = edgesR.setMeasures(next);
    if (changed2.size) edgesR.update({ board: b, edgeUids: changed2, rects: paintRects(), zoom: vp.zoom });
  };
  function scheduleAnchors() {
    if (disposed || anchorFrame) return;
    anchorFrame = true;
    timers.frame(runAnchors);
  }
  const schedule = () => {
    if (disposed || frameHandle) return;
    frameHandle = timers.frame(() => {
      frameHandle = null;
      renderFrame();
    });
  };
  const markViewport = () => {
    dirty.viewport = true;
    schedule();
  };
  const markAll = () => {
    dirty.all = true;
    dirty.structural = true;
    schedule();
  };
  const setViewport = (next) => {
    if (!next) return;
    vp = { x: next.x, y: next.y, zoom: next.zoom };
    markViewport();
    if (!gesturing) settle();
  };
  let zoomOff = null;
  const clearZoomAnim = () => {
    if (zoomOff) {
      zoomOff();
      zoomOff = null;
    }
    root.classList.remove("pxd-root--zooming");
  };
  const armZoomAnim = () => {
    const ms = motionProfile(currentMotion()).zoomMs;
    clearZoomAnim();
    if (ms <= 0) return;
    root.classList.add("pxd-root--zooming");
    zoomOff = timers.later(() => {
      zoomOff = null;
      if (!disposed) root.classList.remove("pxd-root--zooming");
    }, ms);
  };
  const animateViewport = (next) => {
    armZoomAnim();
    setViewport(next);
  };
  const moveViewport = (next) => {
    clearZoomAnim();
    setViewport(next);
  };
  const fitInsets = (bounds) => {
    const rr = root.getBoundingClientRect?.() || rootRect;
    const tb = chrome.toolbar.el?.getBoundingClientRect?.();
    const pel = panel.el?.style?.display !== "none" ? panel.el?.getBoundingClientRect?.() : null;
    const b = board2();
    const r = b ? rects() : null;
    const titled = Boolean(bounds && b && [...b.items.values()].some((it) => it.type === "section" && r.get(it.uid) && r.get(it.uid).y <= bounds.y + 0.5));
    return {
      top: (tb?.height ? Math.max(0, tb.bottom - (rr.top || 0)) : 0) + (titled ? SECTION_TITLE_ALLOWANCE : 0),
      right: pel?.width ? Math.max(0, Math.min(size.width, (rr.left || 0) + size.width - pel.left)) : 0
    };
  };
  const fitTo = (bounds, opts = {}) => {
    if (!size.width || !size.height) measure();
    animateViewport(fitViewport(bounds, size, { padding: 64, maxZoom: opts.maxZoom ?? 1.5, insets: fitInsets(bounds) }));
  };
  const fitAll = () => fitTo(boundsOf([...rects().values()]));
  const fitSelection = (uids) => {
    const r = rects();
    const b = boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
    if (b) fitTo(b, { maxZoom: 1 });
  };
  const centerOn = (worldPoint) => {
    moveViewport({ x: size.width / 2 - worldPoint.x * vp.zoom, y: size.height / 2 - worldPoint.y * vp.zoom, zoom: vp.zoom });
  };
  const mapThreshold = () => zoomThreshold(board2()?.plexus?.lodZoom, setting("map-zoom", "0.45"));
  const paintTier = () => {
    root.classList.toggle("pxd-lod-map", tier !== "detail");
    root.classList.toggle("pxd-lod-overview", tier === "overview");
    const f = lodFonts(vp.zoom);
    root.style.setProperty("--pxd-map-font", `${f.map}px`);
    root.style.setProperty("--pxd-ui", String(f.ui));
    root.style.setProperty("--pxd-overview-font", `${f.section}px`);
    itemsR.setLod(tier, vp.zoom);
  };
  const applyLod = () => {
    tier = lodTier(vp.zoom, tier, { threshold: mapThreshold() });
    paintTier();
  };
  const scheduleContent = () => {
    if (disposed || gesturing || !board2()) return;
    itemsR.scheduleContent({ visibleRect: visibleWorldRect(vp, size, CULL_MARGIN), zoom: vp.zoom, tier });
  };
  const updateBackToContent = () => {
    if (disposed) return;
    let show = false;
    if (size.width && size.height) {
      const r = rects();
      if (r.size) {
        const view2 = visibleWorldRect(vp, size, 0);
        show = true;
        for (const rect of r.values()) if (rectsIntersect(rect, view2)) {
          show = false;
          break;
        }
      }
    }
    if (show === backVisible) return;
    backVisible = show;
    chrome.backToContent.setVisible(show);
  };
  const badgeKeyOf = (item) => item.target.kind === "page" ? `page:${item.target.title}` : `uid:${item.target.uid || item.uid}`;
  const badgeTargetOf = (item) => item.target.kind === "page" ? { kind: "page", title: item.target.title } : { kind: "block", uid: item.target.uid || item.uid };
  const visibleBadgeItems = () => {
    const b = board2();
    if (!b) return [];
    const view2 = visibleWorldRect(vp, size, 0);
    const r = rects();
    const out = [];
    for (const item of b.items.values()) {
      if (out.length >= BADGE_MAX) break;
      if (item.type !== "card" || item.kind === "board" || item.kind === "image") continue;
      const rect = r.get(item.uid);
      if (rect && rectsIntersect(rect, view2)) out.push(item);
    }
    return out;
  };
  const applyBadges = () => {
    if (disposed) return;
    const map = /* @__PURE__ */ new Map();
    for (const item of visibleBadgeItems()) {
      const hit = badgeCache.get(badgeKeyOf(item));
      if (hit) map.set(item.uid, hit.stats);
    }
    itemsR.setBadges(map);
  };
  const refreshBadges = () => {
    if (disposed || gesturing || !board2()) return;
    itemsR.setShowBadges(flag("show-card-badges", true));
    if (!flag("show-card-badges", true) || tier !== "detail" || typeof host?.cardStats !== "function") return;
    const items = visibleBadgeItems();
    const now2 = Date.now();
    const misses = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of items) {
      const key = badgeKeyOf(item);
      const hit = badgeCache.get(key);
      if (hit && now2 - hit.at < BADGE_TTL_MS || seen.has(key) || badgePending.has(key)) continue;
      seen.add(key);
      misses.push({ key, target: badgeTargetOf(item) });
    }
    if (!misses.length) {
      applyBadges();
      return;
    }
    for (const m of misses) badgePending.add(m.key);
    const runChunk = (list) => {
      if (disposed) return;
      const chunk = list.slice(0, BADGE_CHUNK);
      const rest = list.slice(BADGE_CHUNK);
      let res;
      try {
        res = host.cardStats(chunk.map((m) => m.target), { boardUid });
      } catch {
        res = void 0;
      }
      const at = Date.now();
      for (const m of chunk) {
        badgePending.delete(m.key);
        if (res === void 0) continue;
        const stats = res instanceof Map ? res.get(m.key) : res?.[m.key];
        badgeCache.set(m.key, { at, stats: stats || { refs: 0, boards: 0, open: 0, done: 0 } });
      }
      applyBadges();
      if (rest.length) timers.idle(() => runChunk(rest));
    };
    timers.idle(() => runChunk(misses));
  };
  const scheduleBadges = (ms = 0) => {
    if (disposed) return;
    badgeTimer?.();
    badgeTimer = timers.later(() => {
      badgeTimer = null;
      refreshBadges();
    }, ms);
  };
  const settle = () => {
    settleTimer?.();
    settleTimer = timers.later(() => {
      settleTimer = null;
      if (gesturing) return;
      applyLod();
      scheduleContent();
      vpStore.set(vpId, vp);
      dirty.edges = new Set(board2()?.edges.keys() || []);
      dirty.links = true;
      dirty.minimap = true;
      schedule();
      updateBackToContent();
      refreshBadges();
      refreshThumbnails();
    }, RESUME_MS);
  };
  const refreshThumbnails = () => {
    if (disposed || gesturing || !board2()) return;
    const view2 = visibleWorldRect(vp, size, 0);
    const r = rects();
    const candidates = [];
    for (const card2 of board2().items.values()) {
      if (card2.type !== "card" || card2.kind !== "block") continue;
      const rect = r.get(card2.uid);
      if (!rect || !rectsIntersect(rect, view2)) continue;
      let refString = "";
      try {
        refString = host?.blockString?.(card2.target?.uid) || "";
      } catch {
        refString = "";
      }
      if (classifyString(refString).kind !== "board") continue;
      candidates.push(card2.uid);
    }
    const batch = thumbnailBudget(candidates);
    if (batch.length) itemsR.expireContent?.(batch);
  };
  const paintTimer = () => {
    if (!timerHud || !timerState) return;
    const secs = Math.ceil(timerState.remainingMs / 1e3);
    const m = Math.floor(secs / 60);
    timerHud.textContent = `${m}:${String(secs % 60).padStart(2, "0")}`;
  };
  const stopTimer = () => {
    timerTick?.();
    timerTick = null;
    timerHud?.remove();
    timerHud = null;
    timerState = null;
  };
  const armTimer = () => {
    timerTick?.();
    timerTick = timers.later(() => {
      timerTick = null;
      if (!timerState?.running || disposed) return;
      timerState = timerStep(timerState, Date.now());
      paintTimer();
      if (timerState.running) armTimer();
      else toast("Focus timer done");
    }, 1e3);
  };
  const selectedItems = () => selection.items.map((u) => board2()?.items.get(u)).filter(Boolean);
  const toScreenRect = (r) => {
    const p = worldToScreen(vp, { x: r.x, y: r.y });
    return { x: p.x, y: p.y, w: r.w * vp.zoom, h: r.h * vp.zoom };
  };
  const pathScreenRect = (geo, extra) => {
    const pts = [geo.start, geo.end, geo.mid].filter(Boolean).map((p) => worldToScreen(vp, p));
    for (const r of extra) pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
    const xs2 = pts.map((p) => p.x);
    const ys2 = pts.map((p) => p.y);
    const x = Math.min(...xs2);
    const y = Math.min(...ys2);
    return { x, y, w: Math.max(...xs2) - x, h: Math.max(...ys2) - y };
  };
  const ctxAnchor = () => {
    const b = board2();
    if (!b) return null;
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      const geo = edgesR.geometryOf(selection.edge);
      if (!edge || !geo) return null;
      const lr = edge.label ? edgesR.labelRect(selection.edge) : null;
      const extra = lr && lr.width ? [{ x: lr.left - rootRect.left, y: lr.top - rootRect.top, w: lr.width, h: lr.height }] : [];
      return { kind: "edge", rect: pathScreenRect(geo, extra) };
    }
    if (selection.link) {
      const geo = edgesR.linkGeometryOf(selection.link);
      if (!geo) return null;
      return { kind: "edge", rect: pathScreenRect(geo, []) };
    }
    const r = paintRects();
    const bounds = boundsOf(selection.items.map((u) => r.get(u)).filter(Boolean));
    return bounds ? { kind: "items", rect: toScreenRect(bounds) } : null;
  };
  const refCountOf = (item) => {
    if (!item || item.type !== "card") return 0;
    const key = badgeKeyOf(item);
    const hit = badgeCache.get(key);
    if (hit) return Number(hit.stats?.refs) || 0;
    if (typeof host?.cardStats !== "function") return 0;
    let res;
    try {
      res = host.cardStats([badgeTargetOf(item)], { boardUid });
    } catch {
      return 0;
    }
    const stats = (res instanceof Map ? res.get(key) : res?.[key]) || { refs: 0, boards: 0, open: 0, done: 0 };
    badgeCache.set(key, { at: Date.now(), stats });
    return Number(stats.refs) || 0;
  };
  const cardModel = (item) => item?.type === "card" ? { ...item, refs: refCountOf(item) } : item;
  const sectionModel = (item) => {
    const b = board2();
    const uids = b ? [item.uid, ...descendantsOf(b, item.uid)] : [item.uid];
    return {
      ...item,
      hasNote: Boolean(b && sectionNoteUid(b, item.uid)),
      locked: Boolean(b) && uids.every((u) => b.items.get(u)?.pinned)
    };
  };
  const showCtx = () => {
    const b = board2();
    if (!b) return chrome.ctx.hide();
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      return edge ? chrome.ctx.show("edge", edge, ctxAnchor) : chrome.ctx.hide();
    }
    if (selection.link) {
      const link = (session.links || []).find((l) => l.key === selection.link);
      return link ? chrome.ctx.show("link", link, ctxAnchor) : chrome.ctx.hide();
    }
    const items = selectedItems();
    if (!items.length) return chrome.ctx.hide();
    if (items.length > 1) {
      const model2 = { count: items.length, allPinned: items.every((i) => i.pinned), anyCollapsed: items.some((i) => i.type === "card" && i.collapsed) };
      return chrome.ctx.show("cards", model2, ctxAnchor);
    }
    const it = items[0];
    const kind = it.type === "section" ? "section" : it.type === "text" ? "text" : it.kind === "board" ? "board" : "card";
    const model = it.type === "section" ? sectionModel(it) : cardModel(it);
    return chrome.ctx.show(kind, model, ctxAnchor);
  };
  const targetUids = () => selection.edge ? [selection.edge] : selection.items;
  const singleItem = () => selection.items.length === 1 ? board2()?.items.get(selection.items[0]) : null;
  let hoverUid = null;
  const selectionOwnsBar = () => Boolean(selection.edge || selection.link || selection.items.length);
  const barCard = () => {
    const sel = singleItem();
    if (sel?.type === "card") return sel;
    if (!selectionOwnsBar() && hoverUid) {
      const it = board2()?.items.get(hoverUid);
      if (it?.type === "card") return it;
    }
    return null;
  };
  const mentionsUid = (item) => {
    if (!item) return null;
    if (item.target?.kind === "page") return host?.pageUid?.(item.target.title) || null;
    if (item.target?.kind === "block") return item.target.uid || null;
    return item.uid;
  };
  const openBoardOutline = () => {
    const uid = board2()?.uid;
    if (uid) host?.openInSidebar?.(uid, "outline");
  };
  const openItemInSidebar = (item) => {
    if (!item) return;
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) host?.openInSidebar?.(uid, "outline");
    } else {
      host?.openInSidebar?.(item.target.uid || item.uid, "block");
    }
  };
  const stackAt = (strings, x, y, h) => strings.map((string, i) => ({ string, x, y: y + i * (h + 24) }));
  const addStringsBeside = (strings) => {
    const b = board2();
    if (!b || !strings.length) return;
    const r = rects();
    const sel = singleItem();
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    let x;
    let y;
    if (sel && r.get(sel.uid)) {
      const sr = r.get(sel.uid);
      x = sr.x + sr.w + 40;
      y = sr.y;
    } else {
      const c = screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
      x = c.x - w / 2;
      y = c.y - h / 2;
    }
    void session.addRefCards?.(stackAt(strings, x, y, h));
  };
  const isOnBoard = (string) => {
    const b = board2();
    if (!b) return false;
    const s = String(string || "").trim();
    for (const item of b.items.values()) {
      if (item.string.trim() === s || semanticRef(item) === s) return true;
    }
    return false;
  };
  const crumbList = Array.isArray(crumbs) ? crumbs : [];
  const boardTargetOf = (uid) => {
    const item = board2()?.items.get(uid);
    if (item?.kind === "board") return uid;
    const ref = item ? item.kind === "block" ? item.target?.uid : null : uid;
    if (!ref || typeof host?.blockString !== "function") return null;
    return classifyString(host.blockString(ref)).kind === "board" ? ref : null;
  };
  const openBoard = async (uid) => {
    const target = boardTargetOf(uid);
    if (!target) return;
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    if (onOpenBoard) onOpenBoard(target);
    else host?.openBlock?.(target);
  };
  const openOwnPage = (item) => {
    const target = item ? boardTargetOf(item.uid) : null;
    if (target) host?.openBlock?.(target);
  };
  const goCrumb = async (index) => {
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    onCrumb?.(index);
  };
  const popBoard = () => {
    if (crumbList.length > 1 && onCrumb) {
      void goCrumb(crumbList.length - 2);
      return true;
    }
    return false;
  };
  const toast = (message, undo = false) => chrome.toast.show({ message, action: undo ? { label: "Undo", run: () => session.undo?.() } : void 0 });
  const lastSelected = () => selection.items[selection.items.length - 1] ?? null;
  const viewCenterWorld = () => screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
  const cardsIn = (uids) => {
    const b = board2();
    const out = /* @__PURE__ */ new Set();
    if (!b) return [];
    for (const uid of uids) {
      const it = b.items.get(uid);
      if (!it) continue;
      if (it.type === "card") out.add(uid);
      else if (it.type === "section") {
        for (const d of descendantsOf(b, uid)) if (b.items.get(d)?.type === "card") out.add(d);
      }
    }
    return [...out];
  };
  const afterCreate = (label) => (res) => {
    if (disposed) return;
    const list = Array.isArray(res) ? res : [];
    if (!list.length) return;
    ctl.select(list);
    const types = new Set(list.map((u) => board2()?.items.get(u)?.type ?? "card"));
    const noun = types.size === 1 && (types.has("card") || types.has("section")) ? [...types][0] : "item";
    toast(`${label} ${list.length} ${list.length === 1 ? noun : `${noun}s`}`, true);
  };
  const copyText = (text2, message) => {
    void writeClipboard({ text: text2 }).then((ok) => {
      if (!disposed) toast(ok ? message : "Copy failed");
    });
  };
  const openItem = (item) => {
    if (!item) return;
    if (item.kind === "board" || boardTargetOf(item.uid)) {
      void openBoard(item.uid);
      return;
    }
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) {
        if (host?.api?.ui?.mainWindow?.openPage) host.api.ui.mainWindow.openPage({ page: { uid } });
        else host?.openBlock?.(uid);
      }
      return;
    }
    host?.openBlock?.(item.target.uid || item.uid);
  };
  const applyBackground = () => {
    const b = board2();
    const own = b?.plexus;
    const ownPattern = BOARD_PATTERNS.includes(own?.bg) ? own.bg : null;
    const ownHex = hexColor(own?.bgColor) || null;
    const ownTone = ownHex ? null : BOARD_TONES.includes(own?.bgColor) ? own.bgColor : null;
    const defPattern = setting("grid", "dots");
    const defTone = setting("board-tone", "none");
    const pattern = ownPattern ?? (BOARD_PATTERNS.includes(defPattern) ? defPattern : "dots");
    const tone = ownHex ? null : ownTone ?? (BOARD_TONES.includes(defTone) ? defTone : null);
    const image = backgroundImage(own?.bgImage);
    const override = ownPattern !== null || ownTone !== null || ownHex !== null || Boolean(image);
    if (pattern === bgPattern && tone === bgTone && ownHex === bgHex && image === bgImage && override === bgOverride) return;
    if (pattern !== bgPattern) {
      grid.className = `pxd-grid pxd-grid--${pattern}`;
      if (bgPattern === "grid") for (const v of ["--pxd-grid-major", "--pxd-grid-major-x", "--pxd-grid-major-y"]) grid.style.removeProperty?.(v);
      bgPattern = pattern;
      dirty.viewport = true;
      schedule();
    }
    if (tone !== bgTone) {
      if (bgTone) root.classList.remove(`pxd-bg-${bgTone}`);
      if (tone) root.classList.add(`pxd-bg-${tone}`);
      bgTone = tone;
    }
    if (ownHex !== bgHex) {
      if (ownHex) {
        root.style.backgroundColor = ownHex;
        root.style.setProperty("--pxd-label-bg", ownHex);
      } else {
        root.style.backgroundColor = "";
        root.style.removeProperty("--pxd-label-bg");
      }
      bgHex = ownHex;
    }
    if (image !== bgImage) {
      grid.style.backgroundImage = image ? `url("${image}")` : "";
      grid.style.backgroundSize = image ? "cover" : "";
      grid.style.backgroundPosition = image ? "center" : "";
      bgImage = image;
    }
    bgOverride = override;
    chrome.toolbar.setBackground({ pattern, tone: ownHex || tone, override });
  };
  const applyMotion = () => {
    applyMotionClasses(root, currentMotion());
  };
  const focusSetNow = () => {
    const b = board2();
    if (presentSet) return presentSet;
    if (!focusOn || !b || !selection.items.length) return null;
    const sel = new Set(selection.items);
    const set = new Set(sel);
    for (const e of b.edges.values()) {
      if (!e.valid) continue;
      if (sel.has(e.from)) set.add(e.to);
      if (sel.has(e.to)) set.add(e.from);
    }
    for (const l of session.links || []) {
      if (sel.has(l.from)) set.add(l.to);
      if (sel.has(l.to)) set.add(l.from);
    }
    return set;
  };
  const extraTagText = (item) => {
    try {
      if (item?.kind === "page" && item.target?.title) {
        const page = host?.pullPage?.(item.target.title);
        return (page?.[":block/children"] || []).map((kid) => kid?.[":block/string"] || "").filter(Boolean).join("\n");
      }
      if (item?.kind === "block" && item.target?.uid) return host?.blockString?.(item.target.uid) || "";
    } catch {
    }
    return "";
  };
  const rebuildLens = () => {
    const cards = [];
    for (const item of board2()?.items.values() || []) {
      if (!item || item.type === "section") continue;
      cards.push({ uid: item.uid, tags: tagsForCard(item, extraTagText(item)) });
    }
    const catalog = lensCatalog(cards);
    lensIndex = catalog.byUid;
    return catalog;
  };
  const applyFocus = () => {
    if (disposed) return;
    const focus = focusSetNow();
    const set = lensTag ? lensBright(lensIndex, lensTag, focus) : focus;
    const key = `${lensTag || ""}|${set ? [...set].sort().join("|") : ""}`;
    root.classList.toggle("pxd-root--focus", Boolean(set) || focusOn || Boolean(lensTag));
    chrome.toolbar.setFocus(focusOn);
    chrome.toolbar.setLens?.(Boolean(lensTag));
    if (key === focusKey) return;
    focusKey = key;
    itemsR.setFocus(set);
    edgesR.setFocus(set);
  };
  const toggleFocus = () => {
    if (focusOn) {
      focusOn = false;
      applyFocus();
      return;
    }
    if (!selection.items.length) {
      toast("Select a card to focus on it");
      return;
    }
    focusOn = true;
    applyFocus();
  };
  const exitFocus = () => {
    if (!focusOn) return false;
    focusOn = false;
    applyFocus();
    return true;
  };
  const setFolded = (uids, value) => {
    const cards = cardsIn(uids);
    if (cards.length) void session.setCollapsedMany?.(cards, value);
  };
  const foldSelection = () => {
    const cards = cardsIn(selection.items);
    if (!cards.length) return;
    const b = board2();
    void session.setCollapsedMany?.(cards, cards.some((u) => !b.items.get(u).collapsed));
  };
  const alignSel = (mode, uids = selection.items) => {
    const r = rects();
    const b = board2();
    const list = uids.filter((uid) => !b?.items.get(uid)?.pinned).map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
    const moved = alignRects(list, mode).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
    void session.commitRects?.(moved);
  };
  const distributeSel = (axis, uids = selection.items) => {
    const r = rects();
    const b = board2();
    const list = uids.filter((uid) => !b?.items.get(uid)?.pinned).map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
    const moved = distributeRects(list, axis).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
    void session.commitRects?.(moved);
  };
  const wrapBoardSel = (uids = selection.items) => {
    if (!uids.length) return;
    Promise.resolve(session.wrapInBoard?.(uids)).then((uid) => {
      if (uid) ctl.select([uid]);
    }).catch(() => {
    });
  };
  const writeEdgeToGraph = async () => {
    if (!selection.edge) return;
    const r = await session.writeToGraph?.(selection.edge);
    chrome.toast.show({ message: r?.ok ? "Written to the graph" : `Not written: ${r?.reason || "unknown"}` });
  };
  const duplicate = (uids, { dx = 24, dy = 24, asRef = false } = {}) => {
    if (!uids.length) return;
    Promise.resolve(session.duplicateItems?.(uids, { dx, dy, asRef })).then(afterCreate("Duplicated")).catch(() => {
    });
  };
  const expandOutline = (uid, patch) => {
    const preset = patch ? writeMindPreset(storage, patch) : readMindPreset(storage);
    Promise.resolve(session.expandOutline?.(uid, preset)).then((res) => {
      if (disposed || !res || typeof res !== "object") return;
      if (res.added > 0) {
        if (res.skipped > 0) toast(`Mind map: ${res.total - res.skipped} of ${res.total} branches (cap)`, true);
        else toast(`Added ${res.added} ${res.added === 1 ? "card" : "cards"} as a mind map`, true);
      } else toast("Nothing to expand");
    }).catch(() => {
    });
  };
  const spreadChildren = (uid) => {
    Promise.resolve(session.spreadChildren?.(uid)).then((res) => {
      if (disposed || !res || typeof res !== "object") return;
      if (res.added > 0) toast(`Spread ${res.added} ${res.added === 1 ? "child" : "children"} as cards`, true);
      else toast(res.skipped > 0 ? "Every child is already on the board" : "No children to spread");
    }).catch(() => {
    });
  };
  const fitHeight = (uid) => {
    const h = itemsR.measureContent(uid);
    if (h) void session.fitToContent?.(uid, h);
    else toast("Zoom in to measure the card");
  };
  const startSendTo = (uids = selection.items) => {
    const list = uids.slice();
    if (!list.length) return;
    sendPending = list;
    panel.open("boards");
    toast(`Pick a board to send ${list.length} ${list.length === 1 ? "card" : "cards"} to`);
  };
  const finishSend = (uids, target) => {
    Promise.resolve(session.sendToBoard?.(uids, target)).then((res) => {
      if (disposed) return;
      if (res) {
        toast(`Added ${res.added} ${res.added === 1 ? "card" : "cards"} to ${res.title}`);
        panel.close();
      } else toast("Couldn't send the cards to that board");
    }).catch(() => {
    });
  };
  const weekDates = () => {
    const d = /* @__PURE__ */ new Date();
    const monday = d.getDate() - (d.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), monday + i));
  };
  const addDaily = (dates, at) => {
    Promise.resolve(session.addDailyCards?.(dates, { x: at.x, y: at.y })).then((made) => {
      if (disposed) return;
      if (Array.isArray(made) && made.length) ctl.select(made);
      else toast("Already on this board");
    }).catch(() => {
    });
  };
  let pagePicker = null;
  const addPage = (at = null) => {
    if (disposed) return;
    measure();
    const spot = at || screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
    pagePicker?.close();
    const picker = openPagePicker({
      doc,
      search: (text2) => host?.searchPages?.(text2, 30) || [],
      onPick: async (title) => {
        const b = board2();
        if (!b || disposed) return false;
        for (const it of b.items.values()) {
          if (it.kind === "page" && it.target?.title === title) {
            ctl.select([it.uid]);
            pulseItem(it.uid);
            return true;
          }
        }
        const uid = await session.createCard?.({ x: spot.x - PAGE_CARD.w / 2, y: spot.y - PAGE_CARD.h / 2, string: `[[${title}]]`, w: PAGE_CARD.w, h: PAGE_CARD.h });
        if (uid && !disposed) ctl.select([uid]);
        return Boolean(uid);
      }
    });
    pagePicker = picker;
  };
  const outline = () => {
    const b = board2();
    const out = [];
    if (!b) return out;
    for (const uid of outlineOrder(b)) {
      const it = b.items.get(uid);
      if (!it || it.type !== "section") continue;
      out.push({ uid, title: plainText(it.title || it.string, 80) || "Section", depth: it.depth, count: it.members.length, color: it.color || null });
    }
    return out;
  };
  const pastePoint = () => {
    measure();
    const screen = pointerInside && lastPointer ? { x: lastPointer.x - rootRect.left, y: lastPointer.y - rootRect.top } : { x: size.width / 2, y: size.height / 2 };
    return screenToWorld(vp, screen);
  };
  const doCopy = (uids) => {
    const b = board2();
    if (!b || !uids.length) return;
    const payload = copyPayload(b, uids, rects());
    if (!payload.text) return;
    lastPayload = payload;
    void writeClipboard({ text: payload.text, mime: PLEXUS_MIME, data: payload.mime }).then((ok) => {
      if (!disposed) toast(ok ? "Copied" : "Copy failed");
    });
  };
  const pastePlexus = (data, { clone: clone2 = false } = {}, at = pastePoint()) => {
    Promise.resolve(session.pasteItems?.(data, { x: at.x, y: at.y, mode: clone2 ? "clone" : "refs" })).then(afterCreate("Pasted")).catch(() => {
    });
  };
  const pasteEntries = (entries, at = pastePoint()) => {
    Promise.resolve(session.pasteText?.(entries, { x: at.x, y: at.y })).then(afterCreate("Pasted")).catch(() => {
    });
  };
  const pasteFromMenu = async (at, clone2) => {
    let text2 = null;
    try {
      text2 = await globalThis.navigator?.clipboard?.readText?.();
    } catch {
      text2 = null;
    }
    if (disposed) return;
    if (lastPayload && (text2 == null || text2 === lastPayload.text)) {
      let data = null;
      try {
        data = JSON.parse(lastPayload.mime);
      } catch {
        data = null;
      }
      if (data && Array.isArray(data.items)) {
        pastePlexus(data, { clone: clone2 }, at);
        return;
      }
    }
    const entries = parsePastedText(text2 ?? "");
    if (entries.length) pasteEntries(entries, at);
    else toast("Nothing to paste");
  };
  const pasteImages = async (files, at = pastePoint()) => {
    if (!files?.length) return;
    if (typeof host?.uploadFile !== "function") {
      toast("Image upload is not available here");
      return;
    }
    const urls = [];
    let failed = 0;
    for (const file of files) {
      try {
        urls.push(await host.uploadFile(file));
      } catch (err) {
        if (err?.message === "upload-unavailable") {
          if (!disposed) toast("Image upload is not available here");
          return;
        }
        failed += 1;
      }
      if (disposed) return;
    }
    if (failed && !urls.length) {
      toast("Couldn't upload the image");
      return;
    }
    if (!urls.length) return;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const made = await Promise.resolve(session.addRefCards?.(stackAt(urls.map((u) => `![](${u})`), at.x, at.y, h))).catch(() => null);
    if (disposed) return;
    if (Array.isArray(made) && made.length) {
      ctl.select(made);
      toast(failed ? `Added ${made.length} of ${files.length} images` : `Added ${made.length} ${made.length === 1 ? "image" : "images"}`, true);
    }
  };
  const editorTextarea = (node2) => {
    if (!node2) return null;
    if (String(node2.tagName || "").toLowerCase() === "textarea") return node2;
    const editor = node2.closest?.(".pxd-item__editor");
    if (!editor) return null;
    const active = doc.activeElement;
    if (active && editor.contains?.(active) && String(active.tagName || "").toLowerCase() === "textarea") return active;
    return editor.querySelector?.("textarea") || null;
  };
  const remountEditor = async (cardUid) => {
    if (!cardUid || itemsR.editingUid?.() !== cardUid || disposed) return;
    await itemsR.exitEdit({ silent: true });
    if (disposed || !session.board?.items?.has?.(cardUid)) return;
    await itemsR.enterEdit(cardUid);
  };
  const pasteEditorImages = async (ta, blockUid2, files) => {
    if (!files?.length || !blockUid2) return;
    if (typeof host?.uploadFile !== "function") {
      toast("Image upload is not available here");
      return;
    }
    const snap = { value: ta?.value ?? "", start: ta?.selectionStart, end: ta?.selectionEnd };
    const cardUid = itemsR.editingUid?.();
    const urls = [];
    let failed = 0;
    for (const file of files) {
      try {
        urls.push(await host.uploadFile(file));
      } catch (err) {
        if (err?.message === "upload-unavailable") {
          if (!disposed) toast("Image upload is not available here");
          return;
        }
        failed += 1;
      }
      if (disposed) return;
    }
    if (!urls.length) {
      if (!disposed) toast("Couldn't upload the image");
      return;
    }
    if (!ta) {
      let current2 = null;
      try {
        current2 = host?.blockString?.(blockUid2);
      } catch {
        current2 = null;
      }
      if (typeof current2 !== "string") {
        if (!disposed) toast("Couldn't add the image to this card");
        return;
      }
      snap.value = current2;
      snap.start = snap.end = current2.length;
    }
    const placed = inlineAtCaret(snap.value, snap.start, snap.end, imageMarkdown(urls));
    if (ta) {
      commitTextareaValue(ta, placed.string);
      try {
        ta.setSelectionRange?.(placed.caret, placed.caret);
      } catch {
      }
    }
    try {
      const write = () => host.updateString(blockUid2, placed.string);
      if (host.group) await host.group(write);
      else await write();
    } catch {
      if (!disposed) toast("Couldn't upload the image");
      return;
    }
    if (disposed) return;
    if (failed) toast(`Added ${urls.length} of ${files.length} images`);
    await remountEditor(cardUid);
  };
  const pasteEditorBlocks = async (ta, blockUid2, plan) => {
    if (!blockUid2 || plan?.type !== "blocks") return;
    if (typeof host?.updateString !== "function" || typeof host?.createBlock !== "function") return;
    const cardUid = itemsR.editingUid?.();
    if (ta) commitTextareaValue(ta, plan.string);
    try {
      const write = async () => {
        await host.updateString(blockUid2, plan.string);
        for (const line of plan.children) await host.createBlock({ parentUid: blockUid2, order: "last", string: line });
      };
      if (host.group) await host.group(write);
      else await write();
    } catch {
      return;
    }
    if (disposed) return;
    await remountEditor(cardUid);
  };
  const editorPaste = (event) => {
    const ta = editorTextarea(event.target) || editorTextarea(doc.activeElement);
    if (!ta || !root.contains?.(ta)) return false;
    const files = filesFromDataTransfer(event.clipboardData);
    let text2 = "";
    try {
      text2 = event.clipboardData?.getData?.("text/plain") ?? "";
    } catch {
      text2 = "";
    }
    const cardUid = itemsR.editingUid?.();
    const role = inputBlockRole(ta, cardUid);
    const plan = editorPastePlan({
      text: text2,
      imageCount: files.length,
      value: ta.value ?? "",
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
      isRoot: role.role === "root"
    });
    if (!plan || plan.type === "roam") return false;
    const blockUid2 = role.uid || cardUid;
    if (!blockUid2) return false;
    if (plan.type === "images") {
      void pasteEditorImages(ta, blockUid2, files);
      return true;
    }
    void pasteEditorBlocks(ta, blockUid2, plan);
    return true;
  };
  const menuContext = (kind, uid) => {
    const b = board2();
    const item = uid ? b?.items.get(uid) : null;
    switch (kind) {
      case "canvas":
        return { canPaste: true, snapshots: b?.snapshots || [] };
      case "board-menu":
        return { snapshots: b?.snapshots || [] };
      case "card": {
        let queryText = item?.string || "";
        if (!isQueryString(queryText) && item?.target?.kind === "block") {
          try {
            queryText = host?.blockString?.(item.target.uid) || "";
          } catch {
            queryText = "";
          }
        }
        const canExpand = item?.kind === "page" || item?.kind === "note" || item?.kind === "block";
        return { item, isBoard: item?.kind === "board", collapsed: Boolean(item?.collapsed), pinned: Boolean(item?.pinned), hasOutline: NOTE_KINDS2.includes(item?.kind), canSpread: item?.kind === "note" || item?.kind === "block", isQuery: isQueryString(queryText), canExpand, mindPreset: readMindPreset(storage) };
      }
      case "section": {
        const members = item && b ? [item.uid, ...descendantsOf(b, item.uid)] : [];
        return {
          item,
          count: item?.members?.length ?? 0,
          fitOn: item?.autofit !== false,
          pinned: Boolean(item?.pinned),
          collapsed: Boolean(item?.collapsed),
          hasNote: Boolean(item && sectionNoteUid(b, item.uid)),
          locked: members.length > 0 && members.every((u) => b.items.get(u)?.pinned)
        };
      }
      case "text":
        return { item, pinned: Boolean(item?.pinned) };
      case "edge": {
        const e = uid ? b?.edges.get(uid) : null;
        return { item: e, dir: e?.dir, route: e?.route, dash: e?.dash, blockEnd: Boolean(e?.fromBlock || e?.toBlock) };
      }
      case "multi": {
        const items = selection.items.map((u) => b?.items.get(u)).filter(Boolean);
        return {
          count: items.length,
          allPinned: items.length > 0 && items.every((i) => i.pinned),
          anyCollapsed: items.some((i) => i.type === "card" && i.collapsed),
          sectionPair: sectionPair(items.map((i) => i.uid), (id) => b?.items.get(id))
        };
      }
      default:
        return {};
    }
  };
  const openMenuAt = (kind, uid, client, world2) => {
    if (!board2()) return false;
    const items = buildMenu(kind, menuContext(kind, uid));
    const ok = menu.open({ x: client.x, y: client.y, items });
    if (ok) menuCtx = { kind, uid, world: world2, selection: selection.items.slice() };
    return ok;
  };
  const createAt = async (type, world2) => {
    if (type === "sticky") {
      const d2 = STICKY_SIZE;
      const uid2 = await actions.createText({ x: world2.x - d2.w / 2, y: world2.y - d2.h / 2, look: "sticky" });
      if (uid2 && !disposed) {
        ctl.select([uid2]);
        void enterEdit(uid2);
      }
      return;
    }
    const d = DEFAULT_SIZES[type];
    const at = { x: world2.x - d.w / 2, y: world2.y - d.h / 2 };
    const uid = await (type === "text" ? actions.createText(at) : actions.createCard(at));
    if (uid && !disposed) {
      ctl.select([uid]);
      void enterEdit(uid);
    }
  };
  const onMenuPick = (id) => {
    const b = board2();
    if (!b || disposed) return;
    const mc = menuCtx || { kind: "canvas", uid: null, world: viewCenterWorld(), selection: [] };
    const world2 = mc.world || viewCenterWorld();
    const uids = mc.kind === "multi" ? selection.items.slice() : mc.uid && b.items.has(mc.uid) ? [mc.uid] : selection.items.slice();
    const item = uids.length === 1 ? b.items.get(uids[0]) ?? null : null;
    const edgeUid = mc.kind === "edge" ? mc.uid : selection.edge;
    const at = id.indexOf(":");
    const head = at < 0 ? id : id.slice(0, at);
    const arg = at < 0 ? null : id.slice(at + 1);
    switch (head) {
      case "new-card":
        void createAt("card", world2);
        break;
      case "new-text":
        void createAt("text", world2);
        break;
      case "new-sticky":
        void createAt("sticky", world2);
        break;
      case "new-section": {
        const d = DEFAULT_SIZES.section;
        Promise.resolve(session.createSection?.({ rect: { x: world2.x - d.w / 2, y: world2.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => {
          if (uid && !disposed) ctl.select([uid]);
        }).catch(() => {
        });
        break;
      }
      case "new-lane-h":
      case "new-lane-v": {
        const vertical = head === "new-lane-v";
        const d = vertical ? LANE_SIZE.vertical : LANE_SIZE.horizontal;
        Promise.resolve(session.createSection?.({
          rect: { x: world2.x - d.w / 2, y: world2.y - d.h / 2, w: d.w, h: d.h },
          title: "Lane",
          look: "lane",
          axis: vertical ? "vertical" : "horizontal"
        })).then((uid) => {
          if (uid && !disposed) ctl.select([uid]);
        }).catch(() => {
        });
        break;
      }
      case "new-board": {
        const d = DEFAULT_BOARD_CARD;
        Promise.resolve(session.createBoard?.({ rect: { x: world2.x - d.w / 2, y: world2.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => {
          if (uid && !disposed) ctl.select([uid]);
        }).catch(() => {
        });
        break;
      }
      case "template": {
        const d = DEFAULT_BOARD_CARD;
        const rect = { x: world2.x - d.w / 2, y: world2.y - d.h / 2, w: d.w, h: d.h };
        Promise.resolve(session.insertTemplate?.(arg, rect)).then((uid) => {
          if (uid && !disposed) ctl.select([uid]);
        }).catch(() => {
        });
        break;
      }
      case "save-template":
        Promise.resolve(session.saveAsTemplate?.()).catch(() => {
        });
        break;
      case "save-snapshot":
        Promise.resolve(session.saveSnapshot?.()).catch(() => {
        });
        break;
      case "snapshot": {
        const snap = b.snapshots?.find((item2) => item2.uid === arg);
        const title = snap?.title || "this snapshot";
        chrome.toast.show({
          message: `Restore ${title}? Layouts are rewritten in groups of 45.`,
          action: { label: "Restore", run: () => {
            void session.restoreSnapshot?.(arg);
          } }
        });
        break;
      }
      case "delete-snapshot":
        Promise.resolve(session.deleteSnapshot?.(arg)).catch(() => {
        });
        break;
      case "paste":
        void pasteFromMenu(world2, false);
        break;
      case "paste-clone":
        void pasteFromMenu(world2, true);
        break;
      case "select-all":
        ctl.select([...b.items.keys()]);
        break;
      case "fit-all":
        fitAll();
        break;
      case "fold-all":
        void session.collapseAll?.(true);
        break;
      case "unfold-all":
        void session.collapseAll?.(false);
        break;
      case "add-today":
        addDaily([/* @__PURE__ */ new Date()], world2);
        break;
      case "add-page":
        addPage(world2);
        break;
      case "add-week":
        addDaily(weekDates(), world2);
        break;
      case "background":
        chrome.popover.open();
        break;
      case "bg-image": {
        void (async () => {
          let text2 = "";
          try {
            text2 = await globalThis.navigator?.clipboard?.readText?.() || "";
          } catch {
            text2 = "";
          }
          const ok = await session.setBoardBackground?.({ bgImage: text2.trim() });
          if (!disposed && !ok) toast("Copy an https image URL first");
        })();
        break;
      }
      case "gallery":
      case "timeline":
      case "graph":
        if (tableMode) setTable(false);
        if (kanbanMode) setKanban(false);
        laterCtl.open(head);
        break;
      case "print": {
        const sheet = mountPrintSheet(doc, b);
        root.append(sheet);
        root.classList.add("pxd-root--print");
        try {
          win?.print?.();
        } catch {
        }
        sheet.remove();
        root.classList.remove("pxd-root--print");
        break;
      }
      case "highlights": {
        const on = root.classList.toggle("pxd-root--highlights");
        for (const card2 of b.items.values()) {
          const shell = itemsR.shellOf(card2.uid);
          if (!shell) continue;
          shell.classList.toggle("pxd-has-highlight", on && highlightHits(card2.string).length > 0);
        }
        break;
      }
      case "apply-template":
        if (item) void session.applyCardTemplate?.(item.uid, ATTRIBUTE_TEMPLATE);
        break;
      case "version-peek": {
        if (!versionPeekRequest(host?.api)) toast("Roam does not expose block history");
        else toast("Block history is available on this host");
        break;
      }
      case "layout-dates":
        if (item) void session.layoutByDate?.(item.uid);
        break;
      case "focus-timer": {
        if (item?.type === "section") void session.setSectionLook?.(item.uid, "timer");
        stopTimer();
        timerState = { remainingMs: FOCUS_MS, running: true, endsAt: Date.now() + FOCUS_MS };
        timerHud = el("div", "pxd-timer pxd-chrome", root);
        paintTimer();
        armTimer();
        break;
      }
      case "group-connect": {
        const pair2 = sectionPair(uids, (id2) => b.items.get(id2));
        if (pair2) void session.addEdge?.({ from: pair2[0], to: pair2[1] });
        break;
      }
      case "add-bend": {
        if (!edgeUid) break;
        const edge = b.edges.get(edgeUid);
        const a = rects().get(edge?.from);
        const c = rects().get(edge?.to);
        if (!edge || !a || !c) break;
        const mid = {
          x: (a.x + a.w / 2 + c.x + c.w / 2) / 2,
          y: (a.y + a.h / 2 + c.y + c.h / 2) / 2 - 48
        };
        void session.updateEdge?.(edgeUid, { via: [...edge.via || [], mid] });
        break;
      }
      case "clear-bends":
        if (edgeUid) void session.updateEdge?.(edgeUid, { via: [] });
        break;
      case "export-svg":
        void view.exportSvg({ download: true });
        break;
      case "export-png":
        void exportPng();
        break;
      case "copy-png": {
        let ids = uids;
        if ((!ids || !ids.length) && mc.kind === "edge" && edgeUid) {
          const edge = b.edges.get(edgeUid);
          if (edge) ids = [edge.from, edge.to];
        }
        void copySelectionPng(ids);
        break;
      }
      case "copy-outline":
        void view.copyOutline();
        break;
      case "open-outline":
        openBoardOutline();
        break;
      case "edit":
        if (item) {
          if (item.kind === "board") itemsR.renameBoard(item.uid);
          else void enterEdit(item.uid);
        }
        break;
      case "open":
        openItem(item);
        break;
      case "open-own-page":
        openOwnPage(item);
        break;
      case "open-sidebar":
        openItemInSidebar(item);
        break;
      case "copy":
        doCopy(uids);
        break;
      case "copy-ref":
        if (item) copyText(`((${item.uid}))`, "Reference copied");
        break;
      case "copy-link": {
        if (!item) break;
        let pageUid = "";
        try {
          pageUid = host?.blockPageUid?.(boardUid) || "";
        } catch {
          pageUid = "";
        }
        if (!pageUid) pageUid = pageUidFromHash(win?.location?.hash || "");
        copyText(copyLinkText(item, { graph, pageUid }), "Link copied");
        break;
      }
      case "duplicate":
        duplicate(uids);
        break;
      case "duplicate-ref":
        duplicate(uids, { asRef: true });
        break;
      case "color": {
        const target = mc.kind === "edge" && edgeUid ? [edgeUid] : uids;
        if (target.length) void session.setColor?.(target, arg === "none" ? null : arg);
        break;
      }
      case "show-as-card":
        if (item) void session.setLook?.(item.uid, "card");
        break;
      case "show-as-block":
        if (item) void session.setLook?.(item.uid, "block");
        break;
      case "fold":
        setFolded(uids, true);
        break;
      case "unfold":
        setFolded(uids, false);
        break;
      case "fit-height":
        if (item) fitHeight(item.uid);
        break;
      case "reset-size":
        void session.resetSize?.(uids);
        break;
      case "pin":
        void session.setPinned?.(uids, true);
        break;
      case "unpin":
        void session.setPinned?.(uids, false);
        break;
      case "mind-map":
        if (item) expandOutline(item.uid);
        break;
      case "spread-children":
        if (item) spreadChildren(item.uid);
        break;
      case "neighbors": {
        if (!item || !arg) break;
        let titles = [];
        try {
          titles = host?.neighborPages?.(item, arg, { boardUid }) || [];
        } catch {
          titles = [];
        }
        const have = [];
        for (const other of b.items.values()) {
          if (other.target?.kind === "page" && other.target.title) have.push(other.target.title);
        }
        const list = neighborLayout(rects().get(item.uid), titles, { skip: have });
        if (!list.length) {
          toast("No pages to add");
          break;
        }
        const made = session.addRefCards?.(list);
        Promise.resolve(made).then((ids) => {
          if (disposed) return;
          if (Array.isArray(ids) && ids.length) ctl.select(ids);
          toast(`Added ${list.length} ${list.length === 1 ? "page" : "pages"}`, true);
        }).catch(() => {
        });
        break;
      }
      case "query-results": {
        if (!item) break;
        const sourceUid = isQueryString(item.string) ? item.uid : item.target?.kind === "block" ? item.target.uid : item.uid;
        const live = root.querySelector?.(`[data-uid="${item.uid}"] .pxd-item__query .pxd-rs__live`);
        const list = queryResultLayout(rects().get(item.uid), queryResultUids(live, sourceUid));
        if (!list.length) {
          toast("No results in this query");
          break;
        }
        const made = session.addRefCards?.(list);
        Promise.resolve(made).then((ids) => {
          if (disposed) return;
          if (Array.isArray(ids) && ids.length) ctl.select(ids);
          toast(`Added ${list.length} ${list.length === 1 ? "card" : "cards"} from the query`, true);
        }).catch(() => {
        });
        break;
      }
      case "mind-dir":
        if (item && arg) expandOutline(item.uid, { direction: arg });
        break;
      case "mind-space":
        if (item && arg) expandOutline(item.uid, { spacing: arg });
        break;
      case "mind-depth":
        if (item && arg) expandOutline(item.uid, { depth: Number(arg) });
        break;
      case "mind-refs":
        if (item && arg) expandOutline(item.uid, { includeRefs: arg !== "skip" });
        break;
      case "mind-color":
        if (item && arg) expandOutline(item.uid, { colorBranches: arg === "on" });
        break;
      case "send-to":
        startSendTo(uids);
        break;
      case "related":
        panel.open("related");
        break;
      case "delete":
      case "delete-frame":
        ctl.deleteSelection(false);
        break;
      case "delete-contents":
        ctl.deleteSelection(true);
        break;
      case "rename":
        if (item) itemsR.renameSection(item.uid);
        break;
      case "select-contents":
        if (item?.members?.length) ctl.select(item.members);
        break;
      case "select-all-in-section": {
        const all = item ? sectionAllUids(b, item.uid) : [];
        if (all.length) ctl.select(all);
        break;
      }
      case "select-same-color": {
        const same = item ? sameColorUids(b, item.uid) : [];
        if (same.length) ctl.select(same);
        break;
      }
      case "select-connected": {
        const linked = item ? connectedUids(b, item.uid) : [];
        if (linked.length) ctl.select(linked);
        break;
      }
      case "fit-section":
        if (item) void session.fitSection?.(item.uid);
        break;
      case "toggle-fit":
        if (item) void session.setFit?.(item.uid, item.autofit === false);
        break;
      case "tidy":
        void session.tidyItems?.(mc.kind === "board-menu" ? b.roots : uids, arg);
        break;
      case "sort-outline":
        void session.sortOutline?.();
        break;
      case "fold-all-in":
        if (item) void session.collapseAll?.(true, { within: item.uid });
        break;
      case "unfold-all-in":
        if (item) void session.collapseAll?.(false, { within: item.uid });
        break;
      case "collapse-section":
        if (item?.type === "section") void session.setCollapsed?.(item.uid, !item.collapsed);
        break;
      case "section-note":
        if (item?.type === "section") void session.toggleSectionNote?.(item.uid);
        break;
      case "lock-contents":
        if (item?.type === "section") void session.lockSection?.(item.uid, true);
        break;
      case "unlock-contents":
        if (item?.type === "section") void session.lockSection?.(item.uid, false);
        break;
      case "present-section":
        if (item?.type === "section") startPresent(item.uid);
        break;
      case "size":
        if (item) void session.setFontSize?.(item.uid, Number(arg));
        break;
      case "shape":
        if (item?.type === "text") void session.setItemStyle?.([item.uid], { shape: arg });
        break;
      case "dir":
        if (edgeUid) void session.updateEdge?.(edgeUid, { dir: arg });
        break;
      case "route":
        if (edgeUid) void session.updateEdge?.(edgeUid, { route: arg });
        break;
      case "dash":
        if (edgeUid) void session.updateEdge?.(edgeUid, { dash: arg });
        break;
      case "flip":
        if (edgeUid) void session.flipEdge?.(edgeUid);
        break;
      case "unblock":
        if (edgeUid) void session.updateEdge?.(edgeUid, { fromBlock: void 0, toBlock: void 0 });
        break;
      case "label":
        if (edgeUid) edgesR.editLabel(edgeUid);
        break;
      case "notes":
        if (edgeUid) host?.openInSidebar?.(edgeUid, "block");
        break;
      case "write-to-graph":
        void writeEdgeToGraph();
        break;
      case "align":
        alignSel(arg, uids);
        break;
      case "distribute":
        distributeSel(arg, uids);
        break;
      case "same-size":
        if (uids.length) void session.sameSize?.(uids, uids[uids.length - 1], arg);
        break;
      case "wrap-section":
        if (uids.length) void session.wrapInSection?.(uids);
        break;
      case "wrap-board":
        wrapBoardSel(uids);
        break;
      default:
        break;
    }
  };
  let openInfo = () => {
  };
  const chrome = createChrome({
    doc,
    root,
    version,
    settings: settingsProxy,
    timers,
    crumbs: crumbList,
    on: {
      openBoard: () => {
        const it = singleItem();
        if (it) void openBoard(it.uid);
      },
      openOwnPage: () => openOwnPage(singleItem()),
      renameBoard: () => {
        const it = singleItem();
        if (it) itemsR.renameBoard(it.uid);
      },
      crumb: (index) => {
        void goCrumb(index);
      },
      wrapBoard: () => wrapBoardSel(),
      setTool: (tool, lock) => ctl.setTool(tool, lock),
      togglePanel: () => panel.toggle(),
      openInfo: () => openInfo(),
      cycleLinks: () => cycleLinks(),
      toggleTable: () => setTable(!tableMode),
      toggleKanban: () => setKanban(!kanbanMode),
      zoomIn: () => animateViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1.2)),
      zoomOut: () => animateViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / 1.2)),
      zoomReset: () => animateViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / vp.zoom)),
      fit: () => fitAll(),
      toggleMinimap: () => chrome.minimap.setVisible(!chrome.minimap.isVisible()),
      toggleFullscreen: () => requestFullscreen(!isFullscreen),
      editBlock: () => editBoardBlock(),
      savePng: () => {
        void exportPng();
      },
      openOutline: () => openBoardOutline(),
      setColor: (c) => {
        const uids = targetUids();
        if (uids.length) void session.setColor?.(uids, c);
      },
      edit: () => {
        const it = singleItem();
        if (it) void enterEdit(it.uid);
      },
      openSidebar: () => openItemInSidebar(singleItem()),
      collapse: () => {
        const it = singleItem();
        if (it) void session.setCollapsed?.(it.uid, !it.collapsed);
      },
      toggleOpen: () => {
        const it = barCard();
        if (!it) return;
        if (it.kind === "note" || it.kind === "block") itemsR.toggleKids(it.uid);
        else void session.setBlockOpen?.(it.uid, it.open === false);
      },
      showRefs: () => {
        const it = barCard();
        const uid = mentionsUid(it);
        if (uid) host?.openInSidebar?.(uid, "mentions");
      },
      related: () => panel.open("related"),
      delete: () => ctl.deleteSelection(false),
      rename: () => {
        const it = singleItem();
        if (it) itemsR.renameSection(it.uid);
      },
      selectContents: () => {
        const it = singleItem();
        if (it?.members?.length) ctl.select(it.members);
      },
      selectAllInSection: () => {
        const it = singleItem();
        const all = it ? sectionAllUids(board2(), it.uid) : [];
        if (all.length) ctl.select(all);
      },
      selectSameColor: () => {
        const it = singleItem();
        const same = it ? sameColorUids(board2(), it.uid) : [];
        if (same.length) ctl.select(same);
      },
      selectConnected: () => {
        const it = singleItem();
        const linked = it ? connectedUids(board2(), it.uid) : [];
        if (linked.length) ctl.select(linked);
      },
      setFontSize: (n2) => {
        const it = singleItem();
        if (it) void session.setFontSize?.(it.uid, n2);
      },
      edgeDir: (dir) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { dir });
      },
      flip: () => {
        if (selection.edge) void session.flipEdge?.(selection.edge);
      },
      unblock: () => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { fromBlock: void 0, toBlock: void 0 });
      },
      route: (route) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { route });
      },
      dash: (dash) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { dash });
      },
      weight: (weight) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { weight });
      },
      label: () => {
        if (selection.edge) edgesR.editLabel(selection.edge);
      },
      notes: () => {
        if (selection.edge) host?.openInSidebar?.(selection.edge, "block");
      },
      writeToGraph: () => writeEdgeToGraph(),
      pinLink: () => {
        const link = (session.links || []).find((l) => l.key === selection.link);
        if (link) Promise.resolve(session.pinLink?.(link)).then((uid) => {
          if (uid) ctl.selectEdge(uid);
        }).catch(() => {
        });
      },
      openSource: (uid) => host?.openInSidebar?.(uid, "block"),
      align: (mode) => alignSel(mode),
      distribute: (axis) => distributeSel(axis),
      wrap: () => {
        if (selection.items.length) void session.wrapInSection?.(selection.items);
      },
      navigate: (worldPoint) => centerOn(worldPoint),
      searchFilter: (text2) => searchFilter(text2),
      searchNext: (dir) => searchNext(dir),
      searchClosed: () => {
        try {
          root.focus({ preventScroll: true });
        } catch {
        }
      },
      // 1.2
      pin: (on) => {
        if (selection.items.length) void session.setPinned?.(selection.items, Boolean(on));
      },
      fitHeight: () => {
        const it = singleItem();
        if (it) fitHeight(it.uid);
      },
      copyRef: () => {
        const it = singleItem();
        if (it) copyText(`((${it.uid}))`, "Reference copied");
      },
      duplicate: () => duplicate(selection.items),
      sendTo: () => startSendTo(),
      expandOutline: () => {
        const it = singleItem();
        if (it) expandOutline(it.uid);
      },
      fitSection: () => {
        const it = singleItem();
        if (it) void session.fitSection?.(it.uid);
      },
      toggleFit: () => {
        const it = singleItem();
        if (it) void session.setFit?.(it.uid, it.autofit === false);
      },
      tidy: (mode) => {
        if (selection.items.length) void session.tidyItems?.(selection.items, mode);
      },
      foldAll: (value) => {
        const it = singleItem();
        if (it) void session.collapseAll?.(Boolean(value), { within: it.uid });
      },
      collapseSection: () => {
        const it = singleItem();
        if (it?.type === "section") void session.setCollapsed?.(it.uid, !it.collapsed);
      },
      sectionNote: () => {
        const it = singleItem();
        if (it?.type === "section") void session.toggleSectionNote?.(it.uid);
      },
      lockSection: (on) => {
        const it = singleItem();
        if (it?.type === "section") void session.lockSection?.(it.uid, on !== false);
      },
      presentSection: () => {
        const it = singleItem();
        if (it?.type === "section") startPresent(it.uid);
      },
      fold: (value) => setFolded(selection.items, Boolean(value)),
      sameSize: (mode) => {
        if (selection.items.length) void session.sameSize?.(selection.items, lastSelected(), mode);
      },
      toggleFocus: () => toggleFocus(),
      toggleLens: () => toggleLens(),
      present: () => startPresent(),
      openMore: ({ x, y } = {}) => {
        openMenuAt("board-menu", null, { x: x ?? 0, y: y ?? 0 }, viewCenterWorld());
      },
      backToContent: () => fitAll(),
      setBackground: (patch) => {
        Promise.resolve(session.setBoardBackground?.(patch)).then((ok) => {
          if (ok === false && !disposed) toast("This board can't store a background");
        }).catch(() => {
        });
      },
      useBackgroundAsDefault: () => {
        if (typeof onSetDefaults !== "function") return;
        onSetDefaults({ grid: bgPattern, "board-tone": bgTone || "none" });
        toast("Saved as the default background");
      }
    }
  });
  const lensPop = el("div", "pxd-popover pxd-lens pxd-chrome", root);
  lensPop.style.display = "none";
  lensPop.setAttribute("role", "dialog");
  lensPop.setAttribute("aria-label", "Tag lens");
  let lensOffs = [];
  const closeLens = () => {
    lensOffs.splice(0).forEach((off) => off());
    lensPop.style.display = "none";
  };
  const paintLens = () => {
    const catalog = rebuildLens();
    lensPop.replaceChildren();
    const title = el("div", "pxd-popover__title", lensPop);
    title.textContent = "Tag lens";
    const all = el("button", `pxd-lens__row${lensTag ? "" : " is-on"}`, lensPop);
    all.type = "button";
    all.textContent = "All cards";
    all.setAttribute("aria-label", "All cards");
    all.dataset.tag = "";
    all.setAttribute("data-tag", "");
    if (!catalog.tags.length) {
      const empty = el("div", "pxd-lens__empty", lensPop);
      empty.textContent = "No tags on this board";
    }
    for (const tag of catalog.tags) {
      const row2 = el("button", `pxd-lens__row${tag === lensTag ? " is-on" : ""}`, lensPop);
      row2.type = "button";
      row2.textContent = `#${tag}`;
      row2.setAttribute("aria-label", `#${tag}`);
      row2.dataset.tag = tag;
      row2.setAttribute("data-tag", tag);
    }
  };
  const openLens = () => {
    if (lensPop.style.display !== "none") {
      closeLens();
      return;
    }
    paintLens();
    lensPop.style.display = "";
    const btn = chrome.toolbar.lensButton;
    const rootRect2 = root.getBoundingClientRect();
    const b = btn?.getBoundingClientRect?.() || { left: rootRect2.left, bottom: rootRect2.top };
    const w = lensPop.offsetWidth || 200;
    const h = lensPop.offsetHeight || 120;
    const left = Math.max(8, Math.min(b.left - rootRect2.left, (rootRect2.width || 0) - w - 8));
    let top = b.bottom - rootRect2.top + 6;
    if (rootRect2.height && top + h > rootRect2.height - 8) top = Math.max(8, rootRect2.height - h - 8);
    lensPop.style.left = `${Math.round(left)}px`;
    lensPop.style.top = `${Math.round(top)}px`;
    const onDown = (event) => {
      if (lensPop.contains(event.target) || btn?.contains?.(event.target)) return;
      closeLens();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault?.();
      event.stopPropagation?.();
      closeLens();
    };
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("keydown", onKey, true);
    lensOffs = [() => doc.removeEventListener("pointerdown", onDown, true), () => doc.removeEventListener("keydown", onKey, true)];
  };
  const toggleLens = () => openLens();
  listen(lensPop, "click", (event) => {
    const row2 = event.target?.closest?.(".pxd-lens__row");
    if (!row2 || disposed) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const tag = row2.dataset?.tag || row2.getAttribute?.("data-tag") || "";
    lensTag = tag || null;
    if (lensTag) rebuildLens();
    closeLens();
    focusKey = null;
    applyFocus();
  });
  const PANEL_WIDTH_KEY = "plexus-diagram:panel-width";
  let panelWidth = PANEL_WIDTH_DEFAULT;
  try {
    const stored = Number(storage?.getItem?.(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored)) panelWidth = nextPanelWidth(stored, 0);
  } catch {
  }
  const panel = createPanel({
    doc,
    root,
    host,
    timers,
    width: panelWidth,
    on: {
      addBeside: (string) => addStringsBeside([string]),
      addMany: (strings) => addStringsBeside(strings),
      isOnBoard,
      opened: (open) => {
        chrome.toolbar.setPanel(open);
        if (!open) sendPending = null;
      },
      listBoards: () => Promise.resolve(host?.listBoards?.()).then((rows) => rows || []),
      openBoardByUid: (uid) => {
        if (sendPending) {
          const list = sendPending;
          sendPending = null;
          finishSend(list, uid);
          return;
        }
        host?.openBlock?.(uid);
      },
      addBoardCard: (uid) => addStringsBeside([`((${uid}))`]),
      getOutline: () => outline(),
      outlineClick: (uid) => {
        fitSelection([uid]);
        ctl.select([uid]);
      },
      isFullscreen: () => isFullscreen,
      openSidebarEditor: (item) => openItemInSidebar(item),
      openRef: (uid) => host?.openInSidebar?.(uid, "block"),
      focusInfoTab: (uid) => ctl.select([uid]),
      rememberWidth: (w) => {
        try {
          storage?.setItem?.(PANEL_WIDTH_KEY, String(w));
        } catch {
        }
      }
    }
  });
  openInfo = () => {
    const it = singleItem();
    if (it && it.type !== "section") panel.addInfoTab(it);
    else panel.open("info");
  };
  const propsPanel = createPropsPanel({
    doc,
    root,
    storage,
    on: {
      setItemStyle: (patch) => {
        if (selection.items.length) void session.setItemStyle?.(selection.items, patch);
      },
      resetItems: () => {
        if (selection.items.length) void session.resetItemStyle?.(selection.items);
      },
      setSectionStyle: (patch) => {
        if (selection.items.length) void session.setSectionStyle?.(selection.items, patch);
      },
      resetSections: () => {
        if (selection.items.length) void session.resetSectionStyle?.(selection.items);
      },
      setEdge: (patch) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, patch);
      },
      resetEdge: () => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { dir: "one", route: "curve", dash: "solid", weight: 1, color: null });
      },
      setDefaults: (patch) => {
        void session.setSectionDefaults?.(patch);
      },
      resetDefaults: () => {
        void session.resetSectionDefaults?.();
      },
      setBackground: (patch) => {
        Promise.resolve(session.setBoardBackground?.(patch)).then((ok) => {
          if (ok === false && !disposed) toast("This board can't store a background");
        }).catch(() => {
        });
      }
    }
  });
  const syncProps = () => {
    const b = board2();
    if (!b) return;
    propsPanel.refresh({
      items: selection.items.map((id) => b.items.get(id)).filter(Boolean),
      edge: selection.edge ? b.edges.get(selection.edge) : null,
      board: b
    });
  };
  const menu = createMenu({ doc, root, on: { pick: (id) => onMenuPick(id), closed: () => {
    menuCtx = null;
  } } });
  const quicklook = createQuickLook({
    doc,
    root,
    host,
    timers,
    on: {
      getRefCount: (item) => badgeCache.get(badgeKeyOf(item))?.stats?.refs
    }
  });
  const presenter = createPresenter({
    doc,
    root,
    timers,
    on: {
      step: (s) => {
        presentSet = s.members;
        fitTo(s.rect, { maxZoom: 1.2 });
        applyFocus();
      },
      exit: () => {
        presentSet = null;
        applyFocus();
      }
    }
  });
  const startPresent = (only) => {
    quicklook.close();
    const opts = only ? { only } : void 0;
    if (!presenter.start(board2(), rects(), opts)) toast("Nothing to present");
  };
  chrome.minimap.setVisible(setting("show-minimap", true) !== false);
  chrome.toolbar.setLinkMode(linkMode);
  const cycleLinks = () => {
    linkMode = LINK_MODES2[(LINK_MODES2.indexOf(linkMode) + 1) % LINK_MODES2.length];
    chrome.toolbar.setLinkMode(linkMode);
    session.setLinkMode?.(linkMode);
  };
  const hiddenAttrs = /* @__PURE__ */ new Set();
  const legend = el("div", "pxd-legend pxd-chrome", root);
  legend.hidden = true;
  legend.setAttribute("hidden", "");
  const attrStyleMap = () => parseAttrStyles(setting("attr-styles", ""));
  const paintedLinks = () => styleAttrLinks(session.links || [], attrStyleMap(), hiddenAttrs);
  const paintLegend = () => {
    const rows = attrLegend(session.links || [], hiddenAttrs, attrStyleMap());
    legend.replaceChildren();
    if (!rows.length) {
      legend.hidden = true;
      legend.setAttribute("hidden", "");
      return;
    }
    legend.hidden = false;
    legend.removeAttribute("hidden");
    for (const row2 of rows) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = `pxd-legend__row pxd-c-${row2.color}${row2.on ? "" : " is-off"}`;
      btn.setAttribute("data-attr", row2.name);
      btn.setAttribute("aria-pressed", row2.on ? "true" : "false");
      btn.title = row2.on ? `Hide ${row2.name}` : `Show ${row2.name}`;
      btn.setAttribute("aria-label", btn.title);
      btn.textContent = row2.name;
      legend.append(btn);
    }
  };
  listen(legend, "click", (ev) => {
    const btn = ev.target?.closest?.(".pxd-legend__row");
    if (!btn || disposed) return;
    ev.preventDefault();
    ev.stopPropagation();
    const name = btn.getAttribute("data-attr") || "";
    if (!name) return;
    if (hiddenAttrs.has(name)) hiddenAttrs.delete(name);
    else hiddenAttrs.add(name);
    if (selection.link) {
      const current2 = (session.links || []).find((l) => l.key === selection.link);
      const shown = current2?.kind === "attr" ? current2.labels?.[0] : "";
      if (shown && hiddenAttrs.has(shown)) selection.link = null;
    }
    dirty.links = true;
    dirty.selection = true;
    schedule();
  });
  const nestedBoards = (b) => {
    const out = [];
    if (!b || typeof host?.pullBoard !== "function") return out;
    const seen = /* @__PURE__ */ new Set();
    for (const item of b.items.values()) {
      const target = item.kind === "board" ? item.uid : item.kind === "block" ? boardTargetOf(item.uid) : null;
      if (!target || target === b.uid || seen.has(target)) continue;
      seen.add(target);
      let raw = null;
      try {
        raw = host.pullBoard(target);
      } catch {
        raw = null;
      }
      if (!raw) continue;
      let child = null;
      try {
        child = buildBoard(raw);
      } catch {
        child = null;
      }
      if (child?.items) out.push({ parentUid: item.uid, board: child });
    }
    return out;
  };
  const paintSearch = (b, hits, q) => {
    const bright = new Set((hits || []).map((h) => h.focus));
    for (const item of b?.items.values() || []) {
      const shell = itemsR.shellOf(item.uid);
      const on = Boolean(q) && bright.has(item.uid);
      shell?.classList.toggle("pxd-item--dim", Boolean(q) && !on);
      shell?.classList.toggle("pxd-item--hit", on);
    }
    const edges = q ? new Set((hits || []).filter((h) => h.kind === "edge").map((h) => h.uid)) : null;
    edgesR.setSearch(edges);
  };
  const searchFilter = (text2) => {
    const b = board2();
    const q = String(text2 || "").trim().toLowerCase();
    searchIndex = -1;
    root.classList.toggle("pxd-root--searching", Boolean(q));
    searchMatches = b && q ? findOnBoard(b, q, nestedBoards(b)) : [];
    paintSearch(b, searchMatches, q);
    return searchMatches.length;
  };
  const searchNext = (dir = 1) => {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    const hit = searchMatches[searchIndex];
    if (hit?.focus && board2()?.items.has(hit.focus)) {
      ctl.select([hit.focus]);
      fitSelection([hit.focus]);
    }
    const countEl = root.querySelector(".pxd-search__count");
    if (countEl) countEl.textContent = `${searchIndex + 1}/${searchMatches.length}`;
  };
  const enterEdit = async (uid, opts) => {
    ctl.select([uid]);
    if (tier !== "detail") {
      fitSelection([uid]);
      applyLod();
    }
    const ok = await itemsR.enterEdit(uid, opts);
    if (ok) chrome.ctx.hide();
    return ok;
  };
  const freshItems = /* @__PURE__ */ new Set();
  const exitEdit = async () => {
    const uid = itemsR.editingUid?.();
    const editorText = editingPlainText(root);
    await itemsR.exitEdit();
    if (uid && freshItems.delete(uid)) {
      const item = session.board?.items?.get(uid);
      const text2 = host?.blockString?.(uid);
      if (item && freshCardIsBlank({
        blockString: text2,
        itemString: item.string,
        contentCount: (item.content || []).length,
        editorText
      })) {
        await session.deleteItems?.([uid]);
      }
    }
    if (!disposed) {
      dirty.selection = true;
      schedule();
    }
  };
  const applyFullscreen = (on) => {
    isFullscreen = Boolean(on);
    fsDispose();
    fsDispose = applyFullscreenChrome(mountEl, isFullscreen, doc);
    root.classList.toggle("pxd-root--fullscreen", isFullscreen);
    chrome.toolbar.setFullscreen(isFullscreen);
    resizeGrip.style.display = isFullscreen ? "none" : "";
    if (isFullscreen) {
      root.style.height = "";
    } else applyInlineHeight();
    timers.frame(() => {
      measure();
      markViewport();
    });
  };
  const requestFullscreen = (on) => {
    applyFullscreen(on);
    onRequestFullscreen?.(Boolean(on));
  };
  let blockEdit = null;
  const closeBlockEdit = () => {
    if (!blockEdit) return;
    const node2 = blockEdit;
    blockEdit = null;
    node2.remove();
    try {
      host?.unmount?.(node2);
    } catch {
    }
  };
  const editBoardBlock = () => {
    if (blockEdit || disposed) return;
    const node2 = el("div", "pxd-block-edit pxd-chrome", root);
    for (const type of ["pointerdown", "pointerup", "mousedown", "click", "dblclick", "wheel"]) {
      node2.addEventListener(type, (event) => event.stopPropagation());
    }
    blockEdit = node2;
    try {
      host?.renderBlock?.(node2, boardUid);
    } catch {
      closeBlockEdit();
      return;
    }
    openRawBlockEditor(node2);
  };
  const openRawBlockEditor = (node2) => {
    if (node2.querySelector?.("textarea")) return;
    const buttons = [...node2.querySelectorAll?.("button") || []];
    const native = buttons.find((b) => (b.getAttribute?.("title") || b.title) === "Edit Block");
    if (!native) return;
    native.click?.();
    if (node2.querySelector?.("textarea")) return;
    const propsKey = Object.keys(native).find((k) => k.startsWith("__reactProps"));
    const onClick = propsKey && native[propsKey]?.onClick;
    if (typeof onClick === "function") {
      onClick({ preventDefault() {
      }, stopPropagation() {
      }, target: native, currentTarget: native });
    }
  };
  const readHeight = () => {
    try {
      const v = Number(storage?.getItem?.(heightKey));
      return Number.isFinite(v) && v >= MIN_HEIGHT ? v : Number(setting("default-height", DEFAULT_HEIGHT)) || DEFAULT_HEIGHT;
    } catch {
      return DEFAULT_HEIGHT;
    }
  };
  const applyInlineHeight = (h = readHeight()) => {
    root.style.height = `${h}px`;
    if (mountEl?.style) {
      mountEl.style.height = `${h}px`;
      mountEl.style.minHeight = `${h}px`;
    }
  };
  let heightDrag = null;
  const onHeightMove = (event) => {
    if (!heightDrag) return;
    const h = Math.max(MIN_HEIGHT, Math.round(heightDrag.h0 + (event.clientY - heightDrag.y0)));
    heightDrag.h = h;
    applyInlineHeight(h);
  };
  const onHeightUp = () => {
    if (!heightDrag) return;
    try {
      storage?.setItem?.(heightKey, String(heightDrag.h));
    } catch {
    }
    heightDrag = null;
    doc.removeEventListener("pointermove", onHeightMove, true);
    doc.removeEventListener("pointerup", onHeightUp, true);
    measure();
    markViewport();
  };
  listen(resizeGrip, "pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    heightDrag = { y0: event.clientY, h0: rootRect.height || readHeight(), h: rootRect.height || readHeight() };
    doc.addEventListener("pointermove", onHeightMove, true);
    doc.addEventListener("pointerup", onHeightUp, true);
  });
  const resetGrown = () => {
    if (!grown.size) return;
    const ids = [...grown];
    grown = /* @__PURE__ */ new Set();
    itemsR.resetRects(rects(), ids);
  };
  const previewFit = (touched, { parentOf, skip } = {}) => {
    const b = board2();
    if (!b || !flag("auto-fit-sections", true)) return;
    const plan = touched.length ? sectionFitPlan(b, effectiveRects(), touched, { parentOf, skip }) : [];
    const next = new Set(plan.map((p) => p.uid));
    const stale = [...grown].filter((u) => !next.has(u));
    if (stale.length) itemsR.resetRects(rects(), stale);
    const live = itemsR.previewSectionRects(plan.map(({ uid, rect }) => ({ uid, x: rect.x, y: rect.y, w: rect.w, h: rect.h })));
    if (!liveRects) liveRects = /* @__PURE__ */ new Map();
    for (const [uid, rect] of live) liveRects.set(uid, rect);
    grown = next;
  };
  const shortcutSheet = createShortcutSheet({ doc, root });
  const actions = {
    board: board2,
    rects,
    hitRects: () => paintRects(),
    viewport: () => vp,
    size: () => size,
    setViewport: moveViewport,
    animateViewport,
    fitAll,
    fitSelection,
    onSelection: (sel) => {
      selection = { items: sel.items || [], edge: sel.edge || null, link: sel.link || null };
      dirty.selection = true;
      panel.setSelection(singleItem());
      schedule();
    },
    onTool: (tool, locked) => {
      root.dataset.tool = tool;
      root.setAttribute("data-tool", tool);
      chrome.toolbar.setTool(tool, locked);
    },
    onHover: (uid) => itemsR.setHover(uid),
    setGesturing: (on, info) => {
      gesturing = Boolean(on);
      root.classList.toggle("pxd-root--gesturing", gesturing);
      world.style.willChange = gesturing ? "transform" : "";
      if (gesturing) {
        resumeTimer?.();
        resumeTimer = null;
        itemsR.setPaused(true);
        chrome.ctx.hide();
        menu.close();
      } else {
        if (info?.moved) {
          suppressClick = true;
          swallowMouseUp = true;
          timers.later(() => {
            suppressClick = false;
            swallowMouseUp = false;
          }, 0);
        }
        liveRects = null;
        resetGrown();
        resumeTimer = timers.later(() => {
          resumeTimer = null;
          itemsR.setPaused(false);
          applyLod();
          propsPanel.place();
          scheduleContent();
          vpStore.set(vpId, vp);
          dirty.selection = true;
          schedule();
          updateBackToContent();
          refreshBadges();
        }, RESUME_MS);
      }
    },
    showMarquee: (rect, kind) => edgesR.setMarquee(rect, kind),
    showLasso: (points) => edgesR.setLasso(points),
    showGuides: (guides) => edgesR.setGuides(guides),
    previewMove: (uids, dx, dy) => {
      const b = board2();
      if (!b) return;
      liveRects = itemsR.previewMove(uids, dx, dy, b, rects());
      const set = new Set(uids);
      for (const u of uids) for (const d of descendantsOf(b, u)) set.add(d);
      const top = new Set(uids);
      const eff = effectiveRects();
      previewFit(uids, {
        parentOf: (u) => top.has(u) && eff.get(u) ? containerAt(b, center(eff.get(u)), { exclude: set, rects: eff }) : b.items.get(u)?.parentUid
      });
      for (const u of grown) set.add(u);
      const links = paintedLinks();
      const linkKeys = new Set(links.filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: paintRects(), zoom: vp.zoom, linkKeys, links });
      dirty.minimap = true;
      schedule();
    },
    previewRects: (list) => {
      const b = board2();
      if (!b) return;
      liveRects = itemsR.previewRects(list);
      if (blockCards.size) scheduleAnchors();
      const set = new Set(list.map((r) => r.uid));
      previewFit(list.map((r) => r.uid), { skip: new Set(list.filter((r) => b.items.get(r.uid)?.type === "section").map((r) => r.uid)) });
      for (const u of grown) set.add(u);
      const links = paintedLinks();
      const linkKeys = new Set(links.filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: paintRects(), zoom: vp.zoom, linkKeys, links });
      dirty.minimap = true;
      schedule();
    },
    cancelPreview: () => resetGrown(),
    showGhosts: (list) => edgesR.setGhosts(list),
    duplicateItems: (uids, opts) => duplicate(uids, opts),
    openMenu: ({ kind, uid, screen, world: world2 }) => {
      const at = screen || { x: 0, y: 0 };
      return openMenuAt(kind, uid, { x: rootRect.left + at.x, y: rootRect.top + at.y }, world2 || screenToWorld(vp, at));
    },
    foldSelection,
    toggleFocus,
    exitFocus,
    quickLook: () => {
      if (quicklook.isOpen()) {
        quicklook.close();
        return;
      }
      const uid = lastSelected();
      const it = uid ? board2()?.items.get(uid) : null;
      if (it && it.type !== "section") quicklook.open(it);
    },
    closeQuickLook: () => quicklook.close(),
    present: () => startPresent(),
    presentActive: () => presenter.isActive(),
    presentNext: () => presenter.next(),
    presentPrev: () => presenter.prev(),
    exitPresent: () => presenter.stop(),
    expandOutline: (uid) => expandOutline(uid),
    fitHeight: (uid) => fitHeight(uid),
    fitSection: (uid) => session.fitSection?.(uid),
    resetSize: (uids) => session.resetSize?.(uids),
    showTempWire: (spec) => edgesR.setTempWire(spec, rects(), vp.zoom),
    blockTarget: (pt) => blockTargetAt(pt),
    clearBlockTarget: () => clearBlockTarget(),
    revealBlockEnd: (edgeUid, end) => revealBlockEnd(edgeUid, end),
    updateEdge: (uid, patch) => session.updateEdge?.(uid, patch),
    commitMove: (uids, dx, dy) => session.commitMove?.(uids, dx, dy),
    commitRects: (list) => session.commitRects?.(list),
    createCard: (p) => Promise.resolve(session.createCard?.({ x: p.x, y: p.y })).then((uid) => {
      if (uid) freshItems.add(uid);
      return uid;
    }),
    createText: (p) => {
      const spec = { x: p.x, y: p.y };
      if (p.look) spec.look = p.look;
      if (typeof p.w === "number") spec.w = p.w;
      if (typeof p.h === "number") spec.h = p.h;
      if (p.color) spec.color = p.color;
      if (p.shape) spec.shape = p.shape;
      return Promise.resolve(session.createText?.(spec)).then((uid) => {
        if (uid) freshItems.add(uid);
        return uid;
      });
    },
    createSection: (p) => session.createSection?.({ rect: p.rect }),
    createBoard: (p) => session.createBoard?.({ rect: p.rect }),
    moveIntoBoard: async (uids, boardUid2, dx = 0, dy = 0) => {
      const res = await session.moveIntoBoard?.(uids, boardUid2);
      if (!res) {
        void session.commitMove?.(uids, dx, dy);
        return;
      }
      chrome.toast.show({ message: `Moved into ${res.title}`, action: { label: "Undo", run: () => res.undo() } });
    },
    openBoard: (uid) => openBoard(uid),
    isBoardCard: (uid) => Boolean(boardTargetOf(uid)),
    popBoard,
    historyBack: () => onHistoryBack?.(),
    historyForward: () => onHistoryForward?.(),
    wrapInSection: (uids) => session.wrapInSection?.(uids),
    deleteItems: (uids, opts) => session.deleteItems?.(uids, opts),
    deleteEdges: (uids) => session.deleteEdges?.(uids),
    addEdge: (spec) => session.addEdge?.(spec),
    undo: () => session.undo?.(),
    redo: () => session.redo?.(),
    enterEdit: (uid, opts) => enterEdit(uid, opts),
    openPage: (uid, { sidebar = false } = {}) => {
      const item = board2()?.items.get(uid);
      if (item?.kind !== "page") return;
      const pageUid = host?.pageUid?.(item.target?.title || item.title);
      if (!pageUid) return;
      if (sidebar) host?.openInSidebar?.(pageUid, "outline");
      else host?.openPage?.(pageUid);
    },
    exitEdit: () => exitEdit(),
    isEditing: () => itemsR.isEditing(),
    editingUid: () => itemsR.editingUid(),
    autocompleteOpen: () => itemsR.autocompleteOpen(),
    renameSection: (uid) => itemsR.renameSection(uid),
    renamePage: (uid) => itemsR.renamePage(uid),
    editLabel: (uid) => edgesR.editLabel(uid),
    openBlock: (uid) => host?.openBlock?.(uid),
    toast: (t) => chrome.toast.show(t),
    openSearch: () => chrome.search.open(),
    toggleShortcuts: () => shortcutSheet.toggle(),
    openInfo: () => openInfo(),
    addInfoTab: (uid) => {
      const item = board2()?.items.get(uid);
      if (item && item.type !== "section") panel.addInfoTab(item);
    },
    cycleLinks,
    isFullscreen: () => isFullscreen,
    setFullscreen: (on) => requestFullscreen(on),
    setSpace: (on) => root.classList.toggle("pxd-root--space", Boolean(on))
  };
  let targetEl = null;
  let targetCls = "";
  const clearBlockTarget = () => {
    if (!targetEl) return;
    targetEl.classList.remove(targetCls);
    targetEl = null;
  };
  const blockTargetAt = (pt) => {
    clearBlockTarget();
    if (!pt || typeof doc.elementsFromPoint !== "function") return null;
    for (const node2 of doc.elementsFromPoint(pt.x, pt.y) || []) {
      const card2 = node2.closest?.(".pxd-item");
      if (!card2) continue;
      if (!card2.classList.contains("pxd-item--page") || card2.closest?.(".pxd-root") !== root) return null;
      const uid = card2.dataset?.uid || card2.getAttribute?.("data-uid");
      const row2 = node2.closest?.("[data-pxd-row]");
      const header = row2 ? null : node2.closest?.(".pxd-item__header");
      targetEl = row2 || header || null;
      targetCls = row2 ? "pxd-row--target" : "pxd-item__header--target";
      targetEl?.classList.add(targetCls);
      return { uid, row: row2 ? row2.getAttribute?.("data-pxd-row") || row2.dataset?.pxdRow || null : null, header: Boolean(header) };
    }
    return null;
  };
  const revealBlockEnd = (edgeUid, end) => {
    const e = board2()?.edges.get(edgeUid);
    if (!e) return false;
    const card2 = end === "from" ? e.from : e.to;
    const block = end === "from" ? e.fromBlock : e.toBlock;
    if (!block) return false;
    if (itemsR.revealRow(card2, block)) return true;
    host?.openInSidebar?.(block, "block");
    return false;
  };
  const ctl = createInteractions({ actions, settings });
  ctl.setTool("select");
  const targetOf = (t) => {
    if (!t || typeof t.closest !== "function") return { kind: "empty" };
    if (t.closest(".pxd-chrome")) return { kind: "chrome" };
    const port = t.closest(".pxd-port");
    if (port) {
      const owner = port.closest(".pxd-item, .pxd-section");
      return { kind: "port", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), side: port.dataset?.side || port.getAttribute?.("data-side") };
    }
    const grip = t.closest(".pxd-grip");
    if (grip) {
      const owner = grip.closest(".pxd-item, .pxd-section");
      return { kind: "grip", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), part: grip.dataset?.part || grip.getAttribute?.("data-part") };
    }
    const endHandle = t.closest(".pxd-edge__end");
    if (endHandle) return { kind: "edge-end", uid: endHandle.closest(".pxd-edge")?.dataset?.uid || endHandle.closest(".pxd-edge")?.getAttribute?.("data-uid"), end: endHandle.dataset?.end || endHandle.getAttribute?.("data-end") };
    const clamped = t.closest(".pxd-edge__bend--clamped");
    if (clamped) return { kind: "edge-marker", uid: clamped.closest(".pxd-edge")?.dataset?.uid || clamped.closest(".pxd-edge")?.getAttribute?.("data-uid"), end: clamped.dataset?.end || clamped.getAttribute?.("data-end") };
    const label = t.closest(".pxd-label");
    if (label) {
      const key = label.dataset?.key || label.getAttribute?.("data-key");
      if (key) return { kind: "link", key };
      return { kind: "label", uid: label.dataset?.uid || label.getAttribute?.("data-uid") };
    }
    const edge = t.closest(".pxd-edge");
    if (edge) return { kind: "edge", uid: edge.dataset?.uid || edge.getAttribute?.("data-uid") };
    const link = t.closest(".pxd-link");
    if (link) return { kind: "link", key: link.dataset?.key || link.getAttribute?.("data-key") };
    const title = t.closest(".pxd-section__title");
    if (title) return { kind: "section-title", uid: title.closest(".pxd-section")?.dataset?.uid || title.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const border = t.closest(".pxd-section__edge");
    if (border) return { kind: "section-border", uid: border.closest(".pxd-section")?.dataset?.uid || border.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const item = t.closest(".pxd-item");
    if (item) {
      const hit = { kind: "item", uid: item.dataset?.uid || item.getAttribute?.("data-uid"), part: t.closest(".pxd-item__header") ? "header" : "body" };
      const row2 = nativeClickKind(t) ? null : t.closest("[data-pxd-row]");
      if (row2) hit.row = row2.getAttribute?.("data-pxd-row") || row2.dataset?.pxdRow || "";
      return hit;
    }
    return { kind: "empty" };
  };
  const normalize = (event, type = event.type) => {
    const screen = { x: (event.clientX || 0) - rootRect.left, y: (event.clientY || 0) - rootRect.top };
    return {
      type,
      screen,
      client: { x: event.clientX || 0, y: event.clientY || 0 },
      world: screenToWorld(vp, screen),
      target: targetOf(event.target),
      button: event.button ?? 0,
      buttons: event.buttons ?? 0,
      shift: Boolean(event.shiftKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
      ctrl: Boolean(event.ctrlKey),
      key: event.key,
      code: event.code,
      deltaX: event.deltaX || 0,
      deltaY: event.deltaY || 0,
      pointerId: event.pointerId
    };
  };
  let captured = false;
  const onDocMove = (event) => {
    if (ctl.isGesturing()) ctl.handle(normalize(event, "pointermove"));
  };
  const onDocUp = (event) => {
    if (!ctl.isGesturing()) return releaseCapture();
    ctl.handle(normalize(event, "pointerup"));
    if (nativeClickKind(event.target) === "ref" && !suppressClick) openRefFromClick(event);
    releaseCapture();
  };
  const onDocCancel = () => {
    ctl.handle({ type: "pointercancel" });
    releaseCapture();
  };
  const releaseCapture = () => {
    if (!captured) return;
    captured = false;
    doc.removeEventListener("pointermove", onDocMove, true);
    doc.removeEventListener("pointerup", onDocUp, true);
    doc.removeEventListener("pointercancel", onDocCancel, true);
  };
  const toggleClickedTodo = (node2) => {
    const card2 = node2?.closest?.(".pxd-item");
    const uid = card2?.getAttribute?.("data-uid") || card2?.dataset?.uid;
    if (!uid) return;
    const stringRoot = node2.closest?.(".pxd-item__string") || card2;
    const boxes = [...stringRoot.querySelectorAll('input[type="checkbox"]')];
    const hit = node2.closest?.("input, label, .check-container");
    const input = String(hit?.tagName || "").toLowerCase() === "input" ? hit : hit?.querySelector?.('input[type="checkbox"]');
    const index = input ? boxes.indexOf(input) : 0;
    const next = toggleTodoAt(board2()?.items?.get(uid)?.string, index < 0 ? 0 : index);
    if (next == null) return;
    session.setString?.(uid, next);
  };
  listen(root, "pointerdown", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    if (event.target?.closest?.(".pxd-refs")) {
      event.stopPropagation();
      return;
    }
    if (nativeClickKind(event.target) === "checkbox") {
      toggleClickedTodo(event.target);
      return;
    }
    measure();
    const ev = normalize(event, "pointerdown");
    const editingUid = itemsR.editingUid();
    const native = nativeClickKind(event.target);
    if (!(editingUid && ev.target.kind === "item" && ev.target.uid === editingUid && ev.target.part !== "header")) {
      event.stopPropagation();
      if (native !== "image" && ev.target.kind !== "label" && ev.target.kind !== "section-title") event.preventDefault();
    }
    ctl.handle(ev);
    if (ctl.isGesturing() && !captured) {
      captured = true;
      doc.addEventListener("pointermove", onDocMove, true);
      doc.addEventListener("pointerup", onDocUp, true);
      doc.addEventListener("pointercancel", onDocCancel, true);
    }
    try {
      if (!editingUid && ev.target.kind !== "label") root.focus({ preventScroll: true });
    } catch {
    }
  });
  listen(doc, "mouseup", (event) => {
    if (!swallowMouseUp) return;
    swallowMouseUp = false;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);
  for (const type of ["mousedown", "mouseup"]) {
    listen(root, type, (event) => {
      if (event.target?.closest?.(".pxd-chrome")) return;
      const native = nativeClickKind(event.target);
      if (native === "checkbox" || native === "image") return;
      const editing = itemsR.editingUid();
      if (editing && event.target?.closest?.(".pxd-item--editing")) return;
      event.stopPropagation();
    });
  }
  listen(root, "dragstart", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-item--editing, .pxd-refs__row")) return;
    event.preventDefault();
  });
  listen(root, "click", (event) => {
    if (suppressClick) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (openRefFromClick(event)) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);
  let lastRefKey = "";
  let lastRefAt = 0;
  const openRefFromClick = (event) => {
    const t = event.target;
    if (!t?.closest || !t.closest(".pxd-item") || t.closest(".pxd-item--editing")) return false;
    const api = host?.api;
    const page = t.closest("[data-link-uid]");
    const block = t.closest(".rm-block-ref[data-uid]");
    const uid = page?.getAttribute("data-link-uid") || block?.getAttribute("data-uid");
    if (!uid || !api?.ui) return false;
    const key = `${uid}:${event.shiftKey ? 1 : 0}`;
    const now2 = Date.now();
    if (key === lastRefKey && now2 - lastRefAt < 500) return true;
    lastRefKey = key;
    lastRefAt = now2;
    if (event.shiftKey) api.ui.rightSidebar?.addWindow?.({ window: { type: page ? "outline" : "block", "block-uid": uid } });
    else if (page) api.ui.mainWindow?.openPage?.({ page: { uid } });
    else api.ui.mainWindow?.openBlock?.({ block: { uid } });
    return true;
  };
  listen(root, "click", (event) => {
    const kind = nativeClickKind(event.target);
    if (kind === "image" || kind === "checkbox") return;
    if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation();
  });
  listen(root, "dblclick", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-refs")) return;
    if (nativeClickKind(event.target)) return;
    event.stopPropagation();
    event.preventDefault();
    measure();
    ctl.handle(normalize(event, "dblclick"));
  });
  listen(root, "wheel", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    if (pageBodyWantsWheel(event.target, event)) {
      event.stopPropagation();
      return;
    }
    measure();
    const handled = ctl.handle(normalize(event, "wheel"));
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      settle();
    }
  }, { passive: false });
  listen(root, "contextmenu", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    event.stopPropagation();
    if (event.defaultPrevented) return;
    const native = event.target?.closest?.(NATIVE_MENU_TARGETS);
    if (native && native.closest?.(".pxd-item__body")) return;
    measure();
    const handled = ctl.handle(normalize(event, "contextmenu"));
    if (handled) event.preventDefault();
  });
  const showHover = (uid) => {
    if (gesturing || itemsR.isEditing()) {
      hoverUid = null;
      return;
    }
    if (selectionOwnsBar()) {
      hoverUid = null;
      return;
    }
    if (!uid) {
      if (hoverUid) {
        hoverUid = null;
        chrome.ctx.hide();
      }
      return;
    }
    if (uid === hoverUid && chrome.ctx.isOpen()) return;
    const it = board2()?.items.get(uid);
    if (!it || it.type !== "card") {
      if (hoverUid) {
        hoverUid = null;
        chrome.ctx.hide();
      }
      return;
    }
    hoverUid = uid;
    const anchor = () => {
      const r = rects().get(uid);
      return r ? { kind: "items", rect: toScreenRect(r) } : null;
    };
    chrome.ctx.show(it.kind === "board" ? "board" : "card", cardModel(it), anchor);
  };
  listen(root, "pointermove", (event) => {
    lastPointer = { x: event.clientX || 0, y: event.clientY || 0 };
    if (event.target?.closest?.(".pxd-chrome")) return;
    const node2 = event.target?.closest?.(".pxd-item--card");
    showHover(node2?.getAttribute?.("data-uid") || node2?.dataset?.uid || null);
  });
  listen(root, "pointerenter", () => {
    pointerInside = true;
    pointerBoard = root;
  });
  listen(root, "pointerleave", () => {
    pointerInside = false;
    if (pointerBoard === root) pointerBoard = null;
  });
  const dropEffectFor = (effectAllowed) => {
    const a = String(effectAllowed || "uninitialized");
    if (a === "all" || a === "uninitialized" || /copy/i.test(a)) return "copy";
    if (/move/i.test(a)) return "move";
    if (/link/i.test(a)) return "link";
    return "copy";
  };
  const onDragAccept = (event) => {
    const editor = event.target?.closest?.(".pxd-item__editor");
    if (editor) {
      if (!dragHasImages(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
  };
  listen(root, "dragenter", onDragAccept);
  listen(root, "dragover", onDragAccept);
  listen(root, "drop", (event) => {
    const editor = event.target?.closest?.(".pxd-item__editor");
    if (editor) {
      const files2 = filesFromDataTransfer(event.dataTransfer);
      if (!files2.length) return;
      event.preventDefault();
      event.stopPropagation();
      const ta = editorTextarea(event.target) || editorTextarea(editor);
      const cardUid = itemsR.editingUid?.();
      const role = inputBlockRole(ta || event.target, cardUid);
      void pasteEditorImages(ta, role.uid || cardUid, files2);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    measure();
    const p = screenToWorld(vp, { x: event.clientX - rootRect.left, y: event.clientY - rootRect.top });
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) {
      void pasteImages(files, p);
      return;
    }
    const resolveUid = (u) => host?.cardStringForUid ? host.cardStringForUid(u) : `((${u}))`;
    const list = parseDropPayload(event.dataTransfer, { resolveUid, graph: host?.graph || "" });
    if (!list.length) return;
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const isPage = (string) => /^\[\[[^\]]+\]\]$/.test(String(string).trim());
    let dropY = p.y - h / 2;
    const placed = list.map((x) => {
      const page = isPage(x.string);
      const entry = page ? { string: x.string, x: p.x - PAGE_CARD.w / 2, y: dropY, w: PAGE_CARD.w, h: PAGE_CARD.h } : { string: x.string, x: p.x - w / 2, y: dropY };
      dropY += (page ? PAGE_CARD.h : h) + 24;
      return entry;
    });
    const made = session.addRefCards?.(placed);
    const offer = dropNamespace(list.map((x) => x.string));
    Promise.resolve(made).then((uids) => {
      if (Array.isArray(uids) && uids.length) ctl.select(uids);
      if (!offer || !Array.isArray(uids) || disposed) return;
      const mine = offer.indexes.map((i) => uids[i]).filter(Boolean);
      if (!mine.length) return;
      chrome.toast.show({
        message: `Group under ${offer.parent}`,
        action: { label: `Group under ${offer.parent}`, run: () => {
          void session.groupUnder?.(mine, offer.parent);
        } }
      });
    }).catch(() => {
    });
  });
  const openFocusedCardMenu = (hostEl) => {
    const uid = hostEl.dataset?.uid || hostEl.getAttribute?.("data-uid");
    const item = uid ? board2()?.items.get(uid) : null;
    if (!item) return false;
    const kind = item.type === "section" ? "section" : item.type === "text" ? "text" : "card";
    const rect = hostEl.getBoundingClientRect();
    const box2 = root.getBoundingClientRect();
    const screen = { x: (rect.left || 0) - (box2.left || 0), y: (rect.bottom || 0) - (box2.top || 0) };
    const ok = openMenuAt(kind, uid, { x: rect.left || 0, y: rect.bottom || 0 }, screenToWorld(vp, screen));
    if (ok) menu.focusFirst?.();
    return ok;
  };
  const ownsKeyboard = () => {
    const active = doc.activeElement;
    const activeRoot = active?.closest?.(".pxd-root");
    if (activeRoot) return activeRoot === root;
    if (pointerBoard) return pointerBoard === root;
    return isFullscreen;
  };
  let outsideQuiet = null;
  let swallowEnterUp = false;
  const onKeyDown = (event) => {
    if (isTextEntryTarget(event.target) && !root.contains?.(event.target)) {
      itemsR.quiet(true);
      if (outsideQuiet) outsideQuiet();
      outsideQuiet = timers.later(() => {
        outsideQuiet = null;
        if (!disposed) itemsR.quiet(false);
      }, 700);
      return;
    }
    if (outsideQuiet) {
      outsideQuiet();
      outsideQuiet = null;
      itemsR.quiet(false);
    }
    if (outlineMode && !event.target?.closest?.(".pxd-mode")) return;
    if (tableMode && !event.target?.closest?.(".pxd-toolbar__table")) return;
    if (kanbanMode && !event.target?.closest?.(".pxd-toolbar__kanban")) return;
    const addBoard = doc.querySelector?.(".pxd-addboard");
    if (addBoard) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        addBoard.dispatchEvent(new CustomEvent("pxd-close"));
      }
      return;
    }
    if (menu.isOpen()) return;
    if (shortcutSheet.isOpen()) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        shortcutSheet.close();
      }
      return;
    }
    const cardHost = doc.activeElement?.closest?.(".pxd-item, .pxd-section");
    const chord = { key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey };
    if (cardHost && root.contains(cardHost) && findShortcut(chord, "view")?.action === "cardMenu") {
      event.preventDefault();
      event.stopPropagation();
      openFocusedCardMenu(cardHost);
      return;
    }
    if (event.key === "Escape" && blockEdit && !doc.querySelector?.(".rm-autocomplete__results")) {
      event.preventDefault();
      event.stopPropagation();
      closeBlockEdit();
      return;
    }
    if (event.key === "Escape" && chrome.popover.isOpen()) {
      chrome.popover.close();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" && chrome.changelog?.isOpen()) {
      chrome.changelog.close();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (quicklook.isOpen() && event.key !== "Escape" && String(event.key).toLowerCase() !== "q") return;
    if (presenter.isActive() && !["Escape", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "p", "P"].includes(event.key)) return;
    const findKey = (event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === "f";
    const findInSearch = event.target?.closest?.(".pxd-search") || doc.activeElement?.closest?.(".pxd-search");
    if (findKey && findInSearch && root.contains?.(findInSearch)) {
      event.preventDefault();
      event.stopPropagation();
      chrome.search.open();
      return;
    }
    const inputFocused = isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement);
    if (inputFocused) {
      const inside3 = root.contains?.(event.target) || root.contains?.(doc.activeElement);
      if (!inside3 && !itemsR.isEditing()) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === "z") return;
    } else if (!ownsKeyboard()) {
      return;
    }
    if (!inputFocused && itemsR.isEditing() && event.key !== "Escape") {
      itemsR.recoverFocus();
      return;
    }
    if (inputFocused && itemsR.isEditing()) {
      const ta = String(event.target?.tagName || "").toLowerCase() === "textarea" ? event.target : doc.activeElement;
      if (ta && String(ta.tagName || "").toLowerCase() === "textarea") {
        const uid = itemsR.editingUid();
        const role = inputBlockRole(ta, uid);
        const action = editorKeyAction({
          key: event.key,
          shift: event.shiftKey,
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          autocomplete: itemsR.autocompleteOpen(),
          isRoot: role.role === "root",
          fresh: freshItems.has(uid),
          value: ta.value || "",
          selectionStart: Number.isFinite(ta.selectionStart) ? ta.selectionStart : 0,
          selectionEnd: Number.isFinite(ta.selectionEnd) ? ta.selectionEnd : Number.isFinite(ta.selectionStart) ? ta.selectionStart : 0,
          enterMode: setting("enter-in-card", "newline")
        });
        if (action.type === "newline") {
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          swallowEnterUp = true;
          return;
        }
        if (action.type === "delete-card") {
          event.preventDefault();
          event.stopPropagation();
          void exitEdit();
          return;
        }
      }
    }
    const focused = doc.activeElement;
    const onCard = Boolean(focused?.closest?.(".pxd-item, .pxd-section"));
    const onChrome = Boolean(focused?.closest?.(".pxd-chrome"));
    const tabOwned = Boolean(focused) && !onCard && (focused === root || Boolean(root.contains?.(focused)) && !onChrome);
    if (onChrome && root.contains(focused) && (event.key === "Enter" || event.key === " ")) {
      if (event.key === "Enter" && String(focused.tagName || "").toLowerCase() === "button" && !focused.disabled) {
        event.preventDefault();
        focused.click();
      }
      return;
    }
    const handled = ctl.handle({ type: "keydown", key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey, inputFocused, tabOwned });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onKeyUp = (event) => {
    if (swallowEnterUp && event.key === "Enter") {
      swallowEnterUp = false;
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      return;
    }
    ctl.handle({ type: "keyup", key: event.key, code: event.code });
  };
  listen(doc, "input", (event) => {
    if (!root.contains?.(event.target)) host?.invalidateUndo?.();
  }, true);
  listen(win, "keydown", onKeyDown, true);
  listen(win, "keyup", onKeyUp, true);
  const clip = createClipboardIO({
    doc,
    root,
    ownsKeyboard,
    isTextEntry: isTextEntryTarget,
    on: {
      getPayload: ({ cut = false } = {}) => {
        const b = board2();
        if (!b || !selection.items.length) return null;
        const payload = copyPayload(b, selection.items, rects());
        if (!payload.text) return null;
        if (cut) {
          const snapshot = session.snapshotItems?.(selection.items);
          if (snapshot) {
            try {
              payload.mime = JSON.stringify({ ...JSON.parse(payload.mime), snapshot });
            } catch {
            }
          }
        }
        lastPayload = payload;
        return payload;
      },
      cutDone: () => {
        ctl.deleteSelection(true);
      },
      pastePlexus: (data, opts) => pastePlexus(data, opts),
      pasteText: (entries) => pasteEntries(entries),
      pasteImages: (files) => {
        void pasteImages(files);
      },
      editorPaste
    }
  });
  subs.push(session.on("change", ({ dirty: d, structural } = {}) => {
    if (disposed) return;
    const b = board2();
    const current2 = crumbList[crumbList.length - 1];
    if (current2 && b) {
      const title = b.title || UNTITLED_BOARD;
      if (current2.title !== title) {
        current2.title = title;
        chrome.toolbar.setCrumbs(crumbList);
      }
    }
    if (structural || !d) dirty.structural = true;
    if (d && b) {
      for (const uid of d) {
        if (b.edges.has(uid)) dirty.edges.add(uid);
        else dirty.items.add(uid);
      }
    } else dirty.all = true;
    if (!d || d.has?.(boardUid)) applyBackground();
    ctl.reconcile();
    dirty.selection = true;
    schedule();
    if (outlineMode) syncOutline();
    if (tableMode) tableCtl.refresh();
    if (kanbanMode) kanbanCtl.refresh();
    if (laterCtl.isOpen()) laterCtl.refresh();
  }));
  subs.push(session.on("links", () => {
    dirty.links = true;
    schedule();
  }));
  subs.push(session.on("sync", (state) => chrome.toolbar.setSync(state)));
  subs.push(session.on("toast", (t) => chrome.toast.show(t)));
  tableCtl = mountTable({
    doc,
    root,
    host,
    getBoard: board2
  });
  kanbanCtl = mountKanban({
    doc,
    root,
    host,
    getBoard: board2
  });
  laterCtl = mountLater({
    doc,
    root,
    getBoard: board2,
    onClose: () => laterCtl.close()
  });
  if (inSidebar) setOutline(true);
  const RO = globalThis.ResizeObserver;
  if (typeof RO === "function") {
    try {
      const ro = new RO(() => {
        measure();
        markViewport();
        chrome.ctx.reposition();
      });
      ro.observe(root);
      observers.push(ro);
    } catch {
    }
  }
  const MO = globalThis.MutationObserver;
  if (typeof MO === "function") {
    try {
      let settle2 = null;
      const mo = new MO(() => {
        if (disposed) return;
        applyTheme();
        settle2?.();
        settle2 = timers.later(() => {
          settle2 = null;
          applyTheme();
        }, 300);
      });
      for (const node2 of [doc.documentElement, doc.body]) if (node2) mo.observe(node2, { attributes: true, attributeFilter: ["class"] });
      observers.push(mo);
    } catch {
    }
  }
  try {
    const mq = win?.matchMedia?.("(prefers-color-scheme: dark)");
    if (mq?.addEventListener) listen(mq, "change", () => {
      if (!disposed) applyTheme();
    });
  } catch {
  }
  try {
    if (motionMq?.addEventListener) listen(motionMq, "change", () => {
      if (!disposed) applyMotion();
    });
  } catch {
  }
  routeOff = watchRouteExit({ boardUid: routeUid, onExit: () => {
    if (isFullscreen) requestFullscreen(false);
  }, win });
  const renderFrame = () => {
    if (disposed) return;
    const b = board2();
    if (!b) return;
    let itemsChanged = false;
    if (dirty.all || dirty.structural || dirty.items.size) {
      itemsR.sync({
        board: b,
        rects: paintRects(),
        dirty: dirty.all ? null : dirty.items,
        structural: dirty.structural,
        view: size.width ? visibleWorldRect(vp, size, CULL_MARGIN) : null
      });
      syncEmptyHint(emptyHint, b);
      itemsChanged = true;
    }
    const edgesDue = dirty.all || dirty.structural || dirty.links || dirty.edges.size;
    const itemsMoveEdges = dirty.items.size && !dirty.all && !dirty.structural;
    if (edgesDue || itemsMoveEdges) {
      const shown = paintRects();
      if (edgesDue) {
        const links = paintedLinks();
        edgesR.render({ board: b, rects: shown, links, coveredEdges: session.coveredEdges || /* @__PURE__ */ new Set(), selection, zoom: vp.zoom, dirty: dirty.all || dirty.structural || dirty.links ? null : dirty.edges });
        paintLegend();
      }
      if (itemsMoveEdges) {
        const links = paintedLinks();
        edgesR.update({ board: b, edgeUids: edgesTouching(b, dirty.items), rects: shown, zoom: vp.zoom, linkKeys: new Set(links.map((l) => l.key)), links });
      }
    }
    if (dirty.viewport) {
      world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
      itemsR.setZoom(vp.zoom);
      const nextTier = lodTier(vp.zoom, tier, { threshold: mapThreshold() });
      if (nextTier !== tier) {
        tier = nextTier;
        paintTier();
      }
      if (!gesturing) {
        const g = gridBackground(vp, bgPattern);
        if (g) {
          grid.style.backgroundSize = `${g.size}px ${g.size}px`;
          grid.style.backgroundPosition = `${g.x}px ${g.y}px`;
          if (bgPattern === "grid") {
            const mod = (v) => (v % g.major + g.major) % g.major;
            grid.style.setProperty("--pxd-grid-major", `${g.major}px`);
            grid.style.setProperty("--pxd-grid-major-x", `${mod(vp.x)}px`);
            grid.style.setProperty("--pxd-grid-major-y", `${mod(vp.y)}px`);
          }
        }
      }
      chrome.toolbar.setZoom(vp.zoom);
      if (!gesturing) propsPanel.place();
    }
    if (dirty.selection || itemsChanged) {
      itemsR.setSelection(selection.items);
      edgesR.setSelection({ edge: selection.edge, link: selection.link });
      if (!gesturing && !itemsR.isEditing()) showCtx();
      else chrome.ctx.hide();
      syncProps();
      if (lensTag && dirty.structural) rebuildLens();
      if (focusOn || lensTag) applyFocus();
    } else if (dirty.viewport && chrome.ctx.isOpen()) {
      chrome.ctx.reposition();
    }
    if (itemsChanged || dirty.minimap || dirty.viewport && !gesturing) chrome.minimap.update({ board: b, rects: paintRects(), vp, size });
    if (itemsChanged && !gesturing) {
      scheduleContent();
      updateBackToContent();
      panel.refreshOutline();
      if (dirty.all || dirty.structural) scheduleBadges(50);
    }
    if (edgesDue || itemsChanged || itemsMoveEdges) {
      if (refreshBlockCards()) scheduleAnchors();
      else edgesR.setMeasures(/* @__PURE__ */ new Map());
    }
    if (searchMatches.length || root.classList.contains("pxd-root--searching")) panel.refreshMarks();
    dirty.minimap = false;
    dirty.viewport = false;
    dirty.items = /* @__PURE__ */ new Set();
    dirty.edges = /* @__PURE__ */ new Set();
    dirty.structural = false;
    dirty.all = false;
    dirty.selection = false;
    dirty.links = false;
  };
  const pulseItem = (uid) => {
    const shell = itemsR.shellOf(uid);
    if (!shell) return;
    const ms = motionProfile(currentMotion()).pulseMs;
    shell.classList.remove("pxd-item--pulse");
    if (ms <= 0) return;
    void shell.offsetWidth;
    shell.classList.add("pxd-item--pulse");
    timers.later(() => {
      if (!disposed) shell.classList.remove("pxd-item--pulse");
    }, ms);
  };
  const consumeDeepLink = (hash = win?.location?.hash || "") => {
    if (disposed) return false;
    const target = pxdTarget(hash);
    if (!target?.cardUid) return false;
    const b = board2();
    if (!b?.items?.has(target.cardUid)) return false;
    let pageUid = "";
    try {
      pageUid = host?.blockPageUid?.(boardUid) || "";
    } catch {
      pageUid = "";
    }
    if (target.pageUid && pageUid && target.pageUid !== pageUid) return false;
    ctl.select([target.cardUid]);
    fitSelection([target.cardUid]);
    if (itemsR.shellOf(target.cardUid)) pulseItem(target.cardUid);
    else timers.frame(() => {
      if (!disposed) pulseItem(target.cardUid);
    });
    return true;
  };
  listen(win, "hashchange", (event) => {
    const fromEvent = hashFromUrl(event?.newURL);
    consumeDeepLink(fromEvent || void 0);
  });
  applyFullscreen(fullscreen);
  measure();
  if (autofocus) {
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
  }
  if (!vp) {
    const b = board2();
    const r = b ? rects() : /* @__PURE__ */ new Map();
    vp = fitViewport(boundsOf([...r.values()]), size.width && size.height ? size : { width: 800, height: 560 }, { padding: 64, maxZoom: 1 });
  }
  applyBackground();
  applyMotion();
  applyLod();
  itemsR.setShowBadges(flag("show-card-badges", true));
  dirty.viewport = true;
  markAll();
  consumeDeepLink();
  timers.later(() => {
    if (!disposed) {
      scheduleContent();
      updateBackToContent();
    }
  }, 0);
  const localDay = (date = /* @__PURE__ */ new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const Reader = globalThis.FileReader;
    if (typeof Reader !== "function" || !blob) {
      resolve("");
      return;
    }
    const reader = new Reader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    try {
      reader.readAsDataURL(blob);
    } catch {
      resolve("");
    }
  });
  const dataUrlFor = async (src) => {
    if (typeof src !== "string" || !src) return "";
    if (src.startsWith("data:")) return src;
    if (typeof host?.getFile !== "function") return "";
    try {
      const file = await host.getFile(src);
      const data = await blobToDataUrl(file);
      return data.startsWith("data:") ? data : "";
    } catch {
      return "";
    }
  };
  const svgOf = async (b, uids = null) => {
    const pictured = uids ? sliceBoard(b, uids) : b;
    const hrefs = /* @__PURE__ */ new Map();
    for (const item of pictured.items.values()) {
      if (item.kind !== "image") continue;
      const data = await dataUrlFor(imageSrc(item.string));
      if (data) hrefs.set(item.uid, data);
    }
    const text2 = boardToSvg(pictured, rects(), { dark: root.classList.contains("pxd-root--dark"), imageHrefs: hrefs });
    return dropExternalImages(text2);
  };
  const pngName = (b) => {
    let pageTitle = "";
    try {
      pageTitle = host?.pageTitleOf?.(b.uid) || "";
    } catch {
      pageTitle = "";
    }
    return pngFileName({ boardTitle: b.title || UNTITLED_BOARD, pageTitle, date: localDay() });
  };
  async function pngBlob(b, uids = null) {
    return rasterizeSvg(doc, await svgOf(b, uids));
  }
  async function exportPng() {
    const b = board2();
    if (!b) return false;
    try {
      const blob = await pngBlob(b);
      if (!blob) {
        if (!disposed) toast("PNG failed");
        return false;
      }
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = pngName(b);
      doc.body.append(a);
      a.click();
      a.remove();
      timers.later(() => URL.revokeObjectURL(url), 4e3);
      if (!disposed) toast("Saved PNG");
      return true;
    } catch {
      if (!disposed) toast("PNG failed");
      return false;
    }
  }
  async function copySelectionPng(uids) {
    const b = board2();
    if (!b || !uids?.length) {
      if (!disposed) toast("PNG failed");
      return false;
    }
    try {
      const blob = await pngBlob(b, uids);
      const Item = globalThis.ClipboardItem;
      const write = globalThis.navigator?.clipboard?.write;
      if (!blob || typeof Item !== "function" || typeof write !== "function") {
        if (!disposed) toast("Copy failed");
        return false;
      }
      await write.call(globalThis.navigator.clipboard, [new Item({ "image/png": blob })]);
      if (!disposed) toast("Copied PNG");
      return true;
    } catch {
      if (!disposed) toast("Copy failed");
      return false;
    }
  }
  const view = {
    root,
    controller: ctl,
    setFullscreen(on) {
      if (Boolean(on) !== isFullscreen) applyFullscreen(on);
    },
    fit() {
      fitAll();
    },
    viewport: () => ({ x: vp.x, y: vp.y, zoom: vp.zoom }),
    // Swap the settings object (feature.js calls this when a setting changes) and re-apply what depends on it.
    setSettings(next) {
      if (disposed) return;
      const minimapBefore = setting("show-minimap", true) !== false;
      settingsRef = next;
      const nextLinks = setting("graph-links", "all");
      if (nextLinks !== linkMode && LINK_MODES2.includes(nextLinks)) {
        linkMode = nextLinks;
        chrome.toolbar.setLinkMode(linkMode);
        session.setLinkMode?.(linkMode);
      }
      applyBackground();
      applyMotion();
      applyLod();
      const minimapNow = setting("show-minimap", true) !== false;
      if (minimapNow !== minimapBefore) chrome.minimap.setVisible(minimapNow);
      chrome.toolbar.applyControls?.();
      itemsR.setShowBadges(flag("show-card-badges", true));
      dirty.links = true;
      scheduleContent();
      scheduleBadges(0);
      dirty.viewport = true;
      schedule();
    },
    state() {
      return {
        zoom: vp.zoom,
        lod: tier,
        pattern: bgPattern,
        tone: bgTone ?? null,
        focus: focusOn,
        lens: lensTag,
        present: presenter.isActive(),
        selection: [...selection.items],
        mounted: itemsR.mountedCount(),
        menuOpen: menu.isOpen()
      };
    },
    // Serializes the board to SVG text; with download it also offers the file through a temporary link.
    async exportSvg({ download = true } = {}) {
      const b = board2();
      if (!b) return "";
      const text2 = boardToSvg(b, rects(), { dark: root.classList.contains("pxd-root--dark") });
      if (download) {
        try {
          const blob = new Blob([text2], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement("a");
          a.href = url;
          a.download = `${String(b.title || UNTITLED_BOARD).replace(/[\\/:*?"<>|]+/g, "-").trim() || "board"}.svg`;
          doc.body.append(a);
          a.click();
          a.remove();
          timers.later(() => URL.revokeObjectURL(url), 4e3);
        } catch {
        }
      }
      return text2;
    },
    async exportPng() {
      return exportPng();
    },
    addPage(at = null) {
      addPage(at);
    },
    async copyOutline() {
      const b = board2();
      if (!b) return "";
      const text2 = boardToMarkdown(b, rects());
      const ok = await writeClipboard({ text: text2 });
      if (!disposed) toast(ok ? "Outline copied" : "Copy failed");
      return text2;
    },
    stats() {
      return { timers: timers.count(), listeners: listeners2.length + (captured ? 3 : 0), observers: observers.length, mounted: itemsR.mountedCount(), shells: itemsR.shellCount() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      closeLens();
      pagePicker?.close();
      closeBlockEdit();
      if (pointerBoard === root) pointerBoard = null;
      clearOutline();
      tableCtl.dispose();
      kanbanCtl.dispose();
      laterCtl.dispose();
      stopTimer();
      ctl.cancel();
      releaseCapture();
      if (heightDrag) onHeightUp();
      subs.splice(0).forEach((off) => {
        try {
          off?.();
        } catch {
        }
      });
      routeOff();
      fsDispose();
      applyFullscreenChrome(mountEl, false, doc);
      try {
        vpStore.set(vpId, vp);
      } catch {
      }
      vpStore.flush?.();
      resumeTimer?.();
      settleTimer?.();
      frameHandle?.();
      badgeTimer?.();
      menu.dispose();
      quicklook.dispose();
      presenter.dispose();
      clip.dispose();
      itemsR.dispose();
      edgesR.dispose();
      panel.dispose();
      propsPanel.dispose();
      chrome.dispose();
      listeners2.splice(0).forEach((off) => off());
      observers.splice(0).forEach((o) => o.disconnect());
      timers.cancelAll();
      root.remove();
      released = true;
    }
  };
  return view;
}

// src/settings.js
var SETTING_IDS = Object.freeze({
  enabled: "enabled",
  fullscreenOnZoom: "fullscreen-on-zoom",
  graphLinks: "graph-links",
  attrStyles: "attr-styles",
  wheel: "wheel",
  showMinimap: "show-minimap",
  controlsPosition: "controls-position",
  snapGuides: "snap-guides",
  snapGrid: "snap-grid",
  grid: "grid",
  defaultCardWidth: "default-card-width",
  defaultCardHeight: "default-card-height",
  defaultCardLook: "default-card-look",
  enableShortcuts: "enable-shortcuts",
  showVersionBadge: "show-version-badge",
  disableOnMobile: "disable-on-mobile",
  collapseOutline: "collapse-outline",
  boardTone: "board-tone",
  mapZoom: "map-zoom",
  autoFitSections: "auto-fit-sections",
  spaceOut: "space-out",
  showCardBadges: "show-card-badges",
  showPalette: "show-palette",
  motion: "motion",
  enterInCard: "enter-in-card"
});
var DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.fullscreenOnZoom]: true,
  [SETTING_IDS.graphLinks]: "all",
  [SETTING_IDS.attrStyles]: "",
  [SETTING_IDS.wheel]: "pan",
  [SETTING_IDS.showMinimap]: true,
  [SETTING_IDS.controlsPosition]: "rail",
  [SETTING_IDS.snapGuides]: true,
  [SETTING_IDS.snapGrid]: false,
  [SETTING_IDS.grid]: "dots",
  [SETTING_IDS.defaultCardWidth]: 280,
  [SETTING_IDS.defaultCardHeight]: 160,
  [SETTING_IDS.defaultCardLook]: "block",
  [SETTING_IDS.enableShortcuts]: true,
  [SETTING_IDS.showVersionBadge]: true,
  [SETTING_IDS.disableOnMobile]: true,
  [SETTING_IDS.collapseOutline]: true,
  [SETTING_IDS.boardTone]: "none",
  [SETTING_IDS.mapZoom]: "0.45",
  [SETTING_IDS.autoFitSections]: true,
  [SETTING_IDS.spaceOut]: false,
  [SETTING_IDS.showCardBadges]: true,
  [SETTING_IDS.showPalette]: true,
  [SETTING_IDS.motion]: "full",
  [SETTING_IDS.enterInCard]: "newline"
});
var BOARD_TONES2 = ["none", "paper", "gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
var MAP_ZOOMS = ["0.3", "0.45", "0.6"];
var ENUMS = Object.freeze({
  [SETTING_IDS.graphLinks]: ["off", "attributes", "all"],
  [SETTING_IDS.wheel]: ["pan", "zoom"],
  [SETTING_IDS.controlsPosition]: ["rail", "bar"],
  [SETTING_IDS.grid]: ["dots", "lines", "grid", "plain"],
  [SETTING_IDS.defaultCardLook]: ["block", "card"],
  [SETTING_IDS.boardTone]: BOARD_TONES2,
  [SETTING_IDS.mapZoom]: MAP_ZOOMS,
  [SETTING_IDS.motion]: ["full", "reduced", "none"],
  [SETTING_IDS.enterInCard]: ["newline", "child"]
});
var NUMBERS = /* @__PURE__ */ new Set([SETTING_IDS.defaultCardWidth, SETTING_IDS.defaultCardHeight]);
function settingsDefaults() {
  return { ...DEFAULTS };
}
function normalizeSetting(id, value) {
  const fallback = DEFAULTS[id];
  if (value == null || value === "") return fallback;
  if (typeof fallback === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }
  if (NUMBERS.has(id)) {
    const n2 = Number(value);
    return Number.isFinite(n2) && n2 >= 40 ? n2 : fallback;
  }
  if (ENUMS[id]) {
    const text2 = typeof value === "number" ? String(value) : value;
    return ENUMS[id].includes(text2) ? text2 : fallback;
  }
  return value;
}
function readSettings(extensionAPI) {
  const out = {};
  for (const id of Object.keys(DEFAULTS)) {
    let raw = null;
    try {
      raw = extensionAPI?.settings?.get?.(id);
    } catch {
      raw = null;
    }
    out[id] = normalizeSetting(id, raw);
  }
  return out;
}
var settingsStore = null;
async function initializeSettings(extensionAPI) {
  settingsStore = extensionAPI ?? null;
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) {
      await extensionAPI.settings.set(id, value);
    }
  }
}
var listeners = /* @__PURE__ */ new Set();
function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(id, value) {
  for (const fn of [...listeners]) {
    try {
      fn(id, value);
    } catch (error) {
      console.error("[plexus-diagram] Settings listener failed", error);
    }
  }
}
function switchRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "switch", onChange: (event) => emit(id, event?.target?.checked ?? event) }
  };
}
function inputRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "input", onChange: (event) => emit(id, event?.target?.value ?? event) }
  };
}
function selectRow(id, name, description, items) {
  return {
    id,
    name,
    description,
    action: { type: "select", items, onChange: (value) => emit(id, value?.target?.value ?? value) }
  };
}
function groupRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "reactComponent", component: () => null }
  };
}
async function resetPlexusSettings() {
  const defaults = settingsDefaults();
  for (const [id, value] of Object.entries(defaults)) {
    try {
      await settingsStore?.settings?.set?.(id, value);
    } catch (error) {
      console.warn("[plexus-diagram] Could not reset setting", id, error);
    }
    emit(id, value);
  }
}
var SETTING_ROWS = {
  [SETTING_IDS.enabled]: () => switchRow(SETTING_IDS.enabled, "Enabled", "Turn the diagram overlay on or off."),
  [SETTING_IDS.fullscreenOnZoom]: () => switchRow(SETTING_IDS.fullscreenOnZoom, "Fullscreen on zoom", "Open a diagram full screen when you zoom into its block. Esc leaves it."),
  [SETTING_IDS.graphLinks]: () => selectRow(SETTING_IDS.graphLinks, "Graph links", "Show lines between cards that share a page reference or an attribute.", ["all", "attributes", "off"]),
  [SETTING_IDS.attrStyles]: () => inputRow(SETTING_IDS.attrStyles, "Attribute styles", "One JSON object. Each attribute name gets a palette color and a line: solid, dashed, or dotted."),
  [SETTING_IDS.wheel]: () => selectRow(SETTING_IDS.wheel, "Mouse wheel", "What the mouse wheel does on the board. Pinch still zooms.", ["pan", "zoom"]),
  [SETTING_IDS.showMinimap]: () => switchRow(SETTING_IDS.showMinimap, "Show minimap", "Show the small map of the whole board."),
  [SETTING_IDS.showPalette]: () => switchRow(SETTING_IDS.showPalette, "Show tool palette", "Show the tool palette along the bottom of the board."),
  [SETTING_IDS.motion]: () => selectRow(SETTING_IDS.motion, "Motion", "Full, reduced, or none. A system reduced-motion setting shortens Full.", ["full", "reduced", "none"]),
  [SETTING_IDS.controlsPosition]: () => selectRow(SETTING_IDS.controlsPosition, "Controls", "Rail is the vertical stack on the right. Bar is the horizontal zoom group.", ["rail", "bar"]),
  [SETTING_IDS.snapGuides]: () => switchRow(SETTING_IDS.snapGuides, "Snap guides", "Line a dragged card up with its neighbours and show the guides."),
  [SETTING_IDS.snapGrid]: () => switchRow(SETTING_IDS.snapGrid, "Snap to grid", "Snap a dragged card to the 24 pixel grid. Hold Alt while dragging to skip snapping."),
  [SETTING_IDS.grid]: () => selectRow(SETTING_IDS.grid, "Default board background: pattern", "Pattern for boards that do not set their own. A board can override it from Background.", ["dots", "lines", "grid", "plain"]),
  [SETTING_IDS.boardTone]: () => selectRow(SETTING_IDS.boardTone, "Default board background: tone", "Color wash for boards that do not set their own.", BOARD_TONES2),
  [SETTING_IDS.mapZoom]: () => selectRow(SETTING_IDS.mapZoom, "Map view below (zoom)", "Below this zoom, cards show only their title.", MAP_ZOOMS),
  [SETTING_IDS.autoFitSections]: () => switchRow(SETTING_IDS.autoFitSections, "Auto-fit sections", "Grow a section when a card is moved or resized past its edge."),
  [SETTING_IDS.spaceOut]: () => switchRow(SETTING_IDS.spaceOut, "Space out cards", "After a move, push cards apart when they overlap."),
  [SETTING_IDS.showCardBadges]: () => switchRow(SETTING_IDS.showCardBadges, "Show card badges", "Show how many references, tasks, and children a card has."),
  [SETTING_IDS.enterInCard]: () => selectRow(SETTING_IDS.enterInCard, "Enter in a card", "Newline adds a line to the card's block, like a native Roam diagram. Child makes a new child block inside the card.", ["newline", "child"]),
  [SETTING_IDS.defaultCardLook]: () => selectRow(SETTING_IDS.defaultCardLook, "Default card look", "New note cards. Block is a plain Roam block. Card keeps a title row.", ["block", "card"]),
  [SETTING_IDS.defaultCardWidth]: () => inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Width of a new card, in pixels."),
  [SETTING_IDS.defaultCardHeight]: () => inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Height of a new card, in pixels."),
  [SETTING_IDS.enableShortcuts]: () => switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Use keyboard shortcuts on the board."),
  [SETTING_IDS.showVersionBadge]: () => switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the version on the board."),
  [SETTING_IDS.disableOnMobile]: () => switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Do not open diagrams on a phone."),
  [SETTING_IDS.collapseOutline]: () => switchRow(SETTING_IDS.collapseOutline, "Collapse the outline", "Fold an enhanced board once, so the outline does not list every card. Opening the bullet is remembered.")
};
var SETTING_GROUPS = [
  ["group-cards", "Cards", "How new cards look, and the marks on them.", [
    SETTING_IDS.defaultCardLook,
    SETTING_IDS.defaultCardWidth,
    SETTING_IDS.defaultCardHeight,
    SETTING_IDS.enterInCard,
    SETTING_IDS.showCardBadges,
    SETTING_IDS.spaceOut
  ]],
  ["group-sections", "Sections", "How a section grows around its cards.", [
    SETTING_IDS.autoFitSections
  ]],
  ["group-connections", "Connections", "Lines drawn from page references and attributes.", [
    SETTING_IDS.graphLinks,
    SETTING_IDS.attrStyles
  ]],
  ["group-board", "Board", "The canvas, the controls, and how you move around.", [
    SETTING_IDS.enabled,
    SETTING_IDS.fullscreenOnZoom,
    SETTING_IDS.wheel,
    SETTING_IDS.showMinimap,
    SETTING_IDS.showPalette,
    SETTING_IDS.controlsPosition,
    SETTING_IDS.snapGuides,
    SETTING_IDS.snapGrid,
    SETTING_IDS.grid,
    SETTING_IDS.boardTone,
    SETTING_IDS.mapZoom,
    SETTING_IDS.enableShortcuts,
    SETTING_IDS.showVersionBadge
  ]],
  ["group-performance", "Performance", "Motion, and when the overlay stays off.", [
    SETTING_IDS.motion,
    SETTING_IDS.disableOnMobile,
    SETTING_IDS.collapseOutline
  ]]
];
function createSettingsPanel() {
  const settings = [];
  for (const [id, name, description, members] of SETTING_GROUPS) {
    settings.push(groupRow(id, name, description));
    for (const member of members) settings.push(SETTING_ROWS[member]());
  }
  settings.push({
    id: "reset-plexus-settings",
    name: "Reset",
    description: "Put every Plexus setting back to its default. Open boards update right away.",
    action: { type: "button", content: "Reset Plexus settings", onClick: () => resetPlexusSettings() }
  });
  return { tabTitle: "Plexus Diagram", settings };
}

// src/feature.js
var PACKAGE_VERSION = package_default.version;
var RECONCILE_INTERVAL_MS = 400;
var NEGATIVE_TTL_MS = 1500;
var LEGACY_METADATA_PAGE = "plexus-diagram/metadata";
var TITLE_PANEL_CLASS = "rm-diagram-title-panel";
var NEW_BOARD_STRING = "{{[[diagram]]:Untitled board}}";
var ANCESTORS_PATTERN = "[:block/uid :block/string {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}]";
var boardTitle = (s) => parseBoardTitle(s) || UNTITLED_BOARD;
var currentUid = (rec) => rec.crumbs[rec.crumbs.length - 1].uid;
function crumbCopy(list) {
  return (list || []).map((c) => ({ uid: c.uid, title: c.title }));
}
function sameTrail(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i].uid !== b[i].uid) return false;
  return true;
}
function cameraOf(rec) {
  try {
    const v = rec.view?.viewport?.();
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom > 0) {
      return { x: v.x, y: v.y, zoom: v.zoom };
    }
  } catch {
  }
  return null;
}
function shot(rec) {
  return { crumbs: crumbCopy(rec.crumbs), vp: cameraOf(rec) };
}
var PARENTS_QUERY = "[:find ?u ?s :in $ ?uid :where [?b :block/uid ?uid] [?b :block/parents ?p] [?p :block/uid ?u] [?p :block/string ?s]]";
function graphFromHash(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/([^/]+)/);
  return match ? match[1] : "unknown";
}
function pulledString(node2) {
  return String(node2?.[":block/string"] ?? node2?.string ?? "");
}
function pulledChildren(node2) {
  return node2?.[":block/children"] ?? node2?.children ?? [];
}
function hasMigratedMark(node2) {
  for (const child of pulledChildren(node2)) {
    if (/^migrated::\s*2\b/i.test(pulledString(child).trim()) || hasMigratedMark(child)) return true;
  }
  return false;
}
function uidFromLegacyString(value) {
  const token = String(value).trim().split(/\s+/)[0] || "";
  const bare = token.replace(/^(\(\(|\[\[)/, "").replace(/(\)\)|\]\])$/, "");
  return /^[\w-]{6,}$/.test(bare) ? bare : null;
}
function readLegacyEnhanced(host) {
  const out = /* @__PURE__ */ new Set();
  try {
    const pageUid = host.pageUid?.(LEGACY_METADATA_PAGE);
    if (!pageUid) return out;
    const tree = host.api.data.pull("[:block/uid :block/string {:block/children ...}]", [":block/uid", pageUid]);
    const list = pulledChildren(tree).find((child) => /^enhanced::/i.test(pulledString(child).trim()));
    for (const entry of pulledChildren(list)) {
      const uid = uidFromLegacyString(pulledString(entry));
      if (uid && !hasMigratedMark(entry)) out.add(uid);
    }
  } catch (error) {
    console.warn("[plexus-diagram] Could not read the 0.6 enhanced list", error);
  }
  return out;
}
function isMobile(extensionAPI) {
  const flag = extensionAPI?.platform?.isMobile;
  return typeof flag === "function" ? Boolean(flag.call(extensionAPI.platform)) : Boolean(flag);
}
async function installPlexusDiagram({
  extensionAPI,
  lifecycle,
  version,
  mountView,
  host: injectedHost,
  acquireSession: injectedAcquire,
  storage = globalThis.localStorage
}) {
  const doc = globalThis.document;
  const win = globalThis.window ?? globalThis;
  const badge = PACKAGE_VERSION || version || "DEV";
  if (!injectedHost) injectedHost = createHost();
  if (!injectedAcquire) injectedAcquire = acquireSession;
  if (!mountView) mountView = mountBoardView;
  const host = injectedHost;
  const acquireSession2 = injectedAcquire;
  let settings = readSettings(extensionAPI);
  const liveSettings = { get: (id) => settings[id] };
  let stopped = false;
  let closeAddToBoard = () => {
  };
  let closeCommandSheet = () => {
  };
  const mounts = /* @__PURE__ */ new Map();
  const trusted = /* @__PURE__ */ new Set();
  const portalObservers = /* @__PURE__ */ new Map();
  const negativeUntil = /* @__PURE__ */ new Map();
  const legacyUids = readLegacyEnhanced(host);
  const guardUids = /* @__PURE__ */ new Set([...readEnhancedUidCache(storage), ...legacyUids]);
  let guardStyle = null;
  const active = () => !stopped && settings[SETTING_IDS.enabled] !== false && !(settings[SETTING_IDS.disableOnMobile] && isMobile(extensionAPI));
  lifecycle.add(() => {
    for (const rec of [...mounts.values()]) unmount(rec);
    for (const observer of portalObservers.values()) observer.disconnect();
    portalObservers.clear();
    for (const el of [...doc?.querySelectorAll?.(`.${OUTLINE_NATIVE_CLASS}`) || []]) el.classList.remove(OUTLINE_NATIVE_CLASS);
    guardStyle?.remove?.();
    guardStyle = null;
  });
  function syncGuard() {
    if (!doc) return;
    if (!active()) {
      if (guardStyle) guardStyle.textContent = "";
      return;
    }
    if (!guardStyle) {
      guardStyle = doc.getElementById?.(PREPAINT_STYLE_ID) || doc.createElement("style");
      guardStyle.id = PREPAINT_STYLE_ID;
      if (!guardStyle.isConnected) doc.head.appendChild(guardStyle);
    }
    guardStyle.textContent = enhancedUidGuardCss(guardUids);
    try {
      writeEnhancedUidCache(guardUids, storage);
    } catch {
    }
  }
  function markEnhanced(uid) {
    trusted.add(uid);
    guardUids.add(uid);
    negativeUntil.delete(uid);
    syncGuard();
  }
  function markNative(uid) {
    trusted.delete(uid);
    legacyUids.delete(uid);
    guardUids.delete(uid);
    syncGuard();
  }
  function isBoardEnhanced(uid) {
    if (trusted.has(uid) || legacyUids.has(uid)) return true;
    const until = negativeUntil.get(uid);
    if (until && until > Date.now()) return false;
    if (readEnhanced(host.api, uid)) {
      trusted.add(uid);
      if (!guardUids.has(uid)) {
        guardUids.add(uid);
        syncGuard();
      }
      return true;
    }
    negativeUntil.set(uid, Date.now() + NEGATIVE_TTL_MS);
    if (guardUids.has(uid)) {
      guardUids.delete(uid);
      syncGuard();
    }
    return false;
  }
  function titlePanelOf(native) {
    for (const sibling of native.parentElement?.children || []) {
      if (sibling !== native && sibling.classList?.contains(TITLE_PANEL_CLASS)) return sibling;
    }
    return null;
  }
  function setFullscreen(rec, next) {
    rec.fullscreen = Boolean(next);
    try {
      rec.view?.setFullscreen?.(rec.fullscreen);
    } catch (error) {
      console.warn("[plexus-diagram] setFullscreen failed", error);
    }
  }
  function seedCrumbs(uid) {
    const self = { uid, title: boardTitle(host.blockString?.(uid)) };
    try {
      const res = host.api.data.pull(ANCESTORS_PATTERN, [":block/uid", uid]);
      const parents = res?.[":block/parents"] ?? [];
      const chain = parents.filter((p) => isDiagramString(pulledString(p)) && readPlexus(p[":block/props"] ?? p.props)?.v === 2).map((p) => ({ uid: p[":block/uid"], title: boardTitle(p[":block/string"]), depth: (p[":block/parents"] ?? []).length })).sort((a, b) => a.depth - b.depth).map(({ uid: u, title }) => ({ uid: u, title }));
      return [...chain, self];
    } catch {
      return [self];
    }
  }
  const isDiagramUid = (candidate) => isDiagramString(host.blockString?.(candidate));
  function unmountOutlineCopies(parent) {
    for (const other of [...mounts.values()]) {
      if (other !== parent && insideEnhancedOutline(other.native)) unmount(other);
    }
  }
  function collapseOnce(uid, native) {
    if (settings[SETTING_IDS.collapseOutline] === false || !storage?.getItem || !storage?.setItem) return;
    if (native?.closest?.(".bp3-portal")) return;
    const key = `plexus-diagram:collapsed:${graphFromHash()}:${uid}`;
    let state;
    try {
      if (storage.getItem(key)) return;
      state = host.api.data.pull("[:block/open]", [":block/uid", uid]);
      if (!state) return;
      storage.setItem(key, "1");
    } catch {
      return;
    }
    if (state[":block/open"] === false) return;
    Promise.resolve().then(() => host.setOpen(uid, false)).catch((error) => console.warn("[plexus-diagram] Could not collapse the board block", uid, error));
  }
  function mountRecView(rec, { autofocus = false, viewport = null } = {}) {
    return mountView({
      host,
      session: rec.session,
      mountEl: rec.mountEl,
      nativeEl: rec.native,
      settings,
      fullscreen: rec.fullscreen,
      version: badge,
      onRequestFullscreen: (want) => setFullscreen(rec, want === void 0 ? !rec.fullscreen : want),
      crumbs: rec.crumbs.slice(),
      routeUid: rec.uid,
      autofocus,
      initialViewport: viewport,
      onOpenBoard: (child) => visit(rec, [...rec.crumbs, { uid: child, title: boardTitle(host.blockString?.(child)) }]),
      onCrumb: (index) => visit(rec, rec.crumbs.slice(0, index + 1)),
      onHistoryBack: () => historyMove(rec, "back"),
      onHistoryForward: () => historyMove(rec, "forward"),
      onSetDefaults: (patch) => setDefaults(patch)
    });
  }
  async function setDefaults(patch) {
    if (stopped || !patch || typeof patch !== "object") return;
    for (const [id, value] of Object.entries(patch)) {
      try {
        await extensionAPI.settings?.set?.(id, value);
      } catch (error) {
        console.warn("[plexus-diagram] Could not save setting", id, error);
      }
      if (stopped) return;
      settings = { ...settings, [id]: normalizeSetting(id, value) };
    }
    for (const rec of [...mounts.values()]) {
      try {
        if (typeof rec.view?.setSettings === "function") rec.view.setSettings(settings);
      } catch (error) {
        console.warn("[plexus-diagram] Settings propagation failed", error);
      }
    }
  }
  function watchRec(rec) {
    const session = rec.session;
    const offGone = session.on?.("gone", () => {
      if (currentUid(rec) !== rec.uid) popSilent(rec);
      else unmount(rec);
    });
    const offChange = session.on?.("change", () => {
      if (!session.board || session.board.enhanced !== false) return;
      if (currentUid(rec) !== rec.uid) {
        popSilent(rec);
      } else if (!legacyUids.has(rec.uid)) {
        markNative(rec.uid);
        unmount(rec);
      }
    });
    return () => {
      offGone?.();
      offChange?.();
    };
  }
  function forgetUid(rec, uid) {
    const keep = (entry) => entry.crumbs[entry.crumbs.length - 1]?.uid !== uid;
    rec.back = (rec.back || []).filter(keep);
    rec.forward = (rec.forward || []).filter(keep);
  }
  function popSilent(rec) {
    const gone = currentUid(rec);
    if (gone === rec.uid) return;
    forgetUid(rec, gone);
    navigate(rec, rec.crumbs.slice(0, -1), null);
  }
  function visit(rec, next) {
    if (stopped || mounts.get(rec.native) !== rec || !next?.length) return;
    if (next[next.length - 1].uid === currentUid(rec)) return;
    const backTop = rec.back?.[rec.back.length - 1];
    const fore = rec.forward?.[rec.forward.length - 1];
    let mode = "push";
    let destVp = null;
    if (backTop && sameTrail(backTop.crumbs, next)) {
      mode = "back";
      destVp = backTop.vp;
    } else if (fore && sameTrail(fore.crumbs, next)) {
      mode = "forward";
      destVp = fore.vp;
    }
    const leaving = shot(rec);
    navigate(rec, next, destVp, () => {
      if (mode === "back") {
        rec.forward.push(leaving);
        rec.back.pop();
      } else if (mode === "forward") {
        rec.back.push(leaving);
        rec.forward.pop();
      } else {
        rec.back.push(leaving);
        rec.forward = [];
      }
    });
  }
  function historyMove(rec, dir) {
    if (stopped || mounts.get(rec.native) !== rec) return false;
    const from = dir === "back" ? rec.back : rec.forward;
    if (!from?.length) return false;
    const dest = from[from.length - 1];
    const leaving = shot(rec);
    navigate(rec, dest.crumbs, dest.vp, () => {
      from.pop();
      (dir === "back" ? rec.forward : rec.back).push(leaving);
    });
    return true;
  }
  function navigate(rec, next, viewport, commit) {
    queueMicrotask(() => {
      if (stopped || mounts.get(rec.native) !== rec || !next.length) return;
      const target = next[next.length - 1].uid;
      if (target === currentUid(rec)) return;
      if (!readEnhanced(host.api, target)) {
        try {
          Promise.resolve(host.openBlock?.(target)).catch(() => {
          });
        } catch {
        }
        return;
      }
      let session;
      try {
        session = acquireSession2(target, { host, settings: liveSettings });
      } catch (error) {
        console.warn("[plexus-diagram] Could not open the nested board", error);
        return;
      }
      if (!session?.board) {
        session?.release?.();
        return;
      }
      try {
        commit?.();
      } catch {
      }
      try {
        rec.off?.();
      } catch {
      }
      rec.off = null;
      try {
        rec.view?.dispose?.();
      } catch (error) {
        console.warn("[plexus-diagram] view dispose failed", error);
      }
      try {
        rec.session?.release?.();
      } catch (error) {
        console.warn("[plexus-diagram] session release failed", error);
      }
      rec.session = session;
      rec.crumbs = next;
      try {
        rec.view = mountRecView(rec, { autofocus: true, viewport: viewport || null });
        rec.off = watchRec(rec);
      } catch (error) {
        console.error("[plexus-diagram] Nested mount failed; native diagram restored", error);
        negativeUntil.set(rec.uid, Date.now() + 10 * NEGATIVE_TTL_MS);
        unmount(rec);
      }
    });
  }
  function mount(uid, native, { crumbs } = {}) {
    const mountEl = doc.createElement("div");
    mountEl.className = "pxd-mount";
    mountEl.dataset.diagramUid = uid;
    const titlePanel = titlePanelOf(native);
    native.classList.remove(OUTLINE_NATIVE_CLASS);
    titlePanel?.classList.remove(OUTLINE_NATIVE_CLASS);
    const rec = {
      uid,
      native,
      mountEl,
      titlePanel,
      titleDisplay: titlePanel ? titlePanel.style.display : "",
      session: null,
      view: null,
      crumbs: crumbs ?? seedCrumbs(uid),
      back: [],
      forward: [],
      fullscreen: false,
      off: null
    };
    native.classList.add(NATIVE_HIDDEN_CLASS);
    if (titlePanel) titlePanel.style.display = "none";
    native.after(mountEl);
    mounts.set(native, rec);
    if (inRightSidebar(native) && typeof IntersectionObserver === "function") {
      const h = native.getBoundingClientRect?.().height || 0;
      rec.mountEl.style.minHeight = `${Math.max(160, Math.round(h))}px`;
      rec.dormant = true;
      ensureViewportWatch();
      recByMount.set(mountEl, rec);
      viewportWatch?.observe(mountEl);
      return rec;
    }
    try {
      rec.session = acquireSession2(currentUid(rec), { host, settings: liveSettings });
      rec.fullscreen = settings[SETTING_IDS.fullscreenOnZoom] !== false && !routeLeftZoomedDiagram(uid);
      rec.view = mountRecView(rec);
      rec.off = watchRec(rec);
    } catch (error) {
      console.error("[plexus-diagram] Mount failed; native diagram restored", error);
      negativeUntil.set(uid, Date.now() + 10 * NEGATIVE_TTL_MS);
      unmount(rec);
      return null;
    }
    unmountOutlineCopies(rec);
    if (!embedOwnerUid(native, (id) => host.blockString?.(id))) collapseOnce(uid, native);
    if (currentUid(rec) === uid) migrateLegacy(rec);
    ensureViewportWatch();
    recByMount.set(mountEl, rec);
    viewportWatch?.observe(mountEl);
    return rec;
  }
  function migrateLegacy(rec) {
    const { uid, session } = rec;
    if (!legacyUids.has(uid) || readEnhanced(host.api, uid)) return;
    const key = `plexus-diagram:migrated:${graphFromHash()}:${uid}`;
    try {
      if (storage?.getItem?.(key)) return;
      storage?.setItem?.(key, "1");
    } catch {
    }
    if (rec.migrating) return;
    rec.migrating = true;
    Promise.resolve().then(() => session.enhance()).then(() => markEnhanced(uid)).catch((error) => console.warn("[plexus-diagram] 0.6 import failed", uid, error));
  }
  function inRightSidebar(node2) {
    for (let cur = node2; cur; cur = cur.parentElement) {
      if (cur.id === "right-sidebar") return true;
      if (cur.classList?.contains?.("rm-sidebar-window") || cur.classList?.contains?.("rm-right-sidebar")) return true;
    }
    return false;
  }
  const recByMount = /* @__PURE__ */ new WeakMap();
  let viewportWatch = null;
  let sidebarWatch = null;
  function ensureViewportWatch() {
    if (viewportWatch || typeof IntersectionObserver !== "function") return;
    viewportWatch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const rec = recByMount.get(entry.target);
        if (!rec || !mounts.has(rec.native)) continue;
        if (entry.isIntersecting) wake(rec);
        else hibernate(rec);
      }
    }, { rootMargin: "60px" });
  }
  function hibernate(rec, { force = false } = {}) {
    if (!rec || rec.dormant || rec.fullscreen || !rec.view) return;
    if (doc.activeElement && rec.mountEl.contains?.(doc.activeElement)) return;
    const height = rec.mountEl.getBoundingClientRect?.().height || 0;
    if (height < 40 && !force) return;
    rec.mountEl.style.minHeight = `${Math.max(40, Math.round(height))}px`;
    try {
      rec.off?.();
    } catch {
    }
    rec.off = null;
    try {
      rec.view.dispose();
    } catch (error) {
      console.warn("[plexus-diagram] hibernate failed", error);
    }
    try {
      rec.session?.release?.();
    } catch (error) {
      console.warn("[plexus-diagram] session release failed", error);
    }
    rec.view = null;
    rec.session = null;
    rec.dormant = true;
  }
  function wake(rec) {
    if (!rec || !rec.dormant || stopped || rec.mountEl.isConnected === false) return;
    rec.dormant = false;
    rec.mountEl.style.minHeight = "";
    try {
      rec.session = acquireSession2(currentUid(rec), { host, settings: liveSettings });
      if (!rec.session?.board) {
        rec.session?.release?.();
        unmount(rec);
        return;
      }
      rec.view = mountRecView(rec);
      rec.off = watchRec(rec);
      if (!embedOwnerUid(rec.native, (id) => host.blockString?.(id))) collapseOnce(currentUid(rec), rec.native);
      if (currentUid(rec) === rec.uid) migrateLegacy(rec);
    } catch (error) {
      console.error("[plexus-diagram] Wake failed; native diagram restored", error);
      unmount(rec);
    }
  }
  function unmount(rec) {
    if (!rec || !mounts.has(rec.native)) return;
    viewportWatch?.unobserve(rec.mountEl);
    recByMount.delete(rec.mountEl);
    mounts.delete(rec.native);
    try {
      rec.off?.();
    } catch {
    }
    try {
      rec.view?.dispose?.();
    } catch (error) {
      console.warn("[plexus-diagram] view dispose failed", error);
    }
    try {
      rec.session?.release?.();
    } catch (error) {
      console.warn("[plexus-diagram] session release failed", error);
    }
    rec.mountEl.remove();
    rec.native.classList.remove(NATIVE_HIDDEN_CLASS);
    if (rec.titlePanel) rec.titlePanel.style.display = rec.titleDisplay;
  }
  const uidByNative = /* @__PURE__ */ new WeakMap();
  const outlineOwnerByNative = /* @__PURE__ */ new WeakMap();
  function insideEnhancedOutline(native) {
    const cached = outlineOwnerByNative.get(native);
    if (cached) {
      if (isBoardEnhanced(cached)) return true;
      outlineOwnerByNative.delete(native);
    }
    const own = native.closest?.(BLOCK_CONTAINER_SELECTOR);
    let container = own ? own.parentElement?.closest?.(BLOCK_CONTAINER_SELECTOR) : null;
    while (container) {
      const uid = blockContainerUid(container, isDiagramUid);
      if (uid && isBoardEnhanced(uid)) {
        outlineOwnerByNative.set(native, uid);
        return true;
      }
      container = container.parentElement?.closest?.(BLOCK_CONTAINER_SELECTOR);
    }
    return false;
  }
  function consider(native, options) {
    if (stopped || !native || mounts.has(native) || native.isConnected === false) return;
    if (!active()) return;
    if (native.parentElement?.closest?.(".pxd-native-hidden, .pxd-root")) return;
    const readString = (id) => host.blockString?.(id);
    let uid = uidByNative.get(native);
    if (uid === void 0) {
      uid = findDiagramUidFromEl(native, isDiagramUid) || null;
      if (!uid || !isBoardEnhanced(uid)) {
        const fromEmbed = embedBoardUid(native, readString);
        if (fromEmbed && isBoardEnhanced(fromEmbed)) uid = fromEmbed;
      }
      uidByNative.set(native, uid);
    }
    if (!uid || !isBoardEnhanced(uid)) return;
    if (insideEnhancedOutline(native)) {
      native.classList.add(OUTLINE_NATIVE_CLASS);
      titlePanelOf(native)?.classList.add(OUTLINE_NATIVE_CLASS);
      return;
    }
    const scope = embedScope(native, readString);
    if (scope) {
      for (const rec of mounts.values()) {
        if (embedScope(rec.native, readString) === scope) {
          native.classList.add(NATIVE_HIDDEN_CLASS);
          return;
        }
      }
    }
    mount(uid, native, options);
  }
  function scanAdded(node2) {
    for (const diagram of diagramsWithin(node2)) consider(diagram);
  }
  function reconcile() {
    if (stopped) return;
    ensureSidebarWatch();
    for (const rec of [...mounts.values()]) {
      if (rec.native.isConnected === false || rec.mountEl.isConnected === false) unmount(rec);
    }
    for (const [node2, observer] of portalObservers) {
      if (node2.isConnected === false) {
        observer.disconnect();
        portalObservers.delete(node2);
      }
    }
    if (!active()) {
      for (const rec of [...mounts.values()]) unmount(rec);
      return;
    }
    if (!doc) return;
    for (const diagram of doc.querySelectorAll(".rm-diagram")) consider(diagram);
  }
  function onNavigate() {
    for (const rec of mounts.values()) {
      if (routeLeftZoomedDiagram(rec.uid)) {
        if (rec.fullscreen) setFullscreen(rec, false);
      } else if (settings[SETTING_IDS.fullscreenOnZoom] !== false && !rec.fullscreen) {
        setFullscreen(rec, true);
      }
    }
    reconcile();
  }
  function focusedUid(context) {
    return context?.["block-uid"] || host.api?.ui?.getFocusedBlock?.()?.["block-uid"] || extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"] || null;
  }
  function diagramAncestorUid(uid) {
    if (!uid) return null;
    if (isDiagramString(host.blockString?.(uid))) return uid;
    try {
      const rows = host.q?.(PARENTS_QUERY, uid) || [];
      const hits = rows.filter((row2) => isDiagramString(row2[1])).map((row2) => row2[0]);
      if (hits.length < 2) return hits[0] ?? null;
      const deepest = hits.find((cand) => {
        const above = new Set((host.q?.(PARENTS_QUERY, cand) || []).map((row2) => row2[0]));
        return hits.every((other) => other === cand || above.has(other));
      });
      return deepest ?? hits[0];
    } catch {
      return null;
    }
  }
  function resolveBoardUid(context) {
    const fromFocus = diagramAncestorUid(focusedUid(context));
    if (fromFocus) return fromFocus;
    const zoomed = diagramUidFromLocation();
    if (zoomed && isDiagramString(host.blockString?.(zoomed))) return zoomed;
    const uids = new Set([...mounts.values()].map((rec) => rec.uid));
    return uids.size === 1 ? [...uids][0] : null;
  }
  async function enhanceCommand(context) {
    const uid = resolveBoardUid(context);
    if (!uid) {
      console.info("[plexus-diagram] Focus a {{[[diagram]]}} block first");
      return;
    }
    const session = acquireSession2(uid, { host, settings: liveSettings });
    try {
      await session.enhance();
    } finally {
      session.release();
    }
    markEnhanced(uid);
    reconcile();
  }
  async function restoreCommand(context) {
    const uid = resolveBoardUid(context);
    if (!uid) return;
    const session = acquireSession2(uid, { host, settings: liveSettings });
    try {
      await session.restoreNative();
    } finally {
      session.release();
    }
    markNative(uid);
    for (const rec of [...mounts.values()]) if (rec.uid === uid) unmount(rec);
  }
  async function newWhiteboardCommand(context) {
    const parentUid = focusedUid(context);
    if (!parentUid) {
      console.info("[plexus-diagram] Focus a block first; the whiteboard is created under it");
      return;
    }
    const uid = host.generateUid();
    await host.createBlock({
      parentUid,
      order: "last",
      uid,
      string: NEW_BOARD_STRING,
      props: { plexus: { v: 2 } },
      open: settings[SETTING_IDS.collapseOutline] === false ? void 0 : false
    });
    markEnhanced(uid);
    await host.openBlock(uid);
  }
  function fullscreenCommand(context) {
    const uid = resolveBoardUid(context);
    const recs = [...mounts.values()].filter((rec2) => !uid || rec2.uid === uid);
    const rec = recs.find((r) => r.native.isConnected !== false) || recs[0];
    if (rec) setFullscreen(rec, !rec.fullscreen);
  }
  function targetView(context) {
    const uid = resolveBoardUid(context);
    const recs = [...mounts.values()].filter((rec2) => !uid || rec2.uid === uid);
    const rec = recs.find((r) => r.native.isConnected !== false) || recs[0];
    return rec?.view ?? null;
  }
  function exportSvgCommand(context) {
    return targetView(context)?.exportSvg?.({ download: true });
  }
  function copyOutlineCommand(context) {
    return targetView(context)?.copyOutline?.();
  }
  function addPageCommand(context) {
    return targetView(context)?.addPage?.();
  }
  const sheetActions = [
    ["Plexus: Enhance this diagram", enhanceCommand],
    ["Plexus: New whiteboard here", newWhiteboardCommand],
    ["Plexus: Restore native diagram", restoreCommand],
    ["Plexus: Fullscreen this diagram", fullscreenCommand],
    ["Plexus: Export board as SVG", exportSvgCommand],
    ["Plexus: Copy board as text", copyOutlineCommand]
  ];
  const sheetOnlyActions = [
    ["Plexus: Add page…", addPageCommand]
  ];
  function runCommand(label, fn) {
    return (context) => {
      if (!active()) {
        console.info("[plexus-diagram] Command skipped: extension disabled");
        return;
      }
      Promise.resolve(fn(context)).catch((error) => console.warn(`[plexus-diagram] ${label} failed`, error));
    };
  }
  function openCommandSheet(capturedUid) {
    closeCommandSheet();
    const sheet = doc.createElement("div");
    sheet.className = "pxd-commands";
    const back = doc.createElement("button");
    back.type = "button";
    back.className = "pxd-commands-back";
    back.setAttribute("aria-label", "Close commands");
    const box2 = doc.createElement("div");
    box2.className = "pxd-commands__box";
    box2.setAttribute("role", "menu");
    const title = doc.createElement("div");
    title.className = "pxd-commands__title";
    title.textContent = "Plexus";
    box2.append(title);
    for (const [label, fn] of [...sheetActions, ...sheetOnlyActions]) {
      const row2 = doc.createElement("button");
      row2.type = "button";
      row2.className = "pxd-commands__row";
      row2.textContent = label.replace(/^Plexus: /, "");
      row2.setAttribute("aria-label", row2.textContent);
      row2.onclick = () => {
        closeCommandSheet();
        if (!active()) return;
        const context = capturedUid ? { "block-uid": capturedUid } : {};
        Promise.resolve(fn(context)).catch((error) => console.warn(`[plexus-diagram] ${label} failed`, error));
      };
      box2.append(row2);
    }
    sheet.append(back);
    sheet.append(box2);
    lifecycle.node(sheet, doc.body);
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault?.();
      closeCommandSheet();
    };
    if (typeof doc.addEventListener === "function") doc.addEventListener("keydown", onKey);
    back.onclick = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      closeCommandSheet();
    };
    let closed = false;
    closeCommandSheet = () => {
      if (closed) return;
      closed = true;
      if (typeof doc.removeEventListener === "function") doc.removeEventListener("keydown", onKey);
      sheet.remove();
      closeCommandSheet = () => {
      };
    };
  }
  async function registerCommands() {
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: Commands…",
      callback: (context) => {
        if (!active()) {
          console.info("[plexus-diagram] Command skipped: extension disabled");
          return;
        }
        openCommandSheet(focusedUid(context));
      }
    });
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: New whiteboard here",
      callback: runCommand("Plexus: New whiteboard here", newWhiteboardCommand)
    });
    if (extensionAPI.ui?.slashCommand?.addCommand) {
      for (const [label, fn] of sheetActions) {
        await lifecycle.command(extensionAPI.ui.slashCommand, { label, callback: runCommand(label, fn) });
      }
    }
    if (extensionAPI.ui?.blockContextMenu?.addCommand) {
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Plexus: Enhance",
        "display-conditional": (event) => isDiagramString(event?.["block-string"]),
        callback: (event) => {
          if (!active()) return;
          enhanceCommand(event).catch((error) => console.warn("[plexus-diagram] Enhance failed", error));
        }
      });
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Show on board",
        "display-conditional": (event) => {
          if (!active()) return false;
          const uid = event?.["block-uid"];
          if (!uid || typeof host.showOnBoard !== "function") return false;
          try {
            const hit = host.showOnBoard(uid);
            return Boolean(hit?.boardUid && hit?.cardUid && hit?.pageUid);
          } catch {
            return false;
          }
        },
        callback: (event) => {
          if (!active()) return;
          const uid = event?.["block-uid"];
          let hit = null;
          try {
            hit = uid ? host.showOnBoard?.(uid) : null;
          } catch {
            hit = null;
          }
          if (!hit?.pageUid || !hit?.cardUid) return;
          assignDeepLink(globalThis.location, {
            graph: host.graph || graphFromHash(),
            pageUid: hit.pageUid,
            cardUid: hit.cardUid
          }, () => {
            try {
              win.dispatchEvent?.(new Event("hashchange"));
            } catch {
            }
          });
        }
      });
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Add to board…",
        "display-conditional": (event) => active() && Boolean(event?.["block-uid"]),
        callback: (event) => {
          if (!active()) return;
          const blockUid2 = event?.["block-uid"];
          if (!blockUid2) return;
          closeAddToBoard();
          const picker = openAddToBoard({
            doc,
            blockUid: blockUid2,
            listBoards: () => host.listBoards?.() ?? [],
            onPick: async (board2) => {
              if (!board2?.uid || board2.uid === blockUid2) return false;
              let session = null;
              try {
                session = acquireSession2(board2.uid, { host, settings: liveSettings });
                const id = await session?.addBlockRef?.(blockUid2);
                return Boolean(id);
              } catch (error) {
                console.warn("[plexus-diagram] Add to board failed", error);
                return false;
              } finally {
                session?.release?.();
              }
            }
          });
          closeAddToBoard = () => {
            picker.close();
            closeAddToBoard = () => {
            };
          };
        }
      });
      lifecycle.add(() => closeAddToBoard());
    }
    lifecycle.add(() => closeCommandSheet());
  }
  lifecycle.add(onSettingsChange((id, value) => {
    if (stopped) return;
    settings = { ...settings, [id]: normalizeSetting(id, value) };
    syncGuard();
    if (!active()) {
      for (const rec of [...mounts.values()]) unmount(rec);
      return;
    }
    for (const rec of [...mounts.values()]) {
      try {
        if (typeof rec.view?.setSettings === "function") {
          rec.view.setSettings(settings);
        } else if (!rec.dormant) {
          const { native, crumbs } = rec;
          unmount(rec);
          consider(native, { crumbs });
        }
      } catch (error) {
        console.warn("[plexus-diagram] Settings propagation failed", error);
      }
    }
    reconcile();
  }));
  const api = {
    version: badge,
    stats: host.stats,
    mounts: () => [...mounts.values()].map((rec) => ({
      uid: rec.uid,
      current: currentUid(rec),
      crumbs: rec.crumbs.map((c) => c.uid),
      fullscreen: rec.fullscreen,
      connected: rec.native.isConnected !== false && rec.mountEl.isConnected !== false,
      state: rec.view?.state?.() ?? null
    })),
    // Caller must release(). A second acquire of the same board shares the session.
    session(uid) {
      if (!uid) return null;
      return acquireSession2(uid, { host, settings: liveSettings });
    }
  };
  win.__plexusDiagram = api;
  lifecycle.add(() => {
    if (win.__plexusDiagram === api) delete win.__plexusDiagram;
  });
  syncGuard();
  await registerCommands();
  if (doc && typeof globalThis.MutationObserver === "function") {
    const onAdded = (records) => {
      for (const record of records) {
        for (const node2 of record.addedNodes || []) {
          if (node2.nodeType === 1) scanAdded(node2);
        }
      }
    };
    const app = doc.querySelector(".roam-app");
    if (app) lifecycle.observer(new MutationObserver(onAdded), app, { childList: true, subtree: true });
    if (doc.body) {
      lifecycle.observer(new MutationObserver((records) => {
        for (const record of records) {
          for (const node2 of record.addedNodes || []) {
            if (node2.nodeType !== 1 || !node2.classList?.contains("bp3-portal") || portalObservers.has(node2)) continue;
            const observer = new MutationObserver(onAdded);
            observer.observe(node2, { childList: true, subtree: true });
            portalObservers.set(node2, observer);
            scanAdded(node2);
          }
        }
      }), doc.body, { childList: true });
    }
  }
  let wakeTimer = null;
  let parkKey = null;
  const stopParkKeys = () => {
    if (!parkKey) return;
    doc.removeEventListener("keydown", parkKey, true);
    parkKey = null;
  };
  const wakeVisible = () => {
    wakeTimer = null;
    stopParkKeys();
    const height = win.innerHeight || 0;
    for (const rec of mounts.values()) {
      if (!rec.dormant) continue;
      const box2 = rec.mountEl.getBoundingClientRect?.();
      if (!box2) continue;
      if (box2.bottom > -60 && box2.top < height + 60) wake(rec);
    }
  };
  const armWake = () => {
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(wakeVisible, 700);
  };
  const watchParkKeys = () => {
    if (parkKey) return;
    parkKey = (event) => {
      if (!isTextEntryTarget(event.target)) return;
      parkOutside(event.target);
      armWake();
    };
    doc.addEventListener("keydown", parkKey, true);
  };
  const parkOutside = (target) => {
    if (!isTextEntryTarget(target)) return;
    let parked = false;
    for (const rec of mounts.values()) {
      if (rec.mountEl.contains?.(target) || rec.view?.root?.contains?.(target)) continue;
      if (rec.dormant || rec.fullscreen) continue;
      hibernate(rec);
      parked = rec.dormant || parked;
    }
    if (parked) watchParkKeys();
  };
  if (doc && typeof doc.addEventListener === "function") {
    lifecycle.event(doc, "focusin", (event) => {
      parkOutside(event.target);
      armWake();
    });
    lifecycle.event(doc, "input", (event) => {
      if (!isTextEntryTarget(event.target)) return;
      parkOutside(event.target);
      armWake();
    }, true);
  }
  const parkMainForSidebar = () => {
    for (const rec of mounts.values()) {
      if (inRightSidebar(rec.native) || inRightSidebar(rec.mountEl)) continue;
      hibernate(rec, { force: true });
    }
    armWake();
  };
  function ensureSidebarWatch() {
    if (sidebarWatch || typeof MutationObserver !== "function") return;
    const article = doc.querySelector?.(".rm-article-wrapper");
    if (!article) return;
    let open = article.classList?.contains?.("rm-spacing--right-sidebar-open");
    sidebarWatch = new MutationObserver(() => {
      const next = article.classList?.contains?.("rm-spacing--right-sidebar-open");
      if (next && !open) parkMainForSidebar();
      open = next;
    });
    sidebarWatch.observe(article, { attributes: true, attributeFilter: ["class"] });
  }
  ensureSidebarWatch();
  lifecycle.add(() => {
    sidebarWatch?.disconnect();
    sidebarWatch = null;
  });
  lifecycle.add(() => {
    if (wakeTimer) clearTimeout(wakeTimer);
    stopParkKeys();
  });
  if (typeof win.addEventListener === "function") {
    lifecycle.event(win, "hashchange", onNavigate);
    lifecycle.event(win, "popstate", onNavigate);
  }
  lifecycle.interval(reconcile, RECONCILE_INTERVAL_MS);
  lifecycle.add(() => {
    stopped = true;
    viewportWatch?.disconnect();
  });
  reconcile();
}

// src/extension.js
var activeLifecycle = null;
async function onload({ extensionAPI, extension, deps }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();
  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    await initializeSettings(extensionAPI);
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    await installPlexusDiagram({ extensionAPI, lifecycle, version: extension?.version, ...deps });
    console.info(`[plexus-diagram] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}
async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus-diagram] Unloaded");
}
var extension_default = { onload, onunload };
export {
  extension_default as default,
  enhancedUidGuardCss,
  isDiagramString,
  onload,
  onunload,
  settingsDefaults
};
