// PDF reading pane. One live Roam reader beside the board. The highlight list is the drawer's.
// Width is localStorage. No :pdf-highlight write, no palette command.
// This pane adds no document key listener. The parsed view adds one while it is open and removes it on dispose.

import { CARD_MIME, PARSE_MIME } from "../model/drop.js";
import { HIGHLIGHT_COLORS, highlightModel } from "../model/highlight.js";
import { highlightRows } from "../model/highlight-pick.js";
import { coverModel, parsedDocTitle, pdfMacroUrl, readPaneKey, readPaneWidth, readerRule, writeReaderPage } from "../model/pdf.js";
import { dragChipText, fiberOf, highlightById, highlighterContext, PDF_MARK, uidFromMark } from "../model/pdf-drag.js";
import { fitDecision, fitWidthStep, fitsWidth, pageIndicator, pageTotalText, pdfDocumentFromFiber, pillActions, viewerFromFiber } from "../model/read-pane-model.js";
import { isTextEntryTarget } from "./cards.js";
import { applyMotionClasses } from "./motion.js";
import { BOTH_MIN_PX, BUILTIN_OPTIONS, createParseView, readParsedUrls } from "./parse-view.js";
import { optionsHash } from "../model/parse-hash.js";
import { createParseStore } from "../host/parse-store.js";
import { createHelperClient } from "../host/parse-helper-client.js";
import { imageKey } from "../host/parse-store.js";
import { placePopover } from "../relchips.js";
import { chromeObstacles } from "./avoid.js";
import { createDragGhost, dispatchDrop } from "./drag-ghost.js";
import { selectionBarPlacement, selectionInReader } from "./make-highlight.js";
import { compactPage, createTextLayer, pageRecords } from "./text-layer.js";

// U4 owns the visible drawer. The import is async so a missing file leaves the pane's own list.
let liveDrawer = null;
import("./read-drawer.js")
  .then((mod) => {
    liveDrawer = typeof mod?.createReadDrawer === "function" ? mod.createReadDrawer : null;
  })
  .catch(() => { liveDrawer = null; });

const PLACE_W = 300;
const PLACE_H = 140;
const FLASH_MS = 1600;
const ONE_REF = /^\(\(([\w-]+)\)\)$/;
const COLORS = ["gray", ...HIGHLIGHT_COLORS];
export const READ_MODE_KEY = "pxd-read-mode";
export const OCR_LAYER_ID = "ocr-layer";
const BAR_SETTLE_MS = 160;

// U6. Two modes: Read ("reader") and Read + Outline ("both"). Old values ("parsed", "both") mean the outline.
export function normalizeReadMode(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (["parsed", "both", "outline", "read+outline", "read-outline"].includes(v)) return "both";
  return "reader";
}

// The last mode on this device. An old stored value is rewritten in the new form.
export function storedReadMode(storage) {
  let raw = null;
  try { raw = storage?.getItem?.(READ_MODE_KEY); } catch { raw = null; }
  if (raw == null || raw === "") return "reader";
  const mode = normalizeReadMode(raw);
  const fresh = mode === "both" ? "read+outline" : "read";
  if (raw !== fresh) { try { storage?.setItem?.(READ_MODE_KEY, fresh); } catch { /* private mode */ } }
  return mode;
}

export function writeReadMode(storage, mode) {
  try { storage?.setItem?.(READ_MODE_KEY, normalizeReadMode(mode) === "both" ? "read+outline" : "read"); } catch { /* private mode */ }
}

// Merges stored text-layer pages with new ones, page by page.
export function mergeOcrPages(stored, fresh) {
  const byPage = new Map();
  for (const rec of pageRecords(stored)) byPage.set(Number(rec.n), rec);
  for (const rec of pageRecords(fresh)) byPage.set(Number(rec.n), Array.isArray(rec.boxes) ? rec : compactPage(rec));
  return [...byPage.values()].sort((a, b) => a.n - b.n);
}

export function placedHighlightUid(items, refUid) {
  if (typeof refUid !== "string" || refUid === "") return "";
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    if (!item || item.kind !== "highlight") continue;
    if (item.target?.uid !== refUid) continue;
    return typeof item.uid === "string" ? item.uid : "";
  }
  return "";
}

// One ((uid)) payload. Five strings stay on the ordinary drop path.
export function singleRefUid(list) {
  if (!Array.isArray(list) || list.length !== 1) return "";
  const text = String(list[0]?.string ?? "").trim();
  const match = ONE_REF.exec(text);
  return match ? match[1] : "";
}

export function highlightDropPlan(list, items) {
  const uid = singleRefUid(list);
  if (!uid) return { kind: "cards" };
  const existing = placedHighlightUid(items, uid);
  if (existing) return { kind: "pulse", uid: existing };
  return { kind: "cards" };
}

export function originBeside(rect) {
  const box = rect && typeof rect === "object" ? rect : {};
  const x = typeof box.x === "number" && Number.isFinite(box.x) ? box.x : 0;
  const y = typeof box.y === "number" && Number.isFinite(box.y) ? box.y : 0;
  const w = typeof box.w === "number" && Number.isFinite(box.w) ? box.w : 0;
  return { x: x + w + 40, y };
}

export function placePayload(row, origin) {
  if (!row || row.placed === true) return null;
  const uid = typeof row.uid === "string" ? row.uid : "";
  if (!uid) return null;
  const at = origin && typeof origin === "object" ? origin : {};
  const x = typeof at.x === "number" && Number.isFinite(at.x) ? at.x : 0;
  const y = typeof at.y === "number" && Number.isFinite(at.y) ? at.y : 0;
  return { string: `((${uid}))`, x, y, w: PLACE_W, h: PLACE_H };
}

export function placeDecision(row, items, origin) {
  const uid = typeof row?.uid === "string" ? row.uid : "";
  const existing = placedHighlightUid(items, uid);
  if (row?.placed === true || existing) return { kind: "pulse", uid: existing };
  const item = placePayload(row, origin);
  if (!item) return { kind: "none" };
  return { kind: "create", item };
}

function svgIcon(doc, pathD, stroke) {
  const ns = "http://www.w3.org/2000/svg";
  if (typeof doc?.createElementNS !== "function") return null;
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(ns, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", stroke);
  svg.append(path);
  return svg;
}

function pdfGlyph(doc) {
  return svgIcon(doc, "M3.5 1.5h6L13 5v9.5H3.5v-13zM9.5 1.8V5H13", "1.2");
}

function crossGlyph(doc) {
  const svg = svgIcon(doc, "M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6", "1.5");
  const path = svg?.querySelector?.("path");
  path?.setAttribute?.("stroke-linecap", "round");
  return svg;
}

function pillButton(doc, el, parent, label, text) {
  const button = el("button", "pxd-read__pillbtn", parent);
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  return button;
}

export function readerJumpPlan({ cardUid = "", blockUid = "" } = {}) {
  if (typeof cardUid === "string" && cardUid) return { action: "card", uid: cardUid };
  if (typeof blockUid === "string" && blockUid) return { action: "block", uid: blockUid };
  return { action: "missing", toast: "Click the highlight to open the PDF" };
}

function indexNodes(nodes, map) {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.uid === "string" && node.uid) map.set(node.uid, node);
    if (Array.isArray(node.children)) indexNodes(node.children, map);
  }
}

function sortRows(rows) {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const ap = typeof a.row.page === "number" ? a.row.page : Infinity;
    const bp = typeof b.row.page === "number" ? b.row.page : Infinity;
    if (ap !== bp) return ap - bp;
    return a.index - b.index;
  }).map((entry) => entry.row);
}

export function createReadPane({
  doc = globalThis.document,
  root,
  host,
  graph = "",
  storage = globalThis.localStorage,
  onClose,
  onPlace,
  onNote,
  onHover,
  onSwitch,
  onSnapshot,
  onReadingChange,
  onParsedTitle,
  cards,
  placed,
  titleOf,
  coverSrc,
  createDrawer,
  session = null,
  settings = null,
  onNeedOcr = null,
} = {}) {
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    parent?.append(node);
    return node;
  };
  const setHidden = (node, on) => {
    if (!node) return;
    node.hidden = Boolean(on);
    if (on) node.setAttribute("hidden", "");
    else node.removeAttribute("hidden");
  };
  const pane = el("aside", "pxd-read");
  pane.setAttribute("role", "complementary");
  pane.setAttribute("aria-label", "PDF reader");
  const split = el("div", "pxd-read__split", pane);
  split.setAttribute("role", "separator");
  split.setAttribute("aria-orientation", "vertical");
  const head = el("div", "pxd-read__head", pane);
  const dot = el("span", "pxd-read__dot", head);
  dot.setAttribute("aria-hidden", "true");
  const glyph = el("span", "pxd-read__glyph", head);
  glyph.setAttribute("aria-hidden", "true");
  const glyphSvg = pdfGlyph(doc);
  if (glyphSvg) glyph.append(glyphSvg);
  const titleNode = el("div", "pxd-read__title", head);
  const switchBtn = el("button", "pxd-read__switchbtn pxd-chrome", head);
  switchBtn.type = "button";
  switchBtn.textContent = "▾";
  switchBtn.setAttribute("aria-label", "PDFs on this board");
  const switcher = el("select", "pxd-read__switch", head);
  switcher.setAttribute("aria-label", "PDF on this board");
  const hlBtn = el("button", "pxd-read__highlights pxd-chrome", head);
  hlBtn.type = "button";
  hlBtn.setAttribute("aria-label", "Highlights");
  hlBtn.setAttribute("aria-pressed", "false");
  el("span", "pxd-read__hicon", hlBtn).textContent = "☰";
  const countNode = el("span", "pxd-read__count", hlBtn);
  countNode.textContent = "";
  countNode.hidden = true;
  const toolsBtn = el("button", "pxd-read__tools pxd-chrome", head);
  toolsBtn.type = "button";
  toolsBtn.textContent = "⚙";
  toolsBtn.setAttribute("aria-label", "Roam tools");
  toolsBtn.setAttribute("aria-pressed", "false");
  const closeBtn = el("button", "pxd-read__close pxd-chrome", head);
  closeBtn.type = "button";
  const cross = crossGlyph(doc);
  if (cross) closeBtn.append(cross);
  else closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close");
  const modes = el("div", "pxd-read__modes", pane);
  modes.setAttribute("role", "toolbar");
  modes.setAttribute("aria-label", "Reader mode");
  setHidden(modes, true);
  const modeBtns = {};
  for (const [id, label, tip] of [["reader", "Read", "parse.mode.reader"], ["both", "Read + Outline", "parse.mode.both"]]) {
    const button = el("button", "pxd-read__mode", modes);
    button.type = "button";
    button.textContent = label;
    button.setAttribute("data-mode", id);
    button.setAttribute("data-tip", tip);
    button.setAttribute("aria-pressed", id === "reader" ? "true" : "false");
    modeBtns[id] = button;
  }
  const progress = el("div", "pxd-read__progress", pane);
  setHidden(progress, true);
  const progressFill = el("div", "pxd-read__progressfill", progress);
  const stage = el("div", "pxd-read__stage", pane);
  const live = el("div", "pxd-read__live", stage);
  const pill = el("div", "pxd-read__pill", stage);
  pill.setAttribute("role", "toolbar");
  pill.setAttribute("aria-label", "Reader");
  const zoomOutBtn = pillButton(doc, el, pill, "Zoom out", "−");
  const zoomInBtn = pillButton(doc, el, pill, "Zoom in", "+");
  const fitBtn = pillButton(doc, el, pill, "Fit width", "⇔");
  const prevPageBtn = pillButton(doc, el, pill, "Previous page", "‹");
  prevPageBtn.classList.add("pxd-read__pageprev");
  const pageNode = el("span", "pxd-read__pages", pill);
  const nextPageBtn = pillButton(doc, el, pill, "Next page", "›");
  nextPageBtn.classList.add("pxd-read__pagenext");
  const searchBtn = pillButton(doc, el, pill, "Search", "⌕");
  const parsedMount = el("div", "pxd-read__parsed", pane);
  const drawerMount = el("div", "pxd-read__drawer", pane);
  // U3. Selection bar: Copy · Card · Quote · drag handle. Placed below Roam's own tip, never over it.
  const bar = el("div", "pxd-selbar", pane);
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selection");
  setHidden(bar, true);
  for (const [act, text, tip] of [["copy", "Copy", "read.sel.copy"], ["card", "Card", "read.sel.card"], ["quote", "Quote", "read.sel.quote"]]) {
    const button = el("button", "pxd-selbar__btn pxd-chrome", bar);
    button.type = "button";
    button.textContent = text;
    button.setAttribute("data-act", act);
    button.setAttribute("data-tip", tip);
  }
  const barHandle = el("button", "pxd-selbar__handle pxd-chrome", bar);
  barHandle.type = "button";
  barHandle.textContent = "⠿";
  barHandle.setAttribute("aria-label", "Drag to the board");
  barHandle.setAttribute("data-tip", "read.sel.drag");
  const textLayer = createTextLayer({ doc, readerEl: live });
  let colorSel = null;
  let pageFilt = null;
  let snipFilt = null;
  let list = null;
  let drawer = null;
  let legacyKept = null;

  let openFlag = false;
  let mountW = 0;
  let liveBlock = "";
  let watchOff = null;
  let watchTitle = "";
  let selectedUid = "";
  let catalog = [];
  const sourceByUid = new Map();
  let current = { cardUid: "", blockUid: "", title: "", pageUid: "", source: "" };
  let toolsOn = false;
  let searchHold = false;
  let searchWatch = null;
  let userZoomed = false;
  let fitDone = false;
  let settleNoted = false;
  let settleTimer = null;
  let settleGen = 0;
  let fitTimer = null;
  let fitGen = 0;
  // P32-3. Which path fitted the page and how many of Roam's zoom buttons it pressed. autoZoom keeps those
  // presses from counting as the user's own zoom.
  const fitState = { path: "none", clicks: 0 };
  let autoZoom = false;
  let readingUid = "";
  let enterFrame = 0;
  let pillFrame = 0;
  let barNode = null;
  let pageInputNode = null;
  let splitMove = null;
  let splitUp = null;

  // The drawer stores a fraction after the width ("420 0.4"). Number() of that string is NaN.
  const storedWidth = () => {
    try {
      const raw = storage?.getItem?.(readPaneKey(graph));
      const first = String(raw ?? "").trim().split(/\s+/)[0];
      const n = Number(first);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };
  const writeWidth = (px) => {
    try {
      const key = readPaneKey(graph);
      const raw = storage?.getItem?.(key);
      const text = typeof raw === "string" ? raw.trim() : "";
      const rest = text ? text.split(/\s+/).slice(1).join(" ") : "";
      storage?.setItem?.(key, rest ? `${px} ${rest}` : String(px));
    } catch { /* private mode */ }
  };
  const mountWidthNow = () => {
    const w = Number(root?.getBoundingClientRect?.()?.width) || 0;
    if (w > 0) return w;
    return mountW;
  };
  const applyBox = (override) => {
    const given = override != null ? override : storedWidth();
    const box = readPaneWidth(mountWidthNow(), given);
    root?.classList?.toggle("pxd-root--read", true);
    root?.classList?.toggle("pxd-root--read-stack", box.stacked);
    pane.classList.toggle("pxd-read--stack", box.stacked);
    if (box.stacked) {
      pane.style.width = "100%";
      pane.style.height = "46%";
    } else {
      pane.style.width = `${box.width}px`;
      pane.style.height = "";
    }
    try { root?.style?.setProperty?.("--pxd-read-w", `${box.width}px`); } catch { /* stub */ }
    return box;
  };
  const endSplit = () => {
    if (splitMove) root?.removeEventListener?.("pointermove", splitMove);
    if (splitUp) root?.removeEventListener?.("pointerup", splitUp);
    splitMove = null;
    splitUp = null;
  };
  const releaseWatch = () => {
    const off = watchOff;
    watchOff = null;
    watchTitle = "";
    try { off?.(); } catch { /* already off */ }
  };
  const armWatch = (title) => {
    const name = typeof title === "string" ? title.trim() : "";
    if (name && name === watchTitle && watchOff) return;
    releaseWatch();
    watchTitle = name;
    if (!name || typeof host?.watchPage !== "function") return;
    try { watchOff = host.watchPage(name, () => refreshList()); } catch { watchOff = null; }
  };
  const clearLive = () => {
    disarm();
    detachReaderWatch();
    try { host?.unmount?.(live); } catch { /* not mounted */ }
    live.replaceChildren?.();
    liveBlock = "";
  };
  const readerField = () => {
    const bar = live.querySelector?.(".rm-pdf-container .rm-pdf-toolbar");
    const boxed = live.querySelector?.(".rm-pdf-container");
    const pool = bar?.querySelectorAll ? [...bar.querySelectorAll("input")] : [];
    const inputs = pool.length ? pool : [...(boxed?.querySelectorAll?.("input") || [])];
    const named = inputs.find((node) => node.classList?.contains?.("bp3-input") && /^\d+$/.test(String(node.value || "").trim()));
    if (named) return named;
    return inputs.find((node) => /^\d+$/.test(String(node.value || "").trim())) || inputs[0] || null;
  };
  const jumpPage = (page) => {
    const input = readerField();
    if (!input) return false;
    const wrote = writeReaderPage(input, page);
    paintPill();
    return wrote;
  };
  // A fresh reader has no page field yet, and once it loads Roam restores the last page it showed.
  // Wait for the field, set the page, look again after that restore, and set it once more if it moved.
  // Locate runs only after that second look, so it is not undone by the restore.
  let pageWait = null;
  let pageGen = 0;
  const clock = () => doc.defaultView || globalThis;
  const later = (fn, ms) => (clock().setTimeout || globalThis.setTimeout)(fn, ms);
  const cancelLater = (id) => {
    if (id == null) return;
    (clock().clearTimeout || globalThis.clearTimeout)(id);
  };
  const cancelPageWait = () => { if (pageWait) { cancelLater(pageWait); pageWait = null; } };
  let holdImg = null;
  let holdWait = null;
  let holdGen = 0;
  const dropHold = () => {
    holdGen += 1;
    if (holdWait != null) { cancelLater(holdWait); holdWait = null; }
    try { holdImg?.remove?.(); } catch { /* gone */ }
    holdImg = null;
  };
  const pagePainted = () => {
    const nodes = live.querySelectorAll?.(".rm-pdf-container canvas, .page canvas, canvas") || [];
    for (const node of nodes) {
      const box = node.getBoundingClientRect?.();
      const w = Number(node.width) || Number(box?.width) || 0;
      if (w > 0) return true;
    }
    return false;
  };
  const paintHold = (src) => {
    dropHold();
    const url = typeof src === "string" ? src.trim() : "";
    if (!url) return;
    const img = el("img", "pxd-read__hold", stage);
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.src = url;
    holdImg = img;
    const gen = holdGen;
    const started = Date.now();
    const tick = () => {
      holdWait = null;
      if (gen !== holdGen || !openFlag) return;
      if (pagePainted()) { dropHold(); return; }
      if (Date.now() - started > 20000) return;
      holdWait = later(tick, 150);
    };
    holdWait = later(tick, 150);
  };
  const jumpPageWhenReady = (page, after) => {
    cancelPageWait();
    const gen = pageGen + 1;
    pageGen = gen;
    if (typeof page !== "number" || page < 1) return;
    const started = Date.now();
    let settled = 0;
    const finish = () => {
      if (gen !== pageGen) return;
      pageGen += 1;
      try { after?.(); } catch { /* locate */ }
    };
    const tick = () => {
      pageWait = null;
      if (gen !== pageGen || !openFlag) return;
      const input = readerField();
      const ready = input && live.querySelector?.(".rm-pdf-container .page");
      if (!ready) {
        if (Date.now() - started < 5000) pageWait = later(tick, 100);
        else finish();
        return;
      }
      if (String(input.value).trim() !== String(page)) {
        writeReaderPage(input, page);
        settled = 0;
      } else settled += 1;
      if (settled >= 2) { finish(); return; }
      if (Date.now() - started < 5000) pageWait = later(tick, 300);
      else finish();
    };
    tick();
  };
  const mountReader = (blockUid) => {
    if (!blockUid) return;
    if (liveBlock === blockUid && live.querySelector?.(".rm-pdf-container")) return;
    clearLive();
    liveBlock = blockUid;
    try { host?.renderBlock?.(live, blockUid); } catch { /* host */ }
    try { parsedView?.watchPageInput?.(readerField()); } catch { /* field */ }
    let src = "";
    try { src = typeof coverSrc === "function" ? coverSrc(current) : ""; } catch { src = ""; }
    if (typeof src === "string" && src) paintHold(src);
  };
  const cardTitle = (card) => {
    if (typeof titleOf === "function") {
      try {
        const title = titleOf(card);
        if (typeof title === "string" && title.trim()) return title.trim();
      } catch { /* host */ }
    }
    const macro = typeof card?.string === "string" ? card.string : "";
    const url = pdfMacroUrl(macro) || (typeof card?.url === "string" ? card.url : "");
    const given = typeof card?.title === "string" ? card.title : "";
    return coverModel({ title: given, url, count: card?.count }).title;
  };
  const paintSwitcher = () => {
    let pdfs = [];
    try { pdfs = typeof cards === "function" ? cards() : []; } catch { pdfs = []; }
    if (!Array.isArray(pdfs)) pdfs = [];
    switcher.replaceChildren?.();
    for (const card of pdfs) {
      if (!card || card.kind !== "pdf" || !card.uid) continue;
      const opt = el("option", "", switcher);
      opt.value = card.uid;
      opt.textContent = cardTitle(card);
    }
    switcher.value = current.cardUid || "";
    const many = switcher.querySelectorAll?.("option")?.length >= 2;
    switchBtn.classList.toggle("pxd-read__switchbtn--off", !many);
    switcher.classList.toggle("pxd-read__switch--off", !many);
  };
  const paintSelected = () => {
    const nodes = list?.querySelectorAll?.(".pxd-read__row") || [];
    for (const node of nodes) {
      const on = node.getAttribute?.("data-uid") === selectedUid;
      node.classList.toggle("pxd-read__row--on", on);
      node.setAttribute?.("aria-selected", on ? "true" : "false");
    }
  };
  const treeOf = () => {
    const pageUid = current.pageUid;
    if (!pageUid || typeof host?.pdfHighlightTree !== "function") return [];
    try {
      const tree = host.pdfHighlightTree(pageUid);
      return Array.isArray(tree) ? tree : [];
    } catch {
      return [];
    }
  };
  const catalogRows = () => {
    const tree = treeOf();
    sourceByUid.clear();
    indexNodes(tree, sourceByUid);
    let placedItems = [];
    try {
      const got = typeof placed === "function" ? placed() : [];
      placedItems = Array.isArray(got) ? got : [];
    } catch { placedItems = []; }
    let rows = [];
    try { rows = highlightRows(tree, { placed: placedItems }); } catch { rows = []; }
    catalog = sortRows(rows);
    return catalog;
  };
  // Same list the pane used to paint. U4's createReadDrawer replaces it when that module loads.
  const legacyDrawer = () => {
    const legacyBox = el("div", "pxd-read__legacy", drawerMount);
    const filters = el("div", "pxd-read__filters", legacyBox);
    const color = el("select", "pxd-read__color", filters);
    color.setAttribute("aria-label", "Colour");
    const all = el("option", "", color);
    all.value = "";
    all.textContent = "All colours";
    for (const name of COLORS) {
      const opt = el("option", "", color);
      opt.value = name;
      opt.textContent = name;
    }
    const pageField = el("input", "pxd-read__pagefilt", filters);
    pageField.setAttribute("aria-label", "Page");
    pageField.placeholder = "Page";
    const find = el("input", "pxd-read__find", filters);
    find.setAttribute("aria-label", "Snippet");
    find.placeholder = "Snippet";
    const rowsEl = el("div", "pxd-read__list", legacyBox);
    rowsEl.tabIndex = 0;
    rowsEl.setAttribute("role", "listbox");
    rowsEl.setAttribute("aria-label", "Highlights");
    let bodyOpen = false;
    const paintBody = () => drawerMount.classList.toggle("pxd-read__drawer--open", bodyOpen);
    const refresh = () => {
      const allRows = catalogRows();
      const wantColor = String(color.value || "");
      const pageText = String(pageField.value || "").trim();
      const pageWant = pageText === "" ? null : Number(pageText);
      const needle = String(find.value || "").trim().toLowerCase();
      const shown = allRows.filter((row) => {
        if (wantColor && row.color !== wantColor) return false;
        if (pageWant != null && Number.isFinite(pageWant) && row.page !== pageWant) return false;
        if (needle && !String(row.snippet || "").toLowerCase().includes(needle)) return false;
        return true;
      });
      rowsEl.replaceChildren?.();
      for (const row of shown) {
        const node = el("div", "pxd-read__row", rowsEl);
        node.setAttribute("role", "option");
        node.setAttribute("data-uid", row.uid);
        node.draggable = true;
        node.setAttribute("draggable", "true");
        const bar = el("span", "pxd-read__bar", node);
        bar.setAttribute("data-color", String(row.color || ""));
        const source = sourceByUid.get(row.uid);
        const model = source ? highlightModel({ string: source.string, props: source.props, children: source.children }) : null;
        if (model?.image && source) {
          const media = el("div", "pxd-read__media", node);
          const ratioW = model.natural?.w;
          const ratioH = model.natural?.h;
          if (typeof ratioW === "number" && typeof ratioH === "number" && ratioW > 0 && ratioH > 0) {
            media.style.aspectRatio = `${ratioW} / ${ratioH}`;
          }
          try {
            if (typeof host?.renderString === "function") host.renderString(media, source.string);
            else media.textContent = source.string;
          } catch {
            media.textContent = source.string;
          }
        } else if (row.snippet && !String(row.snippet).startsWith("![")) {
          el("div", "pxd-read__snip", node).textContent = row.snippet;
        }
        const meta = el("div", "pxd-read__meta", node);
        if (typeof row.page === "number") el("span", "pxd-read__pg", meta).textContent = `p. ${row.page}`;
        if (row.placed) el("span", "pxd-read__on", meta).textContent = "On board";
        if (typeof row.note === "string" && row.note.trim()) {
          const mark = el("span", "pxd-read__mark", meta);
          mark.textContent = "Note";
          mark.setAttribute("aria-label", "Note");
        }
        const noteBtn = el("button", "pxd-read__note pxd-chrome", meta);
        noteBtn.type = "button";
        noteBtn.textContent = "Note";
        noteBtn.setAttribute("aria-label", "Note");
        const place = el("button", "pxd-read__place pxd-chrome", meta);
        place.type = "button";
        place.textContent = "Place";
      }
    };
    return {
      refresh,
      open() { bodyOpen = true; paintBody(); },
      close() { bodyOpen = false; paintBody(); },
      toggle() { bodyOpen = !bodyOpen; paintBody(); },
      isOpen: () => bodyOpen,
      focusSearch() { try { find.focus?.(); } catch { /* stub */ } },
      setCount() {},
      element: () => drawerMount,
      dispose() {},
    };
  };
  function refreshList() {
    try { drawer?.refresh?.(); } catch { /* drawer */ }
    if (legacyKept && drawer !== legacyKept) {
      try { legacyKept.refresh(); } catch { /* list */ }
    }
    paintSelected();
    paintCount();
  }
  const moveSelection = (step) => {
    const nodes = [...(list?.querySelectorAll?.(".pxd-read__row") || [])];
    if (!nodes.length) return;
    let index = nodes.findIndex((node) => node.getAttribute?.("data-uid") === selectedUid);
    if (index < 0) index = step > 0 ? -1 : nodes.length;
    index = Math.max(0, Math.min(nodes.length - 1, index + step));
    selectedUid = nodes[index].getAttribute?.("data-uid") || "";
    paintSelected();
  };
  const showHighlight = (row) => {
    if (!row?.uid) return;
    selectedUid = row.uid;
    paintSelected();
    if (typeof row.page === "number") {
      jumpPage(row.page);
      jumpPageWhenReady(row.page, () => locateHighlight(row.uid));
      return;
    }
    locateHighlight(row.uid);
  };
  const jumpSelected = () => {
    const row = catalog.find((entry) => entry.uid === selectedUid);
    if (row) showHighlight(row);
  };
  const onPaneKey = (event) => {
    if (event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (target?.closest?.(".rm-pdf-container")) return;
    if (isTextEntryTarget(target)) return;
    if (event.key === "Escape") {
      if (escSeen === event) { escSeen = null; return; }
      event.preventDefault();
      event.stopPropagation();
      close({ notify: true });
      return;
    }
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      event.stopPropagation();
      const { page, total } = pageParts();
      if (page == null) return;
      const next = page + (event.key === "]" ? 1 : -1);
      if (next < 1) return;
      if (total != null && next > total) return;
      jumpPage(next);
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      event.stopPropagation();
      try { drawer?.focusSearch?.(); } catch { /* drawer */ }
      return;
    }
    if (event.key === "h") {
      event.preventDefault();
      event.stopPropagation();
      try { drawer?.toggle?.(); } catch { /* drawer */ }
      paintDrawerPressed();
      return;
    }
    const inList = Boolean(list) && (target === list || Boolean(list.contains?.(target)));
    if (!inList) return;
    if (target?.closest?.("button")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      jumpSelected();
    }
  };

  const rowFromEvent = (event) => {
    const node = event.target?.closest?.(".pxd-read__row");
    if (!node || !list?.contains?.(node)) return null;
    const uid = node.getAttribute?.("data-uid") || "";
    return catalog.find((entry) => entry.uid === uid) || null;
  };
  const onListClick = (event) => {
    if (event.target?.closest?.(".pxd-read__place")) {
      event.stopPropagation();
      const row = rowFromEvent(event);
      if (row) {
        try { onPlace?.(row); } catch { /* host */ }
        showHighlight(row);
      }
      return;
    }
    if (event.target?.closest?.(".pxd-read__note")) {
      event.stopPropagation();
      const row = rowFromEvent(event);
      if (row) {
        try { onNote?.(row); } catch { /* host */ }
      }
      return;
    }
    if (event.target?.closest?.("button")) return;
    const row = rowFromEvent(event);
    if (!row) return;
    event.stopPropagation();
    showHighlight(row);
  };
  const markCache = new WeakMap();
  let dragChip = null;
  let armedEl = null;
  let armedPrev = null;
  let armedUid = "";
  let armedHighlight = null;
  let armedPart = null;
  let moveFrame = 0;
  let lastMove = null;
  let dragging = false;
  let flashTimer = null;
  let flashed = [];
  const blockExists = (uid) => {
    if (typeof host?.blockString !== "function") return true;
    try { return typeof host.blockString(uid) === "string"; } catch { return false; }
  };
  // The text layer sits above the highlight layer, so the event target is a span.
  // The mark is the part on that page whose rect contains the pointer.
  const readMark = (node) => {
    if (!node) return null;
    const cached = markCache.get(node);
    if (cached) return cached;
    const found = uidFromMark(node, blockExists);
    if (!found) return null;
    markCache.set(node, found);
    return found;
  };
  const dragAttr = (node) => (node?.hasAttribute?.("draggable") ? node.getAttribute("draggable") : null);
  const restoreDrag = (node, prev) => {
    if (!node) return;
    if (prev == null) {
      try { node.removeAttribute?.("draggable"); } catch { /* stub */ }
      try { delete node.draggable; } catch { /* IDL */ }
      return;
    }
    try { node.setAttribute?.("draggable", prev); } catch { /* stub */ }
    node.draggable = prev === "true";
  };
  const disarm = () => {
    restoreDrag(armedEl, armedPrev);
    armedEl = null;
    armedPrev = null;
    armedUid = "";
    armedHighlight = null;
    armedPart = null;
    live.classList?.remove("pxd-read__live--overmark");
  };
  const armTarget = (node, found, part) => {
    if (!node || !found?.uid) { disarm(); return; }
    if (armedEl !== node) {
      restoreDrag(armedEl, armedPrev);
      armedEl = node;
      armedPrev = dragAttr(node);
    }
    armedUid = found.uid;
    armedHighlight = found.highlight || null;
    armedPart = part || null;
    node.draggable = true;
    try { node.setAttribute?.("draggable", "true"); } catch { /* stub */ }
    live.classList?.add("pxd-read__live--overmark");
  };
  const pointIn = (rect, x, y) => {
    if (!rect) return false;
    const left = Number(rect.left);
    const right = Number(rect.right);
    const top = Number(rect.top);
    const bottom = Number(rect.bottom);
    if (![left, right, top, bottom].every(Number.isFinite)) return false;
    if (right <= left || bottom <= top) return false;
    return x >= left && x <= right && y >= top && y <= bottom;
  };
  const hitMark = (page, x, y) => {
    const parts = page?.querySelectorAll?.(PDF_MARK) || [];
    let hit = null;
    for (const part of parts) {
      let rect = null;
      try { rect = part.getBoundingClientRect?.(); } catch { rect = null; }
      if (pointIn(rect, x, y)) hit = part;
    }
    return hit;
  };
  const readerContext = () => highlighterContext(live.querySelector?.(".PdfHighlighter"));
  const selectionBusy = () => {
    const ctx = readerContext();
    if (!ctx || typeof ctx.isSelectionInProgress !== "function") return false;
    try { return ctx.isSelectionInProgress() === true; } catch { return false; }
  };
  let moveScheduled = false;
  const cancelMove = () => {
    lastMove = null;
    moveScheduled = false;
    if (!moveFrame) return;
    try { (clock().cancelAnimationFrame || globalThis.cancelAnimationFrame)?.(moveFrame); } catch { /* stub */ }
    moveFrame = 0;
  };
  const applyMove = () => {
    const move = lastMove;
    lastMove = null;
    if (!move || dragging) return;
    const target = move.target;
    if (!target || !live.contains?.(target)) { disarm(); return; }
    if (selectionBusy()) { disarm(); return; }
    const page = typeof target.closest === "function" ? target.closest(".page") : null;
    if (!page || !live.contains?.(page)) { disarm(); return; }
    const part = hitMark(page, move.x, move.y);
    if (!part) { disarm(); return; }
    const found = readMark(part);
    if (!found) { disarm(); return; }
    armTarget(target, found, part);
  };
  const onPointerMove = (event) => {
    if (dragging) return;
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    lastMove = {
      target: event.target,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    };
    if (moveScheduled) return;
    moveScheduled = true;
    const raf = clock().requestAnimationFrame || globalThis.requestAnimationFrame;
    if (typeof raf !== "function") {
      moveScheduled = false;
      applyMove();
      return;
    }
    moveFrame = raf(() => {
      moveFrame = 0;
      moveScheduled = false;
      applyMove();
    });
  };
  // Roam's highlight layer calls preventDefault on mousedown, so Chrome never starts a native drag
  // from a mark. A pointer drag carries the mark instead and hands the board a drop event with the
  // same payload a list row sends. A press that does not move stays Roam's click.
  const DRAG_START_PX = 6;
  let press = null;
  const view = () => doc?.defaultView || globalThis;
  const pressOff = [];
  const pressListen = (node, type, fn) => {
    node?.addEventListener?.(type, fn, true);
    pressOff.push(() => node?.removeEventListener?.(type, fn, true));
  };
  let ghost = null;
  const endPointerDrag = () => {
    dragging = false;
    clearDragClass();
    const g = ghost;
    ghost = null;
    try { g?.cancel(); } catch { /* gone */ }
    disarm();
  };
  const endPress = () => {
    while (pressOff.length) { try { pressOff.pop()(); } catch { /* gone */ } }
    const was = press;
    press = null;
    if (was?.row) restoreDrag(was.row, was.rowPrev);
    if (was?.active) endPointerDrag();
  };
  // The drop's mousedown and mouseup land on different nodes, so the browser sends one click to their
  // common ancestor right after pointerup. Swallow only that click: the listener goes on the next task.
  let swallowOff = null;
  const swallowClick = () => {
    const w = view();
    swallowOff?.();
    const stop = (event) => { event.stopPropagation(); event.preventDefault(); swallowOff?.(); };
    const timer = w.setTimeout?.(() => swallowOff?.(), 0);
    w.addEventListener?.("click", stop, true);
    swallowOff = () => {
      swallowOff = null;
      w.removeEventListener?.("click", stop, true);
      w.clearTimeout?.(timer);
    };
  };
  const fullText = (uid, highlight) => {
    const row = catalog.find((entry) => entry.uid === uid);
    return String((row && row.snippet) || highlight?.content?.text || "");
  };
  const ghostContentOf = (p) => {
    if (p.kind === "text") return { kind: "text", text: p.text, page: p.page };
    const row = catalog.find((entry) => entry.uid === p.uid);
    const color = (row && row.color) || (typeof p.highlight?.color === "string" ? p.highlight.color : "");
    const page = typeof row?.page === "number" ? row.page : null;
    return { kind: "highlight", text: fullText(p.uid, p.highlight), color, page };
  };
  // Text lands at the ghost's top-left (a parse drop places the card's corner); a ((uid)) card is centred on
  // the drop point by the board, so it gets the ghost's centre.
  const dropPress = (p, x, y, alt) => {
    const spot = ghost && ghost.zone() === "board" ? ghost.dropPoint() : null;
    if (p.kind === "text") {
      const json = JSON.stringify({ kind: "text", text: p.text, page: p.page, pdfUid: current.cardUid || "", quote: Boolean(alt) });
      return dispatchDrop({ doc, root, pointer: { x, y }, at: spot ? { x: spot.x, y: spot.y } : { x, y }, entries: [[PARSE_MIME, json], ["text/plain", p.text]] });
    }
    const ref = `((${p.uid}))`;
    return dispatchDrop({ doc, root, pointer: { x, y }, at: spot ? { x: spot.cx, y: spot.cy } : { x, y }, entries: [[CARD_MIME, ref], ["text/plain", ref]] });
  };
  const onPressMove = (event) => {
    if (!press) return;
    // The button came up outside the window: no pointerup reached us.
    if (event.buttons === 0) { endPress(); return; }
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!press.active) {
      if (Math.hypot(x - press.x, y - press.y) < DRAG_START_PX) return;
      press.active = true;
      dragging = true;
      hideBar();
      root?.classList?.add("pxd-root--pdf-drag");
      try {
        ghost = createDragGhost({ doc, root, pane, from: press.from, pointer: { x: press.x, y: press.y }, content: ghostContentOf(press) });
      } catch { ghost = null; }
    }
    ghost?.move(x, y);
    event.preventDefault?.();
  };
  // The live selection stays until a drop lands, so a cancelled drag leaves it as it was.
  const onPressUp = (event) => {
    if (!press) return;
    const p = press;
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (p.active) {
      swallowClick();
      ghost?.move(x, y);
      if (dropPress(p, x, y, event.altKey === true)) {
        const g = ghost;
        ghost = null;
        try { g?.land(); } catch { /* gone */ }
        if (p.kind === "text") clearLiveSelection();
      }
    } else if (p.kind === "text" && !p.fromBar) {
      // A click inside the selection collapses it, as it would without us.
      clearLiveSelection();
      hideBar();
    }
    endPress();
  };
  const onPressKey = (event) => {
    if (event.key !== "Escape" || !press) return;
    event.stopPropagation();
    endPress();
  };
  const startPress = (info, event) => {
    endPress();
    press = { ...info, x: Number(event.clientX), y: Number(event.clientY), active: false };
    const w = view();
    pressListen(w, "pointermove", onPressMove);
    pressListen(w, "pointerup", onPressUp);
    pressListen(w, "pointercancel", endPress);
    pressListen(w, "keydown", onPressKey);
    pressListen(w, "blur", endPress);
  };
  const rectOf = (node) => {
    try { return node?.getBoundingClientRect?.() || null; } catch { return null; }
  };
  // Pointer over the live selection: its text and page, for a drag that starts on the selection itself.
  const selectionUnder = (x, y) => {
    const info = selectionInReader(selectionOf(), live);
    if (!info?.range) return null;
    let rects = [];
    try { rects = [...(info.range.getClientRects?.() || [])]; } catch { rects = []; }
    return rects.some((r) => pointIn(r, x, y)) ? info : null;
  };
  const onLiveDown = (event) => {
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || selectionBusy()) { disarm(); return; }
    if (event.button !== 0) return;
    if (armedUid && targetIsArmed(event.target)) {
      startPress({ kind: "mark", uid: armedUid, highlight: armedHighlight, from: rectOf(armedPart) }, event);
      return;
    }
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    const hit = Number.isFinite(x) && Number.isFinite(y) ? selectionUnder(x, y) : null;
    if (hit) {
      startPress({ kind: "text", text: hit.text, page: hit.page, from: hit.rect }, event);
      return;
    }
    hideBar();
  };
  // Mousedown inside the selection would collapse it or start the browser's own text drag.
  const onLiveMouseDown = (event) => {
    if (press?.kind === "text" && !press.active) event.preventDefault?.();
  };
  // Highlight drawer rows drag the same ghost. Shift keeps the browser's drag (drop into a Roam block).
  const onDrawerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    const row = event.target?.closest?.(".pxd-read-drawer__row");
    if (!row || !drawerMount.contains?.(row)) return;
    if (event.target?.closest?.("button, input, select, textarea, a")) return;
    const uid = row.getAttribute?.("data-uid") || "";
    if (!uid) return;
    const rowPrev = dragAttr(row);
    try { row.setAttribute?.("draggable", "false"); } catch { /* stub */ }
    row.draggable = false;
    startPress({ kind: "row", uid, highlight: null, from: rectOf(row), row, rowPrev }, event);
  };
  const onLiveLeave = () => { if (!dragging) disarm(); };
  const chipLabel = (uid, highlight) => {
    const row = catalog.find((entry) => entry.uid === uid);
    const text = (row && row.snippet) || highlight?.content?.text || "";
    const color = (row && row.color) || (typeof highlight?.color === "string" ? highlight.color : "");
    return { text: dragChipText(text), color };
  };
  const dropChip = () => {
    const node = dragChip;
    dragChip = null;
    try { node?.remove?.(); } catch { /* already gone */ }
  };
  const clearDragClass = () => { root?.classList?.remove("pxd-root--pdf-drag"); };
  const endPdfDrag = () => {
    dragging = false;
    clearDragClass();
    dropChip();
    clearLiveSelection();
    disarm();
  };
  const paintChip = (data, color, text) => {
    dropChip();
    const chip = el("div", "pxd-read__drag");
    chip.style.position = "fixed";
    chip.style.left = "-1000px";
    chip.style.top = "0";
    const bar = el("span", "pxd-read__bar", chip);
    if (color) bar.setAttribute("data-color", color);
    el("span", "pxd-read__dragtext", chip).textContent = text || "";
    pane.append(chip);
    try { data?.setDragImage?.(chip, 8, 8); } catch { /* no drag image */ }
    dragChip = chip;
  };
  // The board cancels dragstart on the root. Stopping here keeps this native drag alive.
  const beginDrag = (event, uid, color, text) => {
    const data = event.dataTransfer;
    if (!uid || !data || typeof data.setData !== "function") return;
    const payload = `((${uid}))`;
    data.setData(CARD_MIME, payload);
    try { data.setData("text/plain", payload); } catch { /* second type */ }
    try { data.effectAllowed = "copy"; } catch { /* read only */ }
    paintChip(data, color, text);
    root?.classList?.add("pxd-root--pdf-drag");
    event.stopPropagation?.();
    return true;
  };
  const onListDrag = (event) => {
    const row = rowFromEvent(event);
    if (!row?.uid) return;
    const label = chipLabel(row.uid, null);
    beginDrag(event, row.uid, row.color || label.color, dragChipText(row.snippet || label.text));
  };
  const targetIsArmed = (target) => {
    if (!armedEl || !target) return false;
    if (target === armedEl) return true;
    return Boolean(armedEl.contains?.(target));
  };
  const onMarkDrag = (event) => {
    // The ghost already owns this drag: no second, native one. A press that has not moved yet gives way.
    if (press?.active) { event.preventDefault?.(); return; }
    if (press) endPress();
    if (!armedUid || !targetIsArmed(event.target)) return;
    const label = chipLabel(armedUid, armedHighlight);
    dragging = beginDrag(event, armedUid, label.color, label.text) === true;
  };
  const selectionOf = () => {
    try {
      if (typeof doc.getSelection === "function") return doc.getSelection();
    } catch { /* stub */ }
    try {
      const view = doc.defaultView;
      if (view && typeof view.getSelection === "function") return view.getSelection();
    } catch { /* stub */ }
    return null;
  };
  const clearLiveSelection = () => {
    const sel = selectionOf();
    if (!sel || typeof sel.removeAllRanges !== "function") return;
    const node = sel.anchorNode || sel.focusNode;
    if (!node) return;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !live.contains?.(el)) return;
    try { sel.removeAllRanges(); } catch { /* stub */ }
  };
  // U3. Selection bar. It reads the selection after mouseup (and once more after Roam's tip settles),
  // places itself below the selection and below Roam's tip, and hides on Esc, scroll, a new press or close.
  let barInfo = null;
  let barTimers = [];
  const barOff = [];
  const cancelBarTimers = () => {
    for (const id of barTimers) cancelLater(id);
    barTimers = [];
  };
  const disarmBarKeys = () => {
    while (barOff.length) { try { barOff.pop()(); } catch { /* gone */ } }
  };
  const onBarKey = (event) => {
    if (event.key !== "Escape" || !barInfo) return;
    escSeen = event;
    hideBar();
  };
  let escSeen = null;
  const armBarKeys = () => {
    if (barOff.length) return;
    const w = view();
    w.addEventListener?.("keydown", onBarKey, true);
    barOff.push(() => w.removeEventListener?.("keydown", onBarKey, true));
  };
  function hideBar() {
    cancelBarTimers();
    disarmBarKeys();
    barInfo = null;
    setHidden(bar, true);
  }
  const tipRect = () => {
    const tip = live.querySelector?.(".PdfHighlighter__tip-container");
    const r = rectOf(tip);
    return r && r.right > r.left && r.bottom > r.top ? r : null;
  };
  const placeBar = () => {
    if (!openFlag || dragging) return;
    const info = selectionInReader(selectionOf(), live);
    if (!info || !info.rect) { hideBar(); return; }
    barInfo = info;
    armBarKeys();
    setHidden(bar, false);
    const paneBox = rectOf(pane);
    const usePane = paneBox && paneBox.right > paneBox.left && paneBox.bottom > paneBox.top;
    const viewport = usePane ? paneBox : rectOf(root);
    if (!viewport) return;
    const size = { w: Number(bar.offsetWidth) || 200, h: Number(bar.offsetHeight) || 30 };
    let obstacles = [];
    try { obstacles = chromeObstacles(root); } catch { obstacles = []; }
    const at = selectionBarPlacement({ selection: info.rect, tip: tipRect(), size, viewport, obstacles, place: placePopover });
    if (at.hidden) { setHidden(bar, true); return; }
    const originX = usePane ? paneBox.left : 0;
    const originY = usePane ? paneBox.top : 0;
    bar.style.left = `${Math.round(at.left - originX)}px`;
    bar.style.top = `${Math.round(at.top - originY)}px`;
  };
  const onLiveMouseUp = () => {
    if (dragging || press?.active) return;
    cancelBarTimers();
    barTimers.push(later(placeBar, 0), later(placeBar, BAR_SETTLE_MS));
  };
  const writeClip = async (text) => {
    const clip = doc.defaultView?.navigator?.clipboard || globalThis.navigator?.clipboard;
    if (!clip || typeof clip.writeText !== "function") throw new Error("no clipboard");
    await clip.writeText(text);
  };
  const toast = (message) => { try { host?.toast?.(message); } catch { /* host */ } };
  const onSelBarClick = (event) => {
    const act = event.target?.closest?.("[data-act]")?.getAttribute?.("data-act");
    if (!act || !barInfo) return;
    event.stopPropagation?.();
    const { text, page } = barInfo;
    if (act === "copy") {
      void writeClip(text).then(() => toast("Copied"), () => toast("Copy failed"));
      return;
    }
    hideBar();
    const fn = session?.insertTextCard;
    if (typeof fn !== "function") return;
    try {
      void Promise.resolve(fn({ text, page, pdfUid: current.cardUid || "", quote: act === "quote" })).catch(() => {});
    } catch { /* host */ }
  };
  // Buttons on the bar must not take the selection away.
  const onSelBarMouseDown = (event) => { event.preventDefault?.(); };
  const onBarHandleDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (!barInfo) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    startPress({ kind: "text", text: barInfo.text, page: barInfo.page, from: barInfo.rect, fromBar: true }, event);
  };
  const clearFlash = () => {
    if (flashTimer) { cancelLater(flashTimer); flashTimer = null; }
    for (const part of flashed) {
      part.classList?.remove("pxd-read__mark-flash");
      try { part.style?.removeProperty?.("--pxd-mark-flash"); } catch { /* stub */ }
    }
    flashed = [];
  };
  const flashColor = (color) => {
    const name = typeof color === "string" ? color : "";
    if (COLORS.includes(name)) return `var(--pxd-${name}-line, var(--pxd-yellow-line, #ca8a04))`;
    if (/^#[0-9a-fA-F]{3,8}$/.test(name)) return name;
    return "var(--pxd-yellow-line, #ca8a04)";
  };
  const flashParts = (parts, color) => {
    clearFlash();
    const paint = flashColor(color);
    flashed = parts.filter(Boolean);
    for (const part of flashed) {
      try { part.style?.setProperty?.("--pxd-mark-flash", paint); } catch { /* stub */ }
      part.classList?.add("pxd-read__mark-flash");
    }
    if (!flashed.length) return;
    flashTimer = later(() => { flashTimer = null; clearFlash(); }, FLASH_MS);
  };
  const fallbackScroll = (part) => {
    const scroller = live.querySelector?.(".PdfHighlighter");
    if (!scroller || !part) return;
    let mark = null;
    let view = null;
    try { mark = part.getBoundingClientRect?.(); } catch { mark = null; }
    try { view = scroller.getBoundingClientRect?.(); } catch { view = null; }
    if (!mark || !view) return;
    const current = Number(scroller.scrollTop);
    const top = Number.isFinite(current) ? current : 0;
    const height = Number(view.height) || 0;
    const next = top + (Number(mark.top) - Number(view.top)) - height * 0.3;
    scroller.scrollTop = Math.max(0, next);
  };
  const partsFor = (uid) => {
    const nodes = live.querySelectorAll?.(PDF_MARK) || [];
    const parts = [];
    let highlight = null;
    for (const node of nodes) {
      const found = readMark(node);
      if (found?.uid !== uid) continue;
      parts.push(node);
      if (!highlight && found.highlight) highlight = found.highlight;
    }
    return { parts, highlight };
  };
  const locateHighlight = (uid) => {
    if (!openFlag || typeof uid !== "string" || uid === "") return;
    const { parts, highlight: fromMark } = partsFor(uid);
    const highlight = fromMark || highlightById(fiberOf(live.querySelector?.(".PdfHighlighter")), uid);
    if (!highlight && !parts.length) return;
    let scrolled = false;
    const ctx = readerContext();
    if (highlight && ctx && typeof ctx.scrollToHighlight === "function") {
      try { ctx.scrollToHighlight(highlight); scrolled = true; } catch { scrolled = false; }
    }
    if (!scrolled) fallbackScroll(parts[0]);
    const row = catalog.find((entry) => entry.uid === uid);
    flashParts(parts, highlight?.color || row?.color || "");
  };
  const highlightUidOf = (detail) => {
    if (typeof detail.highlightUid === "string" && detail.highlightUid) return detail.highlightUid;
    if (typeof detail.uid === "string" && detail.uid && detail.uid !== detail.blockUid && detail.uid !== detail.cardUid) {
      return detail.uid;
    }
    return "";
  };
  const onWheel = (event) => { event.stopPropagation(); };
  const onPointer = (event) => { event.stopPropagation(); };
  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearDragClass();
  };
  const onColor = () => refreshList();
  const onPageFilt = () => refreshList();
  const onFind = () => refreshList();
  const onSwitchChange = () => {
    const uid = String(switcher.value || "");
    if (!uid || uid === current.cardUid) return;
    const rule = readerRule(current.cardUid, uid);
    if (!rule.open || rule.open === current.cardUid) return;
    clearLive();
    try { onSwitch?.(rule.open); } catch { /* host */ }
  };
  const onCloseClick = (event) => {
    event.stopPropagation();
    close({ notify: true });
  };
  const paintCount = () => {
    const n = catalog.length;
    if (!n) {
      countNode.textContent = "";
      countNode.hidden = true;
    } else {
      countNode.hidden = false;
      countNode.textContent = String(n);
    }
    try { drawer?.setCount?.(n); } catch { /* drawer */ }
  };
  const paintDrawerPressed = () => {
    const on = drawer?.isOpen?.() === true;
    hlBtn.setAttribute("aria-pressed", on ? "true" : "false");
  };
  const paintTools = () => {
    pane.classList.toggle("pxd-read--tools", toolsOn || searchHold);
  };
  // The "/ 9" span sits beside the page field. Roam wraps that field, so the span
  // is often the wrap's sibling, or just another short span in the toolbar.
  const totalCandidates = (input) => {
    const bar = input?.closest?.(".rm-pdf-toolbar") || live.querySelector?.(".rm-pdf-container .rm-pdf-toolbar");
    const out = [];
    const push = (node) => {
      if (!node || node === input) return;
      out.push(node.textContent);
    };
    push(input?.nextElementSibling);
    push(input?.previousElementSibling);
    const parent = input?.parentElement;
    if (parent && parent !== bar) {
      push(parent.nextElementSibling);
      push(parent.previousElementSibling);
    }
    const spans = bar?.querySelectorAll?.("span") || [];
    for (const span of spans) push(span);
    return out;
  };
  const pageParts = () => {
    const input = readerField();
    return { input, ...pageIndicator(input?.value, pageTotalText(totalCandidates(input))) };
  };
  const paintPill = () => {
    const { page, total } = pageParts();
    const narrowBoth = pane.classList.contains("pxd-read--both") && pane.classList.contains("pxd-read--narrow");
    if (page == null) pageNode.textContent = "";
    else if (narrowBoth && total != null) pageNode.textContent = `page ${page} / ${total}`;
    else if (narrowBoth) pageNode.textContent = `page ${page}`;
    else if (total == null) pageNode.textContent = String(page);
    else pageNode.textContent = `${page} / ${total}`;
  };
  const stepPage = (delta) => {
    const { page, total } = pageParts();
    if (page == null) return;
    const next = page + delta;
    if (next < 1) return;
    if (total != null && next > total) return;
    jumpPage(next);
  };
  const toolbarEl = () => live.querySelector?.(".rm-pdf-container .rm-pdf-toolbar");
  const toolbarButtons = () => {
    const bar = toolbarEl();
    if (!bar?.querySelectorAll) return [];
    return [...bar.querySelectorAll("button")];
  };
  const searchInput = () => {
    const box = live.querySelector?.(".rm-pdf-container");
    const inputs = [...(box?.querySelectorAll?.("input") || [])];
    const page = readerField();
    return inputs.find((node) => node !== page) || null;
  };
  const dropSearchWatch = () => {
    if (!searchWatch) return;
    searchWatch.node.removeEventListener?.("focusout", searchWatch.fn);
    searchWatch.node.removeEventListener?.("blur", searchWatch.fn);
    searchWatch = null;
  };
  const holdSearch = () => {
    dropSearchWatch();
    const input = searchInput();
    if (!input) return;
    searchHold = true;
    paintTools();
    const fn = () => {
      searchHold = false;
      paintTools();
      dropSearchWatch();
    };
    input.addEventListener?.("focusout", fn);
    input.addEventListener?.("blur", fn);
    searchWatch = { node: input, fn };
    try { input.focus?.(); } catch { /* stub */ }
  };
  const proxyPill = (name) => {
    if (name === "zoomIn" || name === "zoomOut") userZoomed = true;
    if (name === "fit") fitDone = true;
    const button = pillActions(toolbarButtons())[name];
    if (button && typeof button.click === "function") {
      try { button.click(); } catch { /* roam */ }
    }
    if (name === "search") holdSearch();
  };
  const emitSnapshot = (as) => {
    if (typeof onSnapshot !== "function") return;
    const parts = pageParts();
    const source = current.source || "";
    try {
      onSnapshot(live, {
        as,
        page: parts.page,
        pageCount: parts.total,
        url: pdfMacroUrl(source) || source,
        blockUid: current.blockUid || "",
        cardUid: current.cardUid || "",
      });
    } catch { /* host */ }
  };
  const emitReading = (uid) => {
    const next = typeof uid === "string" ? uid : "";
    if (next === readingUid) return;
    readingUid = next;
    try { onReadingChange?.(next); } catch { /* host */ }
  };
  const armed = [];
  const forget = (node, type, fn) => {
    if (!node) return;
    try { node.removeEventListener?.(type, fn); } catch { /* stub */ }
    const idx = armed.findIndex((entry) => entry[0] === node && entry[1] === type && entry[2] === fn);
    if (idx >= 0) armed.splice(idx, 1);
  };
  const listen = (node, type, fn, capture = false) => {
    if (!node || typeof node.addEventListener !== "function") return;
    node.addEventListener(type, fn, capture);
    armed.push([node, type, fn, capture]);
  };
  const onReaderScroll = () => {
    if (barInfo) hideBar();
    const raf = clock().requestAnimationFrame;
    if (typeof raf !== "function") { paintPill(); return; }
    if (pillFrame) return;
    pillFrame = raf(() => {
      pillFrame = 0;
      paintPill();
    });
  };
  const onBarClick = (event) => {
    if (autoZoom) return;
    const button = event.target?.closest?.("button");
    if (!button) return;
    const found = pillActions([button]);
    if (found.zoomIn === button || found.zoomOut === button) userZoomed = true;
  };
  const detachReaderWatch = () => {
    forget(barNode, "click", onBarClick);
    forget(pageInputNode, "input", paintPill);
    barNode = null;
    pageInputNode = null;
    if (pillFrame) {
      try { (clock().cancelAnimationFrame || globalThis.cancelAnimationFrame)?.(pillFrame); } catch { /* stub */ }
      pillFrame = 0;
    }
  };
  const attachReaderWatch = () => {
    const bar = toolbarEl();
    if (bar && bar !== barNode) {
      forget(barNode, "click", onBarClick);
      barNode = bar;
      listen(bar, "click", onSelBarClick);
    }
    const input = readerField();
    if (input && input !== pageInputNode) {
      forget(pageInputNode, "input", paintPill);
      pageInputNode = input;
      listen(input, "input", paintPill);
    }
  };
  const cancelSettle = () => {
    if (settleTimer) { cancelLater(settleTimer); settleTimer = null; }
    settleGen += 1;
  };
  const noteSettled = () => {
    if (settleNoted || !openFlag) return;
    if (!live.querySelector?.(".rm-pdf-container .page")) return;
    settleNoted = true;
    paintPill();
    attachReaderWatch();
    emitSnapshot("settle");
  };
  const cancelFit = () => {
    if (fitTimer) { cancelLater(fitTimer); fitTimer = null; }
    fitGen += 1;
  };
  // pdf.js inserts .page before it paints. Fit once the first canvas has width,
  // and give up after 3s. A zoom in this pane session cancels it.
  const paintedCanvas = () => {
    const nodes = live.querySelectorAll?.(".page canvas") || [];
    for (const node of nodes) {
      const backing = Number(node?.width);
      if (Number.isFinite(backing) && backing > 0) return true;
      let laid = 0;
      try { laid = Number(node?.getBoundingClientRect?.()?.width) || 0; } catch { laid = 0; }
      if (laid > 0) return true;
    }
    return false;
  };
  // P32-3. Geometry of the first painted page against the scroller that holds it.
  const fitGeom = () => {
    const scroller = live.querySelector?.(".PdfHighlighter") || live.querySelector?.(".rm-pdf-viewer-container");
    const page = live.querySelector?.(".page");
    if (!scroller || !page) return null;
    let pageW = 0;
    let viewW = 0;
    try { pageW = Number(page.getBoundingClientRect?.()?.width) || 0; } catch { pageW = 0; }
    if (!(pageW > 0)) pageW = parseFloat(page.style?.width) || 0;
    try { viewW = Number(scroller.clientWidth) || Number(scroller.getBoundingClientRect?.()?.width) || 0; } catch { viewW = 0; }
    if (!(pageW > 0) || !(viewW > 0)) return null;
    return { pageW, viewW };
  };
  const pressZoom = (name) => {
    const button = pillActions(toolbarButtons())[name];
    if (!button || typeof button.click !== "function") return false;
    autoZoom = true;
    try { button.click(); } catch { /* roam */ }
    autoZoom = false;
    return true;
  };
  // Fallback: step Roam's own zoom buttons until the page fills the scroller. Each press re-renders, so the
  // next decision waits for the page width to change (at most 1.5 s), then stops on the model's word.
  const runFitSteps = (gen) => {
    fitState.path = fitState.path === "viewer" ? "viewer+steps" : "steps";
    let last = 0;
    let prev = "";
    const step = () => {
      fitTimer = null;
      if (gen !== fitGen || !openFlag || userZoomed) { fitDone = true; return; }
      const g = fitGeom();
      if (!g) { fitDone = true; return; }
      const action = fitWidthStep({ pageWidth: g.pageW, viewerWidth: g.viewW, lastPageWidth: last, clicks: fitState.clicks, prev });
      if (action !== "in" && action !== "out") { fitDone = true; return; }
      if (!pressZoom(action === "in" ? "zoomIn" : "zoomOut")) { fitDone = true; return; }
      last = g.pageW;
      prev = action;
      fitState.clicks += 1;
      const started = Date.now();
      const wait = () => {
        fitTimer = null;
        if (gen !== fitGen || !openFlag) return;
        const n = fitGeom();
        if (n && n.pageW !== last) { step(); return; }
        if (Date.now() - started < 1500) fitTimer = later(wait, 100);
        else fitDone = true;
      };
      fitTimer = later(wait, 100);
    };
    step();
  };
  // pdf.js inserts .page before it paints. Fit once the first canvas has width, and give up after 3s.
  // A zoom in this pane session cancels it. Page width first through the viewer; Roam's buttons otherwise.
  const armFit = () => {
    cancelFit();
    if (fitDone || userZoomed || !openFlag) return;
    const gen = fitGen;
    const started = Date.now();
    const tick = () => {
      fitTimer = null;
      if (gen !== fitGen || !openFlag || fitDone) return;
      attachReaderWatch();
      if (userZoomed) { fitDone = true; return; }
      if (!paintedCanvas()) {
        if (Date.now() - started < 3000) fitTimer = later(tick, 100);
        return;
      }
      const hasButtons = Boolean(pillActions(toolbarButtons()).zoomIn);
      const viewer = viewerFromFiber(fiberOf(live.querySelector?.(".PdfHighlighter")));
      if (!fitDecision({ userZoomed, hasFit: Boolean(viewer) || hasButtons, settled: true })) {
        fitDone = true;
        return;
      }
      fitDone = true;
      if (viewer) {
        fitState.path = "viewer";
        let set = false;
        autoZoom = true;
        try { viewer.currentScaleValue = "page-width"; set = true; } catch { set = false; }
        autoZoom = false;
        if (set) {
          // Verify after the re-render; a viewer that ignored the value falls back to the buttons.
          fitTimer = later(() => {
            fitTimer = null;
            if (gen !== fitGen || !openFlag || userZoomed) return;
            const g = fitGeom();
            if (g && fitsWidth({ pageWidth: g.pageW, viewerWidth: g.viewW })) return;
            if (hasButtons) runFitSteps(gen);
          }, 600);
          return;
        }
      }
      if (hasButtons) runFitSteps(gen);
      else fitState.path = "none";
    };
    tick();
  };
  const armSettle = () => {
    cancelSettle();
    const gen = settleGen;
    const started = Date.now();
    const tick = () => {
      settleTimer = null;
      if (gen !== settleGen || !openFlag) return;
      if (live.querySelector?.(".rm-pdf-container .page")) {
        noteSettled();
        return;
      }
      if (Date.now() - started < 5000) settleTimer = later(tick, 100);
    };
    tick();
  };
  const ensureMotion = () => {
    if (!root?.classList) return;
    const level = root.dataset?.motion;
    if (level === "full" || level === "reduced" || level === "none") return;
    try { applyMotionClasses(root, "full"); } catch { /* stub */ }
  };
  const dropEnter = () => {
    if (enterFrame) {
      try { (clock().cancelAnimationFrame || globalThis.cancelAnimationFrame)?.(enterFrame); } catch { /* stub */ }
      enterFrame = 0;
    }
    pane.classList.remove("pxd-read--enter");
  };
  const startEnter = () => {
    pane.classList.add("pxd-read--enter");
    if (root?.classList?.contains?.("pxd-root--motion-off") || root?.dataset?.motion === "none") {
      pane.classList.remove("pxd-read--enter");
      return;
    }
    const raf = clock().requestAnimationFrame;
    if (typeof raf !== "function") {
      pane.classList.remove("pxd-read--enter");
      return;
    }
    enterFrame = raf(() => {
      enterFrame = 0;
      pane.classList.remove("pxd-read--enter");
    });
  };
  const drawerHooks = {
    doc,
    mount: drawerMount,
    host,
    rows: catalogRows,
    placed,
    onLocate(row) { showHighlight(row); },
    onPlace(row) {
      try { onPlace?.(row); } catch { /* host */ }
      showHighlight(row);
    },
    onNote(row) {
      try { onNote?.(row); } catch { /* host */ }
    },
    onHover(uid, on) {
      try { onHover?.(uid, on); } catch { /* host */ }
    },
    storage,
    key: readPaneKey(graph),
  };
  // Header, then the reader, then the 32px strip. The open drawer sets its own
  // height (a fraction of the pane) and that height has to win over the legacy
  // 42% flex basis, which ignores an inline height.
  const useDrawerLayout = () => {
    pane.classList.add("pxd-read--drawer");
    if (stage?.style) {
      stage.style.flex = "1 1 auto";
      stage.style.minHeight = "0";
    }
    if (live?.style) live.style.minHeight = "0";
    if (drawerMount?.style) {
      drawerMount.style.flex = "0 0 auto";
      // An inline min-height of 0 beats the parsed/both rule and lets the
      // closed 32px strip shrink inside the grid. Leave the floor to CSS.
      drawerMount.style.minHeight = "";
    }
  };
  const concealLegacy = () => {
    const box = drawerMount.querySelector?.(".pxd-read__legacy");
    if (box) {
      box.hidden = true;
      box.setAttribute?.("hidden", "");
      if (box.style) box.style.display = "none";
    }
    useDrawerLayout();
  };
  // U4 is the visible drawer. The old filters and rows stay in the DOM for the
  // row tests, inside a box that takes no height once the drawer is mounted.
  const makeDrawer = () => {
    if (typeof createDrawer === "function") {
      try {
        const made = createDrawer(drawerHooks);
        if (made && typeof made.refresh === "function") {
          useDrawerLayout();
          return made;
        }
      } catch { /* test stub */ }
    }
    const legacy = legacyDrawer();
    legacyKept = legacy;
    if (typeof liveDrawer !== "function") return legacy;
    try {
      const made = liveDrawer(drawerHooks);
      if (made && typeof made.refresh === "function") {
        concealLegacy();
        return made;
      }
    } catch { /* U4 */ }
    return legacy;
  };
  drawer = makeDrawer();
  list = drawerMount.querySelector?.(".pxd-read__list") || null;
  colorSel = drawerMount.querySelector?.(".pxd-read__color") || null;
  pageFilt = drawerMount.querySelector?.(".pxd-read__pagefilt") || null;
  snipFilt = drawerMount.querySelector?.(".pxd-read__find") || null;
  const onHighlights = (event) => {
    event.stopPropagation();
    try { drawer?.toggle?.(); } catch { /* drawer */ }
    paintDrawerPressed();
  };
  const onTools = (event) => {
    event.stopPropagation();
    toolsOn = !toolsOn;
    toolsBtn.setAttribute("aria-pressed", toolsOn ? "true" : "false");
    paintTools();
  };
  const onSwitchBtn = (event) => {
    event.stopPropagation();
    if (switchBtn.classList.contains("pxd-read__switchbtn--off")) return;
    try {
      if (typeof switcher.showPicker === "function") {
        switcher.showPicker();
        return;
      }
    } catch { /* unsupported */ }
    try { switcher.focus?.(); } catch { /* stub */ }
  };
  listen(pane, "keydown", onPaneKey);
  listen(pane, "wheel", onWheel);
  listen(pane, "pointerdown", onPointer);
  listen(pane, "dragover", onDragOver);
  listen(pane, "drop", onDrop);
  listen(pane, "dragend", endPdfDrag);
  listen(live, "scroll", onReaderScroll, true);
  listen(live, "pointermove", onPointerMove, { capture: true, passive: true });
  listen(live, "pointerleave", onLiveLeave);
  listen(live, "pointerdown", onLiveDown);
  listen(live, "mousedown", onLiveMouseDown, true);
  listen(live, "mouseup", onLiveMouseUp);
  listen(drawerMount, "pointerdown", onDrawerDown, true);
  listen(bar, "click", onSelBarClick);
  listen(bar, "mousedown", onSelBarMouseDown);
  listen(barHandle, "pointerdown", onBarHandleDown);
  listen(live, "dragstart", onMarkDrag);
  if (root) listen(root, "drop", clearDragClass);
  listen(list, "click", onListClick);
  listen(list, "dragstart", onListDrag);
  listen(colorSel, "change", onColor);
  listen(pageFilt, "input", onPageFilt);
  listen(snipFilt, "input", onFind);
  listen(switcher, "change", onSwitchChange);
  listen(switchBtn, "click", onSwitchBtn);
  listen(hlBtn, "click", onHighlights);
  listen(toolsBtn, "click", onTools);
  listen(zoomOutBtn, "click", (event) => { event.stopPropagation(); proxyPill("zoomOut"); });
  listen(zoomInBtn, "click", (event) => { event.stopPropagation(); proxyPill("zoomIn"); });
  listen(fitBtn, "click", (event) => { event.stopPropagation(); proxyPill("fit"); });
  listen(prevPageBtn, "click", (event) => { event.stopPropagation(); stepPage(-1); });
  listen(nextPageBtn, "click", (event) => { event.stopPropagation(); stepPage(1); });
  listen(searchBtn, "click", (event) => { event.stopPropagation(); proxyPill("search"); });
  listen(closeBtn, "click", onCloseClick);
  listen(split, "pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    event.stopPropagation();
    const box = readPaneWidth(mountWidthNow(), storedWidth());
    if (box.stacked) return;
    const startX = Number(event.clientX) || 0;
    const startW = box.width;
    endSplit();
    splitMove = (ev) => {
      ev.stopPropagation?.();
      const dx = startX - (Number(ev.clientX) || 0);
      applyBox(startW + dx);
    };
    splitUp = (ev) => {
      ev.stopPropagation?.();
      const width = applyBox(startW + (startX - (Number(ev.clientX) || 0))).width;
      endSplit();
      writeWidth(width);
      // P32-3: a new pane width is a new reading width, unless the zoom is the user's own.
      if (openFlag && !userZoomed) {
        fitDone = false;
        fitState.clicks = 0;
        armFit();
      }
    };
    root?.addEventListener?.("pointermove", splitMove);
    root?.addEventListener?.("pointerup", splitUp);
  });

  let parsedView = null;
  let parseStore = null;
  let parseHelper = null;
  let viewMode = "reader";
  let explicitMode = false;
  const ensureStore = () => {
    if (!parseStore) parseStore = createParseStore({ indexedDB: doc.defaultView?.indexedDB });
    return parseStore;
  };
  const ensureHelper = () => {
    if (!parseHelper) parseHelper = createHelperClient({ settings, fetch: doc.defaultView?.fetch });
    return parseHelper;
  };
  const pdfUrl = () => pdfMacroUrl(current.source || "") || "";
  // Header title: the real name when there is one, else the parsed document's title, else "PDF".
  let parsedTitle = "";
  const realTitle = (value) => (typeof value === "string" && value.trim() && value.trim() !== "PDF" ? value.trim() : "");
  const shownTitle = () => realTitle(current.title) || parsedTitle || "PDF";
  const paintTitle = () => {
    const text = shownTitle();
    titleNode.textContent = text;
    const options = switcher.querySelectorAll?.("option") || [];
    for (const opt of options) if (opt.value === current.cardUid) opt.textContent = text;
  };
  const noteParsedTitle = (value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text === parsedTitle) return;
    parsedTitle = text;
    if (openFlag) paintTitle();
    if (text) { try { onParsedTitle?.(pdfUrl(), text); } catch { /* host */ } }
  };
  const readerPdf = () => {
    try {
      const fiber = fiberOf(live.querySelector?.(".PdfHighlighter"));
      return viewerFromFiber(fiber)?.pdfDocument || pdfDocumentFromFiber(fiber);
    } catch { return null; }
  };
  const getPdf = async () => readerPdf();
  const pageElement = (n) => {
    const pages = live.querySelectorAll?.(".page") || [];
    for (const node of pages) {
      if (Number(node.getAttribute?.("data-page-number")) === Number(n)) return node;
    }
    return null;
  };
  const revealModes = () => {
    setHidden(modes, false);
    pane.classList.add("pxd-read--modes");
  };
  function applyModeClass() {
    pane.classList.remove("pxd-read--parsed", "pxd-read--both", "pxd-read--narrow");
    const width = Number(pane.clientWidth) || Number(mountW) || 0;
    if (viewMode === "both") {
      pane.classList.add("pxd-read--both");
      if (width > 0 && width < BOTH_MIN_PX) pane.classList.add("pxd-read--narrow");
    }
    for (const [id, button] of Object.entries(modeBtns)) {
      button.setAttribute("aria-pressed", id === viewMode ? "true" : "false");
    }
    setHidden(pill, pane.classList.contains("pxd-read--narrow"));
    paintPill();
  }
  // U2. Text layer pages: from the outline's Read text, the helper, or any other OCR source (pxd-ocr/1
  // page records or built-in geometry records). Stored per PDF on this device, never in the graph.
  let ocrSha = "";
  const persistOcr = async (pages, sha) => {
    if (!sha) return;
    const store = ensureStore();
    const key = imageKey(sha, OCR_LAYER_ID);
    let stored = [];
    try {
      const raw = await store.getImage(key);
      stored = typeof raw === "string" ? JSON.parse(raw) : [];
    } catch { stored = []; }
    try { await store.putImage(key, JSON.stringify(mergeOcrPages(stored, pages))); } catch { /* cache */ }
  };
  const setOcrPages = (input, { sha256 = "", persist = true } = {}) => {
    const pages = pageRecords(input);
    const n = textLayer.setPages(pages);
    const sha = sha256 || ocrSha;
    if (n && persist && sha) void persistOcr(pages, sha);
    return n;
  };
  const loadOcrLayer = async (sha) => {
    if (!sha) return 0;
    ocrSha = sha;
    try {
      const raw = await ensureStore().getImage(imageKey(sha, OCR_LAYER_ID));
      if (typeof raw !== "string" || !openFlag || sha !== ocrSha) return 0;
      return textLayer.setPages(JSON.parse(raw));
    } catch { return 0; }
  };
  // No dead end: a scanned page with nothing to read offers Read text. The host can take over (the status
  // strip, the in-browser source); otherwise the local helper reads it when it is ready.
  const needOcr = (info) => {
    if (typeof onNeedOcr === "function") {
      try { onNeedOcr({ ...(info || {}), url: pdfUrl(), cardUid: current.cardUid || "", setOcrPages }); } catch { /* host */ }
      return;
    }
    void (async () => {
      try { await parsedView?.refreshHelper?.(); } catch { /* helper */ }
      if (info?.helperState === "ready" || (await helperReady())) {
        try { await info?.readScan?.(); } catch { /* scan */ }
        return;
      }
      try { host?.toast?.("Scanned page: start the local helper to read its text (Settings → Parse)"); } catch { /* host */ }
    })();
  };
  const helperReady = async () => {
    try { return (await ensureHelper().health())?.state === "ready"; } catch { return false; }
  };
  const ensureParsed = () => {
    if (parsedView) return parsedView;
    parsedView = createParseView({
      doc,
      store: ensureStore(),
      helper: ensureHelper(),
      session,
      host,
      storage,
      pdfUid: current.cardUid,
      url: pdfUrl(),
      getPdf,
      jumpPage,
      pageNow: () => Number(String(readerField()?.value || "").trim()) || 1,
      pageEl: pageElement,
      readerEl: live,
      onToast: (message) => { try { host?.toast?.(message); } catch { /* host */ } },
      onCached: () => revealModes(),
      onTitle: noteParsedTitle,
      onProgress: (info) => {
        const running = info && info.fraction != null && info.fraction < 1;
        setHidden(progress, !running);
        progressFill.style.width = `${Math.round((Number(info?.fraction) || 0) * 100)}%`;
      },
      adoptCreated: () => { try { refreshList(); } catch { /* list */ } },
      getContext: () => readerContext(),
      outline: true,
      onNeedOcr: (info) => needOcr(info),
      onOcrPages: (pages, sha) => { setOcrPages(pages, { sha256: sha || "" }); },
      ghostRoot: root,
      ghostPane: pane,
      scanAuto: (() => { try { return (settings?.get?.("parse-engine-default") || "auto") === "auto"; } catch { return false; } })(),
    });
    parsedMount.append(parsedView.element());
    try { parsedView.watchPageInput(readerField()); } catch { /* field */ }
    return parsedView;
  };
  function dropParsed() {
    try { parsedView?.dispose?.(); } catch { /* gone */ }
    parsedView = null;
    parsedTitle = "";
    viewMode = "reader";
    setHidden(modes, true);
    setHidden(progress, true);
    pane.classList.remove("pxd-read--modes", "pxd-read--parsed", "pxd-read--both", "pxd-read--narrow");
    setHidden(pill, false);
    for (const [id, button] of Object.entries(modeBtns)) {
      button.setAttribute("aria-pressed", id === "reader" ? "true" : "false");
    }
  }
  async function noteCached() {
    const url = pdfUrl();
    if (!url || !openFlag) return;
    const known = readParsedUrls(storage).has(url);
    if (known) revealModes();
    if (known && viewMode === "reader" && !explicitMode && storedReadMode(storage) === "both") void enterParsed("both");
    try {
      const hit = await ensureStore().findByUrl(url);
      if (hit?.sha256 && openFlag && url === pdfUrl()) void loadOcrLayer(hit.sha256);
      if (hit?.sha256 && openFlag) revealModes();
      if (hit?.sha256 && openFlag && !realTitle(current.title) && !parsedTitle) {
        const hash = await optionsHash(BUILTIN_OPTIONS);
        for (const engine of ["builtin", "docling", "mixed"]) {
          const found = await ensureStore().getParse(hit.sha256, engine, hash);
          if (found) {
            if (openFlag && url === pdfUrl()) noteParsedTitle(parsedDocTitle(found));
            break;
          }
        }
      }
    } catch { /* store */ }
  }
  async function enterParsed() {
    if (!openFlag) return;
    revealModes();
    viewMode = "both";
    applyModeClass();
    try { drawer?.close?.(); } catch { /* drawer */ }
    if (viewMode === "both" && pane.classList.contains("pxd-read--narrow") && !live.querySelector?.(".rm-pdf-container")) {
      settleNoted = false;
      mountReader(current.blockUid);
      armSettle();
    }
    const view = ensureParsed();
    view.setTarget({ url: pdfUrl(), pdfUid: current.cardUid });
    try { view.watchPageInput(readerField()); } catch { /* field */ }
    let found = null;
    try { found = await view.restore(); } catch { found = null; }
    if (!openFlag) return;
    if (!found && view.blockCount() === 0) {
      try { await view.parseBuiltin(); } catch { /* parse */ }
    }
  }
  listen(modes, "click", (event) => {
    const id = event.target?.closest?.("[data-mode]")?.getAttribute?.("data-mode");
    if (!id) return;
    writeReadMode(storage, id);
    if (normalizeReadMode(id) === "reader") {
      viewMode = "reader";
      revealModes();
      applyModeClass();
      return;
    }
    void enterParsed("both");
  });

  function close(opts) {
    cancelPageWait();
    cancelSettle();
    cancelFit();
    cancelMove();
    dropHold();
    clearFlash();
    dropEnter();
    const notify = !opts || opts.notify !== false;
    const wasOpen = openFlag;
    if (!openFlag && !pane.isConnected) return;
    dropParsed();
    hideBar();
    textLayer.clear();
    ocrSha = "";
    if (wasOpen) emitSnapshot("close");
    openFlag = false;
    endSplit();
    releaseWatch();
    endPress();
    swallowOff?.();
    endPdfDrag();
    dropSearchWatch();
    searchHold = false;
    toolsOn = false;
    paintTools();
    toolsBtn.setAttribute("aria-pressed", "false");
    fitDone = false;
    userZoomed = false;
    settleNoted = false;
    clearLive();
    emitReading("");
    root?.classList?.remove("pxd-root--read", "pxd-root--read-stack");
    try { root?.style?.removeProperty?.("--pxd-read-w"); } catch { /* stub */ }
    pane.remove();
    if (notify) {
      try { onClose?.(); } catch { /* host */ }
    }
  }

  return {
    open(detail) {
      const next = detail && typeof detail === "object" ? detail : {};
      const blockUid = typeof next.blockUid === "string" ? next.blockUid : "";
      if (!blockUid || !root) return;
      if (blockUid !== current.blockUid) {
        textLayer.clear();
        ocrSha = "";
      }
      if (!openFlag || blockUid !== current.blockUid) {
        fitDone = false;
        userZoomed = false;
        settleNoted = false;
        if (blockUid !== current.blockUid) parsedTitle = "";
        fitState.path = "none";
        fitState.clicks = 0;
      }
      current = {
        cardUid: typeof next.cardUid === "string" ? next.cardUid : "",
        blockUid,
        title: typeof next.title === "string" ? next.title : "",
        source: typeof next.source === "string" ? next.source : "",
        pageUid: typeof next.pageUid === "string" ? next.pageUid : "",
      };
      if ((!current.title || !current.pageUid) && current.source && typeof host?.pdfCover === "function") {
        try {
          const cover = host.pdfCover(current.source);
          if (!current.title && typeof cover?.title === "string") current.title = cover.title;
          if (!current.pageUid && typeof cover?.pageUid === "string") current.pageUid = cover.pageUid;
        } catch { /* host */ }
      }
      const fresh = !pane.isConnected;
      if (fresh) root.append(pane);
      openFlag = true;
      emitReading(current.cardUid);
      titleNode.textContent = shownTitle();
      ensureMotion();
      applyBox();
      if (fresh) startEnter();
      mountReader(blockUid);
      attachReaderWatch();
      armSettle();
      armFit();
      const wanted = highlightUidOf(next);
      if (typeof next.page === "number") jumpPageWhenReady(next.page, wanted ? () => locateHighlight(wanted) : null);
      else if (wanted) locateHighlight(wanted);
      armWatch(current.title);
      paintSwitcher();
      refreshList();
      explicitMode = next.mode != null && next.mode !== "";
      void noteCached();
      if (explicitMode && normalizeReadMode(next.mode) === "both") void enterParsed("both");
      else if (parsedView && viewMode !== "reader") void enterParsed("both");
    },
    close,
    dispose() {
      close({ notify: false });
      endSplit();
      dropSearchWatch();
      detachReaderWatch();
      try { drawer?.dispose?.(); } catch { /* drawer */ }
      textLayer.dispose();
      for (const [node, type, fn, capture] of armed) node.removeEventListener?.(type, fn, capture);
      armed.length = 0;
    },
    layout(mountWidth) {
      if (typeof mountWidth === "number" && Number.isFinite(mountWidth) && mountWidth > 0) mountW = mountWidth;
      if (!openFlag) return;
      applyBox();
      applyModeClass();
    },
    isOpen: () => openFlag && Boolean(pane.isConnected),
    cardUid: () => current.cardUid || "",
    setTitle(title) {
      current.title = typeof title === "string" && title.trim() ? title.trim() : "PDF";
      paintTitle();
    },
    // P32-3 probe: which path fitted the page (viewer | steps | viewer+steps | none) and the presses it took.
    fitInfo: () => ({ path: fitState.path, clicks: fitState.clicks, done: fitDone, userZoomed }),
    element: () => pane,
    parse() { void enterParsed("both"); },
    showParsed() { void enterParsed("both"); },
    showOutline() { void enterParsed("both"); },
    mode: () => viewMode,
    // U2 contract for OCR sources: pxd-ocr/1 page records (or { pages }) for the open PDF.
    setOcrPages: (pages, opts) => setOcrPages(pages, opts),
    textLayerStats: () => textLayer.stats(),
    selectionBarOpen: () => Boolean(barInfo) && !bar.hasAttribute("hidden"),
  };
}
