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
const FIG_LEAD = String.raw`fig(?:ure)?s?|plates?|abb(?:ildung(?:en)?)?|tafeln?|tafel|taf|sketch(?:es)?`;
const FIG_TOKEN = new RegExp(`^(?:${FIG_LEAD})\\.?$`, "i");
const FIG_NUM = /^\d+[A-Za-z]?[.:]?$/;
const FIG_GLUED = new RegExp(`^(?:${FIG_LEAD})\\.?\\d+[A-Za-z]?$`, "i");
const REVERSED_FIG_RE = new RegExp(`^\\d+[A-Za-z]?(?:[.\\s]+)\\s*(?:${FIG_LEAD})\\.?$`, "i");
const CAPTION_SPLIT_GAP = 8;
const ANCHOR_SEP = 48;

export function findFigures({ graphics, usedRules = new Set(), usedBoxes = new Set(), words = [], bodySize = 10, pageW = 612, pageH = 792, ruleSegments = [], pageTextChars = null, plates = false, textLines = null }) {
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
    coverPlates(figures, prims, lines, bodySize, pageW, pageH, inkBoxes.filter((b) => !overlapsBodyLine(b, lines)));
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
    // A photograph or an engraving is a tone region inside the page image. The
    // page image itself stays the background.
    // Table words are already claimed, so `lines` no longer holds them. The ink
    // of those rules is still on the page; judge it against the full text.
    pictureRegions(figures, inkBoxes, lines, pageW, pageH, textLines);
  }
  const kept = [];
  const dropped = [];
  for (const fig of figures) {
    const box = clipBox(fig, pageW, pageH);
    if (!box) { dropped.push(fig); continue; }
    fig.x0 = box.x0; fig.y0 = box.y0; fig.x1 = box.x1; fig.y1 = box.y1;
    const area = (fig.x1 - fig.x0) * (fig.y1 - fig.y0);
    // A cluster that covers the page on a text page is not a figure. A single
    // page image (a drawing sheet) is decided by the caller and kept.
    let drop = !fig.pageImage && !fig.fromPlate && area >= 0.7 * pageW * pageH && textChars >= 180;
    // A rule cluster on a text page, with no figure caption, is a table the lattice
    // missed (USDA p10, 2500 characters). A patent sheet is short (p1 is under 300)
    // and keeps the drawing. A chart whose caption was accepted is fromPlate.
    // A contents entry ("Figure 1. …… 7") is not a drawing, even when the page is short.
    if (plates && !fig.fromPlate && !fig.pageImage && (textChars >= 400 || contentsLead(lines))) drop = true;
    if (plates && !fig.fromPlate && !fig.pageImage && lines.some((line) => proseLine(line) && line.y1 > fig.y0 + 1 && line.y0 < fig.y1 - 1 && Math.min(line.x1, fig.x1) - Math.max(line.x0, fig.x0) > 0.5 * (line.x1 - line.x0))) drop = true;
    if (drop) { dropped.push(fig); continue; }
    fig.bbox = [round(fig.x0), round(fig.y0), round(fig.x1), round(fig.y1)];
    delete fig.pageImage;
    kept.push(fig);
  }
  // Labels grown onto a cluster that is not a figure are the page's text.
  releaseFigureWords(dropped, kept, lines, used);
  return {
    figures: rejectFalseFigures(kept, {
      lines, pageW, pageH,
      strokes: [...inkBoxes, ...prims.filter((p) => p.kind === "rule" || p.kind === "shape")],
    }),
    used,
  };
}

// Words absorbed while a candidate was growing go back to the text when that
// candidate is not kept, unless a figure we did keep still covers them.
function releaseFigureWords(dropped, kept, lines, used) {
  if (!dropped.length || !used.size) return;
  const inside = (w, fig) => {
    const cx = (w.x0 + w.x1) / 2;
    const cy = ((w.y0 ?? w.base) + (w.y1 ?? w.base)) / 2;
    return cx >= fig.x0 - 4 && cx <= fig.x1 + 4 && cy >= fig.y0 - 4 && cy <= fig.y1 + 4;
  };
  for (const line of lines) {
    for (const w of line.words) {
      if (!used.has(w) || !dropped.some((fig) => inside(w, fig))) continue;
      if (kept.some((fig) => inside(w, fig))) continue;
      used.delete(w);
    }
  }
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
  // Opening hours and a timetable are the page's text, not part labels on a sheet.
  const clocks = textLines.filter((l) => /\b\d{1,2}[.:]\d{2}\b/.test(l.text || "")).length;
  if (clocks >= 2) return false;
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

// A label drawn on a block diagram ("G(s)", "r(t)+", "c (t)"). A header row
// is words; one of these is not a row of the header.
function diagramLabel(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || wordCount(t) > 2) return false;
  return /[A-Za-z]\s*\([^)\s]{1,8}\)/.test(t);
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
  // A gutter mark ("/ FIGURE 1") is not part of the lead.
  t = t.replace(/^[^\p{L}\p{N}]+(?=(?:fig(?:ure)?s?|plates?|abb(?:ildung(?:en)?)?|tafeln?|tafel|taf|sketch(?:es)?)\b)/iu, "");
  t = t.replace(/\bF[1l|]g/g, "Fig").replace(/\bf[1l|]g/g, "fig");
  t = t.replace(/\bfigu[nr]e\b/gi, (m) => (m[0] === "f" ? "figure" : "Figure"));
  t = t.replace(/\b([A-Za-z]{2,})\s*,\s*(?=\d)/g, "$1. ");
  // A plate number whose digit came back as a letter: "Fig. l" / "Fig. I."
  t = t.replace(/\b((?:fig(?:ure)?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\.?\s+)[lI|](?=\s|$|[.:])/gi, "$11");
  // "FIG. 11" on a plate comes back as two capitals. Only the figure number, and only
  // uppercase II (the crop of the gas-burners plate is "FIG. 11", not a roman two). III stays III.
  t = t.replace(/\b((?:fig(?:ure)?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\.?\s+)(II)(?=\s|$|[.:—–-])/gi, (full, pre, num) => (num === "II" ? `${pre}11` : full));
  return t;
}

// The number that belongs to the figure word, not a later "8-inch" or a section
// list. A range ("Figs. 5 & 6") is not a splitter. A bare "Fig." has no number.
export function figCaptionKey(text) {
  let t = normalizeFigSpelling(text);
  t = t.replace(/^(?:[-+]?\d+\s+){1,6}(?=(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\b)/i, "");
  // A steel "plate 14 inches" is a dimension, not Plate 14.
  if (/^plates?\s+\d+[A-Za-z]?\s+(?:inches?|mm|cm|ft|feet|thick)\b/i.test(t)) return null;
  const roman = /^(?:plates?|tafeln?|tafel|taf\.?)\s+([IVXLC]{1,6})\b/i.exec(t);
  if (roman) return roman[1].toUpperCase();
  const rev = new RegExp(`^(\\d+)\\s*\\.?\\s*(?:${FIG_LEAD})\\.?$`, "i").exec(t);
  if (rev) return rev[1];
  const m = new RegExp(`^((?:${FIG_LEAD})\\.?)\\s*(\\d+[A-Za-z]?)?`, "i").exec(t);
  if (!m) return null;
  if (!m[2]) return "";
  const rest = t.slice(m[0].length);
  if (/^(?:figs|plates|abbildungen|tafeln)/i.test(m[1]) && /^[\s.,:&-]*(?:and\s+)?\d+/i.test(rest)) return null;
  return m[2].replace(/[A-Za-z]$/, "");
}

function lineIsCaption(text) {
  const t = normalizeFigSpelling(text);
  if (/^plates?\s+\d+[A-Za-z]?\s+(?:inches?|mm|cm|ft|feet|thick)\b/i.test(t)) return false;
  if (CAPTION_RE.test(t) || figCaptionKey(t) != null || new RegExp(`^(?:${FIG_LEAD})\\.?\\s*$`, "i").test(t) || REVERSED_FIG_RE.test(t)) return true;
  // "Figure" followed by a missing glyph or a bare number, with no other words.
  return new RegExp(`^(?:${FIG_LEAD})\\.?\\s+(\\d+[A-Za-z]?[:.]?|[^\\p{L}\\p{N}]{1,4})$`, "iu").test(t);
}

function lineIsBody(line) {
  return wordCount(line.text) >= 8;
}

// A plate that fills the page prints its title in the bottom band, one line
// above the credit. That line is shorter than a paragraph, so it is not a label.
function captionBandLine(line, fig, pageW, pageH, bodySize) {
  const area = Math.max(0, (fig.x1 - fig.x0) * (fig.y1 - fig.y0));
  if (!(pageW > 0) || !(pageH > 0) || area < 0.75 * pageW * pageH) return false;
  if (wordCount(line.text) < 4) return false;
  if ((line.size || 0) < 0.9 * bodySize) return false;
  const mid = ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2;
  return mid >= pageH * 0.82;
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
      if (captionBandLine(line, art, pageW, pageH, bodySize)) continue;
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
    const nextText = String(next?.text || "").trim();
    // "1.—Viscosity" keeps the number on the first word of the caption.
    const gluedNum = /^\d+[A-Za-z]?[.:—–-]/.test(nextText);
    if (next && (FIG_NUM.test(nextText) || gluedNum) && next.x0 - words[i].x1 < 36) {
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
  const m = /^(\d+[A-Za-z]?)\.fig(?:ure)?\.?$/i.exec(String(w.text || "").trim());
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
  const at = cutsNear(line, [x]);
  return at.length ? at[0] : -1;
}

// Word boundaries that sit on a known column cut. A closed-up gutter is still a cut
// when the two words only touch; a boundary elsewhere on the line is not.
function cutsNear(line, xs) {
  const words = line.words || [];
  const idxs = [];
  for (let i = 1; i < words.length; i++) {
    const gap0 = words[i - 1].x1;
    const gap1 = words[i].x0;
    if (gap1 + 0.5 < gap0) continue;
    const mid = (Math.max(gap0, gap1) + Math.min(gap0, gap1)) / 2;
    if ((xs || []).some((x) => gap0 - 8 <= x && gap1 + 8 >= x && Math.abs(mid - x) <= 18)) idxs.push(i);
  }
  return idxs;
}

// Gaps that end a caption and start the next column. The gap between "FIGURE" and
// its number is the label, not a column.
function columnGapSplits(words) {
  const at = [];
  for (let i = 1; i < (words || []).length; i++) {
    const prev = String(words[i - 1].text || "").trim();
    if (FIG_TOKEN.test(prev) || /^[.:]$/.test(prev)) continue;
    if (words[i].x0 - words[i - 1].x1 >= CAPTION_SPLIT_GAP) at.push(i);
  }
  return at;
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
      const between = line.words.slice(starts[c - 1], idx);
      const captionWords = between.some((w) => {
        const t = String(w.text || "").trim();
        return t && !FIG_TOKEN.test(t) && !FIG_NUM.test(t) && !/^[.:]$/.test(t);
      });
      // Two captions share the baseline even when the column gap has closed up.
      if (prev && cur && (cur.x0 - prev.x1 >= CAPTION_SPLIT_GAP || captionWords)) splits.push(idx);
    }
    if (starts.length >= 2) {
      for (const g of columnGapSplits(line.words || [])) if (!splits.includes(g)) splits.push(g);
      splits.sort((a, b) => a - b);
    }
    if (!splits.length) { out.push(line); continue; }
    bandId += 1;
    const parts = splitWordLine(line, splits);
    for (let p = 1; p < parts.length; p++) {
      if (parts[p].x0 - parts[p - 1].x1 >= 6) gutters.push({ x0: parts[p - 1].x1, x1: parts[p].x0 });
    }
    parts.forEach((p, col) => { p.capBand = bandId; p.capCol = col; });
    const splitXs = parts.slice(1).map((p) => p.x0);
    const consumed = new Set();
    const band = [...parts];
    if (splitXs.length) {
      for (let d = 1; d < 6 && i + d < lines.length; d++) {
        const next = lines[i + d];
        if (next.base - line.base > 3 * (next.size || line.size || 10)) break;
        if (labelStarts(next.words || []).length >= 2) break;
        const at = cutsNear(next, splitXs);
        if (!at.length) break;
        const segs = splitWordLine(next, at);
        segs.forEach((p) => {
          p.capBand = bandId;
          let col = 0;
          for (const x of splitXs) if (p.x0 >= x - 6) col++;
          p.capCol = col;
        });
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

function touchesBox(a, b, pad) {
  return a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.y0 <= b.y1 + pad && b.y0 <= a.y1 + pad;
}

// A disconnected speck (a one-pixel Vision mark at the page origin) must not
// pull the plate hull to the corner. Thin strokes of a line drawing are all
// small, so they stay when nothing larger is on the page.
function isolatedInk(boxes, pageW, pageH) {
  if (boxes.length < 2) return [];
  const minArea = Math.max(64, 0.001 * pageW * pageH);
  const big = boxes.filter((b) => boxArea(b) >= minArea);
  if (!big.length) return [];
  return boxes.filter((b) => boxArea(b) < minArea && !big.some((g) => touchesBox(b, g, 6)));
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

function contentsLead(lines) {
  const list = lines || [];
  const leader = list.some((line) => {
    const t = String(line.text || "");
    const dots = (t.match(/[.]/g) || []).length;
    return /\.{4,}|…{2,}|·{4,}/.test(t) || (dots >= 6 && dots > t.length * 0.35);
  });
  const named = list.some((line) => /\b(?:fig(?:ure)?s?|tables?|plates?)\b/i.test(line.text || "") && /\d/.test(line.text || ""));
  return leader && named;
}

// Ink that sits on a body line is the type, or an underline, not the drawing.
function overlapsBodyLine(box, lines) {
  const bw = (box.x1 ?? 0) - (box.x0 ?? 0);
  const bh = (box.y1 ?? 0) - (box.y0 ?? 0);
  if (!(bw > 0) || !(bh > 0)) return false;
  for (const line of lines || []) {
    if (!proseLine(line)) continue;
    const ox = Math.min(box.x1, line.x1) - Math.max(box.x0, line.x0);
    const oy = Math.min(box.y1, line.y1) - Math.max(box.y0, line.y0);
    if (ox > 0.6 * bw && oy > 0.5 * bh) return true;
  }
  return false;
}

function figBox(fig) {
  if (fig.bbox && fig.bbox.length >= 4 && (fig.x0 == null)) return { x0: fig.bbox[0], y0: fig.bbox[1], x1: fig.bbox[2], y1: fig.bbox[3] };
  if (fig.x0 != null) return { x0: fig.x0, y0: fig.y0, x1: fig.x1, y1: fig.y1 };
  if (fig.bbox && fig.bbox.length >= 4) return { x0: fig.bbox[0], y0: fig.bbox[1], x1: fig.bbox[2], y1: fig.bbox[3] };
  return null;
}

function writeFigBox(fig, box) {
  fig.x0 = box.x0; fig.y0 = box.y0; fig.x1 = box.x1; fig.y1 = box.y1;
  if (fig.bbox) fig.bbox = [round(box.x0), round(box.y0), round(box.x1), round(box.y1)];
}

function lineCenterIn(line, box) {
  const cx = ((line.x0 ?? 0) + (line.x1 ?? 0)) / 2;
  const cy = ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2;
  return cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1;
}

function strokeGeom(s) {
  if (!s || s.x0 == null || s.y0 == null || s.x1 == null || s.y1 == null) return null;
  const x0 = Math.min(s.x0, s.x1);
  const x1 = Math.max(s.x0, s.x1);
  const y0 = Math.min(s.y0, s.y1);
  const y1 = Math.max(s.y0, s.y1);
  return { ...s, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, kind: s.kind || "ink" };
}

function strokeInBox(box, g) {
  if (g.h < 1 && g.w >= 1) {
    return g.y0 >= box.y0 - 1 && g.y0 <= box.y1 + 1 && Math.min(box.x1, g.x1) - Math.max(box.x0, g.x0) > 1;
  }
  if (g.w < 1 && g.h >= 1) {
    return g.x0 >= box.x0 - 1 && g.x0 <= box.x1 + 1 && Math.min(box.y1, g.y1) - Math.max(box.y0, g.y0) > 1;
  }
  return Math.min(box.x1, g.x1) - Math.max(box.x0, g.x0) > 0 && Math.min(box.y1, g.y1) - Math.max(box.y0, g.y0) > 0;
}

// Axes (a long rule each way, plus ticks or a curve), a curve, hatching, a
// raster region bigger than a library stamp, or a dense sketch. A table grid
// of long rules is none of these. Margin specks are not either.
function drawingParts(box, strokes, pageW, pageH) {
  if (!box || !(pageW > 0) || !(pageH > 0)) return [];
  const pageArea = pageW * pageH;
  const inside = [];
  for (const s of strokes || []) {
    const g = strokeGeom(s);
    if (!g || g.kind === "image") continue;
    if (!strokeInBox(box, g)) continue;
    inside.push(g);
  }
  if (!inside.length) return [];
  const blobs = inside.filter((g) => (g.kind === "ink" || g.kind === "box") && g.w * g.h > 0.015 * pageArea && Math.min(g.w, g.h) >= 8);
  const curves = inside.filter((g) => g.kind === "shape" && ((g.segs || g.n || 0) >= 8 || (g.w * g.h > 0.015 * pageArea && Math.min(g.w, g.h) >= 8)));
  const rules = inside.filter((g) => g.kind === "rule");
  const longH = rules.filter((g) => g.w >= 36 && g.h <= 4);
  const longV = rules.filter((g) => g.h >= 36 && g.w <= 4);
  const shortH = rules.filter((g) => g.w >= 8 && g.w < 36 && g.h <= 4);
  const shortV = rules.filter((g) => g.h >= 8 && g.h < 36 && g.w <= 4);
  const hatch = shortH.length >= 6 || shortV.length >= 6;
  const axes = longH.length >= 1 && longV.length >= 1 && (shortH.length + shortV.length >= 4 || curves.length > 0 || blobs.length > 0);
  const fragments = inside.filter((g) => (g.kind === "ink" || g.kind === "shape") && Math.min(g.w, g.h) >= 6 && Math.max(g.w, g.h) >= 12 && g.w * g.h >= 80);
  const fragHull = hullOf(fragments);
  const fragArea = fragments.reduce((n, g) => n + g.w * g.h, 0);
  const many = fragments.length >= 8 && fragHull && fragArea >= 0.25 * Math.max(1, boxArea(fragHull));
  if (!blobs.length && !curves.length && !hatch && !axes && !many) return [];
  const parts = [];
  if (blobs.length) parts.push(...blobs);
  if (curves.length) parts.push(...curves);
  if (hatch) parts.push(...(shortH.length >= 6 ? shortH : shortV));
  if (axes) parts.push(...longH, ...longV, ...shortH, ...shortV);
  if (many) parts.push(...fragments);
  return parts;
}

// The drawing's hull lies in the candidate and fills at least `minShare` of it.
// A fifth means the box is the drawing, not a margin that touched one stroke.
function drawingCovers(box, parts, minShare) {
  if (!parts.length) return false;
  const hull = hullOf(parts);
  if (!hull || insideFrac(hull, box) < 0.8) return false;
  const boxA = boxArea(box);
  if (!(boxA > 0)) return false;
  const hw = Math.max(0, hull.x1 - hull.x0);
  const hh = Math.max(0, hull.y1 - hull.y0);
  const hullA = Math.max(hw * hh, hw * 8, hh * 8);
  return hullA >= minShare * boxA;
}

function markMeasure(g) {
  if (g.h <= 4 && g.w >= 8) return g.w;
  if (g.w <= 4 && g.h >= 8) return g.h;
  return Math.max(g.w, 0.6) * Math.max(g.h, 0.6);
}

function markOverlap(g, next) {
  if (g.h <= 4 && g.w >= 8) {
    if (g.y0 < next.y0 - 1.5 || g.y0 > next.y1 + 1.5) return 0;
    return Math.max(0, Math.min(next.x1, g.x1) - Math.max(next.x0, g.x0));
  }
  if (g.w <= 4 && g.h >= 8) {
    if (g.x0 < next.x0 - 1.5 || g.x0 > next.x1 + 1.5) return 0;
    return Math.max(0, Math.min(next.y1, g.y1) - Math.max(next.y0, g.y0));
  }
  const ox = Math.max(0, Math.min(next.x1, g.x1) - Math.max(next.x0, g.x0));
  const oy = Math.max(0, Math.min(next.y1, g.y1) - Math.max(next.y0, g.y0));
  return ox * oy;
}

// A clip may shave labels. It may not throw the drawing away.
function drawingKept(box, next, parts) {
  if (!drawingCovers(box, parts, 0.2)) return true;
  let area = 0;
  let kept = 0;
  for (const p of parts) {
    const a = markMeasure(p);
    area += a;
    kept += markOverlap(p, next);
  }
  return !(area > 0) || kept >= 0.75 * area;
}

// A caption or a paragraph across the plate is not a column beside the ink.
function spansPlate(line, box, parts) {
  const lw = (line.x1 ?? 0) - (line.x0 ?? 0);
  const bw = box.x1 - box.x0;
  if (bw > 0 && lw >= 0.62 * bw) return true;
  if (!parts.length) return false;
  const x0 = Math.min(...parts.map((p) => p.x0));
  const x1 = Math.max(...parts.map((p) => p.x1));
  const dw = x1 - x0;
  if (dw < 24) return false;
  return Math.min(line.x1, x1) - Math.max(line.x0, x0) >= 0.7 * dw;
}

function textBlockBox(box, lines) {
  const prose = (lines || []).filter((line) => proseLine(line) && lineCenterIn(line, box));
  if (prose.length < 6) return false;
  const span = Math.max(...prose.map((line) => line.y1)) - Math.min(...prose.map((line) => line.y0));
  return span >= 0.55 * (box.y1 - box.y0);
}

// A column of body text beside the ink is not part of the drawing. Clip it off
// when the prose sits on one side and a drawing-sized remainder stays.
// Lines that cross the drawing are the caption or the paragraph on the plate.
// A text page is not carved: slicing one column off it leaves a strip.
function clipBodyColumn(fig, lines, strokes, pageW, pageH) {
  const box = figBox(fig);
  if (!box) return false;
  if (textBlockBox(box, lines)) return false;
  const parts = drawingParts(box, strokes, pageW, pageH);
  const prose = (lines || []).filter((line) => proseLine(line) && lineCenterIn(line, box) && !spansPlate(line, box, parts));
  if (prose.length < 3) return false;
  const mid = (box.x0 + box.x1) / 2;
  const right = prose.filter((line) => ((line.x0 + line.x1) / 2) >= mid);
  const left = prose.filter((line) => ((line.x0 + line.x1) / 2) < mid);
  let next = { ...box };
  if (right.length >= 3 && left.length <= 1) {
    const cut = Math.min(...right.map((line) => line.x0));
    if (cut - box.x0 >= 48 && box.x1 - cut >= 24) next = { ...next, x1: cut - 2 };
  } else if (left.length >= 3 && right.length <= 1) {
    const cut = Math.max(...left.map((line) => line.x1));
    if (box.x1 - cut >= 48 && cut - box.x0 >= 24) next = { ...next, x0: cut + 2 };
  }
  if (next.x0 === box.x0 && next.x1 === box.x1) return false;
  if (!drawingKept(box, next, parts)) return false;
  writeFigBox(fig, next);
  return true;
}

// Why a box is not a figure: edge stripe, library stamp, rule, table border, text block.
// A null reason means the box stays. A candidate whose ink is a drawing (axes, a curve,
// hatching, many strokes) is a figure wherever it sits. A text hull that only contains
// a small drawing is still a text block.
export function falseFigureReason(fig, { lines = [], tables = [], pageW = 612, pageH = 792, peers = [], strokes = [] } = {}) {
  const box = figBox(fig);
  if (!box || !(pageW > 0) || !(pageH > 0)) return null;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const area = w * h;
  const pageArea = pageW * pageH;
  if (!(area > 0)) return null;
  const textBlock = textBlockBox(box, lines);
  // A cloud of short strokes in a small box is the grain of a photograph, or the
  // edge of the next sheet in the picture, not a drawing.
  if (!fig.fromPlate && fig.kind === "drawing" && (fig.count || 0) >= 18 && area < 0.035 * pageArea) return "texture";
  const parts = drawingParts(box, strokes, pageW, pageH);
  if (drawingCovers(box, parts, 0.5) || (drawingCovers(box, parts, 0.2) && !textBlock)) return null;
  const touchTop = box.y0 <= Math.max(4, 0.02 * pageH);
  const touchBot = box.y1 >= pageH - Math.max(4, 0.02 * pageH);
  const touchLeft = box.x0 <= Math.max(4, 0.02 * pageW);
  const touchRight = box.x1 >= pageW - Math.max(4, 0.02 * pageW);
  const largerPeer = peers.some((other) => other !== fig && boxArea(figBox(other) || {}) >= 3 * area);
  if ((touchTop || touchBot) && h <= 0.16 * pageH && w >= 0.65 * pageW && w >= 5 * h && (largerPeer || h <= 0.045 * pageH)) return "edge-stripe";
  if ((touchLeft || touchRight) && w <= 0.055 * pageW && h >= 0.35 * pageH && h >= 8 * w) return "edge-stripe";
  if (!fig.fromPlate && (h <= 0.012 * pageH && w >= 0.25 * pageW || w <= 0.012 * pageW && h >= 0.25 * pageH)) return "rule";
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const aspect = h > 0 ? w / h : 0;
  const corner = (cx <= 0.12 * pageW || cx >= 0.88 * pageW) && (cy <= 0.12 * pageH || cy >= 0.88 * pageH);
  if (!fig.fromPlate && corner && area >= 0.002 * pageArea && area <= 0.015 * pageArea && aspect >= 0.35 && aspect <= 2.8) return "stamp";
  if (!fig.fromPlate && cy >= 0.9 * pageH && w <= 0.45 * pageW && h <= 0.045 * pageH && area <= 0.02 * pageArea && aspect >= 1.4) return "stamp";
  for (const table of tables || []) {
    const tb = table.bbox || table;
    if (!tb || tb.length < 4) continue;
    if (insideFrac(box, { x0: tb[0], y0: tb[1], x1: tb[2], y1: tb[3] }) >= 0.55) return "table-border";
  }
  if (textBlock) return "text-block";
  return null;
}

// Body lines stacked in the upper part of a box are the paragraph above the drawing.
// A running head may sit above that paragraph; the cut still drops the whole band.
function clipBodyBand(fig, lines, strokes, pageW, pageH) {
  const box = figBox(fig);
  if (!box) return;
  const prose = (lines || []).filter((line) => proseLine(line) && lineCenterIn(line, box));
  if (prose.length < 3) return;
  const bot = Math.max(...prose.map((line) => line.y1));
  const top = Math.min(...prose.map((line) => line.y0));
  const h = box.y1 - box.y0;
  if (bot - top <= 0.45 * h && bot - box.y0 <= 0.45 * h && box.y1 - bot >= 48) {
    const next = { ...box, y0: bot + 2 };
    if (!drawingKept(box, next, drawingParts(box, strokes, pageW, pageH))) return;
    writeFigBox(fig, next);
  }
}

export function rejectFalseFigures(figures, opts = {}) {
  const list = figures || [];
  const strokes = opts.strokes || [];
  const pageW = opts.pageW || 612;
  const pageH = opts.pageH || 792;
  for (const fig of list) {
    clipBodyColumn(fig, opts.lines || [], strokes, pageW, pageH);
    clipBodyBand(fig, opts.lines || [], strokes, pageW, pageH);
  }
  const peers = list.map((fig) => fig);
  return list.filter((fig) => {
    const reason = falseFigureReason(fig, { ...opts, peers, strokes });
    return !reason;
  });
}

// A letter or a menu: text runs down the page, and it is not a drawing sheet.
function letterSpread(lines, pageH) {
  const text = (lines || []).filter((line) => (line.text || "").trim());
  if (text.length < 4 || !(pageH > 0)) return false;
  if (text.some((line) => /sheet\s+\d+\s+of\s+\d+/i.test(line.text || ""))) return false;
  const ys = text.map((line) => ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2);
  return Math.max(...ys) - Math.min(...ys) > 0.35 * pageH;
}

// A short band along the top or bottom edge is a header, not a plate.
function edgeBand(box, pageW, pageH) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const touchT = box.y0 <= 0.02 * pageH;
  const touchB = box.y1 >= pageH - 0.02 * pageH;
  const touchL = box.x0 <= 0.02 * pageW;
  const touchR = box.x1 >= pageW - 0.02 * pageW;
  if ((touchT || touchB) && h <= 0.2 * pageH && w <= 0.75 * pageW) return true;
  const cy = (box.y0 + box.y1) / 2;
  const side = (touchL || touchR) && h <= 0.22 * pageH && w <= 0.5 * pageW && (cy < 0.3 * pageH || cy > 0.7 * pageH);
  return side;
}

// A band on the mount beside the sheet, or a hairline along the top or bottom edge.
function marginStrip(box, pageW, pageH) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const touchL = box.x0 <= 0.02 * pageW;
  const touchR = box.x1 >= pageW - 0.02 * pageW;
  const touchT = box.y0 <= 0.02 * pageH;
  const touchB = box.y1 >= pageH - 0.02 * pageH;
  if ((touchL || touchR) && w <= 0.08 * pageW && h >= 0.25 * pageH) return true;
  if ((touchT || touchB) && h <= 0.06 * pageH && w >= 0.4 * pageW) return true;
  return false;
}

function numericToken(text) {
  const t = String(text || "").trim();
  return /\d/.test(t) && /^[\d.,%±+\-–−()]+$/.test(t);
}

// Body lines through the middle of a large box are a framed letter, not a plate.
// Eight numbers down the box are a table. Labels on a drawing ("PIER", "SPAN")
// are neither: a word is not a cell.
function textThroughMiddle(box, lines) {
  const h = box.y1 - box.y0;
  if (!(h > 0)) return false;
  const prose = (lines || []).filter((line) => wordCount(line.text) >= 2 && lineCenterIn(line, box));
  const numbers = (lines || []).filter((line) => numericToken(line.text) && lineCenterIn(line, box));
  // A numeric table is one token per cell. A caption is a line or two.
  const inside = prose.length >= 5 ? prose : numbers.length >= 8 ? numbers : [];
  if (inside.length < 5) return false;
  const mid = inside.filter((line) => {
    const c = (line.y0 + line.y1) / 2;
    return c > box.y0 + 0.2 * h && c < box.y1 - 0.2 * h;
  });
  const top = Math.min(...inside.map((line) => line.y0));
  const bot = Math.max(...inside.map((line) => line.y1));
  return mid.length >= 3 && bot - top > 0.45 * h;
}

// A short band that several lines run through is a table header or a caption
// strip. A plate is taller than that; labels drawn on it do not make it a header.
function headerBand(box, lines, pageH) {
  const h = box.y1 - box.y0;
  if (!(pageH > 0) || h > 0.22 * pageH || h < 8) return false;
  const inside = (lines || []).filter((line) => {
    const text = String(line.text || "").trim();
    if (!text || !lineCenterIn(line, box)) return false;
    // Formula labels sit on the drawing. They are not a table header.
    if (diagramLabel(text)) return false;
    return true;
  });
  return inside.length >= 4;
}

// Handwriting under a drawing is not part of the drawing. Cut it off when the
// upper part of the box is clear of text.
function clipLowerText(box, lines) {
  const h = box.y1 - box.y0;
  if (!(h > 0)) return box;
  const inside = (lines || []).filter((line) => wordCount(line.text) >= 2 && lineCenterIn(line, box));
  const low = inside.filter((line) => line.y0 > box.y0 + 0.55 * h);
  const high = inside.filter((line) => line.y0 <= box.y0 + 0.55 * h);
  if (low.length < 3 || high.length > 2) return box;
  const cut = Math.min(...low.map((line) => line.y0));
  if (cut - box.y0 < 0.28 * h) return box;
  return { ...box, y1: cut - 2 };
}

// The dark of a photograph stops inside the mount. Grow into the empty margin
// and stop at the first line, so the box is the picture and not the caption.
function growUntilText(box, lines, pageW, pageH) {
  const padX = 0.08 * pageW;
  const padY = 0.07 * pageH;
  const text = (lines || []).filter((line) => (line.text || "").trim());
  let { x0, y0, x1, y1 } = box;
  const overlapX = (line, a, b) => Math.min(b, line.x1) - Math.max(a, line.x0) > 8;
  const overlapY = (line, a, b) => Math.min(b, line.y1) - Math.max(a, line.y0) > 4;
  const above = text.filter((line) => line.y1 <= y0 + 1 && overlapX(line, x0, x1)).sort((a, b) => b.y1 - a.y1)[0];
  y0 = above ? Math.max(y0 - padY, above.y1 + 2) : Math.max(0, y0 - padY);
  const below = text.filter((line) => line.y0 >= y1 - 1 && overlapX(line, x0, x1)).sort((a, b) => a.y0 - b.y0)[0];
  y1 = below ? Math.min(y1 + padY, below.y0 - 2) : Math.min(pageH, y1 + padY);
  const left = text.filter((line) => line.x1 <= x0 + 1 && overlapY(line, y0, y1)).sort((a, b) => b.x1 - a.x1)[0];
  x0 = left ? Math.max(x0 - padX, left.x1 + 2) : Math.max(0, x0 - padX);
  const right = text.filter((line) => line.x0 >= x1 - 1 && overlapY(line, y0, y1)).sort((a, b) => a.x0 - b.x0)[0];
  x1 = right ? Math.min(x1 + padX, right.x0 - 2) : Math.min(pageW, x1 + padX);
  if (x1 - x0 < 16 || y1 - y0 < 16) return box;
  return { x0, y0, x1, y1 };
}

// Ink split by a hairline of white is one picture. A sentence in the gap is
// the caption between two pictures, so those stay apart.
function picturesTouch(a, b, lines, pageH) {
  const limit = Math.max(10, 0.02 * (pageH || 0));
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0);
  if (!(narrow > 0) || overlap < 0.55 * narrow) return false;
  const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const gap = yOverlap > 0 ? 0 : a.y1 <= b.y0 ? b.y0 - a.y1 : a.y0 - b.y1;
  if (gap > limit) return false;
  if (yOverlap <= 0) {
    const top = Math.min(a.y1, b.y1);
    const bot = Math.max(a.y0, b.y0);
    const between = (lines || []).some((line) => {
      if (wordCount(line.text) < 3) return false;
      const cy = ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2;
      if (cy <= top + 1 || cy >= bot - 1) return false;
      const ox = Math.min(line.x1, Math.max(a.x1, b.x1)) - Math.max(line.x0, Math.min(a.x0, b.x0));
      return ox > 8;
    });
    if (between) return false;
  }
  return true;
}

function mergeTouchingPictures(made, lines, pageH) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < made.length; i++) {
      for (let j = i + 1; j < made.length; j++) {
        const a = made[i];
        const b = made[j];
        if (!picturesTouch(a, b, lines, pageH)) continue;
        made[i] = {
          x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
          x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
        };
        made.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
}

function diagramBand(box, lines) {
  let n = 0;
  for (const line of lines || []) {
    if (diagramLabel(line.text) && lineCenterIn(line, box)) n += 1;
  }
  return n >= 3;
}

// An engraving set into a two-column page. The ink is the picture; the columns
// flank it. The box the page uses is the text measure, not the dark core.
function widenBetweenColumns(box, lines, pageW, pageH) {
  const h = box.y1 - box.y0;
  const pageArea = pageW * pageH;
  if (h < 0.18 * pageH || boxArea(box) < 0.08 * pageArea) return null;
  const flank = (lines || []).filter((line) => {
    if (wordCount(line.text) < 3) return false;
    const cy = ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2;
    if (cy < box.y0 + 0.08 * h || cy > box.y1 - 0.05 * h) return false;
    const cx = ((line.x0 ?? 0) + (line.x1 ?? 0)) / 2;
    const lw = (line.x1 ?? 0) - (line.x0 ?? 0);
    if (lw > 0.45 * pageW) return false;
    return cx < box.x0 || cx > box.x1;
  });
  const left = flank.filter((line) => ((line.x0 + line.x1) / 2) < box.x0);
  const right = flank.filter((line) => ((line.x0 + line.x1) / 2) > box.x1);
  if (left.length < 4 || right.length < 4) return null;
  const x0 = Math.min(...left.map((line) => line.x0), ...right.map((line) => line.x0));
  const x1 = Math.max(...left.map((line) => line.x1), ...right.map((line) => line.x1));
  if (!(x1 > x0) || x1 - x0 < (box.x1 - box.x0) + 24) return null;
  return { x0: Math.max(0, x0), y0: box.y0, x1: Math.min(pageW, x1), y1: box.y1 };
}

// Hatching is many small strokes, none of them a photograph on its own.
// A column of text beside that field is the caption side, not the drawing.
function hatchPicture(boxes, lines, pageW, pageH) {
  const pageArea = pageW * pageH;
  if (!(pageArea > 0) || boxes.some((b) => boxArea(b) >= 0.018 * pageArea)) return null;
  const small = boxes.filter((b) => boxArea(b) >= 40 && boxArea(b) < 0.018 * pageArea);
  if (small.length < 30) return null;
  const narrow = (lines || []).filter((line) => {
    const w = (line.x1 ?? 0) - (line.x0 ?? 0);
    return w > 8 && w < 0.42 * pageW && wordCount(line.text) >= 1;
  });
  const column = (pred) => {
    const col = narrow.filter(pred);
    if (col.length < 8) return null;
    const ys = col.map((line) => ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2);
    if (Math.max(...ys) - Math.min(...ys) < 0.3 * pageH) return null;
    return col;
  };
  const right = column((line) => line.x0 > 0.52 * pageW);
  const left = column((line) => line.x1 < 0.48 * pageW);
  const side = right && (!left || right.length >= left.length) ? "right" : left ? "left" : null;
  const col = side === "right" ? right : left;
  if (!col) return null;
  const cut = side === "right" ? Math.min(...col.map((line) => line.x0)) : Math.max(...col.map((line) => line.x1));
  const keep = small.filter((b) => {
    const cx = (b.x0 + b.x1) / 2;
    return side === "right" ? cx < cut - 4 : cx > cut + 4;
  });
  if (keep.length < 20) return null;
  const box = {
    x0: Math.min(...keep.map((b) => b.x0)),
    y0: Math.min(...keep.map((b) => b.y0)),
    x1: Math.max(...keep.map((b) => b.x1)),
    y1: Math.max(...keep.map((b) => b.y1)),
  };
  if (side === "right") box.x1 = Math.min(box.x1, cut - 4);
  else box.x0 = Math.max(box.x0, cut + 4);
  if (box.x1 - box.x0 < 0.25 * pageW || box.y1 - box.y0 < 0.4 * pageH) return null;
  if (boxArea(box) < 0.3 * pageArea) return null;
  if (textThroughMiddle(box, lines) || headerBand(box, lines, pageH)) return null;
  if (marginStrip(box, pageW, pageH) || edgeBand(box, pageW, pageH)) return null;
  const h = box.y1 - box.y0;
  const mid = (lines || []).filter((line) => {
    if (wordCount(line.text) < 2 || !lineCenterIn(line, box)) return false;
    const cy = ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2;
    return cy > box.y0 + 0.2 * h && cy < box.y1 - 0.2 * h;
  });
  if (mid.length > 3) return null;
  return box;
}

// One ink component that is a photograph, an engraving, or a compact mark
// (a seal, a logo). Coordinates stay in the page frame the truth uses: a
// photo of a sheet is not cropped to the sheet before the box is stored.
function pictureRegions(figures, inkBoxes, lines, pageW, pageH, textLines = null) {
  const pageArea = pageW * pageH;
  if (!(pageArea > 0)) return;
  const boxes = [...(inkBoxes || [])].sort((a, b) => boxArea(b) - boxArea(a));
  const made = [];
  // A rule cluster on the photograph is not the photograph, and the page image
  // is the photograph. A plate or a chart that already contains the ink blocks it.
  const covers = (outer, box) => {
    if (outer.pageImage || outer.fromPicture) return false;
    const bigDrawing = outer.kind === "drawing" && boxArea(outer) >= 0.15 * pageArea;
    if (!(outer.fromPlate || outer.kind === "image" || bigDrawing)) return false;
    if (insideFrac(box, outer) >= 0.4) return true;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    return cx > outer.x0 && cx < outer.x1 && cy > outer.y0 && cy < outer.y1;
  };
  const covered = (box) => figures.some((f) => covers(f, box)) || made.some((f) => insideFrac(box, f) >= 0.55 || insideFrac(f, box) >= 0.55);
  // A rule cluster on a text page is dropped later. Ink it hides is still the
  // rest of a plate when that ink touches a picture the cluster did not cover.
  const onlyCluster = (box) => figures.some((f) => !f.fromPlate && !f.pageImage && f.kind === "drawing" && covers(f, box))
    && !figures.some((f) => (f.fromPlate || f.kind === "image" || f.pageImage) && covers(f, box));
  const pending = [];
  const spread = letterSpread(lines, pageH);
  for (const raw of boxes) {
    let area = boxArea(raw);
    if (area < 0.018 * pageArea) continue;
    let box = { x0: raw.x0, y0: raw.y0, x1: raw.x1, y1: raw.y1 };
    if (area > 0.78 * pageArea) {
      const clipped = clipLowerText(box, lines);
      if (!(boxArea(clipped) < area - 1) || boxArea(clipped) > 0.78 * pageArea) continue;
      box = clipped;
      area = boxArea(box);
    }
    if (marginStrip(box, pageW, pageH)) continue;
    box = clipLowerText(box, lines);
    // A table's rules are one ink blob. Its words may already belong to the
    // table, so they are missing from `lines`; the full page text still shows them.
    const pageLines = textLines || lines;
    if (textThroughMiddle(box, pageLines)) continue;
    if (textBlockBox(box, lines)) continue;
    const grown = growUntilText(box, lines, pageW, pageH);
    box = boxArea(grown) > 0.85 * pageArea ? box : grown;
    if (edgeBand(box, pageW, pageH)) continue;
    if (textThroughMiddle(box, pageLines) || headerBand(box, pageLines, pageH)) continue;
    if (boxArea(box) > 0.85 * pageArea) continue;
    if (covered(box)) {
      if (onlyCluster(box)) pending.push(box);
      continue;
    }
    made.push(box);
  }
  // Several ink blobs of one size on a letter are the handwriting. Joining
  // them across a hairline would hide that, so the check is before the join.
  if (spread && made.length >= 3) {
    const areas = made.map((b) => boxArea(b)).sort((a, b) => b - a);
    if (areas[0] < 2 * areas[1]) made.length = 0;
  }
  // Only a picture that would stand on its own may pull the hidden ink out.
  // Gluing it onto a speck would turn the speck into a figure.
  for (const box of pending) {
    if (made.some((other) => boxArea(other) >= 0.08 * pageArea && picturesTouch(other, box, lines, pageH))) {
      made.push(box);
      continue;
    }
    // A rule cluster on the text is not the engraving it covers. The ink
    // between the two columns is the plate; the columns set its width.
    const wide = widenBetweenColumns(box, lines, pageW, pageH);
    if (wide) made.push(wide);
  }
  // A white band inside one drawing splits the ink. Two photographs with a
  // line of text between them stay apart.
  mergeTouchingPictures(made, lines, pageH);
  // Several ink blobs of one size on a letter are the handwriting, not a row of plates.
  // Two photographs on a notebook stay: there is no third, or one plate is clearly larger.
  if (spread && made.length >= 3) {
    const areas = made.map((b) => boxArea(b)).sort((a, b) => b - a);
    if (areas[0] < 2 * areas[1]) made.length = 0;
  }
  if (spread) {
    const max = made.length ? Math.max(...made.map((b) => boxArea(b))) : 0;
    for (let i = made.length - 1; i >= 0; i--) {
      const a = boxArea(made[i]);
      // Handwriting on a letter stays smaller than a pasted photograph.
      // A block diagram is one ink region with formula labels on it, and it
      // is smaller than a pasted photograph.
      if (a < 0.08 * pageArea && !diagramBand(made[i], lines) && (made.length === 1 || a < 0.35 * max)) made.splice(i, 1);
    }
  }
  const emblems = [];
  for (const raw of boxes) {
    const w = raw.x1 - raw.x0;
    const h = raw.y1 - raw.y0;
    const area = w * h;
    if (area < 0.012 * pageArea || area >= 0.018 * pageArea) continue;
    const aspect = h > 0 ? w / h : 0;
    if (aspect < 0.45 || aspect > 2.3) continue;
    const box = { x0: raw.x0, y0: raw.y0, x1: raw.x1, y1: raw.y1 };
    if (marginStrip(box, pageW, pageH)) continue;
    const cx = (raw.x0 + raw.x1) / 2;
    const cy = (raw.y0 + raw.y1) / 2;
    if ((cx <= 0.14 * pageW || cx >= 0.86 * pageW) && (cy <= 0.14 * pageH || cy >= 0.86 * pageH)) continue;
    if ((lines || []).some((line) => wordCount(line.text) >= 2 && lineCenterIn(line, box))) continue;
    if (covered(box)) continue;
    emblems.push(box);
  }
  // A letter carries several small marks that are handwriting. A short page can
  // carry one seal. A title page is headings in capitals and one seal, not a letter.
  // A page of body text does not grow a logo out of one of them.
  const proseN = (lines || []).filter((line) => proseLine(line)).length;
  const capsN = (lines || []).filter((line) => {
    const letters = String(line.text || "").replace(/[^A-Za-z]/g, "");
    return letters.length >= 4 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.7;
  }).length;
  if (!spread || (emblems.length === 1 && proseN < 2 && capsN >= 3)) made.push(...emblems);
  if (!made.length) {
    const hatched = hatchPicture(boxes, lines, pageW, pageH);
    if (hatched) made.push(hatched);
  }
  for (const box of made) {
    figures.push({ ...box, kind: "drawing", count: 1, pageImage: false, fromPlate: true, fromPicture: true });
  }
}

// A steel "plate 14 inches" is not Plate 14. "Figure 1 is a side elevation" and
// "Figure 2 herewith." point at a drawing; they are not the caption under it.
function plateLabelText(text, key) {
  if (key == null) return false;
  const t = normalizeFigSpelling(text).replace(/\s+/g, " ").trim();
  // A contents entry ("FIGURE 1. …… 7") names a plate on another page.
  if (/\.{4,}|…{2,}|·{4,}/.test(t)) return false;
  if (/^plates?\s+\d+[A-Za-z]?\s+(?:inches?|mm|cm|ft|feet|thick)\b/i.test(t)) return false;
  const words = t.split(" ");
  if (key === "" && words.length > 2) return false;
  // "Sketch (k)" names a drawing inside a photograph. It is not a plate label
  // that should hull every stroke on the page.
  if (/^sketch(?:es)?\b/i.test(t)) return false;
  const rest = t.replace(/^(?:fig(?:ure)?s?|plates?)\.?\s*\d+[A-Za-z]?[.:]?\s*/i, "");
  if (/^(?:is|are|was|were|shows|show|comprises|has|have)\b/i.test(rest)) return false;
  if (/^(?:and|or|&|und|et)$/i.test(rest.trim())) return false;
  if (/^(?:herewith|above|below|following|opposite)[.]?$/i.test(rest)) return false;
  return true;
}

// Caption lines that name one figure. A "Figs. 5 & 6" range is not one of them.
function titleLikePlateLine(text) {
  const t = normalizeFigSpelling(String(text || "")).replace(/\s+/g, " ").trim();
  if (!t || /\.{4,}|…{2,}|·{4,}/.test(t)) return false;
  const words = t.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 28) return false;
  if (/^(?:table|tabelle|tab)\b/i.test(t) && !/^taf/i.test(t)) return false;
  if (figCaptionKey(t) != null) return false;
  // "flat plates fastened…" is a sentence. The label itself starts the line.
  if (/^(?:plates?|tafeln?|tafel|taf\.?|abb(?:ildung)?)\b/i.test(t)) return true;
  if (words.length < 4) return false;
  // A running head carries the page number at one end, or the word Continued.
  // "420 CALIFORNIA BLUE BOOK" and "… COMMISSIONS. 421" name the page, not the plate.
  const edgeNum = (w) => /^\d{1,4}[.]?$/.test(w);
  if (edgeNum(words[0]) || edgeNum(words[words.length - 1])) return false;
  if (/\bcontinued\b/i.test(t)) return false;
  // "COMMISSION, STATE. 1913-1924" is a term of office, not the title of a plate.
  if (/\b\d{4}\s*[-–—]\s*\d{2,4}\b/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return false;
  return letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.62;
}

// The ink is one plate and the only label is a title under or over it.
function plateTitleCaptions(lines, ink, pageW, pageH) {
  if (!ink || ink.length < 4) return [];
  const hull = hullOf(ink);
  if (!hull) return [];
  const area = (hull.x1 - hull.x0) * (hull.y1 - hull.y0);
  if (area < 0.04 * pageW * pageH) return [];
  // A heading over a paragraph is not a plate, even when the paragraph's rules look like ink.
  const paragraph = lines.some((line) => proseLine(line) && lineCenterIn(line, hull)
    && Math.min(line.x1, hull.x1) - Math.max(line.x0, hull.x0) > 0.5 * (hull.x1 - hull.x0));
  if (paragraph) return [];
  const limit = Math.max(48, 0.08 * pageH);
  const out = [];
  for (const line of lines) {
    if (!titleLikePlateLine(line.text)) continue;
    const below = line.y0 >= hull.y1 - 2;
    const above = line.y1 <= hull.y0 + 2;
    const gap = below ? line.y0 - hull.y1 : above ? hull.y0 - line.y1 : 0;
    if (!below && !above) continue;
    // An all-caps line above a small drawing is a heading. Above a plate that fills
    // the page, with no body column, it is the plate title. Plate / Tafel / Abb. may sit on either side.
    const plateWord = /\b(?:plates?|tafeln?|tafel|abb(?:ildung)?)\b/i.test(normalizeFigSpelling(line.text));
    const proseN = lines.filter((l) => proseLine(l)).length;
    if (!plateWord && !below && (proseN >= 2 || area < 0.18 * pageW * pageH)) continue;
    if (gap > limit) continue;
    const ox = Math.min(hull.x1, line.x1) - Math.max(hull.x0, line.x0);
    const narrower = Math.min(hull.x1 - hull.x0, Math.max(1, line.x1 - line.x0));
    if (ox < 0.35 * narrower) continue;
    out.push({ ...line, key: "title", text: normalizeFigSpelling(line.text) });
  }
  out.sort((a, b) => a.y0 - b.y0);
  return out.slice(0, 1);
}

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

// Words of one caption, stopping at the next label or at a column gutter.
function captionSlice(words, start, end) {
  const slice = [];
  for (let i = start; i < end; i++) {
    if (slice.length) {
      const prev = String(words[i - 1].text || "").trim();
      const gap = words[i].x0 - words[i - 1].x1;
      if (gap >= CAPTION_SPLIT_GAP && !FIG_TOKEN.test(prev) && !/^[.:]$/.test(prev)) break;
    }
    slice.push(words[i]);
  }
  return slice;
}

// One line can carry two numbered captions ("FIGURE 1.—… FIGURE 2.—…") plus the
// body column. Each lead becomes its own caption so the drawings stay apart.
function anchorCaptions(lines) {
  const out = [];
  for (const line of lines || []) {
    const words = line.words || [];
    const starts = labelStarts(words);
    if (starts.length < 2) continue;
    const prefix = words.slice(0, starts[0]);
    if (wordCount(prefix.map((w) => w.text).join(" ")) > 3) continue;
    if (prefix.some((w) => /[.!?]/.test(String(w.text || "")))) continue;
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : words.length;
      const slice = captionSlice(words, starts[i], end);
      if (slice.length < 2) continue;
      const text = normalizeFigSpelling(slice.map((w) => w.text).join(" "));
      const key = figCaptionKey(text);
      if (key == null || key === "" || !plateLabelText(text, key)) continue;
      out.push({ ...makeLine(slice), key, text });
    }
  }
  const keys = new Set(out.map((c) => c.key));
  return keys.size >= 2 ? out : [];
}

function withAnchorCaptions(caps, lines) {
  const anchors = anchorCaptions(lines);
  if (anchors.length < 2) return caps;
  const kept = (caps || []).filter((c) => !anchors.some((a) => Math.abs((a.y0 ?? 0) - (c.y0 ?? 0)) < 4 && a.x0 >= c.x0 - 2 && a.x1 <= c.x1 + 4));
  return [...kept, ...anchors];
}

// Two numbered captions on one baseline name two drawings. Cut the ink just left of
// each later label. A caption stacked above or below is a different plate.
function sideBySideCaptions(caps) {
  const ordered = [];
  const seen = new Set();
  for (const c of [...(caps || [])].filter((c) => c.key !== "" && c.key !== "title").sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    ordered.push(c);
  }
  if (ordered.length < 2) return null;
  const y0 = Math.min(...ordered.map((c) => c.y0));
  const y1 = Math.max(...ordered.map((c) => c.y1));
  const share = ordered.every((c) => {
    const h = Math.max(6, c.y1 - c.y0);
    return Math.min(c.y1, y1) - Math.max(c.y0, y0) >= 0.45 * h && Math.abs(c.y0 - ordered[0].y0) <= Math.max(h, 14);
  });
  if (!share) return null;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].x0 - ordered[i - 1].x0 < 36) return null;
  }
  return ordered;
}

function splitSideBySidePlates(figures, ink, caps, lines, bodySize, pageW, pageH) {
  const cols = sideBySideCaptions(caps);
  if (!cols) return false;
  const numbered = new Set(caps.filter((c) => c.key !== "" && c.key !== "title").map((c) => c.key));
  if (numbered.size !== cols.length) return false;
  const cuts = cols.slice(1).map((c) => c.x0 - 4);
  const groups = new Map(cols.map((c) => [c.key, []]));
  for (const prim of ink) {
    const cx = (prim.x0 + prim.x1) / 2;
    let i = 0;
    while (i < cuts.length && cx >= cuts[i]) i++;
    const left = i === 0 ? -1e9 : cuts[i - 1];
    const right = i < cuts.length ? cuts[i] : 1e9;
    const x0 = Math.max(prim.x0, left === -1e9 ? prim.x0 : left);
    const x1 = Math.min(prim.x1, right === 1e9 ? prim.x1 : right);
    if (x1 - x0 < 2) continue;
    const ph = prim.y1 - prim.y0;
    const pw = prim.x1 - prim.x0;
    if (ph <= 4 && pw > 40 && x1 - x0 < 0.85 * pw) continue;
    groups.get(cols[i].key).push({ ...prim, x0, x1 });
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
    const cap = cols.find((c) => c.key === key) || null;
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
  ink = ink.filter((p) => {
    if (p.kind !== "rule") return true;
    const thin = (p.y1 - p.y0) <= 4 || (p.x1 - p.x0) <= 4;
    return !thin || !overlapsBodyLine(p, lines);
  });
  const inkOnly = ink.filter((p) => p.kind === "ink");
  if (inkOnly.length) {
    const stray = new Set(isolatedInk(inkOnly, pageW, pageH));
    if (stray.size) ink = ink.filter((p) => !stray.has(p));
    const mass = ink.filter((p) => p.kind === "ink");
    if (!mass.length) return;
    const drawn = hullOf(mass);
    const padX = Math.max(36, 0.06 * pageW);
    const padY = Math.max(18, 0.04 * pageH);
    const near = ink.filter((p) => p.kind === "ink" || (p.x1 >= drawn.x0 - padX && p.x0 <= drawn.x1 + padX && p.y1 >= drawn.y0 - padY && p.y0 <= drawn.y1 + padY));
    if (near.length >= 4) ink = near;
  }
  if (ink.length < 4) return;
  let caps = withAnchorCaptions(plateCaptions(lines, pageH), lines);
  // A plate title (PLATE I, TAFEL, an all-caps line on the drawing) is the caption
  // when the page has no Fig. line. A heading far from the ink is not one.
  if (!caps.length) caps = plateTitleCaptions(lines, inkOnly, pageW, pageH);
  if (!caps.length) return;
  // Band cuts need raster ink. Rule fragments alone hull too tight (accelerometer
  // helper Fig. 2) and the nearest-caption path is the one that matched before.
  if (inkOnly.length && splitSideBySidePlates(figures, ink, caps, lines, bodySize, pageW, pageH)) {
    dropCoveredDrawings(figures);
    return;
  }
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
