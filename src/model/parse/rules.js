// Parse step 2: operator list -> rules, boxes, dots, shapes, images in top-left page points.
// Supports pdf.js >= 4 constructPath (args [paintOp, [Float32Array path], minMax]) and the
// legacy moveTo/lineTo/rectangle/closePath op sequence. Pure.

import { applyPoint, mul } from "./lines.js";

export const OP = {
  setLineWidth: 2, setGState: 9, save: 10, restore: 11, transform: 12,
  moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19,
  stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25,
  closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, clip: 29, eoClip: 30,
  setFillColorN: 55, setFillGray: 57, setFillRGBColor: 59, setFillCMYKColor: 61,
  setFillColorSpace: 51, setFillColor: 53,
  paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageXObjectRepeat: 88,
  constructPath: 91,
};

const FILL_OPS = new Set([22, 23, 24, 25, 26, 27]);
const STROKE_OPS = new Set([20, 21, 24, 25, 26, 27]);
const RULE_MIN_LEN = 8;
const RULE_MAX_THICK = 2.5;
const DOT_MAX = 5;

export function luminanceOf(color) {
  if (color == null) return null;
  let r;
  let g;
  let b;
  if (typeof color === "string") {
    const hex = color.replace("#", "");
    if (hex.length !== 6) return null;
    r = parseInt(hex.slice(0, 2), 16) / 255;
    g = parseInt(hex.slice(2, 4), 16) / 255;
    b = parseInt(hex.slice(4, 6), 16) / 255;
  } else if (Array.isArray(color) || ArrayBuffer.isView(color)) {
    if (color.length === 1) { r = g = b = color[0] > 1 ? color[0] / 255 : color[0]; }
    else if (color.length >= 3) {
      const scale = Math.max(color[0], color[1], color[2]) > 1 ? 255 : 1;
      [r, g, b] = [color[0] / scale, color[1] / scale, color[2] / scale];
    } else return null;
  } else if (typeof color === "number") r = g = b = color > 1 ? color / 255 : color;
  else return null;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isRect(points) {
  // 4 corners (5 with the closing point), axis aligned.
  if (points.length < 4 || points.length > 5) return null;
  const pts = points.length === 5 ? points.slice(0, 4) : points;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  for (const p of pts) {
    const onX = Math.abs(p[0] - x0) <= 0.5 || Math.abs(p[0] - x1) <= 0.5;
    const onY = Math.abs(p[1] - y0) <= 0.5 || Math.abs(p[1] - y1) <= 0.5;
    if (!onX || !onY) return null;
  }
  return { x0, y0, x1, y1 };
}

export function extractGraphics(ops, { transform = [1, 0, 0, 1, 0, 0], maxSegments = 5000 } = {}) {
  const out = { rules: [], boxes: [], dots: [], shapes: [], images: [], segments: 0, truncated: false };
  if (!ops || !ops.fnArray) return out;
  const fn = ops.fnArray;
  const args = ops.argsArray;
  const stack = [];
  let ctm = transform.slice();
  let fill = null;
  let lineWidth = 1;
  let pending = []; // legacy path: list of subpaths, each list of [x, y, curve?]
  let cur = null;

  const emitPath = (subpaths, paintOp) => {
    const filled = FILL_OPS.has(paintOp);
    const stroked = STROKE_OPS.has(paintOp);
    if (!filled && !stroked) return;
    for (const sp of subpaths) {
      if (sp.length < 2) continue;
      const points = sp.map((p) => [...applyPoint(ctm, p[0], p[1]), p[2]]);
      const hasCurve = points.some((p) => p[2]);
      const bbox = boxOf(points);
      out.segments += Math.max(1, points.length - 1);
      if (out.segments > maxSegments) { out.truncated = true; continue; }
      const rect = !hasCurve ? isRect(points) : null;
      if (rect) {
        const wd = rect.x1 - rect.x0;
        const ht = rect.y1 - rect.y0;
        if (filled) {
          if (Math.min(wd, ht) <= RULE_MAX_THICK && Math.max(wd, ht) >= RULE_MIN_LEN) {
            const axis = wd >= ht ? "h" : "v";
            out.rules.push({ axis, ...rect, thick: Math.min(wd, ht), filled: true });
          } else if (Math.max(wd, ht) <= DOT_MAX) {
            out.dots.push({ x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2, r: Math.max(wd, ht) / 2 });
          } else {
            const lum = luminanceOf(fill);
            out.boxes.push({ ...rect, fill, light: lum == null ? false : lum >= 0.7 });
          }
        } else {
          // Stroked rectangle: four rules when large, else a shape.
          if (Math.min(wd, ht) >= RULE_MIN_LEN) {
            const t = strokeWidth(lineWidth, ctm);
            out.rules.push({ axis: "h", x0: rect.x0, x1: rect.x1, y0: rect.y0, y1: rect.y0, thick: t });
            out.rules.push({ axis: "h", x0: rect.x0, x1: rect.x1, y0: rect.y1, y1: rect.y1, thick: t });
            out.rules.push({ axis: "v", x0: rect.x0, x1: rect.x0, y0: rect.y0, y1: rect.y1, thick: t });
            out.rules.push({ axis: "v", x0: rect.x1, x1: rect.x1, y0: rect.y0, y1: rect.y1, thick: t });
          } else out.shapes.push({ ...bbox, segs: 4, kind: "rect" });
        }
        continue;
      }
      if (hasCurve) {
        if (filled && Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) <= DOT_MAX) {
          out.dots.push({ x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2, r: (bbox.x1 - bbox.x0) / 2 });
        } else out.shapes.push({ ...bbox, segs: points.length - 1, kind: "curve" });
        continue;
      }
      // Polyline: axis-aligned long segments are rules; the rest is drawing.
      let drawn = 0;
      const t = strokeWidth(lineWidth, ctm);
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const dx = Math.abs(bx - ax);
        const dy = Math.abs(by - ay);
        if (stroked && dy <= 0.5 && dx >= RULE_MIN_LEN) {
          out.rules.push({ axis: "h", x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: (ay + by) / 2, y1: (ay + by) / 2, thick: t });
        } else if (stroked && dx <= 0.5 && dy >= RULE_MIN_LEN) {
          out.rules.push({ axis: "v", x0: (ax + bx) / 2, x1: (ax + bx) / 2, y0: Math.min(ay, by), y1: Math.max(ay, by), thick: t });
        } else drawn++;
      }
      if (filled && !stroked) {
        if (Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) <= DOT_MAX) {
          out.dots.push({ x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2, r: (bbox.x1 - bbox.x0) / 2 });
        } else out.shapes.push({ ...bbox, segs: points.length - 1, kind: "poly" });
      } else if (drawn) out.shapes.push({ ...bbox, segs: drawn, kind: "poly" });
    }
  };

  const flushLegacy = (paintOp) => {
    if (cur && cur.length) pending.push(cur);
    cur = null;
    if (pending.length) emitPath(pending, paintOp);
    pending = [];
  };

  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    const a = args[i];
    switch (op) {
      case OP.save: stack.push({ ctm, fill, lineWidth }); break;
      case OP.restore: { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; lineWidth = s.lineWidth; } break; }
      case OP.transform: if (a && a.length >= 6) ctm = mul(ctm, Array.from(a)); break;
      case OP.paintFormXObjectBegin:
        stack.push({ ctm, fill, lineWidth });
        if (a && a[0] && a[0].length >= 6) ctm = mul(ctm, Array.from(a[0]));
        break;
      case OP.paintFormXObjectEnd: { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; lineWidth = s.lineWidth; } break; }
      case OP.setLineWidth: lineWidth = Number(a && a[0]) || lineWidth; break;
      case OP.setFillRGBColor: case OP.setFillGray: case OP.setFillCMYKColor: case OP.setFillColor:
        fill = a && a.length === 1 ? a[0] : (a ? Array.from(a) : null);
        if (op === OP.setFillCMYKColor && Array.isArray(fill) && fill.length === 4) {
          const [c, m, y, k] = fill.map((v) => (v > 1 ? v / 255 : v));
          fill = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
        }
        break;
      case OP.setFillColorN: fill = null; break;
      case OP.constructPath: {
        if (!a) break;
        const paintOp = a[0];
        const subpaths = decodePathData(a[1]);
        emitPath(subpaths, paintOp);
        break;
      }
      case OP.moveTo: if (cur && cur.length) pending.push(cur); cur = [[a[0], a[1], false]]; break;
      case OP.lineTo: if (!cur) cur = []; cur.push([a[0], a[1], false]); break;
      case OP.curveTo: if (!cur) cur = []; cur.push([a[4], a[5], true]); break;
      case OP.curveTo2: case OP.curveTo3: if (!cur) cur = []; cur.push([a[2], a[3], true]); break;
      case OP.closePath: if (cur && cur.length) { cur.push([cur[0][0], cur[0][1], false]); pending.push(cur); cur = null; } break;
      case OP.rectangle: {
        if (cur && cur.length) pending.push(cur);
        const [x, y, w, h] = a;
        pending.push([[x, y, false], [x + w, y, false], [x + w, y + h, false], [x, y + h, false], [x, y, false]]);
        cur = null;
        break;
      }
      case OP.stroke: case OP.closeStroke: case OP.fill: case OP.eoFill: case OP.fillStroke:
      case OP.eoFillStroke: case OP.closeFillStroke: case OP.closeEOFillStroke:
        flushLegacy(op); break;
      case OP.endPath: pending = []; cur = null; break;
      case OP.clip: case OP.eoClip: break;
      case OP.paintImageXObject: case OP.paintInlineImageXObject: case OP.paintImageMaskXObject:
        out.images.push(unitBox(ctm));
        break;
      case OP.paintImageXObjectRepeat: {
        const [, sx, sy, positions] = a || [];
        if (!positions) break;
        for (let p = 0; p + 1 < positions.length; p += 2) {
          out.images.push(unitBox(mul(ctm, [sx, 0, 0, sy, positions[p], positions[p + 1]])));
        }
        break;
      }
      default: break;
    }
  }
  return out;
}

function strokeWidth(lineWidth, ctm) {
  const s = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
  return Math.max(0.1, lineWidth * s);
}

function unitBox(ctm) {
  const pts = [applyPoint(ctm, 0, 0), applyPoint(ctm, 1, 0), applyPoint(ctm, 1, 1), applyPoint(ctm, 0, 1)];
  return boxOf(pts);
}

function boxOf(points) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

// pdf.js 5 path data: flat [op, coords...] with op 0 moveTo(x,y) 1 lineTo(x,y) 2 curveTo(6) 3 closePath.
export function decodePathData(data) {
  const subpaths = [];
  const arrays = !data ? [] : (ArrayBuffer.isView(data) || typeof data[0] === "number") ? [data] : data;
  for (const arr of arrays) {
    if (!arr || !arr.length) continue;
    let cur = null;
    let i = 0;
    while (i < arr.length) {
      const op = arr[i++];
      if (op === 0) { if (cur && cur.length) subpaths.push(cur); cur = [[arr[i], arr[i + 1], false]]; i += 2; }
      else if (op === 1) { if (!cur) cur = []; cur.push([arr[i], arr[i + 1], false]); i += 2; }
      else if (op === 2) { if (!cur) cur = []; cur.push([arr[i + 4], arr[i + 5], true]); i += 6; }
      else if (op === 3) { if (cur && cur.length) { cur.push([cur[0][0], cur[0][1], false]); subpaths.push(cur); } cur = null; }
      else break;
    }
    if (cur && cur.length) subpaths.push(cur);
  }
  return subpaths;
}

// Cluster collinear rules: horizontal by y, vertical by x; merge touching intervals.
export function snapRules(rules, { tol = 1.5, join = 2 } = {}) {
  const groups = { h: [], v: [] };
  for (const axis of ["h", "v"]) {
    const list = rules.filter((r) => r.axis === axis).map((r) => ({
      pos: axis === "h" ? (r.y0 + r.y1) / 2 : (r.x0 + r.x1) / 2,
      a: axis === "h" ? r.x0 : r.y0,
      b: axis === "h" ? r.x1 : r.y1,
      thick: r.thick || 0.5,
    })).sort((p, q) => p.pos - q.pos || p.a - q.a);
    let g = null;
    for (const r of list) {
      if (g && Math.abs(r.pos - g.pos) <= tol) { g.items.push(r); g.pos = (g.pos * (g.items.length - 1) + r.pos) / g.items.length; }
      else { g = { pos: r.pos, items: [r] }; groups[axis].push(g); }
    }
    for (const grp of groups[axis]) {
      grp.items.sort((p, q) => p.a - q.a);
      const ivs = [];
      for (const r of grp.items) {
        const last = ivs[ivs.length - 1];
        if (last && r.a <= last.b + join) { last.b = Math.max(last.b, r.b); last.thick = Math.max(last.thick, r.thick); }
        else ivs.push({ a: r.a, b: r.b, thick: r.thick });
      }
      grp.intervals = ivs;
      delete grp.items;
    }
  }
  return groups;
}
