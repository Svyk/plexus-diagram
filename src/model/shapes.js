// Flowchart outlines for text items. geometry.js calls these; this file imports nothing.

export const SHAPES = ["rectangle", "rounded", "ellipse", "diamond", "parallelogram", "cylinder"];

const n = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};

const box = (rect) => {
  const x = rect?.x || 0;
  const y = rect?.y || 0;
  const w = rect?.w || 0;
  const h = rect?.h || 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h };
};

const skewOf = (w) => Math.min(Math.max(0, w) * 0.18, 28);

const cylinderRy = (h) => Math.min(h * 0.22, 18, Math.max(1, h / 2 - 0.5));

// Cardinal bbox midpoints sit on five outlines. A parallelogram is skewed, so its anchors move in.
export function shapePoint(rect, shape, side) {
  const b = box(rect);
  if (shape === "parallelogram") {
    const skew = skewOf(b.w);
    if (side === "top") return { x: b.cx + skew / 2, y: b.y };
    if (side === "bottom") return { x: b.cx - skew / 2, y: b.bottom };
    if (side === "left") return { x: b.x + skew / 2, y: b.cy };
    return { x: b.right - skew / 2, y: b.cy };
  }
  if (side === "top") return { x: b.cx, y: b.y };
  if (side === "bottom") return { x: b.cx, y: b.bottom };
  if (side === "left") return { x: b.x, y: b.cy };
  return { x: b.right, y: b.cy };
}

export function shapePath(rect, shape) {
  const b = box(rect);
  const { x, y, w, h, cx, cy, right, bottom } = b;
  if (shape === "ellipse") {
    const rx = w / 2;
    const ry = h / 2;
    return `M${n(cx)} ${n(y)}A${n(rx)} ${n(ry)} 0 0 1 ${n(cx)} ${n(bottom)}A${n(rx)} ${n(ry)} 0 0 1 ${n(cx)} ${n(y)}Z`;
  }
  if (shape === "diamond") {
    return `M${n(cx)} ${n(y)}L${n(right)} ${n(cy)}L${n(cx)} ${n(bottom)}L${n(x)} ${n(cy)}Z`;
  }
  if (shape === "parallelogram") {
    const s = skewOf(w);
    return `M${n(x + s)} ${n(y)}L${n(right)} ${n(y)}L${n(right - s)} ${n(bottom)}L${n(x)} ${n(bottom)}Z`;
  }
  if (shape === "cylinder") {
    const rx = w / 2;
    const ry = cylinderRy(h);
    const top = y + ry;
    const bot = bottom - ry;
    return `M${n(x)} ${n(top)}A${n(rx)} ${n(ry)} 0 0 0 ${n(right)} ${n(top)}L${n(right)} ${n(bot)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(bot)}Z` +
      `M${n(x)} ${n(top)}A${n(rx)} ${n(ry)} 0 0 1 ${n(right)} ${n(top)}`;
  }
  if (shape === "rounded") {
    const rx = Math.min(16, w / 4, h / 4);
    return `M${n(x + rx)} ${n(y)}H${n(right - rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(right)} ${n(y + rx)}V${n(bottom - rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(right - rx)} ${n(bottom)}H${n(x + rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(x)} ${n(bottom - rx)}V${n(y + rx)}A${n(rx)} ${n(rx)} 0 0 1 ${n(x + rx)} ${n(y)}Z`;
  }
  return `M${n(x)} ${n(y)}H${n(right)}V${n(bottom)}H${n(x)}Z`;
}
