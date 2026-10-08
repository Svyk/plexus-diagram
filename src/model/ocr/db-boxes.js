// DB-net boxes from a probability map. Axis-aligned: unclip grows the component's bounding box
// by area * ratio / perimeter, which is the rectangle case of the pyclipper offset.

import { labelComponents } from "./components.js";

function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

// prob: Float32Array row-major, mapW * mapH, values 0..1. Boxes come back in source pixels.
export function boxesFromProb(prob, mapW, mapH, srcW, srcH, opts = {}) {
  const thresh = opts.thresh ?? 0.3;
  const boxThresh = opts.boxThresh ?? 0.6;
  const unclipRatio = opts.unclipRatio ?? 1.5;
  const minSide = opts.minSide ?? 3;
  const maxBoxes = opts.maxBoxes ?? 1000;
  if (!prob || mapW < 2 || mapH < 2) return [];
  const mask = new Uint8Array(mapW * mapH);
  for (let i = 0; i < mask.length; i++) if (prob[i] >= thresh) mask[i] = 1;
  const sx = srcW / mapW;
  const sy = srcH / mapH;
  const raw = [];
  for (const c of labelComponents(mask, mapW, mapH)) {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    if (bw < minSide || bh < minSide) continue;
    let sum = 0;
    let n = 0;
    for (let y = c.y0; y <= c.y1; y++) {
      const row = y * mapW;
      for (let x = c.x0; x <= c.x1; x++) { sum += prob[row + x]; n++; }
    }
    const score = n ? sum / n : 0;
    if (score < boxThresh) continue;
    const peri = 2 * (bw + bh);
    const d = peri > 0 ? ((bw * bh) * unclipRatio) / peri : 0;
    let x0 = (c.x0 - d) * sx;
    let y0 = (c.y0 - d) * sy;
    let x1 = (c.x1 + 1 + d) * sx;
    let y1 = (c.y1 + 1 + d) * sy;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(srcW, x1);
    y1 = Math.min(srcH, y1);
    if (x1 - x0 < minSide || y1 - y0 < minSide) continue;
    if ((x1 - x0) > 0.98 * srcW && (y1 - y0) > 0.5 * srcH) continue;
    raw.push({ x0, y0, x1, y1, score, angle: c.angle });
  }
  raw.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of raw) {
    if (kept.length >= maxBoxes) break;
    if (kept.some((other) => iou(other, box) > 0.5)) continue;
    kept.push(box);
  }
  return kept;
}

// Weighted median angle (degrees, y-down) of wide boxes. 0 when nothing qualifies.
export function dominantAngle(boxes) {
  const wide = [];
  for (const box of boxes || []) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (w > 3 * h && w > 30 && Math.abs(box.angle) <= 20) wide.push({ a: box.angle, w });
  }
  if (!wide.length) return 0;
  wide.sort((p, q) => p.a - q.a);
  const total = wide.reduce((s, r) => s + r.w, 0);
  let acc = 0;
  for (const row of wide) {
    acc += row.w;
    if (acc >= total / 2) return row.a;
  }
  return wide[wide.length - 1].a;
}
