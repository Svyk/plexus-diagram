// Structure chips on the reader page. Hovering a parsed block outlines it and shows a chip at its
// top-right that runs one of the existing parse actions. Hover, outline and dots write nothing;
// only a chip click calls `run`. Pointer events are on the chip alone. No setPointerCapture.

import { bboxToPageRect } from "./parse-overlay.js";

const HIDE_MS = 220;
const DOT_CAP = 400;
export const CHIP_TYPES = Object.freeze(["table", "figure", "heading", "list", "formula"]);

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
      ],
    };
  }
  if (block.type === "figure") {
    return { type: "figure", label: "Figure · Card", primary: { act: "card", ids }, menu: [] };
  }
  if (block.type === "formula") {
    return {
      type: "formula",
      label: "Card",
      primary: { act: "card", ids },
      menu: latexReady ? [{ label: "LaTeX", act: "latex", ids }] : [],
    };
  }
  if (block.type === "heading") {
    return { type: "heading", label: "Insert section", primary: { act: "board", ids: sectionIds(doc, block.id) }, menu: [] };
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
} = {}) {
  const win = () => doc?.defaultView || null;
  const bound = [];
  let outline = null;
  let chipNode = null;
  let dots = [];
  let hideTimer = null;
  let current = null;
  let disposed = false;

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

  const fire = (item, block) => {
    hideAll();
    try { run?.(item.act, { ids: item.ids, extra: item.extra || null, block }); } catch { /* host */ }
  };

  const show = (block, el, parsed) => {
    const plan = chipPlan(block, parsed, { latexReady: Boolean(isLatexReady?.()) });
    const rect = bboxToPageRect(block.bbox, info(block.page), el);
    if (!plan || !rect) return;
    hide();
    current = block.id;
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
    on(main, "click", (event) => { event.stopPropagation?.(); fire(plan.primary, block); });
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
        on(entry, "click", (event) => { event.stopPropagation?.(); fire(item, block); });
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
  const onLeave = () => { if (current && hideTimer == null) hideTimer = later(hideAll, HIDE_MS); };

  const target = host || doc;
  on(target, "pointermove", onMove, true);
  on(target, "pointerleave", onLeave, true);
  on(doc, "selectionchange", onSelection);
  on(win(), "keydown", onKeyDown, true);
  on(win(), "keyup", onKeyUp, true);
  on(win(), "blur", clearDots);

  return {
    hover: onMove,
    hide: hideAll,
    current: () => current,
    dispose() {
      disposed = true;
      hideAll();
      clearDots();
      while (bound.length) off(bound.pop());
    },
  };
}

// Maps a chip action onto the session/actions object. Returns false when nothing was called.
export function runChipAction({ act, ids, extra, block }, { session, payload, copy, latex } = {}) {
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
  fn(extra ? { ...body, ...extra } : body);
  return true;
}
