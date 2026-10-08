import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { createAnydocHost, ANYDOC_CACHE, ANYDOC_ORIGIN } from "../src/host/anydoc.js";
import { ANYDOC_MANIFEST } from "../src/host/anydoc-manifest.js";

const assetUrl = (name) => new URL(`../assets/anydoc/${name}`, import.meta.url);

test("the host module does not fetch until convert", async () => {
  const source = await readFile(new URL("../src/host/anydoc.js", import.meta.url), "utf8");
  const head = source.split("export function createAnydocHost")[0];
  assert.equal(head.includes("fetch("), false);
  assert.match(source, new RegExp(ANYDOC_CACHE));
  let called = 0;
  const host = createAnydocHost({
    fetch: async () => { called += 1; return new Response(new Uint8Array()); },
    caches: null,
    engine: { init: async () => {}, toMarkdownBytes: () => "" },
  });
  assert.equal(host.fetchCount, 0);
  assert.equal(called, 0);
});

test("a hash mismatch is not cached", async () => {
  const puts = [];
  const host = createAnydocHost({
    fetch: async () => new Response(new Uint8Array([1, 2, 3])),
    caches: {
      async open() {
        return {
          async match() { return undefined; },
          async put(url) { puts.push(String(url)); },
        };
      },
    },
    engine: { init: async () => {}, toMarkdownBytes: () => "nope" },
  });
  await assert.rejects(
    () => host.convert(new Uint8Array([9]), "docx"),
    (err) => err?.code === "hash",
  );
  assert.equal(puts.length, 0);
  assert.equal(host.fetchCount, 1);
});

test("the second convert uses cache storage", async () => {
  const store = new Map();
  const files = new Map();
  for (const name of Object.keys(ANYDOC_MANIFEST.files)) {
    files.set(name, await readFile(assetUrl(name)));
  }
  let fetches = 0;
  const host = createAnydocHost({
    origin: ANYDOC_ORIGIN,
    fetch: async (url) => {
      fetches += 1;
      const name = String(url).split("/").pop();
      return new Response(files.get(name));
    },
    caches: {
      async open(name) {
        assert.equal(name, ANYDOC_CACHE);
        return {
          async match(url) {
            const hit = store.get(String(url));
            return hit ? new Response(hit) : undefined;
          },
          async put(url, response) {
            store.set(String(url), new Uint8Array(await response.arrayBuffer()));
          },
        };
      },
    },
    engine: { init: async () => {}, toMarkdownBytes: () => "# Cached" },
  });
  const first = await host.convert(new Uint8Array([1]), "docx");
  assert.equal(first.markdown, "# Cached");
  assert.equal(host.fetchCount, 2);
  const second = await host.convert(new Uint8Array([1]), "csv");
  assert.equal(second.format, "csv");
  assert.equal(host.fetchCount, 2);
  assert.equal(fetches, 2);
  assert.equal(store.size, 2);
});

test("vendored bytes match the manifest", async () => {
  const json = JSON.parse(await readFile(assetUrl("manifest.json"), "utf8"));
  assert.deepEqual(json.files, JSON.parse(JSON.stringify(ANYDOC_MANIFEST.files)));
  for (const [name, spec] of Object.entries(ANYDOC_MANIFEST.files)) {
    const buf = await readFile(assetUrl(name));
    assert.equal(buf.byteLength, spec.bytes);
    assert.equal(createHash("sha256").update(buf).digest("hex"), spec.sha256);
  }
});

test("a built bundle keeps the wasm bytes out", async () => {
  const path = new URL("../extension.js", import.meta.url);
  let text;
  try { text = await readFile(path, "utf8"); } catch { return; }
  const spec = ANYDOC_MANIFEST.files["anydoc_wasm_bg.wasm"];
  if (!text.includes(spec.sha256)) return;
  const info = await stat(path);
  assert.ok(info.size < spec.bytes, `extension.js is ${info.size} bytes`);
  assert.equal(text.includes("AGFzbQ"), false);
});
