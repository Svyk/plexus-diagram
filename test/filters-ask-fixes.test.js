import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as liveai from "../src/host/liveai.js";
import { createPartsIndex } from "../src/host/parts-index.js";
import { PARSE_REV } from "../src/model/parse/index.js";
import { readableParse, restorableByUrl } from "../src/host/parse-store.js";
import { answerCardMarkdown, buildFocusContext, INSTRUCTIONS, parseAnswer } from "../src/model/ai-context.js";
import { blockDisplay, libraryCard } from "../src/model/library.js";
import { openAskAI, paintAnswer } from "../src/view/ask-ai.js";
import { createPanel } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const q = (root, sel) => root.querySelector(sel);

const DOC = {
  schema: "pxd-parse/1",
  engine: "builtin",
  sha256: "sha1",
  parseRev: 8,
  options: { ocr: "none" },
  pages: [{ n: 1 }],
  order: ["h", "p"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Intro" },
    p: { id: "p", type: "para", page: 1, text: "Swab limit is 0 CFU." },
  },
};

function fakeStore(rows, sha = "sha1") {
  return {
    findByUrl: async (url) => (url === "https://x/a.pdf" ? { sha256: sha } : null),
    listParses: async () => rows,
    getParse: async (_s, engine, hash) => rows.find((r) => r.engine === engine && r.optsHash === hash)?.doc || null,
  };
}

// 1. stale parses -------------------------------------------------------------------------------
test("readableParse accepts a stale built-in parse that restorableByUrl refuses", async () => {
  assert.ok(PARSE_REV > 8);
  const store = fakeStore([{ engine: "builtin", optsHash: "x", at: 1, doc: DOC }]);
  assert.equal(await restorableByUrl(store, "https://x/a.pdf", { plainOptions: { ocr: "none" } }), null);
  assert.equal(await readableParse(store, "https://x/a.pdf", { plainOptions: { ocr: "none" } }), DOC);
  assert.equal(await readableParse(store, "https://x/missing.pdf", {}), null);
});

test("readableParse prefers cloud, then an OCR-read doc, then the newest", async () => {
  const mk = (name, extra) => ({ ...DOC, title: name, ...extra });
  const old = { engine: "builtin", optsHash: "a", at: 1, doc: mk("old", {}) };
  const fresh = { engine: "builtin", optsHash: "b", at: 9, doc: mk("fresh", {}) };
  const read = { engine: "builtin", optsHash: "c", at: 5, doc: mk("read", { options: { ocr: "vision" } }) };
  const cloud = { engine: "cloud", optsHash: "d", at: 2, doc: mk("cloud", { engine: "cloud" }) };
  assert.equal((await readableParse(fakeStore([old, fresh]), "https://x/a.pdf", {})).title, "fresh");
  assert.equal((await readableParse(fakeStore([old, fresh, read]), "https://x/a.pdf", {})).title, "read");
  assert.equal((await readableParse(fakeStore([old, fresh, read, cloud]), "https://x/a.pdf", {})).title, "cloud");
});

test("the parts index covers PDFs that only have a stale parse", async () => {
  const store = fakeStore([{ engine: "builtin", optsHash: "x", at: 1, doc: DOC }]);
  const index = createPartsIndex({ store, listPdfs: () => [{ url: "https://x/a.pdf", uid: "u1" }] });
  const rows = await index.get();
  assert.ok(rows.some((r) => /Swab limit/.test(r.text)));
});

test("Ask AI from the card menu and from a part row reads through readableParse", () => {
  const src = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  const start = src.indexOf("const loadParsedFor");
  const body = src.slice(start, start + 900);
  assert.match(body, /readableParse\(/);
  assert.doesNotMatch(body, /restorableByUrl/);
});

// 2. type popover ---------------------------------------------------------------------------------
test("opening the Type list lifts the panel above the palette; closing drops it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const panel = createPanel({ doc: stub.document, root, host: {}, timers: { later: () => () => {}, frame: () => () => {} }, on: {} });
    panel.open("search");
    const btn = q(root, ".pxd-panel__type-btn");
    stub.dispatch(btn, "click");
    assert.ok(root.classList.contains("pxd-root--types-open"));
    stub.dispatch(btn, "click");
    assert.ok(!root.classList.contains("pxd-root--types-open"));
    stub.dispatch(btn, "click");
    panel.close();
    assert.ok(!root.classList.contains("pxd-root--types-open"));
  } finally {
    restore();
  }
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const lift = /\.pxd-root--types-open \.pxd-panel \{\s*z-index: (\d+);/.exec(css);
  const palette = /\.pxd-palette \{[^}]*z-index: (\d+);/.exec(readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8"));
  assert.ok(lift && palette && Number(lift[1]) > Number(palette[1]));
  assert.match(css, /\.pxd-panel__type-pop \{[^}]*z-index: 1000;/);
});

// 3. readable PDF / image / web rows ----------------------------------------------------------------
test("pdf, image and web rows show a label, not the macro or markdown", () => {
  const pdf = "{{[[pdf]]: https://firebasestorage.googleapis.com/v0/b/x/o/imgs%2Fapp%2Fg%2FSwab_Plan_2026.pdf?alt=media}}";
  assert.equal(blockDisplay(pdf).text, "Swab Plan 2026");
  assert.equal(blockDisplay(pdf, "pdf", { pdfTitle: () => "Site Plan" }).text, "Site Plan");
  assert.equal(blockDisplay("{{[[pdf]]: https://x/}}").text, "PDF");
  const img = blockDisplay("![](https://x.example/dir/photo%20one.png?alt=media)");
  assert.equal(img.text, "photo one.png");
  assert.equal(img.thumb, "https://x.example/dir/photo%20one.png?alt=media");
  assert.equal(blockDisplay("![Floor drain](https://x/y.png)").text, "Floor drain");
  assert.equal(blockDisplay("https://www.fda.gov/food/guidance").text, "fda.gov/food/guidance");
  const card = libraryCard({ kind: "block", uid: "u9", string: pdf, pageTitle: "Notes" });
  assert.equal(card.text, "Swab Plan 2026");
  assert.equal(card.label, "in Notes");
});

test("panel rows: PDF uses the parsed title, image gets a 40px lazy thumbnail", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const pdf = "{{[[pdf]]: https://x/a.pdf}}";
    const rows = [
      libraryCard({ kind: "block", uid: "p1", string: pdf, pageTitle: "Notes" }),
      libraryCard({ kind: "block", uid: "i1", string: "![](https://x/pic.png)", pageTitle: "Notes" }),
    ];
    const panel = createPanel({
      doc: stub.document, root, timers: { later: () => () => {}, frame: () => () => {} },
      host: { librarySearch: () => ({ rows, queries: [] }) },
      on: { pdfTitle: (url) => (url === "https://x/a.pdf" ? "Site Plan" : "") },
    });
    panel.open("search");
    const input = q(root, ".pxd-panel__input");
    input.value = "x";
    stub.dispatch(input, "keydown", { key: "Enter" });
    await tick();
    const texts = root.querySelectorAll(".pxd-panel__row-text").map((n) => n.textContent);
    assert.deepEqual(texts, ["Site Plan", "pic.png"]);
    const img = q(root, ".pxd-panel__thumb");
    assert.equal(img.getAttribute("loading"), "lazy");
    assert.equal(img.getAttribute("decoding"), "async");
    assert.equal(img.getAttribute("width"), "40");
    assert.equal(root.querySelectorAll(".pxd-panel__row-label").map((n) => n.textContent)[0], "in Notes");
  } finally {
    restore();
  }
});

// 4. models -----------------------------------------------------------------------------------------
test("listModels drops image, speech and embedding models", () => {
  const w = {
    LiveAI_API: {
      isAvailable: () => true,
      getDefaultModel: () => "gpt-image-2-5",
      listModels: () => [
        { id: "claude", name: "Claude Opus", provider: "A", capabilities: ["text", "vision"] },
        { id: "gpt-image-2-5", name: "GPT Image 2.5 Sunburst", provider: "O" },
        { id: "x1", name: "Flare", provider: "O", capabilities: ["image_generation"] },
        { id: "x2", name: "Painter", provider: "O", outputModalities: ["image"], capabilities: { imageOutput: true } },
        { id: "whisper-1", name: "Whisper", provider: "O" },
        { id: "te3", name: "Text Embedding 3", provider: "O" },
        { id: "gpt", name: "GPT 5", provider: "O", isDefault: true },
      ],
    },
  };
  assert.deepEqual(liveai.listModels(w).map((m) => m.id), ["claude", "gpt"]);
  assert.equal(liveai.defaultModel(w), "gpt");
});

// 5-8. dialog -----------------------------------------------------------------------------------------
function dialogWindow(generate) {
  return {
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => [{ id: "m1", name: "M1", provider: "P", isDefault: true }],
      getDefaultModel: () => "m1",
      generate,
    },
    AbortController,
    addEventListener() {},
    removeEventListener() {},
  };
}

test("answer area scrolls and the action row sits below it", () => {
  const css = readFileSync(new URL("../src/css/ask-ai.css", import.meta.url), "utf8");
  const block = (sel) => new RegExp(`${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] || "";
  assert.match(block(".pxd-ask__answer"), /flex: 1 1 auto/);
  assert.match(block(".pxd-ask__answer"), /min-height: 0/);
  assert.match(block(".pxd-ask__answer"), /overflow: auto/);
  assert.match(block(".pxd-ask__body"), /min-height: 0/);
  assert.match(block(".pxd-ask"), /overflow: hidden/);
  assert.match(block(".pxd-ask"), /100vh/);
  assert.match(css, /\.pxd-ask__actions \{\s*flex: 0 0 auto;/);
});

test("answer markdown becomes nodes: lists, bold, italic, code, cite links; no innerHTML", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const node = doc.createElement("div");
    const jumps = [];
    paintAnswer(doc, node, "Intro **bold** and *soft* with `x<b>` [p. 3].\n\n- **A** one\n- B two\n\n1. first\n2. second", (n) => jumps.push(n));
    assert.equal(node.querySelectorAll("p").length, 1);
    assert.deepEqual(node.querySelectorAll("ul li").map((li) => li.textContent), ["A one", "B two"]);
    assert.deepEqual(node.querySelectorAll("ol li").map((li) => li.textContent), ["first", "second"]);
    assert.equal(node.querySelector("strong").textContent, "bold");
    assert.equal(node.querySelector("em").textContent, "soft");
    assert.equal(node.querySelector("code").textContent, "x<b>");
    assert.equal(node.querySelector(".pxd-ask__cite").textContent, "[p. 3]");
    assert.doesNotMatch(node.textContent, /\*\*|`/);
    paintAnswer(doc, node, "<img src=x onerror=1> text", () => {});
    assert.equal(node.querySelectorAll("img").length, 0);
    assert.match(node.textContent, /<img/);
  } finally {
    restore();
  }
});

test("Stop ends the stream: later chunks and the final result are ignored", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    let push = null;
    let finish = null;
    const w = dialogWindow((options) => new Promise((resolve) => {
      push = options.onChunk;
      finish = () => resolve({ text: "ALL THE REST", model: "m1" });
    }));
    const dialog = openAskAI({ doc: DOC, blockId: "p", document: globalThis.document, window: w });
    q(dialog.el, ".pxd-ask__send").click();
    push("first ");
    const out = q(dialog.el, ".pxd-ask__answer");
    assert.equal(out.textContent.trim(), "first");
    q(dialog.el, ".pxd-ask__stop").click();
    assert.equal(q(dialog.el, ".pxd-ask__status").textContent, "Stopped.");
    push("late chunk");
    finish();
    await tick();
    assert.equal(out.textContent.trim(), "first");
    assert.equal(q(dialog.el, ".pxd-ask__status").textContent, "Stopped.");
    dialog.close();
  } finally {
    restore();
  }
});

test("a new Send after Stop ignores the old request's chunks", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const pushes = [];
    const w = dialogWindow((options) => new Promise(() => { pushes.push(options.onChunk); }));
    const dialog = openAskAI({ doc: DOC, blockId: "p", document: globalThis.document, window: w });
    q(dialog.el, ".pxd-ask__send").click();
    q(dialog.el, ".pxd-ask__stop").click();
    q(dialog.el, ".pxd-ask__send").click();
    pushes[0]("OLD");
    pushes[1]("NEW");
    assert.equal(q(dialog.el, ".pxd-ask__answer").textContent, "NEW");
    dialog.close();
  } finally {
    restore();
  }
});

// 6. labels ---------------------------------------------------------------------------------------------
test("context sections use plain words and the instructions forbid echoing labels", () => {
  const out = buildFocusContext(DOC, { blockId: "p" });
  assert.doesNotMatch(out.context, /FOCUS|NEARBY|SECTION|DOCUMENT/);
  assert.match(out.context, /=== Selected part ===/);
  assert.match(out.context, /=== Section ===/);
  assert.match(out.context, /=== Document outline ===/);
  assert.doesNotMatch(INSTRUCTIONS, /FOCUS|NEARBY|SECTION|DOCUMENT/);
  assert.match(INSTRUCTIONS, /'this table', 'this paragraph' or 'this figure'/);
  assert.match(INSTRUCTIONS, /never mention section labels/);
});

// 9. answer card ------------------------------------------------------------------------------------------
test("answer card: paragraphs and list items are their own blocks, nested items are children", () => {
  const answer = "Overview [p. 2].\n\n- **A** one\n- **B** two\n  - sub b\n\n1. first\n2. second\n\nClosing.";
  const lines = answerCardMarkdown({ answer, chip: { label: "Table 3", page: 2, docTitle: "Report" } }).split("\n");
  assert.deepEqual(lines.slice(1), [
    "- Overview [p. 2].",
    "- **A** one",
    "- **B** two",
    "  - sub b",
    "- first",
    "- second",
    "- Closing.",
  ]);
  assert.ok(lines.every((l) => !/\s-\s\*\*B/.test(l)));
  assert.deepEqual(parseAnswer("a\nb\n\n- x").map((p) => p.type), ["p", "list"]);
});
