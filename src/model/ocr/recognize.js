// Page and cell OCR with injected det/rec runners, so the browser worker and the node bench
// share one pipeline. runDet(data, dims) → Float32Array probability map (H*W).
// runRec(data, dims) → { logits, time, classes, batch? } for a batch of NCHW crops.

import { boxesFromProb, dominantAngle } from "./db-boxes.js";
import { cropRgb, detResize, grayFromRgb, nchwNormalize, padWhite, recResize, resizeRgb, rotateRgb } from "./image.js";
import { inkGlyph, otsuThreshold, rulesFromCanvas } from "./rules-from-canvas.js";
import { bucketConf, ctcDecode, ctcText, round2, snapOcrItems, wordItem, wordsFromCtc } from "./words-from-ctc.js";
import { dashRuns, joinNumberWords, localMask, segmentLine, sizeFromInk, snapWords } from "./word-split.js";
import { acceptOrphanRead, blobBaseline, coverMask, dashFromShape, orphanBlobs } from "./orphans.js";
import { labelComponents } from "./components.js";

const DET_LIMIT = "auto";
const DET_PROBE = 1600;
const DET_TARGET_H = 27;
const DET_MIN = 960;
const DET_MAX = 4096;
const REC_H = 48;
const BATCH = 8;
const SEG_BATCH = 16;
const SPACE_CH = new Set([" ", "\u3000", "\u00a0"]);
const CLEAN_NUM = /^\d{1,4}(?:\.\d+)?$/;
const LONG_WORD = /^[A-Za-z][A-Za-z,.'()\-]{4,}$/;
const CELL_PAD_PT = 1.5;
const CELL_TIGHT_PT = 0.5;
const CELL_SCALE = 3;

function aborted() {
  const error = new Error("ocr aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw aborted();
}

function pageRecord(n, items, rules, w, h, dpi, deskew) {
  return {
    n,
    w: round2(w),
    h: round2(h),
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    scan: true,
    dpi,
    deskew: round2(deskew),
    fonts: { ocr: { name: "ocr" } },
    items,
    rules,
    ops: { fnArray: [], argsArray: [] },
    engine: "ppocr-web",
  };
}

// Long-side limit that puts the median det box near DET_TARGET_H map pixels. The det model
// reads 6 pt scans badly when a 960 px map shrinks them to 7 px glyphs, and splits 10 pt text
// into fragments at full 300 dpi. probeH is the median box height seen at probeLimit.
export function detLimitFor(probeH, probeLimit, longSide, target = DET_TARGET_H) {
  const probeScale = Math.min(1, probeLimit / longSide);
  if (!(probeH > 0)) return Math.min(longSide, probeLimit);
  const scale = Math.min(1, probeScale * target / probeH);
  return Math.round(Math.max(DET_MIN, Math.min(DET_MAX, longSide * scale)));
}

function medianMapHeight(boxes, mapScale) {
  const hs = boxes.map((b) => (b.y1 - b.y0) * mapScale).sort((a, b) => a - b);
  return hs.length ? hs[hs.length >> 1] : 0;
}

async function detect(rgb, width, height, runDet, signal, opts = {}) {
  const { detLimit = DET_LIMIT } = opts;
  if (detLimit !== "auto") return detectAt(rgb, width, height, runDet, signal, opts);
  const long = Math.max(width, height);
  const probe = await detectAt(rgb, width, height, runDet, signal, { ...opts, detLimit: DET_PROBE });
  const probeScale = Math.min(1, DET_PROBE / long);
  const limit = detLimitFor(medianMapHeight(probe, probeScale), DET_PROBE, long);
  opts.chosenLimit = limit;
  if (Math.abs(Math.min(limit, long) - Math.min(DET_PROBE, long)) <= 0.12 * Math.min(DET_PROBE, long)) return probe;
  return detectAt(rgb, width, height, runDet, signal, { ...opts, detLimit: limit });
}

async function detectAt(rgb, width, height, runDet, signal, { detLimit = DET_PROBE, unclipRatio = 1.5, boxThresh = 0.6 } = {}) {
  throwIfAborted(signal);
  const resized = detResize(rgb, width, height, detLimit);
  const data = nchwNormalize(resized.rgb, resized.w, resized.h);
  const prob = await runDet(data, [1, 3, resized.h, resized.w]);
  throwIfAborted(signal);
  const mapW = resized.w;
  const mapH = prob.length / mapW;
  if (!Number.isInteger(mapH)) throw new Error(`det map length ${prob.length} is not ${mapW} wide`);
  return boxesFromProb(prob, mapW, mapH, width, height, { unclipRatio, boxThresh });
}

function prepareCrop(rgb, width, height, box) {
  const pad = 2;
  let crop = cropRgb(rgb, width, height, box.x0 - pad, box.y0 - pad, box.x1 + pad, box.y1 + pad);
  if (crop.w < 2 || crop.h < 2) return null;
  if (crop.h > crop.w * 1.4) crop = rotateRgb(crop.rgb, crop.w, crop.h, 90);
  const resized = recResize(crop.rgb, crop.w, crop.h, REC_H);
  return { box, resized };
}

function blitLeft(dest, batch, destW, src, srcW, height) {
  const plane = height * destW;
  const srcPlane = height * srcW;
  const base = batch * 3 * plane;
  for (let c = 0; c < 3; c++) {
    const d0 = base + c * plane;
    const s0 = c * srcPlane;
    for (let y = 0; y < height; y++) {
      dest.set(src.subarray(s0 + y * srcW, s0 + (y + 1) * srcW), d0 + y * destW);
    }
  }
}

async function readCrops(crops, scaleX, scaleY, runRec, dict, signal) {
  const items = [];
  for (let i = 0; i < crops.length; i += BATCH) {
    throwIfAborted(signal);
    const chunk = crops.slice(i, i + BATCH);
    const maxW = Math.max(...chunk.map((c) => c.resized.w));
    const height = REC_H;
    const data = new Float32Array(chunk.length * 3 * height * maxW);
    const normals = chunk.map((c) => nchwNormalize(c.resized.rgb, c.resized.w, c.resized.h));
    chunk.forEach((c, b) => blitLeft(data, b, maxW, normals[b], c.resized.w, height));
    const out = await runRec(data, [chunk.length, 3, height, maxW]);
    const time = out.time;
    const classes = out.classes;
    const logits = out.logits;
    chunk.forEach((c, b) => {
      const contentT = Math.max(1, Math.min(time, Math.round(time * (c.resized.contentW || c.resized.w) / maxW)));
      const start = b * time * classes;
      const slice = logits.subarray(start, start + contentT * classes);
      const pageBox = {
        x0: c.box.x0 / scaleX,
        y0: c.box.y0 / scaleY,
        x1: c.box.x1 / scaleX,
        y1: c.box.y1 / scaleY,
      };
      items.push(...wordsFromCtc({ logits: slice, time: contentT, classes, dict, box: pageBox }));
    });
  }
  return items;
}

// Crops sorted by width and batched only with crops of nearly the same width: the rec model
// misreads a short crop padded out to a long batch (a 528 px label padded to 2256 px read as
// "SloSExCNTMPILE" instead of "Salmonellosis, excluding typhoid fever"). Batch padding is 0 in
// normalised space, as PaddleOCR pads: white (1) padding turned "Weekly" into "cYanmaGnel".
export function widthBatches(widths, batchSize = SEG_BATCH, ratio = 1.3) {
  const order = widths.map((_, i) => i).sort((a, b) => widths[a] - widths[b]);
  const batches = [];
  let cur = [];
  for (const k of order) {
    if (cur.length && (cur.length >= batchSize || widths[k] > ratio * widths[cur[0]] + 16)) {
      batches.push(cur);
      cur = [];
    }
    cur.push(k);
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function recBatches(crops, runRec, signal, batchSize = SEG_BATCH) {
  const out = new Array(crops.length);
  for (const idx of widthBatches(crops.map((c) => c.resized.w), batchSize)) {
    throwIfAborted(signal);
    const maxW = Math.max(...idx.map((k) => crops[k].resized.w));
    const data = new Float32Array(idx.length * 3 * REC_H * maxW);
    idx.forEach((k, b) => {
      const c = crops[k].resized;
      blitLeft(data, b, maxW, nchwNormalize(c.rgb, c.w, c.h), c.w, REC_H);
    });
    const res = await runRec(data, [idx.length, 3, REC_H, maxW]);
    idx.forEach((k, b) => {
      const c = crops[k].resized;
      const contentT = Math.max(1, Math.min(res.time, Math.round(res.time * (c.contentW || c.w) / maxW)));
      const start = b * res.time * res.classes;
      // A copy: a runtime may hand back the same output buffer on the next run.
      out[k] = { logits: res.logits.slice(start, start + contentT * res.classes), time: contentT, classes: res.classes };
    });
  }
  return out;
}

function pageMask(gray) {
  const thresh = otsuThreshold(gray);
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) if (gray[i] <= thresh) mask[i] = 1;
  return mask;
}

// Each det line box is split at ink gaps; each segment is read alone and its CTC spaces snap to
// the segment's inner gaps. Tall (rotated) boxes and boxes without ink take the line path.
const DASHES = new Set(["-", "–", "—", "−"]);

// Put back a dash the rec model skipped, where the segment's ink shows one between two glyphs.
function restoreDashes(chars, crop, time, mask, pageW) {
  const ink = crop.seg.ink;
  const capH = ink.base - ink.top;
  const [c0, c1] = crop.seg.cols;
  const runs = dashRuns(mask, pageW, crop.proj, c0, c1, ink.base, capH);
  if (!runs.length) return;
  const toT = (col) => ((col + crop.proj.x0 - crop.cropLeft) / crop.cropW) * time;
  for (const run of runs) {
    const t0 = toT(run.c0) - 1;
    const t1 = toT(run.c1) + 1;
    if (chars.some((ch) => DASHES.has(ch.ch) && ch.t >= t0 && ch.t <= t1)) continue;
    const t = Math.round((toT(run.c0) + toT(run.c1)) / 2);
    const at = chars.findIndex((ch) => ch.t > t);
    // The model reads a hyphen; a dash it skipped is an en dash (not in its dict) or an em dash.
    const ch = { ch: run.c1 - run.c0 >= 1.2 * capH ? "—" : "–", t, conf: 0.9 };
    if (at < 0) chars.push(ch);
    else chars.splice(at, 0, ch);
  }
}

async function readSegments(image, w, h, boxes, mask, scaleX, scaleY, runRec, dict, signal, opts) {
  const crops = [];
  const lineBoxes = [];
  for (const box of boxes) {
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const split = bh <= bw * 1.4 ? segmentLine(mask, w, h, box, opts) : null;
    if (!split) { lineBoxes.push(box); continue; }
    const { segments, proj, inkH } = split;
    const padX = Math.max(2, Math.round(opts.padRatio * inkH));
    segments.forEach((seg, i) => {
      const prev = segments[i - 1];
      const next = segments[i + 1];
      const left = Math.max(prev ? (prev.x1 + seg.x0) / 2 : -Infinity, seg.x0 - padX);
      const right = Math.min(next ? (seg.x1 + next.x0) / 2 : Infinity, seg.x1 + padX);
      const ink = seg.ink;
      const padY = ink ? Math.max(2, Math.round(opts.padYRatio * (ink.bottom - ink.top))) : 2;
      const top = ink ? Math.max(box.y0 - 2, ink.top - padY) : box.y0 - 2;
      const bottom = ink ? Math.min(box.y1 + 2, ink.bottom + padY) : box.y1 + 2;
      const crop = cropRgb(image, w, h, left, top, right, bottom);
      if (crop.w < 2 || crop.h < 2) return;
      // White margins: the rec model misreads a crop whose glyphs touch its edges ("Weekly" at
      // 9 pt came back "cYanmaGenne"); padding with page pixels would pull in the next line.
      const white = Math.round(opts.whiteRatio * crop.h);
      const padded = padWhite(crop.rgb, crop.w, crop.h, white, white);
      const cropLeft = Math.max(0, Math.floor(left)) - white;
      crops.push({ box, seg, proj, cropLeft, cropW: padded.w, resized: recResize(padded.rgb, padded.w, padded.h, REC_H) });
    });
  }
  const reads = await recBatches(crops, runRec, signal);
  const items = [];
  crops.forEach((crop, k) => {
    const read = reads[k];
    const chars = ctcDecode(read.logits, read.time, read.classes, dict);
    if (crop.seg.ink && mask) restoreDashes(chars, crop, read.time, mask, w);
    const groups = [];
    let cur = null;
    for (const ch of chars) {
      if (SPACE_CH.has(ch.ch)) { cur = null; continue; }
      if (!cur) { cur = { chars: [] }; groups.push(cur); }
      cur.chars.push(ch);
    }
    if (!groups.length) return;
    const toCol = (t) => crop.cropLeft + (t / read.time) * crop.cropW - crop.proj.x0;
    const named = groups.map((g) => ({
      text: g.chars.map((c) => c.ch).join(""),
      c0: toCol(g.chars[0].t),
      c1: toCol(g.chars[g.chars.length - 1].t + 1),
      conf: g.chars.reduce((s, c) => s + c.conf, 0) / g.chars.length,
    }));
    const snapped = snapWords(named, crop.seg, crop.proj).map((word, i) => ({ ...word, conf: named[i].conf }));
    const capH = crop.seg.ink ? crop.seg.ink.base - crop.seg.ink.top : 0;
    const words = capH ? joinNumberWords(snapped, 0.35 * capH) : snapped;
    const boxPt = { x0: crop.box.x0 / scaleX, y0: crop.box.y0 / scaleY, x1: crop.box.x1 / scaleX, y1: crop.box.y1 / scaleY };
    if (crop.seg.ink) {
      const ink = crop.seg.ink;
      const size = sizeFromInk(named.map((g) => g.text).join(""), (ink.bottom - ink.top) / scaleY) || boxPt.y1 - boxPt.y0;
      boxPt.y1 = ink.base / scaleY + 0.2 * size;
      boxPt.y0 = boxPt.y1 - size;
    }
    for (const word of words) {
      if (word.text) items.push(wordItem(word.text, word.x0 / scaleX, word.x1 / scaleX, boxPt, word.conf));
    }
  });
  if (lineBoxes.length) {
    const lineCrops = [];
    for (const box of lineBoxes) {
      const crop = prepareCrop(image, w, h, box);
      if (crop) lineCrops.push(crop);
    }
    items.push(...await readCrops(lineCrops, scaleX, scaleY, runRec, dict, signal));
  }
  return items;
}

function medianSize(items) {
  const sizes = items.filter((i) => /[A-Z0-9bdfhklt]/.test(i.str)).map((i) => i.transform[0]).sort((a, b) => a - b);
  return sizes.length ? sizes[sizes.length >> 1] : 0;
}

// Ink no det box covers (a lone "-" or "1" in a table cell) → blobs read on their own.
async function readOrphans(image, w, h, boxes, mask, items, scaleX, scaleY, runRec, dict, signal) {
  const emPt = medianSize(items);
  if (!emPt) return [];
  const em = emPt * scaleY;
  const covered = coverMask(boxes, w, h, Math.round(0.1 * em));
  const blobs = orphanBlobs(labelComponents(mask, w, h), covered, w, em);
  if (!blobs.length) return [];
  const crops = [];
  const out = [];
  const place = (text, blob, conf) => {
    const base = blobBaseline(blob, em) / scaleY;
    const box = { x0: blob.x0 / scaleX, x1: blob.x1 / scaleX, y1: base + 0.2 * emPt, y0: base - 0.8 * emPt };
    out.push(wordItem(text, box.x0, box.x1, box, conf));
  };
  for (const blob of blobs) {
    const dash = dashFromShape(blob, em);
    if (dash) { place(dash, blob, 1); continue; }
    const crop = cropRgb(image, w, h, blob.x0 - 1, blob.y0 - 1, blob.x1 + 1, blob.y1 + 1);
    if (crop.w < 1 || crop.h < 1) continue;
    const padY = Math.max(0, Math.round((1.2 * em - crop.h) / 2));
    const padded = padWhite(crop.rgb, crop.w, crop.h, Math.round(0.35 * em), padY);
    crops.push({ blob, resized: recResize(padded.rgb, padded.w, padded.h, REC_H) });
  }
  const reads = crops.length ? await recBatches(crops, runRec, signal) : [];
  crops.forEach((crop, k) => {
    const read = ctcText({ logits: reads[k].logits, time: reads[k].time, classes: reads[k].classes, dict });
    if (acceptOrphanRead(read.text, read.conf, crop.blob, em)) place(read.text.replace(/\s+/g, ""), crop.blob, read.conf);
  });
  return out;
}

// Returns { record, rgb, width, height, dpi } for the deskewed page (the cell re-read frame).
export async function preparePageImage({
  rgb, width, height, dpi = 300, pointW = null, pointH = null, page = 1, runDet, runRec, dict, signal,
  detLimit = DET_LIMIT, unclipRatio = 1.5, boxThresh = 0.5, split = true, gapRatio = 0.9, padRatio = 0.2, padYRatio = 0.1, whiteRatio = 0, orphans = true, localInk = true,
} = {}) {
  throwIfAborted(signal);
  const detOpts = { detLimit, unclipRatio, boxThresh };
  let image = rgb;
  let w = width;
  let h = height;
  let boxes = await detect(image, w, h, runDet, signal, detOpts);
  let deskew = 0;
  const tilt = dominantAngle(boxes);
  if (Math.abs(tilt) >= 0.15 && Math.abs(tilt) <= 8) {
    let bestResidual = Math.abs(tilt);
    for (const applied of [-tilt, tilt]) {
      const rotated = rotateRgb(image, w, h, applied);
      const again = await detect(rotated.rgb, rotated.w, rotated.h, runDet, signal, detOpts.chosenLimit ? { ...detOpts, detLimit: detOpts.chosenLimit } : detOpts);
      const residual = Math.abs(dominantAngle(again));
      if (residual + 0.02 < bestResidual) {
        bestResidual = residual;
        image = rotated.rgb;
        w = rotated.w;
        h = rotated.h;
        boxes = again;
        deskew = applied;
      }
    }
  }
  const scaleX = w / (pointW || (w * 72 / dpi));
  const scaleY = h / (pointH || (h * 72 / dpi));
  const ptW = pointW || w / (dpi / 72);
  const ptH = pointH || h / (dpi / 72);
  const gray = grayFromRgb(image, w, h);
  const rules = rulesFromCanvas(gray, w, h, scaleX);
  const ordered = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  let raw;
  if (split) {
    const mask = pageMask(gray);
    if (localInk) for (const box of ordered) localMask(gray, mask, w, h, box);
    raw = await readSegments(image, w, h, ordered, mask, scaleX, scaleY, runRec, dict, signal, { gapRatio, padRatio, padYRatio, whiteRatio });
    if (orphans) raw.push(...await readOrphans(image, w, h, ordered, mask, raw, scaleX, scaleY, runRec, dict, signal));
  } else {
    const crops = [];
    for (const box of ordered) {
      const crop = prepareCrop(image, w, h, box);
      if (crop) crops.push(crop);
    }
    raw = await readCrops(crops, scaleX, scaleY, runRec, dict, signal);
  }
  const items = snapOcrItems(raw);
  const frame = { rgb: image, width: w, height: h, dpi };
  await polishDirty(items, frame, page, runRec, dict, signal);
  return { record: pageRecord(page, items, rules, ptW, ptH, dpi, deskew), rgb: image, width: w, height: h, dpi };
}

// A first read of a ruling-line fragment often comes back as "C0" or "ODA". Read that word
// box again at 3× and keep the new text only when it is a clean number. A number that already
// parses, and a long label, stay as they are: the wider crop can pick up the rule.
async function polishDirty(items, frame, page, runRec, dict, signal) {
  const dirty = items.filter((item) => {
    const text = item.str.trim();
    // A lone dash or bullet is not a dirty number: read at 3× it came back "8".
    if (/^[-–—.•*·]+$/.test(text)) return false;
    return !CLEAN_NUM.test(text) && !LONG_WORD.test(text);
  });
  if (!dirty.length) return;
  const read = await recognizeCells({
    pages: new Map([[page, frame]]),
    cells: dirty.map((item) => ({
      page,
      bbox: [item.transform[4], item.y0, item.transform[4] + item.width, item.y1],
    })),
    runRec, dict, signal,
  });
  dirty.forEach((item, i) => {
    const text = (read.cells[i]?.text || "").trim();
    if (!CLEAN_NUM.test(text)) return;
    item.str = text;
    item.conf = bucketConf(read.cells[i].conf || 0);
  });
}

export async function recognizePageImage(opts) {
  return (await preparePageImage(opts)).record;
}

async function readCell(prep, cell, runRec, dict, signal) {
  throwIfAborted(signal);
  const scale = prep.dpi / 72;
  const [x0, y0, x1, y1] = cell.bbox;
  const crop = cropRgb(prep.rgb, prep.width, prep.height, (x0 - CELL_PAD_PT) * scale, (y0 - CELL_PAD_PT) * scale, (x1 + CELL_PAD_PT) * scale, (y1 + CELL_PAD_PT) * scale);
  const tight = cropRgb(prep.rgb, prep.width, prep.height, (x0 - CELL_TIGHT_PT) * scale, (y0 - CELL_TIGHT_PT) * scale, (x1 + CELL_TIGHT_PT) * scale, (y1 + CELL_TIGHT_PT) * scale);
  const glyph = tight.w >= 2 && tight.h >= 2 ? inkGlyph(grayFromRgb(tight.rgb, tight.w, tight.h), tight.w, tight.h) : null;
  if (crop.w < 2 || crop.h < 2) return { page: cell.page, bbox: cell.bbox, text: "", conf: 0, glyph };
  const scaled = resizeRgb(crop.rgb, crop.w, crop.h, crop.w * CELL_SCALE, crop.h * CELL_SCALE);
  const padded = padWhite(scaled.rgb, scaled.w, scaled.h, 8);
  const resized = recResize(padded.rgb, padded.w, padded.h, REC_H);
  const data = nchwNormalize(resized.rgb, resized.w, resized.h);
  const out = await runRec(data, [1, 3, resized.h, resized.w]);
  const contentT = Math.max(1, Math.min(out.time, Math.round(out.time * (resized.contentW || resized.w) / resized.w)));
  const slice = out.logits.subarray(0, contentT * out.classes);
  const text = ctcText({ logits: slice, time: contentT, classes: out.classes, dict });
  return { page: cell.page, bbox: cell.bbox, text: text.text, conf: text.conf, glyph };
}

// pages: Map of page number → { rgb, width, height, dpi } in the deskewed frame.
// cells: [{ page, bbox, ...caller fields }]. Returned cells stay in request order.
export async function recognizeCells({ pages, cells, runRec, dict, signal } = {}) {
  const out = [];
  for (const cell of cells || []) {
    const prep = pages?.get?.(cell.page);
    if (!prep) {
      out.push({ page: cell.page, bbox: cell.bbox, text: "", conf: 0, glyph: null });
      continue;
    }
    const read = await readCell(prep, cell, runRec, dict, signal);
    out.push(read);
  }
  return { cells: out };
}
