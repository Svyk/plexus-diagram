import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isTextEntryTarget } from "../src/view/cards.js";
import { askPerf, closeAskAI, DEFAULT_HEIGHT, DEFAULT_WIDTH, EDGE, GEOM_KEY, MIN_HEIGHT, MIN_WIDTH, modelLabel, openAskAI, PAINT_MS, PLACEHOLDER, TITLE } from "../src/view/ask-ai.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const DOC = {
  schema: "pxd-parse/1",
  pages: [{ n: 1 }, { n: 2 }, { n: 3 }],
  order: ["h", "p", "t"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Intro" },
    p: { id: "p", type: "para", page: 1, text: "Sodium was 12 mg." },
    t: { id: "t", type: "table", page: 3, cells: [{ r: 0, c: 0, text: "Salt" }, { r: 0, c: 1, text: "4" }] },
  },
};
const css = readFileSync(new URL("../src/css/ask-ai.css", import.meta.url), "utf8");
const block = (sel) => new RegExp(`${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] || "";
const walk = (n, fn) => { fn(n); for (const k of n.children || []) walk(k, fn); };
const findAll = (n, cls) => { const out = []; walk(n, (x) => { if (x.className?.split?.(" ").includes(cls)) out.push(x); }); return out; };
const find = (n, cls) => findAll(n, cls)[0] || null;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function fakeWindow({ generate = async () => ({ text: "ok", model: "m1" }), liveAI = undefined, width = 1200, height = 800 } = {}) {
  const store = new Map();
  const listeners = new Map();
  const sent = [];
  return {
    store,
    sent,
    innerWidth: width,
    innerHeight: height,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash: "#/app/mygraph/page/x" },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    count: (type) => (listeners.get(type) || []).length,
    ...(liveAI ? { LiveAI: liveAI } : {}),
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => [{ id: "m1", name: "M1", provider: "P", isDefault: true }],
      getDefaultModel: () => "m1",
      generate: (options) => { sent.push(options); return generate(options); },
    },
  };
}
function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, globalThis.document)).finally(() => { closeAskAI(); restore(); });
}

test("the window is built once and reused: close detaches it, the next Ask puts the same element back", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(a.el.getAttribute("role"), "dialog");
  assert.equal(find(a.el, "pxd-ask__title").textContent, TITLE);
  assert.equal(find(a.el, "pxd-ask__question").getAttribute("placeholder"), PLACEHOLDER);
  assert.equal(a.el.isConnected, true);
  const composer = find(a.el, "pxd-ask__composer");
  a.close();
  assert.equal(a.el.isConnected, false);
  assert.equal(w.count("resize"), 0);
  const b = openAskAI({ doc: DOC, blockId: "t", document: doc, window: w });
  assert.equal(b.el, a.el);
  assert.equal(find(b.el, "pxd-ask__composer"), composer);
  assert.equal(findAll(doc.body, "pxd-ask").length, 1);
  assert.match(find(b.el, "pxd-ask__chip").textContent, /Table · p\. 3/);
  assert.ok(askPerf.lastOpenMs < 16, `reopen took ${askPerf.lastOpenMs.toFixed(2)} ms`);
}));

test("a second Ask while the window is open adds its part as a chip and focuses the composer; both parts are sent", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const jumps = [];
  const a = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w, jumpPage: (n) => jumps.push(["a", n]) });
  doc.body.focus();
  const b = openAskAI({ doc: DOC, blockId: "t", document: doc, window: w, jumpPage: (n) => jumps.push(["b", n]) });
  assert.equal(b.el, a.el);
  assert.equal(findAll(doc.body, "pxd-ask").length, 1, "one window");
  const chips = findAll(a.el, "pxd-ask__partlabel").map((n) => n.textContent);
  assert.deepEqual(chips, ["Part 1: Paragraph · p. 1 · Intro", "Part 2: Table · p. 3 · Intro"]);
  assert.equal(find(a.el, "pxd-ask__chip").textContent, "2 parts");
  assert.equal(doc.activeElement, find(a.el, "pxd-ask__question"));
  // The same part again is not a third chip.
  openAskAI({ doc: DOC, blockId: "t", document: doc, window: w });
  assert.equal(findAll(a.el, "pxd-ask__partchip").length, 2);
  find(a.el, "pxd-ask__question").value = "Compare them";
  find(a.el, "pxd-ask__send").click();
  await tick();
  assert.match(w.sent[0].context, /=== Part 1 — Paragraph · p\. 1 · Intro ===/);
  assert.match(w.sent[0].context, /=== Part 2 — Table · p\. 3 · Intro ===/);
  // Removing a chip goes back to one part.
  findAll(a.el, "pxd-ask__partx")[1].click();
  assert.equal(find(a.el, "pxd-ask__parts").hidden, true);
  assert.match(find(a.el, "pxd-ask__chip").textContent, /Paragraph · p\. 1/);
}));

test("+ whole PDF adds the whole document next to the part", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const add = find(d.el, "pxd-ask__addwhole");
  assert.equal(add.hidden, false);
  add.click();
  assert.deepEqual(findAll(d.el, "pxd-ask__partlabel").map((n) => n.textContent.replace(/ · .*$/, "")), ["Part 1: Paragraph", "Part 2: Whole document"]);
  assert.equal(add.hidden, true);
}));

test("drag by the header moves a transform each frame, clamps to the viewport and keeps the place per device", () => withDom(async (stub, doc) => {
  const w = fakeWindow({ width: 1200, height: 800 });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  // Default: bottom-right, 420x560.
  assert.equal(d.el.style.width, `${DEFAULT_WIDTH}px`);
  assert.equal(d.el.style.height, `${DEFAULT_HEIGHT}px`);
  assert.equal(d.el.style.left, `${1200 - DEFAULT_WIDTH - EDGE}px`);
  assert.equal(d.el.style.top, `${800 - DEFAULT_HEIGHT - EDGE}px`);
  let boardSaw = 0;
  doc.addEventListener("pointerdown", () => { boardSaw += 1; });
  const head = find(d.el, "pxd-ask__head");
  stub.dispatch(head, "pointerdown", { button: 0, clientX: 900, clientY: 300 });
  assert.equal(boardSaw, 0, "the board never sees the press");
  stub.dispatch(doc, "pointermove", { clientX: 600, clientY: 200 });
  stub.dispatch(doc, "pointermove", { clientX: 500, clientY: 250 });
  assert.equal(stub.flushFrames(), 1, "one write per frame");
  assert.equal(d.el.style.transform, "translate3d(-400px, -50px, 0)");
  stub.dispatch(doc, "pointermove", { clientX: -5000, clientY: -5000 });
  stub.dispatch(doc, "pointerup", {});
  assert.equal(d.el.style.left, "0px");
  assert.equal(d.el.style.top, "0px");
  assert.equal(d.el.style.transform, "");
  assert.deepEqual(JSON.parse(w.store.get(GEOM_KEY)), { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, x: 0, y: 0 });
  // Later moves after pointerup do nothing.
  stub.dispatch(doc, "pointermove", { clientX: 300, clientY: 300 });
  assert.equal(d.el.style.left, "0px");
  // Past the right/bottom edge it stops at the edge.
  stub.dispatch(head, "pointerdown", { button: 0, clientX: 10, clientY: 10 });
  stub.dispatch(doc, "pointermove", { clientX: 5000, clientY: 5000 });
  stub.dispatch(doc, "pointerup", {});
  assert.equal(d.el.style.left, `${1200 - DEFAULT_WIDTH}px`);
  assert.equal(d.el.style.top, `${800 - DEFAULT_HEIGHT}px`);
  // A frame queued before pointerup does not put the drag offset back.
  stub.flushFrames();
  assert.equal(d.el.style.transform, "");
  d.close();
  const again = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(again.el.style.left, `${1200 - DEFAULT_WIDTH}px`);
  // Double-click the header: back to the default place.
  stub.dispatch(find(again.el, "pxd-ask__head"), "dblclick", {});
  assert.equal(again.el.style.left, `${1200 - DEFAULT_WIDTH - EDGE}px`);
  assert.equal(JSON.parse(w.store.get(GEOM_KEY)).x, null);
  // A press on a header button is a click, not a drag.
  stub.flushFrames();
  stub.dispatch(find(again.el, "pxd-ask__collapse"), "pointerdown", { button: 0, clientX: 0, clientY: 0 });
  stub.dispatch(doc, "pointermove", { clientX: 400, clientY: 400 });
  assert.equal(stub.frames.length, 0);
}));

test("resize from the corner: never below the minimum size or past the viewport; kept per device", () => withDom(async (stub, doc) => {
  const w = fakeWindow({ width: 1200, height: 800 });
  w.store.set(GEOM_KEY, JSON.stringify({ w: 500, h: 500, x: 100, y: 100 }));
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(d.el.style.left, "100px");
  const grip = find(d.el, "pxd-ask__resize");
  stub.dispatch(grip, "pointerdown", { button: 0, clientX: 600, clientY: 600 });
  stub.dispatch(doc, "pointermove", { clientX: 0, clientY: 0 });
  stub.flushFrames();
  assert.equal(d.el.style.width, `${MIN_WIDTH}px`);
  assert.equal(d.el.style.height, `${MIN_HEIGHT}px`);
  stub.dispatch(doc, "pointermove", { clientX: 9000, clientY: 9000 });
  stub.dispatch(doc, "pointerup", {});
  assert.equal(d.el.style.width, "1100px");
  assert.equal(d.el.style.height, "700px");
  assert.deepEqual(JSON.parse(w.store.get(GEOM_KEY)), { w: 1100, h: 700, x: 100, y: 100 });
  // A smaller viewport later: the window shrinks and moves to fit.
  d.close();
  const small = fakeWindow({ width: 600, height: 500 });
  small.store.set(GEOM_KEY, w.store.get(GEOM_KEY));
  const s = openAskAI({ doc: DOC, blockId: "p", document: doc, window: small });
  assert.equal(s.el.style.width, "584px");
  assert.equal(s.el.style.left, "16px");
}));

test("above a fullscreen board and Roam's sidebar; clicks and keys inside never reach the board or Roam", () => withDom(async (stub, doc) => {
  doc.body.classList.add("pxd-has-fullscreen");
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.ok(d.el.classList.contains("pxd-ask--over-fullscreen"));
  const z = Number(/z-index: (\d+)/.exec(block(".pxd-ask"))[1]);
  const fullscreenZ = Number(/\.pxd-mount--fullscreen \{[^}]*z-index: (\d+)/.exec(readFileSync(new URL("../src/extension.css", import.meta.url), "utf8"))[1]);
  assert.ok(z > fullscreenZ, `${z} > ${fullscreenZ}`);
  assert.match(block(".pxd-ask"), /position: fixed/);
  const seen = [];
  for (const type of ["pointerdown", "mousedown", "click", "wheel", "keydown", "keyup"]) doc.addEventListener(type, () => seen.push(type));
  const ta = find(d.el, "pxd-ask__question");
  for (const type of ["pointerdown", "mousedown", "click", "wheel"]) stub.dispatch(find(d.el, "pxd-ask__log"), type, {});
  stub.dispatch(ta, "keydown", { key: "k", metaKey: true });
  stub.dispatch(ta, "keyup", { key: "k" });
  assert.deepEqual(seen, []);
  // Board shortcuts treat every key in the window as the window's, on a button too.
  assert.equal(isTextEntryTarget(find(d.el, "pxd-ask__chip")), true);
  // Leaving fullscreen does not move it.
  const left = d.el.style.left;
  doc.body.classList.remove("pxd-has-fullscreen");
  assert.equal(d.el.style.left, left);
  assert.equal(d.el.isConnected, true);
}));

test("Esc: stops a stream first; in the composer it closes only when the box is empty (or still the suggested question)", () => withDom(async (stub, doc) => {
  let push = null;
  const w = fakeWindow({ generate: (o) => new Promise(() => { push = o.onChunk; }) });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const ta = find(d.el, "pxd-ask__question");
  ta.value = "My own question";
  stub.dispatch(ta, "keydown", { key: "Escape" });
  assert.equal(d.el.isConnected, true, "typed text keeps it open");
  find(d.el, "pxd-ask__send").click();
  push("partial");
  ta.value = "next one";
  stub.dispatch(ta, "keydown", { key: "Escape" });
  assert.equal(d.el.isConnected, true);
  assert.equal(find(d.el, "pxd-ask__status").textContent, "Stopped.");
  assert.equal(find(d.el, "pxd-ask__stop").hidden, true);
  ta.value = "";
  stub.dispatch(ta, "keydown", { key: "Escape" });
  assert.equal(d.el.isConnected, false);
  // The suggested question counts as empty.
  const e = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const ta2 = find(e.el, "pxd-ask__question");
  assert.ok(ta2.value.length > 0);
  stub.dispatch(ta2, "keydown", { key: "Escape" });
  assert.equal(e.el.isConnected, false);
}));

test("a conversation: Enter sends, the composer clears, earlier turns go along as messages, bubbles stack", () => withDom(async (stub, doc) => {
  let n = 0;
  const w = fakeWindow({ generate: async (o) => { n += 1; o.onChunk(`answer ${n}`); return { text: `answer ${n}`, model: "m1" }; } });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const ta = find(d.el, "pxd-ask__question");
  ta.value = "What is the sodium?";
  stub.dispatch(ta, "keydown", { key: "Enter" });
  await tick();
  assert.equal(ta.value, "");
  assert.equal(typeof w.sent[0].prompt, "string");
  assert.equal(w.sent[0].prompt, "What is the sodium?");
  ta.value = "Is that high?";
  stub.dispatch(ta, "keydown", { key: "Enter", shiftKey: true });
  assert.equal(w.sent.length, 1, "Shift+Enter is a new line");
  stub.dispatch(ta, "keydown", { key: "Enter" });
  await tick();
  assert.deepEqual(w.sent[1].prompt, [
    { role: "user", content: "What is the sodium?" },
    { role: "assistant", content: "answer 1" },
    { role: "user", content: "Is that high?" },
  ]);
  assert.match(w.sent[1].context, /Sodium was 12 mg/);
  const users = findAll(d.el, "pxd-ask__msg--user").map((m) => m.textContent);
  const ais = findAll(d.el, "pxd-ask__msg--ai").map((m) => find(m, "pxd-ask__bubble").textContent);
  assert.deepEqual(users, ["What is the sodium?", "Is that high?"]);
  assert.deepEqual(ais, ["answer 1", "answer 2"]);
  // Only the newest answer is the live one, and the actions sit under it.
  assert.equal(findAll(d.el, "pxd-ask__answer").length, 1);
  assert.equal(find(d.el, "pxd-ask__answer").textContent, "answer 2");
  assert.equal(find(d.el, "pxd-ask__actions").parentElement, findAll(d.el, "pxd-ask__msg--ai")[1]);
  assert.equal(find(d.el, "pxd-ask__welcome").hidden, true);
}));

test("Add last answer to board (composer ⋯ menu) adds the last answer as a card", () => withDom(async (stub, doc) => {
  const cards = [];
  const w = fakeWindow({ generate: async () => ({ text: "The answer.", model: "m1" }) });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w, addCard: async (c) => { cards.push(c); } });
  const more = find(d.el, "pxd-ask__morebtn");
  const addItem = () => findAll(d.el, "pxd-ask__mitem").find((n) => n.getAttribute("data-id") === "add-board");
  more.click();
  assert.equal(addItem().disabled, true);
  more.click();
  find(d.el, "pxd-ask__send").click();
  await tick();
  more.click();
  const add = addItem();
  assert.equal(add.disabled, false);
  add.click();
  await tick();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].blockId, "p");
  assert.match(cards[0].markdown, /The answer\./);
}));

test("streaming appends text between paints and redraws the Markdown at most every PAINT_MS", () => withDom(async (stub, doc) => {
  let push = null;
  let finish = null;
  const w = fakeWindow({ generate: (o) => new Promise((resolve) => { push = o.onChunk; finish = resolve; }) });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  find(d.el, "pxd-ask__send").click();
  push("**Bold** start");
  const out = find(d.el, "pxd-ask__answer");
  assert.equal(out.querySelector("strong").textContent, "Bold");
  const p = out.querySelector("p");
  push(" more");
  push(" and more");
  assert.equal(out.querySelector("p"), p, "no redraw between paints");
  assert.equal(out.textContent, "Bold start more and more");
  await tick(PAINT_MS + 20);
  assert.notEqual(out.querySelector("p"), p, "redrawn once the interval passed");
  assert.equal(out.textContent, "Bold start more and more");
  finish({ text: "**Bold** start more and more", model: "m1" });
  await tick();
  assert.equal(find(d.el, "pxd-ask__actions").hidden, false);
}));

test("Open in Live AI hands over the conversation with the context first, then closes ours; hidden without Live AI", () => withDom(async (stub, doc) => {
  const calls = [];
  const w = fakeWindow({ liveAI: { openChatPopup: async (o) => { calls.push(o); } }, generate: async () => ({ text: "12 mg [p. 1]", model: "m1" }) });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const btn = find(d.el, "pxd-ask__openlive");
  assert.equal(btn.hidden, false);
  find(d.el, "pxd-ask__question").value = "Sodium?";
  find(d.el, "pxd-ask__send").click();
  await tick();
  find(d.el, "pxd-ask__question").value = "And salt?";
  btn.click();
  assert.equal(calls.length, 1);
  const h = calls[0].conversationHistory;
  assert.deepEqual(h.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(h[0].content, /^Context from Plexus Diagram \(Paragraph · p\. 1 · Intro\)/);
  assert.match(h[0].content, /Sodium was 12 mg/);
  assert.match(h[0].content, /Sodium\?$/);
  assert.equal(h[1].content, "12 mg [p. 1]");
  assert.equal(h[2].content, "And salt?");
  assert.equal(calls[0].model, "m1");
  assert.equal(d.el.isConnected, false);
  const plain = openAskAI({ doc: DOC, blockId: "p", document: doc, window: fakeWindow() });
  assert.equal(find(plain.el, "pxd-ask__openlive").hidden, true);
}));

test("Live AI missing: the window opens with the setup message and how to enable it", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  delete w.LiveAI_API;
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  assert.equal(d.el.isConnected, true);
  const hints = findAll(d.el, "pxd-ask__hint").map((n) => n.textContent);
  assert.match(hints[0], /Enable Public API/);
  assert.match(hints[1], /How to enable/);
  assert.equal(find(d.el, "pxd-ask__send"), null);
}));

test("collapse leaves only the header; a new Ask opens it again", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  find(d.el, "pxd-ask__collapse").click();
  assert.ok(d.el.classList.contains("pxd-ask--collapsed"));
  assert.equal(d.el.style.height, "");
  assert.match(css, /\.pxd-ask\.pxd-ask--collapsed > :not\(\.pxd-ask__head\) \{\s*display: none;/);
  openAskAI({ doc: DOC, blockId: "t", document: doc, window: w });
  assert.ok(!d.el.classList.contains("pxd-ask--collapsed"));
  assert.equal(d.el.style.height, `${DEFAULT_HEIGHT}px`);
}));

test("the status line names the answering model by its picker label, from the name or the API id", () => {
  const options = [{ value: "Claude Sonnet 5.5", textContent: "Claude Sonnet 5.5 · Anthropic" }, { value: "GPT 6 Sol", textContent: "GPT 6 Sol · OpenAI" }];
  assert.equal(modelLabel(options, "claude-sonnet-5-5"), "Claude Sonnet 5.5 · Anthropic");
  assert.equal(modelLabel(options, "Claude Sonnet 5.5"), "Claude Sonnet 5.5 · Anthropic");
  assert.equal(modelLabel(options, "gpt-6-sol"), "GPT 6 Sol · OpenAI");
  assert.equal(modelLabel(options, "mystery-1"), "");
});
