#!/usr/bin/env node
// Live check for the in-browser OCR source. The orchestrator runs this after the branch
// is loaded in Readwisenotes. This file does not inject, unload, reload, or write blocks.
//
//   node tools/live/ocr-web-check.mjs <file.pdf> [--page 1] [--title Readwisenotes]
//
// It bundles src/host/ocr-web.js, serves the models on 127.0.0.1, and evaluates the source
// against the PDF bytes in the Roam window. Refuses a Svy window and "plx typing bench".

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT_CDP = process.env.CDP_PORT || 9223;

function takeArgs(argv) {
  const out = { page: 1, title: "Readwisenotes" };
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--page") out.page = Number(argv[++i]);
    else if (a === "--title") out.title = argv[++i];
    else if (!a.startsWith("--")) files.push(a);
  }
  out.pdf = files[0] ? resolve(files[0]) : null;
  return out;
}

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT_CDP}/json`);
  return (await res.json()).filter((t) => t.type === "page");
}

function connect(url) {
  return new Promise((resolveWs, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolveWs(ws);
    ws.onerror = reject;
  });
}

let nextId = 1;
function rpc(ws, method, params) {
  const id = nextId++;
  return new Promise((resolveRpc) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { ws.removeEventListener("message", onMsg); resolveRpc(msg.result || msg); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await rpc(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(String(result.exceptionDetails.exception?.description || "eval failed").slice(0, 800));
  }
  return result.result?.value;
}

function serve(files) {
  const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".txt": "text/plain" };
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      const body = files.get(path);
      if (!body) { res.writeHead(404); res.end("missing"); return; }
      res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream", "access-control-allow-origin": "*" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

async function bundle() {
  const page = await build({
    absWorkingDir: root,
    entryPoints: ["src/host/ocr-web.js"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    legalComments: "none",
    logLevel: "silent",
  });
  const worker = await build({
    absWorkingDir: root,
    entryPoints: ["src/host/ocr-web-worker.js"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    legalComments: "none",
    logLevel: "silent",
  });
  return {
    page: page.outputFiles[0].contents,
    worker: worker.outputFiles[0].contents,
  };
}

const args = takeArgs(process.argv.slice(2));
if (!args.pdf) {
  process.stderr.write("usage: ocr-web-check.mjs <file.pdf> [--page 1] [--title Readwisenotes]\n");
  process.exit(2);
}

const pages = await targets();
const hit = pages.find((t) => (t.title || "").includes(args.title));
if (!hit) throw new Error(`no CDP page matching ${args.title}`);
if (/plx typing bench/i.test(hit.title || "") || /\bSvy\b/.test(hit.title || "")) {
  throw new Error(`refusing window ${hit.title}`);
}

const built = await bundle();
const files = new Map([
  ["/ocr-web.js", built.page],
  ["/assets/ocr/ocr-worker.js", built.worker],
]);
for (const name of ["ch_PP-OCRv5_det_mobile.onnx", "en_PP-OCRv5_rec_mobile.onnx", "ppocrv5_en_dict.txt"]) {
  files.set(`/assets/ocr/${name}`, readFileSync(join(root, "assets/ocr", name)));
}
const server = await serve(files);
const origin = `http://127.0.0.1:${server.address().port}`;
const pdfB64 = readFileSync(args.pdf).toString("base64");
const ws = await connect(hit.webSocketDebuggerUrl);
try {
  const expression = `import(${JSON.stringify(`${origin}/ocr-web.js`)}).then(async (mod) => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(pdfB64)}), (c) => c.charCodeAt(0));
    const source = mod.createOcrWeb({ assetBase: ${JSON.stringify(`${origin}/`)}, workerUrl: ${JSON.stringify(`${origin}/assets/ocr/ocr-worker.js`)} });
    const health = await source.health();
    if (health.state !== "cold") throw new Error("health fetched early: " + health.state);
    const t0 = performance.now();
    const result = await source.ocr({ bytes, pages: [${args.page}] });
    const cold = performance.now() - t0;
    const t1 = performance.now();
    const again = await source.ocr({ bytes, pages: [${args.page}] });
    return {
      health, coldMs: Math.round(cold), warmMs: Math.round(performance.now() - t1),
      items: result.pages?.[0]?.items?.length ?? 0,
      rules: result.pages?.[0]?.rules?.length ?? 0,
      deskew: result.pages?.[0]?.deskew ?? null,
      sample: (result.pages?.[0]?.items || []).slice(0, 12).map((item) => item.str),
      warmItems: again.pages?.[0]?.items?.length ?? 0,
    };
  })`;
  const value = await evaluate(ws, expression);
  process.stdout.write(`${JSON.stringify(value, null, 1)}\n`);
} finally {
  try { ws.close(); } catch { /* socket */ }
  server.close();
}
