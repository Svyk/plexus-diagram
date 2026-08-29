import { buildEdgePath, arrowheadPoints, edgeMidpoint } from "./edges.js";
import {
  acquireScratch,
  blankScratch,
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

const SVG_NS = "http://www.w3.org/2000/svg";
const DRAG_THRESHOLD_PX = 4;
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

export function applyFullscreenChrome(mount, on, root = globalThis.document) {
  mount?.classList?.toggle?.("pxd-mount--fullscreen", Boolean(on));
  chromeRootBody(root)?.classList?.toggle?.("pxd-has-fullscreen", Boolean(on));
  if (on) {
    const place = () => {
      if (!mount?.style) return;
      mount.style.top = `${topbarOffset(root)}px`;
      mount.style.left = `${sidebarOffset(root)}px`;
      mount.style.right = "0px";
      mount.style.bottom = "0px";
      mount.style.width = "auto";
      mount.style.height = "auto";
      mount.style.minHeight = "0";
    };
    place();
    // Breadcrumbs `display:none` shrinks `.rm-topbar`; remeasure after one frame.
    return raf(place);
  }
  if (mount?.style) {
    mount.style.top = "";
    mount.style.left = "";
    mount.style.right = "";
    mount.style.bottom = "";
  }
  return () => {};
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
export function createCanvasRoot({ session, settings, version, onPersist }) {
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
  const toolbar = document.createElement("div");
  toolbar.className = "pxd-toolbar";
  const hint = document.createElement("div");
  hint.className = "pxd-hint";
  hint.textContent = HINT_TEXT;
  const minimap = settings.get("minimap") ? document.createElement("div") : null;
  if (minimap) minimap.className = "pxd-minimap";

  world.append(sectionsLayer, edgesSvg, labelsLayer, cardsLayer);
  root.append(grid, world, toolbar, hint);
  if (minimap) root.append(minimap);

  const model = () => session.model;
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

  const applyTransform = () => {
    const { x, y, zoom } = model().viewport;
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    const gridPx = getGridSize() * (zoom || 1);
    grid.style.setProperty("--pxd-grid-size", `${gridPx}px`);
    grid.style.backgroundPosition = `${x}px ${y}px`;
    zoomLabel.textContent = `${Math.round((zoom || 1) * 100)}%`;
    scheduleMinimap();
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
    ["connect", "Connect", "Drag from one card to another"],
    ["section", "Section", "Click the board to add a section frame"],
    ["nested", "Nested", "Click the board to add a nested diagram card"],
    ["library", "Library", "Place existing pages as cards"],
  ];
  const toolButtons = new Map();
  const setActiveTool = (tool) => {
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
  const renderSections = () => {
    sectionsLayer.innerHTML = "";
    if (!settings.get("show-sections")) return;
    for (const [id, section] of model().sections) {
      const el = document.createElement("div");
      el.className = "pxd-section";
      el.style.left = `${section.pos?.x ?? 0}px`;
      el.style.top = `${section.pos?.y ?? 0}px`;
      el.style.width = `${section.size?.width ?? 320}px`;
      el.style.height = `${section.size?.height ?? 240}px`;
      if (settings.get("section-label") && section.title) {
        const label = document.createElement("div");
        label.className = "pxd-section__label";
        label.textContent = section.title;
        el.append(label);
      }
      el.dataset.sectionId = id;
      sectionsLayer.append(el);
    }
  };

  // ---------------------------------------------------------------- edges
  const edgePaths = new Map();
  const edgePills = new Map();
  let tempEdge = null;
  let editingEdgeKey = null;
  let edgeEditorEl = null;
  const cardRect = (contentUid) => {
    const node = model().nodes.get(contentUid);
    if (!node) return null;
    return { x: node.pos.x, y: node.pos.y, width: node.size.width, height: node.size.height };
  };
  const edgeKey = (edge) => `${edge.source}->${edge.target}`;
  const findEdgeByKey = (key) => model().edges.find((edge) => edgeKey(edge) === key) || null;
  const ensureDefs = () => {
    if (edgesSvg.querySelector?.("defs")) return;
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.innerHTML = `
        <marker id="pxd-arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--pxd-edge)" />
        </marker>
        <marker id="pxd-arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M8,0 L0,4 L8,8 Z" fill="var(--pxd-edge)" />
        </marker>`;
    edgesSvg.prepend(defs);
  };
  const positionEdgeChrome = (edge, path, pill) => {
    const source = cardRect(edge.source);
    const target = cardRect(edge.target);
    if (!source || !target) return null;
    const style = settings.get("connector-style") || "bezier";
    const d = buildEdgePath(edge.kind || style, source, target);
    path.setAttribute("d", d);
    const mid = edgeMidpoint(source, target);
    if (pill) {
      pill.style.left = `${mid.x}px`;
      pill.style.top = `${mid.y}px`;
    }
    if (editingEdgeKey === edgeKey(edge) && edgeEditorEl) {
      edgeEditorEl.style.left = `${mid.x}px`;
      edgeEditorEl.style.top = `${mid.y}px`;
    }
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
    const mid = edgeMidpoint(source, target);
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
    ensureDefs();
    const width = num("edge-width", 2);
    const animated = settings.get("edge-animated");
    const arrowheads = arrowheadPoints(settings.get("arrowheads") || "end");
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
      path.setAttribute("stroke", "var(--pxd-edge)");
      path.setAttribute("stroke-width", String(width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("title", edge.label || "add note");
      path.dataset.edgeKey = key;
      const hint = document.createElementNS(SVG_NS, "title");
      hint.textContent = edge.label || "add note";
      path.append(hint);
      if (animated) path.classList.add("pxd-edge--animated");
      if (arrowheads.end) path.setAttribute("marker-end", "url(#pxd-arrow-end)");
      if (arrowheads.start) path.setAttribute("marker-start", "url(#pxd-arrow-start)");
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
          const mid = edgeMidpoint(source, target);
          pill.style.left = `${mid.x}px`;
          pill.style.top = `${mid.y}px`;
        }
        labelsLayer.append(pill);
        edgePills.set(key, pill);
      }
    }
  };
  const updateEdgesFor = (uids) => {
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
  const setTempEdge = (from, worldPoint) => {
    const source = cardRect(from);
    if (!source) return;
    if (!tempEdge) {
      tempEdge = document.createElementNS(SVG_NS, "path");
      tempEdge.classList.add("pxd-edge", "pxd-edge--temp");
      tempEdge.setAttribute("fill", "none");
      tempEdge.setAttribute("stroke", "var(--pxd-edge)");
      tempEdge.setAttribute("stroke-width", String(num("edge-width", 2)));
      edgesSvg.append(tempEdge);
    }
    const target = { x: worldPoint.x, y: worldPoint.y, width: 1, height: 1 };
    tempEdge.setAttribute("d", buildEdgePath(settings.get("connector-style") || "bezier", source, target));
  };
  const clearTempEdge = () => {
    tempEdge?.remove?.();
    tempEdge = null;
  };

  // ---------------------------------------------------------------- cards
  const cardEls = new Map();
  let editingUid = null;
  let editOpenedAt = 0;

  const cardTitleText = (child) => child.string.replace(/\{\{.*?\}\}/, "").trim() || child.string.slice(0, 48);

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
    unmountRoam(body);
    body.innerHTML = "";
    card.classList.remove("pxd-card--empty");
    if (model().isNestedDiagram(child.uid)) {
      const label = document.createElement("div");
      label.className = "pxd-card__nested-label";
      label.textContent = cardTitleText(child) || "Nested diagram";
      const sub = document.createElement("div");
      sub.className = "pxd-card__placeholder";
      sub.textContent = "Double-click to open";
      body.append(label, sub);
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
    const card = cardEls.get(uid);
    root.classList.remove("pxd-root--editing");
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
    model().selected = new Set([uid]);
    syncSelection();
    card.classList.add("pxd-card--editing");
    root.classList.add("pxd-root--editing");
    const body = card._pxdBody;
    unmountRoam(body);
    const fallback = document.createElement("div");
    fallback.className = "pxd-card__edit-fallback";
    fallback.textContent = child.string;
    const editor = document.createElement("div");
    editor.className = "pxd-card__editor";
    body.innerHTML = "";
    body.append(fallback, editor);
    if (!scratchTextareaFocused()) {
      try {
        await updateBlock(scratch.uid, child.string);
      } catch { /* mount anyway; Roam may still show the last scratch string */ }
    }
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
      synthesizeBlockClick(input);
    }
    syncHint();
  };

  const syncSelection = () => {
    for (const [uid, card] of cardEls) {
      card.classList.toggle("pxd-card--selected", model().selected.has(uid));
    }
    scheduleMinimap();
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
    syncHint();
    scheduleMinimap();
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
    clearTempEdge();
  };

  const cardFromPoint = (clientX, clientY) => {
    const el = document.elementFromPoint?.(clientX, clientY);
    const card = el?.closest?.(".pxd-card");
    return card && card.parentElement === cardsLayer ? card.dataset.uid : null;
  };

  const selectCard = (uid, additive) => {
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

  const onPointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target;
    if (target?.closest?.(".pxd-toolbar") || target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    if (target?.closest?.(".pxd-edge-label-editor")) return;
    dismissHint();
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid || null;
    const tool = model().activeTool || "select";
    const panRequested = event.button === 1 || (spaceDown && settings.get("pan-on-space"));

    if (editingUid && editingUid !== uid) void exitEdit();
    if (editingUid && editingUid === uid) return; // Roam owns the caret inside an editing card.
    if (target?.closest?.(".pxd-edge-label") || edgeKeyFromTarget(target)) {
      if (editingEdgeKey && edgeKeyFromTarget(target) !== editingEdgeKey) closeEdgeEditor(true);
      return;
    }

    if (uid && !panRequested) {
      const start = { x: event.clientX, y: event.clientY };
      if (target.closest(".pxd-card__resize")) {
        const node = model().nodes.get(uid);
        beginGesture({ kind: "resize", uid, start, size: { ...node.size }, moved: false });
        event.preventDefault();
        return;
      }
      if (target.closest(".pxd-handle") || tool === "connect") {
        beginGesture({ kind: "connect", uid, start, moved: false });
        event.preventDefault();
        return;
      }
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
    if (!gesture) return;
    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
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
    if (gesture.kind === "connect") {
      setTempEdge(gesture.uid, screenToWorld(event.clientX, event.clientY, false));
    }
  };

  const onPointerUp = async (event) => {
    const active = gesture;
    if (!active) return;
    endGesture();
    if (active.kind === "pan") {
      if (active.moved) markViewportDirty();
      else if (model().activeTool === "select" && !event.shiftKey && model().selected.size) {
        model().selected.clear();
        syncSelection();
      }
      return;
    }
    if (active.kind === "drag" || active.kind === "resize") {
      if (active.moved) markLayoutDirty();
      return;
    }
    if (active.kind === "connect") {
      const targetUid = cardFromPoint(event.clientX, event.clientY);
      if (!active.moved || !targetUid || targetUid === active.uid) {
        if (!active.moved) selectCard(active.uid, event.shiftKey);
        return;
      }
      const added = model().addEdge(active.uid, targetUid, settings.get("connector-style") || "bezier");
      if (added) {
        renderEdges();
        layoutDirty = true;
        await flushLayout();
      }
    }
  };

  const onDoubleClick = (event) => {
    const target = event.target;
    if (target?.closest?.(".pxd-toolbar") || target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    const edgeKeyHit = edgeKeyFromTarget(target);
    if (edgeKeyHit) {
      event.preventDefault();
      event.stopPropagation?.();
      openEdgeLabelEditor(edgeKeyHit);
      return;
    }
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid;
    if (uid) {
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
    if (target?.closest?.(".pxd-card") || target?.closest?.(".pxd-toolbar")) return;
    if (target?.closest?.(".pxd-library-drawer") || target?.closest?.(".pxd-minimap")) return;
    if (target?.closest?.(".pxd-edge-label-editor")) return;
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
    if (!overlayOwnsPointer()) return;
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

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerenter", () => { pointerInside = true; });
  root.addEventListener("pointerleave", () => { pointerInside = false; });
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("click", onClick);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("focusout", onFocusOut);
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
      if (editingUid) void exitEdit(false);
      endGesture();
      if (viewportTimer) {
        clearTimeout(viewportTimer);
        viewportTimer = null;
      }
      if (layoutTimer) {
        clearTimeout(layoutTimer);
        layoutTimer = null;
      }
      for (const card of cardEls.values()) unmountRoam(card._pxdBody);
      cardEls.clear();
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
