// Parse step: raster images and vector drawings -> figures, with axis labels absorbed. Pure.
// A multi-panel figure is one box (the union). Page-sized art is kept only when the page
// is a drawing, not a text page. Every stored box is clipped to the page.

import { round } from "./lines.js";
import { CAPTION_RE } from "./headings.js";
import { EQ_NUMBER_RE } from "./formulas.js";
import { FURNITURE_BAND } from "./furniture.js";
import { detectColumns } from "./xycut.js";

const IMAGE_MIN = 12;
const H_GAP = 56;
const V_GAP = 42;

export function findFigures({ graphics, usedRules = new Set(), usedBoxes = new Set(), words = [], bodySize = 10, pageW = 612, pageH = 792, ruleSegments = [], pageTextChars = null }) {
  const prims = [];
  for (const img of graphics.images || []) {
    if (img.x1 - img.x0 < IMAGE_MIN || img.y1 - img.y0 < IMAGE_MIN) continue;
    const pageImage = (img.x1 - img.x0) * (img.y1 - img.y0) >= 0.75 * pageW * pageH;
    const clipped = clipBox(img, pageW, pageH);
    if (!clipped) continue;
    prims.push({ ...clipped, kind: "image", n: 1, pageImage });
  }
  for (const s of graphics.shapes || []) {
    if ((s.x1 - s.x0) * (s.y1 - s.y0) >= 0.85 * pageW * pageH) continue;
    const clipped = clipBox(s, pageW, pageH);
    if (!clipped) continue;
    prims.push({ ...clipped, kind: "shape", n: Math.max(1, s.segs || 1) });
  }
  for (const b of graphics.boxes || []) {
    if (b.light || usedBoxes.has(b)) continue;
    if ((b.x1 - b.x0) * (b.y1 - b.y0) >= 0.8 * pageW * pageH) continue;
    const clipped = clipBox(b, pageW, pageH);
    if (!clipped) continue;
    prims.push({ ...clipped, kind: "box", n: 1 });
  }
  // Rules not consumed by a lattice table (chart axes, grid lines) count toward drawings.
  for (const seg of ruleSegments) {
    if (usedRules.has(seg) || seg.fromBox) continue;
    const box = seg.axis === "h" ? { x0: seg.a, x1: seg.b, y0: seg.pos, y1: seg.pos } : { x0: seg.pos, x1: seg.pos, y0: seg.a, y1: seg.b };
    const clipped = clipBox(box, pageW, pageH);
    if (!clipped) continue;
    prims.push({ ...clipped, kind: "rule", n: 1 });
  }
  const lines = wordLines(words);
  // Column lines break at a gutter. The label lines above stay joined so a legend
  // on the same baseline as a short note is still one line.
  const gutters = detectColumns(columnLines(words), { pageW });
  const textChars = pageTextChars == null ? words.reduce((n, w) => n + (w.text || "").length, 0) : pageTextChars;
  const clusters = clusterBoxes(prims, 6);
  const figures = [];
  const used = new Set();
  for (const cl of clusters) {
    const hasImage = cl.items.some((p) => p.kind === "image");
    const count = cl.items.reduce((n, p) => n + p.n, 0);
    const w = cl.x1 - cl.x0;
    const h = cl.y1 - cl.y0;
    if (!hasImage && !(count >= 6 && w >= 60 && h >= 40)) continue;
    figures.push({
      x0: cl.x0, y0: cl.y0, x1: cl.x1, y1: cl.y1,
      kind: hasImage ? (cl.items.length > 1 ? "mixed" : "image") : "drawing",
      count,
      pageImage: cl.items.some((p) => p.pageImage),
    });
  }
  for (const fig of figures) growLabels(fig, lines, used, bodySize, pageW, pageH, gutters);
  unionPanels(figures, lines, bodySize, pageW, pageH);
  for (const fig of figures) growLabels(fig, lines, used, bodySize, pageW, pageH, gutters);
  const kept = [];
  for (const fig of figures) {
    const box = clipBox(fig, pageW, pageH);
    if (!box) continue;
    fig.x0 = box.x0; fig.y0 = box.y0; fig.x1 = box.x1; fig.y1 = box.y1;
    const area = (fig.x1 - fig.x0) * (fig.y1 - fig.y0);
    // A cluster that covers the page on a text page is not a figure. A single
    // page image (a drawing sheet) is decided by the caller and kept.
    if (!fig.pageImage && area >= 0.7 * pageW * pageH && textChars >= 180) continue;
    fig.bbox = [round(fig.x0), round(fig.y0), round(fig.x1), round(fig.y1)];
    delete fig.pageImage;
    kept.push(fig);
  }
  return { figures: kept, used };
}

// Image tiles that cover the page, with no text layer and no vector drawing, are a scan.
export function rasterScanPage({ images, shapes, words, pageW, pageH }) {
  const segs = (shapes || []).reduce((n, s) => n + (s.segs || 1), 0);
  return (words || []).length === 0 && imageCover(images, pageW, pageH) >= 0.65 && segs < 15;
}

// A page-sized image is the drawing when the only text is scattered labels.
// Aligned body lines, a dense table, or a long text page keep the image as background.
export function drawingSheetPage({ images, lines, tables, pageW, pageH, textChars }) {
  const pageArea = pageW * pageH;
  const pageImage = (images || []).some((im) => (im.x1 - im.x0) * (im.y1 - im.y0) >= 0.75 * pageArea);
  if (!pageImage || textChars < 12 || textChars >= 900) return false;
  const textLines = (lines || []).filter((l) => (l.text || "").trim());
  if (textLines.length >= 16) return false;
  if (textLines.filter((l) => wordCount(l.text) >= 8).length >= 3) return false;
  if (alignedLineCount(textLines) >= 4) return false;
  const dense = (tables || []).some((t) => {
    if (!t.cells || t.rows < 3 || t.cols < 2) return false;
    const filled = t.cells.filter((c) => c.text).length;
    return filled >= 0.5 * Math.max(1, t.cells.length);
  });
  return !dense;
}

// "Figure N" stacked like a contents list, or a line of dot leaders, is not a caption.
// A run stays a caption when each line sits on its own figure.
export function demoteFalseCaptions(blocks, bodySize, figures = []) {
  const anchored = (b) => figures.some((f) => {
    const tb = f.bbox;
    if (!tb || !b.bbox) return false;
    const ox = Math.min(tb[2], b.bbox.x1) - Math.max(tb[0], b.bbox.x0);
    if (ox <= 0) return false;
    const gap = b.bbox.y1 <= tb[1] ? tb[1] - b.bbox.y1 : b.bbox.y0 >= tb[3] ? b.bbox.y0 - tb[3] : 0;
    return gap <= 3 * bodySize;
  });
  for (const b of blocks) {
    if (b.type === "caption" && /^fig/i.test(b.text || "") && (/\.{4,}|…{2,}|·{4,}/.test(b.text))) b.type = "para";
  }
  const caps = blocks.filter((b) => b.type === "caption" && /^fig/i.test(b.text || ""));
  caps.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  let run = [];
  const flush = () => {
    if (run.length >= 3) for (const r of run) if (!anchored(r)) r.type = "para";
    run = [];
  };
  for (const b of caps) {
    const prev = run[run.length - 1];
    const close = prev && Math.abs(b.bbox.x0 - prev.bbox.x0) <= 36 && b.bbox.y0 - prev.bbox.y1 <= 4.5 * bodySize && b.bbox.y0 + 2 >= prev.bbox.y0;
    if (close) run.push(b);
    else { flush(); run = [b]; }
  }
  flush();
}

export function imageCover(images, pageW, pageH) {
  if (!images || !images.length || pageW <= 0 || pageH <= 0) return 0;
  const nx = 24;
  const ny = 24;
  let hit = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const cx = ((ix + 0.5) / nx) * pageW;
      const cy = ((iy + 0.5) / ny) * pageH;
      if (images.some((im) => cx >= im.x0 && cx <= im.x1 && cy >= im.y0 && cy <= im.y1)) hit++;
    }
  }
  return hit / (nx * ny);
}

export function clipBox(b, pageW, pageH) {
  const x0 = Math.max(0, Math.min(pageW, Math.min(b.x0, b.x1)));
  const y0 = Math.max(0, Math.min(pageH, Math.min(b.y0, b.y1)));
  const x1 = Math.max(0, Math.min(pageW, Math.max(b.x0, b.x1)));
  const y1 = Math.max(0, Math.min(pageH, Math.max(b.y0, b.y1)));
  const thinX = Math.abs(b.x1 - b.x0) < 1;
  const thinY = Math.abs(b.y1 - b.y0) < 1;
  // A rule has no thickness. Keep the hairline when its long axis still meets the page.
  if (thinX && thinY) return null;
  if (thinY && x1 - x0 < 1) return null;
  if (thinX && y1 - y0 < 1) return null;
  if (!thinX && !thinY && (x1 - x0 < 1 || y1 - y0 < 1)) return null;
  return { ...b, x0, y0, x1, y1 };
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function alignedLineCount(lines) {
  // A column of labels shares an x even when a wide gap splits each row into one word.
  let best = 0;
  for (const l of lines) {
    if (!String(l.text || "").trim()) continue;
    let n = 0;
    for (const o of lines) if (String(o.text || "").trim() && Math.abs(o.x0 - l.x0) <= 8) n++;
    if (n > best) best = n;
  }
  return best;
}

function wordLines(words) {
  const sorted = [...words].filter((w) => w && w.text).sort((a, b) => (a.base ?? a.y1 ?? 0) - (b.base ?? b.y1 ?? 0) || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    const y = w.base ?? w.y1 ?? 0;
    const size = w.size || 10;
    const last = lines[lines.length - 1];
    // A wide hole is a different region (a margin note on the same baseline). Column gaps are not.
    const hole = Math.max(160, 8 * size);
    const xBreak = last && (w.x0 - last.x1 > hole || last.x0 - w.x1 > hole);
    if (last && !xBreak && Math.abs(last.y - y) <= 0.45 * Math.max(last.size, size)) {
      last.words.push(w);
      last.x0 = Math.min(last.x0, w.x0);
      last.x1 = Math.max(last.x1, w.x1);
      last.y0 = Math.min(last.y0, w.y0 ?? y - size);
      last.y1 = Math.max(last.y1, w.y1 ?? y);
    } else {
      lines.push({ y, size, words: [w], x0: w.x0, x1: w.x1, y0: w.y0 ?? y - size, y1: w.y1 ?? y });
    }
  }
  for (const l of lines) l.text = l.words.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
  return lines;
}

// Lines for column detection. A gap wider than a word space is a new line, so a
// two-column baseline does not become one line that hides the gutter.
function columnLines(words) {
  const sorted = [...words].filter((w) => w && w.text).sort((a, b) => (a.base ?? a.y1 ?? 0) - (b.base ?? b.y1 ?? 0) || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    const y = w.base ?? w.y1 ?? 0;
    const size = w.size || 10;
    const y0 = w.y0 ?? y - size;
    const y1 = w.y1 ?? y;
    const last = lines[lines.length - 1];
    const gap = last ? w.x0 - last.x1 : 0;
    const split = last && (Math.abs(last.base - y) > 0.45 * Math.max(last.size, size) || gap > Math.max(8, 1.25 * size) || last.x0 - w.x1 > 4);
    if (last && !split) {
      last.words.push(w);
      last.x0 = Math.min(last.x0, w.x0);
      last.x1 = Math.max(last.x1, w.x1);
      last.y0 = Math.min(last.y0, y0);
      last.y1 = Math.max(last.y1, y1);
    } else {
      lines.push({ base: y, size, words: [w], x0: w.x0, x1: w.x1, y0, y1 });
    }
  }
  for (const l of lines) {
    l.text = l.words.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
    l.chars = l.text.replace(/\s+/g, "").length;
  }
  return lines;
}

function wordBox(w) {
  const y1 = w.y1 ?? w.base ?? 0;
  const y0 = w.y0 ?? y1 - (w.size || 10);
  return { x0: w.x0, y0, x1: w.x1, y1 };
}

function outsideDist(cx, cy, box) {
  const dx = cx < box.x0 ? box.x0 - cx : cx > box.x1 ? cx - box.x1 : 0;
  const dy = cy < box.y0 ? box.y0 - cy : cy > box.y1 ? cy - box.y1 : 0;
  return Math.hypot(dx, dy);
}

// The art's column, or every column the art already crosses. Growth stays inside it.
function columnSpan(art, gutters, pageW) {
  if (!gutters.length) return { x0: 0, x1: pageW };
  const cols = [];
  let x = 0;
  for (const g of gutters) {
    cols.push({ x0: x, x1: g.x0 });
    x = g.x1;
  }
  cols.push({ x0: x, x1: pageW });
  const hit = cols.filter((c) => art.x1 > c.x0 + 2 && art.x0 < c.x1 - 2);
  if (hit.length) return { x0: hit[0].x0, x1: hit[hit.length - 1].x1 };
  const cx = (art.x0 + art.x1) / 2;
  let best = cols[0];
  let bestD = Infinity;
  for (const c of cols) {
    const d = cx < c.x0 ? c.x0 - cx : cx > c.x1 ? cx - c.x1 : 0;
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}

function wordInColumn(w, col, gutters) {
  if (!gutters.length) return true;
  const box = wordBox(w);
  const cx = (box.x0 + box.x1) / 2;
  if (cx < col.x0 - 1 || cx > col.x1 + 1) return false;
  for (const g of gutters) {
    if (col.x0 < g.x0 - 1 && col.x1 > g.x1 + 1) continue;
    if (col.x1 <= g.x0 + 1 && box.x1 > g.x1 + 1) return false;
    if (col.x0 >= g.x1 - 1 && box.x0 < g.x0 - 1) return false;
  }
  return true;
}

function inMarginBand(y, pageH) {
  const h = pageH || 792;
  return y <= h * FURNITURE_BAND || y >= h * (1 - FURNITURE_BAND);
}

// A paragraph line. A row of small axis labels is not one.
function lineIsFlow(line, bodySize) {
  return wordCount(line.text) >= 8 && (line.size || bodySize) > 0.85 * bodySize;
}

function isEqNumber(text) {
  return EQ_NUMBER_RE.test(String(text || "").trim());
}

// Grow only over text that sits in the art's column, outside the running-header
// band, and closer to the art than to a body line. Equation numbers never join.
function allowGrowWord(w, line, ctx) {
  if (isEqNumber(w.text) || isEqNumber(line.text)) return false;
  if (!wordInColumn(w, ctx.col, ctx.gutters)) return false;
  const box = wordBox(w);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const da = outsideDist(cx, cy, ctx.art);
  if (da > 0 && inMarginBand(cy, ctx.pageH)) return false;
  if (da > 0 && lineIsFlow(line, ctx.bodySize)) return false;
  if (da > 0) {
    for (const other of ctx.bodyLines) {
      if (other === line) continue;
      if (outsideDist(cx, cy, other) <= da) return false;
    }
  }
  return true;
}

function lineIsCaption(text) {
  const t = String(text || "").trim();
  if (CAPTION_RE.test(t) || /^fig(?:ure)?\.?\s*$/i.test(t)) return true;
  // "Figure" followed by a missing glyph or a bare number, with no other words.
  return /^fig(?:ure)?\.?\s+(\d+[A-Za-z]?[:.]?|[^\p{L}\p{N}]{1,4})$/iu.test(t);
}

function lineIsBody(line) {
  return wordCount(line.text) >= 8;
}

// Short labels and panel letters beside the art join the box. Body lines and captions do not.
function takeWord(fig, w, art, maxOut, used) {
  const nx0 = Math.min(fig.x0, w.x0);
  const ny0 = Math.min(fig.y0, w.y0);
  const nx1 = Math.max(fig.x1, w.x1);
  const ny1 = Math.max(fig.y1, w.y1);
  if (art.x0 - nx0 > maxOut || art.y0 - ny0 > maxOut || nx1 - art.x1 > maxOut || ny1 - art.y1 > maxOut) return false;
  const cx = (w.x0 + w.x1) / 2;
  if (cx < art.x0 - 48 || cx > art.x1 + 48) return false;
  used.add(w);
  fig.x0 = nx0; fig.y0 = ny0; fig.x1 = nx1; fig.y1 = ny1;
  return true;
}

function growLabels(fig, lines, used, bodySize, pageW, pageH, gutters) {
  const art = { x0: fig.x0, y0: fig.y0, x1: fig.x1, y1: fig.y1 };
  const ctx = {
    art,
    col: columnSpan(art, gutters, pageW),
    gutters,
    bodyLines: lines.filter((line) => lineIsFlow(line, bodySize)),
    pageH,
    bodySize,
  };
  const allow = (w, line) => allowGrowWord(w, line, ctx);
  const maxOut = 64;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 5) {
    changed = false;
    for (const line of lines) {
      if (line.words.every((w) => used.has(w))) continue;
      // Small axis labels within 12 pt, one word at a time, including a row of month names.
      if (!lineIsCaption(line.text)) {
        for (const w of line.words) {
          if (used.has(w) || !(w.size <= 0.85 * bodySize)) continue;
          if (/^fig(?:ure)?\.?$/i.test(String(w.text || "").trim())) continue;
          if (!allow(w, line)) continue;
          const cx = (w.x0 + w.x1) / 2;
          const cy = (w.y0 + w.y1) / 2;
          if (cx < art.x0 - 12 || cx > art.x1 + 12 || cy < art.y0 - 12 || cy > art.y1 + 12) continue;
          if (takeWord(fig, w, art, maxOut, used)) changed = true;
        }
      }
      // Panel letters share a baseline across the row. Take each letter that sits on this panel.
      if (line.words.every((w) => /^[a-d]$/i.test(String(w.text || "").trim()))) {
        for (const w of line.words) {
          if (used.has(w) || !allow(w, line)) continue;
          const gapX = w.x1 < fig.x0 ? fig.x0 - w.x1 : w.x0 > fig.x1 ? w.x0 - fig.x1 : 0;
          const gapY = w.y1 < fig.y0 ? fig.y0 - w.y1 : w.y0 > fig.y1 ? w.y0 - fig.y1 : 0;
          if (gapX <= 18 && gapY <= 18 && takeWord(fig, w, art, maxOut, used)) changed = true;
        }
        continue;
      }
      if (lineIsCaption(line.text) || lineIsBody(line)) continue;
      const nWords = wordCount(line.text);
      const panel = nWords === 1 && /^[a-d]$/i.test(line.text.trim());
      const gapX = line.x1 < fig.x0 ? fig.x0 - line.x1 : line.x0 > fig.x1 ? line.x0 - fig.x1 : 0;
      const gapY = line.y1 < fig.y0 ? fig.y0 - line.y1 : line.y0 > fig.y1 ? line.y0 - fig.y1 : 0;
      const inside = gapX === 0 && gapY === 0;
      const yOverlap = Math.min(line.y1, fig.y1) - Math.max(line.y0, fig.y0);
      const beside = gapX > 0 && gapX <= 42 && yOverlap >= 0.4 * Math.max(1, line.y1 - line.y0);
      // Margin notes beside a figure that does not reach the page edge stay out of the crop.
      const rightMargin = line.x0 > pageW - 72 && art.x1 < pageW - 36;
      const leftMargin = line.x1 < 72 && art.x0 > 36;
      if (!inside && (rightMargin || leftMargin)) continue;
      const edge = gapX === 0 && gapY > 0 && gapY <= 2 * bodySize && nWords <= 3 && (line.size <= 0.85 * bodySize || panel);
      if (!inside && !beside && !edge && !(panel && gapX <= 18 && gapY <= 18)) continue;
      if (beside && (nWords > 6 || line.size > bodySize * 1.05)) continue;
      // A label under two panels is one line. A beside legend is not: it does not overlap the art.
      let span = line.words.filter((w) => !used.has(w) && allow(w, line));
      if (gapX === 0 && (line.x1 > art.x1 + 18 || line.x0 < art.x0 - 18)) {
        span = span.filter((w) => {
          const wx = (w.x0 + w.x1) / 2;
          return wx >= art.x0 - 12 && wx <= art.x1 + 12;
        });
      }
      if (!span.length) continue;
      const nx0 = Math.min(fig.x0, ...span.map((w) => w.x0));
      const ny0 = Math.min(fig.y0, ...span.map((w) => w.y0));
      const nx1 = Math.max(fig.x1, ...span.map((w) => w.x1));
      const ny1 = Math.max(fig.y1, ...span.map((w) => w.y1));
      if (art.x0 - nx0 > maxOut || art.y0 - ny0 > maxOut || nx1 - art.x1 > maxOut || ny1 - art.y1 > maxOut) continue;
      const cx = (nx0 + nx1) / 2;
      if (cx < art.x0 - 48 || cx > art.x1 + 48) continue;
      for (const w of span) used.add(w);
      fig.x0 = nx0; fig.y0 = ny0; fig.x1 = nx1; fig.y1 = ny1;
      changed = true;
    }
  }
}

function numsNear(fig, lines, bodySize) {
  const out = new Set();
  for (const line of lines) {
    const gap = line.y1 <= fig.y0 ? fig.y0 - line.y1 : line.y0 >= fig.y1 ? line.y0 - fig.y1 : 0;
    if (gap > 8 * bodySize) continue;
    const ws = line.words;
    for (let i = 0; i < ws.length; i++) {
      const inline = /^(?:fig(?:ure)?\.?\s*)(\d+)/i.exec(ws[i].text);
      const split = /^fig(?:ure)?\.?$/i.test(ws[i].text) && ws[i + 1] ? /^(\d+)/.exec(ws[i + 1].text) : null;
      const n = inline ? inline[1] : split ? split[1] : null;
      if (!n) continue;
      const host = inline ? ws[i] : ws[i + 1];
      if (host.x0 > fig.x1 + 12 || host.x1 < fig.x0 - 12) continue;
      out.add(n);
    }
  }
  return out;
}

function captionBetween(a, b, lines) {
  const top = a.y1 <= b.y0 ? a : b.y1 <= a.y0 ? b : null;
  if (!top) return false;
  const bot = top === a ? b : a;
  for (const line of lines) {
    if (!lineIsCaption(line.text)) continue;
    if (line.y0 >= top.y1 - 2 && line.y1 <= bot.y0 + 2) return true;
  }
  return false;
}

function bodyInGap(a, b, lines, bodySize) {
  const xGap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const yGap = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  // A label sandwiched in a small panel gap is part of the figure, not a separator.
  if (Math.max(xGap, yGap) <= Math.max(18, 1.5 * bodySize)) return false;
  for (const line of lines) {
    if (!lineIsBody(line) || line.size < 0.9 * bodySize) continue;
    const cx = (line.x0 + line.x1) / 2;
    const cy = (line.y0 + line.y1) / 2;
    if (xGap > 0) {
      const left = a.x1 <= b.x0 ? a : b;
      const right = left === a ? b : a;
      const yOverlap = Math.min(line.y1, Math.max(a.y1, b.y1)) - Math.max(line.y0, Math.min(a.y0, b.y0));
      if (cx > left.x1 && cx < right.x0 && yOverlap > 0) return true;
    }
    if (yGap > 0) {
      const top = a.y1 <= b.y0 ? a : b;
      const bot = top === a ? b : a;
      const xOverlap = Math.min(line.x1, Math.max(a.x1, b.x1)) - Math.max(line.x0, Math.min(a.x0, b.x0));
      if (cy > top.y1 && cy < bot.y0 && xOverlap > 0) return true;
    }
  }
  return false;
}

function unionPanels(figures, lines, bodySize, pageW, pageH) {
  let merged = true;
  let guard = 0;
  while (merged && guard++ < 40) {
    merged = false;
    for (let i = 0; i < figures.length; i++) {
      for (let j = i + 1; j < figures.length; j++) {
        const a = figures[i];
        const b = figures[j];
        if (!canUnion(a, b, lines, bodySize, pageW, pageH)) continue;
        a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
        a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
        a.count += b.count;
        a.pageImage = a.pageImage || b.pageImage;
        a.kind = a.kind === b.kind ? a.kind : "mixed";
        figures.splice(j, 1);
        j--;
        merged = true;
      }
    }
  }
}

function canUnion(a, b, lines, bodySize, pageW, pageH) {
  const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const xGap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const yGap = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  const minW = Math.min(a.x1 - a.x0, b.x1 - b.x0);
  const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  const sameRow = yOverlap >= 0.45 * minH && xGap <= H_GAP;
  const sameCol = xOverlap >= 0.45 * minW && yGap <= V_GAP;
  if (!sameRow && !sameCol) return false;
  if (sameCol && captionBetween(a, b, lines)) return false;
  const na = numsNear(a, lines, bodySize);
  const nb = numsNear(b, lines, bodySize);
  // Different numbers block the union even when a close pair also sees its neighbour's number.
  if (na.size && nb.size && !(na.size === nb.size && [...na].every((n) => nb.has(n)))) return false;
  if (bodyInGap(a, b, lines, bodySize)) return false;
  const area = (Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0)) * (Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0));
  if (!a.pageImage && !b.pageImage && area >= 0.68 * pageW * pageH) return false;
  return true;
}

export function clusterBoxes(items, gap) {
  const clusters = items.map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, items: [p] }));
  let merged = true;
  let guard = 0;
  while (merged && guard++ < 50) {
    merged = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
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
