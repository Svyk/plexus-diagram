// REG-6. A 96px map of one saved view. Strokes only, so dark mode does not rely on a fill.

const NS = "http://www.w3.org/2000/svg";

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
  svg.setAttribute("class", "pxd-minimap");
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
    svg.append(strokeRect(doc, { x: rect.x, y: rect.y, width: rect.w, height: rect.h }));
  }
  return svg;
}
