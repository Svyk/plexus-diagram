// Parse step: raster images and vector drawings -> figures, with axis labels absorbed. Pure.

import { round } from "./lines.js";

const IMAGE_MIN = 12;

export function findFigures({ graphics, usedRules = new Set(), usedBoxes = new Set(), words = [], bodySize = 10, pageW = 612, pageH = 792, ruleSegments = [] }) {
  const prims = [];
  for (const img of graphics.images || []) {
    if (img.x1 - img.x0 >= IMAGE_MIN && img.y1 - img.y0 >= IMAGE_MIN) prims.push({ ...img, kind: "image", n: 1 });
  }
  for (const s of graphics.shapes || []) prims.push({ ...s, kind: "shape", n: Math.max(1, s.segs || 1) });
  for (const b of graphics.boxes || []) {
    if (b.light || usedBoxes.has(b)) continue;
    if ((b.x1 - b.x0) * (b.y1 - b.y0) >= 0.8 * pageW * pageH) continue;
    prims.push({ ...b, kind: "box", n: 1 });
  }
  // Rules not consumed by a lattice table (chart axes, grid lines) count toward drawings.
  for (const seg of ruleSegments) {
    if (usedRules.has(seg) || seg.fromBox) continue;
    const box = seg.axis === "h" ? { x0: seg.a, x1: seg.b, y0: seg.pos, y1: seg.pos } : { x0: seg.pos, x1: seg.pos, y0: seg.a, y1: seg.b };
    prims.push({ ...box, kind: "rule", n: 1 });
  }
  const clusters = clusterBoxes(prims, 6);
  const figures = [];
  const used = new Set();
  for (const cl of clusters) {
    const hasImage = cl.items.some((p) => p.kind === "image");
    const count = cl.items.reduce((n, p) => n + p.n, 0);
    const w = cl.x1 - cl.x0; const h = cl.y1 - cl.y0;
    if (!hasImage && !(count >= 6 && w >= 60 && h >= 40)) continue;
    const fig = { x0: cl.x0, y0: cl.y0, x1: cl.x1, y1: cl.y1, kind: hasImage ? (cl.items.length > 1 ? "mixed" : "image") : "drawing", count };
    // Absorb words inside, and small labels within a margin.
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 4) {
      changed = false;
      for (const wd of words) {
        if (used.has(wd)) continue;
        const cx = (wd.x0 + wd.x1) / 2; const cy = (wd.y0 + wd.y1) / 2;
        const inside = cx >= fig.x0 && cx <= fig.x1 && cy >= fig.y0 && cy <= fig.y1;
        const margin = 12;
        const near = wd.size <= 0.85 * bodySize && cx >= fig.x0 - margin && cx <= fig.x1 + margin && cy >= fig.y0 - margin && cy <= fig.y1 + margin;
        if (!inside && !near) continue;
        used.add(wd);
        fig.x0 = Math.min(fig.x0, wd.x0); fig.x1 = Math.max(fig.x1, wd.x1);
        fig.y0 = Math.min(fig.y0, wd.y0); fig.y1 = Math.max(fig.y1, wd.y1);
        changed = true;
      }
    }
    fig.bbox = [round(fig.x0), round(fig.y0), round(fig.x1), round(fig.y1)];
    figures.push(fig);
  }
  return { figures, used };
}

export function clusterBoxes(items, gap) {
  const clusters = items.map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, items: [p] }));
  let merged = true;
  let guard = 0;
  while (merged && guard++ < 50) {
    merged = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i]; const b = clusters[j];
        if (a.x0 > b.x1 + gap || b.x0 > a.x1 + gap || a.y0 > b.y1 + gap || b.y0 > a.y1 + gap) continue;
        a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
        a.items.push(...b.items);
        clusters.splice(j, 1);
        j--;
        merged = true;
      }
    }
  }
  return clusters;
}
