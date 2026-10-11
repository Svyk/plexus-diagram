// Ask AI dialog. One part of a parsed PDF goes to the user's Live AI Assistant (the only AI path) together
// with the document around it. Floating, one at a time, closes on Esc.

import { answerCardMarkdown, buildFocusContext, buildMultiContext, chipText, contextWithImage, MULTI_QUICK_PROMPTS, parseAnswer, previewText, promptWithImage, promptWithImages, QUICK_PROMPTS, selectionDoc, splitCitations, withImageInstructions } from "../model/ai-context.js";
import { graphOfWindow, modelPickKey, pickAskModel } from "../model/ask-models.js";
import * as liveai from "../host/liveai.js";
import { getFigureImages, isUsableImageUrl, noteFor } from "../host/figure-image.js";

export const SEES_NOTE = "The model will see this image";
export const BLIND_NOTE = "This model can't see images — text only";
export const OFF_NOTE = "Figure images are off in settings — text only";
export const UPLOADING_NOTE = "Uploading figure…";
export const VISION_KEY = "pxd-ask-vision-model";
const clipQuestion = (text) => {
  const q = String(text ?? "").replace(/\s+/g, " ").trim();
  return q.length > 60 ? `${q.slice(0, 59).trimEnd()}…` : q;
};
export const WIDTH_KEY = "pxd-ask-width";
export const MIN_WIDTH = 360;
export const QUESTION_MIN_ROWS = 2;
export const QUESTION_MAX_ROWS = 6;
const PENDING_URL = "https://… (uploaded when you press Send)";

let openDialog = null;
let askModelSetting = () => "auto";
// The board hands over the "Ask AI model" setting; a dialog reads it each time it opens.
export function setAskSettings({ model = null } = {}) {
  askModelSetting = typeof model === "function" ? model : () => "auto";
}

function make(doc, tag, cls, parent, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

// Text with [p. N] links, as nodes.
function citeInto(doc, parent, text, onPage) {
  for (const piece of splitCitations(text)) {
    if (piece.page == null && piece.part == null) {
      parent.append(doc.createTextNode(piece.text));
      continue;
    }
    const link = make(doc, "a", "pxd-ask__cite", parent, piece.text);
    link.setAttribute("href", "#");
    if (piece.page != null) link.setAttribute("data-page", String(piece.page));
    if (piece.part != null) link.setAttribute("data-part", String(piece.part));
    link.setAttribute("role", "button");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try { onPage?.(piece.page, piece.part); } catch { /* reader */ }
    });
  }
}

// **bold**, *italic*, `code` and [p. N] links, as nodes. Nothing here parses HTML.
function inlineInto(doc, parent, text, onPage) {
  const re = /`([^`]+)`|\*\*([^*]+?)\*\*|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])/g;
  let last = 0;
  let m;
  const src = String(text ?? "");
  while ((m = re.exec(src))) {
    if (m.index > last) citeInto(doc, parent, src.slice(last, m.index), onPage);
    if (m[1] != null) make(doc, "code", "pxd-ask__code", parent, m[1]);
    else if (m[2] != null) inlineInto(doc, make(doc, "strong", "", parent), m[2], onPage);
    else inlineInto(doc, make(doc, "em", "", parent), m[3], onPage);
    last = m.index + m[0].length;
  }
  if (last < src.length) citeInto(doc, parent, src.slice(last), onPage);
}

// Fills `node` with the answer as minimal markdown: paragraphs, lists, bold, italic, code, "[p. 14]" links.
export function paintAnswer(doc, node, text, onPage) {
  node.replaceChildren?.();
  if (!node.replaceChildren) while (node.firstChild) node.removeChild(node.firstChild);
  for (const part of parseAnswer(text)) {
    if (part.type === "p") {
      inlineInto(doc, make(doc, "p", "pxd-ask__p", node), part.text, onPage);
      continue;
    }
    if (part.type === "table") {
      const wrap = make(doc, "div", "pxd-ask__tablewrap", node);
      const table = make(doc, "table", "pxd-ask__table", wrap);
      const width = Math.max(...part.rows.map((r) => r.length));
      const thead = make(doc, "thead", "", table);
      const tbody = make(doc, "tbody", "", table);
      part.rows.forEach((row, r) => {
        const tr = make(doc, "tr", "", r === 0 ? thead : tbody);
        for (let c = 0; c < width; c += 1) inlineInto(doc, make(doc, r === 0 ? "th" : "td", "", tr), row[c] ?? "", onPage);
      });
      continue;
    }
    const list = make(doc, part.ordered ? "ol" : "ul", "pxd-ask__list", node);
    for (const item of part.items) {
      const li = make(doc, "li", item.depth ? `pxd-ask__li pxd-ask__li--n${Math.min(item.depth, 3)}` : "pxd-ask__li", list);
      inlineInto(doc, li, item.text, onPage);
    }
  }
}

// doc: a pxd-parse document, or null (then `selection` is all there is). focus keys: blockId | selection | page.
// Extras: jumpPage(n), addCard({ markdown, chip, blockId, imageUrl }) -> Promise, toast(msg), win, host document.
// image: { key, caption, url?, name?, getBlob(), getThumb() } is a picture the model may see; imageService decides how its
// URL is made (default: the one the board registered). Nothing is uploaded before Send.
// multi: { basket, jump(part, page) } asks one question about every part in the basket instead (see ask-basket.js).
export function openAskAI({ doc: parsed = null, blockId = "", selection = "", page = null, blockIds = null, wholeDoc = false, jumpPage = null, addCard = null, toast = null, document: ownerDoc = null, window: w = null, image = null, imageService = null, multi = null, askModel = null } = {}) {
  const dom = ownerDoc || (typeof document !== "undefined" ? document : null);
  if (!dom) return null;
  const win = w || dom.defaultView || globalThis;
  try { openDialog?.close(); } catch { /* gone */ }

  let parts = multi ? multi.basket.list() : [];
  const partImages = () => parts.filter((p) => p.image);
  const hasBlocks = !multi && parsed && parsed.blocks && Object.keys(parsed.blocks).length;
  const source = hasBlocks ? parsed : (selection ? selectionDoc({ text: selection, page: Number.isInteger(page) ? page : 1 }) : parsed);
  const focus = hasBlocks
    ? { ...(blockId ? { blockId } : {}), ...(blockIds ? { blockIds } : {}), ...(selection ? { selection } : {}), ...(page != null ? { page } : {}), ...(wholeDoc ? { wholeDoc: true } : {}) }
    : { blockId: "sel", selection };
  let built = multi ? buildMultiContext(parts, "") : buildFocusContext(source, focus);
  const isWhole = !multi && Boolean(wholeDoc) && !focus.blockId && !focus.blockIds && !focus.selection && focus.page == null && hasBlocks;
  let builtFor = built.prompt;
  // A whole-document context is retrieved for the question, so it follows the textarea.
  const multiLabel = () => `${parts.length} part${parts.length === 1 ? "" : "s"}`;
  const rebuild = (question) => {
    if (multi) {
      const q = String(question ?? "").trim();
      built = buildMultiContext(parts, q);
      builtFor = q;
      chip.textContent = multiLabel();
      return;
    }
    if (!isWhole) return;
    const q = String(question ?? "").trim();
    if (q === builtFor) return;
    builtFor = q;
    built = buildFocusContext(source, focus, { question: q });
    chip.textContent = chipText(built.chip);
  };

  const root = make(dom, "div", "pxd-ask", null);
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Ask AI");
  const stop = (event) => event.stopPropagation();
  for (const type of ["pointerdown", "mousedown", "click", "mouseup", "dblclick", "wheel"]) root.addEventListener(type, stop);

  const grip = make(dom, "div", "pxd-ask__grip", root);
  grip.setAttribute("aria-hidden", "true");
  const head = make(dom, "div", "pxd-ask__head", root);
  make(dom, "span", "pxd-ask__title", head, "Ask AI");
  const closeBtn = make(dom, "button", "pxd-ask__close", head, "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");

  const widthKey = () => `${WIDTH_KEY}:${graphOfWindow(win)}`;
  const maxWidth = () => Math.max(MIN_WIDTH, (Number(win.innerWidth) || 1280) - 32);
  const clampWidth = (n) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, n)));
  // A wider dialog for a table or several parts; a width the user dragged to wins and is kept per graph.
  const setWide = (on) => { root.classList.toggle("pxd-ask--wide", Boolean(on)); };
  if (multi) setWide(true);
  try {
    const saved = Number(win.localStorage?.getItem(widthKey()));
    if (Number.isFinite(saved) && saved > 0) root.style.width = `${clampWidth(saved)}px`;
  } catch { /* private mode */ }
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault?.();
    const startX = Number(event.clientX) || 0;
    const startW = Number(root.getBoundingClientRect?.().width) || parseFloat(root.style.width) || 440;
    let last = startW;
    const move = (e) => {
      last = clampWidth(startW + (startX - (Number(e.clientX) || 0)));
      root.style.width = `${last}px`;
    };
    const up = () => {
      dom.removeEventListener?.("pointermove", move, true);
      dom.removeEventListener?.("pointerup", up, true);
      dom.removeEventListener?.("pointercancel", up, true);
      try { win.localStorage?.setItem(widthKey(), String(last)); } catch { /* private mode */ }
      growQuestion();
    };
    dom.addEventListener?.("pointermove", move, true);
    dom.addEventListener?.("pointerup", up, true);
    dom.addEventListener?.("pointercancel", up, true);
  });

  let hasImage = multi ? partImages().length > 0 : Boolean(image) && !isWhole;
  const service = imageService || getFigureImages();
  const altText = () => image?.caption || built.figure?.caption || "";
  const chipsRow = multi ? make(dom, "div", "pxd-ask__parts", root) : null;
  const chip = make(dom, "button", "pxd-ask__chip", root, multi ? `${parts.length} part${parts.length === 1 ? "" : "s"}` : chipText(built.chip));
  chip.type = "button";
  chip.setAttribute("aria-expanded", "false");
  chip.setAttribute("title", "Show exactly what will be sent");
  const preview = make(dom, "pre", "pxd-ask__preview", root);
  preview.hidden = true;
  let thumb = null;
  let imageNote = null;
  if (multi) {
    const strip = make(dom, "div", "pxd-ask__imagerow", root);
    imageNote = make(dom, "span", "pxd-ask__imgnote", strip);
    imageNote.setAttribute("aria-live", "polite");
  } else if (hasImage) {
    const strip = make(dom, "div", "pxd-ask__imagerow", root);
    thumb = make(dom, "img", "pxd-ask__thumb", strip);
    thumb.setAttribute("alt", "");
    thumb.hidden = true;
    imageNote = make(dom, "span", "pxd-ask__imgnote", strip);
    imageNote.setAttribute("aria-live", "polite");
    const show = (src) => { if (src) { thumb.setAttribute("src", src); thumb.hidden = false; } };
    if (image.thumb) show(image.thumb);
    else if (typeof image.getThumb === "function") void Promise.resolve().then(() => image.getThumb()).then(show, () => {});
    else if (image.url) show(image.url);
  }

  const body = make(dom, "div", "pxd-ask__body", root);

  let dead = false;
  let ctl = null;
  let token = 0;
  let answer = "";
  let offReady = () => {};
  let formReady = false;

  const prompt = { text: built.prompt };
  let textarea = null;
  let modelSel = null;
  let sendBtn = null;
  let stopBtn = null;
  let out = null;
  let status = null;
  let actions = null;
  let models = [];
  let knownUrl = "";
  let sentUrl = "";
  const knownUrls = new Map();

  const modelSees = () => Boolean(models.find((m) => m.id === (modelSel?.value || ""))?.imageInput);
  const imagesOn = () => { try { return service ? service.enabled() !== false : Boolean(image?.url); } catch { return true; } };
  // Will the next Send carry the picture?
  const willSend = () => hasImage && imagesOn() && modelSees();
  const paintNote = () => {
    if (!imageNote) return;
    if (multi && !hasImage) { imageNote.textContent = ""; return; }
    imageNote.textContent = !imagesOn() ? OFF_NOTE : modelSees() ? SEES_NOTE : BLIND_NOTE;
  };
  const refreshPreview = () => {
    rebuild(textarea ? textarea.value : prompt.text);
    const sending = willSend();
    const question = textarea ? textarea.value : prompt.text;
    if (multi) {
      const shown = parts.map((p) => (p.image && sending ? { ...p, imageUrl: knownUrls.get(p.key) || PENDING_URL } : p));
      const b = buildMultiContext(shown, question);
      preview.textContent = `${previewText({ instructions: b.instructions, context: b.context, prompt: promptWithImages(question, shown.some((p) => p.imageUrl)) })}\n\n(about ${b.tokensEstimate.toLocaleString?.() ?? b.tokensEstimate} tokens before the question)`;
      return;
    }
    preview.textContent = `${previewText({
      instructions: sending ? withImageInstructions(built.instructions) : built.instructions,
      context: sending ? contextWithImage(built.context, knownUrl || PENDING_URL, altText()) : built.context,
      prompt: sending ? promptWithImage(question, true) : question,
    })}\n\n(about ${built.tokensEstimate.toLocaleString?.() ?? built.tokensEstimate} tokens before the question)`;
  };
  chip.addEventListener("click", () => {
    const show = preview.hidden;
    preview.hidden = !show;
    chip.setAttribute("aria-expanded", show ? "true" : "false");
    if (show) refreshPreview();
  });

  const goPage = (n, partNo) => {
    try {
      if (!multi) { if (n != null) jumpPage?.(n); return; }
      const part = partNo != null ? parts[partNo - 1] : parts[0];
      if (part && (n != null || partNo != null)) multi.jump?.(part, n != null ? n : part.page);
    } catch { /* reader */ }
  };
  const say = (msg) => { try { toast?.(msg); } catch { /* host */ } };
  const setBusy = (busy) => {
    if (sendBtn) sendBtn.hidden = busy;
    if (stopBtn) stopBtn.hidden = !busy;
    if (textarea) textarea.disabled = busy;
  };
  const showActions = (on) => { if (actions) actions.hidden = !on; };
  const paintAnswerNow = () => {
    paintAnswer(dom, out, answer, goPage);
    if (multi || parseAnswer(answer).some((part) => part.type === "table")) setWide(true);
  };
  // The question grows with its text, two to six lines.
  function growQuestion() {
    const ta = textarea;
    if (!ta) return;
    const value = String(ta.value ?? "");
    const wrapped = value.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 52)), 0);
    ta.rows = Math.min(QUESTION_MAX_ROWS, Math.max(QUESTION_MIN_ROWS, wrapped));
    if (ta.style) {
      ta.style.height = "auto";
      const h = Number(ta.scrollHeight);
      if (h > 0) ta.style.height = `${h + 2}px`;
    }
  }

  const ensureImage = async (spec = image) => {
    try {
      if (service) return await service.ensureUrl(spec);
      return spec.url && isUsableImageUrl(spec.url) ? { ok: true, url: spec.url } : { ok: false, reason: "upload-failed" };
    } catch {
      return { ok: false, reason: "upload-failed" };
    }
  };
  const storage = () => { try { return win.localStorage || globalThis.localStorage || null; } catch { return null; } };
  const visionKey = () => `${VISION_KEY}:${/#\/app\/([^/?#]+)/.exec(String(win.location?.hash || ""))?.[1] || ""}`;

  // The model that answers next: the following one from a different provider (one that sees images when the figure goes along).
  const nextModel = () => {
    const at = models.findIndex((m) => m.id === modelSel?.value);
    const cur = models[at];
    const others = models.filter((m) => m.id !== cur?.id && (m.provider || "") !== (cur?.provider || ""));
    const ordered = [...models.slice(at + 1), ...models.slice(0, Math.max(0, at))].filter((m) => others.includes(m));
    return (hasImage && ordered.find((m) => m.imageInput)) || ordered[0] || null;
  };
  const showEmpty = () => {
    const cur = models.find((m) => m.id === modelSel?.value);
    out.replaceChildren?.();
    status.textContent = "";
    showActions(false);
    const box = make(dom, "div", "pxd-ask__empty", out);
    make(dom, "p", "pxd-ask__emptymsg", box, `${cur?.name || "The model"} returned an empty answer. Live AI may not be set up for this provider; try another model.`);
    const next = nextModel();
    if (!next) return;
    const btn = make(dom, "button", "pxd-ask__tryother", box, `Try ${next.name}`);
    btn.type = "button";
    btn.addEventListener("click", () => {
      modelSel.value = next.id;
      try { storage()?.setItem(modelPickKey(graphOfWindow(win)), modelSel.value); } catch { /* private mode */ }
      if (hasImage && modelSees()) { try { storage()?.setItem(visionKey(), modelSel.value); } catch { /* private mode */ } }
      paintNote();
      if (!preview.hidden) refreshPreview();
      void run();
    });
  };

  const run = async () => {
    if (!textarea || ctl) return;
    const question = textarea.value.trim();
    if (!question) { status.textContent = "Type a question first."; return; }
    rebuild(question);
    ctl = typeof win.AbortController === "function" ? new win.AbortController() : new AbortController();
    token += 1;
    const mine = token;
    answer = "";
    sentUrl = "";
    paintAnswer(dom, out, "", goPage);
    showActions(false);
    setBusy(true);
    let note = "";
    let sendContext = "";
    let sendInstructions = "";
    let sendPrompt = "";
    if (multi) {
      const urls = new Map();
      if (willSend()) {
        status.textContent = UPLOADING_NOTE;
        for (const p of partImages()) {
          const got = await ensureImage(p.image);
          if (mine !== token || dead) return;
          if (got.ok) { urls.set(p.key, got.url); knownUrls.set(p.key, got.url); } else note = noteFor(got.reason);
        }
      }
      const shown = parts.map((p) => (urls.has(p.key) ? { ...p, imageUrl: urls.get(p.key) } : p));
      const b = buildMultiContext(shown, question);
      sendContext = b.context;
      sendInstructions = b.instructions;
      sendPrompt = promptWithImages(question, urls.size > 0);
      sentUrl = urls.size ? "multi" : "";
    } else {
      if (willSend()) {
        status.textContent = UPLOADING_NOTE;
        const got = await ensureImage();
        if (mine !== token || dead) return;
        if (got.ok) { sentUrl = got.url; knownUrl = got.url; } else note = noteFor(got.reason);
      }
      sendContext = contextWithImage(built.context, sentUrl, altText());
      sendInstructions = sentUrl ? withImageInstructions(built.instructions) : built.instructions;
      sendPrompt = promptWithImage(question, sentUrl);
    }
    status.textContent = note ? `${note} Thinking…` : "Thinking…";
    if (note) say(note);
    const result = await liveai.ask({
      context: sendContext,
      systemPrompt: sendInstructions,
      prompt: sendPrompt,
      model: modelSel?.value || "",
      signal: ctl.signal,
      window: win,
      onChunk: (chunk) => {
        if (dead || mine !== token) return;
        answer += chunk;
        paintAnswerNow();
        status.textContent = "";
      },
    });
    if (mine !== token || dead) return;
    ctl = null;
    setBusy(false);
    if (!result.ok && result.code === "EMPTY_RESPONSE" && !answer) { showEmpty(); return; }
    if (!result.ok) {
      status.textContent = result.error;
      if (answer) showActions(true);
      return;
    }
    answer = result.text || answer;
    if (!answer.trim()) { answer = ""; showEmpty(); return; }
    paintAnswerNow();
    status.textContent = result.model ? `${result.model}${result.usage?.outputTokens ? ` · ${result.usage.outputTokens} tokens` : ""}` : "";
    showActions(Boolean(answer));
  };

  const buildForm = () => {
    body.replaceChildren?.();
    formReady = true;
    const row = make(dom, "div", "pxd-ask__row", body);
    make(dom, "label", "pxd-ask__label", row, "Model");
    modelSel = make(dom, "select", "pxd-ask__model", row);
    modelSel.setAttribute("aria-label", "Model");
    models = liveai.listModels(win);
    // Plexus' own default (Claude, then Gemini) unless the user picked a model here before; a figure needs one that sees it.
    let remembered = "";
    try { remembered = String(storage()?.getItem(modelPickKey(graphOfWindow(win))) || ""); } catch { remembered = ""; }
    if (!remembered && hasImage) { try { remembered = String(storage()?.getItem(visionKey()) || ""); } catch { remembered = ""; } }
    const def = pickAskModel(models, { setting: askModel ?? askModelSetting(), remembered, liveDefault: liveai.defaultModel(win), needImage: hasImage });
    for (const m of models) {
      const opt = make(dom, "option", "", modelSel, m.provider ? `${m.name} · ${m.provider}` : m.name);
      opt.value = m.id;
      if (m.id === def) opt.selected = true;
    }
    if (def) modelSel.value = def;
    modelSel.addEventListener("change", () => {
      try { storage()?.setItem(modelPickKey(graphOfWindow(win)), modelSel.value); } catch { /* private mode */ }
      if (hasImage && modelSees()) { try { storage()?.setItem(visionKey(), modelSel.value); } catch { /* private mode */ } }
      paintNote();
      if (!preview.hidden) refreshPreview();
    });
    paintNote();
    if (multi) {
      for (const p of partImages()) {
        if (p.image.url && isUsableImageUrl(p.image.url)) knownUrls.set(p.key, p.image.url);
        else if (service?.peek && p.image.key) void Promise.resolve(service.peek(p.image.key)).then((url) => { if (url && !dead) { knownUrls.set(p.key, url); if (!preview.hidden) refreshPreview(); } }, () => {});
      }
    } else if (hasImage && image.url && isUsableImageUrl(image.url)) knownUrl = image.url;
    else if (hasImage && service?.peek && image.key) {
      void Promise.resolve(service.peek(image.key)).then((url) => { if (url && !dead) { knownUrl = url; if (!preview.hidden) refreshPreview(); } }, () => {});
    }

    const quick = make(dom, "div", "pxd-ask__quick", body);
    textarea = make(dom, "textarea", "pxd-ask__question", body);
    textarea.value = multi ? built.prompt : prompt.text;
    growQuestion();
    textarea.setAttribute("aria-label", "Question");
    for (const q of multi ? MULTI_QUICK_PROMPTS : QUICK_PROMPTS) {
      const btn = make(dom, "button", "pxd-ask__quickbtn", quick, q.label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        textarea.value = !multi && wholeDoc && !blockId && !blockIds ? q.prompt.replace("this part", "this document") : q.prompt;
        growQuestion();
        if (!preview.hidden) refreshPreview();
        void run();
      });
    }
    textarea.addEventListener("input", () => { growQuestion(); if (!preview.hidden) refreshPreview(); });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void run(); }
    });

    const bar = make(dom, "div", "pxd-ask__bar", body);
    sendBtn = make(dom, "button", "pxd-ask__send", bar, "Send");
    sendBtn.type = "button";
    sendBtn.addEventListener("click", () => { void run(); });
    stopBtn = make(dom, "button", "pxd-ask__stop", bar, "Stop");
    stopBtn.type = "button";
    stopBtn.hidden = true;
    stopBtn.addEventListener("click", () => {
      const was = ctl;
      token += 1;
      ctl = null;
      try { was?.abort(); } catch { /* done */ }
      setBusy(false);
      status.textContent = "Stopped.";
      showActions(Boolean(answer));
    });
    status = make(dom, "span", "pxd-ask__status", bar);
    status.setAttribute("aria-live", "polite");

    out = make(dom, "div", "pxd-ask__answer", body);
    out.setAttribute("aria-live", "polite");
    actions = make(dom, "div", "pxd-ask__actions", body);
    actions.hidden = true;
    const copyBtn = make(dom, "button", "pxd-ask__act", actions, "Copy");
    copyBtn.type = "button";
    copyBtn.addEventListener("click", () => {
      const clip = win.navigator?.clipboard || globalThis.navigator?.clipboard;
      if (!clip?.writeText) { say("Could not copy"); return; }
      void clip.writeText(answer).then(() => say("Copied"), () => say("Could not copy"));
    });
    const cardBtn = make(dom, "button", "pxd-ask__act", actions, "Add as card");
    cardBtn.type = "button";
    cardBtn.addEventListener("click", () => {
      const cardChip = multi ? { label: multiLabel(), page: null, docTitle: clipQuestion(textarea?.value) } : built.chip;
      const markdown = answerCardMarkdown({ answer, chip: cardChip, imageUrl: multi ? "" : sentUrl });
      if (!markdown || typeof addCard !== "function") { say("Cannot add a card here"); return; }
      cardBtn.disabled = true;
      void Promise.resolve(addCard({ markdown, chip: cardChip, blockId: blockId || "", answer, imageUrl: multi ? "" : sentUrl, ...(multi ? { parts: parts.slice() } : {}) }))
        .catch(() => {})
        .then(() => { cardBtn.disabled = false; });
    });
    try { textarea.focus(); } catch { /* stub */ }
  };

  const buildSetup = () => {
    body.replaceChildren?.();
    formReady = false;
    make(dom, "p", "pxd-ask__hint", body, liveai.present(win)
      ? "Live AI Assistant has no model ready. Add a model and its API key in Live AI Assistant's settings."
      : liveai.SETUP_HINT);
    make(dom, "p", "pxd-ask__hint pxd-ask__hint--quiet", body, "Needs the Live AI Assistant extension, v29 or later.");
  };

  const sync = (ok) => {
    if (dead) return;
    if (ok && !formReady) buildForm();
    else if (!ok && (formReady || !body.firstChild)) {
      try { ctl?.abort(); } catch { /* done */ }
      buildSetup();
    }
  };
  offReady = liveai.onReady(sync, win);
  if (!body.firstChild) sync(liveai.available(win));

  let offBasket = () => {};
  const paintParts = () => {
    if (!chipsRow) return;
    if (chipsRow.replaceChildren) chipsRow.replaceChildren();
    else while (chipsRow.firstChild) chipsRow.removeChild(chipsRow.firstChild);
    parts.forEach((p, i) => {
      const c = make(dom, "span", "pxd-ask__partchip", chipsRow);
      make(dom, "span", "pxd-ask__partlabel", c, `Part ${i + 1}: ${p.label || "Part"}`);
      const x = make(dom, "button", "pxd-ask__partx", c, "×");
      x.type = "button";
      x.setAttribute("aria-label", `Remove part ${i + 1}`);
      x.addEventListener("click", () => { multi.basket.remove(p.key); });
    });
  };
  const close = () => {
    if (dead) return;
    dead = true;
    try { offBasket(); } catch { /* gone */ }
    try { ctl?.abort(); } catch { /* done */ }
    try { offReady(); } catch { /* gone */ }
    try { dom.removeEventListener?.("keydown", onDocKey, true); } catch { /* gone */ }
    try { root.remove(); } catch { /* gone */ }
    if (openDialog && openDialog.el === root) openDialog = null;
  };
  const onDocKey = (event) => { if (event.key === "Escape") close(); };
  dom.addEventListener?.("keydown", onDocKey, true);
  closeBtn.addEventListener("click", close);
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  if (multi) {
    paintParts();
    offBasket = multi.basket.subscribe((list) => {
      if (dead) return;
      parts = list;
      if (!parts.length) { close(); return; }
      hasImage = partImages().length > 0;
      paintParts();
      chip.textContent = multiLabel();
      rebuild(textarea ? textarea.value : "");
      paintNote();
      if (!preview.hidden) refreshPreview();
    });
  }
  (dom.body || dom.documentElement)?.append?.(root);
  openDialog = { el: root, close };
  return { el: root, close, built };
}

export function closeAskAI() {
  try { openDialog?.close(); } catch { /* gone */ }
}
