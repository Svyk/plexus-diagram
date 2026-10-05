// REG-6. A 96px map of one saved view. Strokes only, so dark mode does not rely on a fill.

import { worldRects } from "../model/board.js";
import { arrowHeadPath, arrowSize } from "../model/geometry.js";
import { itemLabel } from "../model/schema.js";

const NS = "http://www.w3.org/2000/svg";
const VIEW_MAX_W = 240;
const VIEW_MAX_H = 140;
const CARD_CAP = 40;

function rectOf(v) {
  if (Array.isArray(v) && v.length >= 4) return { x: Number(v[0]), y: Number(v[1]), w: Number(v[2]), h: Number(v[3]) };
  if (v && typeof v === "object") return { x: Number(v.x), y: Number(v.y), w: Number(v.w), h: Number(v.h) };
  return null;
}

function strokeRect(doc, attrs) {
  const node = doc.createElementNS(NS, "rect");
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("vector-effect", "non-scaling-stroke");
  return node;
}

export function minimapSvg(doc, { v, items = [], size = 96 } = {}) {
  const frame = rectOf(v);
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("class", "pxd-view-map");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  if (frame && frame.w > 0 && frame.h > 0) {
    svg.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.w} ${frame.h}`);
    svg.append(strokeRect(doc, { x: frame.x, y: frame.y, width: frame.w, height: frame.h }));
  }
  for (const item of items) {
    const rect = rectOf(item);
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) continue;
    const node = strokeRect(doc, { x: rect.x, y: rect.y, width: rect.w, height: rect.h });
    if (item.hot) node.setAttribute("class", "pxd-cardchip__hot");
    svg.append(node);
  }
  return svg;
}

function svgEl(doc, tag, attrs, parent) {
  const node = doc.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}

const clip = (text, max) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// PO-2: the preview's text size in world units follows the crop width.
export const previewFont = (viewWidth) => Math.max(12, Math.round(viewWidth / 32));

function finiteFrame(v) {
  const frame = rectOf(v);
  if (!frame || ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite)) return { x: 0, y: 0, w: 0, h: 0 };
  return frame;
}

function intersects(rect, view) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0) || !(view.w > 0) || !(view.h > 0)) return false;
  return rect.x < view.x + view.w && rect.x + rect.w > view.x && rect.y < view.y + view.h && rect.y + rect.h > view.y;
}

function viewPixelSize(frame) {
  if (!(frame.w > 0) || !(frame.h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, VIEW_MAX_W / frame.w, VIEW_MAX_H / frame.h);
  const width = Math.min(VIEW_MAX_W, Math.round(frame.w * scale * 1000) / 1000);
  const height = Math.min(VIEW_MAX_H, Math.round(frame.h * scale * 1000) / 1000);
  return { width, height };
}

// Cards that meet v, 40 non-sections at most. Sections that meet v stay, and no edge is required.
export function viewMapModel(board, v, ids) {
  const viewBox = finiteFrame(v);
  const hi = new Set(Array.isArray(ids) ? ids : []);
  const rects = board?.items ? worldRects(board) : new Map();
  const cards = [];
  let kept = 0;
  for (const item of board?.items?.values?.() ?? []) {
    const rect = rects.get(item.uid);
    if (!intersects(rect, viewBox)) continue;
    const section = item.type === "section";
    if (!section) {
      if (kept >= CARD_CAP) continue;
      kept += 1;
    }
    cards.push({
      uid: item.uid,
      type: item.type,
      rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      title: itemLabel(item) || "",
      role: hi.has(item.uid) ? "hi" : "muted",
    });
  }
  return { viewBox, cards };
}

export function drawViewMap(doc, parent, model) {
  const v = finiteFrame(model?.viewBox);
  const svg = svgEl(doc, "svg", {
    class: "pxd-viewmap",
    viewBox: `${v.x} ${v.y} ${v.w} ${v.h}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "Board view",
  }, parent);
  const size = viewPixelSize(v);
  svg.style.setProperty("display", "inline-block", "important");
  svg.style.setProperty("max-width", "none", "important");
  svg.style.setProperty("width", `${size.width}px`);
  svg.style.setProperty("height", `${size.height}px`);
  for (const card of model?.cards || []) {
    const r = card?.rect;
    if (!r) continue;
    const classes = [`pxd-viewmap__card--${card.role === "hi" ? "hi" : "muted"}`];
    if (card.type === "section") classes.push("pxd-viewmap__card--section");
    svgEl(doc, "rect", { class: classes.join(" "), x: r.x, y: r.y, width: r.w, height: r.h }, svg);
  }
  return svg;
}

export function drawPreview(doc, parent, model) {
  const v = model.viewBox;
  const svg = svgEl(doc, "svg", { class: "pxd-relpop__map", viewBox: `${v.x} ${v.y} ${v.w} ${v.h}`, preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "Where the connection sits on the board" }, parent);
  const line = svgEl(doc, "g", { class: `pxd-relpop__edge${model.color ? ` pxd-c-${model.color}` : ""}` }, null);
  if (model.hex) line.style.setProperty("--pxd-line", model.hex);
  const font = model.font || previewFont(v.w);
  let clips = 0;
  const rects = new Map();
  for (const card of model.cards) {
    const r = card.rect;
    const g = svgEl(doc, "g", { class: `pxd-relpop__card pxd-relpop__card--${card.role}${card.type === "section" ? " pxd-relpop__card--section" : ""}` }, svg);
    if (card.role !== "other" && model.hex) g.style.setProperty("--pxd-line", model.hex);
    if (card.role !== "other" && model.color) g.setAttribute("class", `${g.getAttribute("class")} pxd-c-${model.color}`);
    svgEl(doc, "rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, g);
    if (card.title && card.type !== "section") {
      const t = svgEl(doc, "text", { x: r.x + 10, y: r.y + font + 6, "font-size": font }, g);
      t.textContent = clip(card.title, Math.max(8, Math.floor((r.w - 20) / (font * 0.55))));
    }
    rects.set(card.uid, r);
  }
  svgEl(doc, "path", { class: "pxd-relpop__line", d: model.path }, line);
  // PO-2: a block end is a highlighted bar inside its card, clipped to the card, the arrow entering it.
  const bar = (b, inner, cardUid, arrowEnd) => {
    if (!b) return;
    const r = rects.get(cardUid);
    const g = svgEl(doc, "g", { class: `pxd-relpop__row${model.color ? ` pxd-c-${model.color}` : ""}` }, svg);
    if (model.hex) g.style.setProperty("--pxd-line", model.hex);
    if (r) {
      clips += 1;
      const id = `pxd-relclip-${Math.round(r.x)}-${Math.round(r.y)}-${clips}`;
      const cp = svgEl(doc, "clipPath", { id }, g);
      svgEl(doc, "rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 }, cp);
      g.setAttribute("clip-path", `url(#${id})`);
    }
    svgEl(doc, "rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4 }, g);
    const t = svgEl(doc, "text", { x: b.textX, y: b.textY, "font-size": font }, g);
    t.textContent = b.label;
    if (inner) {
      svgEl(doc, "path", { class: "pxd-relpop__inner", d: `M${inner.from.x} ${inner.from.y}L${inner.tip.x} ${inner.tip.y}` }, line);
      if (arrowEnd) svgEl(doc, "path", { class: "pxd-relpop__head", d: arrowHeadPath(inner.tip, inner.angle, arrowSize(1, 2) * 1.6) }, line);
    }
  };
  bar(model.fromBar, model.fromInner, model.fromCard, model.dir === "two");
  bar(model.toBar, model.toInner, model.toCard, model.dir !== "none");
  if (model.dir !== "none" && !model.toInner) svgEl(doc, "path", { class: "pxd-relpop__head", d: arrowHeadPath(model.end, model.endAngle, arrowSize(1, 2) * 1.6) }, line);
  if (model.dir === "two" && !model.fromInner) svgEl(doc, "path", { class: "pxd-relpop__head", d: arrowHeadPath(model.start, model.startAngle + Math.PI, arrowSize(1, 2) * 1.6) }, line);
  svg.append(line);
  return svg;
}
