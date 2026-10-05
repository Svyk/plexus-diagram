// REG-5. Preview veil boxes and the camera that centres a region or pins a view.

import { clampZoom, visibleWorldRect } from "../model/geometry.js";

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function fracParts(frac) {
  if (Array.isArray(frac)) return { rx: frac[0], ry: frac[1], rw: frac[2], rh: frac[3] };
  return frac || {};
}

function viewParts(v) {
  if (Array.isArray(v)) return { x: v[0], y: v[1], w: v[2], h: v[3] };
  return v || {};
}

// Scale is min(1, max / w, max / h). Never upscales. A zero side is null.
export function previewImageBox(w, h, max = 480) {
  if (![w, h, max].every((n) => finite(n) && n > 0)) return null;
  const scale = Math.min(1, max / w, max / h);
  return { w: w * scale, h: h * scale, scale };
}

export function holeRect(box, frac) {
  const parts = fracParts(frac);
  const bw = Number(box?.w ?? box?.width);
  const bh = Number(box?.h ?? box?.height);
  const rx = Number(parts.rx);
  const ry = Number(parts.ry);
  const rw = Number(parts.rw);
  const rh = Number(parts.rh);
  if (![bw, bh, rx, ry, rw, rh].every(finite)) return null;
  if (!(bw > 0) || !(bh > 0)) return null;
  return { x: rx * bw, y: ry * bh, w: rw * bw, h: rh * bh };
}

export function regionZoom(worldW, worldH) {
  return clampZoom(240 / Math.min(worldW, worldH));
}

// Fraction is mapped onto the image rect in world space, never a card rect.
export function regionCamera({ imageRect, frac, size } = {}) {
  const parts = fracParts(frac);
  const rx = Number(parts.rx);
  const ry = Number(parts.ry);
  const rw = Number(parts.rw);
  const rh = Number(parts.rh);
  const ix = Number(imageRect?.x);
  const iy = Number(imageRect?.y);
  const iw = Number(imageRect?.w ?? imageRect?.width);
  const ih = Number(imageRect?.h ?? imageRect?.height);
  const vw = Number(size?.width);
  const vh = Number(size?.height);
  if (![rx, ry, rw, rh, ix, iy, iw, ih, vw, vh].every(finite)) return null;
  if (!(iw > 0) || !(ih > 0) || !(rw > 0) || !(rh > 0) || !(vw > 0) || !(vh > 0)) return null;
  const worldW = rw * iw;
  const worldH = rh * ih;
  const centerX = ix + rx * iw + worldW / 2;
  const centerY = iy + ry * ih + worldH / 2;
  const zoom = regionZoom(worldW, worldH);
  return { x: vw / 2 - centerX * zoom, y: vh / 2 - centerY * zoom, zoom };
}

// Pins the view top-left. Zoom is the tighter axis, then clampZoom.
export function setCameraFromView(v, size) {
  const view = viewParts(v);
  const x = Number(view.x);
  const y = Number(view.y);
  const w = Number(view.w);
  const h = Number(view.h);
  const vw = Number(size?.width);
  const vh = Number(size?.height);
  if (![x, y, w, h, vw, vh].every(finite)) return null;
  if (!(w > 0) || !(h > 0) || !(vw > 0) || !(vh > 0)) return null;
  const zoom = clampZoom(Math.min(vw / w, vh / h));
  return { x: -x * zoom, y: -y * zoom, zoom };
}

export function cameraRectOf(vp, size) {
  return visibleWorldRect(vp, size, 0);
}
