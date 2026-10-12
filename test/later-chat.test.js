// WO N (Later list from the 3.26 hunt): chat items C4, C6, C7, C8, K2, K4.
import assert from "node:assert/strict";
import test from "node:test";

import { askThemeChanged, BLOCK_SEARCH_MS, closeAskAI, FLASH_MS, openAskAI } from "../src/view/ask-ai.js";
import { notifyPdfNames } from "../src/model/pdf-name-for.js";
import { createBasket, makePart } from "../src/model/ask-basket.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const DOC = {
  schema: "pxd-parse/1",
  pages: [{ n: 1 }, { n: 3 }, { n: 4 }],
  order: ["h", "p", "t", "f", "c"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Intro" },
    p: { id: "p", type: "para", page: 1, text: "Sodium was 12 mg." },
    t: { id: "t", type: "table", page: 3, cells: [{ r: 0, c: 0, text: "Salt" }, { r: 0, c: 1, text: "4" }] },
    f: { id: "f", type: "figure", page: 4, text: "" },
    c: { id: "c", type: "caption", page: 4, for: "f", text: "Figure 2. Sodium by week" },
  },
};
const walk = (n, fn) => { fn(n); for (const k of n.children || []) walk(k, fn); };
const findAll = (n, cls) => { const out = []; walk(n, (x) => { if (x.className?.split?.(" ").includes(cls)) out.push(x); }); return out; };
const find = (n, cls) => findAll(n, cls)[0] || null;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const m = (id, name, provider = "P", imageInput = false, isDefault = false) => ({ id, name, provider, isDefault, imageInput, capabilities: { imageInput } });

function fakeRoam(state) {
  return {
    data: {
      fast: {
        q(query, ...inputs) {
          if (query.includes("[:find ?t :where [?p :node/title ?t]]")) return state.titles.map((t) => [t]);
          if (query.includes("re-pattern")) { state.blockSearches += 1; return [["blk000001", "Sodium was 12 mg in sample A", "Lab notes"]]; }
          return [];
        },
      },
      pull() { return null; },
    },
    ui: { mainWindow: { getOpenPageOrBlockUid: async () => "pageuid1" } },
  };
}

function fakeWindow({ models = [m("m1", "M1", "P", false, true)], generate = async () => ({ text: "ok", model: "m1" }), liveAI = undefined, state = { titles: ["Sodium"], blockSearches: 0 } } = {}) {
  const store = new Map();
  const listeners = new Map();
  const sent = [];
  return {
    sent,
    state,
    innerWidth: 1200,
    innerHeight: 800,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash: "#/app/mygraph/page/x" },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    roamAlphaAPI: fakeRoam(state),
    ...(liveAI ? { LiveAI: liveAI } : {}),
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => models,
      getDefaultModel: () => models.find((x) => x.isDefault)?.id || models[0].id,
      generate: (options) => { sent.push(options); return generate(options); },
    },
  };
}
function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, globalThis.document)).finally(() => { closeAskAI(); restore(); });
}
const type = (stub, ta, value) => { ta.value = value; try { ta.setSelectionRange?.(value.length, value.length); } catch { /* stub */ } stub.dispatch(ta, "input"); };

test("C4: a Style or More pick gives the focus back to the question; a hand-off pick closes the window instead", () => withDom(async (stub, doc) => {
  const opened = [];
  const w = fakeWindow({ liveAI: { openChatPopup: (o) => { opened.push(o); } } });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const q = find(d.el, "pxd-ask__question");
  find(d.el, "pxd-ask__stylebtn").click();
  const style = findAll(d.el, "pxd-ask__mitem").find((b) => b.getAttribute("data-id") !== "Normal");
  assert.ok(style, "a style to pick");
  style.click();
  assert.ok(doc.activeElement === q, "Style pick refocuses the question");
  find(d.el, "pxd-ask__morebtn").click();
  const copy = findAll(d.el, "pxd-ask__mitem").find((b) => b.getAttribute("data-id") === "clear-chat");
  copy.disabled = false;
  copy.click();
  assert.ok(doc.activeElement === q, "More pick refocuses the question");
  find(d.el, "pxd-ask__agentsbtn").click();
  findAll(d.el, "pxd-ask__mitem").find((b) => b.getAttribute("data-id") === "handoff").click();
  assert.equal(opened.length, 1);
  assert.equal(d.el.isConnected, false, "the hand-off closed ours");
}));

test("C6: the Enter that commits an IME composition does not pick a suggestion or send", () => withDom(async (stub, doc) => {
  const w = fakeWindow({ state: { titles: ["Sodium", "Sodium chloride"], blockSearches: 0 } });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const q = find(d.el, "pxd-ask__question");
  type(stub, q, "see [[Sod");
  assert.ok(findAll(d.el, "pxd-ask__slabel").length >= 1, "suggestions open");
  stub.dispatch(q, "keydown", { key: "Enter", isComposing: true });
  stub.dispatch(q, "keydown", { key: "Enter", keyCode: 229 });
  assert.equal(q.value, "see [[Sod");
  assert.equal(w.sent.length, 0);
  stub.dispatch(q, "keydown", { key: "Enter" });
  assert.match(q.value, /\[\[Sodium\]\]/, "a plain Enter still picks");
}));

test("C7: Stop during a retried older turn stops that turn, and the newest answer stays", () => withDom(async (stub, doc) => {
  let calls = 0;
  const w = fakeWindow({
    models: [m("a1", "Model A", "PA", false, true), m("b1", "Model B", "PB")],
    generate: async () => {
      calls += 1;
      if (calls === 1) return { text: "", model: "a1" };
      if (calls === 2) return { text: "Second answer", model: "a1" };
      return new Promise(() => {});
    },
  });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const q = find(d.el, "pxd-ask__question");
  q.value = "First?";
  find(d.el, "pxd-ask__send").click();
  await tick(); await tick();
  const retry = find(d.el, "pxd-ask__tryother");
  assert.ok(retry, "the empty answer offers another model");
  q.value = "Second?";
  find(d.el, "pxd-ask__send").click();
  await tick(); await tick();
  assert.equal(findAll(d.el, "pxd-ask__msg--user").length, 2);
  retry.click();
  await tick();
  assert.equal(calls, 3);
  find(d.el, "pxd-ask__stop").click();
  const users = findAll(d.el, "pxd-ask__msg--user").map((n) => n.textContent);
  assert.deepEqual(users, ["Second?"], "the stopped retry (no answer) goes; the newest turn stays");
  assert.match(findAll(d.el, "pxd-ask__msg--ai").map((n) => n.textContent).join(" "), /Second answer/);
}));

test("C8: blur cancels a pending (( block search", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const q = find(d.el, "pxd-ask__question");
  type(stub, q, "((sod");
  stub.dispatch(q, "blur");
  await tick(BLOCK_SEARCH_MS + 60);
  assert.equal(w.state.blockSearches, 0);
  type(stub, q, "((sodi");
  await tick(BLOCK_SEARCH_MS + 60);
  assert.equal(w.state.blockSearches, 1, "without a blur the search runs");
}));

test("C8: the chat re-measures the theme on every open and when the board theme flips while open", () => withDom(async (stub, doc) => {
  const basket = createBasket();
  basket.add(makePart({ doc: DOC, focus: { blockId: "p" }, pdfUid: "pdfA" }));
  const w = fakeWindow();
  const d = openAskAI({ multi: { basket, jump() {} }, document: doc, window: w });
  assert.equal(d.el.classList.contains("pxd-ask--dark"), false);
  const board = doc.createElement("div");
  board.className = "pxd-root pxd-root--dark";
  doc.body.append(board);
  openAskAI({ multi: { basket, jump() {} }, document: doc, window: w });
  assert.equal(d.el.classList.contains("pxd-ask--dark"), true, "re-measured on the second open");
  board.className = "pxd-root";
  askThemeChanged();
  assert.equal(d.el.classList.contains("pxd-ask--dark"), false, "followed the board flip while open");
}));

test("C8: page titles are read again when the chat is opened again on the same conversation", () => withDom(async (stub, doc) => {
  const state = { titles: ["Sodium"], blockSearches: 0 };
  const w = fakeWindow({ state });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const q = find(d.el, "pxd-ask__question");
  type(stub, q, "[[Sod");
  assert.deepEqual(findAll(d.el, "pxd-ask__slabel").map((n) => n.textContent), ["Sodium"]);
  state.titles = ["Sodium", "Sodium bicarbonate"];
  openAskAI({ doc: DOC, blockId: "t", document: doc, window: w });
  type(stub, q, "[[Sod");
  assert.deepEqual(findAll(d.el, "pxd-ask__slabel").map((n) => n.textContent), ["Sodium", "Sodium bicarbonate"]);
}));

test("C8: the hand-off keeps our window when Live AI's chat throws or rejects", () => withDom(async (stub, doc) => {
  const toasts = [];
  for (const openChatPopup of [() => { throw new Error("boom"); }, async () => { throw new Error("later"); }]) {
    const w = fakeWindow({ liveAI: { openChatPopup } });
    const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w, toast: (msg) => toasts.push(msg) });
    find(d.el, "pxd-ask__openlive").click();
    await tick();
    assert.equal(d.el.isConnected, true, "ours stays");
    closeAskAI();
  }
  assert.equal(toasts.filter((t) => /did not open/.test(t)).length, 2);
}));

test("C8: two selections that share the first 80 characters are two parts", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const head = "x".repeat(90);
  const d = openAskAI({ doc: DOC, selection: `${head} first tail`, page: 1, document: doc, window: w });
  openAskAI({ doc: DOC, selection: `${head} second tail`, page: 1, document: doc, window: w });
  assert.equal(findAll(d.el, "pxd-ask__partchip").length, 2);
  openAskAI({ doc: DOC, selection: `${head} second tail`, page: 1, document: doc, window: w });
  assert.equal(findAll(d.el, "pxd-ask__partchip").length, 2, "the same selection again is not a third");
}));

test("C8: a part added while a picture uploads goes along with the question", () => withDom(async (stub, doc) => {
  const basket = createBasket();
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const service = { peek: async () => null, ensureUrl: async () => { await gate; return { ok: true, url: "https://files.test/1.png" }; } };
  basket.add(makePart({ doc: DOC, focus: { blockId: "f" }, pdfUid: "pdfA", image: { key: "s/a", name: "a", getBlob: async () => null } }));
  basket.add(makePart({ doc: DOC, focus: { blockId: "p" }, pdfUid: "pdfA" }));
  const w = fakeWindow({ models: [m("op", "Claude Opus 5.5", "Anthropic", true, true)] });
  const d = openAskAI({ multi: { basket, jump() {} }, document: doc, window: w, imageService: service });
  find(d.el, "pxd-ask__question").value = "Compare";
  find(d.el, "pxd-ask__send").click();
  await tick();
  basket.add(makePart({ doc: DOC, focus: { blockId: "t" }, pdfUid: "pdfA" }));
  release();
  await tick(10);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].context, /=== Part 3 /, "the part added during the upload is in the context");
}));

test("K2: chip names repaint when a PDF identity lands while the chat is open; none after close", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  let name = "";
  const pdfName = () => name;
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w, pdfName });
  openAskAI({ doc: DOC, blockId: "t", document: doc, window: w, pdfName });
  const before = findAll(d.el, "pxd-ask__partlabel").map((n) => n.getAttribute("title")).join(" | ");
  assert.doesNotMatch(before, /Spore heat resistance/);
  name = "Spore heat resistance";
  notifyPdfNames(["u.pdf"]);
  const after = findAll(d.el, "pxd-ask__partlabel").map((n) => n.getAttribute("title")).join(" | ");
  assert.match(after, /Spore heat resistance/);
  closeAskAI();
  name = "Other";
  notifyPdfNames(["u.pdf"]);
  assert.doesNotMatch(findAll(d.el, "pxd-ask__partlabel").map((n) => n.getAttribute("title")).join(" | "), /Other/);
}));

test("K4: the part flash timer is cancelled when the chat closes", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  openAskAI({ doc: DOC, blockId: "t", document: doc, window: w });
  const q = find(d.el, "pxd-ask__question");
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const flashIds = new Set();
  const cleared = new Set();
  globalThis.setTimeout = (fn, ms, ...rest) => { const id = realSet(fn, ms, ...rest); if (ms === FLASH_MS) flashIds.add(id); return id; };
  globalThis.clearTimeout = (id) => { cleared.add(id); return realClear(id); };
  try {
    q.value = "";
    type(stub, q, "@");
    stub.dispatch(q, "keydown", { key: "Enter" });
    assert.ok(flashIds.size >= 1, "the mention flashed a chip");
    closeAskAI();
    for (const id of flashIds) assert.ok(cleared.has(id), "flash timer cleared on close");
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
}));
