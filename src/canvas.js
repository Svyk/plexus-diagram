import { diagramUidFromLocation } from "./discovery.js";
import {
  buildEdgePath,
  edgeMidpoint,
  arrowheadMarkerId,
  arrowheadSize,
  shouldRescaleMarkers,
  effectiveDirection,
  directionToPoints,
} from "./edges.js";
import {
  acquireScratch,
  blankScratch,
  cloneBlockChildren,
  peekScratch,
  updateBlock,
} from "./metadata.js";
import {
  contentBounds,
  fitViewport,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  viewportNeedsFit,
} from "./model.js";

export const nestStack = [];

/** `{{[[diagram]]:Foo}}` → Foo; `{{[[diagram]]}}` → ""; other strings → trimmed without the macro. */
export function parseDiagramTitle(string) {
  const raw = String(string ?? "");
  const named = raw.match(/\{\{\s*\[\[diagram\]\]\s*:\s*([^}]+)\}\}/i);
  if (named) return named[1].trim();
  return raw.replace(/\{\{\s*\[\[diagram\]\]\s*\}\}/gi, "").trim();
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DRAG_THRESHOLD_PX = 4;
const CONNECT_HIT_INFLATE_PX = 12;
const PERSIST_DEBOUNCE_MS = 150;
const EDIT_GRACE_MS = 1200;
const HYDRATE_CAP_MS = 900;
const HINT_TEXT = "Drag empty space to pan · double-click to add a card · Fullscreen for a real board";

// renderBlock hydration / outline-focus steal can pull an empty string for a
// card that still has text. Never commit that over a known non-empty value.
export function shouldCommitPulledString(previous, pulled) {
  if (typeof pulled !== "string") return false;
  if (pulled === previous) return false;
  if (pulled.trim() === "" && String(previous || "").trim() !== "") return false;
  return true;
}

function raf(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    const id = globalThis.requestAnimationFrame(callback);
    return () => globalThis.cancelAnimationFrame?.(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

// RoamJS breadcrumbs live in `.rm-topbar` (hidden in fullscreen via CSS).
// Fullscreen starts below the remaining topbar — graph switcher stays visible.
export function topbarOffset(root = globalThis.document) {
  const topbar = root?.querySelector?.(".rm-topbar");
  if (!topbar?.getBoundingClientRect) return 0;
  const bottom = topbar.getBoundingClientRect().bottom;
  return Number.isFinite(bottom) ? Math.max(0, Math.round(bottom)) : 0;
}

const SIDEBAR_SELECTORS = [".roam-sidebar-container", ".rm-left-sidebar", "#roam-sidebar-container"];
const RIGHT_SIDEBAR_SELECTORS = ["#right-sidebar", ".rm-right-sidebar", "[class*=\"right-sidebar\"]"];
const RIGHT_INSET_COLLAPSE_PX = 8;

function firstMatch(root, selectors) {
  if (!root?.querySelector) return null;
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

export function sidebarOffset(root = globalThis.document) {
  if (!root?.querySelector) return 0;
  let sidebar = null;
  for (const selector of SIDEBAR_SELECTORS) {
    sidebar = root.querySelector(selector);
    if (sidebar) break;
  }
  if (!sidebar?.getBoundingClientRect) return 0;
  const rect = sidebar.getBoundingClientRect();
  const width = Number(rect.width);
  if (!(width > 0)) return 0;
  const right = Number(rect.right);
  return Number.isFinite(right) ? Math.max(0, Math.round(right)) : 0;
}

function chromeRootBody(root) {
  return root?.body || globalThis.document?.body || null;
}

export function fullscreenInsets(root = globalThis.document) {
  const topbarBottom = topbarOffset(root);
  const article = root?.querySelector?.(".rm-article-wrapper");
  if (!article?.getBoundingClientRect) {
    return { top: topbarBottom, left: 0, right: 0, bottom: 0 };
  }
  const rect = article.getBoundingClientRect();
  const top = Math.max(Number(rect.top) || 0, topbarBottom);
  const left = Number.isFinite(Number(rect.left)) ? Math.round(rect.left) : 0;
  const view = root.defaultView || globalThis;
  const vw = Number(view.innerWidth);
  const vh = Number(view.innerHeight);
  let right = 0;
  if (Number.isFinite(Number(rect.right)) && Number.isFinite(vw) && vw > 0) {
    const gap = vw - rect.right;
    right = gap <= RIGHT_INSET_COLLAPSE_PX ? 0 : Math.max(0, Math.round(gap));
  }
  let bottom = 0;
  if (Number.isFinite(Number(rect.bottom)) && Number.isFinite(vh) && vh > 0) {
    bottom = Math.max(0, Math.round(vh - rect.bottom));
  }
  return { top: Math.round(top), left, right, bottom };
}

export function applyFullscreenChrome(mount, on, root = globalThis.document) {
  mount?.classList?.toggle?.("pxd-mount--fullscreen", Boolean(on));
  chromeRootBody(root)?.classList?.toggle?.("pxd-has-fullscreen", Boolean(on));
  if (!on) {
    if (mount?.style) {
      mount.style.top = "";
      mount.style.left = "";
      mount.style.right = "";
      mount.style.bottom = "";
    }
    return () => {};
  }
  let chromeAlive = true;
  const place = () => {
    if (!chromeAlive || !mount?.style) return;
    const box = fullscreenInsets(root);
    mount.style.top = `${box.top}px`;
    mount.style.left = `${box.left}px`;
    mount.style.right = `${box.right}px`;
    mount.style.bottom = `${box.bottom}px`;
    mount.style.width = "auto";
    mount.style.height = "auto";
    mount.style.minHeight = "0";
  };
  const placeAfterSidebarAnim = () => {
    place();
    raf(() => {
      place();
      raf(place);
    });
  };
  place();
  const disconnects = [];
  const article = root?.querySelector?.(".rm-article-wrapper");
  const sidebar = firstMatch(root, SIDEBAR_SELECTORS);
  const rightSidebar = firstMatch(root, RIGHT_SIDEBAR_SELECTORS);
  if (typeof ResizeObserver === "function") {
    try {
      const ro = new ResizeObserver(() => place());
      if (article) ro.observe(article);
      if (sidebar) ro.observe(sidebar);
      if (rightSidebar && rightSidebar !== sidebar && rightSidebar !== article) ro.observe(rightSidebar);
      disconnects.push(() => ro.disconnect());
    } catch { /* stub articles are not Elements */ }
  }
  if (typeof MutationObserver === "function" && article) {
    try {
      const mo = new MutationObserver(() => placeAfterSidebarAnim());
      mo.observe(article, { attributes: true, attributeFilter: ["class"] });
      disconnects.push(() => mo.disconnect());
    } catch { /* stub articles are not Nodes */ }
  }
  const cancelRaf = raf(place);
  return () => {
    chromeAlive = false;
    cancelRaf();
    for (const disconnect of disconnects) disconnect();
  };
}

const EDGE_HIT_CLASSES = ["pxd-edge", "pxd-edge-hit", "pxd-edge-label", "pxd-edge-label-editor"];

function classTokenList(el) {
  if (!el) return [];
  const raw = el.className;
  const str = typeof raw === "string" ? raw : (raw?.baseVal || "");
  return String(str).split(/\s+/).filter(Boolean);
}

function elementHasClass(el, name) {
  if (el?.classList?.contains?.(name)) return true;
  return classTokenList(el).includes(name);
}

function isEdgeHitNode(el) {
  return EDGE_HIT_CLASSES.some((name) => elementHasClass(el, name));
}

export function cardUidFromHitStack(stack, cardsLayer) {
  for (const el of stack || []) {
    if (!el || isEdgeHitNode(el)) continue;
    let card = null;
    if (elementHasClass(el, "pxd-card")) card = el;
    else if (typeof el.closest === "function") card = el.closest(".pxd-card");
    if (!card) continue;
    if (cardsLayer && card.parentElement && card.parentElement !== cardsLayer) continue;
    return card.dataset?.uid || null;
  }
  return null;
}

export function parseDropPayload(dataTransfer) {
  if (!dataTransfer) return null;
  const chunks = [];
  const take = (type) => {
    try {
      const value = dataTransfer.getData?.(type);
      if (value) chunks.push(String(value));
    } catch { /* unread drag types throw in some browsers */ }
  };
  take("text/plain");
  take("text/html");
  const types = dataTransfer.types;
  if (types) {
    for (const type of types) take(type);
  }
  const blob = chunks.join("\n");
  if (!blob.trim()) return null;
  const page = blob.match(/\[\[([^\]]+)\]\]/);
  if (page) return { kind: "page", title: page[1], string: `[[${page[1]}]]` };
  const blockRef = blob.match(/\(\(([^)]+)\)\)/);
  if (blockRef) return { kind: "block", uid: blockRef[1], string: `((${blockRef[1]}))` };
  let plain = "";
  try {
    plain = String(dataTransfer.getData?.("text/plain") || "").trim();
  } catch { /* unread drag types throw in some browsers */ }
  if (/^[A-Za-z0-9_-]{9}$/.test(plain)) {
    return { kind: "block", uid: plain, string: `((${plain}))` };
  }
  return null;
}

function nextFrame() {
  return new Promise((resolve) => {
    raf(() => resolve());
  });
}

async function waitHydrateQuiet(el, capMs = HYDRATE_CAP_MS) {
  if (!el || typeof MutationObserver !== "function") {
    await nextFrame();
    await nextFrame();
    return;
  }
  let mutations = 0;
  const observer = new MutationObserver(() => { mutations += 1; });
  observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
  const start = Date.now();
  const preHydrationGrace = 250;
  let quiet = 0;
  let sawMutation = false;
  try {
    while (Date.now() - start < capMs) {
      if (!sawMutation && Date.now() - start >= preHydrationGrace) break;
      await nextFrame();
      if (mutations > 0) {
        sawMutation = true;
        quiet = 0;
      } else if (sawMutation) {
        quiet += 1;
      }
      mutations = 0;
      if (sawMutation && quiet >= 2) break;
    }
  } finally {
    observer.disconnect();
  }
}

function synthesizeBlockClick(host) {
  if (!host?.dispatchEvent) return false;
  const rect = host.getBoundingClientRect?.() || { left: 0, top: 0, height: 0 };
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: (Number(rect.left) || 0) + 2,
    clientY: (Number(rect.top) || 0) + ((Number(rect.height) || 0) / 2),
  };
  for (const type of ["mousedown", "mouseup", "click"]) {
    const Constructor = globalThis.MouseEvent || globalThis.Event;
    const event = typeof Constructor === "function" ? new Constructor(type, init) : { type, ...init };
    host.dispatchEvent(event);
  }
  return true;
}

/** Focus a Roam textarea without scrolling the outline copy into view. */
export function focusRoamInput(el) {
  if (!el) return false;
  try {
    el.focus?.({ preventScroll: true });
  } catch {
    try { el.focus?.(); } catch { /* unfocused */ }
  }
  synthesizeBlockClick(el);
  return true;
}

function roamBlockInputUid(el) {
  if (!el) return null;
  const host = typeof el.closest === "function" ? el.closest("[data-uid]") : null;
  const fromData = host?.dataset?.uid || host?.getAttribute?.("data-uid");
  if (fromData) return fromData;
  const id = String(el.id || "");
  const match = id.match(/([A-Za-z0-9_-]{9})$/);
  return match ? match[1] : null;
}

function scratchTextareaFocused() {
  const el = globalThis.document?.activeElement;
  if (!el) return false;
  const tag = String(el.tagName || "").toLowerCase();
  const isInput = tag === "textarea" || el.classList?.contains?.("rm-block__input");
  if (!isInput) return false;
  return Boolean(el.closest?.(".pxd-card__editor"));
}

function roamUi() {
  return globalThis.roamAlphaAPI?.ui;
}

function isTextEntryTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest(".rm-block__input, [contenteditable=\"true\"], .pxd-library-drawer, .pxd-edge-label-editor"));
}

/**
 * Vanilla DOM/SVG whiteboard. Pointer motion only touches CSS (`.pxd-world` transform,
 * one card's left/top/size, the edge paths that hang off it). `render()` is reserved
 * for structural change — add/remove card, tool change, session pull — and reconciles
 * card elements by uid so a card being edited is never torn down under the caret.
 */
const COLOR_SWATCHES = [
  ["", "Default", ""],
  ["red", "Red", "#db3737"],
  ["orange", "Orange", "#d9822b"],
  ["yellow", "Yellow", "#d99e0b"],
  ["green", "Green", "#29a634"],
  ["teal", "Teal", "#00b3a4"],
  ["blue", "Blue", "#2d72d2"],
  ["violet", "Violet", "#7157d9"],
  ["rose", "Rose", "#c22762"],
];

function colorHex(id) {
  const row = COLOR_SWATCHES.find((entry) => entry[0] === id);
  return row?.[2] || "";
}

let canvasCounter = 0;
const DARK_EDGE = "#a7b6c2";
const LIGHT_EDGE = "#738694";
const DARK_ACTIVE = "#48aff0";
const LIGHT_ACTIVE = "#2d72d2";

const hasClass = (el, name) => Boolean(el?.classList?.contains?.(name));

/** Mirrors the dark selectors in extension.css (.bp3-dark, body.bt-theme-dark, body.roam-body.dark, .rm-dark-theme). */
export function isDarkHost(root) {
  let node = root;
  while (node) {
    if (hasClass(node, "bp3-dark") || hasClass(node, "rm-dark-theme") || hasClass(node, "bt-theme-dark")) return true;
    if (hasClass(node, "roam-body") && hasClass(node, "dark")) return true;
    node = node.parentElement;
  }
  const body = globalThis.document?.body;
  if (hasClass(body, "bt-theme-dark") || hasClass(body, "bp3-dark") || hasClass(body, "rm-dark-theme")) return true;
  if (hasClass(body, "roam-body") && hasClass(body, "dark")) return true;
  return false;
}

function computedVar(root, name) {
  const gcs = globalThis.window?.getComputedStyle || globalThis.getComputedStyle;
  if (typeof gcs !== "function") return "";
  try {
    const value = String(gcs(root)?.getPropertyValue?.(name) || "").trim();
    return value.includes("var(") ? "" : value;
  } catch {
    return "";
  }
}

/** Literal color for SVG presentation: swatch hex, else the host's --pxd-edge, else a theme fallback. */
export function resolveEdgeColor(root, colorId) {
  const swatch = colorHex(colorId);
  if (swatch) return swatch;
  return computedVar(root, "--pxd-edge") || (isDarkHost(root) ? DARK_EDGE : LIGHT_EDGE);
}

function resolveActiveColor(root) {
  return computedVar(root, "--pxd-active") || (isDarkHost(root) ? DARK_ACTIVE : LIGHT_ACTIVE);
}

function markerGeometry(kind, zoom) {
  const size = Number(arrowheadSize(zoom || 1).toFixed(2));
  const half = Number((size / 2).toFixed(2));
  const tip = Number((size - 1).toFixed(2));
  if (kind === "start") {
    return { size, refX: 1, refY: half, d: `M${size},0 L0,${half} L${size},${size} Z` };
  }
  return { size, refX: tip, refY: half, d: `M0,0 L${size},${half} L0,${size} Z` };
}

function applyMarkerGeometry(marker, geometry) {
  marker.setAttribute("markerWidth", String(geometry.size));
  marker.setAttribute("markerHeight", String(geometry.size));
  marker.setAttribute("refX", String(geometry.refX));
  marker.setAttribute("refY", String(geometry.refY));
  const path = marker.querySelector?.("path") || marker.children?.[0];
  path?.setAttribute?.("d", geometry.d);
}

export function createCanvasRoot({ session, settings, version, onPersist, nestStack: nestStackOption }) {
  let currentSession = session;
  const canvasId = `pxd${canvasCounter += 1}`;
  const crumbs = nestStackOption !== undefined ? nestStackOption : nestStack;
  const root = document.createElement("div");
  root.className = "pxd-root";
  const grid = document.createElement("div");
  grid.className = "pxd-grid";
  const world = document.createElement("div");
  world.className = "pxd-world";
  const edgesSvg = document.createElementNS(SVG_NS, "svg");
  edgesSvg.classList.add("pxd-edges");
  const cardsLayer = document.createElement("div");
  cardsLayer.className = "pxd-cards";
  const labelsLayer = document.createElement("div");
  labelsLayer.className = "pxd-edge-labels";
  const sectionsLayer = document.createElement("div");
  sectionsLayer.className = "pxd-sections";
  const tempSvg = document.createElementNS(SVG_NS, "svg");
  tempSvg.classList.add("pxd-edges-temp");
  const toolbar = document.createElement("div");
  toolbar.className = "pxd-toolbar";
  const hint = document.createElement("div");
  hint.className = "pxd-hint";
  hint.textContent = HINT_TEXT;
  const minimap = settings.get("minimap") ? document.createElement("div") : null;
  if (minimap) minimap.className = "pxd-minimap";

  world.append(sectionsLayer, edgesSvg, labelsLayer, cardsLayer, tempSvg);
  root.append(grid, world, toolbar, hint);
  if (minimap) root.append(minimap);

  const model = () => currentSession.model;
  const num = (id, fallback) => {
    const value = Number(settings.get(id));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const zoomBounds = () => ({ zoomMin: num("zoom-min", 0.15), zoomMax: num("zoom-max", 3) });
  const defaultCardSize = () => ({
    width: Math.max(MIN_CARD_WIDTH, num("default-card-width", 280)),
    height: Math.max(MIN_CARD_HEIGHT, num("default-card-height", 160)),
  });
  const getGridSize = () => num("grid-size", 24);
  const snap = (value) => {
    if (!settings.get("snap-to-grid")) return value;
    const size = getGridSize();
    return Math.round(value / size) * size;
  };
  const rootRect = () => root.getBoundingClientRect();
  const viewSize = () => {
    const rect = rootRect();
    return { width: rect.width, height: rect.height };
  };
  const screenToWorld = (clientX, clientY, snapped = true) => {
    const rect = rootRect();
    const { x, y, zoom } = model().viewport;
    const wx = (clientX - rect.left - x) / (zoom || 1);
    const wy = (clientY - rect.top - y) / (zoom || 1);
    return snapped ? { x: snap(wx), y: snap(wy) } : { x: wx, y: wy };
  };
  const worldToScreen = (wx, wy) => {
    const rect = rootRect();
    const { x, y, zoom } = model().viewport;
    const z = zoom || 1;
    return {
      clientX: rect.left + x + wx * z,
      clientY: rect.top + y + wy * z,
    };
  };
  let positionEdgeInspector = () => {};
  const mountEl = () => root.closest?.(".pxd-mount") || null;
  const isFullscreen = () => Boolean(mountEl()?.classList?.contains?.("pxd-mount--fullscreen"));

  // ---------------------------------------------------------------- persistence
  let disposed = false;
  let viewportDirty = false;
  let layoutDirty = false;
  let viewportTimer = null;
  let layoutTimer = null;
  const flushViewport = async () => {
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = null;
    if (!viewportDirty) return;
    try {
      await onPersist?.({ persistViewport: true });
      viewportDirty = false;
    } catch (error) {
      throw error;
    }
  };
  const flushLayout = async () => {
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = null;
    if (!layoutDirty) return;
    try {
      await onPersist?.({ persistLayout: true });
      layoutDirty = false;
    } catch (error) {
      throw error;
    }
  };
  const schedulePersistViewport = () => {
    if (disposed || !viewportDirty) return;
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(flushViewport, PERSIST_DEBOUNCE_MS);
  };
  const schedulePersistLayout = () => {
    if (disposed || !layoutDirty) return;
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(flushLayout, PERSIST_DEBOUNCE_MS);
  };
  const markViewportDirty = () => {
    viewportDirty = true;
    schedulePersistViewport();
  };
  const markLayoutDirty = () => {
    layoutDirty = true;
    schedulePersistLayout();
  };

  // ---------------------------------------------------------------- viewport
  const zoomLabel = document.createElement("button");
  zoomLabel.type = "button";
  zoomLabel.className = "pxd-toolbar__zoom-level";
  zoomLabel.title = "Reset zoom to 100%";

  const renderGrid = () => {
    const show = settings.get("show-grid");
    const style = settings.get("grid-style") || "dots";
    grid.className = "pxd-grid";
    grid.classList.toggle("pxd-grid--hidden", !show || style === "none");
    grid.classList.toggle("pxd-grid--dots", style === "dots");
    grid.classList.toggle("pxd-grid--lines", style === "lines");
  };

  let minimapScheduled = null;
  const updateMinimap = () => {
    if (!minimap) return;
    const rect = rootRect();
    const { x, y, zoom } = model().viewport;
    const z = zoom || 1;
    const view = { minX: -x / z, minY: -y / z, maxX: (rect.width - x) / z, maxY: (rect.height - y) / z };
    const content = contentBounds(model().nodes) || view;
    const minX = Math.min(content.minX, view.minX);
    const minY = Math.min(content.minY, view.minY);
    const maxX = Math.max(content.maxX, view.maxX);
    const maxY = Math.max(content.maxY, view.maxY);
    const mw = 140;
    const mh = 90;
    const scale = Math.min(mw / Math.max(maxX - minX, 1), mh / Math.max(maxY - minY, 1));
    const offsetX = (mw - (maxX - minX) * scale) / 2;
    const offsetY = (mh - (maxY - minY) * scale) / 2;
    minimap.innerHTML = "";
    for (const child of model().children) {
      const node = model().nodes.get(child.uid);
      if (!node) continue;
      const dot = document.createElement("div");
      dot.className = "pxd-minimap__card";
      if (model().selected.has(child.uid)) dot.classList.add("pxd-minimap__card--selected");
      dot.style.left = `${offsetX + (node.pos.x - minX) * scale}px`;
      dot.style.top = `${offsetY + (node.pos.y - minY) * scale}px`;
      dot.style.width = `${Math.max(2, node.size.width * scale)}px`;
      dot.style.height = `${Math.max(2, node.size.height * scale)}px`;
      minimap.append(dot);
    }
    const frame = document.createElement("div");
    frame.className = "pxd-minimap__view";
    frame.style.left = `${offsetX + (view.minX - minX) * scale}px`;
    frame.style.top = `${offsetY + (view.minY - minY) * scale}px`;
    frame.style.width = `${Math.max(2, (view.maxX - view.minX) * scale)}px`;
    frame.style.height = `${Math.max(2, (view.maxY - view.minY) * scale)}px`;
    minimap.append(frame);
  };
  const scheduleMinimap = () => {
    if (!minimap || minimapScheduled) return;
    minimapScheduled = raf(() => {
      minimapScheduled = null;
      updateMinimap();
    });
  };

  let markerZoom = 1;
  const syncMarkerScale = (zoom) => {
    markerZoom = zoom || 1;
    for (const svg of [edgesSvg, tempSvg]) {
      for (const marker of svg.querySelectorAll?.("marker") || []) {
        applyMarkerGeometry(marker, markerGeometry(marker.dataset?.pxdKind || "end", markerZoom));
      }
    }
  };

  // `.pxd-world` is only viewport-sized; an SVG at `inset: 0` clips paths that
  // run to panned-off cards even with `overflow: visible` in Electron. Size the
  // edge layers to content ∪ visible viewport (∪ the temp wire tip) in world px.
  const SVG_BOUNDS_PAD_PX = 2000;
  const SVG_BOUNDS_STEP_PX = 500;
  let svgBoundsKey = "";
  const syncSvgBounds = (extraPoint) => {
    const rect = rootRect();
    const { x, y, zoom } = model().viewport;
    const z = zoom || 1;
    const view = { minX: -x / z, minY: -y / z, maxX: (rect.width - x) / z, maxY: (rect.height - y) / z };
    const content = contentBounds(model().nodes) || view;
    let minX = Math.min(content.minX, view.minX);
    let minY = Math.min(content.minY, view.minY);
    let maxX = Math.max(content.maxX, view.maxX);
    let maxY = Math.max(content.maxY, view.maxY);
    if (extraPoint) {
      minX = Math.min(minX, extraPoint.x);
      minY = Math.min(minY, extraPoint.y);
      maxX = Math.max(maxX, extraPoint.x);
      maxY = Math.max(maxY, extraPoint.y);
    }
    // Quantize so a pan does not rewrite the SVG box on every pointer pixel.
    const q = SVG_BOUNDS_STEP_PX;
    minX = Math.floor((minX - SVG_BOUNDS_PAD_PX) / q) * q;
    minY = Math.floor((minY - SVG_BOUNDS_PAD_PX) / q) * q;
    const width = Math.ceil((maxX + SVG_BOUNDS_PAD_PX) / q) * q - minX;
    const height = Math.ceil((maxY + SVG_BOUNDS_PAD_PX) / q) * q - minY;
    if (!(width > 0) || !(height > 0)) return;
    const key = `${minX} ${minY} ${width} ${height}`;
    if (key === svgBoundsKey) return;
    svgBoundsKey = key;
    for (const svg of [edgesSvg, tempSvg]) {
      svg.style.left = `${minX}px`;
      svg.style.top = `${minY}px`;
      svg.style.width = `${width}px`;
      svg.style.height = `${height}px`;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", key);
    }
  };

  const applyTransform = () => {
    const { x, y, zoom } = model().viewport;
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    syncSvgBounds();
    if (shouldRescaleMarkers(markerZoom, zoom || 1)) syncMarkerScale(zoom || 1);
    const gridPx = getGridSize() * (zoom || 1);
    grid.style.setProperty("--pxd-grid-size", `${gridPx}px`);
    grid.style.backgroundPosition = `${x}px ${y}px`;
    zoomLabel.textContent = `${Math.round((zoom || 1) * 100)}%`;
    scheduleMinimap();
    positionEdgeInspector();
  };

  const clampZoom = (zoom) => {
    const { zoomMin, zoomMax } = zoomBounds();
    return Math.min(zoomMax, Math.max(zoomMin, zoom));
  };

  const zoomAt = (nextZoomRaw, screenX, screenY) => {
    const viewport = model().viewport;
    const oldZoom = viewport.zoom || 1;
    const nextZoom = clampZoom(nextZoomRaw);
    if (nextZoom === oldZoom) return;
    const worldX = (screenX - viewport.x) / oldZoom;
    const worldY = (screenY - viewport.y) / oldZoom;
    viewport.zoom = nextZoom;
    viewport.x = screenX - worldX * nextZoom;
    viewport.y = screenY - worldY * nextZoom;
    applyTransform();
  };

  const zoomAroundCenter = (factor) => {
    const rect = rootRect();
    const oldZoom = model().viewport.zoom || 1;
    zoomAt(oldZoom * factor, rect.width / 2, rect.height / 2);
    if ((model().viewport.zoom || 1) !== oldZoom) markViewportDirty();
  };

  const fitToView = () => {
    const { zoomMin, zoomMax } = zoomBounds();
    const next = fitViewport(model().nodes, viewSize(), { zoomMin, zoomMax });
    model().viewport = next;
    model().viewportSource = "fit";
    applyTransform();
    return next;
  };

  let cancelInitialFit = null;
  let initialFitDone = false;

  // Keep the world point under the view centre stable across a size change
  // (fullscreen toggle), so cards do not jump to the top-left corner.
  const keepCenterAcross = (mutate) => {
    const before = rootRect();
    const viewport = model().viewport;
    const zoom = viewport.zoom || 1;
    const centerWorld = {
      x: (before.width / 2 - viewport.x) / zoom,
      y: (before.height / 2 - viewport.y) / zoom,
    };
    // Before the first fit there is nothing worth keeping centred; the fit sizes itself
    // to whatever rect the mutation produced.
    const fitPending = !initialFitDone;
    mutate();
    const settle = () => {
      if (disposed || fitPending) return;
      const after = rootRect();
      if (!after.width || !after.height) return;
      viewport.x = after.width / 2 - centerWorld.x * zoom;
      viewport.y = after.height / 2 - centerWorld.y * zoom;
      applyTransform();
    };
    raf(settle);
  };

  // First paint: reject unusable viewports (native zoomed-out fit-views, cards
  // painted under 140px, everything off-screen) and fit once the root has a size.
  const scheduleInitialFit = (attempt = 0) => {
    if (initialFitDone || disposed) return;
    cancelInitialFit = raf(() => {
      cancelInitialFit = null;
      if (disposed) return;
      const size = viewSize();
      if ((!size.width || !size.height) && attempt < 30) {
        scheduleInitialFit(attempt + 1);
        return;
      }
      initialFitDone = true;
      if (!size.width || !size.height) return;
      if (viewportNeedsFit(model().viewport, model().nodes, size)) {
        fitToView();
      } else {
        applyTransform();
      }
    });
  };

  // ---------------------------------------------------------------- toolbar
  const tools = [
    ["select", "Select", "Select, drag, and pan (V)"],
    ["card", "Card", "Click the board to add a card"],
    ["connect", "Connect", "Click-click or drag from a card; the wire follows the cursor"],
    ["section", "Section", "Click the board to add a section frame"],
    ["nested", "Nested", "Click the board to add a nested diagram card"],
    ["library", "Library", "Place existing pages as cards"],
  ];
  const toolButtons = new Map();
  const setActiveTool = (tool) => {
    if (tool !== "connect") clearConnectArm();
    model().activeTool = tool;
    for (const [name, button] of toolButtons) {
      button.classList.toggle("pxd-toolbar__btn--active", name === tool);
    }
    root.dataset.tool = tool;
    syncHint();
  };
  const makeButton = (label, title, className = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pxd-toolbar__btn${className ? ` ${className}` : ""}`;
    button.textContent = label;
    button.title = title;
    return button;
  };
  const toolGroup = document.createElement("div");
  toolGroup.className = "pxd-toolbar__group";
  for (const [tool, label, title] of tools) {
    const button = makeButton(label, title);
    button.dataset.tool = tool;
    button.addEventListener("click", () => {
      if (tool === "library") {
        onPersist?.({ toggleLibrary: true });
        return;
      }
      setActiveTool(tool);
    });
    toolButtons.set(tool, button);
    toolGroup.append(button);
  }
  toolbar.append(toolGroup);

  const crumbRow = document.createElement("div");
  crumbRow.className = "pxd-crumb";
  const renderCrumbs = () => {
    if (Array.isArray(crumbRow.children)) crumbRow.children.length = 0;
    crumbRow.innerHTML = "";
    if (!crumbs.length) {
      crumbRow.classList.add("pxd-crumb--empty");
      crumbRow.textContent = "";
      return;
    }
    crumbRow.classList.remove("pxd-crumb--empty");
    const currentTitle = parseDiagramTitle(model().tree?.string || "") || "Diagram";
    for (let i = 0; i < crumbs.length; i += 1) {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "pxd-crumb__sep";
        sep.textContent = " › ";
        crumbRow.append(sep);
      }
      const item = crumbs[i];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pxd-crumb__item";
      button.textContent = item.title || "Diagram";
      button.addEventListener("click", () => {
        void onPersist?.({ openCrumb: item.uid });
      });
      crumbRow.append(button);
    }
    const currentSep = document.createElement("span");
    currentSep.className = "pxd-crumb__sep";
    currentSep.textContent = " › ";
    crumbRow.append(currentSep);
    const current = document.createElement("span");
    current.className = "pxd-crumb__current";
    current.textContent = currentTitle;
    crumbRow.append(current);
  };
  renderCrumbs();
  toolbar.append(crumbRow);

  const viewGroup = document.createElement("div");
  viewGroup.className = "pxd-toolbar__group";
  const zoomOutBtn = makeButton("Zoom-", "Zoom out", "pxd-toolbar__btn--zoom");
  zoomOutBtn.addEventListener("click", () => zoomAroundCenter(1 / 1.2));
  const zoomInBtn = makeButton("Zoom+", "Zoom in", "pxd-toolbar__btn--zoom");
  zoomInBtn.addEventListener("click", () => zoomAroundCenter(1.2));
  zoomLabel.addEventListener("click", () => {
    const rect = rootRect();
    zoomAt(1, rect.width / 2, rect.height / 2);
    markViewportDirty();
  });
  const fitBtn = makeButton("Fit", "Fit all cards in view", "pxd-toolbar__btn--zoom");
  fitBtn.addEventListener("click", () => {
    fitToView();
    markViewportDirty();
  });
  const fullBtn = makeButton("Fullscreen", "Maximize like native Roam diagrams. Esc exits.", "pxd-toolbar__btn--zoom");
  fullBtn.addEventListener("click", () => setFullscreen(!isFullscreen()));
  viewGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, fitBtn, fullBtn);
  toolbar.append(viewGroup);

  const palette = document.createElement("div");
  palette.className = "pxd-palette pxd-palette--hidden";
  palette.title = "Card or section color";
  for (const [id, label, hex] of COLOR_SWATCHES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "pxd-swatch";
    swatch.dataset.color = id;
    swatch.title = label;
    if (hex) swatch.style.background = hex;
    else swatch.classList.add("pxd-swatch--default");
    swatch.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyColor(id);
    });
    palette.append(swatch);
  }
  toolbar.append(palette);

  if (settings.get("show-version-badge")) {
    const badge = document.createElement("span");
    badge.className = "pxd-version";
    badge.textContent = `v${version}`;
    toolbar.append(badge);
  }

  let cancelFullscreenPlace = null;
  const placeFullscreen = (mount, on) => {
    cancelFullscreenPlace?.();
    cancelFullscreenPlace = applyFullscreenChrome(mount, on) || null;
  };

  const setFullscreen = (on) => {
    const mount = mountEl();
    if (!mount) return;
    const current = isFullscreen();
    fullBtn.textContent = on ? "Exit full screen" : "Fullscreen";
    fullBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (current === Boolean(on)) {
      if (on) placeFullscreen(mount, true);
      return;
    }
    keepCenterAcross(() => placeFullscreen(mount, Boolean(on)));
  };

  const onWindowResize = () => {
    if (!isFullscreen()) return;
    const mount = mountEl();
    if (mount) placeFullscreen(mount, true);
  };
  window.addEventListener("resize", onWindowResize);

  // ---------------------------------------------------------------- hint
  let hintDismissed = false;
  const syncHint = () => {
    const show = !hintDismissed
      && model().activeTool === "select"
      && (model().children?.length || 0) <= 1
      && !editingUid;
    hint.classList.toggle("pxd-hint--visible", show);
  };
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    syncHint();
  };

  // ---------------------------------------------------------------- sections
  const sectionEls = new Map();
  let selectedSectionId = null;
  const positionSection = (el, section) => {
    el.style.left = `${section.pos?.x ?? 0}px`;
    el.style.top = `${section.pos?.y ?? 0}px`;
    el.style.width = `${section.size?.width ?? 320}px`;
    el.style.height = `${section.size?.height ?? 240}px`;
  };
  const paintSectionColor = (el, section) => {
    const hex = colorHex(section?.color);
    if (hex) el.style.setProperty?.("--pxd-section-color", hex);
    else el.style.removeProperty?.("--pxd-section-color");
  };
  const syncSectionSelection = () => {
    for (const [id, el] of sectionEls) {
      el.classList.toggle("pxd-section--selected", id === selectedSectionId);
    }
  };
  const syncPalette = () => {
    const show = model().selected.size > 0 || Boolean(selectedSectionId);
    palette.classList.toggle("pxd-palette--hidden", !show);
  };
  const applyColor = (id) => {
    const hexId = COLOR_SWATCHES.some((entry) => entry[0] === id) ? id : "";
    let changed = false;
    for (const uid of model().selected) {
      const node = model().nodes.get(uid);
      if (!node) continue;
      node.color = hexId;
      const card = cardEls.get(uid);
      if (card) paintCardColor(card, node);
      changed = true;
    }
    if (selectedSectionId) {
      const section = model().sections.get(selectedSectionId);
      if (section) {
        section.color = hexId;
        const el = sectionEls.get(selectedSectionId);
        if (el) paintSectionColor(el, section);
        changed = true;
      }
    }
    if (changed) markLayoutDirty();
  };
  const startSectionRename = (label) => {
    const sectionId = label.closest?.(".pxd-section")?.dataset?.sectionId;
    const section = sectionId ? model().sections.get(sectionId) : null;
    if (!section) return;
    let cancelled = false;
    let finished = false;
    label.contentEditable = "true";
    label.spellcheck = false;
    label.textContent = section.title || "";
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      label.contentEditable = "false";
      if (commit && !cancelled) {
        const next = String(label.textContent ?? "").trim();
        if (section.title !== next) {
          section.title = next;
          markLayoutDirty();
        }
      }
      label.textContent = section.title || "Section";
    };
    label.addEventListener("blur", () => finish(true), { once: true });
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        label.blur?.();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelled = true;
        label.blur?.();
      }
    });
    label.focus?.();
  };
  const renderSections = () => {
    if (!settings.get("show-sections")) {
      for (const el of sectionEls.values()) el.remove();
      sectionEls.clear();
      return;
    }
    const seen = new Set();
    for (const [id, section] of model().sections) {
      seen.add(id);
      let el = sectionEls.get(id);
      if (!el) {
        el = document.createElement("div");
        el.className = "pxd-section";
        el.dataset.sectionId = id;
        const label = document.createElement("div");
        label.className = "pxd-section__label";
        el._pxdLabel = label;
        const resize = document.createElement("div");
        resize.className = "pxd-section__resize";
        resize.title = "Drag to resize";
        el.append(label, resize);
        sectionEls.set(id, el);
      }
      positionSection(el, section);
      paintSectionColor(el, section);
      el.classList.toggle("pxd-section--selected", id === selectedSectionId);
      if (el._pxdLabel.contentEditable !== "true") {
        el._pxdLabel.textContent = section.title || "Section";
      }
      if (el.parentElement !== sectionsLayer) sectionsLayer.append(el);
    }
    for (const [id, el] of sectionEls) {
      if (seen.has(id)) continue;
      el.remove();
      sectionEls.delete(id);
    }
  };

  // ---------------------------------------------------------------- edges
  const edgePaths = new Map();
  const edgePills = new Map();
  let tempEdge = null;
  let editingEdgeKey = null;
  let edgeEditorEl = null;
  let selectedEdgeKey = null;
  let edgeInspectorEl = null;
  let edgeInspectorControls = null;
  const ROUTE_KINDS = ["straight", "bezier", "elbow"];
  const nextDirection = (edge) => {
    const current = effectiveDirection(edge, settings.get("arrowheads") || "end");
    if (current === "none") return "oneWay";
    if (current === "oneWay") return "twoWay";
    return "none";
  };
  const nextRouteKind = (kind) => {
    const idx = ROUTE_KINDS.indexOf(kind || "bezier");
    return ROUTE_KINDS[(idx + 1) % ROUTE_KINDS.length];
  };
  const syncEdgeInspector = () => {
    if (!edgeInspectorControls || !selectedEdgeKey) return;
    const edge = findEdgeByKey(selectedEdgeKey);
    if (!edge) return;
    const reverseExists = Boolean(findEdgeByKey(`${edge.target}->${edge.source}`));
    edgeInspectorControls.flip.disabled = reverseExists;
    edgeInspectorControls.flip.title = reverseExists ? "Reverse connection already exists" : "Flip";
  };
  const persistEdgeMutation = async (mutator) => {
    if (!selectedEdgeKey) return;
    const edge = findEdgeByKey(selectedEdgeKey);
    if (!edge) return;
    mutator(edge);
    markLayoutDirty();
    await flushLayout();
    renderEdges();
    syncEdgeInspector();
  };
  const flipSelectedEdge = async () => {
    if (!selectedEdgeKey || edgeInspectorControls?.flip?.disabled) return;
    const edge = findEdgeByKey(selectedEdgeKey);
    if (!edge) return;
    const reverseKey = `${edge.target}->${edge.source}`;
    if (findEdgeByKey(reverseKey)) return;
    const snapshot = {
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.label,
      from: edge.from,
      to: edge.to,
      direction: edge.direction,
      color: edge.color,
    };
    model().removeEdge(snapshot.source, snapshot.target);
    const added = model().addEdge(snapshot.target, snapshot.source, snapshot.kind, snapshot.label, {
      from: snapshot.to || "auto",
      to: snapshot.from || "auto",
      direction: snapshot.direction || "",
      color: snapshot.color || "",
    });
    if (!added) {
      model().addEdge(snapshot.source, snapshot.target, snapshot.kind, snapshot.label, {
        from: snapshot.from || "auto",
        to: snapshot.to || "auto",
        direction: snapshot.direction || "",
        color: snapshot.color || "",
      });
      return;
    }
    selectedEdgeKey = reverseKey;
    markLayoutDirty();
    await flushLayout();
    renderEdges();
    syncEdgeInspector();
  };
  const deleteSelectedEdge = async () => {
    if (!selectedEdgeKey) return;
    const edge = findEdgeByKey(selectedEdgeKey);
    if (!edge) return;
    model().removeEdge(edge.source, edge.target);
    clearEdgeSelection();
    markLayoutDirty();
    await flushLayout();
    renderEdges();
  };
  const cardRect = (contentUid) => {
    const node = model().nodes.get(contentUid);
    if (!node) return null;
    return { x: node.pos.x, y: node.pos.y, width: node.size.width, height: node.size.height };
  };
  const edgeKey = (edge) => `${edge.source}->${edge.target}`;
  const findEdgeByKey = (key) => model().edges.find((edge) => edgeKey(edge) === key) || null;
  /**
   * Markers carry literal fills: Chromium does not resolve var() inside SVG presentation
   * attributes, so every color is resolved to a hex/rgb string before it hits the DOM.
   * One helper serves edgesSvg and tempSvg; ids are unique per canvas via canvasId.
   */
  const ensureDefs = (svg, entries) => {
    let defs = svg.querySelector?.("defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      svg.prepend(defs);
    }
    const zoom = model().viewport.zoom || 1;
    for (const entry of entries) {
      if (defs.querySelector?.(`#${entry.id}`)) continue;
      const marker = document.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", entry.id);
      marker.setAttribute("orient", "auto");
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      marker.dataset.pxdKind = entry.kind;
      const head = document.createElementNS(SVG_NS, "path");
      head.classList.add("pxd-arrow");
      head.style.fill = entry.fill;
      head.style.stroke = "none";
      marker.append(head);
      applyMarkerGeometry(marker, markerGeometry(entry.kind, zoom));
      defs.append(marker);
    }
    markerZoom = zoom;
  };
  const edgeColorId = (edge) => (colorHex(edge?.color) ? edge.color : "default");
  const edgeMarkerId = (kind, colorId) => {
    const id = arrowheadMarkerId(kind, canvasId, colorId);
    ensureDefs(edgesSvg, [{ id, kind, fill: resolveEdgeColor(root, colorId === "default" ? "" : colorId) }]);
    return id;
  };
  const tempMarkerId = () => `pxd-arrow-temp-${canvasId}`;
  const positionEdgeChrome = (edge, path, pill) => {
    const source = cardRect(edge.source);
    const target = cardRect(edge.target);
    if (!source || !target) return null;
    const style = settings.get("connector-style") || "bezier";
    const fromSide = edge.from || "auto";
    const toSide = edge.to || "auto";
    const d = buildEdgePath(edge.kind || style, source, target, fromSide, toSide);
    path.setAttribute("d", d);
    const mid = edgeMidpoint(source, target, fromSide, toSide);
    if (pill) {
      pill.style.left = `${mid.x}px`;
      pill.style.top = `${mid.y}px`;
    }
    if (editingEdgeKey === edgeKey(edge) && edgeEditorEl) {
      edgeEditorEl.style.left = `${mid.x}px`;
      edgeEditorEl.style.top = `${mid.y}px`;
    }
    if (selectedEdgeKey === edgeKey(edge)) positionEdgeInspector();
    return d;
  };
  const updateEdgePath = (edge, path) => positionEdgeChrome(edge, path, edgePills.get(edgeKey(edge)));
  const closeEdgeEditor = (commit) => {
    const key = editingEdgeKey;
    const editor = edgeEditorEl;
    editingEdgeKey = null;
    edgeEditorEl = null;
    if (!editor) return;
    const next = String(editor.textContent ?? "").trim();
    editor.remove();
    if (!key) return;
    const edge = findEdgeByKey(key);
    if (!edge) return;
    if (commit) {
      const previous = edge.label || "";
      if (next !== previous) {
        edge.label = next;
        markLayoutDirty();
      }
    }
    renderEdges();
  };
  const openEdgeLabelEditor = (key) => {
    const edge = findEdgeByKey(key);
    if (!edge) return;
    if (editingUid) void exitEdit();
    if (editingEdgeKey === key && edgeEditorEl) {
      edgeEditorEl.focus?.();
      return;
    }
    if (editingEdgeKey) closeEdgeEditor(true);
    const source = cardRect(edge.source);
    const target = cardRect(edge.target);
    if (!source || !target) return;
    const mid = edgeMidpoint(source, target, edge.from || "auto", edge.to || "auto");
    editingEdgeKey = key;
    const editor = document.createElement("div");
    editor.className = "pxd-edge-label-editor";
    editor.contentEditable = "true";
    editor.spellcheck = false;
    editor.textContent = edge.label || "";
    editor.style.left = `${mid.x}px`;
    editor.style.top = `${mid.y}px`;
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        closeEdgeEditor(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEdgeEditor(false);
      }
    });
    editor.addEventListener("blur", () => {
      if (editingEdgeKey === key) closeEdgeEditor(true);
    });
    edgeEditorEl = editor;
    const existingPill = edgePills.get(key);
    existingPill?.remove?.();
    labelsLayer.append(editor);
    editor.focus?.();
  };
  const paintSelectedEdge = () => {
    for (const [key, { path }] of edgePaths) {
      path.classList.toggle("pxd-edge--selected", key === selectedEdgeKey);
    }
  };
  positionEdgeInspector = () => {
    if (!edgeInspectorEl || !selectedEdgeKey) return;
    const edge = findEdgeByKey(selectedEdgeKey);
    if (!edge) return;
    const source = cardRect(edge.source);
    const target = cardRect(edge.target);
    if (!source || !target) return;
    const mid = edgeMidpoint(source, target, edge.from || "auto", edge.to || "auto");
    const screen = worldToScreen(mid.x, mid.y);
    const rect = rootRect();
    edgeInspectorEl.style.left = `${screen.clientX - rect.left}px`;
    edgeInspectorEl.style.top = `${screen.clientY - rect.top}px`;
  };
  const ensureEdgeInspector = () => {
    if (edgeInspectorEl) return edgeInspectorEl;
    const inspector = document.createElement("div");
    inspector.className = "pxd-edge-inspector";
    const makeBtn = (label, onClick) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pxd-edge-inspector__btn";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void onClick?.(event);
      });
      return button;
    };
    const directionBtn = makeBtn("Direction", () => persistEdgeMutation((edge) => {
      edge.direction = nextDirection(edge);
    }));
    const flipBtn = makeBtn("Flip", () => flipSelectedEdge());
    flipBtn.title = "Flip";
    const routeBtn = makeBtn("Route", () => persistEdgeMutation((edge) => {
      edge.kind = nextRouteKind(edge.kind);
    }));
    inspector.append(
      directionBtn,
      flipBtn,
      routeBtn,
      makeBtn("Label", () => {
        if (selectedEdgeKey) openEdgeLabelEditor(selectedEdgeKey);
      }),
    );
    for (const [id, label, hex] of COLOR_SWATCHES) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "pxd-swatch";
      swatch.dataset.color = id;
      swatch.title = label;
      if (hex) swatch.style.background = hex;
      else swatch.classList.add("pxd-swatch--default");
      swatch.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void persistEdgeMutation((edge) => {
          edge.color = id;
        });
      });
      inspector.append(swatch);
    }
    const deleteBtn = makeBtn("Delete", () => deleteSelectedEdge());
    inspector.append(deleteBtn);
    edgeInspectorControls = { direction: directionBtn, flip: flipBtn, route: routeBtn, delete: deleteBtn };
    root.append(inspector);
    edgeInspectorEl = inspector;
    return inspector;
  };
  const clearEdgeSelection = () => {
    selectedEdgeKey = null;
    paintSelectedEdge();
    edgeInspectorEl?.remove?.();
    edgeInspectorEl = null;
    edgeInspectorControls = null;
  };
  const selectEdge = (key) => {
    if (!key || !findEdgeByKey(key)) {
      clearEdgeSelection();
      return;
    }
    model().selected.clear();
    selectedSectionId = null;
    syncSelection();
    selectedEdgeKey = key;
    ensureEdgeInspector();
    syncEdgeInspector();
    paintSelectedEdge();
    positionEdgeInspector();
  };
  const getSelectedEdgeKey = () => selectedEdgeKey;
  const renderEdges = () => {
    const keepEditor = editingEdgeKey && edgeEditorEl;
    edgesSvg.innerHTML = "";
    edgePaths.clear();
    for (const [key, pill] of [...edgePills]) {
      if (keepEditor && key === editingEdgeKey) continue;
      pill.remove?.();
      edgePills.delete(key);
    }
    if (!keepEditor) {
      labelsLayer.querySelectorAll?.(".pxd-edge-label")?.forEach?.((node) => node.remove());
      edgePills.clear();
    }
    syncSvgBounds();
    const width = num("edge-width", 2);
    const animated = settings.get("edge-animated");
    const arrowSetting = settings.get("arrowheads") || "end";
    const showLabels = settings.get("show-edge-labels") !== false;
    for (const edge of model().edges) {
      if (edge.label == null) edge.label = "";
      const key = edgeKey(edge);
      const hit = document.createElementNS(SVG_NS, "path");
      const path = document.createElementNS(SVG_NS, "path");
      const d = positionEdgeChrome(edge, path, null);
      if (!d) continue;
      hit.classList.add("pxd-edge-hit");
      hit.setAttribute("d", d);
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "16");
      hit.setAttribute("title", edge.label || "add note");
      hit.dataset.edgeKey = key;
      path.classList.add("pxd-edge");
      path.setAttribute("fill", "none");
      const colorId = edgeColorId(edge);
      path.style.stroke = resolveEdgeColor(root, colorId === "default" ? "" : colorId);
      path.setAttribute("stroke-width", String(width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("title", edge.label || "add note");
      path.dataset.edgeKey = key;
      const hint = document.createElementNS(SVG_NS, "title");
      hint.textContent = edge.label || "add note";
      path.append(hint);
      if (animated) path.classList.add("pxd-edge--animated");
      const points = directionToPoints(effectiveDirection(edge, arrowSetting));
      if (points.end) path.setAttribute("marker-end", `url(#${edgeMarkerId("end", colorId)})`);
      if (points.start) path.setAttribute("marker-start", `url(#${edgeMarkerId("start", colorId)})`);
      edgesSvg.append(hit, path);
      edgePaths.set(key, { edge, path, hit });
      if (showLabels && edge.label && !(keepEditor && key === editingEdgeKey)) {
        const pill = document.createElement("div");
        pill.className = "pxd-edge-label";
        pill.textContent = edge.label;
        pill.dataset.edgeKey = key;
        pill.title = edge.label;
        const source = cardRect(edge.source);
        const target = cardRect(edge.target);
        if (source && target) {
          const mid = edgeMidpoint(source, target, edge.from || "auto", edge.to || "auto");
          pill.style.left = `${mid.x}px`;
          pill.style.top = `${mid.y}px`;
        }
        labelsLayer.append(pill);
        edgePills.set(key, pill);
      }
    }
    if (selectedEdgeKey && !edgePaths.has(selectedEdgeKey)) clearEdgeSelection();
    else if (selectedEdgeKey) {
      paintSelectedEdge();
      syncEdgeInspector();
      positionEdgeInspector();
    }
  };
  const updateEdgesFor = (uids) => {
    syncSvgBounds();
    for (const { edge, path, hit } of edgePaths.values()) {
      if (!uids.has(edge.source) && !uids.has(edge.target)) continue;
      const pill = edgePills.get(edgeKey(edge));
      const d = positionEdgeChrome(edge, path, pill);
      if (d && hit) hit.setAttribute("d", d);
    }
  };
  const edgeKeyFromTarget = (target) => {
    if (!target) return null;
    const tagged = target.closest?.(".pxd-edge, .pxd-edge-hit, .pxd-edge-label, .pxd-edge-label-editor");
    return tagged?.dataset?.edgeKey || target.dataset?.edgeKey || null;
  };
  const setTempEdge = (from, worldPoint, fromSide = "auto") => {
    const source = cardRect(from);
    if (!source) return;
    if (!tempEdge) {
      const active = resolveActiveColor(root);
      ensureDefs(tempSvg, [{ id: tempMarkerId(), kind: "end", fill: active }]);
      tempEdge = document.createElementNS(SVG_NS, "path");
      tempEdge.classList.add("pxd-edge--temp");
      tempEdge.setAttribute("fill", "none");
      tempEdge.style.stroke = active;
      tempEdge.setAttribute("marker-end", `url(#${tempMarkerId()})`);
      tempEdge.setAttribute("stroke-width", "3");
      tempEdge.setAttribute("stroke-dasharray", "6 4");
      tempEdge.style.pointerEvents = "none";
      tempSvg.append(tempEdge);
    }
    const target = { x: worldPoint.x, y: worldPoint.y, width: 1, height: 1 };
    const style = settings.get("connector-style") || "bezier";
    syncSvgBounds(worldPoint);
    tempEdge.setAttribute("d", buildEdgePath(style, source, target, fromSide || "auto", "auto"));
  };
  const clearTempEdge = () => {
    tempEdge?.remove?.();
    tempEdge = null;
    if (typeof tempSvg.replaceChildren === "function") tempSvg.replaceChildren();
    else if (Array.isArray(tempSvg.children)) tempSvg.children.length = 0;
    else tempSvg.innerHTML = "";
  };

  let connectArm = null;
  // Card under the pointer at the last connect pointermove. pointerup fires on
  // the captured root (or on `document` after Roam re-renders), so the up-event's
  // own target / hit-test can miss a card the user visibly dragged onto.
  let lastHoveredCard = null;
  const trackConnectHover = (event) => {
    lastHoveredCard = cardFromClient(event.clientX, event.clientY, event);
  };
  const onConnectArmMove = (event) => {
    if (!connectArm) return;
    setTempEdge(connectArm.uid, screenToWorld(event.clientX, event.clientY, false), connectArm.side);
    if (!gesture) trackConnectHover(event);
  };
  const armConnect = (uid, side) => {
    if (!uid) return;
    connectArm = { uid, side };
    document.addEventListener("pointermove", onConnectArmMove, true);
  };
  const clearConnectArm = () => {
    if (connectArm) {
      document.removeEventListener("pointermove", onConnectArmMove, true);
    }
    connectArm = null;
    lastHoveredCard = null;
    clearTempEdge();
  };
  const getConnectArm = () => connectArm;

  // ---------------------------------------------------------------- cards
  const cardEls = new Map();
  let editingUid = null;
  let editOpenedAt = 0;
  let stealListening = false;

  const onEditingFocusSteal = (event) => {
    if (!editingUid) return;
    if (!root.classList.contains("pxd-root--editing")) return;
    const target = event.target;
    if (!target || root.contains?.(target)) return;
    const isInput = elementHasClass(target, "rm-block__input")
      || String(target.tagName || "").toLowerCase() === "textarea";
    if (!isInput) return;
    if (roamBlockInputUid(target) !== editingUid) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  const attachFocusGuard = () => {
    if (stealListening || typeof document.addEventListener !== "function") return;
    document.addEventListener("focus", onEditingFocusSteal, true);
    document.addEventListener("scroll", onEditingFocusSteal, true);
    stealListening = true;
  };
  const detachFocusGuard = () => {
    if (!stealListening || typeof document.removeEventListener !== "function") return;
    document.removeEventListener("focus", onEditingFocusSteal, true);
    document.removeEventListener("scroll", onEditingFocusSteal, true);
    stealListening = false;
  };

  const cardTitleText = (child) => {
    if (model().isNestedDiagram(child.uid)) return parseDiagramTitle(child.string) || "";
    const cleaned = String(child.string || "").replace(/\{\{.*?\}\}/, "").trim();
    if (cleaned) return cleaned;
    return String(child.string || "").slice(0, 48);
  };

  const renderStringInto = (el, string) => {
    const components = roamUi()?.components;
    if (string && components?.renderString) {
      try {
        components.renderString({ string, el });
        return;
      } catch { /* fall through to text */ }
    }
    el.textContent = string;
  };

  const unmountRoam = (el) => {
    try {
      roamUi()?.components?.unmountNode?.({ el });
    } catch { /* not mounted by Roam */ }
  };

  const paintCardBody = (card, child) => {
    const body = card._pxdBody;
    if (!body) return;
    if (card._pxdNameTimer) {
      clearTimeout(card._pxdNameTimer);
      card._pxdNameTimer = null;
    }
    unmountRoam(body);
    body.innerHTML = "";
    card.classList.remove("pxd-card--empty");
    if (model().isNestedDiagram(child.uid)) {
      const parsed = parseDiagramTitle(child.string);
      if (parsed) {
        const label = document.createElement("div");
        label.className = "pxd-card__nested-label";
        label.textContent = parsed;
        const sub = document.createElement("div");
        sub.className = "pxd-card__placeholder";
        sub.textContent = "Double-click to open";
        body.append(label, sub);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "pxd-card__nested-name";
        input.placeholder = "Name this board…";
        input.value = "";
        input.addEventListener("pointerdown", (event) => event.stopPropagation());
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        input.addEventListener("input", () => {
          if (diagramUidFromLocation() === child.uid) return;
          if (card._pxdNameTimer) clearTimeout(card._pxdNameTimer);
          card._pxdNameTimer = setTimeout(() => {
            card._pxdNameTimer = null;
            const name = String(input.value || "").trim();
            const next = name ? `{{[[diagram]]:${name}}}` : "{{[[diagram]]}}";
            void updateBlock(child.uid, next).then(() => {
              const live = model().getCard(child.uid);
              if (live) live.string = next;
              child.string = next;
              card._pxdString = next;
            }).catch(() => {});
          }, 150);
        });
        const sub = document.createElement("div");
        sub.className = "pxd-card__placeholder";
        sub.textContent = "Double-click to open";
        body.append(input, sub);
      }
      const nestedLayout = currentSession.metadataStore?.get?.(child.uid);
      const nestedNodes = nestedLayout?.nodes;
      if (nestedNodes && nestedNodes.size > 0) {
        const preview = document.createElement("div");
        preview.className = "pxd-card__preview";
        const entries = [...nestedNodes.values()].slice(0, 8);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const node of entries) {
          const x = node.pos?.x ?? 0;
          const y = node.pos?.y ?? 0;
          const w = node.size?.width ?? 40;
          const h = node.size?.height ?? 24;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
        }
        const bw = Math.max(maxX - minX, 1);
        const bh = Math.max(maxY - minY, 1);
        for (const node of entries) {
          const rect = document.createElement("div");
          rect.className = "pxd-card__preview-node";
          const x = node.pos?.x ?? 0;
          const y = node.pos?.y ?? 0;
          const w = node.size?.width ?? 40;
          const h = node.size?.height ?? 24;
          rect.style.left = `${((x - minX) / bw) * 100}%`;
          rect.style.top = `${((y - minY) / bh) * 100}%`;
          rect.style.width = `${(w / bw) * 100}%`;
          rect.style.height = `${(h / bh) * 100}%`;
          preview.append(rect);
        }
        body.append(preview);
      }
    } else if (!child.string.trim()) {
      card.classList.add("pxd-card--empty");
      const placeholder = document.createElement("div");
      placeholder.className = "pxd-card__placeholder";
      placeholder.textContent = "Empty card · double-click to write";
      body.append(placeholder);
    } else {
      renderStringInto(body, child.string);
    }
    card._pxdString = child.string;
  };

  const exitEdit = async (persistString = true) => {
    const uid = editingUid;
    if (!uid) return;
    editingUid = null;
    editOpenedAt = 0;
    detachFocusGuard();
    const card = cardEls.get(uid);
    root.classList.remove("pxd-root--editing");
    const body = card?._pxdBody;
    if (body) unmountRoam(body);
    const scratchUid = peekScratch()?.uid;
    let child = model().getCard(uid);
    if (persistString && scratchUid) {
      try {
        const pulled = globalThis.roamAlphaAPI?.data?.pull?.("[:block/string]", [":block/uid", scratchUid]);
        const fresh = pulled?.[":block/string"] ?? pulled?.string;
        if (shouldCommitPulledString(child?.string, fresh)) {
          try {
            await updateBlock(uid, fresh);
          } catch { /* keep going so the overlay still paints */ }
          child = { ...(child || { uid }), string: fresh };
          const live = model().getCard(uid);
          if (live) live.string = fresh;
        }
        await cloneBlockChildren(scratchUid, uid);
      } catch { /* keep the model string */ }
    }
    try {
      await blankScratch();
    } catch { /* scratch blank is best-effort */ }
    if (!card) {
      syncHint();
      return;
    }
    card.classList.remove("pxd-card--editing");
    if (child) paintCardBody(card, child);
    syncHint();
  };

  const enterEdit = async (uid) => {
    const card = cardEls.get(uid);
    const child = model().getCard(uid);
    if (!card || !child || model().isNestedDiagram(uid)) return;
    if (editingUid === uid) return;
    if (editingUid) await exitEdit();
    if (editingEdgeKey) closeEdgeEditor(true);
    const components = roamUi()?.components;
    if (!settings.get("native-block-editor") || !components?.renderBlock) {
      onPersist?.({ openBlock: uid });
      return;
    }
    const scratch = await acquireScratch();
    if (!scratch?.uid) {
      onPersist?.({ openBlock: uid });
      return;
    }
    editingUid = uid;
    editOpenedAt = Date.now();
    root.classList.add("pxd-root--editing");
    attachFocusGuard();
    model().selected = new Set([uid]);
    syncSelection();
    card.classList.add("pxd-card--editing");
    const body = card._pxdBody;
    unmountRoam(body);
    const fallback = document.createElement("div");
    fallback.className = "pxd-card__edit-fallback";
    fallback.textContent = child.string;
    const editor = document.createElement("div");
    editor.className = "pxd-card__editor";
    body.innerHTML = "";
    body.append(fallback, editor);
    await blankScratch();
    if (!scratchTextareaFocused()) {
      try {
        await updateBlock(scratch.uid, child.string || " ");
      } catch { /* mount anyway; Roam may still show the last scratch string */ }
    }
    try {
      await cloneBlockChildren(uid, scratch.uid);
    } catch { /* mount with string only */ }
    try {
      components.renderBlock({ uid: scratch.uid, el: editor });
    } catch {
      await exitEdit(false);
      return;
    }
    await waitHydrateQuiet(editor, HYDRATE_CAP_MS);
    if (disposed || editingUid !== uid) return;
    const input = editor.querySelector?.(".rm-block__input")
      || body.querySelector?.(".pxd-card__editor .rm-block__input, .pxd-card__editor textarea");
    if (input) {
      body.querySelector?.(".pxd-card__edit-fallback")?.remove?.();
      focusRoamInput(input);
    }
    syncHint();
  };

  const syncSelection = () => {
    for (const [uid, card] of cardEls) {
      card.classList.toggle("pxd-card--selected", model().selected.has(uid));
    }
    syncSectionSelection();
    syncPalette();
    scheduleMinimap();
  };

  const paintCardColor = (card, node) => {
    const hex = colorHex(node?.color);
    if (hex) {
      card.style.setProperty?.("--pxd-card-color", hex);
      card.style.borderColor = hex;
    } else {
      card.style.removeProperty?.("--pxd-card-color");
      card.style.borderColor = "";
    }
  };

  const positionCard = (card, node) => {
    card.style.left = `${node.pos.x}px`;
    card.style.top = `${node.pos.y}px`;
    card.style.width = `${node.size.width}px`;
    card.style.height = `${node.size.height}px`;
  };

  const buildCard = (child) => {
    const card = document.createElement("div");
    card.className = "pxd-card";
    card.dataset.uid = child.uid;
    const title = document.createElement("div");
    title.className = "pxd-card__title";
    const body = document.createElement("div");
    body.className = "pxd-card__body";
    card._pxdTitle = title;
    card._pxdBody = body;
    card.append(title, body);
    for (const side of ["top", "right", "bottom", "left"]) {
      const handle = document.createElement("div");
      handle.className = `pxd-handle pxd-handle--${side}`;
      handle.dataset.side = side;
      handle.title = "Drag to connect";
      card.append(handle);
    }
    const resize = document.createElement("div");
    resize.className = "pxd-card__resize";
    resize.title = "Drag to resize";
    card.append(resize);
    return card;
  };

  const renderCards = () => {
    const defaults = defaultCardSize();
    const radius = num("card-radius", 8);
    const seen = new Set();
    for (const child of model().children) {
      seen.add(child.uid);
      const node = model().ensureNode(child.uid, defaults);
      let card = cardEls.get(child.uid);
      if (!card) {
        card = buildCard(child);
        cardEls.set(child.uid, card);
        card._pxdString = null;
      }
      card.classList.toggle("pxd-card--compact", Boolean(settings.get("compact-cards")));
      card.classList.toggle("pxd-card--shadow", Boolean(settings.get("card-shadow")));
      card.classList.toggle("pxd-card--nested", model().isNestedDiagram(child.uid));
      card.classList.toggle("pxd-card--selected", model().selected.has(child.uid));
      card.style.borderRadius = `${radius}px`;
      positionCard(card, node);
      paintCardColor(card, node);
      const titleText = cardTitleText(child);
      const showTitle = settings.get("show-card-title") && titleText !== child.string.trim();
      card.classList.toggle("pxd-card--titled", Boolean(showTitle));
      card._pxdTitle.textContent = showTitle ? titleText : "";
      if (editingUid !== child.uid && card._pxdString !== child.string) paintCardBody(card, child);
      if (card.parentElement !== cardsLayer) cardsLayer.append(card);
    }
    for (const [uid, card] of cardEls) {
      if (seen.has(uid)) continue;
      if (editingUid === uid) void exitEdit(false);
      unmountRoam(card._pxdBody);
      card.remove();
      cardEls.delete(uid);
    }
  };

  const render = () => {
    root.dataset.renderChildrenDepth = String(settings.get("render-children-depth") ?? "1");
    renderGrid();
    applyTransform();
    renderSections();
    renderCards();
    renderEdges();
    renderCrumbs();
    syncHint();
    syncPalette();
    scheduleMinimap();
  };

  const clearMountedCards = () => {
    for (const card of cardEls.values()) {
      if (card._pxdNameTimer) {
        clearTimeout(card._pxdNameTimer);
        card._pxdNameTimer = null;
      }
      unmountRoam(card._pxdBody);
      card.remove();
    }
    cardEls.clear();
    if (Array.isArray(cardsLayer.children)) cardsLayer.children.length = 0;
    for (const el of sectionEls.values()) el.remove();
    sectionEls.clear();
    if (Array.isArray(sectionsLayer.children)) sectionsLayer.children.length = 0;
    edgePaths.clear();
    for (const pill of edgePills.values()) pill.remove?.();
    edgePills.clear();
    if (Array.isArray(labelsLayer.children)) labelsLayer.children.length = 0;
    if (editingEdgeKey) closeEdgeEditor(false);
    clearTempEdge();
  };

  const attachSession = (nextSession) => {
    if (!nextSession || nextSession === currentSession) return;
    void exitEdit(false);
    if (editingEdgeKey) closeEdgeEditor(false);
    clearEdgeSelection();
    endGesture();
    clearConnectArm();
    clearMountedCards();
    selectedSectionId = null;
    if (layoutTimer) { clearTimeout(layoutTimer); layoutTimer = null; }
    if (viewportTimer) { clearTimeout(viewportTimer); viewportTimer = null; }
    const flushLayoutNow = layoutDirty;
    const flushViewportNow = viewportDirty;
    layoutDirty = false;
    viewportDirty = false;
    const outgoing = currentSession;
    currentSession = nextSession;
    if (flushLayoutNow) void outgoing?.persistLayout?.();
    if (flushViewportNow) void outgoing?.persistViewport?.();
    const size = viewSize();
    const viewport = nextSession.model?.viewport;
    const usable = viewport
      && size.width
      && size.height
      && !viewportNeedsFit(viewport, nextSession.model.nodes, size, zoomBounds());
    if (usable) {
      initialFitDone = true;
      applyTransform();
    } else {
      initialFitDone = false;
      scheduleInitialFit();
    }
    setActiveTool(model().activeTool || "select");
    render();
  };

  // ---------------------------------------------------------------- pointer model
  let gesture = null;
  let spaceDown = false;
  let lastToolAddAt = 0;

  const beginGesture = (next) => {
    gesture = next;
    root.classList.add("pxd-root--gesturing");
    if (next.kind === "pan") root.classList.add("pxd-root--panning");
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
  };
  const endGesture = () => {
    if (!gesture) return;
    gesture = null;
    root.classList.remove("pxd-root--gesturing", "pxd-root--panning", "pxd-root--dragging");
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    if (!connectArm) clearTempEdge();
  };

  const hitStackFromPoint = (clientX, clientY) => {
    if (typeof document.elementsFromPoint === "function") {
      return document.elementsFromPoint(clientX, clientY) || [];
    }
    const el = document.elementFromPoint?.(clientX, clientY);
    return el ? [el] : [];
  };
  const cardFromPoint = (clientX, clientY) => cardUidFromHitStack(hitStackFromPoint(clientX, clientY), cardsLayer);
  const pointInInflatedRect = (worldPoint, node) => {
    if (!node?.pos || !node?.size) return false;
    const pad = CONNECT_HIT_INFLATE_PX;
    const { x, y } = worldPoint;
    return x >= node.pos.x - pad
      && x <= node.pos.x + node.size.width + pad
      && y >= node.pos.y - pad
      && y <= node.pos.y + node.size.height + pad;
  };
  const cardFromWorldRects = (clientX, clientY) => {
    const world = screenToWorld(clientX, clientY, false);
    for (const child of model().children) {
      const node = model().nodes.get(child.uid);
      if (node && pointInInflatedRect(world, node)) return child.uid;
    }
    return null;
  };
  // The painted card boxes are the source of truth for "is the cursor over this
  // card": they survive pan/zoom/fullscreen/ancestor-scale drift that makes the
  // screenToWorld ↔ node.pos formula disagree with what the user sees, and
  // `elementsFromPoint` returning [] under the `.pxd-world` transform in Electron.
  // Last match wins (later siblings paint on top). Zero-size rects are unpainted.
  const cardFromDomRects = (clientX, clientY) => {
    const pad = CONNECT_HIT_INFLATE_PX;
    const els = Array.isArray(cardsLayer.children) && cardsLayer.children.length
      ? cardsLayer.children
      : [...cardEls.values()];
    let hit = null;
    for (const el of els) {
      const uid = el?.dataset?.uid;
      if (!uid || typeof el.getBoundingClientRect !== "function") continue;
      const r = el.getBoundingClientRect();
      if (!r || !(r.width > 0) || !(r.height > 0)) continue;
      const right = r.right ?? r.left + r.width;
      const bottom = r.bottom ?? r.top + r.height;
      if (clientX >= r.left - pad && clientX <= right + pad
        && clientY >= r.top - pad && clientY <= bottom + pad) hit = uid;
    }
    return hit;
  };
  const cardFromClient = (clientX, clientY, event) => {
    const fromDom = cardFromDomRects(clientX, clientY);
    if (fromDom) return fromDom;
    const fromPoint = cardFromPoint(clientX, clientY);
    if (fromPoint) return fromPoint;
    const fromRects = cardFromWorldRects(clientX, clientY);
    if (fromRects) return fromRects;
    const card = event?.target?.closest?.(".pxd-card");
    return card?.dataset?.uid || null;
  };
  const connectSideFromPoint = (clientX, clientY, targetUid) => {
    if (!targetUid) return "auto";
    for (const el of hitStackFromPoint(clientX, clientY)) {
      if (!el) continue;
      const handle = elementHasClass(el, "pxd-handle") ? el : el.closest?.(".pxd-handle");
      if (!handle) continue;
      const card = handle.closest?.(".pxd-card");
      if (!card || card.dataset?.uid !== targetUid) continue;
      return handle.dataset?.side || "auto";
    }
    return "auto";
  };

  const selectCard = (uid, additive) => {
    clearEdgeSelection();
    selectedSectionId = null;
    const selected = model().selected;
    if (additive) {
      if (selected.has(uid)) selected.delete(uid);
      else selected.add(uid);
    } else if (!selected.has(uid)) {
      selected.clear();
      selected.add(uid);
    }
    syncSelection();
  };

  const selectSection = (sectionId) => {
    clearEdgeSelection();
    selectedSectionId = sectionId;
    model().selected.clear();
    syncSelection();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target;
    if (target?.closest?.(".pxd-toolbar") || target?.closest?.(".pxd-edge-inspector") || target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    if (target?.closest?.(".pxd-edge-label-editor")) return;
    dismissHint();
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid || null;
    const tool = model().activeTool || "select";
    const panRequested = event.button === 1 || (spaceDown && settings.get("pan-on-space"));

    if (editingUid && editingUid !== uid) void exitEdit();
    if (editingUid && editingUid === uid) return; // Roam owns the caret inside an editing card.
    if (target?.closest?.(".pxd-edge-label")) {
      if (editingEdgeKey && edgeKeyFromTarget(target) !== editingEdgeKey) closeEdgeEditor(true);
      return;
    }
    const edgeHit = target?.closest?.(".pxd-edge") || target?.closest?.(".pxd-edge-hit");
    if (edgeHit) {
      const key = edgeKeyFromTarget(target);
      if (key) {
        if (editingEdgeKey && editingEdgeKey !== key) closeEdgeEditor(true);
        selectEdge(key);
        event.preventDefault();
        return;
      }
    }

    const sectionEl = !uid && !panRequested ? target?.closest?.(".pxd-section") : null;
    if (sectionEl && !connectArm) {
      const sectionId = sectionEl.dataset?.sectionId;
      const section = sectionId ? model().sections.get(sectionId) : null;
      if (section) {
        const start = { x: event.clientX, y: event.clientY };
        selectSection(sectionId);
        if (target.closest(".pxd-section__resize")) {
          beginGesture({ kind: "section-resize", sectionId, start, size: { ...section.size }, moved: false });
          event.preventDefault();
          return;
        }
        if (target.closest(".pxd-section__label")) {
          event.preventDefault();
          return;
        }
        if (target.closest(".pxd-section__label")?.isContentEditable || target.isContentEditable) return;
        if (tool === "select" || tool === "section") {
          beginGesture({ kind: "section-drag", sectionId, start, origin: { ...section.pos }, moved: false });
          event.preventDefault();
          return;
        }
      }
    }

    if ((uid || connectArm) && !panRequested) {
      const start = { x: event.clientX, y: event.clientY };
      if (uid && target.closest(".pxd-card__resize")) {
        const node = model().nodes.get(uid);
        beginGesture({ kind: "resize", uid, start, size: { ...node.size }, moved: false });
        event.preventDefault();
        return;
      }
      const handleEl = target.closest?.(".pxd-handle");
      const connectFrom = connectArm?.uid
        || ((handleEl || tool === "connect") ? uid : null);
      if (connectFrom) {
        const fromSide = connectArm?.side ?? handleEl?.dataset?.side;
        beginGesture({ kind: "connect", uid: connectFrom, start, moved: false, fromSide });
        setTempEdge(connectFrom, screenToWorld(event.clientX, event.clientY, false), fromSide);
        try { root.setPointerCapture?.(event.pointerId); } catch { /* unsupported */ }
        event.preventDefault();
        return;
      }
      if (!uid) {
        /* empty space with no connect arm — fall through */
      } else {
        if (tool !== "select") return;
        selectCard(uid, event.shiftKey);
        const origins = new Map();
        for (const selectedUid of model().selected) {
          const node = model().nodes.get(selectedUid);
          if (node) origins.set(selectedUid, { ...node.pos });
        }
        beginGesture({ kind: "drag", uid, start, origins, moved: false });
        return;
      }
    }

    if (panRequested || tool === "select") {
      beginGesture({
        kind: "pan",
        start: { x: event.clientX, y: event.clientY },
        viewport: { ...model().viewport },
        moved: false,
      });
      event.preventDefault();
    }
  };

  const onPointerMove = (event) => {
    if (connectArm && (!gesture || gesture.kind === "connect")) {
      setTempEdge(connectArm.uid, screenToWorld(event.clientX, event.clientY, false), connectArm.side);
    }
    if (!gesture) return;
    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
    if (gesture.kind === "connect") {
      setTempEdge(gesture.uid, screenToWorld(event.clientX, event.clientY, false), gesture.fromSide);
      if (!gesture.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) gesture.moved = true;
      trackConnectHover(event);
      return;
    }
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;
    const zoom = model().viewport.zoom || 1;
    if (gesture.kind === "pan") {
      const viewport = model().viewport;
      viewport.x = gesture.viewport.x + dx;
      viewport.y = gesture.viewport.y + dy;
      applyTransform();
      return;
    }
    if (gesture.kind === "drag") {
      root.classList.add("pxd-root--dragging");
      const moved = new Set();
      for (const [uid, origin] of gesture.origins) {
        const card = cardEls.get(uid);
        if (!card) continue;
        const pos = { x: snap(origin.x + dx / zoom), y: snap(origin.y + dy / zoom) };
        model().setNodePosition(uid, pos);
        positionCard(card, model().nodes.get(uid));
        moved.add(uid);
      }
      updateEdgesFor(moved);
      scheduleMinimap();
      return;
    }
    if (gesture.kind === "resize") {
      const card = cardEls.get(gesture.uid);
      if (!card) return;
      model().setNodeSize(gesture.uid, {
        width: snap(gesture.size.width + dx / zoom),
        height: snap(gesture.size.height + dy / zoom),
      });
      positionCard(card, model().nodes.get(gesture.uid));
      updateEdgesFor(new Set([gesture.uid]));
      scheduleMinimap();
      return;
    }
    if (gesture.kind === "section-drag") {
      const section = model().sections.get(gesture.sectionId);
      const el = sectionEls.get(gesture.sectionId);
      if (!section) return;
      section.pos = { x: snap(gesture.origin.x + dx / zoom), y: snap(gesture.origin.y + dy / zoom) };
      if (el) positionSection(el, section);
      return;
    }
    if (gesture.kind === "section-resize") {
      const section = model().sections.get(gesture.sectionId);
      const el = sectionEls.get(gesture.sectionId);
      if (!section) return;
      section.size = {
        width: Math.max(160, snap(gesture.size.width + dx / zoom)),
        height: Math.max(100, snap(gesture.size.height + dy / zoom)),
      };
      if (el) positionSection(el, section);
    }
  };

  const onPointerUp = async (event) => {
    const active = gesture;
    if (!active) return;
    endGesture();
    if (active.kind === "pan") {
      if (active.moved) markViewportDirty();
      else if (model().activeTool === "select" && !event.shiftKey) {
        if (model().selected.size || selectedSectionId) {
          model().selected.clear();
          selectedSectionId = null;
          syncSelection();
        }
        clearEdgeSelection();
      }
      return;
    }
    if (active.kind === "drag" || active.kind === "resize" || active.kind === "section-drag" || active.kind === "section-resize") {
      if (active.moved) markLayoutDirty();
      return;
    }
    if (active.kind === "connect") {
      const hovered = lastHoveredCard;
      const targetUid = cardFromClient(event.clientX, event.clientY, event) || hovered;
      const sourceNode = model().nodes.get(active.uid);
      const sourceHit = pointInInflatedRect(screenToWorld(event.clientX, event.clientY, false), sourceNode);
      if (!active.moved && !connectArm && (targetUid === active.uid || (!targetUid && sourceHit))) {
        armConnect(active.uid, active.fromSide);
        setTempEdge(active.uid, screenToWorld(event.clientX, event.clientY, false), active.fromSide);
        return;
      }
      if (!active.moved && connectArm && targetUid === connectArm.uid) {
        return;
      }
      const fromSide = active.fromSide ?? connectArm?.side;
      const toSide = connectSideFromPoint(event.clientX, event.clientY, targetUid);
      await completeConnect({
        moved: active.moved,
        sourceUid: active.uid,
        targetUid,
        clientX: event.clientX,
        clientY: event.clientY,
        fromSide,
        toSide,
        event,
      });
    }
  };

  const completeConnect = async ({ moved, sourceUid, targetUid, clientX, clientY, fromSide, toSide, event }) => {
    const hovered = lastHoveredCard;
    const resolvedTarget = cardFromClient(clientX, clientY, event) || targetUid || hovered || null;
    const resolvedFrom = fromSide ?? connectArm?.side;
    const resolvedTo = toSide ?? connectSideFromPoint(clientX, clientY, resolvedTarget);
    const edgeExtra = {
      from: resolvedFrom || "auto",
      to: resolvedTo || "auto",
      direction: effectiveDirection({}, settings.get("arrowheads") || "end"),
    };
    try {
      if (resolvedTarget && resolvedTarget !== sourceUid) {
        const added = model().addEdge(
          sourceUid,
          resolvedTarget,
          settings.get("connector-style") || "bezier",
          "",
          edgeExtra,
        );
        renderEdges();
        if (added) {
          try {
            layoutDirty = true;
            await flushLayout();
          } catch {
            model().removeEdge(sourceUid, resolvedTarget);
            renderEdges();
          }
        }
        return;
      }
      // Heptabase pull-from-port: only a real drag onto empty board spawns a card.
      // A click-click that lands on nothing (or a hit-test miss over a card we
      // were just hovering) cancels instead of leaving a blank editing card.
      if (!resolvedTarget && moved === true && !hovered) {
        const point = screenToWorld(clientX, clientY);
        const size = defaultCardSize();
        const addEdge = { source: sourceUid };
        if (resolvedFrom && resolvedFrom !== "auto") addEdge.from = resolvedFrom;
        await onPersist?.({
          addCard: {
            x: snap(point.x - size.width / 2),
            y: snap(point.y - size.height / 2),
          },
          addEdge,
        });
      }
    } catch { /* connect-to-empty or persist failed — no dangling edge */ } finally {
      clearConnectArm();
      lastHoveredCard = null;
    }
  };

  const onDoubleClick = (event) => {
    const target = event.target;
    if (target?.closest?.(".pxd-toolbar") || target?.closest?.(".pxd-edge-inspector") || target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    const edgeKeyHit = edgeKeyFromTarget(target);
    if (edgeKeyHit) {
      event.preventDefault();
      event.stopPropagation?.();
      openEdgeLabelEditor(edgeKeyHit);
      return;
    }
    const sectionLabel = target?.closest?.(".pxd-section__label");
    if (sectionLabel) {
      event.preventDefault();
      startSectionRename(sectionLabel);
      return;
    }
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid;
    if (uid) {
      if (target?.closest?.(".pxd-card__nested-name")) return;
      if (editingUid === uid) return;
      event.preventDefault();
      if (model().isNestedDiagram(uid)) onPersist?.({ openNested: uid });
      else void enterEdit(uid);
      return;
    }
    event.preventDefault();
    dismissHint();
    if (Date.now() - lastToolAddAt < 600) return; // the Card tool already added on click one
    const point = screenToWorld(event.clientX, event.clientY);
    const size = defaultCardSize();
    setActiveTool("select");
    void onPersist?.({ addCard: { x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) } });
  };

  const onClick = (event) => {
    const target = event.target;
    if (target?.closest?.(".pxd-palette") || target?.closest?.(".pxd-swatch")) return;
    if (target?.closest?.(".pxd-card") || target?.closest?.(".pxd-toolbar") || target?.closest?.(".pxd-edge-inspector")) return;
    if (target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    if (target?.closest?.(".pxd-edge-label-editor")) return;
    const sectionLabel = target?.closest?.(".pxd-section__label");
    if (sectionLabel) {
      if (sectionLabel.isContentEditable) return;
      event.preventDefault();
      startSectionRename(sectionLabel);
      return;
    }
    if (target?.closest?.(".pxd-section")) return;
    if (event.detail > 1) return;
    const pill = target?.closest?.(".pxd-edge-label");
    if (pill?.dataset?.edgeKey) {
      event.preventDefault();
      openEdgeLabelEditor(pill.dataset.edgeKey);
      return;
    }
    if (edgeKeyFromTarget(target)) return;
    const tool = model().activeTool;
    if (tool === "card" || tool === "nested" || tool === "section") {
      const point = screenToWorld(event.clientX, event.clientY);
      lastToolAddAt = Date.now();
      if (tool === "section") void onPersist?.({ addSection: point });
      else void onPersist?.({ addCard: point, string: tool === "nested" ? "{{[[diagram]]}}" : "" });
      if (tool !== "section") setActiveTool("select");
    }
  };

  const onWheel = (event) => {
    if (editingUid && event.target?.closest?.(".pxd-card--editing")) return;
    const pinch = event.ctrlKey || event.metaKey;
    const zoomWheel = settings.get("wheel-zoom");
    event.preventDefault();
    const rect = rootRect();
    if (pinch || zoomWheel) {
      const oldZoom = model().viewport.zoom || 1;
      const factor = Math.exp(-event.deltaY * (pinch ? 0.01 : 0.002));
      zoomAt(oldZoom * factor, event.clientX - rect.left, event.clientY - rect.top);
      if ((model().viewport.zoom || 1) !== oldZoom) markViewportDirty();
    } else {
      const viewport = model().viewport;
      viewport.x -= event.deltaX;
      viewport.y -= event.deltaY;
      applyTransform();
      markViewportDirty();
    }
  };

  const onFocusOut = (event) => {
    if (!editingUid) return;
    if (Date.now() - editOpenedAt < EDIT_GRACE_MS) return;
    const card = cardEls.get(editingUid);
    if (!card) return;
    const next = event.relatedTarget;
    if (next && (card.contains?.(next) || next.closest?.(".bp3-portal, .rm-autocomplete__wrapper"))) return;
    setTimeout(() => {
      if (!editingUid) return;
      if (Date.now() - editOpenedAt < EDIT_GRACE_MS) return;
      const activeEl = document.activeElement;
      if (activeEl && (card.contains?.(activeEl) || activeEl.closest?.(".bp3-portal, .rm-autocomplete__wrapper"))) return;
      exitEdit();
    }, 0);
  };

  let pointerInside = false;
  const overlayOwnsPointer = () => {
    if (pointerInside) return true;
    const active = globalThis.document?.activeElement;
    return Boolean(active && (root.contains?.(active) || active === root));
  };
  const addCardAtViewCenter = () => {
    const size = defaultCardSize();
    const rect = rootRect();
    const { x, y, zoom } = model().viewport;
    const z = zoom || 1;
    void onPersist?.({
      addCard: {
        x: snap((rect.width / 2 - x) / z - size.width / 2),
        y: snap((rect.height / 2 - y) / z - size.height / 2),
      },
    });
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      const owns = overlayOwnsPointer() || isFullscreen();
      const typingElsewhere = isTextEntryTarget(event.target) && !root.contains?.(event.target);
      if (typingElsewhere) return;
      if (connectArm && owns) {
        event.preventDefault();
        clearConnectArm();
        return;
      }
      if (editingEdgeKey) {
        event.preventDefault();
        closeEdgeEditor(false);
        return;
      }
      if (editingUid) {
        event.preventDefault();
        void exitEdit();
        return;
      }
      if (selectedEdgeKey && owns) {
        event.preventDefault();
        clearEdgeSelection();
        return;
      }
      if (crumbs.length && owns) {
        event.preventDefault();
        const parent = crumbs[crumbs.length - 1];
        if (parent?.uid) void onPersist?.({ openCrumb: parent.uid });
        return;
      }
      if (isFullscreen()) {
        event.preventDefault();
        event.stopPropagation();
        setFullscreen(false);
      }
      return;
    }
    if (event.code === "Space" && settings.get("pan-on-space") && !isTextEntryTarget(event.target)) {
      spaceDown = true;
      root.classList.add("pxd-root--space");
    }
    if (settings.get("enable-shortcuts") === false) return;
    if (editingUid || editingEdgeKey) return;
    if (isTextEntryTarget(event.target)) return;
    const shortcutOwns = overlayOwnsPointer() || isFullscreen();
    if (!shortcutOwns) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selectedEdgeKey) {
      event.preventDefault();
      void deleteSelectedEdge();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && model().selected.size > 0) {
      event.preventDefault();
      const uids = [...model().selected];
      model().selected.clear();
      syncSelection();
      void onPersist?.({ deleteCards: uids });
      return;
    }
    const key = String(event.key || "").toLowerCase();
    if (key === "v") {
      event.preventDefault();
      setActiveTool("select");
    } else if (key === "c") {
      event.preventDefault();
      setActiveTool("connect");
    } else if (key === "n") {
      event.preventDefault();
      addCardAtViewCenter();
    } else if (key === "f") {
      event.preventDefault();
      fitToView();
      markViewportDirty();
    }
  };
  const onKeyUp = (event) => {
    if (event.code === "Space") {
      spaceDown = false;
      root.classList.remove("pxd-root--space");
    }
  };

  const onDragOver = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (event) => {
    event.preventDefault();
    const parsed = parseDropPayload(event.dataTransfer);
    if (!parsed) return;
    const point = screenToWorld(event.clientX, event.clientY);
    const size = defaultCardSize();
    void onPersist?.({
      addCard: {
        x: snap(point.x - size.width / 2),
        y: snap(point.y - size.height / 2),
      },
      string: parsed.string,
    });
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerenter", () => { pointerInside = true; });
  root.addEventListener("pointerleave", () => { pointerInside = false; });
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("click", onClick);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("drop", onDrop);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  setActiveTool(model().activeTool || "select");
  render();
  scheduleInitialFit();

  return {
    root,
    render,
    applyTransform,
    fitToView,
    editCard: enterEdit,
    completeConnect,
    attachSession,
    armConnect,
    clearConnectArm,
    getConnectArm,
    selectEdge,
    clearEdgeSelection,
    getSelectedEdgeKey,
    setLibraryOpen(open) {
      toolButtons.get("library")?.classList.toggle("pxd-toolbar__btn--active", Boolean(open));
    },
    setFullscreen,
    dispose() {
      disposed = true;
      cancelInitialFit?.();
      minimapScheduled?.();
      cancelFullscreenPlace?.();
      if (editingEdgeKey) closeEdgeEditor(false);
      clearEdgeSelection();
      if (editingUid) void exitEdit(false);
      detachFocusGuard();
      clearConnectArm();
      endGesture();
      if (viewportTimer) {
        clearTimeout(viewportTimer);
        viewportTimer = null;
      }
      if (layoutTimer) {
        clearTimeout(layoutTimer);
        layoutTimer = null;
      }
      for (const card of cardEls.values()) {
        if (card._pxdNameTimer) {
          clearTimeout(card._pxdNameTimer);
          card._pxdNameTimer = null;
        }
        unmountRoam(card._pxdBody);
      }
      cardEls.clear();
      for (const el of sectionEls.values()) el.remove();
      sectionEls.clear();
      setFullscreen(false);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onWindowResize);
      root.remove();
    },
  };
}

export function viewportCenterPosition(root, session, settings) {
  const rect = root.getBoundingClientRect();
  const zoom = session.model.viewport.zoom || 1;
  const snap = (value) => {
    if (!settings?.get?.("snap-to-grid")) return value;
    const size = Number(settings.get("grid-size")) || 24;
    return Math.round(value / size) * size;
  };
  return {
    x: snap((rect.width / 2 - session.model.viewport.x) / zoom),
    y: snap((rect.height / 2 - session.model.viewport.y) / zoom),
  };
}
