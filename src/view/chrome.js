// Screen-space chrome: toolbar (spec 3.5), context bar (spec 3.4), toast, board search,
// minimap, version badge, sync dot. Everything lives inside .pxd-root; no portals.

import { PALETTE, FONT_SIZES, BOARD_PATTERNS, DOCK_POSITIONS } from "../model/schema.js";
import { SHAPES } from "../model/shapes.js";
import { changelogEntry } from "../model/changelog.js";
import { CHANGELOG_TEXT } from "../changelog-text.js";
import { buildColorPicker } from "./color-picker.js";
import { placeNearAnchor } from "./avoid.js";
import { tipIdForClass } from "./tooltip-text.js";

const CTX_GAP = 12;
const CTX_EDGE_CLEARANCE = 28;
const CTX_MARGIN = 8;
const CTX_MIN_WIDTH = 180;
const TOAST_MS = 6000;
const MINIMAP_W = 180;
const MINIMAP_H = 120;
const LINK_MODES = ["off", "attributes", "all"];
const LINK_LABELS = { off: "Links: Off", attributes: "Links: Attributes", all: "Links: All" };
const LINK_ICONS = { off: "disable", attributes: "inheritance", all: "graph" };

const TOOL_LIST = [
  ["select", "Select", "V", "select"],
  ["hand", "Hand", "H", "hand"],
  ["card", "Card", "N", "new-object"],
  ["text", "Text", "T", "new-text-box"],
  ["section", "Section", "G", "widget"],
  ["board", "Board", "W", "grid-view"],
  ["connect", "Connect", "C", "flows"],
];

const PALETTE_LIST = [
  ["select", "Select", "V", "select"],
  ["hand", "Hand", "H", "hand"],
  ["card", "Card", "N", "new-object"],
  ["text", "Text", "T", "new-text-box"],
  ["task", "Task", "K", "tick-circle"],
  ["sticky", "Sticky", "S", "annotation"],
  ["shape", "Shape", "R", "square"],
  ["section", "Section", "G", "widget"],
  ["board", "Board", "W", "grid-view"],
  ["connect", "Connect", "C", "flows"],
];

const LAYOUTS = ["split", "classic", "dock-only"];
const DOCK_STYLES = ["pill", "strip"];
const DOCK_GROUPS = [["select", "hand"], ["card", "task", "text", "sticky", "shape", "section", "board"], ["connect"]];
const SWATCH_TOOLS = new Set(["card", "sticky", "section"]);
const REVEAL_PX = 48;
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const SHAPE_LABELS = { rectangle: "Rectangle", rounded: "Rounded", ellipse: "Ellipse", diamond: "Diamond", parallelogram: "Parallelogram", cylinder: "Cylinder" };

const MAX_CRUMBS = 4;
const POPOVER_GAP = 6;
const PATTERN_LABELS = { dots: "Dots", lines: "Lines", cross: "Cross", grid: "Grid", plain: "Plain" };
const NOTE_KINDS = ["note", "block", "page"];

export function createChrome({ doc = globalThis.document, root, version = "", settings, timers, on = {}, crumbs = [] } = {}) {
  const setting = (k) => (typeof settings?.get === "function" ? settings.get(k) : settings?.[k]);
  const listeners = [];
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };
  const el = (tag, cls, parent, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };
  // PL-3: no native title. The hover text lives in tooltip-text.js, found through data-tip (and data-tip-state).
  const tip = (node, id, state) => {
    if (id) node.setAttribute("data-tip", id);
    if (state !== undefined) node.setAttribute("data-tip-state", state);
    return node;
  };
  const button = (parent, cls, label, title, onClick) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    tip(b, tipIdForClass(cls));
    const name = String(label || "").trim() || title || "";
    if (name) b.setAttribute("aria-label", name);
    listen(b, "click", (event) => { event.preventDefault(); event.stopPropagation(); onClick?.(event); });
    listen(b, "pointerdown", (event) => event.stopPropagation());
    listen(b, "dblclick", (event) => event.stopPropagation());
    return b;
  };
  const iconButton = (parent, cls, icon, label, title, onClick) => {
    const b = button(parent, `pxd-iconbtn ${cls}`, "", title || label, onClick);
    b.setAttribute("aria-label", label);
    const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
    i.setAttribute("aria-hidden", "true");
    return b;
  };
  const setIcon = (node, icon, label, state) => {
    if (label) node.setAttribute("aria-label", label);
    if (state !== undefined) node.setAttribute("data-tip-state", state);
    const i = node.querySelector(".bp3-icon");
    if (i && icon) i.className = `bp3-icon bp3-icon-${icon}`;
  };
  const swatches = (parent, onPick, { key = "color", paper = false } = {}) => {
    const wrap = el("div", "pxd-swatches", parent);
    const none = button(wrap, "pxd-swatch pxd-swatch--none", "", key === "tone" ? "Default" : "No color", () => onPick(null));
    tip(none, "swatch.none");
    none.dataset[key] = "";
    if (key !== "color") none.setAttribute(`data-${key}`, "");
    if (paper) {
      const p = button(wrap, "pxd-swatch pxd-swatch--paper", "", "Paper", () => onPick("paper"));
      tip(p, "swatch.paper");
      p.dataset[key] = "paper";
      p.setAttribute(`data-${key}`, "paper");
    }
    for (const c of PALETTE) {
      const s = button(wrap, `pxd-swatch pxd-c-${c}`, "", c, () => onPick(c));
      tip(s, `swatch.${c}`);
      s.dataset[key] = c;
      s.setAttribute(`data-${key}`, c);
    }
    return wrap;
  };
  const stopAll = (node) => {
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup", "contextmenu"]) {
      listen(node, type, (event) => event.stopPropagation());
    }
  };

  // ---------------------------------------------------------------- toolbar
  const toolbar = el("div", "pxd-toolbar pxd-chrome", root);
  stopAll(toolbar);
  const crumbsEl = el("div", "pxd-toolbar__group pxd-crumbs", toolbar);
  let overflow = [];
  let crumbMenu = null;
  const closeCrumbMenu = () => { crumbMenu?.remove(); crumbMenu = null; };
  const openCrumbMenu = () => {
    closeCrumbMenu();
    if (!overflow.length) return;
    crumbMenu = el("div", "pxd-crumb-menu", crumbsEl);
    for (const entry of overflow) {
      const b = el("button", "pxd-btn pxd-crumb", crumbMenu, entry.title);
      b.type = "button";
      tip(b, "crumb");
      b.setAttribute("aria-label", entry.title);
      b.dataset.index = String(entry.index);
      b.setAttribute("data-index", String(entry.index));
    }
  };
  // One delegated listener; re-rendering the row never adds listeners.
  listen(crumbsEl, "click", (event) => {
    if (event.target?.closest?.(".pxd-crumb__more")) {
      event.preventDefault?.();
      event.stopPropagation();
      if (crumbMenu) closeCrumbMenu();
      else openCrumbMenu();
      return;
    }
    const hit = event.target?.closest?.(".pxd-crumb[data-index]");
    const raw = hit?.dataset?.index ?? hit?.getAttribute?.("data-index");
    if (raw == null) return;
    const index = Number(raw);
    if (!Number.isFinite(index)) return;
    event.preventDefault?.();
    event.stopPropagation();
    closeCrumbMenu();
    on.crumb?.(index);
  });
  listen(root, "pointerdown", (event) => {
    if (!crumbMenu) return;
    if (crumbMenu.contains(event.target)) return;
    if (event.target?.closest?.(".pxd-crumb__more")) return;
    closeCrumbMenu();
  });
  const renderCrumbs = (list) => {
    closeCrumbMenu();
    crumbsEl.replaceChildren();
    on.chromeRebuilt?.();
    overflow = [];
    const items = Array.isArray(list) ? list : [];
    crumbsEl.style.display = items.length < 2 ? "none" : "";
    if (items.length < 2) return;
    const last = items.length - 1;
    let shown = items.map((c, i) => i);
    if (items.length > MAX_CRUMBS) {
      shown = [0, last - 2, last - 1, last];
      overflow = [];
      for (let i = 1; i < last - 2; i += 1) overflow.push({ index: i, title: items[i].title });
    }
    shown.forEach((i, n) => {
      if (n === 1 && overflow.length) {
        const more = el("button", "pxd-crumb__more", crumbsEl, "…");
        more.type = "button";
        tip(more, "crumb.more");
        more.setAttribute("data-tip-extra", overflow.map((c) => c.title).join(" › "));
        more.setAttribute("aria-label", "Hidden boards");
        more.setAttribute("aria-haspopup", "menu");
        el("span", "pxd-crumb__sep", crumbsEl, "›");
      }
      const c = items[i];
      if (i === last) {
        const cur = el("span", "pxd-crumb pxd-crumb--current", crumbsEl, c.title);
        tip(cur, "crumb.current");
        cur.setAttribute("aria-label", c.title);
        return;
      }
      const b = el("button", "pxd-btn pxd-crumb", crumbsEl, c.title);
      b.type = "button";
      tip(b, "crumb");
      b.setAttribute("aria-label", c.title);
      b.dataset.index = String(i);
      b.setAttribute("data-index", String(i));
      el("span", "pxd-crumb__sep", crumbsEl, "›");
    });
  };
  renderCrumbs(crumbs);
  const toolGroup = el("div", "pxd-toolbar__group pxd-toolbar__tools", toolbar);
  const toolButtons = new Map();
  for (const [id, label, key, icon] of TOOL_LIST) {
    const b = iconButton(toolGroup, "pxd-tool", icon, label, `${label} (${key}). Double-click to lock`, () => on.setTool?.(id, false));
    b.dataset.tool = id;
    b.setAttribute("data-tool", id);
    tip(b, `tool.${id}`);
    listen(b, "dblclick", (event) => { event.preventDefault(); event.stopPropagation(); on.setTool?.(id, true); });
    toolButtons.set(id, b);
  }
  const group2 = el("div", "pxd-toolbar__group", toolbar);
  const addBtn = iconButton(group2, "pxd-toolbar__add", "plus", "Add", "Add cards from the graph", () => on.togglePanel?.());
  iconButton(group2, "pxd-toolbar__info", "info-sign", "Info", "Card info (I)", () => on.openInfo?.());
  const linksBtn = iconButton(group2, "pxd-toolbar__links", LINK_ICONS.all, LINK_LABELS.all, "Graph links (L)", () => on.cycleLinks?.());
  const groupView = el("div", "pxd-toolbar__group", toolbar);
  const tableBtn = iconButton(groupView, "pxd-toolbar__table", "th", "Table", "Table view", () => on.toggleTable?.());
  tableBtn.setAttribute("aria-pressed", "false");
  const kanbanBtn = iconButton(groupView, "pxd-toolbar__kanban", "layout-auto", "Kanban", "Kanban view", () => on.toggleKanban?.());
  kanbanBtn.setAttribute("aria-pressed", "false");
  const bgBtn = iconButton(groupView, "pxd-toolbar__bg", "style", "Background", "Background pattern and tone", () => (popover.isOpen() ? popover.close() : popover.open()));
  const lensBtn = iconButton(groupView, "pxd-toolbar__lens", "tag", "Tags", "Tag lens: keep cards with one tag bright", () => on.toggleLens?.());
  const focusBtn = iconButton(groupView, "pxd-toolbar__focus", "eye-open", "Focus", "Focus mode: fade everything but the selection", () => on.toggleFocus?.());
  iconButton(groupView, "pxd-toolbar__present", "presentation", "Present", "Present this board", () => on.present?.());
  const moreBtn = iconButton(groupView, "pxd-toolbar__more", "more", "More", "More board actions", () => {
    const r = moreBtn.getBoundingClientRect();
    on.openMore?.({ x: r.left, y: r.bottom, w: r.width, h: r.height });
  });
  const group3 = el("div", "pxd-toolbar__group pxd-toolbar__zoom", toolbar);
  iconButton(group3, "pxd-toolbar__zoom-out", "minus", "Zoom out", "Zoom out (Cmd −)", () => on.zoomOut?.());
  const zoomLabel = button(group3, "pxd-toolbar__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  iconButton(group3, "pxd-toolbar__zoom-in", "plus", "Zoom in", "Zoom in (Cmd =)", () => on.zoomIn?.());
  iconButton(group3, "pxd-toolbar__fit", "zoom-to-fit", "Fit", "Fit all (Shift 1)", () => on.fit?.());
  const minimapBtn = iconButton(group3, "pxd-toolbar__minimap", "map", "Minimap", "Toggle minimap", () => on.toggleMinimap?.());
  const editBtn = iconButton(group3, "pxd-toolbar__edit", "edit", "Edit Block", "Edit the diagram block", () => on.editBlock?.());
  const fullBtn = iconButton(group3, "pxd-toolbar__fullscreen", "fullscreen", "Fullscreen", "Fullscreen this board", () => on.toggleFullscreen?.());
  let logEl = null;
  const closeLog = () => { logEl?.remove(); logEl = null; };
  const toggleLog = () => {
    if (logEl) { closeLog(); return; }
    const ver = String(version || "").replace(/^v/, "");
    const entry = changelogEntry(CHANGELOG_TEXT, ver);
    logEl = el("div", "pxd-changelog pxd-chrome", root);
    logEl.setAttribute("role", "dialog");
    logEl.setAttribute("aria-label", "Changelog");
    el("div", "pxd-changelog__title", logEl, ver ? `v${ver}` : "Changelog");
    el("pre", "pxd-changelog__body", logEl, entry || "No changelog entry for this version.");
    listen(logEl, "pointerdown", (event) => event.stopPropagation());
  };
  const badge = button(toolbar, "pxd-badge", version ? `v${version}` : "", "Show changelog", toggleLog);
  const sync = el("span", "pxd-sync", toolbar);
  tip(sync, "sync", "idle");
  sync.setAttribute("aria-label", "Synced");

  // Native order and title text, measured on an unenhanced diagram 2026-09-30.
  const railEl = el("div", "pxd-rail pxd-chrome", root);
  stopAll(railEl);
  railEl.setAttribute("role", "toolbar");
  railEl.setAttribute("aria-label", "Diagram controls");
  const railBtn = (cls, icon, title, fn) => {
    const b = button(railEl, `pxd-rail__btn ${cls}`, "", title, fn);
    b.setAttribute("aria-label", title);
    const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
    i.setAttribute("aria-hidden", "true");
    return b;
  };
  railBtn("pxd-rail__zoom-in", "plus", "zoom in", () => on.zoomIn?.());
  railBtn("pxd-rail__zoom-out", "minus", "zoom out", () => on.zoomOut?.());
  railBtn("pxd-rail__fit", "zoom-to-fit", "fit view", () => on.fit?.());
  const railMinimap = railBtn("pxd-rail__minimap", "eye-open", "Toggle Minimap", () => on.toggleMinimap?.());
  railBtn("pxd-rail__png", "media", "Save PNG", () => on.savePng?.());
  railBtn("pxd-rail__outline", "list", "Open outline in sidebar", () => on.openOutline?.());
  const railEdit = railBtn("pxd-rail__edit", "edit", "Edit Block", () => on.editBlock?.());
  const railFull = railBtn("pxd-rail__fullscreen", "maximize", "Maximize", () => on.toggleFullscreen?.());
  const railExtra = el("div", "pxd-rail__extra", railEl);
  const railZoom = button(railExtra, "pxd-rail__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  const railBadge = button(railExtra, "pxd-badge pxd-rail__badge", version ? `v${version}` : "", "Show changelog", toggleLog);
  const palette = el("div", "pxd-palette pxd-dock pxd-chrome", root);
  const paletteBar = el("div", "pxd-palette__bar pxd-dock__bar", palette);
  const dockIndicator = el("span", "pxd-dock__indicator", paletteBar);
  dockIndicator.setAttribute("aria-hidden", "true");
  el("span", "bp3-icon bp3-icon-lock pxd-dock__lock", dockIndicator);
  const paletteButtons = new Map();
  DOCK_GROUPS.forEach((ids, n) => {
    if (n) el("span", "pxd-dock__sep", paletteBar);
    const group = el("div", "pxd-dock__group", paletteBar);
    for (const id of ids) {
      const [, label, key, icon] = PALETTE_LIST.find((entry) => entry[0] === id);
      const b = iconButton(group, "pxd-palette__btn pxd-dock__btn", icon, label, `${label} (${key})`, () => on.setTool?.(id, false));
      b.dataset.tool = id;
      b.setAttribute("data-tool", id);
      tip(b, `tool.${id}`);
      const tag = el("span", "pxd-dock__label", b);
      tag.setAttribute("data-label", label);
      tag.setAttribute("aria-hidden", "true");
      listen(b, "dblclick", (event) => { event.preventDefault(); event.stopPropagation(); on.setTool?.(id, true); });
      paletteButtons.set(id, b);
    }
  });
  // Inline tool options: built once, shown per tool, so a tool switch never adds listeners.
  const dockOptions = el("div", "pxd-dock__options", paletteBar);
  dockOptions.style.display = "none";
  el("span", "pxd-dock__sep", dockOptions);
  const optionSets = new Map();
  const optionSet = (cls) => { const node = el("div", `pxd-dock__optset ${cls}`, dockOptions); node.style.display = "none"; return node; };
  const colorOpts = optionSet("pxd-dock__colors");
  swatches(colorOpts, (c) => on.setColor?.(c));
  const lookOpts = optionSet("pxd-dock__looks");
  for (const look of ["block", "card"]) {
    const b = button(lookOpts, "pxd-dock__opt", cap(look), `Show selected as ${look}`, () => on.setLook?.(look));
    b.dataset.look = look;
    b.setAttribute("data-look", look);
    tip(b, `dock.look.${look}`);
  }
  const shapeOpts = optionSet("pxd-dock__shapes");
  for (const shape of SHAPES) {
    const b = button(shapeOpts, "pxd-dock__opt", SHAPE_LABELS[shape] || shape, `Shape: ${SHAPE_LABELS[shape] || shape}`, () => on.setShape?.(shape));
    b.dataset.shape = shape;
    b.setAttribute("data-shape", shape);
    tip(b, `dock.shape.${shape}`);
  }
  optionSets.set("card", [colorOpts, lookOpts]);
  optionSets.set("sticky", [colorOpts]);
  optionSets.set("section", [colorOpts]);
  optionSets.set("shape", [shapeOpts]);
  let activeTool = "select";
  let activeLocked = false;
  const px = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const layoutDock = () => {
    const b = paletteButtons.get(activeTool);
    const visible = Boolean(b) && px(b.offsetWidth) > 0;
    dockIndicator.classList.toggle("pxd-dock__indicator--locked", activeLocked);
    dockIndicator.classList.toggle("pxd-dock__indicator--idle", !visible);
    if (!visible) return;
    dockIndicator.style.setProperty("--pxd-ind-x", `${px(b.offsetLeft)}px`);
    dockIndicator.style.setProperty("--pxd-ind-y", `${px(b.offsetTop)}px`);
    dockIndicator.style.setProperty("--pxd-ind-w", `${px(b.offsetWidth)}px`);
    dockIndicator.style.setProperty("--pxd-ind-h", `${px(b.offsetHeight)}px`);
  };
  let dockFrame = null;
  const scheduleDock = () => {
    if (dockFrame) return;
    dockFrame = timers.frame(() => { dockFrame = null; layoutDock(); });
  };
  listen(palette, "pointerenter", () => layoutDock());
  let pendingMap = {};
  const paintPending = () => {
    const mine = pendingMap[activeTool] || {};
    const mark = (node, on) => {
      node.classList.toggle("pxd-dock__chosen", on);
      node.setAttribute("aria-pressed", on ? "true" : "false");
    };
    for (const s of colorOpts.querySelectorAll(".pxd-swatch")) mark(s, Boolean(mine.color) && s.getAttribute("data-color") === mine.color);
    for (const b of lookOpts.querySelectorAll(".pxd-dock__opt")) mark(b, Boolean(mine.look) && b.getAttribute("data-look") === mine.look);
    for (const b of shapeOpts.querySelectorAll(".pxd-dock__opt")) mark(b, Boolean(mine.shape) && b.getAttribute("data-shape") === mine.shape);
  };
  const applyDockOptions = () => {
    paintPending();
    const sets = optionSets.get(activeTool) || [];
    const show = sets.length > 0 && setting("dock-options") !== false;
    dockOptions.style.display = show ? "" : "none";
    for (const node of new Set([colorOpts, lookOpts, shapeOpts])) node.style.display = show && sets.includes(node) ? "" : "none";
  };

  // Board bar visibility for the dock-only layout: near the top edge, or focus inside, or a popover/menu from it is open.
  let boardDock = null;
  let barNear = false;
  let barFocus = false;
  let revealOff = null;
  const barHeld = () => {
    if (popover.isOpen() || crumbMenu) return true;
    return Boolean(root.querySelector?.(".pxd-menu"));
  };
  const paintBar = () => {
    const dockOnly = root.classList.contains("pxd-root--layout-dock-only");
    toolbar.classList.toggle("pxd-toolbar--hidden", dockOnly && !(barNear || barFocus || barHeld()));
  };
  const onRootMove = (event) => {
    const r = root.getBoundingClientRect();
    const near = event.clientY - (r.top || 0) <= REVEAL_PX || Boolean(toolbar.contains?.(event.target));
    if (near === barNear) {
      if (!near && !toolbar.classList.contains("pxd-toolbar--hidden")) paintBar();
      return;
    }
    barNear = near;
    paintBar();
  };
  const onRootLeave = () => { if (!barNear) return; barNear = false; paintBar(); };
  const onBarFocus = () => { barFocus = true; paintBar(); };
  const onBarBlur = () => { barFocus = false; paintBar(); };
  const watchReveal = (on) => {
    if (on && !revealOff) {
      const offs = [];
      for (const [node, type, fn] of [[root, "pointermove", onRootMove], [root, "pointerleave", onRootLeave], [toolbar, "focusin", onBarFocus], [toolbar, "focusout", onBarBlur]]) {
        node.addEventListener(type, fn);
        offs.push(() => node.removeEventListener(type, fn));
      }
      revealOff = () => offs.splice(0).forEach((off) => off());
    } else if (!on && revealOff) {
      revealOff();
      revealOff = null;
      barNear = false;
      barFocus = false;
    }
  };
  const applyControls = () => {
    const rail = setting("controls-position") !== "bar";
    root.classList.toggle("pxd-root--rail", rail);
    railEl.style.display = rail ? "" : "none";
    group3.style.display = rail ? "none" : "";
    const showBadge = setting("show-version-badge") !== false;
    badge.style.display = !rail && showBadge ? "" : "none";
    railBadge.style.display = rail && showBadge ? "" : "none";
    palette.style.display = setting("show-palette") === false ? "none" : "";
    const taskBtn = paletteButtons.get("task");
    if (taskBtn) taskBtn.style.display = setting("task-tool") === false ? "none" : "";
    const layoutSetting = setting("toolbar-layout");
    const layout = LAYOUTS.includes(layoutSetting) ? layoutSetting : "split";
    const docked = layout !== "classic";
    for (const name of LAYOUTS) root.classList.toggle(`pxd-root--layout-${name}`, name === layout);
    root.classList.toggle("pxd-root--docked", docked);
    toolGroup.style.display = docked ? "none" : "";
    const dockSetting = setting("dock-position");
    const own = DOCK_POSITIONS.includes(boardDock) ? boardDock : null;
    const side = own ?? (DOCK_POSITIONS.includes(dockSetting) ? dockSetting : "bottom");
    for (const name of DOCK_POSITIONS) root.classList.toggle(`pxd-root--dock-${name}`, docked && name === side);
    const styleSetting = setting("dock-style");
    const shape = DOCK_STYLES.includes(styleSetting) ? styleSetting : "pill";
    for (const name of DOCK_STYLES) root.classList.toggle(`pxd-root--dock-${name}`, docked && name === shape);
    root.classList.toggle("pxd-root--dock-labels", docked && setting("dock-labels") === true);
    root.classList.toggle("pxd-root--dense", docked && setting("chrome-density") === "compact");
    watchReveal(layout === "dock-only");
    paintBar();
    applyDockOptions();
    layoutDock();
  };

  const toolbarApi = {
    el: toolbar,
    setCrumbs: renderCrumbs,
    setTool(tool, locked) {
      for (const [id, b] of toolButtons) {
        b.classList.toggle("pxd-tool--active", id === tool);
        b.classList.toggle("pxd-tool--locked", id === tool && Boolean(locked));
      }
      activeTool = tool;
      activeLocked = Boolean(locked);
      for (const [id, b] of paletteButtons) {
        b.classList.toggle("pxd-palette__btn--on", id === tool);
        b.classList.toggle("pxd-dock__btn--on", id === tool);
        b.classList.toggle("pxd-tool--locked", id === tool && Boolean(locked));
        b.classList.toggle("pxd-dock__btn--locked", id === tool && Boolean(locked));
      }
      applyDockOptions();
      layoutDock();
    },
    setPending(map) {
      pendingMap = map || {};
      paintPending();
    },
    layoutDock,
    scheduleDock,
    setBoardDock(value) {
      const next = DOCK_POSITIONS.includes(value) ? value : null;
      if (next === boardDock) return;
      boardDock = next;
      applyControls();
    },
    setBoardColor(value) {
      let line = null;
      if (PALETTE.includes(value)) line = `var(--pxd-${value}-line)`;
      else if (/^#[0-9a-f]{6}$/i.test(String(value || ""))) line = String(value).toLowerCase();
      if (line) toolbar.style.setProperty("--pxd-board-line", line);
      else toolbar.style.removeProperty("--pxd-board-line");
    },
    setZoom(z) {
      const label = `${Math.round((z || 1) * 100)}%`;
      zoomLabel.textContent = label;
      railZoom.textContent = label;
    },
    setLinkMode(mode) {
      const key = LINK_ICONS[mode] ? mode : "all";
      setIcon(linksBtn, LINK_ICONS[key], LINK_LABELS[key], key);
    },
    setSync(pending) {
      const name = pending === true ? "writing" : pending === false || pending == null ? "idle" : pending;
      const titles = { idle: "Synced", writing: "Saving…", retrying: "Retrying…", failed: "Couldn't save" };
      const state = titles[name] ? name : "idle";
      sync.classList.remove("pxd-sync--pending", "pxd-sync--writing", "pxd-sync--retrying", "pxd-sync--failed");
      if (state === "writing") sync.classList.add("pxd-sync--pending", "pxd-sync--writing");
      else if (state !== "idle") sync.classList.add(`pxd-sync--${state}`);
      sync.setAttribute("data-tip-state", state);
      sync.setAttribute("aria-label", titles[state]);
    },
    setFullscreen(on) {
      editBtn.style.display = on ? "none" : "";
      railEdit.style.display = on ? "none" : "";
      setIcon(fullBtn, on ? "minimize" : "fullscreen", on ? "Exit fullscreen" : "Fullscreen", on ? "on" : "off");
      fullBtn.classList.toggle("pxd-btn--active", Boolean(on));
      const title = on ? "Minimize" : "Maximize";
      railFull.setAttribute("data-tip-state", on ? "on" : "off");
      railFull.setAttribute("aria-label", title);
      const icon = railFull.querySelector(".bp3-icon");
      if (icon) icon.className = `bp3-icon bp3-icon-${on ? "minimize" : "maximize"}`;
    },
    applyControls,
    // Called on every panel open/close: a floating context bar re-clears the panel now, not at the next pan.
    setPanel(open) { addBtn.classList.toggle("pxd-btn--active", Boolean(open)); positionCtx(); },
    setMinimap(open) {
      minimapBtn.classList.toggle("pxd-btn--active", Boolean(open));
      railMinimap.classList.toggle("pxd-btn--active", Boolean(open));
    },
    setFocus(active) { focusBtn.classList.toggle("pxd-btn--active", Boolean(active)); },
    setLens(active) { lensBtn.classList.toggle("pxd-btn--active", Boolean(active)); },
    lensButton: lensBtn,
    setTable(on) {
      const active = Boolean(on);
      tableBtn.classList.toggle("pxd-btn--active", active);
      setIcon(tableBtn, active ? "grid-view" : "th", active ? "Board" : "Table", active ? "on" : "off");
      tableBtn.setAttribute("aria-pressed", active ? "true" : "false");
    },
    setKanban(on) {
      const active = Boolean(on);
      kanbanBtn.classList.toggle("pxd-btn--active", active);
      setIcon(kanbanBtn, active ? "grid-view" : "layout-auto", active ? "Board" : "Kanban", active ? "on" : "off");
      kanbanBtn.setAttribute("aria-pressed", active ? "true" : "false");
    },
    setBackground(state) { popover.setState(state); },
    bgButton: bgBtn,
  };

  // ---------------------------------------------------------------- background popover
  const popEl = el("div", "pxd-popover pxd-popover--bg pxd-chrome", root);
  popEl.style.display = "none";
  popEl.setAttribute("role", "dialog");
  popEl.setAttribute("aria-label", "Background");
  stopAll(popEl);
  el("div", "pxd-popover__title", popEl, "Background");
  el("div", "pxd-popover__label", popEl, "Pattern");
  const patternSeg = el("div", "pxd-seg pxd-bg__pattern", popEl);
  const patternButtons = new Map();
  for (const pattern of BOARD_PATTERNS) {
    const b = button(patternSeg, "pxd-seg__btn", PATTERN_LABELS[pattern] || pattern, PATTERN_LABELS[pattern] || pattern, () => on.setBackground?.({ bg: pattern }));
    b.dataset.value = pattern;
    b.setAttribute("data-value", pattern);
    tip(b, `bg.pattern.${pattern}`);
    patternButtons.set(pattern, b);
  }
  el("div", "pxd-popover__label", popEl, "Tone");
  const toneWrap = swatches(popEl, (tone) => on.setBackground?.({ bgColor: tone }), { key: "tone", paper: true });
  toneWrap.classList.add("pxd-bg__tones");
  const popFoot = el("div", "pxd-popover__foot", popEl);
  button(popFoot, "pxd-bg__default", "Use as default", "Use this pattern and tone for every board", () => on.useBackgroundAsDefault?.());
  const resetBtn = button(popFoot, "pxd-bg__reset", "Reset", "Clear this board's override", () => on.setBackground?.({ bg: null, bgColor: null }));
  let bgOffs = [];
  const popover = {
    el: popEl,
    isOpen: () => popEl.style.display !== "none",
    open() {
      if (popover.isOpen()) return;
      popEl.style.display = "";
      placeNearAnchor(popEl, bgBtn.getBoundingClientRect(), root, { gap: POPOVER_GAP, skip: bgBtn.closest?.(".pxd-toolbar, .pxd-dock") || null });
      bgBtn.classList.add("pxd-btn--active");
      const onDown = (event) => {
        if (popEl.contains(event.target) || bgBtn.contains(event.target)) return;
        popover.close();
      };
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault?.();
        event.stopPropagation?.();
        popover.close();
      };
      doc.addEventListener("pointerdown", onDown, true);
      doc.addEventListener("keydown", onKey, true);
      bgOffs = [() => doc.removeEventListener("pointerdown", onDown, true), () => doc.removeEventListener("keydown", onKey, true)];
    },
    close() {
      bgOffs.splice(0).forEach((off) => off());
      popEl.style.display = "none";
      bgBtn.classList.remove("pxd-btn--active");
    },
    setState({ pattern, tone, override } = {}) {
      bgState = { pattern: pattern ?? null, tone: tone ?? null, override: Boolean(override) };
      for (const [id, b] of patternButtons) b.classList.toggle("pxd-seg__btn--on", id === bgState.pattern);
      for (const s of toneWrap.querySelectorAll(".pxd-swatch")) {
        const value = s.dataset.tone ?? s.getAttribute("data-tone") ?? "";
        s.classList.toggle("pxd-swatch--on", value === (bgState.tone || ""));
      }
      resetBtn.classList.toggle("pxd-bg__reset--idle", !bgState.override);
      popEl.classList.toggle("pxd-popover--override", bgState.override);
    },
  };
  let bgState = { pattern: null, tone: null, override: false };
  popover.setState(bgState);
  applyControls();

  // ---------------------------------------------------------------- back to content
  const backEl = button(root, "pxd-backtocontent pxd-chrome", "Back to content", "Fit the view back to your cards", () => on.backToContent?.());
  tip(backEl, "backtocontent");
  backEl.style.display = "none";
  for (const type of ["pointerup", "wheel", "keydown", "keyup", "contextmenu"]) listen(backEl, type, (event) => event.stopPropagation());
  const backToContent = {
    el: backEl,
    setVisible(visible) { backEl.style.display = visible ? "" : "none"; },
    isVisible: () => backEl.style.display !== "none",
  };

  // ---------------------------------------------------------------- context bar
  const ctx = el("div", "pxd-ctx pxd-chrome", root);
  ctx.style.display = "none";
  stopAll(ctx);
  let ctxAnchor = null; // () => { rect, kind }

  const buildCtx = (kind, model) => {
    ctx.replaceChildren();
    on.chromeRebuilt?.();
    ctx.dataset.kind = kind;
    ctx.setAttribute("data-kind", kind);
    const row = el("div", "pxd-ctx__row", ctx);
    const btn = (cls, icon, label, title, fn) => iconButton(row, `pxd-ctx__btn ${cls}`, icon, label, title, fn);
    const seg = (cls, options, current, fn) => {
      const wrap = el("div", `pxd-seg ${cls}`, row);
      for (const [value, label, title, icon] of options) {
        const b = button(wrap, `pxd-seg__btn${value === current ? " pxd-seg__btn--on" : ""}${icon ? " pxd-iconbtn" : ""}`, icon ? "" : label, title || label, () => fn(value));
        if (icon) {
          b.setAttribute("aria-label", title || label);
          const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
          i.setAttribute("aria-hidden", "true");
        }
        b.dataset.value = String(value);
        tip(b, `${cls.replace(/^pxd-ctx__/, "ctx.")}.${value}`);
      }
      return wrap;
    };
    // Optional 1.2 buttons: each is skipped when its callback is missing.
    const opt = (name, cls, icon, label, title, fn) => { if (typeof on[name] === "function") btn(cls, icon, label, title, fn); };
    const optSeg = (name, cls, options, fn) => { if (typeof on[name] === "function") seg(cls, options, null, fn); };
    const pinButton = (pinned) => opt("pin", "pxd-ctx__pin-toggle", pinned ? "unpin" : "pin", pinned ? "Unpin" : "Pin", pinned ? "Unpin: allow moving and resizing again" : "Pin: lock position and size", () => on.pin(!pinned));
    const TIDY = [["grid", "Grid", "Tidy into a grid", "grid"], ["row", "Row", "Tidy into a row", "drag-handle-horizontal"], ["column", "Column", "Tidy into a column", "drag-handle-vertical"]];
    const iconBtn = (cls, icon, label, title, fn) => btn(cls, icon, label, title, fn);
    switch (kind) {
      case "card":
      case "cards": {
        if (kind === "card") {
          const picker = el("div", "pxd-ctx__picker", ctx);
          picker.style.display = "none";
          let pickerBuilt = false;
          const colorBtn = iconBtn("pxd-ctx__color", "tint", "Color", "Color", () => {
            if (!pickerBuilt) {
              const tagOpts = {};
              if (typeof on.onTag === "function") {
                tagOpts.onTag = (name) => { on.onTag(name); picker.style.display = "none"; };
                if (typeof on.onGear === "function") tagOpts.onGear = (flag) => { on.onGear(flag); };
                tagOpts.tagMode = typeof on.tagMode === "function" ? on.tagMode() === true : false;
              }
              if (model?.kind === "highlight" && typeof on.setHighlightColor === "function") {
                tagOpts.onHighlight = (name) => { on.setHighlightColor(name); picker.style.display = "none"; };
              }
              const pickerOpts = tagOpts.onTag || tagOpts.onHighlight ? tagOpts : undefined;
              picker.append(buildColorPicker(doc, (c) => { on.setColor?.(c); picker.style.display = "none"; }, listen, pickerOpts));
              pickerBuilt = true;
            }
            picker.style.display = picker.style.display === "none" ? "" : "none";
            // The bar is nearly as wide as the board. Anchoring on it drops the picker past the right edge.
            if (picker.style.display !== "none") placeNearAnchor(picker, colorBtn.getBoundingClientRect(), root, { gap: 4, origin: ctx });
          });
          const closed = model?.kind === "note" || model?.kind === "block" ? !model?.kids : model?.open === false;
          iconBtn(
            "pxd-ctx__expand",
            closed ? "expand-all" : "collapse-all",
            closed ? "Expand children" : "Collapse children",
            closed ? "Show children" : "Hide children",
            () => on.toggleOpen?.(),
          );
          const n = Number(model?.refs) || 0;
          const refs = iconBtn("pxd-ctx__refs", "link", "References", `${n} ${n === 1 ? "reference" : "references"}`, () => on.showRefs?.());
          el("span", "pxd-ctx__refs-count", refs, String(n));
        }
        swatches(row, (c) => on.setColor?.(c));
        if (kind === "card") {
          btn("pxd-ctx__edit", "edit", "Edit", "Edit (Enter)", () => on.edit?.());
          btn("pxd-ctx__sidebar", "panel-stats", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
          btn("pxd-ctx__collapse", model?.collapsed ? "expand-all" : "collapse-all", model?.collapsed ? "Expand" : "Collapse", "Collapse to title", () => on.collapse?.());
          btn("pxd-ctx__related", "diagram-tree", "Related…", "Show related pages and blocks", () => on.related?.());
          pinButton(Boolean(model?.pinned));
          opt("fitHeight", "pxd-ctx__fit-height", "arrows-vertical", "Fit height", "Grow or shrink the card to its text", () => on.fitHeight());
          opt("copyRef", "pxd-ctx__copy-ref", "clipboard", "Copy ref", "Copy a block or page reference", () => on.copyRef());
          opt("duplicate", "pxd-ctx__duplicate", "duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
          opt("sendTo", "pxd-ctx__send-to", "send-to", "Send to board…", "Move into another board", () => on.sendTo());
          if (NOTE_KINDS.includes(model?.kind)) opt("expandOutline", "pxd-ctx__mindmap", "layout-hierarchy", "Mind map", "Expand the children as a mind map", () => on.expandOutline());
          if (model?.kind === "image" || (model?.kind === "highlight" && model?.highlight?.image === true)) btn("pxd-ctx__mark-region", "highlight", "Mark region", "Drag a rectangle on this image", () => on.markRegion?.());
          opt("selectSameColor", "pxd-ctx__same-color", "full-circle", "Select same color", "Select every item of this color", () => on.selectSameColor());
          opt("selectConnected", "pxd-ctx__connected", "flows", "Select connected", "Select items linked to this one", () => on.selectConnected());
        } else {
          seg("pxd-ctx__align", [["left", "L", "Align left", "alignment-left"], ["center", "C", "Align centers", "alignment-horizontal-center"], ["right", "R", "Align right", "alignment-right"], ["top", "T", "Align top", "alignment-top"], ["middle", "M", "Align middles", "alignment-vertical-center"], ["bottom", "B", "Align bottom", "alignment-bottom"]], null, (v) => on.align?.(v));
          seg("pxd-ctx__distribute", [["h", "H", "Distribute horizontally", "horizontal-distribution"], ["v", "V", "Distribute vertically", "vertical-distribution"]], null, (v) => on.distribute?.(v));
          btn("pxd-ctx__wrap", "group-objects", "Wrap in section", "Wrap in a new section (Cmd G)", () => on.wrap?.());
          btn("pxd-ctx__wrap-board", "folder-new", "Move into new board", "Move the selection into a new nested board", () => on.wrapBoard?.());
          optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
          optSeg("sameSize", "pxd-ctx__same-size", [["width", "W", "Same width"], ["height", "H", "Same height"], ["both", "WH", "Same width and height"]], (v) => on.sameSize(v));
          opt("fold", "pxd-ctx__fold", model?.anyCollapsed ? "expand-all" : "collapse-all", model?.anyCollapsed ? "Unfold" : "Fold", model?.anyCollapsed ? "Expand the collapsed cards" : "Collapse the cards to titles", () => on.fold(!model?.anyCollapsed));
          pinButton(Boolean(model?.allPinned));
          opt("duplicate", "pxd-ctx__duplicate", "duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
          opt("saveViewSelection", "pxd-ctx__save-view", "camera", "Save view", "Save a view of the selection", () => on.saveViewSelection());
        }
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      }
      case "board":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__open-board", "document-open", "Open", "Open this board (Enter)", () => on.openBoard?.());
        opt("openOwnPage", "pxd-ctx__own-page", "document", "Own page", "Open nested board in its own page", () => on.openOwnPage());
        if (model?.enhanced) btn("pxd-ctx__rename-board", "edit", "Rename board", "Rename the board", () => on.renameBoard?.());
        btn("pxd-ctx__sidebar", "panel-stats", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "section":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__rename", "edit", "Rename", "Rename (Enter)", () => on.rename?.());
        btn("pxd-ctx__contents", "multi-select", "Select contents", "Select the section's members", () => on.selectContents?.());
        opt("selectAllInSection", "pxd-ctx__all-in-section", "select", "Select all in section", "Select everything inside the section", () => on.selectAllInSection());
        opt("selectSameColor", "pxd-ctx__same-color", "full-circle", "Select same color", "Select every item of this color", () => on.selectSameColor());
        opt("selectConnected", "pxd-ctx__connected", "flows", "Select connected", "Select items linked to this one", () => on.selectConnected());
        opt("collapseSection", "pxd-ctx__collapse-section", model?.collapsed ? "expand-all" : "collapse-all", model?.collapsed ? "Expand" : "Collapse", model?.collapsed ? "Expand the section" : "Collapse to the title", () => on.collapseSection?.());
        opt("sectionNote", "pxd-ctx__section-note", model?.hasNote ? "cross" : "annotation", model?.hasNote ? "Remove note" : "Description", model?.hasNote ? "Remove the section description" : "Add a description line", () => on.sectionNote?.());
        opt("lockSection", "pxd-ctx__lock", model?.locked ? "unlock" : "lock", model?.locked ? "Unlock" : "Lock", model?.locked ? "Unpin everything inside" : "Pin the section and everything inside", () => on.lockSection?.(!model?.locked));
        opt("presentSection", "pxd-ctx__present-section", "presentation", "Present", "Present this section", () => on.presentSection?.());
        opt("fitSection", "pxd-ctx__fit-section", "zoom-to-fit", "Fit to contents", "Resize the section around its cards", () => on.fitSection());
        opt("toggleFit", "pxd-ctx__auto-fit", "automatic-updates", model?.autofit ? "Auto-fit: on" : "Auto-fit: off", "Keep the section sized to its cards", () => on.toggleFit());
        optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
        opt("foldAll", "pxd-ctx__fold-all", "collapse-all", "Fold all", "Collapse every card in the section", () => on.foldAll(true));
        pinButton(Boolean(model?.pinned));
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete frame", "Delete the frame, keep the cards (Del). Shift+Del deletes contents too", () => on.delete?.());
        break;
      case "text":
        swatches(row, (c) => on.setColor?.(c));
        seg("pxd-ctx__size", FONT_SIZES.map((s, i) => [s, ["S", "M", "L", "XL"][i], `${s}px`]), model?.fontSize || 24, (v) => on.setFontSize?.(v));
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "edge":
        seg("pxd-ctx__dir", [["one", "→", "One way"], ["two", "↔", "Two way"], ["none", "—", "No arrow"]], model?.dir, (v) => on.edgeDir?.(v));
        btn("pxd-ctx__flip", "swap-horizontal", "Flip", "Swap endpoints", () => on.flip?.());
        if (model?.fromBlock || model?.toBlock) btn("pxd-ctx__unblock", "document", "Page", "Connect to the page instead of a block", () => on.unblock?.());
        seg("pxd-ctx__route", [["curve", "Curve", "Curve", "path"], ["straight", "Straight", "Straight", "flow-linear"], ["elbow", "Elbow", "Elbow", "step-chart"]], model?.route, (v) => on.route?.(v));
        seg("pxd-ctx__dash", [["solid", "Solid", "Solid", "minus"], ["dashed", "Dashed", "Dashed", "slash"], ["animated", "Animated", "Animated", "pulse"]], model?.dash, (v) => on.dash?.(v));
        seg("pxd-ctx__weight", [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], model?.weight, (v) => on.weight?.(v));
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__label", "tag", "Label", "Edit the label", () => on.label?.());
        btn("pxd-ctx__notes", "annotation", "Notes", "Open the connection block in the sidebar", () => on.notes?.());
        btn("pxd-ctx__write", "inheritance", "Write to graph", "Create an attribute on the source", () => on.writeToGraph?.());
        btn("pxd-ctx__delete pxd-btn--danger", "trash", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "link": {
        const list = el("div", "pxd-ctx__sources", row);
        for (const s of model?.sources || []) {
          const b = button(list, "pxd-ctx__source", (s.string || s.uid || "").slice(0, 60), "Open in the sidebar", () => on.openSource?.(s.uid));
          b.dataset.uid = s.uid;
        }
        btn("pxd-ctx__pin", "new-link", "Pin as connection", "Create a board connection from this link", () => on.pinLink?.());
        break;
      }
      default:
        break;
    }
    // Buttons whose meaning flips carry the state the tooltip table keys on (`id:on`).
    const flip = (cls, active) => row.querySelector(`.${cls}`)?.setAttribute("data-tip-state", active ? "on" : "off");
    const closedKids = model?.kind === "note" || model?.kind === "block" ? !model?.kids : model?.open === false;
    flip("pxd-ctx__expand", !closedKids);
    flip("pxd-ctx__collapse", Boolean(model?.collapsed));
    flip("pxd-ctx__pin-toggle", Boolean(model?.pinned ?? model?.allPinned));
    flip("pxd-ctx__fold", Boolean(model?.anyCollapsed));
    flip("pxd-ctx__lock", Boolean(model?.locked));
    flip("pxd-ctx__section-note", Boolean(model?.hasNote));
    flip("pxd-ctx__collapse-section", Boolean(model?.collapsed));
    flip("pxd-ctx__auto-fit", Boolean(model?.autofit));
  };

  const positionCtx = () => {
    if (ctx.style.display === "none" || !ctxAnchor) return;
    const a = ctxAnchor();
    if (!a) { ctx.style.display = "none"; return; }
    const rootRect = root.getBoundingClientRect();
    const W = rootRect.width || 0;
    const H = rootRect.height || 0;
    const gap = a.kind === "edge" ? CTX_EDGE_CLEARANCE : CTX_GAP;
    // The bar never covers the toolbar (two rows tall) or an open side panel: it flips below / stays left of them.
    const tb = toolbar.getBoundingClientRect();
    const propsEl = root.querySelector?.(".pxd-props");
    const propsBox = propsEl ? propsEl.getBoundingClientRect() : null;
    const propsRight = propsBox?.width ? propsBox.right - (rootRect.left || 0) : 0;
    const propsBot = propsBox?.height ? propsBox.bottom - (rootRect.top || 0) : 0;
    const topLimit = tb.height ? Math.max(CTX_MARGIN, tb.bottom - (rootRect.top || 0) + CTX_MARGIN) : CTX_MARGIN;
    const railBox = railEl.style.display !== "none" ? railEl.getBoundingClientRect() : null;
    const railClear = railBox?.width ? Math.max(0, rootRect.right - railBox.left) : 0;
    const panelEl = root.querySelector?.(".pxd-panel");
    const pr = panelEl && panelEl.style?.display !== "none" ? panelEl.getBoundingClientRect() : null;
    const room = pr?.width ? Math.min(W, pr.left - (rootRect.left || 0)) : W;
    // A bar wider than the space left of the panel wraps into more rows instead of floating over the panel.
    ctx.style.maxWidth = pr?.width && room > 0 ? `${Math.max(CTX_MIN_WIDTH, Math.round(room - 2 * CTX_MARGIN))}px` : "";
    const barW = ctx.offsetWidth || 320;
    const barH = ctx.offsetHeight || 36;
    const rightLimit = pr?.width ? Math.max(barW + CTX_MARGIN, room) : Math.max(barW + CTX_MARGIN, W - railClear);
    let top = a.rect.y - gap - barH;
    if (top < topLimit) top = a.rect.y + a.rect.h + gap; // flip below near the top edge
    if (top + barH > H - CTX_MARGIN && a.rect.y - gap - barH >= topLimit) top = a.rect.y - gap - barH;
    top = Math.max(top, topLimit); // a card panned under the toolbar: the bar sits at the toolbar's edge, never over it
    let left = a.rect.x + a.rect.w / 2 - barW / 2;
    left = Math.max(CTX_MARGIN, Math.min(left, rightLimit - barW - CTX_MARGIN));
    // An open Properties panel sits under the toolbar on the left. Push the bar below it, or to its right.
    if (propsBox?.height && left < propsRight && top < propsBot) {
      const below = propsBot + CTX_MARGIN;
      if (below + barH <= H - CTX_MARGIN) top = Math.max(top, below);
      else left = Math.max(left, propsRight + CTX_MARGIN);
    }
    ctx.style.left = `${Math.round(left)}px`;
    ctx.style.top = `${Math.round(top)}px`;
    ctx.classList.toggle("pxd-ctx--below", top > a.rect.y);
  };

  const ctxApi = {
    el: ctx,
    show(kind, model, anchor) {
      buildCtx(kind, model);
      ctxAnchor = anchor;
      ctx.style.display = "";
      positionCtx();
    },
    hide() { ctx.style.display = "none"; ctxAnchor = null; ctx.replaceChildren(); on.chromeRebuilt?.(); },
    reposition: positionCtx,
    isOpen: () => ctx.style.display !== "none",
  };

  // ---------------------------------------------------------------- toast
  const toast = el("div", "pxd-toast pxd-chrome", root);
  toast.style.display = "none";
  stopAll(toast);
  let toastTimer = null;
  const toastApi = {
    el: toast,
    show({ message, action } = {}) {
      toast.replaceChildren();
      el("span", "pxd-toast__text", toast, message || "");
      if (action?.label) {
        button(toast, "pxd-toast__action", action.label, action.label, () => { action.run?.(); toastApi.hide(); });
      }
      toast.style.display = "";
      toastTimer?.();
      toastTimer = timers.later(() => toastApi.hide(), TOAST_MS);
    },
    hide() { toast.style.display = "none"; toastTimer?.(); toastTimer = null; },
  };

  // ---------------------------------------------------------------- board search
  const search = el("div", "pxd-search pxd-chrome", root);
  search.style.display = "none";
  stopAll(search);
  const searchInput = el("input", "pxd-input pxd-search__input", search);
  searchInput.type = "text";
  searchInput.setAttribute("aria-label", "Search this board");
  searchInput.placeholder = "Search this board…";
  searchInput.setAttribute("placeholder", "Search this board…");
  const searchCount = el("span", "pxd-search__count", search, "");
  listen(searchInput, "input", () => {
    const n = on.searchFilter?.(searchInput.value || "") ?? 0;
    searchCount.textContent = searchInput.value ? `${n}` : "";
  });
  listen(searchInput, "keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); on.searchNext?.(event.shiftKey ? -1 : 1); }
    else if (event.key === "Escape") { event.preventDefault(); searchApi.close(); }
  });
  const searchApi = {
    el: search,
    open() {
      search.style.display = "";
      try { searchInput.focus({ preventScroll: true }); } catch { searchInput.focus?.(); }
      searchInput.select?.();
    },
    close() {
      search.style.display = "none";
      searchInput.value = "";
      searchCount.textContent = "";
      on.searchFilter?.("");
      on.searchClosed?.();
    },
    isOpen: () => search.style.display !== "none",
  };

  // ---------------------------------------------------------------- minimap
  const minimap = el("div", "pxd-minimap pxd-chrome", root);
  tip(minimap, "minimap");
  stopAll(minimap);
  const canvas = el("canvas", "pxd-minimap__canvas", minimap);
  canvas.width = MINIMAP_W;
  canvas.height = MINIMAP_H;
  let mmDirty = true;
  let mmFrame = null;
  let mmState = null; // { board, rects, vp, size }
  let mmScale = null;
  const computeScale = (rects, size, vp) => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const add = (r) => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); };
    for (const r of rects.values()) add(r);
    const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: size.width / vp.zoom, h: size.height / vp.zoom };
    add(view);
    if (!Number.isFinite(minX)) return null;
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const s = Math.min(MINIMAP_W / (maxX - minX), MINIMAP_H / (maxY - minY));
    return { s, ox: (MINIMAP_W - (maxX - minX) * s) / 2 - minX * s, oy: (MINIMAP_H - (maxY - minY) * s) / 2 - minY * s, view };
  };
  const draw = () => {
    mmFrame = null;
    if (!mmDirty || !mmState || minimap.style.display === "none") return;
    mmDirty = false;
    const { board, rects, vp, size } = mmState;
    const g = canvas.getContext?.("2d");
    if (!g) return;
    const sc = computeScale(rects, size, vp);
    mmScale = sc;
    g.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    if (!sc) return;
    const colors = mmColors();
    for (const uid of board.order) {
      const item = board.items.get(uid);
      const r = rects.get(uid);
      if (!r) continue;
      g.fillStyle = item.type === "section" ? colors.section : colors.item;
      g.fillRect(r.x * sc.s + sc.ox, r.y * sc.s + sc.oy, Math.max(1, r.w * sc.s), Math.max(1, r.h * sc.s));
    }
    g.strokeStyle = colors.frame;
    g.lineWidth = 1;
    g.strokeRect(sc.view.x * sc.s + sc.ox, sc.view.y * sc.s + sc.oy, sc.view.w * sc.s, sc.view.h * sc.s);
  };
  const mmColors = () => {
    const dark = root.classList.contains("pxd-root--dark");
    return dark
      ? { item: "rgba(200, 210, 220, 0.6)", section: "rgba(120, 140, 160, 0.35)", frame: "#2dd4bf" }
      : { item: "rgba(60, 80, 100, 0.55)", section: "rgba(60, 80, 100, 0.2)", frame: "#0d9488" };
  };
  const navigateTo = (event) => {
    if (!mmScale || !mmState) return;
    const r = canvas.getBoundingClientRect();
    const px = (event.clientX - r.left) - mmScale.ox;
    const py = (event.clientY - r.top) - mmScale.oy;
    const world = { x: px / mmScale.s, y: py / mmScale.s };
    on.navigate?.(world);
  };
  let mmDragging = false;
  listen(canvas, "pointerdown", (event) => { event.stopPropagation(); mmDragging = true; navigateTo(event); });
  listen(canvas, "pointermove", (event) => { if (mmDragging) navigateTo(event); });
  const stopDrag = () => { mmDragging = false; };
  listen(canvas, "pointerup", stopDrag);
  listen(canvas, "pointerleave", stopDrag);
  const minimapApi = {
    el: minimap,
    // Called from inside the view's render frame: draw now, no extra rAF.
    update(state) { mmState = state; mmDirty = true; if (minimap.style.display !== "none") draw(); },
    setVisible(on) {
      minimap.style.display = on ? "" : "none";
      palette.classList.toggle("pxd-palette--wide", !on);
      toolbarApi.setMinimap(on);
      if (on) { mmDirty = true; if (!mmFrame) mmFrame = timers.frame(draw); }
    },
    isVisible: () => minimap.style.display !== "none",
    draw,
  };

  const dispose = () => {
    toastTimer?.();
    mmFrame?.();
    dockFrame?.();
    revealOff?.();
    bgOffs.splice(0).forEach((off) => off());
    listeners.splice(0).forEach((off) => off());
    for (const node of [toolbar, railEl, palette, popEl, backEl, ctx, toast, search, minimap]) node.remove();
  };

  return { toolbar: toolbarApi, ctx: ctxApi, toast: toastApi, search: searchApi, minimap: minimapApi, popover, changelog: { isOpen: () => Boolean(logEl), close: closeLog }, backToContent, badge, sync, dispose };
}

export { LINK_MODES, CTX_GAP, CTX_EDGE_CLEARANCE };
