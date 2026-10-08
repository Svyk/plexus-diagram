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
export function rulesFromCanvas(gray, width, height, scale, { minLenPt = 18 } = {}) {
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
  return out;
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
