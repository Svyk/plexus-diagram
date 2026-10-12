import assert from "node:assert/strict";
import test from "node:test";

import { buildMultiContext, MULTI_INSTRUCTIONS, splitCitations } from "../src/model/ai-context.js";
import { BASKET_MAX, basketFor, createBasket, findSourceCard, makePart, partKey, pillText } from "../src/model/ask-basket.js";
import { AUTO_ORDER, graphOfWindow, modelPickKey, pickAskModel } from "../src/model/ask-models.js";
import { createFigureImages } from "../src/host/figure-image.js";
import { openAskAI } from "../src/view/ask-ai.js";
import { createParseActions } from "../src/view/parse-actions.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const m = (id, name, provider = "P", imageInput = false, isDefault = false) => ({ id, name, provider, isDefault, imageInput, capabilities: { imageInput } });

// ---- 1. default model --------------------------------------------------------------------------------

test("auto model: the first of Sonnet 5.5, Opus 5.5, Sonnet 5, Gemini Flash, Gemini Pro that is listed; case-insensitive on name or id", () => {
  const luna = m("gpt-luna", "GPT 6 Luna", "OpenAI", false, true);
  assert.deepEqual(AUTO_ORDER, ["Claude Sonnet 5.5", "Claude Opus 5.5", "Claude Sonnet 5", "Gemini 3.8 Flash", "Gemini 3.1 Pro"]);
  const all = [luna, m("g-pro", "Gemini 3.1 Pro", "Google"), m("g-fl", "Gemini 3.8 Flash", "Google"), m("c5", "Claude Sonnet 5", "Anthropic"), m("c-op", "Claude Opus 5.5", "Anthropic"), m("c55", "claude sonnet 5.5", "Anthropic")];
  assert.equal(pickAskModel(all, { liveDefault: "gpt-luna" }), "c55");
  assert.equal(pickAskModel(all.filter((x) => x.id !== "c55"), { liveDefault: "gpt-luna" }), "c-op");
  assert.equal(pickAskModel(all.filter((x) => !["c55", "c-op"].includes(x.id))), "c5");
  assert.equal(pickAskModel([luna, all[1], all[2]]), "g-fl");
  assert.equal(pickAskModel([luna, all[1]]), "g-pro");
  assert.equal(pickAskModel([luna, m("CLAUDE SONNET 5.5", "x", "Anthropic")]), "CLAUDE SONNET 5.5");
});

test("auto model: any Anthropic, then any Google, then the Live AI default, then the first", () => {
  const luna = m("gpt-luna", "GPT 6 Luna", "OpenAI", false, true);
  const haiku = m("h", "Claude Haiku 5", "Anthropic");
  const gem = m("g", "Gemini Nano", "Google");
  assert.equal(pickAskModel([luna, gem, haiku]), "h");
  assert.equal(pickAskModel([luna, gem]), "g");
  assert.equal(pickAskModel([m("a", "A"), luna], { liveDefault: "gpt-luna" }), "gpt-luna");
  assert.equal(pickAskModel([m("a", "A"), m("b", "B")]), "a");
  assert.equal(pickAskModel([]), "");
});

test("auto model with an image: only models that see it; remembered and setting follow the same rule", () => {
  const sonnetBlind = m("s", "Claude Sonnet 5.5", "Anthropic", false);
  const opusSees = m("o", "Claude Opus 5.5", "Anthropic", true);
  const lunaSees = m("l", "GPT 6 Luna", "OpenAI", true, true);
  assert.equal(pickAskModel([sonnetBlind, opusSees, lunaSees], { needImage: true }), "o");
  assert.equal(pickAskModel([sonnetBlind, lunaSees], { needImage: true }), "l");
  assert.equal(pickAskModel([sonnetBlind, opusSees, lunaSees], { needImage: false }), "s");
  assert.equal(pickAskModel([sonnetBlind, opusSees, lunaSees], { remembered: "l", needImage: true }), "l");
  assert.equal(pickAskModel([sonnetBlind, opusSees, lunaSees], { remembered: "s", needImage: true }), "o");
  assert.equal(pickAskModel([sonnetBlind, opusSees, lunaSees], { remembered: "l" }), "l");
  assert.equal(pickAskModel([sonnetBlind, opusSees, lunaSees], { setting: "gpt 6 luna" }), "l");
  assert.equal(pickAskModel([sonnetBlind, opusSees, lunaSees], { setting: "auto" }), "s");
  assert.equal(pickAskModel([sonnetBlind, opusSees], { setting: "nothing like it" }), "s");
});

test("graph name comes from the Roam hash and keys the remembered model", () => {
  assert.equal(graphOfWindow({ location: { hash: "#/app/mygraph/page/x" } }), "mygraph");
  assert.equal(graphOfWindow({}), "");
  assert.notEqual(modelPickKey("a"), modelPickKey("b"));
});

// ---- dom helpers -------------------------------------------------------------------------------------

function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, globalThis.document)).finally(restore);
}
const flush = () => new Promise((r) => setTimeout(r, 10));
function find(node, cls) {
  if (node.className?.split?.(" ").includes(cls)) return node;
  for (const kid of node.children || []) {
    const hit = find(kid, cls);
    if (hit) return hit;
  }
  return null;
}
function findAll(node, cls, out = []) {
  if (node.className?.split?.(" ").includes(cls)) out.push(node);
  for (const kid of node.children || []) findAll(kid, cls, out);
  return out;
}
function fakeWindow(models, over = {}, hash = "#/app/mygraph/page/x") {
  const sent = [];
  const store = new Map();
  return {
    sent,
    store,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => models,
      getDefaultModel: () => models.find((x) => x.isDefault)?.id,
      generate: async (req) => { sent.push(req); return { text: "ok", model: req.model }; },
      ...over,
    },
  };
}

const DOC = {
  schema: "pxd-parse/1",
  pages: [{ n: 1 }, { n: 4 }],
  order: ["h", "p", "f", "c"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Results" },
    p: { id: "p", type: "para", page: 1, text: "Sodium was 12 mg." },
    f: { id: "f", type: "figure", page: 4, text: "" },
    c: { id: "c", type: "caption", page: 4, for: "f", text: "Figure 2. Sodium (mg) by week" },
  },
};

test("dialog default: Claude beats an empty Live AI default; a pick is remembered per graph and wins until changed", () => withDom(async (stub, doc) => {
  const models = [m("luna", "GPT 6 Luna", "OpenAI", false, true), m("son", "Claude Sonnet 5.5", "Anthropic"), m("gem", "Gemini 3.8 Flash", "Google")];
  const w = fakeWindow(models);
  const d1 = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const sel = find(d1.el, "pxd-ask__model");
  assert.equal(sel.value, "son");
  sel.value = "gem";
  stub.dispatch(sel, "change", {});
  assert.equal(w.store.get(modelPickKey("mygraph")), "gem");
  d1.close();
  const d2 = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(find(d2.el, "pxd-ask__model").value, "gem");
  d2.close();
  const other = fakeWindow(models, {}, "#/app/othergraph/page/x");
  const d3 = openAskAI({ doc: DOC, blockId: "p", document: doc, window: other });
  assert.equal(find(d3.el, "pxd-ask__model").value, "son");
  d3.close();
  const d4 = openAskAI({ doc: DOC, blockId: "p", document: doc, window: other, askModel: "Gemini 3.8 Flash" });
  assert.equal(find(d4.el, "pxd-ask__model").value, "gem");
  d4.close();
}));

test("dialog default on a figure with an image: Claude that cannot see it is skipped", () => withDom(async (stub, doc) => {
  const models = [m("son", "Claude Sonnet 5.5", "Anthropic", false), m("op", "Claude Opus 5.5", "Anthropic", true), m("luna", "GPT 6 Luna", "OpenAI", true, true)];
  const service = createFigureImages({ store: { getMeta: async () => null, putMeta: async () => true }, upload: async () => "https://f.test/a.png", shrink: async (b) => b });
  const d = openAskAI({ doc: DOC, blockId: "f", document: doc, window: fakeWindow(models), imageService: service, image: { key: "k", getBlob: async () => new Blob([new Uint8Array([1])], { type: "image/png" }) } });
  assert.equal(find(d.el, "pxd-ask__model").value, "op");
  d.close();
}));

// ---- 2. the basket -----------------------------------------------------------------------------------

test("basket: up to 8 parts, no duplicates, per graph, notifies, clears", () => {
  const b = createBasket();
  const seen = [];
  const off = b.subscribe((list) => seen.push(list.length));
  for (let i = 0; i < BASKET_MAX; i += 1) assert.equal(b.add({ key: `k${i}` }), "added");
  assert.equal(b.add({ key: "k0" }), "have");
  assert.equal(b.add({ key: "extra" }), "full");
  assert.equal(b.size(), 8);
  assert.equal(b.remove("k3"), true);
  assert.equal(b.remove("k3"), false);
  assert.equal(b.size(), 7);
  off();
  b.clear();
  assert.equal(b.size(), 0);
  assert.deepEqual(seen.slice(-2), [8, 7]);
  assert.notEqual(basketFor("g1"), basketFor("g2"));
  assert.equal(basketFor("g1"), basketFor("g1"));
  assert.equal(pillText(1), "1 part · Ask");
  assert.equal(pillText(3), "3 parts · Ask");
  assert.equal(partKey({ pdfUid: "u", blockId: "b" }), partKey({ pdfUid: "u", blockId: "b" }));
  assert.notEqual(partKey({ pdfUid: "u", blockId: "b" }), partKey({ pdfUid: "u", wholeDoc: true }));
});

test("menus: Add to question sits next to Ask AI on PDF and image cards", () => {
  const ids = (menu) => menu.map((r) => r.id);
  assert.ok(ids(buildMenu("card", { isPdf: true, hasParse: true })).includes("add-to-ask"));
  assert.ok(ids(buildMenu("card", { isImage: true })).includes("add-to-ask"));
  assert.ok(!ids(buildMenu("card", { isPdf: true, hasParse: false })).includes("add-to-ask"));
  assert.ok(!ids(buildMenu("card", {})).includes("add-to-ask"));
});

const T = (id, page, cells) => ({ id, type: "table", page, rows: 2, cols: 2, cells: cells || [{ r: 0, c: 0, text: "Analyte" }, { r: 0, c: 1, text: "Limit" }, { r: 1, c: 0, text: "Lead" }, { r: 1, c: 1, text: "5 ppb" }] });

function reportDoc() {
  return {
    schema: "pxd-parse/1",
    title: "Annual report",
    pages: [{ n: 9 }, { n: 10 }],
    order: ["h", "p0", "t", "cap", "p1"],
    blocks: {
      h: { id: "h", type: "heading", level: 1, page: 9, text: "Limits" },
      p0: { id: "p0", type: "para", page: 9, text: "Our limits are set per product." },
      t: T("t", 10),
      cap: { id: "cap", type: "caption", page: 10, for: "t", text: "Table 3. Heavy metal limits" },
      p1: { id: "p1", type: "para", page: 10, text: "These apply to all finished goods." },
    },
  };
}
function regDoc() {
  return {
    schema: "pxd-parse/1",
    title: "Regulation 2024/12",
    pages: [{ n: 3 }],
    order: ["rh", "rp"],
    blocks: {
      rh: { id: "rh", type: "heading", level: 1, page: 3, text: "Maximum levels" },
      rp: { id: "rp", type: "para", page: 3, text: "Lead shall not exceed 10 ppb in infant formula." },
    },
  };
}

test("multi context: one block per part with label, document, section, focus as markdown, caption and one paragraph either side", () => {
  const a = makePart({ doc: reportDoc(), focus: { blockId: "t" }, pdfUid: "pdfA" });
  const b = makePart({ doc: regDoc(), focus: { blockId: "rp" }, pdfUid: "pdfB" });
  assert.equal(a.label, "Table 3 · p. 10 · Annual report");
  assert.equal(b.label, "Paragraph · p. 3 · Regulation 2024/12");
  const built = buildMultiContext([a, b], "do our limits meet the regulation?");
  assert.equal(built.instructions, MULTI_INSTRUCTIONS);
  assert.match(built.context, /=== Part 1 — Table 3 · p\. 10 · Annual report ===/);
  assert.match(built.context, /=== Part 2 — Paragraph · p\. 3 · Regulation 2024\/12 ===/);
  assert.match(built.context, /Document: Annual report/);
  assert.match(built.context, /Document: Regulation 2024\/12/);
  assert.match(built.context, /Section: Limits/);
  assert.match(built.context, /\| Lead \| 5 ppb \|/);
  assert.match(built.context, /Caption: Table 3\. Heavy metal limits/);
  assert.match(built.context, /Our limits are set per product\./);
  assert.match(built.context, /These apply to all finished goods\./);
  assert.match(built.context, /Lead shall not exceed 10 ppb/);
  assert.match(MULTI_INSTRUCTIONS, /\[Part N, p\. M\]/);
  assert.match(MULTI_INSTRUCTIONS, /different PDFs/);
  assert.match(MULTI_INSTRUCTIONS, /do not support/);
  assert.doesNotMatch(built.context, /Image of Part/);
});

test("multi context: figure parts put their own Image of Part N line first, with the vision instructions", () => {
  const fig = makePart({ doc: DOC, focus: { blockId: "f" }, pdfUid: "pdfA" });
  const para = makePart({ doc: regDoc(), focus: { blockId: "rp" }, pdfUid: "pdfB" });
  const built = buildMultiContext([para, { ...fig, imageUrl: "https://files.test/fig.png" }], "q");
  assert.ok(built.context.startsWith("Image of Part 2:\n![Figure 2. Sodium mg by week](https://files.test/fig.png)"));
  assert.match(built.instructions, /Image of Part N/);
  assert.equal([...built.context.matchAll(/!\[[^\]]*\]\(http[^\s)]+\)/g)].length, 1);
});

test("multi context: eight big parts stay inside the budget and every part keeps a share", () => {
  const big = (tag) => {
    const paras = {};
    const order = [];
    for (let i = 0; i < 40; i += 1) { paras[`p${i}`] = { id: `p${i}`, type: "para", page: 1 + (i % 5), text: `${tag} sentence ${i} ${"lorem ipsum dolor ".repeat(60)}` }; order.push(`p${i}`); }
    const cells = [];
    for (let r = 0; r < 60; r += 1) for (let c = 0; c < 6; c += 1) cells.push({ r, c, text: `${tag}-cell-${r}-${c}-${"x".repeat(20)}` });
    paras.t = { id: "t", type: "table", page: 2, rows: 60, cols: 6, cells };
    order.splice(10, 0, "t");
    return { schema: "pxd-parse/1", title: `Doc ${tag}`, pages: [{ n: 1 }, { n: 2 }], order, blocks: paras };
  };
  const parts = ["A", "B", "C", "D", "E", "F", "G", "H"].map((tag, i) => makePart({ doc: big(tag), focus: i % 2 ? { blockId: "t" } : { blockId: "p20" }, pdfUid: `pdf${tag}` }));
  const built = buildMultiContext(parts, "compare");
  assert.ok(built.tokensEstimate <= 14000 + 50, `tokens ${built.tokensEstimate}`);
  for (let i = 1; i <= 8; i += 1) assert.match(built.context, new RegExp(`=== Part ${i} — `));
  for (const tag of ["A", "B", "C", "D", "E", "F", "G", "H"]) assert.match(built.context, new RegExp(`Doc ${tag}`));
  const lens = built.context.split(/(?==== Part \d)/).filter((x) => x.startsWith("=== Part")).map((x) => x.length);
  assert.ok(Math.max(...lens) < 3 * Math.min(...lens), `unfair split ${lens.join(",")}`);
  const few = buildMultiContext(parts.slice(0, 2), "compare");
  assert.ok(few.context.length > built.context.length / 3);
});

test("citations: [Part N, p. M] and [Part N] come out with the part; plain [p. M] is unchanged", () => {
  const pieces = splitCitations("See [Part 2, p. 10], also [Part 1] and [p. 4]; [pp. 3, 7].");
  const cites = pieces.filter((x) => x.part != null || x.page != null);
  assert.deepEqual(cites.map((x) => [x.text, x.part ?? null, x.page]), [["[Part 2, p. 10]", 2, 10], ["[Part 1]", 1, null], ["[p. 4]", null, 4], ["[pp. 3, 7]", null, 3]]);
  assert.deepEqual(splitCitations("no cite"), [{ text: "no cite" }]);
});

test("multi dialog: a chip per part with its label, × removes it, Send carries every part and the multi instructions", () => withDom(async (stub, doc) => {
  const basket = createBasket();
  basket.add(makePart({ doc: reportDoc(), focus: { blockId: "t" }, pdfUid: "pdfA" }));
  basket.add(makePart({ doc: regDoc(), focus: { blockId: "rp" }, pdfUid: "pdfB" }));
  basket.add(makePart({ doc: regDoc(), focus: { blockId: "rh" }, pdfUid: "pdfB" }));
  const w = fakeWindow([m("son", "Claude Sonnet 5.5", "Anthropic", false, true)]);
  const jumps = [];
  const d = openAskAI({ multi: { basket, jump: (part, n) => jumps.push([part.pdfUid, n]) }, document: doc, window: w });
  const chips = () => findAll(d.el, "pxd-ask__partchip");
  assert.equal(chips().length, 3);
  assert.equal(find(chips()[0], "pxd-ask__partlabel").textContent, "Part 1: Table 3 · p. 10 · Annual report");
  assert.equal(find(d.el, "pxd-ask__chip").textContent, "3 parts");
  stub.dispatch(find(chips()[2], "pxd-ask__partx"), "click", {});
  assert.equal(chips().length, 2);
  assert.equal(basket.size(), 2);
  find(d.el, "pxd-ask__question").value = "Do our limits meet the regulation?";
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].context, /Part 1 — Table 3/);
  assert.match(w.sent[0].context, /Part 2 — Paragraph · p\. 3/);
  assert.equal(w.sent[0].systemPrompt, MULTI_INSTRUCTIONS);
  assert.equal(w.sent[0].prompt, "Do our limits meet the regulation?");
  assert.equal(w.sent[0].model, "son");
  // a part added while the dialog is open shows up
  basket.add(makePart({ doc: reportDoc(), focus: { blockId: "p1" }, pdfUid: "pdfA" }));
  assert.equal(chips().length, 3);
  // clearing the basket closes the dialog
  basket.clear();
  assert.equal(globalThis.document.body.children.includes?.(d.el) ?? false, false);
}));

test("multi dialog: citations open the part's PDF at the page; bare [p. N] uses the first part; Add as card hands over every part with a short title", () => withDom(async (stub, doc) => {
  const basket = createBasket();
  basket.add(makePart({ doc: reportDoc(), focus: { blockId: "t" }, pdfUid: "pdfA" }));
  basket.add(makePart({ doc: regDoc(), focus: { blockId: "rp" }, pdfUid: "pdfB" }));
  const w = fakeWindow([m("son", "Claude Sonnet 5.5", "Anthropic", false, true)], { generate: async (req) => { w.sent.push(req); return { text: "Limits differ [Part 1, p. 10] vs [Part 2, p. 3].\n\n- Lead is 5 ppb [p. 10]", model: req.model }; } });
  const jumps = [];
  const cards = [];
  const d = openAskAI({
    multi: { basket, jump: (part, n) => jumps.push([part.pdfUid, n]) },
    document: doc,
    window: w,
    addCard: async (payload) => { cards.push(payload); return { ok: true }; },
  });
  find(d.el, "pxd-ask__question").value = "Do our limits meet the regulation, and where do they differ the most?";
  find(d.el, "pxd-ask__send").click();
  await flush();
  const links = findAll(d.el, "pxd-ask__cite");
  assert.deepEqual(links.map((l) => l.getAttribute("data-part")), ["1", "2", null]);
  links[0].click();
  links[1].click();
  links[2].click();
  assert.deepEqual(jumps, [["pdfA", 10], ["pdfB", 3], ["pdfA", 10]]);
  const actions = find(d.el, "pxd-ask__actions");
  assert.equal(actions.hidden, false);
  findAll(actions, "pxd-ask__act").find((b) => b.textContent === "Add as card").click();
  await flush();
  assert.equal(cards.length, 1);
  assert.match(cards[0].markdown.split("\n")[0], /^- AI answer · 2 parts · Do our limits meet the regulation, and where do they differ/);
  assert.ok(cards[0].markdown.split("\n")[0].length < 140);
  assert.deepEqual(cards[0].parts.map((p) => p.pdfUid), ["pdfA", "pdfB"]);
  d.close();
}));

test("multi dialog: figure parts upload their own image on Send, and only for a model that sees images", () => withDom(async (stub, doc) => {
  const basket = createBasket();
  const spec = (n) => ({ key: `s/${n}`, name: n, getBlob: async () => new Blob([new Uint8Array([n.length])], { type: "image/png" }) });
  basket.add(makePart({ doc: DOC, focus: { blockId: "f" }, pdfUid: "pdfA", image: spec("figA") }));
  basket.add(makePart({ doc: regDoc(), focus: { blockId: "rp" }, pdfUid: "pdfB" }));
  let uploads = 0;
  const service = createFigureImages({ store: { getMeta: async () => null, putMeta: async () => true }, upload: async () => `https://files.test/${(uploads += 1)}.png`, shrink: async (b) => b });
  const w = fakeWindow([m("op", "Claude Opus 5.5", "Anthropic", true, true), m("txt", "Text", "P", false)]);
  const d = openAskAI({ multi: { basket, jump() {} }, document: doc, window: w, imageService: service });
  assert.equal(find(d.el, "pxd-ask__model").value, "op");
  assert.match(find(d.el, "pxd-ask__imgnote").textContent, /will see/);
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(uploads, 1);
  assert.ok(w.sent[0].context.startsWith("Image of Part 1:\n!["));
  assert.match(w.sent[0].context, /https:\/\/files\.test\/1\.png/);
  assert.match(w.sent[0].systemPrompt, /Image of Part N/);
  assert.match(w.sent[0].prompt, /^Look at the images/);
  // a model that cannot see: text only, nothing more uploaded
  const sel = find(d.el, "pxd-ask__model");
  sel.value = "txt";
  stub.dispatch(sel, "change", {});
  assert.match(find(d.el, "pxd-ask__imgnote").textContent, /can't see images/);
  find(d.el, "pxd-ask__question").value = "And without the picture?";
  find(d.el, "pxd-ask__send").click();
  await flush();
  assert.equal(uploads, 1);
  assert.doesNotMatch(w.sent[1].context, /Image of Part/);
  d.close();
}));

// ---- 3. answers connected to their sources ----------------------------------------------------------

test("findSourceCard: the PDF card, a card that targets the pin (a Source:: child does not count); nothing otherwise", () => {
  const items = [{ uid: "pdf1", kind: "pdf" }, { uid: "reg1", kind: "region-ref", target: { uid: "pinA" } }, { uid: "note1", kind: "note", content: "src" }];
  assert.equal(findSourceCard(items, { pdfUid: "pdf1" }), "pdf1");
  assert.equal(findSourceCard(items, { pinUid: "pinA", pdfUid: "pdf1" }), "reg1");
  assert.equal(findSourceCard(items, { pinUid: "pinZ", pdfUid: "pdf1" }), "pdf1");
  assert.equal(findSourceCard(items, { pinUid: "pinB", pdfUid: "pdf1", sourceOf: (it) => (it.uid === "note1" ? "pinB" : "") }), "pdf1");
  assert.equal(findSourceCard(items, { pinUid: "pinZ", pdfUid: "elsewhere" }), "");
  assert.equal(findSourceCard([], { pdfUid: "pdf1" }), "");
});

function actionsRig({ items = [], linkSources } = {}) {
  const cards = [];
  const edges = [];
  const session = {
    board: { items: new Map(items.map((it) => [it.uid, it])) },
    ensurePdfPin: async (spec) => ({ ok: true, uid: `pin-${spec.page}` }),
    insertParsedCard: async (a) => { cards.push(a); session.board.items.set("ans", { uid: "ans", kind: "note" }); return { ok: true, uid: "ans" }; },
    addEdge: async (e) => { edges.push(e); return "edge1"; },
  };
  const actions = createParseActions({ session, placeBeside: () => ({ x: 0, y: 0 }), ...(linkSources ? { linkSources } : {}) });
  return { actions, cards, edges, session };
}
const pin = (page) => ({ pdfUid: "pdfA", page, frac: [0, 0, 1, 1] });

test("answer card over several parts: one Source:: per part, pins via ensurePdfPin, whole documents cite the PDF block", async () => {
  const { actions, cards } = actionsRig();
  await actions.insertAnswerCard({
    markdown: "- AI answer",
    pdfUid: "pdfA",
    sources: [{ pdfUid: "pdfA", pin: pin(10) }, { pdfUid: "pdfB", sourceUid: "pdfB" }, { pdfUid: "pdfA", pin: pin(10) }, { pdfUid: "pdfC" }],
  });
  assert.equal(cards[0].sourceUid, "pin-10");
  assert.deepEqual(cards[0].sourceUids, ["pdfB"]);
});

test("answer card draws a source connection to each source card on this board, at most one per source", async () => {
  const items = [{ uid: "pdfA", kind: "pdf" }, { uid: "reg9", kind: "region-ref", target: { uid: "pin-9" } }];
  const { actions, edges } = actionsRig({ items });
  await actions.insertAnswerCard({
    markdown: "- AI answer",
    pdfUid: "pdfA",
    sources: [{ pdfUid: "pdfA", pin: pin(9) }, { pdfUid: "pdfA", pin: pin(10) }, { pdfUid: "pdfB", sourceUid: "pdfB" }],
  });
  // part 1: the card made from pin-9; part 2: no card for pin-10, so the PDF card; part 3: pdfB is not here; the PDF card is already linked once
  assert.deepEqual(edges.map((e) => [e.from, e.to, e.label]), [["ans", "reg9", "source"], ["ans", "pdfA", "source"]]);
});

test("single-part answers link too, and a source that is not on the board is skipped silently", async () => {
  const one = actionsRig({ items: [{ uid: "pdfA", kind: "pdf" }] });
  await one.actions.insertAnswerCard({ markdown: "- AI answer", pdfUid: "pdfA", pin: pin(4) });
  assert.deepEqual(one.edges.map((e) => [e.to, e.label]), [["pdfA", "source"]]);
  const none = actionsRig({ items: [] });
  const res = await none.actions.insertAnswerCard({ markdown: "- AI answer", pdfUid: "pdfA", sourceUid: "pdfA" });
  assert.equal(res.ok, true);
  assert.equal(none.edges.length, 0);
});

test("Link answers to their sources off: no connection; an addEdge failure never breaks the card", async () => {
  const off = actionsRig({ items: [{ uid: "pdfA", kind: "pdf" }], linkSources: () => false });
  await off.actions.insertAnswerCard({ markdown: "- AI answer", pdfUid: "pdfA", sourceUid: "pdfA" });
  assert.equal(off.edges.length, 0);
  const bad = actionsRig({ items: [{ uid: "pdfA", kind: "pdf" }] });
  bad.session.addEdge = async () => { throw new Error("boom"); };
  const res = await bad.actions.insertAnswerCard({ markdown: "- AI answer", pdfUid: "pdfA", sourceUid: "pdfA" });
  assert.equal(res.ok, true);
});

test("session writes one Source:: child per extra source uid", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/session.js", import.meta.url), "utf8");
  assert.match(src, /insertParsedCard\(\{ x, y, w, h, markdown, pin, sourceUid, sourceUids \} = \{\}\)/);
  assert.match(src, /for \(const extra of Array\.isArray\(sourceUids\)/);
});
