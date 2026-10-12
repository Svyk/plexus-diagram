// Ask AI composer (Live AI's row): mentions → roamContext, context/roamContext exclusivity, / commands with custom
// prompts and styles, thinking effort only for thinking models, tool hand-off to Live AI's chat, and the part gutter's
// Copy ▾ split button.
import assert from "node:assert/strict";
import test from "node:test";

import { closeAskAI, openAskAI, PLACEHOLDER } from "../src/view/ask-ai.js";
import * as liveai from "../src/host/liveai.js";
import { taggedBlocks } from "../src/host/roam-lookup.js";
import { applyMention, buildRoamContext, COMMANDS, customItems, effortOptions, effortsFor, filterCommands, PART_HEADER, parseMentions, rankTitles, STYLE_INTRO, triggerAt, withPartContext, withStyle } from "../src/model/ask-composer.js";
import { createPartGutter } from "../src/view/part-gutter.js";
import { createPageChips } from "../src/view/page-chips.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const DOC = {
  schema: "pxd-parse/1",
  pages: [{ n: 1 }],
  order: ["h", "p"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Intro" },
    p: { id: "p", type: "para", page: 1, text: "Sodium was 12 mg." },
  },
};
const walk = (n, fn) => { fn(n); for (const k of n.children || []) walk(k, fn); };
const findAll = (n, cls) => { const out = []; walk(n, (x) => { if (x.className?.split?.(" ").includes(cls)) out.push(x); }); return out; };
const find = (n, cls) => findAll(n, cls)[0] || null;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const TITLES = ["Sodium", "Sodium chloride", "Potassium", "Salt intake", "roam/js", "Daily Notes"];
const TAGGED = {
  "liveai/prompt": [["pr1", "Make a glossary #liveai/prompt", [{ string: "List every technical term", children: [{ string: "with a one-line definition" }] }]]],
  "liveai/style": [["st1", "Pirate voice #[[liveai/style]]", [{ string: "Talk like a pirate." }]]],
};
// Enough of roamAlphaAPI for the composer's lookups: titles, block search, tagged blocks with children, main view.
function fakeRoam() {
  const tree = new Map();
  for (const rows of Object.values(TAGGED)) for (const [uid, , kids] of rows) tree.set(uid, kids);
  const kidsOf = (list) => (list || []).map((k, i) => ({ ":block/string": k.string, ":block/order": i, ":block/children": kidsOf(k.children) }));
  return {
    data: {
      fast: {
        q(query, ...inputs) {
          if (query.includes("[:find ?t :where [?p :node/title ?t]]")) return TITLES.map((t) => [t]);
          if (query.includes("?tag")) return (TAGGED[inputs[0]] || []).map(([u, s]) => [u, s]);
          if (query.includes("re-pattern")) {
            const re = new RegExp(inputs[0].replace(/^\(\?i\)/, ""), "i");
            return [["blk000001", "Sodium was 12 mg in sample A", "Lab notes"], ["blk000002", "nothing here", "Other"]].filter((r) => re.test(r[1]));
          }
          if (query.includes(":node/title ?t]]") && inputs[0] === "pageuid1") return [["Lab notes"]];
          if (query.includes("[:find ?u :in $ ?t :where [?p :node/title ?t]")) return TITLES.includes(inputs[0]) ? [[`uid-${inputs[0]}`]] : [];
          if (query.includes(":block/string ?s]]") && inputs[0] === "blk000001") return [["Sodium was 12 mg in sample A"]];
          return [];
        },
      },
      pull(_pattern, ref) { return { ":block/children": kidsOf(tree.get(ref[1])) }; },
    },
    ui: { mainWindow: { getOpenPageOrBlockUid: async () => "pageuid1" } },
  };
}

function fakeWindow({ models = [{ id: "m1", name: "M1", provider: "P", isDefault: true }], generate = async () => ({ text: "ok", model: "m1" }), withChat = true } = {}) {
  const store = new Map();
  const listeners = new Map();
  const sent = [];
  const opened = [];
  return {
    sent,
    opened,
    innerWidth: 1200,
    innerHeight: 800,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash: "#/app/mygraph/page/x" },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    roamAlphaAPI: fakeRoam(),
    ...(withChat ? { LiveAI: { openChatPopup: (o) => { opened.push(o); } } } : {}),
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => models,
      getDefaultModel: () => models[0].id,
      generate: (options) => { sent.push(options); return generate(options); },
    },
  };
}
function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, globalThis.document)).finally(() => { closeAskAI(); restore(); });
}
const type = (stub, ta, value) => { ta.value = value; stub.dispatch(ta, "input"); };
const key = (stub, ta, k) => stub.dispatch(ta, "keydown", { key: k });
const suggestions = (el) => findAll(el, "pxd-ask__slabel").map((n) => n.textContent);
const menuItems = (el) => findAll(el, "pxd-ask__mitem");

// ------------------------------------------------------------------ model

test("triggers: / at the start, [[ and # pages, (( blocks; a closed mention is no trigger", () => {
  assert.deepEqual(triggerAt("/sum"), { kind: "command", query: "sum", start: 0 });
  assert.equal(triggerAt("what /sum"), null, "a / mid-sentence is text");
  assert.deepEqual(triggerAt("see [[Sod", 9), { kind: "page", query: "Sod", start: 4 });
  assert.equal(triggerAt("see [[Sodium]] x"), null);
  assert.deepEqual(triggerAt("about #sal"), { kind: "tag", query: "sal", start: 6 });
  assert.equal(triggerAt("C#"), null, "a # inside a word is not a tag");
  assert.deepEqual(triggerAt("in ((sod"), { kind: "block", query: "sod", start: 3 });
  const t = triggerAt("see [[Sod]] now", 9);
  assert.deepEqual(applyMention("see [[Sod]] now", t, 9, "[[Sodium]]"), { text: "see [[Sodium]] now", caret: 15 });
});

test("page ranking: exact, prefix, word start, substring, fuzzy; roam/ pages skipped; at most 20", () => {
  assert.deepEqual(rankTitles(TITLES, "sodium"), ["Sodium", "Sodium chloride"]);
  assert.deepEqual(rankTitles(TITLES, "intake"), ["Salt intake"]);
  assert.deepEqual(rankTitles(TITLES, "ptsm"), ["Potassium"], "letters in order");
  assert.equal(rankTitles(TITLES, "js").includes("roam/js"), false);
  assert.equal(rankTitles(Array.from({ length: 50 }, (_, i) => `Page ${i}`), "page").length, 20);
});

test("mentions → roamContext: pages, tags and blocks; the current page joins named pages; sources and days", () => {
  const m = parseMentions("compare [[Sodium chloride]] with #Potassium and #[[Salt intake]] in ((blk000001))");
  assert.deepEqual(m, { pages: ["Sodium chloride", "Potassium", "Salt intake"], blocks: ["blk000001"] });
  assert.equal(buildRoamContext({}), null, "nothing to send");
  assert.deepEqual(buildRoamContext({ pages: m.pages, blocks: m.blocks }), { page: true, pageArgument: ["Sodium chloride", "Potassium", "Salt intake"], block: true, blockArgument: ["blk000001"] });
  assert.deepEqual(buildRoamContext({ pages: ["A"], sources: { page: true, linkedRefs: true, sidebar: true, logPages: true }, logDays: 3, currentTitle: "Lab notes" }),
    { page: true, pageArgument: ["Lab notes", "A"], linkedRefs: true, linkedRefsArgument: ["Lab notes"], sidebar: true, logPages: true, logPagesArgument: 3 });
  assert.deepEqual(buildRoamContext({ sources: { page: true } }), { page: true }, "no title: Live AI fills in the open page");
});

test("with a roamContext the part context rides in the first user message; never both context and roamContext", async () => {
  assert.deepEqual(withPartContext([{ role: "user", content: "Q1" }, { role: "assistant", content: "A1" }], "CTX"), [{ role: "user", content: `${PART_HEADER}\n\nCTX\n\n---\n\nQ1` }, { role: "assistant", content: "A1" }]);
  const sent = [];
  const w = { LiveAI_API: { isAvailable: () => true, generate: async (o) => { sent.push(o); return { text: "x" }; } } };
  await liveai.ask({ context: "CTX", prompt: "Q", window: w });
  assert.equal(sent[0].context, "CTX");
  assert.equal(sent[0].roamContext, undefined);
  await liveai.ask({ context: "CTX", roamContext: { page: true, pageArgument: ["A"] }, prompt: "Q", messages: [{ role: "user", content: "Q0" }, { role: "assistant", content: "A0" }], window: w });
  assert.equal(sent[1].context, undefined, "generate() refuses both");
  assert.deepEqual(sent[1].roamContext, { page: true, pageArgument: ["A"] });
  assert.match(sent[1].prompt[0].content, /^Context from the PDF[^]*CTX[^]*Q0$/);
  assert.equal(sent[1].prompt[2].content, "Q");
  await liveai.ask({ context: "", roamContext: {}, prompt: "Q", thinking: true, effort: "high", window: w });
  assert.equal(sent[2].roamContext, undefined, "an empty roamContext is not sent");
  assert.equal(sent[2].thinking, true);
  assert.equal(sent[2].effort, "high");
});

test("/ menu filtering, custom prompts and styles from tagged blocks, styles in the system prompt", () => {
  assert.equal(filterCommands(COMMANDS, "sum")[0].id, "summarize");
  assert.equal(filterCommands(COMMANDS, "key")[0].id, "keyInsights");
  assert.ok(filterCommands(COMMANDS, "critique").some((c) => c.id === "challengeMyIdeas"), "keywords match");
  assert.equal(filterCommands(COMMANDS, "zzzz").length, 0);
  const w = { roamAlphaAPI: fakeRoam() };
  const prompts = customItems(taggedBlocks(w, "liveai/prompt"), "liveai/prompt");
  assert.deepEqual(prompts, [{ id: "prompt:pr1", uid: "pr1", name: "Make a glossary", prompt: "- List every technical term\n  - with a one-line definition", category: "CUSTOM PROMPTS", custom: true }]);
  const styles = customItems(taggedBlocks(w, "liveai/style"), "liveai/style");
  assert.equal(styles[0].name, "Pirate voice");
  assert.equal(styles[0].prompt, "- Talk like a pirate.");
  assert.equal(customItems([{ uid: "x", string: "Just do it #liveai/prompt", children: [] }], "liveai/prompt")[0].prompt, "Just do it", "no children: the block text is the prompt");
  assert.equal(withStyle("SYS", styles[0]), `SYS\n\n${STYLE_INTRO}- Talk like a pirate.`);
  assert.equal(withStyle("SYS", null), "SYS");
});

test("effort only for thinking models", () => {
  assert.deepEqual(effortsFor({ thinkingEfforts: ["low", "medium", "high", "max"] }), ["low", "medium", "high", "max"]);
  assert.deepEqual(effortsFor({ thinking: false }), []);
  assert.deepEqual(effortOptions("high", { thinkingEfforts: ["low", "high"] }), { thinking: true, effort: "high" });
  assert.deepEqual(effortOptions("off", { thinkingEfforts: ["low"] }), { thinking: false });
  assert.deepEqual(effortOptions("high", { thinkingEfforts: [] }), {}, "a model without thinking gets nothing");
  assert.deepEqual(effortOptions("", { thinkingEfforts: ["low"] }), {}, "model default sends nothing");
});

// ------------------------------------------------------------------ the window

test("the composer row is Live AI's: tools, context, style, Prompts, model, thinking, agents, more; the placeholder names / [[ #", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const row = find(d.el, "pxd-ask__tools");
  const names = findAll(row, "pxd-ask__rowbtn").map((b) => b.getAttribute("aria-label"));
  assert.deepEqual(names.map((n) => n.split(" ")[0]), ["Live", "Context", "Style", "Prompts", "Thinking", "Agents", "More"]);
  assert.ok(find(row, "pxd-ask__model"), "the model picker sits in the row");
  assert.equal(find(d.el, "pxd-ask__question").getAttribute("placeholder"), PLACEHOLDER);
  assert.match(PLACEHOLDER, /\/ for commands, \[\[ or # for pages/);
  assert.equal(find(d.el, "pxd-ask__menu"), null, "menus are built when opened");
}));

test("[[ opens page suggestions; picking inserts [[Title]], adds a chip and sends it as roamContext with the part in the first message", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const ta = find(d.el, "pxd-ask__question");
  type(stub, ta, "Compare with [[sod");
  assert.deepEqual(suggestions(d.el), ["Sodium", "Sodium chloride"]);
  key(stub, ta, "ArrowDown");
  key(stub, ta, "Enter");
  assert.equal(ta.value, "Compare with [[Sodium chloride]] ");
  assert.equal(find(d.el, "pxd-ask__suggest").hidden, true);
  assert.deepEqual(findAll(d.el, "pxd-ask__mchiplabel").map((n) => n.textContent), ["Page: Sodium chloride"]);
  // # works the same way; Escape closes the list without closing the window.
  type(stub, ta, `${ta.value}and #pot`);
  assert.deepEqual(suggestions(d.el), ["Potassium"]);
  key(stub, ta, "Escape");
  assert.equal(find(d.el, "pxd-ask__suggest").hidden, true);
  assert.equal(d.el.isConnected, true);
  find(d.el, "pxd-ask__send").click();
  await tick();
  const o = w.sent[0];
  assert.equal(o.context, undefined);
  assert.deepEqual(o.roamContext, { page: true, pageArgument: ["Sodium chloride"] }, "#pot names no page: not sent");
  const first = Array.isArray(o.prompt) ? o.prompt[0].content : o.prompt;
  assert.match(first, /Sodium was 12 mg\./, "the part rides in the first user message");
  assert.match(first, /Compare with \[\[Sodium chloride\]\]/);
  assert.match(o.systemPrompt, /\[p\. N\]|p\. /, "citation instructions stay");
}));

test("(( searches blocks after a pause; a typed [[Page]] counts on send; a removed chip stays removed", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const ta = find(d.el, "pxd-ask__question");
  type(stub, ta, "see ((sodium");
  await tick(200);
  assert.deepEqual(suggestions(d.el), ["Sodium was 12 mg in sample A"]);
  key(stub, ta, "Tab");
  assert.equal(ta.value, "see ((blk000001)) ");
  assert.deepEqual(findAll(d.el, "pxd-ask__mchiplabel").map((n) => n.textContent), ["Block: Sodium was 12 mg in sample A"]);
  findAll(d.el, "pxd-ask__mchip")[0].querySelector(".pxd-ask__partx").click();
  ta.value = "see ((blk000001)) and [[Potassium]]";
  find(d.el, "pxd-ask__send").click();
  await tick();
  assert.deepEqual(w.sent[0].roamContext, { page: true, pageArgument: ["Potassium"] });
}));

test("context menu: the part can be turned off, current page / linked refs / daily notes become roamContext", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  find(d.el, "pxd-ask__ctxbtn").click();
  const pick = (id) => menuItems(d.el).find((n) => n.getAttribute("data-id") === id).click();
  pick("part");
  pick("page");
  pick("logPages");
  assert.ok(find(d.el, "pxd-ask__menu"), "toggles keep the menu open");
  assert.equal(menuItems(d.el).find((n) => n.getAttribute("data-id") === "part").getAttribute("aria-checked"), "false");
  assert.deepEqual(findAll(d.el, "pxd-ask__mchiplabel").map((n) => n.textContent), ["Current page", "Daily notes (7 days)"]);
  find(d.el, "pxd-ask__question").value = "What did I note?";
  find(d.el, "pxd-ask__send").click();
  await tick();
  const o = w.sent[0];
  assert.deepEqual(o.roamContext, { page: true, pageArgument: ["Lab notes"], logPages: true, logPagesArgument: 7 });
  assert.equal(o.context, undefined);
  assert.equal(o.prompt, "What did I note?", "no PDF part in the prompt");
  assert.equal(o.systemPrompt, undefined);
}));

test("/ opens commands (built-in, custom prompts, styles); a command sends its prompt under its name; a style goes in the system prompt", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const ta = find(d.el, "pxd-ask__question");
  assert.match(ta.value, /\S/, "the default question is in the composer");
  type(stub, ta, `${ta.value}/`);
  assert.equal(ta.value, "/", "a / onto the untouched default question starts a command");
  const all = suggestions(d.el);
  assert.ok(all.includes("Summarize"));
  assert.ok(all.includes("Make a glossary"), "custom #liveai/prompt");
  assert.ok(all.includes("Pirate voice"), "custom #liveai/style");
  assert.ok(all.includes("Translate to French"));
  type(stub, ta, "/pirate");
  assert.deepEqual(suggestions(d.el), ["Pirate voice"]);
  key(stub, ta, "Enter");
  assert.equal(ta.value, "");
  assert.deepEqual(findAll(d.el, "pxd-ask__mchiplabel").map((n) => n.textContent), ["Style: Pirate voice"]);
  type(stub, ta, "/summ");
  assert.equal(suggestions(d.el)[0], "Summarize");
  key(stub, ta, "Enter");
  await tick();
  const o = w.sent[0];
  assert.match(o.prompt, /^Please provide a concise, cohesive summary/);
  assert.match(o.systemPrompt, /Talk like a pirate\.$/);
  assert.equal(find(d.el, "pxd-ask__msg--user").textContent, "/Summarize");
  // The Prompts button lists the same commands with a filter box.
  find(d.el, "pxd-ask__promptsbtn").click();
  const filter = find(d.el, "pxd-ask__mfilter");
  filter.value = "glossary";
  stub.dispatch(filter, "input");
  const items = menuItems(d.el);
  assert.deepEqual(items.map((n) => n.getAttribute("data-id")), ["prompt:pr1"]);
  items[0].click();
  await tick();
  assert.match(w.sent[1].prompt[2].content, /List every technical term/);
}));

test("thinking (brain) shows only for thinking models and sends thinking + effort", () => withDom(async (stub, doc) => {
  const w = fakeWindow({ models: [
    { id: "plain", name: "Plain", provider: "A", isDefault: true, capabilities: { thinking: false }, thinkingEfforts: [] },
    { id: "deep", name: "Deep", provider: "B", capabilities: { thinking: true }, thinkingEfforts: ["low", "medium", "high", "max"] },
  ] });
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const brain = find(d.el, "pxd-ask__effortbtn");
  const sel = find(d.el, "pxd-ask__model");
  sel.value = "plain";
  stub.dispatch(sel, "change");
  assert.equal(brain.hidden, true);
  sel.value = "deep";
  stub.dispatch(sel, "change");
  assert.equal(brain.hidden, false);
  brain.click();
  assert.deepEqual(menuItems(d.el).map((n) => n.getAttribute("data-id")), ["", "off", "low", "medium", "high", "max"]);
  menuItems(d.el).find((n) => n.getAttribute("data-id") === "high").click();
  find(d.el, "pxd-ask__question").value = "Why?";
  find(d.el, "pxd-ask__send").click();
  await tick();
  assert.equal(w.sent[0].thinking, true);
  assert.equal(w.sent[0].effort, "high");
  assert.equal(w.sent[0].model, "deep");
}));

test("a Live AI tool hands the conversation to Live AI's chat with forcedTools; agents and Open in Live AI hand off too", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const ta = find(d.el, "pxd-ask__question");
  ta.value = "Find related notes about [[Sodium]]";
  find(d.el, "pxd-ask__toolsbtn").click();
  assert.match(find(d.el, "pxd-ask__mnote").textContent, /run in Live AI's chat/);
  menuItems(d.el).find((n) => n.getAttribute("data-id") === "ask_your_graph").click();
  assert.equal(w.opened.length, 1);
  assert.equal(find(d.el, "pxd-ask__mnote"), null, "the menu closed with the hand-off");
  const o = w.opened[0];
  assert.ok(o.forcedTools instanceof Set);
  assert.deepEqual([...o.forcedTools], ["ask_your_graph"]);
  assert.equal(o.model, "m1");
  assert.equal(o.roamContext, undefined, "Live AI's panel drops the chat for a results view when it gets a roamContext");
  assert.match(o.conversationHistory[0].content, /Context from Plexus Diagram[^]*Sodium was 12 mg\.[^]*Find related notes[^]*Also use from my Roam graph: \[\[Sodium\]\]\./);
  assert.equal(d.el.isConnected, false, "our window closes");
  const e = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  find(e.el, "pxd-ask__agentsbtn").click();
  menuItems(e.el)[0].click();
  assert.equal(w.opened.length, 2);
  assert.equal(w.opened[1].forcedTools, undefined);
}));

test("⋯ menu: copy and clear the conversation", () => withDom(async (stub, doc) => {
  const w = fakeWindow({ generate: async () => ({ text: "Twelve.", model: "m1" }) });
  const copied = [];
  w.navigator = { clipboard: { writeText: async (t) => { copied.push(t); } } };
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  find(d.el, "pxd-ask__question").value = "How much sodium?";
  find(d.el, "pxd-ask__send").click();
  await tick();
  const more = find(d.el, "pxd-ask__morebtn");
  more.click();
  menuItems(d.el).find((n) => n.getAttribute("data-id") === "copy-chat").click();
  await tick();
  assert.equal(copied[0], "**You:** How much sodium?\n\n**AI:** Twelve.");
  more.click();
  menuItems(d.el).find((n) => n.getAttribute("data-id") === "clear-chat").click();
  assert.equal(findAll(d.el, "pxd-ask__msg").length, 0);
  assert.equal(find(d.el, "pxd-ask__welcome").hidden, false);
}));

test("menus: one at a time, Escape closes the menu before the window, its button toggles it", () => withDom(async (stub, doc) => {
  const w = fakeWindow();
  const d = openAskAI({ doc: DOC, blockId: "p", document: doc, window: w });
  const style = find(d.el, "pxd-ask__stylebtn");
  style.click();
  assert.equal(style.getAttribute("aria-expanded"), "true");
  find(d.el, "pxd-ask__ctxbtn").click();
  assert.equal(findAll(d.el, "pxd-ask__menu").length, 1);
  assert.equal(style.getAttribute("aria-expanded"), "false");
  stub.dispatch(find(d.el, "pxd-ask__menu"), "keydown", { key: "Escape" });
  assert.equal(find(d.el, "pxd-ask__menu"), null);
  assert.equal(d.el.isConnected, true);
  style.click();
  style.click();
  assert.equal(find(d.el, "pxd-ask__menu"), null, "the same button closes it");
}));

// ------------------------------------------------------------------ Copy ▾

test("part gutter: Copy | ▾ split button; ▾ (click or ArrowDown) opens the copy menu, again closes it, Esc closes it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  try {
    const pane = doc.createElement("div");
    pane._rect = { left: 0, top: 0, width: 600, height: 500, right: 600, bottom: 500 };
    doc.body.append(pane);
    let chips = null;
    const copies = [];
    const gutter = createPartGutter({ doc, mount: pane, onCopy: () => true, onMenu: (block, anchor) => chips.openCopyMenu(block, anchor) });
    chips = createPageChips({ doc, host: pane, getParsed: () => ({ blocks: { p1: { id: "p1", type: "para", page: 1, text: "x" } } }), pageEl: () => null, pageOf: () => null, run() {}, copyMenu: (id, block) => { copies.push([id, block.id]); return true; } });
    gutter.intent({ id: "p1", type: "para" }, { left: 300, top: 120, right: 500, bottom: 160 }, { immediate: true });
    const pill = pane.querySelector(".pxd-pgutter");
    const [, copy, more] = pill.querySelectorAll("button");
    assert.equal(more.getAttribute("aria-label"), "Copy as…");
    assert.equal(more.getAttribute("aria-haspopup"), "menu");
    assert.equal(more.tabIndex, 0, "reachable by Tab");
    assert.equal(copy.nextElementSibling, more, "the arrow sits right under Copy");
    stub.dispatch(more, "click");
    const menu = doc.querySelector(".pxd-copy-menu");
    assert.ok(menu, "the copy menu opens");
    assert.equal(menu.getAttribute("data-block"), "p1");
    assert.ok(menu.querySelectorAll(".pxd-copy-menu__item").length >= 3, "all its formats");
    stub.dispatch(more, "click");
    assert.equal(doc.querySelector(".pxd-copy-menu"), null, "▾ again closes it");
    stub.dispatch(more, "keydown", { key: "ArrowDown" });
    const items = doc.querySelector(".pxd-copy-menu").querySelectorAll(".pxd-copy-menu__item");
    assert.equal(doc.activeElement, items[0], "from the keyboard the first format takes the focus");
    stub.dispatch(globalThis.window, "keydown", { key: "ArrowDown" });
    assert.equal(doc.activeElement, items[1]);
    stub.dispatch(globalThis.window, "keydown", { key: "Escape" });
    assert.equal(doc.querySelector(".pxd-copy-menu"), null);
    assert.equal(doc.activeElement, more, "Esc gives the focus back to ▾");
    stub.dispatch(more, "click");
    stub.dispatch(doc.body, "pointerdown");
    assert.equal(doc.querySelector(".pxd-copy-menu"), null, "a press outside closes it");
    chips.dispose();
    gutter.dispose();
  } finally { restore(); }
});
