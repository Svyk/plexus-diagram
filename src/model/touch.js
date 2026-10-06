// Two-finger camera and long-press. No DOM, no writes. Zoom goes through the same zoomAt as the trackpad pinch.

import { zoomAt } from "./geometry.js";

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_OPEN_PX = 8;
export const LONG_PRESS_CANCEL_PX = 20;

export function pointerDistance(a, b) {
  return Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0));
}

export function pointerMidpoint(a, b) {
  return { x: ((a?.x || 0) + (b?.x || 0)) / 2, y: ((a?.y || 0) + (b?.y || 0)) / 2 };
}

export function fingerPair(points) {
  if (!points || points.length < 2) return null;
  const a = points[0];
  const b = points[1];
  return { a, b, dist: pointerDistance(a, b), mid: pointerMidpoint(a, b) };
}

// One shot from the gesture start: zoom around the first midpoint, then slide by how far the midpoint moved.
// An unchanged distance is a pan. The world point under the fingers stays under them.
export function pinchViewport(vp, { dist0 = 0, mid0, dist = 0, mid } = {}) {
  const base = { x: Number(vp?.x) || 0, y: Number(vp?.y) || 0, zoom: Number(vp?.zoom) || 1 };
  const from = mid0 || { x: 0, y: 0 };
  const to = mid || from;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let zoomed = base;
  if (dist0 > 0 && dist > 0 && dist !== dist0) zoomed = zoomAt(base, from, dist / dist0);
  return { x: zoomed.x + dx, y: zoomed.y + dy, zoom: zoomed.zoom };
}

// "open" once the timer has elapsed and the finger stayed under 8px.
// "cancel" at 20px, before or after the timer. The band between is neither.
export function longPressAt(movement, elapsed = LONG_PRESS_MS) {
  const moved = Number(movement) || 0;
  if (moved >= LONG_PRESS_CANCEL_PX) return "cancel";
  if (elapsed >= LONG_PRESS_MS && moved < LONG_PRESS_OPEN_PX) return "open";
  return "wait";
}
