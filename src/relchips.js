// RF-3 (2.4): a compact relation chip under every connection block Roam renders outside the board (the outline,
// the sidebar, linked references), and a preview popover that shows where on the board the connection sits.
// Zero writes. One cached set of connection-block uids, checked only for the nodes a mutation batch added.

import { boundsOf, buildBoard, routedEdge, worldRects } from "./model/board.js";
import { arrowHeadPath, arrowSize, blockInner, edgePath } from "./model/geometry.js";
import { assignDeepLink } from "./model/deeplink.js";
import { PALETTE, attrNameOf, hexColor, itemLabel, parseBoardTitle } from "./model/schema.js";
import { createTooltip } from "./view/tooltip.js";
import { tipEntry } from "./view/tooltip-text.js";

export const CHIP_CLASS = "pxd-relchip";
export const POP_CLASS = "pxd-relpop";
export const CRUMB_CLASS = "pxd-relcrumb";
export const CRUMB_TIP = "Open the connection preview";
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

// PO-2: the preview's text size in world units follows the crop width.
export const previewFont = (viewWidth) => Math.max(12, Math.round(viewWidth / 32));
export const ROW_PAD = 10;
const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

// PO-2: the target row as a bar INSIDE its page card. `frac` (0..1) is the row's place in the outline; the bar is
// laid between the title strip and the card's bottom, never outside `rect`. `maxChars` is how much text fits.
export function rowBarRect(rect, frac, font) {
  const head = font * 2 + 4;
  const h = Math.min(font + 8, Math.max(4, rect.h - 4));
  const top = rect.y + Math.min(head, Math.max(0, rect.h - h - 2));
  const span = Math.max(0, rect.y + rect.h - 6 - top - h);
  const y = Math.min(rect.y + rect.h - h - 2, top + clamp01(frac) * span);
  const x = rect.x + ROW_PAD;
  const w = Math.max(4, rect.w - 2 * ROW_PAD);
  return { x, y, w, h, textX: x + 8, textY: y + h - Math.max(3, Math.round(font * 0.28)), maxChars: Math.max(0, Math.floor((w - 16) / (font * 0.58))) };
}

// Where a popover goes: first of below / above / right / left of the chip that holds it fully inside the viewport
// (and inside `bounds`, e.g. Roam's scroll container), else the side with most room, shrunk with `scroll` set.
export const POP_GAP = 8;
const rectsHit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// RE-2: `obstacles` are viewport rects the popover must not cover (the dock, board bar, rail, minimap, panels).
// The plain placement stands when it is clear. Otherwise each side is tried, slid along its axis past each
// obstacle; when nothing is clear the roomiest clear strip wins, with `scroll` set and a max-height.
export function placePopover({ anchor, size, viewport, bounds, gap = POP_GAP, obstacles = [] } = {}) {
  const first = placeBasic({ anchor, size, viewport, bounds, gap });
  const wall = (obstacles || []).filter((o) => o && o.right > o.left && o.bottom > o.top);
  if (!wall.length) return first;
  const spanOf = (p) => ({ left: p.left, top: p.top, right: p.left + p.width, bottom: p.top + (p.maxHeight ?? size.h) });
  if (!wall.some((o) => rectsHit(spanOf(first), o))) return first;
  const box = {
    left: Math.max(viewport.left ?? 0, bounds?.left ?? -Infinity),
    top: Math.max(viewport.top ?? 0, bounds?.top ?? -Infinity),
    right: Math.min(viewport.right, bounds?.right ?? Infinity),
    bottom: Math.min(viewport.bottom, bounds?.bottom ?? Infinity),
  };
  const edge = 8;
  const width = Math.min(size.w, Math.max(80, box.right - box.left - 2 * edge));
  const clampX = (x, w) => Math.max(box.left + edge, Math.min(x, box.right - edge - w));
  const clampY = (y, h) => Math.max(box.top + edge, Math.min(y, box.bottom - edge - h));
  const sides = ["below", "above", "right", "left"];
  const make = (side, along, h, scroll) => {
    const vertical = side === "below" || side === "above";
    const left = vertical ? clampX(along, width) : (side === "right" ? anchor.right + gap : anchor.left - gap - width);
    const top = vertical ? (side === "below" ? anchor.bottom + gap : anchor.top - gap - h) : clampY(along, h);
    return { side, left: Math.round(left), top: Math.round(top), width: Math.round(width), maxHeight: scroll ? Math.round(h) : null, scroll };
  };
  // Positions along the side's axis: the aligned one, then flush against each obstacle edge.
  const alongOf = (side, h) => {
    const vertical = side === "below" || side === "above";
    const base = vertical ? anchor.left : anchor.top;
    const out = [base];
    for (const o of wall) {
      if (vertical) out.push(o.right + gap / 2, o.left - gap / 2 - width);
      else out.push(o.bottom + gap / 2, o.top - gap / 2 - h);
    }
    return out.sort((a, b) => Math.abs(a - base) - Math.abs(b - base));
  };
  const fitsSide = (side) => {
    if (side === "below") return box.bottom - edge - (anchor.bottom + gap) >= size.h;
    if (side === "above") return anchor.top - gap - (box.top + edge) >= size.h;
    if (side === "right") return box.right - edge - (anchor.right + gap) >= width;
    return anchor.left - gap - (box.left + edge) >= width;
  };
  for (const side of sides) {
    if (!fitsSide(side)) continue;
    for (const along of alongOf(side, size.h)) {
      const p = make(side, along, size.h, false);
      if (!wall.some((o) => rectsHit(spanOf(p), o))) return p;
    }
  }
  // Nothing fits whole: the tallest clear strip, scrolled.
  let best = null;
  for (const side of sides) {
    for (const along of alongOf(side, size.h)) {
      const vertical = side === "below" || side === "above";
      const probe = make(side, along, vertical ? 1 : size.h, false);
      let room;
      if (vertical) {
        const xs = { left: probe.left, right: probe.left + probe.width };
        const lowest = side === "below" ? anchor.bottom + gap : box.top + edge;
        const highest = side === "below" ? box.bottom - edge : anchor.top - gap;
        let lo = lowest;
        let hi = highest;
        for (const o of wall) {
          if (o.right <= xs.left || o.left >= xs.right) continue;
          if (side === "below" && o.top >= lowest) hi = Math.min(hi, o.top - 4);
          else if (side === "above" && o.bottom <= highest) lo = Math.max(lo, o.bottom + 4);
        }
        room = hi - lo;
        if (room < 80) continue;
        const h = Math.min(size.h, room);
        const p = make(side, along, h, true);
        if (side === "above") p.top = Math.round(hi - h);
        if (!best || h > best.h) best = { p, h };
      } else {
        const x0 = side === "right" ? anchor.right + gap : anchor.left - gap - width;
        let lo = box.top + edge;
        let hi = box.bottom - edge;
        let straddles = false;
        for (const o of wall) {
          if (o.right <= x0 || o.left >= x0 + width) continue;
          if (o.top < anchor.bottom && o.bottom > anchor.top) { straddles = true; break; }
          if (o.bottom <= anchor.top) lo = Math.max(lo, o.bottom + 4);
          else hi = Math.min(hi, o.top - 4);
        }
        if (straddles) continue;
        const h = Math.min(size.h, hi - lo);
        if (h < 80) continue;
        const p = make(side, 0, h, true);
        p.top = Math.round(Math.max(lo, Math.min(anchor.top, hi - h)));
        if (!best || h > best.h) best = { p, h };
      }
    }
  }
  if (best) return best.p;
  return first;
}

function placeBasic({ anchor, size, viewport, bounds, gap = POP_GAP } = {}) {
  const box = {
    left: Math.max(viewport.left ?? 0, bounds?.left ?? -Infinity),
    top: Math.max(viewport.top ?? 0, bounds?.top ?? -Infinity),
    right: Math.min(viewport.right, bounds?.right ?? Infinity),
    bottom: Math.min(viewport.bottom, bounds?.bottom ?? Infinity),
  };
  const edge = 8;
  const room = {
    below: box.bottom - edge - (anchor.bottom + gap),
    above: anchor.top - gap - (box.top + edge),
    right: box.right - edge - (anchor.right + gap),
    left: anchor.left - gap - (box.left + edge),
  };
  const fits = (side) => (side === "below" || side === "above" ? room[side] >= size.h : room[side] >= size.w);
  let side = ["below", "above", "right", "left"].find(fits);
  let scroll = false;
  if (!side) {
    side = Object.keys(room).reduce((best, k) => (room[k] > room[best] ? k : best), "below");
    scroll = true;
  }
  const vertical = side === "below" || side === "above";
  const width = Math.min(size.w, Math.max(80, box.right - box.left - 2 * edge));
  const height = scroll ? Math.max(80, Math.min(size.h, room[side])) : size.h;
  const clampX = (x) => Math.max(box.left + edge, Math.min(x, box.right - edge - width));
  const clampY = (y) => Math.max(box.top + edge, Math.min(y, box.bottom - edge - height));
  let left;
  let top;
  if (vertical) {
    left = clampX(anchor.left);
    top = side === "below" ? anchor.bottom + gap : anchor.top - gap - height;
  } else {
    top = clampY(anchor.top);
    left = side === "right" ? anchor.right + gap : anchor.left - gap - width;
  }
  return { side, left: Math.round(left), top: Math.round(top), width: Math.round(width), maxHeight: scroll ? Math.round(height) : null, scroll };
}

// PO-2: where a block sits in its page's outline, as 0..1 over the visible rows (folded blocks hide their kids).
// Null when the block is not in the outline.
export function rowFraction(blocks, uid) {
  const rows = [];
  const walk = (list) => {
    for (const c of list || []) {
      const str = c?.[":block/string"] ?? c?.string ?? "";
      if (attrNameOf(str) === "BT_attrDue") continue;
      rows.push(c?.[":block/uid"] ?? c?.uid ?? "");
      if (c?.open !== false && c?.[":block/open"] !== false) walk(c?.[":block/children"] ?? c?.children);
    }
  };
  walk(blocks);
  const i = rows.indexOf(uid);
  return i < 0 || !rows.length ? null : (i + 0.5) / rows.length;
}

const rowEnd = (item, other, bar) => {
  const side = other.x + other.w / 2 >= item.x + item.w / 2 ? "right" : "left";
  const point = { x: side === "right" ? item.x + item.w : item.x, y: bar.y + bar.h / 2 };
  return { side, point, inner: blockInner({ rect: item, side, point, rowLeft: ROW_PAD, rowRight: item.w - ROW_PAD }) };
};

// The cropped mini-map: the two connected cards, their neighbours that fall inside the crop, and the arrow.
// Everything is in board world units; `viewBox` is the crop.
export function previewModel(board, edgeUid, { pad = 48, maxOthers = 24, blockText, rowFrac } = {}) {
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
  const font = previewFont(view.w);
  const textOf = (uid) => { try { const t = blockText?.(uid); return typeof t === "string" && t ? t : "block"; } catch { return "block"; } };
  const barFor = (itemUid, blockUid) => {
    const item = board.items.get(itemUid);
    if (!blockUid || !item || item.type === "section" || routed.from === routed.to) return null;
    let frac = null;
    try { frac = rowFrac?.(item, blockUid); } catch { frac = null; }
    const rect = itemUid === edge.from ? a : b;
    const box = rowBarRect(rect, frac, font);
    return { ...box, frac: clamp01(frac), text: textOf(blockUid), label: clip(textOf(blockUid), box.maxChars) };
  };
  const fromBar = routed.from === edge.from ? barFor(edge.from, edge.fromBlock) : null;
  const toBar = routed.to === edge.to ? barFor(edge.to, edge.toBlock) : null;
  const fromEnd = fromBar ? rowEnd(a, b, fromBar) : null;
  const toEnd = toBar ? rowEnd(b, a, toBar) : null;
  const geo = edgePath({
    a: routed.a,
    b: routed.b,
    fromSide: fromEnd?.side || edge.fromSide || "auto",
    toSide: toEnd?.side || edge.toSide || "auto",
    route: edge.route || "curve",
    fromPoint: fromEnd?.point,
    toPoint: toEnd?.point,
  });
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
    font,
    toBar,
    fromBar,
    fromCard: edge.from,
    toCard: edge.to,
    toInner: toEnd?.inner || null,
    fromInner: fromEnd?.inner || null,
    toBlockText: edge.toBlock ? textOf(edge.toBlock) : "",
    fromBlockText: edge.fromBlock ? textOf(edge.fromBlock) : "",
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

export function createRelChips({ doc = globalThis.document, win = globalThis.window, host, graph, timers, setting, openNested } = {}) {
  const cache = createConnectionCache({ host });
  const chips = new Set();
  const models = new Map(); // board uid → { board, at }
  let pop = null;
  let disposed = false;

  const stop = (event) => { event.stopPropagation?.(); };
  const blockText = (uid) => { try { return host?.blockString?.(uid); } catch { return null; } };
  const rowFrac = (item, blockUid) => {
    if (item?.target?.kind !== "page") return null;
    let outline = null;
    try { outline = host?.pageOutline?.(item.target.title, 400); } catch { outline = null; }
    return rowFraction(outline?.blocks, blockUid);
  };

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
    const font = model.font || previewFont(v.w);
    let clips = 0;
    const rects = new Map();
    for (const card of model.cards) {
      const r = card.rect;
      const g = svgEl("g", { class: `pxd-relpop__card pxd-relpop__card--${card.role}${card.type === "section" ? " pxd-relpop__card--section" : ""}` }, svg);
      if (card.role !== "other" && model.hex) g.style.setProperty("--pxd-line", model.hex);
      if (card.role !== "other" && model.color) g.setAttribute("class", `${g.getAttribute("class")} pxd-c-${model.color}`);
      svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, g);
      if (card.title && card.type !== "section") {
        const t = svgEl("text", { x: r.x + 10, y: r.y + font + 6, "font-size": font }, g);
        t.textContent = clip(card.title, Math.max(8, Math.floor((r.w - 20) / (font * 0.55))));
      }
      rects.set(card.uid, r);
    }
    svgEl("path", { class: "pxd-relpop__line", d: model.path }, line);
    // PO-2: a block end is a highlighted bar inside its card, clipped to the card, the arrow entering it.
    const bar = (b, inner, cardUid, arrowEnd) => {
      if (!b) return;
      const r = rects.get(cardUid);
      const g = svgEl("g", { class: `pxd-relpop__row${model.color ? ` pxd-c-${model.color}` : ""}` }, svg);
      if (model.hex) g.style.setProperty("--pxd-line", model.hex);
      if (r) {
        clips += 1;
        const id = `pxd-relclip-${Math.round(r.x)}-${Math.round(r.y)}-${clips}`;
        const cp = svgEl("clipPath", { id }, g);
        svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, cp);
        g.setAttribute("clip-path", `url(#${id})`);
      }
      svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4 }, g);
      const t = svgEl("text", { x: b.textX, y: b.textY, "font-size": font }, g);
      t.textContent = b.label;
      if (inner) {
        svgEl("path", { class: "pxd-relpop__inner", d: `M${inner.from.x} ${inner.from.y}L${inner.tip.x} ${inner.tip.y}` }, line);
        if (arrowEnd) svgEl("path", { class: "pxd-relpop__head", d: arrowHeadPath(inner.tip, inner.angle, arrowSize(1, 2) * 1.6) }, line);
      }
    };
    bar(model.fromBar, model.fromInner, model.fromCard, model.dir === "two");
    bar(model.toBar, model.toInner, model.toCard, model.dir !== "none");
    if (model.dir !== "none" && !model.toInner) svgEl("path", { class: "pxd-relpop__head", d: arrowHeadPath(model.end, model.endAngle, arrowSize(1, 2) * 1.6) }, line);
    if (model.dir === "two" && !model.fromInner) svgEl("path", { class: "pxd-relpop__head", d: arrowHeadPath(model.start, model.startAngle + Math.PI, arrowSize(1, 2) * 1.6) }, line);
    svg.append(line);
    return svg;
  };

  const openOnBoard = (boardUid, edgeUid) => {
    // A connection on a nested board: the host opens the parent page's board and enters the nested one first.
    try { if (openNested?.(boardUid, edgeUid)) return; } catch { /* fall through to the plain page link */ }
    let pageUid = "";
    try { pageUid = host?.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
    if (!pageUid) { try { void host?.openBlock?.(boardUid); } catch { /* host unavailable */ } return; }
    assignDeepLink(win?.location, {
      graph: (typeof graph === "function" ? graph() : graph) || host?.graph || "",
      pageUid,
      cardUid: edgeUid,
    }, () => { try { win.dispatchEvent?.(new Event("hashchange")); } catch { /* already there */ } });
  };

  const openPop = (chip, edgeUid, avoid) => {
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
    const scrollParent = (node) => {
      for (let n = node?.parentElement; n; n = n.parentElement) {
        const o = win?.getComputedStyle?.(n)?.overflowY;
        if (o === "auto" || o === "scroll") return n;
      }
      return null;
    };
    const holder = scrollParent(chip);
    const place = () => {
      if (chip.isConnected === false) { closePop(); return; }
      // The anchor is the chip plus the block line it belongs to: the popover covers neither.
      const rects = [chip, ...[].concat(avoid || [])].map((n) => n?.getBoundingClientRect?.()).filter(Boolean);
      const cr = rects.length > 1
        ? { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) }
        : rects[0] || { left: 0, top: 0, right: 0, bottom: 0 };
      const vw = win?.innerWidth || 1024;
      const vh = win?.innerHeight || 768;
      const own = rects[0] || cr;
      if (own.bottom < 0 || own.top > vh || own.right < 0 || own.left > vw) { closePop(); return; }
      const hr = holder?.getBoundingClientRect?.();
      const at = placePopover({
        anchor: cr,
        size: { w: el.offsetWidth || 380, h: pop?.natural ?? (el.offsetHeight || 300) },
        viewport: { left: 0, top: 0, right: vw, bottom: vh },
        bounds: hr ? { left: hr.left, top: hr.top, right: hr.right, bottom: hr.bottom } : null,
      });
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
      el.style.maxHeight = at.maxHeight ? `${at.maxHeight}px` : "";
      el.style.overflowY = at.scroll ? "auto" : "";
      el.setAttribute("data-side", at.side);
    };
    const offs = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
    on(doc, "keydown", (event) => { if (event.key === "Escape") { event.stopPropagation?.(); closePop(); } }, true);
    on(doc, "pointerdown", (event) => { if (!el.contains?.(event.target) && !chip.contains?.(event.target)) closePop(); }, true);
    let queued = null;
    const again = () => {
      if (queued || !pop) return;
      const id = win?.requestAnimationFrame?.(() => { queued = null; if (pop) place(); });
      queued = () => win?.cancelAnimationFrame?.(id);
    };
    on(win, "scroll", (event) => { if (!el.contains?.(event.target)) again(); }, { capture: true, passive: true });
    on(win, "resize", again, { passive: true });
    offs.push(() => { queued?.(); queued = null; });
    let tooltip = null;
    try { tooltip = createTooltip({ doc, root: el, timers, setting }); } catch { tooltip = null; }
    pop = { el, offs, tooltip, chip, natural: el.offsetHeight || 300 };
    place();
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
    chip.addEventListener("click", (event) => { stop(event); event.preventDefault?.(); openPop(chip, edgeUid, chip.parentElement?.querySelector?.(".rm-block-main")); });
    chip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { stop(event); event.preventDefault?.(); openPop(chip, edgeUid, chip.parentElement?.querySelector?.(".rm-block-main")); }
    });
    return chip;
  };

  // ---- PO-4: the breadcrumb Roam draws above a connection block (linked references, zoomed outline). Its own
  // navigation leads to "Board > Connections"; a plain click opens the preview instead, Shift / Cmd / Ctrl / Alt keep
  // Roam's behavior. Listeners sit on the breadcrumb items only and go away with the layer.
  const crumbs = new WeakSet();
  const crumbOffs = [];
  const crumbGlyphs = new Set();
  const plain = (event) => event.button === 0 && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
  const crumbFor = (zoom) => {
    if (disposed || !zoom || crumbs.has(zoom) || zoom.querySelector?.(`.${CRUMB_CLASS}`)) return;
    const holder = zoom.parentElement;
    const container = holder?.querySelector?.(".roam-block-container[data-block-uid]");
    const edgeUid = container?.getAttribute?.("data-block-uid");
    if (!edgeUid || !cache.has(edgeUid)) return;
    crumbs.add(zoom);
    const avoid = () => [container.querySelector?.(".rm-block-main") || container, container.querySelector?.(`.${CHIP_CLASS}`)].filter(Boolean);
    const items = [...(zoom.querySelectorAll?.(".rm-zoom-item") || [])];
    const glyph = doc.createElement("span");
    glyph.className = CRUMB_CLASS;
    glyph.textContent = "▦";
    glyph.title = CRUMB_TIP;
    glyph.setAttribute("role", "button");
    glyph.setAttribute("tabindex", "0");
    glyph.setAttribute("aria-label", CRUMB_TIP);
    (items[items.length - 1] || zoom).append(glyph);
    crumbGlyphs.add(glyph);
    for (const el of [...items, glyph]) {
      const swallow = (event) => { if (plain(event)) stop(event); };
      const open = (event) => {
        if (!plain(event)) return;
        stop(event);
        event.preventDefault?.();
        openPop(el, edgeUid, avoid());
      };
      for (const type of ["pointerdown", "mousedown", "mouseup"]) { el.addEventListener(type, swallow, true); crumbOffs.push(() => el.removeEventListener(type, swallow, true)); }
      el.addEventListener("click", open, true);
      crumbOffs.push(() => el.removeEventListener("click", open, true));
    }
    const onKey = (event) => {
      if (event.key === "Enter" || event.key === " ") { stop(event); event.preventDefault?.(); openPop(glyph, edgeUid, avoid()); }
    };
    glyph.addEventListener("keydown", onKey);
    crumbOffs.push(() => glyph.removeEventListener("keydown", onKey));
  };

  const attach = (input, edgeUid) => {
    const container = input.closest?.(".roam-block-container") || input.parentElement;
    if (!container) return;
    const zoom = container.parentElement?.querySelector?.(".rm-zoom");
    if (zoom) crumbFor(zoom);
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
    // A breadcrumb that arrives after its block.
    if (node.classList?.contains("rm-zoom")) crumbFor(node);
    else if (typeof node.querySelectorAll === "function") {
      let n = 0;
      for (const zoom of node.querySelectorAll(".rm-zoom")) { crumbFor(zoom); n += 1; if (n >= SCAN_CAP) break; }
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
    for (const off of crumbOffs.splice(0)) off();
    for (const glyph of crumbGlyphs) glyph.remove();
    crumbGlyphs.clear();
    models.clear();
    cache.clear();
  };

  return { start, scan, noteBoard, dispose, openPop, closePop, cache, chipCount: () => chips.size, crumbCount: () => crumbGlyphs.size, isOpen: () => Boolean(pop) };
}
