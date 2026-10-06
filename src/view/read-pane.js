// PDF reading pane. One live Roam reader beside the board. The list is a read of the PDF page.
// Width is localStorage. No :pdf-highlight write, no document key listener, no palette command.

import { CARD_MIME } from "../model/drop.js";
import { HIGHLIGHT_COLORS, highlightModel } from "../model/highlight.js";
import { highlightRows } from "../model/highlight-pick.js";
import { dragChipText, fiberOf, highlightById, highlighterContext, PDF_MARK, uidFromMark } from "../model/pdf-drag.js";
import { readPaneKey, readPaneWidth, writeReaderPage } from "../model/pdf.js";
import { isTextEntryTarget } from "./cards.js";

const PLACE_W = 300;
const PLACE_H = 140;
const FLASH_MS = 1600;
const ONE_REF = /^\(\(([\w-]+)\)\)$/;
const COLORS = ["gray", ...HIGHLIGHT_COLORS];

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
  onSwitch,
  cards,
  placed,
  titleOf,
} = {}) {
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    parent?.append(node);
    return node;
  };
  const pane = el("aside", "pxd-read");
  pane.setAttribute("role", "complementary");
  pane.setAttribute("aria-label", "PDF reader");
  const split = el("div", "pxd-read__split", pane);
  split.setAttribute("role", "separator");
  split.setAttribute("aria-orientation", "vertical");
  const head = el("div", "pxd-read__head", pane);
  const titleNode = el("div", "pxd-read__title", head);
  const switcher = el("select", "pxd-read__switch", head);
  switcher.setAttribute("aria-label", "PDF on this board");
  const closeBtn = el("button", "pxd-read__close pxd-chrome", head);
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  const live = el("div", "pxd-read__live", pane);
  const filters = el("div", "pxd-read__filters", pane);
  const colorSel = el("select", "pxd-read__color", filters);
  colorSel.setAttribute("aria-label", "Colour");
  const all = el("option", "", colorSel);
  all.value = "";
  all.textContent = "All colours";
  for (const name of COLORS) {
    const opt = el("option", "", colorSel);
    opt.value = name;
    opt.textContent = name;
  }
  const pageFilt = el("input", "pxd-read__pagefilt", filters);
  pageFilt.setAttribute("aria-label", "Page");
  pageFilt.placeholder = "Page";
  const snipFilt = el("input", "pxd-read__find", filters);
  snipFilt.setAttribute("aria-label", "Snippet");
  snipFilt.placeholder = "Snippet";
  const list = el("div", "pxd-read__list", pane);
  list.tabIndex = 0;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Highlights");

  let openFlag = false;
  let mountW = 0;
  let liveBlock = "";
  let watchOff = null;
  let watchTitle = "";
  let selectedUid = "";
  let shown = [];
  let catalog = [];
  let current = { cardUid: "", blockUid: "", title: "", pageUid: "", source: "" };
  let splitMove = null;
  let splitUp = null;

  const storedWidth = () => {
    try {
      const raw = storage?.getItem?.(readPaneKey(graph));
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };
  const writeWidth = (px) => {
    try { storage?.setItem?.(readPaneKey(graph), String(px)); } catch { /* private mode */ }
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
    try { host?.unmount?.(live); } catch { /* not mounted */ }
    live.replaceChildren?.();
    liveBlock = "";
  };
  const readerField = () => {
    const box = live.querySelector?.(".rm-pdf-container");
    if (!box?.querySelectorAll) return null;
    const inputs = [...box.querySelectorAll("input")];
    return inputs.find((node) => /^\d+$/.test(String(node.value || "").trim())) || inputs[0] || null;
  };
  const jumpPage = (page) => {
    const input = readerField();
    if (!input) return false;
    return writeReaderPage(input, page);
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
  };
  const cardTitle = (card) => {
    if (typeof titleOf === "function") {
      try {
        const title = titleOf(card);
        if (typeof title === "string" && title.trim()) return title.trim();
      } catch { /* host */ }
    }
    return "PDF";
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
  };
  const paintSelected = () => {
    for (const node of list.querySelectorAll?.(".pxd-read__row") || []) {
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
  function refreshList() {
    const tree = treeOf();
    const byUid = new Map();
    indexNodes(tree, byUid);
    let placedItems = [];
    try {
      const got = typeof placed === "function" ? placed() : [];
      placedItems = Array.isArray(got) ? got : [];
    } catch { placedItems = []; }
    let rows = [];
    try { rows = highlightRows(tree, { placed: placedItems }); } catch { rows = []; }
    const color = String(colorSel.value || "");
    const pageText = String(pageFilt.value || "").trim();
    const pageWant = pageText === "" ? null : Number(pageText);
    const needle = String(snipFilt.value || "").trim().toLowerCase();
    catalog = sortRows(rows);
    shown = catalog.filter((row) => {
      if (color && row.color !== color) return false;
      if (pageWant != null && Number.isFinite(pageWant) && row.page !== pageWant) return false;
      if (needle && !String(row.snippet || "").toLowerCase().includes(needle)) return false;
      return true;
    });
    list.replaceChildren?.();
    for (const row of shown) {
      const node = el("div", "pxd-read__row", list);
      node.setAttribute("role", "option");
      node.setAttribute("data-uid", row.uid);
      node.draggable = true;
      node.setAttribute("draggable", "true");
      const bar = el("span", "pxd-read__bar", node);
      bar.setAttribute("data-color", String(row.color || ""));
      const source = byUid.get(row.uid);
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
      const place = el("button", "pxd-read__place pxd-chrome", meta);
      place.type = "button";
      place.textContent = "Place";
    }
    paintSelected();
  }
  const moveSelection = (step) => {
    if (!shown.length) return;
    let index = shown.findIndex((row) => row.uid === selectedUid);
    if (index < 0) index = step > 0 ? -1 : shown.length;
    index = Math.max(0, Math.min(shown.length - 1, index + step));
    selectedUid = shown[index].uid;
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
    const row = shown.find((entry) => entry.uid === selectedUid);
    if (row) showHighlight(row);
  };
  const onPaneKey = (event) => {
    if (event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (target?.closest?.(".rm-pdf-container")) return;
    if (isTextEntryTarget(target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close({ notify: true });
      return;
    }
    const inList = target === list || Boolean(list.contains?.(target));
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
    if (!node || !list.contains?.(node)) return null;
    const uid = node.getAttribute?.("data-uid") || "";
    return shown.find((entry) => entry.uid === uid) || null;
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
  const endPress = () => {
    while (pressOff.length) { try { pressOff.pop()(); } catch { /* gone */ } }
    const wasActive = press?.active;
    press = null;
    if (wasActive) endPdfDrag();
  };
  const moveChip = (x, y) => {
    if (!dragChip) return;
    dragChip.style.left = `${Math.round(x + 12)}px`;
    dragChip.style.top = `${Math.round(y + 12)}px`;
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
  const dropAt = (uid, x, y) => {
    const w = view();
    const target = doc?.elementFromPoint?.(x, y);
    if (!target || !root?.contains?.(target) || target.closest?.(".pxd-read")) return false;
    const Transfer = w.DataTransfer;
    const Drag = w.DragEvent;
    if (typeof Transfer !== "function" || typeof Drag !== "function") return false;
    const data = new Transfer();
    data.setData(CARD_MIME, `((${uid}))`);
    data.setData("text/plain", `((${uid}))`);
    try { data.effectAllowed = "copy"; } catch { /* read only */ }
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data };
    target.dispatchEvent(new Drag("dragover", init));
    target.dispatchEvent(new Drag("drop", init));
    return true;
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
      const label = chipLabel(press.uid, press.highlight);
      paintChip(null, label.color, label.text);
      if (dragChip) {
        dragChip.style.pointerEvents = "none";
        dragChip.style.zIndex = "60";
      }
      root?.classList?.add("pxd-root--pdf-drag");
      clearLiveSelection();
    }
    moveChip(x, y);
    event.preventDefault?.();
  };
  const onPressUp = (event) => {
    if (!press) return;
    const { active, uid } = press;
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (active) {
      swallowClick();
      dropChip();
      dropAt(uid, x, y);
      clearLiveSelection();
    }
    endPress();
  };
  const onPressKey = (event) => {
    if (event.key !== "Escape" || !press) return;
    event.stopPropagation();
    endPress();
  };
  const onLiveDown = (event) => {
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || selectionBusy()) { disarm(); return; }
    if (event.button !== 0 || !armedUid || !targetIsArmed(event.target)) return;
    endPress();
    press = { x: Number(event.clientX), y: Number(event.clientY), uid: armedUid, highlight: armedHighlight, active: false };
    const w = view();
    pressListen(w, "pointermove", onPressMove);
    pressListen(w, "pointerup", onPressUp);
    pressListen(w, "pointercancel", endPress);
    pressListen(w, "keydown", onPressKey);
    pressListen(w, "blur", endPress);
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
    try { onSwitch?.(uid); } catch { /* host */ }
  };
  const onCloseClick = (event) => {
    event.stopPropagation();
    close({ notify: true });
  };
  const armed = [];
  const listen = (node, type, fn, capture = false) => {
    node.addEventListener(type, fn, capture);
    armed.push([node, type, fn, capture]);
  };
  listen(pane, "keydown", onPaneKey);
  listen(pane, "wheel", onWheel);
  listen(pane, "pointerdown", onPointer);
  listen(pane, "dragover", onDragOver);
  listen(pane, "drop", onDrop);
  listen(pane, "dragend", endPdfDrag);
  listen(live, "pointermove", onPointerMove, { capture: true, passive: true });
  listen(live, "pointerleave", onLiveLeave);
  listen(live, "pointerdown", onLiveDown);
  listen(live, "dragstart", onMarkDrag);
  if (root) listen(root, "drop", clearDragClass);
  listen(list, "click", onListClick);
  listen(list, "dragstart", onListDrag);
  listen(colorSel, "change", onColor);
  listen(pageFilt, "input", onPageFilt);
  listen(snipFilt, "input", onFind);
  listen(switcher, "change", onSwitchChange);
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
    };
    root?.addEventListener?.("pointermove", splitMove);
    root?.addEventListener?.("pointerup", splitUp);
  });

  function close(opts) {
    cancelPageWait();
    cancelMove();
    clearFlash();
    const notify = !opts || opts.notify !== false;
    if (!openFlag && !pane.isConnected) return;
    openFlag = false;
    endSplit();
    releaseWatch();
    endPress();
    swallowOff?.();
    endPdfDrag();
    clearLive();
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
      if (!pane.isConnected) root.append(pane);
      openFlag = true;
      titleNode.textContent = current.title || "PDF";
      applyBox();
      mountReader(blockUid);
      const wanted = highlightUidOf(next);
      if (typeof next.page === "number") jumpPageWhenReady(next.page, wanted ? () => locateHighlight(wanted) : null);
      else if (wanted) locateHighlight(wanted);
      armWatch(current.title);
      paintSwitcher();
      refreshList();
    },
    close,
    dispose() {
      close({ notify: false });
      endSplit();
      for (const [node, type, fn, capture] of armed) node.removeEventListener?.(type, fn, capture);
      armed.length = 0;
    },
    layout(mountWidth) {
      if (typeof mountWidth === "number" && Number.isFinite(mountWidth) && mountWidth > 0) mountW = mountWidth;
      if (!openFlag) return;
      applyBox();
    },
    isOpen: () => openFlag && Boolean(pane.isConnected),
    cardUid: () => current.cardUid || "",
    element: () => pane,
  };
}
