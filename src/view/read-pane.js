// PDF reading pane. One live Roam reader beside the board. The list is a read of the PDF page.
// Width is localStorage. No :pdf-highlight write, no document key listener, no palette command.

import { CARD_MIME } from "../model/drop.js";
import { HIGHLIGHT_COLORS, highlightModel } from "../model/highlight.js";
import { highlightRows } from "../model/highlight-pick.js";
import { dragChipText, PDF_MARK, uidFromMark } from "../model/pdf-drag.js";
import { readPaneKey, readPaneWidth, writeReaderPage } from "../model/pdf.js";
import { isTextEntryTarget } from "./cards.js";

const PLACE_W = 300;
const PLACE_H = 140;
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
  let pageWait = null;
  const cancelPageWait = () => { if (pageWait) { clearTimeout(pageWait); pageWait = null; } };
  const jumpPageWhenReady = (page) => {
    cancelPageWait();
    if (typeof page !== "number" || page < 1) return;
    const started = Date.now();
    let settled = 0;
    const tick = () => {
      pageWait = null;
      if (!openFlag) return;
      const input = readerField();
      const ready = input && live.querySelector?.(".rm-pdf-container .page");
      if (!ready) {
        if (Date.now() - started < 5000) pageWait = setTimeout(tick, 100);
        return;
      }
      if (String(input.value).trim() !== String(page)) {
        writeReaderPage(input, page);
        settled = 0;
      } else settled += 1;
      if (settled < 2 && Date.now() - started < 5000) pageWait = setTimeout(tick, 300);
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
  const jumpSelected = () => {
    const row = shown.find((entry) => entry.uid === selectedUid);
    if (!row) return;
    jumpPage(row.page);
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
      }
      return;
    }
    if (event.target?.closest?.("button")) return;
    const row = rowFromEvent(event);
    if (!row) return;
    event.stopPropagation();
    selectedUid = row.uid;
    paintSelected();
    jumpPage(row.page);
  };
  const markCache = new WeakMap();
  let dragChip = null;
  const blockExists = (uid) => {
    if (typeof host?.blockString !== "function") return true;
    try { return typeof host.blockString(uid) === "string"; } catch { return false; }
  };
  const markOf = (event) => {
    const node = event.target;
    if (!node || typeof node.closest !== "function") return null;
    const mark = node.closest(PDF_MARK);
    if (!mark || !live.contains?.(mark)) return null;
    return mark;
  };
  const armMark = (mark) => {
    const cached = markCache.get(mark);
    if (cached) return cached;
    const found = uidFromMark(mark, blockExists);
    if (!found) return null;
    markCache.set(mark, found);
    return found;
  };
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
    clearDragClass();
    dropChip();
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
    try { data.setDragImage?.(chip, 8, 8); } catch { /* no drag image */ }
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
  };
  const onListDrag = (event) => {
    const row = rowFromEvent(event);
    if (!row?.uid) return;
    const label = chipLabel(row.uid, null);
    beginDrag(event, row.uid, row.color || label.color, dragChipText(row.snippet || label.text));
  };
  const onMarkHover = (event) => {
    const mark = markOf(event);
    if (!mark) return;
    const found = armMark(mark);
    if (!found) return;
    mark.draggable = true;
    try { mark.setAttribute("draggable", "true"); } catch { /* stub */ }
  };
  const onMarkDrag = (event) => {
    const mark = markOf(event);
    if (!mark) return;
    const found = markCache.get(mark);
    if (!found?.uid) return;
    const label = chipLabel(found.uid, found.highlight);
    beginDrag(event, found.uid, label.color, label.text);
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
  listen(live, "pointerover", onMarkHover, true);
  listen(live, "mouseover", onMarkHover, true);
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
    const notify = !opts || opts.notify !== false;
    if (!openFlag && !pane.isConnected) return;
    openFlag = false;
    endSplit();
    releaseWatch();
    clearLive();
    endPdfDrag();
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
      if (typeof next.page === "number") jumpPageWhenReady(next.page);
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
