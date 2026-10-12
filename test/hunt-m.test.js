// WO M bug hunt (3.22 → 3.25 + filter browse): one test per fixed matrix row (~/wo/pxd-r6/hunt-matrix.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPdfNames, IDENTS_KEY, RETRY_NO_LIB_MS } from "../src/view/pdf-names.js";

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const idle = (fn) => { const id = setTimeout(fn, 0); return () => clearTimeout(id); };
function memStore() {
  const meta = new Map();
  return { meta, getMeta: async (k) => meta.get(k) ?? null, putMeta: async (k, v) => { meta.set(k, v); return true; } };
}

test("N1: no pdf.js worker yet → the url is retried soon and never saved as failed", async () => {
  const store = memStore();
  let clock = 1000;
  let ready = false;
  const reads = [];
  const names = createPdfNames({
    store,
    lib: () => (ready ? {} : null),
    read: async (lib, url) => { reads.push(url); return { title: `T ${url}` }; },
    idle,
    now: () => clock,
  });
  await names.want(["a"]);
  await tick(10);
  assert.equal(reads.length, 0, "nothing to read with");
  assert.equal(names.known("a"), true, "not re-queued in a loop");
  assert.equal(names.get("a"), null);
  await tick(10);
  assert.equal(store.meta.get(IDENTS_KEY)?.items?.a, undefined, "the miss is not persisted");
  ready = true;
  clock += RETRY_NO_LIB_MS + 1;
  assert.equal(names.known("a"), false, "retried once Roam's reader has loaded pdf.js");
  await names.want(["a"]);
  for (let i = 0; i < 20 && !names.get("a"); i += 1) await tick(5);
  assert.deepEqual(reads, ["a"]);
  assert.equal(names.get("a").title, "T a");
});

test("N2: the name reader is disposed with the board; dispose flushes the pending save and refuses new work", async () => {
  assert.match(src("view/board-view.js"), /step\(\(\) => pdfNames\?\.dispose\(\)\);\s*\n\s*step\(\(\) => panel\.dispose\(\)\);/);
  const store = memStore();
  const reads = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const names = createPdfNames({
    store,
    lib: () => ({}),
    read: async (lib, url) => { reads.push(url); if (url === "b") await gate; return { title: url }; },
    idle: (fn) => { const id = setTimeout(fn, 50); return () => clearTimeout(id); },
  });
  await names.want(["a", "b", "c"]);
  for (let i = 0; i < 40 && reads.length < 2; i += 1) await tick(10);
  names.dispose();
  release();
  await tick(5);
  assert.ok(store.meta.get(IDENTS_KEY)?.items?.a, "a's identity written at dispose, not lost with the idle save");
  assert.equal(await names.want(["d"]), 0);
  await tick(120);
  assert.deepEqual(reads, ["a", "b"], "c and d are never read after dispose");
});

test("K1: Ask AI from the reader pane and the parse view names the PDF through the board's resolver", async () => {
  const { setPdfNameResolver, pdfNameFor } = await import("../src/model/pdf-name-for.js");
  assert.match(src("view/read-pane.js"), /openAskAI\(\{\s*\.\.\.spec,\s*document: doc,\s*pdfName: \(\) => pdfNameFor\(current\.cardUid\) \|\| pdfNameFor\(pdfUrl\(\)\)/);
  assert.match(src("view/parse-view.js"), /pdfName: \(\) => pdfNameFor\(currentUid\) \|\| pdfNameFor\(currentUrl\)/);
  const off = setPdfNameResolver((key) => (key === "https://x.test/a.pdf" ? "Real Paper Title" : key === "card" ? "PDF" : ""));
  try {
    assert.equal(pdfNameFor("card") || pdfNameFor("https://x.test/a.pdf"), "Real Paper Title", "a bare 'PDF' card name falls through to the url");
  } finally { off(); }
});
