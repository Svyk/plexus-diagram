// Screen-space chrome: toolbar (spec 3.5), context bar (spec 3.4), toast, board search,
// minimap, version badge, sync dot. Everything lives inside .pxd-root; no portals.

import { PALETTE, FONT_SIZES } from "../model/schema.js";

const CTX_GAP = 12;
const CTX_EDGE_CLEARANCE = 28;
const CTX_MARGIN = 8;
const TOAST_MS = 6000;
const MINIMAP_W = 180;
const MINIMAP_H = 120;
const LINK_MODES = ["off", "attributes", "all"];
const LINK_LABELS = { off: "Links: Off", attributes: "Links: Attributes", all: "Links: All" };

const TOOL_LIST = [
  ["select", "Select", "V"],
  ["hand", "Hand", "H"],
  ["card", "Card", "N"],
  ["text", "Text", "T"],
  ["section", "Section", "G"],
  ["board", "Board", "W"],
  ["connect", "Connect", "C"],
];

const MAX_CRUMBS = 4;

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
  const button = (parent, cls, label, title, onClick) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (title) b.title = title;
    listen(b, "click", (event) => { event.preventDefault(); event.stopPropagation(); onClick?.(event); });
    listen(b, "pointerdown", (event) => event.stopPropagation());
    listen(b, "dblclick", (event) => event.stopPropagation());
    return b;
  };
  const swatches = (parent, onPick) => {
    const wrap = el("div", "pxd-swatches", parent);
    const none = button(wrap, "pxd-swatch pxd-swatch--none", "", "No color", () => onPick(null));
    none.dataset.color = "";
    for (const c of PALETTE) {
      const s = button(wrap, `pxd-swatch pxd-c-${c}`, "", c, () => onPick(c));
      s.dataset.color = c;
      s.setAttribute("data-color", c);
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
  // One delegated listener; re-rendering the row never adds listeners.
  listen(crumbsEl, "click", (event) => {
    const hit = event.target?.closest?.(".pxd-crumb[data-index]");
    const raw = hit?.dataset?.index ?? hit?.getAttribute?.("data-index");
    if (raw == null) return;
    const index = Number(raw);
    if (!Number.isFinite(index)) return;
    event.preventDefault?.();
    event.stopPropagation();
    on.crumb?.(index);
  });
  const renderCrumbs = (list) => {
    crumbsEl.replaceChildren();
    const items = Array.isArray(list) ? list : [];
    crumbsEl.style.display = items.length < 2 ? "none" : "";
    if (items.length < 2) return;
    const last = items.length - 1;
    let shown = items.map((c, i) => i);
    let hidden = [];
    if (items.length > MAX_CRUMBS) {
      shown = [0, last - 2, last - 1, last];
      hidden = items.slice(1, last - 2);
    }
    shown.forEach((i, n) => {
      if (n === 1 && hidden.length) {
        const more = el("span", "pxd-crumb__more", crumbsEl, "…");
        more.title = hidden.map((c) => c.title).join(" › ");
        el("span", "pxd-crumb__sep", crumbsEl, "›");
      }
      const c = items[i];
      if (i === last) {
        const cur = el("span", "pxd-crumb pxd-crumb--current", crumbsEl, c.title);
        cur.title = c.title;
        return;
      }
      const b = el("button", "pxd-btn pxd-crumb", crumbsEl, c.title);
      b.type = "button";
      b.title = c.title;
      b.dataset.index = String(i);
      b.setAttribute("data-index", String(i));
      el("span", "pxd-crumb__sep", crumbsEl, "›");
    });
  };
  renderCrumbs(crumbs);
  const toolGroup = el("div", "pxd-toolbar__group", toolbar);
  const toolButtons = new Map();
  for (const [id, label, key] of TOOL_LIST) {
    const b = button(toolGroup, "pxd-tool", label, `${label} (${key}). Double-click to lock`, () => on.setTool?.(id, false));
    b.dataset.tool = id;
    b.setAttribute("data-tool", id);
    listen(b, "dblclick", (event) => { event.preventDefault(); event.stopPropagation(); on.setTool?.(id, true); });
    toolButtons.set(id, b);
  }
  const group2 = el("div", "pxd-toolbar__group", toolbar);
  const addBtn = button(group2, "pxd-toolbar__add", "Add", "Add cards from the graph", () => on.togglePanel?.());
  const linksBtn = button(group2, "pxd-toolbar__links", LINK_LABELS.all, "Graph links (L)", () => on.cycleLinks?.());
  const group3 = el("div", "pxd-toolbar__group", toolbar);
  button(group3, "pxd-toolbar__zoom-out", "−", "Zoom out (Cmd −)", () => on.zoomOut?.());
  const zoomLabel = button(group3, "pxd-toolbar__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  button(group3, "pxd-toolbar__zoom-in", "+", "Zoom in (Cmd =)", () => on.zoomIn?.());
  button(group3, "pxd-toolbar__fit", "Fit", "Fit all (Shift 1)", () => on.fit?.());
  const minimapBtn = button(group3, "pxd-toolbar__minimap", "Minimap", "Toggle minimap", () => on.toggleMinimap?.());
  const fullBtn = button(group3, "pxd-toolbar__fullscreen", "Fullscreen", "Fullscreen this board", () => on.toggleFullscreen?.());
  const badge = el("span", "pxd-badge", toolbar, version ? `v${version}` : "");
  if (setting("show-version-badge") === false) badge.style.display = "none";
  const sync = el("span", "pxd-sync", toolbar);
  sync.title = "Synced";

  const toolbarApi = {
    el: toolbar,
    setCrumbs: renderCrumbs,
    setTool(tool, locked) {
      for (const [id, b] of toolButtons) {
        b.classList.toggle("pxd-tool--active", id === tool);
        b.classList.toggle("pxd-tool--locked", id === tool && Boolean(locked));
      }
    },
    setZoom(z) { zoomLabel.textContent = `${Math.round((z || 1) * 100)}%`; },
    setLinkMode(mode) { linksBtn.textContent = LINK_LABELS[mode] || LINK_LABELS.all; },
    setSync(pending) {
      sync.classList.toggle("pxd-sync--pending", Boolean(pending));
      sync.title = pending ? "Saving…" : "Synced";
    },
    setFullscreen(on) { fullBtn.textContent = on ? "Exit fullscreen" : "Fullscreen"; fullBtn.classList.toggle("pxd-btn--active", Boolean(on)); },
    setPanel(open) { addBtn.classList.toggle("pxd-btn--active", Boolean(open)); },
    setMinimap(open) { minimapBtn.classList.toggle("pxd-btn--active", Boolean(open)); },
  };

  // ---------------------------------------------------------------- context bar
  const ctx = el("div", "pxd-ctx pxd-chrome", root);
  ctx.style.display = "none";
  stopAll(ctx);
  let ctxAnchor = null; // () => { rect, kind }

  const buildCtx = (kind, model) => {
    ctx.replaceChildren();
    ctx.dataset.kind = kind;
    ctx.setAttribute("data-kind", kind);
    const row = el("div", "pxd-ctx__row", ctx);
    const btn = (cls, label, title, fn) => button(row, `pxd-ctx__btn ${cls}`, label, title, fn);
    const seg = (cls, options, current, fn) => {
      const wrap = el("div", `pxd-seg ${cls}`, row);
      for (const [value, label, title] of options) {
        const b = button(wrap, `pxd-seg__btn${value === current ? " pxd-seg__btn--on" : ""}`, label, title || label, () => fn(value));
        b.dataset.value = String(value);
      }
      return wrap;
    };
    switch (kind) {
      case "card":
      case "cards": {
        swatches(row, (c) => on.setColor?.(c));
        if (kind === "card") {
          btn("pxd-ctx__edit", "Edit", "Edit (Enter)", () => on.edit?.());
          btn("pxd-ctx__sidebar", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
          btn("pxd-ctx__collapse", model?.collapsed ? "Expand" : "Collapse", "Collapse to title", () => on.collapse?.());
          btn("pxd-ctx__related", "Related…", "Show related pages and blocks", () => on.related?.());
        } else {
          seg("pxd-ctx__align", [["left", "L", "Align left"], ["center", "C", "Align centers"], ["right", "R", "Align right"], ["top", "T", "Align top"], ["middle", "M", "Align middles"], ["bottom", "B", "Align bottom"]], null, (v) => on.align?.(v));
          seg("pxd-ctx__distribute", [["h", "H", "Distribute horizontally"], ["v", "V", "Distribute vertically"]], null, (v) => on.distribute?.(v));
          btn("pxd-ctx__wrap", "Wrap in section", "Wrap in a new section (Cmd G)", () => on.wrap?.());
          btn("pxd-ctx__wrap-board", "Move into new board", "Move the selection into a new nested board", () => on.wrapBoard?.());
        }
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      }
      case "board":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__open-board", "Open", "Open this board (Enter)", () => on.openBoard?.());
        if (model?.enhanced) btn("pxd-ctx__rename-board", "Rename board", "Rename the board", () => on.renameBoard?.());
        btn("pxd-ctx__sidebar", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "section":
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__rename", "Rename", "Rename (Enter)", () => on.rename?.());
        btn("pxd-ctx__contents", "Select contents", "Select the section's members", () => on.selectContents?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete frame", "Delete the frame, keep the cards (Del). Shift+Del deletes contents too", () => on.delete?.());
        break;
      case "text":
        swatches(row, (c) => on.setColor?.(c));
        seg("pxd-ctx__size", FONT_SIZES.map((s, i) => [s, ["S", "M", "L", "XL"][i], `${s}px`]), model?.fontSize || 24, (v) => on.setFontSize?.(v));
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "edge":
        seg("pxd-ctx__dir", [["one", "→", "One way"], ["two", "↔", "Two way"], ["none", "—", "No arrow"]], model?.dir, (v) => on.edgeDir?.(v));
        btn("pxd-ctx__flip", "Flip", "Swap endpoints", () => on.flip?.());
        seg("pxd-ctx__route", [["curve", "Curve"], ["straight", "Straight"], ["elbow", "Elbow"]], model?.route, (v) => on.route?.(v));
        seg("pxd-ctx__dash", [["solid", "Solid"], ["dashed", "Dashed"]], model?.dash, (v) => on.dash?.(v));
        seg("pxd-ctx__weight", [[1, "1"], [2, "2"], [3, "3"]], model?.weight, (v) => on.weight?.(v));
        swatches(row, (c) => on.setColor?.(c));
        btn("pxd-ctx__label", "Label", "Edit the label", () => on.label?.());
        btn("pxd-ctx__notes", "Notes", "Open the connection block in the sidebar", () => on.notes?.());
        btn("pxd-ctx__write", "Write to graph", "Create an attribute on the source", () => on.writeToGraph?.());
        btn("pxd-ctx__delete pxd-btn--danger", "Delete", "Delete (Del)", () => on.delete?.());
        break;
      case "link": {
        const list = el("div", "pxd-ctx__sources", row);
        for (const s of model?.sources || []) {
          const b = button(list, "pxd-ctx__source", (s.string || s.uid || "").slice(0, 60), "Open in the sidebar", () => on.openSource?.(s.uid));
          b.dataset.uid = s.uid;
        }
        btn("pxd-ctx__pin", "Pin as connection", "Create a board connection from this link", () => on.pinLink?.());
        break;
      }
      default:
        break;
    }
  };

  const positionCtx = () => {
    if (ctx.style.display === "none" || !ctxAnchor) return;
    const a = ctxAnchor();
    if (!a) { ctx.style.display = "none"; return; }
    const rootRect = root.getBoundingClientRect();
    const W = rootRect.width || 0;
    const H = rootRect.height || 0;
    const barW = ctx.offsetWidth || 320;
    const barH = ctx.offsetHeight || 36;
    const gap = a.kind === "edge" ? CTX_EDGE_CLEARANCE : CTX_GAP;
    let top = a.rect.y - gap - barH;
    if (top < CTX_MARGIN) top = a.rect.y + a.rect.h + gap; // flip below near the top edge
    if (top + barH > H - CTX_MARGIN && a.rect.y - gap - barH >= 0) top = a.rect.y - gap - barH;
    let left = a.rect.x + a.rect.w / 2 - barW / 2;
    left = Math.max(CTX_MARGIN, Math.min(left, W - barW - CTX_MARGIN));
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
    hide() { ctx.style.display = "none"; ctxAnchor = null; ctx.replaceChildren(); },
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
    setVisible(on) { minimap.style.display = on ? "" : "none"; toolbarApi.setMinimap(on); if (on) { mmDirty = true; if (!mmFrame) mmFrame = timers.frame(draw); } },
    isVisible: () => minimap.style.display !== "none",
    draw,
  };

  const dispose = () => {
    toastTimer?.();
    mmFrame?.();
    listeners.splice(0).forEach((off) => off());
    for (const node of [toolbar, ctx, toast, search, minimap]) node.remove();
  };

  return { toolbar: toolbarApi, ctx: ctxApi, toast: toastApi, search: searchApi, minimap: minimapApi, badge, sync, dispose };
}

export { LINK_MODES, CTX_GAP, CTX_EDGE_CLEARANCE };
