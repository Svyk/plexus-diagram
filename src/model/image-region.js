// REG-2. Fractions are the clamped drag over the image box, then the region macro.

import { normalizeFrac, serializeRegion } from "./regions.js";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boxOf(rect) {
  if (!rect || typeof rect !== "object") return null;
  const x = finite(rect.x ?? rect.left);
  const y = finite(rect.y ?? rect.top);
  const width = finite(rect.width);
  const height = finite(rect.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function fracFromDrag(rect, x0, y0, x1, y1) {
  const box = boxOf(rect);
  if (!box) return null;
  const pts = [x0, y0, x1, y1].map(finite);
  if (pts.some((n) => n === null)) return null;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const ax = clamp(pts[0], box.x, right);
  const ay = clamp(pts[1], box.y, bottom);
  const bx = clamp(pts[2], box.x, right);
  const by = clamp(pts[3], box.y, bottom);
  const f = normalizeFrac([
    (Math.min(ax, bx) - box.x) / box.width,
    (Math.min(ay, by) - box.y) / box.height,
    Math.abs(bx - ax) / box.width,
    Math.abs(by - ay) / box.height,
  ]);
  if (!f) return null;
  return { rx: f[0], ry: f[1], rw: f[2], rh: f[3] };
}

export function imageRegionString(cardUid, frac, caption) {
  try {
    return serializeRegion({
      kind: "img",
      drawingUid: cardUid,
      f: [frac.rx, frac.ry, frac.rw, frac.rh],
      caption,
    });
  } catch {
    return null;
  }
}

const DRAW_KEY = "pxd-region-draw";
const X_POS = { left: 0, center: 0.5, right: 1 };
const Y_POS = { top: 0, center: 0.5, bottom: 1 };

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function clamp01(n) {
  return clamp(n, 0, 1);
}

function posToken(token, axis) {
  const text = String(token || "").trim().toLowerCase();
  if (!text) return null;
  if (text.endsWith("%")) {
    const n = Number(text.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : null;
  }
  if (axis === "x" && Object.prototype.hasOwnProperty.call(X_POS, text) && text !== "center") return X_POS[text];
  if (axis === "y" && Object.prototype.hasOwnProperty.call(Y_POS, text) && text !== "center") return Y_POS[text];
  if (text === "center") return 0.5;
  return null;
}

// CSS object-position. One token: a vertical keyword sets y and x stays centered;
// anything else sets x and y stays centered. Two tokens follow the written order,
// except a vertical keyword written first.
export function parseObjectPosition(value) {
  const parts = String(value || "50% 50%").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return { x: 0.5, y: 0.5 };
  if (parts.length === 1) {
    const token = parts[0];
    if (token in Y_POS && !(token in X_POS)) return { x: 0.5, y: Y_POS[token] };
    if (token in X_POS && !(token in Y_POS)) return { x: X_POS[token], y: 0.5 };
    const x = posToken(token, "x");
    return { x: x == null ? 0.5 : x, y: 0.5 };
  }
  let a = parts[0];
  let b = parts[1];
  const aIsY = a in Y_POS && !(a in X_POS);
  const bIsX = b in X_POS && !(b in Y_POS);
  if (aIsY && bIsX) { const swap = a; a = b; b = swap; }
  const x = posToken(a, "x");
  const y = posToken(b, "y");
  return { x: x == null ? 0.5 : x, y: y == null ? 0.5 : y };
}

function edgeBox(edge) {
  const src = edge || {};
  return {
    t: Number(src.t) || 0,
    r: Number(src.r) || 0,
    b: Number(src.b) || 0,
    l: Number(src.l) || 0,
  };
}

// The pixels object-fit actually paints, in the same space as `rect` (a border box).
// `padding` and `border` are CSS pixels. `zoom` scales them when `rect` is a screen
// box (getBoundingClientRect). contain / cover / fill depend only on the aspect
// ratio, so a zoomed rect needs no extra zoom. none and scale-down do: a natural
// pixel is one CSS pixel, and the screen size is that times zoom. A missing natural
// size returns the content box.
export function paintedContentRect(rect, natural, { fit = "fill", position = "50% 50%", zoom = 1, padding, border } = {}) {
  const box = boxOf(rect);
  if (!box) return null;
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  const pad = edgeBox(padding);
  const frame = edgeBox(border);
  const left = box.x + (frame.l + pad.l) * z;
  const top = box.y + (frame.t + pad.t) * z;
  const width = box.width - (frame.l + frame.r + pad.l + pad.r) * z;
  const height = box.height - (frame.t + frame.b + pad.t + pad.b) * z;
  if (!(width > 0) || !(height > 0)) return { left: box.x, top: box.y, width: box.width, height: box.height };
  const content = { left, top, width, height };
  const nw = Number(natural?.width) || Number(natural?.naturalWidth) || 0;
  const nh = Number(natural?.height) || Number(natural?.naturalHeight) || 0;
  if (!(nw > 0) || !(nh > 0)) return content;
  const mode = String(fit || "fill").trim().toLowerCase();
  const pos = parseObjectPosition(position);
  const place = (usedW, usedH) => ({
    left: left + (width - usedW) * pos.x,
    top: top + (height - usedH) * pos.y,
    width: usedW,
    height: usedH,
  });
  if (mode === "fill") return content;
  const contain = Math.min(width / nw, height / nh);
  if (mode === "contain") return place(nw * contain, nh * contain);
  if (mode === "cover") {
    const cover = Math.max(width / nw, height / nh);
    return place(nw * cover, nh * cover);
  }
  if (mode === "none") return place(nw * z, nh * z);
  if (mode === "scale-down") {
    const css = Math.min(1, contain / z);
    return place(nw * css * z, nh * css * z);
  }
  return content;
}

function cssPick(style, inline, camel, kebab) {
  const fromStyle = style?.[camel];
  if (fromStyle != null && fromStyle !== "") return String(fromStyle);
  const fromInline = inline?.[camel] ?? inline?.[kebab];
  if (fromInline != null && fromInline !== "") return String(fromInline);
  const fromProp = style?.getPropertyValue?.(kebab);
  if (fromProp != null && fromProp !== "") return String(fromProp);
  return "";
}

function cssPx(style, inline, camel, kebab) {
  const n = Number.parseFloat(cssPick(style, inline, camel, kebab));
  return Number.isFinite(n) ? n : 0;
}

// Screen (or stub) rect of the painted image. Reads object-fit, object-position,
// padding and border. Falls back to the element box when the natural size is unknown.
export function paintedRectOfElement(el, { zoom = 1 } = {}) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  let rect = null;
  try { rect = el.getBoundingClientRect(); } catch { rect = null; }
  if (!rect) return null;
  const view = el.ownerDocument?.defaultView;
  const getStyle = view?.getComputedStyle || globalThis.getComputedStyle;
  let style = null;
  try { style = typeof getStyle === "function" ? getStyle(el) : null; } catch { style = null; }
  const inline = el.style || {};
  const fit = cssPick(style, inline, "objectFit", "object-fit") || "fill";
  const position = cssPick(style, inline, "objectPosition", "object-position") || "50% 50%";
  return paintedContentRect(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    { width: el.naturalWidth, height: el.naturalHeight },
    {
      fit,
      position,
      zoom,
      padding: {
        t: cssPx(style, inline, "paddingTop", "padding-top"),
        r: cssPx(style, inline, "paddingRight", "padding-right"),
        b: cssPx(style, inline, "paddingBottom", "padding-bottom"),
        l: cssPx(style, inline, "paddingLeft", "padding-left"),
      },
      border: {
        t: cssPx(style, inline, "borderTopWidth", "border-top-width"),
        r: cssPx(style, inline, "borderRightWidth", "border-right-width"),
        b: cssPx(style, inline, "borderBottomWidth", "border-bottom-width"),
        l: cssPx(style, inline, "borderLeftWidth", "border-left-width"),
      },
    },
  );
}

export function regionDrawMode(storage = globalThis.localStorage) {
  try { return storage?.getItem?.(DRAW_KEY) === "pen" ? "pen" : "box"; } catch { return "box"; }
}

export function setRegionDrawMode(mode, storage = globalThis.localStorage) {
  const next = mode === "pen" ? "pen" : "box";
  try { storage?.setItem?.(DRAW_KEY, next); } catch { /* private mode */ }
  return next;
}

// Flat `p=` numbers or `{x,y}` points, clamped. Fewer than three points is null.
export function polyPairs(points) {
  const out = [];
  if (!points) return null;
  if (points.length && typeof points[0] === "number") {
    for (let i = 0; i + 1 < points.length; i += 2) {
      const x = Number(points[i]);
      const y = Number(points[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push({ x: clamp01(x), y: clamp01(y) });
    }
  } else {
    for (const p of points) {
      const x = Number(p?.x ?? p?.[0]);
      const y = Number(p?.y ?? p?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push({ x: clamp01(x), y: clamp01(y) });
    }
  }
  return out.length >= 3 ? out : null;
}

export function polyBBox(points) {
  const pairs = polyPairs(points);
  if (!pairs) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of pairs) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const f = normalizeFrac([minX, minY, maxX - minX, maxY - minY]);
  if (!f) return null;
  return { rx: f[0], ry: f[1], rw: f[2], rh: f[3] };
}

export function imageRegionFrac(region) {
  if (!region) return null;
  const f = region.f;
  if (Array.isArray(f) && f.length === 4) {
    const nums = f.map(Number);
    if (nums.every((n) => Number.isFinite(n)) && nums[2] > 0 && nums[3] > 0) {
      return { rx: nums[0], ry: nums[1], rw: nums[2], rh: nums[3] };
    }
  }
  return polyBBox(region.p);
}

function perpDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  let max = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpDistance(points[i], first, last);
    if (d > max) { max = d; index = i; }
  }
  if (max > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// Ramer–Douglas–Peucker, then at most 64 points, 4 decimal places (what both parsers accept).
export function simplifyPoly(points, { epsilon = 0.004, max = 64 } = {}) {
  const src = [];
  for (const p of polyPairs(points) || []) {
    const prev = src[src.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 1e-6 && Math.abs(prev.y - p.y) < 1e-6) continue;
    src.push(p);
  }
  if (src.length > 2) {
    const a = src[0];
    const b = src[src.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) src.pop();
  }
  if (src.length < 3) return null;
  let eps = epsilon > 0 ? epsilon : 0.004;
  let out = rdp(src, eps);
  while (out.length > max && eps < 0.2) {
    eps *= 1.5;
    out = rdp(src, eps);
  }
  if (out.length > max) {
    const step = (out.length - 1) / (max - 1);
    const picked = [];
    for (let i = 0; i < max; i += 1) picked.push(out[Math.round(i * step)]);
    out = picked;
  }
  const clean = [];
  for (const p of out) {
    const next = { x: round4(clamp01(p.x)), y: round4(clamp01(p.y)) };
    const prev = clean[clean.length - 1];
    if (prev && prev.x === next.x && prev.y === next.y) continue;
    clean.push(next);
  }
  return clean.length >= 3 ? clean : null;
}

export function imagePolyString(cardUid, points, caption) {
  const pairs = simplifyPoly(points) || polyPairs(points);
  if (!pairs) return null;
  const flat = [];
  for (const p of pairs) flat.push(round4(p.x), round4(p.y));
  try {
    return serializeRegion({ kind: "imgpoly", drawingUid: cardUid, i: 0, p: flat, caption });
  } catch {
    return null;
  }
}

// Clip path in the image's own 0–1 space (a preview that fills the image box).
export function polygonClipPath(points) {
  const pairs = polyPairs(points);
  if (!pairs) return "";
  return `polygon(${pairs.map((p) => `${p.x * 100}% ${p.y * 100}%`).join(",")})`;
}

// The same polygon inside a crop frame that shows only the bbox.
export function polygonClipInBox(frac, points) {
  const pairs = polyPairs(points);
  const box = frac && typeof frac === "object" && !Array.isArray(frac)
    ? frac
    : (Array.isArray(frac) ? { rx: frac[0], ry: frac[1], rw: frac[2], rh: frac[3] } : null);
  if (!pairs || !box || !(Number(box.rw) > 0) || !(Number(box.rh) > 0)) return "";
  const pts = pairs.map((p) => `${((p.x - box.rx) / box.rw) * 100}% ${((p.y - box.ry) / box.rh) * 100}%`);
  return `polygon(${pts.join(",")})`;
}
