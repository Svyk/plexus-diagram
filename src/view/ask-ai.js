// Ask AI dialog. One part of a parsed PDF goes to the user's Live AI Assistant (the only AI path) together
// with the document around it. Floating, one at a time, closes on Esc.

import { answerCardMarkdown, buildFocusContext, chipText, contextWithImage, parseAnswer, previewText, promptWithImage, QUICK_PROMPTS, selectionDoc, splitCitations, withImageInstructions } from "../model/ai-context.js";
import * as liveai from "../host/liveai.js";
import { getFigureImages, isUsableImageUrl, noteFor } from "../host/figure-image.js";

export const SEES_NOTE = "The model will see this image";
export const BLIND_NOTE = "This model can't see images — text only";
export const OFF_NOTE = "Figure images are off in settings — text only";
export const UPLOADING_NOTE = "Uploading figure…";
export const VISION_KEY = "pxd-ask-vision-model";
const PENDING_URL = "https://… (uploaded when you press Send)";

let openDialog = null;

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
    if (piece.page == null) {
      parent.append(doc.createTextNode(piece.text));
      continue;
    }
    const link = make(doc, "a", "pxd-ask__cite", parent, piece.text);
    link.setAttribute("href", "#");
    link.setAttribute("data-page", String(piece.page));
    link.setAttribute("role", "button");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try { onPage?.(piece.page); } catch { /* reader */ }
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
export function openAskAI({ doc: parsed = null, blockId = "", selection = "", page = null, blockIds = null, wholeDoc = false, jumpPage = null, addCard = null, toast = null, document: ownerDoc = null, window: w = null, image = null, imageService = null } = {}) {
  const dom = ownerDoc || (typeof document !== "undefined" ? document : null);
  if (!dom) return null;
  const win = w || dom.defaultView || globalThis;
  try { openDialog?.close(); } catch { /* gone */ }

  const hasBlocks = parsed && parsed.blocks && Object.keys(parsed.blocks).length;
  const source = hasBlocks ? parsed : (selection ? selectionDoc({ text: selection, page: Number.isInteger(page) ? page : 1 }) : parsed);
  const focus = hasBlocks
    ? { ...(blockId ? { blockId } : {}), ...(blockIds ? { blockIds } : {}), ...(selection ? { selection } : {}), ...(page != null ? { page } : {}), ...(wholeDoc ? { wholeDoc: true } : {}) }
    : { blockId: "sel", selection };
  let built = buildFocusContext(source, focus);
  const isWhole = Boolean(wholeDoc) && !focus.blockId && !focus.blockIds && !focus.selection && focus.page == null && hasBlocks;
  let builtFor = built.prompt;
  // A whole-document context is retrieved for the question, so it follows the textarea.
  const rebuild = (question) => {
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

  const head = make(dom, "div", "pxd-ask__head", root);
  make(dom, "span", "pxd-ask__title", head, "Ask AI");
  const closeBtn = make(dom, "button", "pxd-ask__close", head, "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");

  const hasImage = Boolean(image) && !isWhole;
  const service = imageService || getFigureImages();
  const altText = () => image?.caption || built.figure?.caption || "";
  const chip = make(dom, "button", "pxd-ask__chip", root, chipText(built.chip));
  chip.type = "button";
  chip.setAttribute("aria-expanded", "false");
  chip.setAttribute("title", "Show exactly what will be sent");
  const preview = make(dom, "pre", "pxd-ask__preview", root);
  preview.hidden = true;
  let thumb = null;
  let imageNote = null;
  if (hasImage) {
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

  const modelSees = () => Boolean(models.find((m) => m.id === (modelSel?.value || ""))?.imageInput);
  const imagesOn = () => { try { return service ? service.enabled() !== false : Boolean(image?.url); } catch { return true; } };
  // Will the next Send carry the picture?
  const willSend = () => hasImage && imagesOn() && modelSees();
  const paintNote = () => {
    if (!imageNote) return;
    imageNote.textContent = !imagesOn() ? OFF_NOTE : modelSees() ? SEES_NOTE : BLIND_NOTE;
  };
  const refreshPreview = () => {
    rebuild(textarea ? textarea.value : prompt.text);
    const sending = willSend();
    const question = textarea ? textarea.value : prompt.text;
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

  const goPage = (n) => { try { jumpPage?.(n); } catch { /* reader */ } };
  const say = (msg) => { try { toast?.(msg); } catch { /* host */ } };
  const setBusy = (busy) => {
    if (sendBtn) sendBtn.hidden = busy;
    if (stopBtn) stopBtn.hidden = !busy;
    if (textarea) textarea.disabled = busy;
  };
  const showActions = (on) => { if (actions) actions.hidden = !on; };

  const ensureImage = async () => {
    try {
      if (service) return await service.ensureUrl(image);
      return image.url && isUsableImageUrl(image.url) ? { ok: true, url: image.url } : { ok: false, reason: "upload-failed" };
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
    if (willSend()) {
      status.textContent = UPLOADING_NOTE;
      const got = await ensureImage();
      if (mine !== token || dead) return;
      if (got.ok) { sentUrl = got.url; knownUrl = got.url; } else note = noteFor(got.reason);
    }
    status.textContent = note ? `${note} Thinking…` : "Thinking…";
    if (note) say(note);
    const result = await liveai.ask({
      context: contextWithImage(built.context, sentUrl, altText()),
      systemPrompt: sentUrl ? withImageInstructions(built.instructions) : built.instructions,
      prompt: promptWithImage(question, sentUrl),
      model: modelSel?.value || "",
      signal: ctl.signal,
      window: win,
      onChunk: (chunk) => {
        if (dead || mine !== token) return;
        answer += chunk;
        paintAnswer(dom, out, answer, goPage);
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
    paintAnswer(dom, out, answer, goPage);
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
    let def = liveai.defaultModel(win);
    // A figure goes to a model that can see it: the user's default stays when it can, else the last vision model.
    if (hasImage && !models.find((m) => m.id === def)?.imageInput) {
      let last = "";
      try { last = String(storage()?.getItem(visionKey()) || ""); } catch { last = ""; }
      const pick = models.find((m) => m.id === last && m.imageInput) || models.find((m) => m.imageInput);
      if (pick) def = pick.id;
    }
    for (const m of models) {
      const opt = make(dom, "option", "", modelSel, m.provider ? `${m.name} · ${m.provider}` : m.name);
      opt.value = m.id;
      if (m.id === def) opt.selected = true;
    }
    if (def) modelSel.value = def;
    modelSel.addEventListener("change", () => {
      if (hasImage && modelSees()) { try { storage()?.setItem(visionKey(), modelSel.value); } catch { /* private mode */ } }
      paintNote();
      if (!preview.hidden) refreshPreview();
    });
    paintNote();
    if (hasImage && image.url && isUsableImageUrl(image.url)) knownUrl = image.url;
    else if (hasImage && service?.peek && image.key) {
      void Promise.resolve(service.peek(image.key)).then((url) => { if (url && !dead) { knownUrl = url; if (!preview.hidden) refreshPreview(); } }, () => {});
    }

    const quick = make(dom, "div", "pxd-ask__quick", body);
    textarea = make(dom, "textarea", "pxd-ask__question", body);
    textarea.rows = 3;
    textarea.value = prompt.text;
    textarea.setAttribute("aria-label", "Question");
    for (const q of QUICK_PROMPTS) {
      const btn = make(dom, "button", "pxd-ask__quickbtn", quick, q.label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        textarea.value = wholeDoc && !blockId && !blockIds ? q.prompt.replace("this part", "this document") : q.prompt;
        if (!preview.hidden) refreshPreview();
        void run();
      });
    }
    textarea.addEventListener("input", () => { if (!preview.hidden) refreshPreview(); });
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
      const markdown = answerCardMarkdown({ answer, chip: built.chip, imageUrl: sentUrl });
      if (!markdown || typeof addCard !== "function") { say("Cannot add a card here"); return; }
      cardBtn.disabled = true;
      void Promise.resolve(addCard({ markdown, chip: built.chip, blockId: blockId || "", answer, imageUrl: sentUrl }))
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

  const close = () => {
    if (dead) return;
    dead = true;
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

  (dom.body || dom.documentElement)?.append?.(root);
  openDialog = { el: root, close };
  return { el: root, close, built };
}

export function closeAskAI() {
  try { openDialog?.close(); } catch { /* gone */ }
}
