// Item shells (card / text / section), static content, LOD, culling, idle-chunked mounting,
// and edit mode (spec 3.2). Roam content only ever comes from host.renderString /
// renderBlock / renderPage; we never build <img> or fake editors.

import { DEFAULT_SIZES, firstLine, isUntitledBoard, parseBoardTitle, plainText } from "../model/schema.js";
import { boardPreview, descendantsOf } from "../model/board.js";
import { lodForZoom, rectsIntersect } from "../model/geometry.js";

const SIDES = ["top", "right", "bottom", "left"];
const CHUNK_MS = 8;
const LRU_CAP = 80;
const UNMOUNT_AFTER_MS = 4000;
const HYDRATE_CAP_MS = 900;
const CONTENT_LIMIT = 12;
const CONTENT_DEPTH = 2;
const GROW_CAP = 900;
const HEADER_H = 32;
const BOARD_KEY_DEPTH = 3;
const BOARD_KEY_NODES = 400;

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

function contentKeyOf(item) {
  const parts = [item.kind, item.enhanced ? "e" : "", item.string, item.collapsed ? "c" : "", item.fontSize || ""];
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
  onOpenBoard,
  onRenameBoard,
} = {}) {
  const shells = new Map(); // uid → rec
  const mounted = new Map(); // uid → lastWanted (LRU order = insertion order)
  let lod = "detail";
  let zoomCache = 1;
  let paused = false;
  let editing = null;
  let queue = [];
  let idleHandle = null;
  let wanted = new Set();
  let lastBoard = null;
  let lastRects = null;
  let focusGuard = null;
  let floorTeardown = null;
  let floor = null; // { start, cancel } while a focus recovery is pending
  let recoveries = [];
  let lastOutsideDown = -Infinity;
  let disposed = false;

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

  const renderRoot = (parent, string, cls = "pxd-rs") => {
    const node = el("div", cls, parent);
    if (!string) return node;
    try {
      if (host?.renderString) host.renderString(node, string);
      else node.textContent = plainText(string);
    } catch {
      node.textContent = plainText(string);
    }
    return node;
  };

  const unmountRoots = (rec) => {
    if (!rec.roots?.length) return;
    for (const node of rec.roots) { try { host?.unmount?.(node); } catch { /* not a roam root */ } }
    rec.roots = [];
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
    const rec = { uid: item.uid, type: item.type, roots: [], contentKey: null, rect: null };
    if (item.type === "section") {
      const node = el("div", "pxd-section", null);
      rec.el = node;
      rec.title = el("div", "pxd-section__title", node);
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
    shells.set(item.uid, rec);
    return rec;
  };

  const paintShell = (rec, item) => {
    const node = rec.el;
    const base = item.type === "section" ? "pxd-section" : `pxd-item pxd-item--${item.type} pxd-item--${item.kind}`;
    const cls = [base];
    if (item.color) cls.push(`pxd-c-${item.color}`);
    if (item.collapsed) cls.push("pxd-item--collapsed");
    if (!item.string?.trim()) cls.push("pxd-item--empty");
    if (item.type === "text" && item.fontSize) cls.push(`pxd-item--fs${item.fontSize}`);
    if (rec.selected) cls.push(item.type === "section" ? "pxd-section--selected" : "pxd-item--selected");
    if (rec.hover) cls.push("pxd-item--drop");
    if (editing?.uid === item.uid) cls.push("pxd-item--editing");
    node.className = cls.join(" ");
    if (item.type === "section") {
      if (!rec.titleRendered || rec.titleString !== item.string) {
        rec.title.textContent = item.title || "Section";
        rec.titleString = item.string;
        rec.titleRendered = false;
      }
    } else {
      // A block-ref card's title lives in the referenced block; resolve it here so map LOD and collapsed cards keep a header.
      if (item.kind === "block" && item.target?.uid) {
        const refString = host?.blockString?.(item.target.uid);
        rec.refTitle = typeof refString === "string" ? firstLine(refString) : "";
      } else rec.refTitle = "";
      if (editing?.uid !== item.uid && !rec.renaming) rec.header.textContent = item.type === "text" ? "" : (rec.refTitle || item.title || "");
      if (item.type === "text") rec.header.style.display = "none";
      rec.header.classList.toggle("pxd-item__header--muted", item.kind === "board" && isUntitledBoard(item.title));
    }
    node.title = "";
  };

  const position = (rec, rect) => {
    const prev = rec.rect;
    rec.rect = rect;
    if (editing?.uid === rec.uid) {
      // No style writes while typing unless the rect really changed; min-height keeps the card from shrinking.
      if (prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
      rec.el.style.minHeight = `${rect.h}px`;
    }
    rec.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    rec.el.style.width = `${rect.w}px`;
    rec.el.style.height = `${rect.h}px`;
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
  const sync = ({ board, rects, dirty = null, structural = false }) => {
    lastBoard = board;
    lastRects = rects;
    for (const uid of [...shells.keys()]) if (!board.items.has(uid)) removeShell(uid);
    let orderChanged = structural;
    for (const uid of board.order) {
      const item = board.items.get(uid);
      let rec = shells.get(uid);
      const fresh = !rec;
      if (!rec) { rec = buildShell(item); orderChanged = true; }
      const rect = rects.get(uid);
      if (fresh || !dirty || dirty.has(uid)) {
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
        }
      } else if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) {
        position(rec, rect);
      }
    }
    if (orderChanged) {
      for (const uid of board.order) {
        const rec = shells.get(uid);
        const layer = rec.type === "section" ? sectionsLayer : itemsLayer;
        if (rec.el.parentElement !== layer || layer.lastChild !== rec.el) layer.append(rec.el);
      }
    }
  };

  // ---------------------------------------------------------------- content
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks) {
      if (budget.n >= CONTENT_LIMIT) return;
      budget.n += 1;
      const row = el("div", "pxd-block", parent);
      row.dataset.uid = childUid(b);
      const s = childString(b);
      const node = renderRoot(row, s, "pxd-rs pxd-block__text");
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

  // Board card body: a mini map of the child board's items, the item count and, while untitled, a name field.
  const mountBoardBody = (body, item) => {
    const preview = boardPreview(item);
    const wrap = el("div", "pxd-item__board", body);
    const holder = el("div", "pxd-board-preview", wrap);
    const canvas = el("div", "pxd-board-preview__canvas", holder);
    canvas.style.aspectRatio = String(preview.aspect);
    const pct = (n) => `${Math.round(n * 10000) / 100}%`;
    for (const r of preview.rects) {
      const cls = ["pxd-mini"];
      if (r.type === "section") cls.push("pxd-mini--section");
      else if (r.type === "text") cls.push("pxd-mini--text");
      if (r.color) cls.push(`pxd-c-${r.color}`);
      const mini = el("div", cls.join(" "), canvas);
      mini.style.left = pct(r.x);
      mini.style.top = pct(r.y);
      mini.style.width = pct(r.w);
      mini.style.height = pct(r.h);
    }
    if (item.enhanced && isUntitledBoard(item.title)) {
      const input = el("input", "pxd-input pxd-item__board-name", wrap);
      input.type = "text";
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
    el("span", "pxd-item__board-count", meta).textContent = preview.count ? `${preview.count} ${preview.count === 1 ? "item" : "items"}` : "Empty board";
    const open = el("button", "pxd-btn pxd-item__open", meta);
    open.type = "button";
    open.textContent = "Open";
    open.dataset.action = "open";
    for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stopEvent);
    open.addEventListener("click", (event) => { event.stopPropagation(); openBoard(item.uid); });
  };

  const mountContent = (rec, item) => {
    const body = rec.body;
    unmountRoots(rec);
    body.replaceChildren();
    const budget = { n: 0, roots: [] };
    if (item.collapsed) {
      rec.contentKey = contentKeyOf(item);
      rec.roots = [];
      return;
    }
    if (item.type === "text") {
      budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__text"));
    } else if (item.kind === "image") {
      budget.roots.push(renderRoot(el("div", "pxd-item__media", body), item.string));
    } else if (item.kind === "board") {
      mountBoardBody(body, item);
    } else if (item.kind === "page") {
      const holder = el("div", "pxd-item__page", body);
      const preview = host?.pagePreview?.(item.title, CONTENT_DEPTH, CONTENT_LIMIT);
      // contentKey is stamped after mountContent returns, so only the async path can be stale.
      const apply = (p, sync = false) => {
        if (disposed || !holder.parentElement || (!sync && rec.contentKey !== contentKeyOf(item))) return;
        if (!p?.exists) { el("div", "pxd-item__placeholder", holder).textContent = "Empty page"; return; }
        const b = { n: 0, roots: [] };
        renderBlocks(holder, p.blocks || [], 1, b);
        rec.roots.push(...b.roots);
      };
      if (preview && typeof preview.then === "function") preview.then((p) => apply(p)).catch(() => {});
      else apply(preview, true);
    } else if (item.kind === "block") {
      const ref = item.target.uid;
      const refString = host?.blockString?.(ref);
      rec.refTitle = typeof refString === "string" ? firstLine(refString) : "";
      if (editing?.uid !== item.uid) rec.header.textContent = rec.refTitle || item.title || "";
      if (typeof refString === "string" && refString.trim()) budget.roots.push(renderRoot(body, refString, "pxd-rs pxd-item__string"));
      const tree = host?.pullTree?.(ref, CONTENT_DEPTH, CONTENT_LIMIT);
      const apply = (blocks, sync = false) => {
        if (disposed || !body.isConnected || (!sync && rec.contentKey !== contentKeyOf(item))) return;
        if (!refString?.trim() && !blocks?.length) el("div", "pxd-item__placeholder", body).textContent = "Empty card";
        const b = { n: 0, roots: [] };
        renderBlocks(body, blocks || [], 1, b);
        rec.roots.push(...b.roots);
      };
      if (tree && typeof tree.then === "function") tree.then((t) => apply(t)).catch(() => {});
      else apply(tree, true);
    } else {
      if (item.string?.trim()) budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__string"));
      renderBlocks(body, item.content || [], 1, budget);
      if (!item.string?.trim() && !(item.content || []).length) {
        el("div", "pxd-item__placeholder", body).textContent = "Empty card";
      }
    }
    rec.roots = budget.roots;
    rec.contentKey = contentKeyOf(item);
  };

  const mountSectionTitle = (rec, item) => {
    unmountRoots(rec);
    rec.title.replaceChildren();
    const node = renderRoot(rec.title, item.string || "Section", "pxd-rs pxd-section__title-text");
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
  const scheduleContent = ({ visibleRect, zoom = zoomCache }) => {
    zoomCache = zoom;
    if (!lastBoard || !lastRects) return;
    const next = new Set();
    if (lodForZoom(zoom) === "detail") {
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        if (r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    } else {
      // map LOD: section titles and text items stay rendered (they are the board's headings); card bodies unmount later
      for (const [uid, rec] of shells) {
        const r = lastRects.get(uid);
        if ((rec.type === "section" || rec.type === "text") && r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    }
    wanted = next;
    const t = now();
    for (const uid of next) if (mounted.has(uid)) mounted.set(uid, t);
    queue = [...next].filter((u) => !mounted.has(u));
    if (queue.length && !paused && !idleHandle) idleHandle = idle(pump);
    if ([...mounted.keys()].some((u) => !next.has(u))) scheduleUnmounts();
  };

  const setPaused = (on) => {
    paused = Boolean(on);
    if (paused && idleHandle) { idleHandle(); idleHandle = null; }
    if (!paused && queue.length && !idleHandle) idleHandle = idle(pump);
  };

  const setLod = (nextLod, zoom) => {
    lod = nextLod;
    zoomCache = zoom;
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

  const setSelection = (uids) => {
    const set = new Set(uids);
    for (const [uid, rec] of shells) {
      const on = set.has(uid);
      if (rec.selected === on) continue;
      rec.selected = on;
      rec.el.classList.toggle(rec.type === "section" ? "pxd-section--selected" : "pxd-item--selected", on);
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
    if (recoveries.length >= FLOOR_MAX) return false;
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
    floorTeardown = () => {
      e.editor.removeEventListener("focusin", onIn);
      e.editor.removeEventListener("focusout", onOut);
      mo?.disconnect();
      floor?.cancel?.();
      floor = null;
    };
  };
  const recoverFocus = () => armFloor();

  const stopEvent = (event) => event.stopPropagation();

  const enterEdit = async (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type === "section" || item.kind === "board") return false;
    if (editing?.uid === uid) return true;
    if (editing) await exitEdit();
    if (!host?.renderBlock) { host?.openBlock?.(uid); return false; }
    const targetUid = item.target.kind === "block" ? item.target.uid : item.uid;
    unmountRoots(rec);
    rec.body.replaceChildren();
    rec.contentKey = null;
    mounted.delete(uid);
    const editor = el("div", "pxd-item__editor", rec.body);
    // Rule 19.1: stop pointer/wheel at the overlay boundary BEFORE the synthetic focus click.
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown", "mouseup"]) editor.addEventListener(type, stopEvent);
    editing = { uid, rec, editor, targetUid, item, ready: false };
    rec.el.classList.add("pxd-item--editing");
    if (rec.rect) rec.el.style.minHeight = `${rec.rect.h}px`;
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
    await waitHydrateQuiet(editor, HYDRATE_CAP_MS);
    if (disposed || editing?.uid !== uid) return false;
    const input = editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea");
    if (input) focusRoamInput(input);
    if (editing?.uid === uid && editor.contains?.(doc.activeElement)) editing.ready = true;
    return true;
  };

  const exitEdit = async ({ silent = false } = {}) => {
    const e = editing;
    if (!e) return;
    editing = null;
    detachFocusGuard();
    const { rec, editor, uid, item } = e;
    const contentH = Number(editor.scrollHeight) || 0;
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown", "mouseup"]) editor.removeEventListener(type, stopEvent);
    try { host?.unmount?.(editor); } catch { /* not mounted */ }
    editor.remove();
    rec.el.classList.remove("pxd-item--editing");
    rec.el.style.minHeight = "";
    rec.contentKey = null;
    mounted.delete(uid);
    if (!silent && !disposed) {
      const live = lastBoard?.items.get(uid) || item;
      if (live && shells.has(uid)) {
        mountContent(rec, live);
        paintShell(rec, live);
        mounted.set(uid, now());
      }
      onEditChange?.(null);
      const need = contentH + (["page", "board"].includes(item.kind) || item.collapsed ? HEADER_H : 0) + 20;
      if (contentH > 0 && live && need > live.h) {
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

  const dispose = () => {
    disposed = true;
    if (editing) {
      const e = editing;
      editing = null;
      detachFocusGuard();
      for (const type of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown", "mouseup"]) e.editor.removeEventListener(type, stopEvent);
      try { host?.unmount?.(e.editor); } catch { /* not mounted */ }
    }
    if (idleHandle) { idleHandle(); idleHandle = null; }
    if (unmountTimer) { unmountTimer(); unmountTimer = null; }
    for (const uid of [...shells.keys()]) {
      const rec = shells.get(uid);
      unmountRoots(rec);
      rec.el.remove();
    }
    shells.clear();
    mounted.clear();
    queue = [];
  };

  return {
    sync,
    scheduleContent,
    setPaused,
    setLod,
    previewMove,
    previewRects,
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
    shellOf: (uid) => shells.get(uid)?.el ?? null,
    mountedCount: () => mounted.size,
    mountedUids: () => [...mounted.keys()],
    shellCount: () => shells.size,
    lod: () => lod,
    dispose,
  };
}

export { DEFAULT_SIZES };
