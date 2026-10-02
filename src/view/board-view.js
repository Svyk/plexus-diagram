// Board view: DOM root, layers, render scheduler, culling, LOD (spec 3.2). One rAF loop that
// runs only when dirty; pan/zoom write one transform on .pxd-world plus the grid background.
// Entry used by feature.js: mountBoardView(...) → { root, setFullscreen, fit, dispose, stats, setSettings,
// state, exportSvg, copyOutline }.
//
// 1.2 wiring: three-tier LOD flipped by class during a gesture, board backgrounds (pattern + tone), live
// section auto-fit preview, context menu, clipboard, focus, presentation, card badges, back-to-content.

import { BOARD_PATTERNS, BOARD_TONES, DEFAULT_BOARD_CARD, DEFAULT_SIZES, LANE_SIZE, STICKY_SIZE, UNTITLED_BOARD, classifyString, hexColor, semanticRef, plainText } from "../model/schema.js";
import { boundsOf, buildBoard, connectedUids, containerAt, descendantsOf, displayRects, edgesTouching, outlineOrder, sameColorUids, sectionAllUids, sectionFitPlan, sectionNoteUid, sidebarOutlineUids, worldRects } from "../model/board.js";
import { copyLinkText, hashFromUrl, pageUidFromHash, pxdTarget } from "../model/deeplink.js";
import { findOnBoard } from "../model/find.js";
import { readMindPreset, writeMindPreset } from "../model/mindmap.js";
import { attrLegend, parseAttrStyles, styleAttrLinks } from "../model/attr-styles.js";
import { lensBright, lensCatalog, tagsForCard } from "../model/lens.js";
import { dropNamespace } from "../model/namespace.js";
import { neighborLayout } from "../model/neighbors.js";
import { isQueryString, queryResultLayout, queryResultUids } from "../model/query.js";
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
import { PLEXUS_MIME, copyPayload, editorPastePlan, imageMarkdown, inlineAtCaret, parsePastedText } from "../model/clipboard.js";
import { boardToMarkdown, boardToSvg, dropExternalImages, imageSrc, pngFileName, sliceBoard } from "../model/export.js";
import { createInteractions } from "./interactions.js";
import { createItemRenderer, isTextEntryTarget } from "./cards.js";
import { editorKeyAction, inputBlockRole } from "./editor-keys.js";
import { createEdgeLayer } from "./edges.js";
import { createChrome, LINK_MODES } from "./chrome.js";
import { mountTable } from "./table-view.js";
import { mountKanban } from "./kanban-view.js";
import { createPropsPanel } from "./props-panel.js";
import { PANEL_WIDTH_DEFAULT, nextPanelWidth } from "../model/info.js";
import { createPanel, parseDropPayload } from "./panel.js";
import { createMenu } from "./menu.js";
import { buildMenu } from "./menu-model.js";
import { createQuickLook } from "./quicklook.js";
import { createPresenter } from "./present.js";
import { createClipboardIO, filesFromDataTransfer, writeClipboard } from "./clipboard-io.js";
import { applyFullscreenChrome, watchRouteExit } from "./fullscreen.js";
import { embedOwnerUid } from "../discovery.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// The board under the pointer. Focus inside a board wins over this; fullscreen does not.
let pointerBoard = null;

// Sidebar window ids look like sidebar-window-sidebar-block-<uid> or sidebar-outline- / mentions.
export function sidebarMountKind(nativeEl) {
  const win = nativeEl?.closest?.(".rm-sidebar-window");
  if (!win) return "main";
  const id = String(win.id || "");
  if (id.includes("mentions")) return "mentions";
  if (id.includes("outline")) return "outline";
  return "block";
}

// Main keeps the 1.2 key. A sidebar copy adds the window kind. An embed adds the
// embed block uid, so two copies of one board do not share a pan or overwrite the main camera.
export function viewportStorageId(nativeEl, boardUid, readString) {
  const kind = sidebarMountKind(nativeEl);
  if (kind !== "main") return `${boardUid}:${kind}`;
  const owner = embedOwnerUid(nativeEl, readString);
  if (owner) return `${boardUid}:embed:${owner}`;
  return boardUid;
}
const DEFAULT_HEIGHT = 560;

function rasterizeSvg(doc, svg) {
  return new Promise((resolve, reject) => {
    const Img = doc.defaultView?.Image || globalThis.Image;
    if (typeof Img !== "function" || typeof URL === "undefined" || typeof Blob === "undefined") { resolve(null); return; }
    const img = new Img();
    let url = "";
    try { url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); }
    catch { resolve(null); return; }
    img.onload = () => {
      try {
        const canvas = doc.createElement("canvas");
        const w = img.naturalWidth || img.width || 1;
        const h = img.naturalHeight || img.height || 1;
        canvas.width = Math.max(1, Math.round(w * 2));
        canvas.height = Math.max(1, Math.round(h * 2));
        const g = canvas.getContext?.("2d");
        if (!g || typeof canvas.toBlob !== "function") { URL.revokeObjectURL(url); resolve(null); return; }
        g.setTransform(2, 0, 0, 2, 0, 0);
        g.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob); }, "image/png");
      } catch (err) { try { URL.revokeObjectURL(url); } catch { /* already revoked */ } reject(err); }
    };
    img.onerror = () => { try { URL.revokeObjectURL(url); } catch { /* already revoked */ } resolve(null); };
    img.src = url;
  });
}

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

// Roam's textarea is controlled. A DOM write only sticks when the native setter fires input.
function commitTextareaValue(el, value) {
  if (!el) return;
  const view = el.ownerDocument?.defaultView || globalThis;
  const Proto = view.HTMLTextAreaElement;
  const set = Proto && Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set;
  if (typeof set === "function") {
    try { set.call(el, value); } catch { el.value = value; }
  } else el.value = value;
  try {
    const Ev = view.Event || globalThis.Event;
    if (typeof Ev === "function" && typeof el.dispatchEvent === "function") {
      el.dispatchEvent(new Ev("input", { bubbles: true }));
      el.dispatchEvent(new Ev("change", { bubbles: true }));
    }
  } catch { /* stub event */ }
}
const MIN_HEIGHT = 240;
const RESUME_MS = 120;
const VP_PERSIST_MS = 500;
const SECTION_TITLE_ALLOWANCE = 32; // px: section title pill (20 + padding) plus its 4px lift, fits above the frame
const CULL_MARGIN = 0.5;
const BADGE_TTL_MS = 120000;
const BADGE_CHUNK = 12;
const NATIVE_MENU_TARGETS = ".rm-page-ref, .rm-block-ref, [data-link-uid], a[href], img";

// A checkbox toggles and an image opens Roam's viewer. A page or block ref navigates.
// These must not be turned into "enter edit" by the card's own click.
function nativeClickKind(node) {
  if (!node || typeof node.closest !== "function") return null;
  if (node.closest("img")) return "image";
  const box = node.closest("input, label, .check-container");
  if (box) {
    const tag = String(box.tagName || "").toLowerCase();
    if (tag === "input") {
      if (String(box.getAttribute?.("type") || "").toLowerCase() === "checkbox") return "checkbox";
    } else if (box.classList?.contains("check-container") || box.querySelector?.('input[type="checkbox"]')) {
      return "checkbox";
    }
  }
  if (node.closest("[data-link-uid], .rm-page-ref, .rm-block-ref")) return "ref";
  return null;
}

// renderString draws a checkbox with no block of its own, so the click has to flip the card string.
// A page linked from more than ten blocks asks before data.page.update rewrites every reference.
export function pageRenameNeedsConfirm(refCount) {
  return Number(refCount) > 10;
}

export function toggleTodoAt(string, index = 0) {
  if (typeof string !== "string") return null;
  const marks = [...string.matchAll(/\{\{\[\[(?:TODO|DONE)\]\]\}\}/g)];
  const mark = marks[index];
  if (!mark) return null;
  const next = mark[0].includes("TODO") ? "{{[[DONE]]}}" : "{{[[TODO]]}}";
  return string.slice(0, mark.index) + next + string.slice(mark.index + mark[0].length);
}
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
  onHistoryBack = null,
  onHistoryForward = null,
  initialViewport = null,
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
  // Main keeps the 1.2 key. A sidebar copy adds the window kind. An embed keeps its own key.
  const readBlock = (id) => {
    try { return host?.blockString?.(id); } catch { return null; }
  };
  const inSidebar = sidebarMountKind(nativeEl) !== "main";
  const vpId = viewportStorageId(nativeEl, boardUid, readBlock);
  const embedCopy = vpId !== boardUid && vpId.startsWith(`${boardUid}:embed:`);
  let vp = vpStore.get(vpId);
  // Start from the main camera, but never write that key from this copy.
  if (!vp && embedCopy) {
    const main = vpStore.get(boardUid);
    if (main && Number.isFinite(main.x) && Number.isFinite(main.y) && Number.isFinite(main.zoom) && main.zoom > 0) {
      vp = { x: main.x, y: main.y, zoom: main.zoom };
    }
  }
  if (
    initialViewport
    && Number.isFinite(initialViewport.x)
    && Number.isFinite(initialViewport.y)
    && Number.isFinite(initialViewport.zoom)
    && initialViewport.zoom > 0
  ) {
    vp = { x: initialViewport.x, y: initialViewport.y, zoom: initialViewport.zoom };
  }
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
  let bgHex = null;
  let bgOverride = false;
  let focusOn = false;
  let focusKey = null;
  let lensTag = null;
  let lensIndex = new Map();
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

  // A sidebar root has no enhanced ancestor, so the collapsed board mounts here as a canvas.
  // Outline renders each top-level block (and Connections) without writing :block/open.
  let outlineMode = false;
  let outlineHost = null;
  let outlineKey = "";
  let outlineBtn = null;
  let boardBtn = null;
  const clearOutline = () => {
    if (!outlineHost) return;
    for (const row of [...outlineHost.children]) {
      try { host?.unmount?.(row); } catch { /* stub */ }
    }
    outlineHost.replaceChildren();
  };
  const syncOutline = (force = false) => {
    if (!outlineMode || !outlineHost || disposed) return;
    const key = sidebarOutlineUids(board()).join("\n");
    if (!force && key === outlineKey) return;
    outlineKey = key;
    clearOutline();
    if (typeof host?.renderBlock !== "function") return;
    for (const uid of sidebarOutlineUids(board())) {
      const row = el("div", "pxd-sidebar-outline__row", outlineHost);
      row.dataset.uid = uid;
      row.setAttribute("data-uid", uid);
      try { host.renderBlock(row, uid); } catch { /* render failed */ }
    }
  };
  let tableMode = false;
  let tableCtl = { open() {}, close() {}, refresh() {}, dispose() {} };
  let kanbanMode = false;
  let kanbanCtl = { open() {}, close() {}, refresh() {}, dispose() {} };
  const leaveOutline = () => {
    outlineMode = false;
    root.classList.remove("pxd-root--outline");
    outlineBtn?.classList.toggle("pxd-mode__btn--on", false);
    boardBtn?.classList.toggle("pxd-mode__btn--on", true);
    outlineKey = "";
    clearOutline();
  };
  const setTable = (on) => {
    const next = Boolean(on);
    if (next && outlineMode) leaveOutline();
    if (next && kanbanMode) setKanban(false);
    tableMode = next;
    root.classList.toggle("pxd-root--table", tableMode);
    chrome?.toolbar?.setTable?.(tableMode);
    if (tableMode) tableCtl.open();
    else tableCtl.close();
  };
  const setKanban = (on) => {
    const next = Boolean(on);
    if (next && outlineMode) leaveOutline();
    if (next && tableMode) setTable(false);
    kanbanMode = next;
    root.classList.toggle("pxd-root--kanban", kanbanMode);
    chrome?.toolbar?.setKanban?.(kanbanMode);
    if (kanbanMode) kanbanCtl.open();
    else kanbanCtl.close();
  };
  const setOutline = (on) => {
    outlineMode = Boolean(on);
    if (outlineMode && tableMode) setTable(false);
    if (outlineMode && kanbanMode) setKanban(false);
    root.classList.toggle("pxd-root--outline", outlineMode);
    outlineBtn?.classList.toggle("pxd-mode__btn--on", outlineMode);
    boardBtn?.classList.toggle("pxd-mode__btn--on", !outlineMode);
    if (outlineMode) syncOutline(true);
    else { outlineKey = ""; clearOutline(); }
  };
  if (inSidebar) {
    root.classList.add("pxd-root--sidebar");
    const modeBar = el("div", "pxd-mode pxd-chrome", root);
    modeBar.setAttribute("role", "group");
    modeBar.setAttribute("aria-label", "Sidebar view");
    const modeBtn = (cls, label, on) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `pxd-mode__btn ${cls}`;
      b.textContent = label;
      modeBar.append(b);
      listen(b, "click", on);
      return b;
    };
    outlineBtn = modeBtn("pxd-mode__outline", "Outline", () => setOutline(true));
    boardBtn = modeBtn("pxd-mode__board", "Board", () => setOutline(false));
    outlineHost = el("div", "pxd-sidebar-outline pxd-chrome", root);
  }

  const rects = () => session.rects || worldRects(board());
  const effectiveRects = () => {
    if (!liveRects) return rects();
    const merged = new Map(rects());
    for (const [k, v] of liveRects) merged.set(k, v);
    return merged;
  };
  // Paint and hit-test. Stored rects stay on `rects()` so a collapse never writes section h.
  const paintRects = () => {
    const b = board();
    const base = effectiveRects();
    return b ? displayRects(b, base) : base;
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
    onRenamePage: (from, to) => {
      const n = Number(host?.pageRefCount?.(from)) || 0;
      const go = () => host?.renamePage?.(from, to);
      if (!pageRenameNeedsConfirm(n)) return go();
      chrome.toast.show({
        message: `${n} blocks link to ${from}. Rename it to ${to}?`,
        action: { label: "Rename", run: () => { void go(); } },
      });
      return false;
    },
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
      vpStore.set(vpId, vp);
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
    const r = paintRects();
    const bounds = boundsOf(selection.items.map((u) => r.get(u)).filter(Boolean));
    return bounds ? { kind: "items", rect: toScreenRect(bounds) } : null;
  };
  const refCountOf = (item) => {
    if (!item || item.type !== "card") return 0;
    const key = badgeKeyOf(item);
    const hit = badgeCache.get(key);
    if (hit) return Number(hit.stats?.refs) || 0;
    if (typeof host?.cardStats !== "function") return 0;
    let res;
    try { res = host.cardStats([badgeTargetOf(item)], { boardUid }); } catch { return 0; }
    const stats = (res instanceof Map ? res.get(key) : res?.[key]) || { refs: 0, boards: 0, open: 0, done: 0 };
    badgeCache.set(key, { at: Date.now(), stats });
    return Number(stats.refs) || 0;
  };
  const cardModel = (item) => (item?.type === "card" ? { ...item, refs: refCountOf(item) } : item);
  const sectionModel = (item) => {
    const b = board();
    const uids = b ? [item.uid, ...descendantsOf(b, item.uid)] : [item.uid];
    return {
      ...item,
      hasNote: Boolean(b && sectionNoteUid(b, item.uid)),
      locked: Boolean(b) && uids.every((u) => b.items.get(u)?.pinned),
    };
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
    const kind = it.type === "section" ? "section" : it.type === "text" ? "text" : it.kind === "board" ? "board" : "card";
    const model = it.type === "section" ? sectionModel(it) : cardModel(it);
    return chrome.ctx.show(kind, model, ctxAnchor);
  };

  // ------------------------------------------------------------ session mutations used by chrome
  const targetUids = () => (selection.edge ? [selection.edge] : selection.items);
  const singleItem = () => (selection.items.length === 1 ? board()?.items.get(selection.items[0]) : null);
  let hoverUid = null;
  const selectionOwnsBar = () => Boolean(selection.edge || selection.link || selection.items.length);
  const barCard = () => {
    const sel = singleItem();
    if (sel?.type === "card") return sel;
    if (!selectionOwnsBar() && hoverUid) {
      const it = board()?.items.get(hoverUid);
      if (it?.type === "card") return it;
    }
    return null;
  };
  const mentionsUid = (item) => {
    if (!item) return null;
    if (item.target?.kind === "page") return host?.pageUid?.(item.target.title) || null;
    if (item.target?.kind === "block") return item.target.uid || null;
    return item.uid;
  };
  const openBoardOutline = () => {
    const uid = board()?.uid;
    if (uid) host?.openInSidebar?.(uid, "outline");
  };
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
  const openOwnPage = (item) => {
    const target = item ? boardTargetOf(item.uid) : null;
    if (target) host?.openBlock?.(target);
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
    const ownHex = hexColor(own?.bgColor) || null;
    const ownTone = ownHex ? null : (BOARD_TONES.includes(own?.bgColor) ? own.bgColor : null);
    const defPattern = setting("grid", "dots");
    const defTone = setting("board-tone", "none");
    const pattern = ownPattern ?? (BOARD_PATTERNS.includes(defPattern) ? defPattern : "dots");
    const tone = ownHex ? null : (ownTone ?? (BOARD_TONES.includes(defTone) ? defTone : null));
    const override = ownPattern !== null || ownTone !== null || ownHex !== null;
    if (pattern === bgPattern && tone === bgTone && ownHex === bgHex && override === bgOverride) return;
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
    if (ownHex !== bgHex) {
      if (ownHex) {
        root.style.backgroundColor = ownHex;
        root.style.setProperty("--pxd-label-bg", ownHex);
      } else {
        root.style.backgroundColor = "";
        root.style.removeProperty("--pxd-label-bg");
      }
      bgHex = ownHex;
    }
    bgOverride = override;
    chrome.toolbar.setBackground({ pattern, tone: ownHex || tone, override });
  };
  const applyMotion = () => {
    const motion = setting("motion", "full");
    root.classList.toggle("pxd-root--motion-off", motion === "reduced" || motion === "none");
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
  const extraTagText = (item) => {
    try {
      if (item?.kind === "page" && item.target?.title) {
        const page = host?.pullPage?.(item.target.title);
        return (page?.[":block/children"] || []).map((kid) => kid?.[":block/string"] || "").filter(Boolean).join("\n");
      }
      if (item?.kind === "block" && item.target?.uid) return host?.blockString?.(item.target.uid) || "";
    } catch { /* a missing page is not a tag */ }
    return "";
  };
  const rebuildLens = () => {
    const cards = [];
    for (const item of board()?.items.values() || []) {
      if (!item || item.type === "section") continue;
      cards.push({ uid: item.uid, tags: tagsForCard(item, extraTagText(item)) });
    }
    const catalog = lensCatalog(cards);
    lensIndex = catalog.byUid;
    return catalog;
  };
  const applyFocus = () => {
    if (disposed) return;
    const focus = focusSetNow();
    const set = lensTag ? lensBright(lensIndex, lensTag, focus) : focus;
    const key = `${lensTag || ""}|${set ? [...set].sort().join("|") : ""}`;
    root.classList.toggle("pxd-root--focus", Boolean(set) || focusOn || Boolean(lensTag));
    chrome.toolbar.setFocus(focusOn);
    chrome.toolbar.setLens?.(Boolean(lensTag));
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
  const expandOutline = (uid, patch) => {
    const preset = patch ? writeMindPreset(storage, patch) : readMindPreset(storage);
    Promise.resolve(session.expandOutline?.(uid, preset)).then((res) => {
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
  const editorTextarea = (node) => {
    if (!node) return null;
    if (String(node.tagName || "").toLowerCase() === "textarea") return node;
    const editor = node.closest?.(".pxd-item__editor");
    if (!editor) return null;
    const active = doc.activeElement;
    if (active && editor.contains?.(active) && String(active.tagName || "").toLowerCase() === "textarea") return active;
    return editor.querySelector?.("textarea") || null;
  };
  const remountEditor = async (cardUid) => {
    if (!cardUid || itemsR.editingUid?.() !== cardUid || disposed) return;
    await itemsR.exitEdit({ silent: true });
    if (disposed || !session.board?.items?.has?.(cardUid)) return;
    await itemsR.enterEdit(cardUid);
  };
  const pasteEditorImages = async (ta, blockUid, files) => {
    if (!files?.length || !blockUid) return;
    if (typeof host?.uploadFile !== "function") { toast("Image upload is not available here"); return; }
    const snap = { value: ta?.value ?? "", start: ta?.selectionStart, end: ta?.selectionEnd };
    const cardUid = itemsR.editingUid?.();
    const urls = [];
    let failed = 0;
    for (const file of files) {
      try { urls.push(await host.uploadFile(file)); }
      catch (err) {
        if (err?.message === "upload-unavailable") { if (!disposed) toast("Image upload is not available here"); return; }
        failed += 1;
      }
      if (disposed) return;
    }
    if (!urls.length) { if (!disposed) toast("Couldn't upload the image"); return; }
    const placed = inlineAtCaret(snap.value, snap.start, snap.end, imageMarkdown(urls));
    if (ta) {
      commitTextareaValue(ta, placed.string);
      try { ta.setSelectionRange?.(placed.caret, placed.caret); } catch { /* caret */ }
    }
    try {
      const write = () => host.updateString(blockUid, placed.string);
      if (host.group) await host.group(write);
      else await write();
    } catch { if (!disposed) toast("Couldn't upload the image"); return; }
    if (disposed) return;
    if (failed) toast(`Added ${urls.length} of ${files.length} images`);
    await remountEditor(cardUid);
  };
  const pasteEditorBlocks = async (ta, blockUid, plan) => {
    if (!blockUid || plan?.type !== "blocks") return;
    if (typeof host?.updateString !== "function" || typeof host?.createBlock !== "function") return;
    const cardUid = itemsR.editingUid?.();
    if (ta) commitTextareaValue(ta, plan.string);
    try {
      const write = async () => {
        await host.updateString(blockUid, plan.string);
        for (const line of plan.children) await host.createBlock({ parentUid: blockUid, order: "last", string: line });
      };
      if (host.group) await host.group(write);
      else await write();
    } catch { return; }
    if (disposed) return;
    await remountEditor(cardUid);
  };
  const editorPaste = (event) => {
    const ta = editorTextarea(event.target) || editorTextarea(doc.activeElement);
    if (!ta || !root.contains?.(ta)) return false;
    const files = filesFromDataTransfer(event.clipboardData);
    let text = "";
    try { text = event.clipboardData?.getData?.("text/plain") ?? ""; } catch { text = ""; }
    const cardUid = itemsR.editingUid?.();
    const role = inputBlockRole(ta, cardUid);
    const plan = editorPastePlan({
      text,
      imageCount: files.length,
      value: ta.value ?? "",
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
      isRoot: role.role === "root",
    });
    if (!plan || plan.type === "roam") return false;
    const blockUid = role.uid || cardUid;
    if (!blockUid) return false;
    if (plan.type === "images") { void pasteEditorImages(ta, blockUid, files); return true; }
    void pasteEditorBlocks(ta, blockUid, plan);
    return true;
  };

  // ------------------------------------------------------------ context menu
  const menuContext = (kind, uid) => {
    const b = board();
    const item = uid ? b?.items.get(uid) : null;
    switch (kind) {
      case "canvas": return { canPaste: true, snapshots: b?.snapshots || [] };
      case "board-menu": return { snapshots: b?.snapshots || [] };
      case "card": {
        let queryText = item?.string || "";
        if (!isQueryString(queryText) && item?.target?.kind === "block") {
          try { queryText = host?.blockString?.(item.target.uid) || ""; } catch { queryText = ""; }
        }
        const canExpand = item?.kind === "page" || item?.kind === "note" || item?.kind === "block";
        return { item, isBoard: item?.kind === "board", collapsed: Boolean(item?.collapsed), pinned: Boolean(item?.pinned), hasOutline: NOTE_KINDS.includes(item?.kind), isQuery: isQueryString(queryText), canExpand, mindPreset: readMindPreset(storage) };
      }
      case "section": {
        const members = item && b ? [item.uid, ...descendantsOf(b, item.uid)] : [];
        return {
          item,
          count: item?.members?.length ?? 0,
          fitOn: item?.autofit !== false,
          pinned: Boolean(item?.pinned),
          collapsed: Boolean(item?.collapsed),
          hasNote: Boolean(item && sectionNoteUid(b, item.uid)),
          locked: members.length > 0 && members.every((u) => b.items.get(u)?.pinned),
        };
      }
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
    if (type === "sticky") {
      const d = STICKY_SIZE;
      const uid = await actions.createText({ x: world.x - d.w / 2, y: world.y - d.h / 2, look: "sticky" });
      if (uid && !disposed) { ctl.select([uid]); void enterEdit(uid); }
      return;
    }
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
      case "new-sticky": void createAt("sticky", world); break;
      case "new-section": {
        const d = DEFAULT_SIZES.section;
        Promise.resolve(session.createSection?.({ rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "new-lane-h":
      case "new-lane-v": {
        const vertical = head === "new-lane-v";
        const d = vertical ? LANE_SIZE.vertical : LANE_SIZE.horizontal;
        Promise.resolve(session.createSection?.({
          rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h },
          title: "Lane",
          look: "lane",
          axis: vertical ? "vertical" : "horizontal",
        })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "new-board": {
        const d = DEFAULT_BOARD_CARD;
        Promise.resolve(session.createBoard?.({ rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "template": {
        const d = DEFAULT_BOARD_CARD;
        const rect = { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h };
        Promise.resolve(session.insertTemplate?.(arg, rect)).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "save-template":
        Promise.resolve(session.saveAsTemplate?.()).catch(() => {});
        break;
      case "save-snapshot":
        Promise.resolve(session.saveSnapshot?.()).catch(() => {});
        break;
      case "snapshot": {
        const snap = b.snapshots?.find((item) => item.uid === arg);
        const title = snap?.title || "this snapshot";
        chrome.toast.show({
          message: `Restore ${title}? Layouts are rewritten in groups of 45.`,
          action: { label: "Restore", run: () => { void session.restoreSnapshot?.(arg); } },
        });
        break;
      }
      case "delete-snapshot":
        Promise.resolve(session.deleteSnapshot?.(arg)).catch(() => {});
        break;
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
      case "export-png": void exportPng(); break;
      case "copy-png": {
        let ids = uids;
        if ((!ids || !ids.length) && mc.kind === "edge" && edgeUid) {
          const edge = b.edges.get(edgeUid);
          if (edge) ids = [edge.from, edge.to];
        }
        void copySelectionPng(ids);
        break;
      }
      case "copy-outline": void view.copyOutline(); break;
      case "open-outline": openBoardOutline(); break;
      case "edit": if (item) { if (item.kind === "board") itemsR.renameBoard(item.uid); else void enterEdit(item.uid); } break;
      case "open": openItem(item); break;
      case "open-own-page": openOwnPage(item); break;
      case "open-sidebar": openItemInSidebar(item); break;
      case "copy": doCopy(uids); break;
      case "copy-ref": if (item) copyText(`((${item.uid}))`, "Reference copied"); break;
      case "copy-link": {
        if (!item) break;
        let pageUid = "";
        try { pageUid = host?.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
        if (!pageUid) pageUid = pageUidFromHash(win?.location?.hash || "");
        copyText(copyLinkText(item, { graph, pageUid }), "Link copied");
        break;
      }
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
      case "neighbors": {
        if (!item || !arg) break;
        let titles = [];
        try { titles = host?.neighborPages?.(item, arg, { boardUid }) || []; } catch { titles = []; }
        const have = [];
        for (const other of b.items.values()) {
          if (other.target?.kind === "page" && other.target.title) have.push(other.target.title);
        }
        const list = neighborLayout(rects().get(item.uid), titles, { skip: have });
        if (!list.length) { toast("No pages to add"); break; }
        const made = session.addRefCards?.(list);
        Promise.resolve(made).then((ids) => {
          if (disposed) return;
          if (Array.isArray(ids) && ids.length) ctl.select(ids);
          toast(`Added ${list.length} ${list.length === 1 ? "page" : "pages"}`, true);
        }).catch(() => {});
        break;
      }
      case "query-results": {
        if (!item) break;
        const sourceUid = isQueryString(item.string) ? item.uid : (item.target?.kind === "block" ? item.target.uid : item.uid);
        const live = root.querySelector?.(`[data-uid="${item.uid}"] .pxd-item__query .pxd-rs__live`);
        const list = queryResultLayout(rects().get(item.uid), queryResultUids(live, sourceUid));
        if (!list.length) { toast("No results in this query"); break; }
        const made = session.addRefCards?.(list);
        Promise.resolve(made).then((ids) => {
          if (disposed) return;
          if (Array.isArray(ids) && ids.length) ctl.select(ids);
          toast(`Added ${list.length} ${list.length === 1 ? "card" : "cards"} from the query`, true);
        }).catch(() => {});
        break;
      }
      case "mind-dir": if (item && arg) expandOutline(item.uid, { direction: arg }); break;
      case "mind-space": if (item && arg) expandOutline(item.uid, { spacing: arg }); break;
      case "mind-depth": if (item && arg) expandOutline(item.uid, { depth: Number(arg) }); break;
      case "mind-refs": if (item && arg) expandOutline(item.uid, { includeRefs: arg !== "skip" }); break;
      case "mind-color": if (item && arg) expandOutline(item.uid, { colorBranches: arg === "on" }); break;
      case "send-to": startSendTo(uids); break;
      case "related": panel.open("related"); break;
      case "delete": case "delete-frame": ctl.deleteSelection(false); break;
      case "delete-contents": ctl.deleteSelection(true); break;
      case "rename": if (item) itemsR.renameSection(item.uid); break;
      case "select-contents": if (item?.members?.length) ctl.select(item.members); break;
      case "select-all-in-section": {
        const all = item ? sectionAllUids(b, item.uid) : [];
        if (all.length) ctl.select(all);
        break;
      }
      case "select-same-color": {
        const same = item ? sameColorUids(b, item.uid) : [];
        if (same.length) ctl.select(same);
        break;
      }
      case "select-connected": {
        const linked = item ? connectedUids(b, item.uid) : [];
        if (linked.length) ctl.select(linked);
        break;
      }
      case "fit-section": if (item) void session.fitSection?.(item.uid); break;
      case "toggle-fit": if (item) void session.setFit?.(item.uid, item.autofit === false); break;
      case "tidy": void session.tidyItems?.(mc.kind === "board-menu" ? b.roots : uids, arg); break;
      case "sort-outline": void session.sortOutline?.(); break;
      case "fold-all-in": if (item) void session.collapseAll?.(true, { within: item.uid }); break;
      case "unfold-all-in": if (item) void session.collapseAll?.(false, { within: item.uid }); break;
      case "collapse-section": if (item?.type === "section") void session.setCollapsed?.(item.uid, !item.collapsed); break;
      case "section-note": if (item?.type === "section") void session.toggleSectionNote?.(item.uid); break;
      case "lock-contents": if (item?.type === "section") void session.lockSection?.(item.uid, true); break;
      case "unlock-contents": if (item?.type === "section") void session.lockSection?.(item.uid, false); break;
      case "present-section": if (item?.type === "section") startPresent(item.uid); break;
      case "size": if (item) void session.setFontSize?.(item.uid, Number(arg)); break;
      case "shape": if (item?.type === "text") void session.setItemStyle?.([item.uid], { shape: arg }); break;
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
  // Chrome is built before the panel, so Info is bound after createPanel.
  let openInfo = () => {};
  const chrome = createChrome({
    doc,
    root,
    version,
    settings: settingsProxy,
    timers,
    crumbs: crumbList,
    on: {
      openBoard: () => { const it = singleItem(); if (it) void openBoard(it.uid); },
      openOwnPage: () => openOwnPage(singleItem()),
      renameBoard: () => { const it = singleItem(); if (it) itemsR.renameBoard(it.uid); },
      crumb: (index) => { void goCrumb(index); },
      wrapBoard: () => wrapBoardSel(),
      setTool: (tool, lock) => ctl.setTool(tool, lock),
      togglePanel: () => panel.toggle(),
      openInfo: () => openInfo(),
      cycleLinks: () => cycleLinks(),
      toggleTable: () => setTable(!tableMode),
      toggleKanban: () => setKanban(!kanbanMode),
      zoomIn: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1.2)),
      zoomOut: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / 1.2)),
      zoomReset: () => setViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / vp.zoom)),
      fit: () => fitAll(),
      toggleMinimap: () => chrome.minimap.setVisible(!chrome.minimap.isVisible()),
      toggleFullscreen: () => requestFullscreen(!isFullscreen),
      editBlock: () => editBoardBlock(),
      savePng: () => { void exportPng(); },
      openOutline: () => openBoardOutline(),
      setColor: (c) => { const uids = targetUids(); if (uids.length) void session.setColor?.(uids, c); },
      edit: () => { const it = singleItem(); if (it) void enterEdit(it.uid); },
      openSidebar: () => openItemInSidebar(singleItem()),
      collapse: () => { const it = singleItem(); if (it) void session.setCollapsed?.(it.uid, !it.collapsed); },
      toggleOpen: () => { const it = barCard(); if (it) void session.setBlockOpen?.(it.uid, it.open === false); },
      showRefs: () => {
        const it = barCard();
        const uid = mentionsUid(it);
        if (uid) host?.openInSidebar?.(uid, "mentions");
      },
      related: () => panel.open("related"),
      delete: () => ctl.deleteSelection(false),
      rename: () => { const it = singleItem(); if (it) itemsR.renameSection(it.uid); },
      selectContents: () => { const it = singleItem(); if (it?.members?.length) ctl.select(it.members); },
      selectAllInSection: () => {
        const it = singleItem();
        const all = it ? sectionAllUids(board(), it.uid) : [];
        if (all.length) ctl.select(all);
      },
      selectSameColor: () => {
        const it = singleItem();
        const same = it ? sameColorUids(board(), it.uid) : [];
        if (same.length) ctl.select(same);
      },
      selectConnected: () => {
        const it = singleItem();
        const linked = it ? connectedUids(board(), it.uid) : [];
        if (linked.length) ctl.select(linked);
      },
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
      collapseSection: () => { const it = singleItem(); if (it?.type === "section") void session.setCollapsed?.(it.uid, !it.collapsed); },
      sectionNote: () => { const it = singleItem(); if (it?.type === "section") void session.toggleSectionNote?.(it.uid); },
      lockSection: (on) => { const it = singleItem(); if (it?.type === "section") void session.lockSection?.(it.uid, on !== false); },
      presentSection: () => { const it = singleItem(); if (it?.type === "section") startPresent(it.uid); },
      fold: (value) => setFolded(selection.items, Boolean(value)),
      sameSize: (mode) => { if (selection.items.length) void session.sameSize?.(selection.items, lastSelected(), mode); },
      toggleFocus: () => toggleFocus(),
      toggleLens: () => toggleLens(),
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
  const lensPop = el("div", "pxd-popover pxd-lens pxd-chrome", root);
  lensPop.style.display = "none";
  lensPop.setAttribute("role", "dialog");
  lensPop.setAttribute("aria-label", "Tag lens");
  let lensOffs = [];
  const closeLens = () => {
    lensOffs.splice(0).forEach((off) => off());
    lensPop.style.display = "none";
  };
  const paintLens = () => {
    const catalog = rebuildLens();
    lensPop.replaceChildren();
    const title = el("div", "pxd-popover__title", lensPop);
    title.textContent = "Tag lens";
    const all = el("button", `pxd-lens__row${lensTag ? "" : " is-on"}`, lensPop);
    all.type = "button";
    all.textContent = "All cards";
    all.dataset.tag = "";
    all.setAttribute("data-tag", "");
    if (!catalog.tags.length) {
      const empty = el("div", "pxd-lens__empty", lensPop);
      empty.textContent = "No tags on this board";
    }
    for (const tag of catalog.tags) {
      const row = el("button", `pxd-lens__row${tag === lensTag ? " is-on" : ""}`, lensPop);
      row.type = "button";
      row.textContent = `#${tag}`;
      row.dataset.tag = tag;
      row.setAttribute("data-tag", tag);
    }
  };
  const openLens = () => {
    if (lensPop.style.display !== "none") { closeLens(); return; }
    paintLens();
    lensPop.style.display = "";
    const btn = chrome.toolbar.lensButton;
    const rootRect = root.getBoundingClientRect();
    const b = btn?.getBoundingClientRect?.() || { left: rootRect.left, bottom: rootRect.top };
    const w = lensPop.offsetWidth || 200;
    const h = lensPop.offsetHeight || 120;
    const left = Math.max(8, Math.min(b.left - rootRect.left, (rootRect.width || 0) - w - 8));
    let top = b.bottom - rootRect.top + 6;
    if (rootRect.height && top + h > rootRect.height - 8) top = Math.max(8, rootRect.height - h - 8);
    lensPop.style.left = `${Math.round(left)}px`;
    lensPop.style.top = `${Math.round(top)}px`;
    const onDown = (event) => {
      if (lensPop.contains(event.target) || btn?.contains?.(event.target)) return;
      closeLens();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault?.();
      event.stopPropagation?.();
      closeLens();
    };
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("keydown", onKey, true);
    lensOffs = [() => doc.removeEventListener("pointerdown", onDown, true), () => doc.removeEventListener("keydown", onKey, true)];
  };
  const toggleLens = () => openLens();
  listen(lensPop, "click", (event) => {
    const row = event.target?.closest?.(".pxd-lens__row");
    if (!row || disposed) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const tag = row.dataset?.tag || row.getAttribute?.("data-tag") || "";
    lensTag = tag || null;
    if (lensTag) rebuildLens();
    closeLens();
    focusKey = null;
    applyFocus();
  });

  const PANEL_WIDTH_KEY = "plexus-diagram:panel-width";
  let panelWidth = PANEL_WIDTH_DEFAULT;
  try {
    const stored = Number(storage?.getItem?.(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored)) panelWidth = nextPanelWidth(stored, 0);
  } catch { /* private mode */ }
  const panel = createPanel({
    doc,
    root,
    host,
    timers,
    width: panelWidth,
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
      isFullscreen: () => isFullscreen,
      openSidebarEditor: (item) => openItemInSidebar(item),
      openRef: (uid) => host?.openInSidebar?.(uid, "block"),
      focusInfoTab: (uid) => ctl.select([uid]),
      rememberWidth: (w) => { try { storage?.setItem?.(PANEL_WIDTH_KEY, String(w)); } catch { /* private mode */ } },
    },
  });
  openInfo = () => {
    const it = singleItem();
    if (it && it.type !== "section") panel.addInfoTab(it);
    else panel.open("info");
  };
  const propsPanel = createPropsPanel({
    doc,
    root,
    storage,
    on: {
      setItemStyle: (patch) => { if (selection.items.length) void session.setItemStyle?.(selection.items, patch); },
      resetItems: () => { if (selection.items.length) void session.resetItemStyle?.(selection.items); },
      setSectionStyle: (patch) => { if (selection.items.length) void session.setSectionStyle?.(selection.items, patch); },
      resetSections: () => { if (selection.items.length) void session.resetSectionStyle?.(selection.items); },
      setEdge: (patch) => { if (selection.edge) void session.updateEdge?.(selection.edge, patch); },
      resetEdge: () => { if (selection.edge) void session.updateEdge?.(selection.edge, { dir: "one", route: "curve", dash: "solid", weight: 1, color: null }); },
      setDefaults: (patch) => { void session.setSectionDefaults?.(patch); },
      resetDefaults: () => { void session.resetSectionDefaults?.(); },
      setBackground: (patch) => {
        Promise.resolve(session.setBoardBackground?.(patch)).then((ok) => { if (ok === false && !disposed) toast("This board can't store a background"); }).catch(() => {});
      },
    },
  });
  const syncProps = () => {
    const b = board();
    if (!b) return;
    propsPanel.refresh({
      items: selection.items.map((id) => b.items.get(id)).filter(Boolean),
      edge: selection.edge ? b.edges.get(selection.edge) : null,
      board: b,
    });
  };
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
  const startPresent = (only) => {
    quicklook.close();
    const opts = only ? { only } : undefined;
    if (!presenter.start(board(), rects(), opts)) toast("Nothing to present");
  };
  chrome.minimap.setVisible(setting("show-minimap", true) !== false);
  chrome.toolbar.setLinkMode(linkMode);

  const cycleLinks = () => {
    linkMode = LINK_MODES[(LINK_MODES.indexOf(linkMode) + 1) % LINK_MODES.length];
    chrome.toolbar.setLinkMode(linkMode);
    session.setLinkMode?.(linkMode);
  };

  // Legend visibility is view state. Hiding a name filters the paint; it does not write.
  const hiddenAttrs = new Set();
  const legend = el("div", "pxd-legend pxd-chrome", root);
  legend.hidden = true;
  legend.setAttribute("hidden", "");
  const attrStyleMap = () => parseAttrStyles(setting("attr-styles", ""));
  const paintedLinks = () => styleAttrLinks(session.links || [], attrStyleMap(), hiddenAttrs);
  const paintLegend = () => {
    const rows = attrLegend(session.links || [], hiddenAttrs, attrStyleMap());
    legend.replaceChildren();
    if (!rows.length) {
      legend.hidden = true;
      legend.setAttribute("hidden", "");
      return;
    }
    legend.hidden = false;
    legend.removeAttribute("hidden");
    for (const row of rows) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = `pxd-legend__row pxd-c-${row.color}${row.on ? "" : " is-off"}`;
      btn.setAttribute("data-attr", row.name);
      btn.setAttribute("aria-pressed", row.on ? "true" : "false");
      btn.title = row.on ? `Hide ${row.name}` : `Show ${row.name}`;
      btn.textContent = row.name;
      legend.append(btn);
    }
  };
  listen(legend, "click", (ev) => {
    const btn = ev.target?.closest?.(".pxd-legend__row");
    if (!btn || disposed) return;
    ev.preventDefault();
    ev.stopPropagation();
    const name = btn.getAttribute("data-attr") || "";
    if (!name) return;
    if (hiddenAttrs.has(name)) hiddenAttrs.delete(name);
    else hiddenAttrs.add(name);
    if (selection.link) {
      const current = (session.links || []).find((l) => l.key === selection.link);
      const shown = current?.kind === "attr" ? current.labels?.[0] : "";
      if (shown && hiddenAttrs.has(shown)) selection.link = null;
    }
    dirty.links = true;
    dirty.selection = true;
    schedule();
  });

  // ------------------------------------------------------------ board search
  const nestedBoards = (b) => {
    const out = [];
    if (!b || typeof host?.pullBoard !== "function") return out;
    const seen = new Set();
    for (const item of b.items.values()) {
      const target = item.kind === "board" ? item.uid : (item.kind === "block" ? boardTargetOf(item.uid) : null);
      if (!target || target === b.uid || seen.has(target)) continue;
      seen.add(target);
      let raw = null;
      try { raw = host.pullBoard(target); } catch { raw = null; }
      if (!raw) continue;
      let child = null;
      try { child = buildBoard(raw); } catch { child = null; }
      if (child?.items) out.push({ parentUid: item.uid, board: child });
    }
    return out;
  };
  const paintSearch = (b, hits, q) => {
    const bright = new Set((hits || []).map((h) => h.focus));
    for (const item of b?.items.values() || []) {
      const shell = itemsR.shellOf(item.uid);
      const on = Boolean(q) && bright.has(item.uid);
      shell?.classList.toggle("pxd-item--dim", Boolean(q) && !on);
      shell?.classList.toggle("pxd-item--hit", on);
    }
    const edges = q ? new Set((hits || []).filter((h) => h.kind === "edge").map((h) => h.uid)) : null;
    edgesR.setSearch(edges);
  };
  const searchFilter = (text) => {
    const b = board();
    const q = String(text || "").trim().toLowerCase();
    searchIndex = -1;
    root.classList.toggle("pxd-root--searching", Boolean(q));
    searchMatches = b && q ? findOnBoard(b, q, nestedBoards(b)) : [];
    paintSearch(b, searchMatches, q);
    return searchMatches.length;
  };
  const searchNext = (dir = 1) => {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    const hit = searchMatches[searchIndex];
    if (hit?.focus && board()?.items.has(hit.focus)) {
      ctl.select([hit.focus]);
      fitSelection([hit.focus]);
    }
    const countEl = root.querySelector(".pxd-search__count");
    if (countEl) countEl.textContent = `${searchIndex + 1}/${searchMatches.length}`;
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

  // Inline "Edit Block": the raw {{[[diagram]]}} textarea. Esc unmounts it and the canvas is still here.
  let blockEdit = null;
  const closeBlockEdit = () => {
    if (!blockEdit) return;
    const node = blockEdit;
    blockEdit = null;
    node.remove();
    try { host?.unmount?.(node); } catch { /* not mounted */ }
  };
  const editBoardBlock = () => {
    if (blockEdit || disposed) return;
    const node = el("div", "pxd-block-edit pxd-chrome", root);
    for (const type of ["pointerdown", "pointerup", "mousedown", "click", "dblclick", "wheel"]) {
      node.addEventListener(type, (event) => event.stopPropagation());
    }
    blockEdit = node;
    try { host?.renderBlock?.(node, boardUid); }
    catch { closeBlockEdit(); return; }
    openRawBlockEditor(node);
  };
  // renderBlock shows the diagram. Native's own Edit Block control turns that into the raw textarea.
  const openRawBlockEditor = (node) => {
    if (node.querySelector?.("textarea")) return;
    const buttons = [...(node.querySelectorAll?.("button") || [])];
    const native = buttons.find((b) => (b.getAttribute?.("title") || b.title) === "Edit Block");
    if (!native) return;
    native.click?.();
    if (node.querySelector?.("textarea")) return;
    const propsKey = Object.keys(native).find((k) => k.startsWith("__reactProps"));
    const onClick = propsKey && native[propsKey]?.onClick;
    if (typeof onClick === "function") {
      onClick({ preventDefault() {}, stopPropagation() {}, target: native, currentTarget: native });
    }
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
    hitRects: () => paintRects(),
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
          vpStore.set(vpId, vp);
          dirty.selection = true;
          schedule();
          updateBackToContent();
          refreshBadges();
        }, RESUME_MS);
      }
    },
    showMarquee: (rect, kind) => edgesR.setMarquee(rect, kind),
    showLasso: (points) => edgesR.setLasso(points),
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
      const links = paintedLinks();
      const linkKeys = new Set(links.filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: paintRects(), zoom: vp.zoom, linkKeys, links });
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
      const links = paintedLinks();
      const linkKeys = new Set(links.filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: paintRects(), zoom: vp.zoom, linkKeys, links });
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
    createText: (p) => {
      const spec = { x: p.x, y: p.y };
      if (p.look) spec.look = p.look;
      if (typeof p.w === "number") spec.w = p.w;
      if (typeof p.h === "number") spec.h = p.h;
      if (p.color) spec.color = p.color;
      return Promise.resolve(session.createText?.(spec)).then((uid) => { if (uid) freshItems.add(uid); return uid; });
    },
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
    historyBack: () => onHistoryBack?.(),
    historyForward: () => onHistoryForward?.(),
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
    renamePage: (uid) => itemsR.renamePage(uid),
    editLabel: (uid) => edgesR.editLabel(uid),
    openBlock: (uid) => host?.openBlock?.(uid),
    toast: (t) => chrome.toast.show(t),
    openSearch: () => chrome.search.open(),
    openInfo: () => openInfo(),
    addInfoTab: (uid) => {
      const item = board()?.items.get(uid);
      if (item && item.type !== "section") panel.addInfoTab(item);
    },
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
    // preventDefault on pointerdown suppresses the click, so a stationary ref opens here.
    // A drag sets suppressClick before this line and must not navigate.
    if (nativeClickKind(event.target) === "ref" && !suppressClick) openRefFromClick(event);
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
  const toggleClickedTodo = (node) => {
    const card = node?.closest?.(".pxd-item");
    const uid = card?.getAttribute?.("data-uid") || card?.dataset?.uid;
    if (!uid) return;
    const stringRoot = node.closest?.(".pxd-item__string") || card;
    const boxes = [...stringRoot.querySelectorAll('input[type="checkbox"]')];
    const hit = node.closest?.("input, label, .check-container");
    const input = String(hit?.tagName || "").toLowerCase() === "input" ? hit : hit?.querySelector?.('input[type="checkbox"]');
    const index = input ? boxes.indexOf(input) : 0;
    const next = toggleTodoAt(board()?.items?.get(uid)?.string, index < 0 ? 0 : index);
    if (next == null) return;
    session.setString?.(uid, next);
  };
  listen(root, "pointerdown", (event) => {
    if (event.target?.closest?.(".pxd-chrome")) return;
    // The linked-references drawer drags a mention out. preventDefault would cancel that drag and move the card.
    if (event.target?.closest?.(".pxd-refs")) {
      event.stopPropagation();
      return;
    }
    // A rendered checkbox is not a Roam block control. Flip that TODO and leave the card alone.
    if (nativeClickKind(event.target) === "checkbox") { toggleClickedTodo(event.target); return; }
    measure();
    const ev = normalize(event, "pointerdown");
    const editingUid = itemsR.editingUid();
    const native = nativeClickKind(event.target);
    // Keep Roam's block handlers out of the overlay. Cancelling pointerdown also suppresses the compat
    // mousedown that Roam's page refs navigate on, so a drag that starts on a [[link]] moves the card.
    // An image must keep its click so Roam can open the viewer. A ref is opened from pointerup.
    if (!(editingUid && ev.target.kind === "item" && ev.target.uid === editingUid && ev.target.part !== "header")) {
      event.stopPropagation();
      if (native !== "image" && ev.target.kind !== "label" && ev.target.kind !== "section-title") event.preventDefault();
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
      const native = nativeClickKind(event.target);
      if (native === "checkbox" || native === "image") return;
      const editing = itemsR.editingUid();
      if (editing && event.target?.closest?.(".pxd-item--editing")) return;
      event.stopPropagation();
    });
  }
  listen(root, "dragstart", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-item--editing, .pxd-refs__row")) return;
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
  // pointerup and the click that follows are one gesture, so the second call is a no-op.
  let lastRefKey = "";
  let lastRefAt = 0;
  const openRefFromClick = (event) => {
    const t = event.target;
    if (!t?.closest || !t.closest(".pxd-item") || t.closest(".pxd-item--editing")) return false;
    const api = host?.api;
    const page = t.closest("[data-link-uid]");
    const block = t.closest(".rm-block-ref[data-uid]");
    const uid = page?.getAttribute("data-link-uid") || block?.getAttribute("data-uid");
    if (!uid || !api?.ui) return false;
    const key = `${uid}:${event.shiftKey ? 1 : 0}`;
    const now = Date.now();
    if (key === lastRefKey && now - lastRefAt < 500) return true;
    lastRefKey = key;
    lastRefAt = now;
    if (event.shiftKey) api.ui.rightSidebar?.addWindow?.({ window: { type: page ? "outline" : "block", "block-uid": uid } });
    else if (page) api.ui.mainWindow?.openPage?.({ page: { uid } });
    else api.ui.mainWindow?.openBlock?.({ block: { uid } });
    return true;
  };
  listen(root, "click", (event) => {
    const kind = nativeClickKind(event.target);
    if (kind === "image" || kind === "checkbox") return;
    if (!event.target?.closest?.(".pxd-chrome")) event.stopPropagation();
  });
  listen(root, "dblclick", (event) => {
    if (event.target?.closest?.(".pxd-chrome, .pxd-refs")) return;
    if (nativeClickKind(event.target)) return;
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
  const showHover = (uid) => {
    if (gesturing || itemsR.isEditing()) { hoverUid = null; return; }
    if (selectionOwnsBar()) { hoverUid = null; return; }
    if (!uid) {
      if (hoverUid) { hoverUid = null; chrome.ctx.hide(); }
      return;
    }
    if (uid === hoverUid && chrome.ctx.isOpen()) return;
    const it = board()?.items.get(uid);
    if (!it || it.type !== "card") {
      if (hoverUid) { hoverUid = null; chrome.ctx.hide(); }
      return;
    }
    hoverUid = uid;
    const anchor = () => {
      const r = rects().get(uid);
      return r ? { kind: "items", rect: toScreenRect(r) } : null;
    };
    chrome.ctx.show(it.kind === "board" ? "board" : "card", cardModel(it), anchor);
  };
  listen(root, "pointermove", (event) => {
    lastPointer = { x: event.clientX || 0, y: event.clientY || 0 };
    if (event.target?.closest?.(".pxd-chrome")) return;
    const node = event.target?.closest?.(".pxd-item--card");
    showHover(node?.getAttribute?.("data-uid") || node?.dataset?.uid || null);
  });
  listen(root, "pointerenter", () => { pointerInside = true; pointerBoard = root; });
  listen(root, "pointerleave", () => { pointerInside = false; if (pointerBoard === root) pointerBoard = null; });
  const dropEffectFor = (effectAllowed) => {
    const a = String(effectAllowed || "uninitialized");
    if (a === "all" || a === "uninitialized" || /copy/i.test(a)) return "copy";
    if (/move/i.test(a)) return "move";
    if (/link/i.test(a)) return "link";
    return "copy";
  };
  const onDragAccept = (event) => {
    const editor = event.target?.closest?.(".pxd-item__editor");
    if (editor) {
      if (!filesFromDataTransfer(event.dataTransfer).length) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
  };
  listen(root, "dragenter", onDragAccept);
  listen(root, "dragover", onDragAccept);
  listen(root, "drop", (event) => {
    const editor = event.target?.closest?.(".pxd-item__editor");
    if (editor) {
      const files = filesFromDataTransfer(event.dataTransfer);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      const ta = editorTextarea(event.target) || editorTextarea(editor);
      const cardUid = itemsR.editingUid?.();
      const role = inputBlockRole(ta || event.target, cardUid);
      void pasteEditorImages(ta, role.uid || cardUid, files);
      return;
    }
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
    const offer = dropNamespace(list.map((x) => x.string));
    Promise.resolve(made).then((uids) => {
      if (Array.isArray(uids) && uids.length) ctl.select(uids);
      if (!offer || !Array.isArray(uids) || disposed) return;
      const mine = offer.indexes.map((i) => uids[i]).filter(Boolean);
      if (!mine.length) return;
      chrome.toast.show({
        message: `Group under ${offer.parent}`,
        action: { label: `Group under ${offer.parent}`, run: () => { void session.groupUnder?.(mine, offer.parent); } },
      });
    }).catch(() => {});
  });

  const ownsKeyboard = () => {
    const active = doc.activeElement;
    const activeRoot = active?.closest?.(".pxd-root");
    if (activeRoot) return activeRoot === root;
    if (pointerBoard) return pointerBoard === root;
    return isFullscreen;
  };
  const onKeyDown = (event) => {
    // Outline mode is real Roam blocks. Canvas shortcuts stay off so a key there is not a board command.
    if (outlineMode && !event.target?.closest?.(".pxd-mode")) return;
    if (tableMode && !event.target?.closest?.(".pxd-toolbar__table")) return;
    if (kanbanMode && !event.target?.closest?.(".pxd-toolbar__kanban")) return;
    // The Add to board picker sits outside every root. Escape closes it; other keys stay with its filter.
    const addBoard = doc.querySelector?.(".pxd-addboard");
    if (addBoard) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        addBoard.dispatchEvent(new CustomEvent("pxd-close"));
      }
      return;
    }
    // The open menu owns the keyboard; Quick Look and a presentation only let their own keys through.
    if (menu.isOpen()) return;
    if (event.key === "Escape" && blockEdit && !doc.querySelector?.(".rm-autocomplete__results")) {
      event.preventDefault();
      event.stopPropagation();
      closeBlockEdit();
      return;
    }
    // Escape closes the Background popover before the controller's chain (selection, up a level, fullscreen) runs.
    if (event.key === "Escape" && chrome.popover.isOpen()) { chrome.popover.close(); event.preventDefault(); event.stopPropagation(); return; }
    if (quicklook.isOpen() && event.key !== "Escape" && String(event.key).toLowerCase() !== "q") return;
    if (presenter.isActive() && !["Escape", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "p", "P"].includes(event.key)) return;
    const findKey = (event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === "f";
    const findInSearch = event.target?.closest?.(".pxd-search") || doc.activeElement?.closest?.(".pxd-search");
    if (findKey && findInSearch && root.contains?.(findInSearch)) {
      event.preventDefault();
      event.stopPropagation();
      chrome.search.open();
      return;
    }
    const inputFocused = isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement);
    if (inputFocused) {
      const inside = root.contains?.(event.target) || root.contains?.(doc.activeElement);
      if (!inside && !itemsR.isEditing()) return;
      // Cmd+Z and Cmd+Shift+Z belong to the focused editor. Board undo runs only when focus is on the board.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === "z") return;
    } else if (!ownsKeyboard()) {
      return;
    }
    // Roam dropped focus to <body> mid-edit: put it back on the editor instead of running a board shortcut.
    if (!inputFocused && itemsR.isEditing() && event.key !== "Escape") { itemsR.recoverFocus(); return; }
    if (inputFocused && itemsR.isEditing()) {
      const ta = String(event.target?.tagName || "").toLowerCase() === "textarea" ? event.target : doc.activeElement;
      if (ta && String(ta.tagName || "").toLowerCase() === "textarea") {
        const uid = itemsR.editingUid();
        const role = inputBlockRole(ta, uid);
        const action = editorKeyAction({
          key: event.key,
          shift: event.shiftKey,
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          autocomplete: itemsR.autocompleteOpen(),
          isRoot: role.role === "root",
          fresh: freshItems.has(uid),
          value: ta.value || "",
          selectionStart: Number.isFinite(ta.selectionStart) ? ta.selectionStart : 0,
          selectionEnd: Number.isFinite(ta.selectionEnd) ? ta.selectionEnd : (Number.isFinite(ta.selectionStart) ? ta.selectionStart : 0),
        });
        if (action.type === "delete-card") {
          event.preventDefault();
          event.stopPropagation();
          void exitEdit();
          return;
        }
      }
    }
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
      editorPaste,
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
    if (outlineMode) syncOutline();
    if (tableMode) tableCtl.refresh();
    if (kanbanMode) kanbanCtl.refresh();
  }));
  subs.push(session.on("links", () => { dirty.links = true; schedule(); }));
  subs.push(session.on("sync", (state) => chrome.toolbar.setSync(state)));
  subs.push(session.on("toast", (t) => chrome.toast.show(t)));
  tableCtl = mountTable({
    doc,
    root,
    host,
    getBoard: board,
  });
  kanbanCtl = mountKanban({
    doc,
    root,
    host,
    getBoard: board,
  });
  if (inSidebar) setOutline(true);

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
    let itemsChanged = false;
    if (dirty.all || dirty.structural || dirty.items.size) {
      // Live preview rects (edit growth, drag fit) ride along: a sync for a dirty card must not snap grown section shells back.
      itemsR.sync({ board: b, rects: paintRects(), dirty: dirty.all ? null : dirty.items, structural: dirty.structural });
      itemsChanged = true;
    }
    const edgesDue = dirty.all || dirty.structural || dirty.links || dirty.edges.size;
    // A collapse dirties only the section. Edges into its members still have to move
    // onto the short frame, even when no edge block itself changed.
    const itemsMoveEdges = dirty.items.size && !dirty.all && !dirty.structural;
    if (edgesDue || itemsMoveEdges) {
      const shown = paintRects();
      if (edgesDue) {
        // An edge-only change used to call update(), which moves the path and skips
        // paintEdge, so dash and color never reached the DOM until a full render.
        const links = paintedLinks();
        edgesR.render({ board: b, rects: shown, links, coveredEdges: session.coveredEdges || new Set(), selection, zoom: vp.zoom, dirty: dirty.all || dirty.structural || dirty.links ? null : dirty.edges });
        paintLegend();
      }
      if (itemsMoveEdges) {
        const links = paintedLinks();
        edgesR.update({ board: b, edgeUids: edgesTouching(b, dirty.items), rects: shown, zoom: vp.zoom, linkKeys: new Set(links.map((l) => l.key)), links });
      }
    }
    if (dirty.viewport) {
      world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
      itemsR.setZoom(vp.zoom);
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
      propsPanel.place();
    }
    if (dirty.selection || itemsChanged) {
      itemsR.setSelection(selection.items);
      edgesR.setSelection({ edge: selection.edge, link: selection.link });
      if (!gesturing && !itemsR.isEditing()) showCtx(); else chrome.ctx.hide();
      syncProps();
      if (lensTag && dirty.structural) rebuildLens();
      if (focusOn || lensTag) applyFocus();
    } else if (dirty.viewport && chrome.ctx.isOpen()) {
      chrome.ctx.reposition();
    }
    if (dirty.viewport || itemsChanged || dirty.minimap) chrome.minimap.update({ board: b, rects: paintRects(), vp, size });
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

  // ------------------------------------------------------------ deep link
  const PULSE_MS = 1800;
  const pulseItem = (uid) => {
    const shell = itemsR.shellOf(uid);
    if (!shell) return;
    shell.classList.remove("pxd-item--pulse");
    void shell.offsetWidth;
    shell.classList.add("pxd-item--pulse");
    timers.later(() => { if (!disposed) shell.classList.remove("pxd-item--pulse"); }, PULSE_MS);
  };
  const consumeDeepLink = (hash = win?.location?.hash || "") => {
    if (disposed) return false;
    const target = pxdTarget(hash);
    if (!target?.cardUid) return false;
    const b = board();
    if (!b?.items?.has(target.cardUid)) return false;
    let pageUid = "";
    try { pageUid = host?.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
    if (target.pageUid && pageUid && target.pageUid !== pageUid) return false;
    ctl.select([target.cardUid]);
    fitSelection([target.cardUid]);
    if (itemsR.shellOf(target.cardUid)) pulseItem(target.cardUid);
    else timers.frame(() => { if (!disposed) pulseItem(target.cardUid); });
    return true;
  };
  listen(win, "hashchange", (event) => {
    const fromEvent = hashFromUrl(event?.newURL);
    consumeDeepLink(fromEvent || undefined);
  });

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
  applyMotion();
  applyLod();
  itemsR.setShowBadges(flag("show-card-badges", true));
  dirty.viewport = true;
  markAll();
  consumeDeepLink();
  timers.later(() => { if (!disposed) { scheduleContent(); updateBackToContent(); } }, 0);

  // ------------------------------------------------------------ API
  const localDay = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const Reader = globalThis.FileReader;
    if (typeof Reader !== "function" || !blob) { resolve(""); return; }
    const reader = new Reader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    try { reader.readAsDataURL(blob); } catch { resolve(""); }
  });
  const dataUrlFor = async (src) => {
    if (typeof src !== "string" || !src) return "";
    if (src.startsWith("data:")) return src;
    if (typeof host?.getFile !== "function") return "";
    try {
      const file = await host.getFile(src);
      const data = await blobToDataUrl(file);
      return data.startsWith("data:") ? data : "";
    } catch { return ""; }
  };
  const svgOf = async (b, uids = null) => {
    const pictured = uids ? sliceBoard(b, uids) : b;
    const hrefs = new Map();
    for (const item of pictured.items.values()) {
      if (item.kind !== "image") continue;
      const data = await dataUrlFor(imageSrc(item.string));
      if (data) hrefs.set(item.uid, data);
    }
    const text = boardToSvg(pictured, rects(), { dark: root.classList.contains("pxd-root--dark"), imageHrefs: hrefs });
    return dropExternalImages(text);
  };
  const pngName = (b) => {
    let pageTitle = "";
    try { pageTitle = host?.pageTitleOf?.(b.uid) || ""; } catch { pageTitle = ""; }
    return pngFileName({ boardTitle: b.title || UNTITLED_BOARD, pageTitle, date: localDay() });
  };
  async function pngBlob(b, uids = null) {
    return rasterizeSvg(doc, await svgOf(b, uids));
  }
  async function exportPng() {
    const b = board();
    if (!b) return false;
    try {
      const blob = await pngBlob(b);
      if (!blob) { if (!disposed) toast("PNG failed"); return false; }
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = pngName(b);
      doc.body.append(a);
      a.click();
      a.remove();
      timers.later(() => URL.revokeObjectURL(url), 4000);
      if (!disposed) toast("Saved PNG");
      return true;
    } catch {
      if (!disposed) toast("PNG failed");
      return false;
    }
  }
  async function copySelectionPng(uids) {
    const b = board();
    if (!b || !uids?.length) { if (!disposed) toast("PNG failed"); return false; }
    try {
      const blob = await pngBlob(b, uids);
      const Item = globalThis.ClipboardItem;
      const write = globalThis.navigator?.clipboard?.write;
      if (!blob || typeof Item !== "function" || typeof write !== "function") { if (!disposed) toast("Copy failed"); return false; }
      await write.call(globalThis.navigator.clipboard, [new Item({ "image/png": blob })]);
      if (!disposed) toast("Copied PNG");
      return true;
    } catch {
      if (!disposed) toast("Copy failed");
      return false;
    }
  }

  const view = {
    root,
    controller: ctl,
    setFullscreen(on) { if (Boolean(on) !== isFullscreen) applyFullscreen(on); },
    fit() { fitAll(); },
    viewport: () => ({ x: vp.x, y: vp.y, zoom: vp.zoom }),
    // Swap the settings object (feature.js calls this when a setting changes) and re-apply what depends on it.
    setSettings(next) {
      if (disposed) return;
      const minimapBefore = setting("show-minimap", true) !== false;
      settingsRef = next;
      applyBackground();
      applyMotion();
      applyLod();
      const minimapNow = setting("show-minimap", true) !== false;
      if (minimapNow !== minimapBefore) chrome.minimap.setVisible(minimapNow);
      chrome.toolbar.applyControls?.();
      itemsR.setShowBadges(flag("show-card-badges", true));
      dirty.links = true;
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
        lens: lensTag,
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
    async exportPng() { return exportPng(); },
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
      closeLens();
      closeBlockEdit();
      if (pointerBoard === root) pointerBoard = null;
      clearOutline();
      tableCtl.dispose();
      kanbanCtl.dispose();
      ctl.cancel();
      releaseCapture();
      if (heightDrag) onHeightUp();
      subs.splice(0).forEach((off) => { try { off?.(); } catch { /* already off */ } });
      routeOff();
      fsDispose();
      applyFullscreenChrome(mountEl, false, doc);
      try { vpStore.set(vpId, vp); } catch { /* the store can refuse a write */ }
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
      propsPanel.dispose();
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
