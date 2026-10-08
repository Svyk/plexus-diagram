// Lazy anydoc loader. The glue is bundled so the extension never evaluates remote
// JavaScript. Both files are fetched from the Pages origin only when convert() runs,
// hashed against ANYDOC_MANIFEST, and cached in Cache Storage. The fetched glue is
// not executed: init receives the verified wasm bytes, so the glue's import.meta.url
// fallback never runs.

import init, { toMarkdownBytes } from "../../assets/anydoc/anydoc_wasm.js";
import { sha256Hex } from "../model/parse-hash.js";
import { ANYDOC_MANIFEST } from "./anydoc-manifest.js";

export const ANYDOC_CACHE = "plexus-diagram-models";
export const ANYDOC_VERSION = "0.2.4";
export const ANYDOC_ORIGIN = "https://svyk.github.io/plexus-diagram";

export function anydocAssetUrl(name, origin = ANYDOC_ORIGIN) {
  const base = String(origin || ANYDOC_ORIGIN).replace(/\/$/, "");
  return `${base}/assets/anydoc/${name}`;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

export function createAnydocHost({
  fetch: fetchImpl,
  caches: cachesImpl,
  origin = ANYDOC_ORIGIN,
  now,
  engine,
} = {}) {
  const fetchFn = fetchImpl || globalThis.fetch?.bind(globalThis);
  const cachesApi = cachesImpl === undefined ? globalThis.caches : cachesImpl;
  const clock = typeof now === "function" ? now : () => (
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now()
  );
  const glue = engine?.init || init;
  const convertBytes = engine?.toMarkdownBytes || toMarkdownBytes;
  let ready = null;
  let fetchCount = 0;

  async function openCache() {
    if (!cachesApi || typeof cachesApi.open !== "function") return null;
    try { return await cachesApi.open(ANYDOC_CACHE); } catch { return null; }
  }

  async function loadAsset(name) {
    const spec = ANYDOC_MANIFEST.files[name];
    if (!spec) {
      const err = new Error("hash");
      err.code = "hash";
      throw err;
    }
    const url = anydocAssetUrl(name, origin);
    const cache = await openCache();
    if (cache && typeof cache.match === "function") {
      try {
        const hit = await cache.match(url);
        if (hit) {
          const buf = asBytes(await hit.arrayBuffer());
          const hex = await sha256Hex(buf);
          if (hex === spec.sha256 && buf.byteLength === spec.bytes) return buf;
        }
      } catch { /* miss */ }
    }
    if (typeof fetchFn !== "function") {
      const err = new Error("fetch");
      err.code = "fetch";
      throw err;
    }
    fetchCount += 1;
    let res;
    try {
      res = await fetchFn(url, { mode: "cors", credentials: "omit" });
    } catch (err) {
      if (err && typeof err === "object" && !err.code) err.code = "fetch";
      throw err;
    }
    if (!res || !res.ok) {
      const err = new Error("fetch");
      err.code = "fetch";
      throw err;
    }
    const buf = asBytes(await res.arrayBuffer());
    const hex = await sha256Hex(buf);
    if (hex !== spec.sha256 || buf.byteLength !== spec.bytes) {
      const err = new Error("hash");
      err.code = "hash";
      throw err;
    }
    if (cache && typeof cache.put === "function") {
      try {
        const type = name.endsWith(".wasm") ? "application/wasm" : "text/javascript";
        await cache.put(url, new Response(buf, { headers: { "content-type": type } }));
      } catch { /* cache is optional */ }
    }
    return buf;
  }

  async function ensure() {
    if (ready) return ready;
    const pending = (async () => {
      await loadAsset("anydoc_wasm.js");
      const wasm = await loadAsset("anydoc_wasm_bg.wasm");
      await glue({ module_or_path: wasm });
    })();
    ready = pending;
    try {
      await pending;
    } catch (err) {
      if (ready === pending) ready = null;
      throw err;
    }
  }

  return {
    get fetchCount() { return fetchCount; },
    async convert(bytes, format) {
      await ensure();
      const t0 = clock();
      const view = asBytes(bytes);
      let markdown;
      try {
        markdown = convertBytes(view, format);
      } catch (err) {
        if (err && typeof err === "object" && !err.code) err.code = "convert";
        throw err;
      }
      const text = typeof markdown === "string" ? markdown : new TextDecoder().decode(asBytes(markdown));
      return { markdown: text, ms: clock() - t0, format };
    },
  };
}
