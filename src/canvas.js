import { buildEdgePath, arrowheadPoints } from "./edges.js";

export function createCanvasRoot({ session, settings, version, onPersist }) {
  const root = document.createElement("div");
  root.className = "pxd-root";
  const world = document.createElement("div");
  world.className = "pxd-world";
  const grid = document.createElement("div");
  grid.className = "pxd-grid";
  const edgesSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  edgesSvg.classList.add("pxd-edges");
  const cardsLayer = document.createElement("div");
  cardsLayer.className = "pxd-cards";
  const sectionsLayer = document.createElement("div");
  sectionsLayer.className = "pxd-sections";
  const toolbar = document.createElement("div");
  toolbar.className = "pxd-toolbar";
  const minimap = document.createElement("div");
  minimap.className = "pxd-minimap";

  world.append(grid, sectionsLayer, edgesSvg, cardsLayer);
  root.append(world, toolbar);
  if (settings.get("minimap")) root.append(minimap);

  const syncRenderChildrenDepth = () => {
    root.dataset.renderChildrenDepth = String(settings.get("render-children-depth") ?? "1");
  };

  const setActiveTool = (tool) => {
    session.model.activeTool = tool;
    toolbar.querySelectorAll(".pxd-toolbar__btn").forEach((el) => {
      el.classList.toggle("pxd-toolbar__btn--active", el.dataset.tool === tool);
    });
  };

  const tools = [
    ["select", "Select"],
    ["card", "Card"],
    ["connect", "Connect"],
    ["section", "Section"],
    ["nested", "Nested"],
    ["library", "Library"],
  ];
  for (const [tool, label] of tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pxd-toolbar__btn";
    button.dataset.tool = tool;
    button.title = label;
    button.textContent = label;
    button.addEventListener("click", () => {
      setActiveTool(tool);
      if (tool === "library") onPersist?.({ toggleLibrary: true });
    });
    toolbar.append(button);
  }

  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.className = "pxd-toolbar__btn pxd-toolbar__btn--zoom";
  zoomInBtn.textContent = "Zoom+";
  zoomInBtn.title = "Zoom in";
  zoomInBtn.addEventListener("click", () => {
    const zoomMax = Number(settings.get("zoom-max")) || 3;
    session.model.viewport.zoom = Math.min(zoomMax, (session.model.viewport.zoom || 1) * 1.2);
    onPersist?.({ persistViewport: true });
    render();
  });
  toolbar.append(zoomInBtn);

  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.type = "button";
  zoomOutBtn.className = "pxd-toolbar__btn pxd-toolbar__btn--zoom";
  zoomOutBtn.textContent = "Zoom-";
  zoomOutBtn.title = "Zoom out";
  zoomOutBtn.addEventListener("click", () => {
    const zoomMin = Number(settings.get("zoom-min")) || 0.15;
    session.model.viewport.zoom = Math.max(zoomMin, (session.model.viewport.zoom || 1) / 1.2);
    onPersist?.({ persistViewport: true });
    render();
  });
  toolbar.append(zoomOutBtn);

  const fitBtn = document.createElement("button");
  fitBtn.type = "button";
  fitBtn.className = "pxd-toolbar__btn pxd-toolbar__btn--zoom";
  fitBtn.textContent = "Fit";
  fitBtn.title = "Fit all cards in view";
  fitBtn.addEventListener("click", () => {
    fitToView();
    onPersist?.({ persistViewport: true });
    render();
  });
  toolbar.append(fitBtn);

  const setFullscreen = (on) => {
    const mount = root.closest(".pxd-mount");
    if (!mount) return;
    mount.classList.toggle("pxd-mount--fullscreen", on);
    document.body.classList.toggle("pxd-has-fullscreen", on);
    fullBtn.textContent = on ? "Exit full screen" : "Fullscreen";
    fullBtn.setAttribute("aria-pressed", on ? "true" : "false");
  };

  const fullBtn = document.createElement("button");
  fullBtn.type = "button";
  fullBtn.className = "pxd-toolbar__btn pxd-toolbar__btn--zoom";
  fullBtn.textContent = "Fullscreen";
  fullBtn.title = "Maximize like native Roam diagrams. Esc exits.";
  fullBtn.addEventListener("click", () => {
    const mount = root.closest(".pxd-mount");
    setFullscreen(!mount?.classList.contains("pxd-mount--fullscreen"));
  });
  toolbar.append(fullBtn);

  if (settings.get("show-version-badge")) {
    const badge = document.createElement("span");
    badge.className = "pxd-version";
    badge.textContent = `v${version}`;
    toolbar.append(badge);
  }

  let panning = false;
  let panStart = null;
  let spaceDown = false;
  let connectFrom = null;

  const applyTransform = () => {
    const { x, y, zoom } = session.model.viewport;
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  };

  const getGridSize = () => Number(settings.get("grid-size")) || 24;
  const snap = (value) => {
    if (!settings.get("snap-to-grid")) return value;
    const size = getGridSize();
    return Math.round(value / size) * size;
  };

  const screenToWorld = (clientX, clientY) => {
    const rect = root.getBoundingClientRect();
    const zoom = session.model.viewport.zoom || 1;
    return {
      x: snap((clientX - rect.left - session.model.viewport.x) / zoom),
      y: snap((clientY - rect.top - session.model.viewport.y) / zoom),
    };
  };

  const cardRect = (contentUid) => {
    const node = session.model.nodes.get(contentUid);
    if (!node) return null;
    return { x: node.pos.x, y: node.pos.y, width: node.size.width, height: node.size.height };
  };

  const fitToView = () => {
    const padding = 40;
    const rect = root.getBoundingClientRect();
    const zoomMin = Number(settings.get("zoom-min")) || 0.15;
    const zoomMax = Number(settings.get("zoom-max")) || 3;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of session.model.children) {
      const node = session.model.nodes.get(child.uid);
      if (!node) continue;
      minX = Math.min(minX, node.pos.x);
      minY = Math.min(minY, node.pos.y);
      maxX = Math.max(maxX, node.pos.x + node.size.width);
      maxY = Math.max(maxY, node.pos.y + node.size.height);
    }
    if (!Number.isFinite(minX)) return;
    const contentW = Math.max(maxX - minX, 1);
    const contentH = Math.max(maxY - minY, 1);
    const zoom = Math.min(
      zoomMax,
      Math.max(
        zoomMin,
        Math.min((rect.width - padding * 2) / contentW, (rect.height - padding * 2) / contentH),
      ),
    );
    session.model.viewport.zoom = zoom;
    session.model.viewport.x = (rect.width - contentW * zoom) / 2 - minX * zoom;
    session.model.viewport.y = (rect.height - contentH * zoom) / 2 - minY * zoom;
  };

  const renderSections = () => {
    sectionsLayer.innerHTML = "";
    if (!settings.get("show-sections")) return;
    for (const [id, section] of session.model.sections) {
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

  const renderEdges = () => {
    edgesSvg.innerHTML = "";
    const style = settings.get("connector-style") || "bezier";
    const width = Number(settings.get("edge-width")) || 2;
    const animated = settings.get("edge-animated");
    const arrowheads = arrowheadPoints(settings.get("arrowheads") || "end");
    for (const edge of session.model.edges) {
      const source = cardRect(edge.source);
      const target = cardRect(edge.target);
      if (!source || !target) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", buildEdgePath(edge.kind || style, source, target));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--pxd-active)");
      path.setAttribute("stroke-width", String(width));
      if (animated) path.classList.add("pxd-edge--animated");
      if (arrowheads.end) path.setAttribute("marker-end", "url(#pxd-arrow-end)");
      if (arrowheads.start) path.setAttribute("marker-start", "url(#pxd-arrow-start)");
      edgesSvg.append(path);
    }
    if (!edgesSvg.querySelector("defs")) {
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.innerHTML = `
        <marker id="pxd-arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--pxd-active)" />
        </marker>
        <marker id="pxd-arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
          <path d="M8,0 L0,4 L8,8 Z" fill="var(--pxd-active)" />
        </marker>`;
      edgesSvg.prepend(defs);
    }
  };

  const cardTitleText = (child) => child.string.replace(/\{\{.*?\}\}/, "").trim() || child.string.slice(0, 48);

  const renderCardContent = (cardEl, child) => {
    const body = document.createElement("div");
    body.className = "pxd-card__body";
    if (settings.get("native-block-editor") && globalThis.roamAlphaAPI?.ui?.components?.renderBlock) {
      try {
        globalThis.roamAlphaAPI.ui.components.renderBlock({ uid: child.uid, el: body });
      } catch {
        body.textContent = child.string;
      }
    } else if (globalThis.roamAlphaAPI?.ui?.components?.renderString) {
      try {
        globalThis.roamAlphaAPI.ui.components.renderString({ string: child.string, el: body });
      } catch {
        body.textContent = child.string;
      }
    } else {
      body.textContent = child.string;
    }
    cardEl.append(body);
  };

  const renderCards = () => {
    cardsLayer.innerHTML = "";
    const radius = Number(settings.get("card-radius")) || 8;
    for (const child of session.model.children) {
      const node = session.model.ensureNode(child.uid, {
        width: Number(settings.get("default-card-width")) || 280,
        height: Number(settings.get("default-card-height")) || 160,
      });
      const card = document.createElement("div");
      card.className = "pxd-card";
      if (settings.get("compact-cards")) card.classList.add("pxd-card--compact");
      if (settings.get("card-shadow")) card.classList.add("pxd-card--shadow");
      card.dataset.uid = child.uid;
      card.style.left = `${node.pos.x}px`;
      card.style.top = `${node.pos.y}px`;
      card.style.width = `${node.size.width}px`;
      card.style.height = `${node.size.height}px`;
      card.style.borderRadius = `${radius}px`;
      if (session.model.selected.has(child.uid)) card.classList.add("pxd-card--selected");
      const titleText = cardTitleText(child);
      if (settings.get("show-card-title") && titleText !== child.string.trim()) {
        const title = document.createElement("div");
        title.className = "pxd-card__title";
        title.textContent = titleText;
        card.append(title);
        card.classList.add("pxd-card--titled");
      }
      if (session.model.isNestedDiagram(child.uid)) {
        card.classList.add("pxd-card--nested");
        card.title = "Double-click to open nested diagram";
        card.addEventListener("dblclick", () => onPersist?.({ openNested: child.uid }));
      }
      renderCardContent(card, child);
      for (const side of ["top", "right", "bottom", "left"]) {
        const handle = document.createElement("div");
        handle.className = `pxd-handle pxd-handle--${side}`;
        handle.dataset.side = side;
        handle.addEventListener("mousedown", (event) => {
          event.stopPropagation();
          if (session.model.activeTool !== "connect") return;
          connectFrom = child.uid;
        });
        handle.addEventListener("mouseup", async (event) => {
          event.stopPropagation();
          if (!connectFrom || connectFrom === child.uid) return;
          session.model.addEdge(connectFrom, child.uid, settings.get("connector-style") || "bezier");
          connectFrom = null;
          await onPersist?.({ persistLayout: true });
          render();
        });
        card.append(handle);
      }
      let drag = null;
      card.addEventListener("mousedown", (event) => {
        if (session.model.activeTool !== "select") return;
        event.stopPropagation();
        if (!event.shiftKey) session.model.selected.clear();
        session.model.selected.add(child.uid);
        drag = { x: event.clientX, y: event.clientY, start: { ...node.pos } };
      });
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        if (session.model.activeTool === "select") {
          if (event.shiftKey) session.model.selected.add(child.uid);
          else session.model.selected = new Set([child.uid]);
        }
      });
      const onMove = async (event) => {
        if (!drag) return;
        const zoom = session.model.viewport.zoom || 1;
        node.pos.x = snap(drag.start.x + (event.clientX - drag.x) / zoom);
        node.pos.y = snap(drag.start.y + (event.clientY - drag.y) / zoom);
        render();
      };
      const onUp = async () => {
        if (!drag) return;
        drag = null;
        await onPersist?.({ persistLayout: true });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      card.addEventListener("mousedown", () => {
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
      cardsLayer.append(card);
    }
  };

  const renderGrid = () => {
    const show = settings.get("show-grid");
    const style = settings.get("grid-style") || "dots";
    grid.className = "pxd-grid";
    grid.classList.toggle("pxd-grid--hidden", !show || style === "none");
    grid.classList.toggle("pxd-grid--dots", style === "dots");
    grid.classList.toggle("pxd-grid--lines", style === "lines");
    grid.style.setProperty("--pxd-grid-size", `${getGridSize()}px`);
  };

  const render = () => {
    syncRenderChildrenDepth();
    applyTransform();
    renderGrid();
    renderSections();
    renderCards();
    renderEdges();
  };

  root.addEventListener("wheel", (event) => {
    if (!settings.get("wheel-zoom")) return;
    event.preventDefault();
    const zoomMin = Number(settings.get("zoom-min")) || 0.15;
    const zoomMax = Number(settings.get("zoom-max")) || 3;
    const oldZoom = session.model.viewport.zoom || 1;
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = Math.min(zoomMax, Math.max(zoomMin, oldZoom * delta));
    const rect = root.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - session.model.viewport.x) / oldZoom;
    const worldY = (mouseY - session.model.viewport.y) / oldZoom;
    session.model.viewport.zoom = nextZoom;
    session.model.viewport.x = mouseX - worldX * nextZoom;
    session.model.viewport.y = mouseY - worldY * nextZoom;
    onPersist?.({ persistViewport: true });
    render();
  }, { passive: false });

  const onKeyDown = (event) => {
    if (event.key === "Escape" && root.closest(".pxd-mount")?.classList.contains("pxd-mount--fullscreen")) {
      event.preventDefault();
      event.stopPropagation();
      setFullscreen(false);
      return;
    }
    if (event.code === "Space" && settings.get("pan-on-space")) spaceDown = true;
  };
  const onKeyUp = (event) => {
    if (event.code === "Space") spaceDown = false;
  };

  const isEmptyCanvasTarget = (event) => !event.target.closest(".pxd-card")
    && !event.target.closest(".pxd-toolbar")
    && !event.target.closest(".pxd-library-drawer");

  root.addEventListener("mousedown", (event) => {
    const panOnSpace = settings.get("pan-on-space") && spaceDown;
    const panOnEmpty = event.button === 0
      && isEmptyCanvasTarget(event)
      && session.model.activeTool === "select";
    if (event.button === 1 || panOnSpace || panOnEmpty) {
      panning = true;
      panStart = { x: event.clientX, y: event.clientY, viewport: { ...session.model.viewport } };
      event.preventDefault();
    }
  });
  root.addEventListener("mousemove", (event) => {
    if (!panning || !panStart) return;
    session.model.viewport.x = panStart.viewport.x + (event.clientX - panStart.x);
    session.model.viewport.y = panStart.viewport.y + (event.clientY - panStart.y);
    onPersist?.({ persistViewport: true });
    render();
  });
  root.addEventListener("mouseup", () => { panning = false; panStart = null; });
  root.addEventListener("click", async (event) => {
    if (event.target.closest(".pxd-card") || event.target.closest(".pxd-toolbar")) return;
    if (event.target.closest(".pxd-library-drawer")) return;
    const tool = session.model.activeTool;
    if (tool === "card") {
      await onPersist?.({ addCard: screenToWorld(event.clientX, event.clientY) });
    } else if (tool === "section") {
      await onPersist?.({ addSection: screenToWorld(event.clientX, event.clientY) });
    }
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  setActiveTool(session.model.activeTool || "select");
  render();

  return {
    root,
    render,
    setLibraryOpen(open) {
      toolbar.querySelector('[data-tool="library"]')?.classList.toggle("pxd-toolbar__btn--active", open);
    },
    setFullscreen,
    dispose() {
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
