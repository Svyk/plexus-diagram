// INSTANT-1. Capture a settled board into a snapshot, and paint a snapshot in one
// turn before any Roam read. The painted root uses the live classes (.pxd-root,
// .pxd-item, .pxd-section, header/body) so the cards look and sit exactly like the
// live ones. Shells carry .pxd-item--snap and no listeners; the live renderer adopts
// them by uid, so a persisting card keeps its DOM node through the handoff.

import { lodFonts, lodTier, invZoom, screenPx, gridBackground, fitViewport } from "../model/geometry.js";
import { boundsOf } from "../model/board.js";
import {
  SNAP_VERSION,
  SNAP_MAX_ITEMS,
  LAYER_MAX_NODES,
  buildFace,
  captureFace,
  cleanClasses,
  isSnapViewport,
  itemSig,
  boardStamp,
} from "../model/boardsnap.js";

export const SNAP_CLASS = "pxd-item--snap";
const CHROME_KEEP = /(^|\s)(pxd-toolbar|pxd-rail|pxd-palette|pxd-dock|pxd-mode|pxd-minimap|pxd-props|pxd-resize-grip|pxd-tabs|pxd-fstabs)(\s|$)/;
export const SNAP_ROOT_CLASS = "pxd-snap-root";

const finite = (n) => typeof n === "number" && Number.isFinite(n);

function rootVars(root) {
  const out = {};
  const style = root?.style;
  if (!style) return out;
  const n = Number(style.length) || 0;
  for (let i = 0; i < n; i += 1) {
    const name = style[i];
    if (typeof name !== "string" || !name.startsWith("--pxd-")) continue;
    const value = typeof style.getPropertyValue === "function" ? style.getPropertyValue(name) : "";
    if (value) out[name] = String(value).trim();
  }
  return out;
}

const skipChrome = (el) => {
  const cls = typeof el.getAttribute === "function" ? String(el.getAttribute("class") || "") : "";
  return /(^|\s)(pxd-ports|pxd-grip|pxd-port|pxd-item__editor|pxd-ctx|pxd-tip|pxd-table-thumb)(\s|$)/.test(cls);
};

// Reads classes, inline styles, attributes and text only. No layout read, no Roam call.
// `prev` is the last snapshot: a card whose body is unmounted now keeps its old face
// while its sig still matches. `thumbs` collects data URLs by key.
export function captureBoardSnap({
  uid,
  root,
  board,
  rects,
  vp,
  height = 0,
  width = 0,
  shellOf,
  badges = null,
  tableThumbKey = null,
  threshold = 0.45,
  prev = null,
  thumbs = new Map(),
  now = Date.now,
} = {}) {
  if (!board?.items || !rects || !isSnapViewport(vp) || typeof shellOf !== "function") return null;
  if (board.items.size > SNAP_MAX_ITEMS) return null;
  const prevItems = new Map((prev?.items || []).map((item) => [item.uid, item]));
  const items = [];
  const order = Array.isArray(board.order) ? board.order : [...board.items.keys()];
  for (const id of order) {
    const item = board.items.get(id);
    const rect = rects.get(id);
    const el = shellOf(id);
    if (!item || !rect || !el) continue;
    const section = item.type === "section";
    const sig = itemSig(item);
    const cls = cleanClasses(typeof el.getAttribute === "function" ? el.getAttribute("class") : el.className);
    const bare = cls.includes("pxd-item--bare") || cls.includes("pxd-item--collapsed");
    let face = captureFace(el, { thumbs, skip: skipChrome });
    const old = prevItems.get(id);
    // A bare body at map zoom is not a face; the last detail face with the same sig is.
    if (!section && bare && old?.face && old.sig === sig && !cls.includes("pxd-item--collapsed")) {
      face = mergeBareFace(face, old.face);
    }
    const box = shellBox(el) || rect;
    const out = {
      uid: id,
      section,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      cls: cls.join(" "),
      sig,
      face,
    };
    if (item.parentUid && item.parentUid !== board.uid) out.parent = item.parentUid;
    const stats = badges?.get?.(id);
    if (stats) out.badges = stats;
    const thumb = tableThumbKey?.(item);
    if (thumb) out.thumb = thumb;
    items.push(out);
  }
  const world = root?.querySelector?.(".pxd-world");
  const edgesEl = world?.querySelector?.("svg.pxd-edges");
  const labelsEl = world?.querySelector?.(".pxd-labels");
  const gridEl = root?.querySelector?.(".pxd-grid");
  const layer = (el) => (el ? captureFace(el, { thumbs, maxNodes: LAYER_MAX_NODES, maxChars: 64 * 1024 }) : null);
  // The toolbar, dock, rail, minimap and props bar, so the snapshot frame is the live frame.
  const chrome = [];
  for (const child of [...(root?.children || [])]) {
    const cls = String(child.getAttribute?.("class") || "");
    if (!CHROME_KEEP.test(cls) || child.hasAttribute?.("hidden")) continue;
    const face = captureFace(child, { thumbs, maxNodes: 300, maxChars: 8 * 1024, canvases: true });
    if (face) chrome.push(face);
  }
  return {
    v: SNAP_VERSION,
    uid: uid || board.uid,
    stamp: boardStamp(board, rects),
    savedAt: now(),
    height: finite(height) ? height : 0,
    width: finite(width) ? width : 0,
    threshold: finite(threshold) ? threshold : 0.45,
    vp: { x: vp.x, y: vp.y, zoom: vp.zoom },
    rootCls: typeof root?.getAttribute === "function" ? root.getAttribute("class") || "" : "",
    rootStyle: rootVars(root),
    grid: gridEl ? { c: cleanClasses(gridEl.getAttribute?.("class") || "").join(" ") } : null,
    edges: layer(edgesEl),
    labels: layer(labelsEl),
    chrome,
    items,
  };
}

// The shell's own inline box (what the renderer drew, PDF caps included). No layout read.
function shellBox(el) {
  const style = el?.style;
  if (!style) return null;
  const m = /translate\(\s*(-?[\d.e+-]+)px\s*,\s*(-?[\d.e+-]+)px\s*\)/.exec(String(style.transform || ""));
  const w = parseFloat(style.width);
  const h = parseFloat(style.height);
  if (!m || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, w, h } : null;
}

// Keep the live header (title may have changed) and take the old body.
function mergeBareFace(live, old) {
  const kids = Array.isArray(live?.k) ? live.k.slice() : [];
  const oldBody = (old?.k || []).find((kid) => typeof kid === "object" && String(kid.c || "").split(" ").includes("pxd-item__body"));
  if (!oldBody) return live;
  const index = kids.findIndex((kid) => typeof kid === "object" && String(kid.c || "").split(" ").includes("pxd-item__body"));
  if (index >= 0) kids[index] = oldBody;
  else kids.push(oldBody);
  return { ...(live || { t: "div" }), k: kids };
}

// The paint camera: the board's own resolution order (initial, stored, then the
// camera the snapshot was taken with). Fit only when none exists.
export function resolveSnapViewport({ initial, stored, snap, size } = {}) {
  if (isSnapViewport(initial)) return { x: initial.x, y: initial.y, zoom: initial.zoom };
  if (isSnapViewport(stored)) return { x: stored.x, y: stored.y, zoom: stored.zoom };
  if (isSnapViewport(snap?.vp)) return { ...snap.vp };
  const rects = (snap?.items || []).map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }));
  const box = size && size.width > 0 && size.height > 0 ? size : { width: snap?.width || 800, height: snap?.height || 560 };
  return fitViewport(boundsOf(rects), box, { padding: 64, maxZoom: 1 });
}

function setVar(el, name, value) {
  try { el.style.setProperty(name, value); } catch { /* stub style */ }
}

function applyCamera(state) {
  const { vp, world, grid, root, threshold, pattern } = state;
  world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
  const tier = lodTier(vp.zoom, state.tier || "detail", { threshold });
  state.tier = tier;
  root.classList.toggle("pxd-lod-map", tier !== "detail");
  root.classList.toggle("pxd-lod-overview", tier === "overview");
  const f = lodFonts(vp.zoom);
  setVar(root, "--pxd-map-font", `${f.map}px`);
  setVar(root, "--pxd-ui", String(f.ui));
  setVar(root, "--pxd-overview-font", `${f.section}px`);
  setVar(root, "--pxd-inv-zoom", String(invZoom(vp.zoom)));
  setVar(root, "--pxd-screen-px", String(screenPx(vp.zoom)));
  if (grid) {
    const g = gridBackground(vp, pattern);
    if (g) {
      grid.style.backgroundSize = `${g.size}px ${g.size}px`;
      grid.style.backgroundPosition = `${g.x}px ${g.y}px`;
    }
  }
}

function el(doc, tag, cls, parent) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.append(node);
  return node;
}

export function removeBoardSnap(mountEl) {
  const nodes = mountEl?.querySelectorAll?.(`.${SNAP_ROOT_CLASS}`);
  for (const node of [...(nodes || [])]) {
    try { node.__pxdSnap?.off?.(); } catch { /* listeners already gone */ }
    try { node.remove(); } catch { /* already gone */ }
  }
}

// Paint into mountEl. Returns { root, shells, state } or null. `faceOk(uid, sig)`
// may veto a stale face (the card keeps its header and an empty body).
export function paintBoardSnap(doc, mountEl, snap, vp, { thumbs = null, faceOk = null, height = 0, fullscreen = false } = {}) {
  if (!doc || !mountEl || !snap || !isSnapViewport(vp)) return null;
  removeBoardSnap(mountEl);
  let root;
  try {
    const rootCls = cleanClasses(snap.rootCls).filter((name) => name !== SNAP_ROOT_CLASS);
    if (!rootCls.includes("pxd-root")) rootCls.unshift("pxd-root");
    if (fullscreen && !rootCls.includes("pxd-root--fullscreen")) rootCls.push("pxd-root--fullscreen");
    root = el(doc, "div", `${rootCls.join(" ")} ${SNAP_ROOT_CLASS}`);
    root.setAttribute("data-pxd-snap", "1");
    root.setAttribute("aria-busy", "true");
    for (const [name, value] of Object.entries(snap.rootStyle || {})) setVar(root, name, value);
    root.style.position = "absolute";
    root.style.left = "0";
    root.style.top = "0";
    root.style.right = "0";
    root.style.bottom = "0";
    root.style.zIndex = "2";
    if (!fullscreen) {
      const h = height || snap.height;
      if (h) root.style.height = `${h}px`;
    } else root.style.height = "auto";
    const viewport = el(doc, "div", "pxd-viewport", root);
    const grid = el(doc, "div", cleanClasses(snap.grid?.c || "pxd-grid").join(" ") || "pxd-grid", viewport);
    const world = el(doc, "div", "pxd-world", viewport);
    const sections = el(doc, "div", "pxd-sections", world);
    const edges = snap.edges ? buildFace(doc, snap.edges, { thumbs }) : null;
    if (edges) world.append(edges);
    const labels = snap.labels ? buildFace(doc, snap.labels, { thumbs }) : null;
    if (labels) world.append(labels);
    const itemsLayer = el(doc, "div", "pxd-items", world);
    const shells = new Map();
    // Offscreen shells get no face: style recalc of the hidden faces cost more than the paint.
    // The box is the captured root size, or a generous default, plus a quarter on each side.
    const boxW = (snap.width || 1600) / vp.zoom;
    const boxH = ((fullscreen ? 0 : height || snap.height) || 1000) / vp.zoom;
    const seen = {
      x: -vp.x / vp.zoom - boxW * 0.25,
      y: -vp.y / vp.zoom - boxH * 0.25,
      w: boxW * 1.5,
      h: boxH * 1.5,
    };
    const onScreen = (item) => item.x < seen.x + seen.w && item.x + item.w > seen.x && item.y < seen.y + seen.h && item.y + item.h > seen.y;
    for (const item of snap.items || []) {
      const node = el(doc, "div", `${cleanClasses(item.cls).join(" ")} ${SNAP_CLASS}`, item.section ? sections : itemsLayer);
      node.setAttribute("data-uid", item.uid);
      if (node.dataset) node.dataset.uid = item.uid;
      node.style.transform = `translate(${item.x}px, ${item.y}px)`;
      node.style.width = `${item.w}px`;
      node.style.height = `${item.h}px`;
      const okFace = (!faceOk || faceOk(item.uid, item.sig) !== false) && (item.section || onScreen(item));
      for (const kid of Array.isArray(item.face?.k) ? item.face.k : []) {
        const isBody = typeof kid === "object" && String(kid.c || "").split(" ").includes("pxd-item__body");
        if (isBody && !okFace) { el(doc, "div", "pxd-item__body", node); continue; }
        if (!okFace && !item.section && typeof kid === "object" && !String(kid.c || "").split(" ").includes("pxd-item__header")) continue;
        const child = buildFace(doc, kid, { thumbs });
        if (child) node.append(child);
      }
      if (!item.section && !node.querySelector?.(".pxd-item__header")) {
        const header = el(doc, "div", "pxd-item__header");
        node.insertBefore ? node.insertBefore(header, node.firstChild || null) : node.append(header);
      }
      if (!item.section && !node.querySelector?.(".pxd-item__body")) el(doc, "div", "pxd-item__body", node);
      if (item.thumb && thumbs?.get?.(item.thumb)) paintThumbFace(doc, node, thumbs.get(item.thumb));
      shells.set(item.uid, node);
    }
    for (const face of Array.isArray(snap.chrome) ? snap.chrome : []) {
      const node = buildFace(doc, face, { thumbs });
      if (node) root.append(node);
    }
    const pattern = (cleanClasses(snap.grid?.c || "").find((name) => name.startsWith("pxd-grid--")) || "pxd-grid--dots").slice("pxd-grid--".length);
    const state = { vp: { ...vp }, world, grid, root, threshold: finite(snap.threshold) ? snap.threshold : 0.45, pattern, tier: null, moved: false };
    applyCamera(state);
    root.__pxdSnap = { state, shells };
    if (typeof mountEl.insertBefore === "function" && mountEl.firstChild) mountEl.insertBefore(root, mountEl.firstChild);
    else mountEl.append(root);
    return { root, shells, state };
  } catch {
    removeBoardSnap(mountEl);
    return null;
  }
}

export const TABLE_THUMB_CLASS = "pxd-table-thumb";

// A table card's PNG face: an <img> in the body plus a class that shows the body at map zoom.
export function paintThumbFace(doc, shell, dataUrl) {
  if (!shell || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  const body = shell.querySelector?.(".pxd-item__body");
  if (!body) return null;
  let img = body.querySelector?.(`img.${TABLE_THUMB_CLASS}`);
  if (!img) {
    img = doc.createElement("img");
    img.className = TABLE_THUMB_CLASS;
    img.setAttribute("alt", "");
    img.setAttribute("draggable", "false");
    body.append(img);
  }
  if (img.getAttribute("src") !== dataUrl) img.setAttribute("src", dataUrl);
  shell.classList.add("pxd-item--thumb");
  return img;
}

// Wheel pans (pinch / ctrl-wheel zooms) and a drag pans the snapshot camera. The
// first click or key is kept for the live board; nothing else is queued.
export function armSnapGestures(painted, { win = globalThis.window, onFirstGesture = null } = {}) {
  const { root, state } = painted || {};
  if (!root || !state || typeof root.addEventListener !== "function") return () => {};
  let drag = null;
  let gestured = false;
  const wheel = (event) => {
    try { event.preventDefault?.(); } catch { /* passive */ }
    event.stopPropagation?.();
    const vp = state.vp;
    if (event.ctrlKey || event.metaKey) {
      const box = root.getBoundingClientRect?.() || { left: 0, top: 0 };
      const px = (Number(event.clientX) || 0) - (box.left || 0);
      const py = (Number(event.clientY) || 0) - (box.top || 0);
      const zoom = Math.min(4, Math.max(0.05, vp.zoom * Math.exp(-(Number(event.deltaY) || 0) * 0.01)));
      const k = zoom / vp.zoom;
      state.vp = { x: px - (px - vp.x) * k, y: py - (py - vp.y) * k, zoom };
    } else {
      state.vp = { x: vp.x - (Number(event.deltaX) || 0), y: vp.y - (Number(event.deltaY) || 0), zoom: vp.zoom };
    }
    state.moved = true;
    applyCamera(state);
  };
  const move = (event) => {
    if (!drag) return;
    const dx = (Number(event.clientX) || 0) - drag.x;
    const dy = (Number(event.clientY) || 0) - drag.y;
    if (!drag.panning && Math.hypot(dx, dy) < 4) return;
    drag.panning = true;
    state.vp = { x: drag.vp.x + dx, y: drag.vp.y + dy, zoom: drag.vp.zoom };
    state.moved = true;
    applyCamera(state);
  };
  const up = (event) => {
    const was = drag;
    drag = null;
    win?.removeEventListener?.("pointermove", move, true);
    win?.removeEventListener?.("pointerup", up, true);
    if (was && !was.panning && !gestured) {
      gestured = true;
      onFirstGesture?.([was.down, snapEvent(event)]);
    }
  };
  const down = (event) => {
    if (event.button != null && event.button !== 0) return;
    event.stopPropagation?.();
    drag = { x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, vp: { ...state.vp }, panning: false, down: snapEvent(event) };
    win?.addEventListener?.("pointermove", move, true);
    win?.addEventListener?.("pointerup", up, true);
  };
  const key = (event) => {
    if (gestured || !root.isConnected) return;
    const target = event.target;
    if (target && target !== root && !root.contains?.(target) && target !== win?.document?.body) return;
    gestured = true;
    onFirstGesture?.([snapEvent(event)]);
  };
  root.addEventListener("wheel", wheel, { passive: false });
  root.addEventListener("pointerdown", down);
  root.addEventListener("keydown", key);
  const off = () => {
    root.removeEventListener("wheel", wheel, { passive: false });
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("keydown", key);
    win?.removeEventListener?.("pointermove", move, true);
    win?.removeEventListener?.("pointerup", up, true);
  };
  if (root.__pxdSnap) root.__pxdSnap.off = off;
  return off;
}

function snapEvent(event) {
  const out = { type: event?.type };
  for (const key of ["key", "code", "repeat", "shiftKey", "altKey", "metaKey", "ctrlKey", "button", "buttons", "clientX", "clientY", "pointerId", "pointerType"]) {
    if (event?.[key] != null) out[key] = event[key];
  }
  return out;
}
