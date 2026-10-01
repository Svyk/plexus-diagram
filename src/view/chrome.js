// Screen-space chrome: toolbar (spec 3.5), context bar (spec 3.4), toast, board search,
// minimap, version badge, sync dot. Everything lives inside .pxd-root; no portals.

import { PALETTE, FONT_SIZES, BOARD_PATTERNS } from "../model/schema.js";
import { buildColorPicker } from "./color-picker.js";

const CTX_GAP = 12;
const CTX_EDGE_CLEARANCE = 28;
const CTX_MARGIN = 8;
const CTX_MIN_WIDTH = 180;
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
const POPOVER_GAP = 6;
const POPOVER_MARGIN = 8;
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
  const button = (parent, cls, label, title, onClick) => {
    const b = el("button", `pxd-btn ${cls}`, parent, label);
    b.type = "button";
    if (title) b.title = title;
    listen(b, "click", (event) => { event.preventDefault(); event.stopPropagation(); onClick?.(event); });
    listen(b, "pointerdown", (event) => event.stopPropagation());
    listen(b, "dblclick", (event) => event.stopPropagation());
    return b;
  };
  const swatches = (parent, onPick, { key = "color", paper = false } = {}) => {
    const wrap = el("div", "pxd-swatches", parent);
    const none = button(wrap, "pxd-swatch pxd-swatch--none", "", key === "tone" ? "Default" : "No color", () => onPick(null));
    none.dataset[key] = "";
    if (key !== "color") none.setAttribute(`data-${key}`, "");
    if (paper) {
      const p = button(wrap, "pxd-swatch pxd-swatch--paper", "", "Paper", () => onPick("paper"));
      p.dataset[key] = "paper";
      p.setAttribute(`data-${key}`, "paper");
    }
    for (const c of PALETTE) {
      const s = button(wrap, `pxd-swatch pxd-c-${c}`, "", c, () => onPick(c));
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
  button(group2, "pxd-toolbar__info", "Info", "Card info (I)", () => on.openInfo?.());
  const linksBtn = button(group2, "pxd-toolbar__links", LINK_LABELS.all, "Graph links (L)", () => on.cycleLinks?.());
  const groupView = el("div", "pxd-toolbar__group", toolbar);
  const bgBtn = button(groupView, "pxd-toolbar__bg", "Background", "Background pattern and tone", () => (popover.isOpen() ? popover.close() : popover.open()));
  const focusBtn = button(groupView, "pxd-toolbar__focus", "Focus", "Focus mode: fade everything but the selection", () => on.toggleFocus?.());
  button(groupView, "pxd-toolbar__present", "Present", "Present this board", () => on.present?.());
  const moreBtn = button(groupView, "pxd-toolbar__more", "More", "More board actions", () => {
    const r = moreBtn.getBoundingClientRect();
    on.openMore?.({ x: r.left, y: r.bottom, w: r.width, h: r.height });
  });
  const group3 = el("div", "pxd-toolbar__group pxd-toolbar__zoom", toolbar);
  button(group3, "pxd-toolbar__zoom-out", "−", "Zoom out (Cmd −)", () => on.zoomOut?.());
  const zoomLabel = button(group3, "pxd-toolbar__zoom", "100%", "Zoom to 100% (Shift 0)", () => on.zoomReset?.());
  button(group3, "pxd-toolbar__zoom-in", "+", "Zoom in (Cmd =)", () => on.zoomIn?.());
  button(group3, "pxd-toolbar__fit", "Fit", "Fit all (Shift 1)", () => on.fit?.());
  const minimapBtn = button(group3, "pxd-toolbar__minimap", "Minimap", "Toggle minimap", () => on.toggleMinimap?.());
  const editBtn = button(group3, "pxd-toolbar__edit", "Edit Block", "Edit the diagram block", () => on.editBlock?.());
  const fullBtn = button(group3, "pxd-toolbar__fullscreen", "Fullscreen", "Fullscreen this board", () => on.toggleFullscreen?.());
  const badge = el("span", "pxd-badge", toolbar, version ? `v${version}` : "");
  const sync = el("span", "pxd-sync", toolbar);
  sync.title = "Synced";

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
  const railBadge = el("span", "pxd-badge pxd-rail__badge", railExtra, version ? `v${version}` : "");
  const applyControls = () => {
    const rail = setting("controls-position") !== "bar";
    root.classList.toggle("pxd-root--rail", rail);
    railEl.style.display = rail ? "" : "none";
    group3.style.display = rail ? "none" : "";
    const showBadge = setting("show-version-badge") !== false;
    badge.style.display = !rail && showBadge ? "" : "none";
    railBadge.style.display = rail && showBadge ? "" : "none";
  };
  applyControls();

  const toolbarApi = {
    el: toolbar,
    setCrumbs: renderCrumbs,
    setTool(tool, locked) {
      for (const [id, b] of toolButtons) {
        b.classList.toggle("pxd-tool--active", id === tool);
        b.classList.toggle("pxd-tool--locked", id === tool && Boolean(locked));
      }
    },
    setZoom(z) {
      const label = `${Math.round((z || 1) * 100)}%`;
      zoomLabel.textContent = label;
      railZoom.textContent = label;
    },
    setLinkMode(mode) { linksBtn.textContent = LINK_LABELS[mode] || LINK_LABELS.all; },
    setSync(pending) {
      sync.classList.toggle("pxd-sync--pending", Boolean(pending));
      sync.title = pending ? "Saving…" : "Synced";
    },
    setFullscreen(on) {
      editBtn.style.display = on ? "none" : "";
      railEdit.style.display = on ? "none" : "";
      fullBtn.textContent = on ? "Exit fullscreen" : "Fullscreen";
      fullBtn.classList.toggle("pxd-btn--active", Boolean(on));
      const title = on ? "Minimize" : "Maximize";
      railFull.title = title;
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
      const rootRect = root.getBoundingClientRect();
      const b = bgBtn.getBoundingClientRect();
      const w = popEl.offsetWidth || 240;
      const h = popEl.offsetHeight || 200;
      const left = Math.max(POPOVER_MARGIN, Math.min(b.left - rootRect.left, (rootRect.width || 0) - w - POPOVER_MARGIN));
      let top = b.bottom - rootRect.top + POPOVER_GAP;
      if (rootRect.height && top + h > rootRect.height - POPOVER_MARGIN) top = Math.max(POPOVER_MARGIN, rootRect.height - h - POPOVER_MARGIN);
      popEl.style.left = `${Math.round(left)}px`;
      popEl.style.top = `${Math.round(top)}px`;
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

  // ---------------------------------------------------------------- back to content
  const backEl = button(root, "pxd-backtocontent pxd-chrome", "Back to content", "Fit the view back to your cards", () => on.backToContent?.());
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
    // Optional 1.2 buttons: each is skipped when its callback is missing.
    const opt = (name, cls, label, title, fn) => { if (typeof on[name] === "function") btn(cls, label, title, fn); };
    const optSeg = (name, cls, options, fn) => { if (typeof on[name] === "function") seg(cls, options, null, fn); };
    const pinButton = (pinned) => opt("pin", "pxd-ctx__pin-toggle", pinned ? "Unpin" : "Pin", pinned ? "Unpin: allow moving and resizing again" : "Pin: lock position and size", () => on.pin(!pinned));
    const TIDY = [["grid", "Grid", "Tidy into a grid"], ["row", "Row", "Tidy into a row"], ["column", "Column", "Tidy into a column"]];
    const iconBtn = (cls, icon, label, title, fn) => {
      const b = btn(cls, "", title, fn);
      b.setAttribute("aria-label", label);
      const i = el("span", `bp3-icon bp3-icon-${icon}`, b);
      i.setAttribute("aria-hidden", "true");
      return b;
    };
    switch (kind) {
      case "card":
      case "cards": {
        if (kind === "card") {
          const picker = el("div", "pxd-ctx__picker", ctx);
          picker.style.display = "none";
          let pickerBuilt = false;
          iconBtn("pxd-ctx__color", "tint", "Color", "Color", () => {
            if (!pickerBuilt) {
              picker.append(buildColorPicker(doc, (c) => { on.setColor?.(c); picker.style.display = "none"; }, listen));
              pickerBuilt = true;
            }
            picker.style.display = picker.style.display === "none" ? "" : "none";
          });
          const closed = model?.open === false;
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
          btn("pxd-ctx__edit", "Edit", "Edit (Enter)", () => on.edit?.());
          btn("pxd-ctx__sidebar", "Open in sidebar", "Open in the right sidebar", () => on.openSidebar?.());
          btn("pxd-ctx__collapse", model?.collapsed ? "Expand" : "Collapse", "Collapse to title", () => on.collapse?.());
          btn("pxd-ctx__related", "Related…", "Show related pages and blocks", () => on.related?.());
          pinButton(Boolean(model?.pinned));
          opt("fitHeight", "pxd-ctx__fit-height", "Fit height", "Grow or shrink the card to its text", () => on.fitHeight());
          opt("copyRef", "pxd-ctx__copy-ref", "Copy ref", "Copy a block or page reference", () => on.copyRef());
          opt("duplicate", "pxd-ctx__duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
          opt("sendTo", "pxd-ctx__send-to", "Send to board…", "Move into another board", () => on.sendTo());
          if (NOTE_KINDS.includes(model?.kind)) opt("expandOutline", "pxd-ctx__mindmap", "Mind map", "Expand the children as a mind map", () => on.expandOutline());
        } else {
          seg("pxd-ctx__align", [["left", "L", "Align left"], ["center", "C", "Align centers"], ["right", "R", "Align right"], ["top", "T", "Align top"], ["middle", "M", "Align middles"], ["bottom", "B", "Align bottom"]], null, (v) => on.align?.(v));
          seg("pxd-ctx__distribute", [["h", "H", "Distribute horizontally"], ["v", "V", "Distribute vertically"]], null, (v) => on.distribute?.(v));
          btn("pxd-ctx__wrap", "Wrap in section", "Wrap in a new section (Cmd G)", () => on.wrap?.());
          btn("pxd-ctx__wrap-board", "Move into new board", "Move the selection into a new nested board", () => on.wrapBoard?.());
          optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
          optSeg("sameSize", "pxd-ctx__same-size", [["width", "W", "Same width"], ["height", "H", "Same height"], ["both", "WH", "Same width and height"]], (v) => on.sameSize(v));
          opt("fold", "pxd-ctx__fold", model?.anyCollapsed ? "Unfold" : "Fold", model?.anyCollapsed ? "Expand the collapsed cards" : "Collapse the cards to titles", () => on.fold(!model?.anyCollapsed));
          pinButton(Boolean(model?.allPinned));
          opt("duplicate", "pxd-ctx__duplicate", "Duplicate", "Duplicate (Cmd D)", () => on.duplicate());
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
        opt("fitSection", "pxd-ctx__fit-section", "Fit to contents", "Resize the section around its cards", () => on.fitSection());
        opt("toggleFit", "pxd-ctx__auto-fit", model?.autofit ? "Auto-fit: on" : "Auto-fit: off", "Keep the section sized to its cards", () => on.toggleFit());
        optSeg("tidy", "pxd-ctx__tidy", TIDY, (v) => on.tidy(v));
        opt("foldAll", "pxd-ctx__fold-all", "Fold all", "Collapse every card in the section", () => on.foldAll(true));
        pinButton(Boolean(model?.pinned));
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
        seg("pxd-ctx__dash", [["solid", "Solid"], ["dashed", "Dashed"], ["animated", "Animated"]], model?.dash, (v) => on.dash?.(v));
        seg("pxd-ctx__weight", [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], model?.weight, (v) => on.weight?.(v));
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
    bgOffs.splice(0).forEach((off) => off());
    listeners.splice(0).forEach((off) => off());
    for (const node of [toolbar, railEl, popEl, backEl, ctx, toast, search, minimap]) node.remove();
  };

  return { toolbar: toolbarApi, ctx: ctxApi, toast: toastApi, search: searchApi, minimap: minimapApi, popover, backToContent, badge, sync, dispose };
}

export { LINK_MODES, CTX_GAP, CTX_EDGE_CLEARANCE };
