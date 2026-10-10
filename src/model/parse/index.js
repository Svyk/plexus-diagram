// Built-in PDF parse engine: page data from pdf.js -> pxd-parse/1 document. Pure except for
// the yield between pages. `getPage(n)` returns { items, ops, w, h, rotation, transform, fonts }.

import { buildLines, dominantRotation, lineBox, makeLine, mul, round } from "./lines.js";
import { extractGraphics, luminanceOf } from "./rules.js";
import { chartGrid, findLatticeTables, looksLikeChart } from "./lattice.js";
import { baselineRows, detectStreamRuns, proseColumnTable, tableFromBand } from "./stream.js";
import { demoteFalseCaptions, drawingSheetPage, figCaptionKey, findFigures, imageCover, normalizeFigSpelling, peelFigLabels, rasterScanPage, rejectFalseFigures, sheetRegions, splitSharedCaptions } from "./figures.js";
import { dropMarginRotated, findFurniture, normalizeFurniture } from "./furniture.js";
import { findPageTitle } from "./title.js";
import { applyNumbering, bodySizeOf, CAPTION_RE, headingClasses, headingLevel, refineBodyHeadingLevels } from "./headings.js";
import { detectLists } from "./lists.js";
import { detectFormulas } from "./formulas.js";
import { FOOTNOTE_MARK_RE, groupParagraphs, inlineUnlinkedRefs, joinLines, spansOf } from "./blocks.js";
import { boxOfUnits, crossesGutter, detectColumns, orderUnits, ruleCuts, splitAtGutters } from "./xycut.js";
import { normalizeStreamPiece, repairOcrTable, repairTableReading } from "./ocr-fix.js";
import { lowConfidenceShare } from "./ocr-vote.js";
import { capTitle, isCutPrefix, isGibberishTitle, isJunkTitleText, isMetaBanner } from "../title-cap.js";
import { cleanPdfTitle } from "../pdf.js";

export const SCHEMA = "pxd-parse/1";
export const ENGINE_VERSION = "plexus-builtin/1";
// Revision of the built-in engine's output. Bump whenever parse output changes: cached built-in
// parses with an older (or no) parseRev are re-parsed instead of restored.
export const PARSE_REV = 32;

// A footnote mark on its own (asterisk-like signs, a number, a letter).
const MARK_ONLY_RE = /^([*†‡§¶⁎∗]{1,3}|\d{1,3}|[a-z])$/u;

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

// Axis ticks ("-4 -3") sometimes sit on the caption line, in front of FIG.
function peelTickPrefix(text) {
  return String(text || "").replace(/^(?:[-+]?\d+\s+){1,6}(?=(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\b)/i, "");
}

// "con-" at the end of a caption line is the first half of a word on the next line.
function peelHyphenTail(text) {
  return String(text || "").replace(/\s+\S+-$/, "");
}

const NEXT_SENTENCE_RE = /^(?:The|This|A|An|It|These|Those|For|See)\b/;

// A caption line may carry a missing-glyph number ("Figure" plus a private-use char).
function isCaptionText(text) {
  const raw = peelTickPrefix(normalizeFigSpelling(String(text || "").replace(/[^\p{L}\p{N}.: ]/gu, " ").replace(/\s+/g, " ").trim()));
  if (/^plates?\s+\d+[A-Za-z]?\s+(?:inches?|mm|cm|ft|feet|thick)\b/i.test(raw)) return false;
  return CAPTION_RE.test(raw) || figCaptionKey(raw) != null || /^(?:fig(?:ure)?s?|plates?|abb(?:ildung(?:en)?)?|tafeln?|tafel|taf)\.?\s*$/i.test(raw) || /^\d+[A-Za-z]?(?:[.\s]+)\s*(?:fig(?:ure)?|plates?|abb(?:ildung)?|tafel|taf)\.?$/i.test(raw);
}

function yieldTick() {
  return new Promise((resolve) => (typeof setTimeout === "function" ? setTimeout(resolve, 0) : resolve()));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const err = new Error("parse aborted");
    err.name = "AbortError";
    throw err;
  }
}

export function viewportTransform(w, h, rotation = 0) {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return [0, 1, 1, 0, 0, 0];
    case 180: return [-1, 0, 0, 1, w, 0];
    case 270: return [0, -1, -1, 0, h, w];
    default: return [1, 0, 0, -1, 0, h];
  }
}

// Pass 1 for one page: geometry only.
function figureBounds(fig) {
  const b = fig?.bbox || fig;
  if (Array.isArray(b)) return b;
  if (!b) return null;
  return [b.x0, b.y0, b.x1, b.y1];
}

function wordCenter(word) {
  const cx = ((word.x0 ?? 0) + (word.x1 ?? 0)) / 2;
  const cy = word.y0 != null && word.y1 != null
    ? (word.y0 + word.y1) / 2
    : (word.base ?? 0) - 0.3 * (word.size || 8);
  return [cx, cy];
}

// Grow-and-drop claims a word, then throws the figure away (a rule cluster on a
// menu, a plate that shrinks to the picture). The word stays marked used and the
// line never becomes text. A word whose centre is still inside a figure that
// survived belongs to that figure.
function releaseOrphanFigureWords(used, figureWords, figures, tables) {
  // A page that already has a table keeps claimed labels. Releasing them shifts
  // the columns of a stream table on the same page (a ruled numeric page).
  if ((tables || []).length) return;
  for (const word of figureWords) {
    const [cx, cy] = wordCenter(word);
    const inside = (figures || []).some((fig) => {
      const box = figureBounds(fig);
      if (!box) return false;
      return cx >= box[0] - 2 && cx <= box[2] + 2 && cy >= box[1] - 2 && cy <= box[3] + 2;
    });
    if (!inside) used.delete(word);
  }
}

export function parsePageGeometry(data, n) {
  const t0 = now();
  let w = data.w; let h = data.h;
  let transform = data.transform || viewportTransform(w, h, data.rotation || 0);
  let { lines, rotated } = buildLines(data.items || [], { transform, fonts: data.fonts || {} });
  // A landscape table set sideways on the page (text matrices rotated by 90 degrees): read the
  // page in the text's own frame. Geometry below is then in that frame; `textRotation` says so.
  const textRotation = dominantRotation(rotated, lines);
  if (textRotation) {
    const rad = (-textRotation * Math.PI) / 180;
    const rot = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
    const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => [rot[0] * x + rot[2] * y, rot[1] * x + rot[3] * y]);
    const minX = Math.min(...corners.map((c) => c[0])); const minY = Math.min(...corners.map((c) => c[1]));
    const maxX = Math.max(...corners.map((c) => c[0])); const maxY = Math.max(...corners.map((c) => c[1]));
    transform = mul([rot[0], rot[1], rot[2], rot[3], -minX, -minY], transform);
    w = maxX - minX; h = maxY - minY;
    ({ lines, rotated } = buildLines(data.items || [], { transform, fonts: data.fonts || {} }));
  }
  const ocr = Boolean(data.scan && Array.isArray(data.rules));
  if (ocr) {
    data = { ...data, items: (data.items || []).filter((it) => !/^[.·•]+$/.test(it.str || "")) };
    ({ lines, rotated } = buildLines(data.items, { transform, fonts: data.fonts || {} }));
  }
  // Sideways running titles in the margin are furniture. Drop them before tables
  // and headings see the lines. A page whose text is itself sideways was already
  // re-read in that frame above, so its body lines are upright and stay.
  const margin = dropMarginRotated(lines, rotated, { w, h });
  lines = margin.lines;
  const marginRotated = margin.removed;
  const graphics = ocr ? ocrGraphics(data, w, h) : extractGraphics(data.ops, { transform });
  const words = lines.flatMap((l) => l.words);
  const pageArea = w * h;
  const imageArea = (im) => (im.x1 - im.x0) * (im.y1 - im.y0);
  const textChars = words.reduce((n, wd) => n + (wd.text || "").length, 0);
  // Tiled scans (many images, no text, no vectors) are the same kind of page as one big image.
  const scanRaster = rasterScanPage({ images: graphics.images, shapes: graphics.shapes, words, pageW: w, pageH: h });
  // A fold-out plotted as horizontal strips (each the full width, none the page) is one scan.
  const strips = stripTiles(graphics.images, w, h, textChars);
  const bigImage = scanRaster || strips.length > 0 || graphics.images.some((im) => imageArea(im) >= 0.5 * pageArea);
  // A page-sized image under a text layer is a scan with OCR text: the text is parsed as on
  // any page and the image is the background, not a figure. A drawing sheet keeps that image
  // as the figure (decided after tables) and still reports scanLayer so OCR routing is unchanged.
  const scanLayer = words.length > 0 && (strips.length > 0 || graphics.images.some((im) => imageArea(im) >= 0.85 * pageArea));
  const kind = words.length === 0 && bigImage ? "scan" : bigImage ? "mixed" : "text";
  const pageBody = bodySizeOf(lines) || 10;
  const used = new Set();
  const tables = [];
  const lattice = findLatticeTables({ rules: graphics.rules, boxes: graphics.boxes, words });
  const released = new Set(lattice.released);
  for (const t of lattice.tables) { if (isTitledBox(t)) continue; t.page = n; tables.push(t); }
  for (const w of lattice.usedWords) if (!released.has(w)) used.add(w);
  const usedRules = new Set(lattice.usedRules);
  for (const band of lattice.bands) {
    if (looksLikeChart(band, graphics)) continue;
    const free = words.filter((w) => !used.has(w));
    const t = tableFromBand(band, free);
    if (!t || isTitledBox(t) || chartGrid(t)) continue;
    // A ruled band of names is the same false table as a stream of names.
    if (ocr && proseColumnTable(t)) continue;
    t.page = n;
    for (const w of t.usedWords) used.add(w);
    delete t.usedWords;
    for (const s of band.segs) usedRules.add(s);
    tables.push(t);
  }
  const drawing = drawingSheetPage({ images: graphics.images, lines, tables, shapes: graphics.shapes, pageW: w, pageH: h, textChars });
  if (drawing) lines = peelFigLabels(lines);
  const figWords = lines.flatMap((l) => l.words);
  const stripSet = new Set(strips);
  const figGraphics = scanLayer && !drawing ? { ...graphics, images: graphics.images.filter((im) => !stripSet.has(im) && imageArea(im) < 0.85 * pageArea) } : graphics;
  const figs = kind === "scan" ? { figures: [], used: new Set() } : findFigures({ graphics: figGraphics, usedRules, usedBoxes: lattice.usedBoxes, words: figWords.filter((wd) => !used.has(wd)), bodySize: pageBody, pageW: w, pageH: h, ruleSegments: lattice.segments, pageTextChars: textChars, plates: ocr, textLines: lines });
  const figureWords = figs.used;
  for (const wd of figureWords) used.add(wd);
  let figures = figs.figures.map((f) => ({ ...f, page: n }));
  // A plate found from the ink already covers the drawing. The full-page sheet
  // split is for a patent page, not for that plate.
  const plated = ocr && figures.some((f) => f.fromPlate && boxArea(f.bbox || f) >= 0.08 * pageArea && boxArea(f.bbox || f) <= 0.9 * pageArea);
  // The page image is the scan background once a plate already covers the drawing.
  if (plated) figures = figures.filter((f) => f.fromPlate || boxArea(f.bbox || f) < 0.75 * pageArea);
  // A picture found inside an unlabelled photograph is the figure. A patent sheet
  // still uses the page image: a numbered Fig. or "Sheet N of M" names that sheet.
  const pictureBoxes = figures.filter((f) => f.fromPicture);
  const biggestPicture = pictureBoxes.length ? Math.max(...pictureBoxes.map((f) => boxArea(f.bbox || f))) : 0;
  const textN = lines.filter((line) => (line.text || "").trim()).length;
  // A dark patch on a short plate page is not a reason to throw away the page image.
  const plateFragment = biggestPicture >= 0.2 * pageArea && biggestPicture < 0.5 * pageArea && textN <= 6 && pictureBoxes.length === 1;
  const pictureOnly = pictureBoxes.length > 0 && !sheetNamed(lines) && !plateFragment;
  if (drawing && (plateFragment || sheetNamed(lines) || (!plated && !pictureOnly))) {
    const regions = sheetRegions(lines, w, h);
    if (regions.length) {
      figures = regions.map((r) => ({
        bbox: [round(r.x0), round(r.y0), round(r.x1), round(r.y1)],
        kind: "image",
        count: 1,
        page: n,
      }));
    }
  }
  if (ocr) absorbFigureTables(tables, figures);
  // The page image is the photograph once a picture was found inside it.
  // A plate whose only text is a caption keeps the page image when the ink is
  // only a dark part of that plate. A picture inside a table is the table's ink.
  if (figures.some((f) => f.fromPicture)) {
    const textN = lines.filter((line) => (line.text || "").trim()).length;
    const biggest = Math.max(...figures.filter((f) => f.fromPicture).map((f) => boxArea(f.bbox || f)));
    const pageSized = figures.some((f) => !f.fromPicture && boxArea(f.bbox || f) >= 0.75 * pageArea);
    // A dark patch of a full-page plate is not a better box than the plate.
    // A seal on a short letter is smaller than that patch, and it is the figure.
    const fragment = pageSized && textN <= 6 && biggest >= 0.2 * pageArea && biggest < 0.5 * pageArea;
    if (fragment) figures = figures.filter((f) => !f.fromPicture);
    else figures = figures.filter((f) => f.fromPicture || boxArea(f.bbox || f) < 0.75 * pageArea);
  }
  figures = figures.filter((f) => !f.fromPicture || !tables.some((t) => t.bbox && insideFrac(f.bbox, t.bbox) >= 0.5));
  // A short plate keeps its page image. A letter with lines down the page does not.
  if (!plateFragment) figures = dropSpreadPhoto(figures, lines, w, h);
  figures = rejectFalseFigures(figures, {
    lines, tables, pageW: w, pageH: h,
    strokes: [
      ...(graphics.ink || []).map((b) => ({ ...b, kind: "ink" })),
      ...(graphics.shapes || []).map((s) => ({ ...s, kind: "shape" })),
      ...(graphics.rules || []).map((r) => ({ ...r, kind: "rule" })),
    ],
  });
  // Rule bands beside a chart that only hold its labels go back to the text pass.
  for (let i = tables.length - 1; i >= 0; i--) {
    const t = tables[i];
    if (t.method !== "stream" || (!figureLabels(t, figures) && !sparseContentsTable(t))) continue;
    tables.splice(i, 1);
    for (const w of words) if (used.has(w) && !figs.used.has(w) && w.x0 >= t.bbox[0] - 2 && w.x1 <= t.bbox[2] + 2 && w.base >= t.bbox[1] && w.base <= t.bbox[3] + 2) used.delete(w);
  }
  releaseOrphanFigureWords(used, figureWords, figures, tables);
  return { n, w, h, rotation: data.rotation || 0, textRotation, kind, scanLayer, ocr, lines, rotated, marginRotated, words: figWords, graphics, tables, figures, used, ms: round(now() - t0) };
}

// An OCR page record (helper /v1/ocr): precomputed `rules` segments stand in for the pdf.js
// operator list, and the page is one background image.
// A fold-out drawn as horizontal image strips: each one spans the page and is only a band of it.
function stripTiles(images, pageW, pageH, textChars) {
  // A text page painted in bands (a journal PDF) is not a fold-out. Fold-outs carry a short caption.
  if (textChars >= 400) return [];
  const strips = (images || []).filter((im) => {
    const width = im.x1 - im.x0;
    const height = im.y1 - im.y0;
    return width >= 0.8 * pageW && height >= 8 && height <= 0.28 * pageH;
  });
  if (strips.length < 4 || imageCover(strips, pageW, pageH) < 0.75) return [];
  return strips;
}

export function ocrGraphics(data, w, h) {
  const rules = [];
  const dots = [];
  // Leader dots read as text ("..", ". .") are dots, not words.
  for (const it of data.items || []) {
    if (!/^[.·•]+$/.test(it.str || "")) continue;
    const size = it.transform[0];
    const n = it.str.length;
    for (let i = 0; i < n; i++) dots.push({ x: it.transform[4] + (it.width || size) * (i + 0.5) / n, y: it.transform[5] - 0.05 * size, r: 0.4 });
  }
  for (const r of data.rules || []) {
    const horizontal = Math.abs(r.x1 - r.x0) >= Math.abs(r.y1 - r.y0);
    const thick = r.thick || 0.5;
    if (horizontal) rules.push({ axis: "h", x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), y0: (r.y0 + r.y1) / 2, y1: (r.y0 + r.y1) / 2, thick });
    else rules.push({ axis: "v", x0: (r.x0 + r.x1) / 2, x1: (r.x0 + r.x1) / 2, y0: Math.min(r.y0, r.y1), y1: Math.max(r.y0, r.y1), thick });
  }
  // Filled regions found in the raster (cell and row fills) stand in for filled path boxes.
  // A raster has no invisible per-cell boxes, only what is seen: the top and bottom edges of
  // fills that repeat at one width (zebra rows, a header over shaded rows) are drawn row edges,
  // so they count as rules and bound table rows without a tiling (a tiling of cell fills
  // still gives the columns via boxGridRules). A lone shaded box (a callout) gives none. Light
  // fills where most hold no word are a chart's plot area cut into strips by its grid lines
  // and curves (one strip may hold the legend): they are neither boxes nor row edges.
  const fills = data.fills || [];
  const holdsText = (f) => (data.items || []).some((it) => {
    const x = it.transform[4] + (it.width || 0) / 2;
    const y = it.transform[5] - 0.3 * (it.transform[0] || 0);
    return x > f.x0 && x < f.x1 && y > f.y0 && y < f.y1;
  });
  const texty = fills.map(holdsText);
  const light = fills.map((f) => (luminanceOf(f.gray) ?? 0) >= 0.7);
  const textShare = (idx) => idx.filter((i) => texty[i]).length / Math.max(1, idx.length);
  // Clusters of touching fills.
  const root = fills.map((_, i) => i);
  const find = (i) => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
  for (let i = 0; i < fills.length; i++) for (let j = i + 1; j < fills.length; j++) {
    const a = fills[i]; const b = fills[j];
    if (a.x0 <= b.x1 + 3 && b.x0 <= a.x1 + 3 && a.y0 <= b.y1 + 3 && b.y0 <= a.y1 + 3) root[find(j)] = find(i);
  }
  const members = new Map();
  fills.forEach((_, i) => { const r = find(i); if (!members.has(r)) members.set(r, []); members.get(r).push(i); });
  const plot = fills.map((_, i) => light[i] && members.get(find(i)).length >= 2 && textShare(members.get(find(i))) < 0.5);
  const boxes = [];
  fills.forEach((f, i) => {
    if (plot[i]) return;
    boxes.push({ x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, fill: f.gray, light: light[i] });
    const group = fills.map((_, j) => j).filter((j) => !plot[j] && Math.abs(fills[j].x0 - f.x0) <= 3 && Math.abs(fills[j].x1 - f.x1) <= 3);
    if (group.length < 2 || textShare(group) < 0.5) return;
    rules.push({ axis: "h", x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y0, thick: 0.5, fromBox: true });
    rules.push({ axis: "h", x0: f.x0, x1: f.x1, y0: f.y1, y1: f.y1, thick: 0.5, fromBox: true });
  });
  const ink = [];
  for (const b of data.ink || []) {
    if (!b || !(b.x1 > b.x0) || !(b.y1 > b.y0)) continue;
    ink.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
  }
  return { rules, boxes, dots, shapes: [], images: [{ x0: 0, y0: 0, x1: w, y1: h }], ink, segments: rules.length, truncated: false };
}

function boxArea(b) {
  if (!b) return 0;
  const x0 = b.x0 ?? b[0]; const y0 = b.y0 ?? b[1]; const x1 = b.x1 ?? b[2]; const y1 = b.y1 ?? b[3];
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

// A page-sized image of a letter or a menu is the photograph, not a plate.
// A plate whose only text is a caption band (the lines sit together) stays.
// A numbered figure caption, or a patent "Sheet 2 of 4", names the drawing sheet.
// A bare "Sketch (k)" does not: the picture inside the photograph is the figure.
function sheetNamed(lines) {
  return (lines || []).some((line) => {
    if (/sheet\s+\d+\s+of\s+\d+/i.test(line.text || "")) return true;
    const key = figCaptionKey(line.text);
    return key != null && key !== "";
  });
}

function dropSpreadPhoto(figures, lines, pageW, pageH) {
  const pageArea = pageW * pageH;
  if (!(pageArea > 0)) return figures || [];
  const text = (lines || []).filter((line) => (line.text || "").trim());
  if (sheetNamed(lines)) return figures || [];
  const ys = text.map((line) => ((line.y0 ?? 0) + (line.y1 ?? 0)) / 2);
  const span = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  if (!(text.length >= 5 && span > 0.35 * pageH)) return figures || [];
  return (figures || []).filter((fig) => boxArea(fig.bbox || fig) < 0.82 * pageArea);
}

// A prose or tick table sitting on a chart (above the rules, still the drawing)
// is pulled into the figure so it can be absorbed. A data table is left alone.
function coverChartTables(tables, figures, pageH) {
  for (const f of figures) {
    if (!f.bbox || f.kind === "image" || f.fromPicture) continue;
    for (const t of tables) {
      if (!t.bbox || dataTable(t)) continue;
      const gap = f.bbox[1] - t.bbox[3];
      if (gap < -2 || gap > Math.max(0.2 * pageH, 80)) continue;
      const tw = t.bbox[2] - t.bbox[0];
      const ox = Math.min(f.bbox[2], t.bbox[2]) - Math.max(f.bbox[0], t.bbox[0]);
      if (!(tw > 0) || ox / tw < 0.6) continue;
      f.bbox[1] = Math.min(f.bbox[1], t.bbox[1]);
    }
  }
}

// A table that sits inside a figure (axis ticks, a prose title read as cells) is part of
// the drawing. A data table stays a table even when the plate is much larger than it.
// Layout can put a chart's labels back after the geometry pass dropped them.
// The same rule applies to the document: a non-data table inside a figure goes.
export function dropFigureLabelTables(doc) {
  if (!doc?.blocks || !doc.order) return doc;
  const tables = [];
  const figures = [];
  for (const id of doc.order) {
    const block = doc.blocks[id];
    if (!block) continue;
    if (block.type === "table") tables.push(block);
    else if (block.type === "figure") figures.push(block);
  }
  absorbFigureTables(tables, figures);
  const keep = new Set(tables);
  for (const id of [...doc.order]) {
    const block = doc.blocks[id];
    if (!block || block.type !== "table" || keep.has(block)) continue;
    delete doc.blocks[id];
    const at = doc.order.indexOf(id);
    if (at >= 0) doc.order.splice(at, 1);
  }
  return doc;
}

export function absorbFigureTables(tables, figures) {
  for (let i = tables.length - 1; i >= 0; i--) {
    const t = tables[i];
    if (!t.bbox) continue;
    const host = figures.find((f) => f.bbox && insideFrac(t.bbox, f.bbox) >= 0.75 && boxArea(f.bbox) > 1.35 * boxArea(t.bbox));
    if (!host) continue;
    if (dataTable(t)) continue;
    tables.splice(i, 1);
  }
}

function insideFrac(inner, outer) {
  const area = boxArea(inner);
  if (!(area > 0)) return 0;
  const ox = Math.min(inner[2], outer[2]) - Math.max(inner[0], outer[0]);
  const oy = Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1]);
  if (ox <= 0 || oy <= 0) return 0;
  return (ox * oy) / area;
}

function wordCountText(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

// "Fig. 1" with nothing after the number. The next line is the body, not the caption.
function figLabelOnly(text) {
  const t = normalizeFigSpelling(text).replace(/\s+/g, " ").trim();
  return /^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\.?\s*(?:\d+[A-Za-z]?|[IVXLC]+)?[.:]?$/i.test(t)
    || /^\d+[A-Za-z]?(?:[.\s]+)\s*(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafel|taf)\.?$/i.test(t)
    || /^sketch(?:es)?\.?\s*(?:\([^)]{1,6}\)|\d+[A-Za-z]?)?[.:]?$/i.test(t);
}

function hasFigWord(text) {
  return /\b(?:fig(?:ure)?s?|plates?|abb(?:ildung(?:en)?)?|tafeln?|tafel|sketch(?:es)?)\b/i.test(String(text || ""));
}

// A label-only first line, or the line that carries the ordinate note, ends the caption.
// The lines after it stay a paragraph (helper "Fig. 1" then "now dropping…", and
// "maximum orainate." under a split ordinate line).
function splitOcrCaptionGroup(group) {
  if (!group.length || !isCaptionText(group[0].text)) return [group];
  let keep = group.length;
  if (figLabelOnly(group[0].text)) keep = 1;
  else {
    const at = group.findIndex((l) => /\bordin/i.test(String(l.text || "")));
    if (at >= 0 && at + 1 < group.length) keep = at + 1;
    else {
      const sentence = group.findIndex((l, i) => i > 0 && wordCountText(group[0].text) >= 4 && NEXT_SENTENCE_RE.test(String(l.text || "").trim()));
      if (sentence > 0) keep = sentence;
      else if (figCaptionKey(group[0].text) && wordCountText(group[0].text) >= 6 && /[.?!]["”']?$/.test(String(group[0].text || "").trim())) keep = 1;
    }
  }
  if (keep >= group.length) return [group];
  return [group.slice(0, keep), group.slice(keep)];
}

// "Fig." on its own and "2. Showing…" one baseline lower: the digit is the next
// block, overlapping the tall Fig glyph, so a below-only join never sees it.
function attachDroppedFigDigit(blocks) {
  const drop = new Set();
  for (const b of blocks) {
    if (drop.has(b) || b.type !== "caption") continue;
    if (!/^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\.?$/i.test(normalizeFigSpelling(b.text))) continue;
    let next = null;
    for (const n of blocks) {
      if (n === b || drop.has(n) || (n.type !== "para" && n.type !== "caption" && n.type !== "heading")) continue;
      if (!/^\d/.test(String(n.text || "").trim())) continue;
      if (n.bbox.x0 < b.bbox.x1 - 4 || n.bbox.x0 - b.bbox.x1 > 36) continue;
      const overlap = Math.min(n.bbox.y1, b.bbox.y1) - Math.max(n.bbox.y0, b.bbox.y0);
      const nh = n.bbox.y1 - n.bbox.y0;
      if (!(nh > 0) || overlap < 0.35 * nh) continue;
      if (!next || n.bbox.x0 < next.bbox.x0) next = n;
    }
    if (!next) continue;
    b.text = normalizeFigSpelling(`${b.text} ${next.text}`.replace(/\s+/g, " ").trim());
    b.bbox = {
      x0: Math.min(b.bbox.x0, next.bbox.x0), y0: Math.min(b.bbox.y0, next.bbox.y0),
      x1: Math.max(b.bbox.x1, next.bbox.x1), y1: Math.max(b.bbox.y1, next.bbox.y1),
    };
    b.lines = [...(b.lines || []), ...(next.lines || [])];
    drop.add(next);
  }
  if (!drop.size) return;
  for (let i = blocks.length - 1; i >= 0; i--) if (drop.has(blocks[i])) blocks.splice(i, 1);
}

// A label-only caption and the rest of the sentence on the same baseline, with the
// figure's own labels sitting in the gap ("Fig." … "of propeller section…").
// An axis title on that baseline starts with a capital and stays out.
function joinCaptionContinuation(blocks) {
  const drop = new Set();
  for (const b of blocks) {
    if (drop.has(b) || b.type !== "caption" || !figLabelOnly(b.text)) continue;
    let side = null;
    for (const n of blocks) {
      if (n === b || drop.has(n) || n.type !== "para" || !n.bbox) continue;
      const overlap = Math.min(n.bbox.y1, b.bbox.y1) - Math.max(n.bbox.y0, b.bbox.y0);
      const nh = Math.max(1, n.bbox.y1 - n.bbox.y0);
      if (overlap < 0.5 * nh) continue;
      if (n.bbox.x0 < b.bbox.x1 - 4 || n.bbox.x0 - b.bbox.x1 > 220) continue;
      if (!/^[a-z]/.test(String(n.text || "").trim())) continue;
      if (!side || n.bbox.x0 < side.bbox.x0) side = n;
    }
    if (!side) continue;
    b.text = normalizeFigSpelling(`${b.text} ${side.text}`.replace(/\s+/g, " ").trim());
    b.bbox = {
      x0: Math.min(b.bbox.x0, side.bbox.x0), y0: Math.min(b.bbox.y0, side.bbox.y0),
      x1: Math.max(b.bbox.x1, side.bbox.x1), y1: Math.max(b.bbox.y1, side.bbox.y1),
    };
    b.lines = [...(b.lines || []), ...(side.lines || [])];
    drop.add(side);
  }
  if (!drop.size) return;
  for (let i = blocks.length - 1; i >= 0; i--) if (drop.has(blocks[i])) blocks.splice(i, 1);
}

// The helper breaks "Ordinates in terms of" onto the caption baseline, to the right
// of "Fig.5 Navy", and the next line ("maximum orainate.") joins the stub. Put the
// ordinate note back on the caption and leave that next line out.
function liftOrdinateNote(blocks) {
  const drop = new Set();
  const extra = [];
  for (const b of blocks) {
    if (b.type !== "caption" || !b.lines?.length) continue;
    const head = b.lines[0];
    const side = blocks.find((n) => n !== b && !drop.has(n) && n.lines?.length
      && Math.abs((n.lines[0].base ?? n.bbox.y1) - (head.base ?? head.y1)) <= 4
      && n.bbox.x0 >= (head.x1 ?? b.bbox.x0) - 6
      && n.bbox.x0 - (head.x1 ?? b.bbox.x1) < 160
      && /\bordin/i.test(n.text || ""));
    if (!side) continue;
    const rest = b.lines.slice(1);
    const joined = joinLines([head, ...side.lines]);
    b.text = normalizeFigSpelling(joined.text);
    b.lines = [head, ...side.lines];
    b.bbox = boxOfUnits(b.lines);
    drop.add(side);
    if (rest.length) extra.push({ type: "para", lines: rest, text: joinLines(rest).text, footnoteRefs: [], bbox: boxOfUnits(rest) });
  }
  if (drop.size) for (let i = blocks.length - 1; i >= 0; i--) if (drop.has(blocks[i])) blocks.splice(i, 1);
  blocks.push(...extra);
}

// OCR breaks a caption into the next paragraph ("Fig. 3" then "Sketches of ice formation…").
// A born-digital caption is already one paragraph; joining the next body line drops it from the reading order.
// A label ("Fig. 1") does not take the next paragraph. One continuation line is enough when
// that line has no figure word. The ordinate note ends the join.
function joinCaptionTails(blocks, bodySize) {
  const drop = new Set();
  for (const b of blocks) {
    if (drop.has(b) || b.type !== "caption" || figCaptionKey(b.text) == null && !/^(?:fig|plate|abb|tafel|taf)\b/i.test(normalizeFigSpelling(b.text || ""))) continue;
    if (figLabelOnly(b.text)) continue;
    let plain = 0;
    let guard = 0;
    while (guard++ < 3) {
      let next = null;
      for (const n of blocks) {
        if (n === b || drop.has(n) || n.type !== "para") continue;
        if (n.bbox.y0 < b.bbox.y1 - 2 || n.bbox.y0 - b.bbox.y1 > 1.8 * bodySize) continue;
        const ox = Math.min(n.bbox.x1, b.bbox.x1) - Math.max(n.bbox.x0, b.bbox.x0);
        if (ox <= 8) continue;
        if (!next || n.bbox.y0 < next.bbox.y0) next = n;
      }
      if (!next) break;
      if (figCaptionKey(next.text) != null || /^(?:table|tab)\b/i.test(next.text) || wordCountText(next.text) > 24) break;
      const figWord = hasFigWord(next.text);
      // The next sentence ("The deposit was…") is the body under the caption, not another caption line.
      if (!figWord && wordCountText(b.text) >= 4 && NEXT_SENTENCE_RE.test(String(next.text || "").trim())) break;
      if (!figWord && wordCountText(b.text) >= 6 && /[.?!]["”']?$/.test(String(b.text || "").trim())) break;
      if (/\bordin/i.test(b.text) && !figWord) break;
      if (!figWord && plain >= 1) break;
      if (!figWord && /[.?!]["”']?$/.test(String(b.text || "").trim()) && /^[A-Z]/.test(String(next.text || "").trim())) break;
      b.text = `${b.text} ${next.text}`.replace(/\s+/g, " ").trim();
      b.bbox = {
        x0: Math.min(b.bbox.x0, next.bbox.x0), y0: Math.min(b.bbox.y0, next.bbox.y0),
        x1: Math.max(b.bbox.x1, next.bbox.x1), y1: Math.max(b.bbox.y1, next.bbox.y1),
      };
      b.lines = [...(b.lines || []), ...(next.lines || [])];
      drop.add(next);
      if (!figWord) plain++;
    }
  }
  if (!drop.size) return;
  for (let i = blocks.length - 1; i >= 0; i--) if (drop.has(blocks[i])) blocks.splice(i, 1);
}

// A caption line grouped with the facing column (no horizontal overlap) is not one paragraph.
function peelCaptionColumn(group) {
  if (!group?.length || group.length < 2 || !isCaptionText(group[0].text)) return { keep: group, rest: [] };
  const host = group[0];
  const keep = [host];
  const rest = [];
  for (const line of group.slice(1)) {
    const overlap = Math.min(line.x1, host.x1) - Math.max(line.x0, host.x0);
    if (overlap < 8 && line.x0 >= host.x1 - 4) rest.push(line);
    else keep.push(line);
  }
  if (!rest.length) return { keep: group, rest: [] };
  return { keep, rest };
}

function titleLikePlate(text) {
  const t = normalizeFigSpelling(String(text || "")).replace(/\s+/g, " ").trim();
  if (!t || /\.{4,}|…{2,}|·{4,}/.test(t)) return false;
  const words = t.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 28) return false;
  if (/^(?:table|tabelle|tab)\b/i.test(t) && !/^taf/i.test(t)) return false;
  if (/^(?:plates?|tafeln?|tafel|taf\.?|abb(?:ildung)?)\b/i.test(t)) return true;
  if (words.length < 4) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return false;
  return letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.62;
}

// A plate title sits on the figure ("PLATE I", "TAFEL 2", an all-caps line under the drawing)
// and is not a Fig. line the caption regex already kept.
function attachPlateTitles(blocks, figures, bodySize, pageH) {
  const gapLimit = Math.max(3 * bodySize, 36);
  for (const fig of figures || []) {
    const tb = fig.bbox;
    if (!tb) continue;
    const area = Math.max(0, tb[2] - tb[0]) * Math.max(0, tb[3] - tb[1]);
    // A stamp-sized box does not take the nearest all-caps line as its title.
    if (area < 12000) continue;
    let best = null;
    let bestGap = Infinity;
    for (const b of blocks) {
      if (!b?.bbox || (b.type !== "para" && b.type !== "heading")) continue;
      if (!titleLikePlate(b.text)) continue;
      const yGap = b.bbox.y1 <= tb[1] ? tb[1] - b.bbox.y1 : b.bbox.y0 >= tb[3] ? b.bbox.y0 - tb[3] : 0;
      if (yGap > gapLimit) continue;
      const ox = Math.min(tb[2], b.bbox.x1) - Math.max(tb[0], b.bbox.x0);
      const narrower = Math.min(tb[2] - tb[0], b.bbox.x1 - b.bbox.x0);
      if (!(narrower > 0) || ox < 0.35 * narrower) continue;
      if (yGap < bestGap) { bestGap = yGap; best = b; }
    }
    if (best) {
      best.type = "caption";
      best.text = normalizeFigSpelling(best.text);
    }
  }
}

// A chart title has no "Fig." ("Average tax wedge: …" above the plot). A plate
// title under an engraving is the same kind of line ("Isla Tenglo and harbor…",
// "Die geizigen Räuber"). It is the short line touching the figure, not a
// paragraph with body text between it and the drawing.
function pictureTitleText(text) {
  const t = normalizeFigSpelling(String(text || "")).replace(/\s+/g, " ").trim();
  if (!t || /\.{4,}|…{2,}|·{4,}/.test(t)) return false;
  const words = t.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 18) return false;
  // A lowercase word is the continuation of a sentence, not the plate's title.
  if (/^[a-z]/.test(words[0])) return false;
  if (/^\d{1,4}[.]?$/.test(words[0]) || /^\d{1,4}[.]?$/.test(words[words.length - 1])) return false;
  if (/\bcontinued\b/i.test(t)) return false;
  if (/\b\d{4}\s*[-–—]\s*\d{2,4}\b/.test(t)) return false;
  if (words.length >= 8 && /^(?:the|this|in|it|we|our|after|prior|as)\b/i.test(t)) return false;
  const numeric = words.filter((w) => /^[\d.+-]+$/.test(w)).length;
  if (numeric >= Math.ceil(words.length * 0.5)) return false;
  // A dateline under a portrait ("Executive Mansion … 21/864") is the letter, not its title.
  if (/\b(?:1[6-9]\d{2}|20\d{2})\b/.test(t) || /\b\d{1,2}\s*\/\s*\d{2,4}\b/.test(t)) return false;
  return true;
}

function blockBetween(line, figBox, blocks) {
  const top = Math.min(line.bbox.y1, figBox[1]);
  const bot = Math.max(line.bbox.y1, figBox[1]);
  const above = line.bbox.y1 <= figBox[1] + 2;
  const a = above ? top : Math.min(line.bbox.y0, figBox[3]);
  const b = above ? bot : Math.max(line.bbox.y0, figBox[3]);
  if (b - a < 4) return false;
  return (blocks || []).some((other) => {
    if (other === line || !other.bbox) return false;
    const cy = (other.bbox.y0 + other.bbox.y1) / 2;
    if (cy <= a + 1 || cy >= b - 1) return false;
    const ox = Math.min(other.bbox.x1, Math.max(line.bbox.x1, figBox[2])) - Math.max(other.bbox.x0, Math.min(line.bbox.x0, figBox[0]));
    return ox > 8;
  });
}

// Blocks that are one caption under the picture. A second column on the same
// baseline is not part of it. A word the line builder split off (it overlaps
// the caption in y and the picture in x) is.
function captionLineBlocks(anchor, figBox, blocks) {
  const ah = Math.max(8, anchor.bbox.y1 - anchor.bbox.y0);
  const out = [anchor];
  for (const other of blocks) {
    if (other === anchor) continue;
    if (!other?.bbox || (other.type !== "para" && other.type !== "heading")) continue;
    const sameBand = Math.abs(other.bbox.y0 - anchor.bbox.y0) <= 3 && Math.abs(other.bbox.y1 - anchor.bbox.y1) <= 3;
    const oh = Math.max(8, other.bbox.y1 - other.bbox.y0);
    const oy = Math.min(other.bbox.y1, anchor.bbox.y1) - Math.max(other.bbox.y0, anchor.bbox.y0);
    const splitLine = oy >= 0.45 * Math.min(ah, oh);
    if (!sameBand && !splitLine) continue;
    const cx = (other.bbox.x0 + other.bbox.x1) / 2;
    if (cx < figBox[0] - 6 || cx > figBox[2] + 12) continue;
    const oxFig = Math.min(figBox[2], other.bbox.x1) - Math.max(figBox[0], other.bbox.x0);
    if (oxFig < 8) continue;
    // A column on the same baseline is not the rest of this caption.
    const ox = Math.min(other.bbox.x1, anchor.bbox.x1) - Math.max(other.bbox.x0, anchor.bbox.x0);
    const gapX = other.bbox.x0 > anchor.bbox.x1 ? other.bbox.x0 - anchor.bbox.x1 : anchor.bbox.x0 > other.bbox.x1 ? anchor.bbox.x0 - other.bbox.x1 : 0;
    if (ox < 8 && gapX > 18) continue;
    if (wordCountText(other.text) > 4) continue;
    out.push(other);
  }
  out.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return out;
}

function attachPictureTitles(blocks, figures, bodySize, pageH) {
  const gapLimit = Math.max(2.6 * bodySize, 30);
  const used = new Set();
  for (const fig of figures || []) {
    const tb = fig.bbox;
    if (!tb) continue;
    const fh = tb[3] - tb[1];
    let best = null;
    let bestGap = Infinity;
    let bestText = "";
    for (const b of blocks) {
      if (!b?.bbox || used.has(b) || (b.type !== "para" && b.type !== "heading")) continue;
      const band = captionLineBlocks(b, tb, blocks);
      const joined = band.map((p) => p.text).join(" ");
      const shortBand = band.length > 1 && band.every((p) => wordCountText(p.text) <= 4) && wordCountText(joined) <= 12;
      const title = shortBand ? joined : b.text;
      if (!pictureTitleText(title)) continue;
      const strictAbove = b.bbox.y1 <= tb[1] + 2;
      const strictBelow = b.bbox.y0 >= tb[3] - 2;
      if ((strictAbove || strictBelow) && blockBetween(b, tb, blocks)) continue;
      const overlapsTop = b.bbox.y0 < tb[1] + 0.12 * fh && b.bbox.y1 > tb[1] - 2 && b.bbox.y0 >= tb[1] - gapLimit;
      const above = b.bbox.y1 <= tb[1] + 2 || (b.bbox.y0 < tb[1] && b.bbox.y1 < tb[1] + 0.2 * fh);
      const below = b.bbox.y0 >= tb[3] - 2;
      // A plate title can sit in the bottom band of a page-sized figure.
      const inFoot = pageH > 0 && fh >= 0.45 * pageH && b.bbox.y0 >= tb[3] - 0.08 * pageH && b.bbox.y1 <= tb[3] + 4 && b.bbox.y0 > tb[1] + 0.7 * fh;
      // The line above a photograph, or overlapping its top, is the letterhead.
      // A chart title sits above a chart and is not fromPicture.
      if (fig.fromPicture && !below && !inFoot) continue;
      if (!above && !below && !overlapsTop && !inFoot) continue;
      const gap = above ? tb[1] - b.bbox.y1 : below ? b.bbox.y0 - tb[3] : 0;
      if (!inFoot && gap > gapLimit) continue;
      const ox = Math.min(tb[2], b.bbox.x1) - Math.max(tb[0], b.bbox.x0);
      const narrower = Math.min(tb[2] - tb[0], Math.max(1, b.bbox.x1 - b.bbox.x0));
      if (ox < 0.3 * narrower) continue;
      // A line outside the box beats a legend that only overlaps the top edge.
      const score = above || below ? gap : inFoot ? 6 : gap + 40;
      if (score < bestGap) { bestGap = score; best = b; bestText = title; }
    }
    if (!best) continue;
    // A Fig. / Plate / Abb. / Sketch line already next to this box keeps that link.
    const bareFig = (text) => /^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\.?$/i.test(normalizeFigSpelling(text || "").trim());
    const lead = blocks.some((b) => {
      if (b === best || !b.bbox || !(forwardFigLead(b.text) || bareFig(b.text))) return false;
      const gap = b.bbox.y1 <= tb[1] ? tb[1] - b.bbox.y1 : b.bbox.y0 >= tb[3] ? b.bbox.y0 - tb[3] : 0;
      return gap <= Math.max(gapLimit, pageH > 0 ? 0.08 * pageH : gapLimit);
    });
    if (lead) continue;
    best.type = "caption";
    best.text = normalizeFigSpelling(bestText || best.text);
    used.add(best);
  }
}

// Closest pair wins. A numbered caption beats a bare "Fig." that only touches the same box.
// A caption beside the plate (a rotated margin line) links across a wider horizontal gap.
function captionRank(text) {
  const t = normalizeFigSpelling(text || "");
  const words = wordCountText(t);
  const numbered = figCaptionKey(t) != null && figCaptionKey(t) !== "";
  return (numbered ? 4 : 0) + Math.min(words, 24);
}

// "Figs. 20." names the plate. "1. Fig." is a reversed fragment, and an all-caps
// part label ("FACE ALL READY FOR PUSHING") is not a figure lead.
function forwardFigLead(text) {
  const t = normalizeFigSpelling(text || "").replace(/\s+/g, " ").trim();
  const key = figCaptionKey(t);
  if (key == null || key === "") return false;
  if (!/^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\b/i.test(t)) return false;
  const rest = t.replace(/^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\.?\s*(?:\d+[A-Za-z]?|[IVXLC]+)?[.:]?\s*/i, "");
  if (/^(?:is|are|was|were|shows|show|comprises|has|have)\b/i.test(rest)) return false;
  return true;
}

function linkCaptions(blocks, targets, bodySize, pageH, { scan = false } = {}) {
  const captionFor = new Map();
  const caps = blocks.filter((b) => b.type === "caption");
  const pairs = [];
  for (const cb of caps) {
    const spelled = normalizeFigSpelling(cb.text);
    const wantsTable = /^(?:table|tabelle|tab)\b/i.test(spelled) && !/^taf/i.test(spelled);
    const shortHead = scan && !wantsTable && cb.bbox.y1 <= 0.14 * pageH && wordCountText(cb.text) <= 6;
    for (const target of targets) {
      const tb = target.bbox;
      if (!tb || !cb.bbox) continue;
      const isTable = target.type === "table";
      if (wantsTable !== isTable) continue;
      const ox = Math.min(tb[2], cb.bbox.x1) - Math.max(tb[0], cb.bbox.x0);
      const xGap = cb.bbox.x1 < tb[0] ? tb[0] - cb.bbox.x1 : cb.bbox.x0 > tb[2] ? cb.bbox.x0 - tb[2] : 0;
      const yGap = cb.bbox.y1 <= tb[1] ? tb[1] - cb.bbox.y1 : cb.bbox.y0 >= tb[3] ? cb.bbox.y0 - tb[3] : 0;
      const capH = Math.max(8, cb.bbox.y1 - cb.bbox.y0);
      const yOverlap = Math.min(cb.bbox.y1, tb[3]) - Math.max(cb.bbox.y0, tb[1]);
      const beside = yOverlap >= 0.45 * capH && ox <= 0;
      let yLimit = wantsTable ? 3 * bodySize : shortHead ? Math.max(3 * bodySize, 0.16 * pageH) : Math.max(3 * bodySize, 36);
      // A numbered caption with nothing but the margin between it and the chart
      // still names that chart. A paragraph in the gap does not.
      if (!wantsTable && !isTable && forwardFigLead(cb.text)) yLimit = Math.max(yLimit, 0.08 * pageH);
      const xLimit = beside ? Math.max(8 * bodySize, 96) : Math.max(3 * bodySize, 36);
      if (!beside && yGap > yLimit) continue;
      if (ox <= 0 && xGap > xLimit) continue;
      pairs.push({ cb, target, gap: (beside ? xGap : yGap) + (ox > 0 ? 0 : xGap * 0.25), rank: captionRank(cb.text) });
    }
  }
  pairs.sort((a, b) => {
    const band = Math.max(2 * bodySize, 24);
    if (Math.abs(a.gap - b.gap) <= band) {
      const af = forwardFigLead(a.cb.text);
      const bf = forwardFigLead(b.cb.text);
      if (af !== bf) return af ? -1 : 1;
      if (figLabelOnly(a.cb.text) !== figLabelOnly(b.cb.text)) return figLabelOnly(a.cb.text) ? 1 : -1;
    }
    return a.gap - b.gap || b.rank - a.rank;
  });
  const used = new Set();
  for (const p of pairs) {
    if (used.has(p.cb) || captionFor.has(p.target)) continue;
    used.add(p.cb);
    captionFor.set(p.target, p.cb);
  }
  for (const cb of caps) if (!used.has(cb)) cb.type = "para";
  return captionFor;
}

function dataTable(t) {
  const texts = (t.cells || []).map((c) => String(c.text || "").trim()).filter(Boolean);
  const phrases = texts.filter((s) => s.split(/\s+/).length >= 5).length;
  const wordy = texts.filter((s) => /[A-Za-z]{4,}/.test(s)).length;
  const short = texts.filter((s) => s.split(/\s+/).length <= 3).length;
  // A ruled table of labels and numbers (Redwood) has a few long cells and many short ones.
  // Axis ticks are short tokens only, so they stay eligible to be absorbed.
  if (phrases >= 2 && wordy >= 4 && short >= 8 && t.rows >= 8 && t.cols >= 4) return true;
  if (phrases >= 2) return false;
  return t.rows >= 4 && t.cols >= 2 && wordy >= 4 && phrases === 0 && texts.length >= 8;
}

export async function parsePdf({ getPage, numPages, pages, signal, onPage, info = null, engineVersion = ENGINE_VERSION, sha256 = null, options = {} }) {
  const t0 = now();
  const from = pages ? Math.max(1, pages[0]) : 1;
  const to = pages ? Math.min(numPages, pages[1]) : numPages;
  const pageRecords = [];
  for (let n = from; n <= to; n++) {
    throwIfAborted(signal);
    const data = await getPage(n);
    throwIfAborted(signal);
    const rec = parsePageGeometry(data, n);
    pageRecords.push(rec);
    if (onPage) onPage({ page: n, from, to, ms: rec.ms });
    if (n < to) await yieldTick();
  }
  throwIfAborted(signal);
  const doc = assembleDocument(pageRecords, { numPages, info, engineVersion, sha256, options, from, to });
  doc.stats.ms = round(now() - t0);
  return doc;
}

function freeLinesOf(pg) {
  const free = [];
  for (const line of pg.lines || []) {
    const ws = line.words.filter((w) => !pg.used?.has?.(w));
    if (!ws.length) continue;
    free.push(ws.length === line.words.length ? line : makeLine(ws));
  }
  return free;
}

const EVIDENCE_LINES = 60;
const EVIDENCE_CHARS = 160;

// Running headers and the text lines of the first page, for the metadata-title banner check.
export function titleEvidenceLines(pageRecords, removed = []) {
  const out = [];
  for (const r of removed || []) if (r?.text && r.reason !== "page-number") out.push(String(r.text));
  const first = (pageRecords || [])[0];
  for (const line of first?.free || first?.lines || []) {
    const text = line.words.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return [...new Set(out.map((t) => t.slice(0, EVIDENCE_CHARS)))].slice(0, EVIDENCE_LINES);
}

// The page title from the geometry of pages 1-2 alone (the cover warm reads only those): the same
// furniture cut and findPageTitle as a full parse, no tables or headings. Pure.
export function quickPageTitle(pageRecords) {
  const recs = (pageRecords || []).filter(Boolean);
  if (!recs.length) return { pageTitle: "", lines: [] };
  for (const pg of recs) pg.free = freeLinesOf(pg);
  const furniture = findFurniture(recs.map((pg) => ({ n: pg.n, h: pg.h, lines: pg.free })));
  for (const pg of recs) pg.free = pg.free.filter((l) => !furniture.isFurniture(l));
  const bodySize = bodySizeOf(recs.flatMap((pg) => pg.free)) || 10;
  const found = findPageTitle(recs.slice(0, 2), { bodySize, removed: furniture.removed });
  return { pageTitle: found ? capTitle(found) : "", lines: titleEvidenceLines(recs, furniture.removed) };
}

// Pass 2: document-level structure from the page geometry records. Pure.
export function assembleDocument(pageRecords, { numPages, info = null, engineVersion = ENGINE_VERSION, sha256 = null, options = {}, from = 1, to = numPages } = {}) {
  const t1 = now();
  // Free lines: words not consumed by tables or figures.
  for (const pg of pageRecords) pg.free = freeLinesOf(pg);
  const furniture = findFurniture(pageRecords.map((pg) => ({ n: pg.n, h: pg.h, lines: pg.free })));
  for (const pg of pageRecords) pg.free = pg.free.filter((l) => !furniture.isFurniture(l));
  for (const pg of pageRecords) {
    for (const item of pg.marginRotated || []) {
      if (!item?.text) continue;
      furniture.removed.push({ page: pg.n, bbox: item.bbox, text: item.text, reason: "rotated-margin" });
    }
  }
  furniture.removed.sort((a, b) => a.page - b.page || (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0));
  const allFree = pageRecords.flatMap((pg) => pg.free);
  const bodySize = bodySizeOf(allFree) || 10;
  const bodyFont = dominantFont(allFree);
  let classes = headingClasses(allFree, bodySize);
  // The title class is the largest class seen on the first parsed page; bigger text later
  // (poster labels, figure text) is decoration, not a heading level above the title.
  const firstPage = pageRecords[0];
  if (firstPage && classes.length) {
    const onFirst = classes.filter((k) => firstPage.free.some((l) => Math.round(l.size * 2) / 2 === k && l.chars >= 3));
    if (onFirst.length) classes = classes.filter((k) => k <= onFirst[0]);
  }

  // Read before the page loop cuts lines at column gutters.
  const pageTitle = findPageTitle(pageRecords.slice(0, 2), { bodySize, removed: furniture.removed });
  const blocks = {};
  const order = [];
  const counters = {};
  const nextId = (prefix) => { counters[prefix] = (counters[prefix] || 0) + 1; return `${prefix}${counters[prefix]}`; };
  const headings = [];
  const refs = [];
  const footnotes = [];
  const perPage = [];

  for (const pg of pageRecords) {
    const units = [];
    if (pg.kind === "scan") {
      const id = nextId("s");
      blocks[id] = { id, type: "scan", page: pg.n, bbox: [0, 0, round(pg.w), round(pg.h)], confidence: 1, engine: "builtin" };
      units.push({ id, x0: 0, y0: 0, x1: pg.w, y1: pg.h });
    }
    const dots = pg.graphics.dots;
    const shared = splitSharedCaptions(pg.free);
    pg.free = shared.lines;
    const keepGutter = (list) => {
      const out = [...list];
      for (const g of shared.gutters) {
        if (!out.some((o) => g.x0 <= o.x1 + 8 && o.x0 <= g.x1 + 8)) out.push(g);
      }
      return out.sort((a, b) => a.x0 - b.x0);
    };
    let gutters = keepGutter(detectColumns(pg.free, { pageW: pg.w }));
    if (gutters.length) {
      const remembered = gutters.filter((g) => pg.free.some((l) => l.x0 < g.x0 - 1 && l.x1 > g.x1 + 1));
      pg.free = splitAtGutters(pg.free, gutters, makeLine);
      const again = keepGutter(detectColumns(pg.free, { pageW: pg.w }));
      gutters = again;
      for (const g of remembered) {
        const left = pg.free.some((l) => l.x1 <= g.x0 + 4);
        const right = pg.free.some((l) => l.x0 >= g.x1 - 4);
        if (left && right && !gutters.some((o) => g.x0 <= o.x1 + 8 && o.x0 <= g.x1 + 8)) gutters.push(g);
      }
      gutters.sort((a, b) => a.x0 - b.x0);
    }
    // Column sequences: wide lines (crossing a gutter) form their own sequence.
    const seqs = gutters.map(() => []);
    seqs.push([]);
    const wideSeq = [];
    let byY = [...pg.free].sort((a, b) => a.base - b.base || a.x0 - b.x0);
    // A footnote mark set apart at the start of a wide line joins that line.
    for (const l of [...byY]) {
      if (l.chars > 3 || !l.words.every((w) => MARK_ONLY_RE.test(w.text))) continue;
      const host = byY.find((o) => o !== l && Math.abs(o.base - l.base) <= 0.6 * Math.max(l.size, o.size) && o.x0 >= l.x1 - 1 && o.x0 - l.x1 <= 1.5 * l.size && gutters.some((g) => crossesGutter(o, g)));
      if (!host) continue;
      const joined = makeLine([...l.words.map((w) => ({ ...w, sup: true })), ...host.words]);
      byY = byY.filter((o) => o !== l).map((o) => (o === host ? joined : o));
    }
    // Table-like baseline rows (3+ fragments straddling a gutter) stay together as wide units.
    const rowWide = new Set();
    for (const row of baselineRows(byY)) {
      if (row.lines.length >= 3 && gutters.some((g) => row.x0 < g.x0 - 1 && row.x1 > g.x1 + 1)) for (const l of row.lines) rowWide.add(l);
    }
    let lastWide = null;
    for (let k = 0; k < byY.length; k++) {
      const line = byY[k];
      let wide = rowWide.has(line) || gutters.some((g) => crossesGutter(line, g));
      if (!wide && lastWide && line.base - lastWide.base <= 1.7 * line.size && Math.abs(line.x0 - lastWide.x0) <= 1.5 * line.size && Math.abs(line.size - lastWide.size) <= 0.6) {
        // Short last line of a full-width paragraph: nothing else shares its baseline.
        const shared = byY.some((o) => o !== line && Math.abs(o.base - line.base) <= 0.3 * line.size);
        if (!shared) wide = true;
      }
      if (wide) { wideSeq.push(line); lastWide = line; continue; }
      lastWide = null;
      const mid = (line.x0 + line.x1) / 2;
      let idx = gutters.findIndex((g) => mid < (g.x0 + g.x1) / 2);
      if (idx < 0) idx = gutters.length;
      seqs[idx].push(line);
    }
    const sequences = [...seqs, wideSeq].filter((s) => s.length).map((s) => s.sort((a, b) => a.base - b.base || a.x0 - b.x0));
    // Low confidence on the page, not the lexicon miss: a printed name list is
    // confident and stays a table when it has a date or measurement column.
    // Only High accuracy drops these grids. The local reading keeps them, because
    // a wrong grid left out of the text score beats a wrong paragraph put into it.
    const handwriting = options.releaseHandwriting === true && Boolean(pg.ocr) && lowConfidenceShare(pg.words) >= 0.15;
    const pageTables = [...pg.tables];
    const pageFigures = [...pg.figures];
    const textBlocks = [];
    for (const seq of sequences) {
      let lines = seq;
      // Stream tables, and aligned runs that are really equations or code listings.
      for (const t of detectStreamRuns(lines, { dots, column: boxOfUnits(lines.length ? lines : seq), rules: pg.graphics.rules, bridgeGaps: pg.tables.length === 0, ocr: Boolean(pg.ocr), handwriting })) {
        const drop = new Set(t.lines);
        lines = lines.filter((l) => !drop.has(l));
        if (t.type === "formula") {
          textBlocks.push({ type: "formula", lines: t.lines, number: t.number, bbox: boxOfUnits(t.lines), text: joinLines(t.lines, { collectRefs: false }).text });
          continue;
        }
        if (t.type === "code") {
          textBlocks.push({ type: "code", lines: t.lines, bbox: boxOfUnits(t.lines), text: t.text });
          continue;
        }
        if (isTitledBox(t) || figureLabels(t, pageFigures) || sparseContentsTable(t)) { lines = [...lines, ...t.lines].sort((a, b) => a.base - b.base || a.x0 - b.x0); continue; }
        delete t.lines; delete t.usedWords;
        t.page = pg.n;
        pageTables.push(t);
      }
      // Formulas.
      const column = boxOfUnits(lines.length ? lines : seq);
      const formulaRuns = detectFormulas(lines, { column, bodySize, bodyFont });
      const formulaLines = new Set();
      for (const run of formulaRuns) {
        const fl = lines.slice(run.start, run.end);
        fl.forEach((l) => formulaLines.add(l));
        const box = boxOfUnits(fl);
        textBlocks.push({ type: "formula", lines: fl, number: run.number, bbox: box, text: joinLines(fl, { collectRefs: false }).text });
      }
      lines = lines.filter((l) => !formulaLines.has(l));
      // Lists.
      const listRuns = detectLists(lines, { dots, joinText: (ls) => joinLines(ls).text });
      const listLines = new Set();
      for (const run of listRuns) {
        const ls = lines.slice(run.start, run.end);
        ls.forEach((l) => listLines.add(l));
        const items = run.items.map((it) => {
          const joined = joinLines(it.lines);
          for (const r of joined.footnoteRefs) refs.push({ ...r, page: pg.n, block: null });
          return { text: joined.text, level: it.level, marker: it.marker };
        });
        textBlocks.push({ type: "list", lines: ls, ordered: run.ordered, items, bbox: boxOfUnits(ls) });
      }
      lines = lines.filter((l) => !listLines.has(l));
      // Headings and paragraphs.
      let i = 0;
      const levelAt = (k) => {
        const line = lines[k];
        const next = lines[k + 1];
        const prev = lines[k - 1];
        const nextIsBody = !next || !next.bold || Math.abs(next.size - line.size) > 0.6;
        const isolated = !prev || line.base - prev.base > 1.5 * Math.max(line.size, prev.size) || prev.x1 - prev.x0 < 0.6 * (line.x1 - line.x0);
        return headingLevel(line, { bodySize, classes, nextIsBody, isolated });
      };
      const captionish = (l) => isCaptionText(l.text);
      while (i < lines.length) {
        const line = lines[i];
        const level = levelAt(i);
        if (level && !captionish(line)) {
          const hl = [line];
          let j = i + 1;
          while (j < lines.length && headingLevel(lines[j], { bodySize, classes, nextIsBody: true }) === level && lines[j].base - lines[j - 1].base <= 1.5 * line.size && Math.abs(lines[j].size - line.size) <= 0.6) { hl.push(lines[j]); j++; }
          textBlocks.push({ type: "heading", level, lines: hl, bbox: boxOfUnits(hl), text: joinLines(hl, { collectRefs: false }).text });
          i = j;
          continue;
        }
        let j = i + 1;
        while (j < lines.length && !levelAt(j)) j++;
        const chunk = lines.slice(i, j);
        for (const group of groupParagraphs(chunk, { bodySize })) {
          const peeled = pg.ocr ? peelCaptionColumn(group) : { keep: group, rest: [] };
          const pieces = pg.ocr ? splitOcrCaptionGroup(peeled.keep) : [peeled.keep];
          for (const part of pieces) emitTextGroup(part);
          if (peeled.rest.length) emitTextGroup(peeled.rest);
        }
        function emitTextGroup(group) {
          const joined = joinLines(group);
          const first = group[0].words[0];
          const isCaption = isCaptionText(joined.text);
          const startsWithMark = first && first.sup && FOOTNOTE_MARK_RE.test(first.text) && group[0].size <= 0.9 * bodySize;
          const lowOnPage = group[0].y0 >= 0.75 * pg.h;
          const lastBase = group[group.length - 1].base;
          const lastInColumn = !seq.some((l) => l.base > lastBase + 1 && l.size >= bodySize - 0.5);
          if (startsWithMark && (lowOnPage || lastInColumn)) {
            const mark = first.text;
            const rest = { ...group[0], words: group[0].words.slice(1) };
            rest.text = rest.words.map((w) => w.text).join(" ");
            const text = joinLines([rest, ...group.slice(1)], { collectRefs: false }).text;
            textBlocks.push({ type: "footnote", lines: group, mark, text, bbox: boxOfUnits(group) });
            return;
          }
          const block = { type: isCaption ? "caption" : "para", lines: group, text: isCaption ? normalizeFigSpelling(peelHyphenTail(peelTickPrefix(joined.text))) : joined.text, footnoteRefs: joined.footnoteRefs, bbox: boxOfUnits(group) };
          textBlocks.push(block);
        }
        i = j;
      }
    }
    // A leader-dot column or a split date read on one piece and not the next
    // would keep two pieces of one grid apart. They go before the pieces are compared.
    for (const t of pageTables) if (t.method === "stream") normalizeStreamPiece(t);
    stitchTables(pageTables, textBlocks, bodySize);
    absorbSectionBanners(pageTables, textBlocks, bodySize);
    absorbTableFooters(pageTables, textBlocks, bodySize);
    demoteFalseCaptions(textBlocks, bodySize, pageFigures);
    if (pg.ocr) coverChartTables(pageTables, pageFigures, pg.h);
    // A chart's labels are inside the drawing on a born-digital page too.
    absorbFigureTables(pageTables, pageFigures);
    if (pg.ocr) {
      attachDroppedFigDigit(textBlocks);
      joinCaptionContinuation(textBlocks);
      liftOrdinateNote(textBlocks);
      joinCaptionTails(textBlocks, bodySize);
      attachPlateTitles(textBlocks, pageFigures, bodySize, pg.h);
    }
    attachPictureTitles(textBlocks, pageFigures, bodySize, pg.h);
    // The closer caption wins. A Fig. line just outside the rules still attaches,
    // and on a scan a short plate number in the top band can reach the drawing under it.
    const captionFor = linkCaptions(textBlocks, [...pageTables, ...pageFigures], bodySize, pg.h, { scan: Boolean(pg.ocr) });
    // Materialise blocks with ids.
    const unitOf = (b, id) => ({ id, x0: b.bbox.x0 ?? b.bbox[0], y0: b.bbox.y0 ?? b.bbox[1], x1: b.bbox.x1 ?? b.bbox[2], y1: b.bbox.y1 ?? b.bbox[3] });
    const captionIds = new Map();
    for (const tb of textBlocks) {
      const prefix = { heading: "b", para: "b", caption: "c", footnote: "n", list: "l", formula: "e", code: "k" }[tb.type];
      const id = nextId(prefix);
      const bbox = [round(tb.bbox.x0), round(tb.bbox.y0), round(tb.bbox.x1), round(tb.bbox.y1)];
      const block = { id, type: tb.type, page: pg.n, bbox, confidence: 0.9, engine: "builtin" };
      if (tb.type === "heading") { block.level = tb.level; block.text = tb.text; block.spans = spansOf(tb.lines); headings.push(block); }
      else if (tb.type === "para" || tb.type === "caption") {
        block.text = tb.text; block.spans = spansOf(tb.lines);
        if (tb.footnoteRefs && tb.footnoteRefs.length) { block.footnoteRefs = tb.footnoteRefs.map((r) => ({ ...r, to: null })); for (const r of block.footnoteRefs) refs.push({ ref: r, page: pg.n }); }
        if (tb.type === "caption") captionIds.set(tb, id);
      } else if (tb.type === "footnote") { block.mark = tb.mark; block.text = tb.text; footnotes.push(block); }
      else if (tb.type === "list") { block.ordered = tb.ordered; block.items = tb.items; }
      else if (tb.type === "formula") { block.latex = null; block.number = tb.number; block.text = tb.text; }
      else if (tb.type === "code") { block.text = tb.text; }
      blocks[id] = block;
      units.push(unitOf(tb, id));
    }
    for (const t of pageTables) {
      const id = nextId("t");
      const cap = captionFor.get(t);
      const block = { id, type: "table", page: pg.n, bbox: t.bbox, rows: t.rows, cols: t.cols, headerRows: t.headerRows, headerCols: t.headerCols, cells: t.cells, caption: cap ? captionIds.get(cap) : null, method: t.method, grid: t.grid, confidence: t.confidence, engine: "builtin" };
      if (pg.ocr) {
        annotateOcrCells(block, pg.words);
        block.repairs = repairOcrTable(block);
      } else repairTableReading(block, { tidy: false });
      if (cap) blocks[captionIds.get(cap)].for = id;
      blocks[id] = block;
      units.push({ id, x0: t.bbox[0], y0: t.bbox[1], x1: t.bbox[2], y1: t.bbox[3] });
    }
    for (const f of pageFigures) {
      const id = nextId("f");
      const cap = captionFor.get(f);
      blocks[id] = { id, type: "figure", page: pg.n, bbox: f.bbox, caption: cap ? captionIds.get(cap) : null, image: { kind: "crop", source: f.kind }, confidence: f.kind === "drawing" ? 0.7 : 0.9, engine: "builtin" };
      if (cap) blocks[captionIds.get(cap)].for = id;
      units.push({ id, x0: f.bbox[0], y0: f.bbox[1], x1: f.bbox[2], y1: f.bbox[3] });
    }
    const ordered = orderUnits(units, { gutters, cuts: ruleCuts(pg.graphics.rules, gutters, units), lineHeight: bodySize });
    for (const u of ordered.order) order.push(u.id);
    if (pg.ocr) for (const u of units) if (blocks[u.id]) blocks[u.id].engine = "ocr+builtin";
    perPage.push({ n: pg.n, w: round(pg.w), h: round(pg.h), rotation: pg.rotation, textRotation: pg.textRotation || 0, scanLayer: Boolean(pg.scanLayer), ocr: Boolean(pg.ocr), kind: pg.kind, parsed: true, columns: ordered.columns, ms: pg.ms });
  }
  mergeContinuations(order, blocks);
  linkContinuedTables(order, blocks, perPage);
  refineBodyHeadingLevels(headings, { classes });
  applyNumbering(headings);
  // Footnote links: nearest footnote with the same mark on the same or a later page, else earlier.
  for (const entry of refs) {
    if (!entry.ref) continue;
    const same = footnotes.filter((f) => f.mark === entry.ref.mark);
    const after = same.filter((f) => f.page >= entry.page).sort((a, b) => a.page - b.page);
    const pick = after[0] || same[same.length - 1];
    if (pick) entry.ref.to = pick.id;
  }
  for (const id of order) if (blocks[id]?.footnoteRefs) inlineUnlinkedRefs(blocks[id]);
  // Title: the PDF's own Title unless it is a running header or cut off; else the biggest type on
  // page 1 (or 2) that is not furniture; else the first level-1 heading.
  let title = info && typeof info.Title === "string" ? cleanPdfTitle(info.Title) || null : null;
  const runningTexts = new Set(furniture.removed.filter((r) => r.reason !== "page-number").map((r) => normalizeFurniture(r.text)));
  if (title && (runningTexts.has(normalizeFurniture(title)) || isJunkTitleText(title) || isGibberishTitle(title))) title = null;
  if (title && pageTitle && isMetaBanner(title, { pageTitle, lines: titleEvidenceLines(pageRecords, furniture.removed) })) title = null;
  const titleHeading = (h) => h && h.type === "heading" && !isJunkTitleText(h.text) && !isGibberishTitle(h.text);
  const h1 = headings.find((h) => titleHeading(h) && h.level === 1 && h.page === (firstPage ? firstPage.n : 1)) || headings.find((h) => titleHeading(h) && h.level === 1);
  if (!title) title = pageTitle || (h1 ? h1.text : null);
  else if (h1 && isCutPrefix(title, h1.text)) title = h1.text;
  if (title) title = capTitle(title);
  const pagesOut = [];
  for (const p of perPage) pagesOut.push({ n: p.n, w: p.w, h: p.h, rotation: p.rotation, textRotation: p.textRotation, scanLayer: p.scanLayer, ocr: p.ocr, kind: p.kind, parsed: true, columns: p.columns });
  return {
    schema: SCHEMA,
    sha256,
    engine: "builtin",
    engineVersion,
    parseRev: PARSE_REV,
    options: { ocr: "none", formula: false, tables: "builtin", ...options },
    createdAt: new Date().toISOString(),
    pageCount: numPages,
    title,
    pageTitle: pageTitle ? capTitle(pageTitle) : null,
    pages: pagesOut,
    order,
    blocks,
    removed: furniture.removed,
    stats: { ms: 0, perPage: perPage.map((p) => p.ms), assembleMs: round(now() - t1), bodySize, headingSizes: classes, range: [from, to] },
  };
}

// OCR pages: each cell gets the lowest word confidence inside it and the tight box of those
// words (`wbox`), which the cell re-read crops instead of the full grid cell.
export function annotateOcrCells(table, words) {
  for (const cell of table.cells) {
    if (!cell.bbox) continue;
    const [x0, y0, x1, y1] = cell.bbox;
    let conf = null;
    let box = null;
    const bases = [];
    let size = 0;
    for (const w of words) {
      const cx = (w.x0 + w.x1) / 2; const cy = w.base - 0.25 * w.size;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      if (w.conf != null) conf = conf == null ? w.conf : Math.min(conf, w.conf);
      box = box ? [Math.min(box[0], w.x0), Math.min(box[1], w.y0), Math.max(box[2], w.x1), Math.max(box[3], w.y1)] : [w.x0, w.y0, w.x1, w.y1];
      bases.push(w.base);
      size = Math.max(size, w.size);
    }
    if (box) {
      cell.wbox = box.map(round);
      bases.sort((a, b) => a - b);
      cell.wbase = round(bases[bases.length >> 1]);
      cell.wsize = round(size);
    }
    cell.conf = conf == null ? (cell.text ? 1 : 0) : round(conf);
  }
}

// Labels around a chart (legend entries, slice percentages) line up loosely: a sparse stream
// table touching a drawing is the drawing's text, not a table.
export function figureLabels(t, figures) {
  const texts = (t.cells || []).map((c) => String(c.text || "").trim()).filter(Boolean);
  const numeric = texts.filter((s) => /\d/.test(s)).length;
  // Sketch labels read as a small grid inside the plate ("Formation on end of wire")
  // are the drawing. A numbered table, or a table that is not inside a plate, stays.
  const insidePlate = figures.some((f) => f.fromPlate && f.bbox && t.bbox && insideFrac(t.bbox, f.bbox) >= 0.75);
  if (insidePlate && t.rows <= 6 && texts.length && numeric / texts.length < 0.2) return true;
  const filled = t.cells.filter((k) => k.text).length;
  const singles = Array.from({ length: t.rows }, (_, r) => t.cells.filter((k) => k.r === r && k.text).length === 1).filter(Boolean).length;
  if (filled >= 0.6 * t.cells.length && singles < 0.5 * t.rows) return false;
  // A contents list is a label column plus page numbers. A plate box over the
  // labels does not make those rows into figure text.
  const pageNums = texts.filter((s) => /^\d{1,4}$/.test(s)).length;
  if (t.cols === 2 && t.rows >= 4 && pageNums >= 3) return false;
  return figures.some((f) => {
    const b = f.bbox;
    return t.bbox[0] <= b[2] + 12 && t.bbox[2] >= b[0] - 12 && t.bbox[1] <= b[3] + 12 && t.bbox[3] >= b[1] - 12;
  });
}

// A contents list read as a wide, mostly empty stream grid: page numbers, a
// few prose cells, no decimals. A filled two-column contents list stays a
// table. A measurement grid has a decimal or a four-digit year and stays.
export function sparseContentsTable(t) {
  if (!t || t.method !== "stream" || t.cols < 3 || t.rows < 4) return false;
  const cells = t.cells || [];
  const slot = Math.max(1, t.rows * t.cols);
  const texts = cells.map((c) => String(c.text || "").trim()).filter(Boolean);
  if (!texts.length || texts.length >= 0.55 * slot) return false;
  if (texts.some((s) => /\d{4}|\d\.\d/.test(s))) return false;
  const pageNums = texts.filter((s) => /^\d{1,3}$/.test(s)).length;
  const prose = texts.filter((s) => /[A-Za-z]{5,}/.test(s)).length;
  return pageNums >= 2 && prose >= 2;
}

// A heading over one spanning line of text ("ARTICLE INFO" + an editor line) is a box, not a
// table: two rows where one is a single cell across every column.
export function isTitledBox(t) {
  if (t.rows < 2 || t.cols < 2) return true;
  if (t.rows > 2) return false;
  return t.cells.some((k) => k.colSpan === t.cols && k.text);
}

// The second piece's only header is one numbered line across every column
// ("Supercharger speed - 2,000 r.p.m."), not a row of column names.
function sectionBanner(table) {
  if ((table?.headerRows || 0) !== 1 || (table.cols || 0) < 2) return false;
  const filled = (table.cells || []).filter((c) => c.r === 0 && String(c.text || "").trim());
  if (filled.length !== 1) return false;
  const cell = filled[0];
  if ((cell.colSpan || 1) < table.cols) return false;
  if (!/\d/.test(cell.text)) return false;
  const words = String(cell.text).toLowerCase().replace(/[^a-z]+/g, " ").split(/\s+/).filter((w) => w.length >= 4);
  return words.length >= 2;
}

function bannerWords(text) {
  return String(text || "").toLowerCase().replace(/[^a-z]+/g, " ").trim().split(/\s+/).filter((w) => w.length >= 4);
}

// Two numbered section lines are the same banner when they share their long words.
// A section banner of a roster or a register ends in its years ("Harbormaster,
// at Eureka, 1899-1924." / "..., 1863-1924—Continued."). Two lines of that
// shape are banners of one table even when the words differ.
const YEAR_RANGE_TAIL_RE = /\b(?:1[5-9]|20)\d{2}\s*[-–—]\s*(?:1[5-9]|20)\d{2}\.?(?:\s*[-–—]*\s*continued\.?)?$/i;

function yearRangeBanner(text) {
  const s = String(text || "").trim();
  if (!YEAR_RANGE_TAIL_RE.test(s)) return false;
  return bannerWords(s).length >= 1 && s.split(/\s+/).length <= 12;
}

function sameBanner(a, b) {
  if (!/\d/.test(String(a || "")) || !/\d/.test(String(b || ""))) return false;
  if (yearRangeBanner(a) && yearRangeBanner(b)) return true;
  const A = bannerWords(a);
  const B = bannerWords(b);
  if (A.length < 2 || B.length < 2) return false;
  const set = new Set(B);
  const inter = A.filter((w) => set.has(w)).length;
  return inter >= 2 && inter / Math.min(A.length, B.length) >= 0.6;
}

function spanningBannerTexts(table) {
  const out = [];
  for (let r = 0; r < (table.rows || 0); r++) {
    const row = (table.cells || []).filter((c) => c.r === r);
    const filled = row.filter((c) => String(c.text || "").trim());
    if (filled.length === 1 && (filled[0].colSpan || 1) >= table.cols) out.push(String(filled[0].text));
  }
  return out;
}

function blockBox(tb) {
  const b = tb?.bbox;
  if (!b) return null;
  if (Array.isArray(b)) return { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
  if (b.x0 == null || b.y0 == null) return null;
  return b;
}

// A one-line paragraph inside the width of two grid pieces, at most twelve
// words, not a caption and not a repeat of the column heads.
function sectionLineBetween(tb, a, b, bodySize) {
  if (!tb || (tb.type !== "para" && tb.type !== "heading")) return null;
  const text = String(tb.text || "").trim();
  if (!text || CAPTION_RE.test(text)) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 12 || words.length < 2) return null;
  if (tb.bbox.y1 - tb.bbox.y0 > 1.8 * (bodySize || 10)) return null;
  const x0 = Math.min(a.bbox[0], b.bbox[0]);
  const x1 = Math.max(a.bbox[2], b.bbox[2]);
  if (tb.bbox.x0 < x0 - 2 || tb.bbox.x1 > x1 + 2) return null;
  const heads = (t) => (t.cells || []).filter((c) => c.r === 0).map((c) => String(c.text || "").trim().toLowerCase()).filter(Boolean);
  const low = text.toLowerCase();
  if ([...heads(a), ...heads(b)].some((h) => h.length >= 4 && low.includes(h))) return null;
  return { text, block: tb };
}

// Two stream tables in one column split by a slightly wider row gap: same column structure,
// nothing between them, join them into one. A second piece that opens with a section
// banner is the same table; a piece with its own column heads is not.
export function stitchTables(tables, textBlocks, bodySize) {
  tables.sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  for (let i = 0; i + 1 < tables.length; i++) {
    const a = tables[i];
    const b = tables[i + 1];
    if (a.method !== "stream" || b.method !== "stream" || a.cols !== b.cols) continue;
    if ((b.headerRows || 0) > 0 && !sectionBanner(b)) continue;
    const gap = b.bbox[1] - a.bbox[3];
    if (gap < -2 || gap > 6 * bodySize) continue;
    const ox = Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]);
    if (ox < 0.8 * Math.min(a.bbox[2] - a.bbox[0], b.bbox[2] - b.bbox[0])) continue;
    const colW = (a.bbox[2] - a.bbox[0]) / a.cols;
    let same = true;
    for (let c = 1; c < a.cols; c++) if (Math.abs(a.grid.xs[c] - b.grid.xs[c]) > 0.35 * colW) same = false;
    if (!same) continue;
    const between = textBlocks.filter((tb) => tb.bbox.y0 >= a.bbox[3] - 1 && tb.bbox.y1 <= b.bbox[1] + 1 && Math.min(tb.bbox.x1, a.bbox[2]) - Math.max(tb.bbox.x0, a.bbox[0]) > 0);
    // One short line between two pieces of the same grid is a section head
    // inside the table ("Harbor Commissioners for the Port of San Jose,
    // 1913-1924."): it joins as a full-width row. A caption names a new table.
    const banner = between.length === 1 ? sectionLineBetween(between[0], a, b, bodySize) : null;
    if (between.length && !banner) continue;
    if (!banner && gap > 4 * bodySize) continue;
    if (banner && (a.rows < 3 || b.rows < 3)) continue;
    const bannerRows = banner ? 1 : 0;
    const bannerCells = banner ? [{ r: a.rows, c: 0, rowSpan: 1, colSpan: a.cols, text: banner.text, header: false }] : [];
    const cells = [...a.cells, ...bannerCells, ...b.cells.map((k) => ({ ...k, r: k.r + a.rows + bannerRows, header: false }))];
    if (banner) textBlocks.splice(textBlocks.indexOf(banner.block), 1);
    const merged = {
      ...a,
      rows: a.rows + bannerRows + b.rows,
      cells,
      bbox: [Math.min(a.bbox[0], b.bbox[0]), a.bbox[1], Math.max(a.bbox[2], b.bbox[2]), b.bbox[3]],
      grid: { xs: a.grid.xs, ys: [...a.grid.ys.slice(0, -1), (a.grid.ys[a.grid.ys.length - 1] + b.grid.ys[0]) / 2, ...b.grid.ys.slice(1)] },
      confidence: Math.min(a.confidence, b.confidence),
    };
    tables.splice(i, 2, merged);
    i--;
  }
  return tables;
}

// A section line left above the grid ("Supercharger Speed - 1,000 r.p.m.") is the
// same banner the table already repeats. It becomes the first row.
export function absorbSectionBanners(tables, textBlocks, bodySize) {
  const size = bodySize || 10;
  const used = new Set();
  for (const table of tables || []) for (let pass = 0; pass < 3; pass++) {
    if (!table?.bbox || !table.cells?.length || table.cols < 2) break;
    const banners = spanningBannerTexts(table);
    if (!banners.length) break;
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < textBlocks.length; i++) {
      if (used.has(i)) continue;
      const tb = textBlocks[i];
      if (!tb || (tb.type !== "para" && tb.type !== "heading")) continue;
      const b = blockBox(tb);
      if (!b) continue;
      const gap = table.bbox[1] - b.y1;
      if (gap < -4 || gap > 2.2 * size || b.y0 >= table.bbox[1]) continue;
      if (b.y1 - b.y0 > 1.8 * size) continue;
      const bw = b.x1 - b.x0;
      const ox = Math.min(b.x1, table.bbox[2]) - Math.max(b.x0, table.bbox[0]);
      if (!(bw > 0) || ox < 0.5 * bw) continue;
      const text = String(tb.text || "").trim();
      if (!banners.some((banner) => sameBanner(banner, text))) continue;
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best < 0) break;
    const tb = textBlocks[best];
    const b = blockBox(tb);
    used.add(best);
    for (const cell of table.cells) cell.r += 1;
    table.cells.unshift({
      r: 0, c: 0, rowSpan: 1, colSpan: table.cols, text: String(tb.text || "").trim(), header: false,
    });
    table.rows += 1;
    if ((table.headerRows || 0) > 0) table.headerRows += 1;
    table.bbox = [Math.min(table.bbox[0], b.x0), Math.min(table.bbox[1], b.y0), Math.max(table.bbox[2], b.x1), table.bbox[3]];
    if (table.grid?.ys) table.grid.ys = [b.y0, ...table.grid.ys];
  }
  for (let i = textBlocks.length - 1; i >= 0; i--) if (used.has(i)) textBlocks.splice(i, 1);
  return tables;
}

// A line sitting on the bottom rule, inside the table's width and carrying a
// number, is the table's last row (a totals line, a prefix note), not a paragraph.
export function absorbTableFooters(tables, textBlocks, bodySize) {
  const size = bodySize || 10;
  const used = new Set();
  for (const table of tables || []) {
    if (!table?.bbox || table.cols < 2 || table.rows < 2) continue;
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < textBlocks.length; i++) {
      if (used.has(i)) continue;
      const tb = textBlocks[i];
      if (!tb || tb.type === "caption" || tb.type === "heading" || tb.type === "footnote") continue;
      const b = blockBox(tb);
      if (!b) continue;
      const gap = b.y0 - table.bbox[3];
      // A source line, a chi-square, or the next paragraph sits further down
      // than one line. The row we want is on the bottom rule.
      if (gap < -2 || gap > size) continue;
      if (b.y1 - b.y0 > 3 * size) continue;
      const text = String(tb.text || "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length < 4 || words.length > 40 || !/\d/.test(text)) continue;
      // A sentence that starts lowercase is a note continuing under the rule
      // ("after rounding are shown as 0.00"), not the table's last row.
      if (/^[a-z]/.test(text)) continue;
      // A star or dagger in front of the line is an affiliation or a footnote.
      if (/^[*†‡§¶⁎∗]\s/u.test(text)) continue;
      if (/-\s*$/.test(text)) continue;
      // A citation, a numbered note, a glossary label, or a test statistic
      // printed under the rule is not the table's last row.
      if (/^(?:sources?|notes?|note)\b/i.test(text)) continue;
      if (/^\d+\.\s/.test(text)) continue;
      if (/^[A-Z]{2,}:/.test(text)) continue;
      if (/[χΧ]\s*=/.test(text) || /\bp\s*[=<>]/.test(text)) continue;
      if (isCaptionText(text)) continue;
      if ((tables || []).some((other) => spanningBannerTexts(other).some((banner) => sameBanner(banner, text)))) continue;
      const bw = b.x1 - b.x0;
      const tw = table.bbox[2] - table.bbox[0];
      if (!(tw > 0) || bw < 0.34 * tw || bw > tw * 1.08) continue;
      const ox = Math.min(b.x1, table.bbox[2]) - Math.max(b.x0, table.bbox[0]);
      if (ox < 0.9 * bw) continue;
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best < 0) continue;
    const tb = textBlocks[best];
    const b = blockBox(tb);
    used.add(best);
    table.cells.push({
      r: table.rows, c: 0, rowSpan: 1, colSpan: table.cols, text: String(tb.text || "").trim(), header: false,
    });
    table.rows += 1;
    table.bbox = [Math.min(table.bbox[0], b.x0), table.bbox[1], Math.max(table.bbox[2], b.x1), Math.max(table.bbox[3], b.y1)];
    if (table.grid?.ys) table.grid.ys.push(b.y1);
  }
  for (let i = textBlocks.length - 1; i >= 0; i--) if (used.has(i)) textBlocks.splice(i, 1);
  return tables;
}

// A table at the top of a page continues the last table of the previous page when its caption
// says so, or when both share the column count and sit at the page edges without a caption.
export function linkContinuedTables(order, blocks, pages) {
  const byPage = new Map();
  for (const p of pages) byPage.set(p.n, p);
  const tables = order.map((id) => blocks[id]).filter((b) => b && b.type === "table");
  for (let i = 1; i < tables.length; i++) {
    const b = tables[i];
    const a = tables[i - 1];
    if (b.page !== a.page + 1 || a.cols !== b.cols) continue;
    const cap = b.caption ? blocks[b.caption] : null;
    const says = cap && /\b(cont(inued|\.|'d)|continuation)\b/i.test(cap.text);
    const ph = byPage.get(a.page) ? byPage.get(a.page).h : 792;
    const pb = byPage.get(b.page) ? byPage.get(b.page).h : 792;
    const edges = a.bbox[3] >= 0.6 * ph && b.bbox[1] <= 0.35 * pb;
    if (says || (!cap && edges)) b.continues = a.id;
  }
}

function dominantFont(lines) {
  const counts = new Map();
  for (const l of lines) for (const w of l.words) counts.set(w.fontName, (counts.get(w.fontName) || 0) + w.text.length);
  let best = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { n = v; best = k; }
  return best;
}

// A paragraph cut by a column or page break continues in the next paragraph of the order.
export function mergeContinuations(order, blocks) {
  for (let i = 0; i + 1 < order.length; i++) {
    const a = blocks[order[i]];
    const b = blocks[order[i + 1]];
    if (!a || !b || a.type !== "para" || b.type !== "para") continue;
    if (/[.?!:"”)\]]$/.test(a.text) || !/^[a-z]/.test(b.text)) continue;
    // The next column starts to the right and above the end of this one. That is not a continuation.
    // A same-page gap of more than a line (a running header above the body) is not one either.
    const ab = a.bbox;
    const bb = b.bbox;
    const size = a.spans?.[0]?.size || b.spans?.[0]?.size || 10;
    if (a.page === b.page && ab && bb && bb[1] - ab[3] > 1.4 * size) continue;
    if (ab && bb && bb[0] > ab[2] - 8 && bb[1] + 8 < ab[3]) continue;
    if (Math.abs(a.spans?.[0]?.size - b.spans?.[0]?.size) > 0.6) continue;
    const hyphen = a.text.endsWith("-");
    const offset = a.text.length + (hyphen ? 0 : 1);
    a.text = hyphen ? a.text.slice(0, -1) + b.text : `${a.text} ${b.text}`;
    a.spans = [...(a.spans || []), ...(b.spans || [])];
    if (b.footnoteRefs) {
      // Same ref objects (the footnote linker holds them); only the offsets move.
      for (const r of b.footnoteRefs) r.at += offset - (hyphen ? 1 : 0);
      a.footnoteRefs = [...(a.footnoteRefs || []), ...b.footnoteRefs];
    }
    a.parts = [...(a.parts || [{ page: a.page, bbox: a.bbox }]), { page: b.page, bbox: b.bbox }];
    delete blocks[b.id];
    order.splice(i + 1, 1);
    i--;
  }
}

export { lineBox };
