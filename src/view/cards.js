// Item shells (card / text / section), static content, LOD, culling, idle-chunked mounting,
// and edit mode (spec 3.2). Roam content only ever comes from host.renderString /
// renderBlock / renderPage; we never build <img> or fake editors.

import { DEFAULT_SIZES, FONT_SIZES, PALETTE, attrNameOf, classifyString, cssColor, firstLine, hexColor, isUntitledBoard, parseBoardTitle, plainText } from "../model/schema.js";
import { isQueryString } from "../model/query.js";
import { dueChip } from "../model/tasks.js";
import { commentCount } from "../model/section6.js";
import { LINKED_REF_CAP, linkedRefCard, linkedRefLabel } from "../model/refs.js";
import { boardPreview, descendantsOf, sectionNoteUid } from "../model/board.js";
import { CARD_MIME } from "./panel.js";
import { lodForZoom, rectsIntersect } from "../model/geometry.js";
import { SHAPES, shapePath } from "../model/shapes.js";
import { watchEditorMenus } from "./editor-menus.js";
import { applyEditorCounterScale } from "./editor-scale.js";

const SIDES = ["top", "right", "bottom", "left"];
const CHUNK_MS = 8;
const LRU_CAP = 80;
const UNMOUNT_AFTER_MS = 4000;
const HYDRATE_CAP_MS = 900;
const CONTENT_LIMIT = 12;
const CONTENT_DEPTH = 2;
const OUTLINE_CAP = 300;
const OUTLINE_FETCH = 2000;
const PAGE_WATCH_MAX = 8;
const PAGE_REFRESH_MS = 250;
const GROW_CAP = 900;
const HEADER_H = 32;
const META_H = 28;
const REF_TITLE_MAX = 120;
const HEADER_TEXT_MAX = 160;
const TINY_MINI_PX = 28;
const ATTR_CHIPS_MAX = 3;
const SVG_NS = "http://www.w3.org/2000/svg";
const ROW_BOARD_W = 220;
const ROW_BOARD_H = 90;
const ROW_BOARD_THUMBS = 4;
const BOARD_KEY_DEPTH = 3;
const BOARD_KEY_NODES = 400;
const KID_ROW_H = 22;
const PEEK_DELAY_MS = 400;
const PEEK_TOP = 12;
const PEEK_SUB = 4;
const PEEK_TEXT_MAX = 140;

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

export function isTextEntryTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  if (typeof target.getAttribute === "function" && target.getAttribute("contenteditable") === "true") return true;
  if (typeof target.closest !== "function") return false;
  // Not ".rm-block__input": the board is mounted inside the diagram block's own view-mode div of that class,
  // so an ancestor match would make every key on the board look like typing. Roam's editor is a textarea
  // (caught above). An ancestor that contains the board is a host wrapper, not an input.
  const hit = target.closest("[contenteditable=\"true\"], .pxd-label--editing, .pxd-section__title--editing, .pxd-input");
  return Boolean(hit && !hit.querySelector?.(".pxd-root"));
}

// A plain wheel over a page card body scrolls that body until it reaches an end. Cmd/Ctrl+wheel (a pinch) is the board's.
export function pageBodyWantsWheel(target, event) {
  if (!target || typeof target.closest !== "function" || !event) return null;
  if (event.ctrlKey || event.metaKey) return null;
  const dy = Number(event.deltaY) || 0;
  if (!dy) return null;
  const body = target.closest(".pxd-item__body");
  const card = body?.closest(".pxd-item--page");
  if (!card || card.classList?.contains("pxd-item--editing")) return null;
  const room = (Number(body.scrollHeight) || 0) - (Number(body.clientHeight) || 0);
  if (room <= 1) return null;
  const top = Number(body.scrollTop) || 0;
  if (dy > 0 ? top >= room - 1 : top <= 0) return null;
  return body;
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
    const Ctor = globalThis.MouseEvent || globalThis.Event;
    const event = typeof Ctor === "function" ? new Ctor(type, init) : { type, ...init };
    host.dispatchEvent(event);
  }
  return true;
}

export function focusRoamInput(el) {
  if (!el) return false;
  try { el.focus?.({ preventScroll: true }); } catch { try { el.focus?.(); } catch { /* unfocused */ } }
  synthesizeBlockClick(el);
  return true;
}

function nextFrame() {
  return new Promise((resolve) => {
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") raf(() => resolve());
    else setTimeout(resolve, 16);
  });
}

export async function waitHydrateQuiet(el, capMs = HYDRATE_CAP_MS) {
  const MO = globalThis.MutationObserver;
  if (!el || typeof MO !== "function") {
    await nextFrame();
    await nextFrame();
    return;
  }
  let mutations = 0;
  const observer = new MO(() => { mutations += 1; });
  try { observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true }); } catch { /* stub */ }
  const start = Date.now();
  const grace = 250;
  let quiet = 0;
  let saw = false;
  try {
    while (Date.now() - start < capMs) {
      if (!saw && Date.now() - start >= grace) break;
      await nextFrame();
      if (mutations > 0) { saw = true; quiet = 0; } else if (saw) quiet += 1;
      mutations = 0;
      if (saw && quiet >= 2) break;
    }
  } finally {
    observer.disconnect();
  }
}

const childString = (c) => c?.[":block/string"] ?? c?.string ?? "";
const childKids = (c) => c?.[":block/children"] ?? c?.children ?? [];
const childUid = (c) => c?.[":block/uid"] ?? c?.uid ?? "";

const childProps = (c) => c?.[":block/props"] ?? c?.props;

const KIDS_KINDS = ["note", "block"];
const isKidsCard = (item) => item?.type === "card" && KIDS_KINDS.includes(item.kind);
// Direct children that count as rows: the BT_attrDue child is the due chip, never a row.
const visibleKids = (list) => (list || []).filter((c) => attrNameOf(childString(c)) !== "BT_attrDue");
// Rows renderBlocks will draw for this list (same depth and row caps).
function kidRowsOf(list, depth = 1, budget = { n: 0 }) {
  for (const c of visibleKids(list)) {
    if (budget.n >= CONTENT_LIMIT) break;
    budget.n += 1;
    const kids = childKids(c);
    if (kids.length && depth < CONTENT_DEPTH) kidRowsOf(kids, depth + 1, budget);
  }
  return budget.n;
}

function contentKeyOf(item) {
  const parts = [
    item.kind, item.enhanced ? "e" : "", item.string, item.collapsed ? "c" : "", item.open === false ? "x" : "", item.kids ? "k" : "",
    item.fontSize || "", item.textColor || "", item.align || "", item.fill || "", item.border || "",
    item.titleSize || "", item.titleColor || "", item.titleFill || "", item.areaFill || "",
  ];
  if (item.kind === "board") parts.push(item.w, item.h);
  if (item.kind === "board") {
    // The mini preview draws the child board's layout, so a layout-only change inside it must refresh the card.
    let budget = BOARD_KEY_NODES;
    const walkBoard = (kids, depth) => {
      if (depth > BOARD_KEY_DEPTH) return;
      for (const c of kids) {
        if (budget-- <= 0) return;
        parts.push(childUid(c), childString(c), JSON.stringify(childProps(c) ?? null));
        walkBoard(childKids(c), depth + 1);
      }
    };
    walkBoard(item.content || [], 1);
    return parts.join("\u0001");
  }
  const walk = (kids, depth) => {
    if (depth > CONTENT_DEPTH) return;
    for (const c of kids) { parts.push(childString(c)); walk(childKids(c), depth + 1); }
  };
  walk(item.content || [], 1);
  return parts.join("\u0001");
}

export function createItemRenderer({
  doc = globalThis.document,
  host,
  session,
  itemsLayer,
  sectionsLayer,
  timers,
  onGrow,
  onRenameCommit,
  onEditChange,
  onEditResize,
  onOpenBoard,
  onRenameBoard,
  onRenamePage,
  onBadgeClick,
  onPageLayout,
} = {}) {
  const shells = new Map(); // uid → rec
  const mounted = new Map(); // uid → lastWanted (LRU order = insertion order)
  // ED-2: per-item board renders, on the same object as window.__plexusDiagram.stats.
  const noteRender = (uid) => {
    const bag = host?.stats;
    if (!bag || typeof bag !== "object") return;
    if (!bag.items || typeof bag.items !== "object") bag.items = {};
    bag.items[uid] = (Number(bag.items[uid]) || 0) + 1;
  };
  let lod = "detail";
  let focusSet = null;
  let badgeMap = new Map();
  let showBadges = false;
  let zoomCache = 1;
  let paused = false;
  let editing = null;
  let stopMenus = null;
  let queue = [];
  let idleHandle = null;
  let wanted = new Set();
  let lastBoard = null;
  let lastRects = null;
  let focusGuard = null;
  let floorTeardown = null;
  let floor = null; // { start, cancel } while a focus recovery is pending
  let floorRetry = null; // cancel handle for the re-arm scheduled when the recovery cap refused a floor
  let recoveries = [];
  let lastOutsideDown = -Infinity;
  let disposed = false;

  // `.rm-block__input` is also the read-only block view. The caret lives on the textarea.
  const menuAnchor = () => doc.querySelector?.(".pxd-item--editing textarea")
    || doc.querySelector?.(".pxd-root .bp3-popover-open")
    || null;
  const ensureMenus = (getAnchor = menuAnchor) => {
    if (disposed || stopMenus) return;
    const stop = watchEditorMenus(doc, getAnchor, () => {
      if (stopMenus === stop) stopMenus = null;
    });
    stopMenus = stop;
  };
  const onMenuPointer = () => { if (!disposed) ensureMenus(); };
  doc.addEventListener?.("pointerup", onMenuPointer, true);

  const later = (fn, ms) => (timers?.later ? timers.later(fn, ms) : (() => { const t = setTimeout(fn, ms); return () => clearTimeout(t); })());
  const idle = (fn) => {
    if (timers?.idle) return timers.idle(fn);
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === "function") { const id = ric(fn); return () => globalThis.cancelIdleCallback?.(id); }
    const t = setTimeout(() => fn({ timeRemaining: () => CHUNK_MS, didTimeout: true }), 0);
    return () => clearTimeout(t);
  };

  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };

  // Iframes and PDF highlights sit in the Roam root. A shield beside that root takes the hit so pan and drag still see the card.
  const EMBED_SEL = "iframe, video, .rm-pdf-highlight, .rm-pdf-container, .twitter-tweet, .rm-xparser-default-tweet";
  const embedLive = (node) => {
    for (const child of node.children || []) if (child.classList?.contains("pxd-rs__live")) return child;
    return node;
  };
  const armEmbedShield = (node, live) => {
    const syncShield = () => {
      const hit = live.querySelector?.(EMBED_SEL);
      let shield = null;
      for (const child of node.children || []) if (child.classList?.contains("pxd-embed-shield")) shield = child;
      if (hit && !shield) {
        const cover = el("div", "pxd-embed-shield", node);
        cover.setAttribute("aria-hidden", "true");
      } else if (!hit && shield) shield.remove();
    };
    syncShield();
    const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (typeof MO !== "function") return;
    const mo = new MO(() => syncShield());
    try { mo.observe(live, { childList: true, subtree: true }); } catch { return; }
    node.__pxdEmbedMo = mo;
  };

  const mountQuery = (parent, uid) => {
    const live = el("div", "pxd-rs pxd-item__query", parent);
    const mount = el("div", "pxd-rs__live", live);
    try { host.renderBlock(mount, uid); }
    catch { mount.textContent = "Query"; }
    return live;
  };

  const setHidden = (node, hidden) => {
    node.hidden = hidden;
    if (hidden) node.setAttribute("hidden", "");
    else node.removeAttribute("hidden");
  };

  const addRefRow = (list, rec, ref, on) => {
    const payload = linkedRefCard(ref?.uid);
    if (!payload) return;
    const row = el("div", "pxd-refs__row", list);
    row.draggable = true;
    row.setAttribute("draggable", "true");
    row.dataset.uid = ref.uid;
    row.setAttribute("data-uid", ref.uid);
    const liveWrap = el("div", "pxd-rs", row);
    const live = el("div", "pxd-rs__live", liveWrap);
    try {
      if (host?.renderBlock) host.renderBlock(live, ref.uid);
      else live.textContent = String(ref.string || "");
    } catch {
      live.textContent = String(ref.string || "");
    }
    armEmbedShield(liveWrap, live);
    rec.roots.push(liveWrap);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) on(row, type, stopEvent);
    on(row, "dragstart", (event) => {
      event.stopPropagation();
      try {
        event.dataTransfer?.setData?.(CARD_MIME, payload);
        event.dataTransfer?.setData?.("text/plain", payload);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* the drag still leaves the source block alone */ }
    });
  };

  const mountLinkedRefs = (body, rec, item) => {
    let refs = [];
    try {
      const got = host?.linkedRefs?.(item, { limit: LINKED_REF_CAP });
      if (Array.isArray(got)) refs = got.slice(0, LINKED_REF_CAP);
    } catch { refs = []; }
    const offs = [];
    const on = (node, type, fn) => {
      node.addEventListener(type, fn);
      offs.push(() => node.removeEventListener(type, fn));
    };
    rec.refOff = () => { for (const off of offs.splice(0)) off(); };
    const wrap = el("div", "pxd-refs", body);
    const toggle = el("button", "pxd-refs__toggle", wrap);
    toggle.type = "button";
    toggle.textContent = linkedRefLabel(refs.length);
    toggle.setAttribute("aria-label", toggle.textContent);
    toggle.setAttribute("aria-expanded", "false");
    const list = el("div", "pxd-refs__list", wrap);
    setHidden(list, true);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) on(toggle, type, stopEvent);
    let filled = false;
    on(toggle, "click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      wrap.classList.toggle("pxd-refs--open", open);
      setHidden(list, !open);
      if (!open || filled) return;
      filled = true;
      for (const ref of refs) addRefRow(list, rec, ref, on);
    });
  };

  // One log per uid for the life of this renderer. A later content pass must not log again.
  const loggedRenderErrors = new Set();
  const showRenderChip = (node, uid) => {
    node.classList.add("pxd-item--error");
    const chip = el("div", "pxd-render-chip", node);
    el("span", "pxd-render-chip__label", chip).textContent = "Could not render";
    el("span", "pxd-render-chip__uid", chip).textContent = uid;
    const open = el("button", "pxd-btn pxd-render-chip__open", chip);
    open.type = "button";
    open.textContent = "Open";
    open.setAttribute("aria-label", "Open");
    for (const type of ["pointerdown", "mousedown", "dblclick", "click"]) {
      open.addEventListener(type, (event) => {
        stopEvent(event);
        if (type === "click" && uid) host?.openBlock?.(uid);
      });
    }
  };
  // Roam's renderString catches a broken {{[[roam/render]]}} and writes this phrase instead of throwing.
  const RENDER_FAIL = "Error rendering component";
  const RENDER_FAILS = [RENDER_FAIL, "Failed to render"];
  // PL-2: rows inside cards swap a failed macro for the raw text, muted, instead of a chip or Roam's grey box.
  const showPlainRow = (node, string) => {
    node.classList.add("pxd-rs--plain");
    el("span", "pxd-rs__plain", node).textContent = String(string ?? "");
  };
  const renderRoot = (parent, string, cls = "pxd-rs", uid = "", { plain = false } = {}) => {
    const node = el("div", cls, parent);
    if (!string) return node;
    const live = el("div", "pxd-rs__live", node);
    const buffered = [];
    const origError = console.error;
    console.error = (...args) => { buffered.push(args); };
    let thrown = null;
    try {
      if (host?.renderString) host.renderString(live, string);
      else live.textContent = plainText(string);
    } catch (error) {
      thrown = error;
    } finally {
      console.error = origError;
    }
    const renderedText = String(live.textContent || "");
    const failed = Boolean(thrown) || RENDER_FAILS.some((t) => renderedText.includes(t))
      || Boolean(live.querySelector?.(".rm-render-failed, .rm-api-render--failed"));
    if (!failed) {
      for (const args of buffered) origError.apply(console, args);
      armEmbedShield(node, live);
      return node;
    }
    try { host?.unmount?.(live); } catch { /* Roam had nothing to detach */ }
    try { live.remove(); } catch { /* already gone */ }
    if (plain) showPlainRow(node, string);
    else showRenderChip(node, uid);
    if (!loggedRenderErrors.has(uid)) {
      loggedRenderErrors.add(uid);
      const reported = thrown || buffered[0]?.[0] || new Error(renderedText.slice(0, 180));
      origError.call(console, reported);
    }
    return node;
  };

  const unmountRoots = (rec) => {
    try { rec.refOff?.(); } catch { /* already off */ }
    rec.refOff = null;
    try { rec.pageUnwatch?.(); } catch { /* already off */ }
    rec.pageUnwatch = null;
    rec.pageRoots = [];
    rec.pageHolder = null;
    rec.scrollOff?.();
    rec.scrollOff = null;
    if (!rec.roots?.length) return;
    for (const node of rec.roots) {
      try { node.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
      try { host?.unmount?.(embedLive(node)); } catch { /* not a roam root */ }
    }
    rec.roots = [];
  };

  // PL-1: a row whose block is a {{[[diagram]]}} board (or an embed of one) cannot render through renderString.
  // It becomes a compact board row: a mini-map thumbnail, or a chip when the thumbnail budget is spent or the board
  // is the one on screen. PL-2: any other row that fails to render falls back to its raw text.
  let rowThumbs = ROW_BOARD_THUMBS;
  const startRows = () => { rowThumbs = ROW_BOARD_THUMBS; };
  const EMBED_RE = /^\{\{\s*(?:\[\[)?embed(?:\]\])?\s*:\s*\(\(([\w-]+)\)\)\s*\}\}$/i;
  const boardRowTarget = (uid, string) => {
    const t = String(string ?? "").trim();
    if (classifyString(t).kind === "board") return { uid, string: t };
    const m = EMBED_RE.exec(t);
    if (!m) return null;
    const inner = host?.blockString?.(m[1]);
    return typeof inner === "string" && classifyString(inner).kind === "board" ? { uid: m[1], string: inner } : null;
  };
  const mountBoardRow = (parent, cls, target) => {
    const node = el("div", `${cls} pxd-rs--board`, parent);
    const title = parseBoardTitle(target.string) || "Untitled board";
    const self = target.uid === lastBoard?.uid;
    const open = (event) => {
      stopEvent(event);
      if (event.shiftKey) host?.openInSidebar?.(target.uid, "block");
      else openBoard(target.uid);
    };
    const raw = self ? null : host?.pullBoard?.(target.uid);
    const content = raw?.[":block/children"] ?? raw?.children ?? [];
    if (self || !raw || rowThumbs <= 0) {
      const chip = el("button", "pxd-btn pxd-board-row pxd-board-row--chip", node);
      chip.type = "button";
      const n = self ? 0 : boardPreview({ uid: target.uid, string: target.string, content }).count;
      const label = self ? "this board" : `${n} ${n === 1 ? "item" : "items"}`;
      chip.textContent = `\u25A6 ${title} \u00B7 ${label}`;
      chip.dataset.action = "open";
      chip.setAttribute("aria-label", `Open board ${title}`);
      for (const type of ["pointerdown", "mousedown", "dblclick"]) chip.addEventListener(type, stopEvent);
      chip.addEventListener("click", open);
      return node;
    }
    rowThumbs -= 1;
    const wrap = el("div", "pxd-board-row", node);
    mountBoardBody(wrap, {
      uid: target.uid,
      string: target.string,
      content,
      w: ROW_BOARD_W + 24,
      h: ROW_BOARD_H + HEADER_H + META_H,
      title,
      enhanced: false,
    }, { openUid: target.uid });
    wrap.addEventListener("click", (event) => {
      if (!event.shiftKey || event.target?.closest?.("button")) return;
      open(event);
    });
    return node;
  };
  const renderRowRoot = (parent, string, cls, uid) => {
    const target = boardRowTarget(uid, string);
    return target ? mountBoardRow(parent, cls, target) : renderRoot(parent, string, cls, uid, { plain: true });
  };

  // ---------------------------------------------------------------- shells
  const buildPorts = (parent) => {
    const wrap = el("div", "pxd-ports", parent);
    for (const side of SIDES) {
      const p = el("div", `pxd-port pxd-port--${side}`, wrap);
      p.dataset.side = side;
      p.setAttribute("data-side", side);
      p.title = "Drag to connect";
    }
    return wrap;
  };
  const buildGrips = (parent) => {
    for (const part of ["right", "bottom", "corner"]) {
      const g = el("div", `pxd-grip pxd-grip--${part}`, parent);
      g.dataset.part = part;
      g.setAttribute("data-part", part);
    }
  };

  const buildShell = (item) => {
    const rec = { uid: item.uid, type: item.type, roots: [], contentKey: null, rect: null, bare: item.type === "card" };
    if (item.type === "section") {
      const node = el("div", "pxd-section", null);
      rec.el = node;
      rec.title = el("div", "pxd-section__title", node);
      rec.note = el("div", "pxd-section__note", node);
      for (const side of ["t", "r", "b", "l"]) el("div", `pxd-section__edge pxd-section__edge--${side}`, node);
      buildGrips(node);
      buildPorts(node);
    } else {
      const node = el("div", `pxd-item pxd-item--${item.type}`, null);
      rec.el = node;
      rec.header = el("div", "pxd-item__header", node);
      rec.body = el("div", "pxd-item__body", node);
      buildPorts(node);
      buildGrips(node);
    }
    rec.el.dataset.uid = item.uid;
    rec.el.setAttribute("data-uid", item.uid);
    rec.el.setAttribute("role", "group");
    rec.el.tabIndex = -1;
    rec.tabStop = -1;
    shells.set(item.uid, rec);
    return rec;
  };

  const setVar = (el, name, value) => {
    if (value) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  };
  // Inline variables only when a key is present, so a 1.2 board with no style keys keeps its look.
  const applyStyle = (rec, item) => {
    const node = rec.el;
    if (item.type === "section") {
      const d = item.sectionDefaults || {};
      const area = item.areaFill ?? d.areaFill;
      const border = item.border ?? d.border;
      const titleSize = item.titleSize ?? d.titleSize;
      const titleColor = item.titleColor ?? d.titleColor;
      const titleFill = item.titleFill ?? d.titleFill;
      setVar(node, "--pxd-fill", cssColor(area, "fill"));
      setVar(node, "--pxd-line", cssColor(border, "line") || hexColor(item.color) || "");
      if (rec.title) {
        rec.title.style.fontSize = titleSize ? `${titleSize}px` : "";
        rec.title.style.color = cssColor(titleColor, "text") || "";
        rec.title.style.background = cssColor(titleFill, "fill") || "";
      }
      return;
    }
    const accent = hexColor(item.color);
    setVar(node, "--pxd-card-fs", item.fontSize ? `${item.fontSize}px` : "");
    setVar(node, "--pxd-text-fs", item.type === "text" && item.fontSize ? `${item.fontSize}px` : "");
    setVar(node, "--pxd-text-c", cssColor(item.textColor, "text") || accent || "");
    setVar(node, "--pxd-fill", cssColor(item.fill, "fill") || accent || "");
    setVar(node, "--pxd-line", cssColor(item.border, "line") || accent || "");
    node.style.textAlign = item.align || "";
    const stickyHex = item.type === "text" && item.look === "sticky" && !item.shape
      ? (hexColor(item.fill) || accent || "")
      : "";
    node.style.backgroundColor = stickyHex;
  };

  const syncShape = (rec, item, size) => {
    const name = item?.type === "text" && SHAPES.includes(item.shape) ? item.shape : "";
    if (!name) {
      if (rec.shapeEl) { rec.shapeEl.remove(); rec.shapeEl = null; rec.shapePath = null; }
      rec.shapeName = "";
      rec.shapeKey = "";
      return;
    }
    if (!rec.shapeEl) {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "pxd-shape");
      svg.setAttribute("aria-hidden", "true");
      const path = doc.createElementNS(SVG_NS, "path");
      svg.append(path);
      const before = rec.body || null;
      if (before) rec.el.insertBefore(svg, before);
      else rec.el.append(svg);
      rec.shapeEl = svg;
      rec.shapePath = path;
    }
    const w = size?.w ?? item.w;
    const h = size?.h ?? item.h;
    const key = `${name}:${w}:${h}`;
    rec.shapeName = name;
    if (rec.shapeKey === key) return;
    rec.shapeEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    rec.shapePath.setAttribute("d", shapePath({ x: 0, y: 0, w, h }, name));
    rec.shapeKey = key;
  };

  const paintShell = (rec, item) => {
    const node = rec.el;
    if (item.type !== "section") {
      // A block-ref card's title lives in the referenced block; resolve it here so map LOD and collapsed cards keep a header.
      rec.refString = null;
      rec.refBoard = false;
      if (item.kind === "block" && item.target?.uid) {
        const refString = host?.blockString?.(item.target.uid);
        if (typeof refString === "string") {
          rec.refString = refString;
          rec.refBoard = classifyString(refString).kind === "board";
        }
        if (rec.refBoard) rec.refTitle = parseBoardTitle(rec.refString) || "Untitled board";
        else rec.refTitle = typeof refString === "string" ? firstLine(refString).slice(0, REF_TITLE_MAX) : "";
      } else rec.refTitle = "";
    }
    const base = item.type === "section" ? "pxd-section" : `pxd-item pxd-item--${item.type} pxd-item--${item.kind}`;
    const cls = [base];
    if (PALETTE.includes(item.color)) cls.push(`pxd-c-${item.color}`);
    if (item.collapsed && item.type !== "section") cls.push("pxd-item--collapsed");
    if (item.type === "section" && item.collapsed) cls.push("pxd-section--collapsed");
    if (item.type === "section" && item.look === "lane") cls.push("pxd-section--lane", item.axis === "vertical" ? "pxd-lane-v" : "pxd-lane-h");
    if (!item.string?.trim()) cls.push("pxd-item--empty");
    if (item.type === "text" && FONT_SIZES.includes(item.fontSize)) cls.push(`pxd-item--fs${item.fontSize}`);
    if (item.type !== "section" && item.fontSize) cls.push("pxd-fs");
    if (item.textColor) cls.push("pxd-has-textc");
    if (item.type === "text" && item.shape) cls.push("pxd-item--shape", `pxd-item--shape-${item.shape}`);
    else if (item.type === "text" && item.look === "sticky") cls.push("pxd-item--sticky");
    else if (item.type === "text" && (item.fill || item.border)) cls.push("pxd-text-paint");
    if (rec.selected) cls.push(item.type === "section" ? "pxd-section--selected" : "pxd-item--selected");
    if (rec.hover) cls.push("pxd-item--drop");
    if (editing?.uid === item.uid) cls.push("pxd-item--editing");
    if (item.pinned) cls.push(item.type === "section" ? "pxd-section--pinned" : "pxd-item--pinned");
    if (focusSet && !focusSet.has(item.uid)) cls.push(item.type === "section" ? "pxd-section--focus-dim" : "pxd-item--focus-dim");
    if (item.type !== "section") {
      if (isKidsCard(item)) cls.push(item.kids ? "pxd-item--kids" : "pxd-item--kidsoff");
      if (rec.bare) cls.push("pxd-item--bare");
      if (rec.refBoard) cls.push("pxd-item--wb");
      if (item.look === "block") cls.push("pxd-card--block");
      if (item.type === "card" && dueChip(item.content)?.overdue) cls.push("pxd-item--overdue");
    }
    node.className = cls.join(" ");
    applyStyle(rec, item);
    if (item.type !== "section") syncShape(rec, item);
    if (item.type === "section") {
      if (!rec.titleRendered || rec.titleString !== item.string) {
        rec.title.textContent = item.title || "Section";
        rec.titleString = item.string;
        rec.titleRendered = false;
      }
      const noteUid = !item.collapsed && lastBoard ? sectionNoteUid(lastBoard, item.uid) : null;
      const note = noteUid ? lastBoard.items.get(noteUid) : null;
      if (rec.note) {
        if (note) {
          rec.note.style.display = "";
          rec.note.textContent = firstLine(note.string || "");
        } else rec.note.style.display = "none";
      }
    } else {
      if (editing?.uid !== item.uid && !rec.renaming) rec.header.textContent = item.type === "text" ? "" : String(rec.refTitle || item.title || "").slice(0, HEADER_TEXT_MAX);
      if (item.type === "text") rec.header.style.display = "none";
      rec.header.classList.toggle("pxd-item__header--muted", item.kind === "board" && isUntitledBoard(item.title));
    }
    node.title = "";
    const announced = item.type === "section" ? (item.title || "Section") : String(rec.refTitle || item.title || "Untitled");
    node.setAttribute("aria-label", `${announced}, ${item.type}`);
  };

  const position = (rec, rect) => {
    const prev = rec.rect;
    rec.rect = rect;
    // Same rect while editing: leave the first-frame lock alone. A later rect write must not put it back.
    if (editing?.uid === rec.uid && prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
    rec.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    rec.el.style.width = `${rect.w}px`;
    rec.el.style.height = `${rect.h}px`;
    if (rec.shapeName) syncShape(rec, { type: "text", shape: rec.shapeName, w: rect.w, h: rect.h }, rect);
  };

  const removeShell = (uid) => {
    const rec = shells.get(uid);
    if (!rec) return;
    if (editing?.uid === uid) void exitEdit({ silent: true });
    unmountRoots(rec);
    rec.el.remove();
    shells.delete(uid);
    mounted.delete(uid);
  };

  // Structural or partial sync from the model.
  let shellQueue = [];
  const placeShells = () => {
    if (typeof doc.createDocumentFragment !== "function") {
      for (const uid of lastBoard?.order || []) {
        const rec = shells.get(uid);
        if (!rec?.el) continue;
        const layer = rec.type === "section" ? sectionsLayer : itemsLayer;
        if (rec.el.parentElement !== layer || layer.lastChild !== rec.el) layer.append(rec.el);
      }
      return;
    }
    const sectionNodes = doc.createDocumentFragment();
    const itemNodes = doc.createDocumentFragment();
    for (const uid of lastBoard?.order || []) {
      const rec = shells.get(uid);
      if (!rec?.el) continue;
      (rec.type === "section" ? sectionNodes : itemNodes).append(rec.el);
    }
    if (sectionNodes.childNodes.length) sectionsLayer.append(sectionNodes);
    if (itemNodes.childNodes.length) itemsLayer.append(itemNodes);
  };
  const pumpShells = () => {
    const chunk = shellQueue.splice(0, 40);
    for (const uid of chunk) {
      const item = lastBoard?.items.get(uid);
      if (!item || shells.has(uid)) continue;
      const rec = buildShell(item);
      const rect = lastRects?.get(uid);
      rec.el.style.display = rect ? "" : "none";
      noteRender(uid);
      paintShell(rec, item);
      if (rect) position(rec, rect);
    }
    if (chunk.length) placeShells();
    if (shellQueue.length && timers?.frame) timers.frame(pumpShells);
  };
  const sync = ({ board, rects, dirty = null, structural = false, view = null }) => {
    lastBoard = board;
    lastRects = rects;
    // A full sync builds every missing shell itself. A partial sync must leave the
    // open-time queue alone, or the cards past the first chunk never appear.
    if (dirty == null) shellQueue = [];
    for (const uid of [...shells.keys()]) if (!board.items.has(uid)) removeShell(uid);
    let orderChanged = structural;
    let defer = null;
    if (!shells.size && board.order.length > 80 && typeof timers?.frame === "function") {
      const now = [];
      const later = [];
      for (const uid of board.order) {
        const rect = rects.get(uid);
        if (view && rect && rectsIntersect(rect, view)) now.push(uid);
        else later.push(uid);
      }
      // A camera over empty space used to build every shell in this frame.
      if (!now.length && view) {
        const cx = view.x + view.w / 2;
        const cy = view.y + view.h / 2;
        const dist = (uid) => {
          const r = rects.get(uid);
          return r ? (r.x + r.w / 2 - cx) ** 2 + (r.y + r.h / 2 - cy) ** 2 : Infinity;
        };
        later.sort((a, b) => dist(a) - dist(b));
      }
      if (!now.length) now.push(...later.splice(0, 24));
      if (now.length && later.length) defer = new Set(later);
    }
    for (const uid of board.order) {
      if (defer?.has(uid)) continue;
      const item = board.items.get(uid);
      let rec = shells.get(uid);
      const fresh = !rec;
      if (!rec) { rec = buildShell(item); orderChanged = true; }
      const rect = rects.get(uid);
      rec.el.style.display = rect ? "" : "none";
      if (fresh || !dirty || dirty.has(uid)) {
        // Roam owns the open editor. A pull-watch echo of its text must not repaint this card or remount it.
        if (!fresh && editing?.uid === uid) {
          if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) position(rec, rect);
        } else {
          noteRender(uid);
          paintShell(rec, item);
          if (rect) position(rec, rect);
          const key = contentKeyOf(item);
          if (rec.contentKey !== null && rec.contentKey !== key && editing?.uid !== uid) {
            // content changed under a mounted shell → remount on the next content pass
            unmountRoots(rec);
            rec.body?.replaceChildren?.();
            rec.contentKey = null;
            mounted.delete(uid);
            rec.titleRendered = false;
            if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
          }
          if (showBadges) renderBadges(rec);
        }
      } else if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) {
        position(rec, rect);
      }
    }
    if (orderChanged) placeShells();
    if (defer?.size) {
      shellQueue = [...defer];
      timers.frame(pumpShells);
    }
  };


  // ---------------------------------------------------------------- CH-1/CH-3: children badge and peek
  let peek = null; // { node, rec, off }
  let peekTimer = null;
  const peekRoot = () => itemsLayer?.closest?.(".pxd-root") || null;
  const closePeek = () => {
    peekTimer?.();
    peekTimer = null;
    if (!peek) return;
    const p = peek;
    peek = null;
    p.off?.();
    try { p.node.remove(); } catch { /* already gone */ }
  };
  const peekRowsOf = (rec, item, done) => {
    const take = (list) => done(visibleKids(list).slice(0, PEEK_TOP));
    if (item.kind === "note") return take(item.content);
    const tree = host?.pullTree?.(item.target.uid, 2, 200);
    if (tree && typeof tree.then === "function") tree.then(take).catch(() => {});
    else take(tree);
  };
  const openPeek = (rec) => {
    peekTimer = null;
    const item = lastBoard?.items.get(rec.uid);
    const root = peekRoot();
    if (disposed || peek || !root || !rec.kidsBtn || !item || !isKidsCard(item) || editing || paused) return;
    peekRowsOf(rec, item, (rows) => {
      if (disposed || peek || !rec.kidsBtn?.isConnected || !rows.length) return;
      const node = el("div", "pxd-kids-peek", root);
      node.setAttribute("role", "tooltip");
      for (const c of rows) {
        el("div", "pxd-kids-peek__row", node).textContent = plainText(childString(c), PEEK_TEXT_MAX);
        for (const g of visibleKids(childKids(c)).slice(0, PEEK_SUB)) {
          el("div", "pxd-kids-peek__row pxd-kids-peek__row--sub", node).textContent = plainText(childString(g), PEEK_TEXT_MAX);
        }
      }
      const b = rec.kidsBtn.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      node.style.left = `${Math.round(b.left - r.left)}px`;
      node.style.top = `${Math.round(b.bottom - r.top + 6)}px`;
      const close = () => closePeek();
      doc.addEventListener?.("pointerdown", close, true);
      doc.addEventListener?.("wheel", close, true);
      peek = { node, rec, off: () => { doc.removeEventListener?.("pointerdown", close, true); doc.removeEventListener?.("wheel", close, true); } };
    });
  };
  const dropKidsBadge = (rec) => {
    if (!rec.kidsBtn) return;
    if (peek?.rec === rec) closePeek();
    for (const off of rec.kidsOffs || []) off();
    rec.kidsOffs = [];
    rec.kidsBtn.remove();
    rec.kidsBtn = null;
  };
  const toggleKids = (uid) => {
    const item = lastBoard?.items.get(uid);
    if (!isKidsCard(item)) return false;
    const rec = shells.get(uid);
    const on = !item.kids;
    const extra = on ? Math.ceil((Number(rec?.kidRows) || 0) * KID_ROW_H + 8) : 0;
    void session?.setKids?.(uid, on, extra);
    return true;
  };
  const syncKidsBadge = (rec, itemArg) => {
    const item = itemArg || lastBoard?.items.get(rec.uid);
    const want = Boolean(item) && isKidsCard(item) && lod === "detail" && editing?.uid !== rec.uid
      && !item.collapsed && !rec.refBoard && !rec.bare && Number(rec.kidCount) > 0;
    if (!want) return dropKidsBadge(rec);
    const text = `${item.kids ? "\u25BE" : "\u25B8"} ${rec.kidCount}`;
    if (!rec.kidsBtn) {
      const btn = el("button", "pxd-kids", rec.el);
      btn.type = "button";
      rec.kidsOffs = [];
      const on = (type, fn) => {
        btn.addEventListener(type, fn);
        rec.kidsOffs.push(() => btn.removeEventListener(type, fn));
      };
      for (const type of ["pointerdown", "mousedown", "dblclick"]) {
        on(type, (event) => { stopEvent(event); peekTimer?.(); peekTimer = null; });
      }
      on("click", (event) => { stopEvent(event); closePeek(); toggleKids(rec.uid); });
      on("mouseenter", (event) => {
        if (event.buttons || peek || peekTimer) return;
        peekTimer = later(() => openPeek(rec), PEEK_DELAY_MS);
      });
      on("mouseleave", () => closePeek());
      rec.kidsBtn = btn;
    }
    rec.kidsBtn.textContent = text;
    rec.kidsBtn.setAttribute("aria-expanded", item.kids ? "true" : "false");
    rec.kidsBtn.setAttribute("aria-label", `${rec.kidCount} ${rec.kidCount === 1 ? "child" : "children"}`);
    rec.kidsBtn.setAttribute("data-tip", "kids");
    rec.kidsBtn.setAttribute("data-tip-state", item.kids ? "on" : "off");
  };

  // ---------------------------------------------------------------- content
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks) {
      if (budget.n >= CONTENT_LIMIT) return;
      const s = childString(b);
      // The due date is the chip. The BT_attrDue child stays in the block and is never rewritten.
      if (attrNameOf(s) === "BT_attrDue") continue;
      budget.n += 1;
      const row = el("div", "pxd-block", parent);
      row.dataset.uid = childUid(b);
      row.setAttribute("data-pxd-row", childUid(b));
      const node = renderRowRoot(row, s, "pxd-rs pxd-block__text", childUid(b));
      budget.roots.push(node);
      const kids = childKids(b);
      if (kids.length && depth < CONTENT_DEPTH) {
        const wrap = el("div", "pxd-block__children", row);
        renderBlocks(wrap, kids, depth + 1, budget);
      }
    }
  };

  const openBoard = (uid) => { if (onOpenBoard) onOpenBoard(uid); else host?.openBlock?.(uid); };
  const commitBoardName = (uid, name) => (onRenameBoard || ((u, n) => session?.renameBoard?.(u, n)))(uid, name);

  // Board card body: a thumbnail of the child board (padded frame, titled minis, section frames, hairline connections),
  // the item count and, while untitled, a name field. `openUid` is the board the Open button navigates to.
  const mountBoardBody = (body, item, { openUid = item.uid } = {}) => {
    const innerW = Math.max(1, (Number(item.w) || 0) - 24);
    const preview = boardPreview(item, { aspect: innerW / Math.max(40, (Number(item.h) || 0) - HEADER_H - META_H) });
    const wrap = el("div", "pxd-item__board", body);
    const holder = el("div", "pxd-board-preview", wrap);
    if (preview.empty) {
      el("div", "pxd-board-preview__empty", holder).textContent = "Empty board";
    } else {
      const canvas = el("div", "pxd-board-preview__canvas", holder);
      const pct = (n) => `${Math.round(n * 10000) / 100}%`;
      const addMini = (r) => {
        const cls = ["pxd-mini"];
        if (r.type === "section") cls.push("pxd-mini--section");
        else if (r.type === "text") cls.push("pxd-mini--text");
        if (r.color) cls.push(`pxd-c-${r.color}`);
        if (r.w * innerW < TINY_MINI_PX) cls.push("pxd-mini--tiny");
        const mini = el("div", cls.join(" "), canvas);
        mini.style.left = pct(r.x);
        mini.style.top = pct(r.y);
        mini.style.width = pct(r.w);
        mini.style.height = pct(r.h);
        // Ref and image cards have no text of their own: use the referenced block's first line, or the kind.
        let title = r.title;
        if (!title && r.ref) {
          const text = host?.blockString?.(r.ref);
          if (typeof text === "string") title = firstLine(text).slice(0, REF_TITLE_MAX);
        }
        if (!title && r.kind === "image") title = "Image";
        if (title) el("div", "pxd-mini__title", mini).textContent = title;
      };
      // Sections first, then the connection hairlines, then cards on top (rects arrive sections-first).
      for (const r of preview.rects) if (r.type === "section") addMini(r);
      if (preview.edges.length) {
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "pxd-board-preview__edges");
        svg.setAttribute("viewBox", "0 0 1 1");
        svg.setAttribute("preserveAspectRatio", "none");
        for (const e of preview.edges) {
          const line = doc.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", String(e.x1));
          line.setAttribute("y1", String(e.y1));
          line.setAttribute("x2", String(e.x2));
          line.setAttribute("y2", String(e.y2));
          svg.append(line);
        }
        canvas.append(svg);
      }
      for (const r of preview.rects) if (r.type !== "section") addMini(r);
    }
    if (item.enhanced && isUntitledBoard(item.title)) {
      const input = el("input", "pxd-input pxd-item__board-name", wrap);
      input.type = "text";
      input.setAttribute("aria-label", "Board name");
      input.placeholder = "Name this board…";
      input.setAttribute("placeholder", "Name this board…");
      for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) input.addEventListener(type, stopEvent);
      let done = false;
      const commit = () => {
        if (done) return;
        const name = String(input.value || "").trim();
        if (!name) return;
        done = true;
        commitBoardName(item.uid, name);
      };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); commit(); input.blur?.(); }
        else if (event.key === "Escape") { event.preventDefault(); input.value = ""; input.blur?.(); }
      });
      input.addEventListener("blur", commit);
    }
    const meta = el("div", "pxd-item__board-meta", wrap);
    el("span", "pxd-item__board-count", meta).textContent = `${preview.count} ${preview.count === 1 ? "item" : "items"}`;
    const open = el("button", "pxd-btn pxd-item__open", meta);
    open.type = "button";
    open.textContent = "Open";
    open.setAttribute("aria-label", "Open");
    open.dataset.action = "open";
    for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stopEvent);
    open.addEventListener("click", (event) => { event.stopPropagation(); openBoard(openUid); });
  };

  // ---- page cards (PG-1): the whole outline, rows tagged data-pxd-row, folded blocks folded.
  const fetchPage = (title) => (host?.pageOutline
    ? host.pageOutline(title, OUTLINE_FETCH)
    : host?.pagePreview?.(title, 64, OUTLINE_FETCH));
  const pageKeyOf = (blocks) => {
    const parts = [];
    const walk = (list) => {
      for (const c of list) {
        parts.push(childUid(c), childString(c), c.open === false ? "0" : "1");
        walk(childKids(c));
      }
    };
    walk(blocks || []);
    return parts.join("\u0001");
  };
  const countRows = (blocks) => {
    let n = 0;
    for (const c of blocks) {
      if (attrNameOf(childString(c)) === "BT_attrDue") continue;
      n += 1;
      if (c.open !== false) n += countRows(childKids(c));
    }
    return n;
  };
  const openPageByTitle = (title, uid) => {
    const id = uid || host?.pageUid?.(title);
    if (id) host?.openPage?.(id);
  };
  const moreRow = (parent, n, title, uid) => {
    const more = el("button", "pxd-row__more", parent);
    more.type = "button";
    more.textContent = `+${n} more`;
    more.setAttribute("aria-label", `${n} more blocks, open the page`);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) more.addEventListener(type, stopEvent);
    more.addEventListener("click", (event) => { stopEvent(event); openPageByTitle(title, uid); });
    return more;
  };
  const renderOutline = (parent, blocks, b, rec) => {
    for (const blk of blocks) {
      const s = childString(blk);
      if (attrNameOf(s) === "BT_attrDue") continue;
      const uid = childUid(blk);
      const kids = childKids(blk);
      const folded = blk.open === false && kids.length > 0;
      if (b.n >= OUTLINE_CAP) { b.more += 1 + (folded ? 0 : countRows(kids)); continue; }
      b.n += 1;
      const row = el("div", "pxd-block pxd-prow", parent);
      row.dataset.uid = uid;
      row.setAttribute("data-uid", uid);
      const line = el("div", "pxd-row", row);
      line.dataset.pxdRow = uid;
      line.setAttribute("data-pxd-row", uid);
      let wrap = null;
      let fold = null;
      if (kids.length) {
        fold = el("button", "pxd-row__fold", line);
        fold.type = "button";
        fold.setAttribute("aria-label", folded ? "Unfold" : "Fold");
        fold.setAttribute("aria-expanded", folded ? "false" : "true");
        for (const type of ["pointerdown", "mousedown", "dblclick"]) fold.addEventListener(type, stopEvent);
      }
      b.roots.push(renderRowRoot(line, s, "pxd-rs pxd-block__text", uid));
      if (!kids.length) continue;
      wrap = el("div", "pxd-block__children", row);
      let filled = false;
      const fill = () => {
        if (filled) return;
        filled = true;
        startRows();
        const sub = { n: b.n, more: 0, roots: [] };
        renderOutline(wrap, kids, sub, rec);
        b.n = sub.n;
        if (sub.more) moreRow(wrap, sub.more, rec.pageTitle, rec.pageUid);
        if (rec.pageHolder && rec.pageHolder.isConnected !== false) { rec.pageRoots.push(...sub.roots); rec.roots.push(...sub.roots); }
      };
      if (folded) setHidden(wrap, true);
      else { filled = true; renderOutline(wrap, kids, b, rec); }
      row.classList.toggle("pxd-prow--folded", folded);
      fold.addEventListener("click", (event) => {
        stopEvent(event);
        const open = fold.getAttribute("aria-expanded") !== "true";
        if (open) fill();
        fold.setAttribute("aria-expanded", open ? "true" : "false");
        fold.setAttribute("aria-label", open ? "Fold" : "Unfold");
        row.classList.toggle("pxd-prow--folded", !open);
        setHidden(wrap, !open);
        onPageLayout?.(rec.uid);
      });
    }
  };
  // Replaces the holder's rows. Returns the new live roots; the caller files them under rec.roots.
  const paintPage = (rec, holder, p) => {
    startRows();
    const old = new Set(rec.pageRoots || []);
    for (const node of old) {
      try { node.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
      try { host?.unmount?.(embedLive(node)); } catch { /* not a roam root */ }
    }
    if (old.size && rec.roots) rec.roots = rec.roots.filter((node) => !old.has(node));
    holder.replaceChildren();
    rec.pageRoots = [];
    rec.pageTitle = p?.title || rec.pageTitle || "";
    if (!p?.exists) {
      rec.pageKey = "";
      el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
      onPageLayout?.(rec.uid);
      return [];
    }
    rec.pageUid = p.uid || null;
    rec.pageKey = pageKeyOf(p.blocks);
    const b = { n: 0, more: 0, roots: [] };
    renderOutline(holder, p.blocks || [], b, rec);
    if (!b.n) el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
    if (b.more) moreRow(holder, b.more, rec.pageTitle, rec.pageUid);
    rec.pageRoots = [...b.roots];
    onPageLayout?.(rec.uid);
    return b.roots;
  };

  // BA-3: where a page card row sits, relative to the card top, in world px (screen px / zoom). Null when the card
  // has no rendered outline to measure (not mounted, editing, map tier): the edge then keeps its plain side point.
  const round1 = (n) => Math.round(n * 10) / 10;
  const measureRow = (uid, rowUid) => {
    const rec = shells.get(uid);
    const holder = rec?.pageHolder;
    if (!rec?.body || !holder || holder.isConnected === false || editing?.uid === uid || !rec.pageKey) return null;
    const z = zoomCache || 1;
    const card = rec.el.getBoundingClientRect();
    const body = rec.body.getBoundingClientRect();
    const out = { bodyTop: round1((body.top - card.top) / z), bodyBottom: round1((body.bottom - card.top) / z) };
    const row = holder.querySelector?.(`[data-pxd-row="${rowUid}"]`);
    const r = row ? row.getBoundingClientRect() : null;
    if (!r || (!r.width && !r.height)) return { ...out, rowTop: null, rowHeight: 0, rendered: false };
    const cardLeft = card.left;
    return { ...out, rowTop: round1((r.top - card.top) / z), rowHeight: round1(r.height / z), rowLeft: round1((r.left - cardLeft) / z), rowRight: round1((r.right - cardLeft) / z), rendered: true };
  };
  // RF-2: rows that a block arrow ends on carry a persistent mark (class, edge color, edge uids, tooltip text).
  // `entries` = [{ card, row, edges: [uid], color, tip }]; rows marked before and absent now are cleared.
  const markedRows = new Set();
  const rowOf = (uid, rowUid) => shells.get(uid)?.pageHolder?.querySelector?.(`[data-pxd-row="${rowUid}"]`) ?? null;
  const unmarkRow = (row) => {
    row.classList.remove("pxd-row--linked", "pxd-row--hot");
    row.style.removeProperty("--pxd-row-line");
    row.removeAttribute("data-pxd-edges");
    row.removeAttribute("data-tip");
    row.removeAttribute("data-tip-extra");
  };
  const markRows = (entries) => {
    const keep = new Set();
    for (const en of entries || []) {
      const row = rowOf(en.card, en.row);
      if (!row) continue;
      keep.add(row);
      row.classList.add("pxd-row--linked");
      if (en.color) row.style.setProperty("--pxd-row-line", en.color); else row.style.removeProperty("--pxd-row-line");
      row.setAttribute("data-pxd-edges", en.edges.join(" "));
      row.setAttribute("data-tip", "edge.row");
      row.setAttribute("data-tip-extra", en.tip || "");
      markedRows.add(row);
    }
    for (const row of [...markedRows]) {
      if (keep.has(row)) continue;
      markedRows.delete(row);
      unmarkRow(row);
    }
  };
  const setRowHot = (uid, rowUid, on) => {
    const row = rowOf(uid, rowUid);
    row?.classList?.toggle("pxd-row--hot", Boolean(on));
  };
  // Scrolls the body so the row is centered and flashes it. False when the row is not on screen to scroll to.
  const revealRow = (uid, rowUid) => {
    const rec = shells.get(uid);
    const row = rec?.pageHolder?.querySelector?.(`[data-pxd-row="${rowUid}"]`);
    if (!rec?.body || !row) return false;
    const r = row.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const body = rec.body.getBoundingClientRect();
    const delta = (r.top + r.height / 2 - (body.top + body.height / 2)) / (zoomCache || 1);
    rec.body.scrollTop = Math.max(0, (Number(rec.body.scrollTop) || 0) + delta);
    row.classList.add("pxd-row--flash");
    later(() => row.classList.remove("pxd-row--flash"), 600);
    onPageLayout?.(uid);
    return true;
  };
  let pageWatches = 0;
  const armPageWatch = (rec, item, holder) => {
    if (disposed || rec.pageUnwatch || !host?.watchPage || pageWatches >= PAGE_WATCH_MAX) return;
    let pending = null;
    const refresh = () => {
      pending = null;
      if (disposed || editing?.uid === rec.uid || rec.pageHolder !== holder || holder.isConnected === false) return;
      let got;
      try { got = fetchPage(item.title); } catch { return; }
      Promise.resolve(got).then((p) => {
        if (disposed || editing?.uid === rec.uid || rec.pageHolder !== holder) return;
        if (p?.exists ? pageKeyOf(p.blocks) === rec.pageKey : rec.pageKey === "") return;
        const keep = Number(rec.body?.scrollTop) || 0;
        rec.roots.push(...paintPage(rec, holder, p));
        if (rec.body && keep) rec.body.scrollTop = keep;
      }).catch(() => {});
    };
    let off = null;
    try {
      off = host.watchPage(item.title, () => {
        if (pending) return;
        pending = later(refresh, PAGE_REFRESH_MS);
      });
    } catch { return; }
    pageWatches += 1;
    rec.pageUnwatch = () => {
      rec.pageUnwatch = null;
      try { off?.(); } catch { /* already off */ }
      pending?.();
      pending = null;
      pageWatches -= 1;
    };
  };

  const mountContentBody = (rec, item) => {
    startRows();
    noteRender(item.uid);
    rec.kidCount = 0;
    rec.kidRows = 0;
    const body = rec.body;
    unmountRoots(rec);
    body.replaceChildren();
    rec.bare = false;
    rec.el.classList.remove("pxd-item--bare");
    const budget = { n: 0, roots: [] };
    if (item.collapsed) {
      rec.contentKey = contentKeyOf(item);
      rec.roots = [];
      return;
    }
    if (item.type === "text") {
      budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__text", item.uid));
    } else if (item.kind === "image") {
      budget.roots.push(renderRoot(el("div", "pxd-item__media", body), item.string, "pxd-rs", item.uid));
    } else if (item.kind === "board") {
      mountBoardBody(body, item);
    } else if (item.kind === "page") {
      if (item.open === false) {
        rec.roots = [];
        rec.contentKey = contentKeyOf(item);
        return;
      }
      const holder = el("div", "pxd-item__page", body);
      rec.pageHolder = holder;
      if (onPageLayout && !rec.scrollOff) {
        const onScroll = () => onPageLayout(rec.uid);
        body.addEventListener("scroll", onScroll, { passive: true });
        rec.scrollOff = () => body.removeEventListener("scroll", onScroll, { passive: true });
      }
      rec.pageTitle = item.title;
      const preview = fetchPage(item.title);
      // contentKey is stamped after mountContent returns, so only the async path can be stale.
      const apply = (p, sync = false) => {
        if (disposed || !holder.parentElement || (!sync && rec.contentKey !== contentKeyOf(item))) return;
        const roots = paintPage(rec, holder, p);
        if (sync) budget.roots.push(...roots);
        else rec.roots.push(...roots);
      };
      if (preview && typeof preview.then === "function") preview.then((p) => apply(p)).catch(() => {});
      else apply(preview, true);
      mountLinkedRefs(body, rec, item);
      armPageWatch(rec, item, holder);
    } else if (item.kind === "block") {
      const ref = item.target.uid;
      const refString = host?.blockString?.(ref);
      const isBoardRef = typeof refString === "string" && classifyString(refString).kind === "board";
      if (isBoardRef) rec.refTitle = parseBoardTitle(refString) || "Untitled board";
      else if (typeof refString === "string" && isQueryString(refString)) rec.refTitle = "Query";
      else rec.refTitle = typeof refString === "string" ? firstLine(refString).slice(0, REF_TITLE_MAX) : "";
      if (editing?.uid !== item.uid) rec.header.textContent = String(rec.refTitle || item.title || "").slice(0, HEADER_TEXT_MAX);
      if (isBoardRef) {
        if (item.open === false) {
          rec.roots = budget.roots;
          rec.contentKey = contentKeyOf(item);
          return;
        }
        // Whiteboard shortcut: the same thumbnail from the referenced board's children. Never renderString (a nested overlay).
        const pulled = host?.pullBoard?.(ref);
        mountBoardBody(body, {
          uid: ref,
          string: refString,
          content: pulled?.[":block/children"] ?? pulled?.children ?? [],
          w: item.w,
          h: item.h,
          title: rec.refTitle,
          enhanced: false,
        }, { openUid: ref });
      } else if (typeof refString === "string" && isQueryString(refString) && host?.renderBlock) {
        budget.roots.push(mountQuery(body, ref));
      } else {
        if (typeof refString === "string" && refString.trim()) budget.roots.push(renderRoot(body, refString, "pxd-rs pxd-item__string", ref));
        const tree = host?.pullTree?.(ref, item.kids ? CONTENT_DEPTH : 1, 200);
        const apply = (blocks, sync = false) => {
          if (disposed || !body.isConnected || (!sync && rec.contentKey !== contentKeyOf(item))) return;
          startRows();
          if (!refString?.trim() && !blocks?.length) el("div", "pxd-item__placeholder", body).textContent = "Empty card";
          rec.kidCount = visibleKids(blocks).length;
          rec.kidRows = kidRowsOf(blocks);
          if (item.kids) {
            const b = { n: 0, roots: [] };
            renderBlocks(body, blocks || [], 1, b);
            if (sync) budget.roots.push(...b.roots);
            else rec.roots.push(...b.roots);
          }
          if (!sync) syncKidsBadge(rec, item);
        };
        if (tree && typeof tree.then === "function") tree.then((t) => apply(t)).catch(() => {});
        else apply(tree, true);
      }
    } else if (isQueryString(item.string) && host?.renderBlock) {
      budget.roots.push(mountQuery(body, item.uid));
    } else {
      if (item.string?.trim()) budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__string", item.uid));
      rec.kidCount = visibleKids(item.content).length;
      rec.kidRows = kidRowsOf(item.content);
      if (item.kids) renderBlocks(body, item.content || [], 1, budget);
      if (!item.string?.trim() && !(item.content || []).length) {
        el("div", "pxd-item__placeholder", body).textContent = "Empty card";
      }
    }
    rec.roots = budget.roots;
    rec.contentKey = contentKeyOf(item);
  };

  const mountContent = (rec, item) => {
    mountContentBody(rec, item);
    syncKidsBadge(rec, item);
  };

  const mountSectionTitle = (rec, item) => {
    noteRender(item.uid);
    unmountRoots(rec);
    rec.title.replaceChildren();
    const node = renderRoot(rec.title, item.string || "Section", "pxd-rs pxd-section__title-text", item.uid);
    if (!item.string) node.textContent = "Section";
    rec.roots = [node];
    rec.titleRendered = true;
    rec.contentKey = contentKeyOf(item);
  };

  const unmountContent = (uid) => {
    const rec = shells.get(uid);
    if (!rec || editing?.uid === uid) return;
    unmountRoots(rec);
    if (rec.type === "section") {
      rec.title.replaceChildren();
      rec.title.textContent = lastBoard?.items.get(uid)?.title || "Section";
      rec.titleRendered = false;
    } else {
      rec.body?.replaceChildren?.();
      dropKidsBadge(rec);
      if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
      onPageLayout?.(uid);
    }
    rec.contentKey = null;
    mounted.delete(uid);
  };

  const pump = (deadline) => {
    idleHandle = null;
    if (disposed || paused || !lastBoard) return;
    const start = now();
    const has = (deadline && typeof deadline.timeRemaining === "function") ? () => deadline.timeRemaining() > 1 : () => true;
    while (queue.length && now() - start < CHUNK_MS && has()) {
      const uid = queue.shift();
      if (!wanted.has(uid) || mounted.has(uid)) continue;
      const rec = shells.get(uid);
      const item = lastBoard.items.get(uid);
      if (!rec || !item || editing?.uid === uid) continue;
      if (rec.type === "section") mountSectionTitle(rec, item);
      else mountContent(rec, item);
      mounted.delete(uid);
      mounted.set(uid, now());
    }
    if (queue.length) idleHandle = idle(pump);
    evict();
  };

  const evict = () => {
    if (mounted.size <= LRU_CAP) return;
    const victims = [];
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!wanted.has(uid)) victims.push(uid);
    }
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!victims.includes(uid)) victims.push(uid);
    }
    victims.forEach(unmountContent);
  };

  let unmountTimer = null;
  const scheduleUnmounts = () => {
    if (unmountTimer) return;
    unmountTimer = later(() => {
      unmountTimer = null;
      if (disposed) return;
      const t = now();
      for (const [uid, seen] of [...mounted]) {
        if (!wanted.has(uid) && t - seen >= UNMOUNT_AFTER_MS - 1) unmountContent(uid);
      }
      if ([...mounted.keys()].some((u) => !wanted.has(u))) scheduleUnmounts();
    }, UNMOUNT_AFTER_MS);
  };

  // Decide which items need content for the current viewport; mount in idle chunks.
  // `quieted` drops every live Roam root while the user types outside the board.
  // A keystroke is a Roam transaction, and each renderString root re-renders on it.
  let lastContent = null;
  let quieted = false;
  const holdQuiet = (rec, uid) => {
    if (!rec.roots?.length || editing?.uid === uid) return;
    if (rec.type === "section") {
      const text = rec.title?.textContent || lastBoard?.items.get(uid)?.title || "Section";
      unmountRoots(rec);
      if (rec.title) rec.title.textContent = text;
      rec.titleRendered = false;
    } else if (rec.body) {
      const text = rec.body.textContent || "";
      unmountRoots(rec);
      rec.body.replaceChildren();
      if (text) el("div", "pxd-quiet", rec.body).textContent = text;
    } else {
      unmountRoots(rec);
    }
    rec.contentKey = null;
    mounted.delete(uid);
  };
  const fillContent = ({ visibleRect, zoom = zoomCache, tier = null }) => {
    zoomCache = zoom;
    if (!lastBoard || !lastRects) return;
    const next = new Set();
    if ((tier ?? lodForZoom(zoom)) === "detail") {
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        if (r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    } else {
      // map / overview LOD: section titles, text items and board thumbnails, including whiteboard-shortcut cards (plain divs) stay rendered; card bodies unmount later
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        const keep = rec.type === "section" || rec.type === "text" || rec.refBoard || lastBoard.items.get(uid)?.kind === "board";
        if (keep && r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    }
    wanted = next;
    const t = now();
    for (const uid of next) if (mounted.has(uid)) mounted.set(uid, t);
    queue = [...next].filter((u) => !mounted.has(u));
    if (queue.length && !paused && !idleHandle) idleHandle = idle(pump);
    if ([...mounted.keys()].some((u) => !next.has(u))) scheduleUnmounts();
  };
  const scheduleContent = (args) => {
    lastContent = args;
    if (quieted) return;
    fillContent(args);
  };
  // Detach live Roam roots so a keystroke elsewhere does not re-render every card.
  // The words stay as plain text. The next schedule puts the live roots back.
  const quiet = (on) => {
    const next = Boolean(on);
    if (next === quieted) return;
    quieted = next;
    if (quieted) {
      if (idleHandle) { idleHandle(); idleHandle = null; }
      queue = [];
      for (const [uid, rec] of shells) holdQuiet(rec, uid);
      return;
    }
    if (lastContent) fillContent(lastContent);
  };

  const setPaused = (on) => {
    paused = Boolean(on);
    if (paused && idleHandle) { idleHandle(); idleHandle = null; }
    if (!paused && queue.length && !idleHandle) idleHandle = idle(pump);
  };

  const setZoom = (zoom) => {
    const next = Number(zoom);
    const prevZoom = zoomCache;
    zoomCache = next > 0 && Number.isFinite(next) ? next : 1;
    if (zoomCache !== prevZoom) closePeek();
    if (editing?.editor) applyEditorCounterScale(editing.editor, zoomCache);
  };

  const setLod = (nextLod, zoom) => {
    const prev = lod;
    lod = nextLod === "map" || nextLod === "overview" ? nextLod : "detail";
    setZoom(zoom);
    closePeek();
    if (prev !== lod) for (const rec of shells.values()) if (rec.kidsBtn || rec.kidCount > 0) syncKidsBadge(rec);
    if (showBadges && (prev === "detail") !== (lod === "detail")) {
      if (lod !== "detail") {
        const pending = [];
        for (const rec of shells.values()) if (rec.badgeEl) pending.push(rec);
        const step = () => {
          for (const rec of pending.splice(0, 40)) {
            rec.badgeEl.remove();
            rec.badgeEl = null;
            rec.badgeKey = null;
          }
          if (pending.length) {
            if (timers?.frame) timers.frame(step);
            else step();
          }
        };
        // The class flip is the frame the zoom crossed. Badge removal waits for the
        // next frame when a frame timer exists, so the two do not share one long task.
        if (timers?.frame) timers.frame(step);
        else step();
      } else {
        for (const rec of shells.values()) renderBadges(rec);
      }
    }
  };

  // ---------------------------------------------------------------- preview during gestures
  const previewMove = (uids, dx, dy, board, rects) => {
    const set = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(board, u)) set.add(d);
    const live = new Map();
    for (const uid of set) {
      const rec = shells.get(uid);
      const r = rects.get(uid);
      if (!rec || !r) continue;
      const moved = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
      rec.el.style.transform = `translate(${moved.x}px, ${moved.y}px)`;
      live.set(uid, moved);
    }
    return live;
  };
  const previewRects = (list) => {
    const live = new Map();
    for (const r of list) {
      const rec = shells.get(r.uid);
      if (!rec) continue;
      position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
      live.set(r.uid, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return live;
  };

  // Sections only: live auto-fit growth during a drag positions section shells and nothing else.
  const previewSectionRects = (list) => {
    const live = new Map();
    for (const r of list || []) {
      const rec = shells.get(r.uid);
      if (!rec || rec.type !== "section") continue;
      position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
      live.set(r.uid, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return live;
  };
  // Snap shells back to the model rects (a cancelled or refused gesture).
  const resetRects = (rectsMap, uids = null) => {
    for (const uid of uids ? [...uids] : [...shells.keys()]) {
      const rec = shells.get(uid);
      const r = rectsMap?.get?.(uid);
      if (rec && r) position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
  };
  // World-unit height of a mounted card's header plus body content; null when there is nothing to measure.
  const measureContent = (uid) => {
    const rec = shells.get(uid);
    if (!rec || rec.type === "section" || lod !== "detail" || !mounted.has(uid) || rec.bare) return null;
    // The body is a flex child of a fixed-height card, so its scrollHeight is clamped to the box. Let it take its
    // natural height for the read (a one-off user action), then put the inline styles back.
    const body = rec.body;
    const st = body?.style;
    const saved = st ? { flex: st.flex, height: st.height } : null;
    if (st) { st.flex = "0 0 auto"; st.height = "auto"; }
    const natural = Number(body?.scrollHeight) || 0;
    if (st && saved) { st.flex = saved.flex; st.height = saved.height; }
    const h = (Number(rec.header?.offsetHeight) || 0) + natural;
    return h > 0 ? h : null;
  };

  // ---------------------------------------------------------------- badges and focus (read-only, never touch the model)
  const attrChipsOf = (rec, item) => {
    if (item.kind === "board") return [];
    const lines = [];
    const own = item.kind === "block" ? rec.refString : item.string;
    if (typeof own === "string") lines.push(...own.split("\n"));
    for (const c of item.content || []) lines.push(...String(childString(c)).split("\n"));
    const out = [];
    for (const line of lines) {
      if (out.length >= ATTR_CHIPS_MAX) break;
      const name = attrNameOf(line);
      if (!name || name === "BT_attrDue") continue;
      const value = plainText(line.slice(line.indexOf("::") + 2), 40);
      if (value) out.push(`${plainText(name, 24)}: ${value}`);
    }
    return out;
  };

  const renderBadges = (rec) => {
    const item = lastBoard?.items.get(rec.uid);
    const visible = showBadges && lod === "detail" && rec.type === "card" && item && editing?.uid !== rec.uid;
    const clear = () => { if (rec.badgeEl) { rec.badgeEl.remove(); rec.badgeEl = null; } rec.badgeKey = null; };
    if (!visible) return clear();
    const info = badgeMap?.get?.(rec.uid) || null;
    const chips = [];
    if (info?.refs > 0) chips.push({ cls: "refs", text: `${info.refs} refs`, title: `${info.refs} references to this card` });
    if (info?.boards > 0) chips.push({ cls: "boards", text: `on ${info.boards} boards`, title: "Shown on other boards", action: "boards" });
    if (info && (info.open > 0 || info.done > 0)) chips.push({ cls: "todo", text: `${info.open || 0}/${info.done || 0}`, title: `${info.open || 0} open, ${info.done || 0} done` });
    const comments = commentCount(lastBoard, rec.uid);
    if (comments > 0) chips.push({ cls: "comments", text: `${comments}`, title: `${comments} comments` });
    const due = item.type === "card" ? dueChip(item.content) : null;
    if (due) chips.unshift({ cls: "due", text: due.text, title: "Due", overdue: due.overdue });
    for (const text of attrChipsOf(rec, item)) chips.push({ cls: "attr", text });
    if (!chips.length) return clear();
    const key = JSON.stringify(chips);
    if (rec.badgeEl && rec.badgeKey === key) return;
    clear();
    const row = el("div", "pxd-item__badges", rec.el);
    for (const chip of chips) {
      const node = el(chip.action ? "button" : "span", `pxd-badge-chip pxd-badge-chip--${chip.cls}`, row);
      node.textContent = chip.text;
      if (chip.overdue) node.classList.add("pxd-badge-chip--overdue");
      if (chip.title) node.title = chip.title;
      if (chip.action) {
        node.type = "button";
        node.setAttribute("aria-label", chip.title || chip.text);
        for (const type of ["pointerdown", "mousedown", "dblclick"]) node.addEventListener(type, stopEvent);
        node.addEventListener("click", (event) => { event.stopPropagation(); onBadgeClick?.(rec.uid, chip.action); });
      }
    }
    rec.badgeEl = row;
    rec.badgeKey = key;
  };

  const setBadges = (map) => {
    badgeMap = map instanceof Map ? map : new Map();
    if (showBadges) for (const rec of shells.values()) renderBadges(rec);
  };
  const setShowBadges = (on) => {
    const next = Boolean(on);
    if (next === showBadges) return;
    showBadges = next;
    for (const rec of shells.values()) renderBadges(rec);
  };

  const setFocus = (uids) => {
    focusSet = uids ? new Set(uids) : null;
    for (const [uid, rec] of shells) {
      const on = Boolean(focusSet && !focusSet.has(uid));
      if (rec.focusDim === on) continue;
      rec.focusDim = on;
      rec.el.classList.toggle(rec.type === "section" ? "pxd-section--focus-dim" : "pxd-item--focus-dim", on);
    }
  };

  const setSelection = (uids) => {
    const list = Array.isArray(uids) ? uids : [];
    const set = new Set(list);
    let primary = null;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (shells.has(list[i])) { primary = list[i]; break; }
    }
    for (const [uid, rec] of shells) {
      const on = set.has(uid);
      if (rec.selected !== on) {
        rec.selected = on;
        rec.el.classList.toggle(rec.type === "section" ? "pxd-section--selected" : "pxd-item--selected", on);
      }
      const tab = uid === primary ? 0 : -1;
      if (rec.tabStop !== tab) {
        rec.tabStop = tab;
        rec.el.tabIndex = tab;
      }
    }
  };
  const setHover = (uid) => {
    for (const [u, rec] of shells) {
      const on = u === uid;
      if (rec.hover === on) continue;
      rec.hover = on;
      rec.el.classList.toggle("pxd-item--drop", on);
    }
  };

  // ---------------------------------------------------------------- edit mode
  const onFocusSteal = (event) => {
    if (!editing) return;
    const target = event.target;
    if (!target || editing.editor.contains?.(target)) return;
    const isInput = target.classList?.contains?.("rm-block__input") || String(target.tagName || "").toLowerCase() === "textarea";
    if (!isInput) return;
    const hostEl = typeof target.closest === "function" ? target.closest("[data-uid]") : null;
    const uid = hostEl?.dataset?.uid || String(target.id || "").match(/([A-Za-z0-9_-]{9})$/)?.[1];
    if (uid !== editing.targetUid) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  const onDocPointerDown = (event) => {
    if (!editing) return;
    if (editing.rec.el.contains?.(event.target)) return;
    lastOutsideDown = now();
  };
  const attachFocusGuard = () => {
    if (focusGuard || typeof doc.addEventListener !== "function") return;
    doc.addEventListener("focus", onFocusSteal, true);
    doc.addEventListener("scroll", onFocusSteal, true);
    doc.addEventListener("pointerdown", onDocPointerDown, true);
    focusGuard = () => {
      doc.removeEventListener("focus", onFocusSteal, true);
      doc.removeEventListener("scroll", onFocusSteal, true);
      doc.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  };
  const detachFocusGuard = () => {
    floorTeardown?.();
    floorTeardown = null;
    focusGuard?.();
    focusGuard = null;
  };

  // Focus floor: when Roam drops focus to <body> mid-edit (Enter creating a child block), refocus its live textarea.
  // Never writes to the graph (rule 19.2) and stands down for any real pointer or focus target outside the editor.
  const FLOOR_WINDOW_MS = 600;
  const FLOOR_POINTER_MS = 300;
  const FLOOR_MAX = 4;
  const FLOOR_SPAN_MS = 1500;
  const frameLater = (fn) => {
    if (timers?.frame) return timers.frame(fn);
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") { const id = raf(fn); return () => globalThis.cancelAnimationFrame?.(id); }
    const t = setTimeout(fn, 16);
    return () => clearTimeout(t);
  };
  const rootOfLayer = () => itemsLayer?.closest?.(".pxd-root") ?? null;
  const focusLost = (a) => !a || a === doc.body || a === doc.documentElement || a === rootOfLayer();
  const findLiveTextarea = (e) => {
    const list = [...(e.editor.querySelectorAll?.("textarea") || [])];
    if (!list.length) return null;
    const ta = [...list].reverse().find((n) => String(n.id || "").startsWith("block-input-")) || list[list.length - 1];
    return ta?.isConnected ? ta : null;
  };
  const floorTick = (e) => {
    const f = floor;
    if (!f) return;
    f.cancel = null;
    const stop = () => { if (floor === f) floor = null; };
    if (editing !== e || disposed || lastOutsideDown > f.start - FLOOR_POINTER_MS || doc.hasFocus?.() === false) return stop();
    const a = doc.activeElement;
    if (e.editor.contains?.(a)) return stop();
    if (!focusLost(a)) return stop();
    const ta = findLiveTextarea(e);
    if (ta) { recoveries.push(now()); focusRoamInput(ta); return stop(); }
    if (now() - f.start < FLOOR_WINDOW_MS) f.cancel = frameLater(() => floorTick(e));
    else stop();
  };
  const armFloor = () => {
    const e = editing;
    if (!e || disposed || !e.ready || floor) return false;
    const t = now();
    recoveries = recoveries.filter((x) => t - x < FLOOR_SPAN_MS);
    if (recoveries.length >= FLOOR_MAX) {
      // The cap only rate-limits a focus ping-pong with Roam; it must not strand the editor on <body> (typing then goes
      // nowhere). Nothing else re-arms after the burst, so look again once the oldest recovery has aged out.
      if (!floorRetry) {
        floorRetry = later(() => {
          floorRetry = null;
          if (editing === e && !disposed && focusLost(doc.activeElement)) armFloor();
        }, FLOOR_SPAN_MS - (t - recoveries[0]) + 20);
      }
      return false;
    }
    floor = { start: t, cancel: null };
    floor.cancel = frameLater(() => floorTick(e));
    return true;
  };
  const attachFloor = (e) => {
    const onIn = () => { e.ready = true; };
    const onOut = (event) => {
      if (editing !== e || !e.ready) return;
      const to = event.relatedTarget;
      if (to) return; // focus moved to a real target (inside the editor or elsewhere)
      armFloor();
    };
    e.editor.addEventListener("focusin", onIn);
    e.editor.addEventListener("focusout", onOut);
    const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    let mo = null;
    if (typeof MO === "function") {
      mo = new MO(() => { if (editing === e && e.ready && focusLost(doc.activeElement)) armFloor(); });
      try { mo.observe(e.editor, { childList: true, subtree: true }); } catch { /* stub */ }
    }
    // The editing card grows with its text: report its live height so the view can grow the section around it.
    const RO = doc.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    let ro = null;
    if (typeof RO === "function" && onEditResize) {
      ro = new RO(() => { if (editing === e) onEditResize(e.uid, Number(e.rec.el?.offsetHeight) || 0); });
      try { ro.observe(e.editor); } catch { /* stub */ }
    }
    floorTeardown = () => {
      e.editor.removeEventListener("focusin", onIn);
      e.editor.removeEventListener("focusout", onOut);
      mo?.disconnect();
      ro?.disconnect();
      floor?.cancel?.();
      floor = null;
      floorRetry?.();
      floorRetry = null;
    };
  };
  const recoverFocus = () => armFloor();

  const stopEvent = (event) => event.stopPropagation();
  // Rule 19.1: keep these off the diagram block's ancestors. mouseup is NOT listed on purpose: Roam arms
  // block drag-select on the mousedown it gets from the editor and disarms it only in a document-level
  // bubble mouseup listener. Stopping mouseup leaves that state armed, and the next block that appears
  // under the resting pointer (the one Enter creates) turns the text edit into a block selection.
  const EDITOR_STOPPED = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown"];

  const EDIT_FADE_MS = 80;
  // offsetHeight is layout pixels. getBoundingClientRect is after the world scale, and using it
  // as min-height makes the card grow by that scale on the next frame.
  const boxHeight = (node) => {
    const h = Number(node?.offsetHeight) || 0;
    return h > 0 ? h : 0;
  };
  const prefersReducedMotion = () => {
    const mq = doc.defaultView?.matchMedia;
    if (typeof mq !== "function") return false;
    try { return Boolean(mq.call(doc.defaultView, "(prefers-reduced-motion: reduce)")?.matches); }
    catch { return false; }
  };
  const clearEditFade = (e) => {
    e?.fadeCancel?.();
    e?.releaseCancel?.();
    if (e) { e.fadeCancel = null; e.releaseCancel = null; }
  };
  // The static layer stays in the body until the editor is opaque, then this drops it.
  const dropStaticLayer = (rec) => {
    unmountRoots(rec);
    rec.ghost?.remove();
    rec.ghost = null;
  };
  const releaseEditLock = (rec) => {
    if (!rec?.el) return;
    rec.el.style.minHeight = "";
    if (rec.body?.style) rec.body.style.minHeight = "";
    rec.el.classList.remove("pxd-item--xfade");
  };

  const enterEdit = async (uid, { row = "" } = {}) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type === "section" || item.kind === "board" || rec.refBoard) return false;
    if (editing?.uid === uid) return true;
    if (editing) await exitEdit();
    if (!host?.renderBlock) { host?.openBlock?.(uid); return false; }
    const targetUid = item.target.kind === "block" ? item.target.uid : item.uid;
    // Measure before any mount. A 0 box (stub, detached) falls back to the stored card height.
    const contentH = boxHeight(rec.body);
    const lockH = boxHeight(rec.el) || contentH || Number(rec.rect?.h) || 0;
    const reduced = prefersReducedMotion();
    // PG-3: where the clicked row sits in the card, so the editor can put the same block back under the pointer.
    const clickedRow = row ? rec.body.querySelector?.(`[data-pxd-row="${row}"]`) : null;
    const rowOffset = clickedRow
      ? (Number(clickedRow.getBoundingClientRect?.().top) || 0) - (Number(rec.body.getBoundingClientRect?.().top) || 0)
      : null;
    const ghost = el("div", "pxd-item__ghost");
    ghost.setAttribute("aria-hidden", "true");
    for (const node of [...(rec.body.children || [])]) ghost.append(node);
    rec.body.append(ghost);
    rec.ghost = ghost;
    rec.contentKey = null;
    mounted.delete(uid);
    const editor = el("div", "pxd-item__editor", rec.body);
    // Rule 19.1: stop pointer/wheel at the overlay boundary BEFORE the synthetic focus click.
    for (const type of EDITOR_STOPPED) editor.addEventListener(type, stopEvent);
    editing = { uid, rec, editor, targetUid, item, ready: false, fadeCancel: null, releaseCancel: null };
    rec.el.classList.add("pxd-item--editing");
    renderBadges(rec);
    syncKidsBadge(rec, item);
    if (lockH > 0) rec.el.style.minHeight = `${lockH}px`;
    if (reduced) dropStaticLayer(rec);
    else rec.el.classList.add("pxd-item--xfade");
    lastOutsideDown = -Infinity;
    attachFocusGuard();
    attachFloor(editing);
    onEditChange?.(uid);
    let ok = true;
    try {
      if (item.kind === "page") {
        const pageUid = host.pageUid?.(item.title);
        if (pageUid && host.renderPage) host.renderPage(editor, pageUid);
        else host.renderBlock(editor, item.uid);
      } else {
        host.renderBlock(editor, targetUid);
      }
    } catch { ok = false; }
    if (!ok) { await exitEdit({ silent: true }); return false; }
    // Hold the measured box through the crossfade. Release on the next frame only when the
    // editor already fills that box; a shorter editor would collapse the card (ED-1).
    const releaseIfFilled = () => {
      if (editing?.uid !== uid) return;
      const editorH = boxHeight(editor);
      if (!(editorH > 0 && editorH + 1 >= lockH)) return;
      releaseEditLock(rec);
    };
    if (reduced) {
      editing.releaseCancel = frameLater(() => {
        if (editing?.uid !== uid) return;
        editing.releaseCancel = null;
        releaseIfFilled();
      });
    } else {
      editing.fadeCancel = later(() => {
        if (editing?.uid !== uid) return;
        editing.fadeCancel = null;
        rec.el.classList.remove("pxd-item--xfade");
        dropStaticLayer(rec);
        editing.releaseCancel = frameLater(() => {
          if (editing?.uid !== uid) return;
          editing.releaseCancel = null;
          releaseIfFilled();
        });
      }, EDIT_FADE_MS);
    }
    await waitHydrateQuiet(editor, HYDRATE_CAP_MS);
    if (disposed || editing?.uid !== uid) return false;
    let input = null;
    if (rowOffset !== null) {
      for (const node of editor.querySelectorAll?.(".rm-block__input") || []) {
        if (String(node.id || node.getAttribute?.("id") || "").endsWith(`-${row}`)) { input = node; break; }
      }
      if (input) {
        const delta = (Number(input.getBoundingClientRect?.().top) || 0) - (Number(rec.body.getBoundingClientRect?.().top) || 0) - rowOffset;
        if (delta && rec.body) rec.body.scrollTop = Math.max(0, (Number(rec.body.scrollTop) || 0) + delta / (zoomCache || 1));
      }
    }
    if (!input) input = editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea");
    applyEditorCounterScale(editor, zoomCache);
    if (input) focusRoamInput(input);
    // Roam writes an explicit textarea height when the editor focuses. Apply again
    // after that, and once more on the next frame, so the screen font is not clipped.
    applyEditorCounterScale(editor, zoomCache);
    frameLater(() => { if (editing?.uid === uid) applyEditorCounterScale(editor, zoomCache); });
    if (editing?.uid === uid && editor.contains?.(doc.activeElement)) editing.ready = true;
    stopMenus?.();
    stopMenus = null;
    if (editing?.uid === uid) ensureMenus(() => editor.querySelector?.("textarea"));
    return true;
  };

  const exitEdit = async ({ silent = false } = {}) => {
    stopMenus?.();
    stopMenus = null;
    if (doc.querySelector?.(".pxd-root .bp3-popover-open")) ensureMenus();
    const e = editing;
    if (!e) return;
    editing = null;
    clearEditFade(e);
    detachFocusGuard();
    const { rec, editor, uid, item } = e;
    applyEditorCounterScale(editor, 1);
    const contentH = Number(editor.scrollHeight) || 0;
    for (const type of EDITOR_STOPPED) editor.removeEventListener(type, stopEvent);
    dropStaticLayer(rec);
    try { host?.unmount?.(editor); } catch { /* not mounted */ }
    editor.remove();
    rec.el.classList.remove("pxd-item--editing");
    releaseEditLock(rec);
    rec.contentKey = null;
    mounted.delete(uid);
    if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
    if (!silent && !disposed) {
      const live = lastBoard?.items.get(uid) || item;
      if (live && shells.has(uid)) {
        mountContent(rec, live);
        paintShell(rec, live);
        mounted.set(uid, now());
        renderBadges(rec);
      }
      onEditChange?.(null);
      const need = contentH + (["page", "board"].includes(item.kind) || item.collapsed ? HEADER_H : 0) + 20;
      if (contentH > 0 && live && item.kind !== "page" && need > live.h) {
        const grow = Math.min(GROW_CAP, need);
        if (grow > live.h) (onGrow || ((u, h) => session?.growToFit?.(u, h)))(uid, grow);
      }
    }
  };

  const autocompleteOpen = () => Boolean(doc.querySelector?.(".rm-autocomplete__results"));

  // Section title inline rename (plain contenteditable; writes the block string).
  const renameSection = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type !== "section") return false;
    const t = rec.title;
    unmountRoots(rec);
    t.replaceChildren();
    t.textContent = item.string || "";
    t.classList.add("pxd-section__title--editing");
    t.contentEditable = "true";
    t.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      t.contentEditable = "false";
      t.removeAttribute("contenteditable");
      t.classList.remove("pxd-section__title--editing");
      t.removeEventListener("keydown", onKey);
      t.removeEventListener("blur", onBlur);
      t.removeEventListener("pointerdown", stopEvent);
      const next = String(t.textContent || "").trim();
      rec.titleRendered = false;
      rec.contentKey = null;
      mounted.delete(uid);
      if (commit && next !== item.string) (onRenameCommit || ((u, s) => session?.setString?.(u, s)))(uid, next);
      else t.textContent = item.title || "Section";
    };
    const onKey = (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
      else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    t.addEventListener("keydown", onKey);
    t.addEventListener("blur", onBlur);
    t.addEventListener("pointerdown", stopEvent);
    try { t.focus({ preventScroll: true }); } catch { t.focus?.(); }
    // Start with the whole text selected so typing replaces it (Heptabase/Roam rename behavior).
    try { const d = t.ownerDocument; const r = d.createRange(); r.selectNodeContents(t); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); } catch { /* no selection API */ }
    return true;
  };

  // Board title inline rename on the card header (plain contenteditable; writes the block string).
  const renameBoard = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "board" || !item.enhanced || !rec.header || rec.renaming) return false;
    const h = rec.header;
    const seed = parseBoardTitle(item.string);
    rec.renaming = true;
    h.textContent = seed;
    h.classList.add("pxd-item__header--editing");
    h.classList.remove("pxd-item__header--muted");
    h.contentEditable = "true";
    h.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      if (!rec.renaming) return;
      rec.renaming = false;
      h.contentEditable = "false";
      h.removeAttribute("contenteditable");
      h.classList.remove("pxd-item__header--editing");
      h.removeEventListener("keydown", onKey);
      h.removeEventListener("blur", onBlur);
      h.removeEventListener("pointerdown", stopEvent);
      h.removeEventListener("dblclick", stopEvent);
      const next = String(h.textContent || "").trim();
      const live = lastBoard?.items.get(uid) || item;
      h.textContent = live.title || "";
      h.classList.toggle("pxd-item__header--muted", isUntitledBoard(live.title));
      if (commit && next !== seed) commitBoardName(uid, next);
    };
    const onKey = (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
      else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    h.addEventListener("keydown", onKey);
    h.addEventListener("blur", onBlur);
    h.addEventListener("pointerdown", stopEvent);
    h.addEventListener("dblclick", stopEvent);
    try { h.focus({ preventScroll: true }); } catch { h.focus?.(); }
    try { const d = h.ownerDocument; const r = d.createRange(); r.selectNodeContents(h); const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch { /* no selection API */ }
    return true;
  };

  // Page title on the card header. Commits through onRenamePage, which confirms past ten references.
  const renamePage = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "page" || !rec.header || rec.renaming) return false;
    const h = rec.header;
    const seed = String(item.title || "").trim();
    rec.renaming = true;
    h.textContent = seed;
    h.classList.add("pxd-item__header--editing");
    h.contentEditable = "true";
    h.setAttribute("contenteditable", "true");
    const win = doc.defaultView;
    const finish = (commit) => {
      if (!rec.renaming) return;
      rec.renaming = false;
      h.contentEditable = "false";
      h.removeAttribute("contenteditable");
      h.classList.remove("pxd-item__header--editing");
      win?.removeEventListener("keydown", onKey, true);
      h.removeEventListener("blur", onBlur);
      h.removeEventListener("pointerdown", stopEvent);
      h.removeEventListener("dblclick", stopEvent);
      const next = String(h.textContent || "").trim();
      const live = lastBoard?.items.get(uid) || item;
      h.textContent = String(live.title || seed).slice(0, HEADER_TEXT_MAX);
      if (commit && next && next !== seed) onRenamePage?.(seed, next);
    };
    // Window capture: Roam's document listener takes Enter before a bubble listener on the header.
    const onKey = (event) => {
      const here = event.target === h || h.contains?.(event.target);
      if (!here) return;
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    };
    const onBlur = () => finish(true);
    win?.addEventListener("keydown", onKey, true);
    h.addEventListener("blur", onBlur);
    h.addEventListener("pointerdown", stopEvent);
    h.addEventListener("dblclick", stopEvent);
    try { h.focus({ preventScroll: true }); } catch { h.focus?.(); }
    try { const d = h.ownerDocument; const r = d.createRange(); r.selectNodeContents(h); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); } catch { /* no selection API */ }
    return true;
  };

  const dispose = () => {
    disposed = true;
    closePeek();
    doc.removeEventListener?.("pointerup", onMenuPointer, true);
    stopMenus?.();
    stopMenus = null;
    if (editing) {
      const e = editing;
      clearEditFade(e);
      editing = null;
      detachFocusGuard();
      for (const type of EDITOR_STOPPED) e.editor.removeEventListener(type, stopEvent);
      e.rec.ghost?.remove();
      e.rec.ghost = null;
      try { host?.unmount?.(e.editor); } catch { /* not mounted */ }
    }
    if (idleHandle) { idleHandle(); idleHandle = null; }
    if (unmountTimer) { unmountTimer(); unmountTimer = null; }
    for (const uid of [...shells.keys()]) {
      const rec = shells.get(uid);
      unmountRoots(rec);
      dropKidsBadge(rec);
      rec.el.remove();
    }
    shells.clear();
    mounted.clear();
    queue = [];
  };

  return {
    sync,
    scheduleContent,
    quiet,
    setPaused,
    setLod,
    setZoom,
    previewMove,
    previewRects,
    previewSectionRects,
    resetRects,
    measureContent,
    toggleKids,
    setBadges,
    setShowBadges,
    setFocus,
    setSelection,
    setHover,
    enterEdit,
    exitEdit,
    editingUid: () => editing?.uid ?? null,
    isEditing: () => Boolean(editing),
    recoverFocus,
    autocompleteOpen,
    renameSection,
    renameBoard,
    renamePage,
    shellOf: (uid) => shells.get(uid)?.el ?? null,
    measureRow,
    markRows,
    setRowHot,
    revealRow,
    expireContent(uids) {
      for (const uid of uids || []) {
        const rec = shells.get(uid);
        if (!rec || editing?.uid === uid) continue;
        unmountRoots(rec);
        rec.body?.replaceChildren?.();
        rec.contentKey = null;
        mounted.delete(uid);
        rec.titleRendered = false;
        if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
        onPageLayout?.(uid);
      }
      if (uids?.length && lastContent) fillContent(lastContent);
    },
    mountedCount: () => mounted.size,
    mountedUids: () => [...mounted.keys()],
    shellCount: () => shells.size,
    lod: () => lod,
    dispose,
  };
}

export { DEFAULT_SIZES };
