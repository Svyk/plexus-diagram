import assert from "node:assert/strict";
import test from "node:test";

import { answerCardMarkdown, buildFocusContext, imageAlt, imageDoc, contextWithImage, imageLine, promptWithImage, FIGURE_INSTRUCTIONS } from "../src/model/ai-context.js";
import { asBlob, createFigureImages, fitSize, isUsableImageUrl, noteFor, ENCRYPTED_NOTE, UPLOAD_FAILED_NOTE } from "../src/host/figure-image.js";
import * as liveai from "../src/host/liveai.js";
import { openAskAI } from "../src/view/ask-ai.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createParseStore } from "../src/host/parse-store.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const ROAM_IMAGE_RE = /!\[([^\]]*)\]\((http[^\s)]+)\)/g;
const PNG = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" });

const DOC = {
  schema: "pxd-parse/1",
  pages: [{ n: 1 }, { n: 4 }],
  order: ["h", "f", "c"],
  blocks: {
    h: { id: "h", type: "heading", level: 1, page: 1, text: "Results" },
    f: { id: "f", type: "figure", page: 4, text: "" },
    c: { id: "c", type: "caption", page: 4, for: "f", text: "Figure 2. Sodium (mg) by week [n=12]" },
  },
};

function find(node, cls) {
  if (node.className?.split?.(" ").includes(cls)) return node;
  for (const kid of node.children || []) {
    const hit = find(kid, cls);
    if (hit) return hit;
  }
  return null;
}

function fakeWindow(models, over = {}) {
  const sent = [];
  const store = new Map();
  return {
    sent,
    AbortController,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    location: { hash: "#/app/mygraph/page/x" },
    addEventListener() {},
    removeEventListener() {},
    LiveAI_API: {
      isAvailable: () => true,
      listModels: () => models,
      getDefaultModel: () => models.find((m) => m.isDefault)?.id,
      generate: async (req) => { sent.push(req); return { text: "ok", model: req.model }; },
      ...over,
    },
  };
}

const TEXT = { id: "t", name: "Text", provider: "P", isDefault: true, capabilities: { imageInput: false } };
const VISION = { id: "v", name: "Vision", provider: "P", capabilities: { imageInput: true } };

test("image line: captions with brackets, parens, bangs and breaks stay one match of Roam's image pattern", () => {
  const nasty = "Figure 2. Sodium (mg) [n=12]!\nsee ![x](http://evil)";
  const line = imageLine("https://x.test/a.png", nasty);
  const hits = [...line.matchAll(ROAM_IMAGE_RE)];
  assert.equal(hits.length, 1);
  assert.equal(hits[0][2], "https://x.test/a.png");
  assert.doesNotMatch(hits[0][1], /[[\]()!\n]/);
  assert.match(hits[0][1], /^Figure 2\. Sodium mg n=12/);
  assert.equal(imageAlt(""), "Figure");
  assert.equal(imageAlt("((", "Image"), "Image");
  assert.ok(imageAlt("a".repeat(400)).length <= 120);
  assert.equal(contextWithImage("CTX", "https://x.test/a.png", "Fig"), "Image of the selected part:\n![Fig](https://x.test/a.png)\n\nCTX");
  assert.equal(contextWithImage("CTX", "", "Fig"), "CTX");
  assert.equal(promptWithImage("Why?", "https://x.test/a.png"), "Look at the image of the selected part. Why?");
  assert.equal(promptWithImage("Why?", ""), "Why?");
});

test("figure focus: caption in context, build reports the figure, image instructions read values and refuse invention", () => {
  const built = buildFocusContext(DOC, { blockId: "f" });
  assert.equal(built.figure.caption, "Figure 2. Sodium (mg) by week [n=12]");
  assert.match(built.context, /Figure caption: Figure 2/);
  assert.match(FIGURE_INSTRUCTIONS, /axes/);
  assert.match(FIGURE_INSTRUCTIONS, /not legible/);
  assert.match(FIGURE_INSTRUCTIONS, /\[p\. N\]/);
  assert.equal(buildFocusContext(DOC, { blockId: "h" }).figure, null);
  const card = imageDoc({ caption: "Plant layout", title: "Notes" });
  const img = buildFocusContext(card, { blockId: "img" });
  assert.doesNotMatch(img.context, /p\. 1/);
  assert.doesNotMatch(img.context, /Pages:/);
  assert.equal(img.chip.page, null);
});

test("answer card gets the image as first child only when one was sent", () => {
  const withImg = answerCardMarkdown({ answer: "It rises.", chip: { label: "Figure 2" }, imageUrl: "https://x.test/a.png" }).split("\n");
  assert.equal(withImg[1], "  - ![](https://x.test/a.png)");
  assert.doesNotMatch(answerCardMarkdown({ answer: "It rises.", chip: { label: "Figure 2" } }), /!\[/);
});

test("vision detection reads capabilities.imageInput from ModelInfo", () => {
  const w = fakeWindow([TEXT, VISION, { id: "n", name: "No caps" }]);
  const rows = liveai.listModels(w);
  assert.deepEqual(rows.map((m) => [m.id, m.imageInput]), [["t", false], ["v", true], ["n", false]]);
  assert.equal(liveai.sendsImages({ capabilities: { imageInput: true } }), true);
  assert.equal(liveai.sendsImages({ capabilities: ["imageInput"] }), false);
  assert.equal(liveai.sendsImages(null), false);
});

test("url rules: https only, no encrypted files; sizes and blobs", () => {
  assert.equal(isUsableImageUrl("https://firebasestorage.test/o/a.png?alt=media"), true);
  assert.equal(isUsableImageUrl("https://firebasestorage.test/o/a.png.enc?alt=media"), false);
  assert.equal(isUsableImageUrl("data:image/png;base64,AAAA"), false);
  assert.equal(isUsableImageUrl("blob:https://x/1"), false);
  assert.equal(isUsableImageUrl("http://x.test/a.png"), false);
  assert.deepEqual(fitSize(3200, 1600), { w: 1600, h: 800, scale: 0.5 });
  assert.equal(fitSize(800, 600).scale, 1);
  assert.equal(asBlob("data:image/png;base64,iVBORw0KGgo=").type, "image/png");
  assert.equal(asBlob("nope"), null);
});

function fakeStore() {
  const meta = new Map();
  return { meta, getMeta: async (k) => meta.get(k) ?? null, putMeta: async (k, v) => { meta.set(k, v); return true; } };
}

test("upload once: second ask reuses the cached URL after a live check; 404 re-uploads", async () => {
  const store = fakeStore();
  let uploads = 0;
  const status = { code: 200 };
  const fetched = [];
  const svc = createFigureImages({
    store,
    upload: async (file) => { uploads += 1; assert.match(file.name, /\.png$/); return `https://files.test/${uploads}.png`; },
    fetchFn: async (url, opts) => { fetched.push([url, opts.method]); return { status: status.code }; },
    shrink: async (b) => b,
  });
  const spec = { key: "sha/b1", name: "figure-p4", getBlob: async () => PNG() };
  const first = await svc.ensureUrl(spec);
  assert.deepEqual([first.ok, first.url, first.uploaded], [true, "https://files.test/1.png", true]);
  assert.equal(store.meta.get("figure-url:sha/b1").url, "https://files.test/1.png");
  const second = await svc.ensureUrl(spec);
  assert.deepEqual([second.ok, second.url, second.uploaded], [true, "https://files.test/1.png", false]);
  assert.equal(uploads, 1);
  assert.deepEqual(fetched, [["https://files.test/1.png", "HEAD"]]);
  assert.equal(await svc.peek("sha/b1"), "https://files.test/1.png");
  status.code = 404;
  const third = await svc.ensureUrl(spec);
  assert.deepEqual([third.url, third.uploaded], ["https://files.test/2.png", true]);
  assert.equal(uploads, 2);
});

test("upload once survives a network error on the check and shares one in-flight upload", async () => {
  const store = fakeStore();
  let uploads = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const svc = createFigureImages({
    store,
    upload: async () => { uploads += 1; await gate; return "https://files.test/a.png"; },
    fetchFn: async () => { throw new TypeError("cors"); },
    shrink: async (b) => b,
  });
  const spec = { key: "k", getBlob: async () => PNG() };
  const a = svc.ensureUrl(spec);
  const b = svc.ensureUrl(spec);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(uploads, 1);
  assert.equal(ra.url, rb.url);
  const again = await svc.ensureUrl(spec);
  assert.equal(again.uploaded, false);
  assert.equal(uploads, 1);
});

test("the URL cache lives in the parse store under a meta key", async () => {
  const store = createParseStore({ indexedDB: undefined });
  assert.equal(await store.getMeta("figure-url:a/b"), null);
  assert.equal(await store.putMeta("figure-url:a/b", { url: "https://x.test/a.png" }), true);
  assert.equal((await store.getMeta("figure-url:a/b")).url, "https://x.test/a.png");
  assert.equal(await store.findByUrl("meta:figure-url:a/b"), null);
});

test("encrypted graph: no upload, no fetch; a .enc URL back from upload is unusable; off setting does nothing", async () => {
  let uploads = 0;
  const enc = createFigureImages({ store: fakeStore(), upload: async () => { uploads += 1; return "x"; }, encrypted: () => true, shrink: async (b) => b });
  assert.deepEqual(await enc.ensureUrl({ key: "k", getBlob: async () => PNG() }), { ok: false, reason: "encrypted" });
  assert.deepEqual(await enc.ensureUrl({ url: "https://x.test/a.png", key: "k" }), { ok: false, reason: "encrypted" });
  assert.equal(uploads, 0);
  const odd = createFigureImages({ store: fakeStore(), upload: async () => "https://files.test/a.png.enc?alt=media", shrink: async (b) => b });
  assert.deepEqual(await odd.ensureUrl({ key: "k2", getBlob: async () => PNG() }), { ok: false, reason: "encrypted" });
  const failing = createFigureImages({ store: fakeStore(), upload: async () => { throw new Error("boom"); }, shrink: async (b) => b });
  assert.deepEqual(await failing.ensureUrl({ key: "k3", getBlob: async () => PNG() }), { ok: false, reason: "upload-failed" });
  const none = createFigureImages({ store: fakeStore(), upload: async () => "https://f.test/a.png", shrink: async (b) => b });
  assert.deepEqual(await none.ensureUrl({ key: "k4", getBlob: async () => null }), { ok: false, reason: "no-image" });
  const off = createFigureImages({ store: fakeStore(), upload: async () => { uploads += 1; return "x"; }, enabled: () => false });
  assert.deepEqual(await off.ensureUrl({ key: "k5", getBlob: async () => PNG() }), { ok: false, reason: "off" });
  assert.equal(uploads, 0);
  assert.equal(noteFor("encrypted"), ENCRYPTED_NOTE);
  assert.match(ENCRYPTED_NOTE, /encrypted, so the image can't be shared/);
  assert.equal(noteFor("upload-failed"), UPLOAD_FAILED_NOTE);
});

function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  return Promise.resolve(fn(stub, globalThis.document)).finally(restore);
}

const flush = () => new Promise((r) => setTimeout(r, 10));

test("dialog on a figure preselects a vision model when the default is blind, remembers the choice, shows the notice", () => withDom(async (stub, doc) => {
  const w = fakeWindow([TEXT, VISION]);
  const service = createFigureImages({ store: fakeStore(), upload: async () => "https://f.test/a.png", shrink: async (b) => b });
  const dialog = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w, imageService: service, image: { key: "s/f", getBlob: async () => PNG(), getThumb: async () => "data:image/png;base64,AAAA" } });
  await flush();
  const sel = find(dialog.el, "pxd-ask__model");
  assert.equal(sel.value, "v");
  assert.equal(find(dialog.el, "pxd-ask__imgnote").textContent, "The model will see this image");
  assert.equal(find(dialog.el, "pxd-ask__thumb").getAttribute("src"), "data:image/png;base64,AAAA");
  sel.value = "t";
  stub.dispatch(sel, "change", {});
  assert.equal(find(dialog.el, "pxd-ask__imgnote").textContent, "This model can't see images — text only");
  sel.value = "v";
  stub.dispatch(sel, "change", {});
  assert.equal(w.localStorage.getItem("pxd-ask-vision-model:mygraph"), "v");
  dialog.close();

  // The user's default can see: it stays. The last vision model is only used when the default is blind.
  const w2 = fakeWindow([{ ...VISION, isDefault: true }, { id: "v2", name: "V2", provider: "P", capabilities: { imageInput: true } }]);
  const d2 = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w2, imageService: service, image: { key: "s/f", getBlob: async () => PNG() } });
  assert.equal(find(d2.el, "pxd-ask__model").value, "v");
  d2.close();
  const w3 = fakeWindow([TEXT, VISION, { id: "v2", name: "V2", provider: "P", capabilities: { imageInput: true } }]);
  w3.localStorage.setItem("pxd-ask-vision-model:mygraph", "v2");
  const d3 = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w3, imageService: service, image: { key: "s/f", getBlob: async () => PNG() } });
  assert.equal(find(d3.el, "pxd-ask__model").value, "v2");
  d3.close();
}));

test("Send on a figure with a vision model uploads once, puts the image line in the prompt, adds the instructions, and the card carries the image", () => withDom(async (stub, doc) => {
  const w = fakeWindow([TEXT, VISION]);
  let uploads = 0;
  const service = createFigureImages({ store: fakeStore(), upload: async () => { uploads += 1; return "https://f.test/a.png"; }, shrink: async (b) => b, fetchFn: async () => ({ status: 200 }) });
  const cards = [];
  const dialog = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w, imageService: service, addCard: async (c) => { cards.push(c); }, image: { key: "s/f", getBlob: async () => PNG() } });
  const area = find(dialog.el, "pxd-ask__question");
  area.value = "What is the peak?";
  // The preview shows the image line, with a placeholder until it exists, and never uploads.
  stub.dispatch(find(dialog.el, "pxd-ask__chip"), "click", {});
  const pv = find(dialog.el, "pxd-ask__preview").textContent;
  assert.match(pv, /--- context ---\nImage of the selected part:\n!\[Figure 2\. Sodium mg by week n=12\]\(https:\/\/… \(uploaded when you press Send\)\)\n/);
  assert.match(pv, /--- question ---\nLook at the image of the selected part\. What is the peak\?/);
  assert.equal(uploads, 0);
  stub.dispatch(find(dialog.el, "pxd-ask__send"), "click", {});
  await flush();
  assert.equal(uploads, 1);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].prompt, "Look at the image of the selected part. What is the peak?");
  assert.ok(w.sent[0].context.startsWith("Image of the selected part:\n![Figure 2. Sodium mg by week n=12](https://f.test/a.png)\n"));
  assert.match(w.sent[0].systemPrompt, /Read values off the chart/);
  assert.match(w.sent[0].context, /Figure caption: Figure 2/);
  assert.equal(w.sent[0].model, "v");
  // Preview now shows the real URL.
  stub.dispatch(find(dialog.el, "pxd-ask__chip"), "click", {});
  stub.dispatch(find(dialog.el, "pxd-ask__chip"), "click", {});
  assert.match(find(dialog.el, "pxd-ask__preview").textContent, /\(https:\/\/f\.test\/a\.png\)/);
  const buttons = find(dialog.el, "pxd-ask__actions").children;
  buttons[1].click();
  await flush();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].imageUrl, "https://f.test/a.png");
  assert.equal(cards[0].markdown.split("\n")[1], "  - ![](https://f.test/a.png)");
  // Asking again reuses the cached URL.
  find(dialog.el, "pxd-ask__send").click();
  await flush();
  assert.equal(uploads, 1);
  assert.equal(w.sent.length, 2);
  dialog.close();
}));

test("Send with a blind model is text only and uploads nothing", () => withDom(async (stub, doc) => {
  const w = fakeWindow([TEXT]);
  let uploads = 0;
  const service = createFigureImages({ store: fakeStore(), upload: async () => { uploads += 1; return "https://f.test/a.png"; }, shrink: async (b) => b });
  const cards = [];
  const dialog = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w, imageService: service, addCard: async (c) => { cards.push(c); }, image: { key: "s/f", getBlob: async () => PNG() } });
  assert.equal(find(dialog.el, "pxd-ask__imgnote").textContent, "This model can't see images — text only");
  find(dialog.el, "pxd-ask__send").click();
  await flush();
  assert.equal(uploads, 0);
  assert.doesNotMatch(w.sent[0].prompt, /!\[/);
  assert.doesNotMatch(w.sent[0].systemPrompt, /Read values off the chart/);
  find(dialog.el, "pxd-ask__actions").children[1].click();
  await flush();
  assert.doesNotMatch(cards[0].markdown, /!\[/);
  dialog.close();
}));

test("encrypted graph: dialog says so, sends text only", () => withDom(async (stub, doc) => {
  const w = fakeWindow([VISION]);
  const toasts = [];
  const service = createFigureImages({ store: fakeStore(), upload: async () => "https://f.test/a.png", encrypted: () => true, shrink: async (b) => b });
  const dialog = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w, imageService: service, toast: (m) => toasts.push(m), image: { key: "s/f", getBlob: async () => PNG() } });
  find(dialog.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent.length, 1);
  assert.doesNotMatch(w.sent[0].prompt, /!\[/);
  assert.deepEqual(toasts, [ENCRYPTED_NOTE]);
  dialog.close();
}));

test("upload failure continues text-only with a note; the setting off hides the promise", () => withDom(async (stub, doc) => {
  const w = fakeWindow([VISION]);
  const toasts = [];
  const bad = createFigureImages({ store: fakeStore(), upload: async () => { throw new Error("x"); }, shrink: async (b) => b });
  const d1 = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w, imageService: bad, toast: (m) => toasts.push(m), image: { key: "s/f", getBlob: async () => PNG() } });
  find(d1.el, "pxd-ask__send").click();
  await flush();
  assert.equal(w.sent.length, 1);
  assert.doesNotMatch(w.sent[0].prompt, /!\[/);
  assert.deepEqual(toasts, [UPLOAD_FAILED_NOTE]);
  d1.close();
  const off = createFigureImages({ store: fakeStore(), upload: async () => "https://f.test/a.png", enabled: () => false });
  const d2 = openAskAI({ doc: DOC, blockId: "f", document: doc, window: fakeWindow([VISION]), imageService: off, image: { key: "s/f", getBlob: async () => PNG() } });
  assert.match(find(d2.el, "pxd-ask__imgnote").textContent, /off in settings/);
  d2.close();
}));

test("image card: direct URL goes in the prompt without an upload; the context has its words and page title, no page numbers", () => withDom(async (stub, doc) => {
  const w = fakeWindow([TEXT, VISION]);
  let uploads = 0;
  const service = createFigureImages({ store: fakeStore(), upload: async () => { uploads += 1; return "x"; }, shrink: async (b) => b });
  const dialog = openAskAI({
    doc: imageDoc({ caption: "Line 2 layout — rev B", title: "Plant notes" }),
    blockId: "img",
    document: doc,
    window: w,
    imageService: service,
    image: { key: "", url: "https://files.test/layout.png", caption: "Line 2 layout — rev B", thumb: "https://files.test/layout.png" },
  });
  assert.equal(find(dialog.el, "pxd-ask__model").value, "v");
  assert.equal(find(dialog.el, "pxd-ask__thumb").getAttribute("src"), "https://files.test/layout.png");
  find(dialog.el, "pxd-ask__send").click();
  await flush();
  assert.equal(uploads, 0);
  assert.match(w.sent[0].context, /^Image of the selected part:\n!\[Line 2 layout — rev B\]\(https:\/\/files\.test\/layout\.png\)\n/);
  assert.doesNotMatch(w.sent[0].prompt, /!\[/);
  assert.match(w.sent[0].context, /Line 2 layout/);
  assert.match(w.sent[0].context, /Plant notes/);
  assert.doesNotMatch(w.sent[0].context, /p\. 1/);
  dialog.close();
}));

test("card menu offers Ask AI… on image cards only", () => {
  const byId = (menu, id) => menu.find((row) => row.id === id);
  assert.equal(byId(buildMenu("card", { isImage: true }), "ask-ai").label, "Ask AI…");
  assert.equal(byId(buildMenu("card", {}), "ask-ai"), undefined);
  assert.equal(byId(buildMenu("card", { isPdf: true, hasParse: true, isImage: false }), "ask-ai").label, "Ask AI…");
});

test("empty answer: message with the model name, Try <next> from another provider re-sends, Copy and Add as card stay hidden", () => withDom(async (stub, doc) => {
  const A = { id: "a", name: "GPT 6 Luna", provider: "OpenAI", isDefault: true, capabilities: { imageInput: false } };
  const A2 = { id: "a2", name: "GPT 6 Sol", provider: "OpenAI", capabilities: { imageInput: false } };
  const B = { id: "b", name: "Claude Fable", provider: "Anthropic", capabilities: { imageInput: false } };
  const w = fakeWindow([A, A2, B], { generate: async (req) => { w.sent.push(req); return req.model === "b" ? { text: "Hello", model: "b" } : { text: "", model: req.model }; } });
  const dialog = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w });
  find(dialog.el, "pxd-ask__send").click();
  await flush();
  const out = find(dialog.el, "pxd-ask__answer");
  assert.match(out.textContent, /GPT 6 Luna returned an empty answer\. Live AI may not be set up for this provider; try another model\./);
  assert.equal(find(dialog.el, "pxd-ask__actions").hidden, true);
  const btn = find(dialog.el, "pxd-ask__tryother");
  assert.equal(btn.textContent, "Try Claude Fable");
  btn.click();
  await flush();
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[1].model, "b");
  assert.equal(find(dialog.el, "pxd-ask__model").value, "b");
  assert.match(out.textContent, /Hello/);
  assert.equal(find(dialog.el, "pxd-ask__actions").hidden, false);
  dialog.close();
}));

test("empty answer: EMPTY_RESPONSE error shows the same message; one provider only means no Try button", () => withDom(async (stub, doc) => {
  const w = fakeWindow([TEXT, VISION], { generate: async () => { throw Object.assign(new Error("[LiveAI_API] EMPTY_RESPONSE"), { code: "EMPTY_RESPONSE" }); } });
  const dialog = openAskAI({ doc: DOC, blockId: "f", document: doc, window: w });
  find(dialog.el, "pxd-ask__send").click();
  await flush();
  assert.match(find(dialog.el, "pxd-ask__answer").textContent, /Text returned an empty answer\. Live AI may not be set up for this provider; try another model\./);
  assert.equal(find(dialog.el, "pxd-ask__tryother"), null);
  assert.equal(find(dialog.el, "pxd-ask__actions").hidden, true);
  dialog.close();
}));
