// Bbox overlay for the parsed view. Regions sit inside the reader page element.
// No fill, no pointer events on the region, no setPointerCapture, no graph writes.

import { applyPoint } from "../model/parse/lines.js";
import { viewportTransform } from "../model/parse/index.js";

const FADE_MS = 150;

export function normRotation(rotation) {
  const n = Number(rotation) || 0;
  return ((n % 360) + 360) % 360;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boxOf(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const x0 = num(bbox[0]);
  const y0 = num(bbox[1]);
  const x1 = num(bbox[2]);
  const y1 = num(bbox[3]);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function viewportSize(w, h, rotation) {
  const r = normRotation(rotation);
  if (r === 90 || r === 270) return { w: h, h: w };
  return { w, h };
}

// PDF user space (origin bottom-left, y up) → top-left viewport points.
export function userBoxToViewport(bbox, page) {
  const box = boxOf(bbox);
  if (!box) return null;
  const w = num(page?.w, 1) || 1;
  const h = num(page?.h, 1) || 1;
  const m = viewportTransform(w, h, normRotation(page?.rotation));
  const corners = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ];
  const pts = corners.map(([x, y]) => applyPoint(m, x, y));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// A page whose text runs sideways (engine `textRotation` ±90/180) stores its geometry in the text's
// own frame: frame = R(-textRotation) · viewport + t, with page.w × page.h the frame size. This is the
// inverse, back to top-left viewport points, plus the viewport size. Exact for multiples of 90°.
export function frameBoxToViewport(bbox, page) {
  const box = boxOf(bbox);
  if (!box) return null;
  const fw = num(page?.w, 1) || 1;
  const fh = num(page?.h, 1) || 1;
  const tr = Math.round(num(page?.textRotation) / 90) * 90;
  if (!(normRotation(tr))) return { box, vw: fw, vh: fh };
  const quarter = normRotation(tr) % 180 === 90;
  const vw = quarter ? fh : fw;
  const vh = quarter ? fw : fh;
  const rad = (-tr * Math.PI) / 180;
  const a = Math.round(Math.cos(rad));
  const b = Math.round(Math.sin(rad));
  const c = -b;
  const d = a;
  const xs = [0, vw, vw, 0].map((x, i) => a * x + c * [0, 0, vh, vh][i]);
  const ys = [0, vw, vw, 0].map((x, i) => b * x + d * [0, 0, vh, vh][i]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const pts = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map(([fx, fy]) => {
    const u = fx + minX;
    const w = fy + minY;
    return [a * u + b * w, c * u + d * w];
  });
  const px = pts.map((p) => p[0]);
  const py = pts.map((p) => p[1]);
  return { box: [Math.min(...px), Math.min(...py), Math.max(...px), Math.max(...py)], vw, vh };
}

// Viewport box and size for a stored bbox (frame-aware) or a user-space box (page.userSpace).
export function viewportBox(bbox, page) {
  if (page?.userSpace) {
    const box = userBoxToViewport(bbox, page);
    if (!box) return null;
    const size = viewportSize(num(page?.w, 1) || 1, num(page?.h, 1) || 1, page?.rotation);
    return { box, vw: size.w || 1, vh: size.h || 1 };
  }
  return frameBoxToViewport(bbox, page);
}

// bbox is top-left viewport points in page.w × page.h (the text frame when page.textRotation is set),
// unless page.userSpace. scale = pageEl.clientWidth / viewport width.
export function bboxToPageRect(bbox, page, pageEl) {
  const at = viewportBox(bbox, page);
  if (!at) return null;
  const { box, vw } = at;
  const client = num(pageEl?.clientWidth, 0);
  const scale = (client > 0 ? client : vw) / vw;
  return {
    left: box[0] * scale,
    top: box[1] * scale,
    width: (box[2] - box[0]) * scale,
    height: (box[3] - box[1]) * scale,
    scale,
  };
}

// The same box in percent of the page element: survives reader zoom without a layout read.
export function bboxToPagePercent(bbox, page) {
  const at = viewportBox(bbox, page);
  if (!at) return null;
  const { box, vw, vh } = at;
  return {
    left: (box[0] / vw) * 100,
    top: (box[1] / vh) * 100,
    width: ((box[2] - box[0]) / vw) * 100,
    height: ((box[3] - box[1]) / vh) * 100,
  };
}

function place(node, rect) {
  node.style.position = "absolute";
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${Math.max(0, rect.width)}px`;
  node.style.height = `${Math.max(0, rect.height)}px`;
}

export function createParseOverlay({ doc, pageEl, pageOf, onResplit } = {}) {
  const owned = [];
  const bound = [];
  let fadeTimer = null;
  let drag = null;
  const win = () => doc?.defaultView || null;

  const dropNode = (node) => {
    try { node?.remove?.(); } catch { /* gone */ }
  };

  const clearNow = () => {
    if (fadeTimer != null) {
      const w = win();
      (w?.clearTimeout || clearTimeout)(fadeTimer);
      fadeTimer = null;
    }
    endDrag();
    while (bound.length) {
      const [node, type, fn, capture] = bound.pop();
      try { node?.removeEventListener?.(type, fn, capture); } catch { /* gone */ }
    }
    while (owned.length) dropNode(owned.pop());
  };

  const track = (node, type, fn, capture = false) => {
    node.addEventListener(type, fn, capture);
    bound.push([node, type, fn, capture]);
  };

  const endDrag = () => {
    const state = drag;
    drag = null;
    if (!state) return;
    const w = win();
    w?.removeEventListener?.("pointermove", state.move, true);
    w?.removeEventListener?.("pointerup", state.up, true);
    w?.removeEventListener?.("pointercancel", state.up, true);
  };

  const pageBox = (pageNumber) => {
    const el = pageEl?.(pageNumber);
    const info = pageOf?.(pageNumber) || {};
    return { el, info };
  };

  const add = (parent, cls) => {
    const node = doc.createElement("div");
    node.className = cls;
    node.style.pointerEvents = "none";
    parent.append(node);
    owned.push(node);
    return node;
  };

  const show = (block) => {
    clearNow();
    if (!block || !doc) return null;
    const pageNumber = block.page;
    const { el, info } = pageBox(pageNumber);
    if (!el) return null;
    const rect = bboxToPageRect(block.bbox, info, el);
    if (!rect) return null;
    const node = add(el, "pxd-parse-region");
    place(node, rect);
    node.setAttribute("data-block", block.id || "");
    return node;
  };

  const showGrid = (table) => {
    clearNow();
    if (!table || !doc) return;
    const { el, info } = pageBox(table.page);
    if (!el) return;
    const grid = table.grid || {};
    const xs = Array.isArray(grid.xs) ? grid.xs : [];
    const ys = Array.isArray(grid.ys) ? grid.ys : [];
    const tableRect = bboxToPageRect(table.bbox, info, el);
    if (tableRect) {
      const frame = add(el, "pxd-parse-region pxd-parse-region--table");
      place(frame, tableRect);
    }
    for (let r = 0; r < ys.length - 1; r += 1) {
      for (let c = 0; c < xs.length - 1; c += 1) {
        const cell = bboxToPageRect([xs[c], ys[r], xs[c + 1], ys[r + 1]], info, el);
        if (!cell) continue;
        const node = add(el, "pxd-parse-grid");
        place(node, cell);
      }
    }
    for (const cell of table.cells || []) {
      const rs = cell.rowSpan ?? 1;
      const cs = cell.colSpan ?? 1;
      if (rs < 2 && cs < 2) continue;
      const rect = bboxToPageRect(cell.bbox, info, el);
      if (!rect) continue;
      const node = add(el, "pxd-parse-merge");
      place(node, rect);
    }
    // Column handles drag along the frame's x axis, which is not the screen's on a sideways page.
    const upright = !normRotation(Math.round(num(info?.textRotation) / 90) * 90);
    for (let i = 1; upright && i < xs.length - 1; i += 1) {
      const line = bboxToPageRect([xs[i], ys[0] ?? table.bbox?.[1] ?? 0, xs[i], ys[ys.length - 1] ?? table.bbox?.[3] ?? 0], info, el);
      if (!line) continue;
      const handle = doc.createElement("div");
      handle.className = "pxd-parse-col";
      handle.style.position = "absolute";
      handle.style.left = `${line.left - 3}px`;
      handle.style.top = `${line.top}px`;
      handle.style.width = "6px";
      handle.style.height = `${Math.max(0, line.height)}px`;
      handle.style.pointerEvents = "auto";
      handle.setAttribute("data-col", String(i));
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      el.append(handle);
      owned.push(handle);
      const onDown = (event) => {
        if (event.button != null && event.button !== 0) return;
        event.stopPropagation?.();
        const scale = line.scale || bboxToPageRect([0, 0, 1, 1], info, el)?.scale || 1;
        const startX = num(event.clientX);
        const origin = xs.slice();
        const move = (ev) => {
          const dx = (num(ev.clientX) - startX) / scale;
          const next = origin.slice();
          const lo = origin[i - 1] + 4;
          const hi = origin[i + 1] - 4;
          next[i] = Math.min(hi, Math.max(lo, origin[i] + dx));
          const moved = bboxToPageRect([next[i], 0, next[i], 1], info, el);
          if (moved) handle.style.left = `${moved.left - 3}px`;
          drag.xs = next;
        };
        const up = () => {
          const xsNext = drag?.xs;
          endDrag();
          if (xsNext && typeof onResplit === "function") onResplit(table, xsNext);
        };
        endDrag();
        drag = { move, up, xs: origin.slice() };
        const w = win();
        w?.addEventListener?.("pointermove", move, true);
        w?.addEventListener?.("pointerup", up, true);
        w?.addEventListener?.("pointercancel", up, true);
      };
      track(handle, "pointerdown", onDown);
    }
  };

  return {
    show,
    showGrid,
    flash(block) {
      const node = show(block);
      if (!node) return;
      node.classList.add("pxd-parse-region--flash");
    },
    hide() {
      for (const node of owned) node.classList.add("pxd-parse-region--fade");
      const w = win();
      const later = w?.setTimeout || setTimeout;
      if (fadeTimer != null) (w?.clearTimeout || clearTimeout)(fadeTimer);
      fadeTimer = later(() => { fadeTimer = null; clearNow(); }, FADE_MS);
    },
    dispose() {
      clearNow();
    },
  };
}
