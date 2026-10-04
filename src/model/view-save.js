// REG-6. A saved view is one k=view block. This file only builds the string and the rect.

import { boundsOf } from "./board.js";
import { inflate } from "./geometry.js";
import { normalizeView, serializeRegion } from "./regions.js";

export const VIEW_PAD = 48;
export const VIEW_ID_CAP = 24;
const ID_RE = /^[A-Za-z0-9_-]+$/;

export function viewBlockString({ drawingUid, caption = "", v, ids } = {}) {
  const rect = normalizeView(Array.isArray(v) ? v : [v?.x, v?.y, v?.w, v?.h]);
  if (!rect) return null;
  const clean = [];
  for (const id of ids || []) {
    if (clean.length >= VIEW_ID_CAP) break;
    if (typeof id === "string" && ID_RE.test(id)) clean.push(id);
  }
  return serializeRegion({
    kind: "view",
    drawingUid,
    caption,
    v: rect,
    ...(clean.length ? { ids: clean } : {}),
  });
}

export function selectionViewRect(rects) {
  const bounds = boundsOf(rects || []);
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return null;
  return inflate(bounds, VIEW_PAD);
}

export function captionForView(sections, point, fallbackTitle) {
  let best = null;
  let bestArea = Infinity;
  for (const section of sections || []) {
    const rect = section?.rect;
    if (!rect || !point) continue;
    if (point.x < rect.x || point.y < rect.y || point.x > rect.x + rect.w || point.y > rect.y + rect.h) continue;
    const area = rect.w * rect.h;
    if (area < bestArea) {
      best = section;
      bestArea = area;
    }
  }
  if (best?.title) return best.title;
  return `View of ${fallbackTitle || "board"}`;
}
