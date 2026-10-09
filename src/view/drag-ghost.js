// U5. Card-shaped drag ghost for the reading pane: a text selection, a highlight row or a parsed block.
// The ghost is a real card (.pxd-item) in a fixed layer. It moves by transform only, once per animation
// frame; zones come from rects cached at drag start (no elementFromPoint while moving). It morphs from
// the source's shape to the card's in 150 ms, takes the board zoom over the board with a dashed outline,
// and the drop lands at the ghost's top-left. No graph writes, no pointer capture.

import { chromeObstacles } from "./avoid.js";

export const GHOST_W = 280;
export const MORPH_MS = 150;
export const LAND_MS = 120;
export const PANE_SCALE = 0.9;
// Click-to-place: below this board zoom the content preview is drawn larger than the footprint.
export const PLACE_PREVIEW_MIN = 0.6;
const PREVIEW_VIEW_FRACTION = 0.9;
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;

// Board zoom from the root's --pxd-screen-px (1 / zoom), set by the board view.
export function boardZoom(root, win = root?.ownerDocument?.defaultView || globalThis) {
  let raw = "";
  try { raw = root?.style?.getPropertyValue?.("--pxd-screen-px") || ""; } catch { raw = ""; }
  if (!raw) {
    try { raw = win?.getComputedStyle?.(root)?.getPropertyValue?.("--pxd-screen-px") || ""; } catch { raw = ""; }
  }
  const px = parseFloat(raw);
  return px > 0 ? clamp(1 / px, MIN_SCALE, MAX_SCALE) : 1;
}

const inside = (r, x, y) => Boolean(r) && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

// Where the pointer is, from rects cached at drag start.
export function zoneAt(x, y, { rootRect = null, paneRect = null, blocked = [] } = {}) {
  if (!inside(rootRect, x, y)) return "out";
  if (inside(paneRect, x, y)) return "pane";
  for (const r of blocked || []) if (inside(r, x, y)) return "blocked";
  return "board";
}

export function zoneScale(zone, zoom) {
  if (zone === "board") return clamp(num(zoom, 1) || 1, MIN_SCALE, MAX_SCALE);
  return PANE_SCALE;
}

// What the ghost shows. Text is clamped by CSS; a table keeps its first three rows (rowCap, colCap up to 12).
export function ghostContent(source = {}) {
  const kind = ["text", "table", "figure", "highlight", "blocks"].includes(source.kind) ? source.kind : "text";
  const text = String(source.text ?? "").replace(/\s+/g, " ").trim();
  const rowCap = clamp(Math.round(num(source.rowCap, 3)) || 3, 1, 12);
  const colCap = clamp(Math.round(num(source.colCap, 6)) || 6, 1, 12);
  const rows = Array.isArray(source.rows) ? source.rows.slice(0, rowCap).map((row) => (Array.isArray(row) ? row.slice(0, colCap).map((cell) => String(cell ?? "")) : [])) : [];
  const src = typeof source.src === "string" ? source.src : "";
  const color = typeof source.color === "string" ? source.color : "";
  const page = Number.isFinite(Number(source.page)) && Number(source.page) > 0 ? Number(source.page) : null;
  return { kind, text, rows, src, color, page };
}

// Ghost top-left for the pointer at the current per-axis scale; the grab point stays under the pointer.
export function ghostOrigin(pointer, grab, size, sx, sy) {
  return { x: pointer.x - grab.fx * size.w * sx, y: pointer.y - grab.fy * size.h * sy };
}

function buildGhost(doc, content) {
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    parent?.append?.(node);
    return node;
  };
  const card = el("div", "pxd-item pxd-item--card pxd-ghost");
  card.setAttribute("aria-hidden", "true");
  card.setAttribute("data-kind", content.kind);
  const body = el("div", "pxd-ghost__body", card);
  if (content.color) {
    const bar = el("span", "pxd-ghost__bar", body);
    bar.setAttribute("data-color", content.color);
  }
  if (content.kind === "table" && content.rows.length) {
    const table = el("table", "pxd-ghost__table", body);
    for (const row of content.rows) {
      const tr = el("tr", "", table);
      for (const cell of row) el("td", "", tr).textContent = cell;
    }
  } else if (content.kind === "figure" && content.src) {
    const img = el("img", "pxd-ghost__img", body);
    img.alt = "";
    img.src = content.src;
  }
  if (content.text && !(content.kind === "table" && content.rows.length)) el("div", "pxd-ghost__text", body).textContent = content.text;
  if (content.page) el("div", "pxd-ghost__page", body).textContent = `p. ${content.page}`;
  return card;
}

// from: client rect of the source (selection, row, block). pointer: client point at drag start.
export function createDragGhost({
  doc = globalThis.document,
  root,
  pane = null,
  from = null,
  pointer = { x: 0, y: 0 },
  content = {},
  zoom = null,
  blocked = null,
  width = GHOST_W,
  grab: grabAt = null,
  previewMin = null,
  footprint = null,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  const win = doc?.defaultView || globalThis;
  const host = root || doc?.body;
  const look = ghostContent(content);
  const node = buildGhost(doc, look);
  const ghostW = clamp(num(width, GHOST_W) || GHOST_W, 120, 1200);
  node.style.width = `${ghostW}px`;
  if (ghostW !== GHOST_W) node.style.maxWidth = "none";
  node.style.transform = "translate3d(-10000px, -10000px, 0)";
  host?.append?.(node);
  // One layout read at start: the fixed layer's origin (a transformed root moves it), the card height,
  // and the zones.
  let origin = { x: 0, y: 0 };
  let height = 120;
  try {
    node.style.transform = "translate3d(0px, 0px, 0)";
    const box = node.getBoundingClientRect?.();
    if (box) origin = { x: num(box.left), y: num(box.top) };
    height = num(node.offsetHeight, 0) || num(box?.height, 0) || 120;
  } catch { /* stub */ }
  const size = { w: ghostW, h: height };
  const rects = {
    rootRect: root?.getBoundingClientRect?.() || null,
    paneRect: pane?.getBoundingClientRect?.() || null,
    blocked: blocked || chromeObstacles(root, { win }),
  };
  if (rects.rootRect && !(rects.rootRect.right > rects.rootRect.left)) rects.rootRect = null;
  const zoomNow = zoom != null ? num(zoom, 1) : boardZoom(root, win);
  const start = { x: num(pointer?.x), y: num(pointer?.y) };
  const src = from && num(from.width) > 0 && num(from.height) > 0 ? from : { left: start.x - 8, top: start.y - 8, width: 16, height: 16 };
  const grab = grabAt ? { fx: clamp(num(grabAt.fx, 0.5), 0, 1), fy: clamp(num(grabAt.fy, 0.5), 0, 1) } : {
    fx: clamp((start.x - num(src.left)) / num(src.width, 1), 0, 1),
    fy: clamp((start.y - num(src.top)) / num(src.height, 1), 0, 1),
  };
  let current = { x: start.x, y: start.y };
  let zone = rects.rootRect ? zoneAt(start.x, start.y, rects) : "pane";
  let sx = clamp(num(src.width) / size.w, MIN_SCALE, MAX_SCALE);
  let sy = clamp(num(src.height) / size.h, MIN_SCALE, MAX_SCALE);
  const footSize = { w: clamp(num(footprint?.w, ghostW) || ghostW, 1, 4000), h: clamp(num(footprint?.h, size.h) || size.h, 1, 4000) };
  // Content scale: the board zoom, or a legible minimum (capped to the viewport) when previewMin is set.
  const targetScale = (z) => {
    if (z !== "board") return PANE_SCALE;
    const zoomScale = zoneScale(z, zoomNow);
    if (!(previewMin > 0) || zoomScale >= previewMin) return zoomScale;
    const room = num(rects.rootRect?.right) - num(rects.rootRect?.left) || num(win?.innerWidth, 0) || 0;
    const cap = room > 0 ? (room * PREVIEW_VIEW_FRACTION) / size.w : previewMin;
    return Math.max(zoomScale, Math.min(previewMin, cap));
  };
  const footing = () => zone === "board" && targetScale("board") > zoneScale("board", zoomNow) + 1e-6;
  let foot = null;
  let anim = { fromX: sx, fromY: sy, to: targetScale(zone), at: now(), ms: MORPH_MS };
  let raf = 0;
  let dirty = true;
  let ended = false;
  const timing = { frames: 0, total: 0, max: 0 };
  let painted = { x: NaN, y: NaN, sx: NaN, sy: NaN, zone: "" };

  const paintZone = () => {
    node.classList.toggle("pxd-ghost--board", zone === "board");
    node.classList.toggle("pxd-ghost--blocked", zone === "blocked" || zone === "out");
  };
  paintZone();
  node.style.transformOrigin = "0 0";

  // The dashed footprint at true board scale, where the insert lands. Only drawn when the preview is larger.
  const footRect = () => {
    const z = zoneScale("board", zoomNow);
    const w = footSize.w * z;
    const h = footSize.h * z;
    return { x: current.x - grab.fx * w, y: current.y - grab.fy * h, w, h };
  };
  function paintFoot() {
    const on = footing();
    if (!on) {
      if (foot) { try { foot.remove(); } catch { /* gone */ } foot = null; }
      return;
    }
    if (!foot) {
      foot = doc.createElement("div");
      foot.className = "pxd-ghost-foot";
      foot.setAttribute("aria-hidden", "true");
      host?.append?.(foot);
    }
    const r = footRect();
    foot.style.width = `${r.w.toFixed(1)}px`;
    foot.style.height = `${r.h.toFixed(1)}px`;
    foot.style.transform = `translate3d(${(r.x - origin.x).toFixed(1)}px, ${(r.y - origin.y).toFixed(1)}px, 0)`;
  }

  function frame(at = now()) {
    raf = 0;
    if (ended) return false;
    const t0 = now();
    const k = anim ? easeOut((at - anim.at) / anim.ms) : 1;
    if (anim) {
      sx = anim.fromX + (anim.to - anim.fromX) * k;
      sy = anim.fromY + (anim.to - anim.fromY) * k;
      if (k >= 1) anim = null;
    }
    const at2 = ghostOrigin(current, grab, size, sx, sy);
    paintFoot();
    if (dirty || at2.x !== painted.x || at2.y !== painted.y || sx !== painted.sx || sy !== painted.sy) {
      node.style.transform = `translate3d(${(at2.x - origin.x).toFixed(1)}px, ${(at2.y - origin.y).toFixed(1)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      if (painted.zone !== zone) paintZone();
      painted = { x: at2.x, y: at2.y, sx, sy, zone };
    }
    dirty = false;
    const spent = now() - t0;
    timing.frames += 1;
    timing.total += spent;
    timing.max = Math.max(timing.max, spent);
    if (anim) schedule();
    return true;
  }
  function schedule() {
    if (raf || ended) return;
    const req = win?.requestAnimationFrame;
    if (typeof req !== "function") { frame(); return; }
    raf = req(() => frame(now()));
  }
  const stop = () => {
    ended = true;
    if (raf) {
      try { win?.cancelAnimationFrame?.(raf); } catch { /* stub */ }
      raf = 0;
    }
  };
  const fadeOut = (cls) => {
    stop();
    if (foot) { try { foot.remove(); } catch { /* gone */ } foot = null; }
    node.classList.add(cls);
    const kill = () => { try { node.remove(); } catch { /* gone */ } };
    const later = win?.setTimeout || globalThis.setTimeout;
    try { later(kill, LAND_MS + 20); } catch { kill(); }
  };
  frame();

  return {
    element: () => node,
    move(x, y) {
      if (ended) return;
      current = { x: num(x, current.x), y: num(y, current.y) };
      const next = rects.rootRect ? zoneAt(current.x, current.y, rects) : zone;
      if (next !== zone) {
        zone = next;
        anim = { fromX: sx, fromY: sy, to: targetScale(zone), at: now(), ms: LAND_MS };
      }
      dirty = true;
      schedule();
    },
    frame,
    zone: () => zone,
    scale: () => ({ sx, sy }),
    // Client point of the ghost's top-left, its size on screen, and its centre (ref-card drops centre the card).
    dropPoint() {
      if (footing()) {
        const r = footRect();
        return { x: r.x, y: r.y, w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
      }
      const s = anim ? anim.to : sx;
      const at2 = ghostOrigin(current, grab, size, s, anim ? anim.to : sy);
      const w = size.w * s;
      const h = size.h * (anim ? anim.to : sy);
      return { x: at2.x, y: at2.y, w, h, cx: at2.x + w / 2, cy: at2.y + h / 2 };
    },
    land() { fadeOut("pxd-ghost--land"); },
    cancel() { fadeOut("pxd-ghost--cancel"); },
    stats: () => ({ frames: timing.frames, avgMs: timing.frames ? timing.total / timing.frames : 0, maxMs: timing.max, zoom: zoomNow }),
  };
}

// Hands the board one synthetic drop. The target is read once, under the pointer; the drop point is the
// ghost's top-left so the card lands where the ghost was. `entries` is [[mime, value], …].
export function dispatchDrop({ doc = globalThis.document, root, pointer, at, entries = [], altKey = false } = {}) {
  const win = doc?.defaultView || globalThis;
  const target = doc?.elementFromPoint?.(num(pointer?.x), num(pointer?.y)) || null;
  if (!target || (root && !root.contains?.(target)) || target.closest?.(".pxd-read")) return false;
  const x = num(at?.x, num(pointer?.x));
  const y = num(at?.y, num(pointer?.y));
  const Transfer = win.DataTransfer;
  const Drag = win.DragEvent;
  if (typeof Transfer === "function" && typeof Drag === "function") {
    const data = new Transfer();
    for (const [type, value] of entries) data.setData(type, value);
    try { data.effectAllowed = "copy"; } catch { /* read only */ }
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, altKey: Boolean(altKey), dataTransfer: data };
    target.dispatchEvent(new Drag("dragover", init));
    target.dispatchEvent(new Drag("drop", init));
    return true;
  }
  const map = new Map(entries);
  const transfer = { types: [...map.keys()], getData: (type) => map.get(type) || "", setData() {} };
  const plain = { type: "drop", bubbles: true, cancelable: true, clientX: x, clientY: y, altKey: Boolean(altKey), dataTransfer: transfer, preventDefault() {}, stopPropagation() {} };
  try { target.dispatchEvent(plain); } catch { return false; }
  return true;
}

export const PLACE_GRAB = Object.freeze({ fx: 0.5, fy: 0.5 });
const SWALLOW_MS = 600;

// Click-to-place. An opaque preview hangs on the pointer (same ghost as the drag: board zoom and a
// dashed outline over the board); a click on the board calls onPlace with the ghost's top-left in
// client px; Esc, a right click, or a click outside the board cancels. Window-capture listeners only,
// no pointer capture, mouseup is never stopped. The click that placed or cancelled is swallowed.
export function startPlacement({
  doc = globalThis.document,
  root,
  pane = null,
  pointer = { x: 0, y: 0 },
  from = null,
  content = {},
  width = GHOST_W,
  footprint = null,
  zoom = null,
  blocked = null,
  onPlace = null,
  onCancel = null,
  now,
} = {}) {
  const win = doc?.defaultView || globalThis;
  const ghost = createDragGhost({ doc, root, pane, from, pointer, content, width, footprint, zoom, blocked, grab: PLACE_GRAB, previewMin: PLACE_PREVIEW_MIN, ...(now ? { now } : {}) });
  try { ghost.element().classList.add("pxd-ghost--place"); } catch { /* stub */ }
  try { root?.classList?.add?.("pxd-root--placing"); } catch { /* stub */ }
  let done = false;
  let swallowUntil = 0;
  const clock = () => (typeof now === "function" ? now() : (globalThis.performance?.now?.() ?? Date.now()));
  const bound = [];
  const on = (type, fn) => { win?.addEventListener?.(type, fn, true); bound.push([type, fn]); };
  const release = () => { while (bound.length) { const [type, fn] = bound.pop(); win?.removeEventListener?.(type, fn, true); } };
  const finish = () => {
    done = true;
    swallowUntil = clock() + SWALLOW_MS;
    try { root?.classList?.remove?.("pxd-root--placing"); } catch { /* stub */ }
    // The click and mousedown of the deciding press are still on their way; eat them, then let go.
    const later = win?.setTimeout || globalThis.setTimeout;
    try { later(release, SWALLOW_MS); } catch { release(); }
  };
  const cancel = (reason = "cancel") => {
    if (done) return;
    ghost.cancel();
    finish();
    try { onCancel?.(reason); } catch { /* host */ }
  };
  const place = () => {
    if (done) return;
    const at = ghost.dropPoint();
    ghost.land();
    finish();
    try { onPlace?.({ client: { x: at.x, y: at.y }, size: { w: at.w, h: at.h } }); } catch { /* host */ }
  };
  const eat = (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  on("pointermove", (event) => { if (!done) ghost.move(event.clientX, event.clientY); });
  on("pointerdown", (event) => {
    if (done) { if (clock() <= swallowUntil) eat(event); return; }
    eat(event);
    ghost.move(event.clientX, event.clientY);
    ghost.frame();
    if (event.button != null && event.button !== 0) { cancel("button"); return; }
    if (ghost.zone() === "board") place();
    else cancel("outside");
  });
  on("mousedown", (event) => { if (!done || clock() <= swallowUntil) eat(event); });
  on("click", (event) => { if (!done || clock() <= swallowUntil) eat(event); });
  on("contextmenu", (event) => {
    if (done && clock() > swallowUntil) return;
    eat(event);
    cancel("button");
  });
  on("keydown", (event) => {
    if (done || event.key !== "Escape") return;
    eat(event);
    cancel("escape");
  });
  return {
    active: () => !done,
    cancel: () => cancel("api"),
    ghost,
    dispose() { if (!done) cancel("dispose"); release(); },
  };
}
