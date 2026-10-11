import assert from "node:assert/strict";
import test from "node:test";

import { createPartsIndex } from "../src/host/parts-index.js";
import { createParseStore, subscribeParseStored } from "../src/host/parse-store.js";
import { buildFocusContext, isGenericQuestion } from "../src/model/ai-context.js";
import { PARSE_REV } from "../src/model/parse/index.js";
import { openAskAI } from "../src/view/ask-ai.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const URL_A = "https://x/a.pdf";

function parsedDoc(sha, text) {
  return {
    schema: "pxd-parse/1",
    engine: "builtin",
    sha256: sha,
    parseRev: PARSE_REV,
    options: { ocr: "none", formula: false, tables: "builtin" },
    pages: [{ n: 1 }],
    order: ["h", "p"],
    blocks: {
      h: { id: "h", type: "heading", level: 1, page: 1, text: "Intro" },
      p: { id: "p", type: "para", page: 1, text },
    },
  };
}

// L1 ----------------------------------------------------------------------------------------------
test("L1 a parse stored after the index was built is found by the next get() without invalidate()", async () => {
  const store = createParseStore({});
  const index = createPartsIndex({ store, listPdfs: () => [{ url: URL_A, uid: "u1" }] });
  try {
    assert.equal((await index.get()).length, 0);
    await store.indexUrl(URL_A, { sha256: "s1", pageCount: 1 });
    await store.putParse(parsedDoc("s1", "Swab limit is zero CFU."));
    const rows = await index.get();
    assert.ok(rows.some((r) => /Swab limit/.test(r.text)));
  } finally { index.dispose(); }
});

test("L1 storing a new parse drops only that sha's cached rows and tells onChange listeners", async () => {
  const store = createParseStore({});
  const index = createPartsIndex({ store, listPdfs: () => [{ url: URL_A, uid: "u1" }] });
  const seen = [];
  index.onChange((info) => seen.push(info.sha256));
  try {
    await store.indexUrl(URL_A, { sha256: "s1", pageCount: 1 });
    await store.putParse(parsedDoc("s1", "first text"));
    await index.get();
    assert.ok(index.size() > 0);
    await store.putParse(parsedDoc("s2", "other"));
    assert.equal(index.size(), 0);
    assert.deepEqual(seen, ["s1", "s2"]);
  } finally { index.dispose(); }
});

test("L1 one shared parse-store listener: disposed indexes stop listening and a failed write notifies nobody", async () => {
  const store = createParseStore({});
  const calls = [];
  const off = subscribeParseStored((info) => calls.push(info));
  const a = createPartsIndex({ store, listPdfs: () => [] });
  const b = createPartsIndex({ store, listPdfs: () => [] });
  let hits = 0;
  b.onChange(() => { hits += 1; });
  await store.putParse(parsedDoc("s1", "x"));
  assert.equal(calls.length, 1);
  assert.equal(hits, 1);
  b.dispose();
  await store.putParse(parsedDoc("s2", "y"));
  assert.equal(hits, 1);
  assert.equal(await store.putParse({ engine: "builtin" }), null);
  assert.equal(calls.length, 2);
  a.dispose();
  off();
  await store.putParse(parsedDoc("s3", "z"));
  assert.equal(calls.length, 2);
});

// L2 ----------------------------------------------------------------------------------------------
function bigDoc(pages = 300) {
  const blocks = {};
  const order = [];
  const add = (b) => { blocks[b.id] = b; order.push(b.id); };
  add({ id: "title", type: "heading", level: 1, page: 1, text: "Plant Study" });
  add({ id: "first", type: "para", page: 1, text: "This study covers the plant." });
  for (let p = 1; p <= pages; p += 1) {
    if (p % 30 === 1) add({ id: `sec${p}`, type: "heading", level: 2, page: p, text: `Chapter ${Math.ceil(p / 30)}` });
    for (let k = 0; k < 6; k += 1) {
      add({ id: `p${p}_${k}`, type: "para", page: p, text: `Filler sentence number ${p} ${k} about production lines and routine staffing records.` });
    }
  }
  blocks[`p${pages - 3}_2`].text = "The zirconium sensor drifted by 4 percent after calibration.";
  add({ id: "tab", type: "table", page: 200, cells: [{ r: 0, c: 0, text: "Quartz" }, { r: 0, c: 1, text: "17" }] });
  add({ id: "tabcap", type: "caption", for: "tab", page: 200, text: "Table 9. Quartz yield" });
  return { schema: "pxd-parse/1", pages: Array.from({ length: pages }, (_, i) => ({ n: i + 1 })), order, blocks };
}

test("L2 a question finds a paragraph deep in the document that the opening pages never reach", () => {
  const doc = bigDoc();
  const out = buildFocusContext(doc, { wholeDoc: true }, { question: "How far did the zirconium sensor drift?" });
  assert.match(out.context, /=== Relevant parts of the document ===/);
  assert.match(out.context, /Paragraph \[p\. 297\] The zirconium sensor drifted by 4 percent/);
  assert.match(out.context, /Plant Study/);
  assert.match(out.context, /This study covers the plant\./);
  assert.ok(out.tokensEstimate <= 12000);
  assert.match(out.instructions, /not the whole document/);
  assert.doesNotMatch(out.instructions, /opening pages/);
});

test("L2 a selected table brings its caption", () => {
  const out = buildFocusContext(bigDoc(), { wholeDoc: true }, { question: "quartz yield" });
  assert.match(out.context, /Table \[p\. 200\] Caption: Table 9\. Quartz yield/);
  assert.match(out.context, /17/);
});

test("L2 retrieval is stable in reading order and the same question gives the same context", () => {
  const doc = bigDoc();
  const a = buildFocusContext(doc, { wholeDoc: true }, { question: "zirconium quartz" });
  const b = buildFocusContext(doc, { wholeDoc: true }, { question: "zirconium quartz" });
  assert.equal(a.context, b.context);
  assert.ok(a.context.indexOf("Paragraph [p. 297]") < a.context.indexOf("Caption: Table 9"));
});

test("L2 generic and empty questions fall back to a spread over the sections", () => {
  assert.equal(isGenericQuestion(""), true);
  assert.equal(isGenericQuestion("Summarize this document in plain language."), true);
  assert.equal(isGenericQuestion("What was the zirconium drift?"), false);
  const doc = bigDoc();
  for (const question of ["", "Summarize this document in three to five sentences."]) {
    const out = buildFocusContext(doc, { wholeDoc: true }, { question });
    assert.match(out.context, /Paragraph \[p\. 31\] Filler/, "first paragraph under chapter 2");
    assert.match(out.context, /Paragraph \[p\. 271\] Filler/, "first paragraph under the last chapter");
    assert.match(out.context, /Caption: Table 9\. Quartz yield/);
  }
});

test("L2 retrieval over a 300-page document takes under 30 ms", () => {
  const doc = bigDoc(300);
  buildFocusContext(doc, { wholeDoc: true }, { question: "warm up" });
  const t0 = performance.now();
  buildFocusContext(doc, { wholeDoc: true }, { question: "zirconium sensor drift calibration" });
  const ms = performance.now() - t0;
  assert.ok(ms < 30, `retrieval took ${ms.toFixed(1)} ms`);
});

test("L2 the dialog rebuilds the context from the current question on Send and in the preview", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const sent = [];
    const w = {
      AbortController,
      addEventListener() {},
      removeEventListener() {},
      LiveAI_API: {
        isAvailable: () => true,
        listModels: () => [{ id: "m1", name: "M1", provider: "P", isDefault: true }],
        getDefaultModel: () => "m1",
        generate: async (req) => { sent.push(req); return { text: "ok", model: "m1" }; },
      },
    };
    const dialog = openAskAI({ doc: bigDoc(), wholeDoc: true, document: globalThis.document, window: w });
    const find = (node, cls) => {
      if (node.className?.split?.(" ").includes(cls)) return node;
      for (const kid of node.children || []) { const hit = find(kid, cls); if (hit) return hit; }
      return null;
    };
    const area = find(dialog.el, "pxd-ask__question");
    area.value = "How far did the zirconium sensor drift?";
    stub.dispatch(area, "input", {});
    stub.dispatch(find(dialog.el, "pxd-ask__chip"), "click", {});
    assert.match(find(dialog.el, "pxd-ask__preview").textContent, /zirconium sensor drifted/);
    area.value = "What is the quartz yield?";
    stub.dispatch(find(dialog.el, "pxd-ask__send"), "click", {});
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1);
    const payload = JSON.stringify(sent[0]);
    assert.match(payload, /Quartz yield/);
    assert.doesNotMatch(payload, /zirconium sensor drifted/);
    dialog.close();
  } finally { restore(); }
});
