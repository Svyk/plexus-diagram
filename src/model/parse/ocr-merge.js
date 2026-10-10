// Merge a fresh-OCR parse into the document the built-in pass produced. Pure.
//
// `base` is the document from the page's own text (empty for an image-only page, the old OCR
// layer for a scanLayer page). `fresh` is the document assembled with the helper's OCR records
// standing in for those pages. The fresh document wins page by page; on a scanLayer page each
// fresh table is compared with the layer table at the same place and the one whose numeric
// columns read better is kept. The choice is recorded on the page (`ocrChoice`) and on the
// table (`ocrSource`), so the view can say which reading it shows.

import { polishTableText, tableNumericValidity } from "./ocr-fix.js";

export function iou(a, b) {
  const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

// Compare one table from each reading. The layer wins only when it reads clearly better.
export function chooseTable(fresh, layer) {
  const f = tableNumericValidity(fresh);
  const l = tableNumericValidity(layer);
  const freshScore = f.share * Math.min(1, f.total / Math.max(1, l.total));
  const layerScore = l.share * Math.min(1, l.total / Math.max(1, f.total));
  const sameShape = fresh.rows === layer.rows && fresh.cols === layer.cols;
  const chose = layerScore > freshScore + 0.05 || (sameShape && layerScore > freshScore + 0.02) ? "layer" : "fresh";
  return { chose, fresh: { ...f, score: round(freshScore) }, layer: { ...l, score: round(layerScore) } };
}

function round(n) { return Math.round(n * 1000) / 1000; }

// pages: the page numbers that were OCR'd. Returns a new document (fresh's blocks, with the
// per-table choices applied) and the list of choices.
export function mergeOcrDocument(base, fresh, { pages = [] } = {}) {
  const set = new Set(pages);
  const doc = { ...fresh, blocks: { ...fresh.blocks }, pages: fresh.pages.map((p) => ({ ...p })) };
  const choices = [];
  const layerTables = Object.values(base?.blocks || {}).filter((b) => b.type === "table" && set.has(b.page));
  const basePages = new Map((base?.pages || []).map((p) => [p.n, p]));
  for (const page of doc.pages) {
    if (!set.has(page.n)) continue;
    const was = basePages.get(page.n);
    page.ocrChoice = was && was.scanLayer ? "compared" : "fresh";
  }
  for (const id of Object.keys(doc.blocks)) {
    const block = doc.blocks[id];
    if (block.type !== "table" || !set.has(block.page)) continue;
    const was = basePages.get(block.page);
    if (!was || !was.scanLayer) { doc.blocks[id] = { ...block, ocrSource: "fresh" }; continue; }
    let best = null;
    for (const lt of layerTables) {
      if (lt.page !== block.page) continue;
      const overlap = iou(lt.bbox, block.bbox);
      if (overlap >= 0.5 && (!best || overlap > best.overlap)) best = { table: lt, overlap };
    }
    if (!best) { doc.blocks[id] = { ...block, ocrSource: "fresh" }; continue; }
    const verdict = chooseTable(block, best.table);
    choices.push({ page: block.page, id, layerId: best.table.id, ...verdict });
    if (verdict.chose === "layer") {
      const layer = { ...best.table, cells: (best.table.cells || []).map((c) => ({ ...c })), id, caption: block.caption, engine: "builtin", ocrSource: "layer", ocrCompare: verdict };
      polishTableText(layer, { tidy: false });
      doc.blocks[id] = layer;
    } else {
      doc.blocks[id] = { ...block, ocrSource: "fresh", ocrCompare: verdict };
    }
  }
  if (choices.length) {
    for (const page of doc.pages) {
      if (page.ocrChoice !== "compared") continue;
      const mine = choices.filter((c) => c.page === page.n);
      page.ocrChoice = mine.length && mine.every((c) => c.chose === "layer") ? "layer" : mine.some((c) => c.chose === "layer") ? "mixed" : "fresh";
    }
  }
  doc.ocr = { pages: [...set].sort((a, b) => a - b), choices };
  return { doc, choices };
}

// Pages that need the helper's OCR: image-only (`kind: "scan"`) and old OCR layers
// (`scanLayer`), unless already read (`ocr`).
export function scanPagesOf(doc) {
  return (doc?.pages || []).filter((p) => !p.ocr && (p.kind === "scan" || p.scanLayer)).map((p) => p.n);
}
