// Arrow endpoints beyond a card: a cell, a row, an image region, a PDF pin, or another
// arrow's label. Kind is read off the target block. It is never stored on the edge.
// This file does not import the PDF module. The two ref patterns are copied so the
// graph of imports stays one way.

import { blockAnchor, blockInner } from "./geometry.js";
import { fracFromDrag } from "./image-region.js";
import { isContainerString, parseRegion } from "./regions.js";
import { classifyString } from "./schema.js";

const REF_ONLY = /^\(\(([\w-]+)\)\)$/;
const EMBED_ONLY = /^\{\{\s*(?:\[\[)?embed(?:\]\])?\s*:\s*\(\(([\w-]+)\)\)\s*\}\}$/i;
const REF_RE = /\(\(([\w-]{1,36})\)\)/g;
const MIN_MARQUEE = 8;

const finite = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);

function clip(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function asBox(rect) {
  if (!rect || typeof rect !== "object") return null;
  const x = finite(rect.x ?? rect.left);
  const y = finite(rect.y ?? rect.top);
  const w = finite(rect.w ?? rect.width);
  const h = finite(rect.h ?? rect.height);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function asFrac(frac) {
  if (!frac) return null;
  const v = Array.isArray(frac) ? frac : [frac.rx, frac.ry, frac.rw, frac.rh];
  if (v.length !== 4 || v.some((n) => !Number.isFinite(Number(n)))) return null;
  const [rx, ry, rw, rh] = v.map(Number);
  if (rw <= 0 || rh <= 0) return null;
  return { rx, ry, rw, rh };
}

function hasEdge(edges, uid) {
  if (!uid || !edges) return false;
  return typeof edges.has === "function" ? edges.has(uid) : Boolean(edges[uid]);
}

export function refsIn(string) {
  const out = [];
  const seen = new Set();
  const text = String(string ?? "");
  REF_RE.lastIndex = 0;
  let m = REF_RE.exec(text);
  while (m) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    m = REF_RE.exec(text);
  }
  return out;
}

// "region" for an image region, "pin" for a PDF pin, otherwise null.
export function endpointKindOf(blockString) {
  const region = parseRegion(blockString);
  if (!region?.supported) return null;
  if (region.kind === "img") return "region";
  if (region.kind === "pdf") return "pin";
  return null;
}

// What to call a block end in chips and previews. A region or pin shows its caption, never the macro.
export function endpointDisplayText(blockString) {
  const text = String(blockString ?? "");
  const region = parseRegion(text);
  if (!region) return text;
  if (region.caption) return region.caption;
  return region.kind === "pdf" && Number.isInteger(Number(region.pg)) ? `p. ${region.pg}` : "Region";
}

// Region outlines and pin marks for a card, read from every plexus-regions / plexus-pins container
// among its children (a PDF can carry an old regions container and a new pins container).
export function endpointHitsOf(nodes) {
  const regions = [];
  const pins = [];
  for (const node of nodes || []) {
    const string = node?.[":block/string"] ?? node?.string ?? "";
    if (!isContainerString(string)) continue;
    for (const kid of node?.[":block/children"] ?? node?.children ?? []) {
      const text = kid?.[":block/string"] ?? kid?.string ?? "";
      const id = kid?.[":block/uid"] ?? kid?.uid;
      const kind = endpointKindOf(text);
      if (!id || !kind) continue;
      const f = parseRegion(text)?.f;
      (kind === "region" ? regions : pins).push({ uid: id, frac: f });
    }
  }
  return { regions, pins };
}

// Part of a card's content key, so a new or reshaped region or pin repaints the outlines.
export function endpointHitsKey(nodes) {
  const { regions, pins } = endpointHitsOf(nodes);
  if (!regions.length && !pins.length) return "";
  const one = (h) => `${h.uid}=${Array.isArray(h.frac) ? h.frac.join(",") : ""}`;
  return `r:${regions.map(one).join(";")}|p:${pins.map(one).join(";")}`;
}

// The image block a region is parented under. A card that is the image uses its own uid.
// A ((ref)) or embed uses the source block, and only when that block is an image.
export function imageSourceOf(item, read) {
  if (!item) return { ok: false, reason: "missing" };
  if (item.kind === "image") return { ok: true, uid: item.uid, viaRef: false };
  const text = String(item.string ?? "").trim();
  const ref = REF_ONLY.exec(text) || EMBED_ONLY.exec(text);
  if (!ref) return { ok: false, reason: "not-image" };
  let source = null;
  try { source = typeof read === "function" ? read(ref[1]) : null; } catch { source = null; }
  if (typeof source !== "string") return { ok: false, reason: "unread" };
  if (classifyString(source).kind !== "image") return { ok: false, reason: "not-image" };
  return { ok: true, uid: ref[1], viaRef: true };
}

export function regionBox(imageRect, frac) {
  const box = asBox(imageRect);
  const f = asFrac(frac);
  if (!box || !f) return null;
  return {
    x: box.x + f.rx * box.w,
    y: box.y + f.ry * box.h,
    w: f.rw * box.w,
    h: f.rh * box.h,
  };
}

export function pointInside(point, rect) {
  const box = asBox(rect);
  if (!box || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const slop = 1e-6;
  return point.x >= box.x - slop && point.x <= box.x + box.w + slop
    && point.y >= box.y - slop && point.y <= box.y + box.h + slop;
}

// The point on the region edge that faces `other`. The point sits on the boundary,
// which counts as inside the closed rect.
export function regionEdgePoint(imageRect, frac, other) {
  const rect = regionBox(imageRect, frac);
  if (!rect) return null;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = (Number.isFinite(other?.x) ? other.x : cx + 1) - cx;
  const dy = (Number.isFinite(other?.y) ? other.y : cy) - cy;
  let side;
  let point;
  if (Math.abs(dx) >= Math.abs(dy)) {
    side = dx >= 0 ? "right" : "left";
    point = { x: side === "right" ? rect.x + rect.w : rect.x, y: cy };
  } else {
    side = dy >= 0 ? "bottom" : "top";
    point = { x: cx, y: side === "bottom" ? rect.y + rect.h : rect.y };
  }
  return { point, side, rect };
}

// An edge may be an endpoint only when its own `to` is not an edge. One level.
export function edgeMayTarget(edge, edges) {
  if (!edge) return false;
  return !hasEdge(edges, edge.to);
}

// Item uids of both ends. An edge end unwraps one level to the cards that edge joins.
export function focusEnds(board, edge) {
  if (!board || !edge) return [];
  const out = [];
  const add = (id) => { if (id && board.items?.has?.(id) && !out.includes(id)) out.push(id); };
  const take = (id) => {
    if (!id) return;
    if (board.items?.has?.(id)) { add(id); return; }
    const other = board.edges?.get?.(id);
    if (!other || !edgeMayTarget(other, board.edges)) return;
    add(other.from);
    add(other.to);
  };
  take(edge.from);
  take(edge.to);
  return out;
}

// Both sides of the trail inside the image must clear max(8px, 2% of that side).
// A line, or a release that only crossed the image, is not a region.
export function marqueeFrac(imageRect, points) {
  const box = asBox(imageRect);
  if (!box || !points?.length) return null;
  const inside = [];
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < box.x || p.y < box.y || p.x > box.x + box.w || p.y > box.y + box.h) continue;
    inside.push(p);
  }
  if (inside.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of inside) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const needW = Math.max(MIN_MARQUEE, box.w * 0.02);
  const needH = Math.max(MIN_MARQUEE, box.h * 0.02);
  if (maxX - minX < needW || maxY - minY < needH) return null;
  return fracFromDrag({ x: box.x, y: box.y, width: box.w, height: box.h }, minX, minY, maxX, maxY);
}

// Reuse wins when the pointer is on an outline. A real marquee on another image creates.
// A thin trail, or a release on the card the drag started from, creates nothing.
export function regionDropPlan({ from, imageUid, regionUid, imageRect, points } = {}) {
  if (regionUid && imageUid && imageUid !== from) return { reuse: true, to: imageUid, toBlock: regionUid };
  if (!imageUid || imageUid === from) return null;
  const frac = marqueeFrac(imageRect, points);
  if (!frac) return null;
  return { create: true, to: imageUid, frac };
}

export function regionCaption(label, existingCount) {
  const text = String(label ?? "").trim();
  if (text) return text;
  const n = Number.isFinite(existingCount) ? existingCount : 0;
  return `Region ${n + 1}`;
}

export function endpointChipText({ count, boardTitle } = {}) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  const board = clip(boardTitle, 32) || "board";
  return `⇢ ${n} on ${board}`;
}

// rows: [edgeUid, boardUid, string, boardTitle]. The block keeps the board where it
// is an endpoint of the most edges. The connection block's own uid is not an endpoint.
export function endpointIndex(rows) {
  const byBoard = new Map();
  for (const row of rows || []) {
    const edgeUid = row?.[0];
    const boardUid = row?.[1];
    if (!edgeUid || !boardUid) continue;
    if (!byBoard.has(boardUid)) byBoard.set(boardUid, { title: row[3] || "Untitled board", edges: [] });
    byBoard.get(boardUid).edges.push({ edgeUid, string: row[2] || "" });
  }
  const hits = new Map();
  for (const [boardUid, info] of byBoard) {
    const counts = new Map();
    for (const edge of info.edges) {
      for (const ref of refsIn(edge.string)) {
        if (ref === edge.edgeUid) continue;
        if (!counts.has(ref)) counts.set(ref, []);
        counts.get(ref).push(edge.edgeUid);
      }
    }
    for (const [blockUid, edgeUids] of counts) {
      const entry = {
        count: edgeUids.length,
        boardUid,
        boardTitle: info.title,
        edgeUid: edgeUids[0],
        edges: edgeUids,
      };
      const prev = hits.get(blockUid);
      if (!prev || entry.count > prev.count) hits.set(blockUid, entry);
    }
  }
  return hits;
}

// Where a live connect wire starts. A cell uses the tip inside the cell. A row uses the
// card edge at that row. A region uses the region edge. A folded pin stays on the card face.
export function wireStart(rect, measure, point) {
  const box = asBox(rect);
  if (!box || !measure || measure.face) return null;
  if (measure.region && measure.image) {
    const hit = regionEdgePoint(
      { x: box.x + measure.image.x, y: box.y + measure.image.y, w: measure.image.w, h: measure.image.h },
      measure.frac,
      point,
    );
    return hit?.point || null;
  }
  if (measure.rowTop == null && measure.rowLeft == null && !measure.cell) return null;
  const an = blockAnchor({ rect: box, rowTop: measure.rowTop, rowHeight: measure.rowHeight, bodyTop: measure.bodyTop, bodyBottom: measure.bodyBottom, other: point });
  if (measure.cell && measure.rowLeft != null && !an.clamped) {
    const inner = blockInner({
      rect: box,
      side: an.side,
      point: an.point,
      rowLeft: measure.rowLeft,
      rowRight: measure.rowRight,
      cell: true,
    });
    if (inner?.tip) return inner.tip;
  }
  return an.point;
}

// Cell, row, region outline, or pin under the pointer. Null on a card body.
export function endpointUnderPointer(node, cellOf) {
  if (!node || typeof node.closest !== "function") return null;
  const region = node.closest("[data-pxd-region]");
  if (region) return region.getAttribute?.("data-pxd-region") || null;
  const pin = node.closest("[data-pxd-pin]");
  if (pin) return pin.getAttribute?.("data-pxd-pin") || null;
  const row = node.closest("[data-pxd-row]");
  if (row) return row.getAttribute?.("data-pxd-row") || row.dataset?.pxdRow || null;
  if (typeof cellOf === "function") {
    try {
      const cell = cellOf(node);
      if (cell) return cell;
    } catch { /* a bad cell lookup is not an endpoint */ }
  }
  return null;
}
