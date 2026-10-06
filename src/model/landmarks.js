// Landmarks and the Walk (MEM-7). Pure. Reading order buckets y to 200 world px, then x.
// This is not board.readingOrder, which stays exact y-then-x for the outline.

export const READ_BUCKET = 200;
export const LANDMARK_PX = { S: 48, M: 72, L: 96 };

// Same box as the minimap canvas in chrome.js. Dots are an overlay; the canvas is not ours.
export const MINIMAP_W = 180;
export const MINIMAP_H = 120;
const MINIMAP_PAD = 40;

export function landmarkUids(board) {
  if (!board?.items) return [];
  const out = [];
  const ids = board.order || [...board.items.keys()];
  for (const uid of ids) {
    if (board.items.get(uid)?.landmark === true) out.push(uid);
  }
  return out;
}

const posOf = (uid, rects) => {
  const r = rects?.get?.(uid);
  return { y: r?.y ?? 0, x: r?.x ?? 0, r };
};

export function readingLandmarkOrder(uids, rects) {
  return [...(uids || [])].sort((a, b) => {
    const pa = posOf(a, rects);
    const pb = posOf(b, rects);
    const ba = Math.floor(pa.y / READ_BUCKET);
    const bb = Math.floor(pb.y / READ_BUCKET);
    return ba - bb || pa.x - pb.x || pa.y - pb.y || (a < b ? -1 : a > b ? 1 : 0);
  });
}

const centerOf = (uid, rects) => {
  const r = rects?.get?.(uid);
  return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 0, y: 0 };
};

// Greedy nearest neighbour. The first stop is the reading-order first.
export function nearestNextOrder(uids, rects) {
  const list = readingLandmarkOrder(uids, rects);
  if (list.length < 2) return list;
  const left = new Set(list.slice(1));
  const out = [list[0]];
  while (left.size) {
    const cur = centerOf(out[out.length - 1], rects);
    let best = null;
    let bestD = Infinity;
    for (const uid of left) {
      const p = centerOf(uid, rects);
      const d = (p.x - cur.x) ** 2 + (p.y - cur.y) ** 2;
      if (d < bestD || (d === bestD && (best == null || uid < best))) {
        bestD = d;
        best = uid;
      }
    }
    out.push(best);
    left.delete(best);
  }
  return out;
}

// A rect at least one viewport, centered on the landmark. screen is world px (w/h or width/height).
export function neighbourhoodRect(rect, screen) {
  if (!rect) return null;
  const sw = Number(screen?.w ?? screen?.width);
  const sh = Number(screen?.h ?? screen?.height);
  const w = Math.max(rect.w, Number.isFinite(sw) && sw > 0 ? sw : rect.w);
  const h = Math.max(rect.h, Number.isFinite(sh) && sh > 0 ? sh : rect.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// Landmark plus every item whose center falls in the neighbourhood. Uses world rects.
export function membersIn(board, rects, focusRect, focusUid) {
  const out = new Set();
  if (focusUid) out.add(focusUid);
  if (!board || !focusRect || !rects) return out;
  const right = focusRect.x + focusRect.w;
  const bottom = focusRect.y + focusRect.h;
  for (const uid of board.order || []) {
    const r = rects.get(uid);
    if (!r) continue;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (cx >= focusRect.x && cx <= right && cy >= focusRect.y && cy <= bottom) out.add(uid);
  }
  return out;
}

export function landmarkClass(item) {
  if (!item?.landmark) return "";
  const size = item.size === "S" || item.size === "L" ? item.size : "M";
  const base = item.type === "section" ? "pxd-section--landmark" : "pxd-item--landmark";
  return `${base} pxd-landmark--${size}`;
}

// Matches chrome.js computeScale, including the viewport rect, so overlay dots sit on the canvas marks.
export function minimapScale(rects, size, vp) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (r) => {
    if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + (Number.isFinite(r.w) ? r.w : 0));
    maxY = Math.max(maxY, r.y + (Number.isFinite(r.h) ? r.h : 0));
  };
  if (rects && typeof rects.values === "function") for (const r of rects.values()) add(r);
  if (vp && size && vp.zoom) add({ x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: size.width / vp.zoom, h: size.height / vp.zoom });
  if (!Number.isFinite(minX)) return null;
  minX -= MINIMAP_PAD;
  minY -= MINIMAP_PAD;
  maxX += MINIMAP_PAD;
  maxY += MINIMAP_PAD;
  const s = Math.min(MINIMAP_W / (maxX - minX), MINIMAP_H / (maxY - minY));
  return {
    s,
    ox: (MINIMAP_W - (maxX - minX) * s) / 2 - minX * s,
    oy: (MINIMAP_H - (maxY - minY) * s) / 2 - minY * s,
  };
}

export function landmarkDots(board, rects, vp, size) {
  const sc = minimapScale(rects, size, vp);
  if (!sc || !board) return [];
  const out = [];
  for (const uid of landmarkUids(board)) {
    const r = rects?.get?.(uid);
    if (!r) continue;
    const item = board.items.get(uid);
    out.push({
      uid,
      glyph: item?.glyph || "",
      x: (r.x + r.w / 2) * sc.s + sc.ox,
      y: (r.y + r.h / 2) * sc.s + sc.oy,
    });
  }
  return out;
}

// Presenter stops. mode is "reading", "nearest", or "trail". Off-board trail stops (no rect) are left out.
export function walkStops(board, rects, { mode = "reading", screen, trail } = {}) {
  if (!board) return [];
  if (mode === "trail") {
    const out = [];
    for (const stop of trail?.stops || []) {
      const rect = rects?.get?.(stop.ref);
      if (!rect) continue;
      const item = board.items.get(stop.ref);
      const focus = neighbourhoodRect(rect, screen) || rect;
      out.push({
        uid: stop.ref,
        rect: focus,
        title: item?.title || stop.ref,
        note: stop.note || "",
        members: membersIn(board, rects, focus, stop.ref),
      });
    }
    return out;
  }
  const order = mode === "nearest"
    ? nearestNextOrder(landmarkUids(board), rects)
    : readingLandmarkOrder(landmarkUids(board), rects);
  const out = [];
  for (const uid of order) {
    const rect = rects?.get?.(uid);
    if (!rect) continue;
    const item = board.items.get(uid);
    const focus = neighbourhoodRect(rect, screen) || rect;
    out.push({
      uid,
      rect: focus,
      title: item?.title || "",
      note: "",
      members: membersIn(board, rects, focus, uid),
    });
  }
  return out;
}
