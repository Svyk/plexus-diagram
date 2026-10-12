// @-mentions of context parts in the Ask AI question: the list "@" opens, naming by the PDF's real name, the preamble that
// maps @Part N to a context block, renumbering and "(removed)" references when a part goes, and the send guard.
import assert from "node:assert/strict";
import test from "node:test";

import { triggerAt, applyMention } from "../src/model/ask-composer.js";
import { buildMultiContext } from "../src/model/ai-context.js";
import { createBasket, makePart } from "../src/model/ask-basket.js";
import {
  AT_ALL, afterPartRemoved, atItems, atPreamble, danglingAtRefs, danglingMessage, describeParts, filterAtItems, insertToken, letterSpaced, parseAtRefs, partPdfName, withAtPreamble,
} from "../src/model/ask-parts.js";
import { openAskAI } from "../src/view/ask-ai.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const DOC_A = {
  schema: "pxd-parse/1",
  title: "MA J O R A R T I C L E",
  pages: [{ n: 1 }, { n: 4 }],
  order: ["h", "p", "f"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Spore survival" },
    p: { id: "p", type: "para", page: 1, text: "Spores survived 90 minutes at 80 C." },
    f: { id: "f", type: "figure", page: 4, text: "", caption: "Figure 1. Survival curve" },
  },
};
const DOC_B = {
  schema: "pxd-parse/1",
  title: "Annual report",
  pages: [{ n: 3 }],
  order: ["t"],
  blocks: { t: { id: "t", type: "table", page: 3, text: "a | b", caption: "Table 3. Limits" } },
};
const partsFor = () => [
  { ...makePart({ doc: DOC_A, focus: { blockId: "p" }, pdfUid: "pdfA", url: "https://x/imgs%2Fapp%2Fg%2Fspores_paper.pdf" }), docName: "Spore heat resistance" },
  { ...makePart({ doc: DOC_A, focus: { blockId: "f" }, pdfUid: "pdfA", url: "https://x/imgs%2Fapp%2Fg%2Fspores_paper.pdf", image: { key: "k", url: "https://img/1.png", thumb: "data:t" } }), docName: "Spore heat resistance" },
  { ...makePart({ doc: DOC_B, focus: { blockId: "t" }, pdfUid: "pdfB", url: "https://x/report.pdf" }), docName: "" },
];

test("@ is a trigger after a space or at the start, with 'Part 3' as one query; an email address is not", () => {
  assert.deepEqual(triggerAt("how does @"), { kind: "at", query: "", start: 9 });
  assert.deepEqual(triggerAt("how does @fig"), { kind: "at", query: "fig", start: 9 });
  assert.deepEqual(triggerAt("@Part 3"), { kind: "at", query: "Part 3", start: 0 });
  assert.equal(triggerAt("write to me@example.com"), null);
  assert.equal(triggerAt("see @Part 3 and"), null, "a finished mention is text");
  const t = triggerAt("how does @fi");
  assert.deepEqual(applyMention("how does @fi", t, 12, "@Part 2"), { text: "how does @Part 2 ", caret: 17 });
});

test("PDF names: the host's name first, then the parse title unless it is a letter-spaced banner, then the file name", () => {
  assert.equal(letterSpaced("MA J O R A R T I C L E"), true);
  assert.equal(letterSpaced("Major article on spores"), false);
  const [a, b, c] = partsFor();
  assert.equal(partPdfName(a), "Spore heat resistance");
  assert.equal(partPdfName({ ...c, docTitle: "MA J O R A R T I C L E" }), "report");
  assert.equal(partPdfName({ docTitle: "MA J O R A R T I C L E", url: "https://x/imgs%2Fapp%2Fg%2Fspores_paper.pdf" }), "spores paper");
  assert.equal(partPdfName({ docTitle: "MA J O R A R T I C L E" }), "PDF");
  const d = describeParts([a, b, c]);
  assert.deepEqual(d.map((x) => [x.n, x.type, x.pdf]), [[1, "paragraph", "Spore heat resistance"], [2, "figure", "Spore heat resistance"], [3, "table", "Annual report"]]);
  assert.match(d[2].full, /^Table 3.*· Annual report$/);
  assert.equal(describeParts([{ ...a, docName: "A very long document name that keeps going on and on and on" }])[0].short.length < 70, true);
});

test("the @ list: All parts, every part with its kind, filter by number, kind word or PDF word", () => {
  const items = atItems({ parts: describeParts(partsFor()), mentions: [{ kind: "page", title: "Spore notes" }] });
  assert.deepEqual(items.map((i) => i.token || i.insert), [AT_ALL, "@Part 1", "@Part 2", "@Part 3", "[[Spore notes]]"]);
  assert.deepEqual(filterAtItems(items, "").length, 5);
  assert.deepEqual(filterAtItems(items, "3").map((i) => i.token), ["@Part 3"]);
  assert.deepEqual(filterAtItems(items, "fig").map((i) => i.token), ["@Part 2"]);
  assert.deepEqual(filterAtItems(items, "table").map((i) => i.token), ["@Part 3"]);
  assert.deepEqual(filterAtItems(items, "spore").map((i) => i.token || i.insert), ["@Part 1", "@Part 2", "[[Spore notes]]"]);
  assert.deepEqual(filterAtItems(items, "part 2").map((i) => i.token), ["@Part 2"]);
  assert.deepEqual(filterAtItems(items, "zzz"), []);
  assert.equal(items[2].thumb, "data:t", "a figure carries its thumbnail");
  assert.equal(atItems({ parts: describeParts(partsFor().slice(0, 1)) })[0].token, "@Part 1", "no All entry for one part");
});

test("parsing: @Part N and @All parts, case-insensitive; dangling = removed marker or a number past the last part", () => {
  const text = "Does @Part 3 fit into @part 2's paragraph? Also @All parts, a@b.com and @Part 9 (removed)";
  assert.deepEqual(parseAtRefs(text).map((r) => [r.n, r.all, r.removed]), [[3, false, false], [2, false, false], [null, true, false], [9, false, true]]);
  assert.deepEqual(danglingAtRefs("@Part 1 @Part 2", 3), []);
  assert.deepEqual(danglingAtRefs("@Part 4 and @Part 4 and @Part 2 (removed)", 3).map((d) => [d.token, d.removed]), [["@Part 4", false], ["@Part 2", true]]);
  assert.equal(danglingMessage(danglingAtRefs("@Part 4", 3)), "@Part 4 no longer exists. Delete it from the question or add the part back.");
  assert.equal(danglingMessage([]), "");
});

test("removing a part: references to it stay as '(removed)', later references move up, earlier ones stay", () => {
  const r = afterPartRemoved("@Part 1, @Part 2 and @Part 3 vs @Part 3", 2);
  assert.deepEqual(r, { text: "@Part 1, @Part 2 (removed) and @Part 2 vs @Part 2", hit: true });
  assert.deepEqual(afterPartRemoved("@Part 1 only", 3), { text: "@Part 1 only", hit: false });
  assert.deepEqual(afterPartRemoved("@Part 2 (removed) @Part 3", 1), { text: "@Part 2 (removed) @Part 2", hit: false });
  assert.deepEqual(danglingAtRefs(r.text, 2).map((d) => d.token), ["@Part 2"]);
});

test("insertToken puts @Part N at the caret with a space on each side as needed", () => {
  assert.deepEqual(insertToken("how does  fit", 9, "@Part 3"), { text: "how does @Part 3 fit", caret: 16 });
  assert.deepEqual(insertToken("compare", 7, "@Part 1"), { text: "compare @Part 1 ", caret: 16 });
  assert.deepEqual(insertToken("", 0, "@Part 1"), { text: "@Part 1 ", caret: 8 });
});

test("the preamble maps each @Part N to its context block; nothing when the question names none; All parts counts them", () => {
  const d = describeParts(partsFor());
  const text = "How does @Part 3 fit into @Part 1's paragraph? Compare @Part 3 with @All parts";
  const pre = atPreamble(text, d);
  assert.match(pre, /^In my question, @Part 3 means Part 3 of the context: Table 3, p\. 3 of "Annual report"\./);
  assert.match(pre, /@Part 1 means Part 1 of the context: Paragraph, p\. 1 of "Spore heat resistance"\./);
  assert.match(pre, /@All parts means every part of the context \(3\)\./);
  assert.equal((pre.match(/@Part 3 means/g) || []).length, 1, "one line per distinct reference");
  assert.equal(atPreamble("no mention", d), "");
  assert.equal(atPreamble("@Part 7", d), "", "a number past the last part says nothing");
  assert.match(atPreamble("@Part 1", d.slice(0, 1), { numbered: false }), /means the part in the context: Paragraph/);
  assert.equal(withAtPreamble("Q", pre), `${pre}\n\nQ`);
  assert.equal(withAtPreamble("Q", ""), "Q");
});

test("the context names each part's document by its real name, not the letter-spaced banner", () => {
  const b = buildMultiContext(partsFor(), "q");
  assert.match(b.context, /=== Part 1 [^\n]*\nDocument: Spore heat resistance/);
  assert.doesNotMatch(b.context, /Document: MA J O R/);
  assert.match(b.context, /Document: Annual report/);
});

// ---- the dialog ---------------------------------------------------------------------------------------

function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, globalThis.document)).finally(restore);
}
const flush = () => new Promise((r) => setTimeout(r, 10));
function findAll(node, cls, out = []) {
  if (node.className?.split?.(" ").includes(cls)) out.push(node);
  for (const kid of node.children || []) findAll(kid, cls, out);
  return out;
}
const find = (n, c) => findAll(n, c)[0] || null;
const fakeWindow = () => {
  const sent = [];
  const store = new Map();
  return {
    sent,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash: "#/app/g/page/x" },
    addEventListener() {},
    removeEventListener() {},
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => [{ id: "m1", name: "M1", provider: "P", isDefault: true }],
      getDefaultModel: () => "m1",
      generate: async (req) => { sent.push(req); return { text: "ok", model: req.model }; },
    },
  };
};
const type = (stub, ta, value) => { ta.value = value; stub.dispatch(ta, "input"); };
const rows = (el) => findAll(el, "pxd-ask__slabel").map((n) => n.textContent);

function openThree(doc, w, { names = true } = {}) {
  const basket = createBasket();
  for (const p of partsFor()) basket.add(p);
  const pdfName = names ? (p) => ({ pdfA: "Spore heat resistance", pdfB: "Annual report" })[p.pdfUid] : undefined;
  const d = openAskAI({ multi: { basket }, ...(pdfName ? { pdfName } : {}), document: doc, window: w });
  return { d, basket, ta: find(d.el, "pxd-ask__question") };
}

test("typing @ lists the parts; @fig narrows to the figure (with a thumbnail); Tab inserts @Part 2 and lights the chip", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const { d, ta } = openThree(doc, w);
  type(stub, ta, "how does @");
  assert.deepEqual(rows(d.el), ["All parts", "Part 1 · Paragraph · p. 1", "Part 2 · Figure 1 · p. 4", "Part 3 · Table 3 · p. 3"]);
  type(stub, ta, "how does @fig");
  assert.deepEqual(rows(d.el), ["Part 2 · Figure 1 · p. 4"]);
  assert.equal(findAll(d.el, "pxd-ask__sthumb").length, 1);
  stub.dispatch(ta, "keydown", { key: "Tab" });
  assert.equal(ta.value, "how does @Part 2 ");
  const chips = findAll(d.el, "pxd-ask__partchip");
  assert.equal(chips[1].className.includes("pxd-ask__partchip--flash"), true);
  assert.equal(chips[0].className.includes("pxd-ask__partchip--flash"), false);
}));

test("chips are named by the PDF's real name, with the number in bold and the full text in the tooltip; a click inserts @Part N", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const { d, ta } = openThree(doc, w);
  const labels = findAll(d.el, "pxd-ask__partlabel");
  assert.equal(labels[0].textContent, "Part 1: Paragraph · p. 1 · Spore heat resistance");
  assert.equal(labels[2].textContent, "Part 3: Table 3 · p. 3 · Annual report");
  assert.equal(find(labels[0], "pxd-ask__partno").textContent, "Part 1");
  assert.match(labels[0].getAttribute("title"), /^@Part 1: Paragraph · p\. 1 · Spore heat resistance/);
  ta.value = "how does  fit";
  ta.selectionStart = 9;
  stub.dispatch(labels[2], "click", {});
  assert.equal(ta.value, "how does @Part 3 fit");
}));

test("Send adds the preamble to the prompt, the model sees the real document name, and the typed question stays as asked", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const { d, ta } = openThree(doc, w);
  ta.value = "How does @Part 3 fit into @Part 1's paragraph?";
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].prompt, /^In my question, @Part 3 means Part 3 of the context: Table 3, p\. 3 of "Annual report"\. @Part 1 means Part 1 of the context: Paragraph, p\. 1 of "Spore heat resistance"\.\n\nHow does @Part 3 fit into @Part 1's paragraph\?$/);
  assert.match(w.sent[0].context, /Document: Spore heat resistance/);
  assert.doesNotMatch(w.sent[0].context, /Document: MA J O R/);
  const bubbles = findAll(d.el, "pxd-ask__bubble").map((n) => n.textContent);
  assert.ok(bubbles.some((t) => t.includes("How does @Part 3 fit into @Part 1's paragraph?") && !t.includes("In my question")));
}));

test("removing a referenced part warns inline, rewrites the references, and Send refuses a dangling one until it is fixed", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const { d, basket, ta } = openThree(doc, w);
  ta.value = "Does @Part 2 agree with @Part 3?";
  stub.dispatch(find(findAll(d.el, "pxd-ask__partchip")[1], "pxd-ask__partx"), "click", {});
  assert.equal(basket.size(), 2);
  assert.equal(ta.value, "Does @Part 2 (removed) agree with @Part 2?");
  assert.equal(find(d.el, "pxd-ask__status").textContent, "@Part 2 no longer exists");
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent.length, 0, "nothing sent with a dangling reference");
  assert.match(find(d.el, "pxd-ask__status").textContent, /^@Part 2 no longer exists\. Delete it/);
  ta.value = "Does @Part 2 agree?";
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].prompt, /@Part 2 means Part 2 of the context: Table 3, p\. 3 of "Annual report"/);
  ta.value = "And @Part 9?";
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent.length, 1, "a number past the last part is refused too");
}));

test("a question without @ is sent exactly as typed", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const { d, ta } = openThree(doc, w);
  ta.value = "Compare them";
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent[0].prompt, "Compare them");
}));
