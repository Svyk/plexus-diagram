// Board view: DOM root, layers, render scheduler, culling, LOD (spec 3.2). One rAF loop that
// runs only when dirty; pan/zoom write one transform on .pxd-world plus the grid background.
// Entry used by feature.js: mountBoardView(...) → { root, setFullscreen, fit, dispose, stats, setSettings,
// state, exportSvg, copyOutline }.
//
// 1.2 wiring: three-tier LOD flipped by class during a gesture, board backgrounds (pattern + tone), live
// section auto-fit preview, context menu, clipboard, focus, presentation, card badges, back-to-content.

import { BOARD_PATTERNS, BOARD_TONES, DEFAULT_BOARD_CARD, DEFAULT_SIZES, UNTITLED_BOARD, classifyString, semanticRef, plainText } from "../model/schema.js";
import { boundsOf, containerAt, descendantsOf, edgesTouching, outlineOrder, sectionFitPlan, worldRects } from "../model/board.js";
import {
  alignRects,
  center,
  distributeRects,
  fitViewport,
  gridBackground,
  lodFonts,
  lodTier,
  rectsIntersect,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
} from "../model/geometry.js";
import { PLEXUS_MIME, copyPayload, parsePastedText } from "../model/clipboard.js";
import { boardToMarkdown, boardToSvg } from "../model/export.js";
import { createInteractions } from "./interactions.js";
import { createItemRenderer, isTextEntryTarget } from "./cards.js";
import { createEdgeLayer } from "./edges.js";
import { createChrome, LINK_MODES } from "./chrome.js";
import { createPanel, parseDropPayload } from "./panel.js";
import { createMenu } from "./menu.js";
import { buildMenu } from "./menu-model.js";
import { createQuickLook } from "./quicklook.js";
import { createPresenter } from "./present.js";
import { createClipboardIO, filesFromDataTransfer, writeClipboard } from "./clipboard-io.js";
import { applyFullscreenChrome, watchRouteExit } from "./fullscreen.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_HEIGHT = 560;

// A card made by a gesture is junk only when the block, the model and the open editor are all blank.
// Roam debounces the block string, so the editor text is what the user actually typed.
export function freshCardIsBlank({ blockString, itemString, contentCount = 0, editorText = "" } = {}) {
  if (contentCount > 0) return false;
  return ![blockString, itemString, editorText].some((s) => String(s ?? "").trim());
}

function editingPlainText(root) {
  const editor = root.querySelector?.(".pxd-item--editing .pxd-item__editor");
  if (!editor) return "";
  const areas = typeof editor.querySelectorAll === "function" ? [...editor.querySelectorAll("textarea")] : [];
  if (areas.length) return areas.map((t) => t.value || "").join("\n");
  return typeof editor.textContent === "string" ? editor.textContent : "";
}
const MIN_HEIGHT = 240;
const RESUME_MS = 120;
const VP_PERSIST_MS = 500;
const SECTION_TITLE_ALLOWANCE = 32; // px: section title pill (20 + padding) plus its 4px lift, fits above the frame
const CULL_MARGIN = 0.5;
const BADGE_TTL_MS = 120000;
const BADGE_CHUNK = 12;
const NATIVE_MENU_TARGETS = ".rm-page-ref, .rm-block-ref, [data-link-uid], a[href], img";
const BADGE_MAX = 60;
const NOTE_KINDS = ["note", "block", "page"];

function createTimers() {
  const active = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { active.delete(entry); fn(); }, ms);
    const entry = () => { clearTimeout(id); active.delete(entry); };
    active.add(entry);
    return entry;
  };
  const frame = (fn) => {
    const raf = globalThis.requestAnimationFrame;
    let entry;
    if (typeof raf === "function") {
      const id = raf((t) => { active.delete(entry); fn(t); });
      entry = () => { globalThis.cancelAnimationFrame?.(id); active.delete(entry); };
    } else {
      const id = setTimeout(() => { active.delete(entry); fn(Date.now()); }, 16);
      entry = () => { clearTimeout(id); active.delete(entry); };
    }
    active.add(entry);
    return entry;
  };
  const idle = (fn) => {
    const ric = globalThis.requestIdleCallback;
    let entry;
    if (typeof ric === "function") {
      const id = ric((d) => { active.delete(entry); fn(d); });
      entry = () => { globalThis.cancelIdleCallback?.(id); active.delete(entry); };
    } else {
      const id = setTimeout(() => { active.delete(entry); fn({ timeRemaining: () => 8, didTimeout: true }); }, 0);
      entry = () => { clearTimeout(id); active.delete(entry); };
    }
    active.add(entry);
    return entry;
  };
  return { later, frame, idle, count: () => active.size, cancelAll: () => { for (const c of [...active]) c(); active.clear(); } };
}

export function isDarkHost(root, doc = globalThis.document) {
  const has = (el, name) => Boolean(el?.classList?.contains?.(name));
  let node = root;
  while (node) {
    if (has(node, "bp3-dark") || has(node, "rm-dark-theme") || has(node, "bt-theme-dark")) return true;
    if (has(node, "roam-body") && has(node, "dark")) return true;
    node = node.parentElement;
  }
  const body = doc?.body;
  const html = doc?.documentElement;
  if (has(html, "bp3-dark") || has(body, "bt-theme-dark") || has(body, "bp3-dark") || has(body, "rm-dark-theme")) return true;
  if (has(body, "roam-body") && has(body, "dark")) return true;
  return false;
}

const rgbOf = (value) => {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const a = m[4] == null ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
};

// True only when the host is measurably light: no dark marker, and the first opaque background up the chain
// (Roam paints only <body>; the app wrappers are transparent) has high luminance. The OS color-scheme hint must not
// darken a board that sits on a light host, so a confirmed-light host opts out of the prefers-color-scheme rules.
export function isLightHost(root, doc = globalThis.document, win = globalThis.window) {
  if (isDarkHost(root, doc)) return false;
  if (typeof win?.getComputedStyle !== "function") return false;
  for (let node = root; node; node = node.parentElement) {
    let color;
    try { color = rgbOf(win.getComputedStyle(node)?.backgroundColor); } catch { return false; }
    if (!color || color.a < 0.5) continue;
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255 > 0.6;
  }
  return false;
}

function graphName(win = globalThis.window) {
  const m = /#\/app\/([^/]+)/.exec(String(win?.location?.hash || ""));
  return m ? decodeURIComponent(m[1]) : "graph";
}

function createLocalViewportStore({ storage, graph, timers }) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const pending = new Map();
  return {
    get(uid) {
      try {
        const raw = storage?.getItem?.(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch { return null; }
    },
    set(uid, vp) {
      if (!storage?.setItem) return;
      const write = () => { pending.delete(uid); try { storage.setItem(key(uid), JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom })); } catch { /* quota */ } };
      if (pending.has(uid)) { pending.get(uid).vp = vp; return; }
      const entry = { vp, cancel: timers.later(() => write(), VP_PERSIST_MS) };
      pending.set(uid, entry);
    },
    flush() { for (const [uid, e] of pending) { e.cancel(); try { storage?.setItem?.(key(uid), JSON.stringify(e.vp)); } catch { /* quota */ } } pending.clear(); },
  };
}

export function mountBoardView({
  host,
  session,
  mountEl,
  nativeEl = null,
  settings,
  onRequestFullscreen,
  fullscreen = false,
  version = "",
  crumbs = null,
  onOpenBoard = null,
  onCrumb = null,
  routeUid = session.uid,
  autofocus = false,
  onSetDefaults = null,
} = {}) {
  const doc = globalThis.document;
  const win = globalThis.window;
  // The settings object can be swapped (setSettings); chrome and the controller read through a stable proxy.
  let settingsRef = settings;
  const readSetting = (k) => (typeof settingsRef?.get === "function" ? settingsRef.get(k) : settingsRef?.[k]);
  const settingsProxy = { get: readSetting };
  const setting = (k, d) => {
    const v = readSetting(k);
    return v === undefined || v === null ? d : v;
  };
  const flag = (k, d) => {
    const v = setting(k, d);
    return v === false || v === "false" ? false : v === true || v === "true" ? true : Boolean(v);
  };
  const timers = createTimers();
  const listeners = [];
  const observers = [];
  const subs = [];
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    const off = () => el.removeEventListener(type, fn, opts);
    listeners.push(off);
    return off;
  };
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };
  const svg = (cls, parent) => {
    const node = doc.createElementNS(SVG_NS, "svg");
    node.setAttribute("class", cls);
    if (node.classList && !node.classList.contains(cls)) node.className = cls;
    parent?.append(node);
    return node;
  };

  const boardUid = session.uid;
  const graph = host?.graph || graphName(win);
  const storage = globalThis.localStorage;
  const vpStore = host?.viewports || host?.viewportStore || createLocalViewportStore({ storage, graph, timers });
  // The inline height belongs to the mount (the route board), not to whichever nested board it is showing.
  const heightKey = `plexus-diagram:h:${graph}:${routeUid}`;

  // ------------------------------------------------------------ DOM
  const root = el("div", "pxd-root", mountEl);
  root.tabIndex = 0;
  root.setAttribute("tabindex", "0");
  root.dataset.tool = "select";
  root.setAttribute("data-tool", "select");
  root.dataset.board = boardUid;
  const viewport = el("div", "pxd-viewport", root);
  const grid = el("div", "pxd-grid", viewport);
  const world = el("div", "pxd-world", viewport);
  const sectionsLayer = el("div", "pxd-sections", world);
  const edgesSvg = svg("pxd-edges", world);
  const labelsLayer = el("div", "pxd-labels", world);
  const itemsLayer = el("div", "pxd-items", world);
  const overlaySvg = svg("pxd-overlay", world);
  const resizeGrip = el("div", "pxd-resize-grip pxd-chrome", root);
  resizeGrip.title = "Drag to resize the board";
  // The dark/light class follows the host: decided at mount, then again whenever the host flips (Roam's auto theme
  // follows the OS, and the theme extensions toggle their marker classes on <html>/<body>).
  const applyTheme = () => {
    const dark = isDarkHost(mountEl, doc);
    root.classList.toggle("pxd-root--dark", dark);
    root.classList.toggle("pxd-root--light", !dark && isLightHost(mountEl, doc, globalThis.window));
  };
  applyTheme();

  // ------------------------------------------------------------ state
  let vp = vpStore.get(boardUid);
  let size = { width: 0, height: 0 };
  let rootRect = { left: 0, top: 0, width: 0, height: 0 };
  let disposed = false;
  let released = false;
  let gesturing = false;
  let isFullscreen = false;
  let pointerInside = Boolean(mountEl?.matches?.(":hover"));
  let suppressClick = false;
  let swallowMouseUp = false;
  let linkMode = setting("graph-links", "all");
  let selection = { items: [], edge: null, link: null };
  let liveRects = null; // Map override during move/resize preview
  let grown = new Set(); // section uids whose shells show a live auto-fit preview
  let tier = "detail"; // 'detail' | 'map' | 'overview'
  let bgPattern; // effective board pattern / tone; undefined until applyBackground() runs
  let bgTone;
  let bgOverride = false;
  let focusOn = false;
  let focusKey = null;
  let presentSet = null;
  let sendPending = null; // uids waiting for a target board picked in the Boards tab
  let menuCtx = null;
  let lastPayload = null; // last copy payload, so a menu paste can restore the plexus items
  let lastPointer = null; // last pointer position in client coords, converted with a fresh measure() at paste time
  let backVisible = false;
  let badgeTimer = null;
  const badgeCache = new Map(); // key -> { at, stats }
  const badgePending = new Set(); // keys with a stats query queued or running
  let resumeTimer = null;
  let settleTimer = null;
  let searchMatches = [];
  let searchIndex = -1;
  let frameHandle = null;
  let fsDispose = () => {};
  let routeOff = () => {};
  const dirty = { viewport: false, items: new Set(), edges: new Set(), structural: false, all: true, selection: false, links: false, ctx: false, minimap: false };

  const board = () => session.board;
  const rects = () => session.rects || worldRects(board());
  const effectiveRects = () => {
    if (!liveRects) return rects();
    const merged = new Map(rects());
    for (const [k, v] of liveRects) merged.set(k, v);
    return merged;
  };

  const measure = () => {
    const r = root.getBoundingClientRect();
    rootRect = { left: r.left || 0, top: r.top || 0, width: r.width || 0, height: r.height || 0 };
    size = { width: rootRect.width, height: rootRect.height };
  };

  // ------------------------------------------------------------ layers
  const itemsR = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers,
    onEditChange: (uid) => {
      root.classList.toggle("pxd-root--editing", Boolean(uid));
      if (!uid && grown.size) { liveRects = null; resetGrown(); } // the edit ended: the commit (growToFit) takes over
    },
    onEditResize: (uid, h) => {
      const r = board() && rects().get(uid);
      if (disposed || !r) return;
      // Preview only: the card's live height grows the section around it while typing; nothing is written.
      liveRects = new Map();
      if (h > r.h) liveRects.set(uid, { ...r, h });
      previewFit([uid]);
    },
    onOpenBoard: (uid) => { void openBoard(uid); },
    onRenameBoard: (uid, title) => session.renameBoard?.(uid, title),
    onBadgeClick: (uid) => { ctl.select([uid]); panel.open("related"); },
  });
  const edgesR = createEdgeLayer({
    doc,
    svg: edgesSvg,
    labelsLayer,
    overlaySvg,
    onLabelCommit: (uid, label) => session.updateEdge?.(uid, { label }),
  });

  const schedule = () => {
    if (disposed || frameHandle) return;
    frameHandle = timers.frame(() => { frameHandle = null; renderFrame(); });
  };
  const markViewport = () => { dirty.viewport = true; schedule(); };
  const markAll = () => { dirty.all = true; dirty.structural = true; schedule(); };

  // ------------------------------------------------------------ viewport
  const setViewport = (next) => {
    if (!next) return;
    vp = { x: next.x, y: next.y, zoom: next.zoom };
    markViewport();
    // Buttons, Fit, search and edit-zoom change the viewport outside a gesture: re-evaluate LOD + content.
    if (!gesturing) settle();
  };
  // Screen strips a fit must keep content out of: the toolbar, an open side panel, and the title pill that floats
  // above a section sitting on the top edge of the fitted bounds.
  const fitInsets = (bounds) => {
    const rr = root.getBoundingClientRect?.() || rootRect;
    const tb = chrome.toolbar.el?.getBoundingClientRect?.();
    const pel = panel.el?.style?.display !== "none" ? panel.el?.getBoundingClientRect?.() : null;
    const b = board();
    const r = b ? rects() : null;
    const titled = Boolean(bounds && b && [...b.items.values()].some((it) => it.type === "section" && r.get(it.uid) && r.get(it.uid).y <= bounds.y + 0.5));
    return {
      top: (tb?.height ? Math.max(0, tb.bottom - (rr.top || 0)) : 0) + (titled ? SECTION_TITLE_ALLOWANCE : 0),
      right: pel?.width ? Math.max(0, Math.min(size.width, (rr.left || 0) + size.width - pel.left)) : 0,
    };
  };
  const fitTo = (bounds, opts = {}) => {
    if (!size.width || !size.height) measure();
    setViewport(fitViewport(bounds, size, { padding: 64, maxZoom: opts.maxZoom ?? 1.5, insets: fitInsets(bounds) }));
  };
  const fitAll = () => fitTo(boundsOf([...rects().values()]));
  const fitSelection = (uids) => {
    const r = rects();
    const b = boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
    if (b) fitTo(b, { maxZoom: 1 });
  };
  const centerOn = (worldPoint) => {
    setViewport({ x: size.width / 2 - worldPoint.x * vp.zoom, y: size.height / 2 - worldPoint.y * vp.zoom, zoom: vp.zoom });
  };

  // ------------------------------------------------------------ LOD
  const mapThreshold = () => {
    const n = Number(setting("map-zoom", "0.45"));
    return Number.isFinite(n) && n > 0 ? n : 0.45;
  };
  // Classes and font variables are written only when the tier changes (renderFrame) or a viewport settles.
  const paintTier = () => {
    root.classList.toggle("pxd-lod-map", tier !== "detail");
    root.classList.toggle("pxd-lod-overview", tier === "overview");
    const f = lodFonts(vp.zoom);
    root.style.setProperty("--pxd-map-font", `${f.map}px`);
    root.style.setProperty("--pxd-ui", String(f.ui));
    root.style.setProperty("--pxd-overview-font", `${f.section}px`);
    itemsR.setLod(tier, vp.zoom);
  };
  const applyLod = () => {
    tier = lodTier(vp.zoom, tier, { threshold: mapThreshold() });
    paintTier();
  };
  const scheduleContent = () => {
    if (disposed || gesturing || !board()) return;
    itemsR.scheduleContent({ visibleRect: visibleWorldRect(vp, size, CULL_MARGIN), zoom: vp.zoom, tier });
  };
  // "Back to content": shown when no item intersects the visible world rect.
  const updateBackToContent = () => {
    if (disposed) return;
    let show = false;
    if (size.width && size.height) {
      const r = rects();
      if (r.size) {
        const view = visibleWorldRect(vp, size, 0);
        show = true;
        for (const rect of r.values()) if (rectsIntersect(rect, view)) { show = false; break; }
      }
    }
    if (show === backVisible) return;
    backVisible = show;
    chrome.backToContent.setVisible(show);
  };

  // ------------------------------------------------------------ card badges (read-only)
  const badgeKeyOf = (item) => (item.target.kind === "page" ? `page:${item.target.title}` : `uid:${item.target.uid || item.uid}`);
  const badgeTargetOf = (item) => (item.target.kind === "page" ? { kind: "page", title: item.target.title } : { kind: "block", uid: item.target.uid || item.uid });
  const visibleBadgeItems = () => {
    const b = board();
    if (!b) return [];
    const view = visibleWorldRect(vp, size, 0);
    const r = rects();
    const out = [];
    for (const item of b.items.values()) {
      if (out.length >= BADGE_MAX) break;
      if (item.type !== "card" || item.kind === "board" || item.kind === "image") continue;
      const rect = r.get(item.uid);
      if (rect && rectsIntersect(rect, view)) out.push(item);
    }
    return out;
  };
  const applyBadges = () => {
    if (disposed) return;
    const map = new Map();
    for (const item of visibleBadgeItems()) {
      const hit = badgeCache.get(badgeKeyOf(item));
      if (hit) map.set(item.uid, hit.stats);
    }
    itemsR.setBadges(map);
  };
  const refreshBadges = () => {
    if (disposed || gesturing || !board()) return;
    itemsR.setShowBadges(flag("show-card-badges", true));
    if (!flag("show-card-badges", true) || tier !== "detail" || typeof host?.cardStats !== "function") return;
    const items = visibleBadgeItems();
    const now = Date.now();
    const misses = [];
    const seen = new Set();
    for (const item of items) {
      const key = badgeKeyOf(item);
      const hit = badgeCache.get(key);
      if ((hit && now - hit.at < BADGE_TTL_MS) || seen.has(key) || badgePending.has(key)) continue;
      seen.add(key);
      misses.push({ key, target: badgeTargetOf(item) });
    }
    if (!misses.length) { applyBadges(); return; }
    // The stats queries scan the graph on the main thread: run them in idle slots, a few cards at a time.
    for (const m of misses) badgePending.add(m.key);
    const runChunk = (list) => {
      if (disposed) return;
      const chunk = list.slice(0, BADGE_CHUNK);
      const rest = list.slice(BADGE_CHUNK);
      let res;
      try { res = host.cardStats(chunk.map((m) => m.target), { boardUid }); } catch { res = undefined; }
      const at = Date.now();
      for (const m of chunk) {
        badgePending.delete(m.key);
        if (res === undefined) continue;
        const stats = res instanceof Map ? res.get(m.key) : res?.[m.key];
        badgeCache.set(m.key, { at, stats: stats || { refs: 0, boards: 0, open: 0, done: 0 } });
      }
      applyBadges();
      if (rest.length) timers.idle(() => runChunk(rest));
    };
    timers.idle(() => runChunk(misses));
  };
  const scheduleBadges = (ms = 0) => {
    if (disposed) return;
    badgeTimer?.();
    badgeTimer = timers.later(() => { badgeTimer = null; refreshBadges(); }, ms);
  };

  const settle = () => {
    settleTimer?.();
    settleTimer = timers.later(() => {
      settleTimer = null;
      if (gesturing) return;
      applyLod();
      scheduleContent();
      vpStore.set(boardUid, vp);
      dirty.edges = new Set(board()?.edges.keys() || []); // arrow sizes depend on zoom
      dirty.links = true;
      schedule();
      updateBackToContent();
      refreshBadges();
    }, RESUME_MS);
  };

  // ------------------------------------------------------------ selection + context bar
  const selectedItems = () => selection.items.map((u) => board()?.items.get(u)).filter(Boolean);
  const toScreenRect = (r) => {
    const p = worldToScreen(vp, { x: r.x, y: r.y });
    return { x: p.x, y: p.y, w: r.w * vp.zoom, h: r.h * vp.zoom };
  };
  const pathScreenRect = (geo, extra) => {
    const pts = [geo.start, geo.end, geo.mid].filter(Boolean).map((p) => worldToScreen(vp, p));
    for (const r of extra) pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const ctxAnchor = () => {
    const b = board();
    if (!b) return null;
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      const geo = edgesR.geometryOf(selection.edge);
      if (!edge || !geo) return null;
      // Anchor on the whole connection (path + label) so the bar clears the line, not just its midpoint.
      const lr = edge.label ? edgesR.labelRect(selection.edge) : null;
      const extra = lr && lr.width ? [{ x: lr.left - rootRect.left, y: lr.top - rootRect.top, w: lr.width, h: lr.height }] : [];
      return { kind: "edge", rect: pathScreenRect(geo, extra) };
    }
    if (selection.link) {
      const geo = edgesR.linkGeometryOf(selection.link);
      if (!geo) return null;
      return { kind: "edge", rect: pathScreenRect(geo, []) };
    }
    const r = rects();
    const bounds = boundsOf(selection.items.map((u) => r.get(u)).filter(Boolean));
    return bounds ? { kind: "items", rect: toScreenRect(bounds) } : null;
  };
  const showCtx = () => {
    const b = board();
    if (!b) return chrome.ctx.hide();
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      return edge ? chrome.ctx.show("edge", edge, ctxAnchor) : chrome.ctx.hide();
    }
    if (selection.link) {
      const link = (session.links || []).find((l) => l.key === selection.link);
      return link ? chrome.ctx.show("link", link, ctxAnchor) : chrome.ctx.hide();
    }
    const items = selectedItems();
    if (!items.length) return chrome.ctx.hide();
    if (items.length > 1) {
      const model = { count: items.length, allPinned: items.every((i) => i.pinned), anyCollapsed: items.some((i) => i.type === "card" && i.collapsed) };
      return chrome.ctx.show("cards", model, ctxAnchor);
    }
    const it = items[0];
    return chrome.ctx.show(it.type === "section" ? "section" : it.type === "text" ? "text" : it.kind === "board" ? "board" : "card", it, ctxAnchor);
  };

  // ------------------------------------------------------------ session mutations used by chrome
  const targetUids = () => (selection.edge ? [selection.edge] : selection.items);
  const singleItem = () => (selection.items.length === 1 ? board()?.items.get(selection.items[0]) : null);
  const openItemInSidebar = (item) => {
    if (!item) return;
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) host?.openInSidebar?.(uid, "outline");
    } else {
      host?.openInSidebar?.(item.target.uid || item.uid, "block");
    }
  };
  const stackAt = (strings, x, y, h) => strings.map((string, i) => ({ string, x, y: y + i * (h + 24) }));
  const addStringsBeside = (strings) => {
    const b = board();
    if (!b || !strings.length) return;
    const r = rects();
    const sel = singleItem();
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    let x; let y;
    if (sel && r.get(sel.uid)) { const sr = r.get(sel.uid); x = sr.x + sr.w + 40; y = sr.y; }
    else { const c = screenToWorld(vp, { x: size.width / 2, y: size.height / 2 }); x = c.x - w / 2; y = c.y - h / 2; }
    void session.addRefCards?.(stackAt(strings, x, y, h));
  };
  const isOnBoard = (string) => {
    const b = board();
    if (!b) return false;
    const s = String(string || "").trim();
    for (const item of b.items.values()) {
      if (item.string.trim() === s || semanticRef(item) === s) return true;
    }
    return false;
  };

  // ------------------------------------------------------------ nested boards
  // `crumbs` entries are shared with the feature's record, so a rename shows up in both.
  const crumbList = Array.isArray(crumbs) ? crumbs : [];
  // The board block a card opens: the card itself (nested board), or the target of a whiteboard-shortcut
  // card (a ((ref)) to a {{[[diagram]]}} block). `uid` is an item uid, or a referenced uid the card renderer passes.
  const boardTargetOf = (uid) => {
    const item = board()?.items.get(uid);
    if (item?.kind === "board") return uid;
    const ref = item ? (item.kind === "block" ? item.target?.uid : null) : uid;
    if (!ref || typeof host?.blockString !== "function") return null;
    return classifyString(host.blockString(ref)).kind === "board" ? ref : null;
  };
  const openBoard = async (uid) => {
    const target = boardTargetOf(uid);
    if (!target) return;
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    if (onOpenBoard) onOpenBoard(target);
    else host?.openBlock?.(target);
  };
  const goCrumb = async (index) => {
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    onCrumb?.(index);
  };
  const popBoard = () => {
    if (crumbList.length > 1 && onCrumb) { void goCrumb(crumbList.length - 2); return true; }
    return false;
  };

  // ------------------------------------------------------------ 1.2 helpers
  const toast = (message, undo = false) => chrome.toast.show({ message, action: undo ? { label: "Undo", run: () => session.undo?.() } : undefined });
  const lastSelected = () => selection.items[selection.items.length - 1] ?? null;
  const viewCenterWorld = () => screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
  const cardsIn = (uids) => {
    const b = board();
    const out = new Set();
    if (!b) return [];
    for (const uid of uids) {
      const it = b.items.get(uid);
      if (!it) continue;
      if (it.type === "card") out.add(uid);
      else if (it.type === "section") for (const d of descendantsOf(b, uid)) if (b.items.get(d)?.type === "card") out.add(d);
    }
    return [...out];
  };
  const afterCreate = (label) => (res) => {
    if (disposed) return;
    const list = Array.isArray(res) ? res : [];
    if (!list.length) return;
    ctl.select(list);
    const types = new Set(list.map((u) => board()?.items.get(u)?.type ?? "card"));
    const noun = types.size === 1 && (types.has("card") || types.has("section")) ? [...types][0] : "item";
    toast(`${label} ${list.length} ${list.length === 1 ? noun : `${noun}s`}`, true);
  };
  const copyText = (text, message) => { void writeClipboard({ text }).then((ok) => { if (!disposed) toast(ok ? message : "Copy failed"); }); };
  const openItem = (item) => {
    if (!item) return;
    if (item.kind === "board" || boardTargetOf(item.uid)) { void openBoard(item.uid); return; }
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) { if (host?.api?.ui?.mainWindow?.openPage) host.api.ui.mainWindow.openPage({ page: { uid } }); else host?.openBlock?.(uid); }
      return;
    }
    host?.openBlock?.(item.target.uid || item.uid);
  };

  // ------------------------------------------------------------ background (pattern + tone)
  const applyBackground = () => {
    const b = board();
    const own = b?.plexus;
    const ownPattern = BOARD_PATTERNS.includes(own?.bg) ? own.bg : null;
    const ownTone = BOARD_TONES.includes(own?.bgColor) ? own.bgColor : null;
    const defPattern = setting("grid", "dots");
    const defTone = setting("board-tone", "none");
    const pattern = ownPattern ?? (BOARD_PATTERNS.includes(defPattern) ? defPattern : "dots");
    const tone = ownTone ?? (BOARD_TONES.includes(defTone) ? defTone : null);
    const override = ownPattern !== null || ownTone !== null;
    if (pattern === bgPattern && tone === bgTone && override === bgOverride) return;
    if (pattern !== bgPattern) {
      grid.className = `pxd-grid pxd-grid--${pattern}`;
      if (bgPattern === "grid") for (const v of ["--pxd-grid-major", "--pxd-grid-major-x", "--pxd-grid-major-y"]) grid.style.removeProperty?.(v);
      bgPattern = pattern;
      dirty.viewport = true;
      schedule();
    }
    if (tone !== bgTone) {
      if (bgTone) root.classList.remove(`pxd-bg-${bgTone}`);
      if (tone) root.classList.add(`pxd-bg-${tone}`);
      bgTone = tone;
    }
    bgOverride = override;
    chrome.toolbar.setBackground({ pattern, tone, override });
  };

  // ------------------------------------------------------------ focus mode
  const focusSetNow = () => {
    const b = board();
    if (presentSet) return presentSet;
    if (!focusOn || !b || !selection.items.length) return null;
    const sel = new Set(selection.items);
    const set = new Set(sel);
    for (const e of b.edges.values()) {
      if (!e.valid) continue;
      if (sel.has(e.from)) set.add(e.to);
      if (sel.has(e.to)) set.add(e.from);
    }
    for (const l of session.links || []) {
      if (sel.has(l.from)) set.add(l.to);
      if (sel.has(l.to)) set.add(l.from);
    }
    return set;
  };
  const applyFocus = () => {
    if (disposed) return;
    const set = focusSetNow();
    const key = set ? [...set].sort().join("|") : null;
    root.classList.toggle("pxd-root--focus", Boolean(set) || focusOn);
    chrome.toolbar.setFocus(focusOn);
    if (key === focusKey) return;
    focusKey = key;
    itemsR.setFocus(set);
    edgesR.setFocus(set);
  };
  const toggleFocus = () => {
    if (focusOn) { focusOn = false; applyFocus(); return; }
    if (!selection.items.length) { toast("Select a card to focus on it"); return; }
    focusOn = true;
    applyFocus();
  };
  const exitFocus = () => {
    if (!focusOn) return false;
    focusOn = false;
    applyFocus();
    return true;
  };

  // ------------------------------------------------------------ session actions shared by chrome and the menu
  const setFolded = (uids, value) => {
    const cards = cardsIn(uids);
    if (cards.length) void session.setCollapsedMany?.(cards, value);
  };
  const foldSelection = () => {
    const cards = cardsIn(selection.items);
    if (!cards.length) return;
    const b = board();
    void session.setCollapsedMany?.(cards, cards.some((u) => !b.items.get(u).collapsed));
  };
  const alignSel = (mode, uids = selection.items) => {
    const r = rects();
    const b = board();
    const list = uids.filter((uid) => !b?.items.get(uid)?.pinned).map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
    const moved = alignRects(list, mode).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
    void session.commitRects?.(moved);
  };
  const distributeSel = (axis, uids = selection.items) => {
    const r = rects();
    const b = board();
    const list = uids.filter((uid) => !b?.items.get(uid)?.pinned).map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
    const moved = distributeRects(list, axis).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
    void session.commitRects?.(moved);
  };
  const wrapBoardSel = (uids = selection.items) => {
    if (!uids.length) return;
    Promise.resolve(session.wrapInBoard?.(uids)).then((uid) => { if (uid) ctl.select([uid]); }).catch(() => {});
  };
  const writeEdgeToGraph = async () => {
    if (!selection.edge) return;
    const r = await session.writeToGraph?.(selection.edge);
    chrome.toast.show({ message: r?.ok ? "Written to the graph" : `Not written: ${r?.reason || "unknown"}` });
  };
  const duplicate = (uids, { dx = 24, dy = 24, asRef = false } = {}) => {
    if (!uids.length) return;
    Promise.resolve(session.duplicateItems?.(uids, { dx, dy, asRef })).then(afterCreate("Duplicated")).catch(() => {});
  };
  const expandOutline = (uid) => {
    Promise.resolve(session.expandOutline?.(uid)).then((res) => {
      if (disposed || !res || typeof res !== "object") return;
      if (res.added > 0) {
        if (res.skipped > 0) toast(`Mind map: ${res.total - res.skipped} of ${res.total} branches (cap)`, true);
        else toast(`Added ${res.added} ${res.added === 1 ? "card" : "cards"} as a mind map`, true);
      }
      else toast("Nothing to expand");
    }).catch(() => {});
  };
  const fitHeight = (uid) => {
    const h = itemsR.measureContent(uid);
    if (h) void session.fitToContent?.(uid, h);
    else toast("Zoom in to measure the card");
  };
  const startSendTo = (uids = selection.items) => {
    const list = uids.slice();
    if (!list.length) return;
    sendPending = list;
    panel.open("boards");
    toast(`Pick a board to send ${list.length} ${list.length === 1 ? "card" : "cards"} to`);
  };
  const finishSend = (uids, target) => {
    Promise.resolve(session.sendToBoard?.(uids, target)).then((res) => {
      if (disposed) return;
      if (res) { toast(`Added ${res.added} ${res.added === 1 ? "card" : "cards"} to ${res.title}`); panel.close(); }
      else toast("Couldn't send the cards to that board");
    }).catch(() => {});
  };
  const weekDates = () => {
    const d = new Date();
    const monday = d.getDate() - ((d.getDay() + 6) % 7);
    return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), monday + i));
  };
  const addDaily = (dates, at) => {
    Promise.resolve(session.addDailyCards?.(dates, { x: at.x, y: at.y })).then((made) => {
      if (disposed) return;
      if (Array.isArray(made) && made.length) ctl.select(made);
      else toast("Already on this board");
    }).catch(() => {});
  };
  const outline = () => {
    const b = board();
    const out = [];
    if (!b) return out;
    for (const uid of outlineOrder(b)) {
      const it = b.items.get(uid);
      if (!it || it.type !== "section") continue;
      out.push({ uid, title: plainText(it.title || it.string, 80) || "Section", depth: it.depth, count: it.members.length, color: it.color || null });
    }
    return out;
  };

  // ------------------------------------------------------------ clipboard actions
  const pastePoint = () => {
    measure(); // the Roam page may have scrolled since the last measure
    const screen = pointerInside && lastPointer ? { x: lastPointer.x - rootRect.left, y: lastPointer.y - rootRect.top } : { x: size.width / 2, y: size.height / 2 };
    return screenToWorld(vp, screen);
  };
  const doCopy = (uids) => {
    const b = board();
    if (!b || !uids.length) return;
    const payload = copyPayload(b, uids, rects());
    if (!payload.text) return;
    lastPayload = payload;
    void writeClipboard({ text: payload.text, mime: PLEXUS_MIME, data: payload.mime }).then((ok) => { if (!disposed) toast(ok ? "Copied" : "Copy failed"); });
  };
  const pastePlexus = (data, { clone = false } = {}, at = pastePoint()) => {
    Promise.resolve(session.pasteItems?.(data, { x: at.x, y: at.y, mode: clone ? "clone" : "refs" })).then(afterCreate("Pasted")).catch(() => {});
  };
  const pasteEntries = (entries, at = pastePoint()) => {
    Promise.resolve(session.pasteText?.(entries, { x: at.x, y: at.y })).then(afterCreate("Pasted")).catch(() => {});
  };
  const pasteFromMenu = async (at, clone) => {
    let text = null;
    try { text = await globalThis.navigator?.clipboard?.readText?.(); } catch { text = null; }
    if (disposed) return;
    if (lastPayload && (text == null || text === lastPayload.text)) {
      let data = null;
      try { data = JSON.parse(lastPayload.mime); } catch { data = null; }
      if (data && Array.isArray(data.items)) { pastePlexus(data, { clone }, at); return; }
    }
    const entries = parsePastedText(text ?? "");
    if (entries.length) pasteEntries(entries, at);
    else toast("Nothing to paste");
  };
  const pasteImages = async (files, at = pastePoint()) => {
    if (!files?.length) return;
    if (typeof host?.uploadFile !== "function") { toast("Image upload is not available here"); return; }
    const urls = [];
    let failed = 0;
    for (const file of files) {
      try {
        urls.push(await host.uploadFile(file));
      } catch (err) {
        if (err?.message === "upload-unavailable") { if (!disposed) toast("Image upload is not available here"); return; }
        failed += 1;
      }
      if (disposed) return;
    }
    if (failed && !urls.length) { toast("Couldn't upload the image"); return; }
    if (!urls.length) return;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const made = await Promise.resolve(session.addRefCards?.(stackAt(urls.map((u) => `![](${u})`), at.x, at.y, h))).catch(() => null);
    if (disposed) return;
    if (Array.isArray(made) && made.length) { ctl.select(made); toast(failed ? `Added ${made.length} of ${files.length} images` : `Added ${made.length} ${made.length === 1 ? "image" : "images"}`, true); }
  };

  // ------------------------------------------------------------ context menu
  const menuContext = (kind, uid) => {
    const b = board();
    const item = uid ? b?.items.get(uid) : null;
    switch (kind) {
      case "canvas": return { canPaste: true };
      case "card": return { item, isBoard: item?.kind === "board", collapsed: Boolean(item?.collapsed), pinned: Boolean(item?.pinned), hasOutline: NOTE_KINDS.includes(item?.kind) };
      case "section": return { item, count: item?.members?.length ?? 0, fitOn: item?.autofit !== false, pinned: Boolean(item?.pinned) };
      case "text": return { item, pinned: Boolean(item?.pinned) };
      case "edge": { const e = uid ? b?.edges.get(uid) : null; return { item: e, dir: e?.dir, route: e?.route, dash: e?.dash }; }
      case "multi": {
        const items = selection.items.map((u) => b?.items.get(u)).filter(Boolean);
        return { count: items.length, allPinned: items.length > 0 && items.every((i) => i.pinned), anyCollapsed: items.some((i) => i.type === "card" && i.collapsed) };
      }
      default: return {};
    }
  };
  const openMenuAt = (kind, uid, client, world) => {
    if (!board()) return false;
    const items = buildMenu(kind, menuContext(kind, uid));
    const ok = menu.open({ x: client.x, y: client.y, items });
    if (ok) menuCtx = { kind, uid, world, selection: selection.items.slice() };
    return ok;
  };
  const createAt = async (type, world) => {
    const d = DEFAULT_SIZES[type];
    const at = { x: world.x - d.w / 2, y: world.y - d.h / 2 };
    const uid = await (type === "text" ? actions.createText(at) : actions.createCard(at));
    if (uid && !disposed) { ctl.select([uid]); void enterEdit(uid); }
  };
  const onMenuPick = (id) => {
    const b = board();
    if (!b || disposed) return;
    const mc = menuCtx || { kind: "canvas", uid: null, world: viewCenterWorld(), selection: [] };
    const world = mc.world || viewCenterWorld();
    const uids = mc.kind === "multi" ? selection.items.slice() : mc.uid && b.items.has(mc.uid) ? [mc.uid] : selection.items.slice();
    const item = uids.length === 1 ? b.items.get(uids[0]) ?? null : null;
    const edgeUid = mc.kind === "edge" ? mc.uid : selection.edge;
    const at = id.indexOf(":");
    const head = at < 0 ? id : id.slice(0, at);
    const arg = at < 0 ? null : id.slice(at + 1);
    switch (head) {
      case "new-card": void createAt("card", world); break;
      case "new-text": void createAt("text", world); break;
      case "new-section": {
        const d = DEFAULT_SIZES.section;
        Promise.resolve(session.createSection?.({ rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "new-board": {
        const d = DEFAULT_BOARD_CARD;
        Promise.resolve(session.createBoard?.({ rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "paste": void pasteFromMenu(world, false); break;
      case "paste-clone": void pasteFromMenu(world, true); break;
      case "select-all": ctl.select([...b.items.keys()]); break;
      case "fit-all": fitAll(); break;
      case "fold-all": void session.collapseAll?.(true); break;
      case "unfold-all": void session.collapseAll?.(false); break;
      case "add-today": addDaily([new Date()], world); break;
      case "add-week": addDaily(weekDates(), world); break;
      case "background": chrome.popover.open(); break;
      case "export-svg": void view.exportSvg({ download: true }); break;
      case "copy-outline": void view.copyOutline(); break;
      case "edit": if (item) { if (item.kind === "board") itemsR.renameBoard(item.uid); else void enterEdit(item.uid); } break;
      case "open": openItem(item); break;
      case "open-sidebar": openItemInSidebar(item); break;
      case "copy": doCopy(uids); break;
      case "copy-ref": if (item) copyText(`((${item.uid}))`, "Reference copied"); break;
      case "copy-link": if (item) copyText(semanticRef(item), "Link copied"); break;
      case "duplicate": duplicate(uids); break;
      case "duplicate-ref": duplicate(uids, { asRef: true }); break;
      case "color": { const target = mc.kind === "edge" && edgeUid ? [edgeUid] : uids; if (target.length) void session.setColor?.(target, arg === "none" ? null : arg); break; }
      case "show-as-card": if (item) void session.setLook?.(item.uid, "card"); break;
      case "show-as-block": if (item) void session.setLook?.(item.uid, "block"); break;
      case "fold": setFolded(uids, true); break;
      case "unfold": setFolded(uids, false); break;
      case "fit-height": if (item) fitHeight(item.uid); break;
      case "reset-size": void session.resetSize?.(uids); break;
      case "pin": void session.setPinned?.(uids, true); break;
      case "unpin": void session.setPinned?.(uids, false); break;
      case "mind-map": if (item) expandOutline(item.uid); break;
      case "send-to": startSendTo(uids); break;
      case "related": panel.open("related"); break;
      case "delete": case "delete-frame": ctl.deleteSelection(false); break;
      case "delete-contents": ctl.deleteSelection(true); break;
      case "rename": if (item) itemsR.renameSection(item.uid); break;
      case "select-contents": if (item?.members?.length) ctl.select(item.members); break;
      case "fit-section": if (item) void session.fitSection?.(item.uid); break;
      case "toggle-fit": if (item) void session.setFit?.(item.uid, item.autofit === false); break;
      case "tidy": void session.tidyItems?.(mc.kind === "board-menu" ? b.roots : uids, arg); break;
      case "fold-all-in": if (item) void session.collapseAll?.(true, { within: item.uid }); break;
      case "unfold-all-in": if (item) void session.collapseAll?.(false, { within: item.uid }); break;
      case "size": if (item) void session.setFontSize?.(item.uid, Number(arg)); break;
      case "dir": if (edgeUid) void session.updateEdge?.(edgeUid, { dir: arg }); break;
      case "route": if (edgeUid) void session.updateEdge?.(edgeUid, { route: arg }); break;
      case "dash": if (edgeUid) void session.updateEdge?.(edgeUid, { dash: arg }); break;
      case "flip": if (edgeUid) void session.flipEdge?.(edgeUid); break;
      case "label": if (edgeUid) edgesR.editLabel(edgeUid); break;
      case "notes": if (edgeUid) host?.openInSidebar?.(edgeUid, "block"); break;
      case "write-to-graph": void writeEdgeToGraph(); break;
      case "align": alignSel(arg, uids); break;
      case "distribute": distributeSel(arg, uids); break;
      case "same-size": if (uids.length) void session.sameSize?.(uids, uids[uids.length - 1], arg); break;
      case "wrap-section": if (uids.length) void session.wrapInSection?.(uids); break;
      case "wrap-board": wrapBoardSel(uids); break;
      default: break;
    }
  };

  // ------------------------------------------------------------ chrome + panel
  const chrome = createChrome({
    doc,
    root,
    version,
    settings: settingsProxy,
    timers,
    crumbs: crumbList,
    on: {
      openBoard: () => { const it = singleItem(); if (it) void openBoard(it.uid); },
      renameBoard: () => { const it = singleItem(); if (it) itemsR.renameBoard(it.uid); },
      crumb: (index) => { void goCrumb(index); },
      wrapBoard: () => wrapBoardSel(),
      setTool: (tool, lock) => ctl.setTool(tool, lock),
      togglePanel: () => panel.toggle(),
      cycleLinks: () => cycleLinks(),
      zoomIn: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1.2)),
      zoomOut: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / 1.2)),
      zoomReset: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / vp.zoom)),
      fit: () => fitAll(),
      toggleMinimap: () => chrome.minimap.setVisible(!chrome.minimap.isVisible()),
      toggleFullscreen: () => requestFullscreen(!isFullscreen),
      setColor: (c) => { const uids = targetUids(); if (uids.length) void session.setColor?.(uids, c); },
      edit: () => { const it = singleItem(); if (it) void enterEdit(it.uid); },
      openSidebar: () => openItemInSidebar(singleItem()),
      collapse: () => { const it = singleItem(); if (it) void session.setCollapsed?.(it.uid, !it.collapsed); },
      related: () => panel.open("related"),
      delete: () => ctl.deleteSelection(false),
      rename: () => { const it = singleItem(); if (it) itemsR.renameSection(it.uid); },
      selectContents: () => { const it = singleItem(); if (it?.members?.length) ctl.select(it.members); },
      setFontSize: (n) => { const it = singleItem(); if (it) void session.setFontSize?.(it.uid, n); },
      edgeDir: (dir) => { if (selection.edge) void session.updateEdge?.(selection.edge, { dir }); },
      flip: () => { if (selection.edge) void session.flipEdge?.(selection.edge); },
      route: (route) => { if (selection.edge) void session.updateEdge?.(selection.edge, { route }); },
      dash: (dash) => { if (selection.edge) void session.updateEdge?.(selection.edge, { dash }); },
      weight: (weight) => { if (selection.edge) void session.updateEdge?.(selection.edge, { weight }); },
      label: () => { if (selection.edge) edgesR.editLabel(selection.edge); },
      notes: () => { if (selection.edge) host?.openInSidebar?.(selection.edge, "block"); },
      writeToGraph: () => writeEdgeToGraph(),
      pinLink: () => {
        const link = (session.links || []).find((l) => l.key === selection.link);
        if (link) Promise.resolve(session.pinLink?.(link)).then((uid) => { if (uid) ctl.selectEdge(uid); }).catch(() => {});
      },
      openSource: (uid) => host?.openInSidebar?.(uid, "block"),
      align: (mode) => alignSel(mode),
      distribute: (axis) => distributeSel(axis),
      wrap: () => { if (selection.items.length) void session.wrapInSection?.(selection.items); },
      navigate: (worldPoint) => centerOn(worldPoint),
      searchFilter: (text) => searchFilter(text),
      searchNext: (dir) => searchNext(dir),
      searchClosed: () => { try { root.focus({ preventScroll: true }); } catch { /* stub */ } },
      // 1.2
      pin: (on) => { if (selection.items.length) void session.setPinned?.(selection.items, Boolean(on)); },
      fitHeight: () => { const it = singleItem(); if (it) fitHeight(it.uid); },
      copyRef: () => { const it = singleItem(); if (it) copyText(`((${it.uid}))`, "Reference copied"); },
      duplicate: () => duplicate(selection.items),
      sendTo: () => startSendTo(),
      expandOutline: () => { const it = singleItem(); if (it) expandOutline(it.uid); },
      fitSection: () => { const it = singleItem(); if (it) void session.fitSection?.(it.uid); },
      toggleFit: () => { const it = singleItem(); if (it) void session.setFit?.(it.uid, it.autofit === false); },
      tidy: (mode) => { if (selection.items.length) void session.tidyItems?.(selection.items, mode); },
      foldAll: (value) => { const it = singleItem(); if (it) void session.collapseAll?.(Boolean(value), { within: it.uid }); },
      fold: (value) => setFolded(selection.items, Boolean(value)),
      sameSize: (mode) => { if (selection.items.length) void session.sameSize?.(selection.items, lastSelected(), mode); },
      toggleFocus: () => toggleFocus(),
      present: () => startPresent(),
      openMore: ({ x, y } = {}) => { openMenuAt("board-menu", null, { x: x ?? 0, y: y ?? 0 }, viewCenterWorld()); },
      backToContent: () => fitAll(),
      setBackground: (patch) => {
        Promise.resolve(session.setBoardBackground?.(patch)).then((ok) => { if (ok === false && !disposed) toast("This board can't store a background"); }).catch(() => {});
      },
      useBackgroundAsDefault: () => {
        if (typeof onSetDefaults !== "function") return;
        onSetDefaults({ grid: bgPattern, "board-tone": bgTone || "none" });
        toast("Saved as the default background");
      },
    },
  });
  const panel = createPanel({
    doc,
    root,
    host,
    timers,
    on: {
      addBeside: (string) => addStringsBeside([string]),
      addMany: (strings) => addStringsBeside(strings),
      isOnBoard,
      opened: (open) => { chrome.toolbar.setPanel(open); if (!open) sendPending = null; },
      listBoards: () => Promise.resolve(host?.listBoards?.()).then((rows) => rows || []),
      openBoardByUid: (uid) => {
        if (sendPending) { const list = sendPending; sendPending = null; finishSend(list, uid); return; }
        host?.openBlock?.(uid);
      },
      addBoardCard: (uid) => addStringsBeside([`((${uid}))`]),
      getOutline: () => outline(),
      outlineClick: (uid) => { fitSelection([uid]); ctl.select([uid]); },
    },
  });
  const menu = createMenu({ doc, root, on: { pick: (id) => onMenuPick(id), closed: () => { menuCtx = null; } } });
  const quicklook = createQuickLook({
    doc,
    root,
    host,
    timers,
    on: {
      getRefCount: (item) => badgeCache.get(badgeKeyOf(item))?.stats?.refs,
    },
  });
  const presenter = createPresenter({
    doc,
    root,
    timers,
    on: {
      step: (s) => { presentSet = s.members; fitTo(s.rect, { maxZoom: 1.2 }); applyFocus(); },
      exit: () => { presentSet = null; applyFocus(); },
    },
  });
  const startPresent = () => {
    quicklook.close();
    if (!presenter.start(board(), rects())) toast("Nothing to present");
  };
  chrome.minimap.setVisible(setting("show-minimap", true) !== false);
  chrome.toolbar.setLinkMode(linkMode);

  const cycleLinks = () => {
    linkMode = LINK_MODES[(LINK_MODES.indexOf(linkMode) + 1) % LINK_MODES.length];
    chrome.toolbar.setLinkMode(linkMode);
    session.setLinkMode?.(linkMode);
  };

  // ------------------------------------------------------------ board search
  const searchFilter = (text) => {
    const b = board();
    const q = String(text || "").trim().toLowerCase();
    searchMatches = [];
    searchIndex = -1;
    root.classList.toggle("pxd-root--searching", Boolean(q));
    if (!b) return 0;
    for (const item of b.items.values()) {
      const hay = `${item.title}\n${plainText(item.string, 2000)}`.toLowerCase();
      const hit = q && hay.includes(q);
      if (hit) searchMatches.push(item.uid);
      itemsR.shellOf(item.uid)?.classList.toggle("pxd-item--dim", Boolean(q) && !hit);
    }
    return searchMatches.length;
  };
  const searchNext = (dir = 1) => {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    const uid = searchMatches[searchIndex];
    ctl.select([uid]);
    fitSelection([uid]);
  };

  // ------------------------------------------------------------ editing
  const enterEdit = async (uid) => {
    ctl.select([uid]);
    // Editing at map zoom is unreadable: bring the card to a working zoom first.
    if (tier !== "detail") { fitSelection([uid]); applyLod(); }
    const ok = await itemsR.enterEdit(uid);
    if (ok) chrome.ctx.hide();
    return ok;
  };
  // Cards/text created by a gesture and left empty are removed on edit exit (no junk cards).
  const freshItems = new Set();
  const exitEdit = async () => {
    const uid = itemsR.editingUid?.();
    const editorText = editingPlainText(root);
    await itemsR.exitEdit();
    if (uid && freshItems.delete(uid)) {
      const item = session.board?.items?.get(uid);
      const text = host?.blockString?.(uid);
      if (item && freshCardIsBlank({
        blockString: text,
        itemString: item.string,
        contentCount: (item.content || []).length,
        editorText,
      })) {
        await session.deleteItems?.([uid]);
      }
    }
    if (!disposed) { dirty.selection = true; schedule(); }
  };

  // ------------------------------------------------------------ fullscreen
  const applyFullscreen = (on) => {
    isFullscreen = Boolean(on);
    fsDispose();
    fsDispose = applyFullscreenChrome(mountEl, isFullscreen, doc);
    root.classList.toggle("pxd-root--fullscreen", isFullscreen);
    chrome.toolbar.setFullscreen(isFullscreen);
    resizeGrip.style.display = isFullscreen ? "none" : "";
    if (isFullscreen) { root.style.height = ""; }
    else applyInlineHeight();
    timers.frame(() => { measure(); markViewport(); });
  };
  const requestFullscreen = (on) => {
    applyFullscreen(on);
    onRequestFullscreen?.(Boolean(on));
  };

  // ------------------------------------------------------------ inline height
  const readHeight = () => {
    try { const v = Number(storage?.getItem?.(heightKey)); return Number.isFinite(v) && v >= MIN_HEIGHT ? v : Number(setting("default-height", DEFAULT_HEIGHT)) || DEFAULT_HEIGHT; } catch { return DEFAULT_HEIGHT; }
  };
  const applyInlineHeight = (h = readHeight()) => {
    root.style.height = `${h}px`;
    if (mountEl?.style) { mountEl.style.height = `${h}px`; mountEl.style.minHeight = `${h}px`; }
  };
  let heightDrag = null;
  const onHeightMove = (event) => {
    if (!heightDrag) return;
    const h = Math.max(MIN_HEIGHT, Math.round(heightDrag.h0 + (event.clientY - heightDrag.y0)));
    heightDrag.h = h;
    applyInlineHeight(h);
  };
  const onHeightUp = () => {
    if (!heightDrag) return;
    try { storage?.setItem?.(heightKey, String(heightDrag.h)); } catch { /* quota */ }
    heightDrag = null;
    doc.removeEventListener("pointermove", onHeightMove, true);
    doc.removeEventListener("pointerup", onHeightUp, true);
    measure();
    markViewport();
  };
  listen(resizeGrip, "pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    heightDrag = { y0: event.clientY, h0: rootRect.height || readHeight(), h: rootRect.height || readHeight() };
    doc.addEventListener("pointermove", onHeightMove, true);
    doc.addEventListener("pointerup", onHeightUp, true);
  });

  // ------------------------------------------------------------ section auto-fit preview
  // While items are dragged or resized, sections that must grow around them are shown grown (shells only).
  // Nothing is written: the commit runs the real fit in one transaction, cancel snaps the shells back.
  const resetGrown = () => {
    if (!grown.size) return;
    const ids = [...grown];
    grown = new Set();
    itemsR.resetRects(rects(), ids);
  };
  const previewFit = (touched, { parentOf, skip } = {}) => {
    const b = board();
    if (!b || !flag("auto-fit-sections", true)) return;
    const plan = touched.length ? sectionFitPlan(b, effectiveRects(), touched, { parentOf, skip }) : [];
    const next = new Set(plan.map((p) => p.uid));
    const stale = [...grown].filter((u) => !next.has(u));
    if (stale.length) itemsR.resetRects(rects(), stale);
    const live = itemsR.previewSectionRects(plan.map(({ uid, rect }) => ({ uid, x: rect.x, y: rect.y, w: rect.w, h: rect.h })));
    if (!liveRects) liveRects = new Map();
    for (const [uid, rect] of live) liveRects.set(uid, rect);
    grown = next;
  };

  // ------------------------------------------------------------ controller
  const actions = {
    board,
    rects,
    viewport: () => vp,
    size: () => size,
    setViewport,
    fitAll,
    fitSelection,
    onSelection: (sel) => {
      selection = { items: sel.items || [], edge: sel.edge || null, link: sel.link || null };
      dirty.selection = true;
      panel.setSelection(singleItem());
      schedule();
    },
    onTool: (tool, locked) => {
      root.dataset.tool = tool;
      root.setAttribute("data-tool", tool);
      chrome.toolbar.setTool(tool, locked);
    },
    onHover: (uid) => itemsR.setHover(uid),
    setGesturing: (on, info) => {
      gesturing = Boolean(on);
      root.classList.toggle("pxd-root--gesturing", gesturing);
      world.style.willChange = gesturing ? "transform" : "";
      if (gesturing) {
        resumeTimer?.();
        resumeTimer = null;
        itemsR.setPaused(true);
        chrome.ctx.hide();
        menu.close();
      } else {
        // Only a gesture that actually moved swallows its click; a plain click must reach links and chrome.
        if (info?.moved) {
          suppressClick = true;
          swallowMouseUp = true;
          timers.later(() => { suppressClick = false; swallowMouseUp = false; }, 0);
        }
        liveRects = null;
        resetGrown();
        resumeTimer = timers.later(() => {
          resumeTimer = null;
          itemsR.setPaused(false);
          applyLod();
          scheduleContent();
          vpStore.set(boardUid, vp);
          dirty.selection = true;
          schedule();
          updateBackToContent();
          refreshBadges();
        }, RESUME_MS);
      }
    },
    showMarquee: (rect, kind) => edgesR.setMarquee(rect, kind),
    showGuides: (guides) => edgesR.setGuides(guides),
    previewMove: (uids, dx, dy) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewMove(uids, dx, dy, b, rects());
      const set = new Set(uids);
      for (const u of uids) for (const d of descendantsOf(b, u)) set.add(d);
      // A moved item joins the section under its center; that section grows around it (preview only).
      const top = new Set(uids);
      const eff = effectiveRects();
      previewFit(uids, {
        parentOf: (u) => (top.has(u) && eff.get(u) ? containerAt(b, center(eff.get(u)), { exclude: set, rects: eff }) : b.items.get(u)?.parentUid),
      });
      for (const u of grown) set.add(u);
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
      dirty.minimap = true;
      schedule();
    },
    previewRects: (list) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewRects(list);
      const set = new Set(list.map((r) => r.uid));
      previewFit(list.map((r) => r.uid), { skip: new Set(list.filter((r) => b.items.get(r.uid)?.type === "section").map((r) => r.uid)) });
      for (const u of grown) set.add(u);
      const linkKeys = new Set((session.links || []).filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: effectiveRects(), zoom: vp.zoom, linkKeys, links: session.links || [] });
      dirty.minimap = true;
      schedule();
    },
    cancelPreview: () => resetGrown(),
    showGhosts: (list) => edgesR.setGhosts(list),
    duplicateItems: (uids, opts) => duplicate(uids, opts),
    openMenu: ({ kind, uid, screen, world }) => {
      const at = screen || { x: 0, y: 0 };
      return openMenuAt(kind, uid, { x: rootRect.left + at.x, y: rootRect.top + at.y }, world || screenToWorld(vp, at));
    },
    foldSelection,
    toggleFocus,
    exitFocus,
    quickLook: () => {
      if (quicklook.isOpen()) { quicklook.close(); return; }
      const uid = lastSelected();
      const it = uid ? board()?.items.get(uid) : null;
      if (it && it.type !== "section") quicklook.open(it);
    },
    closeQuickLook: () => quicklook.close(),
    present: () => startPresent(),
    presentActive: () => presenter.isActive(),
    presentNext: () => presenter.next(),
    presentPrev: () => presenter.prev(),
    exitPresent: () => presenter.stop(),
    expandOutline: (uid) => expandOutline(uid),
    fitHeight: (uid) => fitHeight(uid),
    fitSection: (uid) => session.fitSection?.(uid),
    resetSize: (uids) => session.resetSize?.(uids),
    showTempWire: (spec) => edgesR.setTempWire(spec, rects(), vp.zoom),
    commitMove: (uids, dx, dy) => session.commitMove?.(uids, dx, dy),
    commitRects: (list) => session.commitRects?.(list),
    createCard: (p) => Promise.resolve(session.createCard?.({ x: p.x, y: p.y })).then((uid) => { if (uid) freshItems.add(uid); return uid; }),
    createText: (p) => Promise.resolve(session.createText?.({ x: p.x, y: p.y })).then((uid) => { if (uid) freshItems.add(uid); return uid; }),
    createSection: (p) => session.createSection?.({ rect: p.rect }),
    createBoard: (p) => session.createBoard?.({ rect: p.rect }),
    moveIntoBoard: async (uids, boardUid, dx = 0, dy = 0) => {
      const res = await session.moveIntoBoard?.(uids, boardUid);
      if (!res) { void session.commitMove?.(uids, dx, dy); return; }
      chrome.toast.show({ message: `Moved into ${res.title}`, action: { label: "Undo", run: () => res.undo() } });
    },
    openBoard: (uid) => openBoard(uid),
    isBoardCard: (uid) => Boolean(boardTargetOf(uid)),
    popBoard,
    wrapInSection: (uids) => session.wrapInSection?.(uids),
    deleteItems: (uids, opts) => session.deleteItems?.(uids, opts),
    deleteEdges: (uids) => session.deleteEdges?.(uids),
    addEdge: (spec) => session.addEdge?.(spec),
    undo: () => session.undo?.(),
    redo: () => session.redo?.(),
    enterEdit: (uid) => enterEdit(uid),
    exitEdit: () => exitEdit(),
    isEditing: () => itemsR.isEditing(),
    editingUid: () => itemsR.editingUid(),
    autocompleteOpen: () => itemsR.autocompleteOpen(),
    renameSection: (uid) => itemsR.renameSection(uid),
    editLabel: (uid) => edgesR.editLabel(uid),
    openBlock: (uid) => host?.openBlock?.(uid),
    toast: (t) => chrome.toast.show(t),
    openSearch: () => chrome.search.open(),
    cycleLinks,
    isFullscreen: () => isFullscreen,
    setFullscreen: (on) => requestFullscreen(on),
    setSpace: (on) => root.classList.toggle("pxd-root--space", Boolean(on)),
  };
  const ctl = createInteractions({ actions, settings });
  ctl.setTool("select");

  // ------------------------------------------------------------ DOM events → controller
  const targetOf = (t) => {
    if (!t || typeof t.closest !== "function") return { kind: "empty" };
    if (t.closest(".pxd-chrome")) return { kind: "chrome" };
    const port = t.closest(".pxd-port");
    if (port) {
      const owner = port.closest(".pxd-item, .pxd-section");
      return { kind: "port", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), side: port.dataset?.side || port.getAttribute?.("data-side") };
    }
    const grip = t.closest(".pxd-grip");
    if (grip) {
      const owner = grip.closest(".pxd-item, .pxd-section");
      return { kind: "grip", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), part: grip.dataset?.part || grip.getAttribute?.("data-part") };
    }
    const label = t.closest(".pxd-label");
    if (label) {
      const key = label.dataset?.key || label.getAttribute?.("data-key");
      if (key) return { kind: "link", key };
      return { kind: "label", uid: label.dataset?.uid || label.getAttribute?.("data-uid") };
    }
    const edge = t.closest(".pxd-edge");
    if (edge) return { kind: "edge", uid: edge.dataset?.uid || edge.getAttribute?.("data-uid") };
    const link = t.closest(".pxd-link");
    if (link) return { kind: "link", key: link.dataset?.key || link.getAttribute?.("data-key") };
    const title = t.closest(".pxd-section__title");
    if (title) return { kind: "section-title", uid: title.closest(".pxd-section")?.dataset?.uid || title.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const border = t.closest(".pxd-section__edge");
    if (border) return { kind: "section-border", uid: border.closest(".pxd-section")?.dataset?.uid || border.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const item = t.closest(".pxd-item");
    if (item) return { kind: "item", uid: item.dataset?.uid || item.getAttribute?.("data-uid"), part: t.closest(".pxd-item__header") ? "header" : "body" };
    return { kind: "empty" };
  };
  const normalize = (event, type = event.type) => {
    const screen = { x: (event.clientX || 0) - rootRect.left, y: (event.clientY || 0) - rootRect.top };
    return {
      type,
      screen,
      world: screenToWorld(vp, screen),
      target: targetOf(event.target),
      button: event.button ?? 0,
      buttons: event.buttons ?? 0,
      shift: Boolean(event.shiftKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
      ctrl: Boolean(event.ctrlKey),
      key: event.key,
      code: event.code,
      deltaX: event.deltaX || 0,
      deltaY: event.deltaY || 0,
      pointerId: event.pointerId,
    };
  };

  let captured = false;
  const onDocMove = (event) => { if (ctl.isGesturing()) ctl.handle(normalize(event, "pointermove")); };
  const onDocUp = (event) => {
    if (!ctl.isGesturing()) return releaseCapture();
    ctl.handle(normalize(event, "pointerup"));
    releaseCapture();
  };
  const onDocCancel = () => { ctl.handle({ type: "pointercancel" }); releaseCapture(); };
  const releaseCapture = () => {
    if (!captured) return;
    captured = false;
    doc.removeEventListener("pointermove", onDocMove, true);
    doc.removeEventListener("pointerup", onDocUp, true);
    doc.removeEventListener("pointercancel", onDocCancel, true);
  };
  listen(root, "pointerdown", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    measure();
    const ev = normalize(event, "pointerdown");
    const editingUid = itemsR.editingUid();
    // Keep Roam's block handlers out of the overlay. Cancelling pointerdown also suppresses the compat
    // mousedown that Roam's page refs navigate on, so a drag that starts on a [[link]] moves the card;
    // a plain click on a link is routed by the click handler below (openRefFromClick).
    if (!(editingUid && ev.target.kind === "item" && ev.target.uid === editingUid && ev.target.part !== "header")) {
      event.stopPropagation();
      if (ev.target.kind !== "label" && ev.target.kind !== "section-title") event.preventDefault();
    }
    ctl.handle(ev);
    if (ctl.isGesturing() && !captured) {
      captured = true;
      doc.addEventListener("pointermove", onDocMove, true);
      doc.addEventListener("pointerup", onDocUp, true);
      doc.addEventListener("pointercancel", onDocCancel, true);
      // No setPointerCapture: capture retargets click/dblclick to the root, which made double-click on a card
      // create a phantom card and swallowed [[link]] clicks. Document-level listeners already follow the drag.
    }
    try { if (!editingUid && ev.target.kind !== "label") root.focus({ preventScroll: true }); } catch { /* stub */ }
  });
  // The mouseup that ends a drag must not reach a [[link]] the pointer happens to be over (it moved with the card).
  listen(doc, "mouseup", (event) => {
    if (!swallowMouseUp) return;
    swallowMouseUp = false;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);
  // mousedown/mouseup: inner React roots (renderString links) see them first; Roam's block handlers do not.
  for (const type of ["mousedown", "mouseup"]) {
    listen(root, type, (event) => {
      if (event.target?.closest?.(".pxd-chrome")) return;
      const editing = itemsR.editingUid();
      if (editing && event.target?.closest?.(".pxd-item--editing")) return;
      event.stopPropagation();
    });
  }
  listen(root, "dragstart", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-item--editing")) return;
    event.preventDefault();
  });
  // Capture phase only cancels the click that ends a drag. Shielding Roam's block-edit handlers happens in
  // the bubble phase, after renderString's own React roots inside cards have handled [[link]] clicks.
  listen(root, "click", (event) => {
    if (suppressClick) { event.stopPropagation(); event.preventDefault(); return; }
    // Roam's page-ref handlers stop click propagation inside the card's React root, so links are routed here,
    // in the capture phase, before the target sees the click.
    if (openRefFromClick(event)) { event.stopPropagation(); event.preventDefault(); }
  }, true);
  // Static card content: [[page]] / #tag / attr refs carry data-link-uid, ((block)) refs .rm-block-ref[data-uid].
  // Click opens them (Shift: right sidebar), matching Roam; editing cards keep Roam's own handling.
  const openRefFromClick = (event) => {
    const t = event.target;
    if (!t?.closest || !t.closest(".pxd-item") || t.closest(".pxd-item--editing")) return false;
    const api = host?.api;
    const page = t.closest("[data-link-uid]");
    const block = t.closest(".rm-block-ref[data-uid]");
    const uid = page?.getAttribute("data-link-uid") || block?.getAttribute("data-uid");
    if (!uid || !api?.ui) return false;
    if (event.shiftKey) api.ui.rightSidebar?.addWindow?.({ window: { type: page ? "outline" : "block", "block-uid": uid } });
    else if (page) api.ui.mainWindow?.openPage?.({ page: { uid } });
    else api.ui.mainWindow?.openBlock?.({ block: { uid } });
    return true;
  };
  listen(root, "click", (event) => {
    if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation();
  });
  listen(root, "dblclick", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    event.stopPropagation();
    event.preventDefault();
    measure();
    ctl.handle(normalize(event, "dblclick"));
  });
  listen(root, "wheel", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    measure(); // the outer Roam page scrolls without any pointer event on the board
    const handled = ctl.handle(normalize(event, "wheel"));
    if (handled) { event.preventDefault(); event.stopPropagation(); settle(); }
  }, { passive: false });
  // Right-click: the controller decides what was hit and asks us to open the menu; an editing card keeps the
  // browser's own menu (the controller returns false there).
  listen(root, "contextmenu", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    event.stopPropagation();
    // Roam's own menu for a ref / tag already handled this (its React root ran first); links and images keep the browser's.
    if (event.defaultPrevented) return;
    const native = event.target?.closest?.(NATIVE_MENU_TARGETS);
    if (native && native.closest?.(".pxd-item__body")) return;
    measure();
    const handled = ctl.handle(normalize(event, "contextmenu"));
    if (handled) event.preventDefault();
  });
  listen(root, "pointermove", (event) => { lastPointer = { x: event.clientX || 0, y: event.clientY || 0 }; });
  listen(root, "pointerenter", () => { pointerInside = true; });
  listen(root, "pointerleave", () => { pointerInside = false; });
  const acceptsDrop = (event) => !event.target?.closest?.(".pxd-item__editor");
  const dropEffectFor = (effectAllowed) => {
    const a = String(effectAllowed || "uninitialized");
    if (a === "all" || a === "uninitialized" || /copy/i.test(a)) return "copy";
    if (/move/i.test(a)) return "move";
    if (/link/i.test(a)) return "link";
    return "copy";
  };
  const onDragAccept = (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
  };
  listen(root, "dragenter", onDragAccept);
  listen(root, "dragover", onDragAccept);
  listen(root, "drop", (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    measure();
    const p = screenToWorld(vp, { x: event.clientX - rootRect.left, y: event.clientY - rootRect.top });
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) { void pasteImages(files, p); return; }
    const resolveUid = (u) => (host?.cardStringForUid ? host.cardStringForUid(u) : `((${u}))`);
    const list = parseDropPayload(event.dataTransfer, { resolveUid });
    if (!list.length) return;
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const made = session.addRefCards?.(stackAt(list.map((x) => x.string), p.x - w / 2, p.y - h / 2, h));
    Promise.resolve(made).then((uids) => { if (Array.isArray(uids) && uids.length) ctl.select(uids); }).catch(() => {});
  });

  const ownsKeyboard = () => pointerInside || isFullscreen || root.contains?.(doc.activeElement);
  const onKeyDown = (event) => {
    // The open menu owns the keyboard; Quick Look and a presentation only let their own keys through.
    if (menu.isOpen()) return;
    // Escape closes the Background popover before the controller's chain (selection, up a level, fullscreen) runs.
    if (event.key === "Escape" && chrome.popover.isOpen()) { chrome.popover.close(); event.preventDefault(); event.stopPropagation(); return; }
    if (quicklook.isOpen() && event.key !== "Escape" && String(event.key).toLowerCase() !== "q") return;
    if (presenter.isActive() && !["Escape", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "p", "P"].includes(event.key)) return;
    const inputFocused = isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement);
    if (inputFocused) {
      const inside = root.contains?.(event.target) || root.contains?.(doc.activeElement);
      if (!inside && !itemsR.isEditing()) return;
    } else if (!ownsKeyboard()) {
      return;
    }
    // Roam dropped focus to <body> mid-edit: put it back on the editor instead of running a board shortcut.
    if (!inputFocused && itemsR.isEditing() && event.key !== "Escape") { itemsR.recoverFocus(); return; }
    // Tab walks the outline only while focus is on the board itself: not for a resting pointer, and not on a toolbar control.
    const focused = doc.activeElement;
    const tabOwned = Boolean(focused) && (focused === root || (Boolean(root.contains?.(focused)) && !focused.closest?.(".pxd-chrome")));
    const handled = ctl.handle({ type: "keydown", key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey, inputFocused, tabOwned });
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  const onKeyUp = (event) => { ctl.handle({ type: "keyup", key: event.key, code: event.code }); };
  // A typed edit anywhere else in Roam lands on Roam's undo stack: the grouped undo log no longer maps onto it.
  listen(doc, "input", (event) => {
    if (!root.contains?.(event.target)) host?.invalidateUndo?.();
  }, true);
  // Capture phase: Roam's document-level shortcuts (Delete/Backspace on block selection, etc.) stop propagation
  // before a bubble listener on window. onKeyDown returns early for any text input outside the board.
  listen(win, "keydown", onKeyDown, true);
  listen(win, "keyup", onKeyUp, true);

  // ------------------------------------------------------------ clipboard
  const clip = createClipboardIO({
    doc,
    root,
    ownsKeyboard,
    isTextEntry: isTextEntryTarget,
    on: {
      getPayload: ({ cut = false } = {}) => {
        const b = board();
        if (!b || !selection.items.length) return null;
        const payload = copyPayload(b, selection.items, rects());
        if (!payload.text) return null;
        // A cut deletes the blocks, so the payload carries a snapshot of them for the paste to clone from.
        if (cut) {
          const snapshot = session.snapshotItems?.(selection.items);
          if (snapshot) {
            try { payload.mime = JSON.stringify({ ...JSON.parse(payload.mime), snapshot }); } catch { /* keep refs */ }
          }
        }
        lastPayload = payload;
        return payload;
      },
      cutDone: () => { ctl.deleteSelection(true); },
      pastePlexus: (data, opts) => pastePlexus(data, opts),
      pasteText: (entries) => pasteEntries(entries),
      pasteImages: (files) => { void pasteImages(files); },
    },
  });

  // ------------------------------------------------------------ session events
  subs.push(session.on("change", ({ dirty: d, structural } = {}) => {
    if (disposed) return;
    const b = board();
    const current = crumbList[crumbList.length - 1];
    if (current && b) {
      const title = b.title || UNTITLED_BOARD;
      if (current.title !== title) { current.title = title; chrome.toolbar.setCrumbs(crumbList); }
    }
    if (structural || !d) dirty.structural = true;
    if (d && b) {
      for (const uid of d) {
        if (b.edges.has(uid)) dirty.edges.add(uid); else dirty.items.add(uid);
      }
    } else dirty.all = true;
    if (!d || d.has?.(boardUid)) applyBackground();
    ctl.reconcile();
    dirty.selection = true;
    schedule();
  }));
  subs.push(session.on("links", () => { dirty.links = true; schedule(); }));
  subs.push(session.on("busy", (busy) => chrome.toolbar.setSync(Boolean(busy))));
  subs.push(session.on("toast", (t) => chrome.toast.show(t)));

  // ------------------------------------------------------------ observers
  const RO = globalThis.ResizeObserver;
  if (typeof RO === "function") {
    try {
      const ro = new RO(() => { measure(); markViewport(); chrome.ctx.reposition(); });
      ro.observe(root);
      observers.push(ro);
    } catch { /* stub */ }
  }
  const MO = globalThis.MutationObserver;
  if (typeof MO === "function") {
    try {
      let settle = null;
      const mo = new MO(() => {
        if (disposed) return;
        applyTheme();
        settle?.(); // a host background may still be transitioning when its marker class flips: measure once more after it
        settle = timers.later(() => { settle = null; applyTheme(); }, 300);
      });
      for (const node of [doc.documentElement, doc.body]) if (node) mo.observe(node, { attributes: true, attributeFilter: ["class"] });
      observers.push(mo);
    } catch { /* stub */ }
  }
  try {
    const mq = win?.matchMedia?.("(prefers-color-scheme: dark)");
    if (mq?.addEventListener) listen(mq, "change", () => { if (!disposed) applyTheme(); });
  } catch { /* no matchMedia */ }
  routeOff = watchRouteExit({ boardUid: routeUid, onExit: () => { if (isFullscreen) requestFullscreen(false); }, win });

  // ------------------------------------------------------------ render frame
  const renderFrame = () => {
    if (disposed) return;
    const b = board();
    if (!b) return;
    const r = rects();
    let itemsChanged = false;
    if (dirty.all || dirty.structural || dirty.items.size) {
      // Live preview rects (edit growth, drag fit) ride along: a sync for a dirty card must not snap grown section shells back.
      itemsR.sync({ board: b, rects: effectiveRects(), dirty: dirty.all ? null : dirty.items, structural: dirty.structural });
      itemsChanged = true;
    }
    if (dirty.all || dirty.structural || dirty.links || dirty.edges.size) {
      const partial = !dirty.all && !dirty.structural && !dirty.links && !dirty.items.size;
      if (partial) {
        edgesR.update({ board: b, edgeUids: dirty.edges, rects: r, zoom: vp.zoom });
      } else {
        edgesR.render({ board: b, rects: r, links: session.links || [], coveredEdges: session.coveredEdges || new Set(), selection, zoom: vp.zoom, dirty: dirty.all || dirty.structural || dirty.links ? null : dirty.edges });
      }
      // edges touching dirty items move with them
      if (dirty.items.size && !dirty.all && !dirty.structural) {
        edgesR.update({ board: b, edgeUids: edgesTouching(b, dirty.items), rects: r, zoom: vp.zoom, linkKeys: new Set((session.links || []).map((l) => l.key)), links: session.links || [] });
      }
    }
    if (dirty.viewport) {
      world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
      // The tier flips (classes + font variables, once) the moment the zoom crosses the threshold, mid-gesture too.
      const nextTier = lodTier(vp.zoom, tier, { threshold: mapThreshold() });
      if (nextTier !== tier) { tier = nextTier; paintTier(); }
      const g = gridBackground(vp, bgPattern);
      if (g) {
        grid.style.backgroundSize = `${g.size}px ${g.size}px`;
        grid.style.backgroundPosition = `${g.x}px ${g.y}px`;
        if (bgPattern === "grid") {
          const mod = (v) => ((v % g.major) + g.major) % g.major;
          grid.style.setProperty("--pxd-grid-major", `${g.major}px`);
          grid.style.setProperty("--pxd-grid-major-x", `${mod(vp.x)}px`);
          grid.style.setProperty("--pxd-grid-major-y", `${mod(vp.y)}px`);
        }
      }
      chrome.toolbar.setZoom(vp.zoom);
    }
    if (dirty.selection || itemsChanged) {
      itemsR.setSelection(selection.items);
      edgesR.setSelection({ edge: selection.edge, link: selection.link });
      if (!gesturing && !itemsR.isEditing()) showCtx(); else chrome.ctx.hide();
      if (focusOn) applyFocus();
    } else if (dirty.viewport && chrome.ctx.isOpen()) {
      chrome.ctx.reposition();
    }
    if (dirty.viewport || itemsChanged || dirty.minimap) chrome.minimap.update({ board: b, rects: effectiveRects(), vp, size });
    if (itemsChanged && !gesturing) {
      scheduleContent();
      updateBackToContent();
      panel.refreshOutline();
      if (dirty.all || dirty.structural) scheduleBadges(50);
    }
    if (searchMatches.length || root.classList.contains("pxd-root--searching")) panel.refreshMarks();
    dirty.minimap = false;
    dirty.viewport = false;
    dirty.items = new Set();
    dirty.edges = new Set();
    dirty.structural = false;
    dirty.all = false;
    dirty.selection = false;
    dirty.links = false;
  };

  // ------------------------------------------------------------ boot
  applyFullscreen(fullscreen);
  measure();
  if (autofocus) { try { root.focus({ preventScroll: true }); } catch { /* stub */ } }
  if (!vp) {
    const b = board();
    const r = b ? rects() : new Map();
    vp = fitViewport(boundsOf([...r.values()]), size.width && size.height ? size : { width: 800, height: 560 }, { padding: 64, maxZoom: 1 });
  }
  applyBackground();
  applyLod();
  itemsR.setShowBadges(flag("show-card-badges", true));
  dirty.viewport = true;
  markAll();
  timers.later(() => { if (!disposed) { scheduleContent(); updateBackToContent(); } }, 0);

  // ------------------------------------------------------------ API
  const view = {
    root,
    controller: ctl,
    setFullscreen(on) { if (Boolean(on) !== isFullscreen) applyFullscreen(on); },
    fit() { fitAll(); },
    // Swap the settings object (feature.js calls this when a setting changes) and re-apply what depends on it.
    setSettings(next) {
      if (disposed) return;
      const minimapBefore = setting("show-minimap", true) !== false;
      settingsRef = next;
      applyBackground();
      applyLod();
      const minimapNow = setting("show-minimap", true) !== false;
      if (minimapNow !== minimapBefore) chrome.minimap.setVisible(minimapNow);
      itemsR.setShowBadges(flag("show-card-badges", true));
      scheduleContent();
      scheduleBadges(0);
      dirty.viewport = true;
      schedule();
    },
    state() {
      return {
        zoom: vp.zoom,
        lod: tier,
        pattern: bgPattern,
        tone: bgTone ?? null,
        focus: focusOn,
        present: presenter.isActive(),
        selection: [...selection.items],
        mounted: itemsR.mountedCount(),
        menuOpen: menu.isOpen(),
      };
    },
    // Serializes the board to SVG text; with download it also offers the file through a temporary link.
    async exportSvg({ download = true } = {}) {
      const b = board();
      if (!b) return "";
      const text = boardToSvg(b, rects(), { dark: root.classList.contains("pxd-root--dark") });
      if (download) {
        try {
          const blob = new Blob([text], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement("a");
          a.href = url;
          a.download = `${String(b.title || UNTITLED_BOARD).replace(/[\\/:*?"<>|]+/g, "-").trim() || "board"}.svg`;
          doc.body.append(a);
          a.click();
          a.remove();
          timers.later(() => URL.revokeObjectURL(url), 4000);
        } catch { /* no Blob / URL in this environment: the text is still returned */ }
      }
      return text;
    },
    async copyOutline() {
      const b = board();
      if (!b) return "";
      const text = boardToMarkdown(b, rects());
      const ok = await writeClipboard({ text });
      if (!disposed) toast(ok ? "Outline copied" : "Copy failed");
      return text;
    },
    stats() {
      return { timers: timers.count(), listeners: listeners.length + (captured ? 3 : 0), observers: observers.length, mounted: itemsR.mountedCount(), shells: itemsR.shellCount() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctl.cancel();
      releaseCapture();
      if (heightDrag) onHeightUp();
      subs.splice(0).forEach((off) => { try { off?.(); } catch { /* already off */ } });
      routeOff();
      fsDispose();
      applyFullscreenChrome(mountEl, false, doc);
      vpStore.flush?.();
      resumeTimer?.();
      settleTimer?.();
      frameHandle?.();
      badgeTimer?.();
      menu.dispose();
      quicklook.dispose();
      presenter.dispose();
      clip.dispose();
      itemsR.dispose();
      edgesR.dispose();
      panel.dispose();
      chrome.dispose();
      listeners.splice(0).forEach((off) => off());
      observers.splice(0).forEach((o) => o.disconnect());
      timers.cancelAll();
      root.remove();
      // The acquirer (feature.js) owns session.release(); a second release here destroyed shared sessions.
      released = true;
    },
  };
  return view;
}
