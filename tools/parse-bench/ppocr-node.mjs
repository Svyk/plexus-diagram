// Node bench runner for the same PP-OCRv5 mobile models the browser fetches.
// Renders with pypdfium2 (the helper's renderer) and runs onnxruntime-node.
// Not imported by the extension or by test/*.test.js (CI installs with --ignore-scripts).

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LEXICON_FILE, MODEL_FILES, SCHEMA, dictLines } from "../../src/model/ocr/manifest.js";
import { parseLexicon } from "../../src/model/ocr/lexicon.js";
import { preparePageImage, recognizeCells } from "../../src/model/ocr/recognize.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const modelDir = join(root, "assets/ocr");

const RENDER_PY = `
import sys, struct, pypdfium2 as pdfium
pdf = pdfium.PdfDocument(sys.argv[1])
n = int(sys.argv[2]); dpi = int(sys.argv[3])
page = pdf[n - 1]
w_pt = float(page.get_width()); h_pt = float(page.get_height())
img = page.render(scale=dpi / 72).to_pil().convert("RGB")
w, h = img.size
sys.stdout.buffer.write(struct.pack("<IIddI", w, h, w_pt, h_pt, len(pdf)))
sys.stdout.buffer.write(img.tobytes())
`;

let detSession = null;
let recSession = null;
let dict = null;
let ort = null;

async function sessions() {
  if (detSession) return;
  ort = await import("onnxruntime-node");
  // PXD_OCR_MODELS (JSON {det, rec, dict} paths) swaps in other PP-OCR exports for a comparison
  // run, e.g. the PP-OCRv5 server det/rec. The shipped manifest files are the default.
  const alt = JSON.parse(process.env.PXD_OCR_MODELS || "{}");
  detSession = await ort.InferenceSession.create(alt.det || join(modelDir, MODEL_FILES.det.file));
  recSession = await ort.InferenceSession.create(alt.rec || join(modelDir, MODEL_FILES.rec.file));
  dict = dictLines(readFileSync(alt.dict || join(modelDir, MODEL_FILES.dict.file), "utf8"));
}

export async function runDet(data, dims) {
  await sessions();
  const out = await detSession.run({ x: new ort.Tensor("float32", data, dims) });
  return out.fetch_name_0.data;
}

export async function runRec(data, dims) {
  await sessions();
  const out = await recSession.run({ x: new ort.Tensor("float32", data, dims) });
  const tensor = out.fetch_name_0;
  return { logits: tensor.data, batch: tensor.dims[0], time: tensor.dims[1], classes: tensor.dims[2] };
}

// The shipped word list (assets/ocr), as the browser gets it after the SHA check.
export function loadLexicon() {
  return parseLexicon(gunzipSync(readFileSync(join(modelDir, LEXICON_FILE.file))).toString("utf8"));
}

export function renderPdfPage(pdfPath, n, dpi) {
  const buf = execFileSync("python3", ["-c", RENDER_PY, pdfPath, String(n), String(dpi)], {
    maxBuffer: 128 * 1024 * 1024,
  });
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  const pointW = buf.readDoubleLE(8);
  const pointH = buf.readDoubleLE(16);
  const pageCount = buf.readUInt32LE(24);
  const rgb = new Uint8Array(buf.subarray(28));
  if (rgb.length !== width * height * 3) throw new Error(`render ${pdfPath} p${n}: ${rgb.length} bytes, expected ${width}x${height}`);
  return { rgb, width, height, pointW, pointH, pageCount, dpi };
}

// PXD_OCR_OPTS (JSON) overrides preparePageImage options for bench sweeps, e.g. {"detLimit":2560}.
export function createPpocrSource({ pdfPath, dpi = 300, log = () => {}, options = {} } = {}) {
  options = { ...JSON.parse(process.env.PXD_OCR_OPTS || "{}"), ...options };
  const prepared = new Map();
  let pageCount = 0;

  async function pageOf(n, signal) {
    if (prepared.has(n)) return prepared.get(n);
    await sessions();
    const rendered = renderPdfPage(pdfPath, n, dpi);
    pageCount = rendered.pageCount || pageCount;
    const t0 = performance.now();
    const prep = await preparePageImage({
      ...rendered, dpi, page: n, runDet, runRec, dict, signal, ...options,
    });
    log(`ppocr-web p${n} ${(performance.now() - t0).toFixed(0)} ms  items ${prep.record.items.length}  rules ${prep.record.rules.length}  deskew ${prep.record.deskew}`);
    prepared.set(n, prep);
    return prep;
  }

  return {
    async health() {
      return { state: "ready", schema: SCHEMA, engine: "ppocr-web" };
    },
    async ocr({ pages, cells, sha256 = null, signal } = {}) {
      const t0 = performance.now();
      if (cells?.length) {
        const need = [...new Set(cells.map((c) => c.page))];
        for (const n of need) await pageOf(n, signal);
        const result = await recognizeCells({ pages: prepared, cells, runRec, dict, signal });
        return { schema: SCHEMA, engine: "ppocr-web", cells: result.cells, elapsedMs: Math.round(performance.now() - t0) };
      }
      const wanted = pages?.length ? pages : [1];
      const out = [];
      for (const n of wanted) out.push((await pageOf(n, signal)).record);
      return {
        schema: SCHEMA, engine: "ppocr-web", pageCount: pageCount || out.length, pages: out,
        sha256, elapsedMs: Math.round(performance.now() - t0),
      };
    },
  };
}
