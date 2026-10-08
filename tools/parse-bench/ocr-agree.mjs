#!/usr/bin/env node
// Word-box agreement of the PP-OCR web source against a saved Vision fixture, plus ruling
// lines against the helper's OpenCV port.
//   node tools/parse-bench/ocr-agree.mjs [ocr-table.png] [ocr-table.vision.json]
//   node tools/parse-bench/ocr-agree.mjs --pdf file.pdf --vision vision-ocr.json [--page 1]
// A match is IoU >= 0.5 and the same text. Rules match when both ends are within 2 pt.
// The PNG fixture keeps Vision's raw tile observations; overlapping tiles read the same word
// twice (sometimes differently), so words are deduplicated by IoU >= 0.3, longest text kept.
// --vision takes the helper's merged pxd-ocr/1 output (plexus-parse-helper ocr --json).

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dictLines, MODEL_FILES } from "../../src/model/ocr/manifest.js";
import { rulesFromCanvas } from "../../src/model/ocr/rules-from-canvas.js";
import { grayFromRgb } from "../../src/model/ocr/image.js";
import { preparePageImage } from "../../src/model/ocr/recognize.js";
import { runDet, runRec } from "./ppocr-node.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const helperRoot = join(root, "tools/parse-helper");
const defaultPng = join(helperRoot, "tests/fixtures/ocr-table.png");
const defaultVision = join(helperRoot, "tests/fixtures/ocr-table.vision.json");

const LOAD_PY = `
import sys, struct
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
sys.stdout.buffer.write(struct.pack("<II", w, h))
sys.stdout.buffer.write(im.tobytes())
`;

const RULES_PY = `
import sys, json
sys.path.insert(0, sys.argv[2])
from PIL import Image
import numpy as np
from plexus_parse_helper.ocr import rules_from_image
im = Image.open(sys.argv[1]).convert("L")
dpi = int(sys.argv[3])
arr = np.asarray(im)
print(json.dumps(rules_from_image(arr, dpi / 72)))
`;

function loadPng(path) {
  const buf = execFileSync("python3", ["-c", LOAD_PY, path], { maxBuffer: 64 * 1024 * 1024 });
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  const rgb = new Uint8Array(buf.subarray(8));
  if (rgb.length !== width * height * 3) throw new Error(`png ${path}: ${rgb.length} bytes`);
  return { rgb, width, height };
}

function visionWords(fixture) {
  const scale = fixture.dpi / 72;
  const words = [];
  for (const tile of fixture.tiles || []) {
    const [tx0, ty0, tx1, ty1] = tile.tile;
    const tw = tx1 - tx0;
    const th = ty1 - ty0;
    for (const obs of tile.observations || []) {
      for (const [text, box] of obs.words || []) {
        const [bx, by, bw, bh] = box;
        const x0 = (tx0 + bx * tw) / scale;
        const x1 = (tx0 + (bx + bw) * tw) / scale;
        const y0 = (ty0 + (1 - by - bh) * th) / scale;
        const y1 = (ty0 + (1 - by) * th) / scale;
        words.push({ text, x0, y0, x1, y1 });
      }
    }
  }
  return words;
}

export function dedupeWords(words) {
  const kept = [];
  for (const word of [...words].sort((a, b) => b.text.length - a.text.length)) {
    if (kept.some((other) => iou(other, word) >= 0.3)) continue;
    kept.push(word);
  }
  return kept;
}

function recordWords(record) {
  return record.items.map(itemBox);
}

function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function itemBox(item) {
  return {
    text: item.str,
    x0: item.transform[4],
    y0: item.y0,
    x1: item.transform[4] + item.width,
    y1: item.y1,
  };
}

function matchWords(vision, ours, sameText = true) {
  const pairs = [];
  for (let v = 0; v < vision.length; v++) {
    for (let o = 0; o < ours.length; o++) {
      if (sameText && vision[v].text !== ours[o].text) continue;
      const score = iou(vision[v], ours[o]);
      if (score >= 0.5) pairs.push({ v, o, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedV = new Set();
  const usedO = new Set();
  let matched = 0;
  for (const pair of pairs) {
    if (usedV.has(pair.v) || usedO.has(pair.o)) continue;
    usedV.add(pair.v);
    usedO.add(pair.o);
    matched++;
  }
  return matched;
}

function ruleClose(a, b) {
  return Math.abs(a.x0 - b.x0) <= 2 && Math.abs(a.y0 - b.y0) <= 2
    && Math.abs(a.x1 - b.x1) <= 2 && Math.abs(a.y1 - b.y1) <= 2;
}

function matchRules(helper, ours) {
  const used = new Set();
  let matched = 0;
  for (const rule of helper) {
    const hit = ours.findIndex((other, i) => !used.has(i) && ruleClose(rule, other));
    if (hit >= 0) { used.add(hit); matched++; }
  }
  return matched;
}

async function mainPdf(pdfPath, visionPath, page) {
  const { createPpocrSource } = await import("./ppocr-node.mjs");
  const vision = recordWords(JSON.parse(readFileSync(visionPath, "utf8")).pages.find((p) => p.n === page));
  const source = createPpocrSource({ pdfPath, dpi: 300 });
  const t0 = performance.now();
  const record = (await source.ocr({ pages: [page] })).pages[0];
  const ms = performance.now() - t0;
  const ours = recordWords(record);
  const matched = matchWords(vision, ours);
  const boxes = matchWords(vision, ours, false);
  const agreement = vision.length ? matched / vision.length : 0;
  process.stdout.write([
    `words vision ${vision.length} ours ${ours.length} matched ${matched}, boxes only ${boxes}`,
    `agreement ${(agreement * 100).toFixed(1)}% (IoU>=0.5 and equal text), boxes ${(100 * boxes / Math.max(1, vision.length)).toFixed(1)}% (IoU>=0.5), ${ms.toFixed(0)} ms`,
  ].join("\n") + "\n");
  if (agreement < 0.95) process.exitCode = 1;
}

async function main(argv) {
  const pdfAt = argv.indexOf("--pdf");
  if (pdfAt >= 0) {
    const visionAt = argv.indexOf("--vision");
    const pageAt = argv.indexOf("--page");
    return mainPdf(argv[pdfAt + 1], argv[visionAt + 1], pageAt >= 0 ? Number(argv[pageAt + 1]) : 1);
  }
  const pngPath = argv[0] || defaultPng;
  const visionPath = argv[1] || defaultVision;
  const fixture = JSON.parse(readFileSync(visionPath, "utf8"));
  const image = loadPng(pngPath);
  const dpi = fixture.dpi || 300;
  const dict = dictLines(readFileSync(join(root, "assets/ocr", MODEL_FILES.dict.file), "utf8"));
  const pointW = image.width * 72 / dpi;
  const pointH = image.height * 72 / dpi;
  const prep = await preparePageImage({
    ...image, dpi, pointW, pointH, page: 1, runDet, runRec, dict,
  });
  const vision = dedupeWords(visionWords(fixture));
  const ours = prep.record.items.map(itemBox);
  const matched = matchWords(vision, ours);
  const agreement = vision.length ? matched / vision.length : 0;
  const helperRules = JSON.parse(execFileSync("python3", ["-c", RULES_PY, pngPath, helperRoot, String(dpi)], { encoding: "utf8" }));
  const gray = grayFromRgb(image.rgb, image.width, image.height);
  const jsRules = rulesFromCanvas(gray, image.width, image.height, dpi / 72);
  const rulesHit = matchRules(helperRules, jsRules);
  process.stdout.write([
    `words vision ${vision.length} ours ${ours.length} matched ${matched}`,
    `agreement ${(agreement * 100).toFixed(1)}% (IoU>=0.5 and equal text)`,
    `rules helper ${helperRules.length} js ${jsRules.length} within 2pt ${rulesHit}`,
  ].join("\n") + "\n");
  if (agreement < 0.95) process.exitCode = 1;
  if (rulesHit < helperRules.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
