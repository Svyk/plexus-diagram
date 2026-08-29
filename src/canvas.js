import { buildEdgePath, arrowheadPoints } from "./edges.js";
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
const EDIT_GRACE_MS = 1000;
const HINT_TEXT = "Drag empty space to pan · double-click to add a card · Fullscreen for a real board";

// renderBlock hydration / outline-focus steal can pull an empty string for a
// card that still has text. Never commit that over a known non-empty value.
export function shouldCommitPulledString(previous, pulled) {
  if (typeof pulled !== "string") return false;
  if (pulled === previous) return false;
  if (pulled.trim() === "" && String(previous || "").trim() !== "") return false;
  return true;
}

// RoamJS breadcrumbs (and the rest of the top bar) live in `.rm-topbar`.
// Fullscreen must start below that bar — native Maximize does not cover it.
export function topbarOffset(root = globalThis.document) {
  const topbar = root?.querySelector?.(".rm-topbar");
  if (!topbar?.getBoundingClientRect) return 0;
  const bottom = topbar.getBoundingClientRect().bottom;
  return Number.isFinite(bottom) ? Math.max(0, Math.round(bottom)) : 0;
}

function raf(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    const id = globalThis.requestAnimationFrame(callback);
    return () => globalThis.cancelAnimationFrame?.(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

function roamUi() {
  return globalThis.roamAlphaAPI?.ui;
}

function isTextEntryTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest(".rm-block__input, [contenteditable=\"true\"], .pxd-library-drawer"));
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
  const sectionsLayer = document.createElement("div");
  sectionsLayer.className = "pxd-sections";
  const toolbar = document.createElement("div");
  toolbar.className = "pxd-toolbar";
  const hint = document.createElement("div");
  hint.className = "pxd-hint";
  hint.textContent = HINT_TEXT;
  const minimap = settings.get("minimap") ? document.createElement("div") : null;
  if (minimap) minimap.className = "pxd-minimap";

  world.append(sectionsLayer, edgesSvg, cardsLayer);
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

  const applyFullscreenChrome = (mount, on) => {
    mount.classList.toggle("pxd-mount--fullscreen", Boolean(on));
    document.body?.classList?.toggle("pxd-has-fullscreen", Boolean(on));
    if (on) {
      const top = topbarOffset();
      mount.style.top = `${top}px`;
      mount.style.left = "0px";
      mount.style.right = "0px";
      mount.style.bottom = "0px";
      mount.style.width = "auto";
      mount.style.height = "auto";
      mount.style.minHeight = "0";
    } else {
      mount.style.top = "";
      mount.style.left = "";
      mount.style.right = "";
      mount.style.bottom = "";
    }
  };

  const setFullscreen = (on) => {
    const mount = mountEl();
    if (!mount) return;
    const current = isFullscreen();
    fullBtn.textContent = on ? "Exit full screen" : "Fullscreen";
    fullBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (current === Boolean(on)) {
      if (on) applyFullscreenChrome(mount, true);
      return;
    }
    keepCenterAcross(() => applyFullscreenChrome(mount, Boolean(on)));
  };

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
  let tempEdge = null;
  const cardRect = (contentUid) => {
    const node = model().nodes.get(contentUid);
    if (!node) return null;
    return { x: node.pos.x, y: node.pos.y, width: node.size.width, height: node.size.height };
  };
  const edgeKey = (edge) => `${edge.source}->${edge.target}`;
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
  const updateEdgePath = (edge, path) => {
    const source = cardRect(edge.source);
    const target = cardRect(edge.target);
    if (!source || !target) return false;
    const style = settings.get("connector-style") || "bezier";
    path.setAttribute("d", buildEdgePath(edge.kind || style, source, target));
    return true;
  };
  const renderEdges = () => {
    edgesSvg.innerHTML = "";
    edgePaths.clear();
    ensureDefs();
    const width = num("edge-width", 2);
    const animated = settings.get("edge-animated");
    const arrowheads = arrowheadPoints(settings.get("arrowheads") || "end");
    for (const edge of model().edges) {
      const path = document.createElementNS(SVG_NS, "path");
      if (!updateEdgePath(edge, path)) continue;
      path.classList.add("pxd-edge");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--pxd-edge)");
      path.setAttribute("stroke-width", String(width));
      path.setAttribute("stroke-linecap", "round");
      if (animated) path.classList.add("pxd-edge--animated");
      if (arrowheads.end) path.setAttribute("marker-end", "url(#pxd-arrow-end)");
      if (arrowheads.start) path.setAttribute("marker-start", "url(#pxd-arrow-start)");
      edgesSvg.append(path);
      edgePaths.set(edgeKey(edge), { edge, path });
    }
  };
  const updateEdgesFor = (uids) => {
    for (const { edge, path } of edgePaths.values()) {
      if (uids.has(edge.source) || uids.has(edge.target)) updateEdgePath(edge, path);
    }
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

  const focusRoamBlock = (body, uid, attempt = 0) => {
    const input = body.querySelector?.(".pxd-card__editor .rm-block__input, .pxd-card__editor textarea");
    if (!input) {
      if (attempt < 8 && editingUid === uid) setTimeout(() => focusRoamBlock(body, uid, attempt + 1), 80);
      return;
    }
    body.querySelector(".pxd-card__edit-fallback")?.remove?.();
    // Do not call setBlockFocusAndSelection. That focuses the *outline* copy of
    // the same uid; Roam then unmounts or blanks the overlay mount.
    input.focus?.();
    input.click?.();
  };

  const exitEdit = (persistString = true) => {
    const uid = editingUid;
    if (!uid) return;
    editingUid = null;
    editOpenedAt = 0;
    const card = cardEls.get(uid);
    root.classList.remove("pxd-root--editing");
    if (!card) return;
    card.classList.remove("pxd-card--editing");
    let child = model().getCard(uid);
    if (persistString) {
      try {
        const pulled = globalThis.roamAlphaAPI?.data?.pull?.("[:block/string]", [":block/uid", uid]);
        const fresh = pulled?.[":block/string"] ?? pulled?.string;
        if (shouldCommitPulledString(child?.string, fresh)) {
          child = { ...(child || { uid }), string: fresh };
          const live = model().getCard(uid);
          if (live) live.string = fresh;
        }
      } catch { /* keep the model string */ }
    }
    if (child) paintCardBody(card, child);
    syncHint();
  };

  const enterEdit = (uid) => {
    const card = cardEls.get(uid);
    const child = model().getCard(uid);
    if (!card || !child || model().isNestedDiagram(uid)) return;
    if (editingUid === uid) return;
    if (editingUid) exitEdit();
    const components = roamUi()?.components;
    if (!settings.get("native-block-editor") || !components?.renderBlock) {
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
    try {
      components.renderBlock({ uid, el: editor });
    } catch {
      exitEdit(false);
      return;
    }
    setTimeout(() => {
      if (editingUid === uid) focusRoamBlock(body, uid);
    }, 60);
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
      if (editingUid === uid) exitEdit(false);
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
    dismissHint();
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid || null;
    const tool = model().activeTool || "select";
    const panRequested = event.button === 1 || (spaceDown && settings.get("pan-on-space"));

    if (editingUid && editingUid !== uid) exitEdit();
    if (editingUid && editingUid === uid) return; // Roam owns the caret inside an editing card.

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
    const cardEl = target?.closest?.(".pxd-card");
    const uid = cardEl?.dataset?.uid;
    if (uid) {
      if (editingUid === uid) return;
      event.preventDefault();
      if (model().isNestedDiagram(uid)) onPersist?.({ openNested: uid });
      else enterEdit(uid);
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
    if (event.detail > 1) return;
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

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      if (editingUid) {
        if (event.target?.closest?.(".pxd-card--editing")) return; // Roam blurs the block; focusout commits.
        exitEdit();
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
  };
  const onKeyUp = (event) => {
    if (event.code === "Space") {
      spaceDown = false;
      root.classList.remove("pxd-root--space");
    }
  };

  root.addEventListener("pointerdown", onPointerDown);
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
      if (editingUid) exitEdit(false);
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
