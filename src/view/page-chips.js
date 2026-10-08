// Structure chips on the reader page. Hovering a parsed block outlines it and shows a chip at its
// top-right that runs one of the existing parse actions. Hover, outline and dots write nothing;
// only a chip click calls `run`. Pointer events are on the chip alone. No setPointerCapture.
// "Show parsed" adds a persistent soft box per parsed block with a copy icon at its left edge;
// boxes are pointer-events none, only the icons take clicks (one delegated listener).

import { bboxToPagePercent, bboxToPageRect } from "./parse-overlay.js";

const HIDE_MS = 220;
const SYNC_RETRIES = 40;
const SYNC_RETRY_MS = 250;
const DOT_CAP = 400;
// Breathing room around the exact block extent, in CSS px (the box geometry itself is exact).
export const BOX_PAD = 3;
export const CHIP_TYPES = Object.freeze(["table", "figure", "heading", "list", "formula"]);
export const SHOW_PARSED_KEY = "pxd-show-parsed";
export const BESIDE_LABEL = "Insert beside PDF";
// Chip acts that put something on the board: they place by click unless extra.beside is set.
export const PLACE_ACTS = Object.freeze(["table", "card", "board"]);

// On unless this device turned it off.
export function readShowParsed(storage) {
  try { return storage?.getItem?.(SHOW_PARSED_KEY) !== "0"; } catch { return true; }
}

export function writeShowParsed(storage, on) {
  try { storage?.setItem?.(SHOW_PARSED_KEY, on ? "1" : "0"); } catch { /* private mode */ }
}

// Pure. Box and copy-icon geometry for one block in percent of its page.
export function parsedBoxPlan(block, page) {
  if (!block || !Array.isArray(block.bbox)) return null;
  const pct = bboxToPagePercent(block.bbox, page);
  if (!pct || !(pct.width > 0) || !(pct.height > 0)) return null;
  return { id: block.id, type: block.type || "para", ...pct };
}

export const COPY_ICON = 18;
// Gap between a copy button and its box's left edge (the CSS translate is -100% - 5px).
export const COPY_GAP = 5;
// Blocks too small to be worth a box: under this height AND width in page px; image blocks under this size either way.
export const MIN_BOX_H = 14;
export const MIN_BOX_W = 40;
export const MIN_IMAGE = 24;
const MARK_TEXT = /^[\p{L}\p{N}†‡*§¶]{1,3}$/u;

// Pure. True when a parsed block gets no box: a speck (logo dot, tick), a bare mark ("1", "a", "*", "†")
// or a tiny image. plan: percent box from parsedBoxPlan; page: { w, h } in px.
export function skipParsedBox(block, plan, page) {
  const W = Number(page?.w) > 0 ? Number(page.w) : 612;
  const H = Number(page?.h) > 0 ? Number(page.h) : 792;
  const w = (plan.width / 100) * W;
  const h = (plan.height / 100) * H;
  if (h < MIN_BOX_H && w < MIN_BOX_W) return true;
  if ((block?.type === "figure" || block?.type === "image") && (h < MIN_IMAGE || w < MIN_IMAGE)) return true;
  const text = typeof block?.text === "string" ? block.text.trim() : "";
  if (block?.type !== "table" && text && MARK_TEXT.test(text)) return true;
  return false;
}

// Pure. Which copy button to show for a pointer at (x, y) px on a page of size page: the one whose box, or whose
// own button, the pointer is over. A button under the pointer wins; else the smallest box.
// entries: [{ id, left, top, width, height, dy }] in percent (dy: the button's extra drop in px).
export function copyHoverId(entries, x, y, page, size = COPY_ICON) {
  const W = Number(page?.w) > 0 ? Number(page.w) : 612;
  const H = Number(page?.h) > 0 ? Number(page.h) : 792;
  let best = null;
  let bestArea = Infinity;
  for (const e of entries || []) {
    const left = (e.left / 100) * W - BOX_PAD;
    const top = (e.top / 100) * H - BOX_PAD;
    const iconLeft = left - COPY_GAP - size;
    const iconTop = top + (e.dy || 0);
    if (x >= iconLeft && x <= iconLeft + size && y >= iconTop && y <= iconTop + size) return e.id;
    const right = left + (e.width / 100) * W + 2 * BOX_PAD;
    const bottom = top + (e.height / 100) * H + 2 * BOX_PAD;
    if (x < left || x > right || y < top || y > bottom) continue;
    const area = (right - left) * (bottom - top);
    if (area < bestArea) { bestArea = area; best = e.id; }
  }
  return best;
}

// Pure. Copy buttons sit at their box's top-left corner. Two boxes close together would stack the buttons,
// so a later button moves down by one button height (plus a 2 px gap) until it clears every earlier one.
// plans: [{ id, left, top }] in percent of the page; page: { w, h } in px. Returns Map(id -> extra dy px).
export function copyIconNudges(plans, page, size = COPY_ICON) {
  const W = Number(page?.w) > 0 ? Number(page.w) : 612;
  const H = Number(page?.h) > 0 ? Number(page.h) : 792;
  const step = size + 2;
  const placed = [];
  const out = new Map();
  for (const plan of plans || []) {
    const x = (plan.left / 100) * W;
    const y0 = (plan.top / 100) * H;
    let dy = 0;
    for (let guard = 0; guard < 200; guard += 1) {
      const hit = placed.some((p) => Math.abs(p.x - x) < size && Math.abs(p.y - (y0 + dy)) < size);
      if (!hit) break;
      dy += step;
    }
    placed.push({ x, y: y0 + dy });
    out.set(plan.id, dy);
  }
  return out;
}

function tableShape(table) {
  const grid = table?.grid;
  let rows = Number(table?.rows) || (Array.isArray(grid?.ys) ? grid.ys.length - 1 : 0);
  let cols = Number(table?.cols) || (Array.isArray(grid?.xs) ? grid.xs.length - 1 : 0);
  if (!(rows > 0) || !(cols > 0)) {
    for (const cell of table?.cells || []) {
      rows = Math.max(rows, (Number(cell.row) || 0) + (Number(cell.rowSpan) || 1));
      cols = Math.max(cols, (Number(cell.col) || 0) + (Number(cell.colSpan) || 1));
    }
  }
  return { rows: Math.max(0, rows), cols: Math.max(0, cols) };
}

// ids of a heading and the blocks after it up to (not including) the next heading, in reading order.
export function sectionIds(doc, headingId) {
  const order = Array.isArray(doc?.order) ? doc.order : [];
  const at = order.indexOf(headingId);
  if (at < 0) return [];
  const ids = [headingId];
  for (let i = at + 1; i < order.length; i += 1) {
    if (doc.blocks?.[order[i]]?.type === "heading") break;
    ids.push(order[i]);
  }
  return ids;
}

// Pure. Returns null for a block that gets no chip.
// act: "table" (extra.mode) | "card" | "board" | "below" | "copy" | "latex".
export function chipPlan(block, doc, { latexReady = false } = {}) {
  if (!block || !CHIP_TYPES.includes(block.type)) return null;
  const ids = [block.id];
  if (block.type === "table") {
    const { rows, cols } = tableShape(block);
    const size = rows && cols ? ` ${rows}×${cols}` : "";
    return {
      type: "table",
      label: `Table${size} · Roam Grid`,
      primary: { act: "table", ids, extra: { mode: "grid", kind: "table" } },
      menu: [
        { label: "Native", act: "table", ids, extra: { mode: "native", kind: "table" } },
        { label: "Flat", act: "table", ids, extra: { mode: "flat", kind: "table" } },
        { label: "Copy as Markdown", act: "copy", ids },
        { label: "Card", act: "card", ids },
        { label: BESIDE_LABEL, act: "table", ids, extra: { mode: "grid", kind: "table", beside: true } },
      ],
    };
  }
  if (block.type === "figure") {
    return { type: "figure", label: "Figure · Card", primary: { act: "card", ids }, menu: [{ label: BESIDE_LABEL, act: "card", ids, extra: { beside: true } }] };
  }
  if (block.type === "formula") {
    return {
      type: "formula",
      label: "Card",
      primary: { act: "card", ids },
      menu: [...(latexReady ? [{ label: "LaTeX", act: "latex", ids }] : []), { label: BESIDE_LABEL, act: "card", ids, extra: { beside: true } }],
    };
  }
  if (block.type === "heading") {
    const section = sectionIds(doc, block.id);
    return { type: "heading", label: "Insert section", primary: { act: "board", ids: section }, menu: [{ label: BESIDE_LABEL, act: "board", ids: section, extra: { beside: true } }] };
  }
  return { type: "list", label: "Insert list", primary: { act: "below", ids }, menu: [] };
}

export function createPageChips({
  doc,
  host = null,
  getParsed,
  pageEl,
  pageOf,
  run,
  isLatexReady = null,
  getSelection = null,
  copy = null,
  storage = null,
  boxCap = 4000,
} = {}) {
  const win = () => doc?.defaultView || null;
  const bound = [];
  let outline = null;
  let chipNode = null;
  let dots = [];
  let hideTimer = null;
  let current = null;
  let disposed = false;
  let showParsed = readShowParsed(storage);
  // n -> { layer, boxes: Map(id -> box), observer }
  const layers = new Map();
  let boxCount = 0;
  let syncFrame = 0;
  let syncRetries = 0;

  const on = (node, type, fn, capture = false) => {
    if (!node || typeof node.addEventListener !== "function") return;
    node.addEventListener(type, fn, capture);
    bound.push([node, type, fn, capture]);
  };
  const off = (entry) => {
    try { entry[0].removeEventListener(entry[1], entry[2], entry[3]); } catch { /* gone */ }
  };
  const drop = (node) => { try { node?.remove?.(); } catch { /* gone */ } };
  const stopTimer = () => {
    if (hideTimer == null) return;
    (win()?.clearTimeout || clearTimeout)(hideTimer);
    hideTimer = null;
  };

  const selecting = () => {
    try {
      const sel = typeof getSelection === "function" ? getSelection() : doc?.getSelection?.() || win()?.getSelection?.();
      return Boolean(sel && !sel.isCollapsed && String(sel).length > 0);
    } catch { return false; }
  };

  const pageNumberOf = (target, parsed) => {
    const hit = target?.closest?.(".page");
    if (!hit) return 0;
    const n = Number(hit.getAttribute?.("data-page-number"));
    if (Number.isFinite(n) && n > 0) return n;
    for (const page of parsed?.pages || []) if (pageEl?.(page.n) === hit) return page.n;
    return 0;
  };

  const pageBlocks = (parsed, n) => {
    const out = [];
    for (const id of parsed?.order || []) {
      const block = parsed.blocks?.[id];
      if (block && block.page === n && CHIP_TYPES.includes(block.type)) out.push(block);
    }
    return out;
  };

  const info = (n) => pageOf?.(n) || {};

  const hide = () => {
    stopTimer();
    if (current) hot(current, false);
    current = null;
    drop(outline);
    drop(chipNode);
    outline = null;
    chipNode = null;
  };

  const later = (fn, ms) => (win()?.setTimeout || setTimeout)(fn, ms);

  const button = (cls, text, tip) => {
    const node = doc.createElement("button");
    node.type = "button";
    node.className = cls;
    node.textContent = text;
    if (tip) node.setAttribute("data-tip", tip);
    return node;
  };

  // pointer: where the click was; from: the block's client rect, so a placement ghost can grow out of it.
  const fire = (item, block, event, el) => {
    let from = null;
    try {
      const page = el?.getBoundingClientRect?.();
      const r = bboxToPageRect(block.bbox, info(block.page), el);
      if (page && r) from = { left: page.left + r.left, top: page.top + r.top, width: r.width, height: r.height };
    } catch { from = null; }
    const pointer = { x: Number(event?.clientX) || 0, y: Number(event?.clientY) || 0 };
    hideAll();
    try { run?.(item.act, { ids: item.ids, extra: item.extra || null, block, pointer, from }); } catch { /* host */ }
  };

  const hot = (id, on) => {
    for (const entry of layers.values()) {
      const box = entry.boxes.get(id);
      if (box) box.classList.toggle("pxd-parsed-box--hot", on);
    }
  };

  // The copy button of the box under the pointer is the only one drawn; the rest stay clear of the page.
  let copyShown = null;
  const showCopy = (id) => {
    if (id === copyShown) return;
    for (const entry of layers.values()) {
      if (copyShown) entry.icons.get(copyShown)?.classList.remove("pxd-parsed-copy--show");
      if (id) entry.icons.get(id)?.classList.add("pxd-parsed-copy--show");
    }
    copyShown = id;
  };
  const updateCopy = (event, parsed) => {
    if (!showParsed || layers.size === 0) { showCopy(null); return; }
    const n = pageNumberOf(event.target, parsed);
    const entry = n ? layers.get(n) : null;
    const el = entry?.el;
    if (!el) { showCopy(null); return; }
    const box = el.getBoundingClientRect();
    const x = (Number(event.clientX) || 0) - box.left;
    const y = (Number(event.clientY) || 0) - box.top;
    showCopy(copyHoverId(entry.rects, x, y, { w: box.width, h: box.height }));
  };

  const buildLayer = (n, el, parsed) => {
    const layer = doc.createElement("div");
    layer.className = "pxd-parsed-layer";
    layer.style.pointerEvents = "none";
    layer.setAttribute("aria-hidden", "false");
    const boxes = new Map();
    const icons = new Map();
    const entries = [];
    let budget = boxCap - boxCount;
    for (const id of parsed?.order || []) {
      if (budget <= 0) break;
      const block = parsed.blocks?.[id];
      if (!block || block.page !== n) continue;
      const plan = parsedBoxPlan(block, info(n));
      if (!plan) continue;
      entries.push({ block, plan });
    }
    let pageBox = null;
    try { pageBox = el?.getBoundingClientRect?.() || null; } catch { pageBox = null; }
    const fallback = info(n);
    const pagePx = {
      w: pageBox?.width > 0 ? pageBox.width : fallback?.w,
      h: pageBox?.height > 0 ? pageBox.height : fallback?.h,
    };
    const kept = entries.filter((e) => !skipParsedBox(e.block, e.plan, pagePx)).slice(0, Math.max(0, budget));
    entries.length = 0;
    entries.push(...kept);
    const nudges = copyIconNudges(entries.map((e) => e.plan), pagePx);
    const rects = [];
    for (const { block, plan } of entries) {
      const box = doc.createElement("div");
      box.className = `pxd-parsed-box pxd-parsed-box--${plan.type}`;
      box.setAttribute("data-block", plan.id);
      box.style.left = `calc(${plan.left}% - ${BOX_PAD}px)`;
      box.style.top = `calc(${plan.top}% - ${BOX_PAD}px)`;
      box.style.width = `calc(${plan.width}% + ${2 * BOX_PAD}px)`;
      box.style.height = `calc(${plan.height}% + ${2 * BOX_PAD}px)`;
      box.style.pointerEvents = "none";
      const icon = doc.createElement("button");
      icon.type = "button";
      icon.className = "pxd-parsed-copy";
      icon.setAttribute("data-block", plan.id);
      icon.setAttribute("aria-label", block.type === "table" ? "Copy table as Markdown" : "Copy text");
      icon.setAttribute("data-tip", "page-chip.copy");
      icon.style.left = `calc(${plan.left}% - ${BOX_PAD}px)`;
      const nudge = nudges.get(plan.id) || 0;
      icon.style.top = nudge ? `calc(${plan.top}% - ${BOX_PAD}px + ${nudge}px)` : `calc(${plan.top}% - ${BOX_PAD}px)`;
      icon.textContent = "⧉";
      layer.append(box, icon);
      boxes.set(plan.id, box);
      icons.set(plan.id, icon);
      rects.push({ id: plan.id, left: plan.left, top: plan.top, width: plan.width, height: plan.height, dy: nudge });
      boxCount += 1;
    }
    el.append(layer);
    let observer = null;
    const MO = win()?.MutationObserver;
    if (typeof MO === "function") {
      // The reader clears foreign children when it re-renders a page; put the layer back.
      observer = new MO(() => queueSync());
      try { observer.observe(el, { childList: true }); } catch { observer = null; }
    }
    return { layer, boxes, icons, rects, observer, el };
  };

  const dropLayers = () => {
    for (const entry of layers.values()) {
      try { entry.observer?.disconnect(); } catch { /* gone */ }
      drop(entry.layer);
    }
    layers.clear();
    copyShown = null;
    boxCount = 0;
  };

  // Lazy per page: a page gets its layer once the reader has drawn it (pdf.js data-loaded), or at
  // once when the reader marks no page at all. A detached layer is re-appended, never rebuilt.
  const sync = () => {
    syncFrame = 0;
    if (disposed || !showParsed) return;
    const parsed = getParsed?.();
    if (!parsed) return;
    const pages = new Set();
    for (const id of parsed.order || []) { const b = parsed.blocks?.[id]; if (b && b.page) pages.add(b.page); }
    const els = [];
    let marked = false;
    for (const n of pages) {
      const el = pageEl?.(n);
      if (!el) continue;
      if (el.hasAttribute?.("data-loaded")) marked = true;
      els.push([n, el]);
    }
    for (const [n, el] of els) {
      const entry = layers.get(n);
      if (entry) {
        if (entry.el !== el) {
          try { entry.observer?.disconnect(); } catch { /* gone */ }
          drop(entry.layer);
          layers.delete(n);
        } else {
          if (entry.layer.parentElement !== el) el.append(entry.layer);
          continue;
        }
      }
      if (marked && !el.hasAttribute?.("data-loaded")) continue;
      layers.set(n, buildLayer(n, el, parsed));
    }
    // A reopened PDF restores its parse before the reader has drawn the page: look again until one is there.
    if (layers.size === 0 && syncRetries < SYNC_RETRIES) {
      syncRetries += 1;
      later(queueSync, SYNC_RETRY_MS);
    } else if (layers.size > 0) {
      syncRetries = 0;
    }
  };

  function queueSync() {
    if (syncFrame || disposed || !showParsed) return;
    const raf = win()?.requestAnimationFrame;
    if (typeof raf !== "function") { sync(); return; }
    syncFrame = raf(() => sync());
  }

  const onIcon = (event) => {
    const icon = event.target?.closest?.(".pxd-parsed-copy");
    if (!icon) return false;
    event.stopPropagation?.();
    return icon;
  };
  const onIconDown = (event) => { if (onIcon(event)) event.preventDefault?.(); };
  const onIconClick = (event) => {
    const icon = onIcon(event);
    if (!icon) return;
    event.preventDefault?.();
    const id = icon.getAttribute("data-block");
    const block = getParsed?.()?.blocks?.[id];
    if (!block) return;
    try { copy?.(block); } catch { /* host */ }
  };

  const show = (block, el, parsed) => {
    const plan = chipPlan(block, parsed, { latexReady: Boolean(isLatexReady?.()) });
    const rect = bboxToPageRect(block.bbox, info(block.page), el);
    if (!plan || !rect) return;
    hide();
    current = block.id;
    hot(block.id, true);
    outline = doc.createElement("div");
    outline.className = "pxd-page-outline";
    outline.style.position = "absolute";
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${Math.max(0, rect.width)}px`;
    outline.style.height = `${Math.max(0, rect.height)}px`;
    outline.style.pointerEvents = "none";
    el.append(outline);

    chipNode = doc.createElement("div");
    chipNode.className = `pxd-page-chip pxd-page-chip--${plan.type}`;
    chipNode.setAttribute("data-block", block.id);
    chipNode.style.position = "absolute";
    chipNode.style.left = `${rect.left + rect.width}px`;
    chipNode.style.top = `${Math.max(0, rect.top)}px`;
    chipNode.style.pointerEvents = "auto";
    const main = button("pxd-page-chip__main", plan.label, `page-chip.${plan.type}`);
    chipNode.append(main);
    const node = chipNode;
    const swallow = (event) => { event.stopPropagation?.(); };
    on(node, "pointerdown", swallow);
    on(node, "mousedown", swallow);
    on(main, "click", (event) => { event.stopPropagation?.(); fire(plan.primary, block, event, el); });
    if (plan.menu.length) {
      const caret = button("pxd-page-chip__more", "▾", "page-chip.more");
      caret.setAttribute("aria-haspopup", "menu");
      const menu = doc.createElement("div");
      menu.className = "pxd-page-chip__menu";
      menu.setAttribute("role", "menu");
      menu.hidden = true;
      for (const item of plan.menu) {
        const entry = button("pxd-page-chip__item", item.label);
        entry.setAttribute("role", "menuitem");
        entry.setAttribute("data-act", item.act);
        if (item.extra?.mode) entry.setAttribute("data-mode", item.extra.mode);
        if (item.extra?.beside) entry.setAttribute("data-beside", "true");
        on(entry, "click", (event) => { event.stopPropagation?.(); fire(item, block, event, el); });
        menu.append(entry);
      }
      on(caret, "click", (event) => {
        event.stopPropagation?.();
        menu.hidden = !menu.hidden;
        caret.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
      });
      chipNode.append(caret);
      chipNode.append(menu);
    }
    el.append(chipNode);
    // These per-chip listeners go when the chip does.
    const mine = bound.splice(bound.findIndex((entry) => entry[0] === node));
    chipNode.__release = () => mine.forEach(off);
  };

  const release = () => { chipNode?.__release?.(); };
  const hideAll = () => { release(); hide(); };

  const onMove = (event) => {
    if (disposed) return;
    const parsed = getParsed?.();
    if (!parsed) return;
    if (showParsed && layers.size === 0) queueSync();
    updateCopy(event, parsed);
    if (chipNode && chipNode.contains?.(event.target)) { stopTimer(); return; }
    if (selecting()) { if (current) hideAll(); return; }
    const n = pageNumberOf(event.target, parsed);
    const el = n ? pageEl?.(n) : null;
    let hit = null;
    if (el) {
      const box = el.getBoundingClientRect();
      const x = (Number(event.clientX) || 0) - box.left;
      const y = (Number(event.clientY) || 0) - box.top;
      let best = Infinity;
      for (const block of pageBlocks(parsed, n)) {
        const r = bboxToPageRect(block.bbox, info(n), el);
        if (!r || x < r.left || x > r.left + r.width || y < r.top || y > r.top + r.height) continue;
        const area = r.width * r.height;
        if (area < best) { best = area; hit = block; }
      }
    }
    if (!hit) {
      if (current && hideTimer == null) hideTimer = later(hideAll, HIDE_MS);
      return;
    }
    stopTimer();
    if (hit.id === current) return;
    release();
    show(hit, el, parsed);
  };

  const clearDots = () => {
    for (const node of dots) drop(node);
    dots = [];
  };

  const showDots = () => {
    const parsed = getParsed?.();
    if (!parsed || dots.length) return;
    const order = parsed.order || [];
    let count = 0;
    for (let i = 0; i < order.length && count < DOT_CAP; i += 1) {
      const block = parsed.blocks?.[order[i]];
      if (!block) continue;
      const el = pageEl?.(block.page);
      if (!el) continue;
      const rect = bboxToPageRect(block.bbox, info(block.page), el);
      if (!rect) continue;
      const dot = doc.createElement("div");
      dot.className = "pxd-page-dot";
      dot.textContent = String(i + 1);
      dot.style.position = "absolute";
      dot.style.left = `${rect.left}px`;
      dot.style.top = `${rect.top}px`;
      dot.style.pointerEvents = "none";
      el.append(dot);
      dots.push(dot);
      count += 1;
    }
  };

  const onKeyDown = (event) => { if (event.key === "Shift" && !selecting()) showDots(); };
  const onKeyUp = (event) => { if (event.key === "Shift") clearDots(); };
  const onSelection = () => { if (selecting()) hideAll(); };
  const onLeave = () => { showCopy(null); if (current && hideTimer == null) hideTimer = later(hideAll, HIDE_MS); };

  const target = host || doc;
  on(target, "pointermove", onMove, true);
  on(target, "pointerleave", onLeave, true);
  on(doc, "selectionchange", onSelection);
  on(win(), "keydown", onKeyDown, true);
  on(win(), "keyup", onKeyUp, true);
  on(win(), "blur", clearDots);
  on(target, "pointerdown", onIconDown, true);
  on(target, "mousedown", onIconDown, true);
  on(target, "click", onIconClick, true);
  on(target, "scroll", queueSync, true);
  if (showParsed) queueSync();

  return {
    hover: onMove,
    hide: hideAll,
    current: () => current,
    // Repaint the persistent boxes (new parse, new pages). Writes nothing to the graph.
    refresh() {
      if (disposed) return;
      syncRetries = 0;
      dropLayers();
      if (showParsed) sync();
    },
    sync,
    shown: () => showParsed,
    setShown(on) {
      showParsed = Boolean(on);
      writeShowParsed(storage, showParsed);
      syncRetries = 0;
      dropLayers();
      if (showParsed) sync();
      return showParsed;
    },
    boxCount: () => boxCount,
    dispose() {
      disposed = true;
      hideAll();
      clearDots();
      dropLayers();
      if (syncFrame) { try { win()?.cancelAnimationFrame?.(syncFrame); } catch { /* stub */ } syncFrame = 0; }
      while (bound.length) off(bound.pop());
    },
  };
}

// Maps a chip action onto the session/actions object. Returns false when nothing was called.
// client: the placed ghost's top-left in client px (click-to-place); the insert lands there.
export function runChipAction({ act, ids, extra, block, client }, { session, payload, copy, latex } = {}) {
  const blocks = ids || [];
  if (act === "copy") { copy?.(blocks); return true; }
  if (act === "latex") { latex?.(block); return true; }
  const name = act === "table" ? "insertParsedTable"
    : act === "card" ? "insertParsedCard"
      : act === "board" ? "sendParsedToBoard"
        : act === "below" ? "insertParsedBelow" : null;
  const fn = name ? session?.[name] : null;
  if (typeof fn !== "function") return false;
  const body = payload(blocks);
  const merged = extra ? { ...body, ...extra } : body;
  fn(client && Number.isFinite(client.x) && Number.isFinite(client.y) ? { ...merged, client: { x: client.x, y: client.y } } : merged);
  return true;
}
