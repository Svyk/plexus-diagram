// FAST-3. A static sketch of the last settled paint, kept in localStorage.
// Plain DOM only: no renderBlock, no renderString, no block writes.
// The live board uses the same world transform (translate + scale, origin 0 0)
// and the same item translate. The sketch layer is inset by the root border
// so those rects share an origin. Fullscreen drops that border.

import { boundsOf, displayRects, routedEdge } from "../model/board.js";
import { center, edgePath, fitViewport, worldToScreen } from "../model/geometry.js";
import { PALETTE, cssColor, hexColor } from "../model/schema.js";
import { routeAround } from "../model/section6.js";

export const SKETCH_DEBOUNCE_MS = 500;
export const SKETCH_MAX_ITEMS = 300;
export const SKETCH_MAX_BYTES = 200 * 1024;
// Safety cap: drop the sketch if the live world never reports a card.
export const SKETCH_HOLD_MS = 2000;
// .pxd-root border. The viewport sits on the padding edge, one pixel in.
export const SKETCH_ROOT_BORDER = 1;
const PAIR_OFFSET = 18;
const TITLE_MAX = 200;
const SVG_NS = "http://www.w3.org/2000/svg";

export function sketchKey(graph, uid) {
  return `plexus-diagram:sketch:${graph}:${uid}`;
}

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

export function isSketchViewport(vp) {
  return Boolean(vp) && finite(vp.x) && finite(vp.y) && finite(vp.zoom) && vp.zoom > 0;
}

function cleanItem(item) {
  if (!item || typeof item.uid !== "string" || !item.uid) return null;
  if (!finite(item.x) || !finite(item.y) || !finite(item.w) || !finite(item.h)) return null;
  return {
    uid: item.uid,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    title: String(item.title || "").slice(0, TITLE_MAX),
    color: typeof item.color === "string" ? item.color : "",
    fill: typeof item.fill === "string" ? item.fill : "",
  };
}

function cleanEdge(edge) {
  if (!edge || typeof edge.path !== "string" || !edge.path) return null;
  return {
    from: typeof edge.from === "string" ? edge.from : "",
    to: typeof edge.to === "string" ? edge.to : "",
    path: edge.path,
  };
}

// Keep at most 300 items and 200 KB. Edges go first, then titles, then tail items.
export function packSketch(sketch) {
  const items = [];
  for (const item of sketch?.items || []) {
    if (items.length >= SKETCH_MAX_ITEMS) break;
    const clean = cleanItem(item);
    if (clean) items.push(clean);
  }
  const edges = [];
  for (const edge of sketch?.edges || []) {
    const clean = cleanEdge(edge);
    if (clean) edges.push(clean);
  }
  const fit = (next) => {
    const text = JSON.stringify(next);
    return text.length <= SKETCH_MAX_BYTES ? text : null;
  };
  let payload = { items, edges };
  let text = fit(payload);
  if (text) return text;
  payload = { items, edges: [] };
  text = fit(payload);
  if (text) return text;
  payload = {
    items: items.map((item) => ({ ...item, title: item.title.slice(0, 40) })),
    edges: [],
  };
  text = fit(payload);
  if (text) return text;
  let kept = payload.items;
  while (kept.length) {
    kept = kept.slice(0, kept.length - 1);
    text = fit({ items: kept, edges: [] });
    if (text) return text;
  }
  return null;
}

export function parseSketch(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) return null;
  const items = [];
  for (const item of value.items) {
    const clean = cleanItem(item);
    if (!clean) return null;
    items.push(clean);
  }
  const edges = [];
  for (const edge of Array.isArray(value.edges) ? value.edges : []) {
    const clean = cleanEdge(edge);
    if (clean) edges.push(clean);
  }
  return { items, edges };
}

// Same shape as createViewportStore: first write lands at once, a burst waits out the 500 ms.
export function createSketchStore({ storage = globalThis.localStorage, graph = "", now = Date.now, enabled = () => true } = {}) {
  const graphOf = typeof graph === "function" ? graph : () => graph;
  const key = (uid) => sketchKey(graphOf(), uid);
  const lastWrite = new Map();
  const latest = new Map();
  const timers = new Map();
  const allow = () => {
    try { return enabled() !== false; } catch { return true; }
  };
  const flush = (uid) => {
    timers.delete(uid);
    if (!latest.has(uid)) return;
    const text = latest.get(uid);
    latest.delete(uid);
    if (!allow() || typeof text !== "string") return;
    try { storage?.setItem(key(uid), text); } catch { /* quota or private mode */ }
    lastWrite.set(uid, now());
  };
  return {
    get(uid) {
      if (!allow()) return null;
      try {
        const raw = storage?.getItem(key(uid));
        if (!raw) return null;
        return parseSketch(raw);
      } catch { return null; }
    },
    set(uid, sketch) {
      if (!allow() || !uid || !sketch) return;
      const text = packSketch(sketch);
      if (!text) return;
      latest.set(uid, text);
      const since = now() - (lastWrite.get(uid) ?? -Infinity);
      if (since >= SKETCH_DEBOUNCE_MS) { flush(uid); return; }
      if (!timers.has(uid)) {
        const t = setTimeout(() => flush(uid), SKETCH_DEBOUNCE_MS - since);
        t.unref?.();
        timers.set(uid, t);
      }
    },
    flushAll() {
      for (const [uid, t] of timers) { clearTimeout(t); flush(uid); }
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      latest.clear();
    },
  };
}

// Reciprocal pair split, the same 18px the edge layer uses.
function pairOffset(board, edge) {
  for (const other of board.edges.values()) {
    if (other.uid !== edge.uid && other.from === edge.to && other.to === edge.from) {
      return edge.uid < other.uid ? PAIR_OFFSET : -PAIR_OFFSET;
    }
  }
  return 0;
}

function edgePathOf(board, edge, rects) {
  const routed = routedEdge(board, edge, rects);
  if (!routed) return null;
  let via = edge.via;
  if ((!via || !via.length) && edge.route === "around") {
    const obstacles = [];
    for (const [uid, rect] of rects) {
      if (uid === edge.from || uid === edge.to || !rect) continue;
      const item = board.items.get(uid);
      if (item?.type === "card" || item?.type === "text") obstacles.push(rect);
    }
    via = routeAround(center(routed.a), center(routed.b), obstacles);
  }
  const geo = edgePath({
    a: routed.a,
    b: routed.b,
    fromSide: edge.fromSide,
    toSide: edge.toSide,
    route: edge.route,
    offset: pairOffset(board, edge),
    via,
  });
  return geo?.d || null;
}

export function captureSketch(board) {
  if (!board || typeof board.items?.get !== "function") return null;
  const rects = displayRects(board);
  const items = [];
  const order = Array.isArray(board.order) ? board.order : [...board.items.keys()];
  for (const uid of order) {
    if (items.length >= SKETCH_MAX_ITEMS) break;
    const rect = rects.get(uid);
    const item = board.items.get(uid);
    if (!rect || !item) continue;
    const clean = cleanItem({
      uid,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      title: item.title || "",
      color: item.color || "",
      fill: item.fill || "",
    });
    if (clean) items.push(clean);
  }
  const edges = [];
  if (typeof board.edges?.values === "function") {
    for (const edge of board.edges.values()) {
      const path = edgePathOf(board, edge, rects);
      if (!path) continue;
      edges.push({ from: edge.from || "", to: edge.to || "", path });
    }
  }
  return { items, edges };
}

// initial wins over the stored camera, matching mountBoardView. No camera fits the cards.
export function resolveSketchViewport({ stored, initial, board, size } = {}) {
  if (isSketchViewport(initial)) return { x: initial.x, y: initial.y, zoom: initial.zoom };
  if (isSketchViewport(stored)) return { x: stored.x, y: stored.y, zoom: stored.zoom };
  const rects = board ? displayRects(board) : new Map();
  const box = size && size.width > 0 && size.height > 0 ? size : { width: 800, height: 560 };
  return fitViewport(boundsOf([...rects.values()]), box, { padding: 64, maxZoom: 1 });
}

// Screen rect of a sketched card. `inset` is the root border, in screen pixels.
export function sketchScreenRect(item, vp, inset = 0) {
  const p = worldToScreen(vp, { x: item.x, y: item.y });
  return { x: p.x + inset, y: p.y + inset, w: item.w * vp.zoom, h: item.h * vp.zoom };
}

function svgEl(doc, tag) {
  if (typeof doc.createElementNS === "function") return doc.createElementNS(SVG_NS, tag);
  return doc.createElement(tag);
}

function placeLayer(mountEl, layer) {
  if (typeof mountEl.insertBefore === "function" && mountEl.firstChild) mountEl.insertBefore(layer, mountEl.firstChild);
  else mountEl.append(layer);
}

export function removeSketch(mountEl) {
  const nodes = mountEl?.querySelectorAll?.(".pxd-sketch");
  if (!nodes) return;
  for (const node of [...nodes]) {
    try { node.remove(); } catch { /* already gone */ }
  }
}

// Paint card rects, titles, colours, and edge paths. No listeners, so a key
// during the handoff cannot land here. Returns null when the sketch is unusable.
export function paintSketch(doc, mountEl, sketch, vp, { inset = SKETCH_ROOT_BORDER } = {}) {
  if (!doc || !mountEl || !isSketchViewport(vp)) return null;
  const parsed = sketch?.items ? sketch : null;
  if (!parsed || !Array.isArray(parsed.items)) return null;
  removeSketch(mountEl);
  let layer;
  try {
    layer = doc.createElement("div");
    layer.className = "pxd-sketch";
    layer.setAttribute("data-pxd-sketch", "1");
    layer.setAttribute("aria-hidden", "true");
    layer.style.position = "absolute";
    layer.style.left = `${inset}px`;
    layer.style.top = `${inset}px`;
    layer.style.right = `${inset}px`;
    layer.style.bottom = `${inset}px`;
    layer.style.overflow = "hidden";
    layer.style.pointerEvents = "none";
    layer.style.zIndex = "1";

    const world = doc.createElement("div");
    world.className = "pxd-sketch__world";
    world.style.position = "absolute";
    world.style.left = "0";
    world.style.top = "0";
    world.style.width = "0";
    world.style.height = "0";
    world.style.transformOrigin = "0 0";
    world.style.pointerEvents = "none";
    world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
    layer.append(world);

    const edges = svgEl(doc, "svg");
    edges.setAttribute("class", "pxd-sketch__edges");
    edges.style.position = "absolute";
    edges.style.left = "0";
    edges.style.top = "0";
    edges.style.overflow = "visible";
    edges.style.pointerEvents = "none";
    world.append(edges);
    for (const edge of Array.isArray(parsed.edges) ? parsed.edges : []) {
      const clean = cleanEdge(edge);
      if (!clean) continue;
      const path = svgEl(doc, "path");
      path.setAttribute("class", "pxd-sketch__edge");
      path.setAttribute("d", clean.path);
      path.setAttribute("fill", "none");
      edges.append(path);
    }

    for (const item of parsed.items) {
      const clean = cleanItem(item);
      if (!clean) continue;
      const card = doc.createElement("div");
      card.className = "pxd-sketch__card";
      card.setAttribute("data-uid", clean.uid);
      card.style.position = "absolute";
      card.style.left = "0";
      card.style.top = "0";
      card.style.boxSizing = "border-box";
      card.style.overflow = "hidden";
      card.style.pointerEvents = "none";
      card.style.transform = `translate(${clean.x}px, ${clean.y}px)`;
      card.style.width = `${clean.w}px`;
      card.style.height = `${clean.h}px`;
      if (PALETTE.includes(clean.color)) card.classList.add(`pxd-c-${clean.color}`);
      const fill = cssColor(clean.fill, "fill");
      if (fill) card.style.background = fill;
      else if (!PALETTE.includes(clean.color)) {
        const accent = hexColor(clean.color);
        if (accent) card.style.background = accent;
      }
      const title = doc.createElement("div");
      title.className = "pxd-sketch__title";
      title.style.pointerEvents = "none";
      title.textContent = clean.title;
      card.append(title);
      world.append(card);
    }
    placeLayer(mountEl, layer);
    return layer;
  } catch {
    removeSketch(mountEl);
    return null;
  }
}
