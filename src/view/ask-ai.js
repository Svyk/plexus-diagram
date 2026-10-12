// Ask AI chat window. Parts of parsed PDFs go to the user's Live AI Assistant (the only AI path) together with the
// document around them. A floating, movable window in the style of Live AI's own chat: context chips, a conversation
// of bubbles, a composer with the model picker. One window per document, built once and reused; a second Ask while it
// is open adds its part to the conversation. Non-modal: the board stays usable behind it.

import { answerCardMarkdown, buildFocusContext, buildMultiContext, chipText, contextWithImage, MULTI_DEFAULT_PROMPT, MULTI_QUICK_PROMPTS, parseAnswer, previewText, promptWithImage, promptWithImages, QUICK_PROMPTS, selectionDoc, splitCitations, withImageInstructions } from "../model/ai-context.js";
import { graphOfWindow, modelPickKey, pickAskModel } from "../model/ask-models.js";
import * as liveai from "../host/liveai.js";
import { getFigureImages, isUsableImageUrl, noteFor } from "../host/figure-image.js";

export const SEES_NOTE = "The model will see this image";
export const BLIND_NOTE = "This model can't see images — text only";
export const OFF_NOTE = "Figure images are off in settings — text only";
export const UPLOADING_NOTE = "Uploading figure…";
export const VISION_KEY = "pxd-ask-vision-model";
export const TITLE = "Live AI Chat";
export const PLACEHOLDER = "Ask about this part…";
// Position and size of the window, per device: { w, h, x, y }; x/y null = the default place, bottom-right.
export const GEOM_KEY = "pxd-ask-window";
export const MIN_WIDTH = 340;
export const MIN_HEIGHT = 320;
export const DEFAULT_WIDTH = 420;
export const DEFAULT_HEIGHT = 560;
export const EDGE = 16;
// While an answer streams, chunks are appended as text and the Markdown is redrawn at most this often.
export const PAINT_MS = 80;
export const QUESTION_MIN_ROWS = 1;
export const QUESTION_MAX_ROWS = 8;
// Time from openAskAI() to a painted window, for the live harness.
export const askPerf = { lastOpenMs: 0 };
const PENDING_URL = "https://… (uploaded when you press Send)";

const clipQuestion = (text) => {
  const q = String(text ?? "").replace(/\s+/g, " ").trim();
  return q.length > 60 ? `${q.slice(0, 59).trimEnd()}…` : q;
};
const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

let askModelSetting = () => "auto";
// The board hands over the "Ask AI model" setting; a conversation reads it when it starts.
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
const button = (doc, cls, parent, text, label) => {
  const b = make(doc, "button", cls, parent, text);
  b.type = "button";
  if (label) { b.setAttribute("aria-label", label); b.setAttribute("title", label); }
  return b;
};
const clear = (node) => {
  if (node.replaceChildren) node.replaceChildren();
  else while (node.firstChild) node.removeChild(node.firstChild);
};

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
  clear(node);
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

// ------------------------------------------------------------------ context entries

const docIds = new WeakMap();
let docSeq = 0;
const docId = (d) => {
  if (!d || typeof d !== "object") return "none";
  let id = docIds.get(d);
  if (!id) { docSeq += 1; id = `d${docSeq}`; docIds.set(d, id); }
  return id;
};

// One openAskAI() call's part: what it asks about and where its page links and answer card go.
function makeEntry(o) {
  const parsed = o.doc || null;
  const selection = o.selection || "";
  const hasBlocks = Boolean(parsed && parsed.blocks && Object.keys(parsed.blocks).length);
  const source = hasBlocks ? parsed : (selection ? selectionDoc({ text: selection, page: Number.isInteger(o.page) ? o.page : 1 }) : parsed);
  const focus = hasBlocks
    ? { ...(o.blockId ? { blockId: o.blockId } : {}), ...(o.blockIds ? { blockIds: o.blockIds } : {}), ...(selection ? { selection } : {}), ...(o.page != null ? { page: o.page } : {}), ...(o.wholeDoc ? { wholeDoc: true } : {}) }
    : { blockId: "sel", selection };
  const isWhole = Boolean(o.wholeDoc) && !focus.blockId && !focus.blockIds && !focus.selection && focus.page == null && hasBlocks;
  const built = buildFocusContext(source, focus);
  const what = isWhole ? "doc" : focus.blockId && focus.blockId !== "sel" ? focus.blockId : focus.blockIds ? focus.blockIds.join(",") : focus.selection ? `sel:${focus.selection.slice(0, 80)}` : focus.page != null ? `pg${focus.page}` : "x";
  return {
    key: `${docId(parsed)}|${what}`,
    label: isWhole ? `Whole document · ${built.chip?.label || "PDF"}` : chipText(built.chip) || "Part",
    parsed,
    hasBlocks,
    source,
    focus,
    isWhole,
    built,
    builtFor: built.prompt,
    image: o.image || null,
    hasImage: Boolean(o.image) && !isWhole,
    service: o.imageService || getFigureImages(),
    knownUrl: "",
    blockId: o.blockId || "",
    wholeDoc: Boolean(o.wholeDoc),
    jumpPage: o.jumpPage || null,
    addCard: o.addCard || null,
    toast: o.toast || null,
    opts: o,
  };
}

// An entry in the shape buildMultiContext() takes, for a conversation about several entries.
const asPart = (e) => ({
  key: e.key,
  label: e.label,
  doc: e.source,
  blockId: e.focus.blockId || "",
  ...(e.focus.blockIds ? { blockIds: e.focus.blockIds } : {}),
  selection: e.focus.selection || "",
  page: e.focus.page ?? null,
  wholeDoc: e.isWhole,
  image: e.hasImage ? e.image : null,
  service: e.service,
});

// ------------------------------------------------------------------ the window (built once per document)

let chat = null; // { dom, shell, session }
const active = () => chat?.session || null;

function readGeom(win) {
  const g = { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, x: null, y: null };
  try {
    const saved = JSON.parse(win.localStorage?.getItem(GEOM_KEY) || "null");
    if (saved && typeof saved === "object") {
      for (const k of ["w", "h", "x", "y"]) if (Number.isFinite(saved[k])) g[k] = saved[k];
    }
  } catch { /* private mode or junk */ }
  return g;
}

function buildShell(dom) {
  const s = { dom, win: null, geom: null, collapsed: false, composer: null };
  const root = make(dom, "div", "pxd-ask", null);
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", TITLE);
  s.root = root;
  // Nothing in here reaches the board or Roam: no pointer, wheel or key event bubbles out.
  const stop = (event) => event.stopPropagation();
  for (const type of ["pointerdown", "mousedown", "click", "mouseup", "dblclick", "wheel", "contextmenu", "touchstart", "keyup", "keypress"]) root.addEventListener(type, stop);
  root.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault?.(); active()?.escape(event.target); }
  });

  const head = make(dom, "div", "pxd-ask__head", root);
  make(dom, "span", "pxd-ask__title", head, TITLE);
  const btns = make(dom, "div", "pxd-ask__headbtns", head);
  s.openLive = button(dom, "pxd-ask__hbtn pxd-ask__openlive", btns, "↗", "Open in Live AI");
  s.collapse = button(dom, "pxd-ask__hbtn pxd-ask__collapse", btns, "–", "Collapse");
  s.collapse.setAttribute("aria-expanded", "true");
  s.closeBtn = button(dom, "pxd-ask__hbtn pxd-ask__close", btns, "×", "Close");
  s.openLive.addEventListener("click", () => active()?.openInLiveAI());
  s.closeBtn.addEventListener("click", () => active()?.close());
  s.collapse.addEventListener("click", () => {
    s.collapsed = !s.collapsed;
    root.classList.toggle("pxd-ask--collapsed", s.collapsed);
    s.collapse.setAttribute("aria-expanded", s.collapsed ? "false" : "true");
    s.collapse.textContent = s.collapsed ? "▢" : "–";
    s.collapse.setAttribute("aria-label", s.collapsed ? "Expand" : "Collapse");
    s.collapse.setAttribute("title", s.collapsed ? "Expand" : "Collapse");
    place(s);
  });

  const ctx = make(dom, "div", "pxd-ask__context", root);
  s.ctx = ctx;
  s.chip = button(dom, "pxd-ask__chip", ctx, "");
  s.chip.setAttribute("aria-expanded", "false");
  s.chip.setAttribute("title", "Show exactly what will be sent");
  s.chip.addEventListener("click", () => active()?.togglePreview());
  s.parts = make(dom, "div", "pxd-ask__parts", ctx);
  s.addWhole = button(dom, "pxd-ask__addwhole", ctx, "+ whole PDF");
  s.addWhole.setAttribute("title", "Also ask about the whole document");
  s.addWhole.addEventListener("click", () => active()?.addWholeDoc());
  s.imageRow = make(dom, "div", "pxd-ask__imagerow", ctx);
  s.thumb = make(dom, "img", "pxd-ask__thumb", s.imageRow);
  s.thumb.setAttribute("alt", "");
  s.imageNote = make(dom, "span", "pxd-ask__imgnote", s.imageRow);
  s.imageNote.setAttribute("aria-live", "polite");
  s.preview = make(dom, "pre", "pxd-ask__preview", root);
  s.preview.hidden = true;

  s.log = make(dom, "div", "pxd-ask__log", root);
  s.log.setAttribute("aria-live", "polite");
  s.welcome = make(dom, "div", "pxd-ask__welcome", s.log);
  s.quick = make(dom, "div", "pxd-ask__quick", s.welcome);
  s.setup = make(dom, "div", "pxd-ask__setup", s.log);
  s.setup.hidden = true;
  s.status = make(dom, "div", "pxd-ask__status", root);
  s.status.setAttribute("aria-live", "polite");
  s.resize = make(dom, "div", "pxd-ask__resize", root);
  s.resize.setAttribute("aria-hidden", "true");

  // The answer's own actions; they move under the latest answer.
  s.actions = make(dom, "div", "pxd-ask__actions", null);
  s.actions.hidden = true;
  s.copyBtn = button(dom, "pxd-ask__act", s.actions, "Copy");
  s.cardBtn = button(dom, "pxd-ask__act", s.actions, "Add as card");
  s.copyBtn.addEventListener("click", () => active()?.copyLast());
  s.cardBtn.addEventListener("click", () => active()?.addLast(s.cardBtn));

  wireDrag(s, head);
  wireResize(s);
  return s;
}

// The composer is built the first time Live AI is ready, then kept.
function ensureComposer(s) {
  if (s.composer) return s.composer;
  const dom = s.dom;
  const comp = make(dom, "div", "pxd-ask__composer", null);
  s.root.insertBefore(comp, s.resize);
  const tools = make(dom, "div", "pxd-ask__tools", comp);
  const model = make(dom, "select", "pxd-ask__model", tools);
  model.setAttribute("aria-label", "Model");
  model.setAttribute("title", "Model");
  const addBoard = button(dom, "pxd-ask__addboard", tools, "Add to board");
  addBoard.setAttribute("title", "Add the last answer to the board as a card");
  addBoard.disabled = true;
  const row = make(dom, "div", "pxd-ask__inputrow", comp);
  const textarea = make(dom, "textarea", "pxd-ask__question", row);
  textarea.setAttribute("aria-label", "Question");
  textarea.setAttribute("placeholder", PLACEHOLDER);
  textarea.rows = QUESTION_MIN_ROWS;
  const send = button(dom, "pxd-ask__send", row, "↑", "Send");
  const stopBtn = button(dom, "pxd-ask__stop", row, "■", "Stop");
  stopBtn.hidden = true;
  model.addEventListener("change", () => active()?.modelChanged());
  addBoard.addEventListener("click", () => active()?.addLast(addBoard));
  send.addEventListener("click", () => { void active()?.send(); });
  stopBtn.addEventListener("click", () => active()?.stop());
  textarea.addEventListener("input", () => { growQuestion(textarea); active()?.questionChanged(); });
  textarea.addEventListener("focus", () => active()?.focusQuestion());
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) return;
    event.preventDefault();
    void active()?.send();
  });
  s.composer = { el: comp, model, addBoard, textarea, send, stop: stopBtn };
  return s.composer;
}

// The question grows with its text, one to eight lines.
function growQuestion(ta) {
  if (!ta) return;
  const value = String(ta.value ?? "");
  const wrapped = value.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 46)), 0);
  ta.rows = Math.min(QUESTION_MAX_ROWS, Math.max(QUESTION_MIN_ROWS, wrapped));
}

const viewport = (s) => ({ vw: Number(s.win?.innerWidth) || 1280, vh: Number(s.win?.innerHeight) || 800 });
// The size and place the window gets in this viewport: within it, never smaller than the minimum.
function fitGeom(s) {
  const { vw, vh } = viewport(s);
  const g = s.geom;
  const w = Math.round(clamp(g.w, MIN_WIDTH, vw - 2 * 8));
  const h = Math.round(clamp(g.h, MIN_HEIGHT, vh - 2 * 8));
  const shownH = s.collapsed ? 44 : h;
  const x = Math.round(g.x == null ? vw - w - EDGE : clamp(g.x, 0, vw - w));
  const y = Math.round(g.y == null ? vh - shownH - EDGE : clamp(g.y, 0, vh - shownH));
  return { w, h, x: Math.max(0, x), y: Math.max(0, y) };
}
function place(s) {
  if (!s.geom) return;
  const f = fitGeom(s);
  const st = s.root.style;
  st.left = `${f.x}px`;
  st.top = `${f.y}px`;
  st.width = `${f.w}px`;
  st.height = s.collapsed ? "" : `${f.h}px`;
  st.transform = "";
}
function saveGeom(s) {
  try { s.win?.localStorage?.setItem(GEOM_KEY, JSON.stringify(s.geom)); } catch { /* private mode */ }
}
const frame = (s, fn) => {
  const raf = s.win?.requestAnimationFrame || globalThis.requestAnimationFrame;
  if (typeof raf !== "function") { fn(); return null; }
  return raf.call(s.win?.requestAnimationFrame ? s.win : globalThis, fn);
};
// Window-wide pointer tracking for one gesture. Listeners sit on the document in the capture phase and come off on
// pointerup; no pointer capture, so the board never sees a retargeted event.
function track(s, onMove, onUp) {
  const dom = s.dom;
  const move = (e) => { e.preventDefault?.(); onMove(e); };
  const up = (e) => {
    dom.removeEventListener?.("pointermove", move, true);
    dom.removeEventListener?.("pointerup", up, true);
    dom.removeEventListener?.("pointercancel", up, true);
    onUp(e);
  };
  dom.addEventListener?.("pointermove", move, true);
  dom.addEventListener?.("pointerup", up, true);
  dom.addEventListener?.("pointercancel", up, true);
}

// Drag by the header: a transform follows the pointer (one write per frame), the place is kept on pointerup.
// Double-click the header to put the window back in its default place.
function wireDrag(s, head) {
  head.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target?.closest?.("button, select, textarea, input")) return;
    event.preventDefault?.();
    markFullscreen(s);
    const start = fitGeom(s);
    const sx = Number(event.clientX) || 0;
    const sy = Number(event.clientY) || 0;
    const { vw, vh } = viewport(s);
    const shownH = s.collapsed ? Number(s.root.getBoundingClientRect?.().height) || 44 : start.h;
    let nx = start.x;
    let ny = start.y;
    let queued = false;
    let ended = false;
    s.root.classList.add("pxd-ask--dragging");
    track(s, (e) => {
      nx = Math.round(clamp(start.x + (Number(e.clientX) || 0) - sx, 0, vw - start.w));
      ny = Math.round(clamp(start.y + (Number(e.clientY) || 0) - sy, 0, vh - shownH));
      if (queued) return;
      queued = true;
      frame(s, () => { queued = false; if (!ended) s.root.style.transform = `translate3d(${nx - start.x}px, ${ny - start.y}px, 0)`; });
    }, () => {
      ended = true;
      s.root.classList.remove("pxd-ask--dragging");
      if (nx === start.x && ny === start.y) { s.root.style.transform = ""; return; }
      s.geom = { ...s.geom, w: start.w, h: start.h, x: nx, y: ny };
      saveGeom(s);
      place(s);
      queued = false;
    });
  });
  head.addEventListener("dblclick", (event) => {
    if (event.target?.closest?.("button")) return;
    s.geom = { ...s.geom, x: null, y: null };
    saveGeom(s);
    place(s);
  });
}

// Resize from the bottom-right corner; never below MIN_WIDTH x MIN_HEIGHT or past the viewport.
function wireResize(s) {
  s.resize.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault?.();
    const start = fitGeom(s);
    const sx = Number(event.clientX) || 0;
    const sy = Number(event.clientY) || 0;
    const { vw, vh } = viewport(s);
    let nw = start.w;
    let nh = start.h;
    let queued = false;
    let ended = false;
    // From here on the window stays where it is while its corner moves.
    s.geom = { ...s.geom, x: start.x, y: start.y };
    track(s, (e) => {
      nw = Math.round(clamp(start.w + (Number(e.clientX) || 0) - sx, MIN_WIDTH, vw - start.x));
      nh = Math.round(clamp(start.h + (Number(e.clientY) || 0) - sy, MIN_HEIGHT, vh - start.y));
      if (queued) return;
      queued = true;
      frame(s, () => { queued = false; if (!ended) { s.root.style.width = `${nw}px`; s.root.style.height = `${nh}px`; } });
    }, () => {
      ended = true;
      s.geom = { ...s.geom, w: nw, h: nh };
      saveGeom(s);
      place(s);
      queued = false;
    });
  });
}

// Above a fullscreen board: the class says so (the z-index is above it either way).
function markFullscreen(s) {
  const body = s.dom.body;
  s.root.classList.toggle("pxd-ask--over-fullscreen", Boolean(body?.classList?.contains?.("pxd-has-fullscreen")));
}

// ------------------------------------------------------------------ one conversation

function startSession(s, o) {
  const dom = s.dom;
  const win = s.win;
  const multi = o.multi || null;
  let parts = multi ? multi.basket.list() : [];
  let entries = [];
  const turns = [];
  const multiService = o.imageService || getFigureImages();
  const knownUrls = new Map();
  let multiBuilt = multi ? buildMultiContext(parts, "") : null;
  let multiFor = "";
  let toast = o.toast || null;
  const askModel = o.askModel ?? null;
  const multiAddCard = multi ? o.addCard || null : null;
  let dead = false;
  let ctl = null;
  let token = 0;
  let formReady = false;
  let models = [];
  let lastPrefill = "";
  let paintTimer = null;
  let lastPaint = 0;
  let resizeQueued = false;
  let offBasket = () => {};

  const comp = () => s.composer;
  const ta = () => s.composer?.textarea || null;
  const modelSel = () => s.composer?.model || null;
  const multiLike = () => Boolean(multi) || entries.length > 1;
  const ctxParts = () => (multi ? parts.map((p) => ({ ...p, service: multiService })) : entries.map(asPart));
  const multiLabel = () => { const n = multi ? parts.length : entries.length; return `${n} part${n === 1 ? "" : "s"}`; };
  const one = () => entries[0] || null;
  const say = (msg) => { try { toast?.(msg); } catch { /* host */ } };
  const storage = () => { try { return win.localStorage || globalThis.localStorage || null; } catch { return null; } };
  const visionKey = () => `${VISION_KEY}:${/#\/app\/([^/?#]+)/.exec(String(win.location?.hash || ""))?.[1] || ""}`;

  const anyImage = () => (multiLike() ? ctxParts().some((p) => p.image) : Boolean(one()?.hasImage));
  const noteService = () => (multi ? multiService : multiLike() ? entries.find((e) => e.hasImage)?.service : one()?.service);
  const modelSees = () => Boolean(models.find((m) => m.id === (modelSel()?.value || ""))?.imageInput);
  const imagesOn = () => {
    const svc = noteService();
    try { return svc ? svc.enabled() !== false : Boolean(one()?.image?.url); } catch { return true; }
  };
  // Will the next Send carry the picture(s)?
  const willSend = () => anyImage() && imagesOn() && modelSees();

  // A whole-document context is retrieved for the question, so it follows the composer.
  const rebuild = (question) => {
    const q = String(question ?? "").trim();
    if (multiLike()) {
      if (multiBuilt && q === multiFor) return;
      multiBuilt = buildMultiContext(ctxParts(), q);
      multiFor = q;
      return;
    }
    const e = one();
    if (!e || !e.isWhole || q === e.builtFor) return;
    e.builtFor = q;
    e.built = buildFocusContext(e.source, e.focus, { question: q });
    s.chip.textContent = chipText(e.built.chip);
  };
  const defaultPrompt = () => (multiLike() ? MULTI_DEFAULT_PROMPT : one()?.built.prompt || "");
  const questionText = () => {
    const t = ta();
    return t ? t.value : defaultPrompt();
  };

  const paintNote = () => {
    const show = anyImage();
    s.imageRow.hidden = !show;
    if (!show) { s.imageNote.textContent = ""; return; }
    s.imageNote.textContent = !imagesOn() ? OFF_NOTE : modelSees() ? SEES_NOTE : BLIND_NOTE;
  };
  const paintThumb = () => {
    const e = !multiLike() ? one() : null;
    s.thumb.hidden = true;
    s.thumb.removeAttribute?.("src");
    if (!e?.hasImage) return;
    const mine = token;
    const show = (src) => { if (src && !dead && mine === token && one() === e && !multiLike()) { s.thumb.setAttribute("src", src); s.thumb.hidden = false; } };
    const image = e.image;
    if (image.thumb) show(image.thumb);
    else if (typeof image.getThumb === "function") void Promise.resolve().then(() => image.getThumb()).then(show, () => {});
    else if (image.url) show(image.url);
  };
  const refreshPreview = () => {
    if (s.preview.hidden) return;
    const question = questionText();
    rebuild(question);
    const sending = willSend();
    if (multiLike()) {
      const shown = ctxParts().map((p) => (p.image && sending ? { ...p, imageUrl: knownUrls.get(p.key) || PENDING_URL } : p));
      const b = buildMultiContext(shown, question);
      s.preview.textContent = `${previewText({ instructions: b.instructions, context: b.context, prompt: promptWithImages(question, shown.some((p) => p.imageUrl)) })}\n\n(about ${b.tokensEstimate.toLocaleString?.() ?? b.tokensEstimate} tokens before the question)`;
      return;
    }
    const e = one();
    if (!e) return;
    const built = e.built;
    s.preview.textContent = `${previewText({
      instructions: sending ? withImageInstructions(built.instructions) : built.instructions,
      context: sending ? contextWithImage(built.context, e.knownUrl || PENDING_URL, e.image?.caption || built.figure?.caption || "") : built.context,
      prompt: sending ? promptWithImage(question, true) : question,
    })}\n\n(about ${built.tokensEstimate.toLocaleString?.() ?? built.tokensEstimate} tokens before the question)`;
  };

  const paintQuick = () => {
    clear(s.quick);
    s.welcome.hidden = turns.length > 0 || !formReady;
    if (s.welcome.hidden) return;
    const wholeOnly = !multiLike() && one()?.isWhole;
    for (const q of multiLike() ? MULTI_QUICK_PROMPTS : QUICK_PROMPTS) {
      const btn = button(dom, "pxd-ask__quickbtn", s.quick, q.label);
      btn.addEventListener("click", () => {
        const t = ta();
        if (!t) return;
        t.value = wholeOnly ? q.prompt.replace("this part", "this document") : q.prompt;
        lastPrefill = "";
        growQuestion(t);
        refreshPreview();
        void run();
      });
    }
  };
  // The composer holds the default question until the user types; it follows the context while untouched.
  const prefill = () => {
    const t = ta();
    if (!t || turns.length) return;
    if (t.value && t.value !== lastPrefill) return;
    lastPrefill = defaultPrompt();
    t.value = lastPrefill;
    growQuestion(t);
  };
  const paintContext = () => {
    s.chip.textContent = multiLike() ? multiLabel() : chipText(one()?.built.chip) || "No context loaded";
    clear(s.parts);
    s.parts.hidden = !multiLike();
    if (multiLike()) {
      const list = multi ? parts : entries;
      list.forEach((p, i) => {
        const c = make(dom, "span", "pxd-ask__partchip", s.parts);
        make(dom, "span", "pxd-ask__partlabel", c, `Part ${i + 1}: ${p.label || "Part"}`);
        const x = button(dom, "pxd-ask__partx", c, "×", `Remove part ${i + 1}`);
        x.addEventListener("click", () => removePart(p.key));
      });
    }
    const base = !multi ? entries.find((e) => e.hasBlocks && !e.isWhole) : null;
    s.addWhole.hidden = !base || entries.some((e) => e.isWhole && e.parsed === base.parsed);
    paintThumb();
    paintNote();
    paintQuick();
    prefill();
    refreshPreview();
  };
  const peekImage = (e) => {
    if (!e.hasImage) return;
    if (e.image.url && isUsableImageUrl(e.image.url)) { e.knownUrl = e.image.url; return; }
    if (e.service?.peek && e.image.key) void Promise.resolve(e.service.peek(e.image.key)).then((url) => { if (url && !dead) { e.knownUrl = url; refreshPreview(); } }, () => {});
  };
  const peekMulti = () => {
    for (const p of parts) {
      if (!p.image) continue;
      if (p.image.url && isUsableImageUrl(p.image.url)) knownUrls.set(p.key, p.image.url);
      else if (multiService?.peek && p.image.key) void Promise.resolve(multiService.peek(p.image.key)).then((url) => { if (url && !dead) { knownUrls.set(p.key, url); refreshPreview(); } }, () => {});
    }
  };
  const addEntry = (opts) => {
    const e = makeEntry(opts);
    if (opts.toast) toast = opts.toast;
    if (entries.some((x) => x.key === e.key)) return entries.find((x) => x.key === e.key);
    entries.push(e);
    multiBuilt = null;
    peekImage(e);
    paintContext();
    return e;
  };
  const removePart = (key) => {
    if (multi) { multi.basket.remove(key); return; }
    if (entries.length < 2) return;
    entries = entries.filter((e) => e.key !== key);
    multiBuilt = null;
    paintContext();
  };

  const goPage = (n, partNo) => {
    try {
      if (multi) {
        const part = partNo != null ? parts[partNo - 1] : parts[0];
        if (part && (n != null || partNo != null)) multi.jump?.(part, n != null ? n : part.page);
        return;
      }
      if (entries.length > 1) {
        const e = partNo != null ? entries[partNo - 1] : entries[0];
        const pg = n != null ? n : e?.focus.page ?? e?.built.chip?.page ?? null;
        if (e && pg != null) e.jumpPage?.(pg);
        return;
      }
      if (n != null) one()?.jumpPage?.(n);
    } catch { /* reader */ }
  };

  // ---- models and Live AI availability
  const fillModels = () => {
    const sel = modelSel();
    clear(sel);
    models = liveai.listModels(win);
    // Plexus' own default (Claude, then Gemini) unless the user picked a model here before; a figure needs one that sees it.
    let remembered = "";
    try { remembered = String(storage()?.getItem(modelPickKey(graphOfWindow(win))) || ""); } catch { remembered = ""; }
    if (!remembered && anyImage()) { try { remembered = String(storage()?.getItem(visionKey()) || ""); } catch { remembered = ""; } }
    const def = pickAskModel(models, { setting: askModel ?? askModelSetting(), remembered, liveDefault: liveai.defaultModel(win), needImage: anyImage() });
    for (const m of models) {
      const opt = make(dom, "option", "", sel, m.provider ? `${m.name} · ${m.provider}` : m.name);
      opt.value = m.id;
      if (m.id === def) opt.selected = true;
    }
    if (def) sel.value = def;
  };
  const rememberModel = () => {
    const sel = modelSel();
    try { storage()?.setItem(modelPickKey(graphOfWindow(win)), sel.value); } catch { /* private mode */ }
    if (anyImage() && modelSees()) { try { storage()?.setItem(visionKey(), sel.value); } catch { /* private mode */ } }
  };
  const paintSetup = () => {
    clear(s.setup);
    const box = make(dom, "div", "pxd-ask__card", s.setup);
    make(dom, "p", "pxd-ask__hint", box, liveai.present(win)
      ? "Live AI Assistant has no model ready. Add a model and its API key in Live AI Assistant's settings."
      : liveai.SETUP_HINT);
    make(dom, "p", "pxd-ask__hint pxd-ask__hint--quiet", box, "How to enable: Roam Depot → Live AI Assistant (v29 or later) → Settings → Enable Public API, then reload Roam.");
  };
  const paintOpenLive = () => { s.openLive.hidden = typeof win.LiveAI?.openChatPopup !== "function"; };
  const sync = (ok) => {
    if (dead) return;
    paintOpenLive();
    if (ok && !formReady) {
      const c = ensureComposer(s);
      formReady = true;
      c.el.hidden = false;
      s.setup.hidden = true;
      fillModels();
      paintNote();
      paintQuick();
      prefill();
      try { c.textarea.focus(); } catch { /* stub */ }
    } else if (!ok && (formReady || s.setup.hidden)) {
      try { ctl?.abort(); } catch { /* done */ }
      formReady = false;
      if (s.composer) s.composer.el.hidden = true;
      paintSetup();
      s.setup.hidden = false;
      s.welcome.hidden = true;
    }
  };

  // ---- the conversation
  const setBusy = (busy) => {
    const c = comp();
    if (!c) return;
    c.send.hidden = busy;
    c.stop.hidden = !busy;
  };
  const lastAnswered = () => [...turns].reverse().find((t) => t.answer.trim()) || null;
  const showActions = (turn, on) => {
    if (turn?.msg && s.actions.parentElement !== turn.msg) turn.msg.append(s.actions);
    s.actions.hidden = !on;
    if (comp()) comp().addBoard.disabled = !lastAnswered();
  };
  const nearBottom = () => {
    const log = s.log;
    const h = Number(log.scrollHeight) || 0;
    return !h || (Number(log.scrollTop) || 0) + (Number(log.clientHeight) || 0) >= h - 32;
  };
  const toBottom = () => { try { s.log.scrollTop = s.log.scrollHeight; } catch { /* stub */ } };
  const paintTurn = (turn) => {
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    const stick = nearBottom();
    paintAnswer(dom, turn.bubble, turn.answer, goPage);
    lastPaint = now();
    if (stick) toBottom();
  };
  // A chunk between paints: its text goes on the end of the last paragraph or list item.
  const appendChunk = (turn, chunk) => {
    let n = turn.bubble.lastChild;
    while (n && n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName) && n.lastChild) n = n.lastChild;
    const into = n && n.nodeType === 1 && /^(P|LI)$/.test(n.tagName) ? n : turn.bubble;
    into.append(dom.createTextNode(chunk));
  };
  const userBubble = (text) => {
    const msg = make(dom, "div", "pxd-ask__msg pxd-ask__msg--user", null);
    make(dom, "div", "pxd-ask__bubble", msg, text);
    s.log.append(msg);
    return msg;
  };
  const answerBubble = (turn) => {
    for (const old of s.log.querySelectorAll?.(".pxd-ask__answer") || []) old.classList.remove("pxd-ask__answer");
    turn.msg = make(dom, "div", "pxd-ask__msg pxd-ask__msg--ai", null);
    turn.bubble = make(dom, "div", "pxd-ask__bubble pxd-ask__answer", turn.msg);
    s.log.append(turn.msg);
  };
  const dropTurn = (turn) => {
    if (s.actions.parentElement === turn.msg) s.actions.remove();
    try { turn.user?.remove(); } catch { /* gone */ }
    try { turn.msg?.remove(); } catch { /* gone */ }
    const at = turns.indexOf(turn);
    if (at >= 0) turns.splice(at, 1);
  };

  // The model that answers next: the following one from a different provider (one that sees images when a figure goes along).
  const nextModel = () => {
    const at = models.findIndex((m) => m.id === modelSel()?.value);
    const cur = models[at];
    const others = models.filter((m) => m.id !== cur?.id && (m.provider || "") !== (cur?.provider || ""));
    const ordered = [...models.slice(at + 1), ...models.slice(0, Math.max(0, at))].filter((m) => others.includes(m));
    return (anyImage() && ordered.find((m) => m.imageInput)) || ordered[0] || null;
  };
  const showEmpty = (turn) => {
    const cur = models.find((m) => m.id === modelSel()?.value);
    clear(turn.bubble);
    s.status.textContent = "";
    showActions(turn, false);
    const box = make(dom, "div", "pxd-ask__empty", turn.bubble);
    make(dom, "p", "pxd-ask__emptymsg", box, `${cur?.name || "The model"} returned an empty answer. Live AI may not be set up for this provider; try another model.`);
    const next = nextModel();
    if (!next) return;
    const btn = button(dom, "pxd-ask__tryother", box, `Try ${next.name}`);
    btn.addEventListener("click", () => {
      modelSel().value = next.id;
      rememberModel();
      paintNote();
      refreshPreview();
      void run({ retry: turn });
    });
  };

  const ensureImage = async (spec, svc) => {
    try {
      if (svc) return await svc.ensureUrl(spec);
      return spec.url && isUsableImageUrl(spec.url) ? { ok: true, url: spec.url } : { ok: false, reason: "upload-failed" };
    } catch {
      return { ok: false, reason: "upload-failed" };
    }
  };

  async function run({ retry = null } = {}) {
    const t = ta();
    if (!t || ctl || dead) return;
    let turn = retry;
    const question = retry ? retry.q : t.value.trim();
    if (!question) { s.status.textContent = "Type a question first."; return; }
    rebuild(question);
    ctl = typeof win.AbortController === "function" ? new win.AbortController() : new AbortController();
    token += 1;
    const mine = token;
    if (!turn) {
      turn = { q: question, prompt: "", answer: "", sentUrl: "", user: userBubble(question), msg: null, bubble: null };
      turns.push(turn);
      t.value = "";
      lastPrefill = "";
      growQuestion(t);
      s.welcome.hidden = true;
      answerBubble(turn);
    } else {
      turn.answer = "";
      clear(turn.bubble);
    }
    turn.sentUrl = "";
    lastPaint = 0;
    showActions(turn, false);
    setBusy(true);
    toBottom();
    let note = "";
    let sendContext = "";
    let sendInstructions = "";
    let sendPrompt = "";
    if (multiLike()) {
      const list = ctxParts();
      const urls = new Map();
      if (willSend()) {
        s.status.textContent = UPLOADING_NOTE;
        for (const p of list.filter((x) => x.image)) {
          const got = await ensureImage(p.image, p.service);
          if (mine !== token || dead) return;
          if (got.ok) { urls.set(p.key, got.url); knownUrls.set(p.key, got.url); } else note = noteFor(got.reason);
        }
      }
      const shown = list.map((p) => (urls.has(p.key) ? { ...p, imageUrl: urls.get(p.key) } : p));
      const b = buildMultiContext(shown, question);
      sendContext = b.context;
      sendInstructions = b.instructions;
      sendPrompt = promptWithImages(question, urls.size > 0);
      turn.sentUrl = urls.size ? "multi" : "";
    } else {
      const e = one();
      if (willSend()) {
        s.status.textContent = UPLOADING_NOTE;
        const got = await ensureImage(e.image, e.service);
        if (mine !== token || dead) return;
        if (got.ok) { turn.sentUrl = got.url; e.knownUrl = got.url; } else note = noteFor(got.reason);
      }
      sendContext = contextWithImage(e.built.context, turn.sentUrl, e.image?.caption || e.built.figure?.caption || "");
      sendInstructions = turn.sentUrl ? withImageInstructions(e.built.instructions) : e.built.instructions;
      sendPrompt = promptWithImage(question, turn.sentUrl);
    }
    turn.prompt = sendPrompt;
    s.status.textContent = note ? `${note} Thinking…` : "Thinking…";
    if (note) say(note);
    // Earlier turns go along as messages; the context is sent fresh with every question.
    const messages = turns.slice(0, turns.indexOf(turn)).filter((x) => x.answer.trim())
      .flatMap((x) => [{ role: "user", content: x.prompt || x.q }, { role: "assistant", content: x.answer }]);
    const result = await liveai.ask({
      context: sendContext,
      systemPrompt: sendInstructions,
      prompt: sendPrompt,
      messages,
      model: modelSel()?.value || "",
      signal: ctl.signal,
      window: win,
      onChunk: (chunk) => {
        if (dead || mine !== token) return;
        turn.answer += chunk;
        s.status.textContent = "";
        if (now() - lastPaint >= PAINT_MS) { paintTurn(turn); return; }
        appendChunk(turn, chunk);
        if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = null; if (!dead && mine === token) paintTurn(turn); }, PAINT_MS);
      },
    });
    if (mine !== token || dead) return;
    ctl = null;
    setBusy(false);
    if (!result.ok && result.code === "EMPTY_RESPONSE" && !turn.answer) { showEmpty(turn); return; }
    if (!result.ok) {
      s.status.textContent = result.error;
      if (turn.answer) { paintTurn(turn); showActions(turn, true); }
      return;
    }
    turn.answer = result.text || turn.answer;
    if (!turn.answer.trim()) { turn.answer = ""; showEmpty(turn); return; }
    paintTurn(turn);
    // The picker's label ("Claude Sonnet 5.5 · Anthropic"), not the raw model id.
    const shown = result.model ? ([...(s.composer?.model?.options || [])].find((o) => o.value === result.model)?.textContent || result.model) : "";
    s.status.textContent = shown ? `${shown}${result.usage?.outputTokens ? ` · ${result.usage.outputTokens} tokens` : ""}` : "";
    showActions(turn, true);
  }

  const stop = () => {
    if (!ctl) return;
    const was = ctl;
    token += 1;
    ctl = null;
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    try { was.abort(); } catch { /* done */ }
    setBusy(false);
    s.status.textContent = "Stopped.";
    const turn = turns[turns.length - 1];
    if (!turn) return;
    if (turn.answer) { paintTurn(turn); showActions(turn, true); return; }
    // Nothing came back: the question goes back into the composer.
    dropTurn(turn);
    const t = ta();
    if (t && !t.value.trim()) { t.value = turn.q; growQuestion(t); }
    if (!turns.length) paintQuick();
    showActions(null, false);
  };

  const addLast = (btn) => {
    const turn = lastAnswered();
    if (!turn) { say("Nothing to add yet"); return; }
    const e = one();
    const many = multiLike();
    const cardChip = many ? { label: multiLabel(), page: null, docTitle: clipQuestion(turn.q) } : e?.built.chip;
    const imageUrl = many ? "" : turn.sentUrl;
    const markdown = answerCardMarkdown({ answer: turn.answer, chip: cardChip, imageUrl });
    const fn = multi ? multiAddCard : e?.addCard;
    if (!markdown || typeof fn !== "function") { say("Cannot add a card here"); return; }
    btn.disabled = true;
    void Promise.resolve(fn({ markdown, chip: cardChip, blockId: multi ? "" : e?.blockId || "", answer: turn.answer, imageUrl, ...(multi ? { parts: parts.slice() } : {}) }))
      .catch(() => {})
      .then(() => { btn.disabled = false; });
  };
  const copyLast = () => {
    const turn = lastAnswered();
    const clip = win.navigator?.clipboard || globalThis.navigator?.clipboard;
    if (!turn || !clip?.writeText) { say("Could not copy"); return; }
    void clip.writeText(turn.answer).then(() => say("Copied"), () => say("Could not copy"));
  };

  // Live AI's own chat takes the conversation over: the context goes first, in the first user message.
  const openInLiveAI = () => {
    const open = win.LiveAI?.openChatPopup;
    if (typeof open !== "function") return;
    const t = ta();
    const pending = t && t.value.trim() && t.value !== lastPrefill ? t.value.trim() : "";
    rebuild(pending || (turns[0]?.q ?? ""));
    const b = multiLike() ? multiBuilt : one()?.built;
    const head = [`Context from Plexus Diagram (${multiLike() ? multiLabel() : chipText(one()?.built.chip) || "PDF"}):`, b?.instructions || "", b?.context || ""].filter(Boolean).join("\n\n");
    const history = [];
    for (const x of turns) {
      if (!x.answer.trim()) continue;
      history.push({ role: "user", content: x.q }, { role: "assistant", content: x.answer });
    }
    if (pending) history.push({ role: "user", content: pending });
    if (history[0]?.role === "user") history[0] = { role: "user", content: `${head}\n\n${history[0].content}` };
    else history.unshift({ role: "user", content: head });
    try { void Promise.resolve(open({ conversationHistory: history, model: modelSel()?.value || undefined })).catch(() => {}); } catch { /* Live AI */ }
    close();
  };

  const escape = (target) => {
    if (ctl) { stop(); return; }
    const t = ta();
    if (t && target === t && t.value.trim() && t.value !== lastPrefill) return;
    close();
  };

  const onResize = () => {
    if (resizeQueued || dead) return;
    resizeQueued = true;
    frame(s, () => { resizeQueued = false; if (!dead) place(s); });
  };

  function close() {
    if (dead) return;
    dead = true;
    token += 1;
    try { offBasket(); } catch { /* gone */ }
    try { ctl?.abort(); } catch { /* done */ }
    ctl = null;
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    try { offReady(); } catch { /* gone */ }
    try { win.removeEventListener?.("resize", onResize); } catch { /* gone */ }
    for (const t of [...turns]) dropTurn(t);
    s.actions.remove?.();
    s.status.textContent = "";
    s.preview.hidden = true;
    s.chip.setAttribute("aria-expanded", "false");
    try { s.root.remove(); } catch { /* gone */ }
    if (chat?.session === api) chat.session = null;
  }

  const api = {
    multi,
    win,
    get entries() { return entries; },
    addEntry,
    close,
    escape,
    send: () => run(),
    stop,
    addLast,
    copyLast,
    openInLiveAI,
    addWholeDoc: () => {
      const base = entries.find((e) => e.hasBlocks && !e.isWhole);
      if (!base) return;
      addEntry({ ...base.opts, blockId: "", blockIds: null, selection: "", page: null, image: null, wholeDoc: true });
      focus();
    },
    togglePreview: () => {
      const show = s.preview.hidden;
      s.preview.hidden = !show;
      s.chip.setAttribute("aria-expanded", show ? "true" : "false");
      refreshPreview();
    },
    modelChanged: () => { rememberModel(); paintNote(); refreshPreview(); },
    questionChanged: () => refreshPreview(),
    focusQuestion: () => {
      const t = ta();
      if (t && t.value && t.value === lastPrefill) { try { t.select?.(); } catch { /* stub */ } }
    },
    built: () => (multiLike() ? multiBuilt || buildMultiContext(ctxParts(), "") : one()?.built || null),
  };
  const focus = () => { try { ta()?.focus(); } catch { /* stub */ } };
  api.focus = focus;

  // ---- start
  clear(s.setup);
  s.setup.hidden = true;
  s.status.textContent = "";
  s.preview.hidden = true;
  s.chip.setAttribute("aria-expanded", "false");
  if (s.composer) { s.composer.textarea.value = ""; s.composer.el.hidden = true; s.composer.addBoard.disabled = true; setBusy(false); }
  if (multi) {
    peekMulti();
    offBasket = multi.basket.subscribe((list) => {
      if (dead) return;
      parts = list;
      if (!parts.length) { close(); return; }
      multiBuilt = null;
      paintContext();
    });
  } else {
    entries.push(makeEntry(o));
    peekImage(entries[0]);
  }
  paintContext();
  const offReady = liveai.onReady(sync, win);
  if (!formReady && s.setup.hidden) sync(liveai.available(win));
  win.addEventListener?.("resize", onResize);
  return api;
}

// doc: a pxd-parse document, or null (then `selection` is all there is). focus keys: blockId | selection | page.
// Extras: jumpPage(n), addCard({ markdown, chip, blockId, imageUrl }) -> Promise, toast(msg), win, host document.
// image: { key, caption, url?, name?, getBlob(), getThumb() } is a picture the model may see; imageService decides how its
// URL is made (default: the one the board registered). Nothing is uploaded before Send.
// multi: { basket, jump(part, page) } asks one question about every part in the basket instead (see ask-basket.js).
// While the window is open, another call adds its part to the conversation (a basket starts a new one).
export function openAskAI(opts = {}) {
  const dom = opts.document || (typeof document !== "undefined" ? document : null);
  if (!dom) return null;
  const t0 = now();
  const win = opts.window || dom.defaultView || globalThis;
  if (chat && chat.dom !== dom) { try { chat.session?.close(); } catch { /* gone */ } chat = null; }
  if (!chat) chat = { dom, shell: buildShell(dom), session: null };
  const s = chat.shell;
  const cur = chat.session;
  const handle = (built) => ({ el: s.root, close: () => cur2()?.close(), built });
  let session = cur;
  const cur2 = () => session;
  if (s.collapsed && cur) s.collapse.click();
  if (cur && cur.win === win && !opts.multi && !cur.multi) {
    const e = cur.addEntry(opts);
    cur.focus();
    markFullscreen(s);
    askPerf.lastOpenMs = now() - t0;
    return handle(e.built);
  }
  if (cur && opts.multi && cur.multi && cur.multi.basket === opts.multi.basket && cur.win === win) {
    cur.focus();
    askPerf.lastOpenMs = now() - t0;
    return handle(cur.built());
  }
  try { cur?.close(); } catch { /* gone */ }
  s.win = win;
  s.geom = readGeom(win);
  markFullscreen(s);
  const dark = Boolean(dom.querySelector?.(".pxd-root--dark"));
  s.root.classList.toggle("pxd-ask--dark", dark);
  place(s);
  if (!s.root.isConnected) (dom.body || dom.documentElement)?.append?.(s.root);
  session = startSession(s, opts);
  chat.session = session;
  askPerf.lastOpenMs = now() - t0;
  return handle(session.built());
}

export function closeAskAI() {
  try { chat?.session?.close(); } catch { /* gone */ }
}
