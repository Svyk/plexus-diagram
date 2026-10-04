// RF-3 (2.4): a compact relation chip under every connection block Roam renders outside the board (the outline,
// the sidebar, linked references), and a preview popover that shows where on the board the connection sits.
// Zero writes. One cached set of connection-block uids, checked only for the nodes a mutation batch added.

import { boundsOf, buildBoard, routedEdge, worldRects } from "./model/board.js";
import { arrowHeadPath, arrowSize, edgePath } from "./model/geometry.js";
import { assignDeepLink } from "./model/deeplink.js";
import { PALETTE, hexColor, itemLabel, parseBoardTitle } from "./model/schema.js";
import { createTooltip } from "./view/tooltip.js";
import { tipEntry } from "./view/tooltip-text.js";

export const CHIP_CLASS = "pxd-relchip";
export const POP_CLASS = "pxd-relpop";
export const SCAN_CAP = 60; // candidate rows examined per mutation batch
const NAME_MAX = 28;
const BLOCK_MAX = 24;
const MODEL_TTL_MS = 5000;
const SVG_NS = "http://www.w3.org/2000/svg";
const BLOCK_SELECTOR = ".roam-block";
const isInput = (el) => String(el?.id || "").startsWith("block-input-");

// ---------------------------------------------------------------- pure helpers

// Roam's block input id ends with the block uid, which may itself contain "-": try the last one to four segments.
export function uidFromElementId(id, uids) {
  const parts = String(id ?? "").split("-");
  for (let k = 1; k <= Math.min(4, parts.length); k += 1) {
    const candidate = parts.slice(-k).join("-");
    if (candidate && uids.has(candidate)) return candidate;
  }
  return null;
}

const clip = (text, max) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const endName = (name, blockText) => {
  const base = clip(name, NAME_MAX) || "card";
  const block = clip(blockText, BLOCK_MAX);
  return block ? `${base} ▸ “${block}”` : base;
};

// "↗ A —label→ B · on Board", with the block named when an end is a block.
export function chipText({ from, to, label, boardTitle, fromBlockText, toBlockText } = {}) {
  const arrow = label ? `—${clip(label, 32)}→` : "→";
  const board = clip(boardTitle, 32);
  return `↗ ${endName(from, fromBlockText)} ${arrow} ${endName(to, toBlockText)}${board ? ` · on ${board}` : ""}`;
}

export function relationOf(board, edgeUid, { blockText } = {}) {
  const edge = board?.edges?.get(edgeUid);
  if (!edge) return null;
  const read = (uid) => {
    if (!uid) return "";
    try { const t = blockText?.(uid); return typeof t === "string" ? t : ""; } catch { return ""; }
  };
  const title = (uid) => {
    const item = board.items.get(uid);
    return item ? (itemLabel(item, blockText) || item.title || "card") : "card";
  };
  return {
    edge,
    from: title(edge.from),
    to: title(edge.to),
    label: edge.label || "",
    fromBlockText: edge.fromBlock ? read(edge.fromBlock) || "block" : "",
    toBlockText: edge.toBlock ? read(edge.toBlock) || "block" : "",
    boardTitle: board.title || parseBoardTitle(board.string) || "Untitled board",
  };
}

// The cropped mini-map: the two connected cards, their neighbours that fall inside the crop, and the arrow.
// Everything is in board world units; `viewBox` is the crop.
export function previewModel(board, edgeUid, { pad = 48, maxOthers = 24, blockText } = {}) {
  const edge = board?.edges?.get(edgeUid);
  if (!edge) return null;
  const rects = worldRects(board);
  const routed = routedEdge(board, edge, rects);
  if (!routed) return null;
  const a = rects.get(edge.from);
  const b = rects.get(edge.to);
  if (!a || !b) return null;
  const bounds = boundsOf([a, b]);
  const view = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad };
  const inside = (r) => r.x < view.x + view.w && r.x + r.w > view.x && r.y < view.y + view.h && r.y + r.h > view.y;
  const label = (item) => itemLabel(item, blockText) || item.title || "";
  const cards = [];
  let others = 0;
  for (const item of board.items.values()) {
    const r = rects.get(item.uid);
    if (!r) continue;
    const role = item.uid === edge.from ? "from" : item.uid === edge.to ? "to" : "other";
    if (role === "other") {
      if (!inside(r) || others >= maxOthers) continue;
      others += 1;
    }
    cards.push({ uid: item.uid, type: item.type, rect: r, title: label(item), role });
  }
  const geo = edgePath({ a: routed.a, b: routed.b, fromSide: edge.fromSide || "auto", toSide: edge.toSide || "auto", route: edge.route || "curve" });
  const named = PALETTE.includes(edge.color);
  return {
    viewBox: view,
    cards,
    path: geo.d,
    end: geo.end,
    endAngle: geo.endAngle,
    start: geo.start,
    startAngle: geo.startAngle,
    dir: edge.dir,
    color: named ? edge.color : "",
    hex: named ? "" : hexColor(edge.color) || "",
    toBlockText: edge.toBlock ? (() => { try { const t = blockText?.(edge.toBlock); return typeof t === "string" && t ? t : "block"; } catch { return "block"; } })() : "",
    fromBlockText: edge.fromBlock ? (() => { try { const t = blockText?.(edge.fromBlock); return typeof t === "string" && t ? t : "block"; } catch { return "block"; } })() : "",
  };
}

// ---------------------------------------------------------------- uid cache

export function createConnectionCache({ host } = {}) {
  const boardOf = new Map(); // edge uid → board uid
  let loaded = false;
  return {
    load() {
      let rows = [];
      try { rows = host?.listConnectionBlocks?.() || []; } catch { rows = []; }
      for (const [edgeUid, boardUid] of rows) if (edgeUid && boardUid) boardOf.set(edgeUid, boardUid);
      loaded = true;
      return boardOf.size;
    },
    // A mounted board's session saw the connection set change: replace that board's entries.
    setBoard(boardUid, edgeUids) {
      for (const [e, b] of [...boardOf]) if (b === boardUid) boardOf.delete(e);
      for (const e of edgeUids || []) boardOf.set(e, boardUid);
    },
    has: (uid) => boardOf.has(uid),
    boardOf: (uid) => boardOf.get(uid) ?? null,
    uids: () => boardOf,
    size: () => boardOf.size,
    isLoaded: () => loaded,
    clear() { boardOf.clear(); loaded = false; },
  };
}

// ---------------------------------------------------------------- DOM layer

export function createRelChips({ doc = globalThis.document, win = globalThis.window, host, graph, timers, setting } = {}) {
  const cache = createConnectionCache({ host });
  const chips = new Set();
  const models = new Map(); // board uid → { board, at }
  let pop = null;
  let disposed = false;

  const stop = (event) => { event.stopPropagation?.(); };
  const blockText = (uid) => { try { return host?.blockString?.(uid); } catch { return null; } };

  const modelOf = (boardUid) => {
    const hit = models.get(boardUid);
    if (hit && Date.now() - hit.at < MODEL_TTL_MS) return hit.board;
    let raw = null;
    try { raw = host?.pullBoard?.(boardUid); } catch { raw = null; }
    const board = raw ? buildBoard(raw) : null;
    models.set(boardUid, { board, at: Date.now() });
    return board;
  };

  // ---- popover
  const closePop = () => {
    if (!pop) return;
    const p = pop;
    pop = null;
    for (const off of p.offs) off();
    p.tooltip?.dispose?.();
    p.el.remove();
  };

  const svgEl = (tag, attrs, parent) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    parent?.append(node);
    return node;
  };

  const drawPreview = (parent, model) => {
    const v = model.viewBox;
    const svg = svgEl("svg", { class: "pxd-relpop__map", viewBox: `${v.x} ${v.y} ${v.w} ${v.h}`, preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "Where the connection sits on the board" }, parent);
    const line = svgEl("g", { class: `pxd-relpop__edge${model.color ? ` pxd-c-${model.color}` : ""}` }, null);
    if (model.hex) line.style.setProperty("--pxd-line", model.hex);
    const font = Math.max(12, Math.round(v.w / 22));
    for (const card of model.cards) {
      const r = card.rect;
      const g = svgEl("g", { class: `pxd-relpop__card pxd-relpop__card--${card.role}${card.type === "section" ? " pxd-relpop__card--section" : ""}` }, svg);
      if (card.role !== "other" && model.hex) g.style.setProperty("--pxd-line", model.hex);
      if (card.role !== "other" && model.color) g.setAttribute("class", `${g.getAttribute("class")} pxd-c-${model.color}`);
      svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, g);
      if (card.title && card.type !== "section") {
        const t = svgEl("text", { x: r.x + 10, y: r.y + font + 6, "font-size": font }, g);
        t.textContent = clip(card.title, Math.max(8, Math.floor(r.w / (font * 0.55))));
      }
    }
    svg.append(line);
    svgEl("path", { class: "pxd-relpop__line", d: model.path }, line);
    if (model.dir !== "none") svgEl("path", { class: "pxd-relpop__head", d: arrowHeadPath(model.end, model.endAngle, arrowSize(1, 2) * 1.6) }, line);
    if (model.dir === "two") svgEl("path", { class: "pxd-relpop__head", d: arrowHeadPath(model.start, model.startAngle + Math.PI, arrowSize(1, 2) * 1.6) }, line);
    if (model.toBlockText) {
      const pill = svgEl("g", { class: "pxd-relpop__row" }, line);
      const text = `▸ ${clip(model.toBlockText, 30)}`;
      const w = Math.max(60, text.length * font * 0.58 + 16);
      svgEl("rect", { x: model.end.x - w - 6, y: model.end.y - font - 10, width: w, height: font + 8, rx: (font + 8) / 2 }, pill);
      const t = svgEl("text", { x: model.end.x - w + 2, y: model.end.y - 6, "font-size": font }, pill);
      t.textContent = text;
    }
    return svg;
  };

  const openOnBoard = (boardUid, edgeUid) => {
    let pageUid = "";
    try { pageUid = host?.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
    if (!pageUid) { try { void host?.openBlock?.(boardUid); } catch { /* host unavailable */ } return; }
    assignDeepLink(win?.location, {
      graph: (typeof graph === "function" ? graph() : graph) || host?.graph || "",
      pageUid,
      cardUid: edgeUid,
    }, () => { try { win.dispatchEvent?.(new Event("hashchange")); } catch { /* already there */ } });
  };

  const openPop = (chip, edgeUid) => {
    closePop();
    const boardUid = cache.boardOf(edgeUid);
    const board = boardUid ? modelOf(boardUid) : null;
    const rel = board ? relationOf(board, edgeUid, { blockText }) : null;
    const model = board ? previewModel(board, edgeUid, { blockText }) : null;
    const el = doc.createElement("div");
    el.className = `pxd-root ${POP_CLASS}`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Connection preview");
    const mk = (tag, cls, parent, text) => {
      const n = doc.createElement(tag);
      n.className = cls;
      if (text !== undefined) n.textContent = text;
      parent?.append(n);
      return n;
    };
    const head = mk("div", "pxd-relpop__head", el);
    mk("div", "pxd-relpop__title", head, rel ? chipText({ ...rel }).replace(/^↗ /, "") : "This connection is no longer on a board");
    if (model) drawPreview(el, model);
    else mk("div", "pxd-relpop__empty", el, "The connected cards could not be found on the board.");
    if (rel?.toBlockText) mk("div", "pxd-relpop__note", el, `Ends on the block “${clip(rel.toBlockText, 60)}”`);
    const row = mk("div", "pxd-relpop__actions", el);
    const button = (tip, text, fn) => {
      const b = mk("button", "pxd-btn pxd-relpop__btn", row, text);
      b.type = "button";
      b.setAttribute("data-tip", tip);
      b.addEventListener("click", (event) => { stop(event); fn(); });
      return b;
    };
    button("relpop.board", "Open on board", () => { closePop(); if (boardUid) openOnBoard(boardUid, edgeUid); });
    button("relpop.sidebar", "Open in sidebar", () => { closePop(); if (boardUid) { try { void host?.openInSidebar?.(boardUid, "block"); } catch { /* host unavailable */ } } });
    doc.body.append(el);
    // Place under the chip, inside the viewport.
    const cr = chip.getBoundingClientRect?.() || { left: 0, top: 0, bottom: 0 };
    const vw = win?.innerWidth || 1024;
    const vh = win?.innerHeight || 768;
    const w = el.offsetWidth || 380;
    const h = el.offsetHeight || 300;
    const left = Math.max(8, Math.min(cr.left, vw - w - 8));
    const top = cr.bottom + 6 + h > vh - 8 ? Math.max(8, cr.top - h - 6) : cr.bottom + 6;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    const offs = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
    on(doc, "keydown", (event) => { if (event.key === "Escape") { event.stopPropagation?.(); closePop(); } }, true);
    on(doc, "pointerdown", (event) => { if (!el.contains?.(event.target) && !chip.contains?.(event.target)) closePop(); }, true);
    on(win, "scroll", (event) => { if (!el.contains?.(event.target)) closePop(); }, { capture: true, passive: true });
    on(win, "wheel", (event) => { if (!el.contains?.(event.target)) closePop(); }, { capture: true, passive: true });
    let tooltip = null;
    try { tooltip = createTooltip({ doc, root: el, timers, setting }); } catch { tooltip = null; }
    pop = { el, offs, tooltip, chip };
  };

  // ---- chips
  const buildChip = (edgeUid) => {
    const boardUid = cache.boardOf(edgeUid);
    const board = boardUid ? modelOf(boardUid) : null;
    const rel = board ? relationOf(board, edgeUid, { blockText }) : null;
    if (!rel) return null;
    const chip = doc.createElement("div");
    chip.className = CHIP_CLASS;
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.setAttribute("data-edge", edgeUid);
    const entry = tipEntry("relchip");
    if (entry) chip.title = `${entry.name}. ${entry.desc}`;
    chip.textContent = chipText({ ...rel });
    // Roam enters edit mode on mousedown in a block; the chip is not part of the block's text.
    for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick"]) chip.addEventListener(type, stop);
    chip.addEventListener("click", (event) => { stop(event); event.preventDefault?.(); openPop(chip, edgeUid); });
    chip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { stop(event); event.preventDefault?.(); openPop(chip, edgeUid); }
    });
    return chip;
  };

  const attach = (input, edgeUid) => {
    const container = input.closest?.(".roam-block-container") || input.parentElement;
    if (!container) return;
    for (const child of container.children || []) if (child.classList?.contains(CHIP_CLASS) && child.getAttribute("data-edge") === edgeUid) return;
    const chip = buildChip(edgeUid);
    if (!chip) return;
    let kids = null;
    for (const child of container.children || []) if (child.classList?.contains("rm-block-children")) { kids = child; break; }
    if (kids) container.insertBefore(chip, kids); else container.append(chip);
    chips.add(chip);
  };

  // Called for each node a mutation batch added. Cheap when no connection block exists in the graph.
  const scan = (node) => {
    if (disposed || !cache.size() || !node || node.nodeType !== 1) return;
    for (const chip of chips) if (chip.isConnected === false) chips.delete(chip);
    if (node.classList?.contains(CHIP_CLASS) || node.classList?.contains(POP_CLASS)) return;
    const found = [];
    if (node.classList?.contains("roam-block") && isInput(node)) found.push(node);
    if (typeof node.querySelectorAll === "function") {
      for (const el of node.querySelectorAll(BLOCK_SELECTOR)) {
        if (!isInput(el)) continue;
        found.push(el);
        if (found.length >= SCAN_CAP) break;
      }
    }
    for (const input of found.slice(0, SCAN_CAP)) {
      const uid = uidFromElementId(input.id, cache.uids());
      if (uid) attach(input, uid);
    }
  };

  // First load, and a pass over what is already on screen.
  const start = () => {
    cache.load();
    if (!cache.size()) return;
    scan(doc.body);
  };

  const noteBoard = (board) => {
    if (!board?.uid) return;
    cache.setBoard(board.uid, [...(board.edges?.keys?.() || [])]);
    models.delete(board.uid);
  };

  const dispose = () => {
    disposed = true;
    closePop();
    for (const chip of chips) chip.remove();
    chips.clear();
    models.clear();
    cache.clear();
  };

  return { start, scan, noteBoard, dispose, openPop, closePop, cache, chipCount: () => chips.size, isOpen: () => Boolean(pop) };
}
