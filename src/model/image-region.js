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
