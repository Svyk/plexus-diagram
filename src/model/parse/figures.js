// Parse step: raster images and vector drawings -> figures, with axis labels absorbed. Pure.
// A multi-panel figure is one box (the union). Page-sized art is kept only when the page
// is a drawing, not a text page. Every stored box is clipped to the page.

import { makeLine, round } from "./lines.js";
import { CAPTION_RE } from "./headings.js";
import { EQ_NUMBER_RE } from "./formulas.js";
import { FURNITURE_BAND } from "./furniture.js";
import { detectColumns } from "./xycut.js";

const IMAGE_MIN = 12;
const H_GAP = 56;
const V_GAP = 42;
const FIG_TOKEN = /^fig(?:ure)?\.?$/i;
const FIG_NUM = /^\d+[A-Za-z]?[.:]?$/;
const FIG_GLUED = /^fig(?:ure)?\.?\d+[A-Za-z]?$/i;
const REVERSED_FIG_RE = /^\d+[A-Za-z]?\s*\.?\s*fig(?:ure)?\.?$/i;
const CAPTION_SPLIT_GAP = 8;
const ANCHOR_SEP = 48;

export function findFigures({ graphics, usedRules = new Set(), usedBoxes = new Set(), words = [], bodySize = 10, pageW = 612, pageH = 792, ruleSegments = [], pageTextChars = null, plates = false }) {
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
  // Raster ink is not clustered with rules. A table's strokes would become a false
  // figure. coverPlates groups the ink, and only when a figure line is on the page.
  const inkBoxes = [];
  for (const b of graphics.ink || []) {
    const clipped = clipBox(b, pageW, pageH);
    if (!clipped) continue;
    if ((clipped.x1 - clipped.x0) * (clipped.y1 - clipped.y0) >= 0.9 * pageW * pageH) continue;
    inkBoxes.push({ ...clipped, kind: "ink", n: 1 });
  }
  // Rules not consumed by a lattice table (chart axes, grid lines) count toward drawings.
  // A plate page still clusters them: a patent sheet has no "Fig." line, and a chart's
  // axes are the drawing. coverPlates then groups those strokes under a figure caption.
  for (const seg of ruleSegments) {
    if (usedRules.has(seg) || seg.fromBox) continue;
    const box = seg.axis === "h" ? { x0: seg.a, x1: seg.b, y0: seg.pos, y1: seg.pos } : { x0: seg.pos, x1: seg.pos, y0: seg.a, y1: seg.b };
    const clipped = clipBox(box, pageW, pageH);
    if (!clipped) continue;
    prims.push({ ...clipped, kind: "rule", n: 1 });
  }
  const lines = wordLines(words);
  const labelWords = new Set();
  for (const line of lines) {
    for (const i of labelStarts(line.words)) {
      for (const w of line.words.slice(i, labelSpan(line.words, i))) labelWords.add(w);
    }
  }
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
  for (const fig of figures) growLabels(fig, lines, used, bodySize, pageW, pageH, gutters, labelWords);
  unionPanels(figures, lines, bodySize, pageW, pageH);
  for (const fig of figures) growLabels(fig, lines, used, bodySize, pageW, pageH, gutters, labelWords);
  if (plates) {
    coverPlates(figures, prims, lines, bodySize, pageW, pageH, inkBoxes);
    // Labels grow the plate. Words already inside stay free so a real table on the same page can still form.
    for (const fig of figures) {
      if (!fig.fromPlate) continue;
      growLabels(fig, lines, used, bodySize, pageW, pageH, gutters, labelWords);
      for (const line of lines) {
        if (line.y1 < fig.y0 - 1 || line.y0 > fig.y1 + 1) continue;
        const overlap = Math.min(line.x1, fig.x1) - Math.max(line.x0, fig.x0);
        if (overlap < 0.5 * (line.x1 - line.x0)) continue;
        for (const w of line.words) if (w.x0 >= fig.x0 - 1 && w.x1 <= fig.x1 + 1) used.delete(w);
      }
    }
  }
  const kept = [];
  for (const fig of figures) {
    const box = clipBox(fig, pageW, pageH);
    if (!box) continue;
    fig.x0 = box.x0; fig.y0 = box.y0; fig.x1 = box.x1; fig.y1 = box.y1;
    const area = (fig.x1 - fig.x0) * (fig.y1 - fig.y0);
    // A cluster that covers the page on a text page is not a figure. A single
    // page image (a drawing sheet) is decided by the caller and kept.
    if (!fig.pageImage && !fig.fromPlate && area >= 0.7 * pageW * pageH && textChars >= 180) continue;
    // A rule cluster on a text page, with no figure caption, is a table the lattice
    // missed (USDA p10, 2500 characters). A patent sheet is short (p1 is under 300)
    // and keeps the drawing. A chart whose caption was accepted is fromPlate.
    if (plates && !fig.fromPlate && !fig.pageImage && textChars >= 400) continue;
    if (plates && !fig.fromPlate && !fig.pageImage && lines.some((line) => proseLine(line) && line.y1 > fig.y0 + 1 && line.y0 < fig.y1 - 1 && Math.min(line.x1, fig.x1) - Math.max(line.x0, fig.x0) > 0.5 * (line.x1 - line.x0))) continue;
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
export function drawingSheetPage({ images, lines, tables, shapes, pageW, pageH, textChars }) {
  const pageArea = pageW * pageH;
  const pageImage = (images || []).some((im) => (im.x1 - im.x0) * (im.y1 - im.y0) >= 0.75 * pageArea);
  const vectorArt = (shapes || []).reduce((n, s) => n + (s.segs || 1), 0) >= 8;
  const textLines = (lines || []).filter((l) => (l.text || "").trim());
  const bodyish = textLines.filter((l) => wordCount(l.text) >= 8).length;
  const dense = (tables || []).some((t) => {
    if (!t.cells || t.rows < 3 || t.cols < 2) return false;
    const filled = t.cells.filter((c) => c.text).length;
    return filled >= 0.5 * Math.max(1, t.cells.length);
  });
  // A patent sheet is many short part labels over one page image (or vector art), plus
  // "Sheet N of M" and at least one FIG. label. Body prose still wins.
  const marked = textLines.some((l) => /sheet\s+\d+\s+of\s+\d+/i.test(l.text || "")) && figLabelCount(textLines) >= 1;
  if ((pageImage || vectorArt) && marked && textChars < 1200 && bodyish < 3 && !dense) return true;
  if (!pageImage || textChars < 12 || textChars >= 900) return false;
  if (textLines.length >= 16) return false;
  if (bodyish >= 3) return false;
  if (alignedLineCount(textLines) >= 4) return false;
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
    if (b.type === "caption" && /^fig/i.test(normalizeFigSpelling(b.text || "")) && (/\.{4,}|…{2,}|·{4,}/.test(b.text))) b.type = "para";
  }
  const caps = blocks.filter((b) => b.type === "caption" && /^fig/i.test(normalizeFigSpelling(b.text || "")));
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

// OCR on a plate often writes "F1g. 2", "FIG,2", or "Fig.2". The caption regex sees "Fig. 2".
export function normalizeFigSpelling(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/\bF[1l|]g/g, "Fig").replace(/\bf[1l|]g/g, "fig");
  t = t.replace(/\bfigu[nr]e\b/gi, (m) => (m[0] === "f" ? "figure" : "Figure"));
  t = t.replace(/\b([A-Za-z]{2,})\s*,\s*(?=\d)/g, "$1. ");
  // A plate number whose digit came back as a letter: "Fig. l" / "Fig. I."
  t = t.replace(/\b((?:fig(?:ure)?|plates?)\.?\s+)[lI|](?=\s|$|[.:])/gi, "$11");
  // "FIG. 11" on a plate comes back as two capitals. Only the figure number, and only
  // uppercase II (the crop of the gas-burners plate is "FIG. 11", not a roman two). III stays III.
  t = t.replace(/\b((?:fig(?:ure)?|plates?)\.?\s+)(II)(?=\s|$|[.:—–-])/gi, (full, pre, num) => (num === "II" ? `${pre}11` : full));
  return t;
}

// The number that belongs to the figure word, not a later "8-inch" or a section
// list. A range ("Figs. 5 & 6") is not a splitter. A bare "Fig." has no number.
export function figCaptionKey(text) {
  const t = normalizeFigSpelling(text);
  const rev = /^(\d+)\s*\.?\s*(?:fig(?:ure)?|plates?)\.?$/i.exec(t);
  if (rev) return rev[1];
  const m = /^((?:fig(?:ure)?s?|plates?)\.?)\s*(\d+[A-Za-z]?)?/i.exec(t);
  if (!m) return null;
  if (!m[2]) return "";
  const rest = t.slice(m[0].length);
  if (/^figs|^plates/i.test(m[1]) && /^[\s.,:&-]*(?:and\s+)?\d+/i.test(rest)) return null;
  return m[2].replace(/[A-Za-z]$/, "");
}

function lineIsCaption(text) {
  const t = normalizeFigSpelling(text);
  if (CAPTION_RE.test(t) || figCaptionKey(t) != null || /^fig(?:ure)?\.?\s*$/i.test(t) || REVERSED_FIG_RE.test(t)) return true;
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

function growLabels(fig, lines, used, bodySize, pageW, pageH, gutters, labelWords = new Set()) {
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
          if (used.has(w) || labelWords.has(w) || !(w.size <= 0.85 * bodySize)) continue;
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
      let span = line.words.filter((w) => !used.has(w) && !labelWords.has(w) && allow(w, line));
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

// One caption under both boxes, and that caption names a single figure.
function sharedCaptionBelow(a, b, lines) {
  const bottom = Math.max(a.y1, b.y1);
  for (const line of lines) {
    if (!lineIsCaption(line.text)) continue;
    if (line.y0 < bottom - 4 || line.y0 > bottom + 48) continue;
    const oxA = Math.min(line.x1, a.x1) - Math.max(line.x0, a.x0);
    const oxB = Math.min(line.x1, b.x1) - Math.max(line.x0, b.x0);
    if (oxA <= 8 || oxB <= 8) continue;
    const nums = new Set([...String(line.text).matchAll(/fig(?:ure)?\.?\s*(\d+)/gi)].map((m) => m[1]));
    if (nums.size === 1) return true;
  }
  return false;
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
  // A single caption under both (Figure 5's two plots) still joins them.
  const differentNums = na.size && nb.size && !(na.size === nb.size && [...na].every((n) => nb.has(n)));
  if (differentNums && !(sameRow && sharedCaptionBelow(a, b, lines))) return false;
  if (bodyInGap(a, b, lines, bodySize)) return false;
  const area = (Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0)) * (Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0));
  if (!a.pageImage && !b.pageImage && area >= 0.68 * pageW * pageH) return false;
  return true;
}

function figLabelCount(lines) {
  let n = 0;
  for (const l of lines) {
    const t = l.text || "";
    if (/fig(?:ure)?\.?\s*\d+[a-z]?/i.test(t) || REVERSED_FIG_RE.test(t.trim()) || FIG_GLUED.test(t.trim())) n++;
  }
  return n;
}

// Indexes where a figure label starts. A number drawn on top of "FIG" (pdf.js order "2.FIG")
// counts as the same label, starting at the number.
export function labelStarts(words) {
  const at = [];
  for (let i = 0; i < (words || []).length; i++) {
    const t = String(words[i].text || "").trim();
    if (FIG_GLUED.test(t) || /^fig(?:ure)?\.?\s*\d+/i.test(t)) { at.push(i); continue; }
    if (!FIG_TOKEN.test(t)) continue;
    let j = i + 1;
    if (words[j] && /^[.:]$/.test(String(words[j].text || "").trim())) j++;
    const next = words[j];
    if (next && FIG_NUM.test(String(next.text || "").trim()) && next.x0 - words[i].x1 < 24) {
      at.push(i);
      continue;
    }
    let k = i - 1;
    if (words[k] && /^[.:]$/.test(String(words[k].text || "").trim())) k--;
    if (k >= 0 && FIG_NUM.test(String(words[k].text || "").trim()) && words[i].x0 - words[k].x1 < 8) at.push(k);
  }
  return [...new Set(at)].sort((a, b) => a - b);
}

function labelSpan(words, i) {
  let j = i;
  while (j + 1 < words.length) {
    const n = words[j + 1];
    const t = String(n.text || "").trim();
    if (n.x0 - words[j].x1 > 24) break;
    if (!(FIG_TOKEN.test(t) || FIG_NUM.test(t) || /^[.:]$/.test(t) || FIG_GLUED.test(t))) break;
    j++;
  }
  return j + 1;
}

// "2 . FIG" drawn in one spot becomes "FIG. 2", so the caption regex can see it.
function orderedLabelWords(group) {
  const fig = group.find((w) => FIG_TOKEN.test(String(w.text || "").trim()));
  const num = group.find((w) => FIG_NUM.test(String(w.text || "").trim()));
  const dots = group.filter((w) => /^[.:]$/.test(String(w.text || "").trim()));
  if (!fig || !num || !(num.x0 <= fig.x0 + 2 && fig.x0 - num.x1 < 8)) return group;
  const figWord = { ...fig, text: String(fig.text || "").replace(/\.?$/, ".") };
  return [figWord, { ...num }];
}

// On a drawing sheet, lift each FIG. label onto its own line and fix reversed labels.
function normalizeFigWord(w) {
  const m = /^(\d+[A-Za-z]?)\.?fig(?:ure)?\.?$/i.exec(String(w.text || "").trim());
  if (!m) return w;
  return { ...w, text: `FIG. ${m[1]}` };
}

export function peelFigLabels(lines) {
  const out = [];
  for (const line of lines || []) {
    const words = (line.words || []).map(normalizeFigWord);
    const starts = labelStarts(words);
    if (!starts.length) { out.push(line); continue; }
    const pieces = [];
    let cursor = 0;
    for (const s of starts) {
      const end = Math.max(labelSpan(words, s), s + 1);
      if (s > cursor) pieces.push(words.slice(cursor, s));
      pieces.push(orderedLabelWords(words.slice(s, end)));
      cursor = Math.max(cursor, end);
    }
    if (cursor < words.length) pieces.push(words.slice(cursor));
    const rewritten = words.some((w, i) => w !== line.words[i]);
    const same = !rewritten && pieces.length === 1 && pieces[0].length === words.length && pieces[0].every((w, i) => w === words[i]);
    if (same) { out.push(line); continue; }
    for (const p of pieces) if (p.length) out.push(makeLine(p));
  }
  return out;
}

function figAnchors(lines) {
  const anchors = [];
  for (const line of lines || []) {
    const words = line.words || [];
    for (const i of labelStarts(words)) {
      const group = words.slice(i, labelSpan(words, i));
      if (!group.length) continue;
      const x = group.reduce((s, w) => s + (w.x0 + w.x1) / 2, 0) / group.length;
      const y = group.reduce((s, w) => s + (w.y0 != null && w.y1 != null ? (w.y0 + w.y1) / 2 : (w.base || 0)), 0) / group.length;
      anchors.push({ x, y });
    }
  }
  return anchors;
}

function splitAnchors(anchors, box) {
  if (anchors.length <= 1) return [{ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }];
  const dx = Math.max(...anchors.map((a) => a.x)) - Math.min(...anchors.map((a) => a.x));
  const dy = Math.max(...anchors.map((a) => a.y)) - Math.min(...anchors.map((a) => a.y));
  const vertical = dx >= dy;
  const sorted = [...anchors].sort((a, b) => (vertical ? a.x - b.x : a.y - b.y));
  let best = 1;
  let gap = -1;
  for (let i = 1; i < sorted.length; i++) {
    const g = vertical ? sorted[i].x - sorted[i - 1].x : sorted[i].y - sorted[i - 1].y;
    if (g > gap) { gap = g; best = i; }
  }
  if (gap < ANCHOR_SEP) return [{ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }];
  // A FIG label sits on the inner edge of its drawing. The midpoint of the two labels
  // then cuts the next drawing. Stop a short way past the first label.
  const mid = vertical
    ? Math.min(sorted[best - 1].x + 36, sorted[best].x - 24)
    : Math.min(sorted[best - 1].y + 36, sorted[best].y - 24);
  if (vertical) {
    return [
      ...splitAnchors(sorted.slice(0, best), { ...box, x1: mid }),
      ...splitAnchors(sorted.slice(best), { ...box, x0: mid }),
    ];
  }
  return [
    ...splitAnchors(sorted.slice(0, best), { ...box, y1: mid }),
    ...splitAnchors(sorted.slice(best), { ...box, y0: mid }),
  ];
}

// One rectangle per separated FIG. anchor, or the whole page when they sit together.
export function sheetRegions(lines, pageW, pageH) {
  const box = { x0: 0, y0: 0, x1: pageW, y1: pageH };
  const anchors = figAnchors(lines);
  if (anchors.length < 2) return [box];
  return splitAnchors(anchors, box);
}

function splitWordLine(line, indexes) {
  const cuts = [0, ...indexes, line.words.length];
  const parts = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const words = line.words.slice(cuts[i], cuts[i + 1]);
    if (words.length) parts.push(makeLine(words));
  }
  return parts;
}

function gapIndexAt(line, x) {
  const words = line.words || [];
  for (let i = 1; i < words.length; i++) {
    const gap0 = words[i - 1].x1;
    const gap1 = words[i].x0;
    if (gap1 - gap0 >= CAPTION_SPLIT_GAP && gap0 - 6 <= x && gap1 + 6 >= x) return i;
  }
  return -1;
}

function orderCaptionBand(band) {
  const cols = new Map();
  for (const line of band) {
    const k = line.capCol || 0;
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k).push(line);
  }
  const out = [];
  for (const k of [...cols.keys()].sort((a, b) => a - b)) {
    const col = cols.get(k).sort((a, b) => a.base - b.base || a.x0 - b.x0);
    for (const line of col) {
      delete line.capBand;
      delete line.capCol;
      out.push(line);
    }
  }
  return out;
}

// Two figure captions that share one baseline ("Figure 3: … Figure 4: …") are one line when
// the column gap is under two ems. Split at the later label, and split the following lines
// at that same x, then read each column top to bottom so the hyphen join stays inside it.
export function splitSharedCaptions(lines) {
  if (!lines?.length) return { lines: lines || [], gutters: [] };
  const out = [];
  const gutters = [];
  let bandId = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const starts = labelStarts(line.words || []);
    const splits = [];
    for (let c = 1; c < starts.length; c++) {
      const idx = starts[c];
      const prev = line.words[idx - 1];
      const cur = line.words[idx];
      if (prev && cur && cur.x0 - prev.x1 >= CAPTION_SPLIT_GAP) splits.push(idx);
    }
    if (!splits.length) { out.push(line); continue; }
    bandId += 1;
    const parts = splitWordLine(line, splits);
    if (parts.length >= 2 && parts[1].x0 - parts[0].x1 >= 6) gutters.push({ x0: parts[0].x1, x1: parts[1].x0 });
    parts.forEach((p, col) => { p.capBand = bandId; p.capCol = col; });
    const splitX = parts[1]?.x0;
    const consumed = new Set();
    const band = [...parts];
    if (splitX != null) {
      for (let d = 1; d < 6 && i + d < lines.length; d++) {
        const next = lines[i + d];
        if (next.base - line.base > 3 * (next.size || line.size || 10)) break;
        if (labelStarts(next.words || []).length >= 2) break;
        const at = gapIndexAt(next, splitX);
        if (at < 0) break;
        const segs = splitWordLine(next, [at]);
        segs.forEach((p, col) => { p.capBand = bandId; p.capCol = col; });
        band.push(...segs);
        consumed.add(next);
      }
    }
    out.push(...orderCaptionBand(band));
    while (i + 1 < lines.length && consumed.has(lines[i + 1])) i++;
  }
  return { lines: out, gutters };
}

function boxArea(b) {
  const w = (b.x1 ?? b.bbox?.[2]) - (b.x0 ?? b.bbox?.[0]);
  const h = (b.y1 ?? b.bbox?.[3]) - (b.y0 ?? b.bbox?.[1]);
  return Math.max(0, w) * Math.max(0, h);
}

function hullOf(items) {
  if (!items.length) return null;
  return {
    x0: Math.min(...items.map((p) => p.x0)),
    y0: Math.min(...items.map((p) => p.y0)),
    x1: Math.max(...items.map((p) => p.x1)),
    y1: Math.max(...items.map((p) => p.y1)),
  };
}

// Share of `inner` that sits inside `outer`. Boxes are {x0,y0,x1,y1}.
function insideFrac(inner, outer) {
  const area = boxArea(inner);
  if (area <= 0) return 0;
  const ox = Math.min(inner.x1, outer.x1) - Math.max(inner.x0, outer.x0);
  const oy = Math.min(inner.y1, outer.y1) - Math.max(inner.y0, outer.y0);
  if (ox <= 0 || oy <= 0) return 0;
  return (ox * oy) / area;
}

function proseLine(line) {
  const words = String(line.text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;
  return words.filter((w) => /[A-Za-z]{3,}/.test(w)).length >= 4;
}

// A steel "plate 14 inches" is not Plate 14. "Figure 1 is a side elevation" and
// "Figure 2 herewith." point at a drawing; they are not the caption under it.
function plateLabelText(text, key) {
  if (key == null) return false;
  const t = normalizeFigSpelling(text).replace(/\s+/g, " ").trim();
  if (/^plates?\s+\d+[A-Za-z]?\s+(?:inches?|mm|cm|ft|feet|thick)\b/i.test(t)) return false;
  const words = t.split(" ");
  if (key === "" && words.length > 2) return false;
  const rest = t.replace(/^(?:fig(?:ure)?s?|plates?)\.?\s*\d+[A-Za-z]?[.:]?\s*/i, "");
  if (/^(?:is|are|was|were|shows|show|comprises|has|have)\b/i.test(rest)) return false;
  if (/^(?:herewith|above|below|following|opposite)[.]?$/i.test(rest)) return false;
  return true;
}

// Caption lines that name one figure. A "Figs. 5 & 6" range is not one of them.
function plateCaptions(lines, pageH) {
  const out = [];
  for (const line of lines) {
    const text = normalizeFigSpelling(line.text);
    let keyed = text;
    let key = figCaptionKey(text);
    if (key == null) {
      // "Note No. 315 Fig. 3" — the plate number sits at the end of a short header.
      // A body sentence that mentions a figure is not a plate caption, even in the top band
      // ("1918, is shown in Figure 1.").
      const words = text.split(/\s+/);
      const at = words.findIndex((w) => /^fig/i.test(w));
      const header = line.y1 <= 0.18 * pageH;
      const before = at > 0 ? words.slice(0, at).join(" ") : "";
      const label = header && at > 0 && at >= words.length - 3 && words.length <= 8 && !/\b(is|are|was|were|shown|see)\b/i.test(before);
      if (label) { keyed = words.slice(at).join(" "); key = figCaptionKey(keyed); }
    }
    if (!plateLabelText(keyed, key)) continue;
    out.push({ ...line, key, text });
  }
  // A header that lost its digit ("Fig.") must not split the plate that still
  // has "Fig. 3" under the drawing.
  const numbered = out.filter((c) => c.key !== "");
  return numbered.length ? numbered : out;
}

// A fragment belongs to the caption under it. A caption above costs extra, so a
// chart between Fig. 5 and Fig. 6 stays with Fig. 6.
function nearestPlateCaption(prim, caps) {
  const cy = (prim.y0 + prim.y1) / 2;
  const cx = (prim.x0 + prim.x1) / 2;
  // The caption under the ink wins. A caption above is only the fallback,
  // so the chart between Fig. 5 and Fig. 6 stays with Fig. 6.
  const below = caps.filter((c) => c.y0 >= cy - 4);
  const pool = below.length ? below : caps;
  let best = null;
  let bestD = Infinity;
  for (const cap of pool) {
    const gapY = cap.y0 >= cy - 4 ? Math.max(0, cap.y0 - cy) : Math.max(0, cy - cap.y1);
    const xGap = cx < cap.x0 ? cap.x0 - cx : cx > cap.x1 ? cx - cap.x1 : 0;
    const dist = gapY + xGap * 0.25;
    if (dist < bestD) { bestD = dist; best = cap; }
  }
  return best;
}

function proseBetween(fig, cap, lines) {
  const top = Math.min(fig.y1, cap.y0);
  const bot = Math.max(fig.y1, cap.y0);
  if (bot - top < 4) return false;
  for (const line of lines) {
    if (!proseLine(line)) continue;
    const cy = (line.y0 + line.y1) / 2;
    if (cy <= top || cy >= bot) continue;
    const ox = Math.min(line.x1, Math.max(fig.x1, cap.x1)) - Math.max(line.x0, Math.min(fig.x0, cap.x0));
    if (ox > 12) return true;
  }
  return false;
}

// Pull the box toward its caption when only the chart's labels sit in the gap
// (an ordinate row, not a paragraph). Stop short of the caption line.
function extendTowardCaption(fig, cap, lines, bodySize, pageH) {
  if (!cap) return;
  if (cap.y1 <= fig.y0 + 2) {
    const gap = fig.y0 - cap.y1;
    if (gap > 2 && gap <= Math.max(3 * bodySize, 36) && !proseBetween(fig, cap, lines)) fig.y0 = cap.y1 + 2;
    return;
  }
  const gap = cap.y0 - fig.y1;
  const limit = Math.max(8 * bodySize, 0.2 * pageH);
  if (gap <= 2 || gap > limit || proseBetween(fig, cap, lines)) return;
  fig.y1 = Math.max(fig.y1, cap.y1);
  const fw = fig.x1 - fig.x0;
  const cw = cap.x1 - cap.x0;
  const ox = Math.min(fig.x1, cap.x1) - Math.max(fig.x0, cap.x0);
  if (fw > 0 && cw <= 1.5 * fw && ox > 0) {
    fig.x0 = Math.min(fig.x0, cap.x0);
    fig.x1 = Math.max(fig.x1, cap.x1);
  }
}

// Short rule fragments and raster ink spread over one plate become one figure.
// Two captions with different numbers stay two figures (a propeller page's
// Fig. 5 and Fig. 6). Fragments that already fill their plate are left as they are.
// Two drawings on one plate (ice p19): cut the ink on each caption baseline and
// hull each band on its own. A thin stroke that crosses the cut is a frame, not a bridge.
function splitPlateBands(figures, ink, caps, lines, bodySize, pageW, pageH) {
  const ordered = [];
  const seen = new Set();
  for (const c of [...caps].filter((c) => c.key !== "").sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    ordered.push(c);
  }
  if (ordered.length < 2) return false;
  const cuts = ordered.map((c) => c.y0);
  const groups = new Map(ordered.map((c) => [c.key, []]));
  for (const prim of ink) {
    for (let i = 0; i < ordered.length; i++) {
      const top = i === 0 ? 0 : cuts[i - 1];
      const bot = cuts[i];
      const y0 = Math.max(prim.y0, top);
      const y1 = Math.min(prim.y1, bot + 1);
      if (y1 - y0 < 2) continue;
      const pw = prim.x1 - prim.x0;
      const bandH = Math.max(1, bot - top);
      if (pw < 16 && y1 - y0 > 0.55 * bandH) continue;
      groups.get(ordered[i].key).push({ ...prim, y0, y1 });
    }
  }
  const pageArea = pageW * pageH;
  const made = [];
  for (const [key, items] of groups) {
    if (items.length < 4) continue;
    const hull = hullOf(items);
    if (!hull) continue;
    const w = hull.x1 - hull.x0;
    const h = hull.y1 - hull.y0;
    const area = w * h;
    if (w < 48 || h < 32 || area < 0.02 * pageArea || area > 0.7 * pageArea) continue;
    const cap = ordered.find((c) => c.key === key) || null;
    const plate = { ...hull, kind: "drawing", count: items.length, pageImage: false, fromPlate: true };
    extendTowardCaption(plate, cap, lines, bodySize, pageH);
    if ((plate.y1 - plate.y0) * (plate.x1 - plate.x0) > 0.7 * pageArea) continue;
    made.push(plate);
  }
  if (made.length < 2) return false;
  for (let i = figures.length - 1; i >= 0; i--) {
    const f = figures[i];
    if (f.kind === "image") continue;
    if (made.some((p) => insideFrac(f, p) >= 0.35 || insideFrac(p, f) >= 0.35)) figures.splice(i, 1);
  }
  figures.push(...made);
  return true;
}

function dropCoveredDrawings(figures) {
  for (let i = figures.length - 1; i >= 0; i--) {
    const f = figures[i];
    if (f.fromPlate) continue;
    if (figures.some((o) => o !== f && o.fromPlate && (insideFrac(f, o) >= 0.5 || insideFrac(o, f) >= 0.75))) figures.splice(i, 1);
  }
  for (let i = 0; i < figures.length; i++) {
    for (let j = figures.length - 1; j > i; j--) {
      const a = figures[i];
      const b = figures[j];
      if (!a.fromPlate || !b.fromPlate) continue;
      if (insideFrac(a, b) >= 0.8 && insideFrac(b, a) >= 0.8) figures.splice(j, 1);
    }
  }
}

function coverPlates(figures, prims, lines, bodySize, pageW, pageH, inkBoxes = []) {
  let ink = [...prims.filter((p) => p.kind === "rule" || p.kind === "shape"), ...inkBoxes];
  const inkOnly = ink.filter((p) => p.kind === "ink");
  if (inkOnly.length) {
    const drawn = hullOf(inkOnly);
    const padX = Math.max(36, 0.06 * pageW);
    const padY = Math.max(18, 0.04 * pageH);
    const near = ink.filter((p) => p.kind === "ink" || (p.x1 >= drawn.x0 - padX && p.x0 <= drawn.x1 + padX && p.y1 >= drawn.y0 - padY && p.y0 <= drawn.y1 + padY));
    if (near.length >= 4) ink = near;
  }
  if (ink.length < 4) return;
  const caps = plateCaptions(lines, pageH);
  // Ink with no figure line is a table rule or a speck, not a plate.
  if (!caps.length) return;
  // Band cuts need raster ink. Rule fragments alone hull too tight (accelerometer
  // helper Fig. 2) and the nearest-caption path is the one that matched before.
  if (inkOnly.length && splitPlateBands(figures, ink, caps, lines, bodySize, pageW, pageH)) {
    dropCoveredDrawings(figures);
    return;
  }
  const groups = new Map();
  for (const prim of ink) {
    let key = "plate";
    if (caps.length) {
      const keys = new Set(caps.map((c) => c.key));
      if (keys.size <= 1) key = [...keys][0];
      else {
        const near = nearestPlateCaption(prim, caps);
        if (!near) continue;
        key = near.key;
      }
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(prim);
  }
  const pageArea = pageW * pageH;
  for (const [key, items] of groups) {
    if (items.length < 6 && !items.some((p) => p.kind === "ink")) continue;
    const hull = hullOf(items);
    if (!hull) continue;
    const w = hull.x1 - hull.x0;
    const h = hull.y1 - hull.y0;
    const area = w * h;
    if (w < 48 || h < 32 || area < 0.025 * pageArea || area > 0.92 * pageArea) continue;
    const drawings = figures.filter((f) => f.kind !== "image");
    const inside = drawings.filter((f) => insideFrac(f, hull) >= 0.5);
    const insideArea = inside.reduce((n, f) => n + boxArea(f), 0);
    const mine = caps.filter((c) => c.key === key);
    const cap = mine.filter((c) => c.y0 >= hull.y1 - 8).sort((a, b) => a.y0 - b.y0)[0]
      || mine.filter((c) => c.y1 <= hull.y0 + 8).sort((a, b) => b.y1 - a.y1)[0]
      || mine[0]
      || null;
    if (inside.length && insideArea >= 0.55 * area) {
      for (const f of inside) {
        f.x0 = Math.min(f.x0, hull.x0); f.y0 = Math.min(f.y0, hull.y0);
        f.x1 = Math.max(f.x1, hull.x1); f.y1 = Math.max(f.y1, hull.y1);
        f.fromPlate = true;
        extendTowardCaption(f, cap, lines, bodySize, pageH);
      }
      continue;
    }
    for (const f of inside) {
      const at = figures.indexOf(f);
      if (at >= 0) figures.splice(at, 1);
    }
    const plate = { ...hull, kind: "drawing", count: items.length, pageImage: false, fromPlate: true };
    extendTowardCaption(plate, cap, lines, bodySize, pageH);
    figures.push(plate);
  }
  dropCoveredDrawings(figures);
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
