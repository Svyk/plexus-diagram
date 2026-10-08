// Module worker for PP-OCR. The page renders; this thread runs det, rec, rules, and cell crops.
// The page starts it from a blob URL of the SHA-checked bundle (a Pages URL is cross-origin on
// roamresearch.com). ORT is imported from a blob URL the page already verified. esbuild must
// leave that import dynamic. An abort stops the running job only; the next message starts fresh.

import { dictLines } from "../model/ocr/manifest.js";
import { preparePageImage, recognizeCells } from "../model/ocr/recognize.js";
import { createOrtRunners } from "./ocr-ort.js";

const pages = new Map();
let runners = null;
let dict = null;
let controller = new AbortController();

function fail(id, error) {
  self.postMessage({ type: "error", id, message: error?.message || String(error) });
}

async function onInit(msg) {
  const ort = await import(msg.ortUrl);
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = { mjs: msg.wasmMjsUrl, wasm: msg.wasmUrl };
    if (typeof crossOriginIsolated === "undefined" || !crossOriginIsolated) ort.env.wasm.numThreads = 1;
  }
  runners = await createOrtRunners(ort, msg.det, msg.rec);
  dict = dictLines(msg.dictText);
  self.postMessage({ type: "ready", id: msg.id });
}

async function onPage(msg) {
  const rgb = new Uint8Array(msg.rgb);
  const prep = await preparePageImage({
    rgb, width: msg.width, height: msg.height, dpi: msg.dpi, pointW: msg.pointW, pointH: msg.pointH,
    page: msg.n, runDet: runners.runDet, runRec: runners.runRec, dict,
    signal: controller.signal,
  });
  pages.set(msg.n, prep);
  self.postMessage({ type: "page", id: msg.id, record: prep.record });
}

async function onCells(msg) {
  const result = await recognizeCells({
    pages, cells: msg.cells, runRec: runners.runRec, dict, signal: controller.signal,
  });
  self.postMessage({ type: "cells", id: msg.id, cells: result.cells });
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === "abort") { controller.abort(); return; }
  if (msg.type === "forget") { pages.clear(); return; }
  if (msg.type === "init" || controller.signal.aborted) controller = new AbortController();
  const run = msg.type === "init" ? onInit(msg) : msg.type === "page" ? onPage(msg) : msg.type === "cells" ? onCells(msg) : null;
  if (run) run.catch((error) => fail(msg.id, error));
};
