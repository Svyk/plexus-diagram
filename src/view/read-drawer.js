// Highlight drawer. One strip, a body that opens to a fraction of the pane, and the new-highlight pill.
// Listeners are delegated on the drawer root. Resize listeners live only while the pointer is down.
// No setPointerCapture. No document key listener. No :pdf-highlight write.

import { isTextEntryTarget } from "./cards.js";
import {
  colorsPresent,
  diffNew,
  fillCardDrag,
  filterRows,
  pagesPresent,
  placedUidSet,
  readKeyPair,
  sortRows,
  writeKeyPair,
} from "../model/read-drawer-model.js";

const OPEN = 0.4;
const MIN_F = 0.2;
const MAX_F = 0.72;
const PULSE_MS = 600;
const PILL_MS = 6000;
const SVG = "http://www.w3.org/2000/svg";
const LINES = {
  gray: "var(--pxd-gray-line, #6b7280)",
  red: "var(--pxd-red-line, #dc2626)",
  orange: "var(--pxd-orange-line, #ea580c)",
  yellow: "var(--pxd-yellow-line, #ca8a04)",
  green: "var(--pxd-green-line, #16a34a)",
  teal: "var(--pxd-teal-line, #0d9488)",
  blue: "var(--pxd-blue-line, #2563eb)",
  indigo: "var(--pxd-indigo-line, #4f46e5)",
  purple: "var(--pxd-purple-line, #9333ea)",
  pink: "var(--pxd-pink-line, #db2777)",
};

function clampFraction(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return OPEN;
  return Math.min(MAX_F, Math.max(MIN_F, n));
}

function countLabel(n) {
  const value = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return value === 1 ? "1 highlight" : `${value} highlights`;
}

export function createReadDrawer({
  doc = globalThis.document,
  mount,
  host,
  rows = () => [],
  placed,
  onLocate,
  onPlace,
  onNote,
  onHover,
  storage,
  key = "",
} = {}) {
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (tag === "button") {
      node.type = "button";
      node.setAttribute("type", "button");
    }
    parent?.append(node);
    return node;
  };
  const hide = (node, on) => {
    if (!node) return;
    node.hidden = Boolean(on);
    if (on) node.setAttribute("hidden", "");
    else node.removeAttribute("hidden");
  };
  const call = (fn, ...args) => {
    if (typeof fn !== "function") return;
    try { fn(...args); } catch { /* host */ }
  };
  const view = () => doc?.defaultView || globalThis;

  const root = el("div", "pxd-read-drawer");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Highlights");
  const pill = el("div", "pxd-read-drawer__pill", root);
  pill.setAttribute("role", "status");
  hide(pill, true);
  el("span", "pxd-read-drawer__pilltext", pill).textContent = "New highlight · ";
  const pillBtn = el("button", "pxd-read-drawer__pillplace", pill);
  pillBtn.textContent = "Place on board";
  const edge = el("div", "pxd-read-drawer__edge", root);
  edge.setAttribute("role", "separator");
  edge.setAttribute("aria-orientation", "horizontal");
  edge.setAttribute("aria-label", "Resize highlights");
  hide(edge, true);
  const strip = el("div", "pxd-read-drawer__strip", root);
  const chevron = el("button", "pxd-read-drawer__chevron", strip);
  chevron.textContent = "▸";
  chevron.setAttribute("aria-expanded", "false");
  chevron.setAttribute("aria-label", "Open highlights");
  const count = el("span", "pxd-read-drawer__count", strip);
  count.textContent = countLabel(0);
  const dots = el("div", "pxd-read-drawer__dots", strip);
  dots.setAttribute("role", "group");
  dots.setAttribute("aria-label", "Colours");
  const pages = el("div", "pxd-pdf-chips pxd-chrome", strip);
  pages.setAttribute("role", "group");
  pages.setAttribute("aria-label", "Pages");
  const searchBtn = el("button", "pxd-read-drawer__search", strip);
  searchBtn.textContent = "⌕";
  searchBtn.setAttribute("aria-label", "Search highlights");
  searchBtn.setAttribute("aria-expanded", "false");
  const find = el("input", "pxd-read-drawer__find", strip);
  find.setAttribute("type", "search");
  find.setAttribute("aria-label", "Search highlights");
  hide(find, true);
  const body = el("div", "pxd-read-drawer__body", root);
  hide(body, true);
  const list = el("div", "pxd-read-drawer__list", body);
  list.tabIndex = 0;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Highlights");
  mount?.append?.(root);

  let openFlag = false;
  let primed = false;
  let disposed = false;
  let catalog = [];
  let shown = [];
  let selectedUid = "";
  let hoverUid = "";
  let focusUid = "";
  let pinnedCount = null;
  let pillRow = null;
  let pillTimer = null;
  let fraction = OPEN;
  const colors = new Set();
  let page = null;
  let needle = "";
  let prev = new Set();
  const pulsing = new Set();
  const pulseTimers = new Map();
  const timers = new Set();
  const offs = [];
  let dragOff = [];

  try {
    const saved = readKeyPair(storage?.getItem?.(key));
    if (saved.drawer != null) fraction = clampFraction(saved.drawer);
  } catch { /* private mode */ }

  const later = (fn, ms) => {
    const clock = view();
    const run = () => {
      timers.delete(id);
      if (!disposed) fn();
    };
    const id = (clock.setTimeout || globalThis.setTimeout)(run, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => {
    if (id == null) return;
    timers.delete(id);
    try { (view().clearTimeout || globalThis.clearTimeout)(id); } catch { /* stub */ }
  };
  const listen = (target, type, fn, capture) => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const endDrag = () => {
    while (dragOff.length) {
      try { dragOff.pop()(); } catch { /* gone */ }
    }
  };
  const paneHeight = () => {
    try {
      const pane = typeof mount?.closest === "function" ? mount.closest(".pxd-read") : null;
      const node = pane || mount?.parentElement || mount;
      const rect = node?.getBoundingClientRect?.();
      const h = Number(rect?.height);
      return Number.isFinite(h) && h > 0 ? h : 0;
    } catch {
      return 0;
    }
  };
  const applyHeight = () => {
    if (!openFlag) {
      root.style.height = "";
      if (mount?.style) mount.style.height = "";
      return;
    }
    const paneH = paneHeight();
    const px = paneH > 0 ? Math.round(paneH * fraction) : 0;
    const value = px > 0 ? `${px}px` : `${Math.round(fraction * 100)}%`;
    root.style.height = value;
    if (mount?.style) mount.style.height = value;
  };
  const writeFraction = () => {
    if (!key || typeof storage?.setItem !== "function") return;
    try {
      const raw = storage.getItem?.(key);
      storage.setItem(key, writeKeyPair(raw, fraction));
    } catch { /* private mode */ }
  };
  const icon = (ds) => {
    const svg = doc.createElementNS?.(SVG, "svg") || doc.createElement("svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ds) {
      const path = doc.createElementNS?.(SVG, "path") || doc.createElement("path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.5");
      svg.append(path);
    }
    return svg;
  };
  const makeActs = () => {
    const acts = el("div", "pxd-read-drawer__acts");
    const note = el("button", "pxd-read-drawer__note", acts);
    note.setAttribute("aria-label", "Note");
    note.append(icon(["M3 4.5h10v6H6.5L3 13z"]));
    const placeBtn = el("button", "pxd-read-drawer__place", acts);
    placeBtn.setAttribute("aria-label", "Place");
    placeBtn.append(icon(["M2.5 3.5h8v8h-8z", "M11 8h3M12.5 6.5v3"]));
    const locate = el("button", "pxd-read-drawer__locate", acts);
    locate.setAttribute("aria-label", "Locate");
    locate.append(icon(["M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2", "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"]));
    return acts;
  };
  const boardMark = () => {
    const mark = el("span", "pxd-read-drawer__on");
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "On board");
    mark.append(icon(["M2 3h12v10H2z", "M2 6h12"]));
    return mark;
  };
  const rowNode = (uid) => {
    for (const node of list.querySelectorAll?.(".pxd-read-drawer__row") || []) {
      if (node.getAttribute?.("data-uid") === uid) return node;
    }
    return null;
  };
  const rowFromNode = (node) => {
    const uid = node?.getAttribute?.("data-uid") || "";
    return shown.find((entry) => entry.uid === uid) || null;
  };
  const paintCount = () => {
    const n = pinnedCount != null ? pinnedCount : catalog.length;
    count.textContent = countLabel(n);
  };
  const paintPressed = () => {
    for (const dot of dots.querySelectorAll?.(".pxd-read-drawer__dot") || []) {
      const on = colors.has(dot.getAttribute?.("data-color"));
      dot.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const chip of pages.querySelectorAll?.(".pxd-pdf-chip") || []) {
      const on = page != null && Number(chip.getAttribute?.("data-page")) === page;
      chip.setAttribute("aria-pressed", on ? "true" : "false");
      chip.classList.toggle("pxd-pdf-chip--on", on);
    }
  };
  const paintDots = () => {
    dots.replaceChildren?.();
    for (const name of colorsPresent(catalog)) {
      const dot = el("button", "pxd-read-drawer__dot", dots);
      dot.setAttribute("data-color", name);
      dot.setAttribute("aria-label", name);
      dot.setAttribute("aria-pressed", "false");
      const mark = el("span", "pxd-read-drawer__dotmark", dot);
      const line = LINES[name] || "var(--pxd-muted, #5f6b7c)";
      if (typeof mark.style?.setProperty === "function") mark.style.setProperty("--pxd-dot", line);
      else if (mark.style) mark.style["--pxd-dot"] = line;
    }
  };
  const paintPages = () => {
    pages.replaceChildren?.();
    for (const n of pagesPresent(catalog)) {
      const chip = el("button", "pxd-pdf-chip pxd-chrome", pages);
      chip.setAttribute("data-page", String(n));
      chip.setAttribute("aria-label", `Page ${n}`);
      chip.setAttribute("aria-pressed", "false");
      chip.textContent = `p.${n}`;
    }
  };
  const paintSelected = () => {
    for (const node of list.querySelectorAll?.(".pxd-read-drawer__row") || []) {
      const on = node.getAttribute?.("data-uid") === selectedUid;
      node.classList.toggle("pxd-read-drawer__row--on", on);
      node.setAttribute?.("aria-selected", on ? "true" : "false");
    }
  };
  const syncHot = () => {
    const uid = hoverUid || focusUid;
    for (const node of list.querySelectorAll?.(".pxd-read-drawer__row") || []) {
      const on = uid !== "" && node.getAttribute?.("data-uid") === uid;
      node.classList.toggle("pxd-read-drawer__row--hot", on);
      const acts = node.querySelector?.(".pxd-read-drawer__acts");
      if (on && !acts) node.append(makeActs());
      else if (!on && acts) acts.remove?.();
    }
  };
  const syncPulse = () => {
    for (const node of list.querySelectorAll?.(".pxd-read-drawer__row") || []) {
      const uid = node.getAttribute?.("data-uid") || "";
      node.classList.toggle("pxd-read-drawer__row--new", pulsing.has(uid));
    }
  };
  const renderRow = (row) => {
    const node = el("div", "pxd-read-drawer__row");
    node.setAttribute("role", "option");
    node.setAttribute("data-uid", String(row.uid || ""));
    node.draggable = true;
    node.setAttribute("draggable", "true");
    node.tabIndex = -1;
    const bar = el("span", "pxd-read-drawer__bar", node);
    bar.setAttribute("data-color", String(row.color || ""));
    const string = typeof row.string === "string" ? row.string : "";
    if (string.includes("![") && typeof host?.renderString === "function") {
      const media = el("div", "pxd-read-drawer__media", node);
      try { host.renderString(media, string); } catch { media.textContent = row.snippet || ""; }
    } else if (row.snippet) {
      el("div", "pxd-read-drawer__snip", node).textContent = String(row.snippet);
    }
    const meta = el("div", "pxd-read-drawer__meta", node);
    if (typeof row.page === "number") el("span", "pxd-read-drawer__pg", meta).textContent = `p. ${row.page}`;
    if (row.placed === true) meta.append(boardMark());
    return node;
  };
  const paintRows = () => {
    shown = filterRows(catalog, { colors, page, needle });
    list.replaceChildren?.();
    for (const row of shown) list.append(renderRow(row));
    paintSelected();
    syncHot();
    syncPulse();
  };
  const paintChrome = () => {
    paintCount();
    paintDots();
    paintPages();
    paintPressed();
    paintRows();
  };
  const readRows = () => {
    try {
      const got = typeof rows === "function" ? rows() : rows;
      return Array.isArray(got) ? got : [];
    } catch {
      return [];
    }
  };
  const readPlaced = () => {
    try {
      const got = typeof placed === "function" ? placed() : placed;
      return placedUidSet(got);
    } catch {
      return new Set();
    }
  };
  const armPulse = (uids) => {
    for (const uid of uids) {
      if (pulseTimers.has(uid)) continue;
      pulsing.add(uid);
      const id = later(() => {
        pulsing.delete(uid);
        pulseTimers.delete(uid);
        syncPulse();
      }, PULSE_MS);
      pulseTimers.set(uid, id);
    }
    syncPulse();
  };
  const hidePill = () => {
    pillRow = null;
    hide(pill, true);
    if (pillTimer) { cancel(pillTimer); pillTimer = null; }
  };
  const showPill = (row) => {
    pillRow = row;
    hide(pill, false);
    if (pillTimer) cancel(pillTimer);
    pillTimer = later(() => hidePill(), PILL_MS);
  };
  const setOpen = (next) => {
    openFlag = Boolean(next);
    root.classList.toggle("pxd-read-drawer--open", openFlag);
    chevron.setAttribute("aria-expanded", openFlag ? "true" : "false");
    chevron.setAttribute("aria-label", openFlag ? "Close highlights" : "Open highlights");
    chevron.textContent = openFlag ? "▾" : "▸";
    hide(edge, !openFlag);
    hide(body, !openFlag);
    applyHeight();
  };
  const moveSelection = (step) => {
    if (!shown.length) return;
    let index = shown.findIndex((row) => row.uid === selectedUid);
    if (index < 0) index = step > 0 ? -1 : shown.length;
    index = Math.max(0, Math.min(shown.length - 1, index + step));
    selectedUid = shown[index].uid;
    paintSelected();
    rowNode(selectedUid)?.focus?.();
  };
  const selectedRow = () => shown.find((entry) => entry.uid === selectedUid) || null;
  const onClick = (event) => {
    const target = event.target;
    const closest = (sel) => target?.closest?.(sel);
    if (closest(".pxd-read-drawer__pillplace")) {
      event.stopPropagation?.();
      const row = pillRow;
      if (!row) return;
      hidePill();
      call(onPlace, row);
      return;
    }
    const rowEl = closest(".pxd-read-drawer__row");
    if (rowEl && list.contains?.(rowEl)) {
      const row = rowFromNode(rowEl);
      if (!row) return;
      event.stopPropagation?.();
      selectedUid = row.uid;
      paintSelected();
      if (closest(".pxd-read-drawer__note")) { call(onNote, row); return; }
      if (closest(".pxd-read-drawer__place")) { call(onPlace, row); return; }
      if (closest(".pxd-read-drawer__locate") || !closest("button")) call(onLocate, row);
      return;
    }
    const dot = closest(".pxd-read-drawer__dot");
    if (dot && dots.contains?.(dot)) {
      event.stopPropagation?.();
      const name = dot.getAttribute?.("data-color") || "";
      if (!name) return;
      if (colors.has(name)) colors.delete(name);
      else colors.add(name);
      paintPressed();
      paintRows();
      return;
    }
    const chip = closest(".pxd-pdf-chip");
    if (chip && pages.contains?.(chip)) {
      event.stopPropagation?.();
      const n = Number(chip.getAttribute?.("data-page"));
      page = page === n ? null : n;
      paintPressed();
      paintRows();
      return;
    }
    if (closest(".pxd-read-drawer__find")) return;
    if (closest(".pxd-read-drawer__search")) {
      event.stopPropagation?.();
      toggleSearch(true);
      return;
    }
    if (closest(".pxd-read-drawer__chevron")) {
      event.stopPropagation?.();
      setOpen(!openFlag);
      return;
    }
    if (closest(".pxd-read-drawer__strip")) {
      event.stopPropagation?.();
      if (!openFlag) setOpen(true);
    }
  };
  const toggleSearch = (focus) => {
    const collapsed = find.hasAttribute?.("hidden");
    if (collapsed) {
      hide(find, false);
      searchBtn.setAttribute("aria-expanded", "true");
      if (focus) find.focus?.();
      return;
    }
    hide(find, true);
    searchBtn.setAttribute("aria-expanded", "false");
    if (needle) {
      needle = "";
      find.value = "";
      paintRows();
    }
  };
  const onKey = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target?.closest?.(".rm-pdf-container")) return;
    if (isTextEntryTarget(target)) return;
    if (target !== list && !list.contains?.(target)) return;
    const keyName = event.key;
    const inButton = Boolean(target?.closest?.("button"));
    if (inButton && (keyName === "Enter" || keyName === " ")) return;
    if (keyName === "ArrowDown" || keyName === "ArrowUp") {
      event.preventDefault?.();
      event.stopPropagation?.();
      moveSelection(keyName === "ArrowDown" ? 1 : -1);
      return;
    }
    const row = selectedRow();
    if (!row) return;
    if (keyName === "Enter") {
      event.preventDefault?.();
      event.stopPropagation?.();
      call(onLocate, row);
      return;
    }
    if (keyName === "n" || keyName === "p") {
      event.preventDefault?.();
      event.stopPropagation?.();
      call(keyName === "n" ? onNote : onPlace, row);
    }
  };
  const onOver = (event) => {
    const rowEl = event.target?.closest?.(".pxd-read-drawer__row");
    if (!rowEl || !list.contains?.(rowEl)) return;
    const uid = rowEl.getAttribute?.("data-uid") || "";
    if (!uid || uid === hoverUid) return;
    const prevUid = hoverUid;
    hoverUid = uid;
    syncHot();
    if (prevUid) call(onHover, prevUid, false);
    call(onHover, uid, true);
  };
  const onOut = (event) => {
    const rowEl = event.target?.closest?.(".pxd-read-drawer__row");
    if (!rowEl || !list.contains?.(rowEl)) return;
    const uid = rowEl.getAttribute?.("data-uid") || "";
    if (uid !== hoverUid) return;
    const next = event.relatedTarget;
    if (next && rowEl.contains?.(next)) return;
    hoverUid = "";
    syncHot();
    if (uid) call(onHover, uid, false);
  };
  const onFocusIn = (event) => {
    const rowEl = event.target?.closest?.(".pxd-read-drawer__row");
    focusUid = rowEl && list.contains?.(rowEl) ? (rowEl.getAttribute?.("data-uid") || "") : "";
    syncHot();
  };
  const onFocusOut = (event) => {
    const rowEl = event.target?.closest?.(".pxd-read-drawer__row");
    if (!rowEl) return;
    const next = event.relatedTarget;
    if (next && rowEl.contains?.(next)) return;
    if ((rowEl.getAttribute?.("data-uid") || "") === focusUid) focusUid = "";
    syncHot();
  };
  const onDragStart = (event) => {
    const rowEl = event.target?.closest?.(".pxd-read-drawer__row");
    if (!rowEl || !list.contains?.(rowEl)) return;
    if (!fillCardDrag(event.dataTransfer, rowEl.getAttribute?.("data-uid") || "")) return;
    event.stopPropagation?.();
  };
  const onEdgeDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (!openFlag || !event.target?.closest?.(".pxd-read-drawer__edge")) return;
    const paneH = paneHeight();
    if (!paneH) return;
    event.preventDefault?.();
    const startPx = Math.round(paneH * fraction);
    const startY = Number(event.clientY) || 0;
    const win = view();
    const move = (ev) => {
      const y = Number(ev.clientY) || 0;
      fraction = clampFraction((startPx + (startY - y)) / paneH);
      applyHeight();
    };
    const up = () => {
      endDrag();
      writeFraction();
    };
    const arm = (type, fn) => {
      win.addEventListener?.(type, fn);
      dragOff.push(() => win.removeEventListener?.(type, fn));
    };
    endDrag();
    arm("pointermove", move);
    arm("pointerup", up);
    arm("pointercancel", up);
  };
  const onInput = (event) => {
    if (event.target !== find) return;
    needle = String(find.value || "");
    paintRows();
  };

  listen(root, "click", onClick);
  listen(root, "keydown", onKey, true);
  listen(root, "pointerover", onOver);
  listen(root, "pointerout", onOut);
  listen(root, "focusin", onFocusIn);
  listen(root, "focusout", onFocusOut);
  listen(root, "dragstart", onDragStart);
  listen(root, "pointerdown", onEdgeDown);
  listen(root, "input", onInput);

  const refresh = () => {
    const sorted = sortRows(readRows());
    const have = readPlaced();
    const marked = sorted.map((row) => {
      if (!row || typeof row !== "object" || row.placed === true || !have.has(row.uid)) return row;
      return { ...row, placed: true };
    });
    const fresh = primed ? diffNew(prev, marked) : [];
    primed = true;
    prev = new Set(marked.map((row) => row?.uid).filter((uid) => typeof uid === "string" && uid));
    catalog = marked;
    pinnedCount = null;
    const presentColors = new Set(colorsPresent(catalog));
    for (const name of colors) if (!presentColors.has(name)) colors.delete(name);
    if (page != null && !pagesPresent(catalog).includes(page)) page = null;
    paintChrome();
    if (!fresh.length) return;
    armPulse(fresh);
    const row = marked.find((entry) => entry?.uid === fresh[fresh.length - 1]);
    if (row) showPill(row);
  };

  return {
    refresh,
    open() { setOpen(true); },
    close() { setOpen(false); },
    toggle() { setOpen(!openFlag); },
    isOpen() { return openFlag; },
    focusSearch() {
      hide(find, false);
      searchBtn.setAttribute("aria-expanded", "true");
      find.focus?.();
    },
    setCount(n) {
      const value = typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      pinnedCount = value;
      paintCount();
    },
    element() { return root; },
    dispose() {
      if (disposed) return;
      disposed = true;
      endDrag();
      hidePill();
      for (const id of [...timers]) cancel(id);
      for (const id of pulseTimers.values()) cancel(id);
      pulseTimers.clear();
      pulsing.clear();
      if (hoverUid) call(onHover, hoverUid, false);
      hoverUid = "";
      while (offs.length) {
        try { offs.pop()(); } catch { /* gone */ }
      }
      try { root.remove?.(); } catch { /* already gone */ }
    },
  };
}
