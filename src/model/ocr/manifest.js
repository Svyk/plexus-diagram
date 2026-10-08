// Pinned OCR assets. The extension bundle does not contain these bytes. createOcrWeb fetches
// them only from ocr(), checks these SHA-256 values, and stores the bodies in Cache Storage.

export const CACHE_NAME = "plexus-diagram-models";
export const SCHEMA = "pxd-ocr/1";
export const ENGINE = "ppocr-web";
export const PAGES_ORIGIN = "https://svyk.github.io/plexus-diagram/";
export const ORT_VERSION = "1.30.0";
export const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

export const LICENCE = {
  models: "Apache-2.0",
  runtime: "MIT",
  note: "PP-OCRv5 mobile det + English rec weights via RapidAI RapidOCR v3.9.2 (PaddleOCR). onnxruntime-web 1.30.0 is MIT.",
};

export const ORT_FILES = {
  mjs: {
    file: "ort.webgpu.bundle.min.mjs",
    sha256: "0730816731ce2cdfb06f273da065d4a1c7091eb9d1756a83b2916c8a89d015e2",
    bytes: 117732,
  },
  wasmMjs: {
    file: "ort-wasm-simd-threaded.jsep.mjs",
    sha256: "709853412fd1ffc34247af1e73569227b5b79629c5ca3f59cc39cf7e500e4947",
    bytes: 46851,
  },
  wasm: {
    file: "ort-wasm-simd-threaded.jsep.wasm",
    sha256: "3ad23231b5bd6d9dda55a7f84606315e0bf35b6750c28ee993c987c54cacab0f",
    bytes: 28312028,
  },
};

export const MODEL_FILES = {
  det: {
    file: "ch_PP-OCRv5_det_mobile.onnx",
    sha256: "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
    bytes: 4819576,
    url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx",
  },
  rec: {
    file: "en_PP-OCRv5_rec_mobile.onnx",
    sha256: "c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8",
    bytes: 7872351,
    url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx",
  },
  dict: {
    file: "ppocrv5_en_dict.txt",
    sha256: "e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6",
    bytes: 1416,
    url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/paddle/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile/ppocrv5_en_dict.txt",
  },
};

export function dictLines(text) {
  return String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
}

export function joinUrl(base, path) {
  return `${String(base || "").replace(/\/$/, "")}/${String(path || "").replace(/^\//, "")}`;
}
