import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { answerCardMarkdown } from "../src/model/ai-context.js";
import { findSourceCard } from "../src/model/ask-basket.js";
import { nestMarkdownUnderFirst } from "../src/session.js";
import { MIN_WIDTH, openAskAI, WIDTH_KEY } from "../src/view/ask-ai.js";
import { createParseActions } from "../src/view/parse-actions.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const ANSWER = `**Short answer:** The Cronobacter plan matches.

| | Our report (Table 1) | EU 2073/2005 | Comparison |
|---|---|---|---|
| **Salmonella** – plan | Finished blend: n = 60, c = 0 [Part 1, p. 1] | Point 1.22: n = 30, c = 0 [Part 3, p. 11] | Ours is stricter: 60 vs 30. |
| **Salmonella** – limit | Absent in 25 g; Reject [Part 1, p. 1] | Absence in 25 g; EN/ISO 6579 [Part 3, p. 11] | Same limit. |
| **Cronobacter** – plan | Base powder: n = 30, c = 0 [Part 1, p. 1] | Point 1.23: n = 30, c = 0 [Part 3, p. 11] | Identical. |
| **Cronobacter** – limit | Absent in 10 g; Reject [Part 1, p. 1] | Absence in 10 g; ISO/DTS 22964 [Part 3, p. 11] | Same limit. |

**Gaps and caveats**

- **Stage mismatch.** Our Table 1 sets Cronobacter only at base powder.`;

// What Roam's fromMarkdown would build from the card text: a tree of { text, kids } by indent.
function tree(markdown) {
  const root = { text: "", kids: [], depth: -1 };
  const stack = [root];
  for (const line of markdown.split("\n")) {
    const m = /^( *)- ?(.*)$/.exec(line);
    assert.ok(m, `not a bullet line: ${JSON.stringify(line)}`);
    const depth = m[1].length / 2;
    const node = { text: m[2], kids: [], depth };
    while (stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].kids.push(node);
    stack.push(node);
  }
  return root.kids;
}
const rowChains = (tableNode) => tableNode.kids.map((first) => {
  const cells = [];
  for (let n = first; n; n = n.kids[0]) { cells.push(n.text); assert.ok(n.kids.length <= 1); }
  return cells;
});

function assertCardHasTable(markdown) {
  const roots = tree(nestMarkdownUnderFirst(markdown));
  assert.equal(roots.length, 1, "one card root");
  const table = roots[0].kids.find((k) => k.text === "{{[[table]]}}");
  assert.ok(table, "the card has a {{[[table]]}} child");
  const rows = rowChains(table);
  assert.equal(rows.length, 5);
  for (const r of rows) assert.equal(r.length, 4);
  assert.equal(rows[0][0], "", "the empty header cell stays an empty block");
  assert.equal(rows[0][1], "Our report (Table 1)");
  assert.equal(rows[1][0], "**Salmonella** – plan");
  assert.equal(rows[4][3], "Same limit.");
  assert.ok(roots[0].kids.some((k) => /^\*\*Short answer:\*\*/.test(k.text)));
  assert.ok(roots[0].kids.some((k) => /^\*\*Stage mismatch\./.test(k.text)));
}

test("I: a 3-part basket answer with an empty first header cell keeps its {{[[table]]}} child (5 row chains of 4 cells)", () => {
  assertCardHasTable(answerCardMarkdown({ answer: ANSWER, chip: { label: "3 parts", page: null, docTitle: "Compare the plans" } }));
});

test("I: the single-part card path writes the same table child", () => {
  assertCardHasTable(answerCardMarkdown({ answer: ANSWER, chip: { label: "Table 1", page: 1, docTitle: "Report" }, imageUrl: "https://f.test/a.png" }));
});

test("I: a table right after the header, and a table with a text cell that is only a dash, still nest under the card", () => {
  const md = answerCardMarkdown({ answer: "| A | B |\n|---|---|\n| - | x |\n\nAfter." });
  const roots = tree(nestMarkdownUnderFirst(md));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].kids[0].text, "{{[[table]]}}");
  assert.deepEqual(rowChains(roots[0].kids[0]), [["A", "B"], ["-", "x"]]);
  assert.equal(roots[0].kids[1].text, "After.");
});

test("I: insertAnswerCard hands insertParsedCard the table markdown unchanged (multi path)", async () => {
  const cards = [];
  const session = { board: { items: new Map() }, insertParsedCard: async (a) => { cards.push(a); return { ok: true, uid: "ans" }; }, addEdge: async () => {} };
  const actions = createParseActions({ session, placeBeside: () => ({ x: 0, y: 0 }) });
  const markdown = answerCardMarkdown({ answer: ANSWER, chip: { label: "3 parts" } });
  await actions.insertAnswerCard({ markdown, pdfUid: "p1", sources: [{ pdfUid: "p1" }, { pdfUid: "p2" }, { pdfUid: "p3" }] });
  assertCardHasTable(cards[0].markdown);
});

// ---- J ----

test("J: an older answer card with Source:: ((pin)) is not the pin card; the PDF card nested in a section gets the edge", async () => {
  const items = new Map([
    ["sec", { uid: "sec", kind: "section", string: "Reports" }],
    ["pxdLab00", { uid: "pxdLab00", kind: "pdf", parentUid: "sec", string: "{{[[pdf]]: https://f.test/report.pdf}}", target: { kind: "self", uid: "pxdLab00" } }],
    ["old", { uid: "old", kind: "note", string: "AI answer · Table 1", target: { kind: "self", uid: "old" }, content: [{ string: "Source:: ((pin-1))" }] }],
  ]);
  const edges = [];
  const session = {
    board: { items },
    ensurePdfPin: async () => ({ ok: true, uid: "pin-1" }),
    insertParsedCard: async () => { items.set("ans", { uid: "ans", kind: "note", string: "AI answer · 3 parts", target: { kind: "self", uid: "ans" } }); return { ok: true, uid: "ans" }; },
    addEdge: async (e) => { edges.push(e); },
  };
  const actions = createParseActions({ session, placeBeside: () => ({ x: 0, y: 0 }) });
  await actions.insertAnswerCard({
    markdown: "- AI answer",
    sources: [{ pdfUid: "pxdLab00", url: "https://f.test/report.pdf", pin: { pdfUid: "pxdLab00", page: 1, frac: [0, 0, 1, 1] } }],
  });
  assert.deepEqual(edges.map((e) => [e.from, e.to]), [["ans", "pxdLab00"]]);
});

test("J: findSourceCard matches a pin only by the item's own block, never an AI answer card; URL fallback sees section children", () => {
  const url = "https://f.test/report.pdf";
  const items = [
    { uid: "old", kind: "note", string: "AI answer · x", content: [{ string: "Source:: ((pin-1))" }] },
    { uid: "oldRef", kind: "block", string: "AI answer · y", target: { kind: "block", uid: "pin-1" } },
    { uid: "pxdLab00", kind: "pdf", string: `{{[[pdf]]: ${url}}}` },
  ];
  assert.equal(findSourceCard(items, { pinUid: "pin-1", url }), "pxdLab00");
  assert.equal(findSourceCard(items, { pinUid: "pin-1", pdfUid: "pxdLab00" }), "pxdLab00");
  const pinCard = { uid: "pc", kind: "block", string: "((pin-1))", target: { kind: "block", uid: "pin-1" } };
  assert.equal(findSourceCard([...items, pinCard], { pinUid: "pin-1", pdfUid: "pxdLab00" }), "pc");
  const macro = { uid: "pin-1", kind: "region-ref", string: "{{[[plexus-pin]]: {}}}" };
  assert.equal(findSourceCard([...items, macro], { pinUid: "pin-1" }), "pin-1");
});

// ---- H ----

const css = readFileSync(new URL("../src/css/ask-ai.css", import.meta.url), "utf8");
const block = (sel) => new RegExp(`${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] || "";
const walk = (n, fn) => { fn(n); for (const k of n.children || []) walk(k, fn); };
const findAll = (n, cls) => { const out = []; walk(n, (x) => { if (x.className?.split?.(" ").includes(cls)) out.push(x); }); return out; };

function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, globalThis.document)).finally(restore);
}
function fakeWindow(reply = "ok") {
  const store = new Map();
  const models = [{ id: "son", name: "Claude Sonnet 5.5", provider: "Anthropic", isDefault: true, imageInput: false, capabilities: { imageInput: false } }];
  return {
    store,
    innerWidth: 1000,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash: "#/app/mygraph/page/x" },
    addEventListener() {},
    removeEventListener() {},
    LiveAI_API: { isAvailable: () => true, listModels: () => models, getDefaultModel: () => "son", generate: async () => ({ text: reply, model: "son" }) },
  };
}
const DOC = { schema: "pxd-parse/1", pages: [{ n: 1 }], order: ["p"], blocks: { p: { id: "p", type: "para", page: 1, text: "Sodium was 12 mg." } } };
const flush = () => new Promise((r) => setTimeout(r, 10));
const basket = (parts) => ({ list: () => parts, subscribe: () => () => {}, remove() {}, add() {}, size: () => parts.length });
const part = (i) => ({ key: `k${i}`, label: `Table ${i} · p. ${i} · A very long document title that needs an ellipsis ${i}`, pdfUid: `pdf${i}`, doc: DOC, blockId: "p", page: 1, source: {} });

test("H1: part chips are a wrapping flex row; chips never shrink to a sliver, labels ellipsize, the x is fixed size", () => withDom(async (stub, doc) => {
  const d = openAskAI({ document: doc, window: fakeWindow(), multi: { basket: basket([part(1), part(2), part(3)]), jump() {} } });
  assert.equal(findAll(d.el, "pxd-ask__parts").length, 1);
  assert.equal(findAll(d.el, "pxd-ask__partchip").length, 3);
  assert.equal(findAll(d.el, "pxd-ask__partx").length, 3);
  assert.equal(findAll(d.el, "pxd-ask__chip")[0].textContent, "3 parts");
  d.close();
  const parts = block(".pxd-ask__parts");
  assert.match(parts, /display: flex/);
  assert.match(parts, /flex-wrap: wrap/);
  assert.match(parts, /gap: 4px/);
  assert.match(parts, /flex: 0 0 auto/);
  assert.match(parts, /max-height: 96px/);
  assert.match(parts, /overflow-y: auto/);
  assert.doesNotMatch(parts, /(^|[^-])height: \d+px/);
  const chipRule = block(".pxd-ask__partchip");
  assert.match(chipRule, /max-width: 100%/);
  assert.match(chipRule, /height: auto/);
  assert.match(chipRule, /min-width: 0/);
  const label = block(".pxd-ask__partlabel");
  assert.match(label, /text-overflow: ellipsis/);
  assert.match(label, /overflow: hidden/);
  const x = block(".pxd-ask__partx");
  assert.match(x, /width: 18px/);
  assert.match(x, /height: 18px/);
  assert.match(block(".pxd-ask__chip"), /flex: 0 0 auto/);
  assert.match(block(".pxd-ask__chip"), /height: auto/);
}));

test("H2: multi mode and table answers get the wide dialog; a plain single-part answer stays 440px", () => withDom(async (stub, doc) => {
  assert.match(block(".pxd-ask"), /width: min\(440px, calc\(100vw - 32px\)\)/);
  assert.match(block(".pxd-ask--wide"), /width: min\(720px, calc\(100vw - 48px\)\)/);
  const multi = openAskAI({ document: doc, window: fakeWindow(), multi: { basket: basket([part(1), part(2)]), jump() {} } });
  assert.ok(multi.el.classList.contains("pxd-ask--wide"));
  multi.close();
  const plain = openAskAI({ doc: DOC, blockId: "p", document: doc, window: fakeWindow("Just a paragraph.") });
  assert.ok(!plain.el.classList.contains("pxd-ask--wide"));
  findAll(plain.el, "pxd-ask__send")[0].click();
  await flush();
  assert.ok(!plain.el.classList.contains("pxd-ask--wide"));
  plain.close();
  const tab = openAskAI({ doc: DOC, blockId: "p", document: doc, window: fakeWindow("| A | B |\n|---|---|\n| 1 | 2 |") });
  findAll(tab.el, "pxd-ask__send")[0].click();
  await flush();
  assert.ok(tab.el.classList.contains("pxd-ask--wide"));
  assert.equal(findAll(tab.el, "pxd-ask__table").length, 1);
  tab.close();
}));

test("H2: tables lay out by content and break words only as a last resort; the dialog stays in the viewport", () => {
  assert.match(block(".pxd-ask__table"), /table-layout: auto/);
  const cell = css.match(/\.pxd-ask__table th,\s*\.pxd-ask__table td \{([^}]*)\}/)[1];
  assert.match(cell, /min-width: 7em/);
  assert.match(cell, /word-break: normal/);
  assert.match(cell, /overflow-wrap: break-word/);
  assert.doesNotMatch(cell, /anywhere/);
  assert.match(block(".pxd-ask"), /max-width: calc\(100vw - 32px\)/);
  assert.match(block(".pxd-ask"), /right: 16px/);
});

test("H2: a 6px left-edge grip drags the width, clamps at 360px and the viewport, and stores it per graph", () => withDom(async (stub, doc) => {
  assert.match(block(".pxd-ask__grip"), /width: 6px/);
  assert.match(block(".pxd-ask__grip"), /left: 0/);
  assert.match(block(".pxd-ask__grip"), /cursor: ew-resize/);
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const grip = findAll(d.el, "pxd-ask__grip")[0];
  d.el.getBoundingClientRect = () => ({ width: 440 });
  stub.dispatch(grip, "pointerdown", { clientX: 600 });
  stub.dispatch(doc, "pointermove", { clientX: 500 });
  assert.equal(d.el.style.width, "540px");
  stub.dispatch(doc, "pointermove", { clientX: 900 });
  assert.equal(d.el.style.width, `${MIN_WIDTH}px`);
  stub.dispatch(doc, "pointermove", { clientX: -2000 });
  assert.equal(d.el.style.width, "968px");
  stub.dispatch(doc, "pointermove", { clientX: 450 });
  stub.dispatch(doc, "pointerup", {});
  assert.equal(w.store.get(`${WIDTH_KEY}:mygraph`), "590");
  stub.dispatch(doc, "pointermove", { clientX: 100 });
  assert.equal(d.el.style.width, "590px");
  d.close();
  const again = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(again.el.style.width, "590px");
  again.close();
  const other = fakeWindow();
  other.location.hash = "#/app/othergraph/page/x";
  const o = openAskAI({ doc: DOC, blockId: "p", document: doc, window: other });
  assert.equal(o.el.style.width || "", "");
  o.close();
}));

test("H3: the question textarea grows from 2 to 6 lines on input and when a quick prompt sets it", () => withDom(async (stub, doc) => {
  assert.match(block(".pxd-ask__question"), /min-height: calc\(2 \* 18px \+ 14px\)/);
  assert.match(block(".pxd-ask__question"), /max-height: calc\(6 \* 18px \+ 14px\)/);
  assert.match(block(".pxd-ask__question"), /resize: none/);
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: fakeWindow() });
  const ta = findAll(d.el, "pxd-ask__question")[0];
  assert.equal(ta.rows, 2);
  ta.value = "a\nb\nc\nd";
  stub.dispatch(ta, "input", {});
  assert.equal(ta.rows, 4);
  ta.value = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
  stub.dispatch(ta, "input", {});
  assert.equal(ta.rows, 6);
  ta.value = "x".repeat(200);
  stub.dispatch(ta, "input", {});
  assert.equal(ta.rows, 4);
  ta.value = "short";
  stub.dispatch(ta, "input", {});
  assert.equal(ta.rows, 2);
  const quick = findAll(d.el, "pxd-ask__quickbtn")[0];
  ta.value = "z";
  quick.click();
  assert.ok(ta.rows >= 2);
  d.close();
}));
