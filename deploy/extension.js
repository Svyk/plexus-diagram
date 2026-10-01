/* Plexus Diagram v1.3.0 | MIT | generated; edit src/ */

// src/model/geometry.js
var num = (n) => {
  const r = Math.round(n * 1e3) / 1e3;
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
function inflate(r, n) {
  return { x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n };
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
var NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
function edgePath({ a, b, fromSide = "auto", toSide = "auto", route = "curve", offset = 0 }) {
  if (fromSide === "auto" || toSide === "auto") {
    const auto = autoSides(a, b);
    if (fromSide === "auto") fromSide = auto.fromSide;
    if (toSide === "auto") toSide = auto.toSide;
  }
  const start = sidePoint(a, fromSide);
  const end = sidePoint(b, toSide);
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
function gridBackground(vp, style, base = 24) {
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
var MIN_SIZES = { card: { w: 200, h: 80 }, section: { w: 160, h: 100 }, text: { w: 60, h: 24 } };
var DEFAULT_BOARD_CARD = { w: 320, h: 220 };
var UNTITLED_BOARD = "Untitled board";
var FONT_SIZES = [16, 24, 32, 48];
var CARD_LOOKS = ["block", "card"];
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
var ROUTES = ["curve", "straight", "elbow"];
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
var ITEM_STYLE_KEYS = ["fontSize", "textColor", "align", "fill", "border"];
var SECTION_STYLE_KEYS = ["titleSize", "titleColor", "titleFill", "areaFill", "border"];
var ARROW_TOKENS = Object.values(ARROWS);
var HEX_RE = /^#[0-9a-f]{6}$/;
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
  const section = type === "section";
  return {
    type,
    x: num3(p.x),
    y: num3(p.y),
    w: num3(p.w),
    h: num3(p.h),
    color: styleColor(p.color),
    collapsed: p.collapsed === true ? true : p.collapsed === false ? false : void 0,
    // Sections use titleSize. Cards and text take an integer 10–48 (text used to be the four steps only).
    fontSize: section ? void 0 : intIn(p.fontSize, CARD_FONT_MIN, CARD_FONT_MAX),
    pinned: p.pinned === true,
    fit: p.fit === false ? false : void 0,
    look: CARD_LOOKS.includes(p.look) ? p.look : void 0,
    textColor: section ? void 0 : styleColor(p.textColor),
    align: section || !ALIGNS.includes(p.align) ? void 0 : p.align,
    fill: section ? void 0 : styleColor(p.fill),
    border: styleColor(p.border),
    titleSize: section ? intIn(p.titleSize, SECTION_TITLE_MIN, SECTION_TITLE_MAX) : void 0,
    titleColor: section ? styleColor(p.titleColor) : void 0,
    titleFill: section ? styleColor(p.titleFill) : void 0,
    areaFill: section ? styleColor(p.areaFill) : void 0
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
var round1 = (n) => Math.round(n * 10) / 10;
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
  if (l.type === "section" && l.fit === false) out.fit = false;
  if (CARD_LOOKS.includes(l.look)) out.look = l.look;
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
  return Object.keys(base).length ? base : null;
}
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dailyPageTitle(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDate();
  const suffix = day >= 11 && day <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${MONTHS[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
}
function normalizeEdge(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const pick = (v, list, def) => list.includes(v) ? v : def;
  return {
    from: typeof p.from === "string" ? p.from : "",
    to: typeof p.to === "string" ? p.to : "",
    fromSide: pick(p.fromSide, SIDES2, EDGE_DEFAULTS.fromSide),
    toSide: pick(p.toSide, SIDES2, EDGE_DEFAULTS.toSide),
    dir: pick(p.dir, DIRS, EDGE_DEFAULTS.dir),
    route: pick(p.route, ROUTES, EDGE_DEFAULTS.route),
    dash: pick(p.dash, DASHES, EDGE_DEFAULTS.dash),
    weight: EDGE_WEIGHTS.includes(p.weight) ? p.weight : EDGE_DEFAULTS.weight,
    color: styleColor(p.color)
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
function edgeString({ srcRef, dstRef, dir = "one", label = "" }) {
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

// src/model/board.js
var AUTO_GAP = 40;
var AUTO_OFFSET = 48;
var AUTO_ROWS = 4;
var TITLE_BAND = 32;
var BORDER_BAND = 8;
var isNum2 = (v) => typeof v === "number" && Number.isFinite(v);
function sortedChildren(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
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
    const row = i % AUTO_ROWS;
    if (i > 0 && row === 0) {
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
  boardKids.forEach((child, index) => {
    if (containerUid === null && readPlexus(child[":block/props"])?.type === "edges") {
      containerUid = child[":block/uid"];
      containerIndex = index;
    }
  });
  const sectionDefaults = normalizeSectionDefaults(plexus?.defaults?.section);
  const walk = (children, parentUid, depth) => {
    const siblings = [];
    for (const child of children) {
      const cuid = child[":block/uid"];
      if (cuid === containerUid) continue;
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
        look: type === "card" ? cardLook(kind, layout.look) : void 0,
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
      const n = normalizeEdge(eplexus);
      const a = items.get(n.from);
      const b = items.get(n.to);
      edges.set(euid, {
        uid: euid,
        string: estring,
        ...n,
        label: parseEdgeLabel(estring, a ? semanticRef(a) : "", b ? semanticRef(b) : ""),
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
    childCount: boardKids.length,
    edges
  };
}
function worldRects(board) {
  const rects = /* @__PURE__ */ new Map();
  for (const item of board.items.values()) {
    const p = item.parentUid === board.uid ? null : rects.get(item.parentUid);
    rects.set(item.uid, { x: item.x + (p?.x ?? 0), y: item.y + (p?.y ?? 0), w: item.w, h: item.h });
  }
  return rects;
}
function worldRect(board, uid, rects) {
  if (rects) return rects.get(uid) ?? null;
  const item = board.items.get(uid);
  if (!item) return null;
  let x = item.x;
  let y = item.y;
  let parent = board.items.get(item.parentUid);
  while (parent) {
    x += parent.x;
    y += parent.y;
    parent = board.items.get(parent.parentUid);
  }
  return { x, y, w: item.w, h: item.h };
}
function descendantsOf(board, uid) {
  const out = /* @__PURE__ */ new Set();
  const stack = [...board.items.get(uid)?.members ?? []];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...board.items.get(u)?.members ?? []);
  }
  return out;
}
function hasAncestorIn(board, uid, set) {
  let p = board.items.get(uid)?.parentUid;
  while (p && p !== board.uid) {
    if (set.has(p)) return true;
    p = board.items.get(p)?.parentUid;
  }
  return false;
}
function topLevelOf(board, uids) {
  const list = [...uids].filter((u) => board.items.has(u));
  const set = new Set(list);
  return list.filter((u) => !hasAncestorIn(board, u, set));
}
function containerAt(board, point, { exclude = /* @__PURE__ */ new Set(), rects } = {}) {
  const r = rects ?? worldRects(board);
  const ex = exclude instanceof Set ? exclude : new Set(exclude);
  let best = null;
  for (const uid of board.order) {
    const item = board.items.get(uid);
    if (item.type !== "section" || ex.has(uid) || hasAncestorIn(board, uid, ex)) continue;
    if (!contains(r.get(uid), point)) continue;
    if (!best || item.depth >= best.depth) best = item;
  }
  return best ? best.uid : board.uid;
}
function toRelative(board, containerUid, worldPoint, rects) {
  if (containerUid === board.uid) return { x: worldPoint.x, y: worldPoint.y };
  const c = worldRect(board, containerUid, rects);
  return { x: worldPoint.x - c.x, y: worldPoint.y - c.y };
}
function hitTest(board, point, rects, { sectionInterior = false, exclude = null } = {}) {
  for (let i = board.order.length - 1; i >= 0; i--) {
    const item = board.items.get(board.order[i]);
    if (item.type === "section" || exclude?.has(item.uid)) continue;
    if (contains(rects.get(item.uid), point)) return { uid: item.uid, part: "body" };
  }
  for (let i = board.order.length - 1; i >= 0; i--) {
    const item = board.items.get(board.order[i]);
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
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var PREVIEW_MIN = { w: DEFAULT_SIZES.card.w * 2, h: DEFAULT_SIZES.card.h * 2 };
var PREVIEW_TITLE = 40;
function boardPreview(item, { max = 60, aspect = null, pad = 0.12 } = {}) {
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
  const p = Math.max(FIT_PAD, pad * Math.max(bw, bh));
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
function sectionFitPlan(board, rects, touchedUids, {
  pad = FIT_PAD,
  skip = /* @__PURE__ */ new Set(),
  parentOf = (u) => board.items.get(u)?.parentUid
} = {}) {
  const work = /* @__PURE__ */ new Map();
  const same = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  for (const touched of touchedUids) {
    let cur = touched;
    for (let guard = 0; guard < 256; guard++) {
      const pid = parentOf(cur);
      if (!pid || pid === board.uid) break;
      const sec = board.items.get(pid);
      if (!sec || sec.type !== "section" || sec.autofit === false || sec.pinned || skip.has(pid)) break;
      const secRect = work.get(pid) ?? rects.get(pid);
      const childRect = work.get(cur) ?? rects.get(cur);
      if (!secRect || !childRect) break;
      const need = unionRect2(secRect, inflate(childRect, pad));
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
      if (!pid || pid === board.uid) break;
      d++;
      cur = pid;
    }
    return d;
  };
  return [...work.entries()].map(([uid, rect]) => ({ uid, rect, depth: depthOf(uid) })).sort((a, b) => b.depth - a.depth).map(({ uid, rect }) => ({ uid, rect }));
}
function sidebarOutlineUids(board) {
  if (!board) return [];
  const uids = [...board.roots || []];
  if (board.containerUid) uids.push(board.containerUid);
  return uids;
}
function outlineOrder(board) {
  const byOrder = (uids) => uids.map((u, i) => ({ u, i, o: board.items.get(u)?.order ?? i })).sort((a, b) => a.o - b.o || a.i - b.i).map(({ u }) => u);
  const out = [];
  const visit = (uid) => {
    out.push(uid);
    for (const m of byOrder(board.items.get(uid).members)) visit(m);
  };
  for (const uid of byOrder(board.roots)) visit(uid);
  return out;
}
function itemsInRect(board, rect, rects, { mode = "contain" } = {}) {
  const test = mode === "intersect" ? intersects : (r, a) => containsRect(r, a);
  const hits = [];
  for (const uid of board.order) {
    const r = rects.get(uid);
    if (r && test(rect, r)) hits.push(uid);
  }
  return topLevelOf(board, hits);
}
function membershipPlan(board, movedUids, rects) {
  const moved = topLevelOf(board, movedUids);
  const exclude = new Set(moved);
  const plan = [];
  for (const uid of moved) {
    const item = board.items.get(uid);
    const r = rects.get(uid);
    const toParent = containerAt(board, centerOf(r), { exclude, rects });
    if (toParent === item.parentUid) continue;
    const rel = toRelative(board, toParent, { x: r.x, y: r.y }, rects);
    plan.push({ uid, fromParent: item.parentUid, toParent, x: rel.x, y: rel.y });
  }
  return plan;
}
function sectionAdoptPlan(board, sectionUid, rects) {
  const section = board.items.get(sectionUid);
  if (!section) return [];
  const sr = rects.get(sectionUid);
  const parentUid = section.parentUid;
  const siblings = parentUid === board.uid ? board.roots : board.items.get(parentUid).members;
  const plan = [];
  for (const uid of siblings) {
    if (uid === sectionUid) continue;
    const r = rects.get(uid);
    if (!contains(sr, centerOf(r))) continue;
    const rel = toRelative(board, sectionUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: sectionUid, x: rel.x, y: rel.y });
  }
  for (const uid of section.members) {
    const r = rects.get(uid);
    if (contains(sr, centerOf(r))) continue;
    const rel = toRelative(board, parentUid, { x: r.x, y: r.y }, rects);
    plan.push({ uid, toParent: parentUid, x: rel.x, y: rel.y });
  }
  return plan;
}
function edgesTouching(board, uidSet) {
  const full = new Set(uidSet);
  for (const u of uidSet) for (const d of descendantsOf(board, u)) full.add(d);
  const out = /* @__PURE__ */ new Set();
  for (const e of board.edges.values()) if (full.has(e.from) || full.has(e.to)) out.add(e.uid);
  return out;
}
function findEdge(board, from, to) {
  for (const e of board.edges.values()) if (e.from === from && e.to === to) return e;
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
function copyPayload(board, uids, rects) {
  const top = topLevelOf(board, [...uids]);
  const items = [];
  const boxes = [];
  for (const uid of top) {
    const item = board.items.get(uid);
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
    mime: JSON.stringify({ v: 1, board: board.uid, bounds, items }),
    text: items.map((i) => semanticRef(i)).join("\n")
  };
}
function parsePastedText(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
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
function sortedKids(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function planSubtreeClone(node, { genUid, parentUid, order = "last", plexusPatch = null, uidMap = /* @__PURE__ */ new Map() } = {}) {
  const assign = (n) => {
    uidMap.set(n[":block/uid"], genUid());
    for (const c of sortedKids(n)) assign(c);
  };
  assign(node);
  const creates = [];
  const emit2 = (n, parent, ord, isRoot) => {
    const props = n[":block/props"] == null ? null : plainKeys(n[":block/props"]);
    let outProps = props;
    if (isRoot && plexusPatch) {
      outProps = { ...props ?? {} };
      outProps[PLEXUS_KEY] = { ...outProps[PLEXUS_KEY] ?? {}, ...plexusPatch };
    }
    const uid = uidMap.get(n[":block/uid"]);
    creates.push({
      uid,
      parent,
      order: ord,
      string: rewriteRefs(n[":block/string"], uidMap),
      props: outProps,
      open: n[":block/open"] !== false
    });
    sortedKids(n).forEach((c, i) => emit2(c, uid, i, false));
  };
  emit2(node, parentUid, order, true);
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
      string: edgeString({ srcRef: refOfNew(from), dstRef: refOfNew(to), dir: edge.dir, label: edge.label }),
      props: { [PLEXUS_KEY]: serializeEdge({ ...edge, from, to }) },
      open: true
    });
  }
  return creates;
}

// src/model/layout.js
var num2 = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
var norm = (n) => n + 0;
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
  const n = items.length;
  const cols = Math.max(1, Math.min(n, Math.floor(num2(columns, 0)) || Math.ceil(Math.sqrt(n))));
  const colW = new Array(cols).fill(0);
  const rowH = [];
  items.forEach((r, i) => {
    const c = i % cols;
    const row = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], r.w);
    rowH[row] = Math.max(rowH[row] ?? 0, r.h);
  });
  const colX = [];
  let x = origin.x;
  for (let c = 0; c < cols; c++) {
    colX[c] = x;
    x += colW[c] + gap;
  }
  const rowY = [];
  let y = origin.y;
  for (let row = 0; row < rowH.length; row++) {
    rowY[row] = y;
    y += rowH[row] + gap;
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
    let changed = false;
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
        changed = true;
      }
    }
    if (!changed) break;
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
function subtree(node, sizeOf, levelGap, sibGap) {
  const { dd, bb } = sizeOf(node);
  const kids = (node.children ?? []).map((c) => ({ c, s: subtree(c, sizeOf, levelGap, sibGap), size: sizeOf(c) }));
  if (!kids.length) return { extent: bb, nodeB: 0, places: [{ uid: node.uid, d: 0, b: 0 }] };
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
  const places = [{ uid: node.uid, d: 0, b: parentB - min }];
  kids.forEach((k, i) => {
    for (const p of k.s.places) places.push({ uid: p.uid, d: dd + levelGap + p.d, b: offs[i] - min + p.b });
  });
  return { extent: max - min, nodeB: parentB - min, places };
}
function mindMapLayout(root, { direction = "right", hGap = 80, vGap = 24 } = {}) {
  const out = /* @__PURE__ */ new Map();
  if (!root) return out;
  const down = direction === "down";
  const sizeOf = down ? (n) => ({ dd: n.h, bb: n.w }) : (n) => ({ dd: n.w, bb: n.h });
  const toXY = (d, b) => down ? { x: norm(b), y: norm(d) } : { x: norm(d), y: norm(b) };
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
  for (const p of groupPlaces(kids)) out.set(p.uid, toXY(p.d, p.b));
  return out;
}
function findNode(node, uid) {
  if (node.uid === uid) return node;
  for (const c of node.children ?? []) {
    const f = findNode(c, uid);
    if (f) return f;
  }
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
function coveredBy(links, board) {
  const pairs = /* @__PURE__ */ new Map();
  for (const [uid, e] of board.edges) {
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

// src/host/roam.js
var BOARD_PATTERN = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
   {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
     {:block/children ...}]}]}]`;
var ciPattern = (text) => `(?i)${String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
var NATIVE_PATTERN = `[:block/props
 {:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}]`;
var DIAGRAM_RE = "^\\{\\{(\\[\\[)?diagram";
var BOARD_META_PATTERN = "[:block/props :edit/time {:block/children [:block/props]}]";
var eidKey = (uid) => [":block/uid", uid];
var watchEntity = (uid) => `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
function sortedKids2(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function trimTree(node, depth, budget) {
  const out = [];
  if (depth < 1) return out;
  for (const c of sortedKids2(node)) {
    if (budget.left <= 0) break;
    budget.left--;
    out.push({
      uid: c[":block/uid"],
      string: c[":block/string"] ?? "",
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
      let n = 0;
      for (const s of state.values()) if (s.uid === uid) n += s.pending.length + s.inflight;
      return n;
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
  const stats = { writes: 0, watches: 0, renders: 0 };
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
    pageUid(title) {
      const res = pull("[:block/uid]", [":node/title", title]);
      return res?.[":block/uid"] ?? null;
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
    // Page that owns a block. Empty when the block is missing or is itself a page.
    pageTitleOf(uid) {
      const res = pull("[{:block/page [:node/title]}]", eidKey(uid));
      const page = res?.[":block/page"];
      const node = Array.isArray(page) ? page[0] : page;
      const title = node?.[":node/title"];
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
      const n = entry?.n ?? 1;
      let done = 0;
      try {
        for (; done < n; done++) await data.undo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done >= n) redoLog.push(entry);
          else {
            if (done > 0) redoLog.push({ n: done });
            undoLog.push({ n: n - done });
          }
        }
      }
    },
    async redo() {
      lastWriteAt = Date.now();
      const entry = redoLog.pop();
      const n = entry?.n ?? 1;
      let done = 0;
      try {
        for (; done < n; done++) await data.redo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done > 0) undoLog.push(done >= n ? entry : { n: done });
          if (done < n) redoLog.push({ n: n - done });
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
    searchPages(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
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
    searchBlocks(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
      if (!needle) return [];
      const rows = host.q(
        `[:find ?s ?u ?t :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
        ciPattern(needle)
      ) || [];
      return rows.filter(([, , t]) => typeof t === "string" && !t.startsWith("roam/")).slice(0, limit).map(([s, u, t]) => ({ uid: u, string: s, pageTitle: t }));
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
      const add = (list, relation, target, text) => {
        const key = `${relation}|${target.kind}|${target.title ?? target.uid}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ relation, target, text });
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
    }
  };
  return host;
}

// src/host/migrate.js
var METADATA_PAGE = "plexus-diagram/metadata";
function sortedKids3(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
var str = (n) => String(n?.[":block/string"] ?? "").trim();
function pair(text) {
  const p = String(text).split(",").map((s) => Number(s.trim()));
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
      const node = { x: void 0, y: void 0, w: void 0, h: void 0, color: void 0 };
      for (const k of sortedKids3(child)) {
        const l = str(k);
        const pos = prop(l, "pos");
        const size = prop(l, "size");
        const color = prop(l, "color");
        if (pos !== null) {
          const p = pair(pos);
          if (p) {
            node.x = p.a;
            node.y = p.b;
          }
        }
        if (size !== null) {
          const p = pair(size);
          if (p) {
            node.w = p.a;
            node.h = p.b;
          }
        }
        if (color !== null && PALETTE.includes(color)) node.color = color;
      }
      out.nodes.set(uid, node);
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
  const ch = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
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
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) continue;
      out[to] = Math.max(CARD_FONT_MIN, Math.min(CARD_FONT_MAX, n));
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
  const nodes = rawNodes.map((n) => {
    const id = n[":db/id"];
    const blockUid = n[":diagram.node/block"]?.[":block/uid"] ?? null;
    const key = blockUid ?? `n${id}`;
    keyById.set(id, key);
    const data = parseData(n[":diagram.node/data"]);
    const abs = data.positionAbsolute && finite(data.positionAbsolute.x) !== void 0 ? data.positionAbsolute : null;
    const pos = abs ?? data.position ?? {};
    const type = data.type === "group" ? "group" : "node";
    return {
      key,
      blockUid,
      x: finite(pos.x) ?? 0,
      y: finite(pos.y) ?? 0,
      w: finite(data.width) ?? finite(data.measured?.width),
      h: finite(data.height) ?? finite(data.measured?.height),
      absolute: Boolean(abs),
      parentId: n[":diagram.node/parent-node"]?.[":db/id"],
      type,
      title: n[":diagram.node/block"]?.[":block/string"] ?? "",
      style: mapNodeStyle(data, type, type === "group" ? groupDefaults : blockDefaults)
    };
  });
  for (const n of nodes) {
    n.parentNode = n.parentId != null ? keyById.get(n.parentId) : void 0;
    delete n.parentId;
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
var round12 = (n) => Math.round(n * 10) / 10;
var centerOf2 = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
var inside = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
function defaultGen() {
  let n = 0;
  return () => `imp${String(++n).padStart(6, "0")}`;
}
function refOf(board, uid, sectionUids) {
  const item = board.items.get(uid);
  if (item && !sectionUids.has(uid)) return semanticRef(item);
  return `((${uid}))`;
}
function edgePlan(board, sectionUids, from, to, label, extra = {}) {
  const dir = extra.dir ?? "one";
  return {
    from,
    to,
    label,
    string: edgeString({ srcRef: refOf(board, from, sectionUids), dstRef: refOf(board, to, sectionUids), dir, label }),
    props: serializeEdge({ from, to, dir, ...extra, type: void 0 })
  };
}
function planV06(board, source, gen) {
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
  for (const [uid, node] of source.nodes) {
    const item = board.items.get(uid);
    if (!item || item.type === "section") continue;
    const abs = {
      x: node.x ?? item.x,
      y: node.y ?? item.y,
      w: node.w ?? item.w,
      h: node.h ?? item.h
    };
    const c = centerOf2(abs);
    let best = null;
    for (const s of secs) {
      if (!inside(s.abs, c)) continue;
      if (!best || s.abs.w * s.abs.h < best.abs.w * best.abs.h) best = s;
    }
    const layout = { type: item.type, w: abs.w, h: abs.h, color: node.color };
    if (best) {
      best.entry.members.push(uid);
      plan.memberLayouts.push({ uid, layout: { ...layout, x: round12(abs.x - best.abs.x), y: round12(abs.y - best.abs.y) } });
    } else {
      plan.itemLayouts.push({ uid, layout: { ...layout, x: abs.x, y: abs.y } });
    }
  }
  for (const e of source.edges) {
    if (!board.items.has(e.from) || !board.items.has(e.to) || e.from === e.to) continue;
    plan.edges.push(edgePlan(board, sectionUids, e.from, e.to, e.label ?? "", {
      fromSide: e.fromSide,
      toSide: e.toSide,
      dir: e.dir,
      route: e.route,
      color: e.color
    }));
  }
  return plan;
}
function planNative(board, source, gen) {
  const plan = { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  const nodes = source.nodes;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const widths = nodes.filter((n) => n.type !== "group").map((n) => n.w).filter((w) => w > 0).sort((a, b) => a - b);
  const typical = widths.length ? widths[Math.floor(widths.length / 2)] : 165;
  const scale = Math.max(1, 240 / typical);
  const absCache = /* @__PURE__ */ new Map();
  const absOf = (n, seen = /* @__PURE__ */ new Set()) => {
    if (absCache.has(n.key)) return absCache.get(n.key);
    let p = { x: n.x, y: n.y };
    if (!n.absolute && n.parentNode && !seen.has(n.key)) {
      const parent = byKey.get(n.parentNode);
      if (parent) {
        seen.add(n.key);
        const pa = absOf(parent, seen);
        p = { x: pa.x + n.x, y: pa.y + n.y };
      }
    }
    absCache.set(n.key, p);
    return p;
  };
  const sectionOf = /* @__PURE__ */ new Map();
  const groups = nodes.filter((n) => n.type === "group");
  for (const g of groups) {
    const existing = g.blockUid && board.items.has(g.blockUid);
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
      entry: { uid, title: g.title || board.items.get(uid)?.title || "Section", layout: null, members: [], parent: null, existing: Boolean(existing) }
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
  for (const n of nodes) {
    if (n.type === "group") continue;
    const item = n.blockUid ? board.items.get(n.blockUid) : null;
    if (!item || item.type === "section") continue;
    uidOfKey.set(n.key, item.uid);
    const a = absOf(n);
    const abs = { x: a.x * scale, y: a.y * scale };
    const layout = {
      type: item.type,
      w: Math.max(MIN_SIZES.card.w, Math.round((n.w ?? item.w / scale) * scale)),
      h: Math.max(MIN_SIZES.card.h, Math.round((n.h ?? item.h / scale) * scale)),
      ...n.style || {}
    };
    const sec = n.parentNode ? sectionOf.get(n.parentNode) : null;
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
    plan.edges.push(edgePlan(board, sectionUids, from, to, e.label ?? "", {
      dir: e.dir,
      route: e.route,
      dash: e.dash,
      color: e.color
    }));
  }
  if (source.boardStyle && Object.keys(source.boardStyle).length) plan.boardStyle = source.boardStyle;
  return plan;
}
function planImport(board, source, { gen = defaultGen() } = {}) {
  if (!source) return { itemLayouts: [], sections: [], memberLayouts: [], edges: [], viewport: null, markMigratedUid: null };
  return source.nodes instanceof Map ? planV06(board, source, gen) : planNative(board, source, gen);
}
async function executeImport(plan, host, board) {
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
        parentUid: board.uid,
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
    let containerUid = board.containerUid;
    if (!containerUid) {
      containerUid = await host.createBlock({
        parentUid: board.uid,
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
    host.viewports?.set(board.uid, plan.viewport);
    host.viewports?.flushAll?.();
  }
  const markerBase = { ...board.plexus || {} };
  if (plan.boardStyle && Object.keys(plan.boardStyle).length) Object.assign(markerBase, plan.boardStyle);
  await host.updateProps(board.uid, withBoardMarker(markerBase, true));
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
var ITEM_KEYS = ["type", "x", "y", "w", "h", "color", "collapsed", "fontSize", "pinned", "fit", "look", "textColor", "align", "fill", "border", "titleSize", "titleColor", "titleFill", "areaFill"];
var EDGE_KEYS = ["type", "from", "to", "fromSide", "toSide", "dir", "route", "dash", "weight", "color"];
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
var round13 = (n) => Math.round(n * 10) / 10;
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
function kidsOf(node) {
  const kids = Array.isArray(node?.[KIDS]) ? node[KIDS] : [];
  return kids.map((c, i) => ({ c, i })).sort((a, b) => (a.c[ORD] ?? a.i) - (b.c[ORD] ?? b.i) || a.i - b.i).map(({ c }) => c);
}
function indexTree(root) {
  const map = /* @__PURE__ */ new Map();
  const walk = (node, parent) => {
    map.set(node[UID], { node, parent });
    for (const c of node[KIDS] ?? []) walk(c, node);
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
function attach(parentNode, node, order) {
  const kids = kidsOf(parentNode);
  if (order === "last" || typeof order !== "number") kids.push(node);
  else kids.splice(Math.max(0, Math.min(order, kids.length)), 0, node);
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
  const ledger = createEchoLedger({ graceMs, now: now2 });
  let destroyed = false;
  let raw = clone(host.pullBoard(uid));
  let board = null;
  let rects = /* @__PURE__ */ new Map();
  let emitted = null;
  let rix = null;
  const ix = () => rix ?? (rix = indexTree(raw));
  const rebuild = () => {
    rix = null;
    board = raw ? buildBoard(raw) : null;
    rects = board ? worldRects(board) : /* @__PURE__ */ new Map();
  };
  rebuild();
  emitted = board;
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
    const n = Number(setting(name, fallback));
    return Number.isFinite(n) && n >= 40 ? n : fallback;
  };
  const collapseOutline = () => (typeof settings?.get === "function" ? settings.get("collapse-outline") : settings?.["collapse-outline"]) !== false;
  const rawNode = (id) => id === uid ? raw : ix().get(id)?.node ?? null;
  const insertOrder = (parentUid) => {
    const node = raw ? rawNode(parentUid) : null;
    if (!node) return "last";
    const at = kidsOf(node).findIndex((k) => readPlexus(k[PROPS])?.type === "edges");
    return at >= 0 ? at : "last";
  };
  const rawInsert = (parentUid, node, order) => {
    const parent = rawNode(parentUid);
    if (!parent) return;
    attach(parent, node, order);
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
    const node = rawNode(id);
    if (node) node[PROPS] = mergePropsForWrite(node[PROPS], plexus);
  };
  const rawString = (id, string) => {
    const node = rawNode(id);
    if (node) node[STR] = string;
  };
  const publish = () => {
    rebuild();
    if (!board) return null;
    const diff = diffBoards(emitted, board);
    emitted = board;
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
          const node = { ...mine.node, [KIDS]: [] };
          target[KIDS] = [...target[KIDS] ?? [], node];
          inc.set(id, { node, parent: target });
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
  async function execute(list) {
    let i = 0;
    try {
      for (; i < list.length; i++) {
        await runOp(list[i]);
        settleOp(list[i]);
      }
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
    if (!board || destroyed || gone) return Promise.resolve(void 0);
    const ops = [];
    const t = {
      create({ parent, uid: id, string = "", plexus, open, order }) {
        const newUid = id ?? host.generateUid();
        const ord = order ?? insertOrder(parent);
        const node = { [UID]: newUid, [STR]: string, [ORD]: 0, [KIDS]: [] };
        if (plexus) node[PROPS] = { plexus: plainKeys(plexus) };
        if (open !== void 0) node[OPEN] = open;
        rawInsert(parent, node, ord);
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
  function itemPlexus(id, patch) {
    const item = board.items.get(id);
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
    const item = board.items.get(id);
    const own = rects.get(id);
    if (item?.type !== "section" || !own || !item.members.length) return size;
    const b = boundsOf(item.members.map((m) => rects.get(m)).filter(Boolean));
    if (!b) return size;
    return { w: Math.max(size.w, b.x + b.w + FIT_PAD - own.x), h: Math.max(size.h, b.y + b.h + FIT_PAD - own.y) };
  };
  function ensureContainer(t) {
    if (board.containerUid) return board.containerUid;
    const existing = kidsOf(raw).find((k) => readPlexus(k[PROPS])?.type === "edges");
    if (existing) return existing[UID];
    return t.create({ parent: uid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
  }
  function refOf2(id) {
    const item = board.items.get(id);
    return item ? semanticRef(item) : `((${id}))`;
  }
  function edgeStringFor(from, to, dir, label) {
    return edgeString({ srcRef: refOf2(from), dstRef: refOf2(to), dir, label });
  }
  function applyFit(t, touched, { skip } = {}) {
    if (!flag("auto-fit-sections", true)) return;
    const list = [...touched ?? []];
    if (!list.length) return;
    t.sync();
    const plan = sectionFitPlan(board, rects, list, skip ? { skip: new Set(skip) } : {});
    if (!plan.length) return;
    const grown = new Map(plan.map((p) => [p.uid, p.rect]));
    const finalWorld = new Map(rects);
    for (const [sid, r] of grown) finalWorld.set(sid, r);
    const originOf = (pid) => pid === uid ? { x: 0, y: 0 } : finalWorld.get(pid) ?? { x: 0, y: 0 };
    for (const [sid, r] of grown) {
      const p = originOf(board.items.get(sid).parentUid);
      t.props(sid, itemPlexus(sid, { x: round13(r.x - p.x), y: round13(r.y - p.y), w: round13(r.w), h: round13(r.h) }));
    }
    for (const [sid, r] of grown) {
      const old = rects.get(sid);
      if (Math.abs(r.x - old.x) < 0.01 && Math.abs(r.y - old.y) < 0.01) continue;
      for (const m of board.items.get(sid).members) {
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
      const it = board.items.get(id);
      if (!it) continue;
      if (!byParent.has(it.parentUid)) byParent.set(it.parentUid, []);
      byParent.get(it.parentUid).push(id);
    }
    const displacedIds = [];
    for (const [pid, here] of byParent) {
      const sibs = pid === uid ? board.roots : board.items.get(pid)?.members ?? [];
      const withSections = here.some((id) => board.items.get(id).type === "section");
      const map = /* @__PURE__ */ new Map();
      const pinned = /* @__PURE__ */ new Set();
      for (const s of sibs) {
        const it = board.items.get(s);
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
  const cardAt = (t, string, x, y) => {
    const parent = containerAt(board, { x: x + DEFAULT_SIZES.card.w / 2, y: y + DEFAULT_SIZES.card.h / 2 }, { rects });
    const rel = toRelative(board, parent, { x, y }, rects);
    return t.create({ parent, string, plexus: serializeItemLayout(withCardLook({ x: rel.x, y: rel.y }, string)) });
  };
  const defaultSizeFor = (item) => {
    if (item.type === "section") return DEFAULT_SIZES.section;
    if (item.type === "text") return DEFAULT_SIZES.text;
    if (item.kind === "board") return DEFAULT_BOARD_CARD;
    return { w: sizeSetting("default-card-width", DEFAULT_SIZES.card.w), h: sizeSetting("default-card-height", DEFAULT_SIZES.card.h) };
  };
  function recomputeLinks(force) {
    if (!board) return;
    const filtered = filterLinks(allLinks, linkMode);
    const res = coveredBy(filtered, board);
    const fp = `${linkMode}|${res.visible.map((l) => l.key).join(",")}|${[...res.coveredEdges].sort().join(",")}`;
    const changed = fp !== linkFingerprint;
    visibleLinks = res.visible;
    covered = res.coveredEdges;
    linkFingerprint = fp;
    if (changed || force) emit2("links", { links: visibleLinks, coveredEdges: covered });
  }
  function computeLinks() {
    if (!board) return;
    const boardEid = host.resolveEid({ uid });
    const eidToItems = /* @__PURE__ */ new Map();
    for (const item of board.items.values()) {
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
    for (const row of rows) {
      const su = row[2];
      const ss = row[3];
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
      return board;
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
      if (!board || !dx && !dy) return Promise.resolve();
      return txn((t) => {
        const top = topLevelOf(board, uids).filter((id) => !board.items.get(id).pinned);
        if (!top.length) return;
        const moved = new Map(rects);
        for (const id of top) {
          const r = rects.get(id);
          moved.set(id, { ...r, x: r.x + dx, y: r.y + dy });
        }
        const plan = new Map(membershipPlan(board, top, moved).map((p) => [p.uid, p]));
        for (const id of top) {
          const item = board.items.get(id);
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
      if (!board || !list?.length) return Promise.resolve();
      return txn((t) => {
        const changedSections = [];
        const fitTouched = [];
        for (const r of list) {
          const item = board.items.get(r.uid);
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
            const plan = sectionAdoptPlan(board, sid, rects);
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
        const parent = containerAt(board, { x: x + size.w / 2, y: y + size.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        const layout = withCardLook({ x: rel.x, y: rel.y }, string);
        if (w !== void 0) layout.w = w;
        if (h !== void 0) layout.h = h;
        const id = t.create({ parent, string, plexus: serializeItemLayout(layout) });
        applyFit(t, [id]);
        return id;
      });
    },
    createText({ x, y, string = "" } = {}) {
      return txn((t) => {
        const parent = containerAt(board, { x: x + DEFAULT_SIZES.text.w / 2, y: y + DEFAULT_SIZES.text.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        const id = t.create({ parent, string, plexus: serializeItemLayout({ type: "text", x: rel.x, y: rel.y }) });
        applyFit(t, [id]);
        return id;
      });
    },
    createSection({ rect, title = "Section", color } = {}) {
      return txn((t) => makeSection(t, rect, title, color, null));
    },
    wrapInSection(uids) {
      return txn((t) => {
        const top = topLevelOf(board, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const pad = 32;
        const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
        return makeSection(t, rect, "Section", void 0, top);
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
        const top = topLevelOf(board, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const card = { x: b.x, y: b.y, w: Math.min(480, Math.max(240, b.w)), h: Math.min(360, Math.max(180, b.h)) };
        const boardUid = makeBoard(t, card, "", new Set(top), b);
        moveItemsInto(t, top, boardUid, { x: b.x, y: b.y }, { x: 0, y: 0 });
        applyFit(t, [boardUid]);
        return boardUid;
      });
    },
    moveIntoBoard(uids, boardUid) {
      if (!board || destroyed) return Promise.resolve(null);
      const target = board.items.get(boardUid);
      if (!target || target.kind !== "board" || !target.enhanced) return Promise.resolve(null);
      const top = topLevelOf(board, uids).filter((id) => id !== boardUid && !descendantsOf(board, id).has(boardUid));
      if (!top.length) return Promise.resolve(null);
      const preview = boardPreview(target);
      const cb = preview.bounds;
      const place = cb ? { x: cb.x + cb.w + 48, y: cb.y } : { x: 0, y: 0 };
      const origin = boundsOf(top.map((id) => rects.get(id)));
      const moved = new Set(top);
      for (const id of top) for (const d of descendantsOf(board, id)) moved.add(d);
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
        const cur0 = board.items.get(id);
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
        const ids = items.map(({ string, x, y }) => cardAt(t, string, x, y));
        applyFit(t, ids);
        return ids;
      });
    },
    deleteItems(uids, { withContents = false, force = false } = {}) {
      return txn((t) => {
        const protectedItem = (id) => board.items.get(id).pinned || withContents && [...descendantsOf(board, id)].some((d) => board.items.get(d).pinned);
        const set = new Set([...uids].filter((id) => board.items.has(id) && (force || !protectedItem(id))));
        if (!set.size) return;
        let edgeSet;
        if (withContents) {
          edgeSet = edgesTouching(board, set);
        } else {
          edgeSet = /* @__PURE__ */ new Set();
          for (const e of board.edges.values()) if (set.has(e.from) || set.has(e.to)) edgeSet.add(e.uid);
          for (const id of set) {
            const item = board.items.get(id);
            if (item.type !== "section") continue;
            let survivor = item.parentUid;
            while (survivor !== uid && set.has(survivor)) survivor = board.items.get(survivor).parentUid;
            for (const m of item.members) {
              if (set.has(m)) continue;
              const r = rects.get(m);
              const rel = toRelative(board, survivor, { x: r.x, y: r.y }, rects);
              t.move(m, survivor, "last");
              t.props(m, itemPlexus(m, { x: rel.x, y: rel.y }));
            }
          }
        }
        for (const id of edgeSet) t.del(id);
        const explicit = withContents ? topLevelOf(board, set) : [...set].filter((id) => !set.has(board.items.get(id).parentUid));
        for (const id of explicit) t.del(id);
      });
    },
    setColor(uids, color) {
      return txn((t) => {
        for (const id of uids) {
          if (board.items.has(id)) t.props(id, itemPlexus(id, { color: color ?? void 0 }));
          else if (board.edges.has(id)) t.props(id, edgePlexus(id, { color: color ?? void 0 }));
        }
      });
    },
    setCollapsed(id, value) {
      return txn((t) => {
        if (board.items.has(id)) t.props(id, itemPlexus(id, { collapsed: value ? true : void 0 }));
      });
    },
    // Roam :block/open on the card block only. Fold stays on plexus collapsed.
    setBlockOpen(id, open) {
      const item = board?.items.get(id);
      if (!item || item.type !== "card") return Promise.resolve(false);
      const node = rawNode(id);
      if (!node) return Promise.resolve(false);
      const next = open !== false;
      if (node[OPEN] !== false === next) return Promise.resolve(false);
      node[OPEN] = next;
      publish();
      return queue.run(async () => {
        await host.setOpen(id, next);
        return true;
      }).catch((err) => {
        handleFailure(err);
        return false;
      });
    },
    setFontSize(id, size) {
      return txn((t) => {
        if (board.items.has(id)) t.props(id, itemPlexus(id, { fontSize: size }));
      });
    },
    // One undo step. Cards and text only. null clears a key. Invalid values are dropped by serialize.
    setItemStyle(uids, patch = {}) {
      return txn((t) => {
        const ids = capBulk([...new Set(uids ?? [])].filter((id) => {
          const item = board.items.get(id);
          return item && item.type !== "section";
        }), emit2);
        let n = 0;
        for (const id of ids) {
          const nextPatch = {};
          for (const k of ITEM_STYLE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
            nextPatch[k] = patch[k] == null ? void 0 : patch[k];
          }
          const next = itemPlexus(id, nextPatch);
          if (stable(next) !== stable(rawPlexus(id))) {
            t.props(id, next);
            n++;
          }
        }
        return n;
      });
    },
    resetItemStyle(uids) {
      const patch = {};
      for (const k of ITEM_STYLE_KEYS) patch[k] = null;
      return this.setItemStyle(uids, patch);
    },
    setSectionStyle(uids, patch = {}) {
      return txn((t) => {
        const ids = capBulk([...new Set(uids ?? [])].filter((id) => board.items.get(id)?.type === "section"), emit2);
        let n = 0;
        for (const id of ids) {
          const nextPatch = {};
          for (const k of SECTION_STYLE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
            nextPatch[k] = patch[k] == null ? void 0 : patch[k];
          }
          const next = itemPlexus(id, nextPatch);
          if (stable(next) !== stable(rawPlexus(id))) {
            t.props(id, next);
            n++;
          }
        }
        return n;
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
        if (!board.enhanced) return false;
        const base = rawPlexus(uid);
        const prevDefaults = base.defaults && typeof base.defaults === "object" && !Array.isArray(base.defaults) ? base.defaults : {};
        const section = prevDefaults.section && typeof prevDefaults.section === "object" ? { ...prevDefaults.section } : {};
        for (const k of SECTION_STYLE_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
          if (patch[k] == null) delete section[k];
          else section[k] = patch[k];
        }
        const clean = normalizeSectionDefaults(section);
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
        const item = board.items.get(id);
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
        const item = board.items.get(id);
        if (!item || item.type === "section") return;
        const target = Math.min(900, Math.ceil(contentHeight));
        if (!(target > item.h)) return;
        t.props(id, itemPlexus(id, { h: target }));
        applyFit(t, [id]);
      });
    },
    fitSection(id, { shrink = true } = {}) {
      return txn((t) => {
        const item = board.items.get(id);
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
        const item = board.items.get(id);
        if (!item || item.type !== "section") return;
        const want = on === false ? false : void 0;
        if (item.autofit === false === (want === false)) return;
        t.props(id, itemPlexus(id, { fit: want }));
      });
    },
    setPinned(uids, on) {
      return txn((t) => {
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.pinned === Boolean(on)) continue;
          t.props(id, itemPlexus(id, { pinned: on ? true : void 0 }));
        }
      });
    },
    // bg / bgColor: undefined leaves the key, null removes it. bg is a pattern. bgColor is a tone name or #rrggbb.
    // Resolves true when applied (or already equal), false when rejected.
    setBoardBackground({ bg, bgColor } = {}) {
      return txn((t) => {
        if (!board.enhanced) return false;
        let tone = bgColor;
        if (bg != null && !BOARD_PATTERNS.includes(bg)) return false;
        if (tone != null) {
          tone = boardColor(tone);
          if (!tone) return false;
        }
        const base = rawPlexus(uid);
        const next = { ...base };
        for (const [key, value] of [["bg", bg], ["bgColor", tone]]) {
          if (value === void 0) continue;
          if (value === null) delete next[key];
          else next[key] = value;
        }
        if (stable(next) !== stable(base)) t.props(uid, next);
        return true;
      });
    },
    setCollapsedMany(uids, value) {
      return txn((t) => {
        let count = 0;
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
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
        const pool = within ? [...descendantsOf(board, within)] : [...board.items.keys()];
        let count = 0;
        for (const id of pool) {
          const item = board.items.get(id);
          if (!item || item.type !== "card" || skipIds.has(id) || item.collapsed === Boolean(value)) continue;
          t.props(id, itemPlexus(id, { collapsed: value ? true : void 0 }));
          count++;
        }
        return count;
      });
    },
    // Modes: row, column, grid, outline. A lone selected section tidies its members; otherwise each parent's
    // selected items are tidied among themselves. Writes only x and y. Resolves the number of items moved.
    tidyItems(uids, mode = "grid", { gap } = {}) {
      return txn((t) => {
        const top = topLevelOf(board, uids ?? []);
        const groups = /* @__PURE__ */ new Map();
        if (top.length === 1 && board.items.get(top[0]).type === "section") {
          groups.set(top[0], board.items.get(top[0]).members.filter((m) => !board.items.get(m).pinned));
        } else {
          for (const id of top) {
            const it = board.items.get(id);
            if (it.pinned) continue;
            if (!groups.has(it.parentUid)) groups.set(it.parentUid, []);
            groups.get(it.parentUid).push(id);
          }
        }
        const opts = gap !== void 0 ? { gap } : {};
        if (mode === "outline") opts.order = outlineOrder(board);
        const moved = [];
        for (const ids of groups.values()) {
          if (ids.length < 2) continue;
          const list = ids.map((id) => {
            const it = board.items.get(id);
            return { uid: id, x: it.x, y: it.y, w: it.w, h: it.h };
          });
          for (const p of tidyRects(list, mode, opts)) {
            const it = board.items.get(p.uid);
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
        const ids = [.../* @__PURE__ */ new Set([...uids ?? [], primaryUid])].filter((id) => board.items.has(id));
        const list = ids.map((id) => ({ uid: id, w: board.items.get(id).w, h: board.items.get(id).h }));
        const changed = [];
        for (const c of sameSize(list, primaryUid, mode)) {
          const item = board.items.get(c.uid);
          if (item.pinned) continue;
          const size = sectionFloor(c.uid, clampSize(item.type, c.w, c.h));
          if (round13(size.w) === item.w && round13(size.h) === item.h) continue;
          t.props(c.uid, itemPlexus(c.uid, { w: round13(size.w), h: round13(size.h) }));
          changed.push(c.uid);
        }
        applyFit(t, changed);
        return changed.length;
      });
    },
    resetSize(uids) {
      return txn((t) => {
        const changed = [];
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.pinned) continue;
          const d = sectionFloor(id, defaultSizeFor(item));
          const w = round13(d.w);
          const h = round13(d.h);
          if (item.w === w && item.h === h) continue;
          t.props(id, itemPlexus(id, { w, h }));
          changed.push(id);
        }
        applyFit(t, changed);
        return changed.length;
      });
    },
    // Sets the height from measured content, shrinking as well as growing (growToFit only grows).
    fitToContent(id, contentHeight) {
      return txn((t) => {
        const item = board.items.get(id);
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
        for (const item of board.items.values()) if (item.kind === "page") have.add(item.target.title);
        const made = [];
        const size = defaultSizeFor({ type: "card", kind: "page" });
        const occupied = [...board.items.values()].filter((it) => it.type !== "section").map((it) => rects.get(it.uid)).filter(Boolean);
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
    addEdge({ from, to, fromSide, toSide, label = "", dir = "one" } = {}) {
      return txn((t) => {
        if (!from || !to || from === to || !board.items.has(from) || !board.items.has(to)) return null;
        const existing = findEdge(board, from, to);
        if (existing && existing.dir === dir) return existing.uid;
        const container = ensureContainer(t);
        const props = serializeEdge({ from, to, dir, fromSide, toSide });
        return t.create({ parent: container, order: "last", string: edgeStringFor(from, to, dir, label), plexus: props });
      });
    },
    updateEdge(id, patch = {}) {
      return txn((t) => {
        const edge = board.edges.get(id);
        if (!edge) return;
        const { label, ...rest } = patch;
        const next = edgePlexus(id, rest);
        t.props(id, next);
        const dir = rest.dir ?? edge.dir;
        const nextLabel = label ?? edge.label;
        if (rest.dir !== void 0 && rest.dir !== edge.dir || label !== void 0 && label !== edge.label) {
          t.string(id, edgeStringFor(edge.from, edge.to, dir, nextLabel));
        }
      });
    },
    flipEdge(id) {
      return txn((t) => {
        const edge = board.edges.get(id);
        if (!edge) return;
        t.props(id, edgePlexus(id, { from: edge.to, to: edge.from, fromSide: edge.toSide, toSide: edge.fromSide }));
        t.string(id, edgeStringFor(edge.to, edge.from, edge.dir, edge.label));
      });
    },
    deleteEdges(uids) {
      return txn((t) => {
        for (const id of uids) if (board.edges.has(id)) t.del(id);
      });
    },
    pinLink(link) {
      const first = link?.labels?.[0];
      const label = first && first !== "mentions" ? first : "";
      return session.addEdge({ from: link.from, to: link.to, label, dir: "one" });
    },
    async writeToGraph(edgeUid) {
      const edge = board?.edges.get(edgeUid);
      if (!edge) return { ok: false, reason: "unresolved" };
      const label = String(edge.label ?? "").trim();
      if (!label) return { ok: false, reason: "empty-label" };
      if (label.includes("::")) return { ok: false, reason: "invalid-label" };
      if (/^BT_attr/i.test(label)) return { ok: false, reason: "reserved-label" };
      if (label.length > 60) return { ok: false, reason: "too-long" };
      const src = board.items.get(edge.from);
      const dst = board.items.get(edge.to);
      if (!src || !dst) return { ok: false, reason: "unresolved" };
      const dstRef = semanticRef(dst);
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
      if (!board) return { enhanced: false, reason: "no-board" };
      if (board.enhanced) return { enhanced: false, reason: "already" };
      let source = readV06Entry(host, uid);
      let kind = "v06";
      if (!source) {
        const native = readNative(host, uid);
        source = native.nodes.length ? native : null;
        kind = source ? "native" : "none";
      }
      const plan = planImport(board, source, { gen: () => host.generateUid() });
      const collapse = collapseOutline() && raw?.[OPEN] !== false;
      let counts = null;
      try {
        counts = await queue.run(() => grouped(async () => {
          ledger.clear();
          const done = await executeImport(plan, host, board);
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
    const parent = containerAt(board, { x: centerOf3.x + centerOf3.w / 2, y: centerOf3.y + centerOf3.h / 2 }, { rects, exclude });
    const rel = toRelative(board, parent, { x: rect.x, y: rect.y }, rects);
    return t.create({
      parent,
      string: boardString(title),
      plexus: serializeItemLayout({ x: rel.x, y: rel.y, w: rect.w, h: rect.h, v: SCHEMA_VERSION }),
      open: collapseOutline() ? false : void 0
    });
  }
  function moveItemsInto(t, top, boardUid, origin, place, track = {}) {
    const moved = track.moved ?? new Set([...top].flatMap((id) => [id, ...descendantsOf(board, id)]));
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
    const touched = [...board.edges.values()].filter((e) => moved.has(e.from) || moved.has(e.to));
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
      const dup = findEdge(board, from, to);
      const key = `${from}>${to}`;
      if (from === to || dup && dup.uid !== e.uid || taken.has(key)) {
        if (snapshot) snapshot.deleted = true;
        t.del(e.uid);
        continue;
      }
      taken.add(key);
      t.props(e.uid, edgePlexus(e.uid, { from, to, fromSide: moved.has(e.from) ? "auto" : e.fromSide, toSide: moved.has(e.to) ? "auto" : e.toSide }));
      t.string(e.uid, edgeStringFor(from, to, e.dir, e.label));
    }
  }
  function makeSection(t, rect, title, color, adopt) {
    const parent = containerAt(board, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, { rects });
    const rel = toRelative(board, parent, { x: rect.x, y: rect.y }, rects);
    const members = adopt ?? itemsInRect(board, rect, rects, { mode: "contain" });
    const size = clampSize("section", rect.w, rect.h);
    const sectionUid = t.create({
      parent,
      string: title,
      plexus: serializeItemLayout({ type: "section", x: rel.x, y: rel.y, w: size.w, h: size.h, color })
    });
    for (const id of members) {
      if (id === sectionUid) continue;
      const r = rects.get(id);
      t.move(id, sectionUid, "last");
      t.props(id, itemPlexus(id, { x: round13(r.x - rect.x), y: round13(r.y - rect.y) }));
    }
    return sectionUid;
  }
  if (linkMode !== "off" && board) refreshLinks();
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
    board: () => board,
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
var OUTLINE_DIRECTIONS = ["right", "down", "balanced"];
function findNode2(node, uid) {
  if (!node) return null;
  if (node[UID2] === uid) return node;
  for (const c of node[KIDS2] ?? []) {
    const hit = findNode2(c, uid);
    if (hit) return hit;
  }
  return null;
}
var isEnhancedBoardNode = (node) => Boolean(node) && readPlexus(node[PROPS2])?.v === 2 && classifyString(node[STR2]).kind === "board";
extendSession((session, api) => {
  const { host } = api;
  const gen = () => host.generateUid();
  function placeCard(t, string, x, y, { w, h, color } = {}, exclude) {
    const board = api.board();
    const rects = api.rects();
    const cw = w ?? DEFAULT_SIZES.card.w;
    const ch = h ?? DEFAULT_SIZES.card.h;
    const parent = containerAt(board, { x: x + cw / 2, y: y + ch / 2 }, { rects, exclude });
    const rel = toRelative(board, parent, { x, y }, rects);
    const layout = { x: rel.x, y: rel.y };
    if (w !== void 0) layout.w = w;
    if (h !== void 0) layout.h = h;
    if (color) layout.color = color;
    const look = lookForNewString(string, api.setting("default-card-look", "block"));
    if (look) layout.look = look;
    return t.create({ parent, string, plexus: serializeItemLayout(layout) });
  }
  function cloneSet(t, src, entries, exclude) {
    const board = api.board();
    const rects = api.rects();
    const at = new Map(entries.map((e) => [e.uid, e]));
    const uidMap = /* @__PURE__ */ new Map();
    const tops = [];
    for (const id of topLevelOf(src.board, entries.map((e) => e.uid))) {
      const e = at.get(id);
      const item = src.board.items.get(id);
      const node = src.node(id);
      if (!item || !node) continue;
      if (item.kind === "board" && !item.enhanced) continue;
      const parent = containerAt(board, { x: e.x + item.w / 2, y: e.y + item.h / 2 }, { rects, exclude });
      const rel = toRelative(board, parent, { x: e.x, y: e.y }, rects);
      const x = api.round1(rel.x);
      const y = api.round1(rel.y);
      const simple = item.type === "text" || ["page", "block", "image"].includes(item.kind);
      if (simple) {
        const plexus = { ...readPlexus(node[PROPS2]) ?? {}, x, y };
        delete plexus.pinned;
        const fresh = gen();
        uidMap.set(id, fresh);
        t.create({ parent, uid: fresh, string: node[STR2] ?? "", plexus });
        tops.push(fresh);
        continue;
      }
      const patch = { x, y };
      if (item.type === "section") Object.assign(patch, { type: "section", w: item.w, h: item.h });
      const plan = planSubtreeClone(node, { genUid: gen, parentUid: parent, order: api.insertOrder(parent), plexusPatch: patch, uidMap });
      const oldOf = new Map([...uidMap].map(([o, n]) => [n, o]));
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
        const board = api.board();
        const rects = api.rects();
        const top = topLevelOf(board, uids ?? []);
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
          made = cloneSet(t, { board, node: api.rawNode }, entries, exclude);
        }
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },
    // A detached copy of the items (and their subtrees and the connections between them) as a synthetic board
    // tree. A cut puts it in the clipboard payload, so the paste no longer depends on the deleted blocks.
    snapshotItems(uids) {
      const board = api.board();
      if (!board) return null;
      const top = topLevelOf(board, uids ?? []);
      if (!top.length) return null;
      const set = new Set(top);
      for (const id of top) for (const d of descendantsOf(board, id)) set.add(d);
      const copy = (id) => JSON.parse(JSON.stringify(api.rawNode(id) ?? null));
      const nodes = top.map(copy).filter(Boolean);
      if (!nodes.length) return null;
      const edgeNodes = [...board.edges.values()].filter((e) => e.valid && set.has(e.from) && set.has(e.to)).map((e) => copy(e.uid)).filter(Boolean);
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
            const board = buildBoard(payload.snapshot);
            if (!board) return [];
            src = { board, node: (id) => findNode2(payload.snapshot, id) };
          } else if (payload.board === session.uid) src = { board: api.board(), node: api.rawNode };
          else {
            const pulled = host.pullBoard(payload.board);
            const board = pulled ? buildBoard(pulled) : null;
            if (!board) return [];
            src = { board, node: (id) => findNode2(pulled, id) };
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
    pasteText(text, { x = 0, y = 0 } = {}) {
      const list = (Array.isArray(text) ? text : parsePastedText(text)).map((e) => typeof e === "string" ? e : e?.string).filter((s) => typeof s === "string" && s.trim() !== "");
      if (!list.length) return Promise.resolve([]);
      return api.txn((t) => {
        const made = capBulk(stackAt(list, x, y), api.emit).map((c) => placeCard(t, c.string, c.x, c.y));
        api.applyFit(t, made);
        return made;
      }).then((made) => made ?? []);
    },
    // Adds ref cards for the items to the right of the target board's content. Resolves {added, title} or null.
    sendToBoard(uids, targetUid) {
      const board = api.board();
      if (!board || !targetUid || targetUid === session.uid) return Promise.resolve(null);
      const top = topLevelOf(board, uids ?? []).filter((id) => id !== targetUid);
      if (!top.length) return Promise.resolve(null);
      const node = api.rawNode(targetUid);
      if (node) {
        if (!isEnhancedBoardNode(node)) return Promise.resolve(null);
        const origin2 = outlineOrigin(boardPreview({ uid: targetUid, string: node[STR2], content: node[KIDS2] ?? [] }));
        const title = parseBoardTitle(node[STR2]) || UNTITLED_BOARD;
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
    // The source card's child blocks become a mind map of ref cards (blocks stay canonical in Roam) plus one
    // connection per parent -> child. Children that already have a card on this board are reused, not moved.
    expandOutline(cardUid, { direction = "right", max = 24 } = {}) {
      const none = { added: 0, edges: 0 };
      const board = api.board();
      const item = board?.items.get(cardUid);
      if (!item || item.type !== "card") return Promise.resolve(none);
      const plain = (list) => list.filter((n) => n?.uid).map((n) => ({ uid: n.uid, children: plain(n.children ?? []) }));
      const rawTree = (list) => list.filter((n) => n?.[UID2]).map((n) => ({ uid: n[UID2], children: rawTree(api.kidsOf(n)) }));
      let tree;
      if (item.kind === "note") tree = rawTree(api.kidsOf({ [KIDS2]: item.content }));
      else if (item.kind === "block") tree = plain(host.pullTree(item.target.uid, OUTLINE_DEPTH, max) ?? []);
      else if (item.kind === "page") tree = plain(host.pagePreview(item.target.title, OUTLINE_DEPTH, max)?.blocks ?? []);
      else return Promise.resolve(none);
      const flat = [];
      const walk = (list, depth, parent) => {
        for (const n of list) {
          if (depth > OUTLINE_DEPTH || flat.some((f) => f.uid === n.uid)) continue;
          const entry = { uid: n.uid, depth, parent, at: flat.length };
          flat.push(entry);
          walk(n.children, depth + 1, n.uid);
        }
      };
      walk(tree, 1, null);
      const chosen = new Set([...flat].sort((a, b) => a.depth - b.depth || a.at - b.at).slice(0, Math.max(0, max)).map((f) => f.uid));
      const picked = flat.filter((f) => chosen.has(f.uid));
      if (!picked.length) return Promise.resolve(none);
      const rects = api.rects();
      const own = rects.get(cardUid);
      const onBoard = /* @__PURE__ */ new Map();
      for (const it of board.items.values()) {
        if (it.uid !== cardUid && it.kind === "block" && !onBoard.has(it.target.uid)) onBoard.set(it.target.uid, it.uid);
      }
      const nodes = new Map(picked.map((f) => {
        const have = onBoard.get(f.uid);
        const r = have ? rects.get(have) : null;
        return [f.uid, { uid: f.uid, w: r?.w ?? OUTLINE_CARD.w, h: r?.h ?? OUTLINE_CARD.h, children: [] }];
      }));
      const root = { uid: cardUid, w: own.w, h: own.h, children: [] };
      for (const f of picked) (f.parent && nodes.has(f.parent) ? nodes.get(f.parent) : root).children.push(nodes.get(f.uid));
      const layout = mindMapLayout(root, { direction: OUTLINE_DIRECTIONS.includes(direction) ? direction : "right" });
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
          shift.set(f.uid, inherited);
          const id = placeCard(t, `((${f.uid}))`, own.x + p.x + inherited.dx, own.y + p.y + inherited.dy, OUTLINE_CARD);
          cardOf.set(f.uid, id);
          refOfCard.set(id, `((${f.uid}))`);
          created.push(id);
        }
        let edges = 0;
        let container = null;
        for (const f of picked) {
          const from = f.parent && cardOf.has(f.parent) ? cardOf.get(f.parent) : cardUid;
          const to = cardOf.get(f.uid);
          if (from === to || findEdge(board, from, to)) continue;
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
    node(node, parent = globalThis.document?.body) {
      if (!parent) throw new Error("A parent node is required outside the browser");
      parent.append(node);
      add(() => node.remove());
      return node;
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
  version: "1.3.0",
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
var n1 = (n) => Math.round(n * 10) / 10;
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
  const board = String(boardTitle2 ?? "").trim();
  const page = String(pageTitle ?? "").trim();
  const named = board && board.toLowerCase() !== UNTITLED_BOARD.toLowerCase();
  const raw = (named ? board : page) || board || "board";
  const name = raw.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "board";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : "1970-01-01";
  return `${name} ${day}.png`;
}
function sliceBoard(board, uids) {
  const want = new Set(uids || []);
  const items = /* @__PURE__ */ new Map();
  const order = [];
  for (const uid of board?.order || []) {
    if (!want.has(uid)) continue;
    const item = board.items.get(uid);
    if (!item) continue;
    items.set(uid, item);
    order.push(uid);
  }
  const edges = /* @__PURE__ */ new Map();
  for (const [uid, edge] of board?.edges || []) {
    if (edge?.valid && want.has(edge.from) && want.has(edge.to)) edges.set(uid, edge);
  }
  return { ...board, items, order, edges };
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
function boardToSvg(board, rects, { dark = false, padding = 48, maxItems = 500, imageHrefs = null } = {}) {
  const mode = dark ? "dark" : "light";
  const theme = THEME[mode];
  const hex = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/.test(color) ? [color, color, color] : HEX[mode][PALETTE.includes(color) ? color : "gray"];
  const included = [];
  for (const uid of board.order) {
    if (included.length >= maxItems) break;
    if (rects.get(uid)) included.push(board.items.get(uid));
  }
  const inSet = new Set(included.map((i) => i.uid));
  const bounds = boundsOf(included.map((i) => rects.get(i.uid))) ?? { x: 0, y: 0, w: 0, h: 0 };
  const vx = bounds.x - padding;
  const vy = bounds.y - padding;
  const vw = Math.max(1, bounds.w + padding * 2);
  const vh = Math.max(1, bounds.h + padding * 2);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(vx)} ${n1(vy)} ${n1(vw)} ${n1(vh)}" width="${n1(vw)}" height="${n1(vh)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
  out.push(`<title>${esc(board.title || "Board")}</title>`);
  out.push(`<rect x="${n1(vx)}" y="${n1(vy)}" width="${n1(vw)}" height="${n1(vh)}" fill="${theme.bg}"/>`);
  const defs = [];
  const body = [];
  included.forEach((item, index) => {
    const r = rects.get(item.uid);
    const [line, fill, text] = hex(item.color);
    if (item.type === "section") {
      body.push(`<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${n1(r.w)}" height="${n1(r.h)}" rx="12" fill="${fill}" fill-opacity="${dark ? 0.6 : 1}" stroke="${line}" stroke-width="2"/>`);
      body.push(`<text x="${n1(r.x + 4)}" y="${n1(r.y - 10)}" font-size="16" font-weight="700" fill="${text}">${esc(titleOf(item))}</text>`);
    } else if (item.type === "text") {
      const size = item.fontSize || 16;
      body.push(`<text x="${n1(r.x)}" y="${n1(r.y + size)}" font-size="${size}" fill="${theme.text}">${esc(titleOf(item))}</text>`);
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
  for (const edge of board.edges.values()) {
    if (!edge.valid || !inSet.has(edge.from) || !inSet.has(edge.to)) continue;
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    const path = edgePath({ a, b, fromSide: edge.fromSide, toSide: edge.toSide, route: edge.route });
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
function boardToMarkdown(board, rects) {
  const lines = [];
  const readingOrder = (uids) => uids.map((uid, i) => ({ uid, i, r: rects.get(uid) })).sort((a, b) => (a.r?.y ?? 0) - (b.r?.y ?? 0) || (a.r?.x ?? 0) - (b.r?.x ?? 0) || a.i - b.i).map((e) => e.uid);
  const content = (children, depth) => {
    for (const c of children ?? []) {
      const s = oneLine(c[":block/string"]);
      if (s) lines.push(`${"  ".repeat(depth)}- ${s}`);
      content(c[":block/children"], depth + 1);
    }
  };
  const walk = (uids) => {
    for (const uid of readingOrder(uids)) {
      const item = board.items.get(uid);
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
  walk(board.roots);
  const edges = [...board.edges.values()].filter((e) => e.valid);
  if (edges.length) {
    if (lines.length) lines.push("");
    lines.push("## Connections");
    for (const e of edges) {
      const a = oneLine(titleOf(board.items.get(e.from)));
      const b = oneLine(titleOf(board.items.get(e.to)));
      lines.push(e.label ? `${a} -> ${e.label} -> ${b}` : `${a} -> ${b}`);
    }
  }
  return `${lines.join("\n")}
`;
}

// src/view/interactions.js
var TOOL_KEYS = { v: "select", h: "hand", n: "card", t: "text", g: "section", w: "board", c: "connect" };
var TOOLS = ["select", "hand", "card", "text", "section", "board", "connect"];
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
  const board = () => call("board");
  const rects = () => call("rects");
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
    call("showGuides", []);
    call("showTempWire", null);
    call("onHover", null);
    call("showGhosts", null);
    call("cancelPreview");
    call("setGesturing", false, { moved });
  };
  const isPinned = (uid) => Boolean(board()?.items.get(uid)?.pinned);
  const movingSet = (dup = false) => {
    const b = board();
    if (!b) return [];
    const uids = dup ? [...state.selection] : [...state.selection].filter((u) => !isPinned(u));
    return topLevelOf(b, uids);
  };
  const movingBounds = (uids) => {
    const r = rects();
    return boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
  };
  const otherRects = (uids) => {
    const b = board();
    const r = rects();
    const skip = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(b, u)) skip.add(d);
    const out = [];
    for (const uid of b.items.keys()) if (!skip.has(uid) && r.get(uid)) out.push(r.get(uid));
    return out;
  };
  const editingUid = () => call("editingUid") ?? null;
  const isEditing = () => Boolean(call("isEditing"));
  const beginConnect = (uid, side, world) => {
    begin({ kind: "connect", from: uid, fromSide: side, start: world });
    call("showTempWire", { from: uid, fromSide: side, point: world });
  };
  const onPointerDown = (ev) => {
    const t = ev.target || { kind: "empty" };
    if (t.kind === "chrome") return;
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
    const b = board();
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
        const multi = !dup && (ev.shift || ev.meta || ev.ctrl);
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
        begin({ kind: "move", uids, dup, multi, asRef: dup && Boolean(ev.shift), start: ev.screen, target: t.uid, deferred, bounds: movingBounds(uids), others: setting("snap-guides", true) ? otherRects(uids) : [] });
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
    if (state.tool === "card" || state.tool === "text") {
      begin({ kind: "place", tool: state.tool, start: ev.world });
      return;
    }
    begin({ kind: "marquee", start: ev.world, base: ev.shift ? new Set(state.selection) : /* @__PURE__ */ new Set(), shift: ev.shift });
  };
  const onPointerMove = (ev) => {
    const g = state.gesture;
    if (!g) return;
    if (g.kind === "connect") {
      const b = board();
      const r = rects();
      call("showTempWire", { from: g.from, fromSide: g.fromSide, point: ev.world });
      const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
      const hover = hit && hit.uid !== g.from ? hit.uid : null;
      if (hover !== state.hover) {
        state.hover = hover;
        call("onHover", hover);
      }
      if (!g.moved && Math.hypot(ev.world.x - g.start.x, ev.world.y - g.start.y) * zoom() >= DRAG_THRESHOLD_PX) g.moved = true;
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
      if (g.bounds && g.others.length) {
        const moving = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
        const snap = snapMove(moving, g.others, SNAP_PX / z);
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
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
      const b = board();
      const r = rects();
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
    if (g.kind === "marquee") {
      const rect = normRect(g.start, ev.world);
      g.rect = rect;
      call("showMarquee", rect, "select");
      const b = board();
      const r = rects();
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
      const b = board();
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
    const b = board();
    const r = rects();
    switch (g.kind) {
      case "pan":
        break;
      case "marquee":
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
          const d = DEFAULT_SIZES[g.tool];
          const at = { x: g.start.x - d.w / 2, y: g.start.y - d.h / 2 };
          end();
          const p = g.tool === "text" ? call("createText", at) : call("createCard", at);
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
        } else if (!g.dup && !g.multi && state.selection.size === 1 && state.selection.has(g.target)) {
          const item = b?.items.get(g.target);
          if (item?.type === "card" && item.look === "block" && item.kind !== "board") call("enterEdit", g.target);
        }
        break;
      case "resize":
        if (g.moved && g.rect) call("commitRects", [g.rect]);
        break;
      case "connect": {
        const hit = b && r ? hitTest(b, ev.world, r, { sectionInterior: true }) : null;
        end();
        if (hit && hit.uid === g.from) {
          selectItems([g.from]);
        } else if (hit) {
          const existing = findEdge(b, g.from, hit.uid);
          if (existing) {
            selectEdge(existing.uid);
          } else {
            const toSide = nearestSide(r.get(hit.uid), ev.world);
            Promise.resolve(call("addEdge", { from: g.from, to: hit.uid, fromSide: g.fromSide, toSide })).then((uid) => {
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
    const b = board();
    if (t.kind === "item" && t.uid) {
      const item = b?.items.get(t.uid);
      if (!item) return;
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
    const b = board();
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
    call("setViewport", zoomAt(vp(), { x: s.width / 2, y: s.height / 2 }, factor));
  };
  const zoomTo = (z) => {
    const s = call("size") || { width: 0, height: 0 };
    const v = vp();
    call("setViewport", zoomAt(v, { x: s.width / 2, y: s.height / 2 }, z / (v.zoom || 1)));
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
    const b = board();
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
    const b = board();
    const r = rects();
    const from = lastSelected();
    if (!b || !r || !from || !b.items.has(from)) return;
    const parent = b.items.get(from).parentUid;
    const candidates = [];
    for (const [uid, item] of b.items) if (item.parentUid === parent && (uid === from || !state.selection.has(uid))) candidates.push(uid);
    const next = nearestInDirection(r, from, dir, { candidates });
    if (!next) return;
    selectItems(add ? [...state.selection, next] : [next]);
  };
  const selectOutline = (back) => {
    const b = board();
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
      if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || ev.code === "Space" || key === " ") {
        call("presentNext");
        return true;
      }
      if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") {
        call("presentPrev");
        return true;
      }
    }
    if (ev.code === "Space" || key === " ") {
      if (!state.space) {
        state.space = true;
        call("setSpace", true);
      }
      return true;
    }
    if (key === "Escape") return escape();
    if (setting("enable-shortcuts", true) === false) return false;
    const b = board();
    if (mod) {
      const k = key.toLowerCase();
      if (k === "a") {
        if (b) selectItems([...b.items.keys()]);
        return true;
      }
      if (k === "g") {
        if (state.selection.size) call("wrapInSection", [...state.selection]);
        return true;
      }
      if (k === "d" && !ev.alt) {
        if (!state.selection.size) return false;
        call("duplicateItems", [...state.selection], { dx: 24, dy: 24, asRef: false });
        return true;
      }
      if (k === "enter" && ev.alt) {
        call("foldSelection");
        return true;
      }
      if (k === "z") {
        if (ev.shift) call("redo");
        else call("undo");
        return true;
      }
      if (k === "=" || k === "+") {
        zoomBy(1.2);
        return true;
      }
      if (k === "-" || k === "_") {
        zoomBy(1 / 1.2);
        return true;
      }
      return false;
    }
    if (ev.shift) {
      if (ev.code === "Digit1" || key === "!") {
        call("fitAll");
        return true;
      }
      if (ev.code === "Digit2" || key === "@") {
        if (state.selection.size) call("fitSelection", [...state.selection]);
        return true;
      }
      if (ev.code === "Digit0" || key === ")") {
        zoomTo(1);
        return true;
      }
    }
    if (key === "Delete" || key === "Backspace") return deleteSelection(ev.shift);
    if (key === "Enter") {
      if (state.selection.size === 1) {
        const uid = [...state.selection][0];
        const item = b?.items.get(uid);
        if (item?.kind === "board" || item && call("isBoardCard", uid)) call("openBoard", uid);
        else if (item?.type === "section") call("renameSection", uid);
        else call("enterEdit", uid);
        return true;
      }
      return false;
    }
    if (key.startsWith("Arrow")) {
      if (!state.selection.size) return false;
      if (ev.alt) {
        const dir = key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : null;
        if (dir) selectNearest(dir, ev.shift);
        return true;
      }
      const step = ev.shift ? 10 : 1;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      const uids = movingSet();
      if (uids.length) call("commitMove", uids, dx, dy);
      return true;
    }
    if (key === "Tab" && !ev.alt) return ev.tabOwned === false ? false : selectOutline(ev.shift);
    if (ev.alt) return false;
    const lower = key.toLowerCase();
    if (TOOL_KEYS[lower]) {
      setTool(TOOL_KEYS[lower]);
      return true;
    }
    if (lower === "l") {
      call("cycleLinks");
      return true;
    }
    if (key === "/") {
      call("openSearch");
      return true;
    }
    if (lower === "f") {
      call("toggleFocus");
      return true;
    }
    if (lower === "q") {
      call("quickLook");
      return true;
    }
    if (lower === "p") {
      call("present");
      return true;
    }
    if (lower === "m") {
      if (state.selection.size !== 1) return false;
      const uid = lastSelected();
      const item = b?.items.get(uid);
      if (!item || item.type !== "card" || item.kind === "board") return false;
      call("expandOutline", uid);
      return true;
    }
    return false;
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
    cancel: onPointerCancel,
    // Model changed under us: drop selection entries that no longer exist.
    reconcile() {
      const b = board();
      if (!b) return;
      let changed = false;
      for (const u of [...state.selection]) if (!b.items.has(u)) {
        state.selection.delete(u);
        changed = true;
      }
      if (state.edge && !b.edges.has(state.edge)) {
        state.edge = null;
        changed = true;
      }
      if (changed) emitSelection();
    }
  };
}

// src/view/cards.js
var SIDES3 = ["top", "right", "bottom", "left"];
var CHUNK_MS = 8;
var LRU_CAP = 80;
var UNMOUNT_AFTER_MS = 4e3;
var HYDRATE_CAP_MS = 900;
var CONTENT_LIMIT = 12;
var CONTENT_DEPTH = 2;
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
var childString = (c) => c?.[":block/string"] ?? c?.string ?? "";
var childKids = (c) => c?.[":block/children"] ?? c?.children ?? [];
var childUid = (c) => c?.[":block/uid"] ?? c?.uid ?? "";
var childProps = (c) => c?.[":block/props"] ?? c?.props;
function contentKeyOf(item) {
  const parts = [
    item.kind,
    item.enhanced ? "e" : "",
    item.string,
    item.collapsed ? "c" : "",
    item.open === false ? "x" : "",
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
        parts.push(childUid(c), childString(c), JSON.stringify(childProps(c) ?? null));
        walkBoard(childKids(c), depth + 1);
      }
    };
    walkBoard(item.content || [], 1);
    return parts.join("");
  }
  const walk = (kids, depth) => {
    if (depth > CONTENT_DEPTH) return;
    for (const c of kids) {
      parts.push(childString(c));
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
  onBadgeClick
} = {}) {
  const shells = /* @__PURE__ */ new Map();
  const mounted = /* @__PURE__ */ new Map();
  let lod = "detail";
  let focusSet = null;
  let badgeMap = /* @__PURE__ */ new Map();
  let showBadges = false;
  let zoomCache = 1;
  let paused = false;
  let editing = null;
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
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };
  const EMBED_SEL = "iframe, video, .rm-pdf-highlight, .rm-pdf-container, .twitter-tweet, .rm-xparser-default-tweet";
  const embedLive = (node) => {
    for (const child of node.children || []) if (child.classList?.contains("pxd-rs__live")) return child;
    return node;
  };
  const armEmbedShield = (node, live) => {
    const syncShield = () => {
      const hit = live.querySelector?.(EMBED_SEL);
      let shield = null;
      for (const child of node.children || []) if (child.classList?.contains("pxd-embed-shield")) shield = child;
      if (hit && !shield) {
        const cover = el("div", "pxd-embed-shield", node);
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
    node.__pxdEmbedMo = mo;
  };
  const renderRoot = (parent, string, cls = "pxd-rs") => {
    const node = el("div", cls, parent);
    if (!string) return node;
    const live = el("div", "pxd-rs__live", node);
    try {
      if (host?.renderString) host.renderString(live, string);
      else live.textContent = plainText(string);
    } catch {
      live.textContent = plainText(string);
    }
    armEmbedShield(node, live);
    return node;
  };
  const unmountRoots = (rec) => {
    if (!rec.roots?.length) return;
    for (const node of rec.roots) {
      try {
        node.__pxdEmbedMo?.disconnect();
      } catch {
      }
      try {
        host?.unmount?.(embedLive(node));
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
      const node = el("div", "pxd-section", null);
      rec.el = node;
      rec.title = el("div", "pxd-section__title", node);
      for (const side of ["t", "r", "b", "l"]) el("div", `pxd-section__edge pxd-section__edge--${side}`, node);
      buildGrips(node);
      buildPorts(node);
    } else {
      const node = el("div", `pxd-item pxd-item--${item.type}`, null);
      rec.el = node;
      rec.header = el("div", "pxd-item__header", node);
      rec.body = el("div", "pxd-item__body", node);
      buildPorts(node);
      buildGrips(node);
    }
    rec.el.dataset.uid = item.uid;
    rec.el.setAttribute("data-uid", item.uid);
    shells.set(item.uid, rec);
    return rec;
  };
  const setVar = (el2, name, value) => {
    if (value) el2.style.setProperty(name, value);
    else el2.style.removeProperty(name);
  };
  const applyStyle = (rec, item) => {
    const node = rec.el;
    if (item.type === "section") {
      const d = item.sectionDefaults || {};
      const area = item.areaFill ?? d.areaFill;
      const border = item.border ?? d.border;
      const titleSize = item.titleSize ?? d.titleSize;
      const titleColor = item.titleColor ?? d.titleColor;
      const titleFill = item.titleFill ?? d.titleFill;
      setVar(node, "--pxd-fill", cssColor(area, "fill"));
      setVar(node, "--pxd-line", cssColor(border, "line") || hexColor(item.color) || "");
      if (rec.title) {
        rec.title.style.fontSize = titleSize ? `${titleSize}px` : "";
        rec.title.style.color = cssColor(titleColor, "text") || "";
        rec.title.style.background = cssColor(titleFill, "fill") || "";
      }
      return;
    }
    const accent = hexColor(item.color);
    setVar(node, "--pxd-card-fs", item.fontSize ? `${item.fontSize}px` : "");
    setVar(node, "--pxd-text-fs", item.type === "text" && item.fontSize ? `${item.fontSize}px` : "");
    setVar(node, "--pxd-text-c", cssColor(item.textColor, "text") || accent || "");
    setVar(node, "--pxd-fill", cssColor(item.fill, "fill") || accent || "");
    setVar(node, "--pxd-line", cssColor(item.border, "line") || accent || "");
    node.style.textAlign = item.align || "";
  };
  const paintShell = (rec, item) => {
    const node = rec.el;
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
    if (item.collapsed) cls.push("pxd-item--collapsed");
    if (!item.string?.trim()) cls.push("pxd-item--empty");
    if (item.type === "text" && FONT_SIZES.includes(item.fontSize)) cls.push(`pxd-item--fs${item.fontSize}`);
    if (item.type !== "section" && item.fontSize) cls.push("pxd-fs");
    if (item.textColor) cls.push("pxd-has-textc");
    if (item.type === "text" && (item.fill || item.border)) cls.push("pxd-text-paint");
    if (rec.selected) cls.push(item.type === "section" ? "pxd-section--selected" : "pxd-item--selected");
    if (rec.hover) cls.push("pxd-item--drop");
    if (editing?.uid === item.uid) cls.push("pxd-item--editing");
    if (item.pinned) cls.push(item.type === "section" ? "pxd-section--pinned" : "pxd-item--pinned");
    if (focusSet && !focusSet.has(item.uid)) cls.push(item.type === "section" ? "pxd-section--focus-dim" : "pxd-item--focus-dim");
    if (item.type !== "section") {
      if (rec.bare) cls.push("pxd-item--bare");
      if (rec.refBoard) cls.push("pxd-item--wb");
      if (item.look === "block") cls.push("pxd-card--block");
    }
    node.className = cls.join(" ");
    applyStyle(rec, item);
    if (item.type === "section") {
      if (!rec.titleRendered || rec.titleString !== item.string) {
        rec.title.textContent = item.title || "Section";
        rec.titleString = item.string;
        rec.titleRendered = false;
      }
    } else {
      if (editing?.uid !== item.uid && !rec.renaming) rec.header.textContent = item.type === "text" ? "" : String(rec.refTitle || item.title || "").slice(0, HEADER_TEXT_MAX);
      if (item.type === "text") rec.header.style.display = "none";
      rec.header.classList.toggle("pxd-item__header--muted", item.kind === "board" && isUntitledBoard(item.title));
    }
    node.title = "";
  };
  const position = (rec, rect) => {
    const prev = rec.rect;
    rec.rect = rect;
    if (editing?.uid === rec.uid && prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
    rec.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    rec.el.style.width = `${rect.w}px`;
    rec.el.style.height = `${rect.h}px`;
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
  const sync = ({ board, rects, dirty = null, structural = false }) => {
    lastBoard = board;
    lastRects = rects;
    for (const uid of [...shells.keys()]) if (!board.items.has(uid)) removeShell(uid);
    let orderChanged = structural;
    for (const uid of board.order) {
      const item = board.items.get(uid);
      let rec = shells.get(uid);
      const fresh = !rec;
      if (!rec) {
        rec = buildShell(item);
        orderChanged = true;
      }
      const rect = rects.get(uid);
      if (fresh || !dirty || dirty.has(uid)) {
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
      } else if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) {
        position(rec, rect);
      }
    }
    if (orderChanged) {
      for (const uid of board.order) {
        const rec = shells.get(uid);
        const layer = rec.type === "section" ? sectionsLayer : itemsLayer;
        if (rec.el.parentElement !== layer || layer.lastChild !== rec.el) layer.append(rec.el);
      }
    }
  };
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks) {
      if (budget.n >= CONTENT_LIMIT) return;
      budget.n += 1;
      const row = el("div", "pxd-block", parent);
      row.dataset.uid = childUid(b);
      const s = childString(b);
      const node = renderRoot(row, s, "pxd-rs pxd-block__text");
      budget.roots.push(node);
      const kids = childKids(b);
      if (kids.length && depth < CONTENT_DEPTH) {
        const wrap = el("div", "pxd-block__children", row);
        renderBlocks(wrap, kids, depth + 1, budget);
      }
    }
  };
  const openBoard = (uid) => {
    if (onOpenBoard) onOpenBoard(uid);
    else host?.openBlock?.(uid);
  };
  const commitBoardName = (uid, name) => (onRenameBoard || ((u, n) => session?.renameBoard?.(u, n)))(uid, name);
  const mountBoardBody = (body, item, { openUid = item.uid } = {}) => {
    const innerW = Math.max(1, (Number(item.w) || 0) - 24);
    const preview = boardPreview(item, { aspect: innerW / Math.max(40, (Number(item.h) || 0) - HEADER_H - META_H) });
    const wrap = el("div", "pxd-item__board", body);
    const holder = el("div", "pxd-board-preview", wrap);
    if (preview.empty) {
      el("div", "pxd-board-preview__empty", holder).textContent = "Empty board";
    } else {
      const canvas = el("div", "pxd-board-preview__canvas", holder);
      const pct = (n) => `${Math.round(n * 1e4) / 100}%`;
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
          const text = host?.blockString?.(r.ref);
          if (typeof text === "string") title = firstLine(text).slice(0, REF_TITLE_MAX);
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
    open.dataset.action = "open";
    for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stopEvent);
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      openBoard(openUid);
    });
  };
  const mountContent = (rec, item) => {
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
      budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__text"));
    } else if (item.kind === "image") {
      budget.roots.push(renderRoot(el("div", "pxd-item__media", body), item.string));
    } else if (item.kind === "board") {
      mountBoardBody(body, item);
    } else if (item.kind === "page") {
      if (item.open === false) {
        rec.roots = [];
        rec.contentKey = contentKeyOf(item);
        return;
      }
      const holder = el("div", "pxd-item__page", body);
      const preview = host?.pagePreview?.(item.title, CONTENT_DEPTH, CONTENT_LIMIT);
      const apply = (p, sync2 = false) => {
        if (disposed || !holder.parentElement || !sync2 && rec.contentKey !== contentKeyOf(item)) return;
        if (!p?.exists) {
          el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
          return;
        }
        const b = { n: 0, roots: [] };
        renderBlocks(holder, p.blocks || [], 1, b);
        budget.roots.push(...b.roots);
      };
      if (preview && typeof preview.then === "function") preview.then((p) => apply(p)).catch(() => {
      });
      else apply(preview, true);
    } else if (item.kind === "block") {
      const ref = item.target.uid;
      const refString = host?.blockString?.(ref);
      const isBoardRef = typeof refString === "string" && classifyString(refString).kind === "board";
      if (isBoardRef) rec.refTitle = parseBoardTitle(refString) || "Untitled board";
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
      } else {
        if (typeof refString === "string" && refString.trim()) budget.roots.push(renderRoot(body, refString, "pxd-rs pxd-item__string"));
        if (item.open === false) {
          rec.roots = budget.roots;
          rec.contentKey = contentKeyOf(item);
          return;
        }
        const tree = host?.pullTree?.(ref, CONTENT_DEPTH, CONTENT_LIMIT);
        const apply = (blocks, sync2 = false) => {
          if (disposed || !body.isConnected || !sync2 && rec.contentKey !== contentKeyOf(item)) return;
          if (!refString?.trim() && !blocks?.length) el("div", "pxd-item__placeholder", body).textContent = "Empty card";
          const b = { n: 0, roots: [] };
          renderBlocks(body, blocks || [], 1, b);
          budget.roots.push(...b.roots);
        };
        if (tree && typeof tree.then === "function") tree.then((t) => apply(t)).catch(() => {
        });
        else apply(tree, true);
      }
    } else {
      if (item.string?.trim()) budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__string"));
      if (item.open !== false) renderBlocks(body, item.content || [], 1, budget);
      if (!item.string?.trim() && !(item.content || []).length) {
        el("div", "pxd-item__placeholder", body).textContent = "Empty card";
      }
    }
    rec.roots = budget.roots;
    rec.contentKey = contentKeyOf(item);
  };
  const mountSectionTitle = (rec, item) => {
    unmountRoots(rec);
    rec.title.replaceChildren();
    const node = renderRoot(rec.title, item.string || "Section", "pxd-rs pxd-section__title-text");
    if (!item.string) node.textContent = "Section";
    rec.roots = [node];
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
      if (rec.type === "card") {
        rec.bare = true;
        rec.el.classList.add("pxd-item--bare");
      }
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
  const scheduleContent = ({ visibleRect, zoom = zoomCache, tier = null }) => {
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
  const setPaused = (on) => {
    paused = Boolean(on);
    if (paused && idleHandle) {
      idleHandle();
      idleHandle = null;
    }
    if (!paused && queue.length && !idleHandle) idleHandle = idle(pump);
  };
  const setLod = (nextLod, zoom) => {
    const prev = lod;
    lod = nextLod === "map" || nextLod === "overview" ? nextLod : "detail";
    zoomCache = zoom;
    if (showBadges && prev === "detail" !== (lod === "detail")) for (const rec of shells.values()) renderBadges(rec);
  };
  const previewMove = (uids, dx, dy, board, rects) => {
    const set = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(board, u)) set.add(d);
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
    for (const c of item.content || []) lines.push(...String(childString(c)).split("\n"));
    const out = [];
    for (const line of lines) {
      if (out.length >= ATTR_CHIPS_MAX) break;
      const name = attrNameOf(line);
      if (!name) continue;
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
    for (const text of attrChipsOf(rec, item)) chips.push({ cls: "attr", text });
    if (!chips.length) return clear();
    const key = JSON.stringify(chips);
    if (rec.badgeEl && rec.badgeKey === key) return;
    clear();
    const row = el("div", "pxd-item__badges", rec.el);
    for (const chip of chips) {
      const node = el(chip.action ? "button" : "span", `pxd-badge-chip pxd-badge-chip--${chip.cls}`, row);
      node.textContent = chip.text;
      if (chip.title) node.title = chip.title;
      if (chip.action) {
        node.type = "button";
        for (const type of ["pointerdown", "mousedown", "dblclick"]) node.addEventListener(type, stopEvent);
        node.addEventListener("click", (event) => {
          event.stopPropagation();
          onBadgeClick?.(rec.uid, chip.action);
        });
      }
    }
    rec.badgeEl = row;
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
    const set = new Set(uids);
    for (const [uid, rec] of shells) {
      const on = set.has(uid);
      if (rec.selected === on) continue;
      rec.selected = on;
      rec.el.classList.toggle(rec.type === "section" ? "pxd-section--selected" : "pxd-item--selected", on);
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
    const ta = [...list].reverse().find((n) => String(n.id || "").startsWith("block-input-")) || list[list.length - 1];
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
  const boxHeight = (node) => {
    const h = Number(node?.offsetHeight) || 0;
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
  const enterEdit = async (uid) => {
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
    const ghost = el("div", "pxd-item__ghost");
    ghost.setAttribute("aria-hidden", "true");
    for (const node of [...rec.body.children || []]) ghost.append(node);
    rec.body.append(ghost);
    rec.ghost = ghost;
    rec.contentKey = null;
    mounted.delete(uid);
    const editor = el("div", "pxd-item__editor", rec.body);
    for (const type of EDITOR_STOPPED) editor.addEventListener(type, stopEvent);
    editing = { uid, rec, editor, targetUid, item, ready: false, fadeCancel: null, releaseCancel: null };
    rec.el.classList.add("pxd-item--editing");
    renderBadges(rec);
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
    const input = editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea");
    if (input) focusRoamInput(input);
    if (editing?.uid === uid && editor.contains?.(doc.activeElement)) editing.ready = true;
    return true;
  };
  const exitEdit = async ({ silent = false } = {}) => {
    const e = editing;
    if (!e) return;
    editing = null;
    clearEditFade(e);
    detachFocusGuard();
    const { rec, editor, uid, item } = e;
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
  const dispose = () => {
    disposed = true;
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
      rec.el.remove();
    }
    shells.clear();
    mounted.clear();
    queue = [];
  };
  return {
    sync,
    scheduleContent,
    setPaused,
    setLod,
    previewMove,
    previewRects,
    previewSectionRects,
    resetRects,
    measureContent,
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
    shellOf: (uid) => shells.get(uid)?.el ?? null,
    mountedCount: () => mounted.size,
    mountedUids: () => [...mounted.keys()],
    shellCount: () => shells.size,
    lod: () => lod,
    dispose
  };
}

// src/view/edges.js
var SVG_NS2 = "http://www.w3.org/2000/svg";
var PAIR_OFFSET = 18;
var LABEL_HIDE_ZOOM = 0.3;
var setClass = (el, name) => {
  el.setAttribute("class", name);
  if (el.classList && !el.classList.contains(name.split(" ")[0])) el.className = name;
};
function createEdgeLayer({ doc = globalThis.document, svg, labelsLayer, overlaySvg, onLabelCommit } = {}) {
  const edgeEls = /* @__PURE__ */ new Map();
  const linkEls = /* @__PURE__ */ new Map();
  let wire = null;
  let marquee = null;
  const guideEls = [];
  const ghostEls = [];
  let focusSet = null;
  let zoomCache = 1;
  let editingLabel = null;
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
  const pairOffset = (board, edge) => {
    for (const other of board.edges.values()) {
      if (other.uid !== edge.uid && other.from === edge.to && other.to === edge.from) {
        return edge.uid < other.uid ? PAIR_OFFSET : -PAIR_OFFSET;
      }
    }
    return 0;
  };
  const geometryFor = (board, edge, rects) => {
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    if (!a || !b) return null;
    return edgePath({ a, b, fromSide: edge.fromSide, toSide: edge.toSide, route: edge.route, offset: pairOffset(board, edge) });
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
  const dimmed = (e) => Boolean(focusSet) && !(focusSet.has(e.from) && focusSet.has(e.to));
  const paintEdge = (board, edge, rec, { covered, selected }) => {
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
    const dim = dimmed(edge);
    if (dim) cls.push("pxd-edge--dim");
    setClass(rec.g, cls.join(" "));
    if (hex) rec.g.style.setProperty("--pxd-line", hex);
    else rec.g.style.removeProperty("--pxd-line");
    rec.label.className = `pxd-label${named ? ` pxd-c-${edge.color}` : ""}${edge.label ? "" : " pxd-label--empty"}${selected ? " pxd-label--selected" : ""}${dim ? " pxd-label--dim" : ""}`;
    rec.label.style.color = hex || "";
    if (editingLabel?.uid !== edge.uid) rec.label.textContent = edge.label || "";
    rec.dir = edge.dir;
    rec.weight = edge.weight;
  };
  const placeEdge = (board, edge, rec, rects, zoom) => {
    const geo = geometryFor(board, edge, rects);
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
    setClass(rec.g, `pxd-link pxd-c-${link.color || "gray"}${selected ? " pxd-link--selected" : ""}${dim ? " pxd-edge--dim" : ""}`);
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
  const render = ({ board, rects, links = [], coveredEdges = /* @__PURE__ */ new Set(), selection = {}, zoom = 1, dirty = null }) => {
    zoomCache = zoom;
    for (const uid of [...edgeEls.keys()]) if (!board.edges.has(uid)) removeEdge(uid);
    for (const edge of board.edges.values()) {
      let rec = edgeEls.get(edge.uid);
      const fresh = !rec;
      if (!rec) rec = buildEdge(edge);
      if (fresh || !dirty || dirty.has(edge.uid)) {
        paintEdge(board, edge, rec, { covered: coveredEdges.has(edge.uid), selected: selection.edge === edge.uid });
        placeEdge(board, edge, rec, rects, zoom);
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
  const update = ({ board, edgeUids, rects, zoom = zoomCache, linkKeys = null, links = [] }) => {
    for (const uid of edgeUids) {
      const edge = board.edges.get(uid);
      const rec = edgeEls.get(uid);
      if (edge && rec) placeEdge(board, edge, rec, rects, zoom);
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
  const setFocus = (set) => {
    focusSet = set && set.size !== void 0 ? set : null;
    for (const rec of [...edgeEls.values(), ...linkEls.values()]) {
      const dim = dimmed(rec);
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
    setGhosts(null);
    focusSet = null;
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
    setGhosts,
    setFocus,
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

// src/view/color-picker.js
var DARKER = -0.28;
var LIGHTER = 0.4;
function buildColorPicker(doc, onPick, listen) {
  const box = doc.createElement("div");
  box.className = "pxd-picker";
  const on = (node, type, fn) => {
    if (listen) listen(node, type, fn);
    else node.addEventListener(type, fn);
  };
  const stop = (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  const row = (label, colors, named) => {
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
      b.setAttribute("data-color", color);
      if (!named) b.style.background = color;
      on(b, "click", (event) => {
        stop(event);
        onPick?.(color);
      });
      swatches.append(b);
    }
    wrap.append(swatches);
    box.append(wrap);
  };
  row("Colors", NATIVE_SWATCHES, false);
  row("Darker", NATIVE_SWATCHES.map((h) => shadeHex(h, DARKER)), false);
  row("Lighter", NATIVE_SWATCHES.map((h) => shadeHex(h, LIGHTER)), false);
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
  const paint = () => {
    const hex = hexColor(input.value);
    preview.style.background = hex || "transparent";
    input.classList.toggle("pxd-picker__input--bad", input.value.trim() !== "" && !hex);
  };
  const commit = () => {
    const hex = hexColor(input.value);
    if (hex) onPick?.(hex);
  };
  on(input, "input", paint);
  on(input, "change", commit);
  on(input, "keydown", (event) => {
    event.stopPropagation?.();
    if (event.key === "Enter") {
      event.preventDefault?.();
      commit();
    }
  });
  hexRow.append(preview, input);
  box.append(hexRow);
  row("Named", PALETTE, true);
  const clear = doc.createElement("button");
  clear.type = "button";
  clear.className = "pxd-btn pxd-picker__clear";
  clear.textContent = "No color";
  on(clear, "click", (event) => {
    stop(event);
    onPick?.(null);
  });
  box.append(clear);
  return box;
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
var TOOL_LIST = [
  ["select", "Select", "V"],
  ["hand", "Hand", "H"],
  ["card", "Card", "N"],
  ["text", "Text", "T"],
  ["section", "Section", "G"],
  ["board", "Board", "W"],
  ["connect", "Connect", "C"]
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
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== void 0) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const button = (parent, cls, label, title, onClick) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (title) b.title = title;
    listen(b, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick?.(event);
    });
    listen(b, "pointerdown", (event) => event.stopPropagation());
    listen(b, "dblclick", (event) => event.stopPropagation());
    return b;
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
  const stopAll = (node) => {
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup", "contextmenu"]) {
      listen(node, type, (event) => event.stopPropagation());
    }
  };
  const toolbar = el("div", "pxd-toolbar pxd-chrome", root);
  stopAll(toolbar);
  const crumbsEl = el("div", "pxd-toolbar__group pxd-crumbs", toolbar);
  listen(crumbsEl, "click", (event) => {
    const hit = event.target?.closest?.(".pxd-crumb[data-index]");
    const raw = hit?.dataset?.index ?? hit?.getAttribute?.("data-index");
    if (raw == null) return;
    const index = Number(raw);
    if (!Number.isFinite(index)) return;
    event.preventDefault?.();
    event.stopPropagation();
    on.crumb?.(index);
  });
  const renderCrumbs = (list) => {
    crumbsEl.replaceChildren();
    const items = Array.isArray(list) ? list : [];
    crumbsEl.style.display = items.length < 2 ? "none" : "";
    if (items.length < 2) return;
    const last = items.length - 1;
    let shown = items.map((c, i) => i);
    let hidden = [];
    if (items.length > MAX_CRUMBS) {
      shown = [0, last - 2, last - 1, last];
      hidden = items.slice(1, last - 2);
    }
    shown.forEach((i, n) => {
      if (n === 1 && hidden.length) {
        const more = el("span", "pxd-crumb__more", crumbsEl, "…");
        more.title = hidden.map((c2) => c2.title).join(" › ");
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
      b.dataset.index = String(i);
      b.setAttribute("data-index", String(i));
      el("span", "pxd-crumb__sep", crumbsEl, "›");
    });
  };
  renderCrumbs(crumbs);
  const toolGroup = el("div", "pxd-toolbar__group", toolbar);
  const toolButtons = /* @__PURE__ */ new Map();
  for (const [id, label, key] of TOOL_LIST) {
    const b = button(toolGroup, "pxd-tool", label, `${label} (${key}). Double-click to lock`, () => on.setTool?.(id, false));
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
  const addBtn = button(group2, "pxd-toolbar__add", "Add", "Add cards from the graph", () => on.togglePanel?.());
  const linksBtn = button(group2, "pxd-toolbar__links", LINK_LABELS.all, "Graph links (L)", () => on.cycleLinks?.());
  const groupView = el("div", "pxd-toolbar__group", toolbar);
  const bgBtn = button(groupView, "pxd-toolbar__bg", "Background", "Background pattern and tone", () => popover.isOpen() ? popover.close() : popover.open());
  const focusBtn = button(groupView, "pxd-toolbar__focus", "Focus", "Focus mode: fade everything but the selection", () => on.toggleFocus?.());
  button(groupView, "pxd-toolbar__present", "Present", "Present this board", () => on.present?.());
  const moreBtn = button(groupView, "pxd-toolbar__more", "More", "More board actions", () => {
    const r = moreBtn.getBoundingClientRect();
    on.openMore?.({ x: r.left, y: r.bottom, w: r.width, h: r.height });
  });
  const group3 = el("div", "pxd-toolbar__group pxd-toolbar__zoom", toolbar);
  button(group3, "pxd-toolbar__zoom-out", "−", "Zoom out (Cmd −)", () => on.zoomOut?.());
  const zoomLabel = button(group3, "pxd-toolbar__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  button(group3, "pxd-toolbar__zoom-in", "+", "Zoom in (Cmd =)", () => on.zoomIn?.());
  button(group3, "pxd-toolbar__fit", "Fit", "Fit all (Shift 1)", () => on.fit?.());
  const minimapBtn = button(group3, "pxd-toolbar__minimap", "Minimap", "Toggle minimap", () => on.toggleMinimap?.());
  const editBtn = button(group3, "pxd-toolbar__edit", "Edit Block", "Edit the diagram block", () => on.editBlock?.());
  const fullBtn = button(group3, "pxd-toolbar__fullscreen", "Fullscreen", "Fullscreen this board", () => on.toggleFullscreen?.());
  const badge = el("span", "pxd-badge", toolbar, version ? `v${version}` : "");
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
  const railBadge = el("span", "pxd-badge pxd-rail__badge", railExtra, version ? `v${version}` : "");
  const applyControls = () => {
    const rail = setting("controls-position") !== "bar";
    root.classList.toggle("pxd-root--rail", rail);
    railEl.style.display = rail ? "" : "none";
    group3.style.display = rail ? "none" : "";
    const showBadge = setting("show-version-badge") !== false;
    badge.style.display = !rail && showBadge ? "" : "none";
    railBadge.style.display = rail && showBadge ? "" : "none";
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
    },
    setZoom(z) {
      const label = `${Math.round((z || 1) * 100)}%`;
      zoomLabel.textContent = label;
      railZoom.textContent = label;
    },
    setLinkMode(mode) {
      linksBtn.textContent = LINK_LABELS[mode] || LINK_LABELS.all;
    },
    setSync(pending) {
      sync.classList.toggle("pxd-sync--pending", Boolean(pending));
      sync.title = pending ? "Saving…" : "Synced";
    },
    setFullscreen(on2) {
      editBtn.style.display = on2 ? "none" : "";
      railEdit.style.display = on2 ? "none" : "";
      fullBtn.textContent = on2 ? "Exit fullscreen" : "Fullscreen";
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
    const row = el("div", "pxd-ctx__row", ctx);
    const btn = (cls, label, title, fn) => button(row, `pxd-ctx__btn ${cls}`, label, title, fn);
    const seg = (cls, options, current, fn) => {
      const wrap = el("div", `pxd-seg ${cls}`, row);
      for (const [value, label, title] of options) {
        const b = button(wrap, `pxd-seg__btn${value === current ? " pxd-seg__btn--on" : ""}`, label, title || label, () => fn(value));
        b.dataset.value = String(value);
      }
      return wrap;
    };
    const opt = (name, cls, label, title, fn) => {
      if (typeof on[name] === "function") btn(cls, label, title, fn);
    };
    const optSeg = (name, cls, options, fn) => {
      if (typeof on[name] === "function") seg(cls, options, null, fn);
    };
    const pinButton = (pinned) => opt("pin", "pxd-ctx__pin-toggle", pinned ? "Unpin" : "Pin", pinned ? "Unpin: allow moving and resizing again" : "Pin: lock position and size", () => on.pin(!pinned));
    const TIDY = [["grid", "Grid", "Tidy into a grid"], ["row", "Row", "Tidy into a row"], ["column", "Column", "Tidy into a column"]];
    const iconBtn = (cls, icon, label, title, fn) => {
      const b = btn(cls, "", title, fn);
      b.setAttribute("aria-label", label);
      const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
      i.setAttribute("aria-hidden", "true");
      return b;
    };
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
          const closed = model?.open === false;
          iconBtn(
            "pxd-ctx__expand",
            closed ? "expand-all" : "collapse-all",
            closed ? "Expand children" : "Collapse children",
            closed ? "Show children" : "Hide children",
            () => on.toggleOpen?.()
          );
          const n = Number(model?.refs) || 0;
          const refs = iconBtn("pxd-ctx__refs", "link", "References", `${n} ${n === 1 ? "reference" : "references"}`, () => on.showRefs?.());
          el("span", "pxd-ctx__refs-count", refs, String(n));
        }
        swatches(row, (c) => on.setColor?.(c));
        if (kind === "card") {
          btn("pxd-ctx__edit", "Edit", "Edit (Enter)", () => on.edit?.());
          btn("pxd-ctx__sidebar", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
          btn("pxd-ctx__collapse", model?.collapsed ? "Expand" : "Collapse", "Collapse to title", () => on.collapse?.());
          btn("pxd-ctx__related", "Related…", "Show related pages and blocks", () => on.related?.());
          pinButton(Boolean(model?.pinned));
          opt("fitHeight", "pxd-ctx__fit-height", "Fit height", "Grow or shrink the card to its text", () => on.fitHeight());
          opt("copyRef", "pxd-ctx__copy-ref", "Copy ref", "Copy a block or page reference", () => on.copyRef());
          opt("duplicate", "pxd-ctx__duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
          opt("sendTo", "pxd-ctx__send-to", "Send to board…", "Move into another board", () => on.sendTo());
          if (NOTE_KINDS.includes(model?.kind)) opt("expandOutline", "pxd-ctx__mindmap", "Mind map", "Expand the children as a mind map", () => on.expandOutline());
        } else {
          seg("pxd-ctx__align", [["left", "L", "Align left"], ["center", "C", "Align centers"], ["right", "R", "Align right"], ["top", "T", "Align top"], ["middle", "M", "Align middles"], ["bottom", "B", "Align bottom"]], null, (v) => on.align?.(v));
          seg("pxd-ctx__distribute", [["h", "H", "Distribute horizontally"], ["v", "V", "Distribute vertically"]], null, (v) => on.distribute?.(v));
          btn("pxd-ctx__wrap", "Wrap in section", "Wrap in a new section (Cmd G)", () => on.wrap?.());
          btn("pxd-ctx__wrap-board", "Move into new board", "Move the selection into a new nested board", () => on.wrapBoard?.());
          optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
          optSeg("sameSize", "pxd-ctx__same-size", [["width", "W", "Same width"], ["height", "H", "Same height"], ["both", "WH", "Same width and height"]], (v) => on.sameSize(v));
          opt("fold", "pxd-ctx__fold", model?.anyCollapsed ? "Unfold" : "Fold", model?.anyCollapsed ? "Expand the collapsed cards" : "Collapse the cards to titles", () => on.fold(!model?.anyCollapsed));
          pinButton(Boolean(model?.allPinned));
          opt("duplicate", "pxd-ctx__duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
        }
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      }
      case "board":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__open-board", "Open", "Open this board (Enter)", () => on.openBoard?.());
        if (model?.enhanced) btn("pxd-ctx__rename-board", "Rename board", "Rename the board", () => on.renameBoard?.());
        btn("pxd-ctx__sidebar", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "section":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__rename", "Rename", "Rename (Enter)", () => on.rename?.());
        btn("pxd-ctx__contents", "Select contents", "Select the section's members", () => on.selectContents?.());
        opt("fitSection", "pxd-ctx__fit-section", "Fit to contents", "Resize the section around its cards", () => on.fitSection());
        opt("toggleFit", "pxd-ctx__auto-fit", model?.autofit ? "Auto-fit: on" : "Auto-fit: off", "Keep the section sized to its cards", () => on.toggleFit());
        optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
        opt("foldAll", "pxd-ctx__fold-all", "Fold all", "Collapse every card in the section", () => on.foldAll(true));
        pinButton(Boolean(model?.pinned));
        btn("pxd-ctx__delete pxd-btn--danger", "Delete frame", "Delete the frame, keep the cards (Del). Shift+Del deletes contents too", () => on.delete?.());
        break;
      case "text":
        swatches(row, (c) => on.setColor?.(c));
        seg("pxd-ctx__size", FONT_SIZES.map((s, i) => [s, ["S", "M", "L", "XL"][i], `${s}px`]), model?.fontSize || 24, (v) => on.setFontSize?.(v));
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "edge":
        seg("pxd-ctx__dir", [["one", "→", "One way"], ["two", "↔", "Two way"], ["none", "—", "No arrow"]], model?.dir, (v) => on.edgeDir?.(v));
        btn("pxd-ctx__flip", "Flip", "Swap endpoints", () => on.flip?.());
        seg("pxd-ctx__route", [["curve", "Curve"], ["straight", "Straight"], ["elbow", "Elbow"]], model?.route, (v) => on.route?.(v));
        seg("pxd-ctx__dash", [["solid", "Solid"], ["dashed", "Dashed"], ["animated", "Animated"]], model?.dash, (v) => on.dash?.(v));
        seg("pxd-ctx__weight", [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], model?.weight, (v) => on.weight?.(v));
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__label", "Label", "Edit the label", () => on.label?.());
        btn("pxd-ctx__notes", "Notes", "Open the connection block in the sidebar", () => on.notes?.());
        btn("pxd-ctx__write", "Write to graph", "Create an attribute on the source", () => on.writeToGraph?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "link": {
        const list = el("div", "pxd-ctx__sources", row);
        for (const s of model?.sources || []) {
          const b = button(list, "pxd-ctx__source", (s.string || s.uid || "").slice(0, 60), "Open in the sidebar", () => on.openSource?.(s.uid));
          b.dataset.uid = s.uid;
        }
        btn("pxd-ctx__pin", "Pin as connection", "Create a board connection from this link", () => on.pinLink?.());
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
  searchInput.placeholder = "Search this board…";
  searchInput.setAttribute("placeholder", "Search this board…");
  const searchCount = el("span", "pxd-search__count", search, "");
  listen(searchInput, "input", () => {
    const n = on.searchFilter?.(searchInput.value || "") ?? 0;
    searchCount.textContent = searchInput.value ? `${n}` : "";
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
    const pad = 40;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const s = Math.min(MINIMAP_W / (maxX - minX), MINIMAP_H / (maxY - minY));
    return { s, ox: (MINIMAP_W - (maxX - minX) * s) / 2 - minX * s, oy: (MINIMAP_H - (maxY - minY) * s) / 2 - minY * s, view };
  };
  const draw = () => {
    mmFrame = null;
    if (!mmDirty || !mmState || minimap.style.display === "none") return;
    mmDirty = false;
    const { board, rects, vp, size } = mmState;
    const g = canvas.getContext?.("2d");
    if (!g) return;
    const sc = computeScale(rects, size, vp);
    mmScale = sc;
    g.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    if (!sc) return;
    const colors = mmColors();
    for (const uid of board.order) {
      const item = board.items.get(uid);
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
    for (const node of [toolbar, railEl, popEl, backEl, ctx, toast, search, minimap]) node.remove();
  };
  return { toolbar: toolbarApi, ctx: ctxApi, toast: toastApi, search: searchApi, minimap: minimapApi, popover, backToContent, badge, sync, dispose };
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
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== void 0) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const button = (parent, cls, label, title, fn) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (title) b.title = title;
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
  const choice = (parent, options, current, fn) => {
    const wrap = el("div", "pxd-seg pxd-props__choices", parent);
    for (const [value, label] of options) {
      const b = button(wrap, `pxd-seg__btn${value === current ? " pxd-seg__btn--on" : ""}`, label, label, () => fn(value));
      b.setAttribute("data-value", value);
    }
    return wrap;
  };
  const stepper = (parent, { value, fallback, min, max, aria, onCommit }) => {
    const shown = Number.isInteger(value) ? value : fallback;
    const row = el("div", "pxd-props__step", parent);
    const input = el("input", "pxd-input pxd-props__num", row);
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(shown);
    input.setAttribute("aria-label", aria);
    const commit = (n) => {
      const v = Number(n);
      if (!Number.isInteger(v) || v < min || v > max) {
        input.value = String(shown);
        return;
      }
      onCommit(v);
    };
    const dec = button(row, "pxd-props__dec", "−", "Smaller", () => commit(shown - 1));
    row.insertBefore(dec, input);
    button(row, "pxd-props__inc", "+", "Larger", () => commit(shown + 1));
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
    const row = el("div", "pxd-props__field", parent);
    el("span", "pxd-props__label", row, label);
    const chip = button(row, "pxd-props__chip", "", label, () => {
      const open = row.querySelector(".pxd-picker");
      if (open) {
        open.remove();
        return;
      }
      const picker = buildColorPicker(doc, (c) => fn(c), listen);
      row.append(picker);
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
    const text = items.filter((it) => it.type === "text");
    const sample = cards[0] || text[0];
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
  const defaultsGroup = (board) => {
    const stored = board?.defaults?.section || {};
    sectionGroup(
      [{ ...stored, sectionDefaults: {} }],
      "Default groups",
      "defaults",
      (patch) => on.setDefaults?.(patch),
      "Reset default",
      () => on.resetDefaults?.()
    );
  };
  const diagram = (board) => {
    const g = group("Diagram", "diagram");
    const bg = board?.plexus || {};
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
    const board = last?.board;
    if (edge) edgeGroup(edge);
    else {
      const blocksItems = items.filter((it) => it.type === "card" || it.type === "text");
      const sections = items.filter((it) => it.type === "section");
      if (blocksItems.length) blocks(blocksItems);
      if (sections.length) {
        sectionGroup(sections, "Group", "group", (patch) => on.setSectionStyle?.(patch), "Reset", () => on.resetSections?.());
      }
      if (!blocksItems.length && !sections.length) defaultsGroup(board);
    }
    diagram(board);
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

// src/view/panel.js
var CARD_MIME = "application/x-plexus-card";
var DEBOUNCE_MS = 150;
var LIMIT = 40;
var MAX_DROP = 50;
function parseDropPayload(dataTransfer, { resolveUid } = {}) {
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
  const tokens = (text) => text.split(/\s+/).filter((t) => /^[\w-]+$/.test(t));
  let uids = tokens(take("roam/block-uid-list-only-parents"));
  if (!uids.length) uids = tokens(take("roam/block-uid-list"));
  if (!uids.length) {
    for (const type of ["roam/roam-uri-list", "text/uri-list"]) {
      for (const line of take(type).split(/\r?\n/)) {
        if (!line.trim() || line.startsWith("#")) continue;
        const m = line.match(/\/page\/([\w-]+)/);
        if (m) uids.push(m[1]);
      }
      if (uids.length) break;
    }
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
  const plain = take("text/plain").trim();
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
function createPanel({ doc = globalThis.document, root, host, timers, on = {} } = {}) {
  const listeners2 = [];
  const listen = (el2, type, fn, opts) => {
    el2.addEventListener(type, fn, opts);
    listeners2.push(() => el2.removeEventListener(type, fn, opts));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== void 0) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const panel = el("aside", "pxd-panel pxd-chrome", root);
  panel.style.display = "none";
  for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup"]) {
    listen(panel, type, (event) => event.stopPropagation());
  }
  const head = el("div", "pxd-panel__head", panel);
  const tabs = el("div", "pxd-panel__tabs", head);
  const tabSearch = el("button", "pxd-btn pxd-panel__tab pxd-panel__tab--on", tabs, "Search");
  const tabRelated = el("button", "pxd-btn pxd-panel__tab", tabs, "Related");
  const tabBoards = el("button", "pxd-btn pxd-panel__tab", tabs, "Boards");
  const tabOutline = el("button", "pxd-btn pxd-panel__tab", tabs, "Outline");
  const tabButtons = { search: tabSearch, related: tabRelated, boards: tabBoards, outline: tabOutline };
  for (const [name, b] of Object.entries(tabButtons)) {
    b.type = "button";
    b.dataset.tab = name;
    b.setAttribute("data-tab", name);
  }
  const closeBtn = el("button", "pxd-btn pxd-panel__close", head, "×");
  closeBtn.type = "button";
  closeBtn.title = "Close";
  const searchPane = el("div", "pxd-panel__pane pxd-panel__pane--search", panel);
  const relatedPane = el("div", "pxd-panel__pane pxd-panel__pane--related", panel);
  relatedPane.style.display = "none";
  const input = el("input", "pxd-input pxd-panel__input", searchPane);
  input.type = "text";
  input.placeholder = "Search pages and blocks…";
  input.setAttribute("placeholder", "Search pages and blocks…");
  const results = el("div", "pxd-panel__list", searchPane);
  const relatedHead = el("div", "pxd-panel__related-head", relatedPane);
  const relatedTitle = el("span", "pxd-panel__related-title", relatedHead, "Select a card");
  const addAll = el("button", "pxd-btn pxd-panel__add-all", relatedHead, "Add all");
  addAll.type = "button";
  addAll.style.display = "none";
  const relatedList = el("div", "pxd-panel__list", relatedPane);
  const boardsPane = el("div", "pxd-panel__pane pxd-panel__pane--boards", panel);
  boardsPane.style.display = "none";
  const boardsFilter = el("input", "pxd-input pxd-panel__input pxd-panel__boards-filter", boardsPane);
  boardsFilter.type = "text";
  boardsFilter.placeholder = "Filter boards…";
  boardsFilter.setAttribute("placeholder", "Filter boards…");
  const boardsList = el("div", "pxd-panel__list pxd-panel__boards", boardsPane);
  const outlinePane = el("div", "pxd-panel__pane pxd-panel__pane--outline", panel);
  outlinePane.style.display = "none";
  const outlineList = el("div", "pxd-panel__list pxd-panel__outline", outlinePane);
  let tab = "search";
  let debounce = null;
  let selected = null;
  let relatedRows = [];
  let queryId = 0;
  const row = (parent, { string, label, text, kind }) => {
    const r = el("div", "pxd-panel__row", parent);
    r.setAttribute("draggable", "true");
    r.draggable = true;
    r.dataset.string = string;
    r.setAttribute("data-string", string);
    if (label) el("span", "pxd-panel__row-label", r, label);
    el("span", `pxd-panel__row-text pxd-panel__row-text--${kind || "page"}`, r, text);
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
  const runSearch = async () => {
    const q = String(input.value || "").trim();
    const id = queryId += 1;
    results.replaceChildren();
    if (!q) return;
    let pages = [];
    let blocks = [];
    try {
      [pages, blocks] = await Promise.all([
        Promise.resolve(host?.searchPages?.(q, LIMIT) || []),
        Promise.resolve(host?.searchBlocks?.(q, LIMIT) || [])
      ]);
    } catch {
    }
    if (id !== queryId) return;
    const rows = [
      ...pages.map((p) => ({ string: `[[${p.title}]]`, text: p.title, kind: "page", label: "page" })),
      ...blocks.map((b) => ({ string: `((${b.uid}))`, text: `${b.string || ""}`.slice(0, 120), kind: "block", label: b.pageTitle ? `in ${b.pageTitle}` : "block" }))
    ].slice(0, LIMIT);
    results.replaceChildren();
    if (!rows.length) {
      el("div", "pxd-panel__empty", results, "No matches");
      return;
    }
    rows.forEach((r) => row(results, r));
  };
  listen(input, "input", () => {
    debounce?.();
    debounce = timers.later(() => {
      debounce = null;
      void runSearch();
    }, DEBOUNCE_MS);
  });
  listen(input, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      api.close();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      debounce?.();
      debounce = null;
      void runSearch();
    }
  });
  const setTab = (next) => {
    tab = next;
    for (const [name, b] of Object.entries(tabButtons)) b.classList.toggle("pxd-panel__tab--on", tab === name);
    searchPane.style.display = tab === "search" ? "" : "none";
    relatedPane.style.display = tab === "related" ? "" : "none";
    boardsPane.style.display = tab === "boards" ? "" : "none";
    outlinePane.style.display = tab === "outline" ? "" : "none";
    if (tab === "related") void loadRelated();
    if (tab === "boards") void loadBoards();
    if (tab === "outline") renderOutline();
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
      const text = rel.text || (t.kind === "page" ? t.title : t.uid) || "";
      relatedRows.push({ string });
      row(relatedList, { string, label: rel.relation || "related", text, kind: t.kind });
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
      const text = el("div", "pxd-panel__board-text", r);
      el("span", "pxd-panel__board-title", text, b.title || "Untitled board");
      const page = b.page || b.pageTitle;
      if (page) el("span", "pxd-panel__board-page", text, page);
      const n = b.count ?? b.itemCount ?? b.items;
      if (Number.isFinite(n)) el("span", "pxd-panel__board-count", r, `${n} ${n === 1 ? "item" : "items"}`);
      const add = el("button", "pxd-btn pxd-panel__board-add", r, "Add shortcut");
      add.type = "button";
      add.title = "Add a card for this board to the current board";
    }
  };
  listen(boardsList, "click", (event) => {
    const row2 = event.target?.closest?.(".pxd-panel__board-row");
    const uid = row2?.dataset?.uid ?? row2?.getAttribute?.("data-uid");
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
    const row2 = event.target?.closest?.(".pxd-panel__outline-row");
    const uid = row2?.dataset?.uid ?? row2?.getAttribute?.("data-uid");
    if (!uid) return;
    event.stopPropagation();
    on.outlineClick?.(uid);
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
      if (api.isOpen() && tab === "related") void loadRelated();
    },
    refreshMarks() {
      for (const r of panel.querySelectorAll(".pxd-panel__row")) {
        const s = r.dataset?.string || r.getAttribute("data-string");
        r.classList.toggle("pxd-panel__row--on", Boolean(on.isOnBoard?.(s)));
      }
    },
    dispose() {
      debounce?.();
      queryId += 1;
      listeners2.splice(0).forEach((off) => off());
      panel.remove();
    }
  };
  return api;
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
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== void 0) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const on_ = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const selectable = (level) => level.rows.filter((row) => !entries.get(row).item.disabled);
  const setActive = (level, row) => {
    for (const r of level.rows) r.classList.toggle("pxd-menu__item--active", r === row);
    level.active = row || null;
    if (row && level.depth === 0 && menuEl?.classList?.contains("pxd-menu--scroll")) row.scrollIntoView?.({ block: "nearest" });
  };
  const closeFrom = (depth) => {
    while (levels.length > depth) {
      const level = levels.pop();
      level.container.style.display = "none";
      level.container.classList?.remove("pxd-menu__sub--open");
      setActive(level, null);
    }
  };
  const placeSub = (sub, row) => {
    const rootRect = root.getBoundingClientRect();
    sub.classList.remove("pxd-menu__sub--left");
    sub.style.top = "0px";
    const r = row.getBoundingClientRect();
    const w = sub.offsetWidth || MENU_WIDTH;
    const h = sub.offsetHeight || 0;
    if (menuEl?.classList?.contains("pxd-menu--scroll")) {
      const fitsRight = !rootRect.width || r.right + w <= rootRect.right - MARGIN;
      const top = rootRect.height ? Math.max(rootRect.top + MARGIN, Math.min(r.top, rootRect.bottom - MARGIN - h)) : r.top;
      sub.style.left = `${Math.round(fitsRight ? r.right + 2 : r.left - w - 2)}px`;
      sub.style.top = `${Math.round(top)}px`;
      return;
    }
    if (rootRect.width && r.right + w > rootRect.right - MARGIN) sub.classList.add("pxd-menu__sub--left");
    if (rootRect.height && h && r.top + h > rootRect.bottom - MARGIN) {
      sub.style.top = `${Math.round(Math.min(0, rootRect.bottom - MARGIN - (r.top + h)))}px`;
    }
  };
  const openSub = (row) => {
    const entry = entries.get(row);
    if (!entry?.sub || entry.item.disabled) return null;
    closeFrom(entry.level + 1);
    entry.sub.container.style.display = "";
    entry.sub.container.classList.add("pxd-menu__sub--open");
    levels.push(entry.sub);
    placeSub(entry.sub.container, row);
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
      const row = el("div", cls, parent);
      row.setAttribute("role", item.checked ? "menuitemradio" : "menuitem");
      if (item.checked) row.setAttribute("aria-checked", "true");
      if (item.disabled) row.setAttribute("aria-disabled", "true");
      row.setAttribute("data-id", item.id);
      row.dataset.id = item.id;
      el("span", "pxd-menu__label", row, item.label);
      if (item.hint) el("span", "pxd-menu__hint", row, item.hint);
      const entry = { item, level: depth, sub: null };
      entries.set(row, entry);
      level.rows.push(row);
      if (item.children?.length) {
        el("span", "pxd-menu__arrow", row, "›");
        const container = el("div", "pxd-menu__sub", row);
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
  const pick = (row) => {
    const entry = entries.get(row);
    if (!entry || entry.item.disabled) return;
    if (entry.sub) {
      const sub = openSub(row);
      if (sub) setActive(sub, selectable(sub)[0] || null);
      return;
    }
    const { item } = entry;
    try {
      on.pick?.(item.id, item);
    } finally {
      close();
    }
  };
  const current = () => levels[levels.length - 1];
  const move = (step) => {
    const level = current();
    const rows = selectable(level);
    if (!rows.length) return;
    const i = rows.indexOf(level.active);
    const next = i < 0 ? step > 0 ? 0 : rows.length - 1 : (i + step + rows.length) % rows.length;
    setActive(level, rows[next]);
  };
  const onKey = (event) => {
    const key = event.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", " ", "Home", "End", "Tab"].includes(key)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const level = current();
    if (key === "Escape" || key === "Tab") return close();
    if (key === "ArrowDown") return move(1);
    if (key === "ArrowUp") return move(-1);
    if (key === "Home" || key === "End") {
      const rows = selectable(level);
      return setActive(level, key === "Home" ? rows[0] : rows[rows.length - 1]);
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
        const row = rowOf(event);
        if (!row) return;
        event.preventDefault?.();
        pick(row);
      });
      on_(menuEl, "pointerover", (event) => {
        const row = rowOf(event);
        if (!row) return;
        const entry = entries.get(row);
        const level = levels[entry.level];
        if (!level) return;
        closeFrom(entry.level + 1);
        if (entry.item.disabled) {
          setActive(level, null);
          return;
        }
        setActive(level, row);
        if (entry.sub) openSub(row);
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
    dispose() {
      close();
      disposed = true;
      api.el = null;
    }
  };
  return api;
}

// src/view/menu-model.js
var SIZE_LABELS = { 16: "Small", 24: "Medium", 32: "Large", 48: "Extra large" };
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
  const colorMenu = () => {
    const current = item?.color || null;
    return make("color", "Color", {
      children: [
        make("color:none", "No color", { checked: !current }),
        ...PALETTE.map((name) => make(`color:${name}`, cap(name), { checked: current === name }))
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
        make("new-section", "New section", { hint: "G" }),
        make("new-board", "New board", { hint: "W" }),
        sep(),
        make("paste", "Paste", { hint: "Cmd V", disabled: !c.canPaste }),
        make("paste-clone", "Paste as copies", { disabled: !c.canPaste }),
        sep(),
        make("add-today", "Add today's journal"),
        make("add-week", "Add this week's journals"),
        sep(),
        make("select-all", "Select all", { hint: "Cmd A" }),
        make("fit-all", "Fit all", { hint: "Shift 1" }),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
        make("background", "Background…"),
        make("export-svg", "Export as SVG"),
        make("export-png", "Export as PNG"),
        make("copy-outline", "Copy as outline")
      ];
    case "card": {
      const folded = Boolean(c.collapsed);
      const out = [
        make("edit", c.isBoard ? "Rename board" : "Edit", { hint: "Enter" }),
        make("open", c.isBoard ? "Open board" : "Open"),
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
        foldItem(folded),
        make("fit-height", "Fit height", { disabled: folded }),
        make("reset-size", "Reset size", { disabled: folded }),
        pinItem(Boolean(c.pinned))
      ];
      if (c.hasOutline) out.push(make("mind-map", "Expand as mind map"));
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
        make("route", "Route", {
          children: [
            make("route:curve", "Curve", { checked: c.route === "curve" }),
            make("route:straight", "Straight", { checked: c.route === "straight" }),
            make("route:elbow", "Elbow", { checked: c.route === "elbow" })
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
        make("wrap-section", "Wrap in section", { hint: "Cmd G" }),
        make("wrap-board", "Move into new board"),
        make("send-to", "Send to board…"),
        sep(),
        make("delete", "Delete", { hint: "Del", danger: true })
      ];
    }
    case "board-menu":
      return [
        make("export-svg", "Export as SVG"),
        make("export-png", "Export as PNG"),
        make("copy-outline", "Copy as outline"),
        make("open-outline", "Open outline in sidebar"),
        sep(),
        make("fold-all", "Fold all cards"),
        make("unfold-all", "Unfold all cards"),
        sep(),
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
var childString2 = (c) => c?.[":block/string"] ?? c?.string ?? "";
var childKids2 = (c) => c?.[":block/children"] ?? c?.children ?? [];
function createQuickLook({ doc = globalThis.document, root, host, timers, on = {} } = {}) {
  let node = null;
  let roots = [];
  let current = null;
  let cancelPending = null;
  let disposed = false;
  const offs = [];
  const el = (tag, cls, parent, text) => {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text !== void 0) n.textContent = text;
    parent?.append(n);
    return n;
  };
  const renderRoot = (parent, string, cls) => {
    const n = el("div", cls, parent);
    roots.push(n);
    if (!string) return n;
    try {
      if (host?.renderString) host.renderString(n, string);
      else n.textContent = string;
    } catch {
      n.textContent = string;
    }
    return n;
  };
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks || []) {
      if (budget.n >= LIMIT2 * 4) return;
      budget.n += 1;
      const row = el("div", "pxd-ql__block", parent);
      renderRoot(row, childString2(b), "pxd-rs pxd-ql__text");
      const kids = childKids2(b);
      if (kids.length && depth < DEPTH) renderBlocks(el("div", "pxd-ql__children", row), kids, depth + 1, budget);
    }
  };
  const unmountRoots = () => {
    for (const n of roots) {
      try {
        host?.unmount?.(n);
      } catch {
      }
    }
    roots = [];
  };
  const close = () => {
    if (!node) return false;
    cancelPending?.();
    cancelPending = null;
    unmountRoots();
    node.remove();
    node = null;
    current = null;
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
      if (!node || !body.parentElement) return;
      const budget = { n: 0 };
      renderBlocks(body, result || [], 1, budget);
    };
    const settle = (result, apply) => {
      if (result && typeof result.then === "function") {
        result.then((r) => {
          if (node && current === item) apply(r);
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
    current = item;
    node = el("div", "pxd-quicklook pxd-chrome", root);
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", "Quick Look");
    for (const type of STOP_EVENTS2) listen(node, type, (event) => event.stopPropagation());
    const head = el("div", "pxd-ql__head", node);
    el("div", "pxd-ql__title", head, item.kind === "board" ? item.title : item.title || item.string || "");
    let refs = null;
    try {
      refs = on.getRefCount?.(item);
    } catch {
      refs = null;
    }
    if (typeof refs === "number" && refs > 0) el("span", "pxd-ql__refs", head, String(refs));
    const body = el("div", "pxd-ql__body", node);
    fill(body, item);
    listen(doc, "pointerdown", (event) => {
      if (node && !node.contains(event.target)) close();
    }, true);
    listen(doc, "keydown", (event) => {
      if (event.key === "Escape" && node) {
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
      if (node) {
        close();
        return false;
      }
      return open(item);
    },
    isOpen: () => Boolean(node),
    dispose() {
      close();
      disposed = true;
    }
  };
}

// src/view/present.js
var collectMembers = (board, uid) => {
  const out = /* @__PURE__ */ new Set();
  const stack = [uid];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...board.items.get(u)?.members ?? []);
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
  let prevBtn = null;
  let nextBtn = null;
  const offs = [];
  const el = (tag, cls, parent, text) => {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text !== void 0) n.textContent = text;
    parent?.append(n);
    return n;
  };
  const button = (parent, cls, label, fn) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
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
  const paint = () => {
    const s = steps[index];
    if (!hud || !s) return;
    titleEl.textContent = s.title || "";
    countEl.textContent = `${index + 1} / ${steps.length}`;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= steps.length - 1;
    prevBtn.setAttribute("aria-disabled", String(index <= 0));
    nextBtn.setAttribute("aria-disabled", String(index >= steps.length - 1));
  };
  const goto = (i) => {
    if (!active || !steps.length) return false;
    const next = Math.max(0, Math.min(steps.length - 1, Math.trunc(Number(i))));
    if (!Number.isFinite(next)) return false;
    index = next;
    paint();
    const s = steps[index];
    on.step?.({ index, total: steps.length, uid: s.uid, rect: s.rect, title: s.title, members: s.members });
    return true;
  };
  const teardown = () => {
    offs.splice(0).forEach((off) => off());
    hud?.remove();
    hud = titleEl = countEl = prevBtn = nextBtn = null;
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
  const start = (board, rects) => {
    if (!board) return false;
    if (active) {
      teardown();
      active = false;
    }
    const rootSet = new Set(board.roots);
    const sections = outlineOrder(board).filter((u) => rootSet.has(u) && board.items.get(u)?.type === "section" && rects.get(u));
    steps = sections.map((uid) => ({
      uid,
      rect: rects.get(uid),
      title: board.items.get(uid).title || "",
      members: collectMembers(board, uid)
    }));
    if (!steps.length) {
      const all = [...board.items.keys()].filter((u) => rects.get(u));
      if (!all.length) return false;
      steps = [{ uid: null, rect: boundsOf(all.map((u) => rects.get(u))), title: board.title || "", members: new Set(all) }];
    }
    active = true;
    hud = el("div", "pxd-present-hud pxd-chrome", root);
    titleEl = el("span", "pxd-present-hud__title", hud);
    countEl = el("span", "pxd-present-hud__count", hud);
    prevBtn = button(hud, "pxd-present-hud__prev", "Prev", () => goto(index - 1));
    nextBtn = button(hud, "pxd-present-hud__next", "Next", () => goto(index + 1));
    button(hud, "pxd-present-hud__exit", "Exit", () => stop());
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
var defaultTextEntry = (node) => {
  if (!node || node.nodeType !== 1) return false;
  const tag = String(node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return node.isContentEditable === true || node.getAttribute?.("contenteditable") === "true" || node.getAttribute?.("contenteditable") === "";
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
async function writeClipboard({ text = "", mime = null, data = null } = {}) {
  const nav = globalThis.navigator;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(String(text));
      return true;
    }
  } catch {
  }
  const doc = globalThis.document;
  if (!doc?.body) return false;
  const area = doc.createElement("textarea");
  area.value = String(text);
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
  const inText = (event) => {
    const test = (n) => Boolean(isTextEntry?.(n)) || defaultTextEntry(n);
    return test(event.target) || test(doc.activeElement);
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
  listen(doc, "paste", (event) => {
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
    const box = fullscreenInsets(root);
    mount.style.top = `${box.top}px`;
    mount.style.left = `${box.left}px`;
    mount.style.right = `${box.right}px`;
    mount.style.bottom = `${box.bottom}px`;
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
var MIN_HEIGHT = 240;
var RESUME_MS = 120;
var VP_PERSIST_MS = 500;
var SECTION_TITLE_ALLOWANCE = 32;
var CULL_MARGIN = 0.5;
var BADGE_TTL_MS = 12e4;
var BADGE_CHUNK = 12;
var NATIVE_MENU_TARGETS = ".rm-page-ref, .rm-block-ref, [data-link-uid], a[href], img";
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
  let node = root;
  while (node) {
    if (has(node, "bp3-dark") || has(node, "rm-dark-theme") || has(node, "bt-theme-dark")) return true;
    if (has(node, "roam-body") && has(node, "dark")) return true;
    node = node.parentElement;
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
  for (let node = root; node; node = node.parentElement) {
    let color;
    try {
      color = rgbOf(win.getComputedStyle(node)?.backgroundColor);
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
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };
  const svg = (cls, parent) => {
    const node = doc.createElementNS(SVG_NS3, "svg");
    node.setAttribute("class", cls);
    if (node.classList && !node.classList.contains(cls)) node.className = cls;
    parent?.append(node);
    return node;
  };
  const boardUid = session.uid;
  const graph = host?.graph || graphName2(win);
  const storage = globalThis.localStorage;
  const vpStore = host?.viewports || host?.viewportStore || createLocalViewportStore({ storage, graph, timers });
  const heightKey = `plexus-diagram:h:${graph}:${routeUid}`;
  const root = el("div", "pxd-root", mountEl);
  root.tabIndex = 0;
  root.setAttribute("tabindex", "0");
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
  const resizeGrip = el("div", "pxd-resize-grip pxd-chrome", root);
  resizeGrip.title = "Drag to resize the board";
  const applyTheme = () => {
    const dark = isDarkHost(mountEl, doc);
    root.classList.toggle("pxd-root--dark", dark);
    root.classList.toggle("pxd-root--light", !dark && isLightHost(mountEl, doc, globalThis.window));
  };
  applyTheme();
  const mountKind = sidebarMountKind(nativeEl);
  const inSidebar = mountKind !== "main";
  const vpId = inSidebar ? `${boardUid}:${mountKind}` : boardUid;
  let vp = vpStore.get(vpId);
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
  let bgOverride = false;
  let focusOn = false;
  let focusKey = null;
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
  const board = () => session.board;
  let outlineMode = false;
  let outlineHost = null;
  let outlineKey = "";
  let outlineBtn = null;
  let boardBtn = null;
  const clearOutline = () => {
    if (!outlineHost) return;
    for (const row of [...outlineHost.children]) {
      try {
        host?.unmount?.(row);
      } catch {
      }
    }
    outlineHost.replaceChildren();
  };
  const syncOutline = (force = false) => {
    if (!outlineMode || !outlineHost || disposed) return;
    const key = sidebarOutlineUids(board()).join("\n");
    if (!force && key === outlineKey) return;
    outlineKey = key;
    clearOutline();
    if (typeof host?.renderBlock !== "function") return;
    for (const uid of sidebarOutlineUids(board())) {
      const row = el("div", "pxd-sidebar-outline__row", outlineHost);
      row.dataset.uid = uid;
      row.setAttribute("data-uid", uid);
      try {
        host.renderBlock(row, uid);
      } catch {
      }
    }
  };
  const setOutline = (on) => {
    outlineMode = Boolean(on);
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
      modeBar.append(b);
      listen(b, "click", on);
      return b;
    };
    outlineBtn = modeBtn("pxd-mode__outline", "Outline", () => setOutline(true));
    boardBtn = modeBtn("pxd-mode__board", "Board", () => setOutline(false));
    outlineHost = el("div", "pxd-sidebar-outline pxd-chrome", root);
  }
  const rects = () => session.rects || worldRects(board());
  const effectiveRects = () => {
    if (!liveRects) return rects();
    const merged = new Map(rects());
    for (const [k, v] of liveRects) merged.set(k, v);
    return merged;
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
      const r = board() && rects().get(uid);
      if (disposed || !r) return;
      liveRects = /* @__PURE__ */ new Map();
      if (h > r.h) liveRects.set(uid, { ...r, h });
      previewFit([uid]);
    },
    onOpenBoard: (uid) => {
      void openBoard(uid);
    },
    onRenameBoard: (uid, title) => session.renameBoard?.(uid, title),
    onBadgeClick: (uid) => {
      ctl.select([uid]);
      panel.open("related");
    }
  });
  const edgesR = createEdgeLayer({
    doc,
    svg: edgesSvg,
    labelsLayer,
    overlaySvg,
    onLabelCommit: (uid, label) => session.updateEdge?.(uid, { label })
  });
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
  const fitInsets = (bounds) => {
    const rr = root.getBoundingClientRect?.() || rootRect;
    const tb = chrome.toolbar.el?.getBoundingClientRect?.();
    const pel = panel.el?.style?.display !== "none" ? panel.el?.getBoundingClientRect?.() : null;
    const b = board();
    const r = b ? rects() : null;
    const titled = Boolean(bounds && b && [...b.items.values()].some((it) => it.type === "section" && r.get(it.uid) && r.get(it.uid).y <= bounds.y + 0.5));
    return {
      top: (tb?.height ? Math.max(0, tb.bottom - (rr.top || 0)) : 0) + (titled ? SECTION_TITLE_ALLOWANCE : 0),
      right: pel?.width ? Math.max(0, Math.min(size.width, (rr.left || 0) + size.width - pel.left)) : 0
    };
  };
  const fitTo = (bounds, opts = {}) => {
    if (!size.width || !size.height) measure();
    setViewport(fitViewport(bounds, size, { padding: 64, maxZoom: opts.maxZoom ?? 1.5, insets: fitInsets(bounds) }));
  };
  const fitAll = () => fitTo(boundsOf([...rects().values()]));
  const fitSelection = (uids) => {
    const r = rects();
    const b = boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
    if (b) fitTo(b, { maxZoom: 1 });
  };
  const centerOn = (worldPoint) => {
    setViewport({ x: size.width / 2 - worldPoint.x * vp.zoom, y: size.height / 2 - worldPoint.y * vp.zoom, zoom: vp.zoom });
  };
  const mapThreshold = () => {
    const n = Number(setting("map-zoom", "0.45"));
    return Number.isFinite(n) && n > 0 ? n : 0.45;
  };
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
    if (disposed || gesturing || !board()) return;
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
    const b = board();
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
    if (disposed || gesturing || !board()) return;
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
      dirty.edges = new Set(board()?.edges.keys() || []);
      dirty.links = true;
      schedule();
      updateBackToContent();
      refreshBadges();
    }, RESUME_MS);
  };
  const selectedItems = () => selection.items.map((u) => board()?.items.get(u)).filter(Boolean);
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
    const b = board();
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
    const r = rects();
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
  const showCtx = () => {
    const b = board();
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
      const model = { count: items.length, allPinned: items.every((i) => i.pinned), anyCollapsed: items.some((i) => i.type === "card" && i.collapsed) };
      return chrome.ctx.show("cards", model, ctxAnchor);
    }
    const it = items[0];
    return chrome.ctx.show(it.type === "section" ? "section" : it.type === "text" ? "text" : it.kind === "board" ? "board" : "card", cardModel(it), ctxAnchor);
  };
  const targetUids = () => selection.edge ? [selection.edge] : selection.items;
  const singleItem = () => selection.items.length === 1 ? board()?.items.get(selection.items[0]) : null;
  let hoverUid = null;
  const selectionOwnsBar = () => Boolean(selection.edge || selection.link || selection.items.length);
  const barCard = () => {
    const sel = singleItem();
    if (sel?.type === "card") return sel;
    if (!selectionOwnsBar() && hoverUid) {
      const it = board()?.items.get(hoverUid);
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
    const uid = board()?.uid;
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
    const b = board();
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
    const b = board();
    if (!b) return false;
    const s = String(string || "").trim();
    for (const item of b.items.values()) {
      if (item.string.trim() === s || semanticRef(item) === s) return true;
    }
    return false;
  };
  const crumbList = Array.isArray(crumbs) ? crumbs : [];
  const boardTargetOf = (uid) => {
    const item = board()?.items.get(uid);
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
    const b = board();
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
    const types = new Set(list.map((u) => board()?.items.get(u)?.type ?? "card"));
    const noun = types.size === 1 && (types.has("card") || types.has("section")) ? [...types][0] : "item";
    toast(`${label} ${list.length} ${list.length === 1 ? noun : `${noun}s`}`, true);
  };
  const copyText = (text, message) => {
    void writeClipboard({ text }).then((ok) => {
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
    const b = board();
    const own = b?.plexus;
    const ownPattern = BOARD_PATTERNS.includes(own?.bg) ? own.bg : null;
    const ownHex = hexColor(own?.bgColor) || null;
    const ownTone = ownHex ? null : BOARD_TONES.includes(own?.bgColor) ? own.bgColor : null;
    const defPattern = setting("grid", "dots");
    const defTone = setting("board-tone", "none");
    const pattern = ownPattern ?? (BOARD_PATTERNS.includes(defPattern) ? defPattern : "dots");
    const tone = ownHex ? null : ownTone ?? (BOARD_TONES.includes(defTone) ? defTone : null);
    const override = ownPattern !== null || ownTone !== null || ownHex !== null;
    if (pattern === bgPattern && tone === bgTone && ownHex === bgHex && override === bgOverride) return;
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
    bgOverride = override;
    chrome.toolbar.setBackground({ pattern, tone: ownHex || tone, override });
  };
  const applyMotion = () => {
    const motion = setting("motion", "full");
    root.classList.toggle("pxd-root--motion-off", motion === "reduced" || motion === "none");
  };
  const focusSetNow = () => {
    const b = board();
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
  const applyFocus = () => {
    if (disposed) return;
    const set = focusSetNow();
    const key = set ? [...set].sort().join("|") : null;
    root.classList.toggle("pxd-root--focus", Boolean(set) || focusOn);
    chrome.toolbar.setFocus(focusOn);
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
    const b = board();
    void session.setCollapsedMany?.(cards, cards.some((u) => !b.items.get(u).collapsed));
  };
  const alignSel = (mode, uids = selection.items) => {
    const r = rects();
    const b = board();
    const list = uids.filter((uid) => !b?.items.get(uid)?.pinned).map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
    const moved = alignRects(list, mode).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
    void session.commitRects?.(moved);
  };
  const distributeSel = (axis, uids = selection.items) => {
    const r = rects();
    const b = board();
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
  const expandOutline = (uid) => {
    Promise.resolve(session.expandOutline?.(uid)).then((res) => {
      if (disposed || !res || typeof res !== "object") return;
      if (res.added > 0) {
        if (res.skipped > 0) toast(`Mind map: ${res.total - res.skipped} of ${res.total} branches (cap)`, true);
        else toast(`Added ${res.added} ${res.added === 1 ? "card" : "cards"} as a mind map`, true);
      } else toast("Nothing to expand");
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
  const outline = () => {
    const b = board();
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
    const b = board();
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
    let text = null;
    try {
      text = await globalThis.navigator?.clipboard?.readText?.();
    } catch {
      text = null;
    }
    if (disposed) return;
    if (lastPayload && (text == null || text === lastPayload.text)) {
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
    const entries = parsePastedText(text ?? "");
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
  const menuContext = (kind, uid) => {
    const b = board();
    const item = uid ? b?.items.get(uid) : null;
    switch (kind) {
      case "canvas":
        return { canPaste: true };
      case "card":
        return { item, isBoard: item?.kind === "board", collapsed: Boolean(item?.collapsed), pinned: Boolean(item?.pinned), hasOutline: NOTE_KINDS2.includes(item?.kind) };
      case "section":
        return { item, count: item?.members?.length ?? 0, fitOn: item?.autofit !== false, pinned: Boolean(item?.pinned) };
      case "text":
        return { item, pinned: Boolean(item?.pinned) };
      case "edge": {
        const e = uid ? b?.edges.get(uid) : null;
        return { item: e, dir: e?.dir, route: e?.route, dash: e?.dash };
      }
      case "multi": {
        const items = selection.items.map((u) => b?.items.get(u)).filter(Boolean);
        return { count: items.length, allPinned: items.length > 0 && items.every((i) => i.pinned), anyCollapsed: items.some((i) => i.type === "card" && i.collapsed) };
      }
      default:
        return {};
    }
  };
  const openMenuAt = (kind, uid, client, world2) => {
    if (!board()) return false;
    const items = buildMenu(kind, menuContext(kind, uid));
    const ok = menu.open({ x: client.x, y: client.y, items });
    if (ok) menuCtx = { kind, uid, world: world2, selection: selection.items.slice() };
    return ok;
  };
  const createAt = async (type, world2) => {
    const d = DEFAULT_SIZES[type];
    const at = { x: world2.x - d.w / 2, y: world2.y - d.h / 2 };
    const uid = await (type === "text" ? actions.createText(at) : actions.createCard(at));
    if (uid && !disposed) {
      ctl.select([uid]);
      void enterEdit(uid);
    }
  };
  const onMenuPick = (id) => {
    const b = board();
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
      case "new-section": {
        const d = DEFAULT_SIZES.section;
        Promise.resolve(session.createSection?.({ rect: { x: world2.x - d.w / 2, y: world2.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => {
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
      case "add-week":
        addDaily(weekDates(), world2);
        break;
      case "background":
        chrome.popover.open();
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
      case "open-sidebar":
        openItemInSidebar(item);
        break;
      case "copy":
        doCopy(uids);
        break;
      case "copy-ref":
        if (item) copyText(`((${item.uid}))`, "Reference copied");
        break;
      case "copy-link":
        if (item) copyText(semanticRef(item), "Link copied");
        break;
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
      case "fit-section":
        if (item) void session.fitSection?.(item.uid);
        break;
      case "toggle-fit":
        if (item) void session.setFit?.(item.uid, item.autofit === false);
        break;
      case "tidy":
        void session.tidyItems?.(mc.kind === "board-menu" ? b.roots : uids, arg);
        break;
      case "fold-all-in":
        if (item) void session.collapseAll?.(true, { within: item.uid });
        break;
      case "unfold-all-in":
        if (item) void session.collapseAll?.(false, { within: item.uid });
        break;
      case "size":
        if (item) void session.setFontSize?.(item.uid, Number(arg));
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
      cycleLinks: () => cycleLinks(),
      zoomIn: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1.2)),
      zoomOut: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / 1.2)),
      zoomReset: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / vp.zoom)),
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
        if (it) void session.setBlockOpen?.(it.uid, it.open === false);
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
      setFontSize: (n) => {
        const it = singleItem();
        if (it) void session.setFontSize?.(it.uid, n);
      },
      edgeDir: (dir) => {
        if (selection.edge) void session.updateEdge?.(selection.edge, { dir });
      },
      flip: () => {
        if (selection.edge) void session.flipEdge?.(selection.edge);
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
      searchFilter: (text) => searchFilter(text),
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
      fold: (value) => setFolded(selection.items, Boolean(value)),
      sameSize: (mode) => {
        if (selection.items.length) void session.sameSize?.(selection.items, lastSelected(), mode);
      },
      toggleFocus: () => toggleFocus(),
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
  const panel = createPanel({
    doc,
    root,
    host,
    timers,
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
      }
    }
  });
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
    const b = board();
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
  const startPresent = () => {
    quicklook.close();
    if (!presenter.start(board(), rects())) toast("Nothing to present");
  };
  chrome.minimap.setVisible(setting("show-minimap", true) !== false);
  chrome.toolbar.setLinkMode(linkMode);
  const cycleLinks = () => {
    linkMode = LINK_MODES2[(LINK_MODES2.indexOf(linkMode) + 1) % LINK_MODES2.length];
    chrome.toolbar.setLinkMode(linkMode);
    session.setLinkMode?.(linkMode);
  };
  const searchFilter = (text) => {
    const b = board();
    const q = String(text || "").trim().toLowerCase();
    searchMatches = [];
    searchIndex = -1;
    root.classList.toggle("pxd-root--searching", Boolean(q));
    if (!b) return 0;
    for (const item of b.items.values()) {
      const hay = `${item.title}
${plainText(item.string, 2e3)}`.toLowerCase();
      const hit = q && hay.includes(q);
      if (hit) searchMatches.push(item.uid);
      itemsR.shellOf(item.uid)?.classList.toggle("pxd-item--dim", Boolean(q) && !hit);
    }
    return searchMatches.length;
  };
  const searchNext = (dir = 1) => {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    const uid = searchMatches[searchIndex];
    ctl.select([uid]);
    fitSelection([uid]);
  };
  const enterEdit = async (uid) => {
    ctl.select([uid]);
    if (tier !== "detail") {
      fitSelection([uid]);
      applyLod();
    }
    const ok = await itemsR.enterEdit(uid);
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
      const text = host?.blockString?.(uid);
      if (item && freshCardIsBlank({
        blockString: text,
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
    const node = blockEdit;
    blockEdit = null;
    node.remove();
    try {
      host?.unmount?.(node);
    } catch {
    }
  };
  const editBoardBlock = () => {
    if (blockEdit || disposed) return;
    const node = el("div", "pxd-block-edit pxd-chrome", root);
    for (const type of ["pointerdown", "pointerup", "mousedown", "click", "dblclick", "wheel"]) {
      node.addEventListener(type, (event) => event.stopPropagation());
    }
    blockEdit = node;
    try {
      host?.renderBlock?.(node, boardUid);
    } catch {
      closeBlockEdit();
      return;
    }
    openRawBlockEditor(node);
  };
  const openRawBlockEditor = (node) => {
    if (node.querySelector?.("textarea")) return;
    const buttons = [...node.querySelectorAll?.("button") || []];
    const native = buttons.find((b) => (b.getAttribute?.("title") || b.title) === "Edit Block");
    if (!native) return;
    native.click?.();
    if (node.querySelector?.("textarea")) return;
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
    const b = board();
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
  const actions = {
    board,
    rects,
    viewport: () => vp,
    size: () => size,
    setViewport,
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
    showGuides: (guides) => edgesR.setGuides(guides),
    previewMove: (uids, dx, dy) => {
      const b = board();
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
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
      dirty.minimap = true;
      schedule();
    },
    previewRects: (list) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewRects(list);
      const set = new Set(list.map((r) => r.uid));
      previewFit(list.map((r) => r.uid), { skip: new Set(list.filter((r) => b.items.get(r.uid)?.type === "section").map((r) => r.uid)) });
      for (const u of grown) set.add(u);
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
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
      const it = uid ? board()?.items.get(uid) : null;
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
    commitMove: (uids, dx, dy) => session.commitMove?.(uids, dx, dy),
    commitRects: (list) => session.commitRects?.(list),
    createCard: (p) => Promise.resolve(session.createCard?.({ x: p.x, y: p.y })).then((uid) => {
      if (uid) freshItems.add(uid);
      return uid;
    }),
    createText: (p) => Promise.resolve(session.createText?.({ x: p.x, y: p.y })).then((uid) => {
      if (uid) freshItems.add(uid);
      return uid;
    }),
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
    wrapInSection: (uids) => session.wrapInSection?.(uids),
    deleteItems: (uids, opts) => session.deleteItems?.(uids, opts),
    deleteEdges: (uids) => session.deleteEdges?.(uids),
    addEdge: (spec) => session.addEdge?.(spec),
    undo: () => session.undo?.(),
    redo: () => session.redo?.(),
    enterEdit: (uid) => enterEdit(uid),
    exitEdit: () => exitEdit(),
    isEditing: () => itemsR.isEditing(),
    editingUid: () => itemsR.editingUid(),
    autocompleteOpen: () => itemsR.autocompleteOpen(),
    renameSection: (uid) => itemsR.renameSection(uid),
    editLabel: (uid) => edgesR.editLabel(uid),
    openBlock: (uid) => host?.openBlock?.(uid),
    toast: (t) => chrome.toast.show(t),
    openSearch: () => chrome.search.open(),
    cycleLinks,
    isFullscreen: () => isFullscreen,
    setFullscreen: (on) => requestFullscreen(on),
    setSpace: (on) => root.classList.toggle("pxd-root--space", Boolean(on))
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
    if (item) return { kind: "item", uid: item.dataset?.uid || item.getAttribute?.("data-uid"), part: t.closest(".pxd-item__header") ? "header" : "body" };
    return { kind: "empty" };
  };
  const normalize = (event, type = event.type) => {
    const screen = { x: (event.clientX || 0) - rootRect.left, y: (event.clientY || 0) - rootRect.top };
    return {
      type,
      screen,
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
  listen(root, "pointerdown", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    measure();
    const ev = normalize(event, "pointerdown");
    const editingUid = itemsR.editingUid();
    if (!(editingUid && ev.target.kind === "item" && ev.target.uid === editingUid && ev.target.part !== "header")) {
      event.stopPropagation();
      if (ev.target.kind !== "label" && ev.target.kind !== "section-title") event.preventDefault();
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
      const editing = itemsR.editingUid();
      if (editing && event.target?.closest?.(".pxd-item--editing")) return;
      event.stopPropagation();
    });
  }
  listen(root, "dragstart", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-item--editing")) return;
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
  const openRefFromClick = (event) => {
    const t = event.target;
    if (!t?.closest || !t.closest(".pxd-item") || t.closest(".pxd-item--editing")) return false;
    const api = host?.api;
    const page = t.closest("[data-link-uid]");
    const block = t.closest(".rm-block-ref[data-uid]");
    const uid = page?.getAttribute("data-link-uid") || block?.getAttribute("data-uid");
    if (!uid || !api?.ui) return false;
    if (event.shiftKey) api.ui.rightSidebar?.addWindow?.({ window: { type: page ? "outline" : "block", "block-uid": uid } });
    else if (page) api.ui.mainWindow?.openPage?.({ page: { uid } });
    else api.ui.mainWindow?.openBlock?.({ block: { uid } });
    return true;
  };
  listen(root, "click", (event) => {
    if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation();
  });
  listen(root, "dblclick", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    event.stopPropagation();
    event.preventDefault();
    measure();
    ctl.handle(normalize(event, "dblclick"));
  });
  listen(root, "wheel", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
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
    const it = board()?.items.get(uid);
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
    const node = event.target?.closest?.(".pxd-item--card");
    showHover(node?.getAttribute?.("data-uid") || node?.dataset?.uid || null);
  });
  listen(root, "pointerenter", () => {
    pointerInside = true;
    pointerBoard = root;
  });
  listen(root, "pointerleave", () => {
    pointerInside = false;
    if (pointerBoard === root) pointerBoard = null;
  });
  const acceptsDrop = (event) => !event.target?.closest?.(".pxd-item__editor");
  const dropEffectFor = (effectAllowed) => {
    const a = String(effectAllowed || "uninitialized");
    if (a === "all" || a === "uninitialized" || /copy/i.test(a)) return "copy";
    if (/move/i.test(a)) return "move";
    if (/link/i.test(a)) return "link";
    return "copy";
  };
  const onDragAccept = (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
  };
  listen(root, "dragenter", onDragAccept);
  listen(root, "dragover", onDragAccept);
  listen(root, "drop", (event) => {
    if (!acceptsDrop(event)) return;
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
    const list = parseDropPayload(event.dataTransfer, { resolveUid });
    if (!list.length) return;
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const made = session.addRefCards?.(stackAt(list.map((x) => x.string), p.x - w / 2, p.y - h / 2, h));
    Promise.resolve(made).then((uids) => {
      if (Array.isArray(uids) && uids.length) ctl.select(uids);
    }).catch(() => {
    });
  });
  const ownsKeyboard = () => {
    const active = doc.activeElement;
    const activeRoot = active?.closest?.(".pxd-root");
    if (activeRoot) return activeRoot === root;
    if (pointerBoard) return pointerBoard === root;
    return isFullscreen;
  };
  const onKeyDown = (event) => {
    if (outlineMode && !event.target?.closest?.(".pxd-mode")) return;
    if (menu.isOpen()) return;
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
    if (quicklook.isOpen() && event.key !== "Escape" && String(event.key).toLowerCase() !== "q") return;
    if (presenter.isActive() && !["Escape", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "p", "P"].includes(event.key)) return;
    const inputFocused = isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement);
    if (inputFocused) {
      const inside2 = root.contains?.(event.target) || root.contains?.(doc.activeElement);
      if (!inside2 && !itemsR.isEditing()) return;
    } else if (!ownsKeyboard()) {
      return;
    }
    if (!inputFocused && itemsR.isEditing() && event.key !== "Escape") {
      itemsR.recoverFocus();
      return;
    }
    const focused = doc.activeElement;
    const tabOwned = Boolean(focused) && (focused === root || Boolean(root.contains?.(focused)) && !focused.closest?.(".pxd-chrome"));
    const handled = ctl.handle({ type: "keydown", key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey, inputFocused, tabOwned });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onKeyUp = (event) => {
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
        const b = board();
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
      }
    }
  });
  subs.push(session.on("change", ({ dirty: d, structural } = {}) => {
    if (disposed) return;
    const b = board();
    const current = crumbList[crumbList.length - 1];
    if (current && b) {
      const title = b.title || UNTITLED_BOARD;
      if (current.title !== title) {
        current.title = title;
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
  }));
  subs.push(session.on("links", () => {
    dirty.links = true;
    schedule();
  }));
  subs.push(session.on("busy", (busy) => chrome.toolbar.setSync(Boolean(busy))));
  subs.push(session.on("toast", (t) => chrome.toast.show(t)));
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
      for (const node of [doc.documentElement, doc.body]) if (node) mo.observe(node, { attributes: true, attributeFilter: ["class"] });
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
  routeOff = watchRouteExit({ boardUid: routeUid, onExit: () => {
    if (isFullscreen) requestFullscreen(false);
  }, win });
  const renderFrame = () => {
    if (disposed) return;
    const b = board();
    if (!b) return;
    const r = rects();
    let itemsChanged = false;
    if (dirty.all || dirty.structural || dirty.items.size) {
      itemsR.sync({ board: b, rects: effectiveRects(), dirty: dirty.all ? null : dirty.items, structural: dirty.structural });
      itemsChanged = true;
    }
    if (dirty.all || dirty.structural || dirty.links || dirty.edges.size) {
      edgesR.render({ board: b, rects: r, links: session.links || [], coveredEdges: session.coveredEdges || /* @__PURE__ */ new Set(), selection, zoom: vp.zoom, dirty: dirty.all || dirty.structural || dirty.links ? null : dirty.edges });
      if (dirty.items.size && !dirty.all && !dirty.structural) {
        edgesR.update({ board: b, edgeUids: edgesTouching(b, dirty.items), rects: r, zoom: vp.zoom, linkKeys: new Set((session.links || []).map((l) => l.key)), links: session.links || [] });
      }
    }
    if (dirty.viewport) {
      world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
      const nextTier = lodTier(vp.zoom, tier, { threshold: mapThreshold() });
      if (nextTier !== tier) {
        tier = nextTier;
        paintTier();
      }
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
      chrome.toolbar.setZoom(vp.zoom);
      propsPanel.place();
    }
    if (dirty.selection || itemsChanged) {
      itemsR.setSelection(selection.items);
      edgesR.setSelection({ edge: selection.edge, link: selection.link });
      if (!gesturing && !itemsR.isEditing()) showCtx();
      else chrome.ctx.hide();
      syncProps();
      if (focusOn) applyFocus();
    } else if (dirty.viewport && chrome.ctx.isOpen()) {
      chrome.ctx.reposition();
    }
    if (dirty.viewport || itemsChanged || dirty.minimap) chrome.minimap.update({ board: b, rects: effectiveRects(), vp, size });
    if (itemsChanged && !gesturing) {
      scheduleContent();
      updateBackToContent();
      panel.refreshOutline();
      if (dirty.all || dirty.structural) scheduleBadges(50);
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
  applyFullscreen(fullscreen);
  measure();
  if (autofocus) {
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
  }
  if (!vp) {
    const b = board();
    const r = b ? rects() : /* @__PURE__ */ new Map();
    vp = fitViewport(boundsOf([...r.values()]), size.width && size.height ? size : { width: 800, height: 560 }, { padding: 64, maxZoom: 1 });
  }
  applyBackground();
  applyMotion();
  applyLod();
  itemsR.setShowBadges(flag("show-card-badges", true));
  dirty.viewport = true;
  markAll();
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
    const text = boardToSvg(pictured, rects(), { dark: root.classList.contains("pxd-root--dark"), imageHrefs: hrefs });
    return dropExternalImages(text);
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
    const b = board();
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
    const b = board();
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
    // Swap the settings object (feature.js calls this when a setting changes) and re-apply what depends on it.
    setSettings(next) {
      if (disposed) return;
      const minimapBefore = setting("show-minimap", true) !== false;
      settingsRef = next;
      applyBackground();
      applyMotion();
      applyLod();
      const minimapNow = setting("show-minimap", true) !== false;
      if (minimapNow !== minimapBefore) chrome.minimap.setVisible(minimapNow);
      chrome.toolbar.applyControls?.();
      itemsR.setShowBadges(flag("show-card-badges", true));
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
        present: presenter.isActive(),
        selection: [...selection.items],
        mounted: itemsR.mountedCount(),
        menuOpen: menu.isOpen()
      };
    },
    // Serializes the board to SVG text; with download it also offers the file through a temporary link.
    async exportSvg({ download = true } = {}) {
      const b = board();
      if (!b) return "";
      const text = boardToSvg(b, rects(), { dark: root.classList.contains("pxd-root--dark") });
      if (download) {
        try {
          const blob = new Blob([text], { type: "image/svg+xml" });
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
      return text;
    },
    async exportPng() {
      return exportPng();
    },
    async copyOutline() {
      const b = board();
      if (!b) return "";
      const text = boardToMarkdown(b, rects());
      const ok = await writeClipboard({ text });
      if (!disposed) toast(ok ? "Outline copied" : "Copy failed");
      return text;
    },
    stats() {
      return { timers: timers.count(), listeners: listeners2.length + (captured ? 3 : 0), observers: observers.length, mounted: itemsR.mountedCount(), shells: itemsR.shellCount() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      closeBlockEdit();
      if (pointerBoard === root) pointerBoard = null;
      clearOutline();
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
  wheel: "wheel",
  showMinimap: "show-minimap",
  controlsPosition: "controls-position",
  snapGuides: "snap-guides",
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
  showCardBadges: "show-card-badges"
});
var DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.fullscreenOnZoom]: true,
  [SETTING_IDS.graphLinks]: "all",
  [SETTING_IDS.wheel]: "pan",
  [SETTING_IDS.showMinimap]: true,
  [SETTING_IDS.controlsPosition]: "rail",
  [SETTING_IDS.snapGuides]: true,
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
  [SETTING_IDS.showCardBadges]: true
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
  [SETTING_IDS.mapZoom]: MAP_ZOOMS
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
    const n = Number(value);
    return Number.isFinite(n) && n >= 40 ? n : fallback;
  }
  if (ENUMS[id]) {
    const text = typeof value === "number" ? String(value) : value;
    return ENUMS[id].includes(text) ? text : fallback;
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
async function initializeSettings(extensionAPI) {
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
function createSettingsPanel() {
  return {
    tabTitle: "Plexus Diagram",
    settings: [
      switchRow(SETTING_IDS.enabled, "Enabled", "Master overlay toggle."),
      switchRow(SETTING_IDS.fullscreenOnZoom, "Fullscreen on zoom", "Open enhanced diagrams full screen when zoomed into the diagram block. Esc exits."),
      selectRow(SETTING_IDS.graphLinks, "Graph links", "Show links between cards derived from page references and attributes.", ["all", "attributes", "off"]),
      selectRow(SETTING_IDS.wheel, "Mouse wheel", "What the mouse wheel does on the board. Pinch always zooms.", ["pan", "zoom"]),
      switchRow(SETTING_IDS.showMinimap, "Show minimap", "Show the minimap."),
      selectRow(SETTING_IDS.controlsPosition, "Controls", "Rail is the vertical control stack. Bar is the 1.2 horizontal zoom group.", ["rail", "bar"]),
      switchRow(SETTING_IDS.snapGuides, "Snap guides", "Align dragged cards to neighbours and show guides."),
      selectRow(SETTING_IDS.grid, "Default board background: pattern", "Background pattern for boards that do not set their own. A board can override it from the Background button.", ["dots", "lines", "grid", "plain"]),
      selectRow(SETTING_IDS.boardTone, "Default board background: tone", "Background tone for boards that do not set their own.", BOARD_TONES2),
      selectRow(SETTING_IDS.mapZoom, "Map view below (zoom)", "Below this zoom level cards collapse to title-only tiles.", MAP_ZOOMS),
      switchRow(SETTING_IDS.autoFitSections, "Auto-fit sections", "Grow a section to contain a card moved or resized past its edge."),
      switchRow(SETTING_IDS.spaceOut, "Space out cards", "Push overlapping cards apart after a move."),
      switchRow(SETTING_IDS.showCardBadges, "Show card badges", "Show reference, task and child counts on cards."),
      selectRow(SETTING_IDS.defaultCardLook, "Default card look", "New note cards. Block is a plain Roam block. Card keeps the title row.", ["block", "card"]),
      inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Width in pixels for new cards."),
      inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Height in pixels for new cards."),
      switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Enable board keyboard shortcuts."),
      switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the extension version in the toolbar."),
      switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Skip mounting on mobile clients."),
      switchRow(SETTING_IDS.collapseOutline, "Collapse board blocks in the outline (expand the bullet to see them)", "Collapses an enhanced board block once, so Roam does not list every card, section and connection as bullets under it. Expanding the bullet is remembered.")
    ]
  };
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
var PARENTS_QUERY = "[:find ?u ?s :in $ ?uid :where [?b :block/uid ?uid] [?b :block/parents ?p] [?p :block/uid ?u] [?p :block/string ?s]]";
function graphFromHash(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/([^/]+)/);
  return match ? match[1] : "unknown";
}
function pulledString(node) {
  return String(node?.[":block/string"] ?? node?.string ?? "");
}
function pulledChildren(node) {
  return node?.[":block/children"] ?? node?.children ?? [];
}
function hasMigratedMark(node) {
  for (const child of pulledChildren(node)) {
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
  function mountRecView(rec, { autofocus = false } = {}) {
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
      onOpenBoard: (child) => navigate(rec, [...rec.crumbs, { uid: child, title: boardTitle(host.blockString?.(child)) }]),
      onCrumb: (index) => navigate(rec, rec.crumbs.slice(0, index + 1)),
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
      if (currentUid(rec) !== rec.uid) navigate(rec, rec.crumbs.slice(0, -1));
      else unmount(rec);
    });
    const offChange = session.on?.("change", () => {
      if (!session.board || session.board.enhanced !== false) return;
      if (currentUid(rec) !== rec.uid) {
        navigate(rec, rec.crumbs.slice(0, -1));
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
  function navigate(rec, next) {
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
        rec.view = mountRecView(rec, { autofocus: true });
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
      fullscreen: false,
      off: null
    };
    native.classList.add(NATIVE_HIDDEN_CLASS);
    if (titlePanel) titlePanel.style.display = "none";
    native.after(mountEl);
    mounts.set(native, rec);
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
    collapseOnce(uid, native);
    if (currentUid(rec) === uid) migrateLegacy(rec);
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
  function unmount(rec) {
    if (!rec || !mounts.has(rec.native)) return;
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
    let uid = uidByNative.get(native);
    if (uid === void 0) {
      uid = findDiagramUidFromEl(native, isDiagramUid) || null;
      uidByNative.set(native, uid);
    }
    if (!uid || !isBoardEnhanced(uid)) return;
    if (insideEnhancedOutline(native)) {
      native.classList.add(OUTLINE_NATIVE_CLASS);
      titlePanelOf(native)?.classList.add(OUTLINE_NATIVE_CLASS);
      return;
    }
    mount(uid, native, options);
  }
  function scanAdded(node) {
    for (const diagram of diagramsWithin(node)) consider(diagram);
  }
  function reconcile() {
    if (stopped) return;
    for (const rec of [...mounts.values()]) {
      if (rec.native.isConnected === false || rec.mountEl.isConnected === false) unmount(rec);
    }
    for (const [node, observer] of portalObservers) {
      if (node.isConnected === false) {
        observer.disconnect();
        portalObservers.delete(node);
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
      const hits = rows.filter((row) => isDiagramString(row[1])).map((row) => row[0]);
      if (hits.length < 2) return hits[0] ?? null;
      const deepest = hits.find((cand) => {
        const above = new Set((host.q?.(PARENTS_QUERY, cand) || []).map((row) => row[0]));
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
  async function registerCommands() {
    const commands = [
      ["Plexus: Enhance this diagram", enhanceCommand],
      ["Plexus: New whiteboard here", newWhiteboardCommand],
      ["Plexus: Restore native diagram", restoreCommand],
      ["Plexus: Fullscreen this diagram", fullscreenCommand],
      ["Plexus: Export board as SVG", exportSvgCommand],
      ["Plexus: Copy board as text", copyOutlineCommand]
    ];
    for (const [label, fn] of commands) {
      const callback = (context) => {
        if (!active()) {
          console.info("[plexus-diagram] Command skipped: extension disabled");
          return;
        }
        Promise.resolve(fn(context)).catch((error) => console.warn(`[plexus-diagram] ${label} failed`, error));
      };
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback });
      if (extensionAPI.ui?.slashCommand?.addCommand) {
        await lifecycle.command(extensionAPI.ui.slashCommand, { label, callback });
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
    }
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
        } else {
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
        for (const node of record.addedNodes || []) {
          if (node.nodeType === 1) scanAdded(node);
        }
      }
    };
    const app = doc.querySelector(".roam-app");
    if (app) lifecycle.observer(new MutationObserver(onAdded), app, { childList: true, subtree: true });
    if (doc.body) {
      lifecycle.observer(new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes || []) {
            if (node.nodeType !== 1 || !node.classList?.contains("bp3-portal") || portalObservers.has(node)) continue;
            const observer = new MutationObserver(onAdded);
            observer.observe(node, { childList: true, subtree: true });
            portalObservers.set(node, observer);
            scanAdded(node);
          }
        }
      }), doc.body, { childList: true });
    }
  }
  if (typeof win.addEventListener === "function") {
    lifecycle.event(win, "hashchange", onNavigate);
    lifecycle.event(win, "popstate", onNavigate);
  }
  lifecycle.interval(reconcile, RECONCILE_INTERVAL_MS);
  lifecycle.add(() => {
    stopped = true;
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
