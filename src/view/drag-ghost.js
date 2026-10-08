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

// What the ghost shows. Text is clamped by CSS; a table keeps its first three rows.
export function ghostContent(source = {}) {
  const kind = ["text", "table", "figure", "highlight", "blocks"].includes(source.kind) ? source.kind : "text";
  const text = String(source.text ?? "").replace(/\s+/g, " ").trim();
  const rows = Array.isArray(source.rows) ? source.rows.slice(0, 3).map((row) => (Array.isArray(row) ? row.slice(0, 6).map((cell) => String(cell ?? "")) : [])) : [];
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
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  const win = doc?.defaultView || globalThis;
  const host = root || doc?.body;
  const look = ghostContent(content);
  const node = buildGhost(doc, look);
  node.style.width = `${GHOST_W}px`;
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
  const size = { w: GHOST_W, h: height };
  const rects = {
    rootRect: root?.getBoundingClientRect?.() || null,
    paneRect: pane?.getBoundingClientRect?.() || null,
    blocked: blocked || chromeObstacles(root, { win }),
  };
  if (rects.rootRect && !(rects.rootRect.right > rects.rootRect.left)) rects.rootRect = null;
  const zoomNow = zoom != null ? num(zoom, 1) : boardZoom(root, win);
  const start = { x: num(pointer?.x), y: num(pointer?.y) };
  const src = from && num(from.width) > 0 && num(from.height) > 0 ? from : { left: start.x - 8, top: start.y - 8, width: 16, height: 16 };
  const grab = {
    fx: clamp((start.x - num(src.left)) / num(src.width, 1), 0, 1),
    fy: clamp((start.y - num(src.top)) / num(src.height, 1), 0, 1),
  };
  let current = { x: start.x, y: start.y };
  let zone = rects.rootRect ? zoneAt(start.x, start.y, rects) : "pane";
  let sx = clamp(num(src.width) / size.w, MIN_SCALE, MAX_SCALE);
  let sy = clamp(num(src.height) / size.h, MIN_SCALE, MAX_SCALE);
  let anim = { fromX: sx, fromY: sy, to: zoneScale(zone, zoomNow), at: now(), ms: MORPH_MS };
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
        anim = { fromX: sx, fromY: sy, to: zoneScale(zone, zoomNow), at: now(), ms: LAND_MS };
      }
      schedule();
    },
    frame,
    zone: () => zone,
    scale: () => ({ sx, sy }),
    // Client point of the ghost's top-left, its size on screen, and its centre (ref-card drops centre the card).
    dropPoint() {
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
export function dispatchDrop({ doc = globalThis.document, root, pointer, at, entries = [] } = {}) {
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
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data };
    target.dispatchEvent(new Drag("dragover", init));
    target.dispatchEvent(new Drag("drop", init));
    return true;
  }
  const map = new Map(entries);
  const transfer = { types: [...map.keys()], getData: (type) => map.get(type) || "", setData() {} };
  const plain = { type: "drop", bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer, preventDefault() {}, stopPropagation() {} };
  try { target.dispatchEvent(plain); } catch { return false; }
  return true;
}
