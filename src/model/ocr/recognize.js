// Page and cell OCR with injected det/rec runners, so the browser worker and the node bench
// share one pipeline. runDet(data, dims) → Float32Array probability map (H*W).
// runRec(data, dims) → { logits, time, classes, batch? } for a batch of NCHW crops.

import { boxesFromProb, dominantAngle } from "./db-boxes.js";
import { cropRgb, detResize, grayFromRgb, nchwNormalize, padWhite, recResize, resizeRgb, rotateRgb } from "./image.js";
import { inkGlyph, rulesFromCanvas } from "./rules-from-canvas.js";
import { bucketConf, ctcText, round2, snapOcrItems, wordsFromCtc } from "./words-from-ctc.js";

const DET_LIMIT = 960;
const REC_H = 48;
const BATCH = 8;
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

async function detect(rgb, width, height, runDet, signal, { detLimit = DET_LIMIT, unclipRatio = 1.5, boxThresh = 0.6 } = {}) {
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
    data.fill(1);
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

// Returns { record, rgb, width, height, dpi } for the deskewed page (the cell re-read frame).
export async function preparePageImage({
  rgb, width, height, dpi = 300, pointW = null, pointH = null, page = 1, runDet, runRec, dict, signal,
  detLimit = DET_LIMIT, unclipRatio = 1.5, boxThresh = 0.6,
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
      const again = await detect(rotated.rgb, rotated.w, rotated.h, runDet, signal, detOpts);
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
  const crops = [];
  for (const box of ordered) {
    const crop = prepareCrop(image, w, h, box);
    if (crop) crops.push(crop);
  }
  const items = snapOcrItems(await readCrops(crops, scaleX, scaleY, runRec, dict, signal));
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
