// Ink the text detector never boxed. DB detection drops a lone "-" or "1" in a table cell (44 of
// 392 cells on ICDAR eu-001 were a bare dash). Connected components of the page ink that no det
// box covers are grouped into small blobs; the caller reads each blob with the recogniser.

// boxes: det boxes in page pixels. Returns a Uint8Array page mask, 1 inside any box grown by pad.
export function coverMask(boxes, pageW, pageH, pad = 0) {
  const mask = new Uint8Array(pageW * pageH);
  for (const b of boxes || []) {
    const x0 = Math.max(0, Math.floor(b.x0 - pad));
    const y0 = Math.max(0, Math.floor(b.y0 - pad));
    const x1 = Math.min(pageW, Math.ceil(b.x1 + pad));
    const y1 = Math.min(pageH, Math.ceil(b.y1 + pad));
    for (let y = y0; y < y1; y++) mask.fill(1, y * pageW + x0, y * pageW + x1);
  }
  return mask;
}

// components: labelComponents output (inclusive x1/y1). em: body size in page pixels.
// Returns blobs { x0, y0, x1, y1 } (exclusive x1/y1) of uncovered text-sized ink.
export function orphanBlobs(components, covered, pageW, em) {
  if (!(em > 0)) return [];
  const minArea = Math.max(4, 0.01 * em * em);
  const parts = [];
  for (const c of components || []) {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    if (c.area < minArea) continue;
    if (h > 1.3 * em || w > 4 * em) continue;
    if (w >= 2.5 * em && h <= 0.2 * em) continue;
    const cx = Math.round((c.x0 + c.x1) / 2);
    const cy = Math.round((c.y0 + c.y1) / 2);
    if (covered[cy * pageW + cx]) continue;
    parts.push({ x0: c.x0, y0: c.y0, x1: c.x1 + 1, y1: c.y1 + 1 });
  }
  parts.sort((a, b) => a.x0 - b.x0);
  const blobs = [];
  for (const p of parts) {
    const pcy = (p.y0 + p.y1) / 2;
    const host = blobs.find((b) => p.x0 - b.x1 <= 0.5 * em && p.x0 >= b.x0 - 0.5 * em
      && Math.abs(pcy - (b.y0 + b.y1) / 2) <= 0.6 * em && Math.max(b.y1, p.y1) - Math.min(b.y0, p.y0) <= 1.3 * em);
    if (host) {
      host.x0 = Math.min(host.x0, p.x0);
      host.y0 = Math.min(host.y0, p.y0);
      host.x1 = Math.max(host.x1, p.x1);
      host.y1 = Math.max(host.y1, p.y1);
      host.parts++;
    } else blobs.push({ ...p, parts: 1 });
  }
  return blobs.filter((b) => b.x1 - b.x0 <= 8 * em);
}

// Baseline of a blob (page pixels): a glyph-tall blob sits on its bottom edge; a dash or a dot
// row floats about a quarter em above the baseline.
export function blobBaseline(blob, em) {
  const h = blob.y1 - blob.y0;
  if (h >= 0.45 * em) return blob.y1;
  return (blob.y0 + blob.y1) / 2 + 0.25 * em;
}

const HALLUCINATION = /yanma|ianm|gent|cmyk/i;

// Keep a blob read only when it is confident, short enough for the ink, and not the rec
// model's "cyan magenta yellow" answer to near-empty crops.
export function acceptOrphanRead(text, conf, blob, em) {
  const t = String(text || "").trim();
  if (!t) return false;
  const w = blob.x1 - blob.x0;
  const h = blob.y1 - blob.y0;
  // A dash reads at 0.35-0.6: the crop is mostly white. Its shape is the evidence.
  if (/^[-–—]$/.test(t)) return w >= 1.8 * h && h <= 0.2 * em;
  if (conf < 0.6) return false;
  if (HALLUCINATION.test(t)) return false;
  const maxChars = Math.ceil((blob.x1 - blob.x0) / (0.25 * em)) + 2;
  return t.replace(/\s+/g, "").length <= maxChars;
}

// A lone bar the size of a dash is a dash: the rec model returns nothing for an em dash on its
// own and reads a hyphen at 0.35 confidence. Width picks the glyph. null when not dash-shaped.
export function dashFromShape(blob, em) {
  const w = blob.x1 - blob.x0;
  const h = blob.y1 - blob.y0;
  if (blob.parts !== 1 || h > 0.2 * em || w < 3 * h || w < 0.2 * em || w > 1.6 * em) return null;
  if (w < 0.45 * em) return "-";
  if (w < 0.8 * em) return "–";
  return "—";
}
