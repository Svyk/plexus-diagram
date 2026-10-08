// Ruling lines from a rendered page: Otsu ink, then a run-length port of the helper's
// OpenCV morphological open (long horizontal / vertical bars) plus the dash/star ink check.

import { labelComponents } from "./components.js";

export function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let thresh = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between >= max) { max = between; thresh = t; }
  }
  return thresh;
}

function inkMask(gray, width, height) {
  const thresh = otsuThreshold(gray);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) if (gray[i] <= thresh) mask[i] = 1;
  return mask;
}

// Binary erosion or dilation with a 1-d kernel. Border is empty, matching OpenCV's default.
// Prefix counts keep a full-page open at 300 dpi linear in the pixel count.
function morph1d(mask, width, height, length, horizontal, dilate) {
  const out = new Uint8Array(width * height);
  if (length <= 1) { out.set(mask); return out; }
  const anchor = Math.floor((length - 1) / 2);
  if (horizontal) {
    const prefix = new Uint32Array(width + 1);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x] + mask[row + x];
      for (let x = 0; x < width; x++) {
        const a = x - anchor;
        const b = a + length - 1;
        if (a < 0 || b >= width) continue;
        const count = prefix[b + 1] - prefix[a];
        out[row + x] = dilate ? (count > 0 ? 1 : 0) : (count === length ? 1 : 0);
      }
    }
    return out;
  }
  const prefix = new Uint32Array(height + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y] + mask[y * width + x];
    for (let y = 0; y < height; y++) {
      const a = y - anchor;
      const b = a + length - 1;
      if (a < 0 || b >= height) continue;
      const count = prefix[b + 1] - prefix[a];
      out[y * width + x] = dilate ? (count > 0 ? 1 : 0) : (count === length ? 1 : 0);
    }
  }
  return out;
}

function open1d(mask, width, height, length, horizontal) {
  return morph1d(morph1d(mask, width, height, length, horizontal, false), width, height, length, horizontal, true);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// gray: Uint8Array, row-major, 0 = black. scale = pixels per point (dpi / 72).
// fills (from fillsFromCanvas): a dark fill is ink to the open, so the bars between white
// letters on it come out as short rules; rules that lie inside a fill are dropped.
export function rulesFromCanvas(gray, width, height, scale, { minLenPt = 18, fills = [] } = {}) {
  if (!gray || width < 8 || height < 8 || !(scale > 0)) return [];
  const ink = inkMask(gray, width, height);
  const minLen = Math.max(8, Math.round(minLenPt * scale));
  const maxThick = Math.max(6, 4 * scale);
  const out = [];
  const axes = [
    ["h", Math.max(20, Math.floor(width / 60))],
    ["v", Math.max(20, Math.floor(height / 60))],
  ];
  for (const [axis, kernel] of axes) {
    const horizontal = axis === "h";
    let opened = open1d(ink, width, height, kernel, horizontal);
    const bridge = Math.max(1, Math.floor(kernel / 2));
    opened = morph1d(opened, width, height, bridge, horizontal, true);
    opened = morph1d(opened, width, height, bridge, horizontal, false);
    for (const c of labelComponents(opened, width, height)) {
      const bw = c.x1 - c.x0 + 1;
      const bh = c.y1 - c.y0 + 1;
      const length = horizontal ? bw : bh;
      const thick = horizontal ? bh : bw;
      if (length < minLen || thick > maxThick) continue;
      if (horizontal) {
        out.push({
          x0: round2(c.x0 / scale),
          y0: round2((c.y0 + bh / 2) / scale),
          x1: round2((c.x1 + 1) / scale),
          y1: round2((c.y0 + bh / 2) / scale),
          thick: round2(bh / scale),
        });
      } else {
        out.push({
          x0: round2((c.x0 + bw / 2) / scale),
          y0: round2(c.y0 / scale),
          x1: round2((c.x0 + bw / 2) / scale),
          y1: round2((c.y1 + 1) / scale),
          thick: round2(bw / scale),
        });
      }
    }
  }
  out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return fills.length ? out.filter((r) => !fills.some((f) => insideFill(r, f))) : out;
}

// A rule strictly inside a fill across its axis and within it along its axis. Real borders
// split a fill (they are another shade), so they sit on fill edges, never strictly inside.
function insideFill(r, f, m = 1) {
  if (r.y0 === r.y1) return r.y0 > f.y0 + m && r.y0 < f.y1 - m && r.x0 >= f.x0 - m && r.x1 <= f.x1 + m;
  return r.x0 > f.x0 + m && r.x0 < f.x1 - m && r.y0 >= f.y0 - m && r.y1 <= f.y1 + m;
}

// A placeholder the recogniser skips: one thin wide run is a dash, one small blob is a star.
export function inkGlyph(gray, width, height) {
  if (!gray || width < 2 || height < 2) return null;
  const ink = inkMask(gray, width, height);
  const marks = [];
  for (const c of labelComponents(ink, width, height)) {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    if (bw >= 0.8 * width || bh >= 0.8 * height) continue;
    if (c.area < 16 || (bw <= 4 && bh <= 5)) continue;
    if (c.y1 >= height - 2 && bh <= 0.3 * height) continue;
    marks.push({ bw, bh, area: c.area });
  }
  if (marks.length !== 1) return null;
  const { bw, bh, area } = marks[0];
  if (bw >= 3 * bh && bw >= 8 && bh <= 0.3 * height && area >= 0.6 * bw * bh) return "—";
  if (bw / Math.max(1, bh) >= 0.6 && bw / Math.max(1, bh) <= 1.6 && bw <= 0.5 * height && bh <= 0.5 * height && bw >= 5) return "*";
  return null;
}

// Filled regions (header fills, zebra rows, shaded cells) from a rendered page: flat areas of
// one grey level, darker than the paper, with four straight edges. Grown on a ~0.5 pt grid from
// seeds whose 3×3 neighbourhood is flat (anti-aliased glyph edges never seed), each region
// keeps pixels within `tol` of its seed, so text on a fill leaves holes but does not join, and
// two touching fills of different shades stay two boxes. A 3-sample close mends seams between
// abutting fills of one colour, then a morphological open (`openPt`) cuts thin strokes of the
// same colour (a table frame joining every fill) before the shape tests. Returns boxes in points with the fill's grey (0 black … 1 white).
export function fillsFromCanvas(gray, width, height, scale, { tol = 14, minWPt = 8, minHPt = 4, edge = 0.7, solid = 0.55, openPt = 2 } = {}) {
  if (!gray || width < 8 || height < 8 || !(scale > 0)) return [];
  const step = Math.max(1, Math.floor(scale / 2));
  const sw = Math.floor(width / step);
  const sh = Math.floor(height / step);
  if (sw < 4 || sh < 4) return [];
  const g = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) g[y * sw + x] = gray[(y * step) * width + x * step];
  // Paper: the most common level above the ink threshold.
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const ink = otsuThreshold(g);
  let paper = 255;
  let best = -1;
  for (let v = ink + 1; v < 256; v++) if (hist[v] > best) { best = hist[v]; paper = v; }
  const seedMax = paper - 2 * tol;
  if (seedMax <= 0) return [];
  const per = scale / step;
  const minW = minWPt * per;
  const minH = minHPt * per;
  // Odd, so the open's erosion and dilation windows are centred and the result stays inside
  // the region.
  const k = 2 * Math.floor(Math.max(3, Math.round(openPt * per)) / 2) + 1;
  const label = new Int32Array(sw * sh);
  const queue = new Int32Array(sw * sh);
  const pageArea = sw * sh;
  const out = [];
  let next = 0;
  for (let sy = 1; sy < sh - 1; sy++) {
    for (let sx = 1; sx < sw - 1; sx++) {
      const s = sy * sw + sx;
      if (label[s] || g[s] > seedMax) continue;
      let lo = 255;
      let hi = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = g[s + dy * sw + dx];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > 6) continue;
      const id = ++next;
      const seed = g[s];
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      label[s] = id;
      let x0 = sx; let x1 = sx; let y0 = sy; let y1 = sy;
      while (head < tail) {
        const i = queue[head++];
        const x = i % sw;
        const y = (i - x) / sw;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0) { const j = i - 1; if (!label[j] && Math.abs(g[j] - seed) <= tol) { label[j] = id; queue[tail++] = j; } }
        if (x + 1 < sw) { const j = i + 1; if (!label[j] && Math.abs(g[j] - seed) <= tol) { label[j] = id; queue[tail++] = j; } }
        if (y > 0) { const j = i - sw; if (!label[j] && Math.abs(g[j] - seed) <= tol) { label[j] = id; queue[tail++] = j; } }
        if (y + 1 < sh) { const j = i + sw; if (!label[j] && Math.abs(g[j] - seed) <= tol) { label[j] = id; queue[tail++] = j; } }
      }
      if (x1 - x0 + 1 < minW || y1 - y0 + 1 < minH || tail < 0.5 * minW * minH) continue;
      // Region mask in a padded local frame, opened with a k×k square.
      const lw = x1 - x0 + 1 + 2 * k;
      const lh = y1 - y0 + 1 + 2 * k;
      const local = new Uint8Array(lw * lh);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (label[y * sw + x] === id) local[(y - y0 + k) * lw + (x - x0 + k)] = 1;
      // Close first: two abutting fills of one colour leave a lighter anti-aliased seam one
      // sample wide, which the open would widen into a cut.
      let closed = morph1d(local, lw, lh, 3, true, true);
      closed = morph1d(closed, lw, lh, 3, false, true);
      closed = morph1d(closed, lw, lh, 3, true, false);
      closed = morph1d(closed, lw, lh, 3, false, false);
      let opened = morph1d(closed, lw, lh, k, true, false);
      opened = morph1d(opened, lw, lh, k, false, false);
      opened = morph1d(opened, lw, lh, k, true, true);
      opened = morph1d(opened, lw, lh, k, false, true);
      for (const part of flatParts(opened, lw, lh)) {
        const bw = part.x1 - part.x0 + 1;
        const bh = part.y1 - part.y0 + 1;
        if (bw < minW || bh < minH) continue;
        if (bw * bh >= 0.8 * pageArea || part.area < solid * bw * bh) continue;
        // Four straight edges: the first row/column inside each side is mostly this region.
        const share = (ax, ay, bx, by) => {
          let hit = 0; let n = 0;
          for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { n++; if (part.mask[y * lw + x]) hit++; }
          return n ? hit / n : 0;
        };
        const iy0 = Math.min(part.y1, part.y0 + 1); const iy1 = Math.max(part.y0, part.y1 - 1);
        const ix0 = Math.min(part.x1, part.x0 + 1); const ix1 = Math.max(part.x0, part.x1 - 1);
        if (share(part.x0, iy0, part.x1, iy0) < edge || share(part.x0, iy1, part.x1, iy1) < edge) continue;
        if (share(ix0, part.y0, ix0, part.y1) < edge || share(ix1, part.y0, ix1, part.y1) < edge) continue;
        // Square corners: an opened rectangle keeps them; a rounded bar or badge does not. One
        // corner may be lost to anti-aliasing where two rules meet.
        const corners = part.mask[part.y0 * lw + part.x0] + part.mask[part.y0 * lw + part.x1] + part.mask[part.y1 * lw + part.x0] + part.mask[part.y1 * lw + part.x1];
        if (corners < 3) continue;
        let sum = 0; let n = 0;
        for (let y = part.y0; y <= part.y1; y++) for (let x = part.x0; x <= part.x1; x++) {
          if (!part.mask[y * lw + x] || !local[y * lw + x]) continue;
          sum += g[(y + y0 - k) * sw + (x + x0 - k)];
          n++;
        }
        const gx0 = part.x0 + x0 - k;
        const gy0 = part.y0 + y0 - k;
        out.push({
          x0: round2((gx0 * step) / scale),
          y0: round2((gy0 * step) / scale),
          x1: round2(((gx0 + bw) * step) / scale),
          y1: round2(((gy0 + bh) * step) / scale),
          gray: Math.round((sum / n / 255) * 1000) / 1000,
        });
      }
    }
  }
  out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return out;
}

// 4-connected parts of a small binary mask, each with its own membership mask.
function flatParts(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const parts = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const own = new Uint8Array(w * h);
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    let x0 = w; let x1 = -1; let y0 = h; let y1 = -1;
    while (head < tail) {
      const i = queue[head++];
      own[i] = 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1]) {
        if (j < 0 || seen[j] || !mask[j]) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    parts.push({ x0, y0, x1, y1, area: tail, mask: own });
  }
  return parts;
}
